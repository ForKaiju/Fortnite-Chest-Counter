// SPDX-License-Identifier: GPL-3.0-or-later
//
// ooz-cli: a stand-alone Oodle (Kraken/Mermaid/Selkie/Leviathan) decompressor.
// Copyright (C) 2026 the Fortnite Chest Tracker authors.
// It uses ooz-wasm (GPL-3.0-or-later, https://github.com/SnosMe/ooz-wasm), itself built from
// ooz (https://github.com/powzix/ooz). This program is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any later version.
// It is distributed WITHOUT ANY WARRANTY; see the LICENSE file in this folder.
//
// Protocol (stdin -> stdout, any number of requests, processed in order):
//   request:  uint32 LE decompressed size, uint32 LE compressed size, compressed bytes
//   response: int32 LE length (-1 on error), then that many decompressed bytes
// The program ends when stdin is closed.
'use strict';

const ooz = require('./index.js');

let input = Buffer.alloc(0);
let chain = Promise.resolve();

const reply = (data) => {
  const head = Buffer.alloc(4);
  head.writeInt32LE(data ? data.length : -1, 0);
  process.stdout.write(head);
  if (data) process.stdout.write(data);
};

const pump = () => {
  while (input.length >= 8) {
    const rawSize = input.readUInt32LE(0);
    const size = input.readUInt32LE(4);
    if (input.length < 8 + size) return;
    const data = Buffer.from(input.subarray(8, 8 + size));
    input = input.subarray(8 + size);
    chain = chain.then(async () => {
      try {
        // decompressUnsafe returns a view into WebAssembly memory, valid until the next call:
        // copy it out before replying. (ooz-wasm's decompress() helper itself fails.)
        const out = await ooz.decompressUnsafe(data, rawSize);
        reply(Buffer.from(out));
      } catch (err) {
        reply(null);
      }
    });
  }
};

process.stdin.on('data', (d) => {
  input = input.length ? Buffer.concat([input, d]) : d;
  pump();
});
process.stdin.on('end', () => {
  chain.then(() => process.exit(0));
});
