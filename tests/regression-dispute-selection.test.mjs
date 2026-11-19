// THREE WAYS THE ADJUDICATION PHASE TOLD A READER SOMETHING THAT WAS NOT SO.
//
// G-28 (contract-audit against I-1). Adjudication is for a group where a LENS and an EXTERNAL ARM
// contradict each other. The selection was one boolean from the reconciler MODEL — `g.disputed ===
// true` — with no check that the group has two sides, although every finding carries `source`. I-1
// names both failures by name: a lens-vs-lens disagreement routed to judges, and a single-sided
// finding sent to them. A mis-flagged group reached every judge with a vocabulary of one position
// plus `neither`: a vote with nothing to decide between, billed per judge.
//
// G-38 (code-audit). The render loop walks the selected groups and reported every missing merge as
// "the run was interrupted before this group was reached" — but the preparation loop skips any group
// whose id is unusable, so a REJECTED ID was reported as an interruption, a cause the operator
// cannot act on. It also wrote the unvalidated model-supplied group_id straight into a heading.
//
// G-8 (code-audit). check-tiebreak exited 0 as soon as one judge ruled, so a two-vendor panel with a
// broken second vendor printed "the tie-break path round-tripped" and returned success — the exact
// case the file's own header says it exists to catch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { isGroupId, GROUP_ID_RE } from '../scripts/lib/decisions.mjs';
import { disputeComposition } from '../scripts/lib/adjudication.mjs';

const GRAPH = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');

// THE FIXTURES IN THIS TEST WERE WRONG, AND THAT IS WHY THE GATE SHIPPED.
//
// The first version of this file asserted a two-sidedness predicate against groups it invented:
// `{node_id, source: null}` for a lens and `{node_id, source: 'codex'}` for an arm. Both are shapes
// the engine never produces. The real data, from the consumer-mount run that exposed it:
//
//   reconcile payload group   {group_id, decision, severity, disputed, rationale}  — NO findings
//   finding-groups finding    {node_id: 'arch-review',     source: 'opus'}         — a LENS
//   finding-groups finding    {node_id: 'panel-codex-ui',  source: 'codex'}        — an ARM
//
// So the predicate read an empty array for every group and rejected all five disputes, and `source`
// never distinguishes the two sides because both have one. A test built from invented fixtures cannot
// fail for the reason the code is wrong — it agrees with whatever the author believed.
//
// Worse than either, and the reason there is no gate now rather than a corrected one: G-42 carried ONE
// finding, from an arm, and the opposing position was ui-audit's CHECKED_CLEAN entry. An arm says
// broken, a lens says clean. A clean claim is not a finding, so any findings-based check refuses
// exactly the disagreements most worth a third family.
// The arm ids this fixture's groups came from, as lens-roster.json declares them.
const ARM_IDS = ['panel-codex-ui', 'panel-codex-arch', 'panel-codex-contract',
  'panel-codex-perf', 'panel-codex-security', 'panel-codex-code', 'panel-codex-docs'];
const REAL_PAYLOAD_GROUP = {
  group_id: 'G-42', decision: 'confirmed', severity: 'LOW', disputed: true,
  rationale: 'Dispute. The codex UI arm says a failed status poll returns without deleting the item…',
};
const REAL_FINDING_GROUPS = {
  'G-42': { findings: [{ node_id: 'panel-codex-ui', source: 'codex' }] },
  'G-51': {
    findings: [
      { node_id: 'panel-codex-arch', source: 'codex' },
      { node_id: 'panel-codex-contract', source: 'codex' },
      { node_id: 'arch-review', source: 'opus' },
    ],
  },
  'G-72': {
    findings: [
      { node_id: 'panel-codex-perf', source: 'codex' },
      { node_id: 'panel-codex-security', source: 'codex' },
    ],
  },
};

test('regression: the reconciler decides a dispute exists, and no script overrides it', () => {
  // The selection is the model's flag, full stop. The doctrine says why: "a script cannot tell a
  // contradiction from a coincidence".
  assert.match(GRAPH, /const disputed = flagged;/,
    'a script-side gate silenced every dispute in a live run and would refuse arm-vs-clean-claim ones');
  assert.ok(!/const disputed = flagged\.filter\(twoSided\)/.test(GRAPH), 'the gate must stay reverted');
  // Whitespace-tolerant: the sentence is wrapped across a comment line break in the source, and
  // asserting the wrapping instead of the sentence is a brittleness this suite has hit repeatedly.
  assert.match(GRAPH.replace(/\s*\/\/\s*/g, ' ').replace(/\s+/g, ' '),
    /a script cannot tell a contradiction from a coincidence/,
    'the reason must travel with the code, or the next reader re-adds the gate');

  // THE PAYLOAD SHAPE THAT MADE THE GATE VACUOUS, asserted so nobody builds on findings again.
  assert.equal(REAL_PAYLOAD_GROUP.findings, undefined,
    'a reconcile payload group has no findings array — anything reading one reads nothing');
  // ...and both sides carry a source, so "no source" identifies neither.
  const all = Object.values(REAL_FINDING_GROUPS).flatMap((g) => g.findings);
  assert.ok(all.every((f) => f.source), 'every finding has a source: it is the model family, not the role');
});

