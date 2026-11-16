# oodle-ooz — separate program, GPL-3.0-or-later

This folder is a **separate program** shipped next to Fortnite Chest Tracker. The app only starts
it and exchanges plain data with it through pipes (compressed bytes in, decompressed bytes out),
the same way it could call any command-line decompressor. It is licensed under the GNU General
Public License version 3 or later (see `LICENSE`); the rest of the application is not.

Contents

| File | What | Source |
| --- | --- | --- |
| `ooz-cli.js` | the stand-alone decompressor program (stdin/stdout protocol) | this file is its complete source |
| `index.js`, `build/ooz.js`, `package.json`, `README.md` | ooz-wasm 1.0.0 by Alexander Drozdov, unmodified | https://github.com/SnosMe/ooz-wasm |
| (WebAssembly embedded in `build/ooz.js`) | compiled from ooz by powzix | https://github.com/powzix/ooz |

Corresponding source: `ooz-cli.js` and the JavaScript files are included as-is. The WebAssembly
code embedded in `build/ooz.js` is built from the two repositories above with Emscripten
(see the ooz-wasm README). Whoever distributes this program must also make that source available
to the people who receive it, as required by section 6 of the GPL (for example by shipping the
source archives of both repositories at the version used, or by offering them for download from
the same place as the application).

You may replace this folder with any other program that follows the same protocol.
