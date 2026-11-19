// Two gate-integrity defects the cross-family run confirmed, both a way for the gate to compute a
// verdict it has no right to.
//
// G-51 (BLOCKER, panel-codex + security): the reconciler is the barrier, but it lives in
// roster.barrier_nodes, not roster.lenses, so it is NEVER in requiredNodes and the required-node
// check cannot catch its silence. A barrier that timed out or returned garbage left every group
// unadjudicated and the gate still computed from lens verdicts alone, up to PASS — the project's
// central rule failing at the one node whose silence is least visible.
//
// G-43 (HIGH, contract-audit + panel-codex-contract): source/model are set on findings so reconcile
// can weigh cross-family agreement, then the finding-groups projection rebuilt each finding
// field-by-field and dropped both — leaving cross-family weighting to survive only on a node-id
// prefix. finding-groups.json is the reconciler's ONLY findings input.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import {
  reconcileSilent, projectGroupFinding, isFanOutNode, secondOpinionSilent, verdictFloorFromFindings,
} from '../scripts/lib/decisions.mjs';

test('regression: a needed reconciler that did not report OK is SILENT — the gate must block on it', () => {
  // There were groups to adjudicate and the skill is installed, but the barrier did not report OK.
  for (const state of ['BLOCKED', 'RUNNING', 'DEGRADED', 'MISSING', undefined]) {
    assert.equal(
      reconcileSilent({ groupCount: 12, reconcileInstalled: true, reconcileState: state }),
      true,
      `reconcileState ${JSON.stringify(state)} with 12 groups is silence, not a pass`,
    );
  }
});

test('a reconciler that reported OK is not silent', () => {
  assert.equal(reconcileSilent({ groupCount: 12, reconcileInstalled: true, reconcileState: 'OK' }), false);
});

test('regression: NO findings to adjudicate is a legitimate skip, not silence', () => {
  // groupCount 0 means nothing to reconcile — SKIPPED is correct and must NOT block the gate.
  assert.equal(reconcileSilent({ groupCount: 0, reconcileInstalled: true, reconcileState: 'SKIPPED' }), false);
  assert.equal(reconcileSilent({ groupCount: 0, reconcileInstalled: true, reconcileState: 'BLOCKED' }), false);
});

test('a run without the reconcile skill installed does not block on a barrier it never had', () => {
  assert.equal(reconcileSilent({ groupCount: 12, reconcileInstalled: false, reconcileState: 'SKIPPED' }), false);
});

test('regression: the finding-groups projection carries source AND model through', () => {
  // An arm finding tagged with its reviewer must keep that tag; the mapper once stripped it.
  const arm = projectGroupFinding({
    node_id: 'panel-codex-security', severity: 'HIGH', basis: 'convention', claim: 'x',
    evidence_path: 'e', source: 'codex', model: 'gpt-5',
  });
  assert.equal(arm.source, 'codex', 'the arm\'s family must reach the reconciler');
  assert.equal(arm.model, 'gpt-5');

  // A lens finding stamped by spawn-node with its Claude-family source must also survive.
  const lens = projectGroupFinding({
    node_id: 'security-audit', severity: 'HIGH', basis: 'invariant', claim: 'y',
    evidence_path: 'e2', source: 'opus', model: 'opus',
  });
  assert.equal(lens.source, 'opus');

  // A finding with no source projects to an explicit null (a declared field), never a dropped key.
  const bare = projectGroupFinding({ node_id: 'n', severity: 'LOW', basis: 'convention', claim: 'z', evidence_path: 'e3' });
  assert.equal('source' in bare, true, 'source must be a present field, not absent');
  assert.equal(bare.source, null);
  assert.equal(bare.model, null);
});

