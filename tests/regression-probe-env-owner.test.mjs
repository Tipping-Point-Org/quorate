// A subscription probe's environment is runtimeSessionEnv's, not a second copy of its stripping policy.
//
// G-8 of 20261031-022756-urr-remediation-review: subscriptionProbeEnv re-declared the four session and credential names
// runtimeSessionEnv owns, so the two could drift; they had already: the probe lacked the working-directory pin every
// Claude child gets from the owner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeSessionEnv, subscriptionProbeEnv } from '../scripts/lib/decisions.mjs';
import { scrubChildEnv } from '../scripts/lib/decisions.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';

// The names are the runtime adapter's (G-11 of 20261103-022403-rbr-remediation-8-review), so both are given the default one.
const RUNTIME = builtinReviewers().claude;

test('G-8: the probe environment is the scrubbed environment through runtimeSessionEnv, at depth 1', () => {
  const src = { PATH: '/bin', CLAUDECODE: '1', Claude_Code_Entrypoint: 'x', Anthropic_Api_Key: 'k', ANTHROPIC_AUTH_TOKEN: 't',
    CLAUDE_CODE_OAUTH_TOKEN: 'o', KEEP: 'v', GRAPH_NODE_DEPTH: '0' };
  const owner = runtimeSessionEnv(scrubChildEnv(src).env, { authMode: 'subscription', runtime: RUNTIME });
  const probe = subscriptionProbeEnv(src, RUNTIME);
  assert.deepEqual(probe.env, { ...owner.env, GRAPH_NODE_DEPTH: '1' });
  for (const k of owner.stripped) assert.ok(probe.stripped.includes(k), `${k} is not reported as stripped`);
});
