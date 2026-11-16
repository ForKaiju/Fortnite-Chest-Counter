# Third-party notices

Chest Counter bundles or downloads the following third-party components.
Their licenses apply to their code, not to the app shell (MIT — see LICENSE).

## replay-reader/ — Fortnite replay parser

Bundled under `replay-reader/`. Based on **fortnite-replay-parser 1.4.8** by
xNocken — https://github.com/xNocken/replay-reader — MIT License,
Copyright (c) 2021 xNocken. See `replay-reader/LICENSE` and
`replay-reader/NOTICE.md` for the full license and the list of modifications.

## oodle-ooz/ — Oodle decompression helper

Bundled under `oodle-ooz/`. Its license and provenance are documented in
`oodle-ooz/LICENSE`, `oodle-ooz/SOURCE.md` and `oodle-ooz/README.md`.

## electron, express, and friends

- Electron — MIT License, Copyright (c) Electron contributors / OpenJS Foundation
- Express — MIT License, Copyright (c) TJ Holowaychuk / OpenJS Foundation

## cloudflared (downloaded at runtime, not redistributed)

The TikTok bridge uses Cloudflare's `cloudflared` — Apache License 2.0,
https://github.com/cloudflare/cloudflared. The app downloads the official
release binary on first use when it is not bundled.

## Fortnite

Fortnite is a trademark of Epic Games, Inc. Chest Counter is an unofficial fan
tool, not affiliated with or endorsed by Epic Games. It reads only the replay
files Fortnite itself writes to disk and listens to keystrokes — no game
memory access, no injection, no input automation.