// The fan-out selected on `present` alone, and panel-arm rows carry present: true with skill: null
// (they are in `expected` because it is the run's pre-commitment record, but they are spawned by
// spawnPanelArm, not spawn-node). So every arm was also spawned as a lens node and died instantly
// with "one of --prompt or --skill-command is required": six wasted spawns and six wasted pool
// slots per run, a brief written per arm that nothing reads, and "12 lens(es)" reported for six.
// Harmless only while the panel ran strictly AFTER the fan-out — once the two overlap, that bogus
// spawn races the real arm spawn on the same node_id.
test('regression: panel-arm rows are excluded from the lens fan-out', () => {
  const arm = { node_id: 'panel-codex-code', present: true, skill: null, kind: 'panel-arm' };
  assert.equal(isFanOutNode(arm), false, 'an arm is spawned by the panel, never by the lens fan-out');
});

test('lens rows are still selected, and un-present rows still are not', () => {
  assert.equal(isFanOutNode({ node_id: 'code-audit', present: true, skill: '/code-audit' }), true);
  assert.equal(isFanOutNode({ node_id: 'ui-audit', present: false, skill: '/ui-audit' }), false);
  assert.equal(isFanOutNode(undefined), false, 'a missing row is not a node to spawn');
});

// The SAME hole as the barrier's, at the other end of the graph. intent-capture is an aux node, not
// in `expected`, so it has no gate.json row, cannot appear in badRequired, and its failure was
// invisible to every gate branch. Observed live: intent-capture was killed by its timeout, no
// intent.md was ever written, and the gate emitted FAIL with ceiling PASS while contract-audit
// returned a conformance verdict against criteria that do not exist — and with an empty criteria
// set, spawn-node's intent_ref check has nothing to validate citations against and skips.
test('regression: a run whose criteria were never produced cannot certify conformance', () => {
  const intentRequiredButMissing = (expected, intentSha) =>
    expected.some((e) => e.present && e.intent === 'required') && !intentSha;

  const withContractLens = [{ node_id: 'contract-audit', present: true, intent: 'required' }];
  assert.equal(intentRequiredButMissing(withContractLens, null), true,
    'intent required and absent must be caught');
  assert.equal(intentRequiredButMissing(withContractLens, undefined), true);
  assert.equal(intentRequiredButMissing(withContractLens, 'abc123'), false,
    'criteria present is the normal case');

  // A run with no intent-citing lens legitimately needs no intent.md.
  assert.equal(intentRequiredButMissing([{ node_id: 'perf-audit', present: true }], null), false);
  // A lens that is not running does not demand criteria either.
  assert.equal(
    intentRequiredButMissing([{ node_id: 'contract-audit', present: false, intent: 'required' }], null),
    false,
  );
});

// THE THIRD AUX NODE, and I stopped at two. reconcile and intent-capture were each given a
// dedicated silence branch; second-opinion was not. It is not in `expected` either — that array is
// roster.lenses plus panelArmRows() — so it gets no bucket entry and no gate.json row. A
// second-opinion that returns DEGRADED on empty prose, is killed on timeout or budget, or is
// stubbed, therefore appeared NOWHERE, and the gate stayed free to compute PASS: the adversarial
// audit OF the adjudication failing silently, and reading exactly like one that passed.
//
// The response is deliberately weaker than the barrier's. reconcile's silence leaves every finding
// unadjudicated, so the gate is BLOCKED. second-opinion audits an adjudication that did happen, so
// its silence does not invalidate the findings — it means nothing checked them, and PASS overstates
// what the run established. That is a RISK ceiling, not a block.
test('regression: a second-opinion that was expected and did not report is SILENT', () => {
  for (const state of ['DEGRADED', 'BLOCKED', 'RUNNING', 'MISSING', undefined]) {
    assert.equal(
      secondOpinionSilent({ installed: true, skipped: false, hadReconciled: true, state }),
      true,
      `state ${JSON.stringify(state)} must count as an unaudited adjudication`,
    );
  }
});

test('a second-opinion that reported OK is not silent', () => {
  assert.equal(secondOpinionSilent({ installed: true, skipped: false, hadReconciled: true, state: 'OK' }), false);
});

