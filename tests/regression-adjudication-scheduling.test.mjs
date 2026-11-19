// How judges are SCHEDULED, named and accounted for — seven findings from the sweep of the commit
// that introduced them, all in the orchestrator half rather than the merge.
//
// The merge was written first and tested hard; the wiring around it was not, and every one of these
// is a place where the wiring quietly contradicted the merge's own rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { REPO_ROOT } from './helpers.mjs';
import { validateRoster, adjudicationEnabled } from '../scripts/lib/capabilities.mjs';
import { builtinReviewers, familyOfCall } from '../scripts/io/reviewers.mjs';
import { resolvedRequestsDir } from '../scripts/io/project-paths.mjs';
import { adjudicationBrief } from '../scripts/lib/adjudication.mjs';

const GRAPH = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
const ROSTER = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

test('regression: two judges on one adapter would have been one judge', () => {
  // The node id, the evidence directory and the merge key were all built from `judge.reviewer` — a
  // TRANSPORT name. Two judges declared on one adapter (two codex models, a reasonable thing to
  // want) collided on all three and silently became one judge whose result depended on which
  // finished last. `adjudicators[].id` existed and nothing read it.
  assert.match(GRAPH, /const judgeId = judge\.id \?\? judge\.reviewer;/);
  // THE DECLARED ID REACHES THE ID THE NODE IS NAMED BY. The format itself lives in one owner now
  // (`adjudicationBrief`, so the live probe cannot send a shape production never sends) and is
  // exercised by running it; what this asserts is the wiring — that run-graph feeds the DECLARED id
  // into it, which is the half that collapsed two judges into one.
  assert.match(GRAPH, /const nodeId = brief\.nodeId\(judgeId\);/);
  assert.equal(adjudicationBrief({ group: { group_id: 'G-4' } }).nodeId('adj-two'), 'adjudicate-G-4-adj-two');

  const resolve = (name) => builtinReviewers()[name];
  const dup = structuredClone(ROSTER);
  dup.adjudicators = [
    { id: 'adj-one', reviewer: 'codex', model: 'a', family: 'openai' },
    { id: 'adj-one', reviewer: 'codex', model: 'b', family: 'anthropic' },
  ];
  const { errors } = validateRoster(dup, resolve, { defaultRuntime: 'claude' });
  assert.ok(errors.some((e) => /two adjudicators declare id/.test(e)),
    'a duplicate id is one judge overwriting another, and preflight must refuse it');
});

test('regression: two judges of one FAMILY are refused, whatever adapters they came through', () => {
  // `reviewer` is a transport: agy serves Gemini models AND Claude ones. A panel of "two vendors"
  // can be one family wearing two adapter names — the single thing a cross-family panel exists not
  // to be, and nothing checked it.
  const resolve = (name) => builtinReviewers()[name];
  const same = structuredClone(ROSTER);
  // A family is the model's, declared on its adapter (runtime-call-telemetry.plan.md stage 1): agy serving a Claude model and
  // the claude adapter are one family, anthropic, through two adapter names.
  same.adjudicators = [
    { id: 'adj-a', reviewer: 'agy', model: 'Claude Opus 4.6' },
    { id: 'adj-b', reviewer: 'claude', model: 'opus' },
  ];
  const { errors } = validateRoster(same, resolve, { defaultRuntime: 'claude' });
  assert.ok(errors.some((e) => /two adjudicators are family 'anthropic'/.test(e)),
    'same-family agreement may be one opinion counted twice');

  // The shipped judges resolve to different families through their adapters.
  const fams = (ROSTER.adjudicators ?? []).map((j) => familyOfCall({ reviewer: j.reviewer, model: j.model }, builtinReviewers()));
  assert.equal(new Set(fams).size, fams.length, 'the shipped judges must be different families');

  // And the STAKE question is asked of the family, through the one rule, not the vendor.
  assert.match(GRAPH, /const judgeFamily = familyOfCall\(\{ reviewer: judge\.reviewer, model: judge\.model \}, REVIEWER_TABLE\);/);
  assert.match(GRAPH, /findingFamily\(f\) === judgeFamily/,
    'a judge sharing a family with a disputant through another adapter is not neutral');
});

test('regression: a judge refused for a role gap is still counted in coverage', () => {
  // It was dropped from `eligible`, and `eligible.length` was the coverage denominator — so a
  // two-judge panel with one unusable adapter reported coverage 1/1, identical to a panel that only
  // ever had one judge. That is the distinction the whole merge rests on.
  assert.match(GRAPH, /const refused = \[\];/);
  assert.match(GRAPH, /votes: \[\.\.\.votes, \.\.\.refused\]/,
    'a refused judge joins every dispute as an absent vote');
  assert.match(GRAPH, /scheduled: JUDGES\.length/,
    'and the denominator is every DECLARED judge, not the survivors');
  assert.ok(!/scheduled: eligible\.length/.test(GRAPH), 'the survivors are not the panel');
});

