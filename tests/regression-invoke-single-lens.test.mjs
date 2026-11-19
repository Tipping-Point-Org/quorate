// A NARROWED FAN-OUT REACHED THE GATE SAYING NOTHING, AND A TYPO COULD REACH IT.
//
// Implements .claude/requests/invoke-single-lens-review.md, and the defect it had to fix first.
//
// `--only` filters lenses by string equality. Measured on this repository before the fix:
//
//     node scripts/run-graph.mjs --run-dir <…> --only ui-audit      # ui.surface: none
//     # Gate — PASS · every node reported          $0, zero lenses spawned
//
//     node scripts/run-graph.mjs --run-dir <…> --only arch-reveiw   # a transposition
//     # Gate — PASS · every node reported          $0, zero lenses spawned
//
// Every part was individually defensible. `required` is false for a lens nobody asked to run, so
// `did_not_report` is empty, so completeness reads "every node reported". The composite was a clean
// bill of health for a review that did not happen — in the project whose one rule is that silence is
// not a verdict — and the second form reached it from a keystroke.
//
// The flag was an expert's escape hatch when that was written. /invoke makes it the common path,
// which is what turns a sharp edge into a trap, and is why this had to be fixed before the skill
// could be honest.
//
// WHY THE STAMP DOES NOT CAP. Three precedents are exact: UNSWEPT-DIFF, UNCAPPED-BUDGET and
// CONTRACT-PARTIAL are all declared operator choices that permit PASS and print their provenance.
// The operator ruled on this directly when rejecting a cap on /invoke — "the cap exists for
// reviewers that CANNOT produce a verifiable evidence path. A lens with a run directory can, so
// there is nothing to cap." What the stamp buys is the headline: `Gate — PASS` says the code passed
// a review, `Gate — PASS · fan-out narrowed to arch-review` says which one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, REPO_ROOT } from './helpers.mjs';
import { armsForSelection, adjudicationEnabled } from '../scripts/lib/capabilities.mjs';
import {
  CAPPING_STAMPS, stampCaps, FAN_OUT_NARROWED_STAMP, narrowedFanOut,
} from '../scripts/lib/decisions.mjs';

const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
// describeNodeExit reads the bound spellings from the runtime adapter (G-9 of 20261103-040939-rbr-remediation-9-review).
const { builtinReviewers } = await import('../scripts/io/reviewers.mjs');
const RUNTIME = builtinReviewers()[JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'reviewers.json'), 'utf8')).default_node_runtime];

// ------------------------------------------------------------------ the declared invokable set

test('every lens declares whether /invoke may fire it, and WHY', () => {
  // Criterion 8: "The invokable set is a declared, deliberate choice... It is not a runtime
  // capability probe." A blanket `invokable: true` would be a probe with extra steps, so each entry
  // carries its own sentence and this refuses a bare flag.
  assert.ok(roster.lenses.length >= 8, 'the roster parsed suspiciously short');
  for (const l of roster.lenses) {
    assert.equal(l.invokable, true, `${l.id} carries no invokable decision`);
    assert.ok(typeof l.invokable_why === 'string' && l.invokable_why.length > 40,
      `${l.id} is marked invokable with no reason — a flag nobody argued for is not a decision`);
  }
});

test('the exclusions are written down, because an absent entry looks like an oversight', () => {
  const why = String(roster.$invokable ?? '');
  assert.ok(why.length > 400, '$invokable says too little to be a decision record');
  // The four nodes that are NOT invokable, each by name. This is the half a reader cannot
  // reconstruct from the lens entries: a node missing from the roster's `invokable` set is
  // indistinguishable from one nobody considered.
  for (const excluded of ['intent-capture', 'request-capture', 'reconcile', 'second-opinion']) {
    assert.ok(why.includes(excluded), `$invokable does not say why ${excluded} is excluded`);
  }
  // second-opinion is the one the request says belongs in the decision rather than excluded by
  // type — it CAN be made meaningful alone by pointing it at a finished run. Recording that it was
  // weighed and deferred is different from recording that it was rejected.
  assert.match(why, /WORTH REVISITING/,
    'second-opinion was deferred for its invocation shape, not ruled out; the record has to say so');
});

