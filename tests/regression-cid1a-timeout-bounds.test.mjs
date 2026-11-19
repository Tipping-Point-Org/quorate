// Remediation of 20261022-013653-cid1a-delivery: the minutes owner's edges.
//
// G-7 (root of G-14): a derived fallback (barrier and intent-capture default to twice the node limit) was returned without
// the maximum, so a valid node limit above 17,895 minutes minted cleanly and then blocked the run when a node spawned.
// G-5: timerMs rounded a tiny positive value to 0 ms, and spawnSync reads a zero timeout as none.
// G-8: a refusal displayed NaN as `null`, indistinguishable from a null input.
// G-18: reviewers' probe_timeout_minutes refused the digit strings the contract permits for every minutes value.
// G-9: reviewers.mjs carried its own copy of the timer ceiling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { minutes, contractMinutes, timerMs, TIMER_MAX_MINUTES, TIMER_MAX_MS } from '../scripts/lib/check-timeout.mjs';
import { adapterErrors, probeDefaultsErrors } from '../scripts/lib/reviewers.mjs';
import { probeLimits } from '../scripts/lib/reviewer-probe.mjs';

test('G-7: a derived fallback is held at the maximum, so a valid node limit cannot derive an invalid barrier', () => {
  const node = contractMinutes({ node_timeout_minutes: 20_000 }, 'node_timeout_minutes');
  const barrier = contractMinutes({ node_timeout_minutes: 20_000 }, 'barrier_timeout_minutes', node * 2);
  assert.ok(barrier <= TIMER_MAX_MINUTES, `derived ${barrier} is above the maximum ${TIMER_MAX_MINUTES}`);
  // What the derived value is handed to next: the flag spawn-node reads.
  assert.doesNotThrow(() => minutes('flag --timeout-minutes', barrier));
});

test('G-7: a derived fallback that is not a positive number is still refused', () => {
  for (const bad of [NaN, 0, -1, Infinity]) {
    assert.throws(() => minutes('review.barrier_timeout_minutes', undefined, bad), /barrier_timeout_minutes/, String(bad));
  }
});

test('G-5: a positive limit never becomes a zero-millisecond timer', () => {
  assert.ok(timerMs(1e-9) >= 1, `timerMs(1e-9) = ${timerMs(1e-9)}`);
  assert.equal(timerMs(TIMER_MAX_MINUTES, 2), TIMER_MAX_MS);
});

test('G-8: a NaN value is named as NaN in the refusal, not as null', () => {
  assert.throws(() => minutes('review.node_timeout_minutes', NaN), (e) => /got NaN/.test(e.message) && !/got null/.test(e.message));
  assert.throws(() => minutes('review.node_timeout_minutes', null), /got null/);
});

test('G-18: probe_timeout_minutes takes a digit string like every other minutes value, in both helpers', () => {
  assert.deepEqual(adapterErrors('x', { argv: ['x'], probe_timeout_minutes: '5' }).filter((e) => /probe_timeout/.test(e)), []);
  assert.deepEqual(probeDefaultsErrors({ probe_timeout_minutes: '5', version_timeout_seconds: 30, check_margin_seconds: 30 }), []);
  const limits = probeLimits({ probe_timeout_minutes: '5' }, { version_timeout_seconds: 30, check_margin_seconds: 30 });
  assert.equal(limits.probeMs, 5 * 60_000);
  // and both refuse alike what the owner refuses
  assert.ok(adapterErrors('x', { argv: ['x'], probe_timeout_minutes: '0x2' }).some((e) => /probe_timeout/.test(e)));
  assert.throws(() => probeLimits({ probe_timeout_minutes: '0x2' }, { version_timeout_seconds: 30, check_margin_seconds: 30 }));
});

test('G-9: the timer ceiling has one owner; reviewers.mjs does not restate it', () => {
  for (const f of ['scripts/lib/reviewers.mjs', 'scripts/lib/reviewer-probe.mjs']) {
    assert.doesNotMatch(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'), /2_147_483_647|2147483647/, f);
  }
});
