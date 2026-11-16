// Replay chunks are Oodle-compressed. Decompression is done by a separate program
// (../oodle-ooz/ooz-cli.js, its own license) that this reader talks to through pipes:
// compressed bytes in, decompressed bytes out.
const { spawn } = require('child_process');
const path = require('path');
const Replay = require('./Classes/Replay');

let helper = null;

const helperPath = () => process.env.FCT_OOZ_CLI || path.join(__dirname, '..', '..', 'oodle-ooz', 'ooz-cli.js');

const startHelper = () => {
  const child = spawn(process.execPath, [helperPath()], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  });
  const state = { child, waiting: [], buffer: Buffer.alloc(0), dead: null };

  child.stdout.on('data', (d) => {
    state.buffer = state.buffer.length ? Buffer.concat([state.buffer, d]) : d;
    while (state.buffer.length >= 4 && state.waiting.length) {
      const len = state.buffer.readInt32LE(0);
      if (len < 0) {
        state.buffer = state.buffer.subarray(4);
        state.waiting.shift().reject(new Error('Oodle decompression failed'));
        continue;
      }
      if (state.buffer.length < 4 + len) break;
      const out = Buffer.from(state.buffer.subarray(4, 4 + len));
      state.buffer = state.buffer.subarray(4 + len);
      state.waiting.shift().resolve(out);
    }
  });
  const fail = (err) => {
    state.dead = err;
    for (const w of state.waiting.splice(0)) w.reject(err);
    if (helper === state) helper = null;
  };
  // Blocked (an antivirus) or missing: say so plainly, the app then tries again later.
  child.on('error', (err) => fail(new Error(`Oodle helper could not start: ${err.message}`)));
  // A write to a helper that just died must not crash the reader.
  child.stdin.on('error', () => undefined);
  child.on('exit', (code) => fail(new Error(`Oodle helper exited (${code})`)));
  return state;
};

const decompressBytes = (data, rawSize) => {
  if (!helper) helper = startHelper();
  const h = helper;
  return new Promise((resolve, reject) => {
    if (h.dead) return reject(h.dead);
    h.waiting.push({ resolve, reject });
    const head = Buffer.alloc(8);
    head.writeUInt32LE(rawSize, 0);
    head.writeUInt32LE(data.length, 4);
    h.child.stdin.write(head);
    h.child.stdin.write(data);
  });
};

/** Stop the helper process (call once the replay is read). */
const closeDecompressor = () => {
  if (!helper) return;
  const h = helper;
  helper = null;
  try {
    h.child.stdin.end();
  } catch (err) {
    // already gone
  }
};

/**
 * @param {Replay} replay
 * @param {Boolean} isCompressed
 */
const decompress = async (replay, isCompressed) => {
  if (!isCompressed) {
    return replay;
  }

  const decompressedSize = replay.readInt32();
  const compressedSize = replay.readInt32();
  const compressedBuffer = replay.readBytes(compressedSize);

  const newReplay = new Replay(await decompressBytes(Buffer.from(compressedBuffer), decompressedSize));

  newReplay.header = replay.header;
  newReplay.info = replay.info;

  return newReplay;
};

module.exports = decompress;
module.exports.closeDecompressor = closeDecompressor;
