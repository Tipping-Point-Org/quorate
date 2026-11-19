// G-7 of review 20261019-053230-review-review (panel-codex-code): resultShapeErrors accepted two claims under one id,
// and mergeAttributionCheck keys indexOf, graded_by and armKind by id, so the later claim won each map: the merge could
// regrade or replace the wrong claim and misreport which checker graded it. Duplicate ids are refused in the shape
// check (operator: "refuse them in the shape check"), so a merged result carrying them is refused, not half-applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAttributionCheck, applyClaimRules, resultShapeErrors } from '../scripts/lib/claim-check.mjs';

const claim = (over = {}) => ({
  id: 'C1', text: 'the claim', kind: 'behaviour', grade: 'inferred', verdict: 'stands',
  search: { looked_for: 'x', where: ['CLAUDE.md'], found: 'nothing' },
  citations: [], counter_question: { question: 'q?', answer: '' }, ...over,
});
const IO = { fs: { existsSync: () => false, readFileSync: () => '' } };

test('two claims under one id are refused by the shape check', () => {
  const errs = resultShapeErrors({ claims: [claim(), claim({ text: 'another claim' })], not_checked: [] });
  assert.ok(errs.some((e) => /C1/.test(e) && /duplicate|more than once/i.test(e)), `a duplicated id passed: ${errs.join(' | ')}`);
  assert.deepEqual(resultShapeErrors({ claims: [claim(), claim({ id: 'C2' })], not_checked: [] }), []);
});

test('an arm result with a duplicated id cannot be merged into a result the rules step applies', () => {
  const arm = { schema_version: 1, not_checked: [], claims: [
    claim({ id: 'C1', kind: 'attribution', text: 'You approved X.' }),
    claim({ id: 'C1', kind: 'behaviour', text: 'The loop spins.' }),
  ] };
  const m = mergeAttributionCheck(arm, { schema_version: 1, not_checked: [], claims: [] }, { grader: 'node-rt' });
  const applied = applyClaimRules(m.result, { repoRoot: '/virtual/repo', io: IO });
  assert.equal(applied.ok, false, 'a merge that collapsed two claims into one id was applied');
  assert.ok(applied.errors.some((e) => /C1/.test(e)));
});
