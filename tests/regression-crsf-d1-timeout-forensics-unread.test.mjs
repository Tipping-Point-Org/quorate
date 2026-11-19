// G-14 of 20261105-163851-crsf-d1-review: spawn-node's timeout forensics swallowed every error listing or statting the
// evidence directory (`catch { }`) and reported the result as no captured evidence, concealing an unreadable evidence tree
// exactly when a timed-out node is being diagnosed. A source check, because the branch runs only after a real node times
// out: absence is ENOENT only, and any other error is named among the status's errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('G-14: an unreadable evidence directory is named in the timeout forensics, never read as no evidence', () => {
  const s = fs.readFileSync(new URL('../scripts/spawn-node.mjs', import.meta.url), 'utf8');
  const from = s.indexOf('let captured = [];');
  const block = s.slice(from, s.indexOf('const forensics = timeoutForensics(', from));
  assert.ok(from > 0 && block.length > 0, 'the timeout forensics listing was not found');
  assert.doesNotMatch(block, /catch\s*\{/, 'a listing error is swallowed');
  assert.match(block, /ENOENT/, 'absence is not limited to ENOENT');
  assert.match(block, /validator_errors\.push\(/, 'the unread evidence directory is not named');
});
