// ONE CONTAINMENT OWNER (G-5, G-9, G-12, G-13 of 20261029-212858-rdr-remediation-2-review, panel-codex-arch, LOW): four
// places compared paths with a local, case-sensitive `startsWith`, beside the host-aware owner (io/finding-scope.mjs's
// isWithin, ARCHITECTURE.md A-1). On a case-insensitive filesystem a differently cased spelling of the same folder was
// then outside it: the intent hash took in the reviews folder's files, and the tree hash took in the excluded run.
// Two of the four are observable from a spelling (below); the other two compare paths built from one spelling.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withTempDir } from './helpers.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { intentInputHash } from '../scripts/io/intent-cache.mjs';
import { worktreeSha } from '../scripts/io/worktree.mjs';

const caseFolding = hostPlatform().caseInsensitiveFs;
const upper = (root, rel) => path.join(root, rel.toUpperCase());

test('G-9: the intent hash leaves out the reviews folder however its spelling is cased', { skip: !caseFolding && 'a case-sensitive filesystem' }, () => {
  withTempDir((root) => {
    fs.mkdirSync(path.join(root, 'docs', 'rev'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'a.md'), 'a');
    fs.writeFileSync(path.join(root, 'docs', 'rev', 'run.md'), 'a run artifact');
    const hash = (reviewsDir) => intentInputHash({ repoRoot: root, docPaths: ['docs/**'], reviewsDir });
    assert.equal(hash(upper(root, 'docs/rev')), hash(path.join(root, 'docs', 'rev')),
      'a differently cased reviews folder let its files into the intent hash');
  });
});

test('G-13: the tree hash leaves out the excluded folder however its spelling is cased', { skip: !caseFolding && 'a case-sensitive filesystem' }, () => {
  withTempDir((root) => {
    fs.mkdirSync(path.join(root, 'run'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    fs.writeFileSync(path.join(root, 'run', 'b.txt'), 'b');
    const sha = (excludeDir) => worktreeSha({ repoRoot: root, paths: ['.'], excludeDir });
    assert.equal(sha(upper(root, 'run')), sha(path.join(root, 'run')),
      'a differently cased excluded folder was hashed into the tree');
  });
});
