// Four record defects of 20261105-013235-ar-d1-c-remediation-review, each in a pure builder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopFailureEvent, turnStartEvents, summary } from '../scripts/lib/stop-record.mjs';
import { buildDecisionRecord } from '../scripts/lib/telemetry-record.mjs';

// G-11: reset_text was read from the raw message, so a credential inside the matched reset phrase was stored verbatim
// while the message beside it was redacted.
test('G-11: a credential inside the reset phrase is redacted in reset_text', () => {
  const key = ['sk', 'A'.repeat(12) + 'b'.repeat(12)].join('-');
  const e = stopFailureEvent({ session_id: 's', last_assistant_message: `limit resets at ${key} soon` }, { at: 5 });
  assert.ok(e.reset_text, 'the reset phrase was found');
  assert.ok(!e.reset_text.includes(key), `reset_text recorded the credential verbatim: ${e.reset_text}`);
});

// G-14: absent rounds were reported as measured zeros; an absent count is null.
test('G-14: absent rounds and moderator_rounds are null, never 0', () => {
  const r = buildDecisionRecord('20261105-000000-aaaaaa', { first: { outcome: 'A', agreement: 'majority' } });
  assert.equal(r.rounds, null);
  assert.equal(r.moderator_rounds, null);
  const both = buildDecisionRecord('20261105-000000-aaaaaa', { first: { outcome: 'none', rounds: 3, moderator_rounds: 1 }, revote: { outcome: 'A', rounds: 2, moderator_rounds: 0 } });
  assert.equal(both.rounds, 5);
  assert.equal(both.moderator_rounds, 1);
  const half = buildDecisionRecord('20261105-000000-aaaaaa', { first: { outcome: 'none', rounds: 3 }, revote: { outcome: 'A' } });
  assert.equal(half.rounds, null, 'a revote with no rounds recorded makes the sum unknown');
});

// G-12: an involuntary ending inferred from a second start carried no panel state, so it always landed under
// 'not recorded' in byPanel.
test('G-12: an involuntary ending found by a later start is filed under the panel state', () => {
  const evs = [
    { at: 0, event: 'start', session: 'a' },
    ...turnStartEvents({ session_id: 'a' }, { at: 10, open: true, panel: 'on' }),
    { at: 20, event: 'end', kind: 'named', reason: 'done', session: 'a', panel: 'on' },
  ];
  assert.deepEqual(summary(evs).byPanel.on, { turnEnds: 1, involuntary: 1, gapMs: 0 });
  // A record with no involuntary line: the second start, carrying the state, decides it.
  const bare = [{ at: 0, event: 'start', session: 'b' }, { at: 10, event: 'start', session: 'b', panel: 'off' }];
  assert.equal(summary(bare).byPanel.off.involuntary, 1);
});

// G-13: byPanel seeded only on and off, so a summary with no unrecorded ending omitted the third partition.
test('G-13: byPanel always has a not-recorded row, zero when unseen', () => {
  assert.deepEqual(summary([]).byPanel['not recorded'], { turnEnds: 0, involuntary: 0, gapMs: 0 });
});
