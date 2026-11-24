// G-6 of 20261106-013812-stoplog-g8-remediation-review: a `Stop: error — <detail>` or `Stop: wait — <detail>` line was
// recorded verbatim in the session's stop record, while a StopFailure event's text went through redactClaim. A detail
// quoting a credential reached the record on disk. The guard's record now redacts the detail by the same owner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardDecision } from '../scripts/io/stop-record.mjs';

const KEY = `{'${'api' + '_key'}': 'Zq8Pw2LmX9'}`;

test('G-6: a named stop\'s detail is redacted before it is recorded', () => {
  const d = guardDecision({ last_assistant_message: `done here\nStop: error — the call failed with ${KEY}` });
  assert.equal(d.block, false);
  assert.match(d.record.detail, /\[redacted/, d.record.detail);
  assert.ok(!d.record.detail.includes('Zq8Pw2LmX9'), d.record.detail);
});

test('G-6: a declared wait\'s detail is redacted, and so is a blocked or after-block record\'s', () => {
  const tasks = [{ status: 'running' }];
  const wait = guardDecision({ last_assistant_message: `Stop: wait — job with ${KEY}`, background_tasks: tasks });
  assert.ok(!wait.record.detail.includes('Zq8Pw2LmX9'), wait.record.detail);
  // A reserved stop with no options is blocked: its record carries the detail too.
  for (const again of [false, true]) {
    const r = guardDecision({ last_assistant_message: `Stop: reserved — x ${KEY}`, stop_hook_active: again });
    assert.equal(r.record.detail != null, true);
    assert.ok(!JSON.stringify(r.record).includes('Zq8Pw2LmX9'), JSON.stringify(r.record));
  }
});

test('G-6: an ordinary detail is kept as written', () => {
  const d = guardDecision({ last_assistant_message: 'Stop: error — the suite failed on line 42' });
  assert.equal(d.record.detail, 'the suite failed on line 42');
});
