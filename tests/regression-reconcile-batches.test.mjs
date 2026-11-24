// THE BARRIER JUDGED 80 GROUPS AND LEFT 76 UNJUDGED.
//
// The reconcile output schema carries at most 80 groups. A whole-product sweep of story-pipeline (run
// 20261005-235247-product-sweep) produced 156: the reconciler judged 80, the other 76 were neither confirmed
// nor dropped, and the gate could only list their ids. The operator chose to batch by file, inside the one
// reconcile node (2026-10-06: "Batch by file", "One node, batches inside"). These tests pin the split, the
// merge, the one owner of the batch size, and the wiring that keeps every downstream reader unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RECONCILE_MAX_GROUPS, reconcileBatches, mergeReconcilePayloads } from '../scripts/lib/reconcile-batches.mjs';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// Groups as the barrier builds them: sorted by file, ids numbered globally.
function groupsFor(counts) {
  const out = [];
  for (const [file, n] of counts) for (let i = 0; i < n; i++) out.push({ group_id: `G-${out.length + 1}`, file, line: i * 10 });
  return out;
}

test('at or under the cap there is one batch: the unbatched barrier is unchanged', () => {
  const g = groupsFor([['a.js', 40], ['b.js', 40]]);
  const { batches, splitFiles } = reconcileBatches(g, RECONCILE_MAX_GROUPS);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], g);
  assert.deepEqual(splitFiles, []);
});

test('156 groups split into batches under the cap, every group exactly once, no file divided', () => {
  // The shape of the run that found this: many files, 156 groups.
  const counts = [];
  for (let f = 0; f < 26; f++) counts.push([`src/f${String(f).padStart(2, '0')}.py`, 6]);
  const g = groupsFor(counts);
  assert.equal(g.length, 156);
  const { batches, splitFiles } = reconcileBatches(g, RECONCILE_MAX_GROUPS);
  assert.ok(batches.length >= 2, 'more groups than the cap must make more than one batch');
  for (const b of batches) assert.ok(b.length <= RECONCILE_MAX_GROUPS, `a batch of ${b.length} exceeds the cap`);
  const ids = batches.flat().map((x) => x.group_id);
  assert.deepEqual(ids, g.map((x) => x.group_id), 'every group once, in order');
  const fileBatches = new Map();
  batches.forEach((b, i) => b.forEach((x) => fileBatches.set(x.file, new Set([...(fileBatches.get(x.file) ?? []), i]))));
  for (const [file, set] of fileBatches) assert.equal(set.size, 1, `${file} was divided across batches`);
  assert.deepEqual(splitFiles, []);
});

test('a single file with more groups than the cap is split, and the split is reported', () => {
  const g = groupsFor([['small.js', 5], ['huge.js', RECONCILE_MAX_GROUPS + 10], ['tail.js', 3]]);
  const { batches, splitFiles } = reconcileBatches(g, RECONCILE_MAX_GROUPS);
  assert.deepEqual(splitFiles, ['huge.js'], 'a root-cause link may be missing there, so the run must be able to say so');
  for (const b of batches) assert.ok(b.length <= RECONCILE_MAX_GROUPS);
  assert.deepEqual(batches.flat().map((x) => x.group_id), g.map((x) => x.group_id));
});

test('the merge keeps every group, holds intent only if every batch did, and keeps each batch\'s summary', () => {
  const batches = [[{ group_id: 'G-1' }, { group_id: 'G-2' }], [{ group_id: 'G-3' }]];
  const payloads = [
    { schema_version: 1, intent_intact: true, groups: [{ group_id: 'G-1' }, { group_id: 'G-2' }], summary: 'first' },
    { schema_version: 1, intent_intact: true, groups: [{ group_id: 'G-3' }], summary: 'second' },
  ];
  const m = mergeReconcilePayloads(payloads, { runId: 'r', batches });
  assert.deepEqual(m.groups.map((x) => x.group_id), ['G-1', 'G-2', 'G-3']);
  assert.equal(m.intent_intact, true);
  assert.match(m.summary, /Batch 1 of 2 \(2 groups, G-1–G-2\)[\s\S]*first[\s\S]*Batch 2 of 2 \(1 groups, G-3–G-3\)[\s\S]*second/);
  assert.equal(mergeReconcilePayloads([payloads[0], { ...payloads[1], intent_intact: false }], { runId: 'r', batches }).intent_intact, false,
    'one batch finding the intent moved is enough');
  assert.throws(() => mergeReconcilePayloads([payloads[0]], { runId: 'r', batches }), /1 payload\(s\) for 2 batch/);
});

