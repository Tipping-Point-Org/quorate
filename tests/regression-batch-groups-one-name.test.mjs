// G-4 of 20261024-032927-rrs-remediation-review: the barrier's batch groups file was named twice, as the pattern
// 'finding-groups.batch-*.json' in RECONCILE_ARTIFACTS (what a fresh reconcile clears) and as a template literal in
// run-graph's runBatchedReconcile (what it writes). A rename of one would leave the cleanup aimed at a different family
// from the writer, the two-authority defect already fixed for the re-ask's files (reaskGroupsFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../scripts/lib/reconcile-batches.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G-4: the batch groups file has one name, which the writer and the cleanup both use', () => {
  assert.equal(typeof lib.batchGroupsFile, 'function', 'lib owns the batch groups file name');
  assert.ok(lib.RECONCILE_ARTIFACTS.includes(lib.RECONCILE_BATCH_GROUPS), 'the cleanup clears the one pattern');
  assert.equal(lib.batchGroupsFile(3), lib.RECONCILE_BATCH_GROUPS.replace('*', '3'));
  const src = fs.readFileSync(path.join(root, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.doesNotMatch(src, /finding-groups\.batch-/, 'run-graph spells no batch groups file name of its own');
});
