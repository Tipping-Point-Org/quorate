// G-17 of 20261022-034225-cid1a-remediation-2-review: new-run validates every adapter in the merged table on every mint,
// built-ins included and with the panel off, but the contract's behaviour table described adapter validation only inside
// the `external_panel: true` preflight row, so a reader could not predict that a malformed built-in refuses a panel-free
// mint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

test('the contract says every adapter is validated on every mint, panel on or off', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/new-run.mjs'), 'utf8');
  assert.match(src, /Object\.entries\(RUNTIME_TABLE\)\.flatMap\(\(\[name, a\]\) => adapterErrors\(name, a\)\)/,
    'the behaviour this test documents has moved; re-read new-run before changing the document');
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared/claude-md-contract.md'), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith('| `scripts/new-run.mjs` (adapter validation) |'));
  assert.ok(row, 'no behaviour row for the mint\'s adapter validation');
  assert.match(row, /every mint/);
  assert.match(row, /built-in/);
  assert.match(row, /panel (is )?off|external_panel: false/);
});
