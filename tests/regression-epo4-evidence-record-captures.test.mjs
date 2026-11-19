// G-9 of 20261104-171128-epo-remediation-3-review: evidenceRecordDifference's shape check took `typeof captures ===
// 'object'`, which an array satisfies, so a record whose captures was [] read as an empty capture map and a corrupted
// persisted record passed retry validation. An array is refused as a missing record is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceRecordDifference } from '../scripts/lib/remediation-chain.mjs';

test('G-9: an evidence record whose captures is an array is refused, not read as no captures', () => {
  const why = evidenceRecordDifference({ payload: 'h', captures: [] }, { payload: 'h', captures: {} });
  assert.equal(typeof why, 'string', 'an array as captures passed retry validation');
  assert.match(why, /evidence record/);
  assert.equal(typeof evidenceRecordDifference({ payload: 'h', captures: ['a'] }, { payload: 'h', captures: {} }), 'string');
});

test('G-9: a well-formed record that agrees still passes', () => {
  assert.equal(evidenceRecordDifference({ payload: 'h', captures: { 'evidence/remediation/a.log': 'x' } },
    { payload: 'h', captures: { 'evidence/remediation/a.log': 'x' } }), null);
  assert.equal(evidenceRecordDifference({ payload: 'h', captures: {} }, { payload: 'h', captures: { 'evidence/remediation/b.log': 'y' } }),
    'evidence/remediation/b.log is cited now and was not when the first run read the evidence');
});
