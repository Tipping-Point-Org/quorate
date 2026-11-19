#!/usr/bin/env node
// decide — a question with options answered by the decision panel instead of the operator (autonomous-run.plan.md
// stage 5; autonomous-run.md criteria 1, 6, 7, 9, 10, 11, 14-17).
//
//   decide.mjs --question <file.json> [--json]      run the panel; the file is {question, options[{label,description}],
//                                                   category, stage?, since?}
//   decide.mjs --revote <id> [--json]               a fresh blind vote, after a talk with no majority, on a note a fresh
//                                                   blind subagent writes from the question, its options and the work context
//   decide.mjs --pending                            the postponed decisions waiting on the operator
//   decide.mjs --overrule <id> --operator-quote "<words>"   the operator's reversal, recorded; nothing is redone
///   decide.mjs --count-spend <id>                   one spend started on decision <id>, refused at review.run_spend_max
//   decide.mjs --sample [--size <n>]                the n newest decisions the panel took, not yet marked (stage 8);
//                                                   n is SAMPLE_DEFAULT when --size is not given
//   decide.mjs --sample-mark <id> --mark agree|differ --operator-quote "<words>"   the operator's mark on one of them
//   [--repo-root <dir>] [--runtime-bin <path>]      the repository; a fake node-runtime binary (tests)
//
// The seats are the node runtime (a fresh subagent, at the contract's judgment model and effort, built by runtimeCall in
// lib/decision-panel.mjs) and the roster's `decision_panel.seats` (through external-review.mjs --mode decide). Every seat,
// the moderator (a second fresh subagent that does not vote) and the revote note's author stand in a directory of their
// own outside the repository, so none starts where the decision record is (decision-records.plan.md stage 5); every seat's
// and the revote author's holds copies of the paths its work context names, the moderator's nothing (stage 1, and stage 6
// of decision-panel-seats.plan.md for the external seats).
// That limits what a seat finds, not what it can read: a path it is given or guesses is still readable (G-2 of
// 20261104-171128-epo-remediation-3-review; shared/external-reviewers.md).
// No CLI is named here (A-9). Every decision's record is under .claude/decisions/<id>/, which git ignores: it holds
// model text.
//
// Exit: 0 the action completed (any outcome) · 1 it failed · 2 usage or a refusal, with its reason · 3 depth · 4 the
// spend bound is reached.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nodeDepth } from './lib/node-depth.mjs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { runtimeBinArg, runtimeBinArgv } from './io/runtime-bin.mjs';
import { checkCategory, workContextText, panelAttribution, spendAllowed, sampleCandidates, sinceGitArgs, seatFamilyErrors, blindQuestion, SAMPLE_MARKS, SAMPLE_DEFAULT } from './lib/decision-panel.mjs';
import { panelUsable, decisionRoundsOf, runSpendMaxOf, groundingFloorOf } from './lib/autonomous-keys.mjs';
import { seatBasis, stageHeading, runtimeCall, questionEvidenceError, questionEvidence, seatCopyPaths, QUORUM } from './lib/decision-panel.mjs';
import { copyIntoSeatDir } from './io/seat-copies.mjs';
import { writeAllSync } from './io/write-all.mjs';
import { buildRevoteAuthorPrompt } from './io/review-prompts.mjs';
import { familyOfCall } from './lib/reviewers.mjs';
import { basisValues } from './io/basis-values.mjs';
import { hostPlatform } from './platform/index.mjs';
import { runDecision, finalOutcome, recordStore } from './io/decision-run.mjs';
import { confined } from './io/confined-path.mjs';
import { egress, egressReadFile } from './io/egress-read.mjs';
import { contractGlobErrors, parseGlob } from './lib/contract-glob.mjs';
import { readContract } from './io/contract-reader.mjs';
import { acquireFileLock } from './io/atomic.mjs';
import { readRunState } from './io/run-state.mjs';
import { stopHeldOnExit } from './io/stop-on-exit.mjs';
import { gitSync } from './io/git.mjs';
import { quorateHome, defaultReviewsRoot } from './io/reviews-root.mjs';
import { readTemplate, renderTemplate } from './io/template.mjs';
import { selectAdapters, subagentNotices } from './io/reviewers.mjs';

// THE RECURSION GUARD, FIRST (§8): a graph node may not start graph work, and the panel spawns models. Criterion 11:
// children do not inherit the flag, because a child cannot run this at all.
const { raw: RAW_DEPTH, depth: PARSED_DEPTH } = nodeDepth(process.env);
if (PARSED_DEPTH === null) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} is not a non-negative integer — refusing to guess whether this is nested (§8).`);
  process.exit(3);
}
if (PARSED_DEPTH > 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${PARSED_DEPTH} — a graph node may not ask the decision panel (§8).`);
  process.exit(3);
}

