// Review 20261101-032931-ar-remediation-3-review, remediated in 20261101-040217-ar-remediation-4: two rules of
// lib/decision-panel.mjs that held on the shapes their earlier tests used and failed on the next one.
//   G-14: blindText's trailing "— suggested" matcher was anchored to the end of the whole text, not of a line, so a
//         multiline note kept the cue on every line but the last and the revote seats read it.
//   G-17: outcomeOf put a moderator's extension before unanimity, so unanimity reached in a moderator-extended round
//         was recorded as `moderator-extended` rather than `converged` (A-21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blindQuestion, outcomeOf } from '../scripts/lib/decision-panel.mjs';

test('G-14: a trailing "— suggested" is removed from every line of a multiline description, and the lines stay', () => {
  // The note this rule first guarded is gone (decision-records.plan.md stage 5: a fresh author writes it); descriptions keep it.
  // A description is blinded by the same marks, so a multiline description is held to it too.
  const q = blindQuestion({ question: 'Which?', options: [{ label: 'A', description: 'one — suggested\ntwo' }, { label: 'B' }] });
  assert.equal(q.options[0].description, 'one\ntwo');
  // A description written with CRLF line ends is the same description.
  assert.equal(blindQuestion({ question: 'Which?', options: [{ label: 'A', description: 'one — suggested\r\ntwo' }, { label: 'B' }] })
    .options[0].description, 'one\r\ntwo');
});

test('G-17: unanimity reached in a moderator-extended round is convergence, not moderator-extended', () => {
  assert.equal(outcomeOf({ phase: 'first', majority: 'E1', unanimous: true, rounds: 4, moderatorRounds: 1 }).agreement,
    'converged');
  // A majority short of unanimity after the moderator's extension is still that.
  assert.equal(outcomeOf({ phase: 'first', majority: 'E1', unanimous: false, rounds: 4, moderatorRounds: 1 }).agreement,
    'moderator-extended');
});
