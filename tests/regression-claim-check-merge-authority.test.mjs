// Review 20261019-042251-review-review, mergeAttributionCheck:
//  - G-9: an arm attribution the same-family checker left out kept the arm's grade, which was given without the
//    transcript, and applyClaimRules acted on it as though it had been checked against one.
//  - G-10: an absent not_checked from either checker was merged as [], so the rules step's absent-versus-empty guard
//    (G-13 of 20260926-044637-m0-close-r2) could no longer see the omission.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAttributionCheck, applyClaimRules, resultShapeErrors } from '../scripts/lib/claim-check.mjs';

const claim = (over = {}) => ({
  id: 'C1', text: 'the claim', kind: 'behaviour',
  search: { looked_for: 'x', where: ['CLAUDE.md'], found: 'nothing' },
  grade: 'inferred', citations: [], trigger: '', counter_question: { question: 'q?', answer: '' },
  operator_only: false, verdict: 'stands', ...over,
});
const ABSENT = Symbol('absent');
const result = (claims, not_checked = []) => ({ schema_version: 1, claims, ...(not_checked === ABSENT ? {} : { not_checked }) });
const IO = { fs: { existsSync: () => true, readFileSync: () => 'one\ntwo\nthree\n' } };

test('G-9: an arm attribution the same-family checker left out does not keep the arm\'s transcript-less grade', () => {
  const arm = result([claim({ id: 'C2', kind: 'attribution', text: 'You approved Y.', grade: 'observed', verdict: 'stands',
    citations: [{ file: 'CLAUDE.md', lines: '1' }] })]);
  const m = mergeAttributionCheck(arm, result([]), { grader: 'node-rt' });
  assert.deepEqual(m.errors, []);
  const c2 = m.result.claims.find((c) => c.id === 'C2');
  assert.equal(c2.grade, 'inferred', 'the arm graded an attribution without the transcript, and its grade was kept');
  assert.deepEqual(m.kind_disagreements, [{ id: 'C2', arm: 'attribution', same_family: 'not an attribution' }]);
  assert.ok(m.result.not_checked.some((n) => /C2/.test(n)), 'the regrade is not said in not_checked');
  const applied = applyClaimRules(m.result, { repoRoot: '/virtual/repo', io: IO });
  assert.equal(applied.claims.find((c) => c.id === 'C2').verdict, 'ask-operator', 'an unchecked attribution still stands');
});

test('G-10: an absent not_checked on either side stays absent through the merge', () => {
  for (const [arm, same, who] of [
    [result([claim()], ABSENT), result([]), 'the arm'],
    [result([claim()]), result([], ABSENT), 'the same-family checker'],
  ]) {
    const m = mergeAttributionCheck(arm, same, { grader: 'node-rt' });
    assert.equal(Object.hasOwn(m.result, 'not_checked'), false, `${who} omitted not_checked and the merge supplied []`);
    assert.ok(resultShapeErrors(m.result).some((e) => /not_checked/.test(e)), `the rules step cannot see ${who}'s omission`);
  }
  const both = mergeAttributionCheck(result([claim()], ['a']), result([], ['b']), { grader: 'node-rt' });
  assert.deepEqual(both.result.not_checked, ['a', 'b']);
});
