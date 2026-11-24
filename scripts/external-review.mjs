#!/usr/bin/env node
// external-review.mjs — run one EXTERNAL reviewer and print one verdict envelope.
//
// The panel's whole value is that this arm fails differently from the Claude lenses (see
// shared/external-reviewers.md). That only holds if a failure here is visible: a run where Codex
// silently died and one where Codex found nothing must not look the same, or the first reads as
// corroboration it never gave.
//
// So this script ALWAYS prints exactly one structured response on stdout — even when the reviewer
// is missing, times out, or returns junk. Review mode returns a verdict envelope; proposal mode
// returns a candidate batch. Both carry failures in not_checked[].
//
// BEFORE the call, the reviewer is checked (reviewer-preflight.plan.md, stage 2): this combination of
// adapter, model, effort, mode and schema route must have a passing probe record that still counts
// (scripts/lib/reviewer-probe.mjs), and when it has none this script probes it — re-running itself
// with --probe-run, in an empty temporary directory. A reviewer that fails its preflight is REFUSED:
// the mode's unavailable response, naming the reason, and exit 5. A missing or broken reviewer used to
// be a not_checked[] entry and an exit 0; the operator's decision is that what a review needs is
// tested first and a failure refuses (2026-10-08, "no fallback"). A reviewer that passed and then
// fails during the call is still reported in not_checked[] with exit 0, as before.
//
// Contract (shared/claude-md-contract.md):
//   node external-review.mjs --run-dir <abs> --node-id panel-<r> --reviewer <name>
//                            --prompt-file <p> [--mode review|propose]
//                            [--schema <inline json>] [--timeout-minutes N]
//                            [--model <name>] [--effort <level>]
//                            [--candidate-fields a,b,c] [--surface <dir the reviewer reads>]
//                            [--out <file>: its rules are OUT-1 … OUT-8, shared/claude-md-contract.md]
//
// The reviewer is given a REAL JSON Schema and returns its answer natively: codex writes it to
// --output-last-message, agy returns it in `structured_output`. --candidate-fields names the
// per-candidate fields for proposal mode, which strict-mode schemas cannot express generically;
// without it the run falls back to the prompt-and-scan path and says so in not_checked[].
//
// --model and --effort are NEVER defaulted here. A model name is only meaningful paired with a
// reviewer, so the pairing is declared in config (scripts/lens-roster.json panel_arms) and passed
// down. Unset means "take the reviewer CLI's ambient default", which is a real gap in
// reproducibility and is therefore named in not_checked[] rather than passed over in silence.
//
// --preflight-only runs the check (and the probe, when one is needed) and exits 0 or 5 without the call;
// it waives what a check before a run exists cannot have: --prompt-file, --schema, --node-id, --run-dir.
//
// Exit codes: 0 a structured response was printed, and the reviewer passed its preflight
//             2 usage error (nothing printed — the caller passed something impossible)
//             3 recursion guard tripped
//             5 the reviewer failed its preflight: the unavailable response was printed (and written
//               to --out), and the reviewer was never called

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { minutes, timerMs } from './lib/check-timeout.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
import { callEntry, retriedEntry } from './lib/call-entry.mjs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The arm's wall clock, set at the spawn site below and read by every envelope emitter
// above it. Declared HERE rather than beside the spawn: `let` has a temporal dead zone, and
// an envelope emitted on an early failure path -- before the child is ever launched --
// referenced it and threw ReferenceError, turning 'the reviewer was unavailable' into 'this
// script crashed'. null means the child never ran, which is a different fact from 0 ms.
let spawnDurationMs = null;
// The vendor call's entry (lib/call-entry.mjs), null until the vendor process has been started.
let reviewerCall = null;

import {
  INLINE_ARGV_BUDGET, fitsInlineArgv, reviewerArgv, reviewerEnv, NODE_ID_RE, capArmSeverity,
  windowsShellArgv, SEVERITY_RUNGS, vendorFailureReason, UNAVAILABLE_ROLES,
} from './lib/decisions.mjs';
// The basis ladder, for the one rung an external arm can stand on. Only the fallback lives here:
// inside the graph the ceiling arrives already derived from the roster's own ladder.
import { CONSERVATIVE_BASIS, validateAssignment, rosterFamilyErrors } from './lib/capabilities.mjs';
import { reviewSchema, proposeSchema, tieBreakSchema, claimCheckSchema, decideSchema, validateStrict } from './lib/reviewer-schemas.mjs';
import { resultShapeErrors } from './io/claim-check.mjs';
import { seatAnswerOf } from './lib/decision-panel.mjs';
import { quotaOf } from './lib/quota.mjs';
// The vendor table is DATA (scripts/reviewers.json). Every per-vendor branch this file used to carry
// — six of them — is a field on the adapter now, so a new CLI is an entry rather than an edit here.
import {
  selectAdapters, overrideLine, adapterErrors, needsShell, shellLaunchEnv, usageFrom, responseFrom, envPrefixesOf, envNamesOf,
  supportsMode, needsPrompt, declaredReviewers,
} from './io/reviewers.mjs';
// The one owner of "a write must not land on an existing artifact" — beside the durable write, in
// lib/atomic.mjs, because they are the two halves of not destroying a record.
import { freeEvidenceName } from './io/atomic.mjs';
import { confined } from './io/confined-path.mjs';
import { egressReadFile, egressRunReader } from './io/egress-read.mjs';
import { writeAllSync } from './io/write-all.mjs';
// The one owner of "is this path inside that one" — see its docstring for the root case (G-7).
import { isWithin, canonicalSpelling, belowRoot, isBelowRoot } from './io/finding-scope.mjs';
import { quorateHome, admitRun } from './io/reviews-root.mjs';
// THE REVIEWER PREFLIGHT (reviewer-preflight.plan.md): the key, the record, the lock and the CLI version.
import {
  probeKey, adapterHash, probeLimits, maxAgeHoursOf, recordCounts, probePassed, probeDispute, PROBE_REVIEW_SCHEMA,
  PROBE_PROPOSE_SCHEMA, PROBE_CANDIDATE_FIELDS, readProbeRecord, writeProbeRecord, withProbeLockAsync, cliVersion, writtenWhileWaiting, schemaRoute, frameworkProbeCodeHash,
  reviewerLaunchExclusions, launchRealpath, droppedNote,
} from './io/reviewer-probe.mjs';
import { spawnCapture } from './io/spawn-capture.mjs';
import { rawTable, reviewerPromptVia, reviewerPromptInput, ndjsonFailure, schemalessText, deniedEmptyAnswer, sumUsage, retryLimitMs } from './io/reviewers.mjs';
import { readTemplate, renderTemplate } from './io/template.mjs';
import { buildTieBreakPrompt } from './io/review-prompts.mjs';
import { adjudicationBrief, renderVoteVocabulary } from './lib/adjudication.mjs';
import { hostPlatform } from './platform/index.mjs';
import { stopRecord } from './lib/stop-vocabulary.mjs';
import { readContract } from './io/contract-reader.mjs';
import { gitSync } from './io/git.mjs';

