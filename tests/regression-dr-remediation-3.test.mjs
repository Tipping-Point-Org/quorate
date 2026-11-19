// Remediation 20261103-163145-dr-remediation-3 of review 20261101-065930-dr-delivery (decision-records.plan.md):
// G-8  the record carries A-21's boolean `converged` (the plan's stage 3: "`converged` when the last round was unanimous,
//      whatever extended it"), not only an `agreement` string;
// G-14 a majority below the floor reaches the operator WITH the positions as its options, as settleOutcome promises;
// G-16 the decide-mode probe constrains `citations`, so a transport that drops the field fails it;
// G-6  the revote's blind author is given the blinded question, never the raw one with its recommendation marks;
// G-15 a seat answer missing `citations` or `what_would_change` is not counted, as the seat schema requires both;
// G-2  the panel's work context lists untracked files, so new work is not missing from what the seats see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outcomeOf, settleOutcome, seatAnswerOf } from '../scripts/lib/decision-panel.mjs';
import { probePassed } from '../scripts/lib/reviewer-probe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G-8: converged is a boolean on every outcome, true only for unanimity reached after round 1', () => {
  assert.equal(outcomeOf({ phase: 'first', majority: 'E1', unanimous: true, rounds: 2, moderatorRounds: 0 }).converged, true);
  assert.equal(outcomeOf({ phase: 'first', majority: 'E1', unanimous: true, rounds: 4, moderatorRounds: 1 }).converged, true,
    'whatever extended it');
  assert.equal(outcomeOf({ phase: 'first', majority: 'E1', unanimous: true, rounds: 1, moderatorRounds: 0 }).converged, false,
    'round 1 unanimity is independent agreement');
  assert.equal(outcomeOf({ phase: 'first', majority: 'E1', unanimous: false, rounds: 3, moderatorRounds: 0 }).converged, false);
  assert.equal(outcomeOf({ phase: 'first', majority: null, rounds: 3, moderatorRounds: 0 }).converged, false);
});

test('G-14: below the floor, the outcome carries the positions as its options; at or above, none', () => {
  const o = { outcome: 'majority', entry: 'E1', agreement: 'majority', rounds: 1, moderator_rounds: 0 };
  const positions = [{ entry: 'E1', label: 'A', seats: ['s1', 's2'] }, { entry: 'E2', label: 'B', seats: ['s3'] }];
  const below = settleOutcome(o, { basis: 'convention', floor: 'measurement', positions });
  assert.equal(below.outcome, 'to-operator');
  assert.deepEqual(below.options, positions);
  assert.notEqual(below.options, positions, 'a copy, not the caller\'s array');
  const settled = settleOutcome(o, { basis: 'measurement', floor: 'measurement', positions });
  assert.equal(settled.outcome, 'majority');
  assert.equal('options' in settled, false);
});

test('G-14: the record builds the positions from the last round\'s votes and passes them to settleOutcome', () => {
  const src = read('scripts/io/decision-run.mjs');
  assert.match(src, /settleOutcome\(talked, \{[^}]*positions/, 'decision-run passes the positions');
});

test('G-16: the decide probe asks for a citation and fails an answer that dropped it', () => {
  const ok = { result: { choice: 'E1', reason: 'probe', what_would_change: 'probe', citations: ['probe'] } };
  assert.equal(probePassed('decide', ok), true);
  const dropped = { result: { choice: 'E1', reason: 'probe', what_would_change: 'probe' } };
  assert.equal(probePassed('decide', dropped), false, 'a transport that drops citations is not a seat shown to work');
  assert.match(read('prompts/_templates/reviewer-probe-decide.md'), /`citations` \["probe"\]/);
});

test('G-6: the revote author is given the blinded question and options', () => {
  const src = read('scripts/decide.mjs');
  const call = src.match(/buildRevoteAuthorPrompt\(\{[^)]*\}\)/)?.[0] ?? '';
  assert.ok(call, 'the author prompt is built in decide.mjs');
  assert.doesNotMatch(call, /question\.question|question\.options/, 'never the raw question');
  assert.match(call, /blind/i);
});

test('G-15: a seat answer missing citations or what_would_change is silence, not a counted vote', () => {
  const full = { status: 'ok', choice: 'E1', rationale: 'r', other_text: '', change_of: '', what_would_change: 'a bench run', citations: [] };
  assert.notEqual(seatAnswerOf(full).result, null, 'an empty citations list is an answer: a convention seat cites nothing');
  const { citations, ...noCitations } = full;
  assert.equal(seatAnswerOf(noCitations).result, null);
  assert.match(seatAnswerOf(noCitations).why, /citations/);
  assert.equal(seatAnswerOf({ ...full, what_would_change: '' }).result, null);
  assert.match(seatAnswerOf({ ...full, what_would_change: '  ' }).why, /what_would_change/);
  assert.equal(seatAnswerOf({ ...full, citations: 'x.txt' }).result, null, 'not a list');
});

test('G-2: the work context lists untracked files beside the diff', () => {
  const src = read('scripts/decide.mjs');
  assert.match(src, /'ls-files', '--others', '--exclude-standard'/);
});
