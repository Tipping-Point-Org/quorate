// Part 3 of 3 of regression-consumer-use-review-remediation.test.mjs: batches of unknown cost, and the rounds after.
// Split by split-slow-test-files.md; the fixture is consumer-use-review-remediation-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, REPO_ROOT } from './helpers.mjs';
import { read, fakeMain, batchedRun, remainingGrantProblems } from './consumer-use-review-remediation-fixture.mjs';

// ------------------------------------------------------------------------------- round 2 (run consumer-use-r2)
// G-13 of 20261007-040853-consumer-use-r2: the merged status summed only the batches whose cost was known, so a batch
// stopped with an unknown cost added nothing and the run's spend was understated. An unknown part makes the whole
// unknown (null), which the gate's own rule (decisions.mjs nodeSpend) charges at the barrier cap — and since the
// batches share that one ceiling (G-15), the cap is a true upper bound. The known part is kept beside it.
test('r2 G-13: a batched barrier with a batch of unknown cost reports its cost as unknown, not the known part', (t) => {
  // Batch 2 sleeps far past the 30 s barrier (test-suite-cost.md): this test needs a batch that does NOT finish, and a
  // 25 s sleep against the 30 s ceiling finished in time under the suite's load, failing the fixture's precondition. The
  // barrier kills it at its ceiling either way, so the test takes no longer.
  const { status } = batchedRun(t, { reviewYaml: ['  barrier_timeout_minutes: 0.5'], env: { FAKE_RECONCILE_MS: '9000', FAKE_RECONCILE_MS_2: '600000' } });
  const unknown = status.batches.filter((b) => typeof b.total_cost_usd !== 'number');
  assert.ok(unknown.length >= 1, `the fixture needs a batch whose cost is unknown: ${JSON.stringify(status.batches)}`);
  // Round 3 replaced "null" with one rule: the unknown batch is charged its whole grant, so the total is an upper
  // bound (null only on an uncapped barrier). Either way it must not be the known part alone.
  assert.equal(typeof status.total_cost_usd_known, 'number', 'what is known is kept');
  assert.ok(status.total_cost_usd === null || status.total_cost_usd > status.total_cost_usd_known,
    `a sum missing a part is not the cost: total ${status.total_cost_usd}, known ${status.total_cost_usd_known}`);
});

// ------------------------------------------------------------------------------- round 3 (run consumer-use-r3)
// One rule replaces two patches (operator, 2026-10-07: "One rule, then repin"): each batch is granted an even share of
// the barrier budget still unspent, and is charged its cost when known, its full grant when not (nothing when it never
// launched). G-10: an unknown-cost batch was charged nothing, so the next was granted the whole budget again and the
// barrier could spend past budget_usd_per_barrier.
test('r3 G-10: batches with unknown cost are never granted more, together, than the barrier budget', (t) => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'q-cur-r3-')), 'calls.jsonl');
  t.after(() => fs.rmSync(path.dirname(log), { recursive: true, force: true }));
  const { status } = batchedRun(t, { reviewYaml: ['  budget_usd_per_barrier: 1.0'], env: { FAKE_NO_COST: '1', FAKE_LOG: log } });
  const grants = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l).budget);
  assert.ok(grants.length >= 2, `the barrier must still run every batch: ${JSON.stringify(status.batches)}`);
  const total = grants.reduce((a, b) => a + b, 0);
  assert.ok(total <= 1.0 + 1e-9, `batches were granted $${total} in total against a $1.00 barrier: ${grants.join(', ')}`);
});

// G-6: the merged status spread the LAST batch's status, so it took `launched` from that batch alone; a last batch
// that never launched made the whole barrier read unlaunched, and nodeSpend charges an unlaunched node nothing.
test('r3 G-6: a batched barrier counts as launched when any of its batches launched', () => {
  const g = read('scripts/run-graph.mjs');
  const merge = g.slice(g.indexOf("writeTrackedJson(path.join(nodesDir, 'reconcile.status.json'), {", g.indexOf('async function runBatchedReconcile(')));
  // Inline, or through the re-ask's one owner of "launched" (G-8 of 20261024-041845-rrs-remediation-2-review); operator,
  // 2026-10-24: "yes", for this test outside remediation 20261024-045058-rrs-remediation-3b's candidate.
  assert.match(merge.slice(0, 1500), /launched: done\.some\(|launched: launchedBatches\(done\)/, 'launched must be derived from every batch, not the last');
});

test('r3: the one rule, as functions — a share of what is left in proportion to the groups, and a charge that is never nothing for spend', async () => {
  const { batchFraction, batchShare, batchCharge } = await import('../scripts/lib/reconcile-batches.mjs');
  const f = (groupsInBatch, groupsLeft, batchesLeft, minutesLeft) => batchFraction({ groupsInBatch, groupsLeft, batchesLeft, minutesLeft, floorMinutes: 5 });
  assert.equal(f(1, 2, 2, 35), 0.5, 'two equal batches: half each');
  assert.equal(f(80, 82, 2, 35), 80 / 82, 'an 80-group batch beside a 2-group one gets 80/82, not half');
  assert.equal(f(2, 81, 2, 35), 5 / 35, 'a 2-group batch ahead of a 79-group one gets the 5-minute floor (G-7)');
  assert.equal(f(1, 81, 2, 6), 0.5, 'the floor is capped at an even share, so a short barrier is not taken whole');
  assert.equal(f(16, 16, 1, 10), 1, 'the last batch gets all that is left');
  assert.equal(batchShare(35, 5 / 35), 5, 'a share is the fraction of what is left');
  assert.equal(batchShare(Infinity, 3 / 9), Infinity, 'uncapped stays uncapped');
  assert.equal(batchCharge({ cost: 0.2, launched: true, grant: 0.5 }), 0.2, 'a known cost is charged as it is');
  assert.equal(batchCharge({ cost: null, launched: true, grant: 0.5 }), 0.5, 'an unknown cost is charged its whole grant');
  assert.equal(batchCharge({ cost: null, launched: false, grant: 0.5 }), 0, 'a batch that never launched spent nothing');
  assert.equal(batchCharge({ cost: null, launched: true, grant: Infinity }), null, 'unbounded: nothing to charge against');
});
