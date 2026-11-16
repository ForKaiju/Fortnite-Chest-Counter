const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

// app identity before anything reads a path: user data lands in
// %APPDATA%\Chest Counter (writable) instead of the install folder
app.setName('Chest Counter');
app.setAppUserModelId('com.chestcounter.app');

const PORT = 3333;
let mainWindow = null;
let tray = null;
let serverStarted = false;

// ── user data (counters, settings, replay history) ──
// Packaged builds keep data in %APPDATA%\Chest Counter; dev keeps it beside
// the sources. Earlier builds wrote into resources/ — migrate those once.
function dataDir() {
  return app.isPackaged ? app.getPath('userData') : __dirname;
}
function resourceDir() {
  return app.isPackaged ? process.resourcesPath : __dirname;
}
const DATA_FILES = ['counts.json', 'treasure.json', 'config.json', 'replay-history.json'];
function migrateLegacyData() {
  const dest = dataDir();
  if (dest === resourceDir()) return;
  try { fs.mkdirSync(dest, { recursive: true }); } catch (e) {}
  for (const f of DATA_FILES) {
    const src = path.join(resourceDir(), f);
    const dst = path.join(dest, f);
    try {
      if (!fs.existsSync(dst) && fs.existsSync(src)) fs.copyFileSync(src, dst);
    } catch (e) {}
  }
}

// ── global key listener (passive WH_KEYBOARD_LL, via hook.ps1) ──
// Listen-only: reads key state system-wide, never sends input,
// never reads game memory, never injects — external overlay tooling.
const HOLD_SAFETY_MS = 10000;   // kill a stuck hold if keyup never arrives
let hookProc = null;
let hookBuf = '';
let hookWant = false;           // user intent: listener enabled
let hookUp = false;             // hook reports HOOKED
let holding = false;
let holdStart = 0;
let holdTicker = null;
let holdSafetyTimer = null;
let lastFg = '';

// ── interact-prompt watcher (chest-probe.ps1, screen OCR, external only) ──
// The game shows "Search Chest" on screen while a chest is in interact
// range. This watches the screen and arms the key counter only while that
// prompt is visible. No memory reads, no injection — pixels only.
const PROMPT_FRESH_MS = 2500;  // prompt seen within this window → chest in range
let probeProc = null;
let probeBuf = '';
let promptOn = false;          // last reported prompt state
let lastPromptAt = 0;          // Date.now() of last PROMPT:1
let promptUp = false;          // probe reported READY

function promptRecent() {
  return Date.now() - lastPromptAt < PROMPT_FRESH_MS;
}

function handleProbeLine(line) {
  if (line === 'READY') {
    promptUp = true;
    notify('prompt', { up: true });
  } else if (line === 'OCRFAIL') {
    promptUp = false;
    notify('prompt', { up: false, failed: true });
  } else if (line === 'PROMPT:1') {
    promptOn = true;
    lastPromptAt = Date.now();
    notify('prompt', { on: true, fresh: true });
  } else if (line === 'PROMPT:0') {
    promptOn = false;
    notify('prompt', { on: false });
  }
}

function spawnProbe() {
  if (probeProc) return;
  const script = getResourcePath('chest-probe.ps1');
  probeBuf = '';
  probeProc = spawn('powershell.exe', [
    '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script,
  ], { windowsHide: true });
  probeProc.stdout.on('data', d => {
    probeBuf += d.toString();
    let i;
    while ((i = probeBuf.indexOf('\n')) >= 0) {
      const line = probeBuf.slice(0, i).trim();
      probeBuf = probeBuf.slice(i + 1);
      if (line) handleProbeLine(line);
    }
  });
  probeProc.stderr.on('data', () => {}); // keep the pipe drained
  probeProc.on('exit', () => {
    probeProc = null;
    promptUp = false;
    promptOn = false;
    if (!app.isQuitting) setTimeout(spawnProbe, 2000); // watchdog respawn
  });
}

function stopProbe() {
  if (probeProc) { probeProc.kill(); probeProc = null; }
  promptUp = false;
  promptOn = false;
}

