**Download `Chest-Counter-1.0.1-win-x64.zip` below, unzip it anywhere writable and run `Chest Counter.exe`.** Nothing to install. Your totals, settings and replay history are kept when you upgrade.

> **Turn replays on in Fortnite first**: *Settings → Game → Replays → Record Replays: On*. The app only reads those replay files — no access to the game's memory, no injection, no input automation. Counting is your interact tap, gated by the on-screen chest prompt.

**What's new in 1.0.1**
- **The real next Treasure Hour**: the countdown is the actual window — Saturday 21:00–23:00 UTC and Sunday 02:00–04:00 UTC — not a schedule you fill in. The panel lists the next four with LIVE / NEXT / SOON tags, and the boosted odds switch on by themselves
- **Weekly prize art**: every Treasure Hunters week shows its crew portrait and six prize tiles, and the artwork moves on when the week flips at Epic's Sunday 07:00 UTC reset
- **New `Week` overlay** (420 × 410) for streams, plus artwork thumbnails on the items overlay
- **Overlay sizes in the panel**: each source lists its exact size, and one click copies `500x148` into OBS's custom resolution or a TikTok source. A size card covers aspect ratios and 2× values for non-1080p canvases
- **Smaller app**: English locale only, the stock Electron app removed, artwork recompressed, and the 55 MB tunnel binary now downloads on first use instead of shipping in the zip — 316 MB becomes 221 MB unpacked, 128 MB becomes 96 MB zipped
- **Tighter network surface**: the server listens on `127.0.0.1` only, and the TikTok tunnel can reach nothing but the five overlays and the state feed. The panel, settings, replays and config stay on your PC
- **Old audio detection removed**: the desktop-loopback and audio-fingerprint detectors are gone, along with the screen-capture permission they needed. Counting is your interact tap plus the replay audit
- **Fixes**: every toggle in the panel — Listener, Chest prompt, Count Sound, Treasure Hour, TikTok bridge — now responds to a normal mouse click. The switch used to be drawn on top of the checkbox and swallowed the click, so the controls looked live and did nothing. The TikTok bridge also reports what it is doing while it starts (downloading, starting, live, error), and switching it off no longer reports a false failure. Replay audits no longer double-count a match that started before the app was opened

Windows may show *"Windows protected your PC"* because the exe is unsigned: *More info → Run anyway*.

The app lives in your system tray; closing the window does not stop the counter. First time you switch the TikTok bridge on, it downloads `cloudflared.exe` (~55 MB, Cloudflare's own tool) into `%APPDATA%\Chest Counter`. The bridge is off by default — it is the only thing in the app that puts a page on the public internet.
