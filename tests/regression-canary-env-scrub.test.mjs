// G-28 (arch-review + security-audit, cross-confirmed): new-run's canaryEnv() built the sandbox
// canary's environment as {...process.env} minus four fixed names and never called scrubChildEnv —
// the single owner of what an agentic `claude` child may inherit, which spawn-node applies to every
// lens for exactly this reason. The canary is an agentic `claude -p` spawned BY DEFAULT on every
// run, before any lens exists, so the operator's whole secret-bearing shell crossed into it. Its
// own comment claimed it was "kept deliberately parallel to spawn-node.mjs's block"; it mirrored
// only the second half.
//
// The finding also recorded that NO test in tests/ mentioned scrubChildEnv or canaryEnv at all.
// This is that test. On the machine where the fix landed, sandbox-canary.json's env_stripped
// listed 15 real secrets — GITHUB_TOKEN, DATABASE_URL, JIRA_API_KEY, HF_TOKEN among them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scrubChildEnv } from '../scripts/lib/decisions.mjs';
import { REPO_ROOT } from './helpers.mjs';

test('regression: scrubChildEnv strips the secrets that were really crossing into the canary', () => {
  // These are the names actually observed in env_stripped when the fix first ran.
  const shell = {
    PATH: '/usr/bin', HOME: '/home/x',
    ['GITHUB_' + 'TOKEN']: 'ghp_x', DATABASE_URL: 'postgres://x', JIRA_API_KEY: 'j',
    LINEAR_API_KEY: 'l', HF_TOKEN: 'hf', GEMINI_API_KEY: 'g', AWS_SECRET_ACCESS_KEY: 'a',
    SIGNING_KEY: 's', MY_PASSWORD: 'p', SOME_CREDENTIAL: 'c',
    ['CLAUDE_CODE_OAUTH_' + 'TOKEN']: 'oauth',
  };
  const { env, scrubbed } = scrubChildEnv(shell);
  for (const secret of [
    'GITHUB_TOKEN', 'DATABASE_URL', 'JIRA_API_KEY', 'LINEAR_API_KEY', 'HF_TOKEN',
    'GEMINI_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'SIGNING_KEY', 'MY_PASSWORD', 'SOME_CREDENTIAL',
  ]) {
    assert.equal(secret in env, false, `${secret} must not cross into an agentic child`);
    assert.ok(scrubbed.includes(secret), `${secret} must be RECORDED as stripped, not silently dropped`);
  }
  // The vendor's own auth must survive or the child cannot authenticate at all.
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'oauth', 'subscription auth is deliberately kept');
  assert.equal(env.PATH, '/usr/bin', 'execution basics cross');
  // G-9 of 20261023-214545-ger-remediation-review: the keep-set was matched case-sensitively against a case-insensitive
  // secret test, so Windows' stored spelling of the runtime's own auth was stripped and the child could not authenticate.
  const folded = scrubChildEnv({ ['Claude_Code_OAuth_' + 'Token']: 'oauth', Anthropic_Api_Key: 'k', Github_Token: 'g' });
  assert.equal(folded.env.Claude_Code_OAuth_Token, 'oauth', 'the runtime auth is kept whatever its stored case');
  assert.equal(folded.env.Anthropic_Api_Key, 'k', 'the runtime auth is kept whatever its stored case');
  assert.equal('Github_Token' in folded.env, false, 'an unrelated secret is still stripped');
});

test('regression: canaryEnv routes through the single owner instead of re-implementing a deny-list', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function canaryEnv()'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  // Retargeted (G-24 of 20261001-034021-cgg-remediation-review): the canary's surgery moved into subscriptionProbeEnv,
  // shared with check-intent-grant, which delegates to scrubChildEnv — asserted on its behaviour in
  // regression-cgg-r2-remediation.test.mjs. The claim is unchanged: the canary routes through the one owner.
  // With the runtime it spawns, whose adapter names the session variables (G-11 of 20261103-022403-rbr-remediation-8-review).
  assert.match(body, /subscriptionProbeEnv\(process\.env, NODE_RUNTIME\)/,
    'canaryEnv must delegate to the one owner of agentic-child scrubbing');
  assert.match(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'decisions.mjs'), 'utf8'),
    // With its runtime, whose adapter names the auth its child keeps (G-10 of 20261103-040939-rbr-remediation-9-review).
    /export function subscriptionProbeEnv\(sourceEnv, runtime\) \{\n\s*const \{ env: scrubbed, scrubbed: stripped \} = scrubChildEnv\(sourceEnv, \{ runtime \}\);/,
    'subscriptionProbeEnv must scrub through scrubChildEnv');
  assert.doesNotMatch(body, /\{\s*\.\.\.process\.env/,
    'canaryEnv must not spread the raw process.env — that is the defect returning');
  // The crossing must be attributable in the artifacts, as spawn-node does with status.env_stripped.
  assert.match(src, /env_stripped: canaryStripped/,
    'sandbox-canary.json must record what was stripped from the canary child');
});
