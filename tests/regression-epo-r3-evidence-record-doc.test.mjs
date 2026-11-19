// G-14 of 20261104-082659-epo-remediation-2-review (and its symptom G-10): scripts/remediate.mjs writes
// evidence_record.repair_captures into run.json and a retry refuses on it, but the owning contract,
// shared/claude-md-contract.md, declared the record as {payload, captures} only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the contract declares every field remediate.mjs writes into evidence_record', () => {
  const code = fs.readFileSync(path.join(ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  assert.match(code, /repair_captures/, 'remediate.mjs writes repair_captures (the premise of this test)');
  const doc = fs.readFileSync(path.join(ROOT, 'shared', 'claude-md-contract.md'), 'utf8');
  const m = /`evidence_record: \{[^`]*\}`/.exec(doc);
  assert.ok(m, 'the contract declares evidence_record');
  assert.match(m[0], /repair_captures/, `the declared shape names repair_captures: ${m[0]}`);
});
