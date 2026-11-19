// G-8 of 20261104-082659-epo-remediation-2-review: evidenceRecordDifference read a present but non-object repair_captures
// as {} (no repair greens), so a type-corrupted evidence record let --retry-commits go on without checking the greens
// that admitted a repair pass's files. Absent stays a record with none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceRecordDifference } from '../scripts/lib/remediation-chain.mjs';

const base = { payload: 'p', captures: { 'evidence/remediation/a.log': 'h' } };
const now = { payload: 'p', captures: { 'evidence/remediation/a.log': 'h' } };

test('a present repair_captures that is not an object is refused', () => {
  for (const bad of ['evidence/remediation/repair1-x.log', 7, true, null, ['evidence/remediation/repair1-x.log']]) {
    const why = evidenceRecordDifference({ ...base, repair_captures: bad }, now);
    assert.ok(why, `repair_captures ${JSON.stringify(bad)} is refused`);
    assert.match(why, /repair_captures/);
  }
});

test('an absent repair_captures is a record with none', () => {
  assert.equal(evidenceRecordDifference(base, now), null);
  assert.equal(evidenceRecordDifference({ ...base, repair_captures: {} }, now), null);
});
