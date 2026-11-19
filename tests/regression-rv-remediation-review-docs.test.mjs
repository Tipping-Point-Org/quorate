// G-15, G-16 and G-14 of 20261013-233901-rv-delivery-remediation-review: the contract reference contradicted itself on an
// empty `commands.test_one`. Its `test_one` entry still said empty "leaves a remediation node the full suite as its only
// check" while the remediation-timeout paragraph said the evidence gate admits only `test_one` captures (G-15); the
// remediation's rewrite of that paragraph dropped the rule the plan's stage 2 has the doc state, that a node with no
// `test_one` needs a limit above twice `check_timeout_minutes` (G-16); and the entry listed the file-admission conditions
// as complete while omitting the control-character refusal in scripts/lib/test-one.mjs (G-14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { testOneFileRefusal } from '../scripts/lib/test-one.mjs';

const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared/claude-md-contract.md'), 'utf8');
const entry = doc.slice(doc.indexOf('- **`test_one`**'), doc.indexOf('- **`audit`**'));

test('G-15: the test_one entry no longer says an empty key leaves the full suite as a remediation check', () => {
  assert.ok(entry.length > 0);
  assert.doesNotMatch(entry, /full suite as its only check/);
  assert.match(entry, /Empty[\s\S]{0,200}evidence gate admits only `test_one` captures/);
});

test('G-16: the doc states the node limit must exceed twice check_timeout_minutes when test_one is empty', () => {
  const para = doc.slice(doc.indexOf('**The remediation node\'s own limit**'));
  assert.match(para.slice(0, 1500), /twice\s+`check_timeout_minutes`/);
});

test('G-14: the admission conditions name the control-character refusal the code applies', () => {
  assert.ok(testOneFileRefusal('tests/a b.test.mjs', { classify: () => 'test', listed: new Set(['tests/a b.test.mjs']), linksOut: () => false }));
  assert.match(entry, /control character/);
});