const die = (msg, code = 2) => { console.error(`decide: ${msg}`); process.exit(code); };
let opts;
try { ({ values: opts } = parseArgv(process.argv.slice(2), ARGV_SPECS.decide)); } catch (e) {
  if (!(e instanceof ArgvError)) throw e;
  die(e.message);
}
// --runtime-bin, or its alias for one release, through the pair's one owner (io/runtime-bin.mjs).
let RUNTIME_BIN_GIVEN = null;
try { RUNTIME_BIN_GIVEN = runtimeBinArg(opts); } catch (e) { die(e.message); }
const modes = ['question', 'revote', 'pending', 'overrule', 'count-spend', 'sample', 'sample-mark'].filter((k) => opts[k] !== undefined && opts[k] !== false);
if (modes.length !== 1) die('give exactly one of --question, --revote, --pending, --overrule, --count-spend, --sample, --sample-mark');
// --size IS --sample'S (G-2 of 20261103-191032-dr-remediation-3-review): accepted silently with another mode, it read as obeyed.
if (opts.size !== undefined && modes[0] !== 'sample') die('--size is valid only with --sample');
if (opts.mark !== undefined && modes[0] !== 'sample-mark') die('--mark is valid only with --sample-mark');
// --operator-quote IS --overrule'S AND --sample-mark'S (G-1 of 20261103-211624-dr-remediation-4-review): accepted with
// another mode, the operator's words were silently ignored.
if (opts['operator-quote'] !== undefined && !['overrule', 'sample-mark'].includes(modes[0])) die('--operator-quote is valid only with --overrule or --sample-mark');

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
let repoRoot = opts['repo-root'] ? path.resolve(opts['repo-root']) : null;
if (!repoRoot) {
  const top = gitSync(['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0) die('not inside a git repository');
  repoRoot = path.resolve(top.stdout.trim());
}
const decisionsRoot = path.join(repoRoot, '.claude', 'decisions');
const ID = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;
// EVERY PATH BELOW .claude/decisions THROUGH THE ONE OWNER (decision-records.plan.md stage 6; DR-D5 A; ARCHITECTURE
// A-30): `confined`, rooted at the repository's real path, walking `.claude`, `decisions` and each name below them, so a
// link or junction standing at any of those levels is refused, never followed, for every read and write here.
// THE ROOT AS NAMED, never its real path (G-2 of 20261102-211111-rbr-remediation-4-review): realpathSync resolved a link
// or junction at --repo-root before the owner's root check could see it. repoRoot is absolute (path.resolve above).
const REPO_REAL = repoRoot;
const owner = confined(REPO_REAL);
const D = (...names) => ['.claude', 'decisions', ...names];
/** The record store of a decision (or its revote, `sub`), for runDecision and finalOutcome. */
const storeOf = (id, sub = null) => recordStore(path.join(decisionsRoot, id, ...(sub ? [sub] : [])), { root: REPO_REAL, prefix: D(id, ...(sub ? [sub] : [])) });
/** A confined call whose refusal is this script's: a link where a record should be is a refusal, reported (exit 2). */
const held = (fn) => { try { return fn(); } catch (e) { if (e?.code === 'ECONFINED') die(e.message, 2); throw e; } };

/** The record directory of an existing decision, refused when the id is not one this script makes. */
function decisionDir(id) {
  if (!ID.test(String(id ?? ''))) die(`${JSON.stringify(id)} is not a decision id (YYYYMMDD-HHMMSS-xxxxxx)`);
  if (!held(() => owner.exists(D(id, 'question.json')))) die(`no decision ${id} under ${decisionsRoot}`);
  return path.join(decisionsRoot, id);
}
/** A decision's final outcome, read through the owner; an unreadable one stops the command (G-4 of 20261101-042446-ar-remediation-4-review). */
const outcomeOfId = (id) => {
  try { return held(() => finalOutcome(path.join(decisionsRoot, id), storeOf(id))); } catch (e) { die(e.message, 1); }
};

/** Why a revote is refused while the decision's revote directory exists. */
function revoteHeld(dir) {
  return `decision ${path.basename(dir)} is already being revoted, or a revote stopped without an outcome: `
    + `${path.join(dir, 'revote')} holds it (remove that directory to revote again)`;
}

/** The decisions folder, made ignored by git before anything model-written lands in it (as claim-check's is). */
function ensureDecisionsRoot() {
  held(() => owner.dir(D()));
  if (!held(() => owner.exists(D('.gitignore')))) held(() => owner.replace(D('.gitignore'), '# Written by quorate decide: seats\' answers are model text, never committed.\n*\n'));
  const probe = path.join(decisionsRoot, 'question.json');
  if (gitSync(['check-ignore', '-q', probe], { cwd: repoRoot }).status !== 0) {
    die(`${path.relative(repoRoot, decisionsRoot)} is NOT ignored by git here; a decision record is model text and must not be committed`, 1);
  }
}

function newId() {
  const n = new Date();
  const two = (v) => String(v).padStart(2, '0');
  return `${n.getUTCFullYear()}${two(n.getUTCMonth() + 1)}${two(n.getUTCDate())}-${two(n.getUTCHours())}${two(n.getUTCMinutes())}`
    + `${two(n.getUTCSeconds())}-${crypto.randomBytes(3).toString('hex')}`;
}

function readContractOrDie() {
  const read = readContract({ repoRoot });
  if (!read.contract) die(`no contract to read the panel's keys from: ${read.error ?? read.message ?? 'graph_contract absent'}`);
  return read.contract;
}

/**
 * THE OPERATOR'S FIRST WORDS, WRITTEN ONCE (G-5 and G-7 of 20261101-023925-ar-remediation-2-review): the check that no
 * record exists and the write are one step under a lock, as --count-spend's are, so two invocations started together
 * cannot both pass the check and have the later rename replace the first record. Through the owner (stage 6).
 */
function firstWordsOnly(segs, record, heldMessage) {
  const release = acquireFileLock(`${held(() => owner.resolve(segs))}.lock`);
  if (held(() => owner.exists(segs))) { release(); die(heldMessage); }
  try { held(() => owner.replace(segs, `${JSON.stringify(record, null, 2)}\n`)); } finally { release(); }
}

// ------------------------------------------------------------------------------------------------- --overrule, --pending
if (opts.overrule !== undefined) {
  const dir = decisionDir(opts.overrule);
  const quote = String(opts['operator-quote'] ?? '').trim();
  if (!quote) die('--overrule needs --operator-quote "<the operator\'s words>": only the operator reverses a decision');
  if (!outcomeOfId(opts.overrule)) die(`decision ${opts.overrule} has no outcome yet`);
  // ONE OVERRULE (G-7 of 20261101-014615-ar-delivery-remediation-review): a second would replace the operator's first
  // words and their time, and the record is the audit of what the operator reversed.
  firstWordsOnly(D(opts.overrule, 'overrule.json'), { at: new Date().toISOString(), operator_quote: quote },
    `decision ${opts.overrule} is already overruled (${path.join(dir, 'overrule.json')}); the first words stand`);
  console.log(`decide: ${opts.overrule} overruled by the operator ("${quote}"); nothing is redone automatically (criterion 6)`);
  process.exit(0);
}
if (opts.pending) {
  let names = [];
  // ONLY AN ABSENT FOLDER IS "NONE YET" (G-6 of 20261101-023925-ar-remediation-2-review): any other failure would report
  // zero decisions waiting while they wait.
  try { names = owner.list(D()).filter((n) => ID.test(n)).sort(); } catch (e) {
    if (e?.code !== 'ENOENT') die(`${decisionsRoot} cannot be read (${e?.message ?? e?.code}); the pending decisions are unknown`, 1);
  }
  const pending = names.filter((n) => ['postponed', 'to-operator', 'seats-unavailable'].includes(outcomeOfId(n)?.outcome) && !held(() => owner.exists(D(n, 'overrule.json'))));
  // WRITTEN WHOLE BEFORE THE EXIT (G-2 of 20261112-063354-hl-remediation-4-review): one console.log a decision, then
  // process.exit, could cut the listing short on a POSIX pipe and omit a decision waiting on the operator.
  // ROW BY ROW (G-3 of 20261112-073408-hl-remediation-5-review): each row is written whole, synchronously, as it is
  // formed, so the listing is never held in memory; every byte is still written before the exit.
  const row = (s) => writeAllSync(1, `${s}\n`, { retry: ['EAGAIN'] });
  for (const n of pending) {
    const q = JSON.parse(held(() => owner.read(D(n, 'question.json'))));
    row(`${n}  ${String(q.question ?? '').split('\n')[0].slice(0, 120)}`);
  }
  row(`decide: ${pending.length} postponed decision(s) waiting on the operator`);
  process.exit(0);
}

// -------------------------------------------------------------------------------------------------------- --count-spend
// ------------------------------------------------------------------------------------------------ --sample, --sample-mark
// THE OPERATOR'S CHECK OF DELEGATED DECISIONS (autonomous-run.plan.md stage 8; design AR-D8): a few of the decisions the
// panel took, marked agree or differ in the operator's words, so the report can say whether delegation was sound beside
// how often it was reversed. Only the operator's words record a mark.
if (opts.sample) {
  const size = opts.size === undefined ? String(SAMPLE_DEFAULT) : String(opts.size);
  const n = /^\d+$/.test(size) ? Number(size) : NaN;
  let picked;
  try {
    const names = held(() => owner.exists(D())) ? held(() => owner.list(D())).filter((x) => ID.test(x)) : [];
    picked = sampleCandidates(names.map((id) => ({
      id, final: outcomeOfId(id), sampled: held(() => owner.exists(D(id, 'sample.json'))),
    })), n);
  } catch (e) { die(`${e.message} (the suggested size is ${SAMPLE_DEFAULT})`); }
  // Written whole before the exit, as --pending is (G-2 of 20261112-063354-hl-remediation-4-review), and row by row as
  // --pending is (G-4 of 20261112-073408-hl-remediation-5-review): the listing is not held in memory.
  const row = (s) => writeAllSync(1, `${s}\n`, { retry: ['EAGAIN'] });
  for (const d of picked) {
    let q = '';
    // Shown as unreadable, never blank (G-5 of 20261105-181450-crsf-d1-remediation-2-review): a blank question read as a
    // valid record, and the operator was asked to mark a decision without its context.
    try { q = JSON.parse(held(() => owner.read(D(d.id, 'question.json')))).question ?? ''; } catch (e) { q = `[question.json unreadable: ${e?.code ?? e?.message}]`; }
    row(`${d.id}  ${q}  →  ${d.final.label ?? d.final.entry}  (${d.final.agreement})`);
  }
  row(`decide: ${picked.length} decision(s) to sample; mark each with --sample-mark <id> --mark ${SAMPLE_MARKS.join('|')} --operator-quote "<words>"`);
  process.exit(0);
}
if (opts['sample-mark'] !== undefined) {
  const dir = decisionDir(opts['sample-mark']);
  const quote = String(opts['operator-quote'] ?? '').trim();
  if (!quote) die('--sample-mark needs --operator-quote "<the operator\'s words>": only the operator marks a sampled decision');
  if (!SAMPLE_MARKS.includes(opts.mark)) die(`--mark must be one of ${SAMPLE_MARKS.join(' | ')}`);
  if (outcomeOfId(opts['sample-mark'])?.outcome !== 'majority') die(`decision ${opts['sample-mark']} was not taken by the panel, so there is nothing to mark`);
  // ONE MARK (G-8 of 20261101-014615-ar-delivery-remediation-review), as one overrule: the first mark and quote stand.
  firstWordsOnly(D(opts['sample-mark'], 'sample.json'), { at: new Date().toISOString(), mark: opts.mark, operator_quote: quote },
    `decision ${opts['sample-mark']} is already marked (${path.join(dir, 'sample.json')}); the first mark stands`);
  console.log(`decide: ${opts['sample-mark']} marked ${opts.mark} by the operator ("${quote}")`);
  process.exit(0);
}

if (opts['count-spend'] !== undefined) {
  decisionDir(opts['count-spend']);
  const max = runSpendMaxOf(readContractOrDie().review ?? {});
  // PER RUN (G-3 of 20261101-005402-ar-delivery): a spend belongs to the active run, stage 7's run state, named by its
  // plan and start time, so a run crossing midnight keeps its count and two runs never share one. No active run is
  // refused: review.run_spend_max bounds a run, and there is none to bound.
  let state;
  try { state = readRunState(repoRoot); } catch (e) { die(`the active run's state cannot be read: ${e.message}`, 1); }
  if (!state) die('no active run to count a spend against: start one with run-session.mjs start --plan <plan>');
  const runKey = `${state.plan}@${state.started_at}`;
  const file = path.join(decisionsRoot, 'spends.json');
  const SPENDS = D('spends.json');
  // ONE WRITER AT A TIME (G-5): the read, the check and the write are one step under a lock, so two spends started
  // together cannot both pass at the same count.
  const release = acquireFileLock(`${held(() => owner.resolve(SPENDS))}.lock`);
  const refuse = (msg, code) => { release(); die(msg, code); };
  let spends = {};
  let present;
  try { present = owner.exists(SPENDS); } catch (e) { refuse(e.message, 1); }
  if (present) {
    // A RECORD THAT CANNOT BE READ IS REFUSED, NEVER RESET (G-4): it is the count of spends already made, and reading
    // it as empty would let the next spend overwrite it and start the bound again.
    try { spends = JSON.parse(owner.read(SPENDS)); } catch (e) {
      refuse(`${file} cannot be read as JSON (${e.message}); it records the spends already made, so nothing is counted until it is repaired`, 1);
    }
    if (!spends || typeof spends !== 'object' || Array.isArray(spends)) {
      refuse(`${file} is not an object of runs; it records the spends already made, so nothing is counted until it is repaired`, 1);
    }
  }
  // A RUN'S ENTRY THAT IS NOT A LIST IS REFUSED TOO (G-9 of 20261101-014615-ar-delivery-remediation-review), as the
  // whole record is: counting it as empty would overwrite the spends it holds.
  if (Object.hasOwn(spends, runKey) && !Array.isArray(spends[runKey])) {
    refuse(`${file} records the run on ${state.plan} as something other than a list of spends; nothing is counted until it is repaired`, 1);
  }
  const mine = spends[runKey] ?? [];
  if (!spendAllowed(mine.length, max)) {
    refuse(`review.run_spend_max (${max}) is reached for the run on ${state.plan}: end the run with a last line \`Stop: limit — spend bound\``, 4);
  }
  // ONLY THE ACTIVE RUN IS KEPT (G-8 of 20261101-023925-ar-remediation-2-review): one run is active at a time, so every
  // other key is a run that ended, whose count bounds nothing; kept, the file and each rewrite of it grew without bound.
  spends = { [runKey]: [...mine, { at: new Date().toISOString(), decision: opts['count-spend'] }] };
  try { owner.replace(SPENDS, `${JSON.stringify(spends, null, 2)}\n`); } catch (e) { refuse(e.message, 1); }
  release();
  console.log(`decide: spend ${spends[runKey].length}${max === null ? '' : ` of ${max}`} for the run on ${state.plan}, on ${opts['count-spend']}`);
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------- --question, --revote
let question; let dir; let phase = 'first'; let recordDir;
if (opts.question !== undefined) {
  // THROUGH THE EGRESS OWNER (hardlink-egress.plan.md stage 2): the question goes to every seat's vendor, so a link or a
  // file with a second name is refused before any record is made.
  let questionText;
  try { questionText = egressReadFile(path.resolve(String(opts.question)), 'utf8', { repoRoot: REPO_REAL }); } catch (e) {
    die(`the question file could not be read: ${e.message}`);
  }
  try { question = JSON.parse(questionText); } catch (e) {
    die(`the question file could not be read as JSON: ${e.message}`);
  }
  // RESERVED FIRST, FLAG ON OR OFF (design AR-D6): a decision the operator holds never reaches the panel.
  const cat = checkCategory(question?.category);
  if (!cat.ok) die(cat.reason);
  // A QUESTION WITH OPTIONS, CHECKED HERE (G-10 of 20261101-032931-ar-remediation-3-review): runDecision's check came
  // after the record directory was made, so a malformed question left a record the panel was never asked about.
  try { blindQuestion(question); } catch (e) { die(e.message); }
  // THE EVIDENCE IT NAMES (grounding-and-retry-evidence.plan.md stage 1): refused before a record exists, as the options
  // are. An absolute entry is judged below, once the contract names the reviews directories it may sit under (G-3 of
  // 20261104-004602-gre-remediation-review).
  const evidenceError = questionEvidenceError(question?.evidence, { rootsLater: true });
  if (evidenceError) die(evidenceError);
} else {
  dir = decisionDir(opts.revote);
  // A RECORD FILE WHOSE TEXT GOES TO THE SEATS IS A FILE, NEVER A LINK (G-9 of 20261101-032931-ar-remediation-3-review;
  // ARCHITECTURE A-30): read through the owner, which refuses a link at the file and at every level above it (stage 6).
  // THE EGRESS OWNER, not `confined` (G-5 of 20261112-035452-hl-delivery): this text goes to every seat's vendor, so a
  // hard-linked record, a second name for another file, is refused as the --question path refuses one.
  const readRecord = (name) => {
    try { return egress(REPO_REAL).read(D(opts.revote, name)); } catch (e) {
      if (e?.code === 'ECONFINED') die(e.message, 2);
      if (e?.code === 'ENOENT') die(`no ${name} in the record: ${path.join(dir, name)}`);
      die(`${path.join(dir, name)} could not be read: ${e.message}`, 1);
    }
  };
  try { question = JSON.parse(readRecord('question.json')); } catch (e) { die(`the record's question is not JSON: ${e.message}`, 1); }
  let first;
  try { first = JSON.parse(readRecord('outcome.json')); } catch (e) { die(`the record's outcome is not JSON: ${e.message}`, 1); }
  if (first?.outcome !== 'revote') die(`decision ${opts.revote} did not end without a majority, so there is nothing to revote`);
  // RESERVED FIRST, ON A REVOTE TOO (G-10 of 20261101-042446-ar-remediation-4-review): a record whose category is
  // reserved, missing or unknown is refused before the contract is read, as --question's is.
  const cat = checkCategory(question?.category);
  if (!cat.ok) die(cat.reason);
  // VALIDATED BEFORE THE CLAIM (G-14 of the same review): a saved question with malformed options would make the panel
  // fail after the claim exists, and every later revote would be held until the claim was removed by hand.
  try { blindQuestion(question); } catch (e) { die(`the record's question cannot be asked: ${e.message}`); }
  // ONE REVOTE (G-6 of 20261101-005402-ar-delivery): a finished revote is the decision's outcome, and a second would
  // overwrite it; only the operator reverses one (--overrule).
  if (held(() => owner.exists(D(opts.revote, 'revote', 'outcome.json')))) {
    die(`decision ${opts.revote} is already revoted (${outcomeOfId(opts.revote)?.outcome ?? 'recorded'}); only the operator reverses it, with --overrule`);
  }
  // ONE REVOTE AT A TIME (G-11 of 20261101-014615-ar-delivery-remediation-review): the check above sees only a finished
  // revote, so two started together both passed it and wrote one record. A revote's directory is its claim, made below
  // with a mkdir that fails if it exists; one already there is a revote running, or one stopped without an outcome.
  if (held(() => owner.exists(D(opts.revote, 'revote')))) die(revoteHeld(dir));
  phase = 'revote';
}
// THE SINCE IS A COMMIT, CHECKED FIRST (G-12 of 20261101-014615-ar-delivery-remediation-review): a revision git cannot
// read made `git diff` fail, and the failure was read as no changed files, so the panel decided with an empty work
// context and was never told.
let since;
try { since = sinceGitArgs(question.since); } catch (e) { die(e.message); }
if (gitSync(['rev-parse', '--verify', '--quiet', `${since[0]}^{commit}`], { cwd: repoRoot }).status !== 0) {
  die(`the question's since ${JSON.stringify(since[0])} is not a commit in ${repoRoot}; the work context would be empty`);
}
const contract = readContractOrDie();
const review = contract.review ?? {};
const usable = panelUsable(review);
if (!usable.ok) die(usable.reason);
let caps;
try { caps = decisionRoundsOf(review); } catch (e) { die(e.message); }
// The revote is one blind vote on the note (design AR-D4): no talk, no moderator.
if (phase === 'revote') caps = { cap: 1, hardCap: 1 };
// THE FLOOR IN FORCE (decision-records.plan.md stages 2-3; ARCHITECTURE A-22): a decision whose basis, set from its
// majority's citations, is below it goes to the operator.
let floor;
try { floor = groundingFloorOf(review, basisValues()); } catch (e) { die(e.message); }
const IO = hostPlatform();
// Undeclared, a live run is staged under the engine's home, where new-run puts it (G-6 of
// 20261103-040939-rbr-remediation-9-review): that root grounds a seat as the archive does.
const stagingRoot = typeof review.reviews_dir === 'string' && review.reviews_dir.trim() ? null : defaultReviewsRoot({ project: contract.project ?? null, repoRoot });
// Below the reviews directories seatBasis grades against, an absolute entry is allowed (G-3 of
// 20261104-004602-gre-remediation-review); still before the record directory exists. ON A REVOTE TOO (G-1 of
// 20261104-020352-gre-remediation-2-review): the list is read from the record, which can be edited, and it reaches the
// external seats, so it is held to the same roots before the revote's claim is made. Letter case is the platform's.
// NORMALIZED ONCE, AT THE READ OF THE QUESTION (evidence-path-owner.plan.md stage 3; design EP-D2 C): every entry through
// lib/evidence-path.mjs, then checked for a link through the confined owner of its root before the record exists (G-2 of
// 20261104-030455-gre-remediation-3-review: the list was checked by its spelling, so a link below a reviews root passed
// until a seat cited it). The record keeps the canonical spellings, so a revote reads normal forms and checks them again.
let questionEntries = [];
{
  const { entries, error } = questionEvidence(question?.evidence, { repoRoot, reviewsDir: review.reviews_dir ?? '', stagingRoot, caseInsensitive: IO.caseInsensitiveFs });
  const prefix = phase === 'revote' ? "the record's question cannot be asked: " : '';
  if (error) die(prefix + error);
  for (const [i, e] of entries.entries()) {
    let st = null;
    try { st = confined(e.root).stat(e.rel.split('/')); } catch (err) {
      die(prefix + (err?.code === 'ECONFINED'
        ? `the question's evidence[${i}] (${e.canonical}) reaches its file through a link (${err.message}); only a captured artifact itself grounds a seat`
        : `the question's evidence[${i}] (${e.canonical}) cannot be read (${err?.code ?? err?.message})`));
    }
    if (!st?.isFile()) die(prefix + `the question's evidence[${i}] (${e.canonical}) is not a file`);
  }
  questionEntries = entries;
  if (question && Array.isArray(question.evidence)) question = { ...question, evidence: entries.map((e) => e.canonical) };
}
const grounding = { floor, basisOf: (citations) => seatBasis(citations, { repoRoot, io: IO, reviewsDir: review.reviews_dir ?? '', stagingRoot,
  // The question's own list, read from the record on a revote, so a revote judges by the same list (design GR-D1 A).
  evidence: questionEntries }).basis };

ensureDecisionsRoot();
const id = phase === 'first' ? newId() : opts.revote;
if (phase === 'first') dir = path.join(decisionsRoot, id);
recordDir = phase === 'first' ? dir : path.join(dir, 'revote');
// The record directory (a new decision's, or the revote's claim) is made just before the panel is asked, below, after
// every step that can refuse.

// THE WORK CONTEXT, BUILT HERE FROM THE TREE (criterion 2): the request the contract names, the stage the question
// names, and git's view of what changed. Nothing reads the session's conversation.
// BOUNDED AS EVERY GIT LISTING OF THIS ENGINE IS (decision-panel-seats.plan.md stage 6, found live 2026-11-11): read with
// spawnSync's default 1 MiB, this repository's `git ls-files -z` (2,485,356 bytes, 31,630 files) died with ENOBUFS and
// status null, and the decision never reached its panel. 1 GiB is the bound io/worktree.mjs (LISTING_MAX_BUFFER),
// io/preflight-cache.mjs, check-install, find-inert-features and new-run already give a git listing: a bound, so a
// runaway listing still stops, far past any real repository's file list. A census holds every reader here to it.
const GIT_LISTING_MAX_BUFFER = 1 << 30;
const gitOut = (args) => {
  const r = gitSync(args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: GIT_LISTING_MAX_BUFFER });
  // THE ERROR'S CODE, NOT "exit null" (the same day): a spawn that erred (ENOBUFS, ENOENT) has no status to report.
  if (r.status !== 0 || r.error) {
    const why = r.error ? `${r.error.code ?? r.error.message}` : (String(r.stderr ?? '').trim() || `exit ${r.status}`);
    die(`git ${args.join(' ')} failed (${why}); the panel is not asked without its work context`, 1);
  }
  return r.stdout;
};
// THE STAGE AS THE PLAN NAMES IT (decision-records.plan.md stage 5; DR-D1 A): a question's `stage` must name a heading
// of the declared request or plan, and the seat gets that heading, never the session's text.
// HELD TO WHAT THE MINT HOLDS IT TO, STAGE OR NOT (G-2 of 20261110-025747-dps-remediation-5-review): read through
// path.join, a `../` value left the repository and its heading went to the external seats, and with no stage the path
// was still named to them. The grammar's error first, before any record exists; the read through the repository's owner,
// so a link on the way is refused too (ARCHITECTURE A-30). Its normal spelling is the one the seats and their copies get.
const declaredRequest = contract.doc_roles?.request;
const [requestError] = contractGlobErrors({ doc_roles: { request: declaredRequest } });
if (requestError) die(`the contract's ${requestError}`);
const parsedRequest = typeof declaredRequest === 'string' && declaredRequest.trim() ? parseGlob(declaredRequest) : null;
const requestPath = parsedRequest?.glob ?? null;
let stage = null;
if (question.stage !== undefined && question.stage !== null && String(question.stage).trim()) {
  if (!requestPath) die('the question names a stage, but the contract declares no doc_roles.request to find it in');
  let planText;
  // THROUGH THE EGRESS OWNER (G-3 of 20261112-050334-hl-review-b): the stage heading goes into every seat's work context,
  // so a request with a second name is refused, as its seat copy is.
  try { planText = egress(REPO_REAL).read(parsedRequest.segments); } catch (e) { die(`the declared request ${requestPath} could not be read: ${e.message}`, e?.code === 'ECONFINED' ? 2 : 1); }
  stage = stageHeading(planText, question.stage);
  if (!stage) die(`the question's stage ${JSON.stringify(question.stage)} names no heading of ${requestPath}: give its number or the words of its heading`);
}
// AND THE UNTRACKED FILES (G-2 of 20261101-065930-dr-delivery): git diff lists none, so new work was missing.
// EVERY PATH LIST NUL-DELIMITED, UNTRIMMED (G-1 of 20261110-010058-dps-remediation-2-review): read as lines and
// trim()med, a tracked "config " folded onto an ignored "config", which then skipped the credential screen; -z also
// stops git quoting an unusual name.
const nulList = (out) => out.split('\0').filter(Boolean);
const untrackedFiles = nulList(gitOut(['ls-files', '--others', '--exclude-standard', '-z']));
// What git tracks, the one set a seat copy is passed unscreened from (io/seat-copies.mjs; G-2 of
// 20261110-001436-dps-remediation-review): anything else a question cites, an ignored `.env` included, is screened.
// Frozen, so each seat call's copy uses its cached set with no rescan (G-1 of 20261110-022503-dps-remediation-4-review).
const trackedFiles = Object.freeze(nulList(gitOut(['ls-files', '-z'])));
const changedFiles = [...new Set([
  ...nulList(gitOut(['diff', '--name-only', '-z', ...since])),
  ...untrackedFiles,
])];
let context = workContextText({
  request: requestPath,
  stage,
  // The question's evidence list, as the seat-facing question carries it (G-3, G-4 of 20261103-234542-gre-delivery).
  evidence: blindQuestion(question).evidence,
  diffStat: gitOut(['diff', '--stat', ...since]),
  files: changedFiles,
});
// WHAT A NODE-RUNTIME CALL GIVEN THE WORK CONTEXT STANDS AMONG (decision-panel-seats.plan.md stage 1; operator,
// 2026-11-09: "A. Copy cited files in (Recommended)"): every path the context names, copied into the call's empty
// directory at its repository-relative path (io/seat-copies.mjs), since the runtime's CLI refuses a Read outside it. The
// evidence is the intake's normalized entries, so one outside the repository is refused here, by its owner's `inRepo`.
const seatCopies = seatCopyPaths({ request: requestPath, files: changedFiles, evidence: questionEntries, caseInsensitive: IO.caseInsensitiveFs });

// ------------------------------------------------------------------------------------------------------------- the seats
let roster;
try { roster = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'lens-roster.json'), 'utf8')).decision_panel; } catch { roster = null; }
if (!Array.isArray(roster?.seats) || roster.seats.length < 2) die('lens-roster.json declares no decision_panel.seats');
let runtime; let adapters;
try {
  // Chosen by the one owner (contract-runtime-and-session-files.plan.md stage 1): the runtime seat is the runtime the
  // review's nodes run on, review.runtime else the table's default.
  const chosen = selectAdapters({ contract });
  adapters = chosen.table;
  runtime = chosen.runtime;
} catch (e) { die(e.message); }
const seatSpecs = new Map([[runtime, { kind: 'runtime' }], ...roster.seats.map((s) => [s.reviewer, { kind: 'external', ...s }])]);
if (seatSpecs.size !== roster.seats.length + 1) die('the decision panel\'s seats are not distinct from each other and from the node runtime');
// DISTINCT FAMILIES, NOT ONLY DISTINCT IDS (G-8 of 20261101-005402-ar-delivery): the runtime seat runs at the contract's
// judgment model; each external seat at its roster pin.
const familyError = seatFamilyErrors([{ reviewer: runtime, model: review.models?.judgment ?? '' }, ...roster.seats], adapters);
if (familyError) die(familyError);
const seats = [...seatSpecs.keys()];
const families = Object.fromEntries([[runtime, familyOfCall({ reviewer: runtime, model: review.models?.judgment ?? '' }, adapters)],
  ...roster.seats.map((s) => [s.reviewer, familyOfCall(s, adapters)])]);

