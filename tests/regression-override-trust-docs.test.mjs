// reviewer-credential-routing.plan.md stage 4 (D1 = A): the trust decision written down once, and every
// document a reader of an override meets pointing at it.
//
// - ARCHITECTURE.md A-26 owns it, the node-runtime case and the flip condition included; capture.mjs cited
//   disk-first-protocol.md §3 for a flip condition §3 does not state.
// - candidate-pool and /request read external-review's record, but the operator reads the pool and the
//   critique record: each relays `reviewer_override` (plan-review round 8). candidate-pool restated the
//   proposal shape, a second copy that would go stale; it points at the contract row instead.
// - The contract document names the gate field, the response field and new-run's mint line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

test('A-26 owns the trust decision, the node-runtime case and the flip condition', () => {
  const arch = read('ARCHITECTURE.md');
  const at = arch.indexOf('### A-26');
  assert.ok(at > -1, 'ARCHITECTURE.md has no A-26');
  const body = arch.slice(at, arch.indexOf('\n## ', at));
  assert.ok(arch.lastIndexOf('## 4.', at) > arch.lastIndexOf('## 5.', at), 'A-26 belongs to §4, the third-party boundary');
  assert.match(body, /CHILD_ENV_KEEP/, 'the node runtime has no allow-list; A-26 says what crosses instead');
  assert.match(body, /untrusted source/i, 'the flip condition is stated in the rule, not only in a comment');
});

test('capture.mjs cites A-26 for its flip condition', () => {
  const src = read('scripts/capture.mjs');
  assert.match(src, /ARCHITECTURE\.md A-26/);
  assert.doesNotMatch(src, /recorded in shared\/disk-first-protocol\.md §3 rather than only here/);
});

test('candidate-pool relays the override into the pool, and points at the one copy of the proposal shape', () => {
  const s = read('skills/candidate-pool/SKILL.md');
  assert.match(s, /reviewer_override/);
  assert.doesNotMatch(s, /returns `\{schema_version, source, model, effort, candidates,/, 'a restated shape goes stale');
});

test('/request records the override beside the critique model', () => {
  assert.match(read('skills/request/SKILL.md'), /reviewer_override/);
});

test('the contract document names the gate field, the response field and the mint line', () => {
  const c = read('shared/claude-md-contract.md');
  assert.match(c, /reviewer_overrides/);
  assert.match(c, /reviewer_override: \{name, roles, fields, prefixes\}/);
  assert.match(c, /`scripts\/new-run\.mjs` \(every mint\)/);
  assert.match(c, /Overriding the node runtime \(`claude`\)/);
});
