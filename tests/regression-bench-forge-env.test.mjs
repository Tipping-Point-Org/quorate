// The bench's forge builds its Claude-session environment through the owner (G-4 of 20261031-013928-urr-delivery).
//
// forgeRationale deleted a local list of four names (CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ANTHROPIC_API_KEY,
// ANTHROPIC_AUTH_TOKEN) from its child's environment: the policy runtimeSessionEnv owns for spawn-node and spawn-subagent,
// restated with the provider's names in a script, and already behind it — matched by exact case, `Anthropic_Api_Key`
// crossed on Windows, the G-4 of 20260930-153323 that the owner fixed. The owner's own behaviour is tested beside it
// (runtimeSessionEnv); this holds the forge to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { runtimeSessionEnv } from '../scripts/lib/decisions.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';

const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

test('G-4 of 20261031-013928-urr-delivery: the forge names no session or credential variable of its own', () => {
  const src = code(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-second-opinion.mjs'), 'utf8'));
  for (const name of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
    assert.doesNotMatch(src, new RegExp(`['"\`]${name}['"\`]`), `bench-second-opinion.mjs lists ${name} itself`);
  }
  // With the forge's own runtime, whose adapter names the variables (G-11 of 20261103-022403-rbr-remediation-8-review).
  assert.match(src, /runtimeSessionEnv\(\s*scrubbed\s*,\s*\{\s*authMode:\s*'subscription',\s*runtime:\s*FORGE_RUNTIME\s*\}\s*\)/, 'the forge does not ask runtimeSessionEnv for its runtime');
});

// G-18 of 20261031-022756-urr-remediation-review: the test above matched the call only, so it passed with the owner's
// answer unused and the unsanitised environment sent to the forge. The answer must be what the forge's spawn receives.
test('G-18: the environment runtimeSessionEnv returns is the one the forge spawn is given', () => {
  const src = code(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-second-opinion.mjs'), 'utf8'));
  const call = src.match(/const \{ env: (\w+) \} = runtimeSessionEnv\(\s*scrubbed\s*,\s*\{\s*authMode:\s*'subscription',\s*runtime:\s*FORGE_RUNTIME\s*\}\s*\);/);
  assert.ok(call, 'the owner\'s answer is not bound');
  const child = src.match(new RegExp(`const (\\w+) = \\{ \\.\\.\\.${call[1]}, GRAPH_NODE_DEPTH: `));
  assert.ok(child, `the forge's environment is not built from ${call[1]}`);
  // Through io/forge-spawn.mjs since decision-panel-seats.plan.md stage 2, which renders the argv with nodeArgv.
  const spawn = src.match(/await spawnForge\(\{([^}]*)\}\)/);
  assert.ok(spawn, 'the forge spawn was not found');
  assert.match(spawn[1], new RegExp(`\\benv: ${child[1]}\\b`), 'the forge spawn is not given the owner\'s environment');
  assert.doesNotMatch(src, new RegExp(`\\b${child[1]}\\s*=(?!=)[^;]*;[\\s\\S]*\\b${child[1]}\\s*=(?!=)`), `${child[1]} is reassigned after it is built`);
});

test('the owner the forge asks strips the session marks and the API credentials in any case', () => {
  const { env } = runtimeSessionEnv({ CLAUDECODE: '1', Claude_Code_Entrypoint: 'x', Anthropic_Api_Key: 'k', ANTHROPIC_AUTH_TOKEN: 't', KEEP: 'v' },
    { authMode: 'subscription', runtime: builtinReviewers().claude });
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR', 'KEEP']);
});