// EVERY SEAT'S AND THE MODERATOR'S CHILD IS HELD (G-9 of 20261101-005402-ar-delivery; ARCHITECTURE A-25), so an
// interrupted decide stops each through the one owner and says so, rather than leaving it running with the credentials.
const live = new Map();
let childSeq = 0;
const STDERR_TAIL = 64 * 1024;
const SEAT_FAILURE_LINE_MAX = 500;
stopHeldOnExit({
  held: () => live.entries(),
  record: (key, outcome, reason) => console.error(`decide: ${key} ${reason}: ${outcome.outcome}${outcome.pid ? ` (pid ${outcome.pid})` : ''}`),
  onStart: (reason, n) => { if (n) console.error(`decide: ${reason}, stopping ${n} seat call(s)`); },
});
const run = (args, cwd) => new Promise((resolve) => {
  const key = `call-${++childSeq}`;
  const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  live.set(key, child);
  // A BOUNDED TAIL (G-3 of 20261102-220302-rbr-remediation-5-review): only the last line is ever used, and every chunk
  // was kept, so a noisy seat grew this process for its whole life.
  let err = '';
  child.stderr.on('data', (d) => { err = (err + d).slice(-STDERR_TAIL); });
  child.stdout.resume();
  child.on('close', (code) => { live.delete(key); resolve({ code, err }); });
  child.on('error', (e) => { live.delete(key); resolve({ code: null, err: String(e.message) }); });
});
// THE RECORD THIS RUN WRITES, through the owner (stage 6): a new decision's directory, or the revote's below it.
const recordSegs = phase === 'first' ? D(id) : D(opts.revote, 'revote');
const recStore = storeOf(phase === 'first' ? id : opts.revote, phase === 'first' ? null : 'revote');
/** A JSON file the run reads back, through `reader` (an owner's read); null when it is absent or not JSON. */
const readJsonVia = (reader) => { try { return JSON.parse(reader()); } catch (e) { if (e?.code === 'ECONFINED') die(e.message, 2); return null; } };

