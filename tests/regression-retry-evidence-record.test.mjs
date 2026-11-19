// grounding-and-retry-evidence.plan.md stage 2 (design GR-D2 A, operator 2026-11-03: "15 a"). G-13 and G-14 of
// 20261103-211624-dr-remediation-4-review: both retry paths, --readmit-evidence and the ordinary --retry-commits re-plan,
// read the evidence folder as it was at retry time, so a report or capture added or swapped after the refusal was judged
// as the node's own and could authorise a commit. The first run now records what it read, and a retry compares. The
// runner side is held in regression-remediate-runner (a capture gone), regression-remediation-commit-recovery (the report
// edited) and regression-readmit-evidence (a capture added, and a run with no record).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceRecordDifference } from '../scripts/lib/remediation-chain.mjs';

const REC = { payload: 'p1', captures: { 'evidence/remediation/red.txt': 'r1', 'evidence/remediation/green.txt': 'g1' } };

test('GR-D2 A: the same report and captures agree', () => {
  assert.equal(evidenceRecordDifference(REC, structuredClone(REC)), null);
});

test('GR-D2 A: no record is refused, whatever is on disk now', () => {
  for (const r of [undefined, null, {}, { payload: 'p1' }, { captures: {} }]) {
    assert.match(evidenceRecordDifference(r, REC), /no evidence record/, JSON.stringify(r));
  }
});

test('GR-D2 A: a changed report, a changed, missing, added or uncited capture is each refused, by name', () => {
  const now = (patch) => ({ payload: 'p1', ...patch, captures: { ...REC.captures, ...(patch.captures ?? {}) } });
  assert.match(evidenceRecordDifference(REC, now({ payload: 'p2' })), /report of the node .* changed/);
  assert.match(evidenceRecordDifference(REC, now({ captures: { 'evidence/remediation/green.txt': 'g2' } })), /green\.txt changed .*content differs/);
  assert.match(evidenceRecordDifference(REC, now({ captures: { 'evidence/remediation/green.txt': 'absent' } })), /green\.txt changed .*missing now/);
  assert.match(evidenceRecordDifference(REC, now({ captures: { 'evidence/remediation/x.txt': 'x1' } })), /x\.txt is cited now and was not/);
  const fewer = { payload: 'p1', captures: { 'evidence/remediation/red.txt': 'r1' } };
  assert.match(evidenceRecordDifference(REC, fewer), /green\.txt was cited when the first run read the evidence and is not now/);
  const missingThen = { payload: 'p1', captures: { ...REC.captures, 'evidence/remediation/green.txt': 'absent' } };
  assert.match(evidenceRecordDifference(missingThen, REC), /green\.txt changed .*missing then/);
});
