// The session stopped where nothing was asked of the operator: 898 turn-end stops (157 h) in quorate's sessions, 305 of
// them answered only by "continue" (autonomous-run.md, Why; the operator: "This is the worst kind of pause"), and
// instructions in prose did not hold ("it never worked or worked for a short time"). autonomous-run-pauses.plan.md
// stage 2: a turn end is classified from the Stop hook's input, so the guard can refuse an unnamed one and the record
// can count each kind. These pin the classification the guard and the record share.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stopMarker, asksWithOptions, classifyTurnEnd, guardDecision, turnStartSource, turns, summary,
} from '../scripts/io/stop-record.mjs';

const RUNNING = [{ id: 'b1', type: 'shell', status: 'running', command: 'node tests/run-all.mjs' }];

test('regression: a marker names a stop only on the last line', () => {
  assert.deepEqual(stopMarker('All committed.\n\nStop: done'), { reason: 'done', detail: null });
  assert.deepEqual(stopMarker('x\nStop: wait — the suite'), { reason: 'wait', detail: 'the suite' });
  // Quoted in prose, or followed by more text, it is not a marker.
  assert.equal(stopMarker('I would end with `Stop: done` later.\nMore text.'), null);
  assert.equal(stopMarker('Stop: done\nand then something'), null);
  // An unknown reason is not one of the four.
  assert.equal(stopMarker('Stop: tired'), null);
  // G-7 of 20261024-220920-arp-delivery: `error` and `wait` have fixed forms with a named <what> (criteria 1 and 2);
  // without it the line names nothing, so it is not a marker and the guard blocks it as unnamed.
  assert.equal(stopMarker('x\nStop: error'), null);
  assert.equal(stopMarker('x\nStop: wait'), null);
  assert.equal(stopMarker('x\nStop: error —   '), null);
  assert.deepEqual(stopMarker('x\nStop: error — the disk is full'), { reason: 'error', detail: 'the disk is full' });
  assert.equal(classifyTurnEnd({ last_assistant_message: 'x\nStop: wait', background_tasks: RUNNING }).kind, 'undeclared-wait');
  assert.equal(guardDecision({ last_assistant_message: 'x\nStop: error', background_tasks: [] }).block, true);
});

test('regression: each kind of turn end is told apart', () => {
  assert.equal(classifyTurnEnd({ last_assistant_message: 'ok\nStop: question', background_tasks: [] }).kind, 'named');
  assert.equal(classifyTurnEnd({ last_assistant_message: 'x\nStop: wait — suite', background_tasks: RUNNING }).kind, 'declared-wait');
  assert.equal(classifyTurnEnd({ last_assistant_message: 'waiting on the suite', background_tasks: RUNNING }).kind, 'undeclared-wait');
  assert.equal(classifyTurnEnd({ last_assistant_message: 'done for now', background_tasks: [] }).kind, 'unnamed');
  // A declared wait with nothing to wait on is not a wait.
  assert.equal(classifyTurnEnd({ last_assistant_message: 'Stop: wait — the suite', background_tasks: [] }).kind, 'unnamed');
  // A finished task is not a running one.
  assert.equal(classifyTurnEnd({ last_assistant_message: 'hm', background_tasks: [{ status: 'completed' }] }).kind, 'unnamed');
});

test('regression: the guard blocks an unnamed stop and an undeclared wait once, then counts the miss', () => {
  const unnamed = { last_assistant_message: 'waiting', background_tasks: [] };
  const first = guardDecision(unnamed);
  assert.equal(first.block, true);
  assert.match(first.reason, /Stop: <done\|question\|reserved>`, `Stop: error — <what>` or `Stop: limit — <what>/);
  const second = guardDecision({ ...unnamed, stop_hook_active: true });
  assert.equal(second.block, false);
  assert.equal(second.record.kind, 'unnamed-after-block');

  const wait = guardDecision({ last_assistant_message: 'suite running', background_tasks: RUNNING });
  assert.equal(wait.block, true);
  assert.match(wait.reason, /Start another task/);
  assert.equal(guardDecision({ last_assistant_message: 'x\nStop: wait — suite', background_tasks: RUNNING }).block, false);
  assert.equal(guardDecision({ last_assistant_message: 'x\nStop: done', background_tasks: [] }).block, false);
});

test('regression: a stop that waits for the operator must ask with options', () => {
  const bare = { last_assistant_message: 'Shall I push?\nStop: question', background_tasks: [] };
  assert.equal(asksWithOptions(bare.last_assistant_message), false);
  assert.equal(guardDecision(bare).block, true);
  assert.equal(guardDecision({ ...bare, stop_hook_active: true }).record.kind, 'no-options-after-block');
  const shaped = 'Which?\n- **A.** push now (suggested)\n- **B.** wait\nStop: reserved';
  assert.equal(asksWithOptions(shaped), true);
  assert.equal(guardDecision({ last_assistant_message: shaped, background_tasks: [] }).block, false);
  // `done` and `error` need no options.
  assert.equal(guardDecision({ last_assistant_message: 'x\nStop: error — disk full', background_tasks: [] }).block, false);
});

