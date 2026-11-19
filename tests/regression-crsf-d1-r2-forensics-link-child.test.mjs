// G-14 of 20261105-173030-crsf-d1-remediation-review: spawn-node's timeout forensics kept only the evidence directory's
// file children, so a link standing there (a symlink Dirent is not a file) was dropped unnamed, and a node killed with
// only a link in its evidence read as one that wrote nothing. A source check, as G-14 of the round before it is, because
// the branch runs only when a live node times out: a link child is named in the status, never followed or dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('G-14: the timeout forensics name a link child of the evidence directory', () => {
  const s = fs.readFileSync(new URL('../scripts/spawn-node.mjs', import.meta.url), 'utf8');
  const from = s.indexOf('let captured = [];');
  const block = s.slice(from, s.indexOf('timeoutForensics(', from));
  assert.ok(from > 0 && block.length > 0, 'the timeout forensics were not found');
  assert.match(block, /isSymbolicLink\(\)/, 'a link child is filtered out unnamed');
  assert.match(block, /validator_errors\.push\([^;]*link/, 'a link child is not named in the status');
});
