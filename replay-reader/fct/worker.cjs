// Reads one finished Fortnite replay and prints one line:  FCT-RESULT {json}
//   node worker.cjs <file.replay>
// Started by the app at low priority, after the match, so it never competes with the game.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

try {
  os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch (err) {
  // not allowed: keep the default priority
}

// The reader reports recoverable decoding problems on the console: keep stdout for the result.
const quiet = () => undefined;
console.log = quiet;
console.info = quiet;
console.warn = quiet;
console.error = quiet;

const parseReplay = require(path.join(__dirname, '..', 'index.js'));
const { closeDecompressor } = require(path.join(__dirname, '..', 'src', 'decompress.js'));
const summarize = require('./summarize.js');

let finished = false;
const finish = (result) => {
  if (finished) return;
  finished = true;
  closeDecompressor();
  process.stdout.write(`FCT-RESULT ${JSON.stringify(result)}\n`, () => process.exit(0));
};

// An error thrown outside the main flow (a decoder callback, the decompressor's pipes) would
// otherwise end the process without a word: report it like any other reading error.
const crashed = (err) => finish({ ok: false, reason: err && err.message ? err.message : String(err) });
process.on('uncaughtException', crashed);
process.on('unhandledRejection', crashed);

(async () => {
  const file = process.argv[2];
  const started = Date.now();
  try {
    if (!file) throw new Error('No replay file given');
    const data = fs.readFileSync(file);
    const r = await parseReplay(data, { parseLevel: 10, debug: false });
    finish({
      ...summarize(r),
      // Chest Counter extension: elim events (weapon-typed) so the app can count
      // pickaxe eliminations by the recording player (eliminator ∈ myStateGuids).
      elims: (r.events || [])
        .filter((e) => e.group === 'playerElim')
        .map((e) => ({ eliminator: e.eliminator, gunType: e.gunType, knocked: e.knocked, t: e.startTime })),
      // The match's playlist, even when the chests could not be counted: a Creative island is
      // not a game (src/shared/playlist.ts).
      playlist: (r.gameData && typeof r.gameData.playlistInfo === 'string' && r.gameData.playlistInfo) || null,
      lengthMs: r.info ? r.info.LengthInMs : null,
      parseMs: Date.now() - started,
    });
  } catch (err) {
    finish({ ok: false, reason: err && err.message ? err.message : String(err), parseMs: Date.now() - started });
  }
})();
