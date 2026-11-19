// autonomous-run.plan.md stage 3: the contract keys of a delegated decision and a long run, each with one reader that
// refuses anything outside its set rather than guessing (the claim_check_transcript pattern). The flag is OFF when absent
// (autonomous-run.md criterion 3); the round caps default to 3 and 6 (design AR-D3); the spend count has no bound until
// set (AR-D5: "no per-run bound until the key is set"); the time limit defaults to 72 hours and "" lifts it (AR-D6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionPanelOf, decisionRoundsOf, runSpendMaxOf, runTimeLimitHoursOf, panelUsable }
  from '../scripts/lib/autonomous-keys.mjs';

test('review.decision_panel: absent is off, on and off are the only values', () => {
  assert.equal(decisionPanelOf({}), 'off');
  assert.equal(decisionPanelOf(undefined), 'off');
  assert.equal(decisionPanelOf({ decision_panel: 'on' }), 'on');
  assert.equal(decisionPanelOf({ decision_panel: 'off' }), 'off');
  for (const bad of [true, 'yes', '', 'ON']) assert.throws(() => decisionPanelOf({ decision_panel: bad }), /decision_panel/);
});

test('the panel needs the external panel: on without it is refused, naming both keys', () => {
  assert.deepEqual(panelUsable({ decision_panel: 'on', external_panel: true }), { ok: true, reason: null });
  const r = panelUsable({ decision_panel: 'on', external_panel: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /external_panel/);
  assert.match(r.reason, /decision_panel/);
  assert.equal(panelUsable({}).ok, false, 'off is not usable either: the flag is the operator\'s');
});

test('review.decision_rounds and decision_rounds_max: 3 and 6, whole numbers, the hard cap never below the cap', () => {
  assert.deepEqual(decisionRoundsOf({}), { cap: 3, hardCap: 6 });
  assert.deepEqual(decisionRoundsOf({ decision_rounds: 2, decision_rounds_max: 4 }), { cap: 2, hardCap: 4 });
  assert.deepEqual(decisionRoundsOf({ decision_rounds: 8 }), { cap: 8, hardCap: 8 },
    'an absent hard cap is never below a declared cap');
  assert.throws(() => decisionRoundsOf({ decision_rounds: 4, decision_rounds_max: 3 }), /decision_rounds_max/);
  for (const bad of [0, 1.5, '3', '', -1]) assert.throws(() => decisionRoundsOf({ decision_rounds: bad }), /decision_rounds/);
});

test('review.run_spend_max: absent or "" is no bound, a whole number is that many spends', () => {
  assert.equal(runSpendMaxOf({}), null);
  assert.equal(runSpendMaxOf({ run_spend_max: '' }), null);
  assert.equal(runSpendMaxOf({ run_spend_max: 0 }), 0);
  assert.equal(runSpendMaxOf({ run_spend_max: 12 }), 12);
  for (const bad of [-1, 2.5, 'ten', '12']) assert.throws(() => runSpendMaxOf({ run_spend_max: bad }), /run_spend_max/);
});

test('review.run_time_limit_hours: absent is 72, "" is unlimited, else a positive number', () => {
  assert.equal(runTimeLimitHoursOf({}), 72);
  assert.equal(runTimeLimitHoursOf({ run_time_limit_hours: '' }), null);
  assert.equal(runTimeLimitHoursOf({ run_time_limit_hours: 1.5 }), 1.5);
  for (const bad of [0, -2, 'forever', '72']) {
    assert.throws(() => runTimeLimitHoursOf({ run_time_limit_hours: bad }), /run_time_limit_hours/);
  }
});
