// Budget accounting, which has now been wrong in both directions.
//
// First: `started_at` was used to infer that a node had launched — but stubs carry a timestamp too,
// so every SKIPPED node was charged the full per-node cap. A sweep reported $24.02 against $19.33
// actually spent. Fixed by recording `launched` as an explicit fact.
//
// Then, one function away: killAllLive stubbed nodes it had just KILLED — definitively launched,
// definitively billed — and writeStatusStub hardcoded launched:false, so an interrupted run was
// charged $0 for work already paid for. Found by code-audit in 20260804-202327-sweep2 (G-7).
//
// The comment documenting the first fix sat directly above the code that reintroduced it. Prose
// did not prevent the regression. This file is the attempt that can.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { nodeSpend } from '../scripts/lib/decisions.mjs';

const CAPS = { budgetNode: 4.0, budgetBarrier: 7.0 };

test('a reported cost always wins over any cap', () => {
  assert.equal(nodeSpend({ node_id: 'code-audit', launched: true, total_cost_usd: 3.35 }, CAPS), 3.35);
  assert.equal(nodeSpend({ node_id: 'x', launched: true, total_cost_usd: 0 }, CAPS), 0,
    'a genuine zero is a number, not a missing value');
});

// THE FIRST BUG.
test('regression: a node that never launched is charged nothing', () => {
  assert.equal(
    nodeSpend({ node_id: 'feature-verify', launched: false, started_at: '2026-01-01T00:00:00Z' }, CAPS),
    0,
    'a stub carries started_at; charging on that basis overstated a sweep by $4.69',
  );
});

// THE SECOND BUG. A killed node reports no cost because it died before reporting one — but
// "unknown" must not round to "free", or a --resume after an operator interrupt gets a clean
// budget for work already billed.
test('regression: a killed node is charged the cap, because it launched and cost real money', () => {
  const killed = { node_id: 'code-audit', launched: true, state: 'BLOCKED', total_cost_usd: null };
  assert.equal(nodeSpend(killed, CAPS), CAPS.budgetNode);
});

test('regression: launched is read explicitly, never inferred from a timestamp', () => {
  // Identical but for the flag. If anyone reintroduces timestamp-sniffing, these converge.
  const stub = { node_id: 'a', launched: false, started_at: '2026-01-01T00:00:00Z' };
  const real = { node_id: 'a', launched: true, started_at: '2026-01-01T00:00:00Z' };
  assert.notEqual(nodeSpend(stub, CAPS), nodeSpend(real, CAPS));
});

test('the barrier is charged its own budget, not the per-node one', () => {
  assert.equal(nodeSpend({ node_id: 'reconcile', launched: true }, CAPS), CAPS.budgetBarrier);
  assert.equal(nodeSpend({ node_id: 'code-audit', launched: true }, CAPS), CAPS.budgetNode);
});

// A status file with neither a cost nor a launched flag is a node we know nothing about. Charging
// it is the conservative reading: overstating a spend that may have happened is the safe error.
test('an unreadable status is charged the cap rather than assumed free', () => {
  assert.equal(nodeSpend({ node_id: 'mystery' }, CAPS), CAPS.budgetNode);
  assert.equal(nodeSpend(null, CAPS), CAPS.budgetNode);
});

test('regression: reconcile-b is charged the barrier budget it launched under, by mode', () => {
  // Launch grants the barrier cap by mode === 'reconcile'; accounting keyed on the node-id
  // literal, so a killed reconcile-b was charged the node cap and the run-budget guard
  // authorised more spend than the contract allowed (G-15). The two keys must agree.
  const caps = { budgetNode: 4, budgetBarrier: 7 };
  assert.equal(nodeSpend({ node_id: 'reconcile-b', mode: 'reconcile', launched: true }, caps), 7);
  // Pre-mode statuses (and the first reconcile) still resolve by id.
  assert.equal(nodeSpend({ node_id: 'reconcile', launched: true }, caps), 7);
  assert.equal(nodeSpend({ node_id: 'code-audit', mode: 'lens', launched: true }, caps), 4);
});

// THE LAST LAUNCH COULD SPEND PAST THE RUN CEILING (G-42, panel-codex-code).
//
// The admission test was `spent >= BUDGET_RUN`: a node was admitted whenever the current total sat
// under the line, and it then RESERVED a full node cap on top. So the final launch of a run
// overshoots `budget_usd_per_run` by up to one node cap while the artifacts record a ceiling that
// was respected — the reservation is exactly the quantity the test should have compared against.
test('a node is admitted only when the run can afford its reservation', () => {
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const block = graph.slice(graph.indexOf('overBudget: () => {'), graph.indexOf('onDropped: (dropped, why)'));

  // THE RULE MOVED to lib/decisions.mjs's admitSpend (reconcile-batches.plan.md stage 3), shared with the barrier's
  // launches. The fan-out passes its reservation; the rule compares spent PLUS that reservation.
  assert.match(block, /return admitSpend\(\{ spent, reserve: BUDGET_NODE, budgetRun: BUDGET_RUN \}\)/,
    'the fan-out must ask the one admission rule, with the node cap as its reservation');
  const lib = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'decisions.mjs'), 'utf8');
  // From its doc comment, which states why an uncapped reservation is not a hole, to the next function.
  const rule = lib.slice(lib.indexOf('WHETHER THE RUN CAN AFFORD WHAT IS ABOUT TO LAUNCH'), lib.indexOf('export function nodeSpend('));
  assert.match(rule, /spent \+ r <= budgetRun/,
    'admitting on "not yet over" lets the next node push the run past its own ceiling');
  assert.ok(!/return spent >= budgetRun\s*$/m.test(rule), 'the bare comparison must not be the test');

  // The property itself, as arithmetic: a run capped at $12 with $2.50 nodes must stop at $10.00,
  // not at $11.99 — because a launch at $11.99 can end the run at $14.49.
  const afford = (spent, reserve, cap) => spent + reserve <= cap;
  assert.equal(afford(9.99, 2.5, 12), false, 'no room for the reservation');
  assert.equal(afford(9.49, 2.5, 12), true);

  // An UNCAPPED node budget has no reservation size, so there is nothing to require room for. That
  // is not a hole this introduces: the tier is stamped UNCAPPED-BUDGET and named in not_checked[],
  // which is the run saying out loud that it did not bound this.
  assert.match(rule, /Number\.isFinite\(reserve\) \? reserve : 0/);
  assert.match(rule, /UNCAPPED-BUDGET/, 'and the fallback must say why it is not a hole');
});
