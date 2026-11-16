// Replay watcher — the chest-open detection that reads Fortnite's own replay
// files. No game memory, no injection, no input automation: Fortnite writes
// the .replay files at %LOCALAPPDATA%\FortniteGame\Saved\Demos when replays
// are on (Settings › Game › Replays), we parse each finished match with the
// bundled reader (replay-reader/, MIT — see its LICENSE + NOTICE.md) in a
// child process, and count the chests opened/broken by the recording player.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// WORKER + history resolve against the resource base: in the packaged app the
// reader lives in resources/ (outside app.asar), next to counts.json.
let WORKER = null;
let HISTORY_FILE = null;const HISTORY_MAX = 200;

// a .replay file is "done" after this much quiet time and a sane size
const SETTLE_MS = 8000;
const MIN_SIZE = 4096;
// keep the spawn count sane when a whole history gets backfilled at startup
const MAX_PARALLEL = 2;

let cfg = null;            // { getSnapshot(), onMatch(match), log() }
let watcher = null;
let pending = new Map();   // file → { size, timer } — one settle timer per candidate
let parsing = new Set();   // files in flight
let history = [];

// ── match-phase windows from Fortnite's own log ──
// HandleGamePhaseChanged lines carry the game's local clock timestamp. Each
// match = one window (Aircraft/SafeZones opens it, EndGame closes it). The
// audit pass matches a replay file to its window by the start time encoded
// in the filename, then asks the server how many bumps the live tap-gate
// counted inside that window — only the difference gets added, so the live
// counter and the replay audit never double-count the same chest.
let logPos = 0;
let logCarry = '';         // partial line from the last tail chunk
let windows = [];          // [{ startMs, endMs }] — endMs null while match live
let logTimer = null;
const WINDOWS_MAX = 60;

// a match window only counts if the app saw it open (or read it at startup);
// matches with no window here = app was off → the replay adds fully
const PHASE_RE = /\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\].*HandleGamePhaseChanged\..*NewPhase = EAthenaGamePhase::(\w+)/;

function loadHistory() {
  try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); }
  catch (e) { history = []; }
}

function saveHistory() {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history), 'utf8'); } catch (e) {}
}

function demosDir() {
  return path.join(process.env.LOCALAPPDATA || '', 'FortniteGame', 'Saved', 'Demos');
}

function fortniteLog() {
  return path.join(process.env.LOCALAPPDATA || '', 'FortniteGame', 'Saved', 'Logs', 'FortniteGame.log');
}

function tailLog() {
  const file = fortniteLog();
  let st;
  try { st = fs.statSync(file); } catch (e) { logPos = 0; logCarry = ''; return; }
  if (st.size < logPos) { logPos = 0; logCarry = ''; } // log rotated → new session
  if (st.size === logPos) return;
  // cap the read so a giant log can't stall the loop — 8MB covers a day of BR
  const start = logPos;
  const end = Math.min(st.size, start + 8388608);
  let buf;
  try { buf = readSlice(file, start, end); } catch (e) { return; }
  logPos = end;
  const text = logCarry + buf.toString('utf8');
  const lines = text.split(/\r?\n/);
  logCarry = lines.pop() || '';              // last line may be incomplete
  for (const line of lines) applyPhaseLine(line);
}

// one phase line in → open/close the match window it describes
function applyPhaseLine(line) {
  const m = PHASE_RE.exec(line);
  if (!m) return;
  // log clock = local time ([2026.11.15-13.50.33:836])
  const ts = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]).getTime();
  const phase = m[8];
  if (phase === 'Aircraft' || phase === 'SafeZones') {
    const last = windows[windows.length - 1];
    if (last && last.endMs === null) return;   // already inside a live match
    windows.push({ startMs: ts, endMs: null });
  } else if (phase === 'EndGame') {
    const last = windows[windows.length - 1];
    if (last && last.endMs === null) last.endMs = ts;
  } else {
    // Warmup / Setup → back to lobby without an EndGame (quit, disconnect):
    // close the open window so the next match gets its own
    const last = windows[windows.length - 1];
    if (last && last.endMs === null) last.endMs = ts;
  }
  if (windows.length > WINDOWS_MAX) windows = windows.slice(-WINDOWS_MAX);
}

