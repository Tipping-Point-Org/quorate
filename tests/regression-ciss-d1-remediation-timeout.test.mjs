// regression-ciss-d1-remediation-timeout.test.mjs — G-22 of review 20261021-162807-ciss-d1-review.
//
// remediationTimeoutMinutes refused a fractional roster timeout_minutes, and passed the contract's fallback
// review.node_timeout_minutes through Number() unchecked: 0.5 reached the child runner and cancelled a remediation
// after thirty seconds. The fallback is now held to the same rule: a whole number of minutes, at least 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { remediationTimeoutMinutes } from '../scripts/lib/remediation-chain.mjs';

test('G-22: a fractional or sub-minute contract fallback is refused, as the roster value is', () => {
  for (const bad of [0.5, 0, -1, '0.5', '', 'abc']) {
    assert.throws(() => remediationTimeoutMinutes(undefined, { node_timeout_minutes: bad }), /(whole|positive) number of minutes/,
      `node_timeout_minutes ${JSON.stringify(bad)} must be refused`);
  }
});

test('G-22: a whole contract value, or none, is used as before', () => {
  assert.equal(remediationTimeoutMinutes(undefined, { node_timeout_minutes: 30 }), 30);
  assert.equal(remediationTimeoutMinutes(undefined, { node_timeout_minutes: '30' }), 30);
  // Absent: the node limit's one default, 30 (code-index-d1-part-a.plan.md stage 2; it was 15 here).
  assert.equal(remediationTimeoutMinutes(undefined, {}), 30);
  assert.equal(remediationTimeoutMinutes({ timeout_minutes: 20 }, { node_timeout_minutes: 0.5 }), 20);
});
