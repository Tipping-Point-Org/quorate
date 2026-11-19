// run-dir-descendants.plan.md stage 3 (D-D4 A): after admitRun, a script uses only the directory it returned, and a run
// named by a caller's flag or a recorded field is admitted before its first read.
//
// G-13 of 20261024-122231-rdt-remediation-3-review: findings-ledger read the run record through the caller's --run-dir
// before admitting it, so a file in a place no run may be was parsed, and its parse error was the answer. Admitted
// first, the directory is refused for where it is, and nothing in it is read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';

test('G-13: findings-ledger refuses a run outside every admitted place before it reads anything in it', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-counterfeit-run-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = path.join(dir, '20260101-000000-counterfeit');
  fs.mkdirSync(run);
  fs.writeFileSync(path.join(run, 'run.json'), '{ not json');
  const r = runScript('findings-ledger.mjs', ['--run-dir', run]);
  assert.equal(r.status, 2, r.output);
  assert.doesNotMatch(r.output, /not valid JSON/, 'the record of a directory no run may be in was read before admission');
});

// G-9 of 20261024-122231-rdt-remediation-3-review: external-review built its reviewer table, which decides which CLI runs
// and where its credentials go, from run.json read through the caller's --run-dir BEFORE admission, and handed the probe
// child that spelling. A link swapped between the read and the admission is the case, and no test can time it, so the
// shape is held here: the table comes from the record admission returned, and the probe gets the admitted directory.
test('G-9: external-review reads its declared reviewers from the admitted record and forwards the admitted directory', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'external-review.mjs'), 'utf8');
  assert.doesNotMatch(src, /declaredReviewers\(\{\s*runDir: args\.runDir/, 'the table is read through the caller\'s spelling');
  assert.match(src, /earlyAdmission\.record\?\.contract\?\.reviewers/, 'the table does not come from the admitted record');
  const tableAt = src.indexOf('const DECLARED_REVIEWERS');
  const admitAt = src.indexOf('const earlyAdmission');
  assert.ok(admitAt > 0 && admitAt < tableAt, 'the run is not admitted before the table is built');
  assert.match(src, /const keep = outDir \? \[outFlag, admittedRunDir \?\? outDir,/, 'the probe child is handed the caller\'s spelling');
  assert.match(src, /evidenceRoot = ok\.dir;/, 'the evidence root is not the admitted directory');
});
