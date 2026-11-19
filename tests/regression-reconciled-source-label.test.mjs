// I-2's I/O contract requires that finding-groups.json AND reconciled.md label every finding with
// its source. Carrying source through the grouping projection (G-43) fixed the first half only:
// the renderer printed node_id, claim and evidence_path, so the REPORT a human reads — and the one
// remediate consumes as its work list — still showed no family at all.
//
// That matters because the whole point of the panel is that cross-family agreement outweighs two
// same-family lenses agreeing. A reader of reconciled.md could not tell which of those they were
// looking at, so the property the panel exists to provide was invisible in the artifact that
// presents it. The node-id prefix ("panel-") is a convention, not a label.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { renderGroupFinding } from '../scripts/lib/reconcile-diff.mjs';

test('regression: a rendered finding names the family that raised it', () => {
  const line = renderGroupFinding({
    node_id: 'panel-codex-security', source: 'codex',
    claim: 'the probe leaks the operator environment', evidence_path: 'evidence/x/raw.log',
  });
  assert.match(line, /codex/, 'the family must be visible in the report, not inferred from a node-id prefix');
  assert.match(line, /panel-codex-security/);
  assert.match(line, /the probe leaks the operator environment/);
  assert.match(line, /evidence\/x\/raw\.log/);
});

test('a Claude lens finding is labelled with its model family too', () => {
  // Without this half, "unlabelled" would silently come to mean "internal", which is an inference
  // the reader should not have to make.
  const line = renderGroupFinding({
    node_id: 'security-audit', source: 'opus', claim: 'c', evidence_path: 'e',
  });
  assert.match(line, /opus/);
});

test('a finding with no recorded source says so rather than implying a family', () => {
  const line = renderGroupFinding({ node_id: 'code-audit', claim: 'c', evidence_path: 'e' });
  assert.match(line, /code-audit/);
  assert.doesNotMatch(line, /opus|codex|agy/, 'absent provenance must not be rendered as a family');
});

// THE ADJUDICATION WAS NEVER CHECKED AGAINST ITS OWN INPUT (G-46, panel-codex-code).
//
// The schema constrains each row's SHAPE and says nothing about the SET, so a reconcile payload
// that omitted half the groups, repeated one, or invented an id validated cleanly — and
// reconciled.md, which is remediate's work list, was rendered from it while the barrier stayed OK.
// A finding that reaches the reconciler and leaves no row in its output has been dropped by
// silence, the one outcome this system exists to refuse.
test('a reconcile payload that does not cover its groups is reported, not accepted', () => {
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const block = graph.slice(graph.indexOf('const judged = (p.groups ?? [])'), graph.indexOf("const L = ['# Reconciled'"));

  for (const [what, needle] of [
    ['omissions', /never adjudicated/],
    ['duplicates', /adjudicated more than once/],
    ['unknown ids', /name no group this run produced/],
  ]) {
    assert.match(block, needle, `${what} must be named, or the adjudication can shrink silently`);
  }
  assert.match(block, /buckets\.not_checked\.push/,
    'the gap belongs in not_checked[], where the gate prints it');

  // NOT a die(): the adjudication that DID happen is worth keeping, and killing the render would
  // discard every judged group to punish the missing ones.
  assert.ok(!/die\(/.test(block), 'refusing to render discards the judgments that did arrive');

  // The set arithmetic itself, so this is not only a source-shape assertion.
  const groups = ['G-1', 'G-2', 'G-3'];
  const payload = ['G-1', 'G-1', 'G-9'];
  const seen = new Map();
  for (const id of payload) seen.set(id, (seen.get(id) ?? 0) + 1);
  assert.deepEqual(groups.filter((id) => !seen.has(id)), ['G-2', 'G-3']);
  assert.deepEqual([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id), ['G-1']);
  assert.deepEqual([...seen.keys()].filter((id) => !groups.includes(id)), ['G-9']);
});