// ── settings (persisted so tray-only state matches) ──
const CONFIG_DEFAULTS = {
  smartMode: true,
  keyVK: 0x45,    // E — Fortnite interact key
  keyName: 'E',
  tapMin: 80,     // smart mode: shorter than any deliberate interact
  tapMax: 900,    // smart mode: longer = looting menus, not a chest
  holdMs: 3000,   // legacy mode: hold duration to count
  dedupeMs: 900,  // merge duplicate signals (audio + key) on one chest
  sfxOn: false, sfxVol: 60,
  promptGate: true, // count E only when the on-screen chest prompt is live
  tunnelOn: false,  // TikTok bridge (cloudflared) — opt-in, it puts overlays on a public URL
};
function configPath() {
  return path.join(dataDir(), 'config.json');
}
let config = { ...CONFIG_DEFAULTS };
try {
  const stored = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  for (const k of Object.keys(CONFIG_DEFAULTS)) {
    if (typeof stored[k] === typeof CONFIG_DEFAULTS[k]) config[k] = stored[k];
  }
} catch (e) { /* defaults */ }
function saveConfig() {
  try { fs.writeFileSync(configPath(), JSON.stringify(config), 'utf8'); } catch (e) {}
}
function pushConfig() {
  fetch(`http://localhost:${PORT}/api/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dedupeMs: config.dedupeMs }),
  }).catch(() => {});
}

function notify(event, data) {
  fetch(`http://localhost:${PORT}/api/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, data }),
  }).catch(() => {});
}

function bumpCount() {
  fetch(`http://localhost:${PORT}/api/bump`, { method: 'POST' }).catch(() => {});
}

// ── TikTok bridge (bridge.js — cloudflared quick tunnel) ──
const bridge = require('./bridge.js');
bridge.setDataDir(dataDir());
bridge.setNotifier((event, data) => {
  notify(event, data);
  if (event !== 'tunnel' || !mainWindow) return;
  // every state reaches the panel — starting, downloading, error, off. Before
  // this only a successful `on` was forwarded, so a failed start sat on
  // "Starting…" forever with nothing to show the user what went wrong.
  mainWindow.webContents.send('tunnel-state', data);
  if (data.on && data.url) mainWindow.webContents.send('tunnel-url', data.url);
});

function stopHold() {
  holding = false;
  if (holdTicker) { clearInterval(holdTicker); holdTicker = null; }
  if (holdSafetyTimer) { clearTimeout(holdSafetyTimer); holdSafetyTimer = null; }
}

function finishHold() {
  stopHold();
  notify('hold', { phase: 'counted' });
  bumpCount();
}

function handleHookLine(line) {
  if (line === 'DOWN') {
    if (holding) return; // key repeat already handled inside the hook
    holding = true;
    holdStart = Date.now();
    notify('hold', { phase: 'down' });
    if (!config.smartMode) {
      holdTicker = setInterval(() => {
        const el = Date.now() - holdStart;
        if (el >= config.holdMs) {
          // gate applies at the moment the hold completes too
          if (config.promptGate && !promptRecent()) {
            notify('hold', { phase: 'blocked' });
            return; // keep holding — count fires when a chest prompt is live
          }
          finishHold();
          return;
        }
        notify('hold', { phase: 'progress', pct: Math.min(100, (el / config.holdMs) * 100) });
      }, 50);
      holdSafetyTimer = setTimeout(() => stopHold(), HOLD_SAFETY_MS);
    } else {
      // smart: UP decides. A stuck key just times out silently — no fake count.
      holdSafetyTimer = setTimeout(() => stopHold(), config.tapMax + 500);
    }
  } else if (line === 'UP') {
    if (!holding) return; // legacy already auto-counted at holdMs; this UP is stale
    const dur = Date.now() - holdStart;
    stopHold();
    if (config.smartMode) {
      if (dur >= config.tapMin && dur <= config.tapMax) {
        // chest proximity gate: the on-screen prompt must be fresh
        if (config.promptGate && !promptRecent()) {
          notify('hold', { phase: 'blocked' });
        } else {
          finishHold();
        }
      }
      else notify('hold', { phase: 'up' });
    } else {
      notify('hold', { phase: 'up' });
    }
  } else if (line === 'HOOKED') {
    hookUp = true;
    notify('hook', { on: true });
  } else if (line === 'HOOKFAIL') {
    hookUp = false;
    notify('hook', { on: false, failed: true });
  } else if (line.startsWith('FG:')) {
    const name = line.slice(3);
    if (name && name !== lastFg) {
      lastFg = name;
      notify('fg', { name });
    }
  }
}

