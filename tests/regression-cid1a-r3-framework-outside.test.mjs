// G-13 of 20261022-034225-cid1a-remediation-2-review: run-graph judged the framework outside the reviewed repository by
// `frameworkRel.startsWith('..')`. On Windows path.relative across drives returns a drive-qualified absolute path, which
// that test calls inside, so a cross-drive --repo-root framework was joined under the arms' snapshot instead of read in
// place. Containment has one owner, isWithin (lib/finding-scope.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

test('the framework\'s place relative to the repository is asked of isWithin, not spelled from a relative path', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/run-graph.mjs'), 'utf8');
  assert.doesNotMatch(src, /frameworkRel\.startsWith\(/, 'a spelled-out containment test on frameworkRel');
  assert.match(src, /isWithin\(repoRoot, FRAMEWORK\.frameworkRoot\)/);
});

test('a cross-drive relative path is what the spelled-out test misjudged', { skip: process.platform !== 'win32' }, () => {
  const rel = path.win32.relative('C:\\repo', 'D:\\quorate');
  assert.ok(!rel.startsWith('..') && path.win32.isAbsolute(rel), rel);
});
