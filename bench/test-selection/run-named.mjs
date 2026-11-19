// run-named.mjs — node --test over a list of named files read from a file, through node:test's run(), so the list is not
// bounded by the command line. Windows caps a command line at 32,767 characters, and 656 named test files from the
// sandbox's paths came to 32,991 (2026-11-06). The files are named, not globbed, for the reason full-run.mjs gives.
//
// Usage: node run-named.mjs --files-from <list, one path per line> [--reporter <name or file URL> --reporter-destination <destination>]...
//   <name> is dot, spec or tap; a destination is a file path, or "stdout". The nth --reporter writes to the nth
//   --reporter-destination, as node --test's --test-reporter and --test-reporter-destination pair.
// Concurrency is the CLI's default, os.availableParallelism() - 1 files at once, each in its own process.
//
// The command line goes through scripts/lib/argv.mjs's parseArgv, the one parser, so a missing value or an unknown flag
// is refused by name (G-7 of 20261107-061412-split-delivery-2).

import fs from 'node:fs';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import { run } from 'node:test';
import * as builtin from 'node:test/reporters';
import { parseArgv } from '../../scripts/lib/argv.mjs';
import { isFailure } from './test-outcome.mjs';

const die = (msg) => { process.stderr.write(`run-named: ${msg}\n`); process.exit(2); };
let values;
try {
  ({ values } = parseArgv(process.argv.slice(2), { options: { 'files-from': 'string', reporter: 'repeat', 'reporter-destination': 'repeat' } }));
} catch (e) { die(e.message); }
if (!values['files-from']) die('--files-from is required');
const names = values.reporter ?? []; const dests = values['reporter-destination'] ?? [];
if (names.length !== dests.length) die(`${names.length} --reporter and ${dests.length} --reporter-destination: each reporter needs one destination`);
const files = fs.readFileSync(values['files-from'], 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
// An empty or blank list is refused: run, it passed as a run of zero tests (G-7 of 20261107-072037-split-delivery-3).
if (!files.length) die(`no test files listed in ${values['files-from']}`);
const reporters = names.map((n, k) => [n, dests[k]]);

const stream = run({ files, concurrency: Math.max(os.availableParallelism() - 1, 1) });
let failed = false;
// A failing test declared todo is no failure, as node --test counts it (G-8 of 20261107-061412-split-delivery-2), by
// test-outcome.mjs's rule, the one the names reporter records by (G-8 of 20261107-072037-split-delivery-3).
stream.on('test:fail', (data) => { if (isFailure('test:fail', data)) failed = true; });
const done = [];
// Each reporter gets its own copy of the event stream: pipe() sends every event to every destination.
for (const [name, dest] of reporters) {
  const reporter = name === 'spec' ? new builtin.spec() : builtin[name] ?? (await import(name)).default;
  const out = dest === 'stdout' ? process.stdout : fs.createWriteStream(dest);
  const copy = new PassThrough({ objectMode: true });
  stream.pipe(copy);
  copy.compose(reporter).pipe(out);
  if (out !== process.stdout) done.push(new Promise((r) => out.on('finish', r)));
}
// With no reporter nothing reads the stream, and an unread stream emits no test:fail: a failing run exited 0.
if (!reporters.length) { stream.resume(); done.push(new Promise((r) => stream.on('end', r))); }
await Promise.all(done);
process.exitCode = failed ? 1 : 0;
