const express = require('express');
const path    = require('path');
const fs      = require('fs');

const schedule = require('./treasure-schedule');
const { WEEKS: TREASURE_WEEKS, currentWeek } = require('./treasure-weeks');

const app  = express();
const PORT = 3333;
const MINUTE_MS = 60000;

// Works in dev + packaged (electron/packager puts resources beside app.asar)
const BASE       = process.env.RESOURCE_PATH || __dirname;
// user data lives outside the install folder (Program Files isn't writable):
// main.js passes %APPDATA%\Chest Counter when packaged, taps on first run
const DATA_DIR   = process.env.USER_DATA_PATH || BASE;
const DATA_FILE  = path.join(DATA_DIR, 'counts.json');
const PUBLIC_DIR = path.join(BASE, 'public');
// prize artwork is fetched from fortnite.bot's CDN once and cached here, so the
// repo ships no Epic assets and overlays work offline after the first look
const IMG_DIR = path.join(DATA_DIR, 'images');
const IMG_CDN = 'https://cdn.fortnite.bot/s43treasure/';

function loadCounts() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (data.date !== new Date().toDateString()) { data.today = 0; data.date = new Date().toDateString(); }
      // persisted bump timestamps survive restarts so the replay audit can
      // still match live-counted chests to the match window they belong to
      if (!Array.isArray(data.bumpTimes)) data.bumpTimes = [];
      return data;
    }
  } catch(e) {}
  return { total: 0, today: 0, date: new Date().toDateString(), bumpTimes: [] };
}

function saveCounts() {
  // bumpTimes travels with the counters so the audit pass survives restarts
  try { fs.writeFileSync(DATA_FILE, JSON.stringify({ ...counts, bumpTimes }), 'utf8'); } catch(e) {}
}

let counts  = loadCounts();
let clients = [];
let lastBumpAt = 0;
// audio spike + key tap on the same chest = one count; adjustable from panel
let dedupeMs = 900;

// â”€â”€ treasure hunt (Pirate Treasure event) â”€â”€
// Official Epic per-chest odds; Treasure Hours boost three of them.
const TREASURE_FILE = path.join(DATA_DIR, 'treasure.json');
const TREASURE_ITEMS = [
  { id: 'goldOutfit',    name: 'Weekly Gold Outfit',         short: 'Gold Outfit',   odds: 1562500, boost: 7.5 },
  { id: 'shopAccess',    name: 'Pirate Shop Access',         short: 'Shop Access',   odds: 137500,  boost: 1.5 },
  { id: 'vehicleDecal',  name: 'Weekly Vehicle & Decal',     short: 'Vehicle/Decal', odds: 7813,    boost: 10  },
  { id: 'pickBack',      name: 'Weekly Pickaxe / Backbling', short: 'Pickaxe',       odds: 568 },
  { id: 'jamTrack',      name: 'Weekly Jam Track',           short: 'Jam Track',     odds: 391 },
  { id: 'loadingScreen', name: 'Weekly Loading Screen',      short: 'Loading Screen',odds: 272 },
  { id: 'gizmo',         name: 'Gizmo (any)',                short: 'Gizmo',         odds: 127, repeatable: true },
];
let treasureHour = false;
// Manual override: a start time + duration the panel can set when Epic
// announces a window the weekly schedule doesn't know about. When it is unset
// (the normal case) the schedule module owns the countdown.
let nextHourAt = null;          // ISO string of an override start
let hourMinutes = 60;           // override duration, also the panel slider value
let treasure = { chestsSince: {}, lastFound: {}, foundCount: {} };
for (const it of TREASURE_ITEMS) { treasure.chestsSince[it.id] = 0; treasure.foundCount[it.id] = 0; }
try {
  const saved = JSON.parse(fs.readFileSync(TREASURE_FILE, 'utf8'));
  if (typeof saved.hour === 'boolean') treasureHour = saved.hour;
  if (typeof saved.nextHourAt === 'string' || saved.nextHourAt === null) nextHourAt = saved.nextHourAt;
  if (Number.isInteger(saved.hourMinutes)) hourMinutes = Math.min(180, Math.max(15, saved.hourMinutes));
  if (saved.chestsSince) for (const it of TREASURE_ITEMS)
    if (Number.isInteger(saved.chestsSince[it.id])) treasure.chestsSince[it.id] = Math.max(0, saved.chestsSince[it.id]);
  if (saved.lastFound) for (const it of TREASURE_ITEMS)
    if (typeof saved.lastFound[it.id] === 'string') treasure.lastFound[it.id] = saved.lastFound[it.id];
  if (saved.foundCount) for (const it of TREASURE_ITEMS)
    if (Number.isInteger(saved.foundCount[it.id])) treasure.foundCount[it.id] = Math.max(0, saved.foundCount[it.id]);
} catch (e) { /* defaults */ }
function saveTreasure() {
  try { fs.writeFileSync(TREASURE_FILE, JSON.stringify({ ...treasure, hour: treasureHour, nextHourAt, hourMinutes }), 'utf8'); } catch (e) {}
}