test('regression: a turn started by a notification is told from the operator\'s', () => {
  assert.equal(turnStartSource('<task-notification>\n<task-id>b1</task-id>'), 'notification');
  assert.equal(turnStartSource('yes'), 'operator');
});

test('regression: a turn with no end is recorded as involuntary at the next start, and every end counts', () => {
  const events = [
    { at: 0, event: 'start', source: 'operator' },
    { at: 10, event: 'end', kind: 'declared-wait', reason: 'wait' },
    { at: 70, event: 'start', source: 'notification' },
    // crash: no end
    { at: 200, event: 'start', source: 'operator' },
    { at: 210, event: 'end', kind: 'named', reason: 'question' },
    { at: 1210, event: 'start', source: 'operator' },
  ];
  const ts = turns(events);
  assert.equal(ts[1].kind, 'involuntary');
  const s = summary(events);
  assert.equal(s.involuntary, 1);
  assert.equal(s.turnEnds, 2);
  assert.deepEqual(s.byKind['declared-wait:wait'], { count: 1, gapMs: 60 });
  assert.deepEqual(s.byKind['named:question'], { count: 1, gapMs: 1000 });
});

// G-9 of 20261024-220920-arp-delivery: the record is per repository, so two sessions open in one repository interleave
// their events. Pairing in file order let session B's start close A's turn as involuntary and gave A's end to B.
test('regression: turns are paired per session, so concurrent sessions do not invent involuntary stops', () => {
  const events = [
    { at: 0, event: 'start', source: 'operator', session: 'A' },
    { at: 5, event: 'start', source: 'operator', session: 'B' },
    { at: 10, event: 'end', kind: 'named', reason: 'done', session: 'A' },
    { at: 20, event: 'end', kind: 'named', reason: 'question', session: 'B' },
    { at: 110, event: 'start', source: 'operator', session: 'A' },
    { at: 520, event: 'start', source: 'operator', session: 'B' },
  ];
  const s = summary(events);
  assert.equal(s.involuntary, 0);
  assert.equal(s.turnEnds, 2);
  assert.deepEqual(s.byKind['named:done'], { count: 1, gapMs: 100 });
  assert.deepEqual(s.byKind['named:question'], { count: 1, gapMs: 500 });
  assert.ok(turns(events).filter((t) => t.end != null).every((t) => t.start != null));
});

// G-12: the guard writes the involuntary line the next start finds; it is counted once, with its cause and time.
test('regression: a recorded involuntary line closes the open turn once, with its cause', () => {
  const events = [
    { at: 0, event: 'start', source: 'operator', session: 'A' },
    { at: 50, event: 'involuntary', cause: 'ended without a Stop', session: 'A' },
    { at: 50, event: 'start', source: 'operator', session: 'A' },
  ];
  const ts = turns(events);
  assert.deepEqual(ts.map((t) => [t.kind, t.cause ?? null, t.at ?? null]), [['involuntary', 'ended without a Stop', 50], ['open', null, null]]);
  assert.equal(summary(events).involuntary, 1);
});

// Operator, 2026-10-25, on G-8 of 20261024-220920-arp-delivery: "B". G-12 of 20261025-021243-arp-remediation-3c-review:
// two marker lines gave a confident kind from the last. They are blocked once, so the session keeps exactly one.
test('regression: a message with two marker lines is blocked once, then counted', () => {
  const two = { last_assistant_message: 'Stop: question\nOn reflection, all done.\nStop: done', background_tasks: [] };
  assert.equal(classifyTurnEnd(two).kind, 'two-markers');
  const first = guardDecision(two);
  assert.equal(first.block, true);
  assert.match(first.reason, /more than one stop marker/);
  assert.equal(guardDecision({ ...two, stop_hook_active: true }).record.kind, 'two-markers-after-block');
  // A marker quoted inside a sentence is text, not a second marker.
  assert.equal(classifyTurnEnd({ last_assistant_message: 'I end with `Stop: done` lines.\nStop: done', background_tasks: [] }).kind, 'named');
});

// session-record-files.plan.md stage 5: the option check took the first line CONTAINING a question mark as the
// question. A quoted "?" early in a stop then became "the question", and status bullets after it passed as its options
// while the real question, later, had none (the G-12 class). The question is the first line that ENDS in a question
// mark, markdown emphasis aside. (The refusals of 2026-10-25 that prompted this were right: those stops put their options
// above the question.)
test('regression: a quoted question mark does not turn later status bullets into options', () => {
  const msg = ['I asked "what changed?" earlier.', '- the suite passed', '- the commit landed', 'Shall I push?', 'Stop: question'].join('\n');
  assert.equal(asksWithOptions(msg), false, 'the real question has no options after it');
  const shaped = ['I asked "what changed?" earlier.', '', '**Which do you choose?**', '- **A.** keep it (suggested)', '- **B.** drop it', 'Stop: question'].join('\n');
  assert.equal(asksWithOptions(shaped), true, 'a bold question line still counts');
});