test('the batch size has ONE owner: the reconcile output schema reads it', () => {
  const spawn = read('scripts/spawn-node.mjs');
  assert.match(spawn, /maxItems: RECONCILE_MAX_GROUPS/, 'the schema cap and the batch size must be the same number');
  assert.doesNotMatch(spawn, /maxItems: 80\b/, 'a literal cap would let the two drift apart');
});

test('run-graph batches inside the one reconcile node, and every batch\'s brief names its own groups file', () => {
  const g = read('scripts/run-graph.mjs');
  assert.match(g, /reconcileBatches\(groupsOut, RECONCILE_MAX_GROUPS\)/, 'the barrier partitions its groups');
  // The batched path is one function since reconcile-batches.plan.md stage 1, and the barrier calls it.
  assert.match(g, /st = await runBatchedReconcile\(reconcileBatchList, splitFiles, writeReconcileBrief\)/, 'the barrier runs the batched path');
  const start = g.indexOf('async function runBatchedReconcile(');
  const block = g.slice(start, g.indexOf('\n}\n', start));
  // The name inline, or through its one owner in lib (G-14 of 20261024-032927-rrs-remediation-review); operator,
  // 2026-10-24: "fix", for this test outside remediation 20261024-035126-rrs-remediation-2's candidate.
  assert.match(block, /finding-groups\.batch-\$\{i \+ 1\}\.json|batchGroupsFile\(i \+ 1\)/, 'each batch has its own groups file');
  assert.match(block, /mergeReconcilePayloads\(/, 'the batches merge into the one payload');
  // The per-batch spawn lives in the loop the barrier and the re-ask share (reconcile-reask-shape.plan.md stage 1).
  // A GROUP SET, partitioned by the loop (G-5 of 20261024-024945-rrs-delivery): it took batches each caller partitioned.
  assert.match(block, /await reconcileBatchLoop\(groupsOut,/, 'the barrier runs its group set through the shared loop');
  const loopStart = g.indexOf('async function reconcileBatchLoop(');
  const loop = g.slice(loopStart, g.indexOf('\n}\n', loopStart));
  assert.match(loop, /^async function reconcileBatchLoop\(groups,/, 'the shared loop takes a group set');
  assert.match(loop, /= reconcileBatches\(groups, RECONCILE_MAX_GROUPS\);/, 'and partitions it itself');
  const reaskStart = g.indexOf('async function reaskMissing(');
  const reask = g.slice(reaskStart, g.indexOf('\n}\n', reaskStart));
  assert.match(reask, /await reconcileBatchLoop\(asked,/, 'the re-ask runs its missing groups through the loop');
  assert.doesNotMatch(reask, /reconcileBatches\(/, 'and does not partition them first');
  // The barrier's batches run under `reconcile`, the loop's default; the re-ask passes its own id
  // (reconcile-reask-record.plan.md stage 1).
  assert.match(loop, /nodeId = 'reconcile'/, 'the barrier\'s batches run under the one reconcile node id, so no reader changes');
  assert.match(loop, /spawnNode\(\{\s*nodeId,/, 'and the spawn uses the node id it was given');
  // Through the run owner since run-dir-descendants.plan.md stage 2.
  assert.match(loop, /runOwner\.remove\(belowRun\(evidencePayload\)\)/, 'a batch that writes no payload must not inherit the previous one\'s');
  // Since reconcile-batches.plan.md stage 3, `calibrate` carries the batched exclusion and the budget admission.
  assert.match(g, /calibrate = args\.reconcileTwice && !reconcileBatched/, 'calibration is never run on a batched barrier');
  assert.match(g, /if \(calibrate && st\.state === 'OK'\)/, 'and divergence is computed only when it ran');
  assert.match(read('prompts/_templates/reconcile-brief.md'), /\{\{groups_file\}\}/, 'the brief names the groups file');
  assert.match(read('prompts/reconcile/PROMPT.md'), /The groups file your brief names/, 'and the prompt reads that file');
});

// NO HIDDEN DEFAULT MAXIMUM (G-28 of 20261121-193516-m3s7-b1-review): both of run-graph's calls passed only the groups and
// the library filled in its module constant, so the batch size was a decision nobody at the call site made. The maximum is
// now a required argument, refused when absent, and each call names it.
test('reconcileBatches refuses a call that does not name its maximum (G-28)', () => {
  assert.throws(() => reconcileBatches([{ file: 'a', id: 'G-1' }]), /max must be a positive integer/);
});
test('both of run-graph\'s calls pass RECONCILE_MAX_GROUPS explicitly (G-28)', () => {
  const calls = read('scripts/run-graph.mjs').match(/reconcileBatches\([^)]*\)/g) ?? [];
  assert.equal(calls.length, 2, `expected two calls, found ${calls.length}`);
  for (const c of calls) assert.match(c, /, RECONCILE_MAX_GROUPS\)$/, `a call passes no maximum: ${c}`);
});
