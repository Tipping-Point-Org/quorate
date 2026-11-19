// G-9 (G-10 its symptom) of 20261104-072059-epo-remediation-review: repairReportErrors and repairGreenErrors defaulted
// caseInsensitive to false, so a caller that omitted the repository's case rule compared test paths case-sensitively,
// silently, and a valid repair could be refused on a case-insensitive host. Every other reader in remediation-chain
// refuses an omitted rule (caseFlag); these two refuse alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairReportErrors, repairGreenErrors } from '../scripts/lib/remediation-chain.mjs';

const failing = [{ name: 'the guard holds', file: 'tests/a.test.js' }];
const answer = { test_name: 'the guard holds', test_file: 'tests/a.test.js', disposition: 'fixed', cluster: 'c1',
  green_evidence: 'evidence/remediation/repair1-a.log' };

test('G-9: repairReportErrors refuses an omitted case rule rather than defaulting to case-sensitive', () => {
  const payload = { run_id: 'R', pass: 1, failures: [answer] };
  assert.throws(() => repairReportErrors(payload, { runId: 'R', pass: 1, clusterIds: ['c1'], failing }), /caseInsensitive/);
  assert.throws(() => repairReportErrors(payload, { runId: 'R', pass: 1, clusterIds: ['c1'], failing, caseInsensitive: 'yes' }), /caseInsensitive/);
  assert.deepEqual(repairReportErrors(payload, { runId: 'R', pass: 1, clusterIds: ['c1'], failing, caseInsensitive: false }), []);
  assert.deepEqual(repairReportErrors({ ...payload, failures: [{ ...answer, test_file: 'Tests/A.test.js' }] },
    { runId: 'R', pass: 1, clusterIds: ['c1'], failing, caseInsensitive: true }), []);
});

test('G-10: repairGreenErrors refuses an omitted case rule rather than defaulting to case-sensitive', () => {
  const facts = { [answer.green_evidence]: { admitted: 'test_one', outcome: 'passed', file: 'Tests/A.test.js' } };
  assert.throws(() => repairGreenErrors([answer], facts, { pass: 1, failing }), /caseInsensitive/);
  assert.deepEqual(repairGreenErrors([answer], facts, { pass: 1, failing, caseInsensitive: true }), []);
  assert.equal(repairGreenErrors([answer], facts, { pass: 1, failing, caseInsensitive: false }).length, 1);
});
