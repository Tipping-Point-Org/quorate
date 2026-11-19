// What one re-ask attempt records about itself (G-6 and G-7 of 20261024-024945-rrs-delivery).
// G-6: the state was derived only from a failed batch, so a re-ask whose time or budget ran out after one OK batch was
// recorded as OK with groups still missing. G-7: it recorded the batches PLANNED rather than launched, and left the
// status's total_cost_usd_known at the first reply's, so the re-ask's measured cost was missing from the known part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reaskOutcome } from '../scripts/lib/reconcile-batches.mjs';

// reconcileBatchLoop's shape: a batch that wrote its reply carries its payload.
const ok = (cost) => ({ status: { state: 'OK', total_cost_usd: cost }, payload: { groups: [] } });

test('G-3 of 20261024-032927: a batch that reported OK with no payload is not an OK attempt, as the barrier records it', async () => {
  const lib = await import('../scripts/lib/reconcile-batches.mjs');
  const noPayload = { status: { state: 'OK', total_cost_usd: 1 }, payload: null };
  const o = reaskOutcome({ planned: 2, done: [ok(1), noPayload], exhausted: null, firstStatus: {} });
  assert.equal(o.state, 'DEGRADED', 'the loop stopped on a missing payload, so groups are still missing');
  // ONE RULE for both callers: the barrier's batched reconcile reads its state from the same function.
  assert.equal(typeof lib.batchLoopState, 'function', 'the batch-loop state rule must have one owner in lib');
  assert.equal(lib.batchLoopState({ done: [ok(1), noPayload], exhausted: null }), 'DEGRADED');
  assert.equal(lib.batchLoopState({ done: [ok(1), { status: { state: 'TIMEOUT' }, payload: null }], exhausted: null }), 'TIMEOUT');
  assert.equal(lib.batchLoopState({ done: [ok(1)], exhausted: 'budget' }), 'BLOCKED');
  assert.equal(lib.batchLoopState({ done: [ok(1)], exhausted: null }), 'OK');
});

test('G-14 of 20261024-032927: `batches` counts only the batches that launched', () => {
  const refused = { status: { state: 'BLOCKED', launched: false }, payload: null };
  const o = reaskOutcome({ planned: 2, done: [ok(1), refused], exhausted: null, firstStatus: {} });
  assert.equal(o.batches, 1, 'a batch whose spawn was refused did not launch');
});

test('G-6: a re-ask cut short by time or budget after an OK batch is not recorded as OK', () => {
  const o = reaskOutcome({ planned: 2, done: [ok(1)], exhausted: 'the barrier time was used up', firstStatus: {} });
  assert.notEqual(o.state, 'OK', 'an attempt that did not launch every batch it planned is incomplete');
  assert.equal(o.state, 'BLOCKED', 'exhaustion is BLOCKED, as the barrier records it');
});

test('G-6: a failed batch keeps its own state, and a complete attempt is OK', () => {
  assert.equal(reaskOutcome({ planned: 2, done: [ok(1), { status: { state: 'TIMEOUT' } }], exhausted: null, firstStatus: {} }).state, 'TIMEOUT');
  assert.equal(reaskOutcome({ planned: 2, done: [ok(1), ok(2)], exhausted: null, firstStatus: {} }).state, 'OK');
});

test('G-7: the attempt records the batches launched, and the planned count beside it', () => {
  const o = reaskOutcome({ planned: 3, done: [ok(1)], exhausted: 'budget', firstStatus: {} });
  assert.equal(o.batches, 1, 'batches must count what ran, not what was planned');
  assert.equal(o.batches_planned, 3);
});

// G-8 of 20261024-072605-rrr-remediation-review: a re-ask whose spawn was refused recorded the literal NOT-LAUNCHED while
// the node's own aggregated status said BLOCKED, so the attempt and the status it points at disagreed.
test('G-8 (rrr-2): a refused re-ask\'s attempt carries its node\'s own state; none reached, NOT-LAUNCHED', async () => {
  const { notLaunchedAttempt } = await import('../scripts/lib/reconcile-batches.mjs');
  const node = { state: 'BLOCKED', launched: false, total_cost_usd: 0, total_cost_usd_known: 0, duration_ms: 5,
    report_sha256: null, validator_errors: ['spawn refused'] };
  const refused = notLaunchedAttempt({ missing: ['G-2'], planned: 1, why: null, node });
  assert.equal(refused.state, node.state, `the attempt disagrees with the node's status: ${JSON.stringify(refused)}`);
  assert.equal(refused.batches, 0);
  assert.deepEqual(refused.validator_errors, ['spawn refused']);
  assert.equal(notLaunchedAttempt({ missing: ['G-2'], planned: 1, why: 'budget', node: null }).state, 'NOT-LAUNCHED');
});

// The re-ask's OWN known cost, not a composite with the first reply's (I-9; G-2 of 20261024-064941-rrr-delivery): the
// re-ask runs as its own node since reconcile-reask-record.plan.md stage 1, and the first reply's cost is its own status's.
test('G-7: the known cost adds the re-ask batches\' usable costs, and not the first reply\'s', () => {
  const o = reaskOutcome({ planned: 2, done: [ok(1.5), { status: { state: 'OK', total_cost_usd: null } }], exhausted: null,
    firstStatus: { total_cost_usd: 2, total_cost_usd_known: 2 } });
  assert.equal(o.total_cost_usd_known, 1.5, 'the first reply\'s known cost was added to the re-ask\'s');
  assert.equal(reaskOutcome({ planned: 1, done: [ok(1)], exhausted: null, firstStatus: { total_cost_usd: 0.5 } }).total_cost_usd_known, 1);
  assert.equal(reaskOutcome({ planned: 1, done: [ok(1)], exhausted: null }).total_cost_usd_known, 1);
});