test('regression: a judge gets a RUNNING stub before it spawns, like every lens', () => {
  // expected.json promises the node. Without a stub, a hard kill mid-adjudication left that promise
  // with NO status file of any kind behind it — the one shape "silence is not a verdict" cannot
  // catch, because nothing records that the node ever started.
  const block = GRAPH.slice(GRAPH.indexOf('const nodeId = brief.nodeId('));
  const stubAt = block.indexOf(`state: 'RUNNING', kind: NODE_KIND.adjudication`);
  const spawnAt = block.indexOf('await spawnCapture(');
  assert.ok(stubAt !== -1, 'the judge must write a RUNNING stub');
  assert.ok(stubAt < spawnAt, 'and it must be written BEFORE the spawn, or it records nothing');
});

test('regression: an absent judge reaches the gate\'s did-not-report section', () => {
  // `buckets.did_not_report` is filled ONCE from `expected`, long before the adjudication block
  // appends judge rows — so an absent judge appeared only as a DEGRADED row in the node table and a
  // number in the adjudication table, never in the section a reader opens to find out what did not
  // report. The gate's accounting covers judges the way it covers lenses, or it does not cover them.
  assert.match(GRAPH, /adjudicator did not report on \$\{row\.groups\.length\} disputed group\(s\)/);
  assert.match(GRAPH, /never counted against either position/);
  // One line per judge, not per (judge, dispute): three identical lines are noise.
  assert.match(GRAPH, /const silent = new Map\(\);/);
});

// THE LAYER IT LIVES IN (G-18, panel-codex-arch). Both symbols sat in locate.mjs, whose first
// sentence promises it answers where the framework's own files are "without reference to the
// repository being reviewed" — and `resolvedRequestsDir(repoRoot)` is nothing but such a reference.
// An installation-discovery module encoding a consumer project's input policy means a project
// wanting its requests elsewhere edits the module that finds the ENGINE.
//
// Asserted on the module SURFACE rather than on an import line, because the defect is what the
// module exports, not who imports it.
test('regression: framework self-location exports nothing about the reviewed repository', async () => {
  const locate = await import('../scripts/io/locate.mjs');
  for (const name of ['REQUESTS_DIR', 'resolvedRequestsDir']) {
    assert.equal(locate[name], undefined,
      `${name} is a path in the repository UNDER REVIEW; locate.mjs is the other layer`);
  }
  const project = await import('../scripts/io/project-paths.mjs');
  assert.equal(project.REQUESTS_DIR, '.claude/requests');
  assert.equal(typeof project.resolvedRequestsDir, 'function');
});

