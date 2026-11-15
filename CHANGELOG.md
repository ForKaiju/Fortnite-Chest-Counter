# Changelog

All notable changes to Chest Counter will be documented here.

## [1.0.0] - 2026-11-15

### Added
- Real-time chest counting via screen OCR (`chest-probe.ps1`) + keyboard hook (`hook.ps1`)
- OBS browser source overlay at `localhost:3333/overlay`
- TikTok Live Studio support via Cloudflare quick tunnel (no account needed)
- Pirate Treasure event tracker with per-tier odds and Treasure Hour scheduler
- Fortnite `.replay` file parser for post-match chest audit
- System tray icon with show/hide/quit controls
- Data stored in `%APPDATA%\Chest Counter` (safe outside Program Files)
- Auto-migration from legacy `resources/` data location
- Deduplication window (adjustable, default 900ms) to prevent double-counting
