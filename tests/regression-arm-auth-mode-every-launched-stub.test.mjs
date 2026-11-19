// A LAUNCHED ARM IS NEVER CHARGED THE NODE CAP (G-1 of 20261114-070441-m2-7b-remediation-5-review; m2-public-release.plan.md
// stage 7b names it before the release; operator, 2026-11-16: "Fix in this session, 9a reviews it (Recommended)").
// nodeSpend (lib/decisions.mjs) charges a launched node of unknown cost the per-node cap unless its status says
// `auth_mode: 'external-vendor'`: an external arm is billed by its own vendor, not this account. The arm's no-envelope
// branch wrote a launched DEGRADED stub without it, so a consumer's finite run budget was spent on money never spent.
//
// Two halves, and the limit of the second stated: the spend rule is run directly; the census of run-graph's arm status
// stubs is a READ OF THE SOURCE, because no test harness yet runs a whole review with a fake external reviewer (the gap
// named in capture-interactive.followup.md and declined there as its own work). A stub written through a name this
// census does not know is outside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { nodeSpend } from '../scripts/lib/decisions.mjs';

test('the spend rule: a launched node of unknown cost is charged the cap, unless it is an external vendor', () => {
  const budgets = { budgetNode: 2.5, budgetBarrier: 6 };
  const stub = { launched: true, total_cost_usd: null };
  assert.equal(nodeSpend(stub, budgets) > 0, true, 'an unknown-cost launched node is charged');
  assert.equal(nodeSpend({ ...stub, auth_mode: 'external-vendor' }, budgets), 0, 'an external arm is not charged');
});

test('every launched arm status stub in run-graph carries auth_mode', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const missing = [];
  let at = src.indexOf('writeStatusStub(arm.id');
  let found = 0;
  while (at !== -1) {
    // The call's own text: from its start to the line that closes its options object.
    const end = src.indexOf('});', at);
    const call = src.slice(at, end === -1 ? at + 600 : end);
    const line = src.slice(0, at).split('\n').length;
    if (/launched:\s*true/.test(call) && !/auth_mode\s*:/.test(call)) missing.push(`run-graph.mjs:${line}`);
    found += 1;
    at = src.indexOf('writeStatusStub(arm.id', at + 1);
  }
  assert.ok(found >= 5, `the census found only ${found} arm stubs; it no longer sees them`);
  assert.deepEqual(missing, [], 'a launched arm stub without auth_mode is charged the node cap');
});
