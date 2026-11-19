// preload.mjs — candidates 1 and 2 of the test-selection pool, recorded in one run (test-selection-exploration.md).
//
// Passed to every Node process through NODE_OPTIONS=--import=<this file's URL>, with TS_RECORD_DIR naming where records
// go. In each process it records, as JSON lines tagged with the test file that process belongs to:
//   - `load`: every module the loader resolves to a file (candidate 2, the import graph), through module.register hooks;
//   - `read`: every file read through node:fs (candidate 1 adds these): readFileSync, readFile, promises.readFile,
//     createReadStream, opendir/readdirSync of a directory.
// The test a process belongs to is the test file node --test started it for: the first process to see no TS_TEST_FILE
// sets it from its own argv, and every child inherits it through the environment.

import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MessageChannel } from 'node:worker_threads';

const dir = process.env.TS_RECORD_DIR;
if (dir) {
  if (!process.env.TS_TEST_FILE) {
    const main = process.argv[1] ?? '';
    if (/\.test\.mjs$/.test(main)) process.env.TS_TEST_FILE = path.resolve(main);
  }
  const test = process.env.TS_TEST_FILE ?? null;
  const outFile = path.join(dir, `${process.pid}.jsonl`);
  const write = fs.appendFileSync;
  const seen = new Set();
  const note = (kind, file) => {
    if (!test || typeof file !== 'string' || !file) return;
    const key = `${kind}|${file}`;
    if (seen.has(key)) return;
    seen.add(key);
    try { write(outFile, `${JSON.stringify({ test, kind, file })}\n`); } catch { /* a record lost is a miss the comparison shows */ }
  };
  const asPath = (p) => {
    try {
      if (p instanceof URL) return fileURLToPath(p);
      if (typeof p === 'string') return p.startsWith('file:') ? fileURLToPath(p) : path.resolve(p);
    } catch { /* not a path */ }
    return null;
  };

  // Module loads: the hooks run off-thread, so they post each resolved file URL back here.
  const { port1, port2 } = new MessageChannel();
  port1.on('message', (url) => { const p = asPath(url); if (p) note('load', p); });
  port1.unref();
  register(new URL('./hooks.mjs', import.meta.url), { data: { port: port2 }, transferList: [port2] });
  // The test file itself and this process's entry script are loads too.
  if (process.argv[1]) note('load', path.resolve(process.argv[1]));

  // fs reads. Wrapped on the module object, which every importer of node:fs shares.
  const wrap = (obj, name) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function wrapped(p, ...rest) { const f = asPath(p); if (f) note('read', f); return orig.call(this, p, ...rest); };
  };
  for (const n of ['readFileSync', 'readFile', 'createReadStream', 'readdirSync', 'opendirSync', 'existsSync', 'statSync']) wrap(fs, n);
  for (const n of ['readFile', 'readdir', 'opendir', 'stat']) wrap(fs.promises, n);
  const { syncBuiltinESMExports } = await import('node:module');
  syncBuiltinESMExports();
}
