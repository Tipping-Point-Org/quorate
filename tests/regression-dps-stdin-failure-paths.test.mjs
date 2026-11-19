// G-7 of 20261110-010058-dps-remediation-2-review: when the folder of stdin folders could not be listed, sweepStaleStdin
// returned an empty sweep with no word, and stdinFrom had already stamped the sweep as done, so stale plaintext prompt
// folders stayed unnamed and the next attempt waited an hour. A failed listing is now said, returned as null rather than
// as an empty sweep, and not counted as a sweep, so the next call tries again.
//
// G-8 of the same review: when writing the prompt succeeded but opening it failed, a refused removal of the new folder
// was swallowed and the folder was never put on the leftovers, so the report at exit never named it, against the rule
// that an unremoved prompt folder is always named. (Since stdin-folder-owner.plan.md the folders are below the engine
// home's `stdin/`, which every test here gives its own.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as stdinFile from '../scripts/io/stdin-file.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

const fail = (code) => () => { const e = new Error(`${code}: refused`); e.code = code; throw e; };
const home = (t) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dps-failpaths-'))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('G-7: a stdin folder that cannot be listed is reported, not read as an empty sweep', (t) => {
  const h = home(t);
  const lines = [];
  const r = stdinFile.sweepStaleStdin({ home: h, owner: { ...confined(h), list: fail('EACCES') }, write: (l) => lines.push(l) });
  assert.equal(r, null, 'a failed listing was returned as a sweep that found nothing');
  assert.equal(lines.length, 1, 'a failed listing was not reported');
  assert.ok(lines[0].includes(path.join(h, stdinFile.STDIN_FOLDER)), lines[0]);
  assert.match(lines[0], /EACCES/);
});

test('G-7: a sweep that could not list the folder is not counted, so the next call sweeps again', (t) => {
  const h = home(t);
  let sweeps = 0;
  const sweep = () => { sweeps += 1; return null; };
  for (let i = 0; i < 2; i++) stdinFile.stdinFrom('text', { home: h, sweep }).release();
  assert.equal(sweeps, 2, `a failed sweep was stamped as done: ${sweeps} sweep(s) for two calls`);
});

test('G-8: a folder whose removal is refused after its open failed is kept and named at exit', (t) => {
  const h = home(t);
  const refuse = fail('EBUSY');
  assert.throws(() => stdinFile.stdinFrom('a prompt', { home: h, sweep: () => [], open: fail('EMFILE'), rm: refuse }), /EMFILE/);
  const lines = [];
  const named = stdinFile.reportLeftoverStdin({ rm: refuse, write: (l) => lines.push(l) });
  assert.equal(named.length, 1, 'the folder left by the failed open was never put on the leftovers');
  assert.equal(path.dirname(named[0]), path.join(h, stdinFile.STDIN_FOLDER), named[0]);
  assert.equal(lines.length, 1);
});
