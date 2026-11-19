// regression-ciss-d1-r3-timeout-type.test.mjs — G-8 of review 20261021-190234-ciss-d1-remediations-review.
//
// remediationTimeoutMinutes coerced the contract's review.node_timeout_minutes with Number(), so a boolean `true`
// became 1 and launched a remediation with a one-minute limit. Only a number or a decimal-digit string is a count of
// minutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { remediationTimeoutMinutes } from '../scripts/lib/remediation-chain.mjs';

test('G-8: a contract fallback that is not a number or a digit string is refused, not coerced', () => {
  for (const bad of [true, false, [5], { m: 5 }, ' ', '1e1', '0x10']) {
    assert.throws(() => remediationTimeoutMinutes(undefined, { node_timeout_minutes: bad }), /(whole|positive) number of minutes/,
      `node_timeout_minutes ${JSON.stringify(bad)} must be refused`);
  }
  assert.equal(remediationTimeoutMinutes(undefined, { node_timeout_minutes: '30' }), 30);
  assert.equal(remediationTimeoutMinutes(undefined, { node_timeout_minutes: 30 }), 30);
});