test('regression: the legitimate reasons it did not run are NOT silence', () => {
  // --skip-panel is an operator choice and is named elsewhere; no reconciled.md means there was
  // nothing to audit. Treating either as silence would cap every such run at RISK for no defect,
  // and a ceiling that fires on a non-problem teaches people to ignore ceilings.
  assert.equal(secondOpinionSilent({ installed: true, skipped: true, hadReconciled: true, state: 'SKIPPED' }), false);
  assert.equal(secondOpinionSilent({ installed: true, skipped: false, hadReconciled: false, state: 'SKIPPED' }), false);
  assert.equal(secondOpinionSilent({ installed: false, skipped: false, hadReconciled: true, state: undefined }), false);
});


// THE BARRIER'S JUDGEMENT REACHED reconciled.md AND STOPPED THERE (G-49, panel-codex-code).
//
// The gate read pre-reconciliation node verdicts and nothing else, so a group the reconciler
// UPGRADED — two lenses each calling it MEDIUM, the reconciler seeing the root cause and calling it
// HIGH — moved no gate that the lenses' own RISK had not already moved. The severity that survives
// adjudication is the one the run believes, and the gate is where the run states what it believes.
test('an adjudication that raises a severity raises the gate', () => {
  // The upgrade the gate could not see: no node claimed better than MEDIUM.
  const upgraded = [{ group_id: 'G-1', severity: 'HIGH', decision: 'confirmed' }];
  assert.equal(verdictFloorFromFindings(upgraded), 'FAIL');

  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /verdicts\.includes\('FAIL'\) \|\| adjudicatedFloor === 'FAIL'/);
  assert.match(graph, /adjudicated_floor: adjudicatedFloor/,
    'a reader must be able to see which of the two produced the verdict');
});

// AND ONLY RAISE IT. A group the reconciler DROPPED still leaves its lens's FAIL standing: letting
// an adjudication LOWER the gate hands a model the power to clear a deterministic verdict — a red
// test's included. A dropped false positive costs a RISK nobody needed; a wrongly-cleared FAIL costs
// the thing the system is for. Same asymmetry raiseVerdict and capVerdict already encode.
test('a dropped group lowers nothing, it only carries no weight of its own', () => {
  const judged = [
    { group_id: 'G-1', severity: 'BLOCKER', decision: 'dropped' },
    { group_id: 'G-2', severity: 'LOW', decision: 'confirmed' },
  ];
  const floor = verdictFloorFromFindings(judged.filter((g) => g.decision !== 'dropped'));
  assert.equal(floor, 'PASS', 'a dropped group contributes nothing to the floor');

  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  // The floor moved into lib/decisions.mjs's adjudicationFloor (G-15 of 20260930-011534-m0-gate-review-r2), which
  // run-graph calls; the filter is asserted where it now lives.
  const lib = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'decisions.mjs'), 'utf8');
  const block = lib.slice(lib.indexOf('export function adjudicationFloor('), lib.indexOf('export function projectGroupFinding('));
  assert.match(block, /decision !== 'dropped'/);
  assert.match(graph, /const adjudicatedFloor = adjudication\.floor \?\? 'PASS';/);
  // The floor is a FLOOR: it appears only in the raising branches, never as a cap on the others.
  const decision = graph.slice(graph.indexOf('  if (forced) gate = forced;'), graph.indexOf('const gateJson'));
  assert.ok(!/adjudicatedFloor === 'PASS'/.test(decision),
    'a branch keyed on the adjudication being clean would let a model clear a verdict');
});

