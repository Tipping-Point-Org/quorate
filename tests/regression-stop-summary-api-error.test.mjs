// G-6 of 20261106-035103-stoplog-g8-remediation-3-review: summary() keyed every turn ending by kind and reason only, and
// both involuntary endings carry reason null, so a StopFailure's api-error ending (cause API_ERROR_CAUSE, stage 7 part 2)
// and a turn that ended without a Stop fell into one 'involuntary' row: the cause stage 7 records never reached
// `stop-log --summary`. The api-error ending now has its own row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summary, stopFailureEvent, API_ERROR_CAUSE } from '../scripts/lib/stop-record.mjs';

const events = [
  { at: 0, event: 'start', session: 's', source: 'operator' },
  stopFailureEvent({ session_id: 's', error: 'rate_limit' }, { at: 10 }),
  { at: 20, event: 'start', session: 's', source: 'operator' },
  // A start with no end before it: the earlier turn ended without a Stop.
  { at: 30, event: 'start', session: 's', source: 'operator' },
  { at: 40, event: 'end', kind: 'named', reason: 'done', session: 's' },
];

test('G-6: an api-error ending has its own summary row, apart from a missed Stop', () => {
  const s = summary(events);
  assert.deepEqual(s.byKind[`involuntary:${API_ERROR_CAUSE}`], { count: 1, gapMs: 0 });
  assert.deepEqual(s.byKind.involuntary, { count: 1, gapMs: 0 });
  assert.equal(s.involuntary, 2);
});
