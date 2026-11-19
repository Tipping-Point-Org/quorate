// G-13 of 20261013-233901-rv-delivery-remediation-review: the retry path's same() compared two accepted-file lists by
// cloning and sorting `b` inside every step of every(), F sorts of F files per comparison. Each list is sorted once now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

// same() moved with the retry's comparison into lib's retryMismatch (G-4 of 20261015-025724-symptom-remediation-2-review).
test('same() does not sort inside its every() callback', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'remediation-chain.mjs'), 'utf8');
  const at = src.indexOf('const same = ');
  assert.ok(at !== -1);
  const line = src.slice(at, src.indexOf('\n', at));
  assert.doesNotMatch(line, /every\([^)]*\)\s*=>[^;]*sort\(\)/);
  assert.doesNotMatch(line, /\.every\(\(x, i\) => x === \[\.\.\.b\]\.sort\(\)\[i\]\)/);
});
