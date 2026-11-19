// G-5 of 20261106-043201-stoplog-g8-remediation-4-review: summary() indexed plain objects with keys taken from the
// record (a kind, a reason, a panel state), so a record carrying '__proto__' selected Object.prototype, mutated it, and
// its event was missing from Object.entries. Every key is now a row of its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summary } from '../scripts/lib/stop-record.mjs';

test('G-5: a "__proto__" kind or panel is a row of its own and leaves Object.prototype alone', () => {
  const events = [
    { at: 0, event: 'start', session: 's', source: 'operator' },
    { at: 10, event: 'end', kind: '__proto__', reason: null, session: 's', panel: '__proto__' },
    { at: 20, event: 'blocked', kind: '__proto__', session: 's' },
    { at: 30, event: 'start', session: 's', source: 'operator' },
  ];
  const s = summary(events);
  assert.equal(Object.prototype.count, undefined, 'Object.prototype was mutated');
  assert.equal(Object.prototype.turnEnds, undefined, 'Object.prototype was mutated');
  assert.ok(Object.hasOwn(s.byKind, '__proto__'), 'the kind is missing from the summary');
  assert.deepEqual({ ...Object.getOwnPropertyDescriptor(s.byKind, '__proto__').value }, { count: 2, gapMs: 20 });
  assert.ok(Object.hasOwn(s.byPanel, '__proto__'), 'the panel state is missing from the summary');
  assert.equal(Object.getOwnPropertyDescriptor(s.byPanel, '__proto__').value.turnEnds, 1);
  assert.deepEqual(Object.keys(s.byPanel).sort(), ['__proto__', 'not recorded', 'off', 'on']);
});