// Fails CLOSED on a value it cannot read — see the matching note in run-checks.mjs. This script
// spawns third-party reviewers with the source in scope, so "proceeded as though at depth 0
// because the value was unparseable" is the least acceptable place for that behaviour.
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
      `refusing to guess whether this is nested (§8).`,
  );
  process.exit(3);
}
if (DEPTH > 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${DEPTH} — a graph node may not spawn panel arms (§8).`);
  process.exit(3);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

function die(msg) {
  console.error(`external-review: ${msg}`);
  process.exit(2);
}

// ------------------------------------------------------------------------------- EGRESS CONSENT
//
// THIS SCRIPT IS THE ONLY PLACE SOURCE OR CONVERSATION LEAVES THE MACHINE, and until now it never
// asked whether it was allowed to. `review.external_panel` was read by run-graph and new-run and by
// nothing else, so the opt-in governed the GRAPH path alone -- while /request's cross-family
// critique (default ON) and candidate-pool call this script directly. A project that had
// deliberately set external_panel: false still transmitted the operator's conversation to a
// vendor's cloud, and QUORATE.md told them the panel was "optional, OFF by default".
//
// shared/external-reviewers.md states the rule absolutely -- "The panel runs only when
// review.external_panel: true" -- and it was not true. Enforcing it here makes the document
// accurate rather than weakening the document to match the code (G-23, doc-consistency-review,
// basis: invariant).
//
// FAILS CLOSED. A contract that cannot be read is not consent: the refusal costs a review, and
// guessing costs an egress that cannot be undone.
//
// --consent is for the DELIBERATE probe, which exercises this transport and so cannot require it to be
// enabled first: this script's own probe child (runProbe) and check-reviewers, which replaced
// check-panel and check-tiebreak (reviewer-preflight stage 4; G-2 of 20261009-222911). It is recorded in
// the envelope, never silent.
// The ONLY sanctioned consent. `--consent` existed for one caller — check-panel, then — and
// the check was `if (args.consent)`, so ANY value opened the gate. A switch that any caller can set
// to any string is not a switch; it is a documented bypass of the project's egress opt-in, in the
// one script where anything leaves the machine (G-11).
const CONSENT_REASONS = new Set(['transport-probe']);

// The live contract, read ONCE through the one reader (ledger-findings.plan.md stage 4), which caches it per process.
const liveContract = () => readContract({ cwd: process.cwd() });

// THE PROBE'S CONSENT OPENS THE GATE FOR A PROBE ONLY (G-3 of 20261020-151402-argv-delivery): honoured in every mode, it
// let an ordinary review pass `--consent transport-probe` and send its prompt out under external_panel: false. A call
// given it is decided by the contract, as one without it is, and a refusal says the flag did not apply. A --probe-run
// call reaches this only with the probe's own input (probeRunCheck, G-2 of 20261020-172345-argv-remediation-review).
function egressConsent() {
  if (args.consent && !CONSENT_REASONS.has(args.consent)) {
    return {
      ok: false,
      why: `--consent ${JSON.stringify(args.consent)} is not a recognised basis ` +
        `(expected one of: ${[...CONSENT_REASONS].join(', ')})`,
    };
  }
  if (args.consent && (args.probeRun || args.preflightOnly)) {
    return { ok: true, why: `explicit --consent ${args.consent}`, viaConsent: true };
  }
  const c = contractConsent();
  return c.ok || !args.consent ? c
    : { ...c, why: `${c.why}; --consent ${args.consent} opens the gate only for a probe (--probe-run, --preflight-only), not a call` };
}

function contractConsent() {
  // THE RUN'S OWN FROZEN CONTRACT FIRST (G-11). A run pins `contract` into run.json at mint, and
  // every other consumer treats that copy as authoritative precisely so a mid-run edit cannot change
  // what the run was. Re-parsing the LIVE file made the egress decision the one thing in the system
  // that could flip while the run was in flight: enable the panel after the mint and arms start
  // transmitting under a consent the run never recorded, disable it and half the arms are refused
  // — with the artifacts describing a contract nobody can reconstruct.
  //
  // Falls through to the live parse when there is no run directory, which is the /request path:
  // there is no frozen copy to read, and the project's current contract is the only consent there is.
  // ONE FLAG USED TO MEAN TWO THINGS, and the egress decision was what it cost (G-8).
  //
  // `--run-dir` named both a minted graph run (whose run.json freezes the contract) and, for the
  // pre-run `/request` path, a plain directory to keep raw reviewer output in. Because the two were
  // indistinguishable here, a run directory whose run.json was unreadable, truncated, or missing its
  // `contract` key fell through to re-parsing the LIVE contract — so consent could change after the
  // mint on exactly the path where a frozen copy was supposed to make that impossible. capture.mjs
  // fails closed in the same situation; this did not.
  //
  // They are separate flags now: `--run-dir` asserts a canonical run and is held to it, and
  // `--evidence-dir` is the sink with no such claim. A caller that says "this is a run" and cannot
  // produce that run's contract is refused rather than quietly asked a different question.
  // THE ADMITTED RECORD, never a reread (G-9 of 20261023-040306-rdt-remediation-2-review): rereading run.json through the
  // caller's --run-dir after admission let a link retargeted in between substitute the consent this review sends source
  // out under. Admission runs before any call reaches here, and a run it did not admit has no consent.
  if (args.runDir) {
    // The admitted directory names the run (G-2 of 20261029-055946-rdd-remediation-review); the caller's spelling only when
    // nothing was admitted, and then only in the refusal.
    const dir = admittedRunDir ?? String(args.runDir);
    const frozen = admittedRecord;
    if (!frozen) {
      return {
        ok: false,
        why: `--run-dir ${path.basename(dir)} has no readable run.json, and a run whose frozen `
          + 'contract cannot be read is not consent — pass --evidence-dir instead if this is not a '
          + 'minted run (G-8)',
      };
    }
    if (!frozen?.contract) {
      return {
        ok: false,
        why: `--run-dir ${path.basename(dir)}/run.json records no contract, so there is no frozen `
          + 'consent to send anything out (G-8)',
      };
    }
    return frozen.contract.review?.external_panel === true
      ? { ok: true, why: `review.external_panel: true (frozen in ${path.basename(dir)}/run.json)` }
      : { ok: false, why: 'review.external_panel is not true in the contract this run froze at mint' };
  }
  const r = liveContract();
  if (r.absent) return { ok: false, why: 'no readable graph_contract here, so no recorded consent to send anything out' };
  if (r.error) return { ok: false, why: 'the contract could not be read, and an unreadable contract is not consent' };
  return r.contract?.review?.external_panel === true
    ? { ok: true, why: 'review.external_panel: true' }
    : { ok: false, why: 'review.external_panel is not true in this project contract' };
}

/**
 * Adapters this project DECLARES, on top of the built-in table.
 *
 * lib/reviewers.mjs has promised this since it was written — "a CONSUMER may extend the table
 * without touching the engine: `reviewers:` in the graph_contract" — and nothing read the key. The
 * capability was real, exported as `mergeReviewers`, tested, and reachable by no caller. So the one
 * question the adapter table exists to answer, *can I use a different vendor*, still ended at "fork
 * quorate and edit scripts/reviewers.json" — which CLAUDE.md separately forbids, because edits to a
 * mounted submodule exist in no branch and are discarded the next time the pointer moves.
 *
 * FROM THE RUN'S FROZEN CONTRACT when there is a run, for the same reason consent is (G-8/G-11): how
 * a vendor is invoked is part of what a run WAS. Re-reading the live file would let an edit change
 * a reviewer's argv, model or credential prefixes mid-run, with the artifacts describing a contract
 * nobody can reconstruct. Without a run directory — the /request path — the live contract is the
 * only one there is.
 */

// 'tie-break' is its own mode because it answers a different QUESTION, not a smaller version
// of the review question: which of two contradicting positions the evidence supports. Squeezed into
// the review envelope it came back as `verdict PASS, findings: 0` every time — a ruling with no
// field to put the ruling in.
// `claim-check` (claim-check-cross-family.plan.md stage 2): a report's claims, checked by the other family, answered in
// the result shape scripts/claim-check.mjs applies its rules to.
// `decide` (autonomous-run.plan.md stage 4): one seat of the decision panel, answering a question with options by an
// entry, an "Other" or a change, with its reason (lib/decision-panel.mjs owns what each may be).
const MODES = ['review', 'propose', 'tie-break', 'claim-check', 'decide'];

const args = {};
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md): a missing
  // value and an unknown flag are refused, naming the flag.
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['external-review'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  const take = {
    'run-dir': 'runDir',
    // The evidence sink for a caller with no minted run — the /request path. Same directory
    // handling, same containment checks, but it makes no claim about a frozen contract, so
    // consent comes from the live tree (which is the only consent that exists before a mint).
    'evidence-dir': 'evidenceDir',
    surface: 'surface', 'node-id': 'nodeId', reviewer: 'reviewer', mode: 'mode', model: 'model', effort: 'effort',
    'candidate-fields': 'candidateFields', 'prompt-file': 'promptFile', schema: 'schema', 'timeout-minutes': 'timeoutMinutes',
    consent: 'consent', 'severity-ceiling': 'severityCeiling', 'verdict-ceiling': 'verdictCeiling',
    // The bases this arm's runtime may claim, derived by capsFor/allowedBasisFor from what the
    // adapter declares and tightened by the roster. It arrives as an argument because the
    // derivation belongs to the graph, which holds the contract; this script must not re-derive it
    // and reach a second answer.
    'allowed-basis': 'allowedBasis',
    // A FILE OF ITS OWN, CREATED EXCLUSIVELY (story-pipeline, 2026-10-08): two runs redirected to one file interleaved
    // undetected. The file is reserved before the vendor is called, so a second writer is refused before it spends.
    out: 'out',
    // THE REVIEWER PREFLIGHT (reviewer-preflight stage 2). --preflight-only runs the check — and the probe, when the
    // combination has no record that counts — and exits 0 or 5 without the call; new-run uses it at mint.
    'preflight-only': 'preflightOnly',
    // Probe even when a record still counts (check-reviewers --force): an operator who suspects the vendor changed
    // under an unchanged version asks for a fresh answer. One written by another process while this one waited for
    // the lock is still used — it is fresh.
    reprobe: 'reprobe',
    // INTERNAL: this process IS a probe, started by another external-review, so it must not probe itself; and its
    // limit is the probe's own, fractional and not floored at a minute like --timeout-minutes. Any caller can type it, so
    // its input is held to the probe's own (probeRunCheck).
    'probe-run': 'probeRun',
    // TEST-ONLY SEAMS (stage 3), like remediate.mjs's --test-fail-reset: a real check cannot overrun the bound new-run
    // gives it, since every term is enforced in here from the same configuration, nor crash on request. With
    // --preflight-only, after a check that passed: sleep this long before exiting, or throw.
    'test-crash': 'testCrash',
  };
  for (const [flag, key] of Object.entries(take)) if (v[flag] !== undefined) args[key] = v[flag];
  // THE POSITIONS THIS DISPUTE HAS, so the vendor-facing schema can carry the vote enum from
  // the one owner. Without it `supports` was a free string here while the merge and the brief
  // both derived their list from voteVocabulary — three owners of one category list, which is
  // the shape that declaration exists to remove (contract-audit, I-8).
  if (v.participants !== undefined) args.participants = v.participants.split(',').map((x) => x.trim()).filter(Boolean);
  if (v['probe-timeout-ms'] !== undefined) args.probeTimeoutMs = Number(v['probe-timeout-ms']);
  if (v['test-stall-ms'] !== undefined) args.testStallMs = Number(v['test-stall-ms']);
}
// BUILT AFTER THE ARGUMENTS ARE PARSED, because declaredReviewers() reads --run-dir to find the
// run whose contract froze the table. It sat above the parser for one commit and would have thrown
// a ReferenceError on every invocation — `const args` is in its temporal dead zone up there, which
// check-syntax cannot see because the file parses perfectly.
//
// ADMITTED FIRST (run-dir-descendants.plan.md stage 3; G-9 of 20261024-122231-rdt-remediation-3-review): the table was
// read from run.json through the caller's --run-dir spelling, before admission, and it decides which CLI runs and where
// its credentials go. The run is admitted here, against every worktree root git reports (the arms stand in a linked one,
// G-43), and the reviewers come from the record admission returned; nothing after reads the caller's spelling.
function gitWorktreeRoots() {
  const top = gitSync(['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0) return null;
  const roots = [path.resolve(top.stdout.trim())];
  const wt = gitSync(['worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  if (wt.status === 0) {
    for (const line of (wt.stdout ?? '').split(String.fromCharCode(10))) {
      if (!line.startsWith('worktree ')) continue;
      const root = path.resolve(line.slice('worktree '.length).trim());
      if (root && !roots.includes(root)) roots.push(root);
    }
  }
  return roots;
}
const earlyAdmission = (() => {
  if (!args.runDir || args.evidenceDir) return null;
  const roots = gitWorktreeRoots();
  if (!roots) die('not inside a git repository, so there is no tree to confine --run-dir to (G-9)');
  const tries = roots.map((r) => admitRun({ runDir: path.resolve(args.runDir), repoRoot: r }));
  return tries.find((t) => t.ok) ?? tries[0] ?? null;
})();
if (earlyAdmission && !earlyAdmission.ok) die(`--run-dir ${earlyAdmission.why}`);
const DECLARED_REVIEWERS = args.runDir ? (earlyAdmission?.ok ? (earlyAdmission.record?.contract?.reviewers ?? {}) : {})
  // A live contract that cannot be read is this tool's failure, said as every other early one is (G-6 of
  // 20261122-044843-m3s7-b3-remediation-review), as check-reviewers already does, never an unstructured throw.
  : (() => { try { return declaredReviewers({ runDir: null, live: true }); } catch (e) { die(`the live contract's reviewers: ${e.message}`); } })();
// The one owner (contract-runtime-and-session-files.plan.md stage 1); this tool uses the table and the overrides only.
const ADAPTERS = selectAdapters({ declared: DECLARED_REVIEWERS });
const REVIEWER_TABLE = ADAPTERS.table;
const REVIEWERS = Object.keys(REVIEWER_TABLE);

if (!args.reviewer) die('--reviewer is required');
if (!REVIEWERS.includes(args.reviewer)) {
  die(`--reviewer must be one of ${REVIEWERS.join('|')}`
    + ' (built-in adapters plus any this project declares under `reviewers:` in its graph_contract)');
}
// THE ADAPTER, resolved once. Every per-vendor decision below reads a field on it rather than
// testing a name, so adding a CLI is an entry in scripts/reviewers.json — not six edits in here.
// Validated before use: an adapter that cannot say where its answer comes from would let a
// transport status be read as a reviewer's verdict.
const ADAPTER = REVIEWER_TABLE[args.reviewer];
// AN OVERRIDE OF THE BUILT-IN THIS CALL USES IS NAMED HERE, the one egress (reviewer-credential-routing,
// A-26): the contract decided where this vendor's credentials go, and the caller is told on stderr and in
// every response record. Not on --preflight-only, whose caller (new-run) names it itself and freezes the
// record's documented shape, nor on the internal probe run.
const OVERRIDE = ADAPTERS.overrides.find((o) => o.name === args.reviewer) ?? null;
const withOverride = (rec) => (OVERRIDE ? { ...rec, reviewer_override: OVERRIDE } : rec);
if (OVERRIDE && !args.preflightOnly && !args.probeRun) process.stderr.write(`external-review: ${overrideLine(OVERRIDE)}
`);
{
  const errs = adapterErrors(args.reviewer, ADAPTER);
  if (errs.length) die(`reviewer '${args.reviewer}' is not usable: ${errs.join('; ')}`);
}
// THE ROSTER'S FAMILY RULE, ON EVERY CALLER (G-2 of 20261026-174311-rct-remediation-review): new-run refused a role whose
// declared family contradicts its adapter's, and claim-check and candidate-pool, which call their roles through here,
// did not. Checked against this call's merged table, before any spawn.
{
  const roster = JSON.parse(fs.readFileSync(path.join(HERE, 'lens-roster.json'), 'utf8'));
  const errs = rosterFamilyErrors(roster, (n) => REVIEWER_TABLE[n]);
  if (errs.length) die(`lens-roster.json is refused: ${errs.join('; ')}`);
}
args.mode ??= 'review';
if (!MODES.includes(args.mode)) die(`--mode must be one of ${MODES.join('|')}`);

// THE BASIS THIS ARM EMITS, checked against what its runtime is permitted to claim (G-15) — AND
// CHECKED HERE, BEFORE THE VENDOR IS SPAWNED (G-13, arch-review).
//
// `convention` was a literal on every finding while run-graph derived an `allowed_basis` enum and
// wrote it into nodes/expected.json, so the artifact described a permission that governed nothing.
// It is still `convention` for every adapter that ships, and still the only basis THIS script can
// substantiate: the evidence path it emits is the reviewer's raw log, which the run cannot
// re-derive.
//
// The first version of this check sat 260 lines further down, AFTER the vendor had been spawned and
// its usage harvested — so had it ever fired it would have discarded a completed, paid review, and
// run-graph would have recorded "produced no parseable envelope" with no usage: a caller-argument
// error reported as a broken transport. Its own comment claimed it "refuses at spawn". This module's
// contract says exit 2 means a usage error with nothing printed, and that is only true of a check
// that runs before anything is spent.
const ARM_BASIS = 'convention';
const ALLOWED_BASIS = String(args.allowedBasis ?? '').split(',').map((b) => b.trim()).filter(Boolean);
if (ALLOWED_BASIS.length && !ALLOWED_BASIS.includes(ARM_BASIS)) {
  die(`the '${args.reviewer}' runtime is not permitted to claim basis=${ARM_BASIS} `
    + `(allowed: ${ALLOWED_BASIS.join(', ')}), and it is the only basis an external arm can `
    + 'substantiate: its evidence path is a raw vendor log this run cannot re-derive.');
}
// RISK, not FAIL: every finding here is basis=convention with an evidence path this run cannot verify,
// and writeGate promotes any FAIL to a FAIL gate — the cheap-reviewer cascade arriving through the
// panel instead of through a cheap model.
// NO CALLER MOVES IT (G-13 of 20261111-011856-dps-remediation-9-review): FAIL lifted this cap, and PASS turned a non-PASS
// answer into a PASS. A --verdict-ceiling other than RISK is not applied, and the envelope says so, on a failed call too
// (G-2 of 20261111-015717-dps-remediation-10-review), so it is decided here, before any early exit. The value is the
// rung's, as the severity cap's is (G-4 of the same review).
const VERDICT_CEILING = CONSERVATIVE_BASIS[ARM_BASIS].verdict_ceiling;
const declaredVerdictCeiling = String(args.verdictCeiling ?? '').trim().toUpperCase();
const verdictCeilingNotes = declaredVerdictCeiling && declaredVerdictCeiling !== VERDICT_CEILING
  ? [{ item: `${args.reviewer} verdict ceiling`, reason: `--verdict-ceiling ${declaredVerdictCeiling} was not applied: an external arm's verdict is capped at ${VERDICT_CEILING}` }]
  : [];
// FROM THE ADAPTER, not from its name. This was `args.reviewer === 'codex-review'` — a vendor name
// deciding behaviour in the file the adapter table exists to keep free of them.
if (!supportsMode(ADAPTER, args.mode)) {
  die(`--reviewer ${args.reviewer} supports only: ${(ADAPTER.modes ?? MODES).join(', ')}`);
}
// --preflight-only waives what a check at mint cannot have: the prompt and the caller's schema (the probe brings its own).
if (args.mode === 'propose' && !args.schema && !args.preflightOnly) die('--schema is required for --mode propose');
if (needsPrompt(ADAPTER) && !args.promptFile && !args.preflightOnly) {
  die(`--prompt-file is required for '${args.reviewer}'`);
}

let outFd = null;   // reserved below, once the evidence rules have confined --out
// A reservation nothing was written to is removed at exit, so a failed launch does not block its own rerun.
if (args.out) {
  process.on('exit', () => {
    if (outFd === null) return;
    try { fs.closeSync(outFd); fs.rmSync(path.resolve(args.out), { force: true }); } catch { /* best effort */ }
  });
}
// Every emitter writes through here: stdout, as always, and the --out file when one was reserved.
//
// EVERY BYTE, BEFORE THE EXIT (G-4 of 20261112-050334-hl-review-b): every emitter calls process.exit right after this, and
// process.stdout.write on a pipe is asynchronous on POSIX, so the envelope could be cut short; the one writeSync to --out
// ignored its byte count. Both are written synchronously, every byte (io/write-all.mjs). A reader that has gone (EPIPE) is
// not a reason to lose --out, so that one error on stdout is passed over.
function writeStdout(text) {
  try { writeAllSync(1, text, { retry: ['EAGAIN'] }); } catch (e) { if (e?.code !== 'EPIPE') throw e; }
}
function writeResponse(text) {
  writeStdout(text);
  if (outFd !== null) { writeAllSync(outFd, text); fs.closeSync(outFd); outFd = null; }
}

// Validated HERE, not merely where it is written. It becomes a directory name and two file names
// below; a traversal value would escape evidence/ and overwrite artifacts elsewhere in the run.
if (args.nodeId !== undefined && !NODE_ID_RE.test(args.nodeId)) {
  die(`--node-id must match ${NODE_ID_RE}, got ${JSON.stringify(args.nodeId)}`);
}
const nodeId = args.nodeId ?? `panel-${args.reviewer}`;
// The node default when absent, read from the owner of minutes values, not a literal: a direct caller (candidate-pool)
// inheriting a SHORTER fallback than the graph meant the same reviewer on the same prompt could time out from a skill and
// succeed from a run, which makes a timeout look like a property of the reviewer rather than of the caller. The literal
// here was 15 while spawn-subagent's was 30 (code-index-d1-part-a.plan.md stage 2).
let timeoutMs;
try {
  timeoutMs = args.probeRun && args.probeTimeoutMs > 0
    ? args.probeTimeoutMs
    : timerMs(minutes('flag --timeout-minutes', args.timeoutMinutes, minutes('review.node_timeout_minutes', undefined)));
} catch (e) { die(e.message); }
// 0 for a completed call; 5 when the reviewer preflight refused it (reviewer-preflight stage 2). Every emit exits with it.
let exitCode = 0;
let launched = false;
// Whether a reviewer process actually started: `launched` is set before the spawn, which can fail (G-8 of
// 20261111-011856-dps-remediation-9-review).
let reviewerStarted = false;
let schemaDir = '';
let usingTempDir = false;
// Set by cleanupTempSchema when the temporary schema folder could not be removed; declared here, before any emitter can run.
let tempCleanupGap = null;
const model = String(args.model ?? '').trim();
const effort = String(args.effort ?? '').trim();
// CONFINED TO THE REPOSITORY THIS PROCESS IS RUNNING IN (G-9), the same rule and the same two steps
// capture.mjs applies to its own --run-dir. Everything this script writes lands under
// `<run-dir>/evidence/<node-id>/`, and the run.json it reads for the egress decision lives there
// too — so an unconfined path both writes outside the tree and lets a counterfeit contract decide
// whether source may leave the machine. Graph callers pass minted paths today; the boundary should
// not depend on which caller happens to be on the other end.
//
// A caller with no run directory at all is unaffected: /request's critique passes none, and there is
// nothing to confine.
if (args.runDir && args.evidenceDir) {
  die('--run-dir and --evidence-dir are alternatives: the first asserts a minted run whose contract '
    + 'is frozen, the second asserts only a place to write. Passing both leaves it ambiguous which '
    + 'contract this review consented under.');
}
// `outDir` is where evidence goes, from either flag; `runDir` is the narrower claim, and only it
// may be treated as a run whose consent was frozen at mint.
// The admitted directory (stage 3, 4): every check and message below takes it, never the caller's spelling. With
// --run-dir alone, admission above either admitted the run or refused; with --evidence-dir too, the line above refused.
const runDir = args.runDir ? earlyAdmission.dir : null;
// Spelled as the filesystem spells it, as the home it is held to is (canonicalSpelling, CI run 43281517496).
const outDir = runDir ?? (args.evidenceDir ? canonicalSpelling(path.resolve(args.evidenceDir)) : null);
// The record admitRun returned for --run-dir, the only one read after admission (G-19 of 20261023-014400-rdt-delivery).
let admittedRecord = null;
// The directory admitRun returned for --run-dir; every use after admission takes it, never the caller's spelling.
let admittedRunDir = null;
// outDir resolved through links once it is confined; the root every evidence write is built from.
let evidenceRoot = outDir;
// CONFINES BOTH FLAGS. The check is about where bytes are WRITTEN, so it belongs to whichever flag
// named the directory — an evidence sink escapes the tree exactly as easily as a run directory.
const outFlag = args.runDir ? '--run-dir' : '--evidence-dir';
if (outDir) {
  // The roots come from gitWorktreeRoots, their one owner (I-3; G-17 of 20261122-035227-m3s7-b3-review): this block
  // once asked git and parsed its answer a second time, so admission and confinement could disagree.
  const roots = gitWorktreeRoots();
  if (!roots) {
    die(`not inside a git repository, so there is no tree to confine ${outFlag} to (G-9)`);
  }
  // isWithin, from the one owner (G-7, arch-review + panel-codex-code). finding-scope.mjs calls
  // itself "the one place this comparison is spelled" and records that the composed-prefix form
  // BREAKS AT A FILESYSTEM ROOT — path.resolve already returns a trailing separator for `F:\` or
  // `/`, so the doubled form starts nothing and the check passes everything. These are the two
  // places that decide where a run's bytes land and what a third-party reviewer may be pointed at,
  // which makes them the last two that should carry a private copy.
  const inside = isWithin;

  // BOTH ROOTS, BECAUSE A LINKED WORKTREE IS THE SAME REPOSITORY.
  //
  // `--show-toplevel` answers "which tree am I standing in", and since the panel arms were moved
  // into a detached worktree (G-43) that is no longer the tree the RUN DIRECTORY lives in. Every
  // arm died here in 105 ms, exit 2, before any vendor call: the run directory sits in the main
  // checkout, the arm stands in `<quorateHome>/arms/<repo key>/<run-id>/<random>`, and one is not a prefix of the other.
  // Six DEGRADED arms, and the cross-family half of the review simply absent.
  //
  // `--git-common-dir` is the seam: in a linked worktree it resolves to the MAIN repository's
  // `.git`, so its parent is the main checkout. Both are obtained from git in this process, which
  // is the property G-9 is actually about — the authority for "which repository is this" must not
  // come from the file under test. Accepting a second root git itself reports does not weaken that;
  // accepting one the run.json named would have.
  // (The roots above are gitWorktreeRoots': the toplevel first, then every root `git worktree list` reports.)
  // ASK GIT FOR A WORKTREE ROOT, NOT FOR A GIT DIRECTORY (G-8, security-audit).
  //
  // The first version of this took `dirname(--git-common-dir)`, which equals a worktree root only
  // when the git directory is literally `<root>/.git`. It is not, in the deployment this project is
  // BUILT FOR: mounted as a submodule, `.git` is a gitfile resolving to
  // `<super>/.git/modules/<path>`, so the parent is `<super>/.git/modules` — not a repository at
  // all, and it would have been accepted as "inside this repository" for both --run-dir and
  // --evidence-dir, which is where every artifact this script writes lands. A --separate-git-dir
  // checkout breaks it the same way.
  //
  // `git worktree list --porcelain` reports worktree ROOTS, and its first entry is the main one —
  // the same answer from inside a linked worktree or from the main checkout. Still git speaking, in
  // this process, which is the property G-9 is about; what changed is that it is now asked the
  // question whose answer this code actually needs, instead of one whose answer resembles it.

  // ONE ROOT DECIDES BOTH CHECKS (G-45, contract-audit). The first version tested the lexical
  // containment against ANY root and the link containment against ANY root, independently — so a
  // path could pass the first because root A contains its spelling and the second because root B
  // contains its realpath, and neither root ever had to contain both. The comment claimed "the link
  // check applies to whichever root contained it", which is the right rule and was not the code.
  //
  // The root that lexically contains the path is the one that must still contain it after the links
  // are resolved. A path contained by no root at all is refused before either question is asked.
  // AND THE ENGINE'S OWN HOME IS A ROOT, since graph_contract 2 stages runs there.
  //
  // This is G-43 recurring for a new reason, and the shape is identical: all six arms died here
  // in milliseconds, exit 2, before any vendor call -- 'the cross-family half of the review simply
  // absent', as the comment above already says about the worktree case. Then the run directory had
  // moved into a linked worktree; now it has moved out of the repository entirely, so neither git
  // root contains it. The fix is the same in kind: add the root that legitimately holds it.
  //
  // NOT a widening to 'anywhere'. The property G-9 is about survives -- the authority for which
  // directories are acceptable comes from git and from this engine's own configuration, never from
  // the run.json under test. A directory carrying its own run.json is still not authority for where
  // it may be.
  // TWO LISTS, BECAUSE TWO DIFFERENT QUESTIONS ARE ASKED OF THEM.
  //
  // `gitRoots` answers 'could git ever commit this?' -- the ignore check below needs exactly that
  // and nothing else. `roots` answers 'may this directory be written to at all?', which since
  // graph_contract 2 also admits the engine's own home.
  //
  // Collapsing them was a defect I introduced fixing the one above it: appending home to `roots`
  // made the evidence directory count as 'inside a root', so the ignore check ran against a path
  // git cannot see, failed, and every arm died at the next gate instead of this one.
  const gitRoots = [...roots];
  // Where a path sits below one of git's roots, lexically or through the root's own links (belowRoot), and that path
  // spelled from the root git reports, so check-ignore is asked about the place the bytes land (G-3, G-4).
  const gitPlaced = (r, p) => belowRoot(r, p);
  const gitSpelling = (p) => {
    for (const r of gitRoots) { const at = gitPlaced(r, p); if (at) return path.join(at.root, ...at.segs); }
    return p;
  };
  const home = quorateHome();
  if (!roots.includes(home)) roots.push(home);
  // OR BELOW IT THROUGH THE ROOT'S OWN LINKS (belowRoot; ci-path-identity.plan.md stage 1c): the home is on its real path
  // since roots are resolved where they are read, so an --evidence-dir spelled through macOS's /var was "outside" it. The
  // real-path check below still decides whether a link under the root leaves it.
  const lexicalRoot = roots.find((r) => isBelowRoot(r, outDir));   // one predicate (G-9 of 20261118-112631-cpi-review)
  if (!lexicalRoot) {
    die(`${outFlag} ${outDir} is outside this repository and outside the engine's home `
      + `(${roots.join(', ')}); a directory carrying its own run.json is not authority for where `
      + 'it may be (G-9)');
  }
  let realRun;
  let realRoot;
  try {
    realRun = fs.realpathSync.native(outDir);   // native: the JS one keeps an 8.3 short target (CI run 43281517496)
    realRoot = fs.realpathSync.native(lexicalRoot);
  } catch {
    die(`${outFlag} ${outDir} could not be resolved through links; an unresolvable path is not `
      + 'evidence of containment (G-9)');
  }
  if (!inside(realRoot, realRun)) {
    die(`${outFlag} ${outDir} leaves the repository through a link (G-9)`);
  }
  // WRITTEN THROUGH WHAT WAS CHECKED (G-10 of 20261023-040306-rdt-remediation-2-review): every evidence write rebuilt
  // its path from the caller's spelling, so a link retargeted after this check redirected the raw vendor response.
  evidenceRoot = realRun;
  // And every level below it walked by the one owner (run-dir-descendants.plan.md stage 2; G-10, G-11 of
  // 20261024-122231-rdt-remediation-3-review): evidence/<node> was made recursively, so a link planted below the root
  // still carried the raw vendor response wherever it led.

  // AND IT MUST BE SOMEWHERE GIT WILL NOT KEEP (G-9, security-audit). "Inside the repository" was
  // the whole test, and that is exactly the set of places git remembers forever: the only rule
  // covering evidence is `.claude/reviews/*/evidence/`, while skills/request/SKILL.md tells a caller
  // to pass `--evidence-dir <abs>` without naming one — so the natural choices (the repo root, a
  // scratch folder, docs/) are all tracked surface.
  //
  // What lands there is the raw vendor response. This project has already refused to commit exactly
  // this class once: run-checks dropped `stderr_tail` from the tracked checks.json because command
  // output may hold "a connection string, an environment dump, a token inside an error", and §3's
  // acceptance of environment inheritance rests on evidence being gitignored. /request's
  // cross-family critique is default-ON, so this is the routine path and not an edge case.
  //
  // git answers this itself — `check-ignore` is the same authority that decides what a commit
  // would capture — so there is no second list to keep in step with .gitignore.
  // The directory bytes actually LAND in, which is `<outDir>/evidence/<node-id>` for both flags —
  // not outDir itself. A run directory is tracked and its evidence/ subtree is not, so checking the
  // parent would refuse every legitimate run.
  const writeDir = path.join(outDir, 'evidence', nodeId);
  // OUTSIDE EVERY GIT ROOT SATISFIES THIS BY CONSTRUCTION, and the test for it had to learn that.
  //
  // The requirement is that a raw vendor response is never committed. `check-ignore` is the right
  // authority for a path git knows about — but it cannot answer for one outside the repository, so
  // it exits non-zero there and this read that as 'tracked'. Since graph_contract 2 a run is STAGED
  // outside the tree, which is where every arm then died: exit 2, before any vendor call, all six.
  //
  // A directory git cannot see cannot be committed at all, which is a STRONGER guarantee than a
  // gitignore rule -- a rule can be edited, and this cannot. Same shape as the evidence guarantee
  // in the consumer fixture: by construction when the run is out of tree, by rule when it is in.
  // THROUGH THE ROOT'S OWN LINKS TOO (G-3 of 20261118-112631-cpi-review): admission above takes a path below a root by
  // belowRoot, so a lexical-only test here skipped check-ignore for an --evidence-dir spelled through a link above the
  // repository, and a raw vendor response could land on tracked surface. git is asked about the path placed below its
  // root (gitPlaced), which is the spelling git's own toplevel uses.
  // ASKED ABOUT WHERE THE BYTES LAND (G-1 of 20261118-131040-cpi-remediation-review): they are written through
  // evidenceRoot, the sink's real path, so a link at an ignored .claude/reviews/<id> leading to tracked surface passed
  // a check made on the caller's spelling. git is asked about the real path, below whichever git root holds it.
  const realWriteDir = path.join(evidenceRoot, 'evidence', nodeId);
  const insideGit = gitRoots.some((r) => gitPlaced(r, realWriteDir) !== null);
  if (insideGit) {
    const ignored = gitSync(['check-ignore', '-q', gitSpelling(realWriteDir)], { cwd: realRoot });
    if (ignored.status !== 0) {
      die(`${outFlag} ${outDir} would write ${writeDir}, which is inside git's tracked surface. What `
        + 'lands there is a raw vendor response — the class this project already refused to commit '
        + 'once. Point it at a gitignored directory; a run evidence/ tree is one.');
    }
  }

  // A RUN DIRECTORY IS ADMITTED BY THE ONE OWNER (ARCHITECTURE A-28; run-dir-trust.plan.md stage 2): its run.json freezes
  // the consent this review sends source out under, so it must be one of this repository's runs, naming it. The
  // repository is any worktree root git reports here — the arms stand in a linked worktree of it (G-43) — never the
  // run.json's own repo_root. --evidence-dir is a sink with no run.json, and keeps only the rules above.
  if (runDir) {
    // The admission made before the reviewer table was built, not a second one (stage 3, G-9).
    const tries = earlyAdmission?.ok ? [earlyAdmission] : gitRoots.map((r) => admitRun({ runDir, repoRoot: r }));
    const ok = tries.find((t) => t.ok);
    if (!ok) die(`--run-dir ${tries[0]?.why ?? `${runDir} could not be admitted`}`);
    admittedRecord = ok.record;
    // THE ADMITTED DIRECTORY REPLACES THE SPELLING (stage 3, D-D4 A): the evidence root, and what the probe child is given.
    admittedRunDir = ok.dir;
    evidenceRoot = ok.dir;
  }

  // --out IS HELD TO THE SAME RULES (G-3 of 20261008-175234-cpool-and-design-step): it holds the same raw vendor
  // response, so it must lie inside the evidence sink, stay there through links, and be somewhere git will not keep.
  if (args.out) {
    const outPath = canonicalSpelling(path.resolve(args.out));   // spelled as outDir is (8.3, CI run 43281517496)
    // Or below it through the sink's own links (belowRoot; ci-path-identity.plan.md stage 1c): an admitted --run-dir is on
    // its real path, and an --out spelled through macOS's /var was refused as outside it. The names below the sink are
    // kept as given, so the walk below still meets any link at them.
    const below = belowRoot(outDir, outPath);   // the one owner of placement, lexical case included (G-9)
    if (!below || !below.segs.length) {
      die(`--out ${args.out} must be inside ${outFlag} ${outDir}: it holds a raw vendor response, and that `
        + 'directory is where the evidence rules apply (OUT-2)');
    }
    // THE PARENT MUST ALREADY EXIST (G-1 of 20261008-181148-cpool-r2, cross-family): creating it first let a pre-planted
    // link leave stray directories outside the sink before the containment check ran. Nothing is created to check it.
    // THROUGH THE SINK'S OWNER (run-dir-reads.plan.md stage 4, R-D3 A): the folder was contained by real path, which
    // admitted a link that resolved back inside the sink. Each level below the sink is walked, and a link at any of them
    // refused, whatever it leads to.
    const parentSegs = below.segs.slice(0, -1);
    let linkRefused = null;
    if (parentSegs.length) {
      let st = null;
      // ROOTED AT THE SINK AS NAMED, NEVER ITS REAL PATH (G-8 of 20261103-005954-rbr-remediation-7-review): realRun was
      // resolved through links before `confined` could see one at the sink's own path.
      try { st = confined(outDir).stat(parentSegs); } catch (e) {
        if (e.code === 'ENOENT') die(`--out ${args.out}: its folder does not exist; create it inside ${outFlag} first (OUT-3)`);
        linkRefused = e.message;
      }
      if (st && !st.isDirectory()) die(`--out ${args.out}: its folder does not exist; create it inside ${outFlag} first (OUT-3)`);
    } else {
      // DIRECTLY UNDER THE SINK, THE SINK'S OWN PATH IS STILL CHECKED (G-5 of 20261103-022403-rbr-remediation-8-review):
      // with no folder below it the walk above was skipped, and a link at the sink was followed by the open below.
      try { confined(outDir).resolve([path.basename(outPath)]); } catch (e) {
        if (e.code !== 'ENOENT') linkRefused = e.message;
      }
    }
    // OFF THE ADAPTER'S OWN TREE (OUT-8; external-review-out D2): <sink>/evidence/ is where this script writes its schema
    // (a fixed name, truncated), raw log and envelope, so an --out there could be overwritten, or occupy the tree's name.
    // Decided on the sink's native real path — realpathSync keeps the case it was given on Windows, .native returns
    // the folder's own — and compared case-folded on every filesystem: over-refusing a distinct `Evidence` costs nothing,
    // and a case-insensitive mount can sit under any OS. <sink>/evidence need not exist; the comparison is on the path.
    // A LINK IS REFUSED BEFORE ANYTHING BELOW THE SINK IS RESOLVED (G-6 of 20261029-212858-rdr-remediation-2-review): the
    // parent's real path followed the link only to choose between OUT-8 and OUT-4, outside the owner (A-30). With no link
    // at any level, the parent's real path is the sink's own joined with the levels `confined` walked.
    if (linkRefused) die(`--out ${args.out} has a link or junction below ${outFlag}, refused whatever it leads to (OUT-4): ${linkRefused}`);
    const fold = (p) => p.toLowerCase();
    const realSink = fs.realpathSync.native(outDir);
    const evidenceTree = fold(path.join(realSink, 'evidence'));
    const target = fold(path.join(realSink, ...parentSegs, path.basename(outPath)));
    if (target === evidenceTree || target.startsWith(evidenceTree + path.sep)) {
      die(`--out ${args.out} lies in ${outFlag}'s evidence/ tree, where the adapter writes its own files (OUT-8)`);
    }
    if (gitRoots.some((r) => gitPlaced(r, outPath) !== null)) {   // through the root's links too (G-4, as G-3 above)
      const ignored = gitSync(['check-ignore', '-q', gitSpelling(outPath)], { cwd: realRoot });
      if (ignored.status !== 0) die(`--out ${args.out} is inside git's tracked surface; point it at a gitignored path (OUT-5)`);
    }
  }
}
if (args.out && !outDir) {
  die('--out needs --evidence-dir or --run-dir: the response is a raw vendor reply, and it may land only where the '
    + 'evidence rules confine it (OUT-1)');
}
// A FILE OF ITS OWN, CREATED EXCLUSIVELY (story-pipeline, 2026-10-08): two runs redirected to one file interleaved
// undetected. Reserved here, after the checks and before the vendor is called, so a second writer is refused before it
// spends.
if (args.out) {
  try { outFd = fs.openSync(path.resolve(args.out), 'wx'); } catch (e) {
    die(e.code === 'EEXIST'
      ? `--out ${args.out} already exists; refusing to write over another run's response (one file per launch) (OUT-6)`
      : `--out ${args.out} could not be created: ${e.message} (OUT-6)`);
  }
}

// From the admitted record, never a second read of run.json through the path the caller spelled (G-19 of
// 20261023-014400-rdt-delivery).
let runId = admittedRecord?.run_id ?? 'unknown';

// ------------------------------------------------------------------------- what the arm consumed
//
// An arm is billed to the VENDOR'S OWN ACCOUNT, so its status recorded `total_cost_usd: 0` and
// nothing else. That reads as "free" rather than "not measurable here": the 2026-09-06 sweep
// reported $47.88 while also spending six arms' worth of tokens nobody could see, and a --resume
// spent them a second time.
//
// Both CLIs do report usage; this framework was simply throwing it away. agy returns it in the JSON
// wrapper it already parses, and codex emits `turn.completed` on the --json event stream (verified
// to coexist with --output-last-message, which is where the answer comes from).
let reviewerUsage = null;

// (usage extraction lives in lib/reviewers.mjs now: it is a per-vendor FACT, so it belongs in the
// adapter table beside the flags rather than in a branch here.)

// ---------------------------------------------------------------------------- envelope helpers
function envelope({ verdict, findings = [], checked_clean = [], not_checked = [] }) {
  return {
    schema_version: 1,
    run_id: runId,
    node_id: nodeId,
    // The panel is an external arm: it is never given intent.md, so it can neither echo a real
    // intent_sha nor cite an I-n. Same rule as the non-contract lenses.
    intent_sha: '',
    source: args.reviewer,
    verdict,
    findings,
    checked_clean,
    not_checked,
    out_of_scope_observations: [],
    // Tokens, not dollars: the dollar figure belongs to the vendor's account and is not knowable
    // here, while the tokens are exactly what the operator's quota is measured in. null means the
    // CLI reported none, which is a gap to name rather than a zero to record.
    usage: reviewerUsage,
    duration_ms: spawnDurationMs,
    // The vendor process's own call entry (runtime-call-telemetry.plan.md stage 3): its exit code, signal, timeout and usage,
    // measured here where it is started; the caller marks it answered when its classification of this envelope says so.
    call: reviewerCall,
    // WHY THIS EGRESS WAS ALLOWED. The basis was computed and then dropped on the success path, so
    // an artifact could not say whether source left the machine because the project had opted in or
    // because a caller passed --consent (G-14). An egress control whose decision is unrecorded
    // cannot be audited after the fact, which is most of the point of having one.
    egress_basis: consent?.why ?? null,
  };
}


function emit(rawEnv) {
  const env = withOverride(rawEnv);
  const cleanupGap = cleanupTempSchema();
  if (cleanupGap && Array.isArray(env.not_checked)) env.not_checked.push(cleanupGap);
  // Mirror into the run's evidence dir when there is one, so the raw arm output survives even if
  // the caller discards stdout (disk-first §3). BEFORE stdout, and a failure NAMED (G-7 of
  // 20261029-212858-rdr-remediation-2-review): it was swallowed after stdout was written, so the envelope could not say
  // its evidence copy was missing (A-12). The response then carries the gap in its not_checked[], and stderr says it.
  if (outDir) {
    try {
      const sink = confined(evidenceRoot);
      sink.dir(['evidence', nodeId]);
      sink.create(['evidence', nodeId, path.basename(freeEvidenceName({ owner: sink, segments: ['evidence', nodeId] }, 'envelope', '.json'))], JSON.stringify(env, null, 2) + '\n');
    } catch (e) {
      const gap = { item: 'envelope evidence copy', reason: `the envelope could not be mirrored into evidence/${nodeId}/: ${e.message}` };
      if (Array.isArray(env.not_checked)) env.not_checked.push(gap);
      process.stderr.write(`external-review: ${gap.reason}\n`);
    }
  }
  writeResponse(JSON.stringify(env, null, 2) + '\n');
  process.exit(exitCode);
}

// An unpinned model or effort is a REAL gap: the same arm can answer from a different model on
// the next developer's machine, so a finding is not reproducible from the artifact alone. The
// framework's rule for a capability it does not have is to name it, not to omit it — same as an
// empty contract key. See shared/external-reviewers.md.
// Declared here rather than beside the write, because runtimeNotChecked() below reads them and is
// itself called from the early-failure paths — which run before the spawn.
let rawLogRel = null;
let rawLogError = null;

function runtimeNotChecked() {
  if (!launched) return [];
  const out = [];
  if (reviewerStarted && !model) {
    out.push({
      item: `${args.reviewer} model`,
      reason:
        'not pinned; the arm ran on the reviewer CLI ambient default, so this result is not '
        + 'reproducible from the artifact alone',
    });
  }
  if (reviewerStarted && !effort) {
    out.push({
      item: `${args.reviewer} reasoning effort`,
      reason: 'not pinned; the arm ran on the reviewer CLI ambient default',
    });
  }
  // THE RAW LOG THAT WAS NOT WRITTEN (G-12). Every finding below cites this file, and the write used
  // to fail into `catch { /* best effort */ }` — so an arm could hand run-graph findings whose
  // evidence path names a file that does not exist, and be counted as an arm that reported normally.
  // §6 calls that silent_error_swallowing. `rawLogError` is declared far below in file order but the
  // hoisted `var`-like semantics of `let` do not apply, so it is read defensively: this function is
  // also called from the early-failure paths, before the spawn has happened at all.
  if (typeof rawLogError === 'string' && rawLogError) {
    out.push({
      item: `${args.reviewer} raw log`,
      reason: `could not be written (${rawLogError}), so the findings cite no evidence file`,
    });
  }
  return out;
}

function emitProposal({ candidates = [], incomplete_candidates = null, not_checked = [] }) {
  cleanupTempSchema();
  writeResponse(JSON.stringify(withOverride({
    schema_version: 1,
    source: args.reviewer,
    candidates,
    ...(incomplete_candidates ? { incomplete_candidates } : {}),
    model: model || null,
    effort: effort || null,
    // WHAT IT SPENT (G-10, code-audit). `reviewerUsage` is harvested for every mode and emitted by
    // envelope() and emitRuling(); this literal carried no `usage` key at all, so proposal-mode arms
    // — /request's candidate-pool path, a real billed vendor call — reported nothing about what they
    // consumed. That is the gap the accounting work was written to close ("six arms' worth of tokens
    // nobody could see"), left open on one mode of three: the operator's quota is spent and no
    // artifact records it, which is the absent-versus-zero distinction this framework draws
    // everywhere else.
    usage: reviewerUsage,
    duration_ms: spawnDurationMs,
    // The vendor process's own call entry (runtime-call-telemetry.plan.md stage 3): its exit code, signal, timeout and usage,
    // measured here where it is started; the caller marks it answered when its classification of this envelope says so.
    call: reviewerCall,
    not_checked: [...not_checked, ...runtimeNotChecked(), ...cleanupGaps()],
    // WHY THIS EGRESS WAS ALLOWED — on EVERY emitter, not just the review one (G-11,
    // contract-audit). The field was set in `envelope()`, which only `emit()` uses, so a proposal
    // batch and a tie-break ruling left the machine recording nothing about why they were permitted
    // to. I-5 names "--consent transport-probe accepted but not recorded in the envelope" as the
    // failure mode, and the tie-break is the path most likely to be driven by an explicit consent
    // flag rather than by the project's own opt-in. An egress control whose decision is unrecorded
    // cannot be audited after the fact, which is most of the point of having one.
    egress_basis: consent?.why ?? null,
  }), null, 2) + '\n');
  process.exit(exitCode);
}

/**
 * A RULING, which is neither a verdict envelope nor a candidate batch.
 *
 * `supports` names the position upheld, or "neither". Carried as its own field because the review
 * envelope had nowhere to put it: every measured ruling came back `verdict PASS, findings: 0` and
 * rendered into reconciled.md as "no finding upheld" — the adjudication existed in prose and
 * nowhere the graph could read it.
 */
function emitRuling({ supports = null, confidence = null, rationale = '', not_checked = [] }) {
  cleanupTempSchema();
  writeResponse(JSON.stringify(withOverride({
    schema_version: 1,
    source: args.reviewer,
    node_id: nodeId,
    supports,
    confidence,
    rationale,
    model: model || null,
    effort: effort || null,
    not_checked: [...not_checked, ...runtimeNotChecked(), ...cleanupGaps()],
    usage: reviewerUsage,
    duration_ms: spawnDurationMs,
    // The vendor process's own call entry (runtime-call-telemetry.plan.md stage 3): its exit code, signal, timeout and usage,
    // measured here where it is started; the caller marks it answered when its classification of this envelope says so.
    call: reviewerCall,
    // Same rule as the other two emitters (G-11). See emitProposal for why it is on all three.
    egress_basis: consent?.why ?? null,
  }), null, 2) + '\n');
  process.exit(exitCode);
}

/**
 * A CLAIM CHECKER'S ANSWER (claim-check-cross-family.plan.md stage 2): the checker's result for claim-check.mjs, or null
 * when there is none, with the same accounting as the other emitters — settings, usage, duration and why this egress was
 * allowed (G-11).
 */
function emitClaimCheck({ result = null, not_checked = [] }) {
  cleanupTempSchema();
  writeResponse(JSON.stringify(withOverride({
    schema_version: 1,
    source: args.reviewer,
    result,
    model: model || null,
    effort: effort || null,
    usage: reviewerUsage,
    duration_ms: spawnDurationMs,
    // The vendor process's own call entry (runtime-call-telemetry.plan.md stage 3): its exit code, signal, timeout and usage,
    // measured here where it is started; the caller marks it answered when its classification of this envelope says so.
    call: reviewerCall,
    not_checked: [...not_checked, ...runtimeNotChecked(), ...cleanupGaps()],
    egress_basis: consent?.why ?? null,
  }), null, 2) + '\n');
  process.exit(exitCode);
}

/**
 * A DECISION PANEL SEAT'S ANSWER (autonomous-run.plan.md stage 4): `{choice, reason, other_text?, change_of?}`, or null
 * when the seat did not answer, with the same accounting as the other emitters.
 */
function emitDecision({ result = null, not_checked = [] }) {
  cleanupTempSchema();
  writeResponse(JSON.stringify(withOverride({
    schema_version: 1,
    source: args.reviewer,
    result,
    model: model || null,
    effort: effort || null,
    usage: reviewerUsage,
    duration_ms: spawnDurationMs,
    call: reviewerCall,
    not_checked: [...not_checked, ...runtimeNotChecked(), ...cleanupGaps()],
    egress_basis: consent?.why ?? null,
  }), null, 2) + '\n');
  process.exit(exitCode);
}

// The schema route this call takes — computed the way the call computes it below, so the record the mint writes and
// the record the call reads have the same key.
function probeRoute() {
  return schemaRoute(args.mode, { participants: args.participants, candidateFields: args.candidateFields });
}

// The contract that carries review.reviewer_probe_max_age_hours: the run's frozen one with --run-dir, the live one
// otherwise — including under --consent transport-probe, which reads no contract for consent. None readable: absent.
function contractForAge() {
  // The admitted record, not a reread through the caller's spelling (G-11 of 20261023-040306-rdt-remediation-2-review).
  if (args.runDir) return admittedRecord?.contract ?? null;
  return liveContract().contract ?? null;
}

async function reviewerPreflight() {
  const startedAt = Date.now();
  const route = probeRoute();
  const label = [args.reviewer, model || '(ambient model)', effort || '(ambient effort)', args.mode, route].join('/');
  let limits;
  try { limits = probeLimits(ADAPTER, rawTable().probe_defaults); } catch (e) { return { ok: false, label, reason: e.message }; }
  // UNDER THE REVIEWER'S ALLOW-LIST (G-4 of 20261009-232840-reviewer-preflight-r1): the version command is the adapter's
  // own argv, which a consuming project may declare, so it gets what the vendor call gets and no more — not this
  // process's whole environment. And under the call's PATH filter: the snapshot is named here as it is at the call (G-1
  // of 20261017-060636-rpe-review), so the probe cannot vouch for a binary the call would never run.
  const version = cliVersion(ADAPTER, limits, {
    env: reviewerEnv(args.reviewer, process.env, { depth: DEPTH + 1, prefixes: envPrefixesOf(ADAPTER), names: envNamesOf(ADAPTER), caseFold: hostPlatform().caseInsensitiveEnv }).env,
    inside: [args.surface && path.resolve(args.surface)].filter(Boolean),
  });
  // Every exit from here on carries the count, failures included (I-5; G-6 of 20261017-071826-rpe-remediation-2-review):
  // a refusal is exactly the case where a reviewer found only through a dropped entry needs the count said.
  const dropped = version.dropped ?? 0;
  if (!version.ok) return { ok: false, label, reason: version.reason, dropped };
  let maxAgeHours;
  try { maxAgeHours = maxAgeHoursOf(contractForAge()?.review?.reviewer_probe_max_age_hours); } catch (e) { return { ok: false, label, reason: e.message, dropped }; }
  const combination = {
    adapter: args.reviewer, adapter_hash: adapterHash(ADAPTER), model, effort, mode: args.mode, route,
    cli_version: version.version, host: os.hostname(), probe_code_hash: frameworkProbeCodeHash(),
  };
  const key = probeKey(combination);
  const home = quorateHome(process.env, os.homedir());
  const counts = (rec) => recordCounts(rec, combination, { now: Date.now(), maxAgeHours });
  let record = readProbeRecord(home, key);
  if (args.reprobe || !counts(record)) {
    // Whether the lock was taken: a failure inside it (the probe or its record) is not a lock that could not be taken (G-18
    // of 20261122-035227-m3s7-b3-review), and is reported as what it was.
    let held = false;
    try {
      record = await withProbeLockAsync(home, key, limits, async () => {
        held = true;
        // RE-READ under the lock: one written while this process waited, passed or failed, is used as it stands, so a
        // waiter never probes after a holder that finished.
        const again = readProbeRecord(home, key);
        if ((!args.reprobe && counts(again)) || (again && writtenWhileWaiting(again, { startedAt, now: Date.now() }))) return again;
        const result = await runProbe(limits, route);
        const fresh = {
          ...combination, key, state: result.passed ? 'passed' : 'failed', reason: result.reason,
          checked_at: new Date().toISOString(), ms: result.ms,
        };
        writeProbeRecord(home, fresh);
        return fresh;
      });
    } catch (e) {
      const why = String(e?.message ?? e).split('\n')[0];
      return { ok: false, label, reason: held ? `the probe failed while its lock was held: ${why}` : `the probe's lock could not be taken: ${why}`, dropped };
    }
  }
  return record?.state === 'passed' ? { ok: true, label, record, dropped } : { ok: false, label, reason: record?.reason ?? 'the probe did not pass', dropped };
}

// THE PROBE'S WHOLE INPUT, from one owner: what runProbe hands its child, and what a --probe-run child holds its own
// arguments to (G-2 of 20261020-172345-argv-remediation-review). Everything here is fixed by the mode, the reviewer and
// the route, so a child can rebuild it and refuse anything else.
function probeInput(route) {
  if (args.mode === 'tie-break') {
    const group = probeDispute({ armSource: args.reviewer, armNodeId: `panel-${args.reviewer}-code` });
    const brief = adjudicationBrief({ group, excerpt: group.excerpt });
    const prompt = buildTieBreakPrompt({
      ...group, groupId: group.group_id, judgeCount: 1,
      voteVocabulary: renderVoteVocabulary(brief.participants), mechanicalFacts: brief.mechanicalFacts,
    });
    return { prompt, participants: brief.participants,
      extra: ['--participants', brief.participants.join(','), '--node-id', brief.nodeId(args.reviewer)] };
  }
  if (args.mode === 'claim-check') return { prompt: readTemplate('reviewer-probe-claim-check.md'), participants: null, extra: [] };
  if (args.mode === 'decide') return { prompt: readTemplate('reviewer-probe-decide.md'), participants: null, extra: [] };
  if (args.mode === 'propose') {
    // THE PROBE'S OWN FIELDS, on the native route too (story-pipeline, 2026-10-16): built from the caller's fields
    // (kind, concern, ...), the schema had no `name`, while probePassed asks for one candidate NAMED "probe", so a
    // reviewer obeying the schema exactly was refused. The probe checks the transport and native structured output;
    // the caller's own schema is still checked by the call itself (validateStrict).
    return { prompt: readTemplate('reviewer-probe-propose.md'), participants: null,
      extra: ['--schema', PROBE_PROPOSE_SCHEMA, ...(route === 'native' ? ['--candidate-fields', PROBE_CANDIDATE_FIELDS] : [])] };
  }
  return { prompt: readTemplate('reviewer-probe-review.md'), participants: null, extra: ['--schema', PROBE_REVIEW_SCHEMA] };
}

// WHAT A --probe-run CALL MAY SEND: the probe's own input and nothing else (G-2 of 20261020-172345-argv-remediation-review).
// --probe-run is a flag any caller can type, and beside the probe's consent it opened the egress gate and skipped the
// preflight, so a prompt, schema and directory of the caller's own went out under external_panel: false. The child
// rebuilds the input from probeInput and refuses a difference: the prompt's text, every value flag the probe sets (an
// absent one stays absent), and a --surface that is an empty git repository, as runProbe makes, so the reviewer reads
// nothing. One answer per route the probe has; empty errors mean the input is the probe's, and `prompt` is then the
// probe's own text, the one thing sent: the file is read once, here, and never again (G-3 of
// 20261020-190617-argv-remediation-4-review), so a file swapped after this check reaches nobody.
// THE PROMPT FILE: below the admitted run through its owner (run-dir-reads.plan.md stage 4), a link at any level refused;
// a file the caller named elsewhere (a claim check, a candidate pool) is read as named.
function readPromptFile() {
  if (!args.promptFile) return null;
  const abs = path.resolve(args.promptFile);
  const rel = admittedRunDir ? path.relative(admittedRunDir, abs) : '';
  // THROUGH THE EGRESS OWNER, IN A RUN OR OUTSIDE ONE (hardlink-egress.plan.md stage 2): the prompt goes to the vendor, so
  // a link, a junction, or a file with a second name (its content another file's) is refused with the mode's unavailable
  // envelope. Outside a run the file was read raw.
  if (rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) {
    // Size-bound like the branch below (G-4 of 20261112-054852-hl-remediation-3-review): rooted at the run, as before,
    // through the one entry for a prompt-bound run read (G-2 of 20261115-042114-pbr-1b-remediation-4-review), which applies
    // the same refusals and bound.
    try { return egressRunReader(admittedRunDir).read(abs); } catch (e) {
      if (e.code === 'ENOENT') return null;
      unavailable(`prompt file refused: ${e.message}`);
    }
  }
  // Refused alike with the branch above (G-4 of 20261111-042301-dps-a5-review): a directory or an unreadable file is reported.
  try { return egressReadFile(abs, 'utf8', { repoRoot: gitWorktreeRoots()?.[0] ?? null }); } catch (e) {
    if (e.code === 'ENOENT') return null;
    unavailable(`prompt file refused: ${e.message}`);
  }
}

function probeRunCheck() {
  const prompt = readPromptFile();
  const given = { schema: args.schema, 'candidate-fields': args.candidateFields, participants: args.participants?.join(',') };
  const differs = (want) => {
    const pairs = Object.fromEntries(want.extra.flatMap((x, i, a) => (x.startsWith('--') && x !== '--node-id' ? [[x.slice(2), a[i + 1]]] : [])));
    return [
      ...(prompt === want.prompt ? [] : ['--prompt-file is not the probe\'s prompt']),
      ...Object.keys(given).filter((k) => given[k] !== pairs[k]).map((k) => `--${k} is not the probe's`),
    ];
  };
  const routes = ['native', 'prompt-and-scan'].map((r) => ({ want: probeInput(r), errors: [] })).map((x) => ({ ...x, errors: differs(x.want) }));
  const match = routes.find((x) => x.errors.length === 0);
  return { errors: [...(match ?? routes[0]).errors, ...emptyRepositoryErrors(args.surface)], prompt: match?.want.prompt ?? null };
}

// THE DIRECTORY A --probe-run REVIEWER STARTS IN is this process's own (G-3 of 20261020-190617-argv-remediation-4-review):
// the caller's --surface was checked empty, but the caller owns it and could fill it after the check. A fresh empty git
// repository, made as runProbe makes its own and removed when this process exits, holds nothing anyone else put there.
function ownEmptyRepository() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-probe-run-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  const init = gitSync(['init', '-q', '--template='], { cwd: dir, encoding: 'utf8', windowsHide: true });
  if (init.status !== 0) die(`--probe-run could not make its own empty git repository: ${String(init.stderr || init.error?.message || '').trim().split('\n')[0]}`);
  return dir;
}