function spawnHook() {
  if (hookProc || !hookWant) return;
  const script = getResourcePath('hook.ps1');
  hookBuf = '';
  hookProc = spawn('powershell.exe', [
    '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Vk', String(config.keyVK),
  ], { windowsHide: true });
  hookProc.stdout.on('data', d => {
    hookBuf += d.toString();
    let i;
    while ((i = hookBuf.indexOf('\n')) >= 0) {
      const line = hookBuf.slice(0, i).trim();
      hookBuf = hookBuf.slice(i + 1);
      if (line) handleHookLine(line);
    }
  });
  hookProc.on('exit', () => {
    hookProc = null;
    hookUp = false;
    stopHold();
    if (hookWant) setTimeout(spawnHook, 2000); // crash watchdog respawn
  });
}

function startKeyHook() {
  hookWant = true;
  spawnHook();
}

function stopKeyHook() {
  hookWant = false;
  hookUp = false;
  stopHold();
  if (hookProc) { hookProc.kill(); hookProc = null; }
  notify('hook', { on: false });
}

function getResourcePath(...parts) {
  // Works in dev AND in packaged --asar build
  if (app.isPackaged) {
    // resources are OUTSIDE the asar, in resources/
    return path.join(process.resourcesPath, ...parts);
  }
  return path.join(__dirname, ...parts);
}

function startServer() {
  if (serverStarted) return;
  serverStarted = true;
  // Pass resource + data paths to the server via env
  process.env.RESOURCE_PATH = resourceDir();
  process.env.USER_DATA_PATH = dataDir();
  require('./server.js');
}

function waitForServer(cb, tries = 0) {
  http.get(`http://localhost:${PORT}/api/state`, res => {
    if (res.statusCode === 200) { cb(); return; }
    tryAgain();
  }).on('error', tryAgain);
  function tryAgain() {
    if (tries > 50) { cb(); return; }
    setTimeout(() => waitForServer(cb, tries + 1), 100);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 860,
    resizable: false,          // one fixed size — no scaling, no maximize
    maximizable: false,
    fullscreenable: false,
    title: '⚔ Chest Counter',
    icon: getResourcePath('build', 'icon.ico'),
    backgroundColor: '#0d0803',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.setMenuBarVisibility(false);
  // pin zoom: no ctrl+wheel, no pinch — the layout is size-locked
  mainWindow.webContents.setZoomFactor(1);
  // pinch-zoom floor (setZoomLimits landed after Electron 30)
  try { mainWindow.webContents.setVisualZoomLevelLimits(1, 1); } catch (e) {}

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  const iconPath = getResourcePath('build', 'icon.ico');
  const img = nativeImage.createFromPath(iconPath);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('⚔ Chest Counter');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '⚔ Open Panel',       click: () => { if (mainWindow) mainWindow.show(); else createWindow(); } },
    { label: '🌐 Open in Browser', click: () => shell.openExternal(`http://localhost:${PORT}`) },
    { label: '📺 OBS Total URL',   click: () => shell.openExternal(`http://localhost:${PORT}/overlay/total`) },
    { label: '📺 OBS Today URL',   click: () => shell.openExternal(`http://localhost:${PORT}/overlay/today`) },
    { label: '✦ Treasure Hour Preview', click: () => openOverlayWindow('treasure') },
    { label: '✦ Treasure Items Preview', click: () => openOverlayWindow('items') },
    { label: '✦ Weekly Prizes Preview', click: () => openOverlayWindow('week') },
    { type: 'separator' },
    { label: 'Quit',               click: () => app.quit() },
  ]));
  tray.on('double-click', () => { if (mainWindow) mainWindow.show(); else createWindow(); });
}

