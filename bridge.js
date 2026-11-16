// TikTok bridge — TikTok Live Studio's "Add link" only accepts public
// https:// URLs, so localhost browser sources can't be pasted directly.
// This runs Cloudflare's official cloudflared quick tunnel in front of the
// local server and hands out a paste-ready public URL. No account needed.
// (cloudflared is Cloudflare's open-source tool — the binary sits next to
// the app resources, launch flags: --no-autoupdate, --url localhost:3333.)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');

// official Cloudflare release; fetched once on first use when not shipped
const CLOUDFLARED_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
const CLOUDFLARED_MIN_BYTES = 20 * 1024 * 1024; // sanity floor against error pages

const PORT = 3333;
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
// give the tunnel this long to produce a URL before declaring failure
const STARTUP_TIMEOUT_MS = 60000;
// between restart attempts after a crash
const RETRY_MS = 8000;
const MAX_ATTEMPTS = 3;

let notify = () => {};
let proc = null;
let wantOn = false;          // user intent
let publicUrl = null;        // last known trycloudflare URL
let booting = false;
let attempts = 0;
let startupTimer = null;
let retryTimer = null;

let dataDirPath = null;
function setDataDir(d) { dataDirPath = d; }

function cloudflaredPath() {
  // packaged: prefer the copy shipped in resources/, else the user data dir
  // (writable even when the app sits in Program Files); dev: this repo dir
  if (__dirname.endsWith('.asar')) {
    const shipped = path.join(path.dirname(__dirname), 'cloudflared.exe');
    if (fs.existsSync(shipped)) return shipped;
    return path.join(dataDirPath || path.dirname(__dirname), 'cloudflared.exe');
  }
  return path.join(__dirname, 'cloudflared.exe');
}

function clearStartupTimer() {
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
}

// Fetch cloudflared.exe from Cloudflare's official GitHub release. Written to
// a temp file first and renamed only when the size looks sane, so a dropped
// connection or an error page never leaves a corrupt binary behind.
function downloadCloudflared(dest, cb) {
  const tmp = path.join(os.tmpdir(), `cloudflared-${Date.now()}.exe`);
  const follow = (url, hops) => {
    if (hops > 5) { cb(new Error('too many redirects')); return; }
    const req = https.get(url, { timeout: 60000, headers: { 'User-Agent': 'ChestCounter' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        follow(new URL(res.headers.location, url).toString(), hops + 1);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); cb(new Error('HTTP ' + res.statusCode)); return; }
      const out = fs.createWriteStream(tmp);
      let bytes = 0;
      res.on('data', (d) => { bytes += d.length; });
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          if (bytes < CLOUDFLARED_MIN_BYTES) { try { fs.unlinkSync(tmp); } catch (e) {} cb(new Error('download too small')); return; }
          try {
            fs.renameSync(tmp, dest);
            cb(null);
          } catch (e) {
            // dest may be in use or on another volume — fall back to copy
            try { fs.copyFileSync(tmp, dest); fs.unlinkSync(tmp); cb(null); }
            catch (e2) { cb(e2); }
          }
        });
      });
      out.on('error', (e) => { try { fs.unlinkSync(tmp); } catch (e2) {} cb(e); });
    });
    req.on('timeout', () => { req.destroy(new Error('download timed out')); });
    req.on('error', (e) => { try { fs.unlinkSync(tmp); } catch (e2) {} cb(e); });
  };
  follow(CLOUDFLARED_URL, 0);
}

function emit(state) {
  try { notify('tunnel', state); } catch (e) {}
}

// the tunnel only goes live once it actually proxies a request — poll the
// public URL until the counter answers through it, then call it ready
function probePublic(url, cb, tries = 0) {
  const mod = url.startsWith('https:') ? https : http;
  const req = mod.get(`${url}/api/state`, { timeout: 5000 }, res => {
    if (res.statusCode === 200) { cb(true); return; }
    retryProbe();
  });
  req.on('timeout', () => { req.destroy(); retryProbe(); });
  req.on('error', retryProbe);
  function retryProbe() {
    if (tries > 30 || !wantOn) { cb(false); return; }
    setTimeout(() => probePublic(url, cb, tries + 1), 2000);
  }
}

function start() {
  if (proc || booting) return;
  const bin = cloudflaredPath();
  if (!fs.existsSync(bin)) {
    // repo builds ship without the 55MB binary — fetch it on first use
    emit({ on: false, starting: true, error: null, downloading: true });
    downloadCloudflared(bin, (err) => {
      if (err) { emit({ on: false, error: 'cloudflared download failed: ' + err.message }); return; }
      start();
    });
    return;
  }
  publicUrl = null;
  booting = true;
  attempts += 1;
  emit({ on: false, starting: true, error: null });
  proc = spawn(bin, [
    'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`,
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const consume = (buf) => {
    const text = buf.toString();
    const m = URL_RE.exec(text);
    if (m && !publicUrl) {
      publicUrl = m[0];
      clearStartupTimer();
      booting = false;
      emit({ on: true, starting: false, url: publicUrl });
      // confirm the tunnel is live end-to-end before announcing victory
      probePublic(publicUrl, (ok) => {
        if (ok) emit({ on: true, starting: false, url: publicUrl, ready: true });
      });
    }
  };
  proc.stdout.on('data', consume);
  proc.stderr.on('data', consume);
  proc.on('exit', () => {
    proc = null;
    booting = false;
    clearStartupTimer();
    publicUrl = null;
    // a user-initiated stop() must not report a failure: wantOn is already
    // false by then, so this is a clean shutdown, not a crash
    if (!wantOn) { emit({ on: false, starting: false, error: null }); return; }
    if (attempts < MAX_ATTEMPTS) {
      emit({ on: false, starting: true, error: `tunnel exited — retry ${attempts}/${MAX_ATTEMPTS}` });
      retryTimer = setTimeout(start, RETRY_MS);
    } else {
      emit({ on: false, starting: false, error: 'tunnel failed to start' });
    }
  });
  startupTimer = setTimeout(() => {
    if (!publicUrl) {
      try { proc && proc.kill(); } catch (e) {}
      booting = false;
      if (wantOn && attempts < MAX_ATTEMPTS) { retryTimer = setTimeout(start, RETRY_MS); }
      else emit({ on: false, error: 'no URL from cloudflared — check the connection' });
    }
  }, STARTUP_TIMEOUT_MS);
}

function stop() {
  wantOn = false;
  attempts = MAX_ATTEMPTS; // suppress crash retries from stop()
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  clearStartupTimer();
  if (proc) { try { proc.kill(); } catch (e) {} proc = null; }
  publicUrl = null;
  booting = false;
  emit({ on: false, error: null });
}

function enable() {
  wantOn = true;
  attempts = 0;
  start();
}

function status() {
  return { on: !!proc, starting: booting, url: publicUrl };
}

module.exports = { enable, stop, status, setNotifier: (f) => { notify = f; }, setDataDir };
