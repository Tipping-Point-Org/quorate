// G-2 (and its symptoms G-8, G-18) and G-14 of 20261022-034225-cid1a-remediation-2-review: the minutes registry held only
// `absent` and `whole`, so its empty-value rule, minimum and maximum lived in validation code rather than in the entry;
// the generated table had no Minimum or empty-value column; a test computed `MINUTES[key].max + 1` as NaN and never
// tried a finite value above the maximum; and the derived barrier and intent defaults were documented as "twice" the
// node limit although minutes() holds them at the maximum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES, TIMER_MAX_MINUTES, minutes } from '../scripts/lib/check-timeout.mjs';
import { RULES } from '../scripts/lib/rule-text.mjs';

test('every registry entry holds its absent default, empty rule, minimum and maximum', () => {
  for (const [key, s] of Object.entries(MINUTES)) {
    for (const f of ['absent', 'empty', 'whole', 'min', 'max']) assert.ok(Object.hasOwn(s, f), `${key} has no ${f}`);
    assert.ok(Number.isInteger(s.max) && s.max <= TIMER_MAX_MINUTES, key);
    assert.ok(Number.isFinite(s.min), key);
  }
});

test('minutes() refuses a finite value one above the entry\'s maximum and accepts the maximum', () => {
  for (const [key, s] of Object.entries(MINUTES)) {
    assert.ok(Number.isFinite(s.max + 1), key);
    assert.throws(() => minutes(key, s.max + 1), new RegExp(String(s.max)), key);
    assert.equal(minutes(key, s.max), s.max, key);
    assert.throws(() => minutes(key, ''), key);
  }
});

test('the generated table renders every field of the entry', () => {
  const table = RULES['minutes-table'].render();
  const head = table.split('\n')[0];
  for (const col of ['Absent', 'Empty', 'Minimum', 'Maximum']) assert.match(head, new RegExp(col), head);
});

test('a derived absent default says it is held at the maximum', () => {
  for (const key of ['review.barrier_timeout_minutes', 'review.intent_timeout_minutes']) {
    assert.match(String(MINUTES[key].absent), new RegExp(`at most ${TIMER_MAX_MINUTES}`), key);
  }
});
