// regression-ciss-d1-r3-admit-groups-scale.test.mjs — G-7 of review 20261021-190234-ciss-d1-remediations-review.
//
// admitGroups spread a refusal with groups.find inside a full scan of the groups, repeated until nothing grew, comparing
// every pair's file lists afresh each time: a reverse chain, where one refusal propagates per pass, cost O(G³) group
// comparisons. Who shares with whom is now computed once, so a pass walks each group's sharers only. The result,
// including which group a refusal names as blocked_by, is the same; this pins both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { admitGroups } from '../scripts/lib/remediation-chain.mjs';

const chain = (n) => {
  // g0 shares a file with g1, g1 with g2, ... and only the last is unconfirmed: one refusal spreads per pass, backwards.
  const groups = Array.from({ length: n }, (_, i) => ({ group_id: `G-${i}`, disposition: 'fixed', cluster: `c${i}`,
    files: [`src/f${i}.mjs`, `src/f${i + 1}.mjs`] }));
  return { groups, confirmed: groups.slice(0, -1).map((g) => g.group_id) };
};

test('G-7: a refusal spreads through a reverse chain with the same outcome and blocked_by as before', () => {
  const { groups, confirmed } = chain(5);
  const { plannable, checks } = admitGroups({ groups, confirmed, caseInsensitive: false });
  assert.deepEqual(plannable, []);
  assert.deepEqual(checks.map((c) => [c.group, c.kind, c.blocked_by ?? null]), [
    ['G-4', 'unconfirmed-group', null], ['G-3', 'shared-with-refused', 'G-4'], ['G-2', 'shared-with-refused', 'G-3'],
    ['G-1', 'shared-with-refused', 'G-2'], ['G-0', 'shared-with-refused', 'G-1'],
  ]);
});

test('G-7: a reverse chain of 400 groups is admitted without a cubic number of comparisons', () => {
  const { groups, confirmed } = chain(400);
  const t0 = process.hrtime.bigint();
  const { plannable, checks } = admitGroups({ groups, confirmed, caseInsensitive: false });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(plannable.length, 0);
  assert.equal(checks.length, 400);
  assert.equal(checks.at(-1).blocked_by, 'G-1');
  assert.ok(ms < 1500, `admitGroups took ${ms.toFixed(0)} ms for 400 chained groups`);
});
