// THE ROSTER'S FAMILY RULE, REFUSED ON EVERY CALLER (G-2 of 20261026-174311-rct-remediation-review). validateRoster refused
// a role whose declared `family` contradicted its adapter's, but its one production caller was new-run's mint: claim-check
// and candidate-pool call their roles (claim_checker, proposers) through external-review, which never ran the check. So
// the same contradictory roster was refused when a graph was minted and accepted by the workflows that use those roles.
// external-review is the one transport every reviewer role goes through, so it refuses the roster too, before any spawn.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { benchFixture, runBench } from './tools/bench-fixture.mjs';
import { REPO_ROOT } from './helpers.mjs';

// The bench fixture's framework, plus the prompt templates external-review loads when it starts.
const fixture = (t) => {
  const fx = benchFixture(t);
  fs.cpSync(path.join(REPO_ROOT, 'prompts', '_templates'), path.join(fx.fw, 'prompts', '_templates'), { recursive: true });
  return fx;
};

const withRoster = (t, edit) => {
  const fx = fixture(t);
  const file = path.join(fx.fw, 'scripts', 'lens-roster.json');
  const roster = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(roster);
  fs.writeFileSync(file, JSON.stringify(roster, null, 2));
  return fx;
};

test('external-review refuses a claim_checker whose declared family contradicts its adapter', (t) => {
  const fx = withRoster(t, (r) => { r.claim_checker = { ...r.claim_checker, reviewer: 'codex', family: 'not-openai' }; });
  const r = runBench(fx, 'external-review.mjs', ['--reviewer', 'codex', '--mode', 'claim-check']);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /claim_checker declares family 'not-openai'/, r.output);
});

test('external-review refuses a proposer whose declared family contradicts its adapter', (t) => {
  const fx = withRoster(t, (r) => { r.proposers = { ...r.proposers, codex: { ...(r.proposers?.codex ?? {}), family: 'not-openai' } }; });
  const r = runBench(fx, 'external-review.mjs', ['--reviewer', 'codex', '--mode', 'propose']);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /proposer codex declares family 'not-openai'/, r.output);
});

test('the shipped roster passes the check, so external-review gets past it to its own argument checks', (t) => {
  const fx = fixture(t);
  const r = runBench(fx, 'external-review.mjs', ['--reviewer', 'codex', '--mode', 'propose']);
  assert.doesNotMatch(r.output, /declares family/, r.output);
});