// the manual override as a start/end pair, or null when nothing is set
function overrideWindow(now = Date.now()) {
  if (!nextHourAt) return null;
  const start = Date.parse(nextHourAt);
  if (!Number.isFinite(start)) return null;
  return { start, end: start + hourMinutes * MINUTE_MS, source: 'override' };
}

// what the countdown should point at: a live/future manual override wins,
// otherwise the weekly schedule (Saturday 19:00 UTC, Sunday 02:00 UTC)
function hourInfo(now = Date.now()) {
  const ov = overrideWindow(now);
  if (ov && ov.end > now) return { ...ov, live: now >= ov.start };
  if (ov) { nextHourAt = null; saveTreasure(); }   // stale override — drop it
  const live = schedule.currentWindow(now);
  if (live) return { start: live.start, end: live.end, source: 'schedule', live: true };
  const next = schedule.nextWindow(now);
  return next ? { start: next.start, end: next.end, source: 'schedule', live: false } : null;
}
// chest-open timestamps (rolling hour) for the chests/hr rate; persisted in
// counts.json (capped) so restart-proof match-window matching works
let bumpTimes = counts.bumpTimes || [];
function pushBumpTime(t) {
  bumpTimes.push(t);
  if (bumpTimes.length > 5000) bumpTimes = bumpTimes.slice(-5000);
}
function chestsPerHour() {
  const cutoff = Date.now() - 3600000;
  while (bumpTimes.length && bumpTimes[0] < cutoff) bumpTimes.shift();
  return bumpTimes.length;
}

function treasureState() {
  const week = currentWeek();
  // which artwork belongs to each prize slot this week — the pickaxe/back
  // bling and jam track slots change art from week to week
  const artFor = (id) => {
    if (id === 'shopAccess') return 'token.webp';
    if (id === 'gizmo') return 'gizmo-smuggler-key.webp';
    const hit = week && week.items.find((i) => i.id === id);
    return hit ? hit.img : null;
  };
  return TREASURE_ITEMS.map(it => {
    const odds = it.boost && hourActive() ? it.odds / it.boost : it.odds;
    // geometric: after n dry chests, expected remaining = 1/p - n
    const expectedLeft = Math.round(odds - treasure.chestsSince[it.id]);
    return {
      id: it.id, name: it.name, short: it.short, odds: Math.round(odds), base: it.odds,
      boost: it.boost || null,
      repeatable: !!it.repeatable,
      chestsSince: treasure.chestsSince[it.id],
      foundCount: treasure.foundCount[it.id] || 0,
      expectedLeft,
      lastFound: treasure.lastFound[it.id] || null,
      img: artFor(it.id),
    };
  });
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients = clients.filter(c => { try { c.write(msg); return true; } catch(e) { return false; } });
}

// manual switch OR a live window (scheduled or overridden) keeps boosted odds on
function hourActive(now = Date.now()) {
  if (treasureHour) return true;
  const ov = overrideWindow(now);
  if (ov && now >= ov.start && now < ov.end) return true;
  return !!schedule.currentWindow(now);
}

function fullState() {
  const now = Date.now();
  const info = hourInfo(now);
  const week = currentWeek(now);
  // explicit fields only: `bumpTimes` is a per-chest timestamp log and must
  // never ride along in a state push (the TikTok tunnel serves /api/state)
  return {
    total: counts.total, today: counts.today, date: counts.date,
    chestsHour: chestsPerHour(),
    treasureHour: hourActive(now), manualHour: treasureHour,
    scheduledHour: !!(info && info.live && info.source === 'schedule'),
    hourSource: info ? info.source : null,
    nextHourAt: info ? new Date(info.start).toISOString() : null,
    hourEndsAt: info ? new Date(info.end).toISOString() : null,
    hourMinutes,
    // the next four windows, so the panel can list them without doing the math
    nextHours: schedule.upcoming(now, 4).map((w) => ({
      start: new Date(w.start).toISOString(),
      end: new Date(w.end).toISOString(),
    })),
    week: { n: week ? week.n : null, name: week ? week.name : null, weeks: TREASURE_WEEKS },
    treasure: treasureState(),
  };
}

