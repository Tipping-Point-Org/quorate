// THE REMEDIATE SANDBOX (remediate-rebuild.plan.md stage 3; design decision 9). A remediator must edit source and tests
// without bypassPermissions, so its policy grants Edit/Write scoped to the contract's source_globs and test_globs, and
// no commit path at all (remediation-paths: the runner commits after the node exits) — no direct git grant, because a rule matches the command string by
// prefix and `git commit` would admit `--no-verify` and `--amend` (plan-review round 2).
//
// MEASURED, not assumed (evidence: .claude/reviews/20261008-210000-remediate-rebuild-impl/evidence/stage3-edit-scope-probe,
// Claude Code 2.1.290, Windows): RELATIVE rules (`Edit(src/**)`) scope writes and edits to the glob, resolved against the
// node's working directory; ABSOLUTE rules (`Edit(/C:/.../src/**)`) grant nothing — as Read(/F:\...) did before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { denyToolsFor } from '../scripts/lib/decisions.mjs';
import { pathRules } from '../scripts/lib/capabilities.mjs';
import { builtinReviewers, rawTable } from '../scripts/io/reviewers.mjs';

const RUNTIME = builtinReviewers()[rawTable().default_node_runtime];

test('a remediate node is denied everything a lens is, except the edit tools', () => {
  const lens = denyToolsFor('node', RUNTIME);
  const rem = denyToolsFor('remediate', RUNTIME);
  const edit = RUNTIME.node_runtime.tools.edit_tools;
  assert.ok(Array.isArray(edit) && edit.length, 'the runtime declares which tools edit');
  for (const t of edit) assert.ok(!rem.includes(t), `${t} is not denied to a remediator`);
  // A remediator is not a lens: the lens's content-tool denial (G-7 of 20261105-212751-sogsr-delivery, G-17's B, decided
  // for lenses) is not its, so it keeps what it had.
  const content = RUNTIME.node_runtime.grants?.content_tools ?? RUNTIME.node_runtime.tools?.content_tools ?? [];
  for (const t of lens.filter((x) => !edit.includes(x) && !content.includes(x))) assert.ok(rem.includes(t), `${t} stays denied`);
});

test('path rules are relative, one per edit tool and glob, and refuse absolute or escaping globs', () => {
  const { rules, refused } = pathRules(RUNTIME, ['src/**', 'tests/**', '/abs/**', '../up/**', 'C:/x/**']);
  for (const t of RUNTIME.node_runtime.tools.edit_tools) {
    assert.ok(rules.includes(`${t}(src/**)`), `${t}(src/**)`);
    assert.ok(rules.includes(`${t}(tests/**)`), `${t}(tests/**)`);
  }
  assert.ok(!rules.some((r) => /abs|up|C:/.test(r)), `no absolute or escaping rule: ${rules}`);
  assert.deepEqual([...refused].sort(), ['../up/**', '/abs/**', 'C:/x/**'].sort());
});