// THE ENGINE-HOME SURFACES THROUGH AN OWNER TOO (stage 6): each external seat call's directory, each runtime call's, and
// the seats' scratch, all below `decision-surfaces` of the engine's home, made and removed through `confined` rooted at
// the home AS NAMED, so a link planted there, or at the home itself, is refused. Its real path was the root (G-4 of
// 20261102-220302-rbr-remediation-5-review), which resolved a link at the home before the owner's root check saw it.
let homeOwner;
try { fs.mkdirSync(quorateHome(), { recursive: true }); homeOwner = confined(path.resolve(quorateHome())); } catch (e) { die(`the engine's home cannot be used: ${e.message}`, 1); }
const H = (...names) => ['decision-surfaces', ...names];
const surfaceAt = (name) => held(() => homeOwner.dir(H(name)));
// A surface that cannot be removed is named, never dropped silently (G-5 of 20261102-231209-rbr-remediation-6-review).
const dropSurface = (name) => { try { homeOwner.remove(H(name), { recursive: true }); } catch (e) { console.error(`decide: the surface ${path.join(quorateHome(), ...H(name))} could not be removed (${e?.message ?? e}); it is left there`); } };

// EVERY NODE-RUNTIME CALL OF THE PANEL RUNS OUTSIDE THE REPOSITORY (decision-records.plan.md stage 5; DR-D1 A): the seat,
// the moderator and the revote note's author each stand in an empty directory of their own under the engine's home
// (runtimeCall), so none starts beside the decision record it is part of, or an earlier one. For this runtime that
// bounds reads too: its CLI refuses a Read outside its working directory (decision-panel-seats.design.md, "DP-D4,
// measured"), so a call given the work context (`copy`) gets a copy of each path it names in its directory first, and
// the moderator, given none, stands in an empty one. (Codex reads outside its directory: G-2 of
// 20261104-171128-epo-remediation-3-review; shared/external-reviewers.md.) The brief, envelope and result
// files are the spawner's, written to the record. Named for the runtime, never a vendor (G-13 of
// 20261102-231209-rbr-remediation-6-review; ARCHITECTURE A-9).
const runtimeName = `${process.pid}-${id}-runtime`;
let runtimeSeq = 0;
process.on('exit', () => dropSurface(runtimeName));
const relaySubagentNotices = (stderr) => { for (const l of subagentNotices(stderr)) console.error(l); };
let copiesRefusedSaid = false;
/**
 * THE COPIES A SEAT'S CALL STANDS AMONG, into the directory `segs` names below the engine home, recorded as
 * `<stem>-copies.json` (decision-panel-seats.plan.md stage 1, and for every seat since stage 6; operator, 2026-11-11: "A.
 * Copy-in for every seat (Recommended)"): the same paths under the same rules for each, through both owners; a refusal is
 * said once per decide, so a seat that could not read a cited path is never silent about it.
 */