app.use(express.json());

// ── public vs local surface ──
// The TikTok bridge puts this server on the open internet through a Cloudflare
// quick tunnel, so anything reachable there is public. Only the overlay pages,
// their artwork and the state stream are allowed; the panel, the control API
// and the replay history stay on this machine.
// Requiring an https origin on write requests would break OBS browser sources,
// so the allowlist is a path list, not an auth scheme.
const TUNNEL_HEADERS = ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for'];
const PUBLIC_GET = [
  /^\/overlay\/(total|today|treasure|items|week)$/,
  /^\/img\/treasure\/[a-z0-9-]+\.webp$/,
  /^\/events$/,
  /^\/api\/state$/,
];
function viaTunnel(req) {
  return TUNNEL_HEADERS.some((h) => typeof req.headers[h] === 'string');
}
app.use((req, res, next) => {
  if (!viaTunnel(req)) return next();
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET') { res.status(404).end(); return; }
  if (!PUBLIC_GET.some((re) => re.test(req.path))) { res.status(404).end(); return; }
  next();
});

app.use(express.static(PUBLIC_DIR));

app.get('/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  clients.push(res);
  res.write(`event: state\ndata: ${JSON.stringify(fullState())}\n\n`);
  req.on('close', () => { clients = clients.filter(c => c !== res); });
});

app.get('/api/config', (req, res) => res.json({ dedupeMs, treasureHour }));

app.post('/api/bump',   (req, res) => {
  const now = Date.now();
  if (now - lastBumpAt < dedupeMs) { res.json(counts); return; } // duplicate signal merged
  lastBumpAt = now;
  counts.total++; counts.today++; counts.date=new Date().toDateString(); saveCounts(); broadcast('state',fullState()); res.json(counts);
  // every counted chest advances the treasure hunt
  pushBumpTime(now);
  for (const it of TREASURE_ITEMS) treasure.chestsSince[it.id]++;
  saveTreasure();
});
app.post('/api/treasure', (req, res) => {  const { item } = req.body || {};
  const it = TREASURE_ITEMS.find(t => t.id === item);
  if (!it) { res.status(400).json({ error: 'unknown treasure' }); return; }
  treasure.chestsSince[it.id] = 0;
  treasure.lastFound[it.id] = new Date().toISOString();
  treasure.foundCount[it.id] = (treasure.foundCount[it.id] || 0) + 1;
  saveTreasure();
  broadcast('treasure', { id: it.id, name: it.name, repeatable: !!it.repeatable });
  res.json({ ok: true });
});
// clear the found history (items overlay) — dry counters stay untouched
app.post('/api/treasure/reset', (req, res) => {
  for (const it of TREASURE_ITEMS) {
    treasure.foundCount[it.id] = 0;
    delete treasure.lastFound[it.id];
  }
  saveTreasure();
  broadcast('state', fullState());
  res.json({ ok: true });
});
app.post('/api/set',    (req, res) => { const{field,value}=req.body; if(field==='total')counts.total=Math.max(0,parseInt(value)||0); if(field==='today')counts.today=Math.max(0,parseInt(value)||0); saveCounts(); broadcast('state',fullState()); res.json(counts); });
app.post('/api/adjust', (req, res) => { const v=parseInt(req.body.amount)||0; counts.total=Math.max(0,counts.total+v); counts.today=Math.max(0,counts.today+v); saveCounts(); broadcast('state',fullState()); res.json(counts); });
app.post('/api/reset',  (req, res) => { const{field}=req.body; if(field==='today')counts.today=0; if(field==='all'){counts.total=0;counts.today=0;} saveCounts(); broadcast('state',fullState()); res.json(counts); });
app.get('/api/state',   (req, res) => res.json(fullState()));
app.post('/api/config', (req, res) => {
  const { dedupeMs: d, treasureHour: h } = req.body || {};
  if (Number.isFinite(d) && d >= 0 && d <= 5000) dedupeMs = d | 0;
  if (typeof h === 'boolean') { treasureHour = h; saveTreasure(); broadcast('state', fullState()); }
  res.json({ dedupeMs, treasureHour });
});