test('regression: the requests directory is resolved through links before it is written or read', () => {
  // Both callers took a lexical join, which a symlink or a Windows junction at `.claude/requests`
  // redirects silently. Recovery WRITES a generated request through that path and discovery READS
  // through it — so a link could send a generated document out of the tree and then feed an
  // attacker-chosen file into intent capture as the criteria the run is judged against.
  assert.match(GRAPH, /resolvedRequestsDir\(repoRoot, \{ mustExist: false \}\)/, 'the write side');
  assert.match(GRAPH, /const dir = resolvedRequestsDir\(repoRoot\);/, 'the read side');
  const nr = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  assert.match(nr, /resolvedRequestsDir\(repoRoot\)/, 'and discovery in new-run');

  // The rule itself: a path that leaves the repository is refused, and one that cannot be resolved
  // is not evidence of containment either — the same standard external-review applies to evidence.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-req-')));
  try {
    assert.equal(resolvedRequestsDir(root), null, 'a directory that does not exist resolves to nothing');
    fs.mkdirSync(path.join(root, '.claude', 'requests'), { recursive: true });
    const ok = resolvedRequestsDir(root);
    assert.ok(ok && ok.startsWith(fs.realpathSync(root)), 'a real directory inside the repo resolves');
    // The parent-resolving form, used before the directory exists.
    const pre = resolvedRequestsDir(root, { mustExist: false });
    assert.ok(pre && pre.endsWith('requests'), 'the write side can prove containment before creating it');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('regression: an unavailable ARM keeps its vendor stderr out of the tracked status file', () => {
  // The same leak as the judges', in the older path — and the arms run on EVERY panel sweep rather
  // than on a rare dispute, so fixing the judges and leaving these was fixing the rarer half.
  // external-review's unavailable reason is `exited <n> with no output: <vendor stderr>`, and
  // nodes/*.status.json is tracked while evidence/ is gitignored precisely because it holds content.
  const arm = GRAPH.slice(GRAPH.indexOf('async function spawnPanelArm('));
  assert.match(arm, /failure_detail: `evidence\/\$\{arm\.id\}\/failure\.json`/);
  assert.ok(!/validator_errors: \[`arm \$\{probe\.state\}: \$\{probe\.reason\}`\]/.test(arm),
    'the reason must not be quoted into the tracked record');
  assert.match(arm, /a vendor's stderr can carry a credential and this file is tracked/,
    'and it must say why, so the next person does not helpfully inline it again');
});

test('regression: an unsettled dispute cannot leave the gate at PASS', () => {
  // The ceiling never read `adjudicationSummary`. The summary was rendered into gate.md and used for
  // nothing else -- so a run whose only unsettled item was a disputed LOW-severity group emitted
  // PASS with a lens and an arm still flatly contradicting each other, because the severity floor
  // leaves every node verdict at PASS. The panel exists for that contradiction (contract-audit,
  // I-17).
  assert.match(GRAPH, /const unsettled = adjudicationSummary\.tied \+ adjudicationSummary\.inquorate \+ adjudicationSummary\.absent;/);
  assert.match(GRAPH, /if \(unsettled > 0\) ceiling = 'RISK';/);

  // A CRASHED adjudication is the same class and was even quieter: the catch printed to stderr, and
  // status bucketing had already finished with the judge rows marked non-required, so the gate
  // completed normally with the disputes silently unadjudicated. A console line is not an artifact.
  assert.match(GRAPH, /if \(adjudicationCrashed\) ceiling = 'RISK';/);
  assert.match(GRAPH, /the adjudication phase threw/, 'and it must leave a durable gap, not a log line');
  // Hoisted with the other flags writeGate reads on the pre-flight failure path, which never
  // reaches the barrier where they are set -- the temporal-dead-zone defect this file already has.
  // MATCHED ON THE ASSIGNMENT, NOT ITS RIGHT-HAND SIDE. This looked for
  // `adjudicationCrashed = String(` and went red when the catch started unwrapping an
  // AggregateError's causes instead of stringifying the aggregate — a change that strengthened the
  // very thing the surrounding test is about, while the claim here is only that the flag is declared
  // before the code that sets it.
  const hoist = GRAPH.indexOf('let adjudicationCrashed = null;');
  const setAt = GRAPH.search(/^\s*adjudicationCrashed = /m);
  assert.ok(hoist !== -1, 'the flag must be hoisted with the others writeGate reads');
  assert.ok(setAt > hoist, 'declared in the hoist block, set at the barrier');
});

test('regression: the merged decision reaches a machine-readable artifact', () => {
  // Each judge's vote was structured in its own status file, and whether the PANEL decided was in no
  // JSON anywhere -- only prose appended to reconciled.md. A consumer asking "was this dispute
  // settled, and how" had to parse markdown, against this framework's own rule that mechanical facts
  // belong in mechanical form (arch-review, contract-audit).
  // A tracked write since ledger-trust-boundaries 1b: through writeTrackedJson, the redacting writer.
  const at = GRAPH.indexOf("writeTrackedJson(path.join(nodesDir, 'adjudication.json')");
  assert.ok(at !== -1, 'the merged decision must be written as JSON');
  // SCOPED TO THE ARTIFACT. Scanning the whole 3,500-line file for `outcome:` would pass on any
  // occurrence anywhere, which is a check that cannot fail rather than one that holds a shape.
  // Ended past the GROUPS, not at the first nested close — the literal contains a `judges:` map
  // whose own `})` came first, so the slice stopped before the fields this asserts and every check
  // passed vacuously false. A window that excludes what it is checking is worse than no window.
  const artifact = GRAPH.slice(at, GRAPH.indexOf('      });', GRAPH.indexOf('groups: [...merged.entries()]', at)));
  assert.ok(artifact.includes('groups:'), 'the slice must reach the per-group rows');
  for (const field of ['outcome', 'supports', 'tally', 'coverage', 'agreement', 'undecided_reason']) {
    // A PLAIN SUBSTRING. The generated form carried a `\b` that survived into the template literal
    // as an escape — a backspace character, not a word boundary — so every one of these matched a
    // control byte followed by the field name and was false for the right reason and the wrong one.
    assert.ok(artifact.includes(`${field}:`), `adjudication.json must carry ${field}`);
  }
  // And the gate's own JSON, which is the file a reader opens months later.
  assert.match(GRAPH, /adjudication: adjudicationSummary/);

  // COST SEPARATELY (I-14). The run-wide total says what the review cost; it cannot say what the
  // PANEL cost, which is the figure that decides whether the topology is worth keeping. Unmeasured
  // judges are named rather than counted as zero -- unmeasured is not free.
  assert.match(GRAPH, /const adjudicationCost = \{ total: 0, unmeasured: \[\] \};/);
  assert.match(GRAPH, /cost_unmeasured_judges: adjudicationCost\.unmeasured/);
});

test("regression: the vendor's rationale stays out of the tracked status file", () => {
  // `rationale` is third-party free text that routinely quotes the disputed excerpt back --
  // repository content -- and nodes/*.status.json is tracked while evidence/ is gitignored
  // precisely because it holds content. Same rule as the stderr, one field over (contract-audit).
  const block = GRAPH.slice(GRAPH.indexOf('const nodeId = brief.nodeId('));
  assert.ok(!/rationale: tbEnvelope\.rationale/.test(block),
    'the tracked record keeps the vote; the words go to evidence/');
  assert.match(block, /rationale_detail: `evidence\/\$\{nodeId\}\/ruling\.json`/);
  assert.match(block, /writeJson\(path\.join\(dir, 'ruling\.json'\)/);

  // And the vote is named by the DECLARED id, the way every other roster entry is.
  assert.match(block, /judge: judgeId,/);
  assert.match(block, /judge_id: judgeId,/);
});

// THE JUDGES' CHECKOUT WAS BUILT ONLY IF AN ARM WAS GOING TO RUN.
//
// Found while setting up a resume to reproduce an adjudication crash — before spending anything on
// it, which is the only reason it was found at all. The adjudication spawn is the second external
// reviewer and stands in `armSurface.cwd` for the same reason the arms do: run-graph's own teardown
// comment says "pointing it at the repository root is the defect the worktree exists to close".
//
// But `if (panelArms.length)` is the only thing that builds that checkout, and the adjudication phase
// runs in cases where no arm does — a `--resume` where every arm is already OK. On that path
// `panelReadSurface` falls back to `cwd: repoRoot`, so both judges read the repository AND the run's
// own evidence tree, which run-checks describes as possibly holding "a connection string, an
// environment dump, a token inside an error".
//
// And the fallback's STAMP was gated on `panelArms.length` too — so the exposure was not just
// present, it was unrecorded, which is the exact thing that stamp's own comment says was wrong about
// the exposure in the first place: "it was wrong because nothing recorded it, so no reader of a gate
// could tell whether it had happened."
test('regression: the isolated checkout is built whenever the panel may spawn, not only for arms', () => {
  // THESE TWO WERE SOURCE GREPS — `/const mayAdjudicate = !args\.skipPanel/` and a match on the
  // adjudicator `.some(...)` expression — and on 2026-09-22 both failed when that expression was
  // extracted into `adjudicationEnabled` with its behaviour unchanged. That is the grep-shaped
  // assertion's whole failure mode in one event: red for a move, and green for any rewrite that
  // kept the characters. The rule is called now, so it fails for the behaviour instead.
  assert.equal(
    adjudicationEnabled({ skipPanel: false, externalPanel: true, adjudicators: [{ reviewer: 'codex' }] }),
    true, 'whether a judge may spawn is a fact about the run, and it decides where that judge stands');
  assert.equal(
    adjudicationEnabled({ skipPanel: false, externalPanel: true, adjudicators: [] }),
    false, 'no declared adjudicator means no judge, so no checkout is needed for one');
  assert.equal(
    adjudicationEnabled({ skipPanel: true, externalPanel: true, adjudicators: [{ reviewer: 'codex' }] }),
    false, '--skip-panel stops the judges too, which is why the checkout is not built for them');
  assert.match(GRAPH, /if \(panelArms\.length \|\| mayAdjudicate\) \{/,
    'the checkout must exist for either external reviewer, not just the first one');

  // THE UNRECORDED HALF. A fallback nobody stamps is the silent version of the same exposure.
  assert.match(GRAPH, /if \(armSurface\.stamp && \(panelArms\.length \|\| mayAdjudicate\)\) \{/,
    'PANEL-SEES-EVIDENCE must be stamped on every path that reads the repository, or a gate cannot '
    + 'say whether the judges saw the run\'s own evidence');
  assert.ok(!/if \(armSurface\.stamp && panelArms\.length\)/.test(GRAPH),
    'the arms-only gate is what suppressed the stamp on the judges-only path');
});