test('the skill and the roster name the same set', () => {
  // TWO OWNERS OF ONE FACT is the defect this repository keeps paying for. The roster decides;
  // the skill must not quietly list something else.
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'invoke', 'SKILL.md'), 'utf8');
  for (const l of roster.lenses.filter((x) => x.invokable)) {
    assert.ok(skill.includes(l.id), `skills/invoke/SKILL.md does not name ${l.id}`);
  }
  assert.ok(!/`second-opinion`\s*,/.test(skill),
    'the skill must not advertise a node the roster excludes');
});

test('the invoke skill is classified in the roster like every other skill', () => {
  const entry = (roster.not_graph_nodes ?? []).find((n) => n.id === 'invoke');
  assert.ok(entry, 'a skill in no list is indistinguishable from one that was forgotten');
  assert.match(entry.why, /orchestrator|--only/,
    'it is an orchestrator, not a node; the reason has to say which');
});

// ------------------------------------------------------------------ the fan-out narrowing

test('FAN-OUT-NARROWED does not cap, and the precedents it rests on still do not either', () => {
  assert.ok(!CAPPING_STAMPS.includes(FAN_OUT_NARROWED_STAMP));
  assert.ok(!stampCaps([FAN_OUT_NARROWED_STAMP]));
  // If any of these three ever starts capping, the argument for not capping this one has moved and
  // the decision deserves re-reading rather than inheriting.
  for (const precedent of ['UNSWEPT-DIFF', 'UNCAPPED-BUDGET', 'CONTRACT-PARTIAL']) {
    assert.ok(!CAPPING_STAMPS.includes(precedent),
      `${precedent} now caps; FAN-OUT-NARROWED was argued from it permitting PASS`);
  }
});

// ------------------------------------------------------------------ the whole path
//
// BEHAVIOUR, NOT SOURCE SHAPE (G-85). These run the real orchestrator in a throwaway repository and
// read only what the engine wrote. `ui.surface: none` deselects ui-audit, so nothing is billed and
// every assertion below is about a run that cost $0.

function fixture(name, { surface = 'none' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quorate-${name}-`));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `quorate-${name}home-`));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, 'ok.js'), '');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
    '# t\n\n```yaml\ngraph_contract_version: 5\nproject: t\ncommands:\n'
    + '  build: "node ok.js"\n  test: "node ok.js"\n'
    + 'source_globs: ["src/**"]\n'
    + `ui:\n  surface: ${surface}\n\`\`\`\n`);
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, home };
}

function review(f, slug, extraArgs = [], { mayFanOut = false } = {}) {
  const mint = runScript('new-run.mjs',
    ['--slug', slug, '--no-verify-sandbox', '--no-request', '--full-sweep', '.'],
    { cwd: f.dir, env: { QUORATE_HOME: f.home } });
  assert.equal(mint.status, 0, mint.output.slice(-400));
  const runDir = mintedRunDir(mint.output);
  const graph = runScript('run-graph.mjs',
    ['--run-dir', runDir, '--skip-panel', '--no-archive', ...extraArgs],
    { cwd: f.dir, env: { QUORATE_HOME: f.home }, mayFanOut });
  const gatePath = path.join(runDir, 'gate.json');
  return {
    status: graph.status,
    output: graph.output,
    runDir,
    gate: fs.existsSync(gatePath) ? JSON.parse(fs.readFileSync(gatePath, 'utf8')) : null,
    gateMd: fs.existsSync(path.join(runDir, 'gate.md'))
      ? fs.readFileSync(path.join(runDir, 'gate.md'), 'utf8') : '',
  };
}

