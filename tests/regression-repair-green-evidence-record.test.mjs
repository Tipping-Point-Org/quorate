// G-11 of 20261104-072059-epo-remediation-review: a repair pass's admission added its files to the clusters and persisted
// them, but never recorded the greens that admitted them in evidence_record, so a repair capture swapped after the pass
// was not seen by evidenceRecordDifference on a later retry (evidence-path-owner.plan.md: "if it should, they are
// recorded when the pass is admitted"). The record now holds them, as `repair_captures`, and both retry paths compare it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evidenceRecordDifference } from '../scripts/lib/remediation-chain.mjs';

const SRC = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const GREEN = 'evidence/remediation/repair1-a.log';
const base = { payload: 'p', captures: { 'evidence/remediation/red.log': 'r' } };

test('G-11: a repair green that changed since its pass was admitted is refused on a retry', () => {
  const record = { ...base, repair_captures: { [GREEN]: 'g' } };
  assert.equal(evidenceRecordDifference(record, { ...base, repair_captures: { [GREEN]: 'g' } }), null);
  assert.match(evidenceRecordDifference(record, { ...base, repair_captures: { [GREEN]: 'other' } }) ?? '', /repair1-a\.log.*changed/);
  assert.match(evidenceRecordDifference(record, { ...base, repair_captures: { [GREEN]: 'absent' } }) ?? '', /repair1-a\.log/);
  assert.match(evidenceRecordDifference(record, { ...base }) ?? '', /repair1-a\.log/);
  // A run whose record has no repair pass's greens is compared as before.
  assert.equal(evidenceRecordDifference(base, { ...base }), null);
});

test('G-11: the runner records each admitted pass\'s greens and reads them back on both retry paths', () => {
  const src = SRC('scripts/remediate.mjs');
  const start = src.indexOf('async function repairPasses(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /recordRepairGreens\(fixed/, 'an admitted repair pass does not record its greens in evidence_record');
  const refuse = src.slice(src.indexOf('function refuseOnEvidenceChange('), src.indexOf('\n}\n', src.indexOf('function refuseOnEvidenceChange(')));
  assert.match(refuse, /repair_captures/, 'a retry does not compare the recorded repair greens');
});