// startup: read the current log from the beginning so matches played before
// the app started (but this session) still get windows — without a window the
// audit adds full, which is only correct when the app was truly off
function readWholeLog() {
  const file = fortniteLog();
  let st;
  try { st = fs.statSync(file); } catch (e) { return; }
  const from = Math.max(0, st.size - 8388608); // last 8MB of a huge log
  logPos = st.size;
  let buf;
  try { buf = readSlice(file, from, st.size); } catch (e) { return; }
  const text = buf.toString('utf8');
  for (const line of text.split(/\r?\n/)) applyPhaseLine(line);
  if (cfg && windows.length) cfg.log(`replay: ${windows.length} match window(s) from the game log`);
}

function readSlice(file, start, end) {
  const fd = fs.openSync(file, 'r');
  try {
    const len = end - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf;
  } finally { fs.closeSync(fd); }
}

// How many chests did the live tap-gate count during the match that produced
// this replay file? Match the file to its window by the start time in the
// filename (UnsavedReplay-2026.11.15-13.50.33 = local match start): a window
// belongs when it opened within [-2 min, +12 min] of that. No window → the
// app was off during the match → live counted nothing → full add is correct.
const FILENAME_START_RE = /UnsavedReplay-(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})/;
async function liveDuringFor(file) {
  let m;
  try { m = FILENAME_START_RE.exec(path.basename(file)); } catch (e) { m = null; }
  if (!m) return 0;
  const fileStart = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  let best = null;
  for (const w of windows) {
    if (w.startMs < fileStart - 120000 || w.startMs > fileStart + 720000) continue;
    if (!best || Math.abs(w.startMs - fileStart) < Math.abs(best.startMs - fileStart)) best = w;
  }
  if (!best || !cfg || !cfg.getLiveDuring) return 0;
  const endMs = best.endMs === null ? Date.now() : best.endMs;
  return Math.max(0, cfg.getLiveDuring(best.startMs, endMs));
}

function spawnWorker(file) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(process.execPath, [WORKER, file], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const timer = setTimeout(() => { try { child.kill(); } catch (e) {} resolve(null); }, 180000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('exit', () => {
      clearTimeout(timer);
      const line = out.split(/\r?\n/).find((l) => l.startsWith('FCT-RESULT '));
      if (!line) { resolve(null); return; }
      try { resolve(JSON.parse(line.slice('FCT-RESULT '.length))); } catch (e) { resolve(null); }
    });
  });
}

// simple 2-wide semaphore so a full-history backfill never spawns 90 workers
let active = 0;
const slotWaiters = [];
function acquireSlot() {
  if (active < MAX_PARALLEL) { active += 1; return Promise.resolve(); }
  return new Promise((resolve) => slotWaiters.push(resolve));
}
function releaseSlot() {
  const next = slotWaiters.shift();
  if (next) next(); else active -= 1;
}

async function parseFile(file) {
  const key = path.basename(file);
  if (parsing.has(key)) return;
  parsing.add(key);
  if (cfg) cfg.log(`replay: parsing ${key}`);
  await acquireSlot();
  let result = null;
  try {
    result = await spawnWorker(file);
  } finally {
    releaseSlot();
    parsing.delete(key);
  }
  if (!result) {
    return failParse(file, key, 1, 'reader crashed or timed out');
  }
  if (!result.ok) {
    // "Replay encrypted but not completed" / "Too much was read" usually mean
    // the file wasn't finalized yet — retry a few times before giving up
    return failParse(file, key, 1, result.reason || 'unknown');
  }
  triesMap.delete(key);
  const fileName = key;
  // live tap-gate counts during the same match are already in the counter —
  // only the difference is new, and never below zero
  const liveDuring = await liveDuringFor(file);
  const delta = Math.max(0, (result.ownChests || 0) - liveDuring);
  const match = {
    file: fileName,
    parsedAt: new Date().toISOString(),
    playlist: result.playlist || null,
    ownChests: result.ownChests || 0,
    mateChests: result.mateChests || 0,
    ownBroken: result.ownBroken || 0,   // pickaxe-broken chests (bDestroyed path)
    mateBroken: result.mateBroken || 0,
    ownTimes: result.ownTimes || [],
    parseMs: result.parseMs || null,
    ok: !!result.ok,
    reason: result.ok ? null : (result.reason || 'unknown'),
    added: delta,
    liveDuring,
  };
  history = history.filter((h) => h.file !== fileName);
  history.push(match);
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  saveHistory();
  if (cfg) cfg.onMatch(match);
}