const copyFor = (stem, segs) => {
  const c = held(() => copyIntoSeatDir({ repoRoot: REPO_REAL, owner: homeOwner, segs, paths: seatCopies.copy, refused: seatCopies.refused,
    // Every file git does not track, ignored ones and any casing of one included, is screened for a credential's shape
    // before its copy (G-1 of 20261109-232630-dps-delivery; G-2, G-7 of 20261110-001436-dps-remediation-review).
    tracked: trackedFiles, caseInsensitive: IO.caseInsensitiveFs }));
  held(() => owner.replace([...recordSegs, `${stem}-copies.json`], `${JSON.stringify(c, null, 2)}
`));
  if (c.refused.length && !copiesRefusedSaid) {
    copiesRefusedSaid = true;
    for (const x of c.refused) console.error(`decide: ${x.path} is not copied for the seats (${x.why}); no seat can read it`);
  }
  return c;
};
const subagent = async (name, prompt, round, { copy = false } = {}) => {
  const stem = `${name}${round ? `-r${round}` : ''}`;
  held(() => owner.replace([...recordSegs, `${stem}-brief.md`], prompt));
  const file = (suffix) => held(() => owner.resolve([...recordSegs, `${stem}${suffix}`]));
  const surfaceSegs = H(runtimeName, String(++runtimeSeq));
  const surfaceDir = held(() => homeOwner.dir(surfaceSegs));
  if (copy) copyFor(stem, surfaceSegs);
  const call = runtimeCall({ scripts: SCRIPTS, promptFile: file('-brief.md'), out: file('.envelope.json'), result: file('.json'),
    repoRoot, surface: surfaceDir, runtimeBin: RUNTIME_BIN_GIVEN });
  const r = await run(call.argv, call.cwd);
  // Whatever the exit (G-7 of 20261105-163851-crsf-d1-review; G-6 of 20261105-173030-crsf-d1-remediation-review): the
  // child's override notice is passed on (A-26), a failing call through an overridden adapter included.
  relaySubagentNotices(r.err);
  return r.code === 0 ? readJsonVia(() => owner.read([...recordSegs, `${stem}.json`])) : { status: 'error', reason: r.err.trim().split('\n').slice(-1)[0] ?? '' };
};
// A DIRECTORY OF ITS OWN FOR EACH EXTERNAL SEAT'S CALL, HOLDING THE COPIES (stage 6; operator, 2026-11-11: "A. Copy-in for
// every seat (Recommended)"): the seats shared one EMPTY directory per decision, so agy's model, looking for the files
// the question cited, ran a command to list it, which headless agy denied twice, and the seat answered no round
// (decision 20261111-055540-08ae29). Each call now gets an empty git repository (codex refuses a directory outside one)
// with the same copies as the runtime seat's, under the same rules.
const seatsName = `${process.pid}-${id}-seats`;
let seatsSeq = 0;
process.on('exit', () => dropSurface(seatsName));

