// autonomous-run.plan.md stage 2: the decision panel's rules, one owner (scripts/lib/decision-panel.mjs). A question with
// options that would go to the operator is answered by three seats of different families, blind, by majority, with
// capped talking rounds and a moderator who may extend them (autonomous-run.md criteria 7, 9, 14-17; design AR-D2..AR-D4).
// Each case below is one rule a model is not trusted to apply to itself: what a seat may see, what counts as a vote, when
// the talk ends, and which questions may reach the panel at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, RESERVED_CATEGORIES, checkCategory, blindQuestion, seatLetters, startState, applyRound,
  roundResult, nextStep, parseModerator, roundView, outcomeOf,
} from '../scripts/lib/decision-panel.mjs';
import * as panel from '../scripts/lib/decision-panel.mjs';

const Q = {
  question: 'Which cache bound should the index use?',
  options: [
    { label: 'Size cap (Recommended)', description: 'Evict least recently used. Suggested: this one.' },
    { label: 'Age cap', description: 'Drop entries older than N days.' },
  ],
};

test('reserved categories mirror session-rules, and only delegable reaches the panel', () => {
  // G-21 of 20261101-023925-ar-remediation-2-review: A-23 items 3 and 4 (a change to the contract, the roster or
  // ARCHITECTURE.md; egress metered per call by an API key) are categories of their own, so neither can only be filed
  // as `delegable`.
  assert.deepEqual(RESERVED_CATEGORIES,
    ['approval', 'destructive', 'environment', 'unrelated-program', 'governing-change', 'metered-egress']);
  assert.deepEqual(CATEGORIES, [...RESERVED_CATEGORIES, 'delegable']);
  assert.equal(checkCategory('delegable').ok, true);
  for (const c of RESERVED_CATEGORIES) {
    const r = checkCategory(c);
    assert.equal(r.ok, false);
    assert.match(r.reason, /reserved/);
  }
  assert.equal(checkCategory(undefined).ok, false, 'a question with no category is refused, not guessed');
  assert.match(checkCategory('maybe').reason, /unknown category/);
});

test('blinding strips every recommendation marker this repository writes, and keeps the substance', () => {
  const b = blindQuestion(Q);
  assert.equal(b.options[0].label, 'Size cap');
  assert.equal(b.options[0].description, 'Evict least recently used.');
  assert.equal(b.options[1].label, 'Age cap');
  for (const marked of ['A (recommended)', 'A (Suggested)', 'A — suggested', '**A (suggested)**']) {
    assert.doesNotMatch(blindQuestion({ question: 'q', options: [{ label: marked }, { label: 'B' }] }).options[0].label,
      /recommend|suggest/i, marked);
  }
  assert.doesNotMatch(blindQuestion({ question: 'Pick one. Suggested: A.', options: [{ label: 'A' }, { label: 'B' }] })
    .question, /suggest/i);
  assert.throws(() => blindQuestion({ question: 'q', options: [{ label: 'only one' }] }), /two options/);
});

test('seat letters are anonymous, a permutation, and reshuffled between rounds', () => {
  const seats = ['s1', 's2', 's3'];
  const r1 = seatLetters(seats, 1, 'seed-x');
  assert.deepEqual(Object.values(r1).sort(), ['A', 'B', 'C']);
  assert.deepEqual(seatLetters(seats, 1, 'seed-x'), r1, 'the same seed and round give the same letters');
  const differ = [2, 3, 4, 5, 6].some((r) => JSON.stringify(seatLetters(seats, r, 'seed-x')) !== JSON.stringify(r1));
  assert.ok(differ, 'later rounds reshuffle');
});

test('round 1 shows no other seat; later rounds show every entry and its reasons, under letters, never seats', () => {
  let s = startState(blindQuestion(Q));
  const v1 = roundView(s, 1, { s1: 'A', s2: 'B', s3: 'C' });
  assert.equal(v1.entries.every((e) => e.reasons.length === 0), true);
  s = applyRound(s, 1, {
    s1: { choice: 'E1', reason: 'size is what fills the disk' },
    s2: { choice: 'other', other_text: 'Both caps', reason: 'age catches stale entries' },
    s3: { choice: 'E2', reason: 'simpler' },
  }, { s1: 'A', s2: 'B', s3: 'C' });
  const v2 = roundView(s, 2, { s1: 'C', s2: 'A', s3: 'B' });
  const text = JSON.stringify(v2);
  assert.doesNotMatch(text, /"s[123]"/, 'no seat id reaches a seat');
  const e3 = v2.entries.find((e) => e.id === 'E3');
  assert.equal(e3.label, 'Both caps');
  assert.deepEqual(e3.reasons.map((r) => r.by), ['A'], 'reasons are shown under the reader round\'s letters');
  // A revote starts at round 1 again on a state that already holds reasons: it must be blind all the same.
  assert.equal(roundView(s, 1, { s1: 'B', s2: 'C', s3: 'A' }).entries.every((e) => e.reasons.length === 0), true,
    'a round-1 view is blind even when the state already carries reasons');
});

