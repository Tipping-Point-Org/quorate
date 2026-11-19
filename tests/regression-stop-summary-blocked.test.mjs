// G-4 of 20261106-013812-stoplog-g8-remediation-review: the guard records a refused stop as event 'blocked'
// (stop-guard.mjs), and shared/session-rules.md says the attempt is counted; but turns() read only start, end and
// involuntary events, so summary() dropped every blocked attempt, and a turn still open was reported in byKind as if
// 'open' were a kind of turn end. Blocked attempts are now counted by kind, and open turns apart from the turn ends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summary } from '../scripts/lib/stop-record.mjs';

const events = [
  { at: 0, event: 'start', session: 's', source: 'operator' },
  { at: 10, event: 'blocked', kind: 'unnamed-blocked', reason: null, session: 's' },
  { at: 20, event: 'end', kind: 'unnamed-after-block', reason: null, session: 's' },
  { at: 30, event: 'start', session: 's', source: 'operator' },
  { at: 40, event: 'start', session: 'other', source: 'operator' },
  { at: 50, event: 'end', kind: 'named', reason: 'done', session: 'other' },
  { at: 60, event: 'start', session: 'other', source: 'operator' },
];

test('G-4: a blocked attempt is counted by its kind', () => {
  const s = summary(events);
  assert.deepEqual(s.byKind['unnamed-blocked'], { count: 1, gapMs: 0 });
  assert.equal(s.blocked, 1);
  assert.deepEqual(s.byKind['unnamed-after-block'], { count: 1, gapMs: 10 });
});

test('G-4: an open turn is not a kind of turn end', () => {
  const s = summary(events);
  assert.equal(s.byKind.open, undefined, 'open turns are not reported as an ending kind');
  assert.equal(s.open, 2, 'the open turns of s (start at 30) and other (start at 60) are counted apart');
  assert.equal(s.turnEnds, 2);
});
