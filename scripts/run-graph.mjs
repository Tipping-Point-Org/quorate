#!/usr/bin/env node
// run-graph.mjs — derive the graph, fan out, hold the barrier, reconcile, gate.
//
// The graph is derived DETERMINISTICALLY from lens-roster.json plus the contract. No model is
// asked how to decompose the work: a model-authored decomposition is the weakest node in a
// fan-out graph, because nothing downstream can distinguish a bad split from a good one.
//
// nodes/expected.json is written BEFORE anything launches. That file is what makes the
// determinism auditable — without it, "which nodes were supposed to run" is itself a claim.
//
// Exit codes: 0 the run reached a gate (read gate.json for the verdict)
//             1 the run is BLOCKED
//             2 configuration error
//             3 recursion guard tripped

import fs from 'node:fs';
import { nodeDepth } from './lib/node-depth.mjs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  groupFindings, PROXIMITY_LINES,
  nodeSpend, unreadableStatusCharge, reviewerEnv, engineLocationEnv, classifyPanelProbe, budgetOf, reconcileSilent, projectGroupFinding,
  isFanOutNode, unshadowedJudgmentLenses, secondOpinionSilent, panelSilent,
  verdictFloorFromFindings, raiseVerdict, capVerdict, SEVERITY_RUNGS, isGroupId, NODE_KIND, authModeFor,
  stampCaps, CAPPING_STAMPS, effectiveDocRoles, gateCompleteness, FAN_OUT_NARROWED_STAMP,
  narrowedFanOut, briefArg, measuredUsd, blockingSilence, adjudicationFloor, admitSpend, judgmentPins,
} from './lib/decisions.mjs';
import {
  admitRun, callerRepoRoot, quorateHome, repoRunRoots, armsRoot, archivePlan, panelMirrorExclusions, ensureReviewsIgnore, reviewsIgnoreWarning, reviewsIgnoreGaps, archiveRun, archiveStagedRun, archiveEvidenceEntry, evidenceIgnoredByGit, evidenceWillBeIgnored,
} from './io/reviews-root.mjs';
import { writeRunRecord } from './io/telemetry-record.mjs';
import { bestEffort } from './lib/telemetry-record.mjs';
import { markAnswered } from './lib/call-entry.mjs';
import { spawnCapture as spawnCaptureChild, capturedStatusFields } from './io/spawn-capture.mjs';
import { stopHeldOnExit, stoppedStatusFields } from './io/stop-on-exit.mjs';
import { SIGNAL_EXIT_DEADLINE_MS } from './io/stop-child.mjs';
import { resolveFrameworkDirs, nodeInstructions } from './io/locate.mjs';
import { panelDegraded, panelUnread, preflightRefusal, panelCallFailed, schemaRoute, armUnreachableState } from './lib/reviewer-probe.mjs';
import { createSnapshot, snapshotIntentDocs } from './io/doc-snapshot.mjs';
import { REQUESTS_DIR, resolvedRequestsDir, requestStatus } from './io/project-paths.mjs';
// The vendor table (scripts/reviewers.json), so credential prefixes come from the adapter rather
// than from a name test — the same table external-review renders its argv from.
import { selectAdapters, envPrefixesOf, envNamesOf, overrideLine, familyOfCall } from './io/reviewers.mjs';
import {
  armLimitsFor, panelReadSurface, frameworkCopyReady, roleGaps,
  armsForSelection, adjudicationEnabled, rosterNodeSetting,
} from './lib/capabilities.mjs';
import { writeTextAtomic } from './io/atomic.mjs';
import { confined } from './io/confined-path.mjs';
import {
  egressReadFile, egressRunReader, refusalWords, refusedOrAbsent, REQUIRED_NOT_STARTED,
} from './io/egress-read.mjs';
import { readKeptVerdict, keepBatchReport } from './io/run-artifacts.mjs';
import { redactClaim, redactTree } from './lib/redact.mjs';
import { frameworkStamp, stampIsAttributable } from './io/version.mjs';
import { buildArmShadowPrompt, buildTieBreakPrompt, criteriaSection, BRIEF_FEEDBACK, censusSection, ARM_CENSUS_PATH } from './io/review-prompts.mjs';
import { readTemplate } from './io/template.mjs';
import { stampConsequence } from './io/stamp-notes.mjs';
import { diffAdjudications, payloadJudgedSomething, renderGroupFinding } from './lib/reconcile-diff.mjs';
import { mergeAdjudication, summariseAdjudications, renderVoteVocabulary, voteValuesFor, adjudicationBrief, disputeComposition } from './lib/adjudication.mjs';
import { runPool, runBudgetedPool } from './io/pool.mjs';
import {
  preflightInputHash, readPreflightCache, preflightDecision, preflightStamps, preflightNotChecked, checksResults,
  restorePreflightEvidence, touchPreflightCache,
} from './io/preflight-cache.mjs';
import { crashCauses, crashSummary, crashRecord } from './lib/crash.mjs';
import { reapRun } from './io/reap.mjs';
import { worktreeSha, copyTrackedInto } from './io/worktree.mjs';
import { buildArmsSurface, armsBuildDir, reclaimArmsRoot } from './io/snapshot.mjs';
import { panelSnapshotMaxBytes } from './lib/snapshot-surface.mjs';
import {
  findingScopeErrors, findingOutOfScope, declaredSurface, escapesAfterRealpath, isWithin,
  snapshotName, isDocumentName,
  requestSnapshotAdmits, relativeBelow,
} from './io/finding-scope.mjs';
import { hostPlatform } from './platform/index.mjs';
import { readExcerpt } from './io/excerpt.mjs';
import { intentInputHash, readIntentCache, writeIntentCache } from './io/intent-cache.mjs';
import { logWindow } from './lib/log-window.mjs';
import { renderTemplate } from './lib/template.mjs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { runtimeBinArg, runtimeBinArgv } from './io/runtime-bin.mjs';
import { matchesGlob } from './lib/contract-glob.mjs';
import {
  RECONCILE_MAX_GROUPS, RECONCILE_BATCH_FLOOR_MINUTES, reconcileBatches, mergeReconcilePayloads, batchFraction, batchShare, batchCharge,
  validateBatchReply, checkRootLinks, coverageGaps, RECONCILE_ARTIFACTS, reaskGroupsFile, reaskAttempts, mergeReask, reaskOutcome, notLaunchedAttempt, lastUsedReport, knownCost, knownDuration, reaskWhy, launchedBatches, batchLoopState, batchGroupsFile, reaskResumeStart,
  reconcileReusable as reconcileReusableRule,
} from './lib/reconcile-batches.mjs';
import { profileSection } from './io/project-profile.mjs';
import { resolveLinkedRun } from './lib/remediation-chain.mjs';
import { contractMinutes, minutes, timerMs } from './lib/check-timeout.mjs';
import {
  consumerLenses, mergeLenses, CONSUMER_LENS_BASIS, CONSUMER_LENS_VERDICT_CEILING,
  CONSUMER_LENS_STAMP,
} from './lib/consumer-lenses.mjs';
import { gitSync } from './io/git.mjs';

// A tie-break ruling carries `supports <node>`, a confidence, a rationale, and the adjudicator's
// not_checked[] items concatenated last. 1200 bytes was the previous bare bound and is kept: the
// number was never the defect (G-36) — truncating without a mark was.
const RULING_MAX_BYTES = 1200;

// The ask shared/external-reviewers.md mandates for EVERY brief this panel sends. The section
// stood as an inert guarantee — present-tense doc, zero emitting code (G-31) — until this
// constant; every brief writer in this file appends it, and review-prompts.mjs carries it to the
// external arms. A JSON-envelope node answers inside its schema (a not_checked entry, item
// "brief-gap"); a prose node answers inline.
// Every command key whose emptiness the contract's consequences table promises to name. The
// three not-checked assemblies iterated hand-picked subsets — ['typecheck','bench'] in the
// briefs, ['typecheck','bench','run'] at the gate — so lint, fmt_check, audit and deny vanished
// from every artifact and the gate read more complete than the run was (G-21), falsifying the
// 'named verbatim in not_checked[]' promise CLAUDE.md makes for them.
const EMPTY_KEY_CHECKS = ['lint', 'fmt_check', 'typecheck', 'bench', 'run', 'audit', 'deny', 'test_product'];

// BRIEF_FEEDBACK now has ONE owner, prompts/_templates/brief-feedback.md, read once by
// io/review-prompts.mjs (imported above; codex-prompts.mjs until G-21) and appended by
// every brief writer here AND by every external prompt builder. Two copies had already drifted
// apart once; the tie-break, which had neither, is why that mattered.

// Fails CLOSED on a value it cannot read — see the matching guard in spawn-node.mjs. `isFinite`
// let any non-numeric GRAPH_NODE_DEPTH through as "not nested", which is the one input a
// corrupted environment most likely carries.
const { raw: RAW_DEPTH, depth: PARSED_DEPTH } = nodeDepth(process.env);
// PRESENT-BUT-EMPTY IS UNREADABLE, NOT ZERO (G-6, contract-audit against I-16). `Number('')` and
// `Number(' ')` are both 0, so a value that is present and says nothing passed
// `Number.isInteger(0) && 0 >= 0` and was treated as TOP LEVEL — the guard's own header claims
// it "fails CLOSED on a value it cannot read", and the empty string is named elsewhere in this
// engine as exactly the value the previous guard mishandled. The replacement mishandled it
// identically, in all seven scripts that carry this block, and the one test for the case used
// 'yes' — which coerces to NaN and takes the other branch. Nothing in the engine emits an empty
// value, so this failed open only to a corrupted or externally supplied environment: the case
// the guard exists for.
const DEPTH = PARSED_DEPTH ?? NaN;
if (!Number.isInteger(DEPTH) || DEPTH < 0) {
  console.error(
    `ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} is not a non-negative integer — ` +
      `refusing to guess whether this is a nested run (§8).`,
  );
  process.exit(3);
}
if (DEPTH > 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${DEPTH} — a graph node may not start a graph run (§8).`);
  process.exit(3);
}

const die = (m) => { console.error(`run-graph: ${m}`); process.exit(2); };

const args = {};
{
  const a = process.argv.slice(2);
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs — the rule new-run applies (G-7 of
  // 20261020-122714-ciss-remediation-4b-review): a trailing `--only` read as [] and deselected every lens. A missing value
  // and an unknown flag are refused, naming the flag.
  let v;
  try { ({ values: v } = parseArgv(a, ARGV_SPECS['run-graph'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  if (v['run-dir'] !== undefined) args.runDir = v['run-dir'];
  if (v['repo-root'] !== undefined) args.repoRoot = v['repo-root'];
  if (v.only !== undefined) {
    args.only = v.only.split(',').map((s) => s.trim()).filter(Boolean);
    if (!args.only.length) die('--only names no lens; deselecting every lens would reach the gate having spawned nothing');
  }
  // WHETHER THE PRE-FLIGHT BARRIER RUNS. Three states, because the two that existed could not
  // express the one the operator wanted:
  //
  //   auto    (default) consult the cache; re-run only when the previous result no longer
  //           applies. "running pre-flight frequently is a bad choice" — the operator.
  //   always  run it unconditionally, the behaviour every run had before this flag existed.
  //   never   skip it, DECLARED: stamped CHECKS-SKIPPED, capped, and every declared command
  //           named in the gate's not_checked[].
  //
  // `--skip-preflight` is kept, and now honest. It was documented as "reuses an earlier barrier result" and
  // implemented as pure omission — on a fresh mint there was no earlier result at all, so the
  // gate went out silent about declared build and test having never run. The documented promise
  // of reuse now describes the DEFAULT, where it is true; the flag keeps the behaviour it always
  // had (`--preflight never`) and gains the stamp that makes it visible. Given with --preflight, the later of the two wins.
  {
    const last = (name) => a.findLastIndex((t) => t === `--${name}` || t.startsWith(`--${name}=`));
    if (v.preflight !== undefined) args.preflight = v.preflight.trim();
    if (v['skip-preflight'] && last('skip-preflight') > last('preflight')) args.preflight = 'never';
  }
  // Leave a staged run OUTSIDE the repository instead of archiving it back. The durable way to
  // say that is to declare review.reviews_dir; this is the per-run escape hatch for a review you
  // do not want in the tree at all.
  if (v['no-archive']) args.noArchive = true;
  // Reuse an intent.md already captured for this run. The hash in run.json still governs,
  // so a resumed fan-out is judged against exactly the criteria the first attempt froze.
  if (v['skip-intent']) args.skipIntent = true;
  // Force re-derivation even when the pinned inputs are unchanged. The escape hatch for
  // "I think the pinned criteria are wrong", and the way to deliberately re-sample them.
  if (v['fresh-intent']) args.freshIntent = true;
  // Re-enter a run whose orchestrator died. A node already in a terminal OK state is kept
  // as-is: its verdict was schema-validated and its report hash recorded, so re-spawning it
  // would buy nothing and would discard a result that is already accountable.
  if (v.resume) args.resume = true;
  if (v['skip-panel']) args.skipPanel = true;
  // The runtime command override spawn-node takes, passed to EVERY node this run spawns (spawnNode is the one
  // launcher): a fixture's fake runtime, so a test can observe what a node is handed (G-22 of
  // 20261001-155615-cgg-review-r3). The external arms are a different launcher and are not covered: pair it with
  // --skip-panel.
  try { args.runtimeBin = runtimeBinArg(v); } catch (e) { die(e.message); }
  // Calibration, not adjudication: spawn a SECOND reconcile on the same finding-groups and
  // diff the decisions. The first reconcile's output remains the run's output regardless.
  if (v['reconcile-twice']) args.reconcileTwice = true;
}
if (!args.runDir) die('--run-dir is required');
// A FAKE RUNTIME IS NOT MIXED WITH REAL ARMS. --runtime-bin reaches every Claude node; the external arms launch through
// external-review.mjs and would still reach their vendors, so a run half fake and half live is refused.
if (args.runtimeBin && !args.skipPanel) die('--runtime-bin overrides the node runtime only; pass --skip-panel with it');
// FAIL CLOSED ON A VALUE THIS DOES NOT UNDERSTAND. `--preflight auot` silently falling through to
// the default would be a typo that reads as a decision, and the decision it reads as is the
// permissive one. The same rule GRAPH_NODE_DEPTH is held to four scripts over.
args.preflight = String(args.preflight ?? 'auto').trim() || 'auto';
if (!['auto', 'always', 'never'].includes(args.preflight)) {
  die(`--preflight ${JSON.stringify(args.preflight)} is not one of auto, always, never`);
}

const givenRunDir = path.resolve(args.runDir);
// The tree under review. Independent of where this engine lives — see below. GIT'S TOPLEVEL of where this runs when
// --repo-root is absent (G-16 of 20261023-014400-rdt-delivery): the literal working directory judged a run from a
// subdirectory as though that subdirectory were the repository. OUTSIDE ANY REPOSITORY IT IS REFUSED (run-dir-descendants
// .plan.md stage 5; G-23 of 20261024-122231-rdt-remediation-3-review; run-dir-trust.design.md R-D1 A): the working
// directory as a fallback made wherever this happened to run the repository a run was admitted for.
const repoRoot = callerRepoRoot(args.repoRoot)
  ?? die('this is not running in a repository, so there is no repository to admit the run for; pass --repo-root');

// Where THIS engine lives, derived from this file's own location and never from `repoRoot`. The
// two were the same value while the framework sat inside its only consumer, and the code said so
// (`path.join(repoRoot, '.claude/skills/scripts')`). Separating them is what lets a known-good
// orchestrator review a broken one: `--repo-root <broken-tree>` used to load that tree's scripts,
// which are exactly the ones under suspicion.
const FRAMEWORK = resolveFrameworkDirs(
  path.dirname(fileURLToPath(import.meta.url)),
);
const { scriptsDir, skillsDir, promptsDir } = FRAMEWORK;

// THE SAME THREE CHECKS capture.mjs AND external-review.mjs ALREADY APPLY (G-26,
// panel-codex-security). --run-dir decides where every artifact of this run is written AND supplies
// the `contract` that every subsequent spawn is configured from — commands, models, reviewers, the
// declared runtime. Both leaf scripts refuse a directory that is outside the repository, that
// cannot name itself, or whose realpath leaves the tree; the ORCHESTRATOR, which hands the same
// path to both of them, only called path.resolve on it. A counterfeit directory accepted here
// redirects the writes and supplies the contract for everything downstream.
//
// Fail-closed and in this order: inside the tree lexically, resolvable through links, and carrying
// a run_id that matches its own basename. A missing run_id is not consent — it is the absence of
// the only thing that could grant it.
{
  // TWO CONTAINERS SINCE graph_contract 2, not one, and not "anywhere". Runs default to the engine's
  // own home now, so confining them to the repository refused every default run — quorate could not
  // run its own graph. Widening the check to nothing would have deleted the control instead of
  // re-basing it, and the control is why a counterfeit run directory cannot redirect the writes or
  // supply the contract.
  //
  // ADMITTED BY THE ONE OWNER since run-dir-trust (ARCHITECTURE A-28): the same containment, a run_id that is the
  // directory's real name, and the run one of this repository's runs, naming it. A run that cannot name itself is not one
  // this orchestrator may spawn from, and its contract is not an authority.
}
const admitted = admitRun({ runDir: givenRunDir, repoRoot });
if (!admitted.ok) die(`--run-dir ${admitted.why}`);
// EVERYTHING AFTER IS DONE TO THE DIRECTORY ADMITTED (G-13, G-19 of 20261023-014400-rdt-delivery): its real path, never
// the one the caller spelled, which a link could repoint between the check and the use.
const runDir = admitted.dir;
const nodesDir = path.join(runDir, 'nodes');
// THROUGH THE ONE OWNER (run-dir-descendants.plan.md stage 2): every write below the admitted run — the four write helpers
// and the direct writes further down — names its path as segments below runDir, and the owner walks each level, refusing
// a link at any of them. A path that is not below the run is refused loudly here, never written raw.
const runOwner = confined(runDir);
function belowRun(p) {
  // Below the run by containment's one owner (G-2 of 20261105-154708-crsf-remediation-5-review; G-8 of
  // 20261105-151040-crsf-remediation-4b-review: a hand-rolled `startsWith('..')` refused a descendant named `..x`).
  const segs = relativeBelow(path.resolve(runDir), path.resolve(p));
  if (!segs) throw new Error(`run-graph: ${p} is not below the run ${runDir}; a run write goes through its owner`);
  return segs;
}
const runDirOf = (p) => runOwner.dir(belowRun(p));
// AND EVERY READ BELOW THE RUN (run-dir-reads.plan.md stage 4; G-19, G-20, G-21 of 20261029-065343-rdd-remediation-2-review,
// G-9 of 20261029-134336-rdd-remediation-3-review): intent.md, the payloads, run.json, queue.json, the briefs and reports
// were read raw below the admitted directory, so a link at any level was followed. runHas asks whether a name is there,
// a refused link answering true so the read that follows refuses it by name rather than the file reading as absent;
// runRead reads through the owner; runList lists a directory below the run, or the run itself, missing as empty.
function runHas(p) { try { return runOwner.exists(belowRun(p)); } catch (e) { if (e.code === 'ECONFINED') return true; throw e; } }
const runRead = (p, encoding = 'utf8') => runOwner.read(belowRun(p), encoding);
// A RUN FILE WHOSE CONTENT REACHES A PROMPT (prompt-bound-run-reads.plan.md; operator, 2026-11-14: "One owner for
// prompt-bound run reads (Recommended)"): read through the egress owner rooted at the admitted run, which refuses a link,
// a file with a second name and a file over the egress bound. runRead stays for what only the orchestrator reads.
const promptReader = egressRunReader(runDir);
const promptRead = (p, encoding = 'utf8') => promptReader.read(Array.isArray(p) ? p : belowRun(p), encoding);
// WHAT A PROMPT-BOUND SITE HANDLES BY ITS CLASS, AND NOTHING ELSE (G-3 of 20261115-042114-pbr-1b-remediation-4-review;
// ARCHITECTURE.md A-30, operator 2026-11-15: "Tighten A-30, decline G-4/5 (Recommended)"): a refusal, and an absence, which
// A-30 puts in the same class; any other failure (EACCES, EIO) is re-thrown by every caught site, as everywhere else.
// The class is lib/egress-read.mjs's refusedOrAbsent, owned there with its words (G-28 of 20261116-221234-m2-9a-high-2).
function runList(p) { try { return runOwner.list(p === runDir ? [] : belowRun(p)); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } }
const runJsonPath = path.join(runDir, 'run.json');
const runJson = admitted.record;
// THE RUN'S OWN START (telemetry-run-time.plan.md stage 2), once: the mint is another command, often run long before, and
// its created_at counted that idle wait as run time. A --resume keeps the first start.
// Best-effort, a failure a note (G-9 of 20261027-083759-trt-remediation-review): telemetry never fails a run.
if (!runJson.graph_started_at) {
  bestEffort(() => {
    runJson.graph_started_at = new Date().toISOString();
    writeJson(runJsonPath, runJson);
  }, (why) => console.error(`run-graph: graph_started_at not recorded (${why})`));
}
const contract = runJson.contract ?? {};
const commands = contract.commands ?? {};
const review = contract.review ?? {};
const roster = JSON.parse(fs.readFileSync(path.join(scriptsDir, 'lens-roster.json'), 'utf8'));
// WHERE THE ENGINE KEEPS ITS STATE, handed to every external-review child (G-12 of 20261010-063310-reviewer-preflight-r6);
// lib/decisions.mjs's engineLocationEnv owns which keys and why.
const ENGINE_LOCATION = engineLocationEnv(process.env);

// ---------------------------------------------------------------- project-declared lenses (option 2)
//
// `lenses:` in the graph_contract lets a project add a check only it needs, without editing the
// submodule — the capability the adapter table has had for reviewers all along, on the axis that was
// missing. The caps are derived in lib/consumer-lenses.mjs and cannot be declared away; what happens
// HERE is the part that needs the repository root: proving the instructions file is inside the tree
// under review and reachable without leaving it.
//
// FATAL on a bad declaration, never dropped. A declared lens that cannot be built is a node the
// operator expected to run, and `expected.json` exists precisely so a promised node cannot vanish.
const CONSUMER = (() => {
  const { lenses: declaredLenses, errors } = consumerLenses({
    declared: contract.lenses ?? {},
    frameworkIds: [
      ...(roster.lenses ?? []).map((l) => l.id),
      ...(roster.barrier_nodes ?? []).map((n) => n.id ?? n),
    ].filter(Boolean),
  });
  const fatal = [...errors];
  const ok = [];
  for (const lens of declaredLenses) {
    const abs = path.resolve(repoRoot, lens.instructions_rel);
    if (!isWithin(repoRoot, abs) || escapesAfterRealpath(repoRoot, abs)) {
      fatal.push(`lenses['${lens.id}'].instructions ${lens.instructions_rel} resolves outside the `
        + 'repository under review, or leaves it through a link — a node is never instructed by a file '
        + 'this run cannot account for');
      continue;
    }
    if (!fs.existsSync(abs)) {
      fatal.push(`lenses['${lens.id}'].instructions ${lens.instructions_rel} does not exist`);
      continue;
    }
    ok.push({ ...lens, instructions_abs: abs });
  }
  if (fatal.length) {
    die(`the graph_contract declares ${declaredLenses.length + errors.length} project lens(es) and `
      + `${fatal.length} cannot be used:\n  - ${fatal.join('\n  - ')}`);
  }
  return ok;
})();

// ONE merged list, so the seven readers of the lens set cannot disagree about which lenses exist.
const LENSES = mergeLenses(roster.lenses ?? [], CONSUMER);
if (CONSUMER.length) {
  runJson.stamps = [...new Set([...(runJson.stamps ?? []), CONSUMER_LENS_STAMP])];
  writeJson(runJsonPath, runJson);
  console.log(`\nproject lenses: ${CONSUMER.map((l) => l.id).join(', ')} — capped at basis `
    + `${CONSUMER_LENS_BASIS.join('|')} / verdict ${CONSUMER_LENS_VERDICT_CEILING}, never required`);
}
// A NAME IN --only THAT MATCHES NO LENS IS A TYPO, AND A TYPO MUST NOT READ AS A DECISION.
//
// `--only` filters by string equality, so an id nothing matches deselected EVERYTHING and the run
// reached a gate having spawned nothing. Measured: `--only arch-reveiw` produced
// `# Gate — PASS · every node reported`, $0, zero lenses — a clean bill of health from a
// transposition. The flag was an expert's escape hatch when that was written; /invoke makes it the
// common path, which is what turns a sharp edge into a trap.
//
// Fail closed and name the alternatives, the same rule GRAPH_NODE_DEPTH and --preflight are held to.
// Checked against LENSES rather than the roster alone so a project's own declared lens is invokable
// by its own name.
if (args.only) {
  const known = new Set(LENSES.map((l) => l.id));
  const unknown = args.only.filter((id) => !known.has(id));
  if (unknown.length) {
    die(`--only names ${unknown.map((u) => JSON.stringify(u)).join(', ')}, which no lens in this run matches.\n`
      + `  Available: ${[...known].join(', ')}\n`
      + '  Deselecting every lens would reach the gate having spawned nothing, and a gate that '
      + 'reviewed nothing must not be reachable by a typo.');
  }
}

// The run's OWN table: built-in adapters plus anything this project declared under `reviewers:`,
// read from the contract this run froze at mint. run-graph uses it for one thing — which credential
// prefixes an arm may inherit (envPrefixesOf) — and a declared vendor missing from here would have
// been spawned with NO credentials and reported as an authentication failure, which is the shape a
// broken transport also has.
// Chosen by the one owner (contract-runtime-and-session-files.plan.md stage 1), from the FROZEN contract.
const ADAPTERS = selectAdapters({ contract });
const REVIEWER_TABLE = ADAPTERS.table;
// The runtime graph nodes run on (A-9): the frozen review.runtime, else the table's default. It names the family of a
// finding with no adapter source (stage 1's family rule), and every node is spawned on it (`--runtime` below).
let NODE_RUNTIME;
try { NODE_RUNTIME = ADAPTERS.runtime; } catch (e) { die(e.message); }
// WHICH BUILT-INS THIS RUN'S CONTRACT OVERRIDES (reviewer-credential-routing stage 2, A-26). Derived
// from the contract the run froze, not recorded at mint, so a run minted before this field existed and
// a --resume both get the answer. The gate names them; no stamp, no ceiling.
const REVIEWER_OVERRIDES = ADAPTERS.overrides;

const CONCURRENCY = Math.max(1, Number(review.concurrency ?? 3));
// Each limit through contractMinutes, which refuses what Number() coerced: `true` was a one-minute limit on every lens
// (G-11 of 20261021-194056-ciss-d1-remediation-3-review).
const minutesOf = (key, fallback) => {
  try { return contractMinutes(review, key, fallback); } catch (e) { return die(e.message); }
};
// Absent: the owner's one default, 30 (code-index-d1-part-a.plan.md stage 2; it was 15 here and 30 in spawn-subagent).
const NODE_TIMEOUT = minutesOf('node_timeout_minutes');
// A roster lens's and arm's limits through the same owner: neither was validated, and an arm's non-numeric value reached
// spawnCapture as NaN, which sets no timer at all (design note, part 1).
const rosterMinutes = (key, value, fallback) => {
  try { return minutes(key, value, fallback); } catch (e) { return die(e.message); }
};
const lensMinutes = (lens) => rosterMinutes('roster.lens.timeout_minutes', lens?.timeout_minutes, NODE_TIMEOUT);
const armMinutes = (arm, lens) => rosterMinutes('roster.arm.timeout_minutes', arm.timeout_minutes, lensMinutes(lens));
// The barrier's own ceiling, mirroring budget_usd_per_barrier for the identical reason: the
// reconciler reads every lens — and, with the panel enabled, every arm — at once, and
// legitimately costs more time than a lens. The first six-arm run proved it the hard way:
// 47 groups against a 15-minute cap killed reconcile at 900s when 31 groups had already taken
// 11.5 minutes, and the whole adjudication died of a limit sized for a single lens. Default
// 2x the node timeout; declare review.barrier_timeout_minutes to pin it.
const BARRIER_TIMEOUT = minutesOf('barrier_timeout_minutes', NODE_TIMEOUT * 2);
// intent-capture gets its own ceiling for the same reason the barrier does: its cost scales with a
// DIFFERENT VARIABLE. A lens is bounded by scope — it reads the declared files however much it
// finds. intent-capture is bounded by DOC VOLUME: it reads every declared document in full to
// derive the criteria, so growing the doctrine grows this node and nothing else. Observed: 12
// minutes on one run, then killed at the 15-minute node cap on the next after ~40 lines were added
// to shared/**, taking the whole run's criteria with it. Default 2x the node timeout; declare
// review.intent_timeout_minutes to pin it.
const INTENT_TIMEOUT = minutesOf('intent_timeout_minutes', NODE_TIMEOUT * 2);
// A budget key set to "" or "none" means UNCAPPED — no dollar ceiling is enforced and the child
// is spawned with no --budget-usd flag at all. This is a deliberate operator choice (the caps were
// never requested; the operator asked to run uncapped), distinct from the key being ABSENT, which
// still falls back to the conservative default so a consumer who copies the template stays bounded.
// new-run.mjs stamps the run UNCAPPED-BUDGET and names it in not_checked so an uncapped run never
// looks the same as a bounded one at the gate. Infinity compares correctly in every `spent >= CAP`
// test below (nothing is ever >= Infinity), so the guards simply never fire.
// budgetOf THROWS on an unparseable value rather than silently uncapping (G-21). Catch it here so
// the operator gets one clear line naming the offending key, not a stack trace.
const budgetKey = (k, dflt) => {
  try { return budgetOf(review[k], dflt); }
  catch (e) { console.error(`run-graph: review.${k} — ${e.message}`); process.exit(2); }
};
const BUDGET_NODE = budgetKey('budget_usd_per_node', 2.5);
// The barrier gets its own budget because its cost scales with a different variable. A lens is
// bounded by SCOPE — it reads the same files however much it finds. reconcile is bounded by how
// much every lens FOUND: it judges each group, so a wide sweep can hand it many times the work a
// narrow one does. Observed: a 7-lens sweep produced 46 groups and exhausted the $2.50 node cap
// mid-adjudication, returning BLOCKED with every lens having succeeded — the run paid for seven
// reviews and got no verdict on them.
const BUDGET_BARRIER = budgetKey('budget_usd_per_barrier', Number.isFinite(BUDGET_NODE) ? Math.max(6, BUDGET_NODE * 2.5) : Infinity);
const BUDGET_RUN = budgetKey('budget_usd_per_run', 12);
// FROM CONFIG, NEVER A LITERAL (G-50). `?? 'opus'` put a model name in the orchestrator, which is
// the one class of fact this repository has decided will not live in a script. The contract is where
// a project sets it; lens-roster.json's `default_models` is what an ABSENT key falls back to.
// Resolved by judgmentPins (lib/decisions.mjs), the one owner of this fallback, shared with spawn-subagent.mjs.
let JUDGMENT_PINS;
try { JUDGMENT_PINS = judgmentPins(review, roster); } catch (e) { die(e.message); }
const JUDGMENT_MODEL = JUDGMENT_PINS.model;

// Effort is a dial, not a constant. It belongs in the contract next to `models` for the same
// reason `models` does: it changes cost and finding quality on every node, so it needs one place
// to move rather than a literal buried in a spawn call. Measured on this repo at contract-audit:
// high 7/9 recall $1.79 in 21 turns, xhigh 8/9 at $1.65 in 14 turns, max 9/9 at $1.98 — higher
// effort planned better, so it was both cheaper and stronger than the default it replaced.
// Undefined means "send no --effort and take the CLI default", which is what every run before
// this key existed did.
// Only `judgment` is read: every node this orchestrator spawns is a judgment node. There is no
// `mechanical` counterpart here on purpose — declaring one nothing reads is the inert guarantee
// doc-consistency-review exists to catch. Add it when a mechanical node exists to consume it.
//
// The fallback is an explicit value, not "send no --effort". Omitting the flag would take the
// CLI's ambient default, which makes a run's depth a property of the machine it ran on and
// records `effort: null` in the status file — an unreproducible finding, which is the attribution
// problem this system exists to prevent. 'high' mirrors the CLI's own documented default, so
// behaviour is unchanged for a repo that declares nothing; it is merely now written down. If the
// CLI default ever moves, this diverges visibly instead of shifting every run silently.
const JUDGMENT_EFFORT = JUDGMENT_PINS.effort;

// The substitution above is deliberate (attribution needs an explicit value, never the CLI's
// ambient default) — but a defaulted configuration must stay DISTINGUISHABLE from a declared one:
// expected.json and every status file used to record opus/high as though somebody wrote them,
// and nothing marked the run as configured by fallback (G-19). Recorded on run.json, where an
// auditor reading only the artifacts can see it.
{
  const substituted = [];
  // The RESOLVED values, not literals (G-16 of 20260929-225147-m0-gate-review): the record named 'opus' whatever
  // lens-roster.json's default_models said, so it would have been wrong the day the roster moved.
  substituted.push(...JUDGMENT_PINS.substituted);
  // The SAME defaults_substituted mechanism now covers every silently-derived review value, not
  // just model and effort (G-23): a consumer raising budget_usd_per_node moved the barrier stop
  // from $6 to $10 with no artifact recording it. Record the effective derived value.
  if (review.budget_usd_per_barrier === undefined) substituted.push(`review.budget_usd_per_barrier -> $${BUDGET_BARRIER}`);
  if (review.barrier_timeout_minutes === undefined) substituted.push(`review.barrier_timeout_minutes -> ${BARRIER_TIMEOUT}m`);
  if (review.budget_usd_per_node === undefined) substituted.push(`review.budget_usd_per_node -> $${BUDGET_NODE}`);
  if (review.budget_usd_per_run === undefined) substituted.push(`review.budget_usd_per_run -> $${BUDGET_RUN}`);
  // WHO MAY LAUNCH commands.run, written into the run so the enforcement point can read it (G-5).
  // The identity was the bare literal 'feature-verify' in two modules that never communicate:
  // capture.mjs enforced it and this file granted it in the brief, while lens-roster.json — which
  // declares every other per-lens property — declared nothing. Renaming the lens there left both
  // literals pointing at a node that does not exist, silently granting the run command to nobody.
  //
  // capture cannot read the roster (it is the small enforcement script and run.json is its only
  // authority), so the roster's answer travels through run.json, which capture already trusts.
  {
    // FROM THE ROSTER ALONE, NOT THE MERGED LIST. `may_launch_run` is permission to launch the project's
    // own `commands.run` — a capability the FRAMEWORK grants, and the one thing a project-declared lens
    // must not be able to acquire by declaring itself. Reading the merged list here would have made
    // that a question about validation; reading the roster makes it impossible.
    const runners = (roster.lenses ?? []).filter((l) => l.may_launch_run).map((l) => l.id);
    if (JSON.stringify(runJson.runner_nodes ?? null) !== JSON.stringify(runners)) {
      runJson.runner_nodes = runners;
      writeJson(runJsonPath, runJson);
    }
  }

  if (substituted.length) {
    runJson.defaults_substituted = substituted;
    // writeJson (tmp+fsync+rename), like the six other writers of this path: a bare writeFileSync
    // truncates first, and run.json is the run's only durable record of the frozen contract and
    // intent sha — an interruption inside that window bricked every later invocation including
    // --resume (G-12). writeJson is hoisted, so there was never a reason not to.
    writeJson(runJsonPath, runJson);
    console.log(`defaults substituted (undeclared in the contract): ${substituted.join(', ')}`);
  }
}

runOwner.dir(['nodes']);

// ---------------------------------------------------------------------------- helpers
const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

function conditionMet(cond) {
  if (!cond || cond.type === 'always') return true;
  // A `run.` prefix resolves against THIS RUN rather than the contract. Some conditions are facts
  // about the run, not about the repository: `doc_roles.request` says a request is declared as a
  // concept, `run.request` says this particular run actually has an approved one. A lens gated on
  // the former would still be selected on a run that has none.
  const v = cond.key.startsWith('run.')
    ? get(runJson, cond.key.slice(4))
    : get(contract, cond.key);
  if (cond.type === 'nonempty') return !isEmpty(v);
  if (cond.type === 'empty') return isEmpty(v);
  if (cond.type === 'not_equal') return v !== cond.value;
  if (cond.type === 'equal') return v === cond.value;
  die(`unknown condition type: ${cond.type}`);
}

// BOTH HOMES. The twelve node contracts live in prompts/ and the ten a person invokes live in
// skills/; a node is installed if its instructions exist in either. Checking only skills/ after the
// split would have reported every lens as not installed, which the roster renders as SKIPPED with a
// skip_reason — a run that silently reviewed nothing while reporting cleanly.
const skillInstalled = (id) => Boolean(nodeInstructions(FRAMEWORK, id));

// Did intent.md still hash to what new-run froze? ONE owner, because the answer was previously
// computed only deep inside the barrier block — under `groupsOut.length` and again under "the
// reconciler wrote a payload" — so a run where every lens reported CLEAN produced no groups, skipped
// the block, and never asked. That is the run that emits PASS: the check existed on every path
// where it could only downgrade an already-bad verdict, and was missing from the one path where it
// decided between PASS and BLOCKED (G-50).
//
// Rehashed by SCRIPT, never taken from the reconciler's boolean: "did the criteria move mid-flight?"
// is the one question that voids a run, and asking the model whose criteria they are is exactly the
// delegation §2 forbids.
function intentIsIntact() {
  if (!runJson.intent_sha256) return true; // nothing was frozen, so nothing can have drifted
  const p = path.join(runDir, 'intent.md');
  if (!runHas(p)) return false;
  return crypto.createHash('sha256').update(runRead(p, null)).digest('hex') === runJson.intent_sha256;
}

// Where the doctrine actually is, RESOLVED for this mount. Fifteen SKILL.md files hardcoded
// `.claude/skills/shared/disk-first-protocol.md`, a path that exists in neither layout: in this
// checkout the doctrine is at `shared/`, and under the documented consumer mount it is at
// `.claude/skills/quorate/shared/`. spawn-node inlines SKILL.md verbatim into every node prompt,
// so that was the INSTRUCTION SET, not prose about it — a literal-minded node looked for a file
// that was not there and skipped the document defining the severity ladder, the evidence rule and
// the finding shape, in every run (G-63). No literal can be correct in both layouts, so the brief
// carries the resolved path and the skills defer to it.
//
// RESOLVED ONCE, AND THE DIRECTORY IS KEPT (G-64). The intent sandbox snapshots the doctrine so a
// sandboxed node can read what its brief points at — and it resolved that directory from its OWN
// list, which disagreed with this one on the middle entry: this probes the documented consumer
// mount `.claude/skills/quorate/shared`, that probed the ANCESTOR ENGINE's `.claude/skills/shared`.
// So a node could be TOLD one doctrine path and GIVEN a snapshot of a different directory.
//
// That divergence was the only thing that made a consumer's `.claude/skills/shared` reachable at
// all, and it is why `shared` sat on the "legacy engine" watch list. One owner now, so there is
// nothing to disagree with — and the snapshot inherits this resolution's content check rather than
// trusting a directory because of its name.
const DOCTRINE_DIR = [
  path.resolve(FRAMEWORK.frameworkRoot, 'shared'),
  path.resolve(repoRoot, '.claude/skills/quorate/shared'),
  path.resolve(repoRoot, 'shared'),
].find((d) => fs.existsSync(path.join(d, 'disk-first-protocol.md'))) ?? null;

const DOCTRINE_PATH = DOCTRINE_DIR
  ? `${path.relative(repoRoot, DOCTRINE_DIR).split(path.sep).join('/') || '.'}/disk-first-protocol.md`
  : '(doctrine not found — say so in not_checked[] rather than inventing a path)';

function writeJson(p, obj) {
  // Durable JSON, as the one home for it writes it (io/atomic.mjs, G-10): a temporary file and a rename, now through the
  // owner's atomic replace. This wrapper stays so the fifty call sites keep their name.
  runOwner.replace(belowRun(p), `${JSON.stringify(obj, null, 2)}\n`);
}

// TRACKED WRITES PASS THROUGH THE ONE REDACTION OWNER (ledger-trust-boundaries 1b). reconciled.md, the reports,
// finding-groups.json, the gate files and intent.md are committed with the run, and they quote what lenses and
// vendors wrote — a finding about a leaked credential tends to quote it. Machine data (run.json, expected.json,
// checks.json) and evidence/ (gitignored) are written raw; tests/regression-ledger-trust-boundaries-writes
// names those targets, so a raw write of anything else fails there until it is classified.
function writeTracked(p, text) {
  runOwner.replace(belowRun(p), redactClaim(text));
}
function writeTrackedJson(p, obj) {
  runOwner.replace(belowRun(p), `${JSON.stringify(redactTree(obj), null, 2)}\n`);
}
// An append as appendTextAtomic made it: read what is there, write it back with the addition, atomically.
function appendTracked(p, text) {
  const segs = belowRun(p);
  runOwner.replace(segs, (runOwner.isFree(segs) ? '' : runOwner.read(segs)) + redactClaim(text));
}

function writeStatusStub(nodeId, state, extra = {}) {
  writeTrackedJson(path.join(nodesDir, `${nodeId}.status.json`), {
    schema_version: 1, run_id: runJson.run_id, node_id: nodeId, state,
    started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
    // A stub USUALLY describes a node that was never spawned. `launched` is stated explicitly
    // rather than inferred from `started_at`, which a stub also carries — inferring from the
    // timestamp made the budget charge the per-node cap to SKIPPED nodes that cost nothing, and a
    // full sweep reported $24.02 against $19.33 actually spent.
    //
    // It is a DEFAULT, not a constant: `...extra` is spread last precisely so a caller that knows
    // better can correct it. recordStoppedChild is that caller — the nodes it stubs were definitively
    // spawned and definitively cost money, and recording them as unlaunched made the budget charge
    // an interrupted run $0 for work it had already paid for. Same accounting failure this comment
    // documents being fixed, reintroduced through the one path that stubs live children.
    launched: false,
    graph_node_depth: 1, validator_errors: [], findings_count: 0, ...extra,
  });
}

// ---------------------------------------------------------------------------- expected.json
const scopePaths = runJson.scope?.paths ?? [];

// Wrapped in a function because it runs more than once: a precondition recovered mid-run (a
// request drafted for a run that started without one) changes which conditions are met, and a
// lens gated on the recovered key must become selected. Deriving once would leave it SKIPPED for
// the rest of the run, which would make the recovery pointless.
function deriveExpected() {
const expected = [];

for (const lens of LENSES) {
  const met = conditionMet(lens.condition);
  // A PROJECT-DECLARED LENS IS "INSTALLED" WHEN ITS OWN INSTRUCTIONS EXIST. `skillInstalled` asks the
  // FRAMEWORK — correct for every lens quorate ships, and structurally unable to see a lens whose
  // instructions live in the consumer's tree. Without this the lens was derived, capped, stamped and
  // then silently `present: false`: the run printed "project lenses: …" and spawned none of them,
  // which is the worst of both, a declared node that vanishes with no row explaining why. The
  // existence and containment of that file were already proved at load, so this reads the result
  // rather than re-deciding it.
  const installed = lens.consumer ? Boolean(lens.instructions_abs) : skillInstalled(lens.id);
  const selected = !args.only || args.only.includes(lens.id);

  let skip_reason = null;
  if (!selected) skip_reason = 'not selected by --only';
  else if (!met) skip_reason = `condition not met: ${JSON.stringify(lens.condition)}`;
  else if (!installed) {
    skip_reason = `skill not installed (${lens.status}): .claude/skills/${lens.id}/SKILL.md absent` +
      (lens.deferred_reason ? ` — ${lens.deferred_reason}` : '');
  }

  // A lens whose condition is unmet is not "required" in any meaningful sense.
  let degraded = lens.degrade_when ? conditionMet(lens.degrade_when) : false;
  // `degraded_ceiling` in the roster is a VERDICT ("this lens may not conclude FAIL"). It was
  // being written into severity_ceiling and passed to --severity-ceiling, where a rung check
  // silently discarded it — so degraded lenses ran uncapped while every artifact said otherwise.
  // A PROJECT-DECLARED LENS IS CAPPED HERE, NOT MERELY IN ITS DECLARATION. The entry carries
  // `verdict_ceiling: 'RISK'`, and this row is built from the degradation rules alone — so the row
  // went out with `verdict_ceiling: null`, the spawner passed no `--verdict-ceiling`, and the cap the
  // engine advertises for project lenses existed only in a constant and a log line. Measured in the
  // fixture: the lens happened to answer RISK by its own choice, which is exactly how a cap that does
  // nothing looks like a cap that works. `lens.verdict_ceiling` is consulted first, and the degraded
  // path can still lower it further but never raise it.
  let verdictCeiling = lens.verdict_ceiling ?? (degraded ? (lens.degraded_ceiling ?? null) : null);
  let severityCeiling = degraded ? (lens.degraded_severity_ceiling ?? null) : null;
  let notCheckedOverride = null;

  // A recovered request is an INFERENCE about what someone wanted, reconstructed from the docs by
  // a model that was not allowed to see the code. That is enough to review against and not enough
  // to fail a build on: if the inference is wrong, the lens is measuring the drafter's guess, not
  // the developer's mistake. So conformance findings against an inferred request are capped at
  // RISK, and the gap is named in not_checked rather than left for a reader to notice that
  // `status: inferred` appears somewhere in run.json.
  //
  // Without this the recovery would be strictly worse than the failure it replaces — a run that
  // stops is honest about knowing nothing, while a run that invents criteria and then enforces
  // them at BLOCKER has laundered a guess into an authority.
  if (lens.intent === 'required' && runJson.request?.status === 'inferred') {
    degraded = true;
    verdictCeiling = 'RISK';
    // MEDIUM, and this is the half that was missing. The verdict cap alone stopped the node
    // concluding FAIL, but individual findings still arrived at the barrier marked HIGH — judged
    // against criteria no human ever confirmed. A finding cannot be more certain than the
    // requirement it is measured against.
    severityCeiling = 'MEDIUM';
    notCheckedOverride = {
      item: 'human-approved request',
      reason: `no approved request existed; criteria were inferred from documentation by ` +
        `request-capture (${runJson.request.path}) and never confirmed by a person`,
    };
  }

  expected.push({
    node_id: lens.id,
    skill: lens.skill_command,
    // A PROJECT-DECLARED lens is instructed by a file in the consumer's tree, proved contained above.
    // Carried on the expected row so the spawn reads it from the run's pre-commitment record rather
    // than re-deriving it, and so `nodes/expected.json` states which lenses were project-authored.
    ...(lens.consumer ? { consumer: true, instructions: lens.instructions_abs } : {}),
    kind: NODE_KIND.lens,
    required: Boolean(lens.required) && met && selected,
    // WHAT THE ROSTER SAYS, beside what this run resolved. `required` above is a fact about THIS
    // RUN and is correctly false for a lens nobody asked to run — it is what the BLOCKED rule reads,
    // and it must not change. But the gate rendered that value under a column headed "Required",
    // so `--only arch-review` printed `| contract-audit | no | SKIPPED |` for a lens the roster
    // declares required:true. The table stated something false about the roster in order to state
    // something true about the run. Both facts fit; only one was carried.
    required_by_roster: Boolean(lens.required),
    present: Boolean(met && installed && selected),
    // DESELECTED BY THE OPERATOR, distinct from a condition the contract did not meet. The gate
    // needs the difference: an unmet condition is the contract describing this project, while a
    // deselection is a person narrowing this run, and only the second is a choice a reader may
    // want to revisit.
    deselected: Boolean(args.only) && !selected,
    // Would this lens have run if nobody had narrowed the fan-out? Deselecting a lens whose
    // condition the contract does not meet costs nothing, so the narrowing stamp must not fire for
    // it — otherwise the signal appears on runs that lost nothing and stops meaning anything.
    would_have_run: Boolean(met && installed),
    degraded,
    allowed_basis: degraded && lens.degraded_basis ? lens.degraded_basis : lens.allowed_basis,
    verdict_ceiling: verdictCeiling,
    severity_ceiling: severityCeiling,
    not_checked_override: notCheckedOverride,
    severity_floor: degraded ? (lens.degraded_severity_floor ?? null) : null,
    schema_variant: lens.schema_variant,
    intent: lens.intent,
    // Optional per-lens overrides, resolved here so expected.json records the model and depth a
    // run ACTUALLY used — reproducing a finding needs both, and re-deriving them later from a
    // contract that has since moved is exactly the attribution problem this system exists to
    // avoid. Measured reason to want per-lens control: on this repo Sonnet-5 at xhigh produced
    // per-claim evidence where Opus reused one whole-project log, while Opus at max had the best
    // recall — so an evidence-heavy lens and a recall-heavy lens genuinely want different rows.
    model: lens.model ?? JUDGMENT_MODEL,
    effort: lens.effort ?? JUDGMENT_EFFORT,
    // Per-lens clock, declared in the roster beside model and effort rather than hardcoded here.
    // A lens whose cost scales with a DIFFERENT VARIABLE than scope needs its own ceiling, the
    // same argument the barrier and intent-capture already won: feature-verify's cost is product
    // startup plus exercise time, and it was killed at the 15-minute node cap after 14 real
    // evidence captures on the first consumer run that ever exercised it.
    timeout_minutes: lens.timeout_minutes === undefined ? null : lensMinutes(lens),
    skip_reason,
  });
}

return expected;
}

const expected = deriveExpected();

// A NARROWED FAN-OUT IS A FACT ABOUT THE VERDICT, AND THE GATE SAID NOTHING ABOUT IT.
//
// `--only ui-audit` on this repository produced `# Gate — PASS · every node reported` having
// spawned zero lenses for $0. Each part was defensible on its own: `required` is false for a lens
// nobody asked to run, so `did_not_report` is empty, so completeness reads "every node reported".
// The composite is a clean bill of health for a review that did not happen.
//
// It is stamped rather than capped, and the three precedents are exact: UNSWEPT-DIFF,
// UNCAPPED-BUDGET and CONTRACT-PARTIAL are all declared operator choices that permit PASS and print
// their provenance. Narrowing the fan-out is the same kind of thing — the lens that ran is as good
// as it is in a full review, which is the operator's own ruling on /invoke ("the cap exists for
// reviewers that cannot produce a verifiable evidence path; a lens with a run directory can").
// What must not survive is a headline claiming more than the run examined.
//
// Only a lens that WOULD have run counts. Deselecting a lens whose condition the contract does not
// meet costs nothing, and stamping for it would make the signal fire on runs that lost nothing.
const deselectedLive = narrowedFanOut(expected);
if (deselectedLive.length) {
  runJson.stamps = [...new Set([...(runJson.stamps ?? []), FAN_OUT_NARROWED_STAMP])];
  writeJson(runJsonPath, runJson);
  console.log(`\nfan-out narrowed to ${expected.filter((e) => e.present && e.kind === NODE_KIND.lens)
    .map((e) => e.node_id).join(', ') || '(nothing)'} — `
    + `${deselectedLive.length} lens(es) deselected that would otherwise have run`);
}

// Panel arm rows join expected.json BEFORE anything launches (G-30): expected.json is the run's
// pre-commitment record of "which nodes were SUPPOSED to run — lenses and arms alike", and a
// budget abort or SIGINT mid-fan-out must not leave a record that names none of six configured
// arms. Every input to panelArmsFor() is known here, so nothing forced the old deferral to after
// the fan-out. panelArmsFor is a hoisted declaration, callable now.
// One builder for panel-arm rows, so EVERY writer of expected.json includes them — the initial
// registration here AND rederiveExpected() after recovery. The pre-fan-out registration (G-30)
// pushed rows once, but rederiveExpected zeroed `expected` and refilled from deriveExpected()
// (lenses only), erasing every arm row on the recovery path — which fires whenever doc_roles.request
// is empty, this repo's own state (G-18). A missed builder in one of two writers is the class this
// centralises away.
/**
 * What an arm may claim, and how hard it is capped — derived, then tightened by any roster
 * declaration. `cap_reason` rides along so an auditor can answer "why was this capped" from the
 * artifact instead of from the engine.
 */
function armLimits(arm, role = 'arm') {
  // THE LADDER FROM THE ROSTER, beside the models and efforts. What a kind of evidence is WORTH is
  // a judgement, and one nobody can change without editing the engine is indistinguishable from a
  // law (basis_ceilings, lens-roster.json).
  return armLimitsFor(REVIEWER_TABLE[arm.reviewer], arm, { ladder: roster.basis_ceilings, role });
}

function panelArmRows() {
  const lenses = LENSES;
  return panelArmsFor().map((arm) => ({
    node_id: arm.id, skill: null, kind: NODE_KIND.arm, required: false, present: true,
    degraded: false,
    // DERIVED FROM WHAT THE RUNTIME CAN SUBSTANTIATE, not assigned because it is a third party.
    //
    // `allowed_basis: ['convention']` and the ceilings 'MEDIUM'/'RISK' were literals here, and they
    // are the right values for every adapter that ships — but they were unreachable by any adapter,
    // so the framework could not tell "this runtime cannot produce verifiable evidence" from "this
    // runtime is not ours". Only the first is a property of anything. An adapter that can run
    // capture.mjs inside the run directory and cite what it printed has earned `measurement` by the
    // same §4 rule that governs a Claude lens; its vendor is not the question.
    //
    // The roster may TIGHTEN a severity ceiling but never loosen it: an operator capping an arm harder
    // is a decision, and an operator raising a cap above what the basis supports gets the finding
    // REJECTED downstream rather than honoured — a declared ceiling the run cannot apply is exactly the
    // artifact-lies shape this file already corrected once (G-14). A verdict ceiling is fixed; mint
    // refuses any other value. shared/adapter-contract.md owns the reasoning.
    ...armLimits(arm),
    // The clock each arm actually gets, recorded before it runs: an arm inherits its shadowed lens's
    // timeout, because it reviews the same surface against the same criteria.
    timeout_minutes: armMinutes(arm, lenses.find((l) => l.id === arm.shadows)),
    severity_floor: null, schema_variant: 'code', intent: 'forbidden',
    reviewer: arm.reviewer, model: String(arm.model ?? '').trim() || null,
    effort: String(arm.effort ?? '').trim() || null, skip_reason: null,
  }));
}
expected.push(...panelArmRows());

writeJson(path.join(nodesDir, 'expected.json'), {
  run_id: runJson.run_id,
  written_at: new Date().toISOString(),
  derivation: 'deterministic: lens-roster.json x graph_contract; no model involved. Panel-arm rows included pre-fan-out.',
  expected,
});

// Never overwrite a node that already reached a terminal state. Re-entering a run directory with
// a different --only used to stamp SKIPPED over every unselected node, destroying the OK verdicts
// and cost records of nodes that really ran — the run's only durable trail, and the artifact the
// whole disk-first protocol exists to preserve. The second invocation looked like a clean run of
// two lenses; the evidence that six others had reported was simply gone.
for (const e of expected) {
  if (e.present) continue;
  const existing = statusPresent(e.node_id)
    ? readStatus(e.node_id)
    : null;
  if (existing && existing.state && existing.state !== 'SKIPPED') {
    console.log(`run-graph: keeping prior ${existing.state} status for ${e.node_id} (not selected this pass)`);
    continue;
  }
  writeStatusStub(e.node_id, 'SKIPPED', { skip_reason: e.skip_reason });
}

// Declared here, populated at the barrier. writeGate() is reachable from the pre-flight failure
// path, which runs before the barrier — leaving these in the temporal dead zone would turn a
// clean "barrier failed" exit into a ReferenceError.
const buckets = { ok: [], did_not_report: [], not_checked: [], orphan_reports: [] };
let reconcileState = 'SKIPPED';
let reconcileBatched = false;   // set at the barrier: more groups than one reconcile reply carries
let calibrate = false;   // --reconcile-twice ran: unbatched, and the run budget admitted it (G-9)
let reconcileAlreadyNamed = [];   // ids a batch's validation already named, so the render's check skips them
// Each batch's "left these unjudged" entry, with its ids kept as data, so the re-ask updates it without parsing its
// sentence (G-11 of 20261023-224259-rmg-delivery).
const batchUnjudged = new Map();
// The groups a reply left out and the re-ask's result (reaskMissing); declared here, before any gate can render.
// The re-ask attempt made in THIS invocation, if any: the render and the second-opinion reuse rule read it. What a run
// records is the status's `reask` list (reaskAttempts), which the gate reads (reconcile-reask-shape.plan.md stage 2).
let reaskThisInvocation = null;
// Hoisted so writeGate can read it even on the pre-flight-failure path (called before the barrier
// stage assigns it). Empty until the barrier builds the groups; empty means "no findings to
// adjudicate", which is a legitimate reason for the reconciler to be SKIPPED, not silent (G-51).
let groupsOut = [];
// Hoisted for the same reason, and it was NOT: declared beside the panel check at the barrier, it
// sat in the temporal dead zone for writeGate's pre-flight-failure call — turning a clean
// "barrier failed; nothing was spawned" exit into `ReferenceError: Cannot access 'panelWasSilent'
// before initialization`. The comment three lines up states the rule; the code broke it the same
// day (G-40, code-audit). Every flag writeGate reads belongs in this block, not where it is set.
let panelWasSilent = false;
// Hoisted for exactly the reason the comment above gives, and stated because I nearly repeated the
// mistake one commit earlier: the adjudication block runs at the barrier and writeGate reads this on
// the pre-flight failure path, which the barrier never reaches. Declared here, set there. `null`
// means no adjudication happened, which is different from one that adjudicated nothing.
let adjudicationSummary = null;
// Same block, same reason: writeGate reads it on the pre-flight failure path, which never reaches
// the barrier where it is set.
let adjudicationCrashed = null;

// ---------------------------------------------------------------------------- briefs
// A newline, named. Written as `String.fromCharCode(10)` in a couple of places already for the same
// reason: an escaped newline does not survive every editing route this file has been through.
const NL = String.fromCharCode(10);

// THE CENSUS OF THE REMEDIATION THIS REVIEW FOLLOWS (observation-guard-and-sibling-census.md, B), read once: every lens
// is pointed at the same report. Only its path and counts reach the tracked brief (lib/review-prompts censusSection).
//
// FOUND BY ITS run_id (G-4 of 20261017-031552-ogsc-review): the link's run_dir is where the remediation was when the link
// was recorded, and it is archived after; read straight from there, a moved run lost its census and a reused directory
// showed another remediation's. resolveLinkedRun is the identity check remediate.mjs's chain walk already uses.
//
// AND COPIED INTO THIS RUN (G-5): a staged remediation sits outside the repository, and a lens may read only the
// repository and its own run. The copy is evidence, on the ignored side, so the node's text stays out of the brief.
// CONTEXT INPUTS LEFT OUT (prompt-bound-run-reads.plan.md stage 1b): a refused context input does not stop the node it
// adds to, so the gate names it in not-checked, as the brief names it to the node. DECLARED ABOVE THE CENSUS (G-5 of
// 20261115-013659-pbr-1b-delivery): REMEDIATION_CENSUS runs at module load and pushes here, and declared below it the
// push threw a temporal-dead-zone ReferenceError, killing the orchestrator before any gate.
const contextRefusals = [];
const REMEDIATION_CENSUS = (() => {
  const follows = runJson.follows_remediation;
  if (!follows?.run_dir) return '';
  const roots = repoRunRoots({ repoRoot, project: contract.project ?? null, home: quorateHome(), declaredReviewsDir: review.reviews_dir || null });
  // Admitted by the one owner for this repository (ARCHITECTURE A-28): the recorded path is the last resort, and was read
  // with no containment at all.
  // AND READ THROUGH THE DIRECTORY IT ADMITTED (G-14 of 20261023-040306-rdt-remediation-2-review): payload.json was read
  // through linked.run_dir, the candidate's spelling, which a link could retarget after admission.
  const admit = (dir) => admitRun({ runDir: dir, repoRoot });
  const linked = resolveLinkedRun({ dir: follows.run_dir, runId: follows.run_id ?? null, roots, admit, join: path.join, basename: path.basename });
  let payload = null;
  let refused = null;
  // Through the linked run's own owner (run-dir-reads.plan.md stage 4; G-19 of 20261029-065343-rdd-remediation-2-review,
  // G-9 of 20261029-134336-rdd-remediation-3-review): a link below the admitted directory is refused, not followed, and
  // the section says it was refused (G-13 of 20261029-224143-rdr-remediation-3-review), not merely unreadable.
  // A FAILURE THAT IS NEITHER A REFUSAL NOR AN ABSENCE THROWS (G-4 of 20261115-045745-pbr-1b-remediation-5-review;
  // ARCHITECTURE.md A-30): an EACCES, an EIO or a payload that does not parse was swallowed here, and the run went on
  // without the census. An absent payload is said in the section, as unreadable.
  try { if (linked) payload = JSON.parse(egressRunReader(linked.run_dir).read(['evidence', 'remediation', 'payload.json'])); }
  // Said relative to the run (G-15 of 20261029-235315-rdr-remediation-4-review): the error's own message names the linked
  // run's absolute path, which would ride into every brief and external prompt.
  catch (e) {
    if (!refusedOrAbsent(e)) throw e;
    if (e.code === 'ECONFINED') { refused = `${refusalWords(e)} stands at evidence/remediation/payload.json below the linked run`; contextRefusals.push({ item: 'the linked remediation census', reason: refused }); }
  }
  const evidenceCopy = path.join(runDir, 'evidence', 'remediation-census', 'payload.json');
  // Through the one owner (G-24 of 20261024-122231-rdt-remediation-3-review; run-dir-descendants stage 2).
  if (payload) runOwner.replace(belowRun(evidenceCopy), JSON.stringify(payload, null, 2) + '\n');
  // NAMED RELATIVE TO THE RUN (G-3 of 20261017-040138-ogsc-remediation-review), as the brief names the lens's own
  // evidence dir: the absolute path put this host's run directory into every tracked brief and every external prompt.
  return censusSection({ followsRemediation: follows, payload, refused, payloadPath: 'evidence/remediation-census/payload.json' });
})();

function writeBrief(e) {
  // `run` is withheld from every lens EXCEPT the one whose entire job is to exercise it. Launching
  // the app is not a review action — a lens that can start the product can hang the graph or mutate
  // state the review is meant to observe — but feature-verify's SKILL.md tells it its brief "carries
  // commands.run", and this filter dropped it for that lens too. Combined with Edit/Write denied and
  // capture filtering the same key, every step the skill orders was impossible under the policy the
  // node actually ran with, so the lens could only ever return an empty PASS (G-36).
  // From the roster (G-5), never a literal: the same list capture.mjs enforces, through run.json.
  const isRunner = (runJson.runner_nodes ?? []).includes(e.node_id);
  const allowedCommands = Object.entries(commands)
    .filter(([k, v]) => typeof v === 'string' && v.trim() && k !== 'shell' && (k !== 'run' || isRunner))
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  const standing = [];
  const lens = LENSES.find((l) => l.id === e.node_id);
  if (lens?.standing_not_checked) standing.push(lens.standing_not_checked);
  if (e.degraded && lens?.degraded_not_checked) standing.push(lens.degraded_not_checked);
  // Derived at run time rather than declared in the roster — an inferred request is a property of
  // THIS run, not of the lens.
  if (e.not_checked_override) standing.push(e.not_checked_override);
  for (const k of EMPTY_KEY_CHECKS) {
    if (!commands[k]) {
      standing.push({ item: `commands.${k}`, reason: `empty in graph_contract — ${k} could not be run` });
    }
  }

  const body = renderTemplate(readTemplate('run-brief.md'), {
    node_id: e.node_id,
    run_id: runJson.run_id,
    base_commit: runJson.base_commit ?? '(unresolved)',
    // The run directory is staged under the engine's home, so a node's cwd is outside the repository it judges; without
    // this the reconciler inferred the root and dropped what it could not open (20261020-043006-code-index-delivery).
    repo_root: repoRoot,
    doctrine_path: DOCTRINE_PATH,
    // The sentences live in prompts/_templates (G-9 of 20261114-032609-m2-7b-remediation-review); this picks one and
    // supplies the hash.
    intent_block: (e.intent === 'required'
      ? renderTemplate(readTemplate('brief-intent-required.md'), { intent_sha256: runJson.intent_sha256 ?? '(not captured)' }, 'brief-intent-required.md')
      : renderTemplate(readTemplate('brief-intent-withheld.md'), {}, 'brief-intent-withheld.md')
    ).replace(/\r\n/g, '\n').replace(/\n+$/, ''),
    scope_origin: runJson.scope?.full_sweep ? 'scope is human-asserted (--full-sweep)' : 'scope derived from the diff',
    full_sweep_paths: scopePaths.join(', ') || '(none)',
    changed_files: (runJson.scope?.changed_files ?? []).join(', ') || '(none)',
    source_globs: JSON.stringify(contract.source_globs ?? []),
    test_globs: JSON.stringify(contract.test_globs ?? []),
    generated_globs: JSON.stringify(contract.generated_globs ?? []),
    doc_paths: JSON.stringify(contract.doc_paths ?? []),
    remediation_census: REMEDIATION_CENSUS,
    doc_roles_block: Object.entries(effectiveDocRoles(contract.doc_roles, runJson.request?.path)).filter(([, v]) => String(v ?? '').trim()).length
      ? Object.entries(effectiveDocRoles(contract.doc_roles, runJson.request?.path))
        .map(([role, pth]) => `  ${role}: ${String(pth ?? '').trim() || '(not declared)'}`)
        .join(NL)
      // The sentence lives in prompts/_templates (G-7 of 20261114-042824-m2-7b-remediation-2-review).
      : renderTemplate(readTemplate('brief-doc-roles-none.md'), {}, 'brief-doc-roles-none.md').trimEnd(),
    ui_surface: contract.ui?.surface ?? '(not declared)',
    ui_static_bundle: String(contract.ui?.static_bundle ?? '').trim() || '(not declared)',
    allowed_basis: JSON.stringify(e.allowed_basis),
    // ONE LINE, NOT TWO. The literal carried two consecutive severity-ceiling sentences, both
    // conditioned on the same value: "clamped, not rejected" and "except a §6 invariant, which is
    // never capped". Both rendered together whenever a ceiling was set, telling a node the same
    // rule twice in different words — and neither was complete. No archived brief shows it because
    // no lens had a ceiling until they became derived; it would have started firing now. Merged
    // into the one sentence that carries both facts.
    // Each sentence lives in prompts/_templates; this supplies only the value (G-12 of
    // 20261021-194056-ciss-d1-remediation-3-review: the prose here could drift from the prompts, and the verdict line had).
    severity_ceiling_line: e.severity_ceiling
      ? degradedLine(readTemplate('degraded-severity-ceiling.md'), { severity_ceiling: e.severity_ceiling })
      : '',
    severity_floor_line: e.severity_floor
      ? degradedLine(readTemplate('degraded-severity-floor.md'), { severity_floor: e.severity_floor })
      : '',
    verdict_ceiling_line: e.verdict_ceiling
      ? degradedLine(readTemplate('degraded-verdict-ceiling.md'), { verdict_ceiling: e.verdict_ceiling })
      : '',
    // THE PROJECT'S OWN KNOWLEDGE, inlined (see lib/project-profile.mjs). A consumer had nowhere to
    // put idiom a lens needs except a same-named skill of its own, which is a collision rather than
    // an extension: the orchestrator's --inline-skill wins, so the project's text was discarded
    // silently. Empty when the project has no profile, so a brief gains nothing by the mechanism
    // existing.
    project_profile: profileSection({ repoRoot, nodeId: e.node_id }).text,
    capture_rel: path.relative(repoRoot, path.join(scriptsDir, 'capture.mjs')).split(path.sep).join('/'),
    // THE OTHER §8 EXEMPTION, RESOLVED THE SAME WAY, because it was the only one that was not.
    //
    // Three things a node is pointed at live outside the reviewed tree: capture.mjs (resolved above
    // since G-24), the doctrine (resolved since G-63), and this detector — which kept the literal
    // `<framework-root>/scripts/find-inert-features.mjs` in doc-consistency-review's contract while
    // every one of those prompts told the reader "your brief interpolates the resolved path; prefer
    // it verbatim". The brief did not. That sentence was an inert guarantee sitting in the
    // instructions that tell a node how to find the engine, and it named the one exemption that had
    // no resolved path.
    //
    // It took a consumer-mount run to cost anything: panel-codex-docs reported the detector
    // "absent", which was true of the empty submodule directory AND would have been the node's
    // problem anyway once it had to guess where `<framework-root>` pointed.
    // ...AND THE RESOLVED PATH HAD TO BE ONE capture.mjs WOULD ACCEPT (G-3). It was resolved, and
    // relative, and capture admits the detector ONLY as an absolute path — deliberately, because a
    // relative spelling resolves against the SPAWN's working directory and let a file inside the
    // reviewed tree be executed through the evidence channel. So the brief ordered
    // `node scripts/find-inert-features.mjs`, told the node to run it verbatim and through
    // capture.mjs, and capture refused it:
    //
    //   Permitted starts: ... | node <repo>\scripts\find-inert-features.mjs
    //
    // Nothing reported a gap. doc-consistency-review is REQUIRED to run this sweep, so the lens
    // either did not run it and said so in prose nobody parses, or ran it bare — which the node
    // permission policy denies too: the only Bash grant is `node scripts/capture.mjs:*`. A mandatory
    // instruction that no node can execute is the inert guarantee at its worst, since the artifact it
    // was supposed to produce is what the lens is graded on.
    //
    // Forward slashes: capture keeps both separator spellings and a model writes either, but one
    // spelling in the brief is one thing to get right.
    // NOT `briefArg`: this is a command HEAD, matched by capture.mjs's allow-list as a PREFIX, and
    // that list carries both separator spellings and no quoted form. Quoting it made capture refuse
    // the detector outright — the mandatory §8 sweep rendered unrunnable, which is the inert
    // guarantee at its worst and precisely what the test below this slot exists to catch (G-3).
    detector_abs: path.join(scriptsDir, 'find-inert-features.mjs').split(path.sep).join('/'),
    // THE ONE THAT WAS ACTUALLY WRONG. An ARGUMENT, seen by no prefix rule, and the only path on
    // that command a POSIX shell could mangle into nonsense.
    run_dir: briefArg(runDir),
    allowed_commands: allowedCommands || '  (none declared)',
    standing_block: standing.length
      ? standing.map((x) => `  - ${x.item}: ${x.reason}`).join(NL)
      : '  (none)',
    // EACH STAMP WITH WHAT IT DOES TO THIS NODE (G-39). The block was a bare list of names, and
    // TESTS-THIN and FMT-DIRTY were rendered as two extra template blocks below it — so two stamps
    // stated their effect and thirteen did not, and a lens reading `CONTRACT-PARTIAL` had to infer
    // one. The sentences live in the prompt library beside every other piece of model-facing prose;
    // those two fragments were folded in rather than kept alongside, because saying the same rule in
    // two places is how the copies drift.
    stamps_block: (runJson.stamps ?? []).length
      ? (runJson.stamps ?? []).map((x) => `  - ${x}: ${stampConsequence(x)}`).join(NL)
      : '  (none)',
    threat_model: contract.threat_model ?? '(not declared)',
  }, 'run-brief.md');
  writeTracked(path.join(nodesDir, `${e.node_id}-brief.md`), body + BRIEF_FEEDBACK);
}

// Briefs for the two nodes that are not lenses and not the reconciler. Both were spawned with
// `inlineSkill`, and spawn-node's buildPrompt tells EVERY skill node "read your brief at <path>
// first; follow it exactly" — unconditionally. So both were directed at a file nobody wrote.
//
// This is not cosmetic. The brief is the sole carrier of the run-scoped facts a node may not
// discover for itself (§7: "Nodes never discover the environment"), including run_id — which
// intent-capture's schema requires to match ^[0-9]{8}-[0-9]{6}-[a-z0-9-]+$ and which its sandboxed
// cwd gives it no declared source for. The run that found this recorded the damage in its own
// artifact: intent.md's Not-checked says "brief.md — absent" and states that scope and the ask were
// reconstructed. A hole in the machinery degraded the criteria the run was then judged against.
//
// RENDERED FROM prompts/_templates (G-25 of 20261021-162807-ciss-d1-review): the brief and each node's purpose were
// string arrays here, and callers passed more prose in, so a prompt author could not find them. `purposeTemplate` names
// the node's own template; `vars` fills its slots. The node-specific section now sits under the purpose, not after Conduct.
// One degraded-mode line of the brief, from its template: a declaration, so the brief writer above can call it.
function degradedLine(text, vars) {
  return renderTemplate(text, vars, 'degraded line').replace(/\r\n/g, '\n').replace(/\n+$/, '');
}
const templateText = (name, vars = {}) => renderTemplate(readTemplate(name), vars, name).replace(/\r\n/g, '\n').replace(/\n+$/, '');
function writeAuxBrief(nodeId, purposeTemplate, vars = {}) {
  const standing = [];
  for (const k of EMPTY_KEY_CHECKS) {
    if (!commands[k]) standing.push({ item: `commands.${k}`, reason: `empty in graph_contract — ${k} could not be run` });
  }
  if (!contract.ui?.static_bundle) standing.push({ item: 'ui.static_bundle', reason: 'not declared; no built bundle was inspected' });
  const body = templateText('aux-brief.md', {
    node_id: nodeId,
    run_id: runJson.run_id,
    doctrine_path: DOCTRINE_PATH,
    repo: contract.project ?? '(unnamed)',
    // Named for the same reason as the lens and reconcile briefs: this node's cwd is the staged run directory.
    repository_root: repoRoot,
    purpose: templateText(purposeTemplate, vars),
    scope_origin: runJson.scope?.full_sweep ? 'scope is human-asserted (--full-sweep)' : 'scope derived from the diff',
    full_sweep_paths: scopePaths.join(', ') || '(none)',
    changed_files: (runJson.scope?.changed_files ?? []).join(', ') || '(none)',
    generated_globs: JSON.stringify(contract.generated_globs ?? []),
    declared_documents: Object.entries(effectiveDocRoles(contract.doc_roles, runJson.request?.path))
      .filter(([, v]) => String(v ?? '').trim())
      .map(([role, p]) => `  ${role}: ${p}`).join('\n'),
    standing_not_checked: standing.length ? standing.map((s) => `  - ${s.item}: ${s.reason}`).join('\n') : '  (none)',
  });
  writeTracked(path.join(nodesDir, `${nodeId}-brief.md`), `${body}\n${leftOutSection(nodeId)}` + BRIEF_FEEDBACK);
}

// A CONTEXT INPUT LEFT OUT IS NAMED TO THE NODE (prompt-bound-run-reads.plan.md stage 1b; G-3 of
// 20261115-005715-pbr-remediation-3-review): a declared document the sandbox refused, or any other skip of the intent
// sandbox, is listed in the brief of a node that reads that sandbox, as the gate's not-checked list lists it, so the node
// knows what its reading lacks. Empty when nothing was left out.
function leftOutSection(nodeId) {
  if (!['intent-capture', 'request-capture'].includes(nodeId) || !docSnapshotSkips.length) return '';
  // Its words are the prompt library's (G-6 of 20261115-013659-pbr-1b-delivery; ARCHITECTURE.md §2), the list is the run's.
  return `${templateText('left-out-of-sandbox.md', { items: docSnapshotSkips.map((s) => `- ${s.item}: ${s.reason}`).join('\n') })}\n\n`;
}

// ---------------------------------------------------------------------------- child running
const live = new Map(); // nodeId -> child
let aborted = false;
// THE RUN HAS STOPPED MOVING ONCE IT IS LEAVING (stopping-a-child stage 3). The stop on the way out now WAITS — up to
// SIGNAL_EXIT_DEADLINE_MS for the children's exits — where it used to exit at once, and a child exiting in that window
// resolved its promise: the fan-out could settle and the main flow walk on to the barrier, spawn the reconciler, or write
// a gate for a run that is being interrupted. So once `aborted` is set no new child is started and no settled one is
// handed back: the promise never resolves, and the process exits from the stop.
const LEAVING = new Promise(() => {});

// A KILLED ARM IS STILL AN EXTERNAL ARM (G-31). The stub written here carried `launched: true` and
// `total_cost_usd: null` but no `auth_mode`, and nodeSpend recognises a third-party arm ONLY by that
// key — so on SIGINT every killed arm fell through to the unknown-cost fallback and was charged the
// full node cap against a run budget it never touched. The arms authenticate as the operator to
// another vendor and are billed there; `live` holds them beside lens nodes, and the difference has
// to survive the kill.
const LIVE_KIND = new Map();   // liveKey -> extra status fields the stub must carry
// WHAT THE RUN KEEPS ABOUT A CHILD IT STOPPED ON THE WAY OUT (stopping-a-child stage 3). HOW the children are stopped is
// io/stop-on-exit.mjs's — all at once, through the one owner, at most one deadline waited (design 3A) — and this is
// called once per child with the outcome. A child not seen to exit is named with its pid, in the stub and on stderr: the
// run exits right after, before the end-of-run reaper, so it is named HERE or nowhere (G-15 of
// 20260926-044637-m0-close-r2). It is never retried by pid later — pids are reused.
function recordStoppedChild(nodeId, { outcome, pid }, reason) {
  // The orchestrator owns the record for a node it stopped: spawn-node may not survive to write its own terminal status.
  // What the stop says — the outcome, and a pid the node runner itself named — is stoppedStatusFields's, which a test
  // drives.
  //
  // `launched: true` because it was. The cost is unknown — the child died before reporting one —
  // but "unknown" must not be recorded as "free", or a --resume after an operator interrupt gets
  // a clean budget for work already billed. Charging the per-node cap is the conservative
  // reading: it can overstate, and overstating a spend that really happened is the safe error.
  writeStatusStub(nodeId, 'BLOCKED', {
    ...stoppedStatusFields({ outcome, pid }, reason, outcome === 'exited' ? readStatus(nodeId) : null),
    launched: true,
    total_cost_usd: null,
    // Uncapped: there is no cap to charge, and charging Infinity would poison spentSoFar and
    // every downstream sum. Record 0 and let the unknown-cost gap speak for itself in the status.
    cost_unknown_charged_at_cap: Number.isFinite(BUDGET_NODE) ? BUDGET_NODE : 0,
    // ...and whatever makes this child what it is. For a panel arm that is
    // `auth_mode: 'external-vendor'`, the ONE key nodeSpend recognises: without it a killed arm
    // was charged the full node cap against a budget this account never spends (G-31).
    ...(LIVE_KIND.get(nodeId) ?? {}),
  });
  live.delete(nodeId);
}

/**
 * Remove the arms' checkout, from whichever path gets there first (G-32, code-audit).
 *
 * This lived inline at the one top-level call site, reached only when the fan-out AND the panel both
 * settled normally — while the signal handler below calls process.exit(130) and runBudgetedPool
 * rethrows a failed worker, so BOTH of those leave before it. A leaked worktree stays registered in
 * .git/worktrees and the next `git worktree add` inherits the mess.
 *
 * Not a hypothetical: stopping a sweep by hand left exactly this behind, and it had to be removed
 * with `git worktree remove --force` before the next run could be started.
 *
 * Idempotent by the null check, so calling it from the normal path, the signal path and the failure
 * path cannot double-remove. A refused removal is NAMED rather than swallowed — the operator has to
 * know a directory and a registration are still there.
 */
// DECLARED HERE, ABOVE ITS READER, AND THAT IS THE WHOLE POINT (measured 2026-09-22).
//
// It lived beside `panelMirrored` at the panel-surface block, ~870 lines below — after the
// `process.on('exit')` registration a few lines down. `let` is in the temporal dead zone until its
// declaration EXECUTES, so any exit before that line made the handler throw
// `ReferenceError: Cannot access 'panelWorktree' before initialization` instead of tearing down.
//
// The path that reaches it is the one that matters most: a FAILED PRE-FLIGHT BARRIER. `runPreflight`
// calls process.exit at ~:1501, which is before the old declaration, so every BLOCKED-at-the-barrier
// run printed its correct "BARRIER FAILED ... the run is BLOCKED" and then died in a stack trace,
// losing the intended exit code that a hook or a caller reads. Found by bench-second-opinion, whose
// resume re-runs the barrier in a seeded worktree.
//
// This file already records the same defect twice — `alreadyOk` ("a const declared far below it, so
// reading it there is a temporal-dead-zone crash on every run") and the `tbStartedAt`/`judgeId`
// pair. Third time: a value read from a handler must be declared above the handler, not beside its
// topic.
// A DECLARED DOCUMENT THE INTENT SNAPSHOT REFUSED IS A GAP IN WHAT INTENT SAW (G-16,
// contract-audit). I-9 names a guard that refuses an input without recording it as a failure mode,
// so these reach the gate's not_checked[] and not only stderr.
//
// MODULE SCOPE, for the same reason `panelWorktree` below is: it is written deep inside the
// doc-snapshot walk and read at the gate, ~1400 lines apart. Declared in the walk's block it parsed
// cleanly and would have thrown a ReferenceError at the gate — the defect shape this file has
// already paid for once, where `check-syntax` passes because a parse is not a scope check.
const docSnapshotSkips = [];
// Links withheld from the arms' checkout — untracked (G-11 of 20260925-015614), tracked, and in the
// copied framework (G-11 of 20260925-200721): named in the gate, never silent.
const mirrorRefusals = [];
let panelWorktree = null;

function tearDownPanelWorktree() {
  if (!panelWorktree) return;
  const dir = panelWorktree;
  panelWorktree = null;   // cleared FIRST: a throw inside the removal must not leave a retry loop
  // A plain directory since arms-read-surface: the snapshot builder's, holding no link (it asserts
  // that), so a recursive removal cannot reach outside it. No `git worktree` is registered any more.
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {
    console.error(`panel: could not remove the arms' directory at ${dir} — ${e.message}; remove it by hand`);
  }
  // Then the run's arms root, which holds only this run's builds; left in place if anything is still in it.
  try { fs.rmdirSync(path.dirname(dir)); } catch { /* not empty, or already gone */ }
}

// ONE PATH OUT, THREE WAYS TO TAKE IT (stopping-a-child stage 3): a signal, an uncaught failure, and any other exit. Each
// stops every held child through the one owner and records it (recordStoppedChild), then removes the arms' checkout.
//
// Detached children do NOT receive the orchestrator's SIGINT — they are in their own process groups, which is exactly
// what makes the tree kill work — so they are stopped explicitly. The removal is THE BACKSTOP too, for the path neither of
// the explicit calls reaches: runBudgetedPool and runPool RETHROW a failed worker, so an orchestrator that dies on an
// exception leaves before any teardown line. tearDownPanelWorktree is idempotent, so the normal path still frees the
// checkout early, before the barrier, and this only catches what escaped (G-32). The generic exit hook used to do only
// that, and never stopped a child (ledger run-graph.mjs:1130).
stopHeldOnExit({
  held: () => live.entries(),
  record: recordStoppedChild,
  teardown: tearDownPanelWorktree,
  onStart: (reason, n) => {
    aborted = true;
    console.error(`
run-graph: ${reason} — stopping ${n} live node(s), waiting at most ${SIGNAL_EXIT_DEADLINE_MS / 1000}s`);
  },
});

function spawnNode({ nodeId, skill, mode, schemaVariant, allowedBasis, model, effort, severityCeiling, severityFloor, verdictCeiling, addDirs, inlineSkill, timeoutMinutes, budgetUsd, instructions = null }) {
  if (aborted) return LEAVING;
  return new Promise((resolve) => {
    const argv = [
      path.join(scriptsDir, 'spawn-node.mjs'),
      '--run-dir', runDir, '--repo-root', repoRoot,
      '--node-id', nodeId, '--mode', mode,
      '--schema-variant', schemaVariant,
      '--model', model ?? rosterNodeSetting(roster, nodeId).model ?? JUDGMENT_MODEL,
      // The barrier gets its own timeout for the same reason it gets its own budget.
      // Narrowest first, exactly as model and effort resolve: a per-lens roster override, then the
      // mode's own ceiling (the barrier and intent-capture each scale with a different variable
      // from a lens), then the contract's node default.
      '--timeout-minutes', String(
        timeoutMinutes
        ?? (mode === 'reconcile' ? BARRIER_TIMEOUT : mode === 'intent' ? INTENT_TIMEOUT : NODE_TIMEOUT),
      ),
      ...runtimeBinArgv(args.runtimeBin),
    ];
    // THE RUNTIME THE CONTRACT DECLARED (G-28, panel-codex-arch). new-run reads `review.runtime` to
    // pick the adapter it writes the policy files and the canaries under; this never forwarded it,
    // and spawn-node falls back to `default_node_runtime` when `--runtime` is absent. So a project
    // declaring a runtime got its mint-time policy generated for THAT one and its lenses spawned
    // under another — the two halves of the adapter boundary disagreeing, with every run recording
    // the mint's answer as though it were the lenses'.
    //
    // From the FROZEN contract in run.json, like every other node parameter, so a resume spawns
    // under the runtime the run was minted for even if the contract has since moved. Chosen once, by the owner.
    argv.push('--runtime', NODE_RUNTIME);
    // Uncapped => pass the explicit sentinel 'none' so spawn-node omits --max-budget-usd on the
    // child entirely. It must be explicit, not an OMITTED flag: spawn-node defaults an ABSENT
    // --budget-usd to its own $1.50 standalone safety, so omitting the flag re-imposes a cap
    // LOWER than the one we are lifting (this killed arch-review/intent/reconcile at ~$1.5 on the
    // first uncapped resume). A finite cap is passed through unchanged.
    // `budgetUsd` lets a caller spend PART of a tier: the batches of one reconcile share the barrier's ceiling (G-15).
    const childBudget = budgetUsd ?? (mode === 'reconcile' ? BUDGET_BARRIER : BUDGET_NODE);
    argv.push('--budget-usd', Number.isFinite(childBudget) ? String(childBudget) : 'none');
    // Resolution order, narrowest first: an explicit call-site value, then the per-lens override
    // in lens-roster.json, then the contract default. A lens with a genuinely different depth
    // need (a cheap mechanical sweep, an expensive structural one) is expressed in the roster
    // beside its other properties, not by editing this function.
    // THE MIDDLE RUNG THE COMMENT ABOVE ALREADY DESCRIBED, which did not exist. `roster.barrier_nodes`
    // was read in one place and only for `.id`, so an override on reconcile, intent-capture,
    // request-capture, reconcile-b or second-opinion was read by NOTHING — five nodes where
    // `$per_lens_overrides` promised a mechanism that silently did nothing. Lenses appeared to work
    // only because their override is baked into expected.json upstream and arrives here as a
    // call-site value. Found by trying to use it: a measured, operator-approved `effort: low` on
    // second-opinion would have sat in the roster reading as adopted while every run kept using the
    // contract's setting, which is worse than no override at all.
    const rosterOverride = rosterNodeSetting(roster, nodeId);
    const resolvedEffort = effort ?? rosterOverride.effort ?? JUDGMENT_EFFORT;
    if (resolvedEffort) argv.push('--effort', resolvedEffort);
    // Passed as flags so the cap is enforced by the validator, not merely requested in the brief.
    if (severityCeiling) argv.push('--severity-ceiling', severityCeiling);
    if (verdictCeiling) argv.push('--verdict-ceiling', verdictCeiling);
    if (severityFloor) argv.push('--severity-floor', severityFloor);
    if (skill) argv.push('--skill-command', skill);
    if (allowedBasis?.length) argv.push('--allowed-basis', allowedBasis.join(','));
    if (inlineSkill) argv.push('--inline-skill');
    // The one place the reviewed tree instructs a node, and it is explicit in the argv the
    // spawner records: only for a lens the contract declared, whose path this file proved is
    // inside the repository and does not leave it through a link.
    if (instructions) argv.push('--instructions', instructions);
    // AND THE RUN DIRECTORY, WHEN IT IS NOT INSIDE THE REPOSITORY.
    //
    // Every node is spawned with `cwd: repoRoot`, and the runtime refuses a path outside its cwd
    // whatever the permission rules say -- the two are different boundaries. Since graph_contract 2
    // a run is STAGED outside the tree, so a node could not read ITS OWN BRIEF: contract-audit tried
    // `Read`, then `cat`, then `Get-Content`, and was denied all three. It then echoed an empty
    // intent_sha and DEGRADED on the drift check, which BLOCKED the gate -- and the lenses that did
    // report came back FAIL with zero findings, having been handed no brief either.
    //
    // A Read RULE for the same directory is necessary and was not sufficient: that admits the tool,
    // this admits the path. Fixed centrally rather than at each spawn site, because the failure was
    // every node and the next node added would have inherited it.
    //
    // Conditional, and the run's OWN directory only: when the run is inside the repository the cwd
    // already covers it, and the staging ROOT holds every other run of every other project.
    //
    // AND NEVER FOR THE INTENT NODE (G-31). This widening was written for the nodes that could not
    // read their own brief, and it applied to every node -- undoing, 42 lines below, the deliberate
    // withholding in docReadDirs: the run directory holds evidence/pre-flight/build.log and
    // test.log, full of the implementation's own symbol and test names, which is the exact context
    // Rule 2 exists to keep from intent-capture. The sweep that found this measured it: that run's
    // intent-settings.json granted Read on the run directory, its intent-capture.status.json listed
    // the run directory among add_dirs, and its intent.md's own not_checked records the node
    // noticing the pre-flight logs were readable and CHOOSING not to read them. Rule 2 back to
    // resting on a node's discretion is the failure narrowing its cwd was built to end.
    //
    // The intent node needs none of it: it writes no files (its PROMPT.md rule 5 -- the orchestrator
    // renders intent.md from the emitted JSON), and everything it reads is copied into its sandbox
    // by spawn-node, briefs and declared docs alike.
    const widen = isWithin(repoRoot, runDir) || mode === 'intent' ? [] : [runDir];
    const dirs = [...(addDirs ?? []), ...widen];
    if (dirs.length) argv.push('--add-dir', ...dirs);

    const child = spawn('node', argv, {
      cwd: repoRoot,
      env: { ...process.env, GRAPH_NODE_DEPTH: '0' }, // spawn-node adds the +1
      stdio: ['ignore', 'inherit', 'inherit'],
      // Killable with its descendants — how that is arranged is the platform's (os-platform-adapters).
      ...hostPlatform().proc.killableSpawnOptions(),
    });
    live.set(nodeId, child);
    child.on('exit', () => { live.delete(nodeId); if (!aborted) resolve(readStatus(nodeId)); });
    child.on('error', (e) => {
      live.delete(nodeId);
      writeStatusStub(nodeId, 'BLOCKED', { validator_errors: [`failed to spawn spawn-node.mjs: ${e.message}`] });
      resolve(readStatus(nodeId));
    });
  });
}

// IS A NODE'S STATUS THERE, through the run's owner (run-dir-reads.plan.md stage 3): the probes in front of readStatus
// were existsSync of a joined path, which followed a link at nodes/ or at the file. A refused link is not "absent": it
// answers true, so readStatus reads it and reports the refusal (BLOCKED, "status file refused"), never a missing node.
function statusPresent(nodeId) {
  try { return runOwner.exists(['nodes', `${nodeId}.status.json`]); } catch (e) { if (e.code === 'ECONFINED') return true; throw e; }
}

function readStatus(nodeId) {
  // THROUGH THE OWNER (G-18 of 20261029-055946-rdd-remediation-review): a link at a status file is refused, not followed.
  try { return JSON.parse(runOwner.read(['nodes', `${nodeId}.status.json`])); }
  catch (e) { return { node_id: nodeId, state: 'BLOCKED', validator_errors: [e.code === 'ECONFINED' ? `status file refused: ${e.message}` : 'status file unreadable'] }; }
}

// A node that spent money and died without emitting an envelope records total_cost_usd: null —
// timeouts and BLOCKED nodes both. Counting null as 0 made the most expensive failures look free
// and let the budget check keep launching: eight lenses at the per-node cap against a $12 run
// budget, with gate.json under-reporting by the same amount so the overrun left no trace.
//
// Unknown is charged at the per-node cap, because that is what the node was authorised to spend
// and therefore the most it could have spent. Over-estimating stops a run early; under-estimating
// lets it run past a limit that was set deliberately. SKIPPED nodes never launched, so they are
// genuinely free and are the one case that stays at zero.
// The one directory the sandboxed producer may read: its sandbox, holding copies of the declared documents and nothing
// else, passed as --add-dir and used as its cwd, so the source tree is unreachable rather than merely discouraged.
// The status of a sandboxed node that docReadDirs refused to prepare (G-4 of 20261115-002137-pbr-remediation-2-review):
// recorded as a stub, never spawned, so the gate names why it did not run.
// A REQUIRED INPUT WAS REFUSED (prompt-bound-run-reads.plan.md stage 1b): the node it feeds is not started, its status is
// BLOCKED with the refusal's cause, and the gate names it. `cause` is the refusal as the site words it.
function refusedInputStatus(nodeId, cause = 'its contract snapshot was refused') {
  const extra = { launched: false, validator_errors: [`not started: ${cause} (a required input; named in the gate's not-checked list)`] };
  writeStatusStub(nodeId, 'BLOCKED', extra);
  return { node_id: nodeId, state: 'BLOCKED', ...extra };
}

// Why the last docReadDirs call returned null: a required input refused or absent (prompt-bound-run-reads.plan.md stage 1b).
let docReadRefusal = null;
function docReadDirs(nodeId) {
  docReadRefusal = null;
  // A REFUSAL BELOW THE SANDBOX IS THE SAME CLASS (G-6 of 20261115-005715-pbr-remediation-3-review): the sandbox directory
  // is made through the owner, and a link at sandbox/ threw out of the orchestrator before the gate. It is a required
  // input's refusal: the node is not started, and the cause is kept.
  try { runOwner.dir(['sandbox', nodeId]); } catch (e) {
    if (e.code !== 'ECONFINED') throw e;
    docReadRefusal = `${refusalWords(e)} stands at sandbox/${nodeId}`;
    // Named in the gate and the run's log as the contract snapshot's refusal is: the status alone was a cause nobody reads.
    console.error(`run-graph: ${nodeId} not started — ${docReadRefusal}`);
    docSnapshotSkips.push({ item: `sandbox/${nodeId}`, reason: `refused: ${docReadRefusal}; ${nodeId} ${REQUIRED_NOT_STARTED}` });
    return null;
  }
  // The node's sandbox floor — an empty directory, NOT the run directory. spawn-node.mjs uses the
  // same path as the intent cwd; the run directory holds pre-flight build and test logs naming the
  // implementation's own symbols, and a cwd is readable whether or not it is in --add-dir.
  // MADE BY THE ONE OWNER (G-15 of 20261023-040306-rdt-remediation-2-review; run-dir-descendants.plan.md stage 2, which
  // replaces the private `madeInside` this was): one level at a time, a link at sandbox/ or sandbox/<node> refused
  // wherever it leads, so the document copies and the node's readable root cannot be taken elsewhere.
  const sandbox = runOwner.dir(['sandbox', nodeId]);
  const dirs = new Set([sandbox]);
  // THE RUN DIRECTORY IS NOT READABLE, AND NEEDS NOT BE (contract-glob-grammar stage 4). This said the run directory was
  // reached through a policy rule, `Read(/<runDir>/**)` — on Windows that rule granted nothing (stage 2b's probe), so the
  // contract snapshot was unreachable in practice. What the node needs from the run directory now travels into the
  // sandbox: the brief (spawn-node) and the contract snapshot (below). The run directory stays withheld as an --add-dir
  // root, because it holds pre-flight logs naming the implementation's own symbols (G-31).
  // Top-level declared FILES are copied here rather than reached in place. --add-dir takes
  // directories, and the parent of a top-level file is the repo root — so "just add the parent",
  // which is what the CLI suggests, hands the producer the entire source tree and voids the one
  // guarantee that makes its output worth anything. Copying costs a few kilobytes and keeps the
  // sandbox intact.
  //
  // Without this the first recovery run reported two declared documents it simply could not read.
  // A drafter silently missing a document that states a requirement is the failure mode this whole
  // skill exists to avoid, so the alternative to copying was not "slightly less context" — it was
  // criteria confidently written from a partial reading.
  const snapDir = path.join(sandbox, 'declared-docs');
  // EVERY WRITE INTO THE SNAPSHOT GOES THROUGH HERE (G-12). snapshotName makes path-derived names
  // injective, but the doctrine and request copies below write fixed-prefix names into the same
  // directory, and a consumer's own `shared/x.md` meets the mounted doctrine's `x.md` on one name
  // by construction. The later write still wins, as it always did; what changes is that a
  // document replaced by a different one is RECORDED rather than silently gone (I-9).
  // EVERY DOCUMENT IS COPIED, NONE IS GRANTED IN PLACE (contract-glob-grammar stage 4; operator, 2026-10-01: "B: copy
  // only matched docs (Recommended)"). This loop live-mounted a doc directory with --add-dir unless it overlapped source,
  // and stage 2b measured what that granted: everything below the directory, whatever the glob said. The intent node now
  // reads only this sandbox; io/doc-snapshot.mjs copies, for every doc glob, exactly what matchesGlob admits, and every
  // glob it cannot honour is recorded (r5's G-8, G-9: three of those skips were silent).
  const recordSkip = (s) => {
    console.error(`run-graph: doc snapshot skipped — ${s.item}: ${s.reason}`);
    docSnapshotSkips.push(s);
  };
  const caseInsensitive = hostPlatform().caseInsensitiveFs;
  const snap = createSnapshot(snapDir, { caseInsensitive, onSkip: recordSkip,
    write: (name, content) => runOwner.replace(['sandbox', nodeId, 'declared-docs', name], content) });
  const snapCopy = (src, name) => snap.copy(src, name);
  // The reviews root holds every run's artifacts; a doc glob over an ancestor of it must not descend into them (G-29).
  // The staging root here, and the in-repository archive root always: snapshotIntentDocs decides the roots, for every
  // caller (G-4 of 20261001-031029-invoke-security-audit-cgg-high; G-25 of 20261001-034021-cgg-remediation-review).
  // THE ROLE DOCUMENTS TOO (G-17 of 20261001-183347-cgg-review-r4). The intent cache's key covers every doc_roles value
  // (lib/walk-rules.mjs's intentInputSpec), and the node was handed only doc_paths — so an architecture or roadmap
  // declared as a role and not as a doc path was an input the criteria were keyed on and never derived from. Each is a
  // literal path in the glob grammar (validated at mint), so it goes through the same owner and the same refusals.
  // `request` is excluded: it has its own copy below, which checks the bytes against the hash frozen at mint.
  const roleDocs = Object.entries(effectiveDocRoles(contract.doc_roles, runJson.request?.path))
    .filter(([role, value]) => role !== 'request' && typeof value === 'string' && value.trim())
    .map(([, value]) => value.trim());
  snapshotIntentDocs({
    repoRoot, docPaths: [...(contract.doc_paths ?? []), ...roleDocs], generatedGlobs: contract.generated_globs ?? [],
    stagingRoot: path.dirname(runDir), snap, caseInsensitive, onSkip: recordSkip,
  });

  // THE CONTRACT SNAPSHOT, BESIDE THE BRIEF (operator, 2026-10-01: "Inside the chosen fix (Recommended)"). The prompt tells
  // the node to read it first, and it sat in the run directory, reachable only by a Read rule that grants nothing on
  // Windows — review r5's own intent.md records "contract.snapshot.md — Not present in the sandbox".
  const contractSnapshot = path.join(runDir, 'contract.snapshot.md');
  // Through the egress owner: a second name is refused (G-10 of 20261114-184441-m2-pred1-remediation-b-review), and the
  // refusal is recorded in the gate rather than thrown out of the orchestrator (G-4 of 20261114-235051-pbr-remediation-review).
  // A REFUSAL STARTS NO NODE (G-4 of 20261115-002137-pbr-remediation-2-review): criteria written without the frozen
  // contract are written from an incomplete input, so the node is not spawned. The source read and the sandbox write are
  // caught apart, each refusal named as the side it stands on; docReadDirs returns null and its caller records the node
  // BLOCKED.
  if (!runOwner.isFree(['contract.snapshot.md'])) {
    let snapshotRefused = null;
    let snapshotBytes = null;
    try { snapshotBytes = promptRead(contractSnapshot, null); }
    catch (e) {
      if (!refusedOrAbsent(e)) throw e;
      snapshotRefused = `${refusalWords(e)} stands at contract.snapshot.md`;
    }
    if (snapshotBytes !== null) {
      try { runOwner.replace(['sandbox', nodeId, 'contract.snapshot.md'], snapshotBytes); }
      catch (e) {
        if (e.code !== 'ECONFINED') throw e;
        snapshotRefused = `${refusalWords(e)} stands at sandbox/${nodeId}/contract.snapshot.md`;
      }
    }
    if (snapshotRefused) {
      recordSkip({ item: 'contract.snapshot.md', reason: `refused: ${snapshotRefused}, so ${nodeId} is not started` });
      docReadRefusal = `contract.snapshot.md was refused: ${snapshotRefused}`;
      return null;
    }
  } else {
    // ABSENT IS THE SAME AS REFUSED for a required input (stage 1b; the claim check of 20261115-004327-pbr-remediation-3
    // dissolved "true again with no edit": the absent branch still skipped and went on, against the doctrine's statement
    // that the sandbox holds the snapshot). Every minted run writes it, so its absence is a broken run, not an option.
    recordSkip({ item: 'contract.snapshot.md', reason: `absent from the run directory, so ${nodeId} is not started` });
    docReadRefusal = 'contract.snapshot.md is absent from the run directory';
    return null;
  }

  // SNAPSHOT THE DOCTRINE THE NODE IS ACTUALLY TOLD TO READ (G-64). This resolved its own
  // directory from a list that disagreed with DOCTRINE_PATH's: it probed the ancestor engine's
  // `.claude/skills/shared` where DOCTRINE_PATH probes the documented mount
  // `.claude/skills/quorate/shared`. A node could therefore be handed a snapshot of one directory
  // while its brief pointed at another — and since the old list matched on the directory EXISTING
  // rather than on it containing the doctrine, any consumer folder named `shared` qualified.
  //
  // That is what put `.claude/skills/shared` on the legacy watch list, and why a project keeping
  // its own panel tooling under that name was warned about on every run for a hazard that only
  // existed here. One owner now.
  const shared = DOCTRINE_DIR;
  if (shared && fs.existsSync(shared)) {
    runOwner.dir(['sandbox', nodeId, 'declared-docs']);
    for (const f of fs.readdirSync(shared).filter(isDocumentName)) {
      snapCopy(path.join(shared, f), snapshotName(`shared/${f}`));
    }
  }

  // The inferred request is snapshotted into the intent sandbox too (G-22): recovery drafts a
  // request, stamps REQUEST-INFERRED and caps the gate, but intent-capture received only the
  // declared doc_paths and never the request itself — so the node that must turn the request into
  // numbered criteria could not read it, and the criteria were derived from documentation alone.
  // The request doc is authored by request-capture (sandboxed from source), so it is safe to hand
  // to the intent sandbox.
  if (nodeId === 'intent-capture' && runJson.request?.path) {
    const reqAbs = path.resolve(repoRoot, runJson.request.path);
    // A REQUEST THAT VANISHED IS REFUSED, NOT SKIPPED (G-21): this sat inside `if (existsSync)` with
    // no else, so a request deleted between mint and here was omitted in silence — intent derived
    // without it, and nothing in the gate said so.
    // THE APPROVED BYTES, IN THEIR DECLARED PLACE (G-23): a pre-flight command runs between mint
    // and here, so the request is re-checked against the hash mint froze, and must not be a link.
    const realRepo = (() => { try { return fs.realpathSync(repoRoot); } catch { return path.resolve(repoRoot); } })();
    const resolvedReq = (() => { try { return fs.realpathSync(reqAbs); } catch { return null; } })();
    const actualSha = resolvedReq ? crypto.createHash('sha256').update(fs.readFileSync(resolvedReq, 'utf8')).digest('hex') : null;
    const admits = !fs.existsSync(reqAbs)
      ? { ok: false, why: `the request named at mint (${runJson.request.path}) no longer exists — intent is not derived without it` }
      : requestSnapshotAdmits({
        realRepoRoot: realRepo, rel: path.relative(repoRoot, reqAbs), resolved: resolvedReq,
        frozenSha: runJson.request.sha256 ?? null, actualSha, caseInsensitive: hostPlatform().caseInsensitiveFs,
      });
    if (!admits.ok) {
      // A REFUSED REQUEST STARTS NO INTENT-CAPTURE (G-35 of 20261116-200635-m2-9a-high): it is a required input of the
      // node, and returning the read directories started the node anyway, against this refusal's own words.
      console.error(`run-graph: request not snapshotted — ${admits.why}`);
      docReadRefusal = `the request was refused: ${admits.why}`;
      docSnapshotSkips.push({ item: `request ${runJson.request.path}`, reason: `${admits.why}; ${nodeId} ${REQUIRED_NOT_STARTED}` });
      return null;
    }
    runOwner.dir(['sandbox', nodeId, 'declared-docs']);
    snapCopy(reqAbs, snapshotName(`request/${path.basename(reqAbs)}`));
    console.log(`   inferred request snapshotted into the intent sandbox (G-22)`);
  }
  if (fs.existsSync(snapDir)) console.log(`   declared docs snapshotted to ${path.relative(runDir, snapDir).replace(/\\/g, '/')}/`);
  return [...dirs];
}

// Render the request document from the node's validated payload. `.inferred.md` is in the name,
// not only the frontmatter, so the weaker provenance survives a directory listing — someone
// scanning .claude/requests/ months from now sees which documents a person wrote and which a run
// reconstructed, without opening either.
function renderRequestDoc(nodeId) {
  const payloadPath = path.join(runDir, 'evidence', nodeId, 'payload.json');
  if (!runHas(payloadPath)) return null;
  // Through the egress owner (G-5 of 20261114-231942-pbr-delivery): the payload is rendered into the adopted request, which
  // the intent node reads.
  const p = JSON.parse(promptRead(payloadPath));

  // Node output is UNTRUSTED, and the schema pattern that should constrain the slug is enforced
  // by the model runtime, which this system never treats as a security boundary — validateVerdict
  // re-checks evidence paths for exactly that reason. An unchecked slug was a path traversal into
  // any `*.inferred.md` the operator can write (G-15); the orchestrator re-checks it here, at the
  // point where a string becomes a filesystem path.
  if (typeof p.slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) {
    console.error(`run-graph: refusing request document — slug ${JSON.stringify(p.slug)} is not a plain [a-z0-9-] slug`);
    return null;
  }
  // The rest of the payload gets the same distrust the slug gets — the schema behind these fields
  // is enforced by the model runtime, which this system never treats as a boundary, yet the
  // renderer dereferenced title/what/why/acceptance_criteria.map unguarded while giving three
  // OTHER fields `?? []` in the same expression list (G-12). A malformed payload now renders a
  // document with named gaps instead of throwing an uncaught TypeError that killed the
  // orchestrator without recording anything.
  const str = (v, label) => (typeof v === 'string' && v.trim() ? v : `(request-capture omitted ${label})`);
  const list = (v) => (Array.isArray(v) ? v : []);
  p.title = str(p.title, 'title');
  p.what = str(p.what, 'what');
  p.why = str(p.why, 'why');
  p.acceptance_criteria = list(p.acceptance_criteria);
  p.non_goals = list(p.non_goals);

  // RESOLVED THROUGH LINKS BEFORE WRITING. A lexical join is redirected by a symlink or junction at
  // `.claude/requests`, and this WRITES a generated document there — outside the repository, if the
  // link says so. `mustExist: false` because the directory legitimately may not exist yet.
  const dir = resolvedRequestsDir(repoRoot, { mustExist: false });
  if (!dir) {
    console.error('recovery: the requests directory does not resolve inside this repository — '
      + 'refusing to write an inferred request through it');
    return null;
  }
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${p.slug}.inferred.md`);
  // Exclusive create (G-25): a later recovery reusing a slug must not silently overwrite a
  // persisted request — including one a person approved and edited. On collision, suffix.
  let finalFile = file;
  for (let n = 2; fs.existsSync(finalFile); n++) {
    finalFile = path.join(dir, `${p.slug}-${n}.inferred.md`);
  }

  const body = [
    '---',
    `request: ${p.slug}`,
    // Not `draft`: a draft is something a human is expected to act on before anything uses it,
    // and this document is already in use by the run that produced it. `inferred` says both
    // things at once — usable now, and never approved by anyone.
    'status: inferred',
    `created: ${(runJson.created_at ?? new Date().toISOString()).slice(0, 10)}`,
    `milestone: ${p.milestone || 'none declared'}`,
    `inferred_by_run: ${runJson.run_id}`,
    '---', '',
    `# ${p.title}`, '',
    '> **This request was inferred, not stated.** No approved request existed when this run started,',
    '> so it was reconstructed from the declared documentation by a node that could not read the',
    '> source. Conformance findings judged against it are capped at RISK, except a §6 invariant finding,',
    '> which is never capped. A human who reads it and',
    `> sets \`status: approved\` lifts that cap on the next run.`, '',
    '## What', '', p.what, '',
    '## Why', '', p.why, '',
    '## Acceptance criteria', '',
    ...p.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`), '',
    '## Non-goals', '',
    ...p.non_goals.map((n) => `- ${n}`), '',
    '## Expected surface', '',
    ...((p.expected_surface ?? []).length ? p.expected_surface.map((s) => `- ${s}`) : ['_None identified._']), '',
    '## Needs input', '',
    ...((p.needs_input ?? []).length
      ? p.needs_input.map((q) => `- ${q}`)
      : ['_The drafter recorded no open questions. On a substantial request that is itself worth ' +
         'checking — it often means guesses were written as facts._']),
    '',
    '## Not checked', '',
    '_Declared documentation the drafter could not read. A requirement stated only in one of these',
    'is not reflected above._', '',
    ...((p.not_checked ?? []).length
      ? p.not_checked.map((n) => `- **${n.item}** — ${n.reason}`)
      : ['_Everything declared was reachable._']),
    '',
  ].join('\n');

  writeTracked(finalFile, body);
  return finalFile;
}

// The newest request document, preferring one this run produced. `status: inferred` is accepted
// here and only here — new-run requires `approved`, because a document a human read carries an
// authority a generated one does not, and the recovery path must not erase that distinction.
function newestRequestDoc() {
  // The read side of the same link. A redirected directory would feed a file from outside the
  // repository into intent capture as the criteria this run is judged against.
  const dir = resolvedRequestsDir(repoRoot);
  if (!dir) return null;
  const candidates = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ f, abs: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const c of candidates) {
    const text = fs.readFileSync(c.abs, 'utf8');
    const status = requestStatus(text);
    if (status === 'inferred' || status === 'approved') {
      return {
        path: path.relative(repoRoot, c.abs).replace(/\\/g, '/'),
        sha256: crypto.createHash('sha256').update(text).digest('hex'),
        status,
      };
    }
  }
  return null;
}

// Re-run the deterministic derivation after a precondition is satisfied. A lens gated on
// `run.request` was correctly deselected while the request was missing; without this it would
// stay deselected for the rest of the run and the recovery would have achieved nothing.
function rederiveExpected() {
  const fresh = deriveExpected();
  expected.length = 0;
  expected.push(...fresh);
  expected.push(...panelArmRows()); // arm rows survive recovery too (G-18)
  writeJson(path.join(nodesDir, 'expected.json'), {
    run_id: runJson.run_id,
    written_at: new Date().toISOString(),
    derivation: 'deterministic: lens-roster.json x graph_contract; re-derived after precondition recovery',
    expected,
  });
  for (const e of expected) {
    if (e.present) continue;
    const existing = statusPresent(e.node_id) ? readStatus(e.node_id) : null;
    if (existing && existing.state && existing.state !== 'SKIPPED') continue;
    writeStatusStub(e.node_id, 'SKIPPED', { skip_reason: e.skip_reason });
  }
}

const spentSoFar = () =>
  runList(nodesDir)
    .filter((f) => f.endsWith('.status.json'))
    .reduce((sum, f) => {
      try {
        const s = JSON.parse(runOwner.read(['nodes', f]));
        // nodeSpend lives in lib/decisions.mjs so the regression suite covers the real rule.
        return sum + nodeSpend(s, { budgetNode: BUDGET_NODE, budgetBarrier: BUDGET_BARRIER });
      } catch {
        // AN UNREADABLE STATUS IS AN UNKNOWN CHARGE, NOT NONE (G-5 of 20261023-224259-rmg-delivery), and is named; the
        // charge is lib/decisions.mjs's unreadableStatusCharge (G-3 of 20261023-231847-rmg-remediation-review).
        console.error(`run-graph: ${f} is unreadable; its spend is counted at the larger finite cap`);
        return sum + unreadableStatusCharge({ budgetNode: BUDGET_NODE, budgetBarrier: BUDGET_BARRIER });
      }
    }, 0);

// ---------------------------------------------------------------------------- phase 0
//
// CHECKED, NOT RE-RUN. The barrier used to execute unconditionally unless --skip-preflight omitted
// it silently. Both halves were wrong: a consuming project paid its whole suite before every review
// (story-pipeline: 2,866 tests, ~7 minutes, including for a review scoped to one lens), and the
// escape hatch produced a gate that said NOTHING about declared build and test having never run.
//
// What phase 0 decides now is which of three things happened, and every one of them is visible at
// the gate. `preflightOutcome` is that record; nothing below may reach a verdict without it.
const preflightOutcome = {
  state: 'ran', from: null, inferred: false, reason: null, why: null, evidence_restored: null,
};

// `known` is the input hash already computed for the reuse decision, passed down so run-checks keys
// its entry by the tree the checks START from and does not walk every input a second time. It carries the list the hash
// was taken over (`files`, for run-checks to record: G-10 of 20261012-031702-preflight-reuse-review) in the same value,
// so a list can never be paired with another hash (G-3 of 20261114-061035-m2-7b-remediation-4-review).
// checks.json as the gate reads it, on every path that reads it: absent is no results, present and unreadable is an error
// (G-10 of 20261024-032927-rrs-remediation-review), and the parsing is checksResults' (G-6 of 20261024-041845).
function readChecksJson() {
  let text = null;
  // Through the run's owner (G-1 of 20261029-050428-rdd-delivery): a link at checks.json is refused, an error here.
  try { text = runOwner.read(['checks.json']); } catch (e) {
    if (e.code !== 'ENOENT') return { results: [], error: `checks.json could not be read (${e.code ?? e.message})`, barrier_failed: null };
  }
  return checksResults(text);
}
const runPreflight = (why, known = null) => {
  console.log(`== pre-flight barrier ==${why ? `  (${why})` : ''}`);
  // The list and the hash it was taken over, recorded together, so run-checks can tell the list is this hash's (G-8 of
  // 20261114-042824-m2-7b-remediation-2-review).
  if (known?.hash) {
    runJson.checks_input_files = known.files ?? null; runJson.checks_input_files_sha256 = known.hash; writeJson(runJsonPath, runJson);
  }
  const hashArgs = known?.hash ? ['--input-hash', known.hash, ...(known.inferred ? ['--inputs-inferred'] : [])] : [];
  const r = spawnSync('node', [path.join(scriptsDir, 'run-checks.mjs'), '--run-dir', runDir, '--repo-root', repoRoot, ...hashArgs], {
    stdio: 'inherit', cwd: repoRoot, env: { ...process.env, GRAPH_NODE_DEPTH: '0' },
  });
  if (r.status === 1) {
    // WHAT THE BARRIER'S OUTCOME WAS (check-outcomes.plan.md stage 3; plan-review round 6): still BLOCKED, since nothing
    // downstream ran, but a build that did not run to its own end did not FAIL, and the gate says which it was.
    // Read through the gate's own reader, so an unreadable checks.json is named here too (G-6 of
    // 20261024-041845-rrs-remediation-2-review: a bare catch dropped it, and the unfinished checks with it).
    const cj = readChecksJson();
    if (cj.error) buckets.not_checked.push({ node_id: 'pre-flight', why: `${cj.error}, so no unfinished check it recorded can be named` });
    const { results } = cj;
    const barrier = results.find((x) => x.check === cj.barrier_failed) ?? null;
    // This exit is before the gate-time preflightNotChecked call, so its entries are added here or the machine-readable
    // not_checked[] omits the build the headline says did not finish (G-14 of 20261018-035437-co-delivery).
    for (const e of preflightNotChecked({ ...preflightOutcome, commands: contract.commands ?? {}, results })) buckets.not_checked.push(e);
    const unfinished = barrier?.outcome && !['passed', 'failed'].includes(barrier.outcome);
    writeGate('BLOCKED', unfinished
      ? `pre-flight barrier did not run to completion (${barrier.outcome}${barrier.outcome_detail ? `: ${barrier.outcome_detail}` : ''}); nothing was spawned`
      : 'pre-flight barrier failed; nothing was spawned');
    process.exit(1);
  }
  if (r.status !== 0) die(`run-checks exited ${r.status}`);
  Object.assign(runJson, JSON.parse(runRead(runJsonPath)));
};

if (args.preflight === 'always') {
  // HASHED BEFORE THE CHECKS, as auto does (G-21 of 20261114-022647-m2-7b-review): with no hash passed, run-checks hashed
  // the inputs after the checks finished, so a tree that moved while they ran was cached under content they never saw.
  // A hash that cannot be computed falls back to run-checks' own, as auto's stale path does.
  let known = null;
  try {
    const h = preflightInputHash({
      repoRoot, contract, contractSource: runJson.contract_source ?? null, reviewsDir: path.dirname(runDir),
    });
    if (h.hash) known = { hash: h.hash, inferred: h.inferred, files: h.relFiles ?? null };
  } catch (e) {
    console.error(`run-graph: could not hash the pre-flight inputs (${e.message}) — run-checks will hash them itself`);
  }
  runPreflight('--preflight always', known);
} else if (args.preflight === 'never') {
  // DECLARED OMISSION. The flag's behaviour is unchanged and its silence is not: the stamp caps the
  // gate the way UNBUILT does, and every declared command is named in not_checked[] by
  // preflightNotChecked below. "A gate that is merely silent about a declared check having not run
  // is not an acceptable outcome of any path."
  preflightOutcome.state = 'skipped';
  preflightOutcome.reason = 'skipped by request (--preflight never / --skip-preflight)';
  console.log('== pre-flight barrier: SKIPPED by request ==\n'
    + '   the declared checks did NOT run; the gate names them and caps at RISK');
} else {
  // auto — the default. Cheap: one hash of the files the declared checks read, against an entry
  // written by whichever run last ran them. The check must not cost the thing it avoids, so
  // nothing here executes a command.
  let hash = null; let inferred = false; let why = null; let listedBy = null; let relFiles = null;
  try {
    ({ hash, inferred, why, listedBy, relFiles } = preflightInputHash({
      repoRoot,
      contract,
      contractSource: runJson.contract_source ?? null,
      reviewsDir: path.dirname(runDir),
    }));
  } catch (e) {
    // Unproven freshness is staleness, and that rule covers this engine's own failure to compute
    // the proof as much as it covers a missing input.
    console.error(`run-graph: could not hash the pre-flight inputs (${e.message}) — re-running the checks`);
  }
  const entry = hash ? readPreflightCache(path.dirname(runDir), hash) : null;
  // THE TREE AS IT IS NOW (G-18 of 20260929-225147-m0-gate-review): `runJson.dirty` was frozen at mint, so an edit made
  // after mint, outside the hashed inputs, could reuse a cached result. Dirty then or now is dirty; a tree whose state
  // cannot be established now is unknown (null), which preflightDecision already refuses to reuse on.
  const dirtyAtReuse = (() => {
    const probe = gitSync(['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
    const now = probe.status === 0 ? probe.stdout.trim().length > 0 : null;
    if (runJson.dirty === true || now === true) return true;
    return runJson.dirty === false && now === false ? false : null;
  })();
  const decision = hash
    // A declared set listed by git: the hash alone decides (preflight-reuse-by-hash).
    ? preflightDecision({ entry, hash, dirty: dirtyAtReuse, hashDecides: !inferred && listedBy === 'git' })
    : { state: 'stale', reason: 'the pre-flight input set could not be resolved' };

  if (decision.state !== 'reuse') {
    runPreflight(decision.reason, hash ? { hash, inferred, files: relFiles ?? null } : null);
  } else {
    // A REUSE COUNTS AS A USE (G-10): the cache evicts least-recently-used, so refresh this entry.
    touchPreflightCache(path.dirname(runDir), hash);
    // The evidence paths the reused results cite, which the restore answers for (G-12 of 20261029-190658-rdr-delivery).
    const citedEvidence = (results) => (Array.isArray(results) ? results : Object.values(results ?? {}))
      .map((r) => r?.evidence_path).filter((p) => typeof p === 'string' && p);
    // ONE REUSE TRANSITION FOR BOTH OUTCOMES (G-5 of 20261114-051141-m2-7b-remediation-3-review): the cached failure was a
    // second copy of this block, so its checks.json lacked the provenance below and its gate exited before
    // preflightNotChecked ran (G-6). A cached failure is still a result; reuse means the outcome, not the good news.
    preflightOutcome.state = 'reuse';
    preflightOutcome.from = decision.from;
    preflightOutcome.inferred = Boolean(decision.entry.inferred ?? inferred);
    preflightOutcome.why = why;
    // THE CITED LOGS, PUT WHERE THEY ARE CITED. Every result below names an evidence_path relative
    // to a run directory; without this they name files that are not in THIS one. A reused run then
    // carries the stamps a log produced while the log is unreachable. A failure's logs too (G-22 of
    // 20260925-200721-platform-remediated).
    preflightOutcome.evidence_restored = restorePreflightEvidence(path.dirname(runDir), hash, runOwner, { cited: citedEvidence(decision.entry.results) });
    // This run's OWN checks.json, carrying the reused results and saying where they came from, so a
    // reader of the artifacts never has to go looking for a file that explains the gate.
    writeJson(path.join(runDir, 'checks.json'), {
      run_id: runJson.run_id,
      ran_at: decision.entry.ran_at,
      reused_from: decision.from,
      reused_head_commit: decision.entry.head_commit ?? null,
      reused_worktree_sha: decision.entry.worktree_sha ?? null,
      inputs_inferred: preflightOutcome.inferred,
      // Whether the paths in `results` below resolve inside THIS run directory. False means the
      // result stands on its exit codes alone: still a result, and the gate says so rather than
      // leaving a reader to find out by ENOENT.
      evidence_restored: preflightOutcome.evidence_restored,
      barrier_failed: decision.entry.barrier_failed ?? null,
      results: decision.entry.results,
      stamps: decision.entry.stamps ?? [],
    });
    // The EVIDENCE stamps the original run earned (TESTS-THIN, FMT-DIRTY, TESTS-UNCOUNTED …) travel
    // with the result. They are facts about the same tree, and dropping them would make a reused
    // run look cleaner than the run that produced its evidence. The phase's own stamps are added
    // after this block, or here on the failure path, which exits before it (G-9 of
    // 20261114-042824-m2-7b-remediation-2-review).
    runJson.stamps = [...new Set([...(runJson.stamps ?? []), ...(decision.entry.stamps ?? [])])];
    runJson.checks_ran_at = decision.entry.ran_at;
    runJson.checks_reused_from = decision.from;
    runJson.checks_input_sha256 = hash;
    writeJson(runJsonPath, runJson);
    if (decision.entry.barrier_failed) {
      runJson.stamps = [...new Set([...runJson.stamps, ...preflightStamps(preflightOutcome)])];
      writeJson(runJsonPath, runJson);
      // This exit is before the gate-time preflightNotChecked call, so its entries are added here (G-6), as the live
      // failure's exit adds them (G-14 of 20261018-035437-co-delivery).
      for (const e of preflightNotChecked({ ...preflightOutcome, commands: contract.commands ?? {}, results: decision.entry.results })) {
        buckets.not_checked.push(e);
      }
      console.error(`
BARRIER FAILED: ${decision.entry.barrier_failed} (reused from ${decision.from}) — `
        + 'the inputs are unchanged since that result, so re-running it would fail identically.');
      writeGate('BLOCKED', `pre-flight barrier failed (${decision.entry.barrier_failed}, reused from ${decision.from}); nothing was spawned`);
      process.exit(1);
    }
    console.log(`== pre-flight barrier: REUSED from ${decision.from} ==
`
      + `   ${decision.entry.results.filter((r) => r.status === 'PASS').length} check(s) passed on an identical input set`
      + `${preflightOutcome.inferred ? '; the input set was INFERRED, so the gate is capped' : ''}`);
  }
}

// The stamps for whatever phase 0 decided. One owner (lib/preflight-cache.mjs), so the cap, the
// brief and the gate cannot disagree about what happened.
{
  const s = preflightStamps(preflightOutcome);
  if (s.length) {
    runJson.stamps = [...new Set([...(runJson.stamps ?? []), ...s])];
    writeJson(runJsonPath, runJson);
  }
}

// ------------------------------------------------------- phase 0.5: precondition recovery
// A missing precondition is a signal that something upstream did not happen — a planning step
// that failed, a ticket nobody wrote, a gap in the specs. Either way the answer is the same: fill
// it and retry the work that needed it. Stopping instead would make the operator the recovery
// mechanism for a gap the graph can close itself.
//
// Recovery is BOUNDED to one attempt per precondition. A producer that fails twice is a real
// failure, and a graph that retries indefinitely converts a missing input into a spend loop.
//
// The recovered artifact is never laundered into the real thing. request-capture writes
// `status: inferred`, the run keeps a REQUEST-INFERRED stamp through to the gate, and the lens
// that depends on it is capped — an inference about what someone wanted is weaker evidence than
// their having said so, and the difference has to survive into the verdict.
const PRECONDITIONS = [
  {
    id: 'request',
    satisfied: () => Boolean(runJson.request),
    // Suppressed deliberately: --no-request means "review this code, claim nothing about intent".
    applicable: () => !(runJson.stamps ?? []).includes('UNREQUESTED'),
    producer: 'request-capture',
    stamp: 'REQUEST-INFERRED',
    // The reason the producer reads, from prompts/_templates (G-10 of 20261114-042824-m2-7b-remediation-2-review).
    why: renderTemplate(readTemplate('recovery-why-request.md'), {}, 'recovery-why-request.md').trim(),
  },
];

for (const pre of PRECONDITIONS) {
  if (!pre.applicable() || pre.satisfied()) continue;

  if (!skillInstalled(pre.producer)) {
    console.error(`run-graph: precondition '${pre.id}' unmet and producer /${pre.producer} is not installed`);
    writeStatusStub(pre.producer, 'SKIPPED', {
      skip_reason: `producer for unmet precondition '${pre.id}' is not installed`,
    });
    continue;
  }

  console.log(`\n== recovery: '${pre.id}' unmet — ${pre.why} ==`);
  console.log(`   firing /${pre.producer}, then retrying what needed it`);

  // The brief states the recovery context explicitly. Without it the producer would write
  // `status: draft` per its normal rule, the run would find no acceptable document, and the
  // recovery would report success while changing nothing.
  //
  // THE PROSE LIVES IN prompts/_templates/, NOT HERE. This brief was ~40 lines of model-facing
  // instruction assembled from string literals in the orchestrator -- reported four times. It is
  // the brief that fires on EVERY run of a repository with no approved request, so it is the one
  // whose wording shapes the inferred request every later criterion descends from, and it was the
  // hardest place in the engine for a prompt author to find.
  //
  // The list slots arrive PRE-RENDERED because lib/template.mjs has no conditionals and no loops:
  // every decision stays in code and the template holds only text.
  const scopeList = scopePaths.length
    ? scopePaths.map((x) => `- \`${x}\``).join('\n')
    : '- (whole repo)';
  const docPathList = (contract.doc_paths ?? []).map((x) => `- \`${x}\``).join('\n');
  const docRoleList = Object.entries(effectiveDocRoles(contract.doc_roles, runJson.request?.path))
    .filter(([, v]) => v)
    .map(([k, v]) => `- **${k}**: \`${v}\``)
    .join('\n');
  const recoveryBriefPath = path.join(nodesDir, `${pre.producer}-brief.md`);
  const recoveryBrief = renderTemplate(readTemplate('recovery-brief.md'), {
      producer: pre.producer,
      why: pre.why,
      missing_reason: runJson.request_missing_reason ?? '(not recorded)',
      scope_paths: scopeList,
      doc_paths: docPathList,
      doc_roles: docRoleList,
      // The fourth brief writer, and the one that fires on EVERY run of a repo with no approved
      // request -- which made it exactly the brief whose gaps were never collected (G-16).
      brief_feedback: BRIEF_FEEDBACK,
    });
  writeTracked(recoveryBriefPath, recoveryBrief);

  // Sandboxed exactly like intent-capture, and for the same reason: a request written from the
  // implementation describes what was built, so contract-audit would judge the code against a
  // description of itself and pass every time. The producer must not be able to see the source.
  const preDirs = docReadDirs(pre.producer);
  // Its sandbox is built after its brief, so what was left out is added to the brief now (stage 1b).
  const preLeftOut = leftOutSection(pre.producer);
  if (preDirs !== null && preLeftOut) writeTracked(recoveryBriefPath, recoveryBrief.replace(BRIEF_FEEDBACK, () => preLeftOut + BRIEF_FEEDBACK));
  const st = preDirs === null
    ? refusedInputStatus(pre.producer, docReadRefusal ?? 'a required input was refused')
    : await spawnNode({
      nodeId: pre.producer, skill: `/${pre.producer}`, mode: 'intent',
      schemaVariant: 'request', addDirs: preDirs, inlineSkill: true,
    });

  if (st.state !== 'OK') {
    console.error(`run-graph: /${pre.producer} did not complete (${st.state}) — precondition stays unmet`);
    runJson.stamps = [...new Set([...(runJson.stamps ?? []), `${pre.stamp}-FAILED`])];
    writeJson(runJsonPath, runJson);
    continue;
  }

  // The node emitted a validated payload; the ORCHESTRATOR writes the document (§8.1). Nodes run
  // with Write denied, so a node that tried to author the file directly would collect permission
  // denials and produce nothing — which is what the first version of this did.
  // Bound to the path the render actually returned (G-17): the old rescan of .claude/requests/ by
  // mtime meant a null render silently adopted an unrelated earlier document, and contract-audit
  // judged this run against another run's criteria with nothing recording the substitution.
  // Guarded like its three sibling failure branches: a throw here used to kill the orchestrator
  // after the recovery node was paid for, recording nothing — --resume then read a run that
  // looked unfinished rather than failed (G-12).
  let renderedPath = null;
  try {
    renderedPath = renderRequestDoc(pre.producer);
  } catch (e) {
    console.error(`run-graph: rendering the recovered request failed: ${e.message}`);
    runJson.stamps = [...new Set([...(runJson.stamps ?? []), `${pre.stamp}-FAILED`])];
    writeJson(runJsonPath, runJson);
    continue;
  }

  const produced = renderedPath ? newestRequestDoc() : null;
  if (produced && renderedPath && path.resolve(repoRoot, produced.path) !== path.resolve(renderedPath)) {
    console.error(
      `run-graph: rendered ${path.relative(repoRoot, renderedPath)} but the newest request on disk is ` +
        `${produced.path} — refusing to adopt a document this run did not produce`,
    );
    runJson.stamps = [...new Set([...(runJson.stamps ?? []), `${pre.stamp}-FAILED`])];
    writeJson(runJsonPath, runJson);
    continue;
  }
  if (produced) {
    runJson.request = produced;
    runJson.stamps = [...new Set([...(runJson.stamps ?? []).filter((s) => s !== 'REQUEST-MISSING'), pre.stamp])];
    writeJson(runJsonPath, runJson);
    rederiveExpected();
    console.log(`   recovered: ${produced.path} (status: inferred) — re-derived the node set`);
  } else {
    console.error(`run-graph: /${pre.producer} reported OK but produced no request document`);
    runJson.stamps = [...new Set([...(runJson.stamps ?? []), `${pre.stamp}-FAILED`])];
    writeJson(runJsonPath, runJson);
  }
}

// ---------------------------------------------------------------------------- phase 1: intent
// WHY THIS RUN HAS NO CRITERIA, WHEN A PROMPT-BOUND READ WAS REFUSED (G-5, G-6 of 20261115-002137-pbr-remediation-2-review):
// kept for the run so a lens requiring intent is not launched and an arm shadowing one keeps the cause, instead of each
// reading the missing intent.md as an ordinary absence. null when nothing was refused.
let intentRefusal = null;
const needsIntent = expected.some((e) => e.present && e.intent === 'required');
const haveIntent = runHas(path.join(runDir, 'intent.md')) && runJson.intent_sha256;
// INTENT PINNING (see lib/intent-cache.mjs). intent-capture is a model call, so the same documents
// produced 56, 49 and 38 criteria on three consecutive runs — a moving bar makes two runs of
// identical code incomparable, which defeats the point of a verification run. Key the derived
// intent on a hash of exactly its inputs (declared docs, the request, the skill) and reuse it while
// those are unchanged. Change any of them and the hash moves and criteria are derived again.
// A HASH THAT CANNOT BE COMPUTED MEANS NO CACHED INTENT, not a crash (G-22 of 20260929-225147-m0-gate-review): the walk
// refuses a glob outside the repository by throwing, and new-run refuses such a contract first — this is the backstop,
// as the pre-flight hash's catch is. The intent is then derived afresh, which is what an unproven cache key means.
const intentInputs = (() => {
  if (!(needsIntent && skillInstalled('intent-capture'))) return null;
  try {
    return intentInputHash({
      repoRoot,
      docPaths: contract.doc_paths ?? [],
      docRoles: effectiveDocRoles(contract.doc_roles, runJson.request?.path),
      requestPath: runJson.request?.path ?? null,
      skillPath: nodeInstructions(FRAMEWORK, 'intent-capture')?.file ?? null,
      reviewsDir: path.dirname(runDir),
    });
  } catch (e) {
    console.error(`run-graph: could not hash the intent inputs (${e.message}) — deriving the intent afresh`);
    return null;
  }
})();
const pinned = intentInputs && !args.freshIntent ? readIntentCache(path.dirname(runDir), intentInputs) : null;

// A RESUME REUSES THE INTENT IT IS RESUMING, which `--skip-intent` had to be passed by hand to get.
//
// Measured: resuming a consumer-mount run re-ran intent-capture and derived 27 criteria where the
// first attempt had 15 — and rewrote `run.json.intent_sha256` to match, so the resumed half of the
// run was judged against a bar the first half never saw, with nothing in the artifacts marking the
// change. The pinning exists for exactly this ("the same documents produced 56, 49 and 38 criteria on
// three consecutive runs"), and a resume is the case where the criteria are already frozen ON DISK,
// in this run's own directory.
//
// Gated on the hash, not merely on the file existing: `intentIsIntact()` is the same check the gate
// uses, so an intent.md that was edited between the attempts is NOT silently adopted — it falls
// through to re-derivation, and the drift stamp still fires at the gate if the file moves later.
const resumeIntent = Boolean(args.resume) && haveIntent && intentIsIntact();
if ((args.skipIntent || resumeIntent) && haveIntent) {
  console.log(`\n== intent-capture: reusing captured intent (sha ${runJson.intent_sha256.slice(0, 12)})`
    + `${resumeIntent && !args.skipIntent ? ' — resuming, so the criteria this run froze still govern' : ''} ==`);
} else if (pinned) {
  // Reuse, and say exactly whose criteria these are. The provenance is the thread to pull if a
  // pinned intent ever looks wrong; --fresh-intent forces re-derivation.
  const intentPath = path.join(runDir, 'intent.md');
  writeTracked(intentPath, pinned.intent_md);
  runJson.intent_sha256 = crypto.createHash('sha256').update(runRead(intentPath, null)).digest('hex');
  runJson.intent_reused_from = pinned.derived_by_run ?? null;
  runJson.intent_input_sha256 = intentInputs;
  runJson.stamps = [...new Set([...(runJson.stamps ?? []), 'INTENT-PINNED'])];
  writeJson(runJsonPath, runJson);
  console.log(
    `\n== intent-capture: PINNED — inputs unchanged since ${pinned.derived_by_run ?? 'an earlier run'} ==\n` +
    `intent.md: ${pinned.criteria_count ?? '?'} criteria, sha ${runJson.intent_sha256.slice(0, 12)} (reused, not re-derived)`,
  );
} else if (needsIntent && skillInstalled('intent-capture')) {
  console.log('\n== intent-capture (Rule 2 sandbox) ==');
  // docReadDirs — the DECLARED doc_paths, snapshots included — exactly as request-capture gets.
  // The old hardcoded ['specs','docs'] scan was wrong in both directions at once: it granted a
  // root the contract never declared as documentation, and it made every declared doc path
  // unreachable, so this repository's own criteria were derived from an undeclared directory
  // while shared/**, CLAUDE.md and QUORATE.md sat behind Read rules that could never fire —
  // intent-capture recorded the contamination itself, from inside the sandbox (round-3 G-13).
  const addDirs = docReadDirs('intent-capture');
  writeAuxBrief('intent-capture', 'aux-purpose-intent-capture.md');
  const intentStatus = addDirs === null
    ? refusedInputStatus('intent-capture', docReadRefusal ?? 'a required input was refused')
    : await spawnNode({
      nodeId: 'intent-capture', skill: '/intent-capture', mode: 'intent',
      schemaVariant: 'intent', addDirs, inlineSkill: true,
    });
  if (addDirs === null) intentRefusal = `${docReadRefusal ?? 'a required input was refused'}, so intent-capture did not start`;

  // WHERE THE RULE-2 PROOF ACTUALLY LIVES (G-41, panel-codex-contract). The finding asks this
  // acceptance to check the node's own permission_denials[] for a deliberate source read — and that
  // is the wrong place for it twice over. It is per-run evidence of a per-MACHINE property, it
  // depends on the node having tried (a node that simply never attempted proves only that the
  // policy is configured), and by the time it could fail the run has already paid for the node.
  // new-run's gate 4 probes intent-settings.json at MINT with a deliberate source read and a
  // positive control, and writes intent-canary.json; a run whose Rule 2 sandbox is not enforced
  // never reaches this line. The check the finding asks for would be a second, weaker copy of a
  // control that already exists earlier and cheaper.
  //
  // Render intent.md from the validated payload — the node does not write files (§8.1).
  // Only from a node that succeeded (I-5; G-23 of 20261114-022647-m2-7b-review): a payload left by an earlier attempt
  // would otherwise become this run's criteria although the node that ran now failed.
  const payloadPath = path.join(runDir, 'evidence', 'intent-capture', 'payload.json');
  // Through the egress owner (G-7 of 20261114-231942-pbr-delivery): the payload is rendered into intent.md, whose criteria
  // reach the external arm's prompt. A refusal is kept and recorded in the gate, never thrown out of the orchestrator
  // (G-6 of 20261114-235051-pbr-remediation-review); the run then has no intent.md, as when the node failed.
  let intentPayload = null;
  let intentPayloadRefused = null;
  if (intentStatus?.state === 'OK' && runHas(payloadPath)) {
    try { intentPayload = JSON.parse(promptRead(payloadPath)); }
    catch (e) {
      if (!refusedOrAbsent(e)) throw e;
      intentPayloadRefused = `${refusalWords(e)} stands at evidence/intent-capture/payload.json`;
      intentRefusal = intentPayloadRefused;
    }
  } else if (intentStatus?.state === 'OK') {
    // ABSENT IS THE REQUIRED CLASS TOO (G-2 of 20261115-013659-pbr-1b-delivery; ARCHITECTURE.md §4, A-30): a node that reported
    // OK with no payload left the read skipped and intentRefusal unset, so a lens requiring intent passed its guard.
    intentPayloadRefused = 'evidence/intent-capture/payload.json is absent';
    intentRefusal = intentPayloadRefused;
  }
  if (intentPayloadRefused) docSnapshotSkips.push({ item: 'intent.md', reason: `not rendered: ${intentPayloadRefused}` });
  if (intentStatus?.state !== 'OK' || intentPayloadRefused) {
    // A NODE THAT DID NOT FINISH OK LEAVES THE CRITERIA ABSENT, the required class (G-4 of
    // 20261115-022835-pbr-1b-remediation-review): this branch removed intent.md and left intentRefusal unset, so a lens
    // requiring intent passed its guard and judged against "(not captured)".
    if (!intentRefusal) intentRefusal = `intent-capture did not complete (${intentStatus?.state ?? 'no status'})`;
    console.error(intentPayloadRefused
      ? `run-graph: intent.md not rendered — ${intentPayloadRefused}`
      : `run-graph: intent-capture did not complete (${intentStatus?.state ?? 'no status'}) — intent.md not rendered`);
    // AND NO EARLIER ONE STANDS IN FOR IT (G-11 of 20261114-032609-m2-7b-remediation-review): this branch is reached only
    // when the criteria were to be derived afresh (--fresh-intent, or an intent.md not adopted above), so an intent.md
    // and intent_sha256 left by an earlier derivation are not this run's criteria. Removed, a lens that requires intent
    // reads "(not captured)" rather than the bar this run was asked to replace.
    const stalePath = path.join(runDir, 'intent.md');
    if (runHas(stalePath)) runOwner.remove(belowRun(stalePath));
    if (runJson.intent_sha256) {
      delete runJson.intent_sha256;
      writeJson(runJsonPath, runJson);
    }
  } else if (intentPayload) {
    const p = intentPayload;
    const md = [
      '# Intent', '',
      '_Captured before any implementation was read. Frozen once the first lens launched._', '',
      '## Criteria', '',
      ...(p.criteria ?? []).flatMap((c) => [
        `### ${c.id}`, '', c.behaviour, '',
        `**I/O contract:** ${c.io_contract}`, '',
        ...(c.failure_modes?.length ? ['**Failure modes:**', ...c.failure_modes.map((f) => `- ${f}`), ''] : []),
      ]),
      '## Assumed contract (UNVERIFIED)', '',
      ...((p.assumed_contract_unverified ?? []).length
        ? p.assumed_contract_unverified.map((a) => `- **${a.assumption}** — ${a.why_unverifiable}`)
        : ['_None recorded._']),
      '', '## Not checked', '',
      ...((p.not_checked ?? []).length ? p.not_checked.map((n) => `- **${n.item}** — ${n.reason}`) : ['_None recorded._']),
      '',
    ].join('\n');
    const intentPath = path.join(runDir, 'intent.md');
    writeTracked(intentPath, md);
    const { createHash } = await import('node:crypto');
    runJson.intent_sha256 = createHash('sha256').update(runRead(intentPath, null)).digest('hex');
    // Pin it for the next run over the same inputs, so the bar stops moving between runs.
    if (intentInputs) {
      runJson.intent_input_sha256 = intentInputs;
      writeIntentCache(path.dirname(runDir), intentInputs, {
        intent_md: md,
        criteria_count: (p.criteria ?? []).length,
        intent_sha256: runJson.intent_sha256,
        derived_by_run: runJson.run_id,
        derived_at: new Date().toISOString(),
      });
    }
    writeJson(runJsonPath, runJson);
    console.log(`intent.md: ${(p.criteria ?? []).length} criteria, sha ${runJson.intent_sha256.slice(0, 12)}`);
  }
} else if (needsIntent) {
  // A NODE THAT CANNOT RUN LEAVES THE CRITERIA ABSENT, the required class (G-2 of 20261115-031845-pbr-1b-remediation-2-review;
  // ARCHITECTURE.md §4, A-30): with intent-capture not installed no branch above ran and intentRefusal stayed unset, so a
  // lens or arm requiring intent started with no criteria.
  intentRefusal = 'intent-capture is not installed, so no criteria were captured';
  console.error(`run-graph: ${intentRefusal}`);
}

// ---------------------------------------------------------------------------- phase 2: fan-out
const alreadyOk = new Set();
if (args.resume) {
  for (const e of expected.filter((x) => x.present)) {
    if (statusPresent(e.node_id) && readStatus(e.node_id).state === 'OK') alreadyOk.add(e.node_id);
  }
}
// Panel-arm rows live in `expected` (they are part of the run's pre-commitment record) but they are
// NOT lens nodes: they carry skill: null and are spawned by spawnPanelArm, not spawn-node. Without
// this filter the fan-out spawned spawn-node once per arm, each dying instantly with "one of
// --prompt or --skill-command is required" — six wasted spawns per run, six wasted pool slots, a
// brief written per arm that nothing reads, and a lens count reported as 12 when six lenses ran.
// Harmless only while the panel ran strictly AFTER the fan-out; now that the two overlap, the bogus
// spawn races the real arm spawn on the same node_id, so this is load-bearing.
const toRun = expected.filter((e) => isFanOutNode(e) && !alreadyOk.has(e.node_id));
for (const e of toRun) writeBrief(e);

if (alreadyOk.size) console.log(`\n== resume: keeping ${alreadyOk.size} completed node(s): ${[...alreadyOk].join(', ')} ==`);
// An arm reads the shadowed lens's BRIEF (written just above) and its SKILL.md — never the lens's
// OUTPUT — and panelArmsFor() only checks that the lens is SCHEDULED, not that it finished. So the
// panel has no dependency on the fan-out completing and is started here, concurrently, instead of
// after it. Measured: six arms took 30.5 min of pure serial wall clock, each starting exactly when
// the previous ended, against a 15-min lens window they could have hidden inside.
// --resume skips arms that already reported OK, exactly as the fan-out skips lenses. The fan-out
// filtered on alreadyOk and this did not, so a resume re-ran all six arms and re-billed them:
// observed on the 2026-09-06 sweep, which announced "keeping 12 completed node(s)" — arms included
// — then spawned every one of them again, returning different findings the second time
// (panel-codex-contract went 5 -> 13). A resume that re-runs the expensive half is not a resume,
// and the divergence means the artifact stopped describing one consistent review.
//
// Filtered HERE and not inside panelArmsFor(), for two reasons: panelArmRows() calls that function
// at line ~411 to build `expected`, which is the pre-commitment record and must list EVERY arm
// including the ones a resume will skip; and `alreadyOk` is a const declared far below it, so
// reading it there is a temporal-dead-zone crash on every run.
const panelArms = panelArmsFor().filter((a) => !alreadyOk.has(a.id));
if (panelArms.length) {
  console.log(`\n== panel: ${panelArms.length} external arm(s), concurrency ${CONCURRENCY}, overlapped with fan-out ==`);
}
// Deliberately NOT awaited here. Arm rows are already in expected.json (registered pre-fan-out,
// G-30), so the pre-commitment record still precedes every spawn.
//
// TWO POOLS OF WIDTH C, not one shared cap, so peak children is up to 2xC while the panel is on
// (G-36). Deliberate: the arms spend a different vendor's quota over the network, and putting them
// in the lens pool would idle the local fan-out behind a slow remote arm — which is what the
// serialized version cost, 30.5 minutes of it. Written down in shared/claude-md-contract.md so an
// operator sizing `concurrency` knows what the number actually bounds.
// AN ISOLATED CHECKOUT FOR THE ARMS (G-43). They were pointed at repoRoot, which contains this
// run's own evidence tree — captured output that run-checks.mjs describes as possibly holding "a
// connection string, an environment dump, a token inside an error". `evidence/` is gitignored, so a
// worktree of the reviewed commit does not contain it: measured on this repository, 23 evidence
// directories in the tree and zero in the checkout. By construction, not by instruction.
//
// Torn down in a finally below, because a leaked worktree stays registered in .git/worktrees and
// the next `git worktree add` inherits it (G-4).
//
// `panelWorktree` is NOT declared here — it is hoisted above `tearDownPanelWorktree`, which reads
// it from a `process.on('exit')` handler registered hundreds of lines earlier. See the declaration
// there for what that cost.
// The builder's result (arms-read-surface): null until the panel block runs; read by panelReadSurface.
let panelBuilt = null;
// Declared BESIDE the other panel-surface facts and before the block that sets it — the
// `tbStartedAt` and `judgeId` defect in this same file was a value read above its declaration,
// twice. False until something establishes otherwise: an unestablished precondition must not
// read as a satisfied one.
let panelFrameworkReady = false;
// THE JUDGES STAND IN THIS CHECKOUT TOO, and the gate for building it asked only about the ARMS.
//
// The adjudication spawn is the second external reviewer and is pointed at `armSurface.cwd` for
// exactly the reason the arms are — "pointing it at the repository root is the defect the worktree
// exists to close", as the teardown comment says. But `if (panelArms.length)` is the only thing that
// builds it, and the adjudication phase runs in cases where no arm does: a `--resume` where every arm
// is already OK, which is precisely the shape used to reproduce an adjudication crash. On that path
// `panelReadSurface` falls back to `cwd: repoRoot`, so both judges read the repository AND the run's
// own evidence tree — captured output that may hold "a connection string, an environment dump, a
// token inside an error".
//
// Worse, the fallback's stamp was gated on `panelArms.length` as well, so the exposure was not merely
// present, it was UNRECORDED: the one thing that comment says was wrong about it in the first place
// ("it was wrong because nothing recorded it"). Both gates ask about the whole panel now.
const mayAdjudicate = adjudicationEnabled({
  skipPanel: args.skipPanel,
  externalPanel: review.external_panel,
  adjudicators: roster.adjudicators,
});
// THE RUN'S ARMS' DIRECTORIES LIVE UNDER QUORATE'S OWN HOME (arms-directory-home.design.md), which nothing else writes
// to, so `<home>/arms/<repo key>/<run-id>` is the run's by location. In the shared temp directory, four rounds each
// found a new way that proving a path was the run's could fail. Whatever an earlier, hard-killed attempt of this run
// left there is removed whole — before the panel decision, so a --skip-panel resume reclaims it too (G-6 of
// 20261003-183350-arms-dir-ownership-confirm-3). Reported, never thrown: cleanup does not stop a run. A root it refuses
// (a link at any level, G-5 of 20261003-194617-arms-dir-home-confirm) is no place to build either (G-11).
const armsHome = armsRoot({ home: quorateHome(), project: contract.project, repoRoot, runId: runJson.run_id });
let armsRefused = null;
// The cause a census copy was left out of the arms' surface for, named in each arm's brief as well as the gate (G-6 of
// 20261115-035028-pbr-1b-remediation-3-review).
let armCensusLeftOut = null;
{
  const left = reclaimArmsRoot(armsHome, { home: quorateHome() });
  if (left.removed) console.error('panel: removed the arms\' directories an earlier attempt of this run left behind');
  if (left.refused) {
    armsRefused = `the arms' directory is not built: ${left.refused}`;
    console.error(`panel: ${left.refused}; not removed, and nothing is built there`);
  }
  if (left.failed) console.error(`panel: could not remove ${armsHome}, left by an earlier attempt of this run — ${left.failed}; remove it by hand`);
}
if (panelArms.length || mayAdjudicate) {
  if (armsRefused) panelBuilt = { ok: false, why: armsRefused, withheld: [] };
  // THE ARMS' DIRECTORY IS BUILT FROM A SNAPSHOT (.claude/requests/arms-read-surface.md). It was a
  // `git worktree` checkout, patched with the dirty diff, mirrored with the untracked files, and then
  // searched for links leading out of it — and each of three review rounds found another kind of path
  // that search missed. buildArmsSurface snapshots the working state (exactly what the lens reads),
  // leaves out and names whatever resolves outside the repository, writes the rest as plain files into
  // a repository of its own holding the base commit, and asserts that no link remains.
  //
  // THE REVIEWED STATE IS head_commit PLUS THE WORKING TREE, and the diff base is base_commit, so the
  // arm's `git diff <base>` shows what the lens's does. The arm once read the PARENT of the change,
  // because this checked out base_commit (G-30, arch-review): an arm reported an empty diff.
  const dir = armsBuildDir(armsHome);   // unique to this build (G-4)
  // Named for teardown by the build's onCreated, only once the build has created it: one already there was removed
  // here anyway (G-7 of 20261002-225920-stop-child-confirm). Torn down on every exit path from then on, built or not.
  const frameworkRel = path.relative(repoRoot, FRAMEWORK.frameworkRoot);
  let maxBytes;
  try { maxBytes = panelSnapshotMaxBytes(contract); } catch (e) { panelBuilt = { ok: false, why: e.message, withheld: [] }; }
  if (!panelBuilt) {
    panelBuilt = buildArmsSurface({
      repoRoot,
      headCommit: runJson.head_commit ?? 'HEAD',
      baseCommit: runJson.base_commit ?? runJson.head_commit ?? 'HEAD',
      dir,
      // The run's own artifacts must not cross (G-21, G-37): its staging root and its archive destination.
      exclude: panelMirrorExclusions({ runDir, archiveTo: runJson.archive_to, repoRoot }),
      maxBytes,
      onCreated: (d) => { panelWorktree = d; },
      // THE FRAMEWORK MUST EXIST IN THE DIRECTORY THE ARMS READ. In the documented consumer mount it IS
      // a submodule, which a snapshot holds only as a pointer — so the arms stood in a tree without the
      // doctrine file and the detector their prompts require, and reported both absent, which the gate
      // recorded as the ARM being unavailable. It is copied in here: after the directory's own commit,
      // so `git diff <base>` does not list the whole framework as added, and before the no-links
      // assertion, so the copy is held to it. Asked of the destination, not inferred from the layout:
      // in this repository the framework IS the repository and is already there.
      beforeAssert: (d) => {
        // THE CENSUS, WHERE AN ARM CAN READ IT (ARM_CENSUS_PATH): the arm's prompt names this copy, not the run's.
        // Read from the run through its owner (run-dir-descendants stage 2); written into the arms' own directory.
        const census = ['evidence', 'remediation-census', 'payload.json'];
        if (!runOwner.isFree(census)) {
          // THROUGH THE EGRESS OWNER (G-6 of 20261114-195905-m2-pred1-remediation-2-review): this copy is what the arm reads,
          // so a second name is refused; the confined owner refuses a link only.
          // A CONTEXT INPUT (G-6 of 20261115-022835-pbr-1b-remediation-review): a refusal took the whole surface down, so
          // every arm was SKIPPED. It is left out, named with its cause, and the arms still start.
          let censusBytes = null;
          try { censusBytes = promptRead(census, null); } catch (e) {
            if (!refusedOrAbsent(e)) throw e;
            armCensusLeftOut = refusalWords(e);
            buckets.not_checked.push({ node_id: 'panel', why: `the remediation census left out of the arms' surface — ${refusalWords(e)} stands at evidence/remediation-census/payload.json` });
            console.error(`panel: the remediation census left out of the arms' surface — ${refusalWords(e)}`);
          }
          if (censusBytes !== null) {
            const armCensus = path.join(d, ...ARM_CENSUS_PATH.split('/'));
            fs.mkdirSync(path.dirname(armCensus), { recursive: true });
            fs.writeFileSync(armCensus, censusBytes);
          }
        }
        const destFramework = path.join(d, frameworkRel);
        const alreadyThere = fs.existsSync(path.join(destFramework, 'scripts', 'find-inert-features.mjs'));
        // Asked of isWithin, containment's one owner (G-13 of 20261022-034225-cid1a-remediation-2-review): across Windows
        // drives path.relative returns an absolute path, which `startsWith('..')` called inside.
        const frameworkOutside = !isWithin(repoRoot, FRAMEWORK.frameworkRoot);
        const needsPopulating = Boolean(frameworkRel) && !frameworkOutside && !alreadyThere;
        if (!needsPopulating) {
          // NOT ASSUMED READY (G-16 of 20260927-012913-arms-read-surface): the detector being present
          // said nothing about the doctrine file, and a snapshot can leave out either. A framework
          // OUTSIDE the reviewed repository (`--repo-root` another tree) is not copied in at all; the
          // arms read it where it is, by path, as before.
          if (frameworkOutside) { panelFrameworkReady = true; return { ok: true }; }
          const readiness = frameworkCopyReady({ ok: true, refused: [] }, (r) => fs.existsSync(path.join(destFramework, ...r.split('/'))));
          panelFrameworkReady = readiness.ready;
          if (!readiness.ready) console.error(`panel: the framework in the arms' directory is incomplete — ${readiness.why}`);
          return { ok: true };
        }
        const rel = frameworkRel.split(path.sep).join('/');
        const sub = copyTrackedInto(FRAMEWORK.frameworkRoot, destFramework);
        const readiness = frameworkCopyReady(sub, (r) => fs.existsSync(path.join(destFramework, ...r.split('/'))));
        panelFrameworkReady = readiness.ready;
        for (const r of (sub.ok ? sub.refused ?? [] : [])) {
          console.error(`panel: framework file ${rel}/${r.rel} not copied — ${r.why}`);
          mirrorRefusals.push({ ...r, rel: `${rel}/${r.rel}`, route: 'framework file' });
        }
        if (!readiness.ready) console.error(`panel: the framework in the arms' directory is incomplete — ${readiness.why}`);
        return { ok: true };
      },
    });
  }
  // LEFT OUT AND NAMED (operator, 2026-09-26): never silent, and never a refused snapshot for them.
  for (const w of panelBuilt.withheld ?? []) {
    console.error(`panel: ${w.path} left out of the arms' directory — ${w.why}`);
    mirrorRefusals.push({ rel: w.path, why: w.why, route: 'entry' });
  }
  if (!panelBuilt.ok) console.error(`panel: the arms' directory could not be built (${panelBuilt.why})`);
}
// TWO OUTCOMES, NO FALLBACK (arms-read-surface criterion 6; operator: "B drop"). The directory was
// built and its framework is whole, or no external reviewer runs — arms and judges alike. The
// repository root is never handed over: it is the operator's real tree, and every link-check round
// that kept missing a class was a check of that tree.
const armSurface = panelReadSurface({ built: panelBuilt, frameworkReady: panelFrameworkReady });
if (armSurface.stamp && (panelArms.length || mayAdjudicate)) {
  // STAMPED, NOT SILENT. A reader of the gate must be able to tell a run whose panel could not stand
  // anywhere safe from one whose panel was switched off.
  if (!(runJson.stamps ?? []).includes(armSurface.stamp)) {
    runJson.stamps = [...(runJson.stamps ?? []), armSurface.stamp];
    writeJson(runJsonPath, runJson);
  }
  console.error(`panel: ${armSurface.stamp} — ${armSurface.why}`);
}

// WHEN EACH FAN-OUT NODE WAS READY (telemetry-run-time.plan.md stage 2): every lens and arm is ready as its pool starts,
// so its start minus this is the wait for a slot. A resume re-times only the nodes it runs again.
{
  const readyAt = new Date().toISOString();
  const queuePath = path.join(runDir, 'queue.json');
  let queue = {};
  // Only a missing file is a first fan-out (G-13 of 20261027-071443-trt-delivery): one that cannot be read or parsed is kept
  // aside and named, never overwritten with its recorded waits lost.
  // Parsed is not enough (G-11 of 20261027-083759-trt-remediation-review): a scalar threw on the first assignment and an
  // array dropped every wait it was given, so only a plain object is a queue. Each recovery takes a name of its own, so a
  // second never replaces the first's file.
  try {
    queue = JSON.parse(runRead(queuePath));
    if (!queue || typeof queue !== 'object' || Array.isArray(queue)) throw Object.assign(new Error('not an object'), { code: 'NOT_AN_OBJECT' });
  } catch (e) {
    if (e?.code !== 'ENOENT') {
      // Set aside through the run's owner (run-dir-descendants stage 2): a name a link holds is taken, never written through.
      let aside = 'queue.unreadable.json';
      for (let n = 2; !runOwner.isFree([aside]); n++) aside = `queue.unreadable-${n}.json`;
      let kept = `kept as ${path.join(runDir, aside)}`;
      try { runOwner.rename(belowRun(queuePath), [aside]); } catch (m) { kept = `NOT kept aside (${m?.code ?? m?.message}), so overwritten`; }
      console.error(`queue: ${queuePath} could not be read (${e?.code ?? e?.message}); ${kept}, and the fan-out's waits start afresh`);
    }
    queue = {};
  }
  for (const id of [...panelArms.map((a) => a.id), ...toRun.map((e) => e.node_id)]) queue[id] = readyAt;
  // queue.json exists only for telemetry's queued_ms, so its write is a note when it fails, never the fan-out's end (G-6 of
  // 20261027-094343-trt-remediation-2-review).
  bestEffort(() => writeJson(queuePath, queue), (why) => console.error(`queue: ${queuePath} not written (${why}); the fan-out's waits go unrecorded`));
}
const panelPromise = runPool(panelArms, spawnPanelArm, CONCURRENCY, () => aborted);

console.log(`\n== fan-out: ${toRun.length} lens(es), concurrency ${CONCURRENCY} ==`);
// THE FAN-OUT'S LOOP LIVES IN lib/pool.mjs NOW (G-23, G-47). It stayed hand-rolled here because it
// does one thing runPool cannot — write a BLOCKED stub for every node the budget stopped, since
// expected.json already promised them and a promised node that leaves no artifact is silence. The
// cost was two loops interpreting review.concurrency independently, with every concurrency test in
// the suite exercising only the other one: the pool that spends the operator's own quota had no
// regression coverage at all. runBudgetedPool is that loop, in one place, testable.
await runBudgetedPool(toRun, async (e) => {
  if (e.intent === 'required' && intentRefusal) {
    writeStatusStub(e.node_id, 'BLOCKED', { launched: false, validator_errors: [`intent criteria refused: ${intentRefusal}`] });
    return;
  }
  // THE RESERVATION, written HERE and synchronously (G-19).
  //
  // The budget check reads the status files, and a node's own RUNNING status is written by the
  // CHILD — after this process spawns it, after node starts, after the module loads. Three workers
  // could pass `overBudget()` in the same tick, each seeing a total that none of them had yet
  // affected, and all three launch: the run overshoots review.budget_usd_per_run by up to
  // (concurrency - 1) node caps, silently, with the artifacts showing a budget that was respected.
  //
  // Writing the reservation in the parent closes it, because JavaScript gives this for free: this
  // line runs before any `await` in the worker, so between one worker's check and its reservation
  // no other worker can run at all. spawn-node overwrites this same file with its own richer status
  // moments later — same node_id, same path — so nothing is double-counted.
  writeStatusStub(e.node_id, 'RUNNING', { launched: true, total_cost_usd: null });
  await spawnNode({
    nodeId: e.node_id, skill: e.skill, mode: 'lens',
    instructions: e.instructions ?? null,
    schemaVariant: e.schema_variant, allowedBasis: e.allowed_basis,
    model: e.model, effort: e.effort, timeoutMinutes: e.timeout_minutes,
    severityCeiling: e.severity_ceiling, severityFloor: e.severity_floor,
    verdictCeiling: e.verdict_ceiling,
    // Unconditional, and evidence-forced twice over. The conditional it replaces inlined
    // only for foreign trees, on the premise that slash discovery works when the framework
    // lives inside the reviewed tree — and the first --reconcile-twice self-review falsified
    // that premise IN THIS REPOSITORY: every lens resolved its command to nothing (0 turns,
    // $0.001, DEGRADED), exactly as the bench worktrees had a day earlier. The aux nodes
    // never failed this way because they always inlined. Lenses now follow the same rule,
    // which is also the correctness rule: instructions come from the framework doing the
    // reviewing, never from whatever the child's cwd happens to resolve.
    inlineSkill: true,
  });
}, CONCURRENCY, {
  shouldStop: () => aborted,
  overBudget: () => {
    const spent = spentSoFar();
    // ROOM FOR THE NODE ABOUT TO LAUNCH, not merely room below the line (G-42, panel-codex-code).
    //
    // `spent >= BUDGET_RUN` admits a node whenever the current total is under the ceiling, and that
    // node then reserves and may spend a full BUDGET_NODE on top — so the last launch of a run
    // overshoots `budget_usd_per_run` by up to one node cap while the artifacts record a ceiling
    // that was respected. The reservation is exactly the quantity this test should have been
    // comparing against: a node is admitted when the run can AFFORD it, not when it has not yet
    // been paid for.
    //
    // An uncapped node budget has no reservation size, so there is nothing to require room for and
    // the test falls back to the bare comparison. That is not a hole this introduces: an uncapped
    // tier is stamped UNCAPPED-BUDGET and named in the gate's not_checked[], which is the run
    // saying it did not bound this.
    // THE RULE IS lib/decisions.mjs's (admitSpend), shared with the barrier's launches (G-9 of consumer-use-r4).
    return admitSpend({ spent, reserve: BUDGET_NODE, budgetRun: BUDGET_RUN });
  },
  onDropped: (dropped, why) => {
    for (const d of dropped) writeStatusStub(d.node_id, 'BLOCKED', { validator_errors: [why] });
    console.error(`run-graph: run budget $${BUDGET_RUN} exhausted; ${dropped.length} node(s) not launched`);
  },
});

// ------------------------------------------------------------------- external panel arms
// Runs an external reviewer on the shadowed lens's own criteria PLUS the same run brief. The arms
// now run CONCURRENTLY with the lens fan-out and with each other, bounded by review.concurrency.
// They used to run after the fan-out, one at a time, each a blocking spawnSync — 30.5 minutes of
// serialized wall clock on a six-arm run, during which SIGINT could not fire because spawnSync
// blocks the event loop (G-23, G-31). spawnCapture replaces it: async, parent-timeout backstopped,
// and registered in `live` so a signal reaches the child. The tie-break loop below now goes through
// the same helper, so the exception this comment used to record is closed rather than restated. The arm's
// envelope is written as an ordinary node status plus verdict.kept.json, so the barrier picks it
// up beside the lenses with no special case — cross-arm agreement then becomes something reconcile
// can see rather than something a human has to notice.
function panelArmsFor() {
  // --skip-panel must stop the ONE irreversible panel effect — source leaving the machine — not
  // just second-opinion and the tie-break (G-26). Honoured at the source of the arm set.
  if (args.skipPanel) return [];
  if (review.external_panel !== true) return [];
  if (!fs.existsSync(path.join(scriptsDir, 'external-review.mjs'))) return [];
  // The rule itself lives in lib/capabilities.mjs so it can be tested against inputs rather than
  // asserted against this file's source text. What stays here is the three run-level refusals
  // above, which read this module's own state.
  return armsForSelection({ panelArms: roster.panel_arms, expected });
}

// THE CAPTURED CHILD IS io/spawn-capture.mjs's (stopping-a-child stage 2): run without blocking, its output capped and
// the cap said, stopped through the one owner past its timeout. What stays here is `live`: the child joins it so an
// interrupt can stop it, and leaves it only when it is gone — a refused or unconfirmed survivor STAYS, so the stop on the way out
// and the end-of-run reaper can still reach it (G-23 of 20260925-200721-platform-remediated).
function spawnCapture(cmd, argv, opts, { timeoutMs, liveKey, liveKind = null }) {
  if (aborted) return LEAVING;
  return spawnCaptureChild(cmd, argv, opts, {
    timeoutMs,
    onSpawn: (child) => {
      if (!liveKey) return;
      live.set(liveKey, child);
      // What this child IS, remembered for the stub recordStoppedChild may have to write on its behalf.
      if (liveKind) LIVE_KIND.set(liveKey, liveKind);
    },
    onDone: ({ survivor }) => {
      // While leaving, the kind is KEPT: the stop records this child after its exit, and that record needs the kind — a
      // killed arm without `auth_mode` is charged the node cap against a budget it never touches (G-31).
      if (liveKey && !survivor) { live.delete(liveKey); if (!aborted) LIVE_KIND.delete(liveKey); }
    },
  }).then((r) => (aborted ? LEAVING : r));
}

async function spawnPanelArm(arm) {
  // NO SAFE SURFACE, NO ARM (G-12 of 20260926-002850-m0-close): every directory available would hand
  // the vendor a file behind an outward link. Recorded per arm, so the gate names the gap.
  if (!armSurface.cwd) {
    writeStatusStub(arm.id, 'SKIPPED', { skip_reason: `${armSurface.stamp}: ${armSurface.why}` });
    console.error(`panel: ${arm.id} skipped — ${armSurface.why}`);
    return;
  }
  // Derived once, here, and used for BOTH the spawn and the status record. Computing it in one
  // place and reading the roster in the other is how the two came apart.
  const armCaps = armLimits(arm);
  // THE ROLE REQUIREMENT IS ENFORCED, not merely recorded (G-55, doc-consistency-review).
  //
  // adapter-contract.md's Roles table promises that "a role is refused when a requirement is unmet,
  // and the refusal names the missing capability" — for all four roles. It was true of two. This
  // path computed `runtimeContract(adapter, 'arm')`, wrote `eligible` and `missing_for_role` into
  // expected.json, and then spawned regardless: the document's own wall-versus-specification
  // distinction, inverted, on one of the two roles that spends money at a third-party vendor. An
  // arm with no structured_output comes back as "no parseable verdict envelope", which reads as a
  // broken vendor rather than a table entry that never met the requirement.
  if (!armCaps.runtime.eligible) {
    const missing = armCaps.runtime.missing_for_role.join(', ');
    writeStatusStub(arm.id, 'SKIPPED', {
      skip_reason: `'${arm.reviewer}' cannot serve the arm role: it provides no ${missing} `
        + '(shared/adapter-contract.md). Not spawned.',
    });
    console.error(`panel: ${arm.id} skipped — '${arm.reviewer}' provides no ${missing}`);
    return;
  }
  // PER-ARM, not module-level. This was a shared `let` assigned inside the spawn and read when
  // writing that arm's status — safe only because the arms ran strictly sequentially. Running them
  // concurrently would let arm A record arm B's credential list, and since reviewerEnv is now
  // scoped per vendor (G-21) those lists genuinely differ: codex and agy pass different names. The
  // serialisation was silently load-bearing; making this a local is what makes it safe to remove.
  let armEnvPassed = [];
  // `briefFile`, not `briefPath`: this is the path TO a brief, while lib/decisions.mjs exports
  // `briefPath` for making a path safe INSIDE one. Two different things, and one name shadowing
  // the other in a 4000-line file is a trap laid for whoever edits this next.
  const briefFile = path.join(nodesDir, `${arm.shadows}-brief.md`);
  if (!runHas(briefFile)) {
    writeStatusStub(arm.id, 'SKIPPED', { skip_reason: `no brief for shadowed lens ${arm.shadows}` });
    return;
  }
  const shadowed = nodeInstructions(FRAMEWORK, arm.shadows);
  if (!shadowed) {
    writeStatusStub(arm.id, 'SKIPPED', {
      skip_reason: `no instructions for shadowed lens ${arm.shadows} in ${promptsDir} or ${skillsDir}`,
    });
    return;
  }
  const skillPath = shadowed.file;

  // A run brief carries scope and evidence mechanics, not the lens's review criteria. The
  // internal node gets those criteria by invoking the skill; Codex has no such session context,
  // so its prompt must include both. Otherwise two reviewers asked different questions can appear
  // to corroborate one another merely because they share the same scope.
  // THE CRITERIA TRAVEL TO THE ARM; THE ARM NEVER TRAVELS TO THE RUN DIRECTORY.
  //
  // The brief tells a node to read intent.md. An arm may not, so the arm shadowing the one lens that
  // MUST cite I-n was the one node structurally unable to see the ask, and it said so rather than
  // guessing: panel-codex-contract returned RISK with "the authoritative intent.md criteria were not
  // provided inline and the external-arm rules prohibit reading the run directory". The engine read
  // that not_checked[] entry correctly and declined to call the empty candidates[] clean — that rule
  // works. The prompt was what was broken.
  //
  // Only a lens declaring intent: 'required' gets this; for every other arm the criteria are not
  // merely unnecessary but wrong to send, since its shadowed lens may not cite I-n either. The arm's
  // own expected entry keeps intent: 'forbidden', which stays true: it still may not read the file.
  const shadowedLens = LENSES.find((l) => l.id === arm.shadows);
  let armCriteria = '';
  if (shadowedLens?.intent === 'required') {
    // BLOCKED, the required class (G-9, G-2 of 20261115-013659-pbr-1b-delivery; ARCHITECTURE.md §4, A-30): the arm's criteria are a
    // required input, and refused or absent they start no arm, recorded BLOCKED with the cause, as the lens it shadows is.
    if (intentRefusal) {
      writeStatusStub(arm.id, 'BLOCKED', { launched: false, source: arm.reviewer, shadows: arm.shadows, validator_errors: [`intent criteria refused: ${intentRefusal}`] });
      console.error(`panel: ${arm.id} not launched — intent criteria refused: ${intentRefusal}`);
      return;
    }
    try {
      // Through the egress owner (G-7 of 20261114-195905-m2-pred1-remediation-2-review): the criteria go into the vendor prompt.
      armCriteria = criteriaSection(promptRead(['intent.md']));
    } catch (e) {
      if (!refusedOrAbsent(e)) throw e;
      // A REFUSAL IS NOT AN ABSENCE (G-8 of 20261114-231942-pbr-delivery): a link, a second name or a file over the bound at
      // intent.md keeps its cause and launches no arm, as the gate keeps the cause of a refused payload.
      if (e.code === 'ECONFINED') {
        writeStatusStub(arm.id, 'BLOCKED', { launched: false, source: arm.reviewer, shadows: arm.shadows, validator_errors: [`intent criteria refused: ${refusalWords(e)} stands at intent.md`] });
        console.error(`panel: ${arm.id} not launched — ${refusalWords(e)} stands at intent.md`);
        return;
      }
      // ABSENT IS THE SAME CLASS (G-2 of 20261115-013659-pbr-1b-delivery): an arm was started with empty criteria when
      // intent.md was absent, against ARCHITECTURE.md §4, A-30's "a required input refused, or absent, starts no node it feeds".
      const why = 'intent.md is absent';
      writeStatusStub(arm.id, 'BLOCKED', { launched: false, source: arm.reviewer, shadows: arm.shadows, validator_errors: [`intent criteria unavailable: ${why}`] });
      console.error(`panel: ${arm.id} not launched — ${why}`);
      return;
    }
  }

  // THE SHADOWED LENS'S BRIEF IS A REQUIRED INPUT (G-8 of 20261115-022835-pbr-1b-remediation-review): read inline in the
  // prompt's construction, a refusal escaped this function before the arm had a status. Refused, no arm starts.
  // Through the egress owner too (G-8 of 20261114-195905-m2-pred1-remediation-2-review): runRead refuses a link, not a
  // second name, and the brief goes into the vendor prompt.
  let armBrief;
  try { armBrief = promptRead(briefFile); } catch (e) {
    if (!refusedOrAbsent(e)) throw e;
    writeStatusStub(arm.id, 'BLOCKED', { launched: false, source: arm.reviewer, shadows: arm.shadows, validator_errors: [`shadowed lens brief refused: ${refusalWords(e)} stands at nodes/${path.basename(briefFile)}`] });
    console.error(`panel: ${arm.id} not launched — ${refusalWords(e)} stands at nodes/${path.basename(briefFile)}`);
    return;
  }

  const promptPath = path.join(nodesDir, `${arm.id}-prompt.md`);
  writeTracked(
    promptPath,
    buildArmShadowPrompt({
      lensId: arm.shadows,
      // THROUGH THE EGRESS OWNER (G-12 of 20261112-054852-hl-remediation-3-review): these instructions go into the arm's
      // vendor prompt, so a link or a second name is refused; rooted at the framework, as claim-check's checker is.
      skillMarkdown: egressReadFile(skillPath, 'utf8', { repoRoot: FRAMEWORK.frameworkRoot }),
      runBrief: armBrief,
      intentCriteria: armCriteria,
      // The roster owns whether this lens may cite intent; the prompt library is told, never left to
      // infer it from whether criteria happen to be empty (G-22).
      intentMode: shadowedLens?.intent,
      // A census left out of the arms' surface is named here, in the arm's brief, not only in the gate (A-30).
      censusLeftOut: armCensusLeftOut,
      // arm.reviewer is threaded to the adapter flag, the credential allow-list, the probe, the
      // source tag and the status record — and was hardcoded in the ONE input that tells the model
      // which reviewer it is. An agy arm would have launched under a prompt naming Codex: a seam
      // swappable everywhere except where it is named is not swappable.
      reviewer: arm.reviewer,
    }),
  );

  const armModel = String(arm.model ?? '').trim();
  const armEffort = String(arm.effort ?? '').trim();

  // AN ARM GETS THE CLOCK ITS SHADOWED LENS GETS.
  //
  // Every arm was launched with the global node timeout while the lens it shadows may declare its
  // own — contract-audit and security-audit both declare 30 minutes, with a roster note recording
  // the measurement that forced it: their cost scales with the SOURCE SURFACE they audit, not with
  // diff size. The arm reviews that same surface against those same criteria, so 15 minutes was
  // never the right budget for it.
  //
  // Observed twice: panel-codex-contract took 12 minutes in one run and was killed at exactly 15:00
  // in the next. It reported as `spawn error: spawnSync cmd.exe ETIMEDOUT` — see the timeout
  // classification in external-review — so two consecutive runs looked like a flaky vendor CLI when
  // the arm was simply being cut off mid-review.
  //
  // An arm may still declare its own `timeout_minutes` and win; otherwise it inherits, and only then
  // falls back to the global.
  // `shadowedLens` is resolved once above, where the criteria decision needs it. It was looked up a
  // second time here; two lookups of one fact is A-1's rule waiting to be broken by whichever copy a
  // later edit misses.
  const armTimeout = armMinutes(arm, shadowedLens);

  const started = new Date().toISOString();
  const r = await spawnCapture(
    'node',
    [
      path.join(scriptsDir, 'external-review.mjs'),
      '--run-dir', runDir, '--node-id', arm.id, '--reviewer', arm.reviewer,
      '--prompt-file', promptPath,
      '--schema', JSON.stringify({ verdict: 'PASS|RISK|FAIL', findings: '[{severity,file,line,claim}]' }),
      '--timeout-minutes', String(armTimeout),
      // Declared per arm in lens-roster.json ($panel_runtime), never defaulted here. An arm that
      // declares neither sends no flag and external-review.mjs names the omission in
      // not_checked[], so an unpinned runtime is visible rather than assumed.
      ...(armModel ? ['--model', armModel] : []),
      ...(armEffort ? ['--effort', armEffort] : []),
      // THE DERIVED CEILINGS, not the raw roster entry (G-15, contract-audit + panel-codex-contract).
      // armLimits() computes what this runtime can substantiate, tightens it by any roster
      // declaration, and writes the result into nodes/expected.json — and the spawn passed
      // `arm.severity_ceiling` straight from the roster, so the derivation governed the ARTIFACT and
      // nothing else. Identical values today, because the roster happens to declare what the
      // derivation computes; an adapter that declared evidence_capture would have been capped
      // anyway, which is the exact failure mode the derivation was built to remove. A record that
      // describes a cap the run did not apply is the shape this file has already corrected once.
      ...(armCaps.severity_ceiling ? ['--severity-ceiling', String(armCaps.severity_ceiling)] : []),
      ...(armCaps.verdict_ceiling ? ['--verdict-ceiling', String(armCaps.verdict_ceiling)] : []),
      // AND THE BASIS IT MAY CLAIM. external-review stamped every arm finding `convention` as a
      // literal; it now receives the derived enum and refuses a stamp outside it, so the two cannot
      // describe the same arm differently.
      '--allowed-basis', armCaps.allowed_basis.join(','),
      // The arm READS the arms' directory; external-review itself stays in the repository, where its
      // containment and consent are decided (arms-read-surface: the directory is its own repository).
      '--surface', armSurface.cwd,
    ],
    // ALLOW-LIST, not a deny-list. The first "scrub" removed five Anthropic keys and spread the
    // rest, which handed a third-party agentic CLI every other secret the operator's shell
    // carried — GITHUB_TOKEN, AWS keys, database URLs — under a comment claiming the environment
    // was scrubbed (the verification run's G-19, credential_exposure, non-waivable). A deny-list
    // cannot bound an open set of secrets; only naming what the arm NEEDS can. It gets: the
    // variables a process needs to execute at all, the reviewer vendors' own configuration and
    // credentials (their prefixes, their auth — that is whose CLI this is), and the depth guard.
    // What was passed, not what was stripped, is what gets recorded on the arm's status.
    // reviewerEnv (lib/decisions.mjs) is the ONE owner of what an external reviewer inherits. It
    // lived inline here until the tie-break spawned the same child without it (G-36 BLOCKER).
    (() => { const { env, passed } = reviewerEnv(arm.reviewer, process.env, {
        depth: 0, prefixes: envPrefixesOf(REVIEWER_TABLE[arm.reviewer]), names: envNamesOf(REVIEWER_TABLE[arm.reviewer]),
      }); armEnvPassed = passed;
      return { cwd: repoRoot, env: { ...env, ...ENGINE_LOCATION }, ...hostPlatform().proc.killableSpawnOptions() }; })(),
    // Backstop only: external-review.mjs enforces --timeout-minutes itself. Give the parent a
    // margin over that so the child reports its own timeout (with an envelope) in the normal case,
    // and this fires solely if the child is wedged.
    {
      timeoutMs: timerMs(armTimeout, 2),
      liveKey: arm.id,
      // An arm killed mid-flight is still billed by its own vendor, not by this account (G-31).
      liveKind: { auth_mode: authModeFor(NODE_KIND.arm), kind: NODE_KIND.arm, source: arm.reviewer },
    },
  );

  // WHAT THE PROCESS DID, on every record of this arm (telemetry-records.plan.md stage 1c): exit code, signal, whether the
  // backstop timer stopped it, and the limit that applied. A Claude node's status carried these and an arm's did not, so a
  // slow or failing arm could not be told apart from a slow or failing reviewer.
  const armProcess = { exit_code: r.status ?? null, signal: r.signal ?? null, timed_out: r.timedOut === true, timeout_minutes: armTimeout };

  let env = null;
  try { env = JSON.parse(r.stdout); } catch { /* external-review always prints one, exit 5 included; treat as absent */ }

  if (!env) {
    writeStatusStub(arm.id, 'DEGRADED', {
      launched: true, started_at: started, reviewer_answered: false,
      validator_errors: [`external-review.mjs produced no parseable envelope (exit ${r.status})`],
      // The arm's auth mode, as the unreachable-probe branch below records it: without it nodeSpend charges a launched
      // node of unknown cost the per-node cap, for money its vendor bills elsewhere (G-1 of
      // 20261114-070441-m2-7b-remediation-5-review; operator, 2026-11-16: "Fix in this session, 9a reviews it (Recommended)").
      auth_mode: authModeFor(NODE_KIND.arm),
      // A survivor and a truncation are kept with the record (G-11, G-13 of 20261002-215002-stop-child-review).
      ...capturedStatusFields(r), ...armProcess,
    });
    return;
  }

  // classifyPanelProbe separates a reviewer that RAN from one that was unavailable (missing binary,
  // timeout, refusal, a failed preflight) — external-review.mjs always prints a parseable envelope,
  // exiting 0, or 5 for a reviewer that failed its preflight, so recording state OK for any parse made an arm that reviewed nothing indistinguishable at the
  // gate from one that found nothing (G-25/G-28). This cluster was written for the panel round and
  // silently did not persist — a python block failed on its last line, so only the import landed;
  // the verification run caught the import with no call. Applied for real, grep-verified.
  const probe = classifyPanelProbe(env, arm.reviewer);
  if (probe.state !== 'reachable') {
    writeStatusStub(arm.id, armUnreachableState(probe), { // BLOCKED for a refused prompt file (G-5 of 20261115-045745-pbr-1b-remediation-5-review)
      launched: true, started_at: started, reviewer_answered: false, source: arm.reviewer, shadows: arm.shadows,
      ...capturedStatusFields(r), ...armProcess,
      // The vendor call's entry (runtime-call-telemetry.plan.md stage 3), not answered: the probe classified it unreachable.
      call: markAnswered(env?.call ?? null, false),
      auth_mode: authModeFor(NODE_KIND.arm), env_passed: armEnvPassed,
      // TOKENS SURVIVE A FAILURE. This branch replaced the envelope with a stub and dropped
      // `env.usage`, so a reviewer that consumed tokens and THEN refused or timed out reported
      // nothing and the run understated what it spent (G-38). Same rule spawn-node already
      // follows for cost — "the cost of a failed node is exactly as real as the cost of a
      // successful one" — and the one this whole accounting pass exists to apply.
      model: armModel || null, effort: armEffort || null,
      // WALL CLOCK SURVIVES A FAILURE for the same reason the tokens do, and it is timed by
      // external-review at the spawn site because no vendor reports it. Without this every
      // arm row read 0.0 minutes and any latency comparison including an arm was silently
      // Claude-only. null means the child never launched -- not the same fact as 0 ms.
      duration_ms: typeof env?.duration_ms === 'number' ? env.duration_ms : null,
      total_cost_usd: null, usage: env?.usage ?? null,
      // THE SAME LEAK AS THE JUDGES', IN THE OLDER PATH. external-review's unavailable reason is
      // `exited <n> with no output: <the vendor CLI's stderr>`, and `nodes/*.status.json` is TRACKED
      // while `evidence/` is gitignored precisely because it holds content. Fixing this for the
      // adjudicators and leaving the arms — which run on EVERY panel sweep rather than on a rare
      // dispute — was fixing the rarer half of one defect. Raised by panel-codex-security.
      // A PREFLIGHT REFUSAL IS NAMED (G-11 of 20261009-232840-reviewer-preflight-r1): its reason is the engine's own
      // sentence, and this writer redacts it like everything tracked; any other failure stays a pointer.
      ...(preflightRefusal(probe.reason) ? { preflight_refused: preflightRefusal(probe.reason) } : {}),
      validator_errors: [preflightRefusal(probe.reason)
        ? `arm refused before its call — ${preflightRefusal(probe.reason)}`
        : `arm ${probe.state} — detail in evidence/${arm.id}/failure.json `
          + "(gitignored, not quoted here: a vendor's stderr can carry a credential and this file is tracked)"],
      failure_detail: `evidence/${arm.id}/failure.json`,
      not_checked: [{ item: `panel arm ${arm.id}`, reason: `${probe.state} — see evidence/${arm.id}/failure.json` }],
    });
    try {
      const dir = path.join(runDir, 'evidence', arm.id);
      runDirOf(dir);
      writeJson(path.join(dir, 'failure.json'), {
        node_id: arm.id, state: probe.state, reason: probe.reason ?? null,
      });
    } catch (e) {
      console.error(`panel: could not write failure detail for ${arm.id}: ${e.message}`);
    }
    // REDACTED: the reason can quote the vendor CLI's stderr, and the console reaches terminal and CI logs (G-12 of
    // 20261002-215002-stop-child-review). failure.json above keeps the whole reason, in the directory git ignores.
    console.log(`${arm.id}: ${probe.state} — ${redactClaim(probe.reason)}`);
    return;
  }

  const evDir = path.join(runDir, 'evidence', arm.id);
  runDirOf(evDir);
  // G-33: this file's NAME asserts it is the validated set — spawn-node writes it only after
  // validateVerdict, and collectFindings reads both producers indiscriminately into
  // finding-groups.json, the reconciler's only input, and thence into reconciled.md, which is
  // remediate's work list under bypassPermissions. Writing it straight from the reviewer envelope
  // with rejected_count: 0 asserted a validation that had never run, so an arm finding reached the
  // barrier unchecked for repository containment, file existence, line bounds and the
  // generated-glob exclusion, while external-review passes f.file through verbatim. A codex arm
  // returning '../../.ssh/config' was therefore a counted finding. Arm findings now pass the same
  // scope owner the lenses use (lib/finding-scope.mjs), and the counts are honest.
  const genGlobs = runJson.contract?.generated_globs ?? [];
  const armKept = [];
  const armRejected = [];
  const armOutOfScope = [];
  // The verdict ceiling applied after this loop is armLimitsFor's since G-8 of
  // 20261111-015717-dps-remediation-10-review; a roster entry may only repeat it.
  for (const f of env.findings ?? []) {
    // source on EVERY finding (G-32): reconcile weights cross-arm agreement above two Claude
    // lenses agreeing, and needs to know the family — external-review set it on the envelope only.
    const tagged = { ...f, source: arm.reviewer };
    const why = findingScopeErrors(tagged, { repoRoot });
    // Arms follow the same §8.5 rule as lenses. The generated-glob case moved out of
    // findingScopeErrors into findingOutOfScope; without this branch the arm path would silently
    // start KEEPING generated-path findings it used to reject — one owner, two writers, and only
    // one updated, which is the exact shape of the scope-validation gap this file already records.
    const oos = findingOutOfScope(tagged, {
      generatedGlobs: genGlobs, declaredGlobs: declaredSurface(runJson.contract),
    });
    if (oos && !why.length) {
      armOutOfScope.push({ file: tagged.file, note: `${oos} — ${String(tagged.claim ?? '').slice(0, 300)}` });
    } else if (why.length) armRejected.push({ ...tagged, rejected_because: why });
    else armKept.push(tagged);
  }
  // The verdict floor applies to ARMS TOO (G-37). verdictFloorFromFindings had exactly one call
  // site — spawn-node — and an arm envelope never takes that path: spawnPanelArm wrote
  // `verdict: env.verdict` straight into both verdict.kept.json and the status file. So an arm
  // returning PASS beside its own MEDIUM findings landed in buckets.ok as PASS and writeGate's RISK
  // test never fired. Same shape as the scope-validation gap: one owner, two writers, and only the
  // lens path went through it. The floor is derived from the findings that SURVIVED scope
  // validation, then the ceiling armLimitsFor computed, the one passed to external-review above,
  // still caps it. Its verdict ceiling is the convention rung's whatever the arm's roster entry
  // says (G-11 of 20261111-024650-dps-remediation-11-review); the entry may only repeat it.
  const armFloor = verdictFloorFromFindings(armKept);
  // FLOOR, THEN CEILING — in that order, as the lens path already does (G-45, code-audit).
  //
  // The ceiling was applied in the CHILD process, external-review capping its own verdict before it
  // returned; this then raised that verdict to the floor and capped nothing. So an arm whose kept
  // findings reached the FAIL floor ended at FAIL — above its declared `verdict_ceiling: RISK` —
  // and writeGate promotes any FAIL to a FAIL gate. That is the cheap-reviewer cascade the ceiling
  // exists to prevent, arriving from an evidence path this run cannot verify, and the comment
  // directly above asserted the ceiling "still caps it" while nothing here did.
  //
  // spawn-node computes the floor and THEN caps, deliberately, so a capped node ends at its cap.
  // Two paths through one rule, and only one of them applied it in the order that makes the cap
  // binding. The floor still does its job: an arm reporting PASS beside its own MEDIUM findings is
  // raised, just never past what its runtime may claim.
  const armVerdict = capVerdict(raiseVerdict(env.verdict, armFloor), armCaps.verdict_ceiling ?? null);

  if (armRejected.length) {
    runOwner.replace(
      belowRun(path.join(evDir, 'verdict.rejected.json')),
      JSON.stringify({ schema_version: 1, node_id: arm.id, rejected: armRejected }, null, 2) + '\n',
    );
    console.log(`${arm.id}: ${armRejected.length} finding(s) rejected on scope — see evidence/${arm.id}/verdict.rejected.json`);
  }
  runOwner.replace(
    belowRun(path.join(evDir, 'verdict.kept.json')),
    JSON.stringify({
      schema_version: 1, run_id: runJson.run_id, node_id: arm.id,
      verdict: armVerdict, kept_count: armKept.length, rejected_count: armRejected.length,
      findings: armKept,
      // Same artifact key the lens path writes, so the gate reads ONE shape for both (§8.5).
      out_of_scope_observations: [...(env.out_of_scope_observations ?? []), ...armOutOfScope],
    }, null, 2) + '\n',
  );

  // A REPORT, LIKE EVERY OTHER NODE — and `report_sha256` hashes THAT (G-33). The arm path hashed
  // `JSON.stringify(env.findings)` under the same field name that spawn-node uses for the sha of a
  // rendered file, so one status key carried two meanings and a consumer such as version-gate could
  // not verify what it was given. The orchestrator renders the arm's report because the arm cannot:
  // it has no session and no renderer, which is exactly why the field was improvised in the first
  // place. Marked as orchestrator-rendered, so nobody mistakes it for the reviewer's own prose.
  const armReportPath = path.join(nodesDir, `${arm.id}-report.md`);
  {
    const L = [`# ${arm.id} — ${armVerdict}`, ''];
    L.push('| | |', '|---|---|');
    L.push(`| Run | \`${runJson.run_id}\` |`);
    L.push(`| Node | \`${arm.id}\` (external arm, ${arm.reviewer}${armModel ? `, model \`${armModel}\`` : ''}) |`);
    L.push(`| Shadows | \`${arm.shadows}\` |`);
    L.push(`| Findings | ${armKept.length} kept, ${armRejected.length} rejected on scope |`);
    L.push('', '_Rendered by the orchestrator from the validated envelope: an external arm has no',
      'session and writes no report of its own._', '');
    L.push(`## Findings (${armKept.length})`, '');
    for (const f of armKept) {
      L.push(`### ${f.severity} · ${f.basis ?? 'convention'} · \`${f.file}:${f.line}\``, '');
      L.push(String(f.claim ?? ''), '');
      if (f.evidence_path) L.push(`Evidence: \`${f.evidence_path}\``, '');
    }
    if (armRejected.length) {
      L.push(`## Rejected on scope (${armRejected.length})`, '');
      for (const f of armRejected) L.push(`- \`${f.file}:${f.line}\` — ${(f.rejected_because ?? []).join('; ')}`);
      L.push('');
    }
    writeTracked(armReportPath, `${L.join('\n')}\n`);
  }

  // MASS REJECTION IS NOT A SUCCESSFUL REVIEW (G-32). spawn-node fails a lens whose findings were
  // more than half rejected — "the review was not performed" — and the arm path wrote state OK
  // regardless, so an arm whose every finding was thrown out on scope still counted as a delivered
  // second family. panelSilent then saw a reporting arm, and the gate could claim cross-family
  // corroboration nobody supplied. Same rule, same threshold, applied to both writers.
  const armTotal = armKept.length + armRejected.length;
  const armUnusable = armTotal > 0 && armRejected.length / armTotal > 0.5;

  writeTrackedJson(path.join(nodesDir, `${arm.id}.status.json`), {
    schema_version: 1, run_id: runJson.run_id, node_id: arm.id,
    ...capturedStatusFields(r), ...armProcess,
    // The vendor call's entry (runtime-call-telemetry.plan.md stage 3), answered: the probe classified the envelope reachable.
    call: markAnswered(env?.call ?? null, true),
    state: armUnusable ? 'DEGRADED' : 'OK',
    // THE REVIEWER ANSWERED (G-18 of 20261010-051458-reviewer-preflight-r4), whatever the scope check then made of it.
    reviewer_answered: true,
    verdict: armVerdict, verdict_before_floor: armVerdict !== env.verdict ? env.verdict : undefined,
    source: arm.reviewer, shadows: arm.shadows,
    // session_id and report_sha256, the attribution pair every node carries (G-29).
    session_id: env.session_id ?? null,
    report_path: path.relative(runDir, armReportPath),
    report_sha256: crypto.createHash('sha256').update(runRead(armReportPath, null)).digest('hex'),
    // The reviewer and the MODEL it ran are different facts. Recording only `source: codex` left a
    // finding unreproducible the moment a developer changed their local Codex default.
    model: armModel || null, effort: armEffort || null,
      // WALL CLOCK SURVIVES A FAILURE for the same reason the tokens do, and it is timed by
      // external-review at the spawn site because no vendor reports it. Without this every
      // arm row read 0.0 minutes and any latency comparison including an arm was silently
      // Claude-only. null means the child never launched -- not the same fact as 0 ms.
      duration_ms: typeof env?.duration_ms === 'number' ? env.duration_ms : null,
    // auth_mode names the credential path (G-23's attribution promise): the arm authenticates as
    // its own vendor, never through any Anthropic credential. env_passed is the allow-list's
    // whole output — recording what CROSSED the boundary, which for an allow-list is the fact an
    // auditor needs, where env_stripped only ever named the five keys a deny-list knew about.
    auth_mode: authModeFor(NODE_KIND.arm),
    env_passed: armEnvPassed,
    not_checked: Array.isArray(env.not_checked) ? env.not_checked : [],
    launched: true, started_at: started, ended_at: new Date().toISOString(),
    // The VALIDATED counts, matching verdict.kept.json. Reporting the envelope's raw length with
    // rejected_findings_count: 0 restated the same false claim the artifact made (G-33): the gate
    // would show an arm's findings_count including findings the barrier never received.
    findings_count: armKept.length, rejected_findings_count: armRejected.length,
    graph_node_depth: 1,
    validator_errors: armUnusable
      ? [`${armRejected.length}/${armTotal} findings rejected on scope (>50%) — the review was not performed`]
      : [],
    // NOT ZERO — UNKNOWN. The dollar figure belongs to the vendor's own account and is not knowable
    // here, and `0` asserted it was free: the 2026-09-06 sweep reported $47.88 while six arms spent
    // real money invisibly, twice, because --resume re-ran them. Absent is not the same as zero,
    // which is the rule this framework applies to every other missing measurement.
    total_cost_usd: null,
    // What IS knowable, and what the operator's quota is actually measured in. Both CLIs report it
    // and this framework was discarding it: agy in the JSON wrapper it already parses, codex on the
    // --json event stream. null means the CLI reported none — a gap to name, not a zero to record.
    usage: env.usage ?? null,
  });
  // WHAT THE RUN RECORDED, not what the reviewer said (G-31, code-audit). This printed the raw
  // envelope after armKept/armRejected/armVerdict had already been computed and written into
  // verdict.kept.json and the status file — so an arm whose findings were rejected on scope, or
  // whose PASS was raised by the verdict floor, announced a verdict and a count that contradicted
  // every artifact of the same run, and the operator watching the console read a different result
  // from the one the gate would compute. Rejections are named rather than silently subtracted.
  console.log(`${arm.id}: ${armVerdict} (${armKept.length} finding(s)`
    + `${armRejected.length ? `, ${armRejected.length} rejected on scope` : ''})`);
}

// The panel was STARTED before the fan-out (overlapped); the barrier cannot open until it is done,
// so this is where it is joined. Ordering guarantee that matters (G-15/G-20): expected.json is the
// run's pre-commitment record — "which nodes were SUPPOSED to run", written before they do — and
// the arm rows were registered pre-fan-out (G-30), so no arm status file exists that nothing
// expected, even if a kill lands mid-panel.
// GUARDED, BECAUSE AN ARM WORKER THROW KILLED THE RUN BEFORE ITS GATE. `spawnPanelArm` is 22k of
// logic with two inner catches and no wrapper, so anything it throws reaches `runPool`, which
// rethrows as an AggregateError — and this await had no catch at all. An unhandled rejection at the
// top level of an ESM module takes the process out: no gate.json, no gate.md, no verdict of any
// kind, on a run that had already paid for every lens. That is this system's central rule inverted —
// silence is not a verdict, and a crash before the gate is the loudest possible silence.
//
// The barrier already handles arms that did not report: expected.json committed their rows before
// they launched, so a missing status is a FINDING about the run rather than an absence. Continuing to
// the gate is therefore strictly better than dying, and the causes are recorded the same way the
// adjudication phase records its own.
try {
  await panelPromise;
} catch (e) {
  const causes = crashCauses(e);
  const summary = crashSummary(causes) || String(e?.message ?? e);
  let detail = null;
  try {
    const dir = path.join(runDir, 'evidence', 'panel');
    runDirOf(dir);
    writeJson(path.join(dir, 'crash.json'), crashRecord({ phase: 'panel', error: e, causes, at: new Date(hostPlatform().now()).toISOString() }));
    detail = 'evidence/panel/crash.json';
  } catch (writeErr) {
    console.error(`panel: could not write the crash detail: ${writeErr.message}`);
  }
  console.error(`panel: ${causes.length} arm worker(s) threw — ${summary}`);
  for (const c of causes) console.error(String(c?.stack ?? c).split('\n').slice(0, 4).join('\n'));
  buckets.not_checked.push({
    node_id: 'panel',
    why: `the panel phase threw — ${causes.length} arm worker failure(s): ${summary}`
      + `${detail ? ` (stacks in ${detail}, gitignored)` : ''} — any arm without a status file below `
      + 'did not report, and the run continues to a gate rather than ending with no verdict at all',
  });
}
// EVERY DOCUMENT THE INTENT SNAPSHOT REFUSED, named in the gate (G-16). A declared document missing
// from what intent-capture read is a gap in the run, and a reader who cannot see it over-trusts the
// intent the run was judged against.
for (const r of mirrorRefusals) {
  buckets.not_checked.push({ node_id: 'panel', why: `${r.route} ${r.rel} withheld from the external reviewers — ${r.why}` });
}
for (const skip of docSnapshotSkips) {
  buckets.not_checked.push({ node_id: 'intent-capture', why: `${skip.item} — ${skip.reason}` });
}
for (const c of contextRefusals) {
  buckets.not_checked.push({ node_id: 'lenses', why: `${c.item} left out of the briefs — ${c.reason}` });
}
// NOT TORN DOWN HERE ANY MORE. The tie-break spawn runs in this same checkout — it is the second
// external reviewer, and pointing it at the repository root is the defect the worktree exists to
// close (G-32) — so freeing it before the barrier would leave the adjudicator nowhere contained to
// stand. It is freed immediately after the last ruling instead, and the signal handler and the exit
// hook still free it on every abnormal path, so a leaked checkout cannot outlive the process.

// ------------------------------------------------------------------- the batched barrier (one runner)
// THE BATCH LOOP, ONE FOR THE BARRIER AND THE RE-ASK (reconcile-reask-shape.plan.md stage 1; design RA-D1 A, operator,
// 2026-10-24: "1 A"). The re-ask had its own loop, which sliced its groups by position and granted, charged and validated
// beside this one (G-4, G-7, G-10 of the rmg chain). Both now run their batches here: the loop takes a GROUP SET and
// partitions it itself, with lib/reconcile-batches.mjs reconcileBatches (G-5 of 20261024-024945-rrs-delivery: it took
// batches each caller had partitioned), and returns the partition. For each batch, in turn: a share of the barrier's time and
// budget still left (batchFraction, batchShare, with the floor), its groups file and brief, the node, its charge
// (batchCharge), its reply validated against its own groups (validateBatchReply) and its links against its own rows
// (checkRootLinks), and its status and payload kept in `evidenceDir`. A failed batch ends the loop, as one failed reconcile
// fails the barrier. Returns each batch's status, validated payload, grant and charge, why it stopped early if it did, and
// the batches and split files of the partition.
// THE NODE ID AND ITS PAYLOAD ARE THE CALLER'S (reconcile-reask-record.plan.md stage 1; RR-D1 A, operator, 2026-10-24:
// "as suggested, continue"): the barrier runs `reconcile` into evidence/reconcile/payload.json, the re-ask runs
// `reconcile-reask` into its own, as the calibration run's `reconcile-b` has its own. The loop removes, before each spawn,
// only the payload path it was given, so no batch of the re-ask writes the first reply's payload, status or brief; the
// re-ask, once its loop ends, adds the `reask` record to that status and writes the merged payload over that payload.
async function reconcileBatchLoop(groups, { evidenceDir, brief, groupsFile, note, label, startedAt, budgetLeft, nameMissing,
  nodeId = 'reconcile', payloadPath = path.join(runDir, 'evidence', 'reconcile', 'payload.json'), beforeFirstLaunch = null }) {
  const { batches: batchList, splitFiles } = reconcileBatches(groups);
  const n = batchList.length;
  runDirOf(evidenceDir);
  const evidencePayload = payloadPath;
  const done = [];
  // ONE CEILING FOR THE BARRIER, not one per batch (G-15 of 20261007-031302-consumer-use-review): each batch is given
  // a share of the budget still unspent and the time still left in proportion to its groups (batchShare), and charged
  // by batchCharge.
  let spent = 0;
  let exhausted = null;
  for (let i = 0; i < n; i++) {
    const minutesLeft = BARRIER_TIMEOUT - (Date.now() - startedAt) / 60000;
    const left = budgetLeft - spent;   // Infinity when uncapped, and stays so
    if (minutesLeft <= 0 || left <= 0) {
      exhausted = `the barrier's ${minutesLeft <= 0 ? `${BARRIER_TIMEOUT}-minute time` : `$${BUDGET_BARRIER} budget`} `
        + `was used up before ${label(i, n)} could start`;
      break;
    }
    // A SHARE IN PROPORTION TO THE GROUPS LEFT, WITH A FLOOR (lib's batchFraction): one share per batch starved an
    // 80-group batch beside a 2-group one (story-pipeline run 20261008-003626-round2-review), and no floor starved a
    // 2-group batch ahead of a 79-group one (G-7 of 20261008-021115-batch-share-review).
    const fraction = batchFraction({
      groupsInBatch: batchList[i].length,
      groupsLeft: batchList.slice(i).reduce((a, b) => a + b.length, 0),
      batchesLeft: n - i,
      minutesLeft,
      floorMinutes: RECONCILE_BATCH_FLOOR_MINUTES,   // passed, not defaulted: lib reads nothing past its arguments (A-2)
    });
    const grant = batchShare(left, fraction);
    const rel = groupsFile(i);
    writeTrackedJson(path.join(runDir, rel), { run_id: runJson.run_id, batch: i + 1, of: n, groups: batchList[i] });
    brief(rel, note(i, n, batchList[i]), nodeId);
    console.log(`   ${label(i, n)}: ${batchList[i].length} group(s)`);
    if (i === 0 && beforeFirstLaunch) beforeFirstLaunch();
    runOwner.remove(belowRun(evidencePayload));   // a batch that writes no payload must not inherit the last one's
    const bst = await spawnNode({
      nodeId, skill: '/reconcile', mode: 'reconcile',
      schemaVariant: 'reconcile', addDirs: [repoRoot], inlineSkill: true,
      // A SHARE OF THE TIME TOO (G-15 of 20261007-073125-reconcile-batches-review): the whole remainder let a hung early
      // batch use the barrier's time and starve the rest. Same fraction as the budget.
      timeoutMinutes: batchShare(minutesLeft, fraction), budgetUsd: grant,
    });
    const charge = batchCharge({ cost: bst.total_cost_usd, launched: bst.launched, grant });
    spent += charge ?? 0;   // null only when uncapped, where nothing is being bounded
    const payload = runHas(evidencePayload) ? JSON.parse(runRead(evidencePayload)) : null;
    // EACH REPLY CHECKED AGAINST ITS OWN BATCH (design §2; G-3 of 20261007-050929-consumer-use-r4). Foreign and repeated
    // rows are dropped before the merge; every gap is named with its batch, and recorded on the batch's own status.
    // A batch with NO payload is validated as an empty reply (G-8 of 20261008-021115-batch-share-review), so its groups
    // are named under that batch and on its status, not only in the render's aggregate count. A re-ask's missing groups
    // are not named here (nameMissing false): the first pass or the render's coverage check names each once.
    const validation = validateBatchReply(batchList[i], payload ?? { groups: [] });
    {
      const lbl = label(i, n);
      const name = (ids, what) => {
        if (!ids.length) return;
        // THE CALLER'S NODE, not `reconcile` (G-4 of 20261024-064941-rrr-delivery): the re-ask's gaps are its own.
        const entry = { node_id: nodeId, why: `${lbl} ${what}: ${ids.join(', ')}` };
        buckets.not_checked.push(entry);
        if (what === 'left these unjudged') batchUnjudged.set(entry, { label: `${lbl} ${what}`, ids });
        reconcileAlreadyNamed.push(...ids);
      };
      if (nameMissing) name(validation.missing, 'left these unjudged');
      name(validation.repeated, 'repeated');
      name(validation.foreign, 'judged groups it was not given');
      // LINKS CHECKED AGAINST THIS REPLY'S OWN ROWS (design §3): after the merge a link to another batch's group would
      // look valid, though this reply never saw that group.
      const links = checkRootLinks(validation.rows);
      validation.rows = links.rows;
      for (const c of links.cleared) {
        buckets.not_checked.push({
          node_id: nodeId,
          why: `root-cause link cleared: ${c.from} -> ${c.to} (${lbl} did not judge ${c.to})`,
        });
      }
    }
    writeJson(path.join(evidenceDir, `batch-${i + 1}-status.json`), {
      ...readStatus(nodeId),
      validation: { foreign: validation.foreign, repeated: validation.repeated, missing: validation.missing },
    });
    if (payload) runOwner.replace(belowRun(path.join(evidenceDir, `batch-${i + 1}-payload.json`)), runOwner.read(belowRun(evidencePayload), null));
    // ITS REPORT TOO, when it wrote one (G-5 of 20261024-064941-rrr-delivery): the next spawn of the node rewrites it.
    const { refused: reportRefused, ...report } = keepBatchReport({ runDir, status: readStatus(nodeId), to: path.join(evidenceDir, `batch-${i + 1}-report.md`) });
    if (reportRefused) buckets.not_checked.push({ node_id: nodeId, why: `batch ${i + 1} report not kept: ${reportRefused}` });
    done.push({ status: bst, payload: payload && { ...payload, groups: validation.rows }, grant, charge, report });
    if (bst.state !== 'OK' || !payload) break;   // a failed batch fails the barrier, as one failed reconcile does
  }
  return { done, exhausted, batches: batchList, splitFiles };
}

// THE CONTROL FLOW OF A BATCHED RECONCILE, in one function (reconcile-batches.plan.md stage 1; operator, 2026-10-07:
// "In run-graph.mjs"). Every RULE it applies is lib/reconcile-batches.mjs's: the partition, the grant and charge, the
// validation of each reply against its batch, and the merge. This function spawns, copies, names and writes — nothing
// it decides could live in the pure layer.
async function runBatchedReconcile(batchList, splitFiles, writeReconcileBrief) {
  const n = batchList.length;
  console.log(`\n== barrier: reconcile (${groupsOut.length} group(s) in ${n} batches of at most ${RECONCILE_MAX_GROUPS}) ==`);
  if (args.reconcileTwice) {
    buckets.not_checked.push({
      node_id: 'reconcile-b',
      why: `--reconcile-twice was not run: the barrier was batched (${n} batches), and a calibration of one `
        + 'batch against a different split would measure the split, not the judgment',
    });
  }
  if (splitFiles.length) {
    buckets.not_checked.push({
      node_id: 'reconcile',
      why: `${splitFiles.length} file(s) had more than ${RECONCILE_MAX_GROUPS} groups and were split across batches, `
        + `so a symptom in one batch could not name its root cause in another: ${splitFiles.join(', ')}`,
    });
  }
  // Each batch's own artifacts are KEPT, because the next spawn of the same node overwrites them.
  const evidenceBatchDir = path.join(runDir, 'evidence', 'reconcile-batches');
  const evidencePayload = path.join(runDir, 'evidence', 'reconcile', 'payload.json');
  // The group set, not the batches: the loop partitions it (G-5); `batchList` is the same partition, made by the caller
  // only to decide whether to batch at all, and used here for the opening lines.
  const { done, exhausted, batches: ranBatches } = await reconcileBatchLoop(groupsOut, {
    evidenceDir: evidenceBatchDir, brief: writeReconcileBrief,
    groupsFile: (i) => batchGroupsFile(i + 1),
    // The batch note is a prompt, so it lives in prompts/_templates/ (ARCHITECTURE.md §2; ledger run-graph.mjs:3160).
    note: (i, n) => renderTemplate(readTemplate('reconcile-batch-note.md'), {
      batch: String(i + 1), of: String(n), total: String(groupsOut.length), max: String(RECONCILE_MAX_GROUPS),
    }).trim(),
    label: (i, n) => `batch ${i + 1} of ${n}`,
    startedAt: Date.now(), budgetLeft: BUDGET_BARRIER, nameMissing: true,
  });
  // MERGED into the files every reader uses. Only batches that reported OK contribute rows, already validated.
  const okDone = done.filter((d) => d.status.state === 'OK' && d.payload);
  writeJson(evidencePayload, mergeReconcilePayloads(okDone.map((d) => d.payload), {
    runId: runJson.run_id, batches: okDone.map((_, i) => ranBatches[i]),
  }));
  const last = readStatus('reconcile');
  writeTrackedJson(path.join(nodesDir, 'reconcile.status.json'), {
    ...last,
    // LAUNCHED IF ANY BATCH WAS (G-6 of 20261007-044125-consumer-use-r3).
    launched: launchedBatches(done) > 0,
    state: batchLoopState({ done, exhausted }),   // the re-ask's state comes from the same rule (G-3)
    ...(exhausted ? { validator_errors: [...(last.validator_errors ?? []), exhausted] } : {}),
    // THE BARRIER'S CEILING, not the last batch's share (G-9 of 20261008-021115-batch-share-review); each batch's own
    // share stays on its batch-N-status.json.
    timeout_minutes: BARRIER_TIMEOUT,
    // THE SUM OF THE CHARGES (G-13 of consumer-use-r2, G-10 of consumer-use-r3): an upper bound when a cost is unknown;
    // null only when a charge is unbounded (uncapped barrier); the known part is kept beside it.
    total_cost_usd: done.every((d) => typeof d.charge === 'number') ? done.reduce((a, d) => a + d.charge, 0) : null,
    // ONLY USABLE COSTS are measured (G-11 of the same review): `sum` added any number, a negative one included. lib's
    // knownCost, the one owner (G-7 of 20261024-072605-rrr-remediation-review).
    total_cost_usd_known: knownCost(done),
    // lib's knownDuration, the one owner, the re-ask's aggregate's too (G-5 of 20261024-080423-rrr-remediation-2-review).
    duration_ms: knownDuration(done),
    batches: done.map((d, i) => ({
      batch: i + 1, groups: ranBatches[i].length, state: d.status.state,
      payload: Boolean(d.payload), total_cost_usd: d.status.total_cost_usd ?? null, duration_ms: d.status.duration_ms ?? null,
      grant_usd: Number.isFinite(d.grant) ? d.grant : null, charge_usd: d.charge,
    })),
    batches_planned: n,
  });
  return readStatus('reconcile');
}

// ROOT-CAUSE LINKS, CHECKED ON EVERY BARRIER (design §3): a link must name a group the same reply judged. Applied to the
// payload every reader uses, batched or not; each cleared link is named.
function checkReconcileLinks() {
  const evidencePayload = path.join(runDir, 'evidence', 'reconcile', 'payload.json');
  if (!runHas(evidencePayload)) return;
  const p = JSON.parse(runRead(evidencePayload));
  const { rows, cleared } = checkRootLinks(p.groups ?? []);
  if (!cleared.length) return;
  writeJson(evidencePayload, { ...p, groups: rows });
  for (const c of cleared) {
    buckets.not_checked.push({
      node_id: 'reconcile',
      why: `root-cause link cleared: ${c.from} -> ${c.to} (not a group the same reply judged)`,
    });
  }
}

// A GROUP THE REPLY LEFT OUT IS ASKED AGAIN, ONCE (reconcile-missing-groups.plan.md stage 1; operator, 2026-10-23: "C").
// The reconcile node read every group and returned no row for some, in four archived runs; the gate named the gap and
// nothing asked again, so the run could not be folded. The groups an OK reply missed go back to the same node, alone,
// as one more batch: its brief names their own groups file, its reply is checked against them (validateBatchReply) and
// its root-cause links against that reply (checkRootLinks, the same-reply rule), and its rows join the payload
// (mergeReask). It gets the barrier's remaining time and budget. A group it also misses is named as before. The first
// reply's status stays the barrier's state; the re-ask is recorded on it and in the gate.
async function reaskMissing(st, writeReconcileBrief, barrierStartedAt) {
  const evidencePayload = path.join(runDir, 'evidence', 'reconcile', 'payload.json');
  if (st.state !== 'OK' || !runHas(evidencePayload)) return st;
  // ONCE PER RUN (reconcile-reask-shape.plan.md stage 2; RA-D2 A): a run whose status records an attempt is not re-asked
  // by a later --resume, which reports the recorded one through the gate (G-6, and G-3/G-8, of
  // 20261024-000248-rmg-remediation-2-review). A fresh reconcile writes a status with no attempt, so it may re-ask once.
  if (reaskAttempts(readStatus('reconcile')).length) return st;
  const first = JSON.parse(runRead(evidencePayload));
  const { missing } = coverageGaps(groupsOut.map((g) => g.group_id), first.groups ?? []);
  if (!missing.length) return st;
  const asked = groupsOut.filter((g) => missing.includes(g.group_id));
  const firstStatus = readStatus('reconcile');
  // GRANTED AND CHARGED AS A BATCH IS (I-1; G-7 and G-8 of 20261023-224259-rmg-delivery): the re-ask is one more batch,
  // the last, so batchFraction gives it what is left, and the first call is charged by batchCharge, which charges an
  // unknown cost its whole grant rather than nothing.
  // An unknown on either side leaves the total unknown: dropping it reported a known partial total (G-8 of
  // 20261023-231847-rmg-remediation-review).
  const add = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a + b : null);
  const firstCharge = batchCharge({ cost: firstStatus.total_cost_usd, launched: firstStatus.launched, grant: BUDGET_BARRIER });
  let budgetLeft = BUDGET_BARRIER - (firstCharge ?? 0);   // Infinity when uncapped
  // THROUGH THE BARRIER'S BATCH LOOP (reconcile-reask-shape.plan.md stage 1; RA-D1 A): the missing groups are partitioned
  // as the barrier's are, each file's groups together and at most RECONCILE_MAX_GROUPS to a batch, and run by
  // reconcileBatchLoop with the barrier's remaining time and budget. Its own chunk loop, by position, is gone (G-4, G-10).
  // The loop partitions the group set itself and returns the partition (G-5 of 20261024-024945-rrs-delivery).
  console.log(`\n== barrier: reconcile re-ask (${missing.length} group(s) the reply left out: ${missing.join(', ')}) ==`);
  const evidenceReaskDir = path.join(runDir, 'evidence', 'reconcile-reask');
  // ITS OWN NODE, `reconcile-reask` (RR-D1 A): its brief, status, report and payload are its own, so no batch writes the
  // first reply's and there is nothing to back up or restore (the bookkeeping G-10, G-12, G-8 and G-9 were about). After
  // the loop the first reply's status gains the `reask` record, and its payload is replaced by the merged one when the
  // re-ask judged a group (G-4 of 20261024-080423-rrr-remediation-2-review: this said they were never written).
  const reaskPayload = path.join(evidenceReaskDir, 'payload.json');
  const loop = await reconcileBatchLoop(asked, {
      evidenceDir: evidenceReaskDir, brief: writeReconcileBrief,
      groupsFile: (i) => reaskGroupsFile(i + 1),
      note: (i, n, batch) => renderTemplate(readTemplate('reconcile-reask-note.md'), {
        judged: String(groupsOut.length - missing.length), count: String(batch.length),
      }).trim(),
      label: (i, n) => `re-ask batch ${i + 1} of ${n}`,
      startedAt: barrierStartedAt, budgetLeft, nameMissing: false,
      nodeId: 'reconcile-reask', payloadPath: reaskPayload,
    });
  const { batches: reaskBatches, splitFiles } = loop;
  if (splitFiles.length) {
    buckets.not_checked.push({ node_id: 'reconcile-reask', why: `the re-ask split ${splitFiles.length} file(s) with more than `
      + `${RECONCILE_MAX_GROUPS} missing groups across batches, so a symptom in one could not name its root in another: ${splitFiles.join(', ')}` });
  }
  const why = loop.exhausted;
  const outcome = reaskOutcome({ planned: reaskBatches.length, done: loop.done, exhausted: why });
  // What launched is reaskOutcome's count, not every entry the loop recorded: a refused spawn is one (G-8 of
  // 20261024-041845-rrs-remediation-2-review), and it read as re-asked here while the outcome said otherwise.
  const launched = outcome.batches;
  let merged = first;
  for (const [i, d] of loop.done.entries()) {
    if (d.status.state === 'OK' && d.payload) merged = mergeReask(merged, d.payload, { asked: reaskBatches[i] });
  }
  const judged = loop.done.flatMap((d) => (d.status.state === 'OK' && d.payload ? d.payload.groups.map((r) => r.group_id) : []));
  // ONE WRITE OF THE MERGED PAYLOAD, and only when the re-ask judged a group: otherwise evidence/reconcile/payload.json is
  // as the first reply wrote it, which the re-ask never removed (G-8 of 20261024-052401-rrs-remediation-3b-review).
  if (judged.length) writeJson(evidencePayload, merged);
  const stillMissing = missing.filter((id) => !judged.includes(id));
  const { state } = outcome;
  const sumOf = (vals) => (vals.every((v) => typeof v === 'number') ? vals.reduce((x, y) => x + y, 0) : null);
  // THE MEASURED DURATIONS, SUMMED as the barrier's batched status sums them (lib's knownDuration): sumOf was null as soon
  // as one batch had none, a refused spawn, and the batches that ran lost theirs (G-5 of rrr-remediation-2-review).
  const reaskMs = knownDuration(loop.done);
  // THE RE-ASK NODE'S STATUS, AGGREGATED (stage 1): its batches share one node id, and each spawn rewrites
  // nodes/reconcile-reask.status.json, so without this the run's spend (spentSoFar, which sums every node's status) would
  // count only its last batch. As the barrier's batched status is: the sum of the charges, an upper bound when a cost is
  // unknown and null when uncapped, with the measured part beside it; each batch's own status stays in its evidence.
  if (loop.done.length) {
    const last = readStatus('reconcile-reask');
    writeTrackedJson(path.join(nodesDir, 'reconcile-reask.status.json'), {
      ...last,
      launched: launched > 0,
      state,
      ...(why ? { validator_errors: [...(last.validator_errors ?? []), why] } : {}),
      // THE REPORT OF THE LAST BATCH WHOSE REPLY WAS USED, not of the last spawned (G-7 of 20261024-064941-rrr-delivery):
      // a failed batch ends the loop, and its reply is never merged. lib's, its one owner (G-11 of rrr-remediation-review).
      ...lastUsedReport(loop.done),
      total_cost_usd: sumOf(loop.done.map((d) => d.charge)),
      // reaskOutcome's, its one owner (G-7 of 20261024-072605-rrr-remediation-review: the reduce was spelled here again).
      total_cost_usd_known: outcome.total_cost_usd_known,
      duration_ms: reaskMs,
      batches: loop.done.map((d, i) => ({ batch: i + 1, groups: reaskBatches[i].length, state: d.status.state,
        payload: Boolean(d.payload), total_cost_usd: d.status.total_cost_usd ?? null, duration_ms: d.status.duration_ms ?? null,
        grant_usd: Number.isFinite(d.grant) ? d.grant : null, charge_usd: d.charge })),
      batches_planned: reaskBatches.length,
    });
  }
  if (!launched) {
    // The status records the re-ask that did not run, as it records one that did (I-3), as the run's one attempt. It names
    // the node and carries the fields every attempt carries, from the node's aggregated status when a spawn was refused,
    // with that status's validator errors (G-8 of 20261024-064941-rrr-delivery); none when nothing reached the spawn.
    const node = loop.done.length ? readStatus('reconcile-reask') : null;
    const attempt = notLaunchedAttempt({ missing, planned: reaskBatches.length, why, node });
    reaskThisInvocation = { groups: missing, judged: [], missing, state: attempt.state, why };
    writeTrackedJson(path.join(nodesDir, 'reconcile.status.json'), {
      ...firstStatus,
      reask: [attempt],
    });
    return readStatus('reconcile');
  }
  // A group a batch already named as unjudged, and the re-ask then judged, is no longer a gap.
  if (judged.length) {
    reconcileAlreadyNamed = reconcileAlreadyNamed.filter((id) => !judged.includes(id));
    buckets.not_checked = buckets.not_checked.flatMap((b) => {
      const named = batchUnjudged.get(b);
      if (!named) return [b];
      const left = named.ids.filter((id) => !judged.includes(id));
      return left.length ? [{ ...b, why: `${named.label}: ${left.join(', ')}` }] : [];
    });
  }
  // A batch left unlaunched by time or budget keeps its groups missing, and says why.
  const whyField = why ? { why } : {};
  // THE FIRST REPLY'S STATUS STAYS ITS OWN but for the attempt record (stage 1, with RR-D2 A): its cost, duration and
  // report hash are no longer summed with the re-ask's, which spentSoFar now counts from the re-ask node's own status.
  writeTrackedJson(path.join(nodesDir, 'reconcile.status.json'), {
    ...firstStatus,
    // THE ATTEMPT POINTS AT THE RE-ASK NODE'S OWN STATUS (reconcile-reask-record.plan.md stage 2; RR-D2 A): its node id,
    // and its aggregated totals as that status holds them, so the gate's record and the node's status cannot disagree.
    reask: [(() => {
      const node = readStatus('reconcile-reask');
      return { node: 'reconcile-reask', groups: missing, batches: outcome.batches, batches_planned: outcome.batches_planned,
        state, ...whyField, judged, missing: stillMissing, total_cost_usd: node.total_cost_usd ?? null,
        total_cost_usd_known: node.total_cost_usd_known ?? null, duration_ms: node.duration_ms ?? null,
        // ITS REPORT HASH (I-8; G-9 of 20261024-064941-rrr-delivery), as that status holds it: null for a reconcile node,
        // which writes no report.
        report_sha256: node.report_sha256 ?? null };
    })()],
  });
  reaskThisInvocation = { groups: missing, judged, missing: stillMissing, state, ...whyField };
  return readStatus('reconcile');
}

// ---------------------------------------------------------------------------- phase 3: barrier
// Mechanical work is script, not model (§ model routing). Grouping findings by location is
// mechanical, so the reconciler is handed groups and asked only for judgment: is this
// corroboration or coincidence, what is the true severity, which is the root cause.
function collectFindings() {
  const all = [];
  for (const e of expected) {
    const st = statusPresent(e.node_id) ? readStatus(e.node_id) : null;
    if (!st || st.state !== 'OK') continue;
    // Read the VALIDATED set, never raw stdout. spawn-node computes a kept/rejected split and
    // writes the kept findings here; taking payload.findings straight from stdout.json silently
    // re-admitted everything the validator threw out — impermissible bases, over-severities,
    // fabricated evidence paths — into grouping, corroboration, and ultimately remediate.
    // THROUGH THE ONE READER (ledger-trust-boundaries 2a): a verdict of the wrong shape was caught here only when
    // it threw, and was then mislabelled "will not parse"; a `findings` string was iterated character by
    // character into finding-groups.json. The reader refuses each by name; the barrier's policy stays its own.
    const kept = readKeptVerdict(runDir, e.node_id);
    if (!kept.ok && kept.missing) {
      // OK state but no validated set means the node predates this artifact or its render was
      // interrupted. Refuse to fall back to raw stdout — that is the exact hole being closed.
      buckets.did_not_report.push({
        node_id: e.node_id,
        why: 'OK but no verdict.kept.json — validated findings unavailable; raw stdout is not trusted',
      });
      continue;
    }
    if (kept.ok) {
      // PROVENANCE FROM THE STATUS FILE when the finding does not carry it: an external arm's findings
      // arrive without `model`, so all 83 in story-pipeline run 20261005-235247-product-sweep read
      // model: null while each arm's status recorded its model, and the reconciler had to cross-read
      // nodes/*.status.json to tell the families apart. A value the finding carries is never replaced.
      for (const f of kept.verdict.findings) {
        all.push({
          ...f, node_id: e.node_id,
          source: f.source ?? st.source ?? e.reviewer ?? null,
          model: f.model ?? st.model ?? null,
        });
      }
    } else {
      const err = { message: kept.why };
      // REPORTED, NOT SWALLOWED (G-20, panel-codex-security). This read
      // `catch { /* already DEGRADED */ }` — and the loop above had just excluded every node that
      // is not OK, so the state that comment described cannot occur here. A corrupt
      // verdict.kept.json therefore dropped all of that node's findings while the node still
      // reported OK, and a run with real findings read clean at the gate. Silence presented as a
      // verdict is the one outcome this system exists to refuse.
      //
      // The same path a MISSING verdict.kept.json already takes, because it is the same claim: the
      // validated set is unavailable, and raw stdout is not trusted as a substitute.
      buckets.did_not_report.push({
        node_id: e.node_id,
        why: `OK but verdict.kept.json was refused (${String(err.message).split('\n')[0]}) — its `
          + 'validated findings are unavailable and raw stdout is not trusted, so this node '
          + 'contributed nothing and the gate must say so rather than count it as clean',
      });
    }
  }
  return all;
}

// Sorted before grouping so the result is a function of the findings, not of the order they were
// read in. The anchor is whichever finding arrives first, so an unsorted pass could group the
// same inputs differently on a re-run — a reconciler judging one grouping could not reproduce it.
const findings = collectFindings().sort(
  (a, b) =>
    String(a.file).localeCompare(String(b.file)) ||
    (Number(a.line) || 0) - (Number(b.line) || 0) ||
    String(a.node_id).localeCompare(String(b.node_id)),
);

// THE GROUPING RULE IS lib/decisions.mjs's groupFindings (G-7 of 20261115-002137-pbr-remediation-2-review), a pure
// decision tested there: same file, within PROXIMITY_LINES of the group's anchor, a file's last group the only one in
// reach (G-7 of 20261114-235051-pbr-remediation-review; G-12 of 20261114-032609-m2-7b-remediation-review; G-39).
const groups = groupFindings(findings);
groupsOut = groups.map((g) => ({
  group_id: g.group_id, file: g.file, line: g.line,
  // PROXIMITY, not corroboration. These nodes landed within a few lines of each other in the same
  // file; whether they are describing the same defect is the judgment the reconciler is spawned
  // to make, and a mechanical `corroborated: true` pre-empted it — two unrelated findings six
  // lines apart could arrive pre-labelled as mutually confirming, which is precisely the false
  // signal the barrier exists to catch. The field is named for what the loop can actually know.
  proximate_nodes: [...g.nodes],
  distinct_node_count: g.nodes.size,
  grouped_by: `same file, within ${PROXIMITY_LINES} lines of the anchor — proximity only, not a corroboration claim`,
  // G-43: projectGroupFinding (lib/decisions.mjs) carries source AND model through — the mapper's
  // field-by-field rebuild dropped both, and finding-groups.json is the reconciler's ONLY input.
  findings: g.findings.map(projectGroupFinding),
}));
writeTrackedJson(path.join(runDir, 'finding-groups.json'), { run_id: runJson.run_id, groups: groupsOut });

// The Lens-did-not-report / Not-checked split — enumerated from STATUS FILES, never reports.
for (const e of expected) {
  if (!statusPresent(e.node_id)) {
    buckets.did_not_report.push({ node_id: e.node_id, why: 'no status file (orchestrator crash or never launched)' });
    continue;
  }
  const st = readStatus(e.node_id);
  // SOURCE CARRIED THROUGH (G-33, panel-codex-contract against I-2). This rebuilt each OK status
  // from three fields and dropped `st.source`, so gate.json and gate.md could only tell a Claude
  // lens from an external arm by the shape of its node id — a convention the roster can change. The
  // same field-by-field rebuild dropped source and model out of finding-groups.json once already
  // (G-43); this is that defect at the other end of the graph, where the gate is the file a reader
  // opens months later to ask which families actually reviewed this.
  if (st.state === 'OK') {
    buckets.ok.push({
      node_id: e.node_id, verdict: st.verdict, findings: st.findings_count,
      source: st.source ?? e.reviewer ?? null,
    });
  }
  else if (st.state === 'SKIPPED') {
    // `required` already accounts for unmet conditions and --only, so a node that is
    // STILL required here and yet skipped can only be one whose skill is absent. That
    // is a hole in the review, not a benign omission — it belongs in the hard bucket.
    if (e.required) {
      buckets.did_not_report.push({
        node_id: e.node_id,
        why: st.skip_reason ?? 'required lens not installed',
      });
    } else {
      buckets.not_checked.push({ node_id: e.node_id, why: st.skip_reason });
    }
  }
  else if (st.state === 'RUNNING') buckets.did_not_report.push({ node_id: e.node_id, why: 'no terminal status' });
  else buckets.did_not_report.push({ node_id: e.node_id, why: `${st.state}: ${st.validator_errors?.[0] ?? 'no detail'}` });
}
// Run-level gaps, not node-level ones. The not-checked table was assembled purely from SKIPPED
// nodes, so a gap that belongs to the run as a whole had nowhere to appear: an inferred-request run
// carried REQUEST-INFERRED in the stamp list and degraded contract-audit in expected.json, but the
// gate's own "what did nobody check" table never once said that no human confirmed the criteria —
// the single fact a reader most needs to weigh the conformance result.
// Contract-declared gaps. These are named in every brief and echoed in six node reports, and until
// now reached the GATE in none of them: a grep for 'typecheck' across a completed run returned zero
// hits in gate.json and gate.md while appearing in run.json, the briefs and the reports. The gate
// is the artifact a reader consults to learn what a run did not cover, so a gap the contract
// declares out loud belonged there first.
for (const k of EMPTY_KEY_CHECKS) {
  if (!commands[k]) {
    buckets.not_checked.push({
      node_id: `commands.${k}`,
      why: `empty in graph_contract — ${k} could not be run, and nothing in this run substitutes for it`,
    });
  }
}
// An uncapped budget tier is a run-level gap in exactly the same sense: the ceiling that would
// have bounded runaway spend was not enforced, by operator choice. Name it so the gate reader sees
// it beside the other not-checked entries rather than having to notice a missing guard.
for (const [k, cap] of [['per-node', BUDGET_NODE], ['per-barrier', BUDGET_BARRIER], ['per-run', BUDGET_RUN]]) {
  if (!Number.isFinite(cap)) {
    buckets.not_checked.push({
      node_id: `budget.${k}`,
      why: `uncapped by contract — no ${k} dollar ceiling was enforced on this run (UNCAPPED-BUDGET)`,
    });
  }
}

// A judgment lens with no second family reviewing beside it is ONE opinion, however confidently
// stated. The roster asserted in a note that every judgment lens had an arm while ui-audit had
// none, and nothing emitted a gap for an unshadowed lens — so a consuming project with a UI surface
// ran ui-audit single-family and the gate recorded it exactly as it records a shadowed one. That is
// absence reading as agreement, the failure the panel exists to prevent (G-19). Checked here rather
// than asserted in prose, so the claim cannot outrun the roster again.
// THE ARCHIVE'S EVIDENCE, IN THE RUN'S RECORD, WHATEVER THE PANEL SETTING (contract-glob-grammar stage 6, design §4).
// This sat inside the external-panel branch below, so with the panel off the gate never said where withheld evidence
// went (r5 G-14). And it decided from quorate's own reading of the .gitignore, which missed `!*/` (r5 G-5); it asks git.
if (!args.noArchive && runJson.archive_to) {
  const archiveRoot = path.resolve(runJson.archive_to);   // the reviews root the run is archived into
  const entry = archiveEvidenceEntry({
    archiveRoot, runDir, ignored: evidenceWillBeIgnored(archiveRoot, runJson.run_id, runOwner), missing: reviewsIgnoreGaps(archiveRoot),
  });
  if (entry) buckets.not_checked.push(entry);
}

// THE PANEL'S OWN GAPS, named where a reader looks. Both were invisible until the run that hit
// them: the transport probe artifact had one writer and zero readers, and six arms dying produced
// six status files and no line in the gate.
if (review.external_panel === true) {
  const armStates = (roster.panel_arms ?? [])
    .filter((a) => expected.some((e) => e.node_id === a.id && e.present))
    .map((a) => { try { return readStatus(a.id).state; } catch { return 'MISSING'; } });

  const silent = panelSilent({ enabled: true, armStates });
  if (silent) {
    buckets.not_checked.push({ node_id: 'external panel', why: silent });
    panelWasSilent = true;   // applied at the gate, beside the other ceilings
  }

  for (const id of unshadowedJudgmentLenses({
    lenses: LENSES,
    panelArms: roster.panel_arms ?? [],
    isPresent: (lensId) => expected.some((e) => e.node_id === lensId && e.present),
  })) {
    buckets.not_checked.push({
      node_id: `panel arm for ${id}`,
      why: `no second-family arm shadows ${id}, a judgment lens — its findings are one model family's opinion, not cross-family agreement`,
    });
  }
}
// NAMED EVEN WHEN ui.surface IS none (G-36). I-5 makes the rule uniform — "an empty contract key
// means the corresponding check is SKIPPED and named VERBATIM in not_checked[]" — and it lists
// ui.static_bundle among the keys it governs. Suppressing it here made one key's honesty conditional
// on another key's value, which is how a not_checked[] table stops being a complete list of what
// this run could not check.
if (!String(contract.ui?.static_bundle ?? '').trim()) {
  buckets.not_checked.push({
    node_id: 'ui.static_bundle',
    why: 'not declared — ui-audit reviewed source only; no built bundle or shipped webview was inspected',
  });
}

if (runJson.request?.status === 'inferred') {
  buckets.not_checked.push({
    node_id: 'human-approved request',
    why: `criteria were inferred from documentation by request-capture (${runJson.request.path}) ` +
      `and never confirmed by a person; conformance findings are capped (a §6 invariant finding is not) and the gate cannot PASS`,
  });
}
for (const s of (runJson.stamps ?? []).filter((x) => x.endsWith('-FAILED'))) {
  buckets.not_checked.push({
    node_id: s,
    why: 'the graph identified a missing precondition, attempted recovery, and could not fill it',
  });
}

// THE OTHER HALF OF WHAT THE STAMP PROMISES. decisions.mjs and I-20 both say TESTS-DID-NOT-RUN
// "caps and is named in not_checked[], like UNTESTED"; the cap is now real (CAPPING_STAMPS) and this
// is the naming. Without it a reader sees a RISK ceiling with nothing in the table explaining it,
// which is the failure mode not_checked[] exists to close: a gap that happened and was not declared.
if ((runJson.stamps ?? []).includes('TESTS-DID-NOT-RUN')) {
  buckets.not_checked.push({
    node_id: 'commands.test',
    why: 'the declared suite exited non-zero and reported zero tests, or could not start, so nothing was learned from it '
      + '— this is not a red suite and does not force the gate, and no lens substitutes for it',
  });
}
if ((runJson.stamps ?? []).includes('TESTS-OUTCOME-UNKNOWN')) {
  buckets.not_checked.push({
    node_id: 'commands.test',
    why: 'the declared suite exited non-zero and its output could not be parsed, or it was stopped before it finished, '
      + 'so whether any test ran is unknown — the run asserts nothing about the suite in either direction (G-32)',
  });
}
if ((runJson.stamps ?? []).includes('CONTRACT-STALE')) {
  buckets.not_checked.push({
    node_id: 'graph_contract semantics',
    why: 'this contract declares an older graph_contract version than the engine implements, so a '
      + 'key whose spelling is unchanged may have changed meaning — the one staleness no other check '
      + 'in this run can see, because the consumer\'s file is byte-identical either way',
  });
}
// A check that did not run is named, not left to the stamp alone (G-10 of 20261021-194056-ciss-d1-remediation-3-review).
if ((runJson.stamps ?? []).includes('COVERAGE-UNKNOWN')) {
  buckets.not_checked.push({
    node_id: 'contract coverage',
    why: 'whether every tracked file is declared by a contract glob was not checked: listing the tracked files failed at '
      + `mint (${runJson.contract_coverage_unknown ?? 'no reason recorded'}), so undeclared files may exist unreviewed`,
  });
}
// WHAT PHASE 0 DID, said at the gate. The entries are built by lib/preflight-cache.mjs rather than
// assembled here, because the same sentences have to be true of a skipped run and of a reused one
// and there is no second place that knows both. A skipped run names EVERY declared command; a
// reused one names the inference its freshness claim rests on, when there was one.
// And the results themselves (check-outcomes.plan.md stage 3), so a check that did not run to its own end is named.
// A checks.json that is present and unreadable is named, not read as no results (G-10 of 20261024-032927-rrs-remediation-review).
const preflightChecks = readChecksJson();
if (preflightChecks.error) {
  buckets.not_checked.push({ node_id: 'pre-flight', why: `${preflightChecks.error}, so no unfinished check it recorded can be named` });
}
const preflightResults = preflightChecks.results;
for (const e of preflightNotChecked({ ...preflightOutcome, commands: contract.commands ?? {}, results: preflightResults })) {
  buckets.not_checked.push(e);
}
// THE NEWEST ENTRY ALONE EXCEEDED THE CACHE CAP (G-10). It was kept — evicting what this run just paid
// for would make the cache useless to it — so the cache is over its bound, and the gate says so.
if (runJson.checks_cache_over_cap) {
  buckets.not_checked.push({
    node_id: 'pre-flight',
    why: 'the pre-flight cache entry this run wrote is larger than review.preflight_cache_max_mb on its '
      + 'own; it was kept, and the cache is over its cap until a smaller entry replaces it',
  });
}
if ((runJson.stamps ?? []).includes('TESTS-TIMED-OUT')) {
  buckets.not_checked.push({
    node_id: 'commands.test',
    why: 'the declared suite was killed at capture.mjs\'s deadline before it finished, so no failure '
      + 'was read and nothing was confirmed to pass — size the timeout rather than reading this as '
      + 'a broken install (G-48)',
  });
}

// A report with no OK status is a model-written file the system must not trust.
for (const f of runList(nodesDir).filter((x) => x.endsWith('-report.md'))) {
  const id = f.replace(/-report\.md$/, '');
  const st = statusPresent(id) ? readStatus(id) : null;
  if (!st || st.state !== 'OK') buckets.orphan_reports.push(f);
}

// A RESUME THAT RE-RAN NOTHING MUST NOT RE-JUDGE THE SAME GROUPS.
//
// `expected.json` holds the lenses and the arms, and `alreadyOk` is built from it — so `--resume`
// could keep 15 nodes and then re-spawn reconcile, second-opinion and intent-capture, which are the
// three most expensive non-lens nodes in the graph. Measured on a consumer-mount resume: reconcile
// 21.1 minutes and second-opinion 12.5, both re-derived from a payload that was sitting in the run
// directory, to reach a phase that only needed the payload file. run-graph's own source records this
// defect being fixed for the panel ARMS — "a resume re-ran all six arms and re-billed them" — and the
// barrier kept it.
//
// The condition is narrow on purpose. Reuse is only sound when NOTHING re-ran: a resumed lens or arm
// changes the finding set, and a reconciliation of the old set would then be judgment about a
// different run. So this requires an OK status, both artifacts present, and an empty fan-out and
// panel — anything else re-reconciles, which is the expensive-but-correct direction.
const reconcileArtifacts = [
  path.join(runDir, 'reconciled.md'),
  path.join(runDir, 'evidence', 'reconcile', 'payload.json'),
];
// THE RULE IS lib/reconcile-batches.mjs's (reconcileReusable); run-graph only gathers its inputs.
const reconcileReusable = reconcileReusableRule({
  resume: args.resume,
  nothingReRun: toRun.length === 0 && panelArms.length === 0,
  statusState: statusPresent('reconcile') ? readStatus('reconcile').state : null,
  artifactsPresent: reconcileArtifacts.every((p) => runHas(p)),
});

// Above both branches: a reused reconcile can still re-ask the groups its reply left out (reconcile-missing-groups.plan.md
// stage 3), and the re-ask writes the brief through this.
// THE PROSE LIVES IN prompts/_templates/, NOT HERE (reported twice). The barrier's own
// instructions -- what judgment it owes, and that grouping was already done mechanically --
// sat in a template literal in the orchestrator, which is the one place a prompt author does
// not look. The JSON slots arrive pre-serialised: lib/template.mjs holds text, not decisions.
const writeReconcileBrief = (groupsFile, batchNote, nodeId = 'reconcile') => writeTracked(
  path.join(nodesDir, `${nodeId}-brief.md`),
  renderTemplate(readTemplate('reconcile-brief.md'), {
    run_id: runJson.run_id,
    repo_root: repoRoot,
    // Every brief names the doctrine; this one did not, and the reconciler found it only by reading a
    // sandbox copy (BRIEF-GAP, story-pipeline run 20261005-235247-product-sweep).
    doctrine_path: DOCTRINE_PATH,
    intent_sha256: runJson.intent_sha256 ?? '(none)',
    did_not_report: JSON.stringify(buckets.did_not_report),
    not_checked: JSON.stringify(buckets.not_checked),
    brief_feedback: BRIEF_FEEDBACK,
    groups_file: groupsFile,
    batch_note: batchNote,
  }),
);
if (groupsOut.length && skillInstalled('reconcile') && reconcileReusable) {
  console.log('\n== barrier: reconcile REUSED — this resume re-ran no lens and no arm, so the '
    + 'reconciliation on disk is judgment about exactly this finding set ==');
  // THE STATE THE SPAWN WOULD HAVE SET. `reconcileState` defaults to 'SKIPPED' and is assigned from
  // the status file after the spawn — so skipping the spawn without this leaves the gate believing
  // the barrier never reported, and `reconcileSilent` turns a sound reuse into BLOCKED. Read from
  // the status file rather than assigned 'OK': the reuse condition already required OK, and taking
  // the value from the artifact keeps one source for it.
  reconcileState = readStatus('reconcile').state;
  // A FINISHED RUN WHOSE REPLY LEFT GROUPS OUT (reconcile-missing-groups.plan.md stage 3): --resume asks for those groups
  // only, and re-runs no lens, arm or whole reconcile. The reuse rule above is unchanged; reaskMissing reads the coverage
  // itself, and leaves the reused state as it is.
  // The barrier's time left after the first reply, not a fresh clock (G-11 of 20261024-032927-rrs-remediation-review).
  const resumedStatus = readStatus('reconcile');
  await reaskMissing(resumedStatus, writeReconcileBrief, reaskResumeStart({ now: Date.now(), firstStatus: resumedStatus }));
  // RENDERED AGAIN ONLY WHEN THE RE-ASK JUDGED A GROUP (reconcile-reask-shape.plan.md stage 3; RA-D3 A, operator,
  // 2026-10-24: "3 A"): that is also when second-opinion is not reused, so the audit and reconciled.md always agree
  // (G-7 of 20261024-000248-rmg-remediation-2-review). A re-ask that judged nothing is recorded in the status and the gate.
  if (reaskThisInvocation?.judged?.length) renderReconciled();
} else if (groupsOut.length && skillInstalled('reconcile')) {
  // NOTHING FROM A PREVIOUS RECONCILE SURVIVES THIS ONE (G-13 of 20261007-031302-consumer-use-review). Reuse needs an
  // OK status plus reconciled.md and payload.json; a batched barrier writes an OK status after every batch and merges
  // only at the end, so a run killed between batches, over an earlier complete render, would be reused as if whole.
  // EVERY artifact either reconcile writes (lib's RECONCILE_ARTIFACTS, design §5): the two-path cleanup this replaced
  // left an earlier --reconcile-twice attempt's calibration files and divergence behind (G-8 of consumer-use-r4).
  for (const rel of RECONCILE_ARTIFACTS) {
    const parts = rel.replace(/\/$/, '').split('/');
    const leaf = parts.pop();
    const dir = path.join(runDir, ...parts);
    // A wildcard entry is matched by the one owner of glob semantics, lib/contract-glob.mjs.
    const names = !leaf.includes('*')
      ? [leaf]
      : runList(dir).filter((f) => matchesGlob(leaf, f));
    for (const name of names) runOwner.remove(belowRun(path.join(dir, name)), { recursive: true });
  }
  // BATCHED PAST RECONCILE_MAX_GROUPS (lib/reconcile-batches.mjs; operator, 2026-10-06: "Batch by file", "One
  // node, batches inside"). The output schema carries at most that many groups, and a whole-product sweep of
  // story-pipeline produced 156: the reconciler judged 80 and 76 went unjudged. Each batch keeps its files' groups
  // together and runs under the SAME reconcile node, one after another; their payloads merge into the one
  // evidence/reconcile/payload.json and status file every reader already uses, so nothing downstream changes.
  const { batches: reconcileBatchList, splitFiles } = reconcileBatches(groupsOut);
  reconcileBatched = reconcileBatchList.length > 1;
  let st;
  const barrierStartedAt = Date.now();   // the re-ask gets what is left of the barrier's time
  // THE PER-RUN BUDGET, CHECKED BEFORE THE BARRIER LAUNCHES (G-9 of 20261007-050929-consumer-use-r4; design §6 as
  // amended 2026-10-07). The fan-out has always asked lib/decisions.mjs's admitSpend before each launch; the barrier
  // never did. Reconcile reserves the barrier cap (its batches share that one ceiling); the --reconcile-twice
  // calibration reserves a second one on top. A refused reconcile is a silent barrier, which blocks the gate.
  const barrierRefused = admitSpend({ spent: spentSoFar(), reserve: BUDGET_BARRIER, budgetRun: BUDGET_RUN, what: 'the barrier' });
  const calibrationRefused = args.reconcileTwice && !reconcileBatched && !barrierRefused
    ? admitSpend({ spent: spentSoFar(), reserve: 2 * BUDGET_BARRIER, budgetRun: BUDGET_RUN, what: 'the calibration' })
    : null;
  calibrate = args.reconcileTwice && !reconcileBatched && !barrierRefused && !calibrationRefused;
  if (calibrationRefused) {
    buckets.not_checked.push({ node_id: 'reconcile-b', why: `--reconcile-twice was not run: ${calibrationRefused}` });
  }
  if (barrierRefused) {
    console.error(`run-graph: ${barrierRefused}; reconcile not launched`);
    writeStatusStub('reconcile', 'BLOCKED', { launched: false, validator_errors: [barrierRefused] });
    buckets.did_not_report.push({
      node_id: 'reconcile',
      why: `${barrierRefused} — ${groupsOut.length} group(s) left unadjudicated`,
    });
    st = readStatus('reconcile');
  } else if (!reconcileBatched) {
    console.log(`\n== barrier: reconcile (${groupsOut.length} group(s)) ==`);
    writeReconcileBrief('finding-groups.json', '');
    // reconcile-b is CALIBRATION over the SAME groups and the SAME brief in a fresh context. It has
    // no data dependency on reconcile's result — it is not a retry and never feeds the verdict — so
    // it runs CONCURRENTLY instead of after. That sequencing alone cost 12.5 minutes of barrier wall
    // clock on the last full run. The only thing given up is the rare case where the primary fails
    // and the calibration spend is wasted; the divergence code below already treats a missing or
    // unjudged payload as "unmeasured, which is not agreement".
    if (calibrate) {
      console.log('\n== barrier: reconcile-b (calibration, concurrent with reconcile) ==');
      runOwner.replace(['nodes', 'reconcile-b-brief.md'], runOwner.read(['nodes', 'reconcile-brief.md'], null));
    }
    [st] = await Promise.all([
      spawnNode({
        nodeId: 'reconcile', skill: '/reconcile', mode: 'reconcile',
        schemaVariant: 'reconcile', addDirs: [repoRoot], inlineSkill: true,
      }),
      calibrate
        ? spawnNode({
          nodeId: 'reconcile-b', skill: '/reconcile', mode: 'reconcile',
          schemaVariant: 'reconcile', addDirs: [repoRoot], inlineSkill: true,
        })
        : Promise.resolve(null),
    ]);
  } else {
    st = await runBatchedReconcile(reconcileBatchList, splitFiles, writeReconcileBrief);
  }
  reconcileState = st.state;
  checkReconcileLinks();   // design §3, on every barrier: batched or not
  // After the first reply's links are checked against that reply, so each reply is held to its own rows.
  // The re-ask leaves the barrier's state as the first reply's, so reconcileState is not taken from it again.
  st = await reaskMissing(st, writeReconcileBrief, barrierStartedAt);

  // ------------------------------------------------------------- reconcile-twice (calibration)
  // The fan-out is redundant; the fan-in is not: one context decides confirmed or dropped for
  // every group, and a dropped group is gone. Nothing measured how stable that judgment is.
  // --reconcile-twice runs a SECOND reconcile on the same groups and brief in a fresh context and
  // diffs the decisions (lib/reconcile-diff.mjs, pure). The disagreement rate is the calibration
  // figure the barrier never had; the groups the two runs decide differently — above all a
  // confirmed-vs-dropped split, where one adjudicator kept what the other erased — are the ones
  // deserving a closer look.
  //
  // Measurement only, by design: reconcile's output remains the run's output, reconcile-b's
  // state never reaches the gate, and a failed second run reports the divergence as unmeasured
  // rather than degrading the run that hosted the experiment. (Cost note: reconcile-b is charged
  // the BARRIER cap, like every reconcile-mode node — nodeSpend keys that budget on `mode`, not on
  // the node id. This comment described the old id-keyed behaviour, which is exactly the disagreement
  // G-15 fixed: launched under the barrier cap, accounted at the node cap, so a killed calibration
  // under-counted the run's spend. A stale comment about a budget is a false account of what was
  // enforced, which I-60 names outright (G-37).)
  // Both barrier nodes have now finished (launched together above). Only the DIVERGENCE is
  // computed here, and only when the primary succeeded — a calibration figure against a failed
  // adjudication would describe nothing.
  if (calibrate && st.state === 'OK') {
    const pa = path.join(runDir, 'evidence', 'reconcile', 'payload.json');
    const pb = path.join(runDir, 'evidence', 'reconcile-b', 'payload.json');
    let note;
    if (runHas(pa) && runHas(pb)) {
      const A = JSON.parse(runRead(pa));
      const B = JSON.parse(runRead(pb));
      if (payloadJudgedSomething(A) && payloadJudgedSomething(B)) {
        const d = diffAdjudications(A, B);
        writeTrackedJson(path.join(runDir, 'reconcile-divergence.json'), { schema_version: 1, ...d });
        const flips = d.diverged.filter((g) => g.kept_vs_erased);
        note = `disagreement rate ${d.disagreement_rate} over ${d.groups_judged_by_both} group(s)` +
          (flips.length ? `; KEPT-VS-ERASED: ${flips.map((g) => g.group_id).join(', ')}` : '');
      } else {
        note = 'one adjudication judged nothing — divergence unmeasured, which is not agreement';
      }
    } else {
      note = 'reconcile-b did not report — divergence unmeasured, which is not agreement';
    }
    console.log(`reconcile-twice: ${note}`);
  }

  renderReconciled();
}

// Render reconciled.md from the validated payload — the barrier node does not write it either. A function because the
// reused branch renders too, after its re-ask (G-13 of 20261023-224259-rmg-delivery): reconciled.md is remediate's work
// list, and a re-ask that merged into the payload alone left it out of date.
function renderReconciled() {
  const rp = path.join(runDir, 'evidence', 'reconcile', 'payload.json');
  if (runHas(rp)) {
    const p = JSON.parse(runRead(rp));
    // Intent integrity is rehashed HERE, by script, not trusted from the reconciler's boolean
    // (G-33): "did the criteria move mid-flight?" is the one check that voids a run, and §2 says
    // mechanical work is script — delegating it to the model whose criteria they are is exactly
    // the failure that rule names. The model's own p.intent_intact still appears in its summary;
    // the artifact-level truth is this hash comparison against what new-run froze.
    const intentIntact = intentIsIntact();
    if (!intentIntact) {
      runJson.stamps = [...new Set([...(runJson.stamps ?? []), 'INTENT-DRIFT'])];
      writeJson(runJsonPath, runJson);
    }
    const byId = Object.fromEntries(groupsOut.map((g) => [g.group_id, g]));
    // Derived from the ONE ladder (G-21), not restated: a private rank map is a second owner of the
    // same fact, and a rung it does not list sorts to the bottom silently. SEVERITY_RUNGS is
    // lowest-first, so worst-first is its reverse index.
    const judged = (p.groups ?? []).slice().sort((a, b) =>
      SEVERITY_RUNGS.indexOf(b.severity) - SEVERITY_RUNGS.indexOf(a.severity));

    // THE ADJUDICATION MUST COVER THE GROUPS IT WAS GIVEN, EXACTLY ONCE EACH (G-46,
    // panel-codex-code). The schema constrains each row's SHAPE and says nothing about the set: a
    // payload that omits half the groups, repeats one, or invents an id validated cleanly, and
    // reconciled.md — remediate's work list — was rendered from it while the barrier stayed OK. A
    // finding that reaches the reconciler and leaves no row in its output has been dropped by
    // silence, which is the one outcome this system exists to refuse.
    //
    // NAMED IN not_checked[], never fatal: the adjudication that DID happen is still worth keeping,
    // and killing the render would discard every judged group to punish the missing ones. The gate
    // reads not_checked and the operator sees the ids.
    {
      // THE RULE IS lib/reconcile-batches.mjs's (coverageGaps); ids a batch already named are skipped, so a gap is
      // named once (reconcile-batches.plan.md stage 1).
      const { missing, duplicated, unknown } = coverageGaps(groupsOut.map((g) => g.group_id), judged, reconcileAlreadyNamed);
      const sample = (ids) => ids.slice(0, 8).join(', ') + (ids.length > 8 ? `, +${ids.length - 8} more` : '');
      if (missing.length) {
        buckets.not_checked.push({
          node_id: 'reconcile',
          why: `${missing.length} of ${groupsOut.length} finding group(s) were never adjudicated: ${sample(missing)}`,
        });
      }
      if (duplicated.length) {
        buckets.not_checked.push({
          node_id: 'reconcile',
          why: `${duplicated.length} group(s) were adjudicated more than once, so which ruling stands is `
            + `undefined: ${sample(duplicated)}`,
        });
      }
      if (unknown.length) {
        buckets.not_checked.push({
          node_id: 'reconcile',
          why: `${unknown.length} adjudicated id(s) name no group this run produced: ${sample(unknown)}`,
        });
      }
    }
    const L = ['# Reconciled', ''];
    if (!intentIntact) {
      L.push('> **INTENT DRIFT — intent.md no longer hashes to the value recorded at run start.**',
             '> The criteria moved mid-flight, so this run measured nothing. The gate is BLOCKED.', '');
    }
    L.push(p.summary ?? '', '');
    for (const bucket of ['confirmed', 'symptom', 'coincidence', 'dropped']) {
      const rows = judged.filter((g) => g.decision === bucket);
      if (!rows.length) continue;
      L.push(`## ${bucket[0].toUpperCase()}${bucket.slice(1)} (${rows.length})`, '');
      for (const g of rows) {
        const src = byId[g.group_id];
        L.push(`### ${g.group_id} · ${g.severity} · \`${src?.file ?? '?'}:${src?.line ?? '?'}\``, '');
        // Reads `proximate_nodes` — the field the grouping loop actually writes. The old form
        // read `corroborating_nodes`/`corroborated`, which no longer exist, so every group
        // rendered "Raised by:" with an empty list. Note there is no corroboration marker here
        // on purpose: whether these nodes corroborate each other is the reconciler's decision,
        // and it is already carried in `g.decision` and `g.rationale` below.
        L.push(`Raised by: ${(src?.proximate_nodes ?? []).map((n) => `\`${n}\``).join(', ') || '(none recorded)'}`, '');
        if (g.root_cause_group) L.push(`Root cause: \`${g.root_cause_group}\``, '');
        L.push(g.rationale, '');
        // renderGroupFinding (lib/reconcile-diff.mjs) labels each finding with the FAMILY that
        // raised it. finding-groups.json carried source and this renderer dropped it, so the report
        // a human reads showed only node ids — and cross-family agreement, the whole point of the
        // panel, was invisible in the artifact that presents it (I-2's I/O contract).
        for (const f of src?.findings ?? []) L.push(renderGroupFinding(f));
        L.push('');
      }
    }
    if (buckets.did_not_report.length) {
      L.push('## Lens did not report', '');
      for (const b of buckets.did_not_report) L.push(`- **\`${b.node_id}\`** — ${b.why}`);
      L.push('');
    }
    writeTracked(path.join(runDir, 'reconciled.md'), L.join('\n'));
    // The stamp is already written above from the script-computed intentIntact (G-33); this
    // reasserts it idempotently in case the block above short-circuited.
    if (!intentIntact) {
      runJson.stamps = [...new Set([...(runJson.stamps ?? []), 'INTENT-DRIFT'])];
      writeJson(runJsonPath, runJson);
    }
  }
}

// ------------------------------------------------------ phase 3b: second opinion (post-barrier)
// Reads reconciled.md, not the diff. An uncontexted reviewer handed the same diff would BE
// code-audit, and its agreement would then be counted as independent corroboration by the very
// reconciler it was meant to check.
// BOTH conditions, matching new-run.mjs's stamping rule. File existence alone said "panel" in the
// console and on the label while `review.external_panel` was false and no external arm would run
// — a report that claimed decorrelation the run never had. The adapter being present and the
// operator having opted in are different facts, and only their conjunction means a panel.
const panelInstalled =
  review.external_panel === true && fs.existsSync(path.join(scriptsDir, 'external-review.mjs'));
if (!panelInstalled) {
  runJson.stamps = [...new Set([...(runJson.stamps ?? []), 'PANEL-ABSENT'])];
  writeJson(runJsonPath, runJson); // same reason as INTENT-DRIFT: a stamp only the gate saw
}

// REUSED ON THE SAME CONDITION THE RECONCILIATION IS. second-opinion audits reconciled.md; if this
// resume re-ran no lens and no arm and therefore reused that file unchanged, the audit of it still
// holds, and re-running costs 12.5 minutes of judgment-model time (measured) to re-read a file that
// did not move. The condition is `reconcileReusable` itself rather than a second copy of its clauses:
// two spellings of "nothing re-ran" would eventually disagree, and then the audit would be of a
// reconciliation it never read.
// A reused reconcile whose re-ask judged a group re-rendered reconciled.md, so the old audit did not read it (G-11 of
// 20261023-231847-rmg-remediation-review).
const secondOpinionReusable = reconcileReusable
  && !reaskThisInvocation?.judged?.length
  && statusPresent('second-opinion')
  && readStatus('second-opinion').state === 'OK';
if (secondOpinionReusable) {
  console.log('\n== second-opinion REUSED — it audited this exact reconciled.md, which was not re-derived ==');
} else if (!args.skipPanel && skillInstalled('second-opinion') && runHas(path.join(runDir, 'reconciled.md'))) {
  console.log(`\n== second-opinion (${panelInstalled ? 'panel' : 'single arm — PANEL-ABSENT'}) ==`);
  writeAuxBrief('second-opinion', 'aux-purpose-second-opinion.md', {
    panel_state: templateText(panelInstalled ? 'aux-panel-present.md' : 'aux-panel-absent.md'),
  });
  await spawnNode({
    nodeId: 'second-opinion', skill: '/second-opinion', mode: 'panel',
    schemaVariant: 'none', addDirs: [repoRoot], inlineSkill: true,
  });
} else if (skillInstalled('second-opinion')) {
  writeStatusStub('second-opinion', 'SKIPPED', {
    skip_reason: args.skipPanel ? 'disabled with --skip-panel' : 'no reconciled.md to audit',
  });
}

// ------------------------------------------------------------------- tie-break (orchestrator)
// The tie-break runs HERE, at depth 0, because the layer the design previously assigned it to
// cannot execute it: second-opinion is a graph node at GRAPH_NODE_DEPTH=1, and external-review's
// own recursion guard exits 3 on exactly that value — the adjudication the roster described as
// the design was structurally impossible, and its failure would have read as agy being
// unavailable rather than as a capability in the wrong layer (round-3 G-22). reconcile declares
// the disputes (a script cannot tell contradiction from coincidence); second-opinion audits the
// adjudication; the ORCHESTRATOR — the only layer allowed to spawn — carries the flagged groups
// to the tie-breaker and appends the rulings.
if (!args.skipPanel && review.external_panel === true) {
  try {
    const rp = path.join(runDir, 'evidence', 'reconcile', 'payload.json');
    // A REFUSED PAYLOAD IS A REQUIRED INPUT REFUSED (G-11 of 20261115-013659-pbr-1b-delivery; ARCHITECTURE.md §4, A-30): the
    // judges' prompts are built from it, and its refusal fell into the phase's generic catch, which only caps the gate at
    // RISK. No judge starts; each is named BLOCKED with the cause, and the run goes on to its gate.
    // EACH JUDGE A REFUSED INPUT FEEDS IS RECORDED BLOCKED (G-9, G-10 of 20261115-022835-pbr-1b-remediation-review): a
    // did_not_report row alone left no status file and no expected row, and a refused finding-groups.json fell into the
    // phase's generic catch. One helper, for both required inputs: a row, a BLOCKED status naming the path and reason.
    const blockJudges = (why, judges = (roster.adjudicators ?? []).filter((x) => x?.reviewer)) => {
      console.error(`adjudication: ${why}`);
      for (const j of judges) {
        const judgeNodeId = `adjudicate-${j.id ?? j.reviewer}`;
        buckets.did_not_report.push({ node_id: judgeNodeId, why });
        expected.push({ node_id: judgeNodeId, skill: null, kind: NODE_KIND.adjudication, required: false, present: false, degraded: false, skip_reason: why });
        writeStatusStub(judgeNodeId, 'BLOCKED', { kind: NODE_KIND.adjudication, source: j.reviewer, launched: false, validator_errors: [why] });
      }
      writeJson(path.join(nodesDir, 'expected.json'), {
        run_id: runJson.run_id, written_at: new Date().toISOString(),
        derivation: 'deterministic: lens-roster.json x graph_contract; no model involved. Adjudicator rows APPENDED BLOCKED: a required input of theirs was refused.',
        expected,
      });
    };
    let payloadText = null;
    if (runHas(rp)) {
      try { payloadText = promptRead(rp); } catch (e) {
        if (!refusedOrAbsent(e)) throw e;
        blockJudges(`BLOCKED: ${refusalWords(e)} stands at evidence/reconcile/payload.json; ${REQUIRED_NOT_STARTED}`);
      }
    } else blockJudges(`BLOCKED: evidence/reconcile/payload.json is absent; ${REQUIRED_NOT_STARTED}`); // G-36 of 20261117-013640-m2-9a-final (A-30)
    const flagged = payloadText !== null
      ? (JSON.parse(payloadText).groups ?? []).filter((g) => g.disputed === true)
      : [];
    // WHAT A DISPUTE IS, AND WHY NO SCRIPT DECIDES IT (G-28 — raised, implemented, and REVERTED by
    // the evidence of the run that implemented it).
    //
    // contract-audit read I-1 — adjudication is for a group where a lens and an external arm
    // contradict each other — and observed that selection was `g.disputed === true` and nothing else,
    // "although every finding carries `source`". Both halves of that turned out to be false about the
    // real data, and the gate built on it silenced every dispute in a live consumer run:
    //
    //   * the reconcile PAYLOAD carries no findings at all. A group there is
    //     {group_id, decision, severity, disputed, rationale} — so a findings-based check reads an
    //     empty array for every group and rejects all of them. All five disputes, not spawned.
    //   * `source` does not distinguish a lens from an arm: it is the MODEL FAMILY, "opus" for a lens
    //     and "codex" for an arm. A test for "a finding with no source" matches neither side.
    //   * and the dispute class worth the most is invisible to any findings-based check. G-42 held ONE
    //     finding, from an arm, and the contradiction the reconciler named was against ui-audit's
    //     CHECKED_CLEAN entry — an arm says broken, a lens says clean. A clean claim is not a finding,
    //     so a script counting findings sees one side and would refuse exactly the disagreements that
    //     most need a third family.
    //
    // Which is the doctrine already: "You are the one who decides a dispute exists, because a script
    // cannot tell a contradiction from a coincidence." The reconciler is that layer. What a script CAN
    // do is report the composition so a reader can tell an arm-versus-lens dispute from an arm-only
    // one — recorded per group below, never gating the spawn.
    //
    // The abuse the finding worried about is accepted with its bound stated: a mis-flagged group costs
    // one call per judge, and the group, its rationale and its composition are all in the artifacts.
    const disputed = flagged;
    // Declared arm ids, from config rather than the `panel-` naming convention — the node-id shape is
    // "a convention lens-roster.json can change", and this must not be one of the things that changes
    // with it. The composition itself is computed by lib/adjudication.mjs from data passed IN: the
    // first version read `groupsById` out of an enclosing scope, that name was declared in a nested
    // block, and the artifact write threw ReferenceError after all ten judges had ruled.
    const ARM_IDS = panelArmsFor().map((a) => a.id);
    // ONE owner for the vendor. `--reviewer` was read from config while `source`, the credential
    // scrub, the probe classification and the expected row all kept the literal 'agy' — so a seam
    // that is swappable in one place and hardcoded in five is not swappable, which is precisely
    // what shared/external-reviewers.md says it must be: "the vendor is a parameter, never a
    // literal. arm.reviewer reaches the adapter flag, the credential allow-list, the probe, the
    // source tag and the status record" (G-41, G-55).
    // DECLARED, never defaulted to a vendor name. `?? 'agy'` was the last vendor literal in this
    // file: with no tie_breaker in the roster it silently spawned a specific CLI, which is the
    // opposite of "the vendor is a parameter, never a literal". Nothing declared means no
    // adjudication — recorded, not improvised.
    // A JUDGE SET, NOT A TIE-BREAKER (.claude/requests/adjudication-merge-for-disputes.md). Every
    // judge votes as a first-order judge and the merge is arithmetic: a 1-1 split returns the group
    // UNDECIDED rather than being broken by whoever was asked last, because a tie between two
    // judges is itself the finding. `roster.adjudicators` replaced `roster.tie_breaker`, and the
    // reason it is a set is that one vote cannot say how often it is wrong.
    const JUDGES = (roster.adjudicators ?? []).filter((j) => j?.reviewer);
    if (disputed.length && !JUDGES.length) {
      buckets.not_checked.push({
        node_id: 'adjudication',
        why: `${disputed.length} disputed group(s) and no adjudicators declared in lens-roster.json — `
          + 'the contradictions stand unadjudicated',
      });
    }
    // NEITHER JUDGE IS NEUTRAL, and the run says so rather than implying a neutrality it does not
    // have. Only two adapters serve the reviewer role and every panel arm runs on codex, so on a
    // lens-versus-arm dispute the codex judge is a party to its own family's position. The merge
    // labels each vote; this is the run-level statement, because a reader of the gate should not
    // have to open a status file to learn the panel had a stake.
    if (disputed.length && JUDGES.length && JUDGES.length < 2) {
      buckets.not_checked.push({
        node_id: 'adjudication',
        why: `only ${JUDGES.length} adjudicator declared, so every ruling this run is single-judge — `
          + 'a vote with no second family cannot say how often it is wrong',
      });
    }
    if (disputed.length && JUDGES.length) {
      console.log(`
== adjudication: ${disputed.length} disputed group(s) x ${JUDGES.length} judge(s) `
        + `(${JUDGES.map((j) => j.reviewer).join(', ')}) ==`);
      // THE TIE-BREAK ROLE IS CHECKED, not assumed (G-47). `ROLE_REQUIREMENTS['tie-break']` was a
      // declared role no caller ever passed to roleGaps — its only two call sites asked about 'arm'
      // and 'intent' — so a tie-breaker whose adapter declares no structured_output was SPAWNED and
      // then reported as having returned no parseable envelope, which reads as a broken vendor
      // rather than a table entry that never met the requirement. The cost lands late and points
      // the wrong way, which is the same shape G-28 had.
      // PER JUDGE, because the set can be mixed. A judge whose adapter cannot serve the role is
      // dropped from the panel and NAMED — not silently, and not by refusing the whole adjudication:
      // one unusable vendor must not erase the votes the others can cast, and the surviving panel
      // being smaller is itself something the gate has to report.
      const eligible = [];
      // A REFUSED JUDGE IS STILL A SCHEDULED JUDGE. Dropping it from `eligible` removed it from the
      // coverage denominator too, so a two-judge panel with one unusable adapter reported coverage
      // 1/1 — identical to a panel that only ever had one judge, which is the distinction the whole
      // merge is built on. It is recorded here and folded into every dispute's votes as absent.
      const refused = [];
      for (const j of JUDGES) {
        // NO SAFE SURFACE, NO JUDGE (G-12 of 20260926-002850-m0-close). A judge is the second external
        // reviewer and stands in the arms' directory; with none safe it is refused like any other
        // judge that cannot serve — named, and still counted in the panel it was scheduled for.
        if (!armSurface.cwd) {
          const judgeId = j.id ?? j.reviewer;
          refused.push({ judge: judgeId, reviewer: j.reviewer, state: 'unavailable', reason: armSurface.why });
          buckets.not_checked.push({
            node_id: `adjudicate-${judgeId}`,
            why: `${armSurface.stamp}: ${armSurface.why} — it cast no vote on any disputed group`,
          });
          continue;
        }
        const gaps = roleGaps(REVIEWER_TABLE[j.reviewer], 'tie-break');
        if (gaps.length) {
          // THE DECLARED ID, here too. This row named the judge by its TRANSPORT, so two judges
          // declared on one adapter — the case the rest of this path was fixed for — produced two
          // not_checked entries with the same node_id, and a reader could not tell one refused judge
          // reported twice from two refused judges. It is not a per-group node id (no group is
          // involved: this judge voted on nothing at all), which is why it is spelled here rather
          // than taken from adjudicationBrief.
          const judgeId = j.id ?? j.reviewer;
          refused.push({
            judge: judgeId,
            reviewer: j.reviewer,
            state: 'unavailable',
            reason: `cannot serve as an adjudicator: no ${gaps.join(', ')} (shared/adapter-contract.md)`,
          });
          buckets.not_checked.push({
            node_id: `adjudicate-${judgeId}`,
            why: `'${j.reviewer}' cannot serve as an adjudicator: it provides no ${gaps.join(', ')} `
              + '(shared/adapter-contract.md) — it cast no vote on any disputed group',
          });
          // AND A STATUS FILE, LIKE THE ARM PATH (G-43, doc-consistency-review).
          // shared/adapter-contract.md promises that a failed role check "writes a SKIPPED status
          // naming the missing capability" — true of arms, and the adjudicator path pushed a
          // not_checked row and `continue`d, writing no status and no expected row. So a refused
          // judge existed nowhere in the gate's node table: the one artifact a reader opens to ask
          // which nodes the run promised and what became of them. A promise kept in one of the two
          // places it is documented for is the inert-guarantee shape this engine exists to catch.
          const refusedNodeId = `adjudicate-${judgeId}`;
          expected.push({
            node_id: refusedNodeId, skill: null, kind: NODE_KIND.adjudication,
            required: false, present: false, degraded: false,
            skip_reason: `'${j.reviewer}' provides no ${gaps.join(', ')}`,
          });
          writeStatusStub(refusedNodeId, 'SKIPPED', {
            kind: NODE_KIND.adjudication,
            source: j.reviewer,
            skip_reason: `cannot serve as an adjudicator: no ${gaps.join(', ')} (shared/adapter-contract.md)`,
          });
          console.error(`adjudication: '${j.reviewer}' lacks ${gaps.join(', ')} — not spawning it`);
          continue;
        }
        eligible.push(j);
      }
      if (disputed.length && !eligible.length) {
        buckets.not_checked.push({
          node_id: 'adjudication',
          why: `${disputed.length} disputed group(s) and no declared adjudicator can serve the role — `
            + 'the contradictions stand unadjudicated',
        });
      }
      // The disputes THEMSELVES are untouched: they are still disputed, still reported, and still
      // unadjudicated. Emptying `disputed` to skip the spawn would have erased the contradictions
      // from every downstream count — a refusal that hides what it refused to look at.
      // A REQUIRED INPUT, READ BEFORE ANY JUDGE IS PREPARED (G-10 of 20261115-022835-pbr-1b-remediation-review): its
      // refusal fell into the phase's generic catch, which only caps the gate at RISK. Now each eligible judge is BLOCKED.
      let groupsText = null;
      if (eligible.length) {
        try { groupsText = promptRead(['finding-groups.json']); } catch (e) {
          if (!refusedOrAbsent(e)) throw e;
          blockJudges(`BLOCKED: ${refusalWords(e)} stands at finding-groups.json; ${REQUIRED_NOT_STARTED}`, eligible);
          eligible.length = 0; // each BLOCKED above, none sent; `disputed` is never emptied, so every contradiction stands
        }
      }
      const toAdjudicate = eligible.length ? disputed : [];
      // Derived ONCE PER JUDGE, not per group and not once for the set: the judges are different
      // vendors, so their caps come from different rows of basis_ceilings, and computing them per
      // (group, judge) is how two rows come to disagree about the same vendor.
      const limitsFor = new Map(eligible.map((j) => [j.reviewer, armLimits({ reviewer: j.reviewer }, 'tie-break')]));

      const groupsById = Object.fromEntries(
        (groupsText === null ? [] : JSON.parse(groupsText).groups)
          .map((g) => [g.group_id, g]),
      );
      const rulings = ['', '## Tie-break (external, capped at RISK/MEDIUM like every arm)', ''];
      // TWO PHASES: PREPARE EVERY GROUP, THEN ADJUDICATE THEM CONCURRENTLY (G-35).
      //
      // This awaited each tie-break before starting the next, so wall time was the SUM of reviewer
      // latency across every disputed group — each one a live third-party call bounded only by
      // NODE_TIMEOUT. The panel arms beside it have run as a bounded pool since they were written;
      // the tie-breaks, which are the same kind of work against the same kind of endpoint, did not.
      //
      // Splitting prepare from spawn is what makes that safe, and it strengthens an invariant this
      // file already states: expected.json must be written BEFORE anything launches, because that
      // pre-commitment is what makes a node that never reports detectable rather than merely
      // absent. Serially, each row landed before its own spawn but after the previous ones had run.
      // Now every row is committed before any spawn, and the file is written once instead of once
      // per group.
      const prepared = [];
      for (const g of toAdjudicate) {
        // group_id comes from the reconcile payload (model output) and becomes a filesystem path
        // and a --node-id, so it is re-validated here on the same ground the request slug is
        // (G-34): the schema pins ^G-[0-9]{1,3}$ but the runtime is never a security boundary,
        // and --resume re-reads a payload the current CLI never validated.
        if (!isGroupId(g.group_id)) {
          console.error(`tie-break: skipping group with invalid id ${JSON.stringify(g.group_id)}`);
          continue;
        }
        const src = groupsById[g.group_id];
        // Built by the SHARED builder, not by hand (I-8/I-9). The hand-written version carried
        // neither the external-arm constraints nor the mandated brief-feedback ask, and it was the
        // one prompt whose reviewer then returned nothing.
        // UNDER evidence/, NOT nodes/ (G-34). This prompt embeds the disputed source EXCERPT
        // verbatim, and the two directories are not interchangeable: `nodes/` holds indexes and
        // statuses and is tracked, while `.claude/reviews/*/evidence/` is gitignored precisely
        // because it holds content. run-checks already made this exact move — it stripped
        // `stderr_tail` out of the tracked checks.json for the same reason, saying so in its own
        // comment. Writing repository content into a tracked artifact is a decision a consuming
        // project would be making without being asked.
        //
        // A pointer stays in nodes/, so the run's index still names the prompt and a reader can
        // find it; what moves is the file that carries source.
        const tbEvidenceDir = path.join(runDir, 'evidence', `adjudicate-${g.group_id}`);
        runDirOf(tbEvidenceDir);
        const promptPath = path.join(tbEvidenceDir, 'prompt.md');
        writeTracked(
          path.join(nodesDir, `adjudicate-${g.group_id}-prompt.md`),
          `The adjudication brief for ${g.group_id} carries the disputed source excerpt, so it is
`
          + `written where content belongs: evidence/adjudicate-${g.group_id}/prompt.md (gitignored,
`
          + `like every other evidence artifact). This file is the index entry, not the brief.
`
          + `ONE brief, rendered once and handed to every judge verbatim: a panel whose members read
`
          + `differently worded questions measures the wording, not the dispute.
`,
        );
        // The excerpt the doctrine promises the tie-breaker. Read HERE rather than in the prompt
        // builder, which is deliberately pure so prompt changes stay testable without I/O.
        // The contract decides what may be excerpted, not just where it lives (G-15): generated
        // trees hold captured output, and anything outside the declared surface is not under review.
        const excerpt = readExcerpt({
          repoRoot, file: src?.file, line: src?.line,
          generatedGlobs: contract.generated_globs ?? [],
          declaredGlobs: declaredSurface(contract),
        });
        // THE POSITIONS ARE THE VOTE VOCABULARY, from the one owner the merge also reads
        // (lib/adjudication.mjs). A brief offering labels the merge does not accept, or accepting
        // values the brief never offered, is the two-owner shape that has already cost this project
        // the intent canary's mismatched line windows — and upstream it is the difference between
        // kappa 0.12 and 0.66 on identical items.
        // DERIVED BY THE OWNER, not re-computed here and again in the probe. check-tiebreak had
        // its own copy of all of this and the copy had already drifted.
        const brief = adjudicationBrief({ group: { ...g, ...src }, excerpt });
        const { participants, mechanicalFacts } = brief;
        writeTracked(promptPath, buildTieBreakPrompt({
          groupId: g.group_id,
          file: src?.file,
          line: src?.line,
          rationale: g.rationale,
          findings: src?.findings ?? [],
          excerpt,
          judgeCount: eligible.length,
          voteVocabulary: renderVoteVocabulary(participants),
          mechanicalFacts,
        }));
        // BEFORE THE SPAWN (G-38). This file's own opening line says expected.json is written
        // BEFORE anything launches — that is what makes a node that never reports detectable rather
        // than merely absent — and the tie-break row was pushed AFTER its reviewer had already been
        // launched. An interruption inside that window left work that ran, spent tokens and appears
        // in no pre-commitment record: the one shape "silence is not a verdict" cannot catch,
        // because the run never promised the node existed.
        // AND RE-WRITE THE FILE. expected.json is written at mint and after recovery, both long
        // before any dispute exists, so pushing to the in-memory array "letting expected.json
        // account for it" accounted for nothing: the tie-break appeared in no artifact (G-45).
        // Appended rather than re-derived, so the pre-commitment record still precedes every spawn
        // and only gains the row for work that actually happened.
        // ONE SCHEDULED NODE PER JUDGE. The gate's "did not report" accounting is per node, so a
        // judge that never answers has to BE a node — otherwise a two-judge panel where one judge
        // vanished reads in the node table exactly like a one-judge panel that was never wider.
        // Silence is not a verdict, and it is not a smaller panel either.
        for (const judge of eligible) {
        // THE DECLARED ID NAMES THE NODE. Built from `judge.reviewer` it was a transport name, so
        // two judges on one adapter — two codex models, a reasonable thing to want — collided on the
        // node id, the evidence directory and the merge key, silently becoming one judge whose
        // result depended on which finished last. `adjudicators[].id` existed and nothing read it.
        const judgeId = judge.id ?? judge.reviewer;
        const nodeId = brief.nodeId(judgeId);
        const tbLimits = limitsFor.get(judge.reviewer);
        const { env: tbEnv, passed: tbPassed } = reviewerEnv(judge.reviewer, process.env, {
          depth: 0, prefixes: envPrefixesOf(REVIEWER_TABLE[judge.reviewer]), names: envNamesOf(REVIEWER_TABLE[judge.reviewer]),
        });
        // A JUDGE WITH A STAKE IN THE DISPUTE IT IS JUDGING. Every panel arm runs on codex, so a
        // codex judge voting on a group one of those arms raised is voting on its own family's
        // position. Computed here, recorded on the vote, and surfaced at the gate.
        // STAKE IS A FAMILY QUESTION. This compared a finding's `source` — an adapter name — with
        // `judge.reviewer`, and `reviewer` is a TRANSPORT: agy serves Gemini models and Claude ones,
        // so two judges reached through different adapters can be one family and a judge sharing a
        // family with a disputant through a different adapter was labelled neutral. `family`
        // defaults to the reviewer, so a one-family vendor behaves exactly as before.
        // THE ONE FAMILY RULE (runtime-call-telemetry.plan.md stage 1): a family is the model's, declared on its adapter.
        // A finding from an adapter (an arm) is that adapter's model's; one with no adapter source ran on the node runtime.
        const findingFamily = (f) => (f.source && REVIEWER_TABLE[f.source]
          ? familyOfCall({ reviewer: f.source, model: f.model }, REVIEWER_TABLE)
          : familyOfCall({ reviewer: NODE_RUNTIME, model: f.model }, REVIEWER_TABLE));
        const judgeFamily = familyOfCall({ reviewer: judge.reviewer, model: judge.model }, REVIEWER_TABLE);
        const party = Boolean(judgeFamily) && (src?.findings ?? []).some((f) => findingFamily(f) === judgeFamily);
        expected.push({
          node_id: nodeId, skill: null, kind: NODE_KIND.adjudication, required: false, present: true,
          // DERIVED, LIKE EVERY OTHER EXTERNAL ROW (G-47, arch-review + contract-audit on I-20).
          //
          // These three were inline literals — `['convention']`, `'MEDIUM'`, `'RISK'` — which is
          // the exact assigned-not-derived pattern lib/capabilities.mjs was written to remove,
          // surviving in one of the four roles adapter-contract.md declares. I-20 even names this
          // failure mode: "the derivation lives in one caller, so a second caller assigns ceilings
          // of its own". Two consequences, both silent: `basis_ceilings` in lens-roster.json — the
          // file declared to OWN those numbers — never reached the tie-breaker, and the
          // `cap_reason` added so an auditor can answer "why was this capped" from the artifact was
          // absent for this node alone.
          degraded: false,
          allowed_basis: tbLimits.allowed_basis,
          severity_ceiling: tbLimits.severity_ceiling,
          verdict_ceiling: tbLimits.verdict_ceiling,
          runtime: tbLimits.runtime,
          severity_floor: null, schema_variant: 'code',
          intent: 'forbidden', reviewer: judge.reviewer,
          // The pinned runtime, recorded like every other node's. It was null/null while the spawn
          // passed a --model, so the artifact denied the pin it had just used.
          model: judge.model ?? null, effort: judge.effort ?? null,
          skip_reason: null,
        });
        // `judgeId` TRAVELS WITH THE REST. It was computed here and read in the worker — a sibling
        // scope — so every adjudication threw `ReferenceError: judgeId is not defined` before it
        // could write its status. Identical to the `tbStartedAt` defect this same loop already had:
        // computed once per (group, judge) in the preparation loop, read where it is not bound.
        prepared.push({ g, src, judge, judgeId, participants, nodeId, promptPath, tbEnv, tbPassed, party });
        }
      }

      // The rows only exist in an ARTIFACT if the artifact is rewritten. `derivation` says so
      // plainly rather than letting a reader assume every row was pre-committed: the tie-break
      // rows could not be, because no dispute existed when the file was first written.
      //
      // ONE WRITE, AFTER EVERY ROW AND BEFORE EVERY SPAWN (G-35).
      writeJson(path.join(nodesDir, 'expected.json'), {
        run_id: runJson.run_id,
        written_at: new Date().toISOString(),
        derivation: 'deterministic: lens-roster.json x graph_contract; no model involved. Panel-arm rows included pre-fan-out. Tie-break rows APPENDED after reconcile declared the disputes — they cannot be pre-committed because no dispute exists at mint.',
        expected,
      });

      // Same width as every other pool in this file, from the contract. `aborted` stops it taking
      // new work on SIGINT, exactly as the panel pool does — a tie-break is a billed vendor call,
      // and an interrupt that keeps launching them is the shape that costs quota after the operator
      // has already asked it to stop.
      // VOTES COLLECTED PER GROUP, MERGED AFTER THE POOL DRAINS. The worker's job is now one
      // judge's vote and nothing else; deciding the group is arithmetic and happens once, over every
      // vote, where a partial tally cannot be mistaken for a result.
      const votesByGroup = new Map();
      // What the PANEL cost, separately from the run. `unmeasured` names the judges whose vendor
      // reported nothing, because a total that silently omits them reads as cheaper than it was.
      const adjudicationCost = { total: 0, unmeasured: [] };
      const ruled = new Map();
      await runPool(prepared, async ({ g, src, judge, judgeId, participants, nodeId, promptPath, tbEnv, tbPassed, party }) => {
        // WHEN THIS SPAWN STARTED — captured HERE, in the worker, for two reasons.
        //
        // Without a start there is no duration, and duration is the first thing that separates a
        // refusal from a slow answer: two tie-breaks whose `ended_at` differed by three milliseconds
        // read equally well as two concurrent calls finishing together and as two processes refused
        // in 0.1s by an argument-parse error. It was the second, and `ended_at` alone could not say.
        //
        // The first attempt put this in the PREPARATION loop, whose body is a sibling scope to this
        // worker — so it was not in scope here at all and every tie-break threw `ReferenceError:
        // tbStartedAt is not defined`, runPool rethrew, the enclosing catch printed "tie-break
        // failed" and no status file was written for any disputed group. Strictly worse than the
        // DEGRADED-with-null-ruling it replaced: a promised node leaving no artifact at all. Found
        // by code-audit on the sweep of that very change, because nothing in the offline suite
        // executes this path and my own regression asserted the source text rather than running it.
        //
        // Prep time would also be the wrong number: preparation happens before the pool runs.
        const tbStartedAt = new Date().toISOString();
        // ASYNC, LIVE-REGISTERED, AND BACKSTOPPED — like every other reviewer this file spawns.
        //
        // It was a blocking spawnSync with no maxBuffer, which is three defects in one line
        // (G-38, perf-audit): Node's 1 MiB default truncated any agy wrapper larger than that, so
        // JSON.parse threw and the ruling was recorded DEGRADED — a verdict lost to a buffer size
        // rather than to a reviewer; the child was in no `live` entry, so an interrupt could not
        // reach it; and spawnSync blocks the event loop, so the SIGINT handler could not run to
        // try. spawnCapture answers all three, and the comment at the top of the arm section that
        // said "the tie-break loop is still unbounded by the old mechanism" is no longer true.
        // A RUNNING STUB BEFORE THE SPAWN, which every lens gets and no judge did. expected.json
        // promises the node; if the orchestrator is hard-killed mid-adjudication the promise stood
        // with NO status file of any kind behind it — the one shape "silence is not a verdict"
        // cannot catch, because nothing records that the node ever started.
        writeTrackedJson(path.join(nodesDir, `${nodeId}.status.json`), {
          schema_version: 1, run_id: runJson.run_id, node_id: nodeId,
          state: 'RUNNING', kind: NODE_KIND.adjudication, source: judge.reviewer,
          group_id: g.group_id, party_to_dispute: party,
          model: judge.model ?? null, effort: judge.effort ?? null,
          auth_mode: authModeFor(NODE_KIND.adjudication), launched: true, started_at: tbStartedAt,
        });
        const r = await spawnCapture(
          'node',
          [path.join(scriptsDir, 'external-review.mjs'),
            '--run-dir', runDir, '--node-id', nodeId,
            // From CONFIG, never a literal — and PINNED, because agy also offers Claude Sonnet 4.6
            // and Claude Opus 4.6. An unpinned judge cannot promise it is a different family from
            // the lens it is voting about, which is the only reason a panel is worth anything
            // (roster.adjudicators).
            '--reviewer', judge.reviewer,
            ...(judge.model ? ['--model', judge.model] : []),
            ...(judge.effort ? ['--effort', judge.effort] : []),
            '--mode', 'tie-break',
            // The positions, so the vendor-facing schema carries the vote enum from the one owner.
            ...(participants.length ? ['--participants', participants.join(',')] : []),
            '--prompt-file', promptPath, '--timeout-minutes', String(NODE_TIMEOUT),
            '--surface', armSurface.cwd],
          // THE SAME SURFACE THE ARMS GET (G-32/G-43, panel-codex-arch). This was `cwd: repoRoot`,
          // so the adjudicator — a third-party cloud CLI — stood in a tree containing the run's own
          // evidence, which is the exact defect the arms' worktree was built to close, in the
          // sibling call site. capabilities.mjs declares panelReadSurface the owner of "what
          // directory a third-party reviewer is pointed at"; consulting it for one of the two
          // external spawns and not the other is how the two came apart.
          //
          // The tie-breaker needs no tree at all — readExcerpt embeds the disputed lines in the
          // prompt (G-36), which is what made it able to rule in the first place. It still needs a
          // cwd inside the operator's repository, because external-review derives its containment root
          // from there — and since arms-read-surface the arms' directory is a repository of its own, so
          // the judge is STARTED in the arms' directory (--surface) while external-review stays here.
          // A KILLABLE TREE, like every other child (design §5): without it the judge on posix shared this process's group,
          // so the group kill that stops an arm could not reach the vendor CLI it started.
          { cwd: repoRoot, env: { ...tbEnv, ...ENGINE_LOCATION }, ...hostPlatform().proc.killableSpawnOptions() },
          {
            timeoutMs: timerMs(NODE_TIMEOUT, 2),
            liveKey: nodeId,
            // The tie-breaker is a third-party reviewer too, billed by its own vendor (G-31).
            liveKind: { auth_mode: authModeFor(NODE_KIND.adjudication), kind: NODE_KIND.adjudication, source: judge.reviewer },
          },
        );
        // A tie-break is a spawned external reviewer, so it gets a status file like every other
        // node — recording the credential attribution (G-36 companion: the crossing was
        // invisible in the artifacts) and letting expected.json account for it.
        // PARSED ONCE, AND THE REASON KEPT. This was three independent `try { JSON.parse(r.stdout) }
        // catch { DEGRADED / null }` blocks over the same string — so the classifier's reason, the
        // vendor's stderr and the stdout itself were all discarded, three separate times, at the
        // exact moment they became the only evidence there was.
        //
        // Measured in the story-pipeline fixture: tiebreak-G-17 and tiebreak-G-32 both came back
        // DEGRADED with `ruling: null`, no error, no validator_errors and no stderr — two disputes
        // left unadjudicated with nothing to say why, on a run whose agy transport had round-tripped
        // thirty minutes earlier. The panel ARMS record this properly (panel-codex-docs explained
        // itself in one line, in the gate), and the asymmetry is the whole defect: one of the two
        // external spawn sites was taught to keep its diagnostics and the other was not.
        const tbEnvelope = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
        const tbProbe = classifyPanelProbe(tbEnvelope, judge.reviewer);
        // Written BESIDE the vendor's raw log, in the directory git ignores, and only on failure.
        // The status file this run also writes is tracked, so it gets the path and not the bytes.
        if (tbProbe.state !== 'reachable') {
          try {
            const dir = path.join(runDir, 'evidence', nodeId);
            runDirOf(dir);
            writeJson(path.join(dir, 'failure.json'), {
              node_id: nodeId,
              state: tbProbe.state,
              // The classifier's reason can itself quote the vendor's stderr, which is why it lives
              // here rather than in nodes/.
              reason: tbProbe.reason ?? null,
              exit_code: r.status,
              stderr_excerpt: (r.stderr ?? '').trim().slice(0, 4000) || null,
              // Withheld when it parsed: the envelope is then the record and this would duplicate it.
              stdout_excerpt: tbEnvelope ? null : (r.stdout ?? '').trim().slice(0, 4000) || null,
            });
          } catch (e) {
            console.error(`adjudication: could not write failure detail for ${nodeId}: ${e.message}`);
          }
        }
        writeTrackedJson(path.join(nodesDir, `${nodeId}.status.json`), {
          schema_version: 1, run_id: runJson.run_id, node_id: nodeId,
          ...capturedStatusFields(r),
          // State from the ENVELOPE via classifyPanelProbe, not the exit code: external-review
          // exited 0 for every answer (and exits 5 now only for a failed preflight, whose envelope
          // names the tie-breaker), so `r.status === 0` recorded a missing/refusing agy as OK and a
          // disputed group as externally ruled when nothing ruled (G-33).
          state: tbProbe.state === 'reachable' ? 'OK' : 'DEGRADED',
          reviewer_answered: tbProbe.state === 'reachable',
          // WHY, in the artifact, whenever it is not OK. Named `validator_errors` because that is
          // the key the arms already use for the same thing, and the gate's "Lens did not report"
          // section reads it.
          // THE DIAGNOSTICS GO WHERE GIT DOES NOT FOLLOW, AND A POINTER COMES BACK.
          //
          // The first version wrote the classifier's reason plus stderr and stdout excerpts into
          // THIS file — and `nodes/*.status.json` is tracked, while `evidence/` is gitignored
          // precisely because it holds content. external-review's unavailable reason is
          // `exited <n> with no output: <the vendor CLI's stderr>`, so that published the exact
          // class this codebase has twice ruled out of history: run-checks strips `stderr_tail`
          // from the tracked checks.json because command output may hold "a connection string, an
          // environment dump, a token inside an error", and external-review refuses any write path
          // git would keep. Raised by security-audit on the sweep of that change.
          //
          // Diagnosability was the point and it survives: the state is enough to act on, the detail
          // sits beside the vendor's own raw log in the same ignored directory, and the status file
          // names the path rather than quoting it.
          ...(tbProbe.state === 'reachable' ? {} : {
            // A PREFLIGHT REFUSAL IS NAMED, as for the arms (G-11 of 20261009-232840-reviewer-preflight-r1).
            ...(preflightRefusal(tbProbe.reason) ? { preflight_refused: preflightRefusal(tbProbe.reason) } : {}),
            validator_errors: [preflightRefusal(tbProbe.reason)
              ? `adjudicator '${judge.reviewer}' refused before its call — ${preflightRefusal(tbProbe.reason)}`
              : `adjudicator '${judge.reviewer}' unavailable: ${tbProbe.state}`
                + ` — detail in evidence/${nodeId}/failure.json (gitignored, not quoted here: a`
                + " vendor's stderr can carry a credential and this file is tracked)"],
            failure_detail: `evidence/${nodeId}/failure.json`,
          }),
          kind: NODE_KIND.adjudication, source: judge.reviewer,
          // A JUDGE WITH A STAKE, recorded on its own vote. Every arm runs on codex, so a codex
          // judge voting on a group a codex arm raised is voting on its own family's position.
          party_to_dispute: party,
          group_id: g.group_id,
          // The PINNED runtime, recorded like every other node's (I-8). These were null while the
          // spawn passed --model, so the artifact denied the pin it had just used and a ruling
          // could not be attributed to the model that made it (G-46).
          model: judge.model ?? null,
          effort: judge.effort ?? null,
          // THE RULING ITSELF, structured. It was parsed, flattened into one markdown sentence,
          // appended to reconciled.md and then discarded — so `supports` existed for exactly as
          // long as it took to render it into prose, and nothing downstream could read which
          // position an adjudication had upheld (G-43). The whole point of giving the tie-break a
          // schema was that the ruling stop being prose.
          // THE VOTE, NOT THE VENDOR'S PROSE. `rationale` is third-party free text that routinely
          // quotes the disputed excerpt back — repository content — and this file is TRACKED. Same
          // rule as the stderr: the machine-readable vote stays here, the words go to evidence/.
          // (contract-audit, I-11.)
          ruling: tbEnvelope
            ? { supports: tbEnvelope.supports ?? null, confidence: tbEnvelope.confidence ?? null }
            : null,
          rationale_detail: `evidence/${nodeId}/ruling.json`,
          // WHAT THE VENDOR REPORTED, not only what it decided (G-41 and its sibling).
          //
          // This writer enumerates the fields it keeps, so anything the envelope gains is discarded in
          // silence until somebody adds a line — and twice nobody did. G-41: external-review names an
          // unpinned model or effort in the envelope's not_checked, and it reached only
          // evidence/ruling.json and the rendered ruling line, never the gate, because "the status file
          // carries supports and confidence only". The sibling, found while asking whether a run can be
          // capped on TOKENS: `usage` was dropped the same way, so the four adjudication nodes were
          // invisible to any token accounting — the missing 4% of a run — while the ARM writer, reading
          // an envelope from the same script, copied both through.
          //
          // The rationale deliberately stays OUT: it is third-party prose that quotes the disputed
          // excerpt back, and this file is tracked. Detail to evidence, accounting to the status.
          usage: tbEnvelope?.usage ?? null,
          not_checked: tbEnvelope?.not_checked ?? [],
          // G-35: the DECLARED id, so a judge is named the way every other roster entry is.
          judge_id: judgeId,
          auth_mode: authModeFor(NODE_KIND.adjudication), env_passed: tbPassed,
          launched: true, started_at: tbStartedAt, ended_at: new Date().toISOString(),
          // The exit code, which was also discarded. external-review prints an envelope for every
          // answer it has and exits 0, or 5 when the judge failed its preflight and was never called;
          // any other non-zero status means it refused its arguments before reaching a reviewer, and
          // both are different problems from a reviewer that answered badly.
          exit_code: r.status,
          // THE REST OF WHAT THE PROCESS DID, as an arm records it (telemetry-records.plan.md stage 1c): the duration
          // external-review timed at the spawn site (null when no envelope carried one, never 0), the signal, whether the
          // backstop timer stopped it, and the limit that applied.
          duration_ms: typeof tbEnvelope?.duration_ms === 'number' ? tbEnvelope.duration_ms : null,
          signal: r.signal ?? null, timed_out: r.timedOut === true, timeout_minutes: NODE_TIMEOUT,
          // The vendor call's entry (runtime-call-telemetry.plan.md stage 3), answered when the ruling was classified reachable.
          call: markAnswered(tbEnvelope?.call ?? null, tbProbe.state === 'reachable'),
        });
        // THE SAME REASON THE STATUS FILE GOT. This stub was a bare "(tie-breaker did not answer)",
        // so reconciled.md — which second-opinion audits and the gate summarises — reported an
        // unadjudicated dispute without saying whether the adjudicator was missing, refused, timed
        // out or returned something unparseable. Those are four different problems with four
        // different fixes, and the reader was handed one sentence covering all of them.
        // The words, beside the vendor's own raw log, in the directory git ignores.
        try {
          const dir = path.join(runDir, 'evidence', nodeId);
          runDirOf(dir);
          writeJson(path.join(dir, 'ruling.json'), {
            node_id: nodeId, judge_id: judgeId, group_id: g.group_id,
            supports: tbEnvelope?.supports ?? null,
            confidence: tbEnvelope?.confidence ?? null,
            rationale: tbEnvelope?.rationale ?? '',
            not_checked: tbEnvelope?.not_checked ?? [],
          });
        } catch (e) {
          console.error(`adjudication: could not write the ruling detail for ${nodeId}: ${e.message}`);
        }

        // ONE JUDGE'S VOTE, RECORDED — not a ruling. Deciding the group happens after the pool
        // drains, over every vote at once, in lib/adjudication.mjs. A worker that decided would be
        // deciding from a partial tally, and whichever judge finished last would be the one whose
        // answer stood: the single-judge shape rebuilt out of concurrency.
        const votes = votesByGroup.get(g.group_id) ?? [];
        votes.push({
          // THE DECLARED ID. `judge: nodeId` named a vote after the node rather than the judge,
          // which is the pattern no other roster entry follows and the reason the per-judge summary
          // had to key on something else to aggregate at all.
          judge: judgeId,
          node_id: nodeId,
          reviewer: judge.reviewer,
          state: tbProbe.state,
          reason: tbProbe.reason ?? null,
          supports: tbEnvelope?.supports ?? null,
          confidence: tbEnvelope?.confidence ?? null,
          rationale: tbEnvelope?.rationale ?? '',
          not_checked: tbEnvelope?.not_checked ?? [],
          party,
          participants,
        });
        votesByGroup.set(g.group_id, votes);
        {
          // `Number(null)` IS 0 AND 0 IS FINITE (G-22). A judge whose vendor explicitly returned
          // `total_cost_usd: null` was tallied as costing nothing and never reached `unmeasured` —
          // defeating the intent stated four lines above this block. `measuredUsd` separates a real
          // zero, which is a measurement, from an absence, which is not.
          const spent = measuredUsd(tbEnvelope?.total_cost_usd);
          if (spent !== null) adjudicationCost.total += spent;
          else if (!adjudicationCost.unmeasured.includes(judgeId)) adjudicationCost.unmeasured.push(judgeId);
        }

        let ruling = tbProbe.state === 'reachable'
          ? `(${judge.reviewer} did not answer)`
          : `(no vote — ${judge.reviewer} ${tbProbe.state}: ${tbProbe.reason})`;
        try {
          const env2 = tbEnvelope;
          if (!env2) throw new Error('no envelope');
          // THE RULING, not a verdict. `verdict PASS; no finding upheld` was what every measured
          // tie-break rendered to, because the review envelope had no field for which position won.
          //
          // An UNANSWERED tie-break and a ruling of "neither" are printed differently on purpose:
          // the first means nobody adjudicated, the second means somebody did and found the
          // evidence insufficient. Collapsing them would let an absent adjudicator read as a
          // considered draw.
          const claimed = env2.supports;
          // FROM THE ONE OWNER. This was a literal re-derivation of the vote vocabulary — a third
          // copy of the same list, in the file whose own comment says the vocabulary is owned once.
          const valid = voteValuesFor(participants).includes(claimed);
          ruling = claimed == null
            ? `NO VOTE — ${(env2.not_checked ?? []).map((n) => n.reason).join('; ') || `${judge.reviewer} did not answer`}`
            : `votes **${claimed}**${valid ? '' : ' (NOT a participant in this dispute — this vote is illegible and is not counted)'}` +
              `${env2.confidence ? ` · confidence ${env2.confidence}` : ''}. ${env2.rationale ?? ''}` +
              (env2.not_checked?.length ? ` [not checked: ${env2.not_checked.map((n) => n.item).join(', ')}]` : '');
        } catch { /* the stub above stands */ }
        // BOUNDED VISIBLY, through the module that owns bounding (G-36). This was a bare
        // `ruling.slice(0, 1200)`: the ruling ends with the adjudicator's own `not_checked[]`
        // items, so an ordinary rationale pushed those past the bound and reconciled.md showed a
        // ruling stopping mid-sentence — indistinguishable from one that ended there, with the
        // tie-breaker's stated gaps silently gone. reconciled.md is what second-opinion audits and
        // what the gate summarises, so a reader could not tell an adjudicator who checked
        // everything from one who said they had not. Bounding here is right; bounding without
        // saying so is not. Head AND tail, for the same reason capture keeps both: the ruling's
        // conclusion is at the front and its declared gaps are at the end.
        // KEYED, NOT APPENDED. Under concurrency the completion order is reviewer latency, which
        // would reorder reconciled.md run to run for no reason a reader could interpret. The
        // rulings are assembled below in the order the disputes were declared.
        // KEYED PER JUDGE, not per group: a group now has one line per judge, and two judges
        // writing to the same key would leave whichever finished last.
        // KEYED BY THE JUDGE, NOT ITS ADAPTER (G-14): two judges on one transport would otherwise
        // share a key, and the second ruling would overwrite the first's.
        ruled.set(`${g.group_id}::${judgeId}`, Buffer.concat(
          logWindow([Buffer.from(ruling, 'utf8')], RULING_MAX_BYTES,
            ({ total, headBytes, tailBytes, dropped }) => Buffer.from(
              `

[TRUNCATED — ruling was ${total} bytes; first ${headBytes} and last ${tailBytes} kept, `
              + `${dropped} dropped from the middle — read the tie-breaker's raw envelope under evidence/]

`)),
        ).toString('utf8'));
      }, CONCURRENCY, () => aborted);

      // DECLARED ORDER, not completion order. A group that was prepared but produced no entry was
      // dropped by the abort check above; it is named rather than omitted, because a dispute that
      // silently vanishes from reconciled.md is the same failure as a lens that never reported.
      //
      // THE MERGE, ONCE, OVER EVERY VOTE. Arithmetic, in the pure module the offline suite asserts:
      // a strict plurality decides, a 1-1 split is UNDECIDED and stays that way, an absent judge is
      // coverage 0 and never a vote against, and a vote naming a non-participant is illegible rather
      // than either. A single surviving vote still decides and is LABELLED single-judge, because
      // discarding it would throw away a judge that ruled and leaving it unmarked would reinstate
      // exactly what this replaced.
      const merged = new Map();
      for (const g of toAdjudicate) {
        const votes = votesByGroup.get(g.group_id);
        if (!votes) continue;   // prepared but never reached: reported below as interrupted
        merged.set(g.group_id, mergeAdjudication({
          participants: votes[0]?.participants ?? [],
          // Every judge that was DECLARED, whether it ran or was refused for a role gap. A judge
          // missing from this list is missing from coverage, and a panel that looks narrower than
          // it was declared to be is the reporting failure the merge exists to prevent.
          votes: [...votes, ...refused],
          // TOLD, NOT COUNTED FROM `votes`. A vote is pushed inside the pool worker and runPool stops
          // taking items once `aborted` is set, so a SIGINT between two judges of one group leaves
          // the second out of `votes` entirely — and coverage would report 1/1 for a panel that was
          // scheduled as 2. `eligible` is how many were sent.
          scheduled: JUDGES.length,
        }));
      }
      adjudicationSummary = summariseAdjudications([...merged.values()]);

      // THE MERGED DECISION IN A MACHINE-READABLE ARTIFACT. Until now it existed only as prose
      // appended to reconciled.md: each judge's vote was structured in its own status file, and
      // whether the PANEL decided was in no JSON anywhere. A consumer asking "was this dispute
      // settled, and how" had to parse markdown — against this framework's own rule that mechanical
      // facts belong in mechanical form (arch-review, contract-audit, I-7/I-13).
      //
      // Written to nodes/ because it is an index, not content: votes, outcome, tally, coverage and
      // agreement are all machine values, and the vendors' words stay under evidence/.
      //
      // COST PER JUDGE, separately (I-14). The run-wide total says what the review cost; it cannot
      // say what the panel cost, which is the number that decides whether the topology is worth
      // keeping. `null` where a vendor reports none, rather than 0 — unmeasured is not free.
      writeTrackedJson(path.join(nodesDir, 'adjudication.json'), {
        schema_version: 1,
        run_id: runJson.run_id,
        written_at: new Date().toISOString(),
        judges: JUDGES.map((j) => ({
          id: j.id ?? j.reviewer, reviewer: j.reviewer, model: j.model ?? null,
          effort: j.effort ?? null, family: familyOfCall({ reviewer: j.reviewer, model: j.model }, REVIEWER_TABLE),
          eligible: eligible.some((e) => (e.id ?? e.reviewer) === (j.id ?? j.reviewer)),
        })),
        summary: adjudicationSummary,
        cost_usd: adjudicationCost.total,
        cost_unmeasured_judges: adjudicationCost.unmeasured,
        groups: [...merged.entries()].map(([group_id, m]) => ({
          group_id,
          // WHO WAS ON EACH SIDE, reported and never gating (G-28). A reader asking whether a
          // decided dispute was cross-family can answer it here: `arms` and `non_arms` are the
          // declared arm ids crossed with the group's findings. An arm-only group, or one with a
          // single finding whose opponent was a lens's checked_clean entry, is visible rather than
          // silently refused — refusing it was tried, and it silenced every dispute in a live run.
          composition: disputeComposition({
            findings: groupsById[group_id]?.findings ?? [],
            armIds: ARM_IDS,
          }),
          outcome: m.outcome,
          supports: m.supports,
          confidence: m.confidence,
          tally: m.tally,
          coverage: m.coverage,
          agreement: m.agreement,
          party_judges: m.party_judges,
          non_party_votes: m.non_party_votes,
          undecided_reason: m.undecided_reason,
          votes: (m.votes_cast ?? []).map((v) => ({ judge: v.judge, supports: v.supports, party: v.party })),
          absent: (m.absent ?? []).map((a) => ({ judge: a.judge, why: a.why })),
          invalid: (m.invalid ?? []).map((i) => ({ judge: i.judge, supports: i.supports })),
        })),
      });

      // AND INTO THE GATE'S "DID NOT REPORT" ACCOUNTING, which covers judges the way it covers
      // lenses. `buckets.did_not_report` is filled ONCE from `expected`, long before this block
      // appends judge rows — so an absent judge appeared only as a DEGRADED row in the node table
      // and a number in the adjudication table, never in the section a reader looks at to find out
      // what did not report. Added per judge rather than per (judge, dispute): one line saying a
      // judge was silent on three groups is the fact; three identical lines are noise.
      {
        const silent = new Map();
        for (const [groupId, m] of merged) {
          for (const a of m.absent ?? []) {
            const row = silent.get(a.judge) ?? { groups: [], why: a.why };
            row.groups.push(groupId);
            silent.set(a.judge, row);
          }
        }
        for (const [judgeId, row] of silent) {
          buckets.did_not_report.push({
            node_id: judgeId,
            why: `adjudicator did not report on ${row.groups.length} disputed group(s) `
              + `(${row.groups.join(', ')}) — ${row.why}. Its vote is absent from those merges, `
              + 'never counted against either position',
          });
        }
      }

      for (const g of toAdjudicate) {
        // TWO REASONS A GROUP HAS NO MERGE, AND THEY ARE NOT THE SAME (G-38). This loop walked the
        // groups selected for adjudication and reported every missing merge as an interruption —
        // but the preparation loop above skips any group whose id is unusable, so a rejected id was
        // reported to the operator as "the run was interrupted", a cause they cannot act on. It also
        // printed the unvalidated model-supplied value straight into a markdown heading.
        const named = isGroupId(g.group_id);
        const m = named ? merged.get(g.group_id) : null;
        rulings.push(`### ${named ? g.group_id : `(unusable group id ${JSON.stringify(String(g.group_id)).slice(0, 40)})`}`, '');
        if (!m) {
          rulings.push(named
            ? '(not adjudicated — the run was interrupted before this group was reached)'
            : '(not adjudicated — its group id was rejected before any judge was asked: the id becomes '
              + 'a --node-id and a directory name, and the reconcile schema pins its shape)', '');
          continue;
        }
        // THE MERGED RESULT FIRST, then every vote that produced it. A reader who sees only the
        // outcome cannot tell a unanimous panel from a 2-1, and the per-judge counts are the thing
        // the source work found hides which way the instrument moved when it is omitted.
        rulings.push(
          m.decided
            ? `**Panel: supports \`${m.supports}\`** (${Object.entries(m.tally).map(([k, n]) => `${k}:${n}`).join(', ')})`
              + `${m.single_judge ? ' — SINGLE-JUDGE: only one judge voted, so this carries no agreement figure' : ''}`
              + `${m.party_judges.length ? ` — ${m.party_judges.length} of ${m.votes_cast.length} voting judges had a stake in this dispute` : ''}`
            // TIED AND ABSENT ARE DIFFERENT FACTS, and rendering both as UNDECIDED said a panel
            // that never reported had weighed the dispute and split. Silence is not a verdict.
            : m.outcome === 'absent'
              ? `**Panel: NOT ADJUDICATED** — ${m.undecided_reason}`
              // INQUORATE IS ITS OWN OUTCOME. A lone vote used to decide the group with a
              // SINGLE-JUDGE label, which restored the single-judge path this whole topology
              // replaced — reachable by one timeout. The vote is still shown below; it just does
              // not become the answer.
              : m.outcome === 'inquorate'
                ? `**Panel: INQUORATE** — ${m.undecided_reason}`
                : `**Panel: UNDECIDED (tied)** — ${m.undecided_reason}`,
          '',
          `Coverage ${m.coverage.voted}/${m.coverage.scheduled} judges`
            + (m.agreement.rate === null
              ? '; agreement not computable (fewer than two votes)'
              : `; pairwise agreement ${m.agreement.rate} over ${m.agreement.pairs_compared} pair(s)`),
          '',
        );
        for (const j of prepared.filter((p) => p.g.group_id === g.group_id)) {
          rulings.push(`- \`${j.judge.reviewer}\`${j.party ? ' (party to this dispute)' : ''}: `
            + (ruled.get(`${g.group_id}::${j.judge.id ?? j.judge.reviewer}`) ?? '(no record — interrupted)'));
        }
        rulings.push('');
      }
      // ATOMIC, AND IT SAYS WHEN IT LANDED (G-48, panel-codex-arch).
      //
      // Two problems in one appendFileSync. An interruption mid-append leaves a truncated tail in a
      // file nothing marks as incomplete — and reconciled.md is remediate's work list. And
      // second-opinion has ALREADY audited this file by the time the rulings arrive, so the
      // adjudication a reader ends up with is not the version that was audited; nothing said so.
      //
      // The ordering cannot simply be reversed: a tie-break fires only on groups reconcile declared
      // disputed, and second-opinion audits the adjudication that produced them. So the section
      // states its own provenance instead of pretending to have been there.
      appendTracked(
        path.join(runDir, 'reconciled.md'),
        [
          '',
          '> These rulings were APPENDED after `second-opinion` audited this file. They are part of',
          '> the adjudication and were not part of what that audit read.',
          '',
          ...rulings,
        ].join(String.fromCharCode(10)),
      );
      console.log('tie-break rulings appended to reconciled.md');
      // Freed as soon as the last external reader is done with it.
      tearDownPanelWorktree();
    }
  } catch (e) {
    // A broken adjudication must not break the run it serves — but it must not be INVISIBLE to the
    // gate either. This printed to stderr and nothing else: status bucketing had already finished
    // and the judge rows were non-required, so a pool, status-write or append failure left the gate
    // completing normally with the disputes silently unadjudicated. A console line is not an
    // artifact (panel-codex-code, panel-codex-security).
    // THE CAUSES, NOT THE COUNT. `runPool` throws an AggregateError whose `.errors` holds one real
    // error per failed worker — and `e.message` on that is "3 pool workers failed", which is what
    // this recorded. A consumer-mount sweep then hit it for real: five genuine disputes, two judges,
    // both vendors answering correctly, and the phase threw. The gate said "3 pool workers failed",
    // the three causes were in the object that was being stringified, and the run had cost $69.49 —
    // so the one thing needed to fix it was discarded at the boundary, by the same move this
    // repository has now corrected for vendor stderr, for the detector's contract read, and for a
    // DEGRADED ruling. A count is not a diagnosis.
    // UNWRAPPED BY THE OWNER (lib/crash.mjs). This was inline here, correct once; the identical
    // loss at `await panelPromise` is what said it had to be a tested function instead.
    const causes = crashCauses(e);
    adjudicationCrashed = crashSummary(causes) || String(e?.message ?? e);
    let detail = null;
    try {
      const dir = path.join(runDir, 'evidence', 'adjudication');
      runDirOf(dir);
      writeJson(path.join(dir, 'crash.json'), crashRecord({ phase: 'adjudication', error: e, causes, at: new Date(hostPlatform().now()).toISOString() }));
      detail = 'evidence/adjudication/crash.json';
    } catch (writeErr) {
      console.error(`adjudication: could not write the crash detail: ${writeErr.message}`);
    }
    console.error(`adjudication failed: ${adjudicationCrashed}`);
    for (const c of causes) console.error(String(c?.stack ?? c).split('\n').slice(0, 4).join('\n'));
    buckets.not_checked.push({
      node_id: 'adjudication',
      why: `the adjudication phase threw — ${causes.length} worker failure(s): ${adjudicationCrashed}`
        + `${detail ? ` (stacks in ${detail}, gitignored)` : ''} — the disputed groups reconcile `
        + 'declared are unadjudicated, and this run cannot say which way they would have gone',
    });
  }
}

// ---------------------------------------------------------------------------- phase 4: gate
function writeGate(forced, reason) {
  // TREE-MOVED (G-44). Declared in disk-first-protocol.md §7 since the beginning and implemented in
  // no script: nothing compared the tree against run start, and the field that would have enabled
  // it — run.json.worktree_sha — was written as the HEAD COMMIT under a name promising working-tree
  // state, so editing a tracked file could not have moved it even if something had looked. Every
  // finding cites a file and a line; if the reviewed files changed during a fan-out that runs for
  // tens of minutes, those citations may name lines that no longer exist, and the gate said nothing.
  // Computed here, the latest possible point, so it covers the whole run.
  // A NULL HASH AT MINT IS A RECORDED STATE, not a missing one (G-18 of 20261001-183347-cgg-review-r4): mint writes the
  // key always, null when the scope held nothing to hash, and `runJson.worktree_sha &&` skipped the comparison — so a
  // scope empty at mint that held files at the gate read as unchanged, the other half of G-14. Only a run.json written
  // before the key existed (undefined) has nothing to compare.
  if (runJson.worktree_sha !== undefined && (runJson.scope?.paths ?? []).length) {
    const nowSha = worktreeSha({
      repoRoot, paths: runJson.scope.paths, excludeDir: path.dirname(runDir),
      // Must match what new-run hashed, or every run reports its own tree as moved (G-32).
      generatedGlobs: runJson.contract?.generated_globs ?? [],
    });
    // A NULL HASH NOW IS A MOVE, not a pass (G-14 of 20261001-155615-cgg-review-r3): worktreeSha returns null when nothing
    // in scope can be hashed, and `nowSha &&` let a scope that vanished entirely between mint and gate read as unchanged.
    // Mint had something to hash — the guard above — so nothing now is the largest move there is.
    if (nowSha !== runJson.worktree_sha) {
      runJson.stamps = [...new Set([...(runJson.stamps ?? []), 'TREE-MOVED'])];
      writeJson(runJsonPath, runJson);
      buckets.not_checked.push({
        node_id: 'worktree',
        why: 'the reviewed files changed during the run, or one could not be read (TREE-MOVED) — file-and-line citations may name lines that have moved, so no conclusion resting on a location is better than RISK',
      });
    }
  }
  // Criteria that moved mid-flight mean the run measured nothing (§5, §7), and this is checked HERE
  // — unconditionally, at the gate — rather than only inside the barrier. A run where every lens
  // reported clean produces no groups, skips the barrier entirely, and is exactly the run that can
  // emit PASS; the check was absent from that one path (G-50).
  if (!intentIsIntact()) {
    runJson.stamps = [...new Set([...(runJson.stamps ?? []), 'INTENT-DRIFT'])];
    writeJson(runJsonPath, runJson);
    if (!buckets.did_not_report.some((b) => b.node_id === 'intent.md')) {
      buckets.did_not_report.push({
        node_id: 'intent.md',
        why: 'the criteria changed after the run froze them — every finding was judged against a bar that no longer exists',
      });
    }
  }

  const stamps = runJson.stamps ?? [];
  const requiredNodes = expected.filter((e) => e.required);
  const badRequired = requiredNodes.filter((e) => {
    if (!statusPresent(e.node_id)) return true;
    const st = readStatus(e.node_id);
    // SKIPPED is not a pass for a REQUIRED node. `required` is already false for a lens
    // whose condition is unmet or that --only excluded, so the only way to reach here
    // skipped is with the skill absent — the lens never ran and nothing checked its
    // dimension. Whitelisting SKIPPED here let a missing required lens emit PASS.
    return st.state !== 'OK';
  });

  // THE THIRD AUX NODE (G-48). reconcile and intent-capture each got a silence branch and this one
  // did not. second-opinion is absent from `expected` too, so a DEGRADED/killed/stubbed audit
  // appeared in no bucket and no gate row, and the gate stayed free to compute PASS — the
  // adversarial audit OF the adjudication failing silently and reading like one that passed.
  const soState = statusPresent('second-opinion')
    ? readStatus('second-opinion').state
    : undefined;
  const secondOpinionWasSilent = secondOpinionSilent({
    installed: skillInstalled('second-opinion'),
    skipped: Boolean(args.skipPanel),
    hadReconciled: runHas(path.join(runDir, 'reconciled.md')),
    state: soState,
  });
  if (secondOpinionWasSilent && !buckets.did_not_report.some((b) => b.node_id === 'second-opinion')) {
    buckets.did_not_report.push({
      node_id: 'second-opinion',
      why: `the adversarial audit of the adjudication did not report OK (${soState ?? 'no status'}) — the findings were adjudicated but nothing checked that adjudication`,
    });
  }

  let ceiling = 'PASS';
  // FROM THE DECLARED LIST (lib/decisions.mjs CAPPING_STAMPS), not from conditions spelled here.
  // A stamp whose consequence lives only in an inline condition can be promised by three documents
  // and delivered by none, and the guard that should catch that can only look for the stamp's NAME
  // in this file — which a comment satisfies. That is G-63 and G-85 together.
  if (stampCaps(stamps)) ceiling = 'RISK';
  // An adjudication nobody audited cannot read as PASS. Weaker than the barrier's BLOCKED on
  // purpose: the findings WERE adjudicated, so this is an overstatement of confidence rather than
  // a verdict resting on nothing (G-48).
  if (secondOpinionWasSilent) ceiling = 'RISK';
  // The panel was ENABLED and produced nothing, so the cross-family half of this review did not
  // happen. Same reasoning one line up: not wrong, UNCORROBORATED — and PASS on a run that believes
  // it had a second family is precisely the overstatement RISK exists to say (G-13).
  if (panelWasSilent) ceiling = 'RISK';

  // A precondition the graph KNEW was unmet, tried to close, and failed to close. That is a
  // strictly worse position than never having needed it, and it must not read as PASS: the run
  // identified a gap in its own inputs and could not fill it, so whatever it did check, it checked
  // against less than it should have. The stamp already says so; this makes the verdict say so.
  //
  // RISK rather than BLOCKED deliberately — the lenses that DID run produced real evidence, and
  // discarding it would punish the run for the honesty of recording the gap.
  // A DISPUTE THAT WAS NEVER SETTLED CANNOT LEAVE THE GATE AT PASS.
  //
  // The ceiling never read `adjudicationSummary` at all — it was rendered into gate.md and used for
  // nothing else. So a run whose only unsettled item was a disputed LOW-severity group emitted PASS
  // with a lens and an arm still flatly contradicting each other, because the §2 severity floor
  // leaves every node verdict at PASS. The panel's whole purpose is that contradiction, and the
  // verdict said nothing about it (contract-audit, I-17).
  //
  // RISK, not BLOCKED, for the reason the sibling ceilings give: the lenses that DID run produced
  // real evidence, and an unsettled dispute means uncorroborated rather than wrong.
  if (adjudicationCrashed) ceiling = 'RISK';
  if (adjudicationSummary) {
    const unsettled = adjudicationSummary.tied + adjudicationSummary.inquorate + adjudicationSummary.absent;
    if (unsettled > 0) ceiling = 'RISK';
  }
  const recoveryFailures = stamps.filter((s) => s.endsWith('-FAILED'));
  if (recoveryFailures.length) ceiling = 'RISK';
  // A run whose criteria were inferred rather than stated cannot certify conformance either.
  if (stamps.includes('REQUEST-INFERRED')) ceiling = 'RISK';

  // G-51 (BLOCKER): the reconciler is the barrier, but it lives in roster.barrier_nodes, not
  // roster.lenses, so it is NEVER in requiredNodes and badRequired can never catch its silence.
  // When there were findings to adjudicate (groupsOut.length) and the reconcile skill is installed,
  // a barrier that timed out, exhausted its budget, or returned unparseable output leaves every
  // group unadjudicated — and without this branch the gate would still compute from lens verdicts
  // alone, up to PASS, at the one node whose silence is least visible. Silence is not a verdict,
  // least of all here. SKIPPED-because-no-findings is legitimate and excluded (groupsOut is empty).
  const reconcileWasSilent = reconcileSilent({
    groupCount: groupsOut.length, reconcileInstalled: skillInstalled('reconcile'), reconcileState,
  });
  if (reconcileWasSilent && !buckets.did_not_report.some((b) => b.node_id === 'reconcile')) {
    // COUNTED against what WAS judged (G-17 of 20261007-031302-consumer-use-review): a batched barrier that failed
    // part-way has a merged payload covering its earlier batches, and "every group unadjudicated" overstated the gap.
    let judged = 0;
    try {
      const rp = JSON.parse(runOwner.read(['evidence', 'reconcile', 'payload.json']));
      const ids = new Set(groupsOut.map((g) => g.group_id));
      judged = new Set((rp.groups ?? []).map((g) => g.group_id).filter((id) => ids.has(id))).size;
    } catch { /* no payload: nothing was judged */ }
    buckets.did_not_report.push({
      node_id: 'reconcile',
      why: `barrier did not report OK (${reconcileState}) — ${groupsOut.length - judged} of ${groupsOut.length} `
        + 'group(s) left unadjudicated',
    });
  }

  // The SAME hole as the barrier's, at the other end of the graph. intent-capture is an aux node,
  // not in `expected`, so it has no row in gate.json, cannot appear in badRequired, and its failure
  // was invisible to every branch here. Observed: intent-capture was killed by its timeout, no
  // intent.md was ever written, and the gate emitted FAIL with ceiling PASS while contract-audit
  // returned a conformance verdict against criteria that do not exist — and because the criteria
  // set was empty, spawn-node's intent_ref validation had nothing to check those citations against
  // and skipped it. A run whose criteria were never produced measured nothing about conformance.
  const intentRequiredButMissing = expected.some((e) => e.present && e.intent === 'required')
    && !runJson.intent_sha256;
  if (intentRequiredButMissing && !buckets.did_not_report.some((b) => b.node_id === 'intent-capture')) {
    buckets.did_not_report.push({
      node_id: 'intent-capture',
      why: 'no intent.md was produced, but a lens in this run cites intent as its basis — every I-n citation in this run is unverifiable',
    });
  }

  const verdicts = buckets.ok.map((o) => o.verdict).filter(Boolean);

  // THE ADJUDICATION CAN RAISE THE GATE, AND ONLY RAISE IT (G-49, panel-codex-code).
  //
  // The gate read pre-reconciliation node verdicts and nothing else, so the barrier's judgement
  // reached reconciled.md and stopped there: a group the reconciler UPGRADED — two lenses each
  // calling it MEDIUM, the reconciler seeing the root cause and calling it HIGH — moved no gate that
  // the lenses' own RISK had not already moved. The severity that survives adjudication is the one
  // the run believes, and the gate is where the run states what it believes.
  //
  // THE OTHER DIRECTION STAYS CLOSED, deliberately, and the finding asks for it: a group the
  // reconciler DROPPED still leaves its lens's FAIL standing. Letting an adjudication LOWER the gate
  // hands a model the power to clear a deterministic verdict — including a red test's — which is the
  // cheap-reviewer cascade in its most expensive form. A dropped false positive costs a RISK nobody
  // needed; a wrongly-cleared FAIL costs the thing this whole system is for. The asymmetry is the
  // same one raiseVerdict and capVerdict already encode: under-reporting is the direction that
  // produces a false PASS, so only that direction is corrected automatically.
  //
  // AN UNREADABLE PAYLOAD IS THE RECONCILER NOT REPORTING (G-15 of 20260930-011534-m0-gate-review-r2). A catch here
  // returned PASS, so a corrupt payload.json dropped every upgrade the adjudication made — the direction above calls
  // the one that must not be lost. adjudicationFloor refuses it, and the refusal lands in the did-not-report bucket.
  // A refusal by the owner keeps its cause (G-16 of 20261029-235315-rdr-remediation-4-review): a link at the payload is
  // not an absent payload.
  let adjudicationPayloadText = null;
  let adjudicationPayloadRefused = null;
  // Through the run owner, not the egress owner (G-9 of 20261114-231942-pbr-delivery): this is the gate's own decision
  // input and goes into no prompt, and a local read keeps `confined` alone (ARCHITECTURE A-30, HL-D1 B).
  try { adjudicationPayloadText = runOwner.read(['evidence', 'reconcile', 'payload.json']); } catch (e) {
    if (e.code === 'ECONFINED') adjudicationPayloadRefused = `${refusalWords(e)} stands at evidence/reconcile/payload.json`;
  }
  const adjudication = adjudicationFloor({
    groupCount: groupsOut.length, reconcileState,
    payloadText: adjudicationPayloadText, payloadRefused: adjudicationPayloadRefused,
  });
  if (adjudication.refused && !buckets.did_not_report.some((b) => b.node_id === 'reconcile')) {
    buckets.did_not_report.push({
      node_id: 'reconcile',
      why: `${adjudication.refused} — ${groupsOut.length} group(s) left without a readable adjudication`,
    });
  }
  const adjudicatedFloor = adjudication.floor ?? 'PASS';

  // THE BUCKET IS THE GATE'S INPUT (G-16 of the same review). The chain below read each required node's status file
  // and never this bucket, so a required lens with an OK status and a missing or refused verdict.kept.json was listed
  // as silent while the gate still computed PASS. Every entry that blocks is decided in one place.
  const silentBlocking = blockingSilence({ didNotReport: buckets.did_not_report, expected });

  let gate;
  if (forced) gate = forced;
  // Criteria that moved mid-flight mean the run measured nothing — not a statement about the code.
  else if (stamps.includes('INTENT-DRIFT')) gate = 'BLOCKED';
  else if (badRequired.length) gate = 'BLOCKED';
  // A barrier that was needed and did not report leaves the findings unadjudicated (G-51).
  else if (reconcileWasSilent) gate = 'BLOCKED';
  // Criteria that were never produced mean the run measured nothing about conformance — the same
  // reading INTENT-DRIFT gets when they move mid-flight, and for the same reason.
  else if (intentRequiredButMissing) gate = 'BLOCKED';
  // Any other silence the bucket holds that blocks: a required lens whose validated findings are unavailable, or a
  // reconciler whose payload could not be read.
  else if (silentBlocking.length) gate = 'BLOCKED';
  // A red test outranks every lens opinion in the run. It is deterministic, reproducible, and its
  // failure mode is uncorrelated with any model's — so it forces the verdict rather than capping
  // it. Before this, a failing suite printed FAIL in the barrier and the gate still said PASS,
  // which would have made the regression suite decorative: a resurfaced bug turns a test red and,
  // without this line, changes nothing anyone reads.
  // A suite that could not START is not a red suite, and it must not force the verdict. run
  // 20260915-021139 forced FAIL on a consumer whose package was simply not installed: pytest exited 2
  // with 224 collection errors and ZERO tests executed, and the gate reported "your code is broken"
  // about code no test had examined. TESTS-DID-NOT-RUN caps like UNTESTED instead — nothing was
  // learned, so nothing is asserted.
  else if (stamps.includes('TESTS-FAILING')) gate = 'FAIL';
  else if (verdicts.includes('FAIL') || adjudicatedFloor === 'FAIL') gate = 'FAIL';
  else if (verdicts.includes('RISK') || ceiling === 'RISK' || adjudicatedFloor === 'RISK') gate = 'RISK';
  else gate = 'PASS';

  const gateJson = {
    run_id: runJson.run_id, gate, reason: reason ?? null, max_verdict: ceiling, stamps,
    // What the ADJUDICATION alone would have required, recorded beside the gate: a reader comparing
    // it against the node verdicts can see which of the two produced this verdict (G-49).
    adjudicated_floor: adjudicatedFloor,
    // THE PANEL'S OWN OUTCOME, in the machine-readable gate. It was rendered into gate.md and into
    // no JSON at all, so whether a dispute was settled could only be read out of markdown — against
    // this framework's own rule that mechanical facts belong in mechanical form. `null` when no
    // dispute arose, which is a different fact from a panel that ran and settled nothing.
    adjudication: adjudicationSummary
      ? { ...adjudicationSummary, crashed: adjudicationCrashed }
      : (adjudicationCrashed ? { crashed: adjudicationCrashed } : null),
    scope: runJson.scope, intent_sha256: runJson.intent_sha256 ?? null,
    // WHERE THIS RUN'S BUILD AND TEST EVIDENCE CAME FROM. Three states — produced by this run,
    // reused from a named one, or not produced at all — and the reader has to be able to tell them
    // apart without opening checks.json. `from` is the audit thread: it names the run whose tree
    // that evidence actually describes.
    preflight: {
      state: preflightOutcome.state,
      from: preflightOutcome.from,
      inputs_inferred: preflightOutcome.inferred,
      evidence_restored: preflightOutcome.evidence_restored,
      reason: preflightOutcome.reason,
    },
    // Copied onto the gate, not left only in run.json. gate.json is the file a reader opens months
    // later, and "which orchestrator produced this verdict" is exactly the question that arises
    // when two projects on different framework versions disagree about the same code.
    framework: runJson.framework ?? frameworkStamp(FRAMEWORK.frameworkRoot, { layout: FRAMEWORK.layout }),
    nodes: expected.map((e) => {
      const st = statusPresent(e.node_id) ? readStatus(e.node_id) : {};
      return {
        node_id: e.node_id, required: e.required,
        // Both facts, because the gate rendered one of them under a heading that promised the
        // other: `required` is this RUN's answer (false for a lens nobody asked to run, which is
        // what the BLOCKED rule reads), and `required_by_roster` is what the roster declares.
        // `--only arch-review` printed `| contract-audit | no |` for a lens declared required:true.
        required_by_roster: e.required_by_roster ?? e.required,
        deselected: Boolean(e.deselected),
        state: st.state ?? 'MISSING',
        verdict: st.verdict ?? null, findings_count: st.findings_count ?? 0,
        report_path: st.report_path ?? null, report_sha256: st.report_sha256 ?? null,
        evidence_dir: `evidence/${e.node_id}`, skip_reason: st.skip_reason ?? null,
        session_id: st.session_id ?? null, total_cost_usd: st.total_cost_usd ?? null,
      };
    }),
    buckets, reconcile_state: reconcileState,
    // The groups the reconciler's reply left out and were asked again (reconcile-missing-groups.plan.md stage 1).
    // FROM THE STATUS, not this process (RA-D2 A): a resume that re-asked nothing still reports the run's recorded
    // attempt. A list, or null when the run made none.
    reconcile_reask: (() => {
      const st = statusPresent('reconcile') ? readStatus('reconcile') : null;
      const attempts = reaskAttempts(st);
      return attempts.length ? attempts : null;
    })(),
    total_cost_usd: Number(spentSoFar().toFixed(4)),
    reviewer_overrides: REVIEWER_OVERRIDES,
  };
  writeTrackedJson(path.join(runDir, 'gate.json'), gateJson);

  // WHICH KIND OF ANSWER THIS IS, ON THE SAME LINE AS THE ANSWER.
  //
  // PASS, RISK and FAIL are three rungs of one ladder and all three are claims about the CODE.
  // BLOCKED is not on that ladder at all — it is a claim about the RUN, and it means no verdict was
  // established. The distinction is the project's central rule, and the gate table already carries
  // it in two separate columns (`| contract-audit | OK | FAIL |` — the node was fine, its verdict on
  // the code was not). But the headline is one bare word with no register cue, and that is the one
  // place a reader meets the verdict first: read alone, "FAIL" is just as easily "the tool broke",
  // which is the one thing it never means. The exit code says the same thing and says it backwards
  // to most eyes — a FAIL run exits 0 because it WORKED; only BLOCKED exits 1.
  //
  // Derived from `buckets.did_not_report`, the one owner of the fact, rather than recounting
  // `expected` here (G-20): a second derivation of "did everything report" is exactly how the gate
  // and its own table would come to disagree.
  // THE NARROWING GOES IN THE HEADLINE, which is the one line every reader is guaranteed to read.
  // `# Gate — PASS · every node reported` was emitted by a run that spawned zero lenses: the
  // completeness clause counts nodes that were EXPECTED and silent, and a deselected lens is not
  // expected, so nothing was missing and nothing was reviewed. Naming the lenses that did run turns
  // "the code passed a review" into "the code passed THIS review", which is the whole difference.
  const ranLenses = expected.filter((e) => e.kind === NODE_KIND.lens && e.present).map((e) => e.node_id);
  const narrowed = stamps.includes(FAN_OUT_NARROWED_STAMP)
    ? ` · fan-out narrowed to ${ranLenses.length ? ranLenses.join(', ') : '(no lens)'}`
    : '';
  const L = [`# Gate — ${gate} · ${gateCompleteness(buckets.did_not_report.length)}${narrowed}`, ''];
  if (reason) L.push(`> ${reason}`, '');
  L.push(`| | |`, `|---|---|`, `| Run | \`${runJson.run_id}\` |`);
  L.push(`| Scope | ${runJson.scope?.full_sweep ? `human-asserted: \`${scopePaths.join('`, `')}\`` : 'derived from diff'} |`);
  L.push(`| Stamps | ${stamps.length ? stamps.map((s) => `\`${s}\``).join(', ') : '(none)'} |`);
  // THE EVIDENCE'S PROVENANCE, on the face of the gate. A reused result is evidence about a tree
  // that was measured at some other moment, and the run it came from is the thread to pull if that
  // looks wrong. A SKIPPED pre-flight is the case this row exists for: the gate used to say nothing
  // at all, so declared build and test commands that never ran were indistinguishable from ones
  // that passed.
  {
    const p = gateJson.preflight ?? {};
    const detail = p.state === 'reuse'
      ? `reused from \`${p.from ?? 'an earlier run'}\`${p.inputs_inferred ? ' — **input set inferred**, so this freshness claim is not proven' : ''}`
      : p.state === 'skipped'
        ? '**SKIPPED** — the declared checks did not run; see Not-checked'
        : 'ran in this run';
    L.push(`| Pre-flight | ${detail} |`);
  }
  if (REVIEWER_OVERRIDES.length) L.push(`| Reviewer overrides | ${REVIEWER_OVERRIDES.map(overrideLine).join('<br>')} |`);
  L.push(`| Ceiling | ${ceiling} |`);
  L.push(`| Cost | $${gateJson.total_cost_usd} |`);
  // Which orchestrator produced this verdict. gate.md is what a person actually opens — putting the
  // stamp only in gate.json would answer the question in the file nobody reads. `dirty` is surfaced
  // rather than hidden: a verdict from a modified framework tree is not reproducible from `commit`,
  // and that is exactly the caveat a reader needs at the moment they are trusting the result.
  {
    const fw = gateJson.framework ?? {};
    const commit = String(fw.commit ?? 'unknown').slice(0, 8);
    // THROUGH THE DECISION, not a hand-rolled repeat of it (G-20). `stampIsAttributable` is exported
    // from the pure layer to answer exactly this question — is this stamp good enough to attribute a
    // finding to a rebuildable state? — and had no runtime caller at all: only tests, which is an
    // inert feature by this project's own definition, sitting under a lens that requires the
    // inert-feature sweep. The prose here re-derived the same three cases by hand.
    const caveat = stampIsAttributable(fw)
      ? ''
      : fw.dirty === true ? ' — **modified tree, not reproducible from this commit**'
        : fw.dirty === null ? ' — cleanliness unverified'
          : ' — **no commit recorded, so this verdict cannot be attributed to a rebuildable state**';
    L.push(`| Framework | \`${fw.name ?? '?'}\` ${fw.version ?? '?'} @ \`${commit}\` (${fw.layout ?? '?'})${caveat} |`);
  }
  L.push('');
  L.push('## Nodes', '', '| Node | Required | State | Verdict | Findings |', '|---|---|---|---|---|');
  for (const n of gateJson.nodes) {
    // A deselected lens is not "not required" — it is required and was not asked for. Printing a
    // bare `no` under this heading stated something false about the roster in order to state
    // something true about the run.
    const req = n.required ? 'yes'
      : n.deselected && n.required_by_roster ? 'yes — **deselected**'
        : n.deselected ? 'no — deselected'
          : 'no';
    L.push(`| \`${n.node_id}\` | ${req} | \`${n.state}\` | ${n.verdict ?? '—'} | ${n.findings_count} |`);
  }
  L.push('');
  if (buckets.did_not_report.length) {
    L.push('## Lens did not report', '');
    for (const b of buckets.did_not_report) L.push(`- **\`${b.node_id}\`** — ${b.why}`);
    L.push('', '_A run with any non-OK required node cannot emit PASS. Silence is not a verdict._', '');
  }
  // THE AGREEMENT FIGURE, BESIDE THE NUMBER, ALWAYS. "The number without its agreement is the
  // single-judge number again in a bigger font." The gate reported a verdict, a ceiling, a cost and
  // a framework stamp, and nothing whatsoever about how much its panel agreed — while seven lenses
  // and seven arms reviewed the same scope.
  //
  // PER-JUDGE COUNTS, not only the aggregate: upstream, round 6 moved kappa 0.66 → 0.35 while the
  // headline barely changed, because one judge's objection was a different rule that more items gave
  // more to fire on. A panel number without its per-judge counts hides which way the instrument moved.
  if (adjudicationSummary && adjudicationSummary.adjudicated) {
    const s = adjudicationSummary;
    L.push('## Adjudication of disputed groups', '');
    L.push(`${s.adjudicated} disputed group(s): **${s.decided} decided**, ${s.tied} tied, `
      + `${s.inquorate} inquorate, ${s.absent} not adjudicated`
      // NOT "decided by a SINGLE judge" (G-44). With QUORUM = 2, single_judge is true exactly when
      // the group is INQUORATE — so that phrase announced as decided the groups that are by
      // definition undecided, in the gate's own headline. It is a breakdown of the inquorate count,
      // not a fourth outcome beside it.
      + `${s.single_judge ? ` (${s.single_judge} of them inquorate because only one judge voted)` : ''}.`, '');
    // ILLEGIBLE IS A COLUMN, because a judge that answered unusably is neither a voter nor a
    // silence, and it had no row at all until the summary started reading `invalid`.
    L.push('| judge | voted | absent | illegible | votes | stake |', '|---|---|---|---|---|---|');
    for (const r of s.per_judge) {
      const votes = Object.entries(r.votes).map(([k, n]) => `${k}:${n}`).join(', ') || '—';
      L.push(`| \`${r.reviewer ?? r.judge}\` | ${r.voted} | ${r.absent} | ${r.illegible ?? 0} | ${votes} | `
        + `${r.party ? 'party to a dispute it judged' : 'none'} |`);
    }
    L.push('');
    L.push(s.agreement.rate === null
      ? `_Agreement not computable: ${s.agreement.pairs_compared} comparable pairs. A lone judge `
        + 'agrees with itself trivially, which is not an agreement figure._'
      : `_Pairwise agreement **${s.agreement.rate}** over ${s.agreement.pairs_compared} pair(s). `
        + `Fleiss' kappa ${s.agreement.kappa_why}._`);
    L.push('', '_A tie is not broken. An undecided group reaches you undecided, because a split '
      + 'between judges is the finding rather than something to resolve._', '');
  }
  if (buckets.not_checked.length) {
    L.push('## Not checked', '');
    for (const b of buckets.not_checked) L.push(`- **\`${b.node_id}\`** — ${b.why}`);
    L.push('');
  }
  if (gateJson.reconcile_reask) {
    L.push('## Reconcile re-ask', '');
    for (const r of gateJson.reconcile_reask) {
      // A re-ask that was not launched is not said to have run (G-13 of 20261023-231847-rmg-remediation-review), whether
      // nothing reached a spawn or every spawn was refused, which carries its node's state (G-8 of rrr-remediation-review).
      L.push(`- The reconciler's reply left out ${r.groups.length} group(s), `
        + `${r.state === 'NOT-LAUNCHED' || r.batches === 0 ? 'not re-asked' : `re-asked once${r.batches > 1 ? `, in ${r.batches} batches` : ''}`}: `
        + `${r.groups.join(', ')}. Judged on the re-ask: ${(r.judged ?? []).join(', ') || 'none'}. `
        + `Still unjudged: ${(r.missing ?? []).join(', ') || 'none'}${reaskWhy(r) ? ` (${reaskWhy(r)})` : ''}.`);
    }
    L.push('');
  }
  // §8.5 rule 5: out-of-scope findings are "reported, never counted — they go in
  // out_of_scope_observations[], which the gate prints and does not tally." The gate printed
  // nothing, so the second half of that promise had no implementation and the list was invisible
  // wherever it was written (G-52). Read from each node's own evidence rather than recomputed here:
  // the spawner's validator is what decides scope, and a second decision would be free to disagree.
  //
  // Deliberately NOT tallied and deliberately NOT gating: an observation is something a lens noticed
  // outside the surface it was asked to review, so counting it would let work nobody scoped change a
  // verdict, and hiding it would waste the only sighting anyone gets.
  {
    const obs = [];
    for (const e of expected.filter((x) => x.present)) {
      // Through the one reader (2a). A refused or missing verdict contributes no observations; the node's silence
      // is reported by collectFindings. An observation that is not an object is skipped rather than spread into
      // "undefined — undefined".
      const kept = readKeptVerdict(runDir, e.node_id);
      if (!kept.ok) continue;
      const list = kept.verdict.out_of_scope_observations;
      for (const o of Array.isArray(list) ? list : []) if (o && typeof o === 'object' && !Array.isArray(o)) obs.push({ node: e.node_id, ...o });
    }
    if (obs.length) {
      L.push('## Out of scope, observed (not counted)', '');
      for (const o of obs) L.push(`- **\`${o.node}\`** \`${o.file}\` — ${o.note}`);
      L.push('', '_Reported because a lens saw them; not tallied, because nobody scoped them._', '');
    }
  }
  if (buckets.orphan_reports.length) {
    L.push('## Orphan reports (ignored)', '');
    for (const f of buckets.orphan_reports) L.push(`- \`${f}\` — a report with no OK status; not trusted`);
    L.push('');
  }
  writeTracked(path.join(runDir, 'gate.md'), L.join('\n'));
  return gate;
}

// LEFTOVERS ARE REAPED BEFORE THE GATE (G-14 of 20260926-002850-m0-close, with G-13, G-16, G-17). A
// child whose kill the OS refused kept running — only a signal ever stopped the held children, and
// spawn-node exited leaving its refused child recorded nowhere — while holding the operator's
// credentials. Our own children, whose handle has not seen an exit, are stopped once more through the
// one owner; a pid spawn-node recorded is only watched, never killed, because it may belong to another
// process by now. Stopped means an exit SEEN (stopping-a-child stage 4, design 2A); whatever was not seen
// to exit is named in the gate: it cannot be made to stop, only seen. The reap is io/reap.mjs's, which a
// test drives.
{
  const { stopped, notChecked } = await reapRun({ held: live.entries(), nodesDir });
  for (const r of stopped) console.error(`reap: ${r.node} (pid ${r.pid}) stopped at the end of the run`);
  buckets.not_checked.push(...notChecked);
  live.clear();
}
// PANEL-DEGRADED (reviewer-preflight stage 5, D4): an arm or judge whose combination passed at mint and did not answer
// now. Decided from the FROZEN run.json.reviewer_preflight and the status files, so --resume reaches the same answer as
// the run that spawned them. An arm's combination is its roster entry's, as it was spawned (its unparseable-answer stub
// records no model); a judge's is in its own status.
{
  const calls = [];
  for (const arm of roster.panel_arms ?? []) {
    if (!expected.some((e) => e.node_id === arm.id && e.present)) continue;
    calls.push({ id: arm.id, reviewer: arm.reviewer, model: arm.model, effort: arm.effort, mode: 'review', route: schemaRoute('review'),
      ok: !panelCallFailed(readStatus(arm.id)) });
  }
  // LISTED AND READ THROUGH THE OWNER, AND NO REFUSAL SKIPPED (G-17 of 20261029-190658-rdr-delivery): the listing was a raw
  // readdir of nodes/, and a status file the owner refused was passed over in silence, so a judge's failed call could drop
  // out of the stamp below. A status that cannot be read cannot show its call answered: the panel is degraded.
  const unread = [];
  let statusNames = [];
  try { statusNames = runList(nodesDir).filter((n) => n.endsWith('.status.json')); }
  catch (e) { if (e.code !== 'ECONFINED') throw e; unread.push({ node: null, label: `nodes/ (${e.message})` }); }
  for (const f of statusNames) {
    let st = null;
    try { st = JSON.parse(runOwner.read(['nodes', f])); } catch (e) {
      unread.push({ node: f.replace(/\.status\.json$/, ''), label: `nodes/${f}${e.code === 'ECONFINED' ? ` (${e.message})` : ''}` });
      continue;
    }
    if (st?.kind !== NODE_KIND.adjudication || !st.source) continue;
    calls.push({ id: st.node_id ?? f.replace(/\.status\.json$/, ''), reviewer: st.source, model: st.model, effort: st.effort,
      mode: 'tie-break', route: schemaRoute('tie-break'), ok: !panelCallFailed(st) });
  }
  const degraded = panelDegraded({ preflight: runJson.reviewer_preflight, calls });
  // ONLY A PANEL NODE'S, ONLY A PROMISED PANEL (G-18 of 20261029-201447-rdr-remediation-review): an unread lens status capped
  // the gate as PANEL-DEGRADED, decided here beside the owner rather than by it.
  const panelIds = new Set((roster.panel_arms ?? []).map((a) => a.id));
  // A POSITIVE TEST (G-14 of 20261029-224143-rdr-remediation-3-review): an arm, or a judge, by its expected row or its
  // node name; anything else (a lens, reconcile, reconcile-reask, second-opinion) is not the panel's.
  const judgeIds = new Set(expected.filter((e) => e.kind === NODE_KIND.adjudication).map((e) => e.node_id));
  const isPanelNode = (id) => panelIds.has(id) || judgeIds.has(id) || id.startsWith('adjudicate-');
  const unreadPanel = panelUnread({ preflight: runJson.reviewer_preflight, unread, panel: isPanelNode });
  if (degraded.length || unreadPanel.length) {
    runJson.stamps = [...new Set([...(runJson.stamps ?? []), 'PANEL-DEGRADED'])];
    writeJson(runJsonPath, runJson);
  }
  if (degraded.length) {
    buckets.not_checked.push({ node_id: 'external panel', why: degraded.length + ' reviewer call(s) failed after their '
      + 'combination passed at mint: ' + degraded.join(', ') + ' — the panel this run was promised did not all answer' });
  }
  if (unreadPanel.length) {
    buckets.not_checked.push({ node_id: 'external panel', why: unreadPanel.length + ' status file(s) could not be read, so '
      + 'no call they record can be shown to have answered: ' + unreadPanel.join(', ') });
  }
}
const gate = writeGate(null, null);
// Same disambiguation as the gate.md headline, for the same reason — this line and that one are
// where a reader meets the verdict with no table beside it. See writeGate's note on `completeness`.
console.log(`\n== gate: ${gate} ==`);
console.log(`        ${gateCompleteness(buckets.did_not_report.length)}` + (buckets.did_not_report.length
  ? ' — so this is a statement about the RUN, not about the code'
  : ' — so this is a verdict on the code, not a failure of the review'));
console.log(`stamps: ${(runJson.stamps ?? []).join(', ') || '(none)'}`);
console.log(`cost:   $${spentSoFar().toFixed(4)}`);

// STAGED OUTSIDE, RETURNED AFTER. The run was written outside the repository so nothing mutated
// the tree it was reviewing; now that it is finished and inert it goes back, so the committed
// evidence trail keeps growing and nothing has to be backed up separately. `archive_to` is null
// for a project that DECLARED reviews_dir: that run was written where it belongs already.
//
// AFTER the gate, deliberately. writeGate recomputes the tree hash for TREE-MOVED, and archiving
// first would have the run mutate the very tree it is about to measure.
//
// A BLOCKED or FAILED run is archived too -- it is evidence. Only a run KILLED mid-flight stays
// outside, which is the right place for it: --resume works on it there, and a half-written run is
// not an artifact worth committing.
// The sequence (the .gitignore that arrives with the bytes, git's answer on the evidence, the move) is
// io/reviews-root's archiveStagedRun, shared with remediate.mjs and archive-run.mjs.
// THE RUN'S TELEMETRY RECORD (telemetry-records.plan.md stage 3), written beside the gate before the run moves, so it is
// archived with it. One that cannot be built is a note, never a failed run.
{
  // THE RUN'S OWN END (G-5 of 20261027-071443-trt-delivery): the gate's work follows the last task, so the record's end is
  // this moment, written from run.json as it is on disk. A --resume records its own, later end.
  bestEffort(() => {
    const onDisk = JSON.parse(runRead(runJsonPath));
    runJson.graph_ended_at = onDisk.graph_ended_at = new Date().toISOString();
    writeJson(runJsonPath, onDisk);
  }, (why) => console.error(`run-graph: the run's end was not recorded (${why})`));
  const tel = writeRunRecord(runDir, { recordKind: 'review', repoRoot });
  if (!tel.ok) console.error(`run-graph: ${tel.note}`);
}
const finalDir = args.noArchive ? runDir
  : archiveStagedRun({ runDir, archiveTo: runJson.archive_to, repoRoot, log: (m) => console.error(`run-graph: ${m}`) });
if (finalDir !== runDir) {
  // latest.txt follows the run: a pointer left beside the staging area names a directory that is
  // no longer there, which is worse than no pointer at all.
  try {
    // Atomic, like every other write here (G-20 of 20260929-225147-m0-gate-review): a torn pointer names no run.
    writeTextAtomic(path.join(path.dirname(finalDir), 'latest.txt'), `${path.basename(finalDir)}
`);
  } catch (err) {
    // A convenience pointer must not fail a completed run, and a failed one is named (G-9 of
    // 20261024-072605-rrr-remediation-review): silent, the pointer named an older run with no word of why.
    console.error(`run-graph: latest.txt not updated, so it may still name an older run: ${err.message}`);
  }
}
console.log(`${isWithin(repoRoot, finalDir) ? path.relative(repoRoot, path.join(finalDir, 'gate.md')) : path.join(finalDir, 'gate.md')}`);
process.exit(gate === 'BLOCKED' ? 1 : 0);