const cleanup = (f) => {
  for (const d of [f.dir, f.home]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
};

test('--only refuses a name no lens matches, instead of deselecting everything', () => {
  const f = fixture('invtypo');
  try {
    // mayFanOut, because the REFUSAL is the thing under test: run-graph must reject this argument
    // before it derives a node set, let alone spawns one. helpers.mjs's spend guard would otherwise
    // refuse the invocation itself — correctly, since `arch-reveiw` is not on its safe list.
    const r = review(f, 'typo', ['--only', 'arch-reveiw'], { mayFanOut: true });
    assert.equal(r.status, 2, `a typo must not reach a gate:\n${r.output.slice(-600)}`);
    assert.match(r.output, /--only names "arch-reveiw"/);
    assert.match(r.output, /Available: .*arch-review/, 'and it must say what the alternatives are');
    assert.ok(!fs.existsSync(path.join(r.runDir, 'gate.json')),
      'no gate may be written for a run that reviewed nothing by accident');
  } finally { cleanup(f); }
});

test('a narrowed fan-out is stamped, and the headline names what actually ran', () => {
  const f = fixture('invnarrow');
  try {
    const r = review(f, 'narrow', ['--only', 'ui-audit']);
    assert.match(r.output, /cost:\s+\$0\.0+\b/, `this test must spawn no model:\n${r.output.slice(-600)}`);
    assert.ok(r.gate, 'no gate.json was written');
    assert.ok(r.gate.stamps.includes(FAN_OUT_NARROWED_STAMP), `stamps: ${r.gate.stamps.join(', ')}`);

    // THE HEADLINE, which is the one line every reader is guaranteed to read. Before the fix this
    // said exactly "# Gate — PASS · every node reported" for this same run.
    const headline = r.gateMd.split('\n')[0];
    assert.match(headline, /fan-out narrowed to/, `headline was: ${JSON.stringify(headline)}`);

    // ...and the Required column stops misstating the roster. `required` is correctly false for a
    // lens nobody asked to run — it is what the BLOCKED rule reads and it must not change — but the
    // table printed that value under a heading promising the roster's answer.
    const contractAudit = r.gate.nodes.find((n) => n.node_id === 'contract-audit');
    assert.equal(contractAudit.required, false, 'the run-level fact is unchanged');
    assert.equal(contractAudit.required_by_roster, true, 'and the roster-level fact is now carried');
    assert.equal(contractAudit.deselected, true);
    assert.match(r.gateMd, /\| `contract-audit` \| yes — \*\*deselected\*\*/,
      'a required lens nobody asked for is not "no" under a column headed Required');
  } finally { cleanup(f); }
});

test('the narrowing rule: only a lens that WOULD have run counts as given up', () => {
  // THESE THREE CASES COST $2.81 TO LEARN. They were first written end-to-end, which meant passing
  // `--only <every lens but ui-audit>` to a real orchestrator -- and every lens but ui-audit has
  // condition:always, so four of them spawned judgment-tier models before the run was killed
  // mid-reconcile. A sibling test called run-graph with no `--only` at all and would have run the
  // full fan-out. The rule is pure and belongs in the pure layer; helpers.mjs now refuses the
  // invocation that did it, because the rule they broke was the first paragraph of that file and a
  // comment is not a guard.
  //
  // `would_have_run` is the load-bearing half. Deselecting a lens the contract already switched off
  // costs nothing, and stamping there would put the signal on runs that gave up nothing.
  const row = (id, over) => ({ node_id: id, deselected: false, would_have_run: true, ...over });

  assert.deepEqual(narrowedFanOut([]), [], 'no lenses, nothing given up');
  assert.deepEqual(narrowedFanOut([row('code-audit'), row('arch-review')]), [],
    'a run with no --only deselects nothing');

  // Deselected, and it would have run: the case the stamp exists for.
  const lost = narrowedFanOut([
    row('arch-review'),
    row('code-audit', { deselected: true }),
    row('security-audit', { deselected: true }),
  ]);
  assert.deepEqual(lost.map((e) => e.node_id), ['code-audit', 'security-audit']);

  // Deselected, but the contract had already switched it off -- ui-audit under `ui.surface: none`,
  // or feature-verify with no commands.run. Nothing was lost, so nothing is stamped.
  assert.deepEqual(
    narrowedFanOut([
      row('arch-review'),
      row('ui-audit', { deselected: true, would_have_run: false }),
      row('feature-verify', { deselected: true, would_have_run: false }),
    ]),
    [],
    'excluding a lens that could not have run is not a narrowing',
  );

  // A malformed row is not a narrowing either. The filter must not throw on a row assembled
  // differently, because the only consequence of a crash here is a run that reaches no gate.
  assert.deepEqual(narrowedFanOut([null, undefined, {}]), []);
});

test('the arm set narrows with the lens set, rather than loading every declared arm', () => {
  // Criterion 3, the half the cross-family critique flagged as ambiguous: "the contract's
  // external_panel boolean is honoured as-is, and the set of arms that actually run is exactly those
  // shadowing the invoked lens — not the full panel_arms array. Reading this as 'load every arm the
  // contract declares' would restore the full fan-out and defeat the request."
  //
  // Asserted against the roster's own wiring rather than by spawning a vendor CLI, which this suite
  // may never do: every arm declares which lens it shadows, and run-graph selects on that lens being
  // present. An arm with no `shadows` would be selected by nothing and is the shape that would break
  // the narrowing silently.
  const arms = roster.panel_arms ?? [];
  assert.ok(arms.length >= 7, 'the panel roster parsed suspiciously short');
  const lensIds = new Set(roster.lenses.map((l) => l.id));
  for (const a of arms) {
    assert.ok(a.shadows, `${a.id} shadows no lens, so narrowing the fan-out cannot narrow it`);
    assert.ok(lensIds.has(a.shadows), `${a.id} shadows ${a.shadows}, which is not a lens`);
  }
  // THIS ASSERTION USED TO BE `assert.match(src, /shadowed\?\.present/)` — a substring match on
  // run-graph's source. It broke on 2026-09-22 when the rule was extracted into
  // `armsForSelection` with its behaviour unchanged, which is the whole objection to a grep-shaped
  // test in one event: it failed for a move and would have passed for a rewrite that kept the
  // string. The rule is called now, with the inputs a `--only code-audit` run produces.
  assert.deepEqual(
    armsForSelection({
      panelArms: arms,
      expected: roster.lenses.map((l) => ({ node_id: l.id, present: l.id === 'code-audit' })),
    }).map((a) => a.shadows),
    ['code-audit'],
    'selecting one lens must select exactly the arms shadowing it, which is what makes --only '
    + 'narrow the arms too');
});

// ------------------------------------------------------- what a non-zero exit is allowed to say

test('a node stopped at its dollar ceiling says so, instead of "exit code 1"', async () => {
  const { describeNodeExit } = await import('../scripts/lib/decisions.mjs');

  // THE SHAPE IS REAL, not invented: these three fields are copied from the stdout.json that run
  // 20260920-045034-invoke-arch-review wrote on story-pipeline. arch-review worked for seven
  // minutes, captured three pieces of evidence, spent $4.10 against a declared
  // `budget_usd_per_node: 4.00`, and the status recorded `validator_errors: ["exit code 1"]` —
  // while the answer sat in the evidence directory beside it.
  const real = {
    terminal_reason: 'budget_exhausted',
    subtype: 'error_max_budget_usd',
    is_error: true,
    errors: ['Reached maximum budget ($4)'],
  };
  const said = describeNodeExit({ exitCode: 1, result: real, budgetUsd: '4.00', runtime: RUNTIME });
  assert.match(said, /exit code 1/, 'the raw fact is still there for anyone who wants it');
  assert.match(said, /DOLLAR CEILING/);
  assert.match(said, /\$4\.00/, 'the figure comes from the contract, and a reader needs it to act');
  assert.match(said, /not a defect in the node/,
    'raise the ceiling and fix the node are opposite instructions; the sentence has to pick one');

  // NOTHING FROM THE VENDOR'S OWN STRINGS. This lands in validator_errors, which renders into
  // gate.json and gate.md — both tracked. `errors[]` is free text from a third party and is exactly
  // the class external-review already refuses to quote into a tracked file.
  assert.ok(!said.includes('Reached maximum budget'),
    'the runtime\'s own error strings must not be copied into a tracked artifact');
});

test('an unrecognised terminal_reason is passed through only as a bare token', async () => {
  const { describeNodeExit } = await import('../scripts/lib/decisions.mjs');
  assert.match(describeNodeExit({ exitCode: 2, result: { terminal_reason: 'context_overflow' }, runtime: RUNTIME }),
    /terminal_reason "context_overflow"/);

  // A value that could carry a credential, a path or a connection string is NOT quoted. The guard is
  // the shape of the token, not a scan for secrets — a scan is a blacklist and this is a whitelist.
  for (const hostile of [
    'sk-ant-api03-XXXX', 'C:\Users\me\.aws\credentials', 'postgres://u:p@h/db',
    'BUDGET EXHAUSTED', 'x'.repeat(200), '', '../../etc/passwd',
  ]) {
    const out = describeNodeExit({ exitCode: 1, result: { terminal_reason: hostile }, runtime: RUNTIME });
    assert.equal(out, 'exit code 1', `a terminal_reason of ${JSON.stringify(hostile.slice(0, 30))} was quoted`);
  }
});

test('a non-zero exit with no result envelope still reports the exit code', async () => {
  const { describeNodeExit } = await import('../scripts/lib/decisions.mjs');
  // The common case, and the one that must not regress into a crash: a node that died before
  // writing anything parseable.
  for (const result of [null, undefined, '', 'not json', 42, {}, { subtype: 'success' }]) {
    assert.equal(describeNodeExit({ exitCode: 1, result, runtime: RUNTIME }), 'exit code 1');
  }
  // An uncapped run has no figure to quote, and must not invent one.
  const uncapped = describeNodeExit({
    exitCode: 1, result: { subtype: 'error_max_budget_usd' }, budgetUsd: null, runtime: RUNTIME,
  });
  assert.match(uncapped, /DOLLAR CEILING/);
  assert.ok(!/\$/.test(uncapped.replace('DOLLAR', '')), `invented a figure: ${uncapped}`);
});

// ------------------------------------- AC2: adjudication does not know how wide the fan-out was

test('adjudication is reachable on a ONE-LENS run, because a dispute needs two reporters not two lenses', () => {
  // Criterion 2: adjudication "fires as it does in a full run". A dispute is a contradiction
  // between two reporters about one group — and a single lens plus the arm shadowing it ARE two
  // reporters. So the decision must have no term for the size of the fan-out, and this asserts the
  // absence of that term by exercising the decision rather than by reading the source for it.
  const adjudicators = [{ id: 'adj-codex', reviewer: 'codex' }];
  assert.equal(
    adjudicationEnabled({ skipPanel: false, externalPanel: true, adjudicators }), true,
    'a one-lens run must still be able to adjudicate; the inputs here describe exactly that run');

  // The three conditions that DO gate it, each alone sufficient to refuse.
  assert.equal(adjudicationEnabled({ skipPanel: true, externalPanel: true, adjudicators }), false,
    '--skip-panel must stop adjudication: it is the operator disabling the panel for this run');
  assert.equal(adjudicationEnabled({ skipPanel: false, externalPanel: false, adjudicators }), false,
    'without contract consent nothing may leave the machine, adjudication included');
  assert.equal(adjudicationEnabled({ skipPanel: false, externalPanel: true, adjudicators: [] }), false,
    'no declared adjudicator means nobody to ask');
  assert.equal(
    adjudicationEnabled({ skipPanel: false, externalPanel: true, adjudicators: [{ id: 'x' }] }), false,
    'an adjudicator with no reviewer names no transport, so it cannot be consulted');
});

test('external_panel is honoured as a boolean, not as truthiness', () => {
  // `external_panel` is the one switch that decides whether source leaves the machine. A truthy
  // string — the shape a hand-edited contract produces — must not open it.
  const adjudicators = [{ reviewer: 'codex' }];
  for (const v of ['true', 1, 'yes', {}]) {
    assert.equal(adjudicationEnabled({ externalPanel: v, adjudicators }), false,
      `external_panel ${JSON.stringify(v)} is not the boolean true and must not consent`);
  }
});

// ------------------------------- AC3, measured rather than grepped: the arm set follows the lenses

test('exactly the arms shadowing a RUNNING lens are selected', () => {
  // This criterion was previously held by `assert.match(src, /shadowed\?\.present/)` — a substring
  // match on run-graph's source, which is the grep-shaped assertion this project records as unable
  // to fail for the behaviour it protects (G-59). The rule is a function now, so it can be given
  // the inputs a `--only code-audit` run produces and asked what it returns.
  const panelArms = [
    { id: 'panel-codex-code', shadows: 'code-audit' },
    { id: 'panel-codex-docs', shadows: 'doc-consistency-review' },
    { id: 'panel-codex-contract', shadows: 'contract-audit' },
  ];
  const onlyCodeAudit = [
    { node_id: 'code-audit', present: true },
    { node_id: 'doc-consistency-review', present: false },
    { node_id: 'contract-audit', present: false },
  ];
  const got = armsForSelection({ panelArms, expected: onlyCodeAudit });
  assert.deepEqual(got.map((a) => a.id), ['panel-codex-code'],
    'narrowing the lenses must narrow the arms; loading every declared arm restores the fan-out '
    + 'the request exists to remove');
});

test('an arm that shadows nothing is selected by nothing', () => {
  // The shape that would break the narrowing SILENTLY: an arm with no `shadows` cannot be tied to
  // a lens, so treating it as always-on would put a full-fan-out arm beside one invoked lens.
  const got = armsForSelection({
    panelArms: [{ id: 'orphan' }, { id: 'panel-codex-code', shadows: 'code-audit' }],
    expected: [{ node_id: 'code-audit', present: true }],
  });
  assert.deepEqual(got.map((a) => a.id), ['panel-codex-code']);
});

test('no present lens means no arms, not every arm', () => {
  const panelArms = [{ id: 'panel-codex-code', shadows: 'code-audit' }];
  assert.deepEqual(armsForSelection({ panelArms, expected: [{ node_id: 'code-audit', present: false }] }), []);
  assert.deepEqual(armsForSelection({ panelArms, expected: [] }), []);
  assert.deepEqual(armsForSelection({}), []);
});

test('the real roster narrows to one arm for every invokable lens', () => {
  // Against the SHIPPED roster, not a fixture: every lens `/invoke` exposes must actually have an
  // arm to shadow it, or criterion 2's "the lens's shadow arm runs" is unsatisfiable for that lens
  // and the cross-family half of the review is silently absent for it.
  // EVERY LENS GETS AN ARM OR SAYS WHY NOT — the rule `invokable_why` already applies to the other
  // decision on these entries, for the same reason: an absent entry looks like an oversight, and a
  // flag nobody argued for is not a decision.
  //
  // Found 2026-09-22 by this test: `feature-verify` alone has no arm, and the roster said nothing.
  // It turned out to be a real constraint rather than a gap — an arm cannot launch `commands.run`
  // (the permission is read from `roster.lenses` alone, deliberately), is capped at `convention`
  // while this lens is measurement-only, and could otherwise only read source, which is the one
  // thing it must never do. That argument now lives in the roster where a maintainer meets it.
  // Asserted over ALL lenses, not just invokable ones: an unshadowed lens loses its cross-family
  // half in a full sweep too.
  assert.ok(roster.lenses.length >= 8, 'the lens set parsed suspiciously short');
  for (const lens of roster.lenses) {
    const got = armsForSelection({
      panelArms: roster.panel_arms, expected: [{ node_id: lens.id, present: true }],
    });
    if (!got.length) {
      assert.ok(typeof lens.unshadowed_why === 'string' && lens.unshadowed_why.length > 200,
        `${lens.id} has no shadow arm and no unshadowed_why — so it silently loses its cross-family `
        + 'half, and a reader cannot tell a constraint from an omission');
      continue;
    }
    assert.ok(!lens.unshadowed_why,
      `${lens.id} declares unshadowed_why but IS shadowed by ${got.map((a) => a.id).join(', ')} — `
      + 'the explanation outlived the thing it explained');
    for (const a of got) {
      assert.equal(a.shadows, lens.id, `${a.id} was selected for ${lens.id} but shadows ${a.shadows}`);
    }
  }
});

// --------------------------------------------- AC5: a fabricated evidence path is still rejected

test('the evidence-path checks a single-lens run relies on are all four, in the spawner', () => {
  // Criterion 5: findings "cite evidence paths that exist under evidence/<lens>/, produced during
  // the run, and a fabricated path is rejected by the same mechanism a full run uses". `/invoke`
  // spawns through spawn-node.mjs exactly as a full run does, so the mechanism is shared — the risk
  // is not that it is bypassed but that it quietly loses a clause. Four are required, and the
  // fourth is the one a naive reading misses: ownership plus existence still admits a file an
  // EARLIER attempt left under this node's own directory.
  // The first three are decided by lib/finding-scope.mjs's evidenceOwnershipError, the containment owner, since G-19 of
  // 20261025-104155-srf-remediation-3-review; the spawner must still call it.
  const spawner = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  assert.match(spawner, /evidenceOwnershipError\(/, 'the spawner no longer asks the owner whose evidence a path is');
  const src = spawner + fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'finding-scope.mjs'), 'utf8');
  for (const [clause, why] of [
    ['no evidence_path', 'a finding with no path cites nothing'],
    ['evidence_path is outside evidence/', "citing another node's evidence is how corroboration gets faked"],
    ['evidence_path does not exist on disk', 'a fabricated path is the case the criterion names'],
    ['evidence_path predates this node', 'a file from an earlier attempt is somebody else\'s work'],
  ]) {
    assert.ok(src.includes(clause), `the spawner no longer rejects: ${clause} — ${why}`);
  }
});
