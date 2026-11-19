// The node runtime's session environment is the adapter's declaration (G-11 of 20261103-022403-rbr-remediation-8-review;
// ARCHITECTURE.md A-9): runtimeSessionEnv, a generically named owner in the pure decision layer, hardcoded CLAUDECODE,
// CLAUDE_CODE_ENTRYPOINT, ANTHROPIC_* and CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR, so a second node runtime inherited one
// vendor's authentication handling or needed an edit here. The names now come from the adapter's
// node_runtime.session_env, and a runtime declaring none gets none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeSessionEnv, subscriptionProbeEnv } from '../scripts/lib/decisions.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'reviewers.json'), 'utf8'));
const CLAUDE = builtinReviewers()[TABLE.default_node_runtime];
assert.ok(CLAUDE?.node_runtime, 'precondition: the default node runtime is in the adapter table');

test('G-11: lib/decisions.mjs names no vendor environment variable', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'decisions.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export function runtimeSessionEnv'), src.indexOf('export function runtimeSessionEnv') + 1500);
  assert.doesNotMatch(body, /CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|ANTHROPIC_|CLAUDE_BASH_MAINTAIN/, 'runtimeSessionEnv hardcodes a vendor\'s variables');
});

test('G-11: a runtime declaring no session environment strips and sets nothing', () => {
  const other = { cmd: 'other', node_runtime: {} };
  const src = { CLAUDECODE: '1', ANTHROPIC_API_KEY: 'k', KEEP: 'x' };
  const { env, stripped } = runtimeSessionEnv(src, { authMode: 'subscription', runtime: other });
  assert.deepEqual(env, src, 'another runtime inherited one vendor\'s environment handling');
  assert.deepEqual(stripped, []);
});

test('G-11 (guard): the default runtime\'s declaration keeps the behaviour, in any case', () => {
  const src = { CLAUDECODE: '1', Claude_Code_Entrypoint: 'cli', Anthropic_Api_Key: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o', KEEP: 'x' };
  const sub = runtimeSessionEnv(src, { authMode: 'subscription', runtime: CLAUDE });
  assert.deepEqual(Object.keys(sub.env).sort(), ['CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'KEEP']);
  assert.equal(sub.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR, '1');
  const api = runtimeSessionEnv(src, { authMode: 'api', runtime: CLAUDE });
  assert.equal(api.env.Anthropic_Api_Key, 'k', 'API credentials are stripped only under subscription');
  assert.equal('CLAUDECODE' in api.env, false);
  const probe = subscriptionProbeEnv({ ANTHROPIC_API_KEY: 'k', PATH: 'p' }, CLAUDE);
  assert.equal('ANTHROPIC_API_KEY' in probe.env, false);
  assert.equal(probe.env.GRAPH_NODE_DEPTH, '1');
});

test('G-11 (guard): an owner given no runtime refuses rather than stripping nothing', () => {
  assert.throws(() => runtimeSessionEnv({}, { authMode: 'subscription' }), /runtime/);
});
