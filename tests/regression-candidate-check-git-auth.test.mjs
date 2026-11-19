// G-1 of 20261014-000825-rv-delivery-remediation-2-review: candidateCheckEnv delegated to commitEnvFor, which keeps
// SSH_AUTH_SOCK and the scoped GIT_CONFIG tuple because git needs them to COMMIT. The candidate check runs tests the
// remediator wrote, so that code reached the operator's SSH agent and any credential in a GIT_CONFIG_VALUE_<n> (an
// http.extraheader). The plan was amended (remediation-verification.plan.md stage 4; operator, 2026-10-14: "Own policy,
// drop git auth (Recommended)"): the candidate check has a policy of its own that drops them and keeps the git identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateCheckEnv } from '../scripts/lib/full-check.mjs';
// The platform context the runner supplies (candidate-check-boundaries.plan.md stage 2): an allow-list now.
const CTX = { basics: ['PATH', 'HOME'], declared: [], caseInsensitiveEnv: false };

const SRC = {
  PATH: '/bin', SSH_AUTH_SOCK: '/tmp/agent.sock', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraheader',
  GIT_CONFIG_VALUE_0: 'AUTHORIZATION: bearer x', GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_AUTHOR_DATE: 'd',
  GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@x', GIT_COMMITTER_DATE: 'd2', GITHUB_TOKEN: 'g',
};

test('the candidate check drops what git needs only to commit: the SSH agent and the scoped config tuple', () => {
  const env = candidateCheckEnv(SRC, {}, CTX);
  for (const k of ['SSH_AUTH_SOCK', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GITHUB_TOKEN']) {
    assert.equal(k in env, false, `${k} reached code the remediator wrote`);
  }
});

test('the candidate check keeps the git identity and the ordinary environment', () => {
  const env = candidateCheckEnv(SRC, {}, CTX);
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE', 'PATH']) {
    assert.equal(env[k], SRC[k], k);
  }
  assert.equal(env.GRAPH_NODE_DEPTH, '1');
});