// AN EMPTY GIT REPOSITORY, as `git init -q --template=` leaves one: no file outside .git, no link anywhere, and inside .git
// only HEAD naming a branch and a config of [core] settings. A .git FILE, an alternates file or a core.worktree would each
// hand the reviewer a tree from elsewhere.
function emptyRepositoryErrors(surface) {
  if (!surface) return ['no --surface, so the reviewer would start in this directory'];
  const root = path.resolve(surface);
  const bad = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(root, p).split(path.sep).join('/');
      if (e.isDirectory()) { if (rel === '.git' || rel.startsWith('.git/')) walk(p); else bad.push(rel); continue; }
      if (!e.isFile()) { bad.push(rel); continue; }
      const text = fs.readFileSync(p, 'utf8');
      if (rel === '.git/HEAD' && /^ref: refs\/heads\/[\w.-]+\s*$/.test(text)) continue;
      if (rel === '.git/config' && text.split(/\r?\n/).every((l) => /^\s*(\[core\]|(repositoryformatversion|filemode|bare|logallrefupdates|symlinks|ignorecase|precomposeunicode)\s*=\s*\w+)?\s*$/i.test(l))) continue;
      bad.push(rel);
    }
  };
  try {
    if (!fs.lstatSync(root).isDirectory() || !fs.lstatSync(path.join(root, '.git')).isDirectory()) return [`--surface ${root} is not an empty git repository`];
    walk(root);
  } catch { return [`--surface ${root} is not an empty git repository`]; }
  return bad.length ? [`--surface ${root} is not an empty git repository (holds ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ', ...' : ''})`] : [];
}

