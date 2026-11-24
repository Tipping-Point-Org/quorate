// I-3, G-17 (and its symptom G-16) of 20261122-035227-m3s7-b3-review: external-review built its worktree roots twice, in
// gitWorktreeRoots for admission and again inline for output confinement, so the two parses could drift and confinement
// and admission would disagree about which trees are this repository. One owner: gitWorktreeRoots. A static rule, held by
// the source: the git question is asked in one place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'scripts', 'external-review.mjs'), 'utf8');

test("external-review asks git for its worktree roots in gitWorktreeRoots alone", () => {
  const asks = src.match(/\['worktree', 'list', '--porcelain'\]/g) ?? [];
  assert.equal(asks.length, 1, `git worktree list is asked ${asks.length} times; gitWorktreeRoots is its one owner`);
  const tops = src.match(/\['rev-parse', '--show-toplevel'\]/g) ?? [];
  assert.equal(tops.length, 1, `rev-parse --show-toplevel is asked ${tops.length} times; gitWorktreeRoots is its one owner`);
  assert.match(src, /const roots = gitWorktreeRoots\(\);/, 'output confinement does not take its roots from the owner');
});
