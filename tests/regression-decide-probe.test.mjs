// autonomous-run.plan.md stage 4. Every external reviewer is probed before it is used (reviewer-preflight), and
// `check-reviewers` is how an operator checks the whole panel on demand: it covers the decide mode at each decision_panel
// seat's pin, as claimCheckCombinations covers claim-check. Like claim-check it is not in the mint's set: no graph run
// calls it, and external-review probes it before its own first call. A change to the mode's probe prompt or to the
// seat-answer check moves the probe-code hash, so a probe of the old code cannot vouch for the new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import * as probe from '../scripts/lib/reviewer-probe.mjs';

test('decideCombinations: each seat at its pin, in decide mode, native route; a seat the adapter refuses is left out', () => {
  assert.equal(typeof probe.decideCombinations, 'function', 'lib/reviewer-probe.mjs has no decideCombinations');
  const roster = { decision_panel: { seats: [
    { reviewer: 'codex', model: 'm-c', effort: 'e-c' }, { reviewer: 'agy', model: 'm-a', effort: null }, { reviewer: 'none', model: 'x' }] } };
  assert.deepEqual(probe.decideCombinations(roster, (n) => n !== 'none'), [
    { reviewer: 'codex', model: 'm-c', effort: 'e-c', mode: 'decide', route: 'native' },
    { reviewer: 'agy', model: 'm-a', effort: '', mode: 'decide', route: 'native' },
  ]);
  assert.deepEqual(probe.decideCombinations({}, () => true), []);
});

test('check-reviewers probes them, and the mint does not', () => {
  assert.match(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'check-reviewers.mjs'), 'utf8'), /decideCombinations\(/);
  assert.doesNotMatch(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8'), /decideCombinations/);
});

test('the mode\'s probe prompt and seat-answer check are probe code', () => {
  for (const f of ['prompts/_templates/reviewer-probe-decide.md', 'scripts/lib/decision-panel.mjs']) {
    assert.ok(probe.PROBE_CODE_FILES.includes(f), `${f} is not in PROBE_CODE_FILES`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, f)), f);
  }
});
