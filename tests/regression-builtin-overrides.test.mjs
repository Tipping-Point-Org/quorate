// reviewer-credential-routing.plan.md stage 1 (D1 = A, operator 2026-10-10: "A: decline, make visible
// (Recommended)"). A contract entry that merges over a built-in adapter keeps that vendor's credentials
// (G-29), so changing its `cmd` or argv changes where they go. Nothing said so. These two pure functions
// are the one answer every path uses to name it: which built-ins the contract overrides, which fields,
// and what reaches the overridden binary.
//
// A node runtime has no allow-list, so it carries no prefixes: spawn-node gives a node the scrubbed
// environment (scrubChildEnv), which keeps the runtime's own auth (CHILD_ENV_KEEP). Its line says that,
// and says "node", not "lens": the remediation node runs on it too (plan-review rounds 9 and 11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinOverrides, overrideLine } from '../scripts/lib/reviewers.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';

const BUILTIN = {
  codex: { cmd: 'codex', roles: ['reviewer'], env_prefixes: ['CODEX_', 'OPENAI_'] },
  agy: { cmd: 'agy', roles: ['reviewer'], env_prefixes: ['AGY_'] },
  claude: { cmd: 'claude', roles: ['node'], env_prefixes: ['ANTHROPIC_', 'CLAUDE_'] },
};

test('an entry over a built-in reviewer is an override: its fields, sorted, and the prefixes it keeps', () => {
  const o = builtinOverrides(BUILTIN, { codex: { cmd: '/opt/other', base_argv: ['x'] } });
  assert.deepEqual(o, [{ name: 'codex', roles: ['reviewer'], fields: ['base_argv', 'cmd'], prefixes: ['CODEX_', 'OPENAI_'] }]);
});

test('a refused env_prefixes is not a field the override sets', () => {
  const o = builtinOverrides(BUILTIN, { agy: { env_prefixes: ['AWS_'], model_flag: '--m' } });
  assert.deepEqual(o.map((x) => x.fields), [['model_flag']]);
  assert.deepEqual(builtinOverrides(BUILTIN, { agy: { env_prefixes: ['AWS_'] } }), []);
});

test('a new name is not an override, and an empty entry overrides nothing', () => {
  assert.deepEqual(builtinOverrides(BUILTIN, { mine: { cmd: 'mine' }, codex: {} }), []);
  assert.deepEqual(builtinOverrides(BUILTIN, undefined), []);
  assert.deepEqual(builtinOverrides(BUILTIN, { codex: null }), []);
});

test('a node runtime override carries no prefixes: spawn-node does not read them', () => {
  const [o] = builtinOverrides(BUILTIN, { claude: { cmd: 'other-cli' } });
  assert.deepEqual(o, { name: 'claude', roles: ['node'], fields: ['cmd'], prefixes: [] });
});

test('the reviewer line names the fields and where the vendor credentials go', () => {
  const [o] = builtinOverrides(BUILTIN, { codex: { cmd: '/opt/other', base_argv: ['x'] } });
  assert.equal(overrideLine(o), 'codex — base_argv, cmd set by the contract; CODEX_*, OPENAI_* go to it');
});

test('the node-runtime line says every NODE gets the scrubbed environment, its auth included', () => {
  const [o] = builtinOverrides(BUILTIN, { claude: { cmd: 'other-cli' } });
  const line = overrideLine(o);
  assert.equal(line, "claude (node runtime) — cmd set by the contract; every node spawned on this runtime gets the scrubbed environment, the runtime's own auth included");
  assert.doesNotMatch(line, /lens/);
});

test('every built-in in reviewers.json is covered, each worded by its role', () => {
  const builtin = builtinReviewers();
  const declared = Object.fromEntries(Object.keys(builtin).map((n) => [n, { cmd: 'elsewhere' }]));
  const overrides = builtinOverrides(builtin, declared);
  assert.deepEqual(overrides.map((o) => o.name).sort(), Object.keys(builtin).sort());
  for (const o of overrides) {
    const line = overrideLine(o);
    if (o.roles.includes('node')) assert.match(line, /\(node runtime\).*every node spawned/);
    else assert.match(line, / go to it$/);
  }
});
