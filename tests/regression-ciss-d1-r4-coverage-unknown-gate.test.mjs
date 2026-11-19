// regression-ciss-d1-r4-coverage-unknown-gate.test.mjs — G-10 of review 20261021-194056-ciss-d1-remediation-3-review.
//
// new-run stamps COVERAGE-UNKNOWN and records run.json's contract_coverage_unknown when listing the tracked files
// failed, but run-graph had no branch naming it in the gate's not_checked[]: a check that did not run was visible only
// as a stamp, silence read as completeness. Source-level, as the gate's other stamp entries have no driver short of a
// whole run: the branch must exist, key on the stamp, and carry the recorded reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rg = fs.readFileSync(new URL('../scripts/run-graph.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('G-10: run-graph names COVERAGE-UNKNOWN in the gate\'s not_checked[], with the reason run.json kept', () => {
  const at = rg.search(/\.includes\('COVERAGE-UNKNOWN'\)/);
  assert.ok(at >= 0, 'run-graph has no branch on the COVERAGE-UNKNOWN stamp: the gate\'s not_checked[] never names the coverage gap');
  const branch = rg.slice(at, at + 600);
  assert.match(branch, /buckets\.not_checked\.push\(/, 'the COVERAGE-UNKNOWN branch does not push a not_checked[] entry');
  assert.match(branch, /contract_coverage_unknown/, 'the COVERAGE-UNKNOWN entry does not carry run.json\'s contract_coverage_unknown');
});