// ONE PROBE: this script run again on a synthetic prompt — the same adapter, model, effort, mode and route — started
// in an EMPTY directory (never the caller's: G-5 of 20260929-225147-m0-gate-review), and judged by probePassed.
async function runProbe(limits, route) {
  const t0 = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-probe-'));
  try {
    const surface = path.join(dir, 'surface');
    fs.mkdirSync(surface);
    // A GIT REPOSITORY, EMPTY. codex refuses to run outside one ("Not inside a trusted directory and
    // --skip-git-repo-check was not specified", exit 1), so a plain empty directory failed every codex probe on every
    // machine — found by the first live mint. The arms' real directory is a repository of its own
    // (scripts/io/snapshot.mjs); this one is initialised the same way, with no template, and holds nothing.
    const init = gitSync(['init', '-q', '--template='], { cwd: surface, encoding: 'utf8', windowsHide: true });
    if (init.status !== 0) {
      return { passed: false, reason: `the probe's directory could not be made a git repository: ${String(init.stderr || init.error?.message || '').trim().split('\n')[0]}`, ms: Date.now() - t0 };
    }
    const promptFile = path.join(dir, 'probe.md');
    const { prompt: probePrompt, extra, participants } = probeInput(route);
    fs.writeFileSync(promptFile, probePrompt);
    // THE PROBE'S RAW OUTPUT IS KEPT WHERE THE CALLER KEEPS ITS OWN (story-pipeline, 2026-10-16): spawned with neither flag,
    // a refused preflight discarded the reviewer's answer, the one diagnostic, while the caller had passed --evidence-dir.
    // Under its own node id, so the probe's log is never read as the main call's. By the caller's own flag (G-5 of
    // 20261016-193355-sp-bugs-review): handed --evidence-dir under a --run-dir call, the child resolved its adapter from
    // the live contract while this process keyed the record by the frozen one.
    const keep = outDir ? [outFlag, admittedRunDir ?? outDir,...(args.mode === 'tie-break' ? [] : ['--node-id', `probe-${args.reviewer}-${args.mode}`])] : [];
    const r = await spawnCapture(process.execPath, [
      fileURLToPath(import.meta.url), '--probe-run', '--reviewer', args.reviewer,
      ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []),
      '--mode', args.mode, '--prompt-file', promptFile, '--surface', surface,
      // The probe's egress is the call's own consent; the child records it as the probe's.
      '--consent', 'transport-probe', '--probe-timeout-ms', String(limits.probeMs), ...extra, ...keep,
    ], {
      env: process.env, windowsHide: true,
      // KILLABLE, so a timeout ends the whole tree (G-3 of 20261010-071234-reviewer-preflight-r7): a timed spawnSync ended
      // only the wrapper, and on POSIX the reviewer CLI it started could keep running and spending. spawnCapture stops a
      // child through the one owner (io/stop-child.mjs), which is the only code that may.
      ...hostPlatform().proc.killableSpawnOptions(),
    }, { timeoutMs: limits.probeChildMs });
    let env = null;
    try { env = JSON.parse(r.stdout ?? ''); } catch { /* named below */ }
    const passed = probePassed(args.mode, env, { participants });
    const reason = passed ? null
      : r.timedOut ? `the probe did not finish within ${limits.probeChildMs / 1000} s`
        : r.error ? `the probe did not finish: ${r.error.code ?? r.error.message}`
        : !env ? `the probe returned no parseable envelope (exit ${r.status})`
          : (env.not_checked ?? []).find((n) => new RegExp(`^(${UNAVAILABLE_ROLES.join('|')}) '`).test(String(n?.item ?? '')))?.reason
            ?? `the reviewer's answer did not have the ${args.mode} shape`;
    return { passed, reason, ms: Date.now() - t0 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A USAGE LIMIT, told apart from any other failure (autonomous-run.plan.md stage 7 part 2; operator, 2026-10-31: "3 a"):
// set where the vendor's own output is read, from the adapter's declared quota_patterns (UNVERIFIED until a real one is
// seen), and carried on every not_checked entry unavailable() emits as kind 'quota', with the reset text if the message
// gave one. The reason stays what it was: the vendor's text is not quoted into it (G-43).
let quotaNote = null;
function quotaFrom(...texts) {
  const q = quotaOf(texts.map((t) => String(t ?? '')).join('\n'), ADAPTER?.quota_patterns);
  return q ? { kind: 'quota', reset_text: q.reset_text ? q.reset_text.slice(0, 60) : null } : null;
}
// A RETRY'S NOTE, carried by every envelope this script emits from the moment the retry is made (G-9 of
// 20261110-230425-dps-remediation-6-review-b): the usage of a retry that ends unavailable is summed too, and must say so.
let retryNote = null;
// A retried call's first attempt writes a log of its own, and losing it is not losing the one findings cite, so it has its
// own note, carried as the retry's is (G-5 of 20261110-234941-dps-remediation-7-review).
let deniedLogNote = null;
function unavailable(reason) {
  if (quotaNote) reason = `${reason} (a usage limit, by this adapter's quota_patterns${quotaNote.reset_text ? `; resets ${quotaNote.reset_text}` : ''})`;
  const q = quotaNote ?? {};
  const retried = [retryNote, deniedLogNote].filter(Boolean);
  if (args.mode === 'tie-break') {
    // A tie-breaker that did not answer must not look like one that ruled "neither": the first is
    // an absent adjudication, the second is a decision. supports stays null.
    emitRuling({ not_checked: [{ item: `tie-breaker '${args.reviewer}'`, reason, ...q }, ...retried] });
  }
  if (args.mode === 'propose') {
    emitProposal({
      not_checked: [{ item: `external proposer '${args.reviewer}'`, reason, ...q }, ...retried],
    });
  }
  if (args.mode === 'claim-check') {
    // NO RESULT, not an empty one: a checker that did not answer must not read as one that found every claim standing.
    emitClaimCheck({ result: null, not_checked: [{ item: `claim checker '${args.reviewer}'`, reason, ...q }, ...retried] });
  }
  if (args.mode === 'decide') {
    // SILENCE, never a vote: a seat that did not answer must not read as one that chose (lib/decision-panel.mjs applyRound).
    emitDecision({ result: null, not_checked: [{ item: `decision seat '${args.reviewer}'`, reason, ...q }, ...retried] });
  }
  // RISK, not PASS: this arm checked nothing. A PASS here would be counted as agreement by the
  // reconciler, which is precisely the false corroboration the panel exists to avoid.
  emit(
    envelope({
      verdict: 'RISK',
      // runtimeNotChecked here as on every other emitter (G-2 of 20261111-003934-dps-remediation-8-review): this branch alone
      // dropped a launched arm's unwritten raw log and unpinned settings (A-12). Empty before the launch.
      not_checked: [{ item: `external reviewer '${args.reviewer}'`, reason, ...q }, ...retried, ...verdictCeilingNotes, ...runtimeNotChecked()],
    }),
  );
}

// ---------------------------------------------------------------------------- run the reviewer
//
// CONSENT IS CHECKED BEFORE THE PROMPT IS EVEN READ, because the refusal must not depend on
// anything about the payload. Reported through `unavailable()` rather than die(): this script's
// contract is that it ALWAYS emits one structured response, and a refusal a caller cannot see is
// the same defect as a reviewer that dies quietly -- the caller would read "no findings".
// A --probe-run call carrying anything but the probe's own input is a usage error, refused before the consent below can
// open the gate for it (G-2 of 20261020-172345-argv-remediation-review): nothing is sent, and no envelope is printed.
// What it sends is what was checked, bound here: the probe's prompt text and a directory of its own (G-3 of
// 20261020-190617-argv-remediation-4-review).
let probeOwn = null;
// Bound before the probe's check, which can refuse through unavailable(): the envelope reads it (G-2 of
// 20261111-024650-dps-remediation-11-review). Null there: nothing has been decided about egress yet.
let consent = null;
if (args.probeRun) {
  const { errors, prompt } = probeRunCheck();
  if (errors.length) die(`--probe-run is the preflight's own probe, and this call's input is not the probe's: ${errors.join('; ')}`);
  probeOwn = { prompt, surface: ownEmptyRepository() };
}
consent = egressConsent();
{
  if (!consent.ok) {
    unavailable(
      `refusing to send anything to ${args.reviewer}: ${consent.why}. This is the only place source ` +
      `or conversation leaves the machine, and the panel is opt-in (shared/external-reviewers.md). ` +
      `Set review.external_panel: true to enable it; --consent transport-probe covers only the transport ` +
      `probe (--probe-run, --preflight-only).`,
    );
  }
}

const prompt = probeOwn ? probeOwn.prompt : readPromptFile();
if (needsPrompt(ADAPTER) && !prompt && !args.preflightOnly) unavailable(`prompt file not found: ${args.promptFile}`);

// This adapter currently carries the schema in the prompt and validates the returned shape below.
// Keep the task instruction separate from the schema so the same brief can be sent to every
// proposer unchanged and the output contract can vary with the caller's requested fields.
//
// `status` is the ADAPTER's field, appended to whatever shape the caller asked for: the caller
// owns the payload, this script owns the "did you actually do it" contract. It exists because
// "Silence is not a verdict" (CLAUDE.md) was enforced for this script - which always emits - and
// never for the reviewer it calls. Without a legal way to say "I could not", a reviewer that
// refuses, runs short, or is denied by the sandbox has two options left: violate the schema, or
// fabricate a passing answer. A schema describing only success PRESSURES a stuck model toward the
// second. With `status`, the two failures separate cleanly:
//
//   no output / unparseable  -> HARD failure: the transport or the runtime broke.
//   status != ok             -> SOFT failure: the reviewer answered, and said it could not.
//
// Both are reported; neither can become a PASS. The words are the prompt library's (G-3 of
// 20261105-212751-sogsr-delivery: they were inline here, against ARCHITECTURE.md §2).
const schemaHint = args.schema
  ? '\n\n' + renderTemplate(readTemplate('reviewer-reply-contract.md'), { schema: args.schema }, 'reviewer-reply-contract.md')
  : '';

// codex ships as an npm .ps1/.cmd shim on Windows, which CreateProcess cannot execute directly;
// shell:true routes through the interpreter that understands it.
//
// agy is a real .exe and MUST NOT get shell:true. With a shell, the whole command line is
// rebuilt and re-parsed by cmd.exe, which mangles the multi-line prompt passed to `--print`:
// the reviewer then sees a truncated fragment and answers something unparseable, which this
// script would honestly-but-uselessly report as "returned no parseable verdict envelope".
// Without a shell, Node hands argv straight to CreateProcess and newlines and quotes survive.
const useShell = needsShell(ADAPTER, hostPlatform());

// A reviewer whose prompt travels INLINE IN ARGV (none ships since decision-panel-seats.plan.md stage 3: codex and agy
// read stdin, which has no such limit) is held to the budget here. The budget and
// the measurement live in lib/decisions.mjs with the other pure decisions, so the rule can be
// tested without spawning anything; see shared/external-reviewers.md ("Why the prompt goes
// inline") for why the file-based alternative is refused.
// THE REVIEWER IT WAS GIVEN, NOT A VENDOR OF ITS OWN (G-7 of 20261023-014400-rdt-delivery; A-9): this branch is chosen by
// the adapter, and its message named agy and --reviewer codex whatever adapter took it.
if (!args.preflightOnly && reviewerPromptVia(ADAPTER) === 'argv' && !fitsInlineArgv(prompt + schemaHint, ADAPTER.prompt.budget_bytes ?? INLINE_ARGV_BUDGET)) {
  const bytes = Buffer.byteLength(prompt + schemaHint, 'utf8');
  const budget = ADAPTER.prompt.budget_bytes ?? INLINE_ARGV_BUDGET;
  unavailable(
    `prompt is ${bytes} bytes; ${args.reviewer} receives it inline in argv, which Windows caps near 32767 ` +
      `(budget ${budget}). Refusing rather than sending a truncated brief — send the ` +
      'disputed finding and its excerpt, or use a reviewer whose adapter takes the prompt on stdin.',
  );
}

// THE ASSIGNMENT, VALIDATED BEFORE ANYTHING IS SPENT (stage 4; check-tiebreak validated its judges before a call): the
// preflight's probe IS a call, so a model and effort the adapter rejects — agy takes no effort for a model whose name
// carries one — is a usage error here, not a probe that could never pass. Errors only: an unknown model is a warning.
{
  const { errors } = validateAssignment(ADAPTER, { model, effort, name: args.reviewer, label: `--reviewer ${args.reviewer}` });
  if (errors.length) die(errors.join('; '));
}

// ---------------------------------------------------------------------------- the reviewer preflight
// AFTER THE CHEAP REFUSALS (stage 4): a missing prompt or a brief too large for an argv-prompt reviewer is refused
// without a probe, which would otherwise spend at the vendor on a call that was never going to be made.
// Operator, 2026-10-08: "no fallback. preflight test for what is needed and fails if something is missing. if the use
// decides to use agy or orther model preflight should be ran again". Before the reviewer is called, THIS combination —
// adapter, its definition, model, effort, mode, schema route, the CLI's version, the host — must have a passing probe
// record young enough to count; when it has none it is probed here, once, in an empty directory, and a failed probe
// refuses the call: the mode's unavailable envelope, with the subject run-graph recognises, and exit 5.
if (!args.probeRun) {
  const check = await reviewerPreflight();
  if (!check.ok) {
    // The dropped count, said here because the refusal exits before the call that says it (I-5; G-6 of
    // 20261017-071826-rpe-remediation-2-review). stderr: stdout is the envelope the caller parses.
    if (check.dropped) console.error(`external-review: ${droppedNote(check.dropped)}`);
    exitCode = 5;
    unavailable(`reviewer preflight failed for ${check.label}: ${check.reason}`);
  }
  if (args.preflightOnly) {
    // WHAT PASSED, for the caller to freeze (new-run's run.json.reviewer_preflight): the record's identity and outcome.
    // The dropped count, said here because this exit comes before the call that says it (I-5; G-8 of
    // 20261017-064450-rpe-remediation-review). stderr: stdout is the record the caller parses.
    if (check.dropped) console.error(`external-review: ${droppedNote(check.dropped)}`);
    const { key, adapter, model: m, effort: e, mode, route, state, checked_at } = check.record;
    // Every byte before the exit below, as writeResponse (G-4 of 20261112-050334-hl-review-b).
    writeStdout(`${JSON.stringify({ key, adapter, model: m, effort: e, mode, route, state, checked_at })}\n`);
    if (args.testStallMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, args.testStallMs);
    if (args.testCrash) throw new Error('test seam: --test-crash');
    process.exit(0);
  }
}

// The command line is built by a PURE function so the exact flags can be asserted offline. The
// panel is behind an explicit QUORATE_LIVE opt-in, so a wrong flag would otherwise only surface on
// a paid probe.
// ------------------------------------------------------------------ native structured output
// The reviewer is handed a REAL JSON Schema and returns the answer in a file (codex) or inside a
// JSON wrapper (agy), instead of being asked in prose and having its answer recovered from stdout
// by a hand-written scanner. Probed 2026-08-31: codex enforces it through OpenAI structured
// outputs in STRICT mode, which rejects any schema with a missing `additionalProperties: false` or
// an unlisted property — with exit 1 and no output file.
//
// A schema that cannot be built is NOT an error: proposal mode needs the caller's candidate field
// names to express a candidate at all under strict mode, and without them the run falls back to
// the prompt-and-scan path and names the downgrade in not_checked[]. Narrowing the caller's fields
// to something expressible would answer a question they did not ask.
// A run's evidence folder through the one owner (run-dir-descendants stage 2): every level walked, a link refused.
const evidenceSink = outDir ? confined(evidenceRoot) : null;
if (evidenceSink) {
  try { schemaDir = evidenceSink.dir(['evidence', nodeId]); } catch (e) { die(`${outFlag}: evidence/${nodeId}: ${e.message}`); }
} else {
  schemaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-schema-'));
}
usingTempDir = !outDir;

let nativeSchema = args.mode === 'propose' ? proposeSchema(args.candidateFields)
  : args.mode === 'tie-break' ? tieBreakSchema({ participants: args.participants })
    : args.mode === 'claim-check' ? claimCheckSchema()
      : args.mode === 'decide' ? decideSchema()
        : reviewSchema();
let schemaFile = '';
let outFile = '';
// The adapter's answer file: below the sink through its owner (run-dir-reads.plan.md stage 4), so a link standing at
// <node>.response.json is not read as the vendor's answer; in a temporary folder, as written.
const readAnswerFile = (f) => {
  if (!f) return '';
  if (evidenceSink) { try { return evidenceSink.read(['evidence', nodeId, path.basename(f)]); } catch { return ''; } }
  // Guarded as the sink read is (G-7 of 20261122-044843-m3s7-b3-remediation-review): a directory or an unreadable file
  // at the answer path gives '' and the structured failure below, never a throw past every emitter.
  try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
};
// Why the answer file gave nothing, for the failure's wording: below the sink the owner is asked (G-8 of
// 20261029-212858-rdr-remediation-2-review), so a link standing there is named as refused rather than followed.
const answerFileMissing = (f) => {
  if (evidenceSink) {
    try { return evidenceSink.exists(['evidence', nodeId, path.basename(f)]) ? 'the response did not parse' : 'the response file was never written'; } catch (e) { return `the response file was refused (${e.message})`; }
  }
  return fs.existsSync(f) ? 'the response did not parse' : 'the response file was never written';
};
const schemaNotes = [];

if (!nativeSchema) {
  schemaNotes.push({
    item: 'native structured output',
    reason: 'no --candidate-fields given, so no strict schema could be built; fell back to the prompt-and-scan path',
  });
  // The answer's own file, where the adapter has one: the scan reads it before stdout (story-pipeline, 2026-10-16).
  if (ADAPTER.response?.from === 'file') {
    try { if (!evidenceSink) fs.mkdirSync(schemaDir, { recursive: true }); outFile = path.join(schemaDir, `${nodeId}.response.json`); } catch { outFile = ''; }
  }
} else {
  const strictErrors = validateStrict(nativeSchema);
  if (strictErrors.length) {
    // Caught here rather than as a bare 400 from the API, which would cost the whole arm.
    nativeSchema = null;
    schemaNotes.push({
      item: 'native structured output',
      reason: `generated schema is not strict-mode valid (${strictErrors.join('; ')}); fell back to the prompt-and-scan path`,
    });
  } else {
    try {
      schemaFile = path.join(schemaDir, `${nodeId}.schema.json`);
      if (evidenceSink) evidenceSink.replace(['evidence', nodeId, `${nodeId}.schema.json`], JSON.stringify(nativeSchema, null, 2) + '\n');
      else fs.writeFileSync(schemaFile, JSON.stringify(nativeSchema, null, 2) + '\n');
      // Some CLIs write their final message to a file, others return it in a stdout wrapper. The
      // adapter says which, so this stopped being a vendor name test.
      if (ADAPTER.response?.from === 'file') outFile = path.join(schemaDir, `${nodeId}.response.json`);
    } catch (e) {
      nativeSchema = null;
      schemaFile = '';
      outFile = '';
      schemaNotes.push({
        item: 'native structured output',
        reason: `could not write the schema file (${e.message}); fell back to the prompt-and-scan path`,
      });
    }
  }
}

// A FAILED REMOVAL IS NAMED, never discarded (G-1 of 20261118-142344-cpi-remediation-2-review): the folder can hold the
// reviewer's source-derived answer in the shared OS temporary directory, and nothing said it stayed. It is not worth
// failing an arm over, so the arm still answers; its not_checked[] and stderr say what was left and where.
function cleanupTempSchema() {
  if (!usingTempDir || !schemaDir) return null; // a run's evidence directory is the artifact; never remove it
  if (tempCleanupGap) return tempCleanupGap;
  try {
    for (const f of fs.readdirSync(schemaDir)) fs.unlinkSync(path.join(schemaDir, f));
    fs.rmdirSync(schemaDir);
  } catch (e) {
    tempCleanupGap = {
      item: 'temporary schema folder',
      reason: `could not be removed (${e.code ?? e.message}); the reviewer's answer may remain in ${schemaDir}`,
    };
    process.stderr.write(`external-review: the ${tempCleanupGap.item} ${tempCleanupGap.reason}
`);
  }
  return tempCleanupGap;
}
// A declaration, not a const: an emitter can run before this line is reached (a preflight refusal does), and a const
// read there is a ReferenceError.
function cleanupGaps() { return tempCleanupGap ? [tempCleanupGap] : []; }

const { cmd, argv } = reviewerArgv({
  adapter: ADAPTER, reviewer: args.reviewer, model, effort, schemaFile, outFile, mode: args.mode,
  // The deadline is part of the command line, so it is built by the builder (G-11).
  timeoutMinutes: timeoutMs / 60000,
});
// reviewerEnv is the ONE owner of what a third-party reviewer CLI inherits, and it must be applied
// at the last hop before the vendor process — HERE — not only by run-graph. check-panel.mjs (the
// sanctioned QUORATE_LIVE probe) and any other caller spawn external-review.mjs without scrubbing,
// so this process may hold the operator's full shell; without this the reviewer CLI below would
// inherit it entire — GITHUB_TOKEN, AWS_*, DATABASE_URL, ANTHROPIC_API_KEY (G-10 BLOCKER). Scoped
// to the selected vendor's own prefixes so no key crosses a vendor boundary (G-21).
const { env: reviewerScrubbedEnv } = reviewerEnv(args.reviewer, process.env, {
  depth: DEPTH + 1, prefixes: envPrefixesOf(ADAPTER), names: envNamesOf(ADAPTER), caseFold: hostPlatform().caseInsensitiveEnv,
});
// WHERE THE REVIEWER STANDS is not where this script stands (arms-read-surface). The arms' directory
// is built by run-graph as a repository of its own, holding a snapshot of the reviewed state — so
// this script cannot run there: its containment check asks git which repository it is in, and the
// run directory, inside the operator's repository, would be refused as outside it (the G-43 failure,
// every arm dead before any vendor call). This script stays in the operator's repository, where
// consent and containment are decided; only the reviewer is started in --surface.
const surfaceDir = probeOwn ? probeOwn.surface : args.surface ? path.resolve(args.surface) : null;
if (surfaceDir && !fs.statSync(surfaceDir, { throwIfNoEntry: false })?.isDirectory()) {
  die(`--surface ${surfaceDir} is not a directory; the reviewer must be given the directory it is to read`);
}
// Not looked up in the reviewed snapshot it stands in (G-8 of 20261016-214749-sp-bugs-remediation-2-review), nor through
// a PATH entry that is relative or leads into the repository or the snapshot (reviewer-path-entries.md). This script
// stands in the operator's repository — the whole of it, by git's toplevel, not only the directory it was started in;
// the reviewer, in --surface when given. Each entry is judged by its real path too. The count is said, so an operator
// can see why a repository-local copy of the CLI was not the one that ran.
const launch = shellLaunchEnv(reviewerScrubbedEnv, useShell, { platform: hostPlatform(), inside: reviewerLaunchExclusions([surfaceDir]), realpath: launchRealpath });
if (launch.dropped) console.error(`external-review: ${droppedNote(launch.dropped)}`);
const spawnOpts = {
  // windowsHide: Node's default opens a console window per reviewer call on Windows (the operator saw agy's, 2026-10-24).
  encoding: 'utf8', timeout: timeoutMs, shell: useShell, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  env: launch.env,
  ...(surfaceDir ? { cwd: surfaceDir } : {}),
};

// QUOTED WHEN A SHELL IS IN THE WAY (G-11). Node does not quote argv under `shell: true` — it joins
// the arguments with spaces and lets cmd.exe re-split them — and every path this arm passes is
// absolute, built from the run directory. A consumer whose checkout sits under a path with a space
// had `--output-schema` split in half, and the reviewer then read a schema file that does not exist.
// agy never takes this branch (it must not have a shell), so its inline prompt is untouched.
const shellArgv = (a) => (useShell ? windowsShellArgv(a) : a);

let r;
launched = true;
// WALL CLOCK, MEASURED HERE BECAUSE THE VENDOR DOES NOT REPORT IT. A node runtime's result envelope
// carries duration_ms and an arm's does not, so every comparison that includes an arm was silently
// Claude-only on the time axis -- the axis the operator added precisely because latency compounds.
// Nothing about that required the vendor's cooperation: this process spawns the child and can time
// it. It is the operator's wait, which is the quantity that matters, and it includes process
// startup, which a vendor-reported figure would exclude.
const spawnStartedAt = Date.now();
// THROUGH THE STOP OWNER (stop-owner-grep-state-roots.plan.md stage 1, G-11 of 20261022-200543-ciss-d1-review-2): a timed
// spawnSync ended only its direct child, so a vendor CLI's descendants kept running, and their open pipes held the wait
// itself, so the call never returned. spawnCapture stops the whole tree through io/stop-child.mjs, started killable as
// the reviewer probe above is, and reports the stop's outcome.
// spawnSync's own `timeout`, `encoding` and `maxBuffer` are NOT passed on: Node's async spawn honours `timeout` too, and
// would kill the direct child alone at the same moment the owner's timer fires, leaving its descendants (seen 2026-11-05:
// the grandchild survived while a bare spawnCapture stopped it). The owner times the call; the cap is maxBytes.
const { timeout: _t, encoding: _e, maxBuffer: _m, ...captureOpts } = spawnOpts;
// The limit of the call about to be made: the whole of it, and for a retry what the first attempt left (G-6 of
// 20261110-230425-dps-remediation-6-review-b).
let callLimitMs = timeoutMs;
const capture = (av, input = null) => spawnCapture(cmd, av, { ...captureOpts, ...hostPlatform().proc.killableSpawnOptions() },
  { timeoutMs: callLimitMs, maxBytes: spawnOpts.maxBuffer, input });
// ONE CALL TO THE VENDOR, as a function so a call whose tool was denied can be made once more, the same prompt and settings.
const callVendor = async () => {
  // A local `r`, named as the call's result is everywhere below it (the tests that read these spellings hold every reviewer
  // call to `r = await capture(...)`, the owner's spawn).
  let r;
  if (reviewerPromptVia(ADAPTER) === 'argv') {
    // The prompt rides INLINE IN ARGV. The builder leaves a placeholder so it stays a pure function,
    // and this is also why such a vendor must not get a shell: cmd.exe would re-parse the command
    // line and truncate a multi-line prompt.
    const withPrompt = argv.map((x) => (x === ADAPTER.prompt.placeholder ? prompt + schemaHint : x));
    r = await capture(withPrompt);
  } else if (ADAPTER.schema?.style === 'none') {
    // Nothing to hand over and no prompt channel declared: spawn as-is. (The dormant codex-review
    // path, described in the table exactly as the code described it.)
    r = await capture(shellArgv(argv));
  } else {
    // stdin, which has no argv size limit — the reason a vendor that can read it does: the text itself, or one NDJSON
    // user line for a stream-json reader (decision-panel-seats.plan.md stage 3), as the adapter declares.
    r = await capture(shellArgv(argv), reviewerPromptInput(ADAPTER, prompt + schemaHint));
  }
  return r;
};
try {
  r = await callVendor();
} catch (e) {
  unavailable(`spawn failed: ${e.message}`);
}
// spawnCapture resolves with `error` set for a child that never started; one stopped at its limit did start, and carries one too.
reviewerStarted = !r.error || r.timedOut === true;
// A TOOL THE HEADLESS REVIEWER WAS DENIED, RETRIED ONCE (decision-panel-seats.plan.md stage 6; operator, 2026-11-10:
// "A. Detect, retry once (Recommended)"): agy auto-denies a tool it cannot prompt for and ends with an empty SUCCESS, which
// read as "no parseable" (20261110-214705-sfo-remediation-3-review, its adjudicator's `run_command`). The first attempt's
// raw output is kept as raw-denied*.log and its usage added to the retry's, so neither is lost and neither counted silently.
// Only a process that exited cleanly: a failing exit is another failure, and no other failure is retried (G-4 of
// 20261110-230425-dps-remediation-6-review-b).
const entryOf = (res, startedMs, endedMs) => callEntry({
  reviewer: args.reviewer, model: model || null, table: REVIEWER_TABLE, startedMs, endedMs,
  exitCode: res?.status ?? null, signal: res?.signal ?? null,
  timedOut: res?.timedOut === true,
  // The limit this attempt ran under: a retry's is what the first attempt left (G-2 of 20261110-234941-dps-remediation-7-review).
  timeoutMinutes: Number.isFinite(callLimitMs) ? callLimitMs / 60000 : null, stdout: res?.stdout ?? '',
});
let deniedFirst = null;
let retryStartedAt = null;
if (r && !r.timedOut && !r.error && r.status === 0 && !r.signal) {
  const d = deniedEmptyAnswer(ADAPTER, r.stdout ?? '');
  if (d) {
    const firstEndedAt = Date.now();
    deniedFirst = { tools: d.tools, usage: usageFrom(ADAPTER, r.stdout ?? ''), rawRel: null, entry: entryOf(r, spawnStartedAt, firstEndedAt) };
    // On the record before the retry, so a retry that cannot be made or cannot start does not lose what the first call spent.
    reviewerUsage = deniedFirst.usage;
    reviewerCall = deniedFirst.entry;
    spawnDurationMs = firstEndedAt - spawnStartedAt;
    if (outDir) {
      try {
        const sink = confined(evidenceRoot);
        sink.dir(['evidence', nodeId]);
        const at = freeEvidenceName({ owner: sink, segments: ['evidence', nodeId] }, 'raw-denied', '.log');
        sink.create(['evidence', nodeId, path.basename(at)], [r.stdout ?? '', '\n--- stderr ---\n', r.stderr ?? '']);
        deniedFirst.rawRel = `evidence/${nodeId}/${path.basename(at)}`;
      } catch (e) {
        deniedLogNote = { item: `${args.reviewer} first attempt's raw log`, reason: `could not be written (${e.message}); the raw output of the call that was retried is lost` };
      }
    }
    const deniedText = `the first call's model tried a tool headless ${args.reviewer} may not run (${d.tools.join(', ')}); it was denied and the call returned no answer`;
    const firstRaw = deniedFirst.rawRel ? `; the first call's raw output: ${deniedFirst.rawRel}` : '';
    const left = retryLimitMs(timeoutMs, Date.now() - spawnStartedAt);
    if (left === null) {
      unavailable(`${deniedText}, and the call's limit left no time for its one retry${firstRaw}`);
    }
    retryNote = {
      item: `retried call to '${args.reviewer}'`,
      reason: `${deniedText}, so it was made once more with the same prompt and settings; the usage recorded is both calls' sum${firstRaw}`,
    };
    callLimitMs = left;
    retryStartedAt = Date.now();
    // A RETRY THAT DID NOT START ran nothing and spent nothing, so the record stays the first call's, set above. spawnCapture
    // resolves with `error` set rather than rejecting, so the result is asked as well as the catch (G-6 of
    // 20261110-234941-dps-remediation-7-review); a call stopped at its limit did start, and carries an error too.
    const retryNotStarted = (why) => {
      retryNote = { ...retryNote, reason: `${deniedText}; the second call could not be started, so the usage recorded is the first call's alone${firstRaw}` };
      unavailable(`spawn failed on the retry after a denied tool: ${why}`);
    };
    try {
      r = await callVendor();
    } catch (e) {
      retryNotStarted(e.message);
    }
    if (r.error && !r.timedOut) retryNotStarted(r.error.message);
  }
}
spawnDurationMs = Date.now() - spawnStartedAt;
// THE CALL'S ENTRY, the one shape every runtime call has (runtime-call-telemetry.plan.md stage 3): the vendor process's own
// exit code and signal reach the caller here, where only this wrapper's exit used to. A call made twice is one entry with
// both attempts in it (lib/call-entry.mjs, retriedEntry).
reviewerCall = deniedFirst
  ? retriedEntry(deniedFirst.entry, entryOf(r, retryStartedAt, spawnStartedAt + spawnDurationMs))
  : entryOf(r, spawnStartedAt, spawnStartedAt + spawnDurationMs);

// A TIMEOUT IS A TIMEOUT ON EVERY PLATFORM, and it must say so.
//
// The timeout test was `r.signal === 'SIGTERM'`, which is how POSIX reports it. Windows does not:
// spawnSync surfaces a timeout as an ERROR with code ETIMEDOUT, so the branch below caught it first
// and reported "spawn error: spawnSync cmd.exe ETIMEDOUT" — which reads as a broken transport, not
// as a reviewer that ran out of time. It cost a real investigation: panel-codex-contract failed this
// way in two consecutive runs and looked like a flaky vendor CLI, while what actually happened is
// that it needed more than the 15 minutes it was given (it took 12 in the run before).
//
// The branch itself is below the raw log (G-5).

const stdout = r.stdout ?? '';
// Harvested before anything can fail: an arm that spent tokens and THEN produced junk still spent
// them, the same rule spawn-node follows for cost on the early path.
reviewerUsage = usageFrom(ADAPTER, stdout);
// BOTH CALLS' USAGE, SUMMED AND SAID (stage 6): a retry after a denied tool spent twice, and the record says so.
if (deniedFirst) {
  reviewerUsage = sumUsage(deniedFirst.usage, reviewerUsage);
  schemaNotes.push(retryNote);
  if (deniedLogNote) schemaNotes.push(deniedLogNote);
}
// THE NAME THIS ATTEMPT ACTUALLY WROTE, remembered, because the findings below cite it. Retries
// version the log (raw.2.log, raw.3.log) while every finding still named `raw.log` — so a second
// attempt's findings pointed at the FIRST attempt's artifact, a citation to evidence that does not
// support it (G-13). Stable evidence identity is the whole premise of §3. Set only where a log is
// written: with no sink it stays null, and a finding cited a raw.log nothing created (G-7 of
// 20261016-204040-sp-bugs-remediation-review).
if (outDir) {
  rawLogRel = `evidence/${nodeId}/raw.log`;
  try {
    const sink = confined(evidenceRoot);
    sink.dir(['evidence', nodeId]);
    const at = freeEvidenceName({ owner: sink, segments: ['evidence', nodeId] }, 'raw', '.log');
    sink.create(['evidence', nodeId, path.basename(at)], [stdout, '\n--- stderr ---\n', r.stderr ?? '']);
    rawLogRel = `evidence/${nodeId}/${path.basename(at)}`;
  } catch (e) {
    // NOT SWALLOWED (G-12). This was `catch { /* best effort */ }`, after which findings still cited
    // a raw.log that was never written and run-graph counted them as an arm that reported normally —
    // silent_error_swallowing, in the one file whose findings carry an evidence path nothing else
    // can verify. The failure now rides in the envelope's not_checked[], and the findings cite nothing,
    // as they do with no sink (G-5 of 20261111-015717-dps-remediation-10-review).
    rawLogError = e.message;
    rawLogRel = null;
  }
}
// AFTER the usage harvest and the raw log (G-5 of 20261105-212751-sogsr-delivery): `unavailable` exits, so a timeout
// handled above them lost what a reviewer with partial output spent, and kept no raw evidence of the failure.
// Checked BEFORE the generic error branch, because on Windows the timeout arrives as an error.
// spawnCapture says so itself (`timedOut`), and names what the stop did: the timeout's text carries the owner's sentence,
// so a survivor the stop could not end is said, not hidden behind "timed out".
if (r.timedOut) {
  const minutesText = timeoutMs >= 60000 ? `${Math.round(timeoutMs / 60000)} minutes` : `${Math.round(timeoutMs / 1000)} s`;
  unavailable(`timed out after ${minutesText}: ${stopRecord({ outcome: r.survivor ? r.survivor.outcome : 'exited',
    pid: r.survivor ? r.survivor.pid : null, reason: 'timeout', context: 'captured' }).sentence}` +
    (outDir && !rawLogError ? ` (raw output: ${rawLogRel})` : ''));
}
if (r.error) {
  unavailable(r.error.code === 'ENOENT' ? `'${args.reviewer}' is not on PATH` : `spawn error: ${r.error.message}`);
}
if (r.status !== 0) quotaNote = quotaFrom(r.stderr, stdout);
// DENIED AGAIN ON THE RETRY (stage 6): the cause is named, with the tool, never "no parseable"; the vendor's text stays in
// raw.log (G-43).
{
  const deniedAgain = deniedFirst ? deniedEmptyAnswer(ADAPTER, stdout) : null;
  if (deniedAgain) {
    unavailable(`the model tried a tool headless ${args.reviewer} may not run (${deniedAgain.tools.join(', ')}); it was denied and `
      + 'returned no answer, on the call and on its one retry with the same prompt and settings'
      + (outDir && !rawLogError ? ` (raw output: ${[deniedFirst.rawRel, rawLogRel].filter(Boolean).join(' and ')})` : ''));
  }
}
// A STREAM'S OWN FAILURE IS THE REVIEWER'S (decision-panel-seats.plan.md stage 3): a final result whose status is not
// SUCCESS is reported as the reviewer's failure, by its status, never read as an answer that did not parse. Its error
// text is the vendor's: it decides whether this was a usage limit, and it stays in raw.log, out of the reason (G-43).
{
  const streamFailure = ndjsonFailure(ADAPTER, stdout);
  if (streamFailure) {
    if (!quotaNote) quotaNote = quotaFrom(r.stderr, streamFailure.error);
    unavailable(streamFailure.status === null
      ? `${args.reviewer}'s output held no result event (exit ${r.status})` + (outDir && !rawLogError ? `; see ${rawLogRel}` : '')
      : `${args.reviewer} reported its result as ${streamFailure.status}${streamFailure.error ? ', with an error' : ', with no error given'}`
        + (outDir && !rawLogError ? ` (its error and raw output: ${rawLogRel})` : ''));
  }
}
// ANY nonzero exit, not only one with empty stdout (G-5 of 20261109-232630-dps-delivery): a process that wrote a
// parseable answer and then failed was accepted as a valid panel result.
if (r.status !== 0) {
  // The reason is COMMITTED — see vendorFailureReason. The complete stderr is already in raw.log
  // above, on the gitignored side, which is where it stays (G-43).
  unavailable(vendorFailureReason({ status: r.status, rawLogRel: outDir && !rawLogError ? rawLogRel : null, hadOutput: Boolean(stdout.trim()) }));
}

// ---------------------------------------------------------------------------- extract the JSON
// These CLIs wrap their answer in progress chatter and often a markdown fence. Scan for balanced
// top-level objects and take the last one that looks like a verdict — the last, because a model
// that restates the schema before answering emits the example first.
function extractObjects(text) {
  const out = [];
  // ONE FORWARD PASS, no restarts.
  //
  // The original began a fresh scan at every '{' in the text, and a '{' that never closes — a brace
  // in prose, a log line, a truncated payload — scanned to end-of-text before giving up. On a long
  // stdout with sprinkled braces that is O(n^2), and stdout is exactly where these CLIs put their
  // unbounded progress chatter (G-16).
  //
  // Every COMPLETED object is emitted, at whatever nesting depth it closed, which is what makes a
  // single pass sufficient: an unmatched outer '{' no longer hides the well-formed objects inside
  // it, so there is nothing left for a retry to recover. Objects are emitted in closing order, so
  // an envelope still arrives after anything nested within it and last-one-wins is unchanged.
  const starts = [];
  let inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\' && !esc) esc = true;
      else if (ch === '"' && !esc) inStr = false;
      else esc = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    else if (ch === '{') starts.push(i);
    // A '}' with nothing open is stray punctuation, not a close: ignored, as before.
    else if (ch === '}' && starts.length) out.push(text.slice(starts.pop(), i + 1));
  }
  return out;
}
// REPORTED AND DECLINED (G-12, panel-codex-perf): the O(N x D) copying is real — every closing brace
// slices a substring, so a nested object's bytes are copied once per enclosing level. What the
// report does not account for is that every emitted candidate is then JSON.parsed by the caller, so
// the same bytes are materialised either way; returning index pairs and slicing lazily moves the
// copy rather than removing it, because nothing can filter a candidate without parsing it first.
// Emitting only depth-0 objects WOULD remove it, and is the change the comment above forbids: an
// unmatched outer brace would once again hide the well-formed objects inside it, which is the
// recovery this function exists for. It also runs only on the schemaless fallback path, which the
// run already names in not_checked[]. Unmeasured, like every perf finding in a run with no bench
// command; the condition that would flip it is a measurement.

// With a native schema the answer arrives in a known place and needs no recovery: codex writes its
// final message to --output-last-message, agy's stream-json reply ends in a result event whose
// `structured_output` holds the object. Note that result ALSO has a `status` — its own
// transport status ("SUCCESS"), not the reviewer's (any other value was reported as its failure above). Reading the wrong one would report a refusal
// as a success, so the payload is only ever taken from `structured_output`.
function nativeResult() {
  if (!nativeSchema) return null;
  return responseFrom(ADAPTER, {
    stdout,
    outFile,
    readOut: readAnswerFile,
  });
}

let p = nativeResult();

// Fallback: the prompt-and-scan path, for a reviewer running without a schema (proposal mode with
// no declared candidate fields) — and ONLY then. A native run that produced no readable payload is
// a hard failure, not an invitation to go hunting through stdout for something that looks close
// enough; that guessing is exactly what the schema was adopted to remove.
if (!p && !nativeSchema) {
  // THE ANSWER BEFORE THE TRANSPORT: the adapter's answer file when it was written, else stdout.
  const answerText = readAnswerFile(outFile);
  // A stream's answer is its final result's `response` text, never the raw stream, where it is string-escaped.
  const scanned = answerText.trim() ? answerText : schemalessText(ADAPTER, stdout);
  const found = extractObjects(scanned)
    .map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter((o) => o && typeof o === 'object' && (
      args.mode === 'propose' ? Array.isArray(o.candidates)
        : args.mode === 'tie-break' ? 'supports' in o
          // A claim checker answers {status, claims, not_checked}, with no verdict (G-4 of 20261029-050428-rdd-delivery).
          : args.mode === 'claim-check' ? Array.isArray(o.claims)
            : args.mode === 'decide' ? 'choice' in o
              : 'verdict' in o
    ));
  p = found.length ? found[found.length - 1] : null;
  // AND THE AMBIGUITY IS RECORDED, not resolved silently (G-13, panel-codex-contract). "The last
  // object that looks right" is a heuristic, and a model that illustrates the shape before
  // answering in it produces two — at which point this picks one and nothing downstream knows a
  // choice was made. The fallback stays: an adapter with no schema channel has no other way to
  // answer, and refusing outright would turn a working arm into a silent gap. What it does not get
  // to do is look like a schema-enforced result.
  if (found.length > 1) {
    schemaNotes.push({
      item: 'payload selection',
      reason: `${found.length} objects in this response matched the expected shape and the LAST was `
        + 'taken; with no schema channel there is nothing to distinguish an answer from an example',
    });
  }
}

if (!p) {
  unavailable(
    `returned no parseable ${args.mode === 'propose' ? 'proposal batch' : args.mode === 'tie-break' ? 'ruling'
      : args.mode === 'claim-check' ? 'claim-check result' : args.mode === 'decide' ? 'seat answer' : 'verdict envelope'} ` +
      (nativeSchema
        ? `(schema was enforced, so this is a transport or runtime failure; ` +
          `${outFile ? answerFileMissing(outFile) : 'the response did not parse'}` +
          `, exit ${r.status})`
        : `(${stdout.trim().length} chars of output`) +
      (rawLogError ? '; the raw output could not be written)'
        : outDir ? `; see ${rawLogRel})` : ', and neither --run-dir nor --evidence-dir was given, so the raw output was not kept)'),
  );
}

// SOFT failure: the reviewer answered and told us it could not do the job. Distinct from the hard
// failure above (no output at all), and distinct from a real result — reporting it as either would
// lose the one thing the reviewer actually told us. It is never a PASS in review mode and never an
// empty-but-fine pool in propose mode; both carry the reviewer's own words into not_checked[].
const status = typeof p.status === 'string' ? p.status.trim().toLowerCase() : '';
// A CLAIM CHECK WITH NO STATUS IS NOT A COMPLETED ONE (G-5 of 20261019-014448-ccf-delivery; operator: "G-5 for
// claim-check only (Recommended)"): its claims are graded and acted on, so a response that omits the status it must
// carry is refused rather than read as `ok`.
if (args.mode === 'claim-check' && !status) {
  unavailable('returned a claim-check result with no status — the reviewer did not say it completed the check');
}
// A SEAT WITH NO STATUS HAS NOT VOTED, by the same rule: a vote is acted on, so it must say it completed.
if (args.mode === 'decide' && !status) {
  unavailable('returned a seat answer with no status — the reviewer did not say it completed the answer');
}
if (status && status !== 'ok') {
  const why = typeof p.reason === 'string' && p.reason.trim()
    ? p.reason.trim()
    : '(no reason given, though the contract requires one)';
  if (args.mode === 'propose') {
    // KEPT, OUTSIDE `candidates` (story-pipeline, 2026-10-08): the pool stays empty, so a partial batch never reads
    // as complete, and what the proposer did return survives in `incomplete_candidates` with its count named.
    // The same accounting as a complete batch (G-8 of 20261008-175234-cpool-and-design-step): an empty candidate is
    // dropped AND counted, and the proposer's own not_checked[] and the schema notes are kept, not replaced.
    const raw = Array.isArray(p.candidates) ? p.candidates : [];
    const partial = raw.filter((c) => c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length);
    const dropped = raw.length - partial.length;
    emitProposal({
      incomplete_candidates: partial,
      not_checked: [
        ...schemaNotes,
        { item: `external proposer '${args.reviewer}'`, reason: `reported status '${status}': ${why}` },
        ...(partial.length ? [{
          item: `${partial.length} candidate(s) from '${args.reviewer}'`,
          reason: `returned with status '${status}', so they are kept in incomplete_candidates and not counted as the pool`,
        }] : []),
        ...(dropped ? [{
          item: `${dropped} candidate(s) from '${args.reviewer}'`,
          reason: 'returned with no fields; an empty candidate cannot be filtered against the stated constraints and is not counted as an option',
        }] : []),
        ...(Array.isArray(p.not_checked) ? p.not_checked.filter((n) => n && n.item && n.reason) : []),
      ],
    });
  }
  unavailable(`reported status '${status}': ${why}`);
}
if (args.mode === 'claim-check') {
  // THE SHAPE claim-check.mjs WILL APPLY ITS RULES TO, checked here too: the vendor was ASKED to honour the schema, which
  // is not the same as having honoured it (contract-audit, I-8). The adapter's own status and reason stay out of it.
  const result = { schema_version: 1, claims: p.claims, not_checked: p.not_checked };
  const errors = resultShapeErrors(result);
  if (errors.length) unavailable(`returned a result claim-check.mjs would refuse: ${errors.slice(0, 3).join('; ')}`);
  emitClaimCheck({ result, not_checked: schemaNotes });
}
if (args.mode === 'decide') {
  // THE SEAT'S ANSWER AS THE PANEL READS IT: `rationale` becomes the vote's `reason`, and the strict schema's empty
  // `other_text` / `change_of` are dropped rather than recorded as values. The shape is checked again here, because the
  // vendor was ASKED to honour the schema, which is not the same as having honoured it.
  // The status was checked above; seatAnswerOf (lib/decision-panel.mjs) is the one mapping both seat transports use.
  const { result, why } = seatAnswerOf({ ...p, status: 'ok' });
  if (!result) unavailable(`returned a seat answer the panel would refuse: ${why}`);
  emitDecision({ result, not_checked: schemaNotes });
}
if (args.mode === 'tie-break') {
  // `supports` is validated by the CALLER against the group's actual participants — the schema
  // cannot know per-run node ids. Here it is only normalised: a missing one is null, never "" or a
  // guess, so an absent ruling stays distinguishable from a ruling of "neither".
  const supports = typeof p.supports === 'string' && p.supports.trim() ? p.supports.trim() : null;
  emitRuling({
    supports,
    confidence: ['high', 'medium', 'low'].includes(p.confidence) ? p.confidence : null,
    rationale: typeof p.rationale === 'string' ? p.rationale : '',
    not_checked: [
      ...schemaNotes,
      ...(supports ? [] : [{
        item: `tie-breaker '${args.reviewer}'`,
        reason: 'the response named no supported position, so the dispute stands unresolved',
      }]),
      ...(Array.isArray(p.not_checked) ? p.not_checked.filter((n) => n && n.item && n.reason) : []),
    ],
  });
}
if (args.mode === 'propose') {
  // Review mode normalises severity, file, line and claim before emitting; proposal mode used to
  // pass `candidates` straight through, so a proposer answering `{"candidates":[{},{}]}` produced
  // a pool that looked full and carried nothing. An empty candidate is the proposal-mode form of
  // the silent PASS this adapter exists to prevent: drop it, and say how many were dropped.
  //
  // Guarded, not assumed: the fallback path filters for `Array.isArray(candidates)` before getting
  // here, but the native path takes whatever the reviewer's structured output contained. An
  // unhandled throw here would break this script's ONE guarantee — that it always prints exactly
  // one structured response — and turn a malformed answer into no answer at all.
  const raw = Array.isArray(p.candidates) ? p.candidates : [];
  const kept = raw.filter((c) => c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length);
  const dropped = raw.length - kept.length;
  emitProposal({
    candidates: kept,
    not_checked: [
      ...schemaNotes,
      ...(Array.isArray(p.candidates) ? [] : [{
        item: `proposal batch from '${args.reviewer}'`,
        reason: 'the response carried no candidates array; treated as an empty pool rather than crashing',
      }]),
      ...(Array.isArray(p.not_checked) ? p.not_checked.filter((n) => n && n.item && n.reason) : []),
      ...(dropped
        ? [{
            item: `${dropped} candidate(s) from '${args.reviewer}'`,
            reason: 'returned with no fields; an empty candidate cannot be filtered against the stated constraints and is not counted as an option',
          }]
        : []),
      ...(kept.length ? [] : [{
        item: `external proposer '${args.reviewer}'`,
        reason: 'returned a well-formed batch containing no usable candidate',
      }]),
    ],
  });
}
const findings = Array.isArray(p.findings) ? p.findings : [];

// The ladder is BLOCKER|HIGH|MEDIUM|LOW. External models routinely say CRITICAL or SEVERE, which
// are not in the enum: mapping them onto the nearest real rung keeps the finding rather than
// silently flattening a serious claim to LOW.
//
// THE CAP ITSELF IS DECLARED, NOT HARDCODED (G-14). It was the literal `MEDIUM` in this function,
// while run-graph and finding-scope both carried comments saying the ROSTER capped the arm and no
// arm entry carried a ceiling at all — so an auditor asking what bounds a third-party reviewer's
// authority looked in the declared place and found nothing, and changing it meant editing a script.
// `--severity-ceiling` comes from lens-roster.json's panel_arms; MEDIUM remains the fallback for a
// caller outside the graph (/request), because an arm's basis is `convention` and §4 caps that at
// MEDIUM regardless of what any config says.
// THE SHARED LADDERS, not a second copy (G-14, panel-codex-arch). Both rungs lists were literals
// here while lib/decisions.mjs exports them and every other orchestration module imports them — so
// adding a rung would have made this adapter reject a value the rest of the system had agreed on,
// and fall back to MEDIUM without a word. The order differs (SEVERITY_RUNGS runs weakest-first);
// membership is the question here, so it does not matter, and taking the list from its owner is
// what stops the two from disagreeing about what a rung IS.
const SEVERITY_CEILING = SEVERITY_RUNGS.includes(String(args.severityCeiling ?? '').toUpperCase())
  ? String(args.severityCeiling).toUpperCase()
  : 'MEDIUM';
// THE BASIS THIS ARM EMITS, checked against what its runtime is permitted to claim (G-15).
// `convention` was a literal on every finding while run-graph derived an `allowed_basis` enum and
// wrote it into nodes/expected.json — so the artifact described a permission that governed nothing,
// and an adapter declaring evidence_capture was capped anyway. It is still `convention` for every
// adapter that ships, and it is still the only basis THIS script can substantiate: the evidence path
// it emits is the reviewer's raw log, which the run cannot re-derive. The difference is that the
// permission is now checked rather than assumed, and an arm whose runtime is not permitted even
// `convention` refuses at spawn rather than emitting findings the reconciler will drop.
// The refusal itself is at ARGUMENT-PARSE TIME (G-13) — see ARM_BASIS above, declared beside the
// other argument checks. Here it is only the value the emitters stamp.

// TIGHTENED BY THE BASIS ACTUALLY EMITTED, not only by the ceiling the graph passed. A runtime that
// declares evidence_capture lifts the derived ceiling to what `measurement` allows, but this script
// still emits `convention` — and §4 caps convention at MEDIUM, so honouring the higher ceiling would
// hand validateVerdict a finding it REJECTS, and the finding would vanish instead of landing at its
// honest weight. Two rules, both applied, the stricter one wins.
const BASIS_CEILING = CONSERVATIVE_BASIS[ARM_BASIS]?.severity_ceiling ?? 'MEDIUM';
const EFFECTIVE_CEILING =
  SEVERITY_RUNGS.indexOf(BASIS_CEILING) < SEVERITY_RUNGS.indexOf(SEVERITY_CEILING)
    ? BASIS_CEILING
    : SEVERITY_CEILING;

const capSeverity = (s) => capArmSeverity(s, EFFECTIVE_CEILING);

emit(
  envelope({
    // Capped at RISK, never FAIL. Every finding this arm produces is basis=convention with an
    // unverifiable evidence path, so a FAIL would be a run-level verdict resting on nothing the
    // run can check — and writeGate promotes any FAIL to a FAIL gate. That is the cheap-reviewer
    // cascade the design exists to prevent, arriving through the panel instead of through a
    // cheap model. The external arm contributes a perspective; corroboration with a lens is what
    // makes it actionable, and reconcile is where that judgement belongs.
    //
    // An out-of-range verdict lands on the ceiling by the same route: the arm reviewed something,
    // but its own summary cannot be taken at face value. lens-roster.json declares RISK per arm (G-14),
    // and it is RISK for every caller (VERDICT_CEILING above).
    verdict: p.verdict === 'PASS' ? 'PASS' : VERDICT_CEILING,
    findings: findings.map((f) => ({
      // An external arm has no capture.mjs and therefore no evidence path this run can verify,
      // so its basis is `convention` — and §4 caps convention at MEDIUM. Emitting HIGH here
      // would not make the finding stronger; validateVerdict would REJECT it and the whole
      // finding would vanish silently, which is worse than reporting it at its honest weight.
      // The arm contributes a perspective; it cannot by itself carry a FAIL.
      severity: capSeverity(f.severity),
      basis: ARM_BASIS,
      file: typeof f.file === 'string' ? f.file : '(unspecified)',
      line: Number.isInteger(f.line) ? f.line : 0,
      claim: typeof f.claim === 'string' ? f.claim : JSON.stringify(f).slice(0, 500),
      evidence_path: rawLogRel,
    })),
    checked_clean: Array.isArray(p.checked_clean) ? p.checked_clean.filter((s) => typeof s === 'string') : [],
    not_checked: [
      ...(Array.isArray(p.not_checked) ? p.not_checked.filter((n) => n && n.item && n.reason) : []),
      ...schemaNotes,
      ...verdictCeilingNotes,
      ...runtimeNotChecked(),
      ...(outDir ? [] : [{
        item: `${args.reviewer} raw log`,
        reason: 'not kept: neither --run-dir nor --evidence-dir was given, so the findings cite no evidence file',
      }]),
      {
        item: 'evidence paths',
        reason: `${args.reviewer} runs outside the run sandbox and cannot produce verifiable evidence; findings are capped at basis=convention`,
      },
    ],
  }),
);
