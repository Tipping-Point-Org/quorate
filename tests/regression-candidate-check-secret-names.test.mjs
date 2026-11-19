// G-12 of 20261013-233901-rv-delivery-remediation-review: the runner's candidate checks run code the remediator wrote, and
// their environment was the runner's own less only the runtime's auth (what a remediation capture strips), so GITHUB_TOKEN,
// AWS_* or DATABASE_URL reached that code. The plan was amended (remediation-verification.plan.md stage 4, operator:
// "Scrub secret names (Recommended)"): the candidate checks drop every secret-shaped name through the owner the commit's
// hooks already use, commitEnvFor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateCheckEnv } from '../scripts/lib/full-check.mjs';
import { commitEnvFor } from '../scripts/lib/decisions.mjs';
// The platform context the runner supplies (candidate-check-boundaries.plan.md stage 2): an allow-list now.
const CTX = { basics: ['PATH', 'HOME'], declared: [], caseInsensitiveEnv: false };

const SRC = {
  PATH: '/bin', HOME: '/home/u', GITHUB_TOKEN: 'g', AWS_SECRET_ACCESS_KEY: 'a', DATABASE_URL: 'd', NPM_TOKEN: 'n',
  ANTHROPIC_API_KEY: 'k', QUORATE_RUN_ID: 'r', SSH_AUTH_SOCK: '/tmp/s', GRAPH_NODE_DEPTH: '0',
};

test('the candidate check drops every secret-shaped name, and the runtime auth and run pin', () => {
  const env = candidateCheckEnv(SRC, { QUORATE_COUNT_FILE: 'c.txt', QUORATE_FACTS_FILE: 'f.json' }, CTX);
  for (const k of ['GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL', 'NPM_TOKEN', 'ANTHROPIC_API_KEY', 'QUORATE_RUN_ID']) {
    assert.equal(k in env, false, k);
  }
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/home/u');
  assert.equal(env.QUORATE_COUNT_FILE, 'c.txt');
  assert.equal(env.QUORATE_FACTS_FILE, 'f.json');
  assert.equal(env.GRAPH_NODE_DEPTH, '1');
});

// Amended with the plan (G-1 of 20261014-000825-rv-delivery-remediation-2-review; operator: "Own policy, drop git auth
// (Recommended)"): the candidate check no longer equals the commit's environment. It drops everything the commit drops,
// and the commit's git-auth keeps besides (tests/regression-candidate-check-git-auth.test.mjs).
test('the candidate check drops at least every name the commit environment drops', () => {
  const env = candidateCheckEnv(SRC, {}, CTX);
  const commit = commitEnvFor(SRC);
  for (const k of Object.keys(SRC)) if (!(k in commit)) assert.equal(k in env, false, k);
  assert.equal('SSH_AUTH_SOCK' in env, false);
});