// THE GATE DROPPED THE REVIEWER FAMILY (G-33, panel-codex-contract against I-2).
//
// The OK bucket rebuilt each status from three fields and discarded `st.source`, so gate.json and
// gate.md could only tell a Claude lens from an external arm by the SHAPE OF ITS NODE ID — a
// convention lens-roster.json can change. The same field-by-field rebuild dropped source and model
// out of finding-groups.json once already (G-43); this is that defect at the other end of the graph,
// where the gate is the file a reader opens months later to ask which families actually reviewed.
test('an OK arm keeps its family at the gate', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const bucket = src.slice(src.indexOf("if (st.state === 'OK')"), src.indexOf("else if (st.state === 'SKIPPED')"));
  assert.match(bucket, /source: st\.source/, 'the family must survive the rebuild');

  // Every shipped arm records one, so the field is real rather than aspirational.
  const runs = path.join(REPO_ROOT, '.claude', 'reviews');
  const withArms = fs.readdirSync(runs)
    .map((d) => path.join(runs, d, 'nodes'))
    .filter((n) => fs.existsSync(n))
    .flatMap((n) => fs.readdirSync(n).filter((f) => f.startsWith('panel-') && f.endsWith('.status.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(n, f), 'utf8'))))
    .filter((s) => s.state === 'OK');
  if (withArms.length) {
    assert.ok(withArms.every((s) => typeof s.source === 'string' && s.source),
      'an OK arm status must name its reviewer, or there is nothing for the gate to carry');
  }
});

// G-20 of run 20260924-145430-post-med2 — `panel-codex-security`, verified in source.
//
// `collectFindings` selects nodes that reported OK (`if (!st || st.state !== 'OK') continue`), then
// parsed each one's `verdict.kept.json` inside `try { } catch { }` whose comment read "a node whose
// output will not parse is already DEGRADED". That premise is false HERE — the loop just excluded
// every node that is not OK.
//
// So a corrupt validated-findings file on an OK node dropped every finding it held, silently: the
// node still reports OK, the gate counts zero findings for it, and a run with real findings reads
// clean. That is the failure this whole system is built to refuse — silence presented as a verdict.
//
// The sibling case two lines above already does the right thing: a MISSING verdict.kept.json pushes
// to `did_not_report` rather than falling back to raw stdout. An unparseable one is the same claim
// — the validated set is unavailable — and now takes the same path.
//
// NOT EXPRESSIBLE AS A UNIT TEST HERE: `collectFindings` is a closure inside run-graph.mjs with no
// export, and constructing a run directory complete enough to reach it costs more than it proves.
// The before-state was the catch body itself, captured by git grep; this pins the shape.
test('an unparseable verdict file is reported, not swallowed', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function collectFindings'), src.indexOf('  return all;'));
  assert.ok(fn.length > 200, 'collectFindings should be locatable');

  assert.ok(!/catch \{ \/\* a node whose output will not parse is already DEGRADED \*\/ \}/.test(fn),
    'the loop already excluded non-OK nodes, so that comment described a state that cannot occur here');
  // Ordering, not distance: a fixed character window is a limit on the COMMENT length, which is
  // not the property under test and broke the moment the fix explained itself.
  // Since ledger-trust-boundaries 2a the one reader classifies the verdict, so the refusal is the branch taken
  // when it is neither missing nor ok — an `else`, no longer a `catch`.
  const catchAt = fn.indexOf('if (kept.ok)') > -1 ? fn.indexOf('} else {', fn.indexOf('if (kept.ok)')) : fn.indexOf('} catch (');
  const pushAt = fn.indexOf('did_not_report.push', catchAt);
  assert.ok(catchAt > -1 && pushAt > catchAt,
    'an OK node whose validated findings will not parse must reach did_not_report, exactly as one '
    + 'with no verdict.kept.json already does — otherwise its findings vanish and the gate reads clean');
});

test('regression: an arm finding takes its model from the arm\'s status when it carries none', () => {
  // The G-43 projection above carries model THROUGH, and passed while every external-arm finding still read
  // model: null — an arm's findings never carried one to carry (83 of 83 in story-pipeline run
  // 20261005-235247-product-sweep, whose arm status files recorded gpt-5.6-sol). The fill happens where the
  // barrier collects findings, from the node's status, and never replaces a value the finding has.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function collectFindings('), src.indexOf('return all;', src.indexOf('function collectFindings(')));
  assert.match(fn, /model: f\.model \?\? st\.model \?\? null/, 'a missing model is filled from the status file');
  assert.match(fn, /source: f\.source \?\? st\.source/, 'and so is a missing source');
});
