// claim-check-cross-family.plan.md stage 6. Every external reviewer is probed before it is used (reviewer-preflight),
// and `check-reviewers` is how an operator checks the whole panel on demand: it covers the claim-check mode at the
// roster's claim_checker pin, as proposeCombinations covers propose at the proposer pins. Like propose, it is not in the
// mint's set: no graph run calls it, and external-review probes it before its own first call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import * as probe from '../scripts/lib/reviewer-probe.mjs';

test('claimCheckCombinations: the claim checker\'s pin, in claim-check mode, native route', () => {
  assert.equal(typeof probe.claimCheckCombinations, 'function', 'lib/reviewer-probe.mjs has no claimCheckCombinations');
  const combos = probe.claimCheckCombinations({ claim_checker: { reviewer: 'codex', model: 'm-cc', effort: 'e-cc' } }, () => true);
  assert.deepEqual(combos, [{ reviewer: 'codex', model: 'm-cc', effort: 'e-cc', mode: 'claim-check', route: 'native' }]);
  assert.deepEqual(probe.claimCheckCombinations({}, () => true), [], 'no claim checker declared, nothing to probe');
  assert.deepEqual(probe.claimCheckCombinations({ claim_checker: { reviewer: 'codex', model: 'm' } }, () => false), [],
    'an adapter that does not take the mode is not probed in it');
});

test('check-reviewers probes them, and the mint does not', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'check-reviewers.mjs'), 'utf8');
  assert.match(src, /claimCheckCombinations\(/);
  assert.doesNotMatch(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8'), /claimCheckCombinations/);
});
