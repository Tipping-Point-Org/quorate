// remediation-commit-env.md (operator, 2026-10-11: "Scrub secret names (Recommended)"); G-2 of
// 20261011-144207-commit-recovery-design-r7, ledger scripts/remediate.mjs:170, seen 22 times.
//
// remediate commits each cluster with an environment built by commandEnvFor, whose reason ("a project's own suite may
// need its own keys") is about a REVIEW's captured command. The commit path's children are git and the consumer's
// hooks, and they inherited GITHUB_TOKEN, AWS_* and DATABASE_URL. The commit path now gets the environment with
// secret-shaped names removed, keeping SSH_AUTH_SOCK, a socket path that SSH-agent commit signing needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitEnvFor, commandEnvFor } from '../scripts/lib/decisions.mjs';

const SOURCE = {
  PATH: '/bin', HOME: '/h', GIT_AUTHOR_NAME: 'x', GIT_COMMITTER_EMAIL: 'c@x', GIT_DIR: '.git', SSH_AUTH_SOCK: '/tmp/agent.sock',
  GITHUB_TOKEN: 'ghp', AWS_SECRET_ACCESS_KEY: 'aws', DATABASE_URL: 'pg://', QUORATE_RUN_ID: 'r',
  ANTHROPIC_API_KEY: 'a', CLAUDE_CODE_OAUTH_TOKEN: 'o', ANTHROPIC_AUTH_TOKEN: 't', // the auth token too (G-45 of 20261122-232627-m3s7-b4-review)
};

test('AC1: the commit path drops secret-shaped names, the runtime auth and the run pin; keeps what git needs', () => {
  const env = commitEnvFor(SOURCE);
  for (const k of ['GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL', 'QUORATE_RUN_ID', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN']) {
    assert.equal(k in env, false, `${k} reached the commit's hooks`);
  }
  for (const k of ['PATH', 'HOME', 'GIT_AUTHOR_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_DIR', 'SSH_AUTH_SOCK']) assert.equal(env[k], SOURCE[k], `${k} was lost`);
});

test('AC2: a review\'s captured command keeps its environment, as before', () => {
  const env = commandEnvFor(SOURCE);
  assert.equal(env.GITHUB_TOKEN, 'ghp', 'a project suite may need its own keys; capture is unchanged');
  assert.equal('QUORATE_RUN_ID' in env, false);
});

// G-2 of 20261011-235046-commit-env-review: `_KEY` in the secret-name rule matched GIT_CONFIG_KEY_<n>, so the commit
// environment kept GIT_CONFIG_COUNT and GIT_CONFIG_VALUE_<n> without their keys. Git rejects that broken tuple, and every
// git call of a remediation started with scoped git config failed.
test('scoped git config survives whole: GIT_CONFIG_COUNT with every KEY and VALUE', () => {
  const env = commitEnvFor({ PATH: '/bin', GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'x',
    GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'false' });
  for (const k of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1']) {
    assert.ok(k in env, `${k} was dropped, leaving git a broken config tuple`);
  }
});

// G-8 of the same run: the document that owns the residual still said the hooks get the test command's environment.
test('shared/remediation.md states the hooks\' scrubbed environment, not the test command\'s', async () => {
  const fs = await import('node:fs');
  const doc = fs.readFileSync(new URL('../shared/remediation.md', import.meta.url), 'utf8');
  assert.doesNotMatch(doc, /in the same environment the test command gets/);
  // G-14 of 20261023-205906-ger-delivery: the hooks' environment was named as commitEnvFor, which no production code
  // calls; a commit's git runs in gitEnvFor's, through scripts/io/git.mjs's gitCommitSync.
  assert.match(doc, /in the commit's own environment \(`gitEnvFor` with `commit: true`/);
  assert.doesNotMatch(doc, /commitEnvFor/, 'the document names a function the commit path never calls');
});

// G-1 of 20261012-005825-commit-env-r2 (four nodes): the identity exception kept the whole GIT_AUTHOR_* /
// GIT_COMMITTER_* prefix, so a secret-shaped name under it (GIT_AUTHOR_TOKEN) skipped the scrub. Only the identity
// variables git reads are kept: NAME, EMAIL, DATE.
test('only the identity variables git reads are kept, not every name under their prefix', () => {
  const tokenName = 'GIT_AUTHOR_' + 'TOKEN';
  const env = commitEnvFor({ GIT_AUTHOR_NAME: 'n', GIT_AUTHOR_EMAIL: 'e', GIT_AUTHOR_DATE: 'd',
    GIT_COMMITTER_NAME: 'n', GIT_COMMITTER_EMAIL: 'e', GIT_COMMITTER_DATE: 'd', [tokenName]: 'x' });
  assert.equal(tokenName in env, false, 'a secret-shaped name under the identity prefix reached the hooks');
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE']) {
    assert.ok(k in env, `${k} was lost`);
  }
});