// THE SEATS' EVIDENCE IS STAGED OUTSIDE THE RECORD DURING A ROUND (G-11 of 20261101-005402-ar-delivery): an external
// seat's envelope written to the record before the round ends is a same-round peer answer another seat could read.
// runDecision moves each seat's scratch into the record after the round.
const scratchName = `${process.pid}-${id}-evidence`;
const scratchRoot = surfaceAt(scratchName);
// runDecision empties each seat's scratch once the record holds it, so what is left here is evidence that never reached
// the record (G-18 of 20261101-014615-ar-delivery-remediation-review): it is kept and named, never deleted with the rest.
process.on('exit', () => {
  try { if (homeOwner.list(H(scratchName)).length === 0) homeOwner.remove(H(scratchName), { recursive: true }); else console.error(`decide: seat evidence that did not reach the record is kept at ${scratchRoot}`); } catch (e) { console.error(`decide: the seat-evidence scratch at ${scratchRoot} could not be listed or removed (${e?.message ?? e}); it is left in place`); }
});

const runSeat = async (seat, prompt, round, scratch) => {
  const spec = seatSpecs.get(seat);
  if (spec.kind === 'runtime') return subagent(`seat-${seat}`, prompt, round, { copy: true });
  // The scratch runDecision made through its owner (stage 6); written and read here through the engine home's owner,
  // with the scratch root and the seat's directory as segments (G-7 of 20261102-231209-rbr-remediation-6-review): an
  // owner rooted at the seat's directory never checked the scratch root above it for a link.
  if (path.dirname(path.resolve(scratch)) !== path.resolve(scratchRoot)) die(`decide: the seat's scratch ${scratch} is not below ${scratchRoot}`, 1);
  const S = (...names) => H(scratchName, path.basename(scratch), ...names);
  const ev = { replace: (n, s) => homeOwner.replace(S(...n), s), resolve: (n) => homeOwner.resolve(S(...n)), read: (n) => homeOwner.read(S(...n)) };
  const promptFile = held(() => ev.replace(['prompt.md'], prompt));
  const out = held(() => ev.resolve([`${seat}.json`]));
  const seatSegs = H(seatsName, String(++seatsSeq));
  const surface = held(() => homeOwner.dir(seatSegs));
  gitSync(['init', '-q'], { cwd: surface });
  copyFor(`seat-${seat}-r${round}`, seatSegs);
  const call = await run([path.join(SCRIPTS, 'external-review.mjs'), '--reviewer', spec.reviewer, '--model', spec.model,
    ...(spec.effort ? ['--effort', spec.effort] : []), '--mode', 'decide', '--prompt-file', promptFile,
    '--evidence-dir', scratch, '--out', out, '--surface', surface], repoRoot);
  const env = readJsonVia(() => ev.read([`${seat}.json`]));
  // external-review already mapped the answer; it is handed back in the raw schema's names so the one mapping applies.
  if (env?.result) {
    return { status: 'ok', choice: env.result.choice, rationale: env.result.reason,
      other_text: env.result.other_text ?? '', change_of: env.result.change_of ?? '',
      what_would_change: env.result.what_would_change ?? '', citations: env.result.citations ?? [] };
  }
  // SILENT FOR A USAGE LIMIT, recorded as such (autonomous-run.plan.md stage 7 part 2; operator, 2026-10-31: "3 a"): the
  // reply in the round's record says `quota`, with the reset text, so a no-majority round is not read as disagreement.
  const quota = (env?.not_checked ?? []).find((n) => n?.kind === 'quota');
  if (quota) return { status: 'quota', reason: `usage limit${quota.reset_text ? `; resets ${quota.reset_text}` : ''}` };
  // AND ANY OTHER SILENCE KEEPS ITS REASON (decision-panel-seats.plan.md stage 4; DP-D3 A): the envelope's not_checked
  // reasons, which the round's record and a seats-unavailable outcome name; it was null, read as "no answer object".
  const reasons = (env?.not_checked ?? []).map((n) => (typeof n?.reason === 'string' ? n.reason.trim() : '')).filter(Boolean);
  if (reasons.length) return { status: 'unavailable', reason: reasons.join('; ') };
  // WITH NO REASON OF ITS OWN, THE CALL'S FAILURE IS THE REASON (G-4 of 20261110-025747-dps-remediation-5-review): run()'s
  // result was discarded, so a seat whose process died before its envelope was recorded with no cause. Its exit and last
  // stderr line, bounded because the reason is printed in the summary.
  const lastLine = call.err.trim().split('\n').slice(-1)[0].trim().slice(0, SEAT_FAILURE_LINE_MAX);
  const failure = `${call.code === null ? 'no exit code' : `exit ${call.code}`}${lastLine ? `: ${lastLine}` : ''}`;
  return { status: 'unavailable', reason: `${env ? 'its envelope gave no answer and no reason' : 'it wrote no envelope'} (${failure})` };
};
const runModerator = (prompt) => subagent('moderator', prompt, null);

