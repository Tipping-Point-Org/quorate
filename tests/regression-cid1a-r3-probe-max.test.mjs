// G-3 (and its symptom G-15) of 20261022-034225-cid1a-remediation-2-review: reviewers.probe_timeout_minutes was accepted up
// to the timer maximum, 35,791, and the generated table said so, but probeLimits adds the probe period twice into one
// timer and refused anything above about half of it. The fix lowered that key's maximum to fit (PROBE_MAX), a second owner
// of the sum rule (G-1 of 20261022-131046-cid1a-remediation-3-review). Decided since (probe-limit-sum.design.md): the value
// keeps the one maximum, and probeLimits, the sum's one owner, refuses a set that does not fit, at mint and at the call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES, minutes } from '../scripts/lib/check-timeout.mjs';
import { probeLimits } from '../scripts/lib/reviewer-probe.mjs';
import { adapterErrors } from '../scripts/lib/reviewers.mjs';

const KEY = 'reviewers.probe_timeout_minutes';
const DEFAULTS = { probe_timeout_minutes: 5, version_timeout_seconds: 30, check_margin_seconds: 30 };

test('the probe minutes maximum is the one maximum as a value, and probeLimits refuses it as a sum', () => {
  const max = MINUTES[KEY].max;
  assert.equal(minutes(KEY, max), max);
  assert.throws(() => probeLimits({ probe_timeout_minutes: max }, DEFAULTS), /do not fit one timer together/,
    'the sum is checked where it is summed, so a value that fits alone is refused as a sum');
  assert.throws(() => minutes(KEY, max + 1), new RegExp(`at most ${max}`));
  assert.ok(adapterErrors('x', { cmd: 'x', probe_timeout_minutes: max + 1 }).some((e) => /probe_timeout_minutes/.test(e)));
});