// Override the weekly schedule with a specific Treasure Hour (only needed when
// Epic announces a one-off window). Send nextAt:null to drop the override and
// hand the countdown back to the schedule.
app.post('/api/treasure-hour', (req, res) => {
  const { nextAt, minutes } = req.body || {};
  if (nextAt === null) {
    nextHourAt = null;
  } else {
    const t = Date.parse(nextAt);
    if (!Number.isFinite(t)) { res.status(400).json({ error: 'bad nextAt' }); return; }
    nextHourAt = new Date(t).toISOString();
  }
  if (Number.isFinite(minutes)) hourMinutes = Math.min(180, Math.max(15, minutes | 0));
  saveTreasure();
  broadcast('state', fullState());
  res.json({ nextHourAt, hourMinutes });
});

// main-process push channel (key listener + foreground app events â†’ UI/overlays)
app.post('/api/notify', (req, res) => {
  const { event, data } = req.body || {};
  if (event) broadcast(event, data);
  res.json({ ok: true });
});

app.get('/overlay/total', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'overlays', 'total.html')));
app.get('/overlay/today', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'overlays', 'today.html')));
app.get('/overlay/treasure', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'overlays', 'treasure.html')));
app.get('/overlay/items', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'overlays', 'items.html')));
app.get('/overlay/week', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'overlays', 'week.html')));

// ── prize artwork cache ──
// first request downloads the webp from the CDN and keeps it in user data;
// later requests (and the TikTok tunnel) are served straight off disk.
app.get('/img/treasure/:file', async (req, res) => {
  const file = req.params.file;
  if (!/^[a-z0-9-]+\.webp$/.test(file)) { res.status(400).end(); return; }
  const cached = path.join(IMG_DIR, file);
  const send = (buf) => {
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.type('image/webp').send(buf);
  };
  try {
    if (fs.existsSync(cached)) { send(fs.readFileSync(cached)); return; }
  } catch (e) { /* fall through to the network */ }
  try {
    const r = await fetch(IMG_CDN + file, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) { res.status(404).end(); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(IMG_DIR, { recursive: true });
    fs.writeFileSync(cached, buf);
    send(buf);
  } catch (e) {
    res.status(404).end();
  }
});

// ── replay-based chest counting (replay.js) ──
// Parses finished match replays Fortnite saved on disk and credits the chests
// the recording player opened/broken with their pickaxe. The live tap-gate is
// the instant counter; the replay is the authoritative per-match audit.
const replayWatcher = require('./replay.js');

replayWatcher.start({
  base: BASE,
  dataDir: DATA_DIR,   // replay-history.json lives with the other user data
  getSnapshot: () => ({ total: counts.total, today: counts.today }),
  onMatch: (match) => {
    if (match.added > 0) {
      // old backfilled matches only add to the lifetime total; matches from
      // today count toward today's number too (date lives in the filename)
      const d = (match.file.match(/(\d{4})\.(\d{2})\.(\d{2})/) || []);
      const isToday = d.length === 4 &&
        new Date(+d[1], +d[2] - 1, +d[3]).toDateString() === new Date().toDateString();
      counts.total += match.added;
      if (isToday) counts.today += match.added;
      counts.date = new Date().toDateString();
      saveCounts();
      // replay-audit bumps use one shared timestamp; they happen after the
      // match window closed, so they can't inflate a later window's match
      const now = Date.now();
      for (let i = 0; i < match.added; i++) pushBumpTime(now);
      for (const it of TREASURE_ITEMS) treasure.chestsSince[it.id] += match.added;
      saveTreasure();
      broadcast('state', fullState());
    }
    broadcast('replay', match);
  },
  getLiveDuring: (startMs, endMs) => {
    // how many chests the live tap-gate counted inside this match's window
    const from = startMs - 120000, to = endMs + 300000;
    return bumpTimes.filter((t) => t >= from && t <= to).length;
  },
  log: (msg) => console.log(msg),
});

app.get('/api/replays', (req, res) => res.json(replayWatcher.status()));

// loopback only: the tunnel is the one deliberate way out, and it goes through
// cloudflared — nothing else on the LAN needs to reach this port
const server = app.listen(PORT, '127.0.0.1', () => console.log(`Chest Counter running on 127.0.0.1:${PORT}`));
server.on('error', (e) => console.error('server:', e.message));
