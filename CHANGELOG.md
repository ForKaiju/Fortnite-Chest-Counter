# Changelog

All notable changes to Chest Counter are documented here.

## [1.0.1] - 2026-11-16

### Added
- **Real Treasure Hour schedule** — the weekly cadence (Saturday 21:00–23:00 UTC, Sunday 02:00–04:00 UTC) is computed locally. The panel shows a countdown, the next four windows with LIVE / NEXT / SOON tags, and the boosted odds flip on their own.
- **Weekly prize crews** — all five Treasure Hunters weeks with crew portraits and six prize tiles each, flipping at Epic's Sunday reset (07:00 UTC).
- `overlay/week` — new 420 × 410 overlay showing the live week's crew and prizes, with artwork.
- Artwork thumbnails on `overlay/items`, one tile per prize row.
- Manual Treasure Hour override, used only for one-off windows Epic announces out of cadence.
- Overlay size chips in the panel — click one to copy `500x148` for an OBS custom resolution or a TikTok source.
- Dedicated **Overlay Sizes** card with aspect ratios and 2× values for non-1080p canvases.

### Changed
- Overlays are all served from their own fixed size, and the panel lists that size next to the URL and in the TikTok link list.
- `hourInfo()` resolves schedule-vs-override once, server-side; the panel no longer does date math.
- Build is slimmer: English locale pack only, stock Electron starter app dropped, prize/page artwork recompressed (5.3 MB → 0.98 MB).
- Release zip is written with the smallest deflate level available.
- `cloudflared.exe` is no longer shipped by default — it downloads on first tunnel start. `build-manual.ps1 -Full` builds the offline variant.

### Security
- Server binds `127.0.0.1` only.
- Tunnel traffic is restricted to an allowlist: the five overlay pages, `/img/treasure/*`, `/events` and `/api/state`. Every other path — panel, settings, replay history, all write endpoints — returns `404`.
- State pushes carry explicit counter fields only; the per-chest timestamp log no longer leaves the process.

### Removed
- **Audio Detection** (desktop loopback RMS) and **audio fingerprinting** — both replaced by the prompt-gated tap counter in 1.0.0 and still shipping in the UI. The app no longer captures screen or system audio at all.
- `desktopCapturer` and the `get-screen-source` IPC bridge that existed only to feed those detectors.

### Fixed
- Replay audit no longer double-counts when a match started before the app was opened.
- Week boundaries land on the item-shop reset instead of local midnight.

## [1.0.0] - 2026-11-15

### Added
- Real-time chest counting via screen OCR (`chest-probe.ps1`) + keyboard hook (`hook.ps1`)
- OBS browser source overlays at `localhost:3333`
- TikTok Live Studio support via Cloudflare quick tunnel (no account needed)
- Pirate Treasure event tracker with per-tier odds
- Fortnite `.replay` file parser for post-match chest audit, with a live-vs-replay diff
- System tray icon with show/hide/preview controls
- Data stored in `%APPDATA%\Chest Counter` (safe outside Program Files)
- One-time migration from the legacy `resources/` data location
- Adjustable duplicate merge window (default 900 ms)
