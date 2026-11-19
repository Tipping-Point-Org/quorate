// Which credentials a runtime's child keeps is that runtime adapter's declaration (G-10 of
// 20261103-040939-rbr-remediation-9-review; ARCHITECTURE.md A-9): scrubChildEnv kept a fixed set of one vendor's names,
// so another runtime's secret-shaped credential was deleted before its adapter could act, and that vendor's credentials
// crossed into a child of a different runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubChildEnv, subscriptionProbeEnv } from '../scripts/lib/decisions.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'reviewers.json'), 'utf8'));
const DEFAULT = builtinReviewers()[TABLE.default_node_runtime];
const SHELL = { ANTHROPIC_API_KEY: 'a', CLAUDE_CODE_OAUTH_TOKEN: 'o', OTHER_RUNTIME_API_KEY: 'x', GITHUB_TOKEN: 'g', PATH: '/bin' };

test('G-10: another runtime keeps its own declared auth and not the default vendor\'s', () => {
  const other = { node_runtime: { session_env: { keep_auth: ['Other_Runtime_Api_Key'] } } };
  const { env } = scrubChildEnv(SHELL, { runtime: other });
  assert.equal(env.OTHER_RUNTIME_API_KEY, 'x', 'the runtime\'s own credential was deleted before its adapter could act');
  assert.equal(env.ANTHROPIC_API_KEY, undefined, 'one vendor\'s credential crossed into another runtime\'s child');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.PATH, '/bin');
  const none = scrubChildEnv(SHELL, { runtime: { node_runtime: {} } }).env;
  assert.equal(none.ANTHROPIC_API_KEY, undefined, 'a runtime declaring no auth keeps none');
  assert.throws(() => scrubChildEnv(SHELL, { runtime: null }), /runtime/);
});

test('G-10: the default runtime keeps exactly what it kept, now by its declaration', () => {
  const { env } = scrubChildEnv(SHELL, { runtime: DEFAULT });
  assert.equal(env.ANTHROPIC_API_KEY, 'a');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'o');
  assert.equal(env.OTHER_RUNTIME_API_KEY, undefined);
  const probe = subscriptionProbeEnv(SHELL, { node_runtime: { session_env: { keep_auth: ['OTHER_RUNTIME_API_KEY'] } } }).env;
  assert.equal(probe.OTHER_RUNTIME_API_KEY, 'x', 'the subscription probe scrubbed by the fixed set, not its runtime\'s');
  assert.equal(probe.ANTHROPIC_API_KEY, undefined);
});

test('G-10: every spawner of a runtime child names its runtime to the scrub', () => {
  for (const rel of ['scripts/spawn-node.mjs', 'scripts/spawn-subagent.mjs', 'scripts/bench-second-opinion.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
    assert.doesNotMatch(src, /scrubChildEnv\(process\.env\)/, `${rel} scrubs by the fixed set, not its runtime's declaration`);
  }
});
