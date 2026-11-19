// THE FAN-IN WAS NEVER MEASURED, ONLY THE FAN-OUT.
//
// Every number bench-lenses produced scored DETECTION: did a lens land on the seeded defect. A
// `reconcile` that then discarded the group still read as recall 1.0, so the one failure mode a
// fan-in graph is uniquely exposed to — the barrier losing what the lenses correctly found — was
// invisible while reconcile took 22-34% of every bench pass.
//
// scoreReconcile closes that. These tests pin the part that is easy to get wrong, and that WAS got
// wrong on the first attempt: which decisions mean the defect survived.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreReconcile } from '../scripts/lib/bench-scoring.mjs';

const GI = [
  { group_id: 'G-1', file: 'scripts/lib/decisions.mjs', line: 40 },
  { group_id: 'G-2', file: 'scripts/lib/decisions.mjs', line: 43 },
  { group_id: 'G-9', file: 'scripts/other.mjs', line: 400 },
];
const at = (decisions) => scoreReconcile({
  groupIndex: GI, decisions, file: 'scripts/lib/decisions.mjs', defectLine: 43, tolerance: 15,
});

test('a confirmed group anchored on the seed is kept', () => {
  const s = at({ 'G-2': { decision: 'confirmed' } });
  assert.equal(s.state, 'kept');
  assert.equal(s.kept, true);
});

test('dropped and coincidence are losses, because a seeded defect is real by construction', () => {
  // The reconcile prompt: `dropped` is "not defensible", `coincidence` is "does not survive contact
  // with the other's evidence". Both are wrong about a seed, which exists.
  for (const decision of ['dropped', 'coincidence']) {
    const s = at({ 'G-1': { decision }, 'G-2': { decision } });
    assert.equal(s.state, 'lost', `${decision} must score as lost`);
    assert.equal(s.kept, false);
  }
});

test('a SYMPTOM is kept, not lost — it is "real, but downstream of another group"', () => {
  // THE BUG THIS TEST EXISTS FOR. The first version scored `kept = decision === 'confirmed'`, which
  // called a correctly-attributed seed a barrier failure. A symptom reaches the gate under its root
  // cause; the defect is reported, so nothing was lost.
  const s = at({ 'G-2': { decision: 'symptom', root_cause_group: 'G-1' }, 'G-1': { decision: 'confirmed' } });
  assert.equal(s.state, 'kept');
});

test('a symptom whose root cause was dropped IS lost — the chain is followed', () => {
  const s = at({ 'G-2': { decision: 'symptom', root_cause_group: 'G-1' }, 'G-1': { decision: 'dropped' } });
  assert.equal(s.state, 'lost',
    'a symptom is only as alive as the group it was attributed to');
});

test('a cycle in root_cause_group terminates instead of hanging', () => {
  // The ids are model-authored, so a cycle is a thing that can arrive. A scorer that recursed
  // without a visited set would hang the whole bench on one malformed envelope.
  const s = at({
    'G-2': { decision: 'symptom', root_cause_group: 'G-1' },
    'G-1': { decision: 'symptom', root_cause_group: 'G-2' },
  });
  assert.equal(s.state, 'lost');
});

test('a symptom with no root cause named still counts as reported', () => {
  const s = at({ 'G-2': { decision: 'symptom', root_cause_group: null } });
  assert.equal(s.state, 'kept',
    'the reconciler omitting a pointer is not the same as the defect being discarded');
});

test('reconcile not reporting is NOT a loss', () => {
  // A node that never ran cannot have dropped anything. Scoring it as a barrier failure would blame
  // the barrier for a transport error — the same distinction the harness draws between a MISS and a
  // seed NOT RUN.
  for (const decisions of [undefined, null, {}]) {
    const s = scoreReconcile({
      groupIndex: GI, decisions, file: 'scripts/lib/decisions.mjs', defectLine: 43,
    });
    assert.equal(s.state, 'not-reported');
    assert.equal(s.kept, null, 'null, not false — unknown is not a failure');
  }
});

test('no group anchored on the seed is a grouping question, not a decision one', () => {
  // ANCHORING COMES FROM groupIndex, NOT FROM THE DECISIONS. An earlier version of this test put a
  // confirmed decision on a far-away group and expected `no-anchored-group`, which is wrong twice:
  // G-1 and G-2 are still anchored, and an anchored group the payload never decided has not reached
  // the gate, so `lost` is the right answer for it.
  const s = scoreReconcile({
    groupIndex: [{ group_id: 'G-9', file: 'scripts/other.mjs', line: 400 }],
    decisions: { 'G-9': { decision: 'confirmed' } },
    file: 'scripts/lib/decisions.mjs', defectLine: 43, tolerance: 15,
  });
  assert.equal(s.state, 'no-anchored-group');
  assert.equal(s.kept, null, 'unknown, not a failure');
});

test('an anchored group the payload never decided is lost', () => {
  const s = at({ 'G-9': { decision: 'confirmed' } });
  assert.equal(s.state, 'lost',
    'the reconciler was handed the group and did not decide it, so it reaches no gate');
});

test('a resolved defect line is required, for the same reason scoreSeed requires one', () => {
  assert.throws(
    () => scoreReconcile({ groupIndex: GI, decisions: { 'G-2': { decision: 'confirmed' } }, file: 'x', defectLine: 0 }),
    /defectLine/,
  );
});
