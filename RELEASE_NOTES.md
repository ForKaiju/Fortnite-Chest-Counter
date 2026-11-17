**Download `Chest-Counter-1.2.0-win-x64.zip` below, unzip it anywhere writable and run `Chest Counter.exe`.** Nothing to install. Your totals, settings and replay history are kept when you upgrade.

> **Turn replays on in Fortnite first**: *Settings → Game → Replays → Record Replays: On*. The app only reads those replay files — no access to the game's memory, no injection, no input automation. Counting is your interact tap, gated by the on-screen chest prompt.

**What's new in 1.2.0**
- **Auto Found**: win a Pirate Treasure prize and the app marks it for you. The reveal banner naming the prize is read by the same Windows OCR pass that already gates the chest counter — the dry counter resets, the row turns gold, the found count goes up and the **TREASURE FOUND** banner plays, exactly as if you had pressed Found
- **Matched against the live week**: banner text is compared with this week's prize names first (so *Gold Corvette Decal* can never resolve to the Gold Outfit), then against the prize type, and it survives OCR dropping characters. A prize that was just detected cannot fire twice inside a minute
- **A switch, not a rule**: Auto Found is on by default and one click off on the Treasure tab. The **Found** button stays where it was for anything the reader misses
- **Chest prompt gate unchanged**: the prompt crop and the banner crop are read independently, so a wide banner region never slows the chest counter down

**Why the banner is the source**: Epic decides prizes on its servers and writes them straight to your account. Neither the replay files nor `FortniteGame.log` ever contain the grant — that was checked against a real 17.7 MB replay and a 16.5 MB log before this feature was built. The pixels of the reveal are the only local evidence there is.

Windows may show *"Windows protected your PC"* because the exe is unsigned: *More info → Run anyway*.

The app lives in your system tray; closing the window does not stop the counter. First time you switch the TikTok bridge on, it downloads `cloudflared.exe` (~55 MB, Cloudflare's own tool) into `%APPDATA%\Chest Counter`. The bridge is off by default — it is the only thing in the app that puts a page on the public internet.
