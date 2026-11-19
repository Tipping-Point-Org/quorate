// set-aside-memory-child.mjs — one set-aside and its write-back of `count` refused files of `size` bytes each, measured
// (runner-test-seam.plan.md stage 3, design RT-D3 A). Run as a child with --expose-gc by
// tests/regression-set-aside-reads.test.mjs; it has no tests of its own.
//
//   node --expose-gc --no-concurrent-array-buffer-sweeping tests/tools/set-aside-memory-child.mjs <count> <size>
//
// (The second flag makes V8 free an ArrayBuffer's memory inside the forced collection rather than on a background sweeper,
// which under load lagged and counted an earlier file as still held; the test that runs this records the measurement.)
//
// The module is imported statically, so what is measured is the shipped code. At each `bytes-close` a collection is forced
// and process.memoryUsage().arrayBuffers read: the bytes still referenced as a file's callback ends. It prints one JSON
// line: { baseline, samples: [{ path, held }], restored }, where `held` is arrayBuffers less the baseline taken after the
// fixture is built and before the set-aside starts.

import fs from 'node:fs';
import path from 'node:path';
import diagnosticsChannel from 'node:diagnostics_channel';
import { setAsideRefused, writeBackSetAside, SET_ASIDE_CHANNELS } from '../../scripts/io/set-aside.mjs';
import { setAsideFixture, realCapabilities } from './set-aside-capabilities.mjs';

if (typeof globalThis.gc !== 'function') { console.error('set-aside-memory-child: run with --expose-gc'); process.exit(2); }
const [count, size] = process.argv.slice(2).map(Number);
const cleanups = [];
const files = Array.from({ length: count }, (_, i) => `tests/big-${i + 1}.js`);

function build() {
  // Each file is written a small chunk at a time, so no buffer of a file's size exists before the set-aside reads one.
  const fx = setAsideFixture({ after: (fn) => cleanups.push(fn) }, { committed: { 'src/a.js': 'a\n' } });
  fs.mkdirSync(path.join(fx.repo, 'tests'), { recursive: true });
  for (const [i, p] of files.entries()) {
    const chunk = Buffer.alloc(64 * 1024, 97 + i);
    const fd = fs.openSync(path.join(fx.repo, ...p.split('/')), 'w');
    try { for (let done = 0; done < size; done += chunk.length) fs.writeSync(fd, chunk, 0, Math.min(chunk.length, size - done)); } finally { fs.closeSync(fd); }
  }
  return fx;
}

const f = build();
const { caps } = realCapabilities(f);
const samples = [];
let baseline = 0;
const onClose = ({ path: p }) => { globalThis.gc(); samples.push({ path: p, held: process.memoryUsage().arrayBuffers - baseline }); };
globalThis.gc();
baseline = process.memoryUsage().arrayBuffers;
diagnosticsChannel.subscribe(SET_ASIDE_CHANNELS.bytesClose, onClose);
let restored = false;
try {
  const { record } = setAsideRefused(caps, [{ id: 'c2', committable: false, accepted: files }], {});
  const failed = writeBackSetAside(caps, record.dir.join('/'));
  restored = failed.length === 0 && files.every((p) => fs.statSync(path.join(f.repo, ...p.split('/'))).size === size);
} finally {
  diagnosticsChannel.unsubscribe(SET_ASIDE_CHANNELS.bytesClose, onClose);
  for (const fn of cleanups) fn();
}
process.stdout.write(`${JSON.stringify({ baseline, samples, restored })}\n`);