ipcMain.on('open-overlay', (e, type) => openOverlayWindow(type));

// preview windows open at the size the source is designed for, so what you
// see here is what OBS shows when the browser source is set to it
const OVERLAY_SIZES = { total: [500, 148], today: [500, 148], treasure: [460, 132], items: [420, 386], week: [420, 410] };
function openOverlayWindow(type) {
  const [w, h] = OVERLAY_SIZES[type] || [520, 170];
  const ow = new BrowserWindow({
    width: w,
    height: h,
    useContentSize: true,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    icon: getResourcePath('build', 'icon.ico'),
    webPreferences: { contextIsolation: true },
  });
  ow.loadURL(`http://localhost:${PORT}/overlay/${type}`);
  ow.setAlwaysOnTop(true, 'screen-saver');
}

// Desktop-audio loopback is gone: nothing in the app captures the screen or the
// system audio mix any more. Detection is the key listener plus the on-screen
// prompt watcher — both read-only — and the replay audit.
ipcMain.handle('keyhook-toggle', (e, on) => {
  if (on) startKeyHook(); else stopKeyHook();
  return { want: hookWant, up: hookUp };
});

ipcMain.handle('keyhook-state', () => ({ want: hookWant, up: hookUp }));

ipcMain.handle('tunnel-toggle', (e, on) => {
  if (on) { bridge.enable(); return { on: true, starting: true, url: bridge.status().url }; }
  bridge.stop();
  return { on: false, starting: false, url: null };
});

ipcMain.handle('tunnel-state', () => bridge.status());

// Type-checked settings patch. keyVK change restarts the hidden hook host
// so the new bind takes effect system-wide immediately.
ipcMain.handle('get-config', () => ({ ...config, hookUp }));

ipcMain.handle('update-config', (e, patch) => {
  if (typeof patch !== 'object' || patch === null) return { ...config };
  let respawnHook = false;
  for (const k of Object.keys(CONFIG_DEFAULTS)) {
    if (!(k in patch) || typeof patch[k] !== typeof CONFIG_DEFAULTS[k]) continue;
    // numeric sanity: keep windows ordered, keep VK in hookable range
    if (typeof patch[k] === 'number' && !Number.isFinite(patch[k])) continue;
    if (k === 'keyVK') {
      const vk = patch[k] | 0;
      if (vk < 8 || vk > 254) continue;
      if (vk !== config.keyVK) respawnHook = true;
    }
    if (k === 'tapMin' && patch[k] < 20) continue;
    if (k === 'tapMax' && patch[k] > 6000) continue;
    if (k === 'holdMs' && (patch[k] < 500 || patch[k] > 30000)) continue;
    if (k === 'dedupeMs' && (patch[k] < 0 || patch[k] > 5000)) continue;
    if (k === 'keyName' && (typeof patch[k] !== 'string' || patch[k].length > 20)) continue;
    config[k] = patch[k];
  }
  // keep tap windows ordered
  if (config.tapMin > config.tapMax) config.tapMax = config.tapMin + 50;
  saveConfig();
  pushConfig();
  if (respawnHook && hookWant) {
    stopKeyHook();
    startKeyHook();
  }
  return { ...config };
});

// one instance only — the server owns :3333
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
    else createWindow();
  });
}

app.whenReady().then(() => {
  if (!gotLock) return; // second instance: it quits, never starts a server
  migrateLegacyData();
  startServer();
  waitForServer(() => {
    createWindow();
    createTray();
    pushConfig(); // server up — hand it dedupeMs
    spawnProbe(); // screen watcher for the chest-prompt gate
    startKeyHook(); // listener lives in the main process — sees keys while Fortnite is focused
    if (config.tunnelOn) bridge.enable(); // TikTok Add link wants a public https URL
  });
});

app.on('window-all-closed', () => { /* stay in tray */ });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('before-quit', () => { app.isQuitting = true; stopKeyHook(); stopProbe(); bridge.stop(); });