if (phase === 'first') {
  // MADE LAST, as the revote's claim is (G-9): a decision refused during preparation leaves no record without an outcome.
  // Through the owner (stage 6): the id is new, and an exclusive create refuses one already taken.
  held(() => owner.create(D(id, 'question.json'), `${JSON.stringify(question, null, 2)}\n`));
}
if (phase === 'revote') {
  // THE CLAIM (G-11): of two revotes started together, only one makes the directory. MADE LAST (G-9 of
  // 20261101-023925-ar-remediation-2-review): a refusal during preparation (git, the template, the seats) left it behind,
  // and every later revote was held until it was removed by hand. From here on it holds a revote the panel was asked.
  // The levels above it are walked by the owner first (stage 6); the claim itself is one exclusive mkdir.
  const claim = held(() => owner.resolve(D(opts.revote, 'revote')));
  try { fs.mkdirSync(claim); } catch (e) { if (e?.code === 'EEXIST') die(revoteHeld(dir)); throw e; }
  // THE NOTE, BY A FRESH BLIND AUTHOR (decision-records.plan.md stage 5; DR-D1 A): given only the question, its options
  // and the work context, standing outside the repository, so it has seen neither round 1 nor the asking session. The
  // session's own note is never read. An author that does not answer releases the claim, so a later revote is not held.
  // BLINDED (G-6 of 20261101-065930-dr-delivery): the raw question kept its recommendation marks, the cue a blind author
  // must not see; blindQuestion was checked above, so it does not throw here.
  const blindAuthor = blindQuestion(question);
  const author = await subagent('revote-author', buildRevoteAuthorPrompt({ question: blindAuthor.question, options: blindAuthor.options, context }), null, { copy: true });
  const note = typeof author?.note === 'string' ? author.note.trim() : '';
  if (author?.status !== 'ok' || !note) {
    // A claim that cannot be released holds every later revote (revoteHeld), so that is said instead (G-7 of
    // 20261103-005954-rbr-remediation-7-review): "can be run again" would be false.
    try { owner.remove(D(opts.revote, 'revote'), { recursive: true }); } catch (e) { die(`the revote note's author gave no note (${author?.reason || author?.status || 'no answer'}); nothing was voted, but the revote's claim at ${claim} could not be released (${e?.message ?? e}): remove it by hand before the revote is run again`, 1); }
    die(`the revote note's author gave no note (${author?.reason || author?.status || 'no answer'}); nothing was voted, and the revote can be run again`, 1);
  }
  held(() => owner.replace(D(opts.revote, 'revote', 'revote-note.md'), `${note}\n`));
  // The revote's words to the seats are a template (G-13 of 20261101-014615-ar-delivery-remediation-review).
  context += `\n\n${renderTemplate(readTemplate('decision-revote-note.md'), { note }, 'decision-revote-note.md').trim()}`;
}

