// G-13 / G-44 / G-57 — THE MIGRATION FROM "A LONE VOTE DECIDES" TO "INQUORATE" STOPPED HALFWAY.
//
// `adjudication.mjs` computes two different things and only one of them learned about QUORUM:
//
//   const decided = Boolean(top && (!runnerUp || top[1] > runnerUp[1]));   // :129, PRE-quorum plurality
//   const outcome = cast.length < QUORUM ? 'inquorate' : (decided ? 'decided' : 'tied');  // :158, quorate
//
// A single vote makes `outcome` 'inquorate' — and `decided` true, because one vote has no runner-up.
// Everything keyed off `outcome` is right; everything still keyed off `decided` reports a panel result
// the panel never reached:
//
//   G-13  `supports: decided ? top[0] : null` (:191) records the lone vote's POSITION in
//         adjudication.json, the only machine-readable panel record. I-2 forbids an inquorate group
//         carrying a position.
//   G-44  the gate prints ", N decided by a SINGLE judge" (run-graph.mjs:3932) — and with QUORUM = 2,
//         single_judge is true exactly when the group is inquorate. The gate announces as decided the
//         groups that are by definition undecided.
//   G-57  the regression test for this path never checked the recorded position, so the field could
//         hold anything and stay green.
//
// This is the request under review (adjudication-merge-for-disputes) failing its own I-11: "a failed
// adjudication must not leave disputes presented as settled". reconciled.md renders correctly only
// because it happens to branch on `m.decided` rather than on the outcome — the right answer by luck.
//
// ONE CLAIM, checked here: an inquorate group is inquorate everywhere. It records no position, and
// nothing downstream calls it decided.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { mergeAdjudication, summariseAdjudications } from '../scripts/lib/adjudication.mjs';

/** One judge voted; the other never reported. QUORUM is 2, so the panel did not settle this. */
// voteVocabulary takes participant IDS as strings; an object silently yields an empty vocabulary,
// every vote becomes illegal, and the outcome reads 'absent' instead of the case under test.
const PARTICIPANTS = ['panel-codex-perf', 'perf-audit'];
const LONE = [{ judge: 'adj-agy', reviewer: 'agy', state: 'reachable', supports: 'panel-codex-perf', confidence: 'high' }];

test('an inquorate group records NO supported position', () => {
  const m = mergeAdjudication({ participants: PARTICIPANTS, votes: LONE, scheduled: 2 });

  assert.equal(m.outcome, 'inquorate', 'one vote against QUORUM 2 is inquorate');
  assert.equal(m.supports, null,
    'adjudication.json is the only machine-readable panel record (I-12). An inquorate group carrying '
    + 'a position tells a reader the panel backed something it never settled (I-2).');
});

test('a quorate decision still records its position', () => {
  const two = [
    { judge: 'adj-agy', reviewer: 'agy', state: 'reachable', supports: 'panel-codex-perf', confidence: 'high' },
    { judge: 'adj-codex', reviewer: 'codex', state: 'reachable', supports: 'panel-codex-perf', confidence: 'medium' },
  ];
  const m = mergeAdjudication({ participants: PARTICIPANTS, votes: two, scheduled: 2 });
  assert.equal(m.outcome, 'decided');
  assert.equal(m.supports, 'panel-codex-perf', 'the fix must not silence a genuine decision');
});

test('a tie records no position either', () => {
  const split = [
    { judge: 'adj-agy', reviewer: 'agy', state: 'reachable', supports: 'panel-codex-perf', confidence: 'high' },
    { judge: 'adj-codex', reviewer: 'codex', state: 'reachable', supports: 'perf-audit', confidence: 'high' },
  ];
  const m = mergeAdjudication({ participants: PARTICIPANTS, votes: split, scheduled: 2 });
  assert.equal(m.outcome, 'tied');
  assert.equal(m.supports, null, 'a tie IS the finding; it backs nobody');
});

// G-44 — the gate's own sentence.
test('the gate does not call an inquorate group decided', () => {
  // CODE ONLY. Reading the whole file would match the comment that EXPLAINS the fix, so the check
  // would fail on its own rationale — the same trap the backtick rule hit in ARCHITECTURE.md. A test
  // that a comment can defeat is a test about prose, not about what the gate prints.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join(' ');
  assert.ok(!/decided by a SINGLE judge/.test(src),
    'with QUORUM = 2 a single_judge group is ALWAYS inquorate, so this phrase announces as decided '
    + 'exactly the groups that are undecided. Say what it is: one judge voted and the panel was '
    + 'inquorate.');
});

// The summary counters must agree with the outcomes they are counting.
test('the summary counts a lone vote as inquorate and not as decided', () => {
  const s = summariseAdjudications([mergeAdjudication({ participants: PARTICIPANTS, votes: LONE, scheduled: 2 })]);
  assert.equal(s.inquorate, 1);
  assert.equal(s.decided, 0, 'a lone vote has never decided anything since QUORUM was introduced');
});

// G-57 — the test that existed for this path never looked at the field that was wrong.
test('the older adjudication regression now asserts the recorded position', (t) => {
  const p = path.join(REPO_ROOT, 'tests', 'regression-adjudication-merge.test.mjs');
  if (!fs.existsSync(p)) { t.skip('regression-adjudication-merge.test.mjs is absent'); return; }
  const src = fs.readFileSync(p, 'utf8');
  assert.match(src, /supports/,
    'the regression named for the single-judge path never checked `supports`, which is the field that '
    + 'carried the defect — a test that cannot fail for the reason it is named (G-57).');
});