// a failed parse shows as a red row and re-queues — the file may still be
// getting finalized by the game. Give up only after several spaced tries.
const MAX_PARSE_TRIES = 5;
const RETRY_MS = 45000;
const triesMap = new Map();   // basename → attempts (runtime; entry keeps it for restarts)
let retryTimers = new Map();  // basename → timer

function failParse(file, key, extraTries, reason) {
  const tries = (triesMap.get(key) || 0) + extraTries;
  triesMap.set(key, tries);
  if (cfg) cfg.log(`replay: parse failed for ${key} (try ${tries}/${MAX_PARSE_TRIES}) — ${reason}`);
  const existing = history.find((h) => h.file === key);
  const match = existing && existing.ok === false
    ? { ...existing, tries, reason, parsedAt: new Date().toISOString() }
    : {
        file: key,
        parsedAt: new Date().toISOString(),
        playlist: null, ownChests: 0, mateChests: 0, ownBroken: 0, mateBroken: 0,
        ownTimes: [], parseMs: null,
        ok: false, reason, added: 0, liveDuring: 0,
      };
  history = history.filter((h) => h.file !== key);
  history.push(match);
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  saveHistory();
  if (cfg) cfg.onMatch(match);
  if (tries < MAX_PARSE_TRIES) {
    const prev = retryTimers.get(key);
    if (prev) clearTimeout(prev);
    retryTimers.set(key, setTimeout(() => {
      retryTimers.delete(key);
      consider(file);
    }, RETRY_MS));
  }
}

function consider(file) {
  const fileName = path.basename(file);
  if (!/\.replay$/i.test(fileName)) return;
  // retry ladder: a failed entry re-parses until MAX_PARSE_TRIES
  const existing = history.find((h) => h.file === fileName);
  if (existing && existing.ok !== false) return;
  if (existing && (existing.tries || 0) >= MAX_PARSE_TRIES) return;
  if (parsing.has(fileName)) return;
  // reset this file's settle timer on every write burst
  const prev = pending.get(file);
  if (prev) clearTimeout(prev.timer);
  let size = 0;
  try { size = fs.statSync(file).size; } catch (e) { pending.delete(file); return; }
  pending.set(file, {
    size,
    timer: setTimeout(async () => {
      pending.delete(file);
      let st;
      try { st = fs.statSync(file); } catch (e) { return; }
      if (st.size < MIN_SIZE) return;                 // still empty / aborted
      if (st.size !== size) { consider(file); return; }  // still growing
      if (Date.now() - st.mtimeMs < SETTLE_MS) { consider(file); return; }
      await parseFile(file);
    }, SETTLE_MS),
  });
}

function start(options) {
  cfg = options;
  WORKER = path.join(options.base, 'replay-reader', 'fct', 'worker.cjs');
  HISTORY_FILE = path.join(options.dataDir || options.base, 'replay-history.json');
  loadHistory();
  // failed entries resume their retry ladder after a restart
  for (const h of history) {
    if (h.ok === false && (h.tries || 0) < MAX_PARSE_TRIES) {
      triesMap.set(h.file, h.tries || 1);
    }
  }
  const dir = demosDir();
  try {
    watcher = fs.watch(dir, (eventType, fileName) => {
      if (!fileName) return;
      consider(path.join(dir, fileName));
    });
  } catch (e) {
    if (cfg) cfg.log(`replay: cannot watch ${dir} — ${e.message}`);
  }
  // scan once at startup: catch a replay finished while the app was closed
  setTimeout(() => {
    try {
      for (const f of fs.readdirSync(dir)) consider(path.join(dir, f));
    } catch (e) {}
  }, 5000);
  readWholeLog();               // windows for matches already in this log session
  logTimer = setInterval(tailLog, 5000);
}

function stop() {
  if (watcher) { watcher.close(); watcher = null; }
  if (logTimer) { clearInterval(logTimer); logTimer = null; }
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  for (const t of retryTimers.values()) clearTimeout(t);
  retryTimers.clear();
}

function status() {
  return {
    watching: !!watcher,
    matches: history.length,
    totalOwn: history.reduce((a, h) => a + (h.ownChests || 0), 0),
    totalMate: history.reduce((a, h) => a + (h.mateChests || 0), 0),
    totalOwnBroken: history.reduce((a, h) => a + (h.ownBroken || 0), 0),
    history: history.slice(-30).reverse(),
  };
}

module.exports = { start, stop, status };
