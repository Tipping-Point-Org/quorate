// G-11 of review 20261019-033102-review-review: mergeAttributionCheck matched a same-family claim to an arm claim by id
// ALONE, so a same-family checker that reused an id for a different claim overwrote an unrelated arm claim — the arm's
// claim vanished from the result and its grade was recorded under the wrong checker. An id now matches only when the
// claim it quotes is the same; a reused id with other text is a new claim under a fresh id, and the arm's stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAttributionCheck } from '../scripts/lib/claim-check.mjs';

const claim = (over = {}) => ({
  id: 'C1', text: 'the claim', kind: 'behaviour',
  search: { looked_for: 'x', where: ['CLAUDE.md'], found: 'nothing' },
  grade: 'inferred', citations: [], trigger: '', counter_question: { question: 'q?', answer: '' },
  operator_only: false, verdict: 'stands', ...over,
});
const result = (claims) => ({ schema_version: 1, claims, not_checked: [] });

test('a reused id quoting a different claim does not overwrite the arm\'s claim', () => {
  const arm = result([claim({ id: 'C1', text: 'The build passes.' }), claim({ id: 'C2', text: 'Tests are green.' })]);
  const same = result([claim({ id: 'C1', kind: 'attribution', text: 'You asked for X.', verdict: 'ask-operator' })]);
  const m = mergeAttributionCheck(arm, same, { grader: 'node-rt' });
  assert.deepEqual(m.errors, []);
  const c1 = m.result.claims.find((c) => c.id === 'C1');
  assert.equal(c1.text, 'The build passes.', 'the arm\'s claim was replaced by an unrelated one under its id');
  assert.equal(m.graded_by.C1, 'arm');
  const added = m.result.claims.find((c) => c.text === 'You asked for X.');
  assert.ok(added, 'the same-family attribution was lost');
  assert.notEqual(added.id, 'C1');
  assert.equal(new Set(m.result.claims.map((c) => c.id)).size, m.result.claims.length, 'ids are not unique');
  assert.equal(m.graded_by[added.id], 'node-rt');
  assert.deepEqual(m.kind_disagreements, []);
});

test('the same claim re-quoted with other spacing or case still matches the arm\'s id', () => {
  const arm = result([claim({ id: 'C1', text: 'You asked for X.' })]);
  const same = result([claim({ id: 'C1', kind: 'attribution', text: '  you asked  for X. ', verdict: 'ask-operator' })]);
  const m = mergeAttributionCheck(arm, same, { grader: 'node-rt' });
  assert.equal(m.result.claims.length, 1);
  assert.equal(m.result.claims[0].kind, 'attribution');
  assert.equal(m.graded_by.C1, 'node-rt');
  assert.deepEqual(m.kind_disagreements, [{ id: 'C1', arm: 'behaviour', same_family: 'attribution' }]);
});