let result;
try {
  result = await runDecision({ question, recordDir, seed: id, seats, context, caps, runSeat, runModerator, phase, scratchRoot, grounding, families, store: recStore });
} catch (e) { die(`the panel failed: ${e?.message ?? e}`, 1); }
const o = result.outcome;
const summary = o.outcome === 'majority'
  ? `decide: ${o.entry} "${o.label}" — ${panelAttribution(id)}, ${o.agreement}, ${o.rounds} round(s), basis ${o.basis} (floor ${o.floor})`
  : o.outcome === 'to-operator'
    ? `decide: the panel chose ${o.entry} "${o.label}" (${o.agreement}), but its basis ${o.basis} is below the floor ${o.floor}: this goes to the operator, the panel's positions as the options (${id})`
  : o.outcome === 'seats-unavailable'
    ? `decide: seats unavailable after ${o.rounds} round(s) — ${o.answering ?? 0} seat(s) answered, fewer than ${QUORUM}; silent: ${(o.silent ?? []).map((x) => `${x.seat} (${x.why})`).join('; ')}. This goes to the operator (${id})`
  : o.outcome === 'revote'
    ? `decide: no majority after ${o.rounds} round(s) — run decide.mjs --revote ${id} for a blind revote on a fresh author's note`
    : `decide: postponed for the operator (${id}) — no majority on the revote; continue with work that does not depend on it`;
// Every byte before the exit (G-3 of 20261112-054852-hl-remediation-3-review): console.log on a POSIX pipe is queued, and
// process.exit could cut a large record short.
if (opts.json) writeAllSync(1, `${JSON.stringify({ id, ...o })}\n`, { retry: ['EAGAIN'] });
writeAllSync(1, `${summary}\n`, { retry: ['EAGAIN'] });
process.exit(0);