test('"Other" and a change become new entries; a change names its source and the original stays votable', () => {
  let s = startState(blindQuestion(Q));
  s = applyRound(s, 1, {
    s1: { choice: 'other', other_text: 'No cap', reason: 'r' },
    s2: { choice: 'change', change_of: 'E2', other_text: 'Age cap, 30 days', reason: 'r' },
    s3: { choice: 'E1', reason: 'r' },
  }, { s1: 'A', s2: 'B', s3: 'C' });
  assert.deepEqual(s.entries.map((e) => e.id), ['E1', 'E2', 'E3', 'E4']);
  assert.equal(s.entries.find((e) => e.label === 'Age cap, 30 days').from, 'E2');
  assert.equal(s.entries.find((e) => e.id === 'E2').label, 'Age cap', 'nobody edits another entry');
  assert.equal(s.rounds[0].added.length, 2);
});

test('a strict majority of readable votes ends the talk, unless an entry was added that round', () => {
  const L = { s1: 'A', s2: 'B', s3: 'C' };
  let s = startState(blindQuestion(Q));
  s = applyRound(s, 1, { s1: { choice: 'E1', reason: 'r' }, s2: { choice: 'E1', reason: 'r' }, s3: { choice: 'E2', reason: 'r' } }, L);
  assert.deepEqual(roundResult(s, 1), { majority: 'E1', unanimous: false, readable: 3, addedThisRound: 0 });

  let t = startState(blindQuestion(Q));
  t = applyRound(t, 1, { s1: { choice: 'E1', reason: 'r' }, s2: { choice: 'E1', reason: 'r' }, s3: { choice: 'other', other_text: 'X', reason: 'r' } }, L);
  assert.equal(roundResult(t, 1).majority, null, 'a new entry in the round breaks the majority');

  let u = startState(blindQuestion(Q));
  u = applyRound(u, 1, { s1: { choice: 'E1', reason: 'r' }, s2: 'garbled', s3: { choice: 'E2', reason: 'r' } }, L);
  assert.equal(roundResult(u, 1).readable, 2);
  assert.equal(roundResult(u, 1).majority, null, 'one of two readable votes is not a strict majority');

  let w = startState(blindQuestion(Q));
  w = applyRound(w, 1, { s1: { choice: 'E1', reason: 'r' }, s2: { choice: 'E9', reason: 'r' }, s3: null }, L);
  assert.equal(roundResult(w, 1).readable, 1, 'an unknown entry and a missing reply are silence, never votes');
  assert.equal(roundResult(w, 1).majority, null, 'one seat is not a majority of a three-seat panel');
});

test('rounds run to the cap, the moderator extends one at a time to the hard cap, and nothing else extends', () => {
  const caps = { cap: 3, hardCap: 6 };
  assert.equal(nextStep({ round: 1, majority: 'E1', ...caps }), 'decided');
  assert.equal(nextStep({ round: 1, majority: null, ...caps }), 'next-round');
  assert.equal(nextStep({ round: 3, majority: null, ...caps }), 'ask-moderator');
  assert.equal(nextStep({ round: 3, majority: null, moderatorExtends: true, ...caps }), 'next-round');
  assert.equal(nextStep({ round: 3, majority: null, moderatorExtends: false, ...caps }), 'no-majority');
  assert.equal(nextStep({ round: 6, majority: null, moderatorExtends: true, ...caps }), 'no-majority', 'the hard cap holds');
  assert.equal(nextStep({ round: 3, majority: null, moderatorExtends: 'yes', ...caps }), 'no-majority',
    'only an explicit true extends');
  assert.equal(parseModerator({ extend: true, reason: 'B and C are converging' }), true);
  for (const junk of [{ extend: 'yes' }, 'extend', null, {}, { extend: true }]) assert.equal(parseModerator(junk), false, JSON.stringify(junk));
  assert.throws(() => nextStep({ round: 1, majority: null, cap: 4, hardCap: 3 }), /hard cap/);
});

test('the outcome: majority, then a revote on the note, then postponed; each with its agreement figure', () => {
  assert.deepEqual(outcomeOf({ phase: 'first', majority: 'E2', unanimous: true, rounds: 1, moderatorRounds: 0 }),
    { outcome: 'majority', entry: 'E2', agreement: 'unanimous', rounds: 1, moderator_rounds: 0, converged: false });
  assert.equal(outcomeOf({ phase: 'first', majority: 'E1', unanimous: false, rounds: 4, moderatorRounds: 1 }).agreement,
    'moderator-extended');
  assert.equal(outcomeOf({ phase: 'first', majority: null, rounds: 3, moderatorRounds: 0 }).outcome, 'revote');
  assert.equal(outcomeOf({ phase: 'revote', majority: null, rounds: 1, moderatorRounds: 0 }).outcome, 'postponed');
  assert.equal(outcomeOf({ phase: 'revote', majority: 'E1', unanimous: false, rounds: 1, moderatorRounds: 0 }).agreement,
    'majority-on-revote');
  // G-23 of 20261101-023925-ar-remediation-2-review: unanimity reached after the seats read each other is convergence,
  // not independent agreement (A-21), so it is not labelled as round 1's unanimity is.
  assert.equal(outcomeOf({ phase: 'first', majority: 'E2', unanimous: true, rounds: 2, moderatorRounds: 0 }).agreement,
    'converged');
});

// The revote note is no longer the session's text filtered by patterns (G-10 of 20261101-023925-ar-remediation-2-review,
// G-12 of 20261101-042446-ar-remediation-4-review): a fresh blind author writes it (decision-records.plan.md stage 5),
// held by tests/regression-decision-seat-inputs.test.mjs.
