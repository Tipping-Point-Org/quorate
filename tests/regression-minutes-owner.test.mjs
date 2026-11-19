// regression-minutes-owner.test.mjs — code-index-d1-part-a.plan.md stage 1 (design note A-D1, A-D2, A-D3).
//
// One key, review.node_timeout_minutes, fell back to 15 at four readers and 30 at two; at least five validators read "a
// positive number of minutes" and disagreed; every value reaching setTimeout was unbounded except reviewers.json's probe
// limit, so above 35,791 minutes a timer overflowed to about 1 ms (G-12 of 20261021-202611-ciss-d1-remediation-4-review).
// lib/check-timeout.mjs now holds a registry, and minutes() reads every value by its key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutes, MINUTES, TIMER_MAX_MINUTES } from '../scripts/lib/check-timeout.mjs';

test('the one maximum is what a Node timer can hold', () => {
  assert.equal(TIMER_MAX_MINUTES, 35_791);
  assert.ok(TIMER_MAX_MINUTES * 60_000 <= 2 ** 31 - 1 && (TIMER_MAX_MINUTES + 1) * 60_000 > 2 ** 31 - 1);
});

test('every registered key accepts its maximum and refuses one more, naming the maximum', () => {
  for (const [key, { max }] of Object.entries(MINUTES)) {
    // Each key's own maximum, never above the timer's (the probe's is lower: G-3 of 20261022-034225-cid1a-remediation-2-review).
    assert.ok(max <= TIMER_MAX_MINUTES, key);
    assert.equal(minutes(key, max, 1), max, key);
    assert.throws(() => minutes(key, max + 1, 1), new RegExp(`${key.replace(/[.]/g, '\.')} .*at most ${max}`), key);
    assert.throws(() => minutes(key, TIMER_MAX_MINUTES + 1, 1), new RegExp(`${key.replace(/[.]/g, '\.')} .*at most ${max}`), key);
  }
});

test('every registered key refuses what Number() would have coerced', () => {
  for (const key of Object.keys(MINUTES)) {
    for (const bad of [true, false, '', ' ', '0x2', '1e1', 0, -1, Number.NaN, Infinity, [], {}, '30m']) {
      assert.throws(() => minutes(key, bad, 1), new RegExp(key.replace(/[.]/g, '\.')), `${key} accepted ${JSON.stringify(bad)}`);
    }
  }
});

test('absent: the registry number, or the resolved fallback for a derived default, never a guess', () => {
  assert.equal(minutes('review.node_timeout_minutes', undefined), 30, 'A-D2: one absent default, 30');
  assert.equal(minutes('review.check_timeout_minutes', undefined), 10);
  assert.equal(minutes('reviewers.probe_timeout_minutes', undefined), 5);
  assert.throws(() => minutes('review.node_timeout_minutes', null), /node_timeout_minutes/, 'declared with no value is not absent');
  assert.equal(minutes('review.barrier_timeout_minutes', undefined, 60), 60);
  assert.throws(() => minutes('roster.lens.timeout_minutes', undefined), /fallback .* was not resolved/);
  assert.throws(() => minutes('no.such_key', 5), /no minutes value is registered/);
});

test('whole-minute keys refuse a fraction; the others take one', () => {
  for (const [key, spec] of Object.entries(MINUTES)) {
    if (spec.whole) assert.throws(() => minutes(key, 1.5, 1), /whole number/, key);
    else assert.equal(minutes(key, '0.5', 1), 0.5, key);
  }
});
