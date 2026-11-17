**Download `Chest-Counter-1.2.1-win-x64.zip` below, unzip it anywhere writable and run `Chest Counter.exe`.** Nothing to install. Your totals, settings and replay history are kept when you upgrade.

> **Turn replays on in Fortnite first**: *Settings → Game → Replays → Record Replays: On*. The app only reads those replay files — no access to the game's memory, no injection, no input automation. Counting is your interact tap, gated by the on-screen chest prompt.

**What's new in 1.2.1**
- **The switch is now called "Read Prize Banner"** — same feature, honest label. It reads the reveal Fortnite puts on your screen and marks that tier Found; it automates nothing in the game, claims nothing, and predicts nothing
- **A tighter default watch area**: the reader now looks at the centred band the reveal occupies (`0.24 / 0.28 / 0.52 / 0.44` of the screen) instead of a wide sweep, so it never touches chat, party UI or the minimap. Detection is unchanged — smaller region, less to look at
- If you had already tuned `prizeRegion` in `config.json`, your value is kept as it is

**What shipped in 1.2.0**
- **Read Prize Banner** (then called Auto Found): win a Pirate Treasure prize and the tier marks itself. The reveal banner naming the prize is read by the same Windows OCR pass that already gates the chest counter — the dry counter resets, the row turns gold, the found count goes up and the **TREASURE FOUND** banner plays, exactly as if you had pressed Found
- **Matched against the live week**: banner text is compared with this week's prize names first (so *Gold Corvette Decal* can never resolve to the Gold Outfit), then against the prize type, and it survives OCR dropping characters. A prize that was just detected cannot fire twice inside a minute
- **The Found button stays** for anything the reader misses, and the chest-prompt gate is untouched — the two crops are independent, so a banner region never slows the counter down

**Why the banner is the source**: Epic decides prizes on its servers and writes them straight to your account. Neither the replay files nor `FortniteGame.log` ever contain the grant — that was checked against a real 17.7 MB replay and a 16.5 MB log before this feature was built. The pixels of the reveal are the only local evidence there is.

**Why this stays outside Epic's rules**: no process handle, no memory read, no injection, no DLL, no driver, no input sent to the game, no account, no network egress. The app reads pixels you can already see and the replay files Fortnite writes for you, then records them locally.

Windows may show *"Windows protected your PC"* because the exe is unsigned: *More info → Run anyway*.

The app lives in your system tray; closing the window does not stop the counter. First time you switch the TikTok bridge on, it downloads `cloudflared.exe` (~55 MB, Cloudflare's own tool) into `%APPDATA%\Chest Counter`. The bridge is off by default — it is the only thing in the app that puts a page on the public internet.