test('composition is REPORTED per group, from config rather than the node-id convention', () => {
  // The half of G-28 that was worth keeping: a reader can tell a cross-family dispute from an arm-only
  // one. It reaches the artifact and decides nothing.
  assert.match(GRAPH, /const ARM_IDS = panelArmsFor\(\)\.map\(\(a\) => a\.id\);/,
    'declared arm ids, because the `panel-` prefix is a convention lens-roster.json can change');
  assert.match(GRAPH, /findings: groupsById\[group_id\]\?\.findings \?\? \[\]/,
    'read from finding-groups, which HAS findings, not from the payload, which does not');
  assert.match(GRAPH, /composition: disputeComposition\(\{/, 'and it lands in the artifact');

  // A PURE FUNCTION OF ITS ARGUMENTS. The first version was a closure reading `groupsById` from an
  // enclosing scope — declared in a NESTED block, so the name resolved nowhere and the artifact write
  // threw ReferenceError AFTER all ten judges had ruled. Third occurrence of that class in this phase.
  // A function whose inputs arrive as parameters cannot have the bug: a missing argument is a value to
  // handle, not a name that might resolve.
  assert.deepEqual(
    disputeComposition({ findings: REAL_FINDING_GROUPS['G-51'].findings, armIds: [...ARM_IDS] }),
    { positions: ['panel-codex-arch', 'panel-codex-contract', 'arch-review'],
      arms: ['panel-codex-arch', 'panel-codex-contract'],
      non_arms: ['arch-review'] });
  assert.deepEqual(disputeComposition(), { positions: [], arms: [], non_arms: [] },
    'called with nothing it reports nothing, rather than throwing inside a catch-free artifact write');

  // The rule applied to the three real shapes, through the OWNER rather than a second copy of its
  // logic — a reimplementation here would agree with itself and prove nothing about the engine.
  const compose = (id) =>
    disputeComposition({ findings: REAL_FINDING_GROUPS[id].findings, armIds: ARM_IDS });
  assert.deepEqual(compose('G-42'),
    { positions: ['panel-codex-ui'], arms: ['panel-codex-ui'], non_arms: [] },
    'one arm finding, opposed by a lens CLEAN CLAIM that lives in no findings array');
  assert.deepEqual(compose('G-51').non_arms, ['arch-review'], 'a genuine lens-versus-arm dispute');
  assert.deepEqual(compose('G-72').non_arms, [], 'two arms of one family disagreeing — visible, still judged');
});

test('regression: a group rejected for its id is not reported as an interruption', () => {
  assert.match(GRAPH, /const named = isGroupId\(g\.group_id\);/,
    'the renderer must ask the same question the preparation loop asked');
  assert.match(GRAPH, /its group id was rejected before any judge was asked/,
    'the two reasons a group has no merge are different and the operator can only act on the true one');
  // The heading may not carry an unvalidated model-supplied value.
  assert.match(GRAPH, /unusable group id \$\{JSON\.stringify\(String\(g\.group_id\)\)/);
  assert.ok(!/rulings\.push\(`### \$\{g\.group_id\}`/.test(GRAPH),
    'the raw payload value must not be interpolated into a markdown heading');
});

test('the group-id shape has one owner, and it is the one the schema pins', () => {
  // Typed three times before: envelope schema, runtime re-validation, renderer.
  for (const ok of ['G-1', 'G-17', 'G-999']) assert.equal(isGroupId(ok), true, ok);
  for (const bad of ['g-1', 'G-1000', 'G-', 'G-1/x', '', null, undefined, 17, 'G-01x']) {
    assert.equal(isGroupId(bad), false, `${JSON.stringify(bad)} must be refused`);
  }
  assert.ok(!/\/\^G-\[0-9\]\{1,3\}\$\//.test(GRAPH.replace(/^\s*\/\/.*$/gm, '')),
    'run-graph must not carry its own copy of the pattern');
  assert.equal(GROUP_ID_RE.source, '^G-[0-9]{1,3}$');
});

// G-8 MOVED with check-tiebreak.mjs's retirement (reviewer-preflight stage 4): check-reviewers checks every judge and
// exits 1 when any combination fails — held by regression-reviewer-preflight, "check-reviewers checks every roster
// combination, and exits 0 only when all of them pass", where agy fails while codex passes. Behaviour, not source text.
