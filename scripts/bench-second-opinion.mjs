#!/usr/bin/env node
// bench-second-opinion.mjs — score the audit OF the barrier, by making a reconciliation error on
// purpose and seeing whether `second-opinion` says so.
//
// AC 14 of .claude/requests/model-and-effort-reevaluation.md. `reconcile` was scoreable from
// artifacts that already existed; this node is not. It is the graph's one PROSE node
// (`schema_variant: none`), it is the bench's largest line item — $14.80 over seven seeds, 38% of
// the Anthropic cost — and nothing has ever scored it. Its job is catching the RECONCILER's
// mistakes, so measuring it means making one: "a corpus that does not exist: seeded reconciliation
// errors rather than seeded code defects."
//
// The plan, its rejected alternatives and its declared weaknesses are in
// .claude/requests/second-opinion-scored.plan.md. What matters here:
//
//   * ONE mutation, `misanchor`, under one of two INJECTION RULES. `borrow` moves the anchor onto
//     a line the prose already discusses and leaves the prose alone — measured 2026-09-22, that
//     scores 2 of 7 seeds and both still name the real line in their own rationale, so it measures
//     tamper-detection. `rewrite` (the default) has the reconciler's paragraph regenerated to match
//     the moved anchor, which lifts the same-file restriction and is checked mechanically for the
//     tell. The lenses' own words are NEVER rewritten: a header disagreeing with its inputs is the
//     defect, not a seam. lib/reconcile-mutations.mjs carries the full argument.
//   * ONE NODE IS SPAWNED DIRECTLY, through the same `spawn-node.mjs` CLI run-graph itself wraps
//     (`run-graph.mjs:1081-1163`). It was a `run-graph --resume` first, and that could not work:
//     a resume rewrites finding-groups.json from the lens reports UNCONDITIONALLY (`:2729`), so the
//     injected anchor reverted there while surviving in reconciled.md, and the audit reported the
//     two artifacts contradicting each other rather than the misanchor. Spawning the node removes
//     the regroup and the pre-flight barrier, which a reconciliation audit needs neither of.
//   * A cross-family JUDGE rules whether the report identified the injected error, and is believed
//     only if it quotes the report verbatim. The same judge rules on the CONTROL report, from the
//     unmutated run, so the instrument's own false-alarm rate is measured rather than assumed.
//
//   node scripts/bench-second-opinion.mjs                       what a run would cost, and from where
//   node scripts/bench-second-opinion.mjs --dry-run             what it would INJECT, spawning nothing
//   QUORATE_BENCH=1 node scripts/bench-second-opinion.mjs --forge-only    forge the errors, audit nothing
//   QUORATE_BENCH=1 node scripts/bench-second-opinion.mjs [--from <result.json>] [--seed <id>]
//
// A NEW MUTATION GOES THROUGH `--forge-only` BEFORE A FULL PASS, and that is not advice. The dry
// run cannot reach the forge at all — it spawns nothing by definition — so every line between
// "the mutation applied" and "the audit ran" is unexercised until the cents tier runs. Measured
// 2026-09-22: `deflate`'s first full pass died on every seed with `The "path" argument must be of
// type string`, because the destination-source read is a `misanchor` concept and `to` is a severity
// for the other two. It cost $0 only because it threw before the first model call, which is luck
// rather than design. `--forge-only` would have found it for about a dollar and with a paragraph
// to read at the end.
//
// The dry run is the one to reach for first: it establishes every precondition the billed tiers
// depend on and spawns nothing. On the 2026-09-21 corpus it scores 6 of 7 seeds under `rewrite`
// and 2 of 7 under `borrow` — the measurement that chose the default, and it cost $0 rather than
// the $15 a pass would have spent to reach the same conclusion badly.
//
// The opt-in mirrors bench-lenses: this spawns a real `second-opinion` per seed and sends the
// report to a third-party reviewer, so it never runs implicitly.
//
// Exit codes: 0 ran (or listed) · 1 no seed could be scored · 2 usage · 3 depth guard.

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { contractMinutes } from './lib/check-timeout.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shAsync, makeLock } from './io/pool.mjs';
import { spawnForge } from './io/forge-spawn.mjs';
import { resolveAnchor, scoreReconcile, validateManifest } from './lib/bench-scoring.mjs';
import { collectRun, splitSpend, readRunRecord, refusalLines } from './io/run-artifacts.mjs';
import { redactTree } from './lib/redact.mjs';
import {
  groupHeaders, groupSection, alternateAnchor, applyMisanchor, mutationSurvived,
  splitGroupSection, rewriteCarriesTell, applyRewrittenRationale, citedLines, INJECTION_RULES,
  MUTATIONS, deflatedSeverity, applyDeflate, dropWouldDangle, applyDrop,
  forgeSlots, tellForMutation, injectionSurvived,
} from './lib/reconcile-mutations.mjs';
import {
  scoreJudgedReport, summariseSecondOpinion, readCliEnvelope, JUDGE_PARTICIPANTS, IDENTIFIED, NOT_IDENTIFIED,
} from './lib/second-opinion-scoring.mjs';
import { readTemplate } from './io/template.mjs';
import { renderTemplate } from './lib/template.mjs';
import { reviewerEnv, engineLocationEnv, scrubChildEnv, runtimeSessionEnv, SEVERITY_RUNGS } from './lib/decisions.mjs';
import {
  selectAdapters, overrideLine, envPrefixesOf, envNamesOf,
} from './io/reviewers.mjs';
import {
  defaultJudge, judgmentSetting, candidateAdmissible, effortLadder, resultBasename, sumSpend,
  benchContract, uncommittedContractRefusal,
} from './lib/bench-settings.mjs';
import { readContract } from './io/contract-reader.mjs';
import { CONTRACT_CANDIDATES } from './lib/contract-source.mjs';
import { VOTE_NEITHER } from './lib/adjudication.mjs';
import { frameworkStamp } from './io/version.mjs';
import { quorateHome, isSafeRunId, admitRun, defaultReviewsRoot } from './io/reviews-root.mjs';
import { confined } from './io/confined-path.mjs';
import { gitSync, gitAsync } from './io/git.mjs';
import { writeBenchRecord } from './io/telemetry-record.mjs';
import { callEntry, runtimeAnswered, markAnswered } from './lib/call-entry.mjs';

// Fails CLOSED like every entry point that starts graph work (disk-first-protocol §8). Copied in
// the same shape as the other seven, including the present-but-empty case: `Number('')` is 0, so a
// value that is present and says nothing once passed as TOP LEVEL in all of them.
const { raw: RAW_DEPTH, depth: PARSED_DEPTH } = nodeDepth(process.env);
const DEPTH = PARSED_DEPTH ?? NaN;
if (!Number.isInteger(DEPTH) || DEPTH < 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} is not a non-negative integer (§8).`);
  process.exit(3);
}
if (DEPTH > 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${DEPTH} — a graph node may not start a benchmark (§8).`);
  process.exit(3);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = path.resolve(HERE, '..');
const CORPUS_DIR = path.join(FRAMEWORK_ROOT, 'bench', 'corpus');
const RESULTS_DIR = path.join(FRAMEWORK_ROOT, 'bench', 'results');
const ROSTER = path.join(HERE, 'lens-roster.json');

// THE ONE NODE THIS HARNESS SPAWNS. Named once because it is read in three places that must agree:
// the spawn argv, the cost split, and the reuse of the preserved report as a control. A literal in
// each was how the cost of fifteen inherited nodes got summed as though this pass had paid for them.
const SPAWNED_NODE = 'second-opinion';

function die(msg) {
  console.error(`bench-second-opinion: ${msg}`);
  process.exit(2);
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const args = { tolerance: 15 };
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['bench-second-opinion'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  if (v.from !== undefined) args.from = v.from;
  // A LIST, because the result file is keyed by the SOURCE stamp alone: two single-seed runs
  // write `<stamp>-second-opinion.json` twice and the second silently replaces the first.
  // Measured — that is how one run's result was lost. Seeds that belong in one number have to
  // be scored in one invocation.
  if (v.seed !== undefined) args.seed = v.seed.split(',').map((s) => s.trim()).filter(Boolean);
  for (const [flag, key] of Object.entries({ judge: 'judge', keep: 'keep', 'dry-run': 'dryRun', rule: 'rule', 'forge-only': 'forgeOnly',
    rejudge: 'rejudge', mutation: 'mutation', forged: 'forged' })) {
    if (v[flag] !== undefined) args[key] = v[flag];
  }
  if (v.tolerance !== undefined) args.tolerance = Number(v.tolerance);
  // THE CANDIDATE SETTING — the half of I-3 this harness did not have. Without it the bench
  // could only ever measure `second-opinion` at the setting already in force, which makes the
  // current-versus-lower comparison the whole request exists for impossible for this position.
  // SEPARATE KNOBS, because AC2 says so: "model and effort varied as separate knobs", and the
  // search space is bounded differently depending on which one moved.
  if (v.model !== undefined) args.candidate = { ...args.candidate, model: v.model };
  if (v.effort !== undefined) args.candidate = { ...args.candidate, effort: v.effort };
}
if (!Number.isInteger(args.tolerance) || args.tolerance < 0) die('--tolerance must be a non-negative integer');

// `rewrite` IS THE DEFAULT, because `borrow` was measured and does not work on this corpus: it
// scores 2 of 7 seeds and both of those carry a tamper tell (the rationale restates its own line
// number). `borrow` stays reachable because it spawns no forge — it is the cheap comparison arm,
// and a result from it has to be read knowing what it measures.
args.rule = args.rule ?? 'rewrite';
if (!INJECTION_RULES.includes(args.rule)) {
  die(`--rule ${JSON.stringify(args.rule)} is not one of: ${INJECTION_RULES.join(', ')}`);
}
// `borrow` runs no forge, so `--forge-only` under it would spawn nothing, score nothing and exit 0
// — a command that silently does nothing is worse than one that refuses.
// `misanchor` STAYS THE DEFAULT. It is the only one of the three with a corpus behind it (6/6
// scoreable) and the only one whose tell check is mechanically bounded on every rung; the other
// two are narrower and `drop`'s guard rests partly on a prompt instruction. A default nobody chose
// should be the one that measures the most with the strongest guarantee.
args.mutation = args.mutation ?? 'misanchor';
if (!MUTATIONS.includes(args.mutation)) {
  die(`--mutation ${JSON.stringify(args.mutation)} is not one of: ${MUTATIONS.join(', ')}`);
}
// `borrow` leaves the rationale standing, which only means anything for a mutation the rationale
// can contradict — the anchor. A deflated severity or a dropped group with its original paragraph
// intact is a contradiction on its face, which is the tamper-detection this design refuses to
// measure, so the combination is refused rather than silently producing that number.
if (args.mutation !== 'misanchor' && args.rule === 'borrow') {
  die(`--rule borrow only applies to misanchor: a ${args.mutation} with its original rationale `
    + 'left in place contradicts itself, and an auditor catching THAT has caught the harness');
}
if (args.forgeOnly && args.rule !== 'rewrite') die('--forge-only has nothing to forge under --rule borrow');
if (args.forgeOnly && args.dryRun) die('--forge-only and --dry-run ask for different tiers; pick one');
// `--forged` supplies what `--forge-only` produces, so asking for both is asking to write a file
// and read it in the same breath.
if (args.forged && args.forgeOnly) die('--forge-only WRITES the paragraphs; --forged reads them. Pick one');
if (args.forged && args.rejudge) die('--rejudge reuses whole preserved runs, rationale included; --forged is redundant with it');

// LOADED ONCE, UP FRONT, so a missing or unparseable file fails before a worktree is built rather
// than per-seed after work has been done.
let forgedSource = null;
if (args.forged) {
  const p = path.resolve(args.forged);
  try {
    forgedSource = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    die(`--forged ${path.basename(p)} did not parse: ${e.message}`);
  }
  // VALID JSON OF THE WRONG SHAPE IS REFUSED TOO (usage-report-followup.plan.md stage 2; G-2 of
  // 20261031-033859-urr-remediation-2-review): `null` crashed at `.injection_rule`, and a `seeds` that is not a list of
  // objects crashed per seed.
  if (!isPlainObject(forgedSource) || (forgedSource.seeds !== undefined && !(Array.isArray(forgedSource.seeds) && forgedSource.seeds.every(isPlainObject)))) {
    die(`--forged ${path.basename(p)} is not a forged-paragraphs file: an object, its seeds a list of objects`);
  }
  if (forgedSource.injection_rule && forgedSource.injection_rule !== args.rule) {
    die(`--forged was produced under rule ${forgedSource.injection_rule}, this run is ${args.rule}`);
  }
}

// ------------------------------------------------------------------ the one contract this bench answers to
// THE FRAMEWORK ROOT'S, read ONCE (bench-contract-root.design.md D1-D3): the forge runtime and the judge's credential
// routing come from the same contract as the roster, not from whatever directory the bench was launched in (G-4 of
// 20261014-220944-lf-remediation-r5-review). Read here, before the result file and the --seed filter, so a live run on
// an uncommitted contract is refused before anything else is decided (D1's amendment). readContract runs new-run.mjs
// --print-contract, the one contract parser.
let BENCH_DECLARED;
let declaredReview;
try { ({ reviewers: BENCH_DECLARED, review: declaredReview } = benchContract(readContract({ cwd: FRAMEWORK_ROOT }))); } catch (e) { die(e.message); }
// The one owner (contract-runtime-and-session-files.plan.md stage 1), as new-run chooses.
const BENCH_ADAPTERS = selectAdapters({ declared: BENCH_DECLARED, contract: { review: declaredReview } });
const REVIEWER_TABLE = BENCH_ADAPTERS.table;
// EVERY OVERRIDE OF THIS TABLE, NAMED ONCE BEFORE ANYTHING THAT SPENDS (reviewer-credential-routing, A-26): the contract
// decided where an overridden built-in's credentials go. The per-seed spawn of a COPIED run is named by spawn-node
// itself, from that run's frozen contract.
for (const o of BENCH_ADAPTERS.overrides) console.error(`bench-second-opinion: ${overrideLine(o)}`);
// THE FORGE RUNS ON THE NODE RUNTIME, chosen as new-run chooses the one its nodes spawn on: review.runtime, else the
// adapter table's default. `REVIEWER_TABLE.claude` with `?? 'claude'` behind it was the defect spawn-node had already
// fixed and written down in its own source, and the bench was the copy that was missed. Resolved once, here, so a
// failure is a startup refusal rather than a seed that dies after a worktree exists.
let FORGE_RUNTIME_NAME;
try { FORGE_RUNTIME_NAME = BENCH_ADAPTERS.runtime; } catch (e) { die(e.message); }
// A LIVE RUN SPENDS ONLY ON A COMMITTED CONTRACT (D1's amendment). --dry-run spawns nothing and is not asked.
if (process.env.QUORATE_BENCH === '1' && !args.dryRun) {
  const st = gitSync(['status', '--porcelain', '--', ...CONTRACT_CANDIDATES], { cwd: FRAMEWORK_ROOT, encoding: 'utf8' });
  const refused = uncommittedContractRefusal({ status: st.status, stdout: st.stdout, stderr: st.stderr, error: st.error?.message });
  if (refused) die(refused);
}

// ------------------------------------------------------------------ which pass are we mutating
// A PRESERVED RUN, not a fresh one. Everything this harness needs already exists on disk from the
// bench pass that produced it: the reconciliation, the grouping, the lens and arm verdicts, and
// the report the unmutated run produced — which is the control, free.
function latestResult() {
  if (!fs.existsSync(RESULTS_DIR)) return null;
  const candidates = fs.readdirSync(RESULTS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/.test(f))
    .sort();
  return candidates.length ? path.join(RESULTS_DIR, candidates[candidates.length - 1]) : null;
}

const resultPath = args.from ? path.resolve(args.from) : latestResult();
if (!resultPath || !fs.existsSync(resultPath)) {
  die('no bench result to mutate — pass --from <bench/results/<stamp>.json>, or run bench-lenses first');
}
const stamp = path.basename(resultPath).replace(/\.json$/, '');
let priorResult;
try {
  priorResult = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
} catch (e) {
  die(`${resultPath} did not parse: ${e.message}`);
}
// The same for --from (G-2): its scores and runs are dereferenced and mapped below.
if (!isPlainObject(priorResult)
  || (priorResult.scores !== undefined && !(Array.isArray(priorResult.scores) && priorResult.scores.every(isPlainObject)))
  || (priorResult.runs !== undefined && !(Array.isArray(priorResult.runs) && priorResult.runs.every(isPlainObject)))) {
  die(`${path.basename(resultPath)} is not a bench result: an object, its scores and runs lists of objects`);
}

// THE RUN DIRECTORY THE PASS PRESERVED, and the line the defect resolved to WHEN IT RAN. The
// second is the integrity check that makes this safe: the seeded tree is recreated from a commit,
// and if the anchor no longer lands where the pass recorded, the tree moved and the seed is NOT
// RUN rather than silently scored against different code.
// A SEED NAME IS A PATH SEGMENT, and it comes from a result file this process did not write (G-4 of
// 20260929-181033-ssr-review-r5): it is joined into the preserved-run path here and into the staging and temp paths in
// runSeed. One that is not a single safe segment gets no path at all, and runSeed says so by name — the rule run_id
// already follows (isSafeRunId).
const candidates = (priorResult.scores ?? []).map((s) => ({
  seed: s.seed,
  defectLine: s.defect_line,
  reconcile: s.reconcile ?? null,
  unsafeSeed: !isSafeRunId(s.seed),
  runDir: isSafeRunId(s.seed) ? path.join(RESULTS_DIR, `${stamp}-${s.seed}-run`) : null,
})).filter((c) => !args.seed?.length || args.seed.includes(c.seed));

// A NAME THAT MATCHES NOTHING IS A TYPO, AND A TYPO MUST NOT READ AS A DECISION — the rule
// run-graph's `--only` already fails closed on (`:270`), for the same reason: there, a transposed
// lens id deselected everything and reached a gate having spawned nothing. Here it would silently
// shrink the corpus and publish a recall over the seeds that happened to match.
if (args.seed?.length) {
  const known = new Set((priorResult.scores ?? []).map((s) => s.seed));
  const unknown = args.seed.filter((s) => !known.has(s));
  if (unknown.length) {
    die(`--seed names ${unknown.map((u) => JSON.stringify(u)).join(', ')}, which ${path.basename(resultPath)} `
      + `did not score.\n  Available: ${[...known].join(', ')}`);
  }
}

if (!candidates.length) {
  die(args.seed?.length ? `no seed matched ${args.seed.join(', ')} in ${path.basename(resultPath)}` : 'that result file scored no seeds');
}

// ----------------------------------------------------------------------------------- the judge
// FROM CONFIG, never a literal (lens-roster.json adjudicators). A model name is only meaningful
// paired with a CLI, and an unpinned judge cannot promise it is a different family from the node
// it is ruling about — which is the only reason a cross-family ruling is worth anything.
const roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
const judges = roster.adjudicators ?? [];
let judge;
if (args.judge) {
  judge = judges.find((j) => (j.id ?? j.reviewer) === args.judge);
  if (!judge) die(`no adjudicator '${args.judge}' in ${path.relative(FRAMEWORK_ROOT, ROSTER)}`);
} else {
  // FROM `default_judge`, not from one vendor's name. `j.reviewer === 'codex'` was the same defect
  // spawn-node wrote down about itself — a vendor literal doing the job the config table exists for
  // — and `?? judges[0]` behind it made file order the tie-break nobody declared.
  const picked = defaultJudge(judges, roster);
  if (!picked.ok) die(`${picked.why} (${path.relative(FRAMEWORK_ROOT, ROSTER)})`);
  judge = picked.judge;
}

// THE ENGINE'S HOME, checked once here for the same reason (G-8 of 20260929-181033-ssr-review-r5): QUORATE_HOME is one
// setting for the whole process, and quorateHome() refuses a bad one by throwing. Called inside the first seed, that
// throw ended the benchmark; here it is a startup refusal that names the setting, before any seed starts. Each seed's
// run copy is staged under it, in the recreated tree's own staging root (run-dir-trust.plan.md stage 3).
try {
  quorateHome();
} catch (e) {
  die(`QUORATE_HOME cannot be used for staging: ${String(e?.message ?? e).split('\n')[0]}`);
}
const FORGE_RUNTIME = REVIEWER_TABLE[FORGE_RUNTIME_NAME];
if (!FORGE_RUNTIME?.cmd) {
  die(`the node runtime '${FORGE_RUNTIME_NAME}' declares no \`cmd\`, so the forge has nothing to spawn`);
}

// ------------------------------------------------------------- the candidate, checked UP FRONT
// AC2 bounds the search space, and a candidate outside it costs exactly what one inside it costs
// while answering no question the request asked. Checked here rather than at the spawn for the
// reason `--forged` already learned the hard way: a precondition validated per seed AFTER the
// worktree and the copy exist fails N times, late, having done the setup work each time.
//
// Per seed, because the setting in force is a property of the run that seed came from — a corpus
// mixing two settings is a comparison against two different baselines, and the pass should say so
// rather than average over it.
if (args.candidate) {
  if (args.rejudge) {
    die('--rejudge spawns no node — it re-scores reports that already exist, at the setting they '
      + 'were produced at. A candidate setting there would label a measurement that never ran.');
  }
  const runtimeLadder = effortLadder(REVIEWER_TABLE[FORGE_RUNTIME_NAME]);
  for (const c of candidates) {
    if (!c.runDir) continue;   // an unsafe seed name has no path; runSeed reports it
    // THE ROOT FIRST, THEN THE SHARED STRICT READER (usage-report-reviewed-runs.plan.md stage 4; G-2, G-3 of
    // 20261030-195117-ciss-remaining-remediation-review): a raw read of run.json followed a link at the run or at the file,
    // and took the setting in force from outside. A link at the run, an absent or a refused record is reported NOT RUN per
    // seed by runSeed, which is its own message, so it is passed over here.
    let rootSt = null;
    try { rootSt = fs.lstatSync(c.runDir); } catch { continue; }
    if (rootSt.isSymbolicLink() || !rootSt.isDirectory()) continue;
    const record = readRunRecord(c.runDir);
    if (!record.ok) continue;
    const frozenReview = record.record.contract?.review ?? {};
    const inForce = {
      model: frozenReview.models?.judgment ?? roster.default_models?.judgment ?? null,
      effort: frozenReview.effort?.judgment ?? null,
    };
    const verdict = candidateAdmissible({ candidate: args.candidate, inForce, ladder: runtimeLadder });
    if (!verdict.ok) {
      die(`candidate ${JSON.stringify(args.candidate)} is outside the search space for seed `
        + `'${c.seed}' (in force: ${inForce.model}${inForce.effort ? `/${inForce.effort}` : ''}) — ${verdict.why}`);
    }
  }
}

// ------------------------------------------------------------------------------------- listing
// `--dry-run` passes THROUGH this gate rather than around it: the gate exists to stop unintended
// SPEND, and a dry run spawns nothing — no node, no reviewer, no judge. Gating it anyway would
// mean the only way to check the expensive half's preconditions was to set the variable that
// authorises paying for them, which is the opposite of what the opt-in is for.
if (process.env.QUORATE_BENCH !== '1' && !args.dryRun) {
  console.log(`bench-second-opinion: ${candidates.length} seed(s) from ${path.basename(resultPath)}\n`);
  for (const c of candidates) {
    const present = Boolean(c.runDir) && fs.existsSync(c.runDir);
    console.log(`  ${JSON.stringify(c.seed)}${c.runDir ? (present ? '' : '   — NO PRESERVED RUN DIRECTORY, cannot be mutated') : '   — NOT A SAFE PATH SEGMENT, cannot be mutated'}`);
  }
  const each = (priorResult.runs ?? [])
    .map((r) => r.costs?.['second-opinion'] ?? 0)
    .filter((n) => n > 0);
  const avg = each.length ? each.reduce((a, b) => a + b, 0) / each.length : null;
  console.log(
    `\nEach seed re-spawns ONE second-opinion against a mutated reconciliation` +
    (avg ? `, which cost ~$${avg.toFixed(2)} each on that pass — ~$${(avg * candidates.length).toFixed(2)} total` : '') +
    `.\nThe judge is ${judge.id ?? judge.reviewer} (${judge.reviewer}/${judge.model}), billed by its own vendor.` +
    `\nThe node runtime a live run records: ${FORGE_RUNTIME_NAME}.` +
    `\nRe-run with QUORATE_BENCH=1 to spend that deliberately.`,
  );
  process.exit(0);
}

// ------------------------------------------------------------------------------------ the run
const gitLock = makeLock();
const withGitLock = (fn) => gitLock(fn);
const rows = [];
const notRun = [];
// HARD LINKS ARE NAMED, NOT REFUSED (usage-report-followup.plan.md stage 1; the operator, 2026-10-31: "C but check and
// report to the user if one is found"). A file with more than one name may share its content with a file anywhere on the
// same drive, and what the bench copies or re-judges reaches the external judge; a symbolic link stays refused (A-30).
const hardLinks = [];
function noteHardLink(seed, where, file) {
  hardLinks.push({ seed, where, file });
  console.log(`   HARD LINK in seed ${seed} (${where}): ${file} has another name on this drive, so its content may come from `
    + 'outside the run; it is used as it is');
}
const perSeed = [];
const startedAt = new Date().toISOString();
const logPath = path.join(RESULTS_DIR, `${stamp}-second-opinion.log`);
const logLine = (label, text) => fs.appendFileSync(logPath, `\n===== ${label} =====\n${text}\n`);

/**
 * Have the reconciler's own paragraph rewritten to match the anchor this harness moved.
 *
 * THE THIRD MODEL IN THE INSTRUMENT, and the one that has to be declared loudest: one model forges
 * the error, one audits it, one judges the audit. That is a real cost, accepted because the
 * alternative measured worse — `borrow` leaves a paragraph that still names the true line, so the
 * audited node can win by spotting an inconsistency instead of by checking the source.
 *
 * Bounded three ways. It is pinned to the SAME model and effort the reconciler ran at, read from
 * the run's own frozen contract rather than today's — a paragraph rewritten by a different model
 * than wrote the rest of the file is its own tell. It is given no tools. And its output is checked
 * mechanically by `rewriteCarriesTell` before anything is spent on it, so "the tell is gone" is a
 * verified property rather than the assumption that already failed once.
 */
async function forgeRationale({ wt, runDir, seed, groupId, severity, decision, from, to, parts, contract, mutation }) {
  // THE REAL SOURCE AT THE DESTINATION, because a forge with no tools invents it otherwise.
  // Measured on the first live forge-only pass: asked to re-anchor onto `scripts/capture.mjs:423`
  // it wrote "capture.mjs:423 is `if (!/^-[A-Za-z]/.test(t)) return false;`" — that line is
  // actually `const commandEnv = { ...process.env };`. The paragraph was then checkably false
  // ABOUT THE FILE, which is a second error and a much louder one than the misanchor: an auditor
  // reading the source finds a fabricated quotation rather than a misjudged location, and recall
  // measured against it is inflated. The real defect's rationale is accurate about the code and
  // wrong only about which code is the defect, so the forge is shown what is there.
  // ONLY `misanchor` HAS A DESTINATION TO READ. For that mutation `to` is `{file, line}`; for
  // `deflate` and `drop` it is a severity or a decision, so `to.file` is undefined and `path.join`
  // threw — every seed NOT RUN with "The 'path' argument must be of type string", a harness fault
  // wearing a seed's failure. `forgeSlots` already returns a "not applicable" block for those two;
  // this is the other half of that branch, and it belongs on the same condition.
  let destinationSource = null;
  if (mutation === 'misanchor') {
    // ONLY INSIDE THE RECREATED TREE (G-5 of 20260929-181033-ssr-review-r5): to.file comes from a preserved
    // reconciled.md, and its excerpt goes into the forge prompt. A `../` anchor, or a link inside the tree leading out,
    // would put a file from elsewhere on this machine in front of a model. The seed is NOT RUN instead. THROUGH THE
    // OWNER (usage-report-followup.plan.md stage 2; G-3 of 20261031-033859-urr-remediation-2-review): a containment check
    // and then a raw read left a window between them in which the path could be swapped for a link; readInTree checks and
    // reads as one.
    let destText;
    try { destText = readInTree(wt, to.file); } catch (e) {
      if (e?.code !== 'ECONFINED') throw e;
      throw new Error(`the misanchor destination ${JSON.stringify(String(to.file))} is outside the recreated tree; nothing is read`);
    }
    const destLines = destText === null ? [] : destText.split('\n');
    const lo = Math.max(1, to.line - 7);
    const hi = Math.min(destLines.length, to.line + 7);
    destinationSource = destLines.length
      ? destLines.slice(lo - 1, hi).map((l, i) => `${String(lo + i).padStart(5)}  ${l}`).join('\n')
      : '(the destination file could not be read — do not quote or describe any source)';
  }

  // THE FORGE MATCHES THE RECONCILER, SO IT NEVER TAKES THE CANDIDATE. A pass comparing two
  // settings must vary ONE thing, and forging the mutated rationale at the candidate's setting
  // would vary the thing being audited as well as the auditor. The same `judgmentSetting` the spawn
  // uses, with `candidate` left out on purpose.
  const forgeSetting = judgmentSetting({ frozen: contract, rosterDefaults: roster.default_models });
  if (!forgeSetting.ok) throw new Error(`${forgeSetting.why} The forge cannot match the reconciler.`);
  const { model, effort } = forgeSetting;

  const promptPath = path.join(runDir, `forge-${seed}.prompt.md`);
  // THE MUTATION-SPECIFIC PROSE COMES PRE-RENDERED from lib/reconcile-mutations.mjs. One template
  // serves all three mutations because `lib/template.mjs` has no conditionals by design — "every
  // decision stays in code and arrives pre-rendered" — so the branching lives where it can be
  // tested rather than inside a prompt nothing exercises.
  const slots = forgeSlots({
    mutation, groupId, from, to, tolerance: args.tolerance, destinationSource,
  });
  fs.writeFileSync(promptPath, renderTemplate(readTemplate('reconcile-rewrite.md'), {
    group_id: groupId,
    severity,
    decision,
    original_rationale: parts.rationale,
    findings: parts.findings,
    change_instruction: slots.change_instruction,
    forbidden_rule: slots.forbidden_rule,
    destination_source: slots.destination_source,
    // Only `misanchor` moves between files; the others discuss the same code at the same place.
    file_rule: args.mutation !== 'misanchor'
      ? 'The location does not change, so name the same file the original named.'
      : from.file === to.file
        ? `The file is unchanged (\`${to.file}\`); only the line moves.`
        : `The file changes too: discuss \`${to.file}\` and do not name \`${path.basename(from.file)}\` at all.`,
  }, 'reconcile-rewrite.md'));

  // NO TOOLS, and the argv rendered by nodeArgv with the prompt on stdin where the runtime takes it there: both in
  // io/forge-spawn.mjs (decision-panel-seats.plan.md stage 2), which a test drives with a fake runtime. A tool the
  // adapter does not name cannot be denied by that route, which is why the prompt also forbids reading and why the
  // output is checked rather than trusted. The forge needs nothing but the text it was handed.
  const forgePrompt = fs.readFileSync(promptPath, 'utf8');
  // THE SAME ENVIRONMENT DISCIPLINE spawn-node APPLIES, and for the reason its source states
  // outright: "ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN outrank subscription credentials ... A
  // stale or empty-balance key produces a 400 after the node has already burned its turns, which is
  // the worst possible failure shape." This forge passed `process.env` straight through on the
  // reasoning that claude is the local runtime rather than a third-party reviewer, and got exactly
  // that 400 on all six seeds — `"result":"Credit balance is too low"` — while the operator's
  // subscription auth was fine and every prior bench pass had worked, because THOSE went through
  // spawn-node. CLAUDECODE/CLAUDE_CODE_ENTRYPOINT go too: a child that looks like Claude Code
  // starting inside Claude Code can refuse to launch or hang.
  const { env: scrubbed } = scrubChildEnv(process.env, { runtime: FORGE_RUNTIME });
  // DEPTH + 1, NOT ZERO (G-3, panel-codex-arch). This forge is a DIRECT agentic child — `claude -p`
  // rather than a spawn-node call — so nothing downstream increments for it, and `'0'` told it it
  // was the root of the world. A graph-starting command reachable through an incomplete or changed
  // tool-denial configuration would then pass the §8 guard.
  //
  // Tool denial was the only barrier left, and the paragraph below explains why that is not enough
  // on its own: the deny list is the union of every tool name this runtime DECLARES, so a tool the
  // adapter does not name cannot be denied by that route. The depth guard is the one that does not
  // depend on the adapter's vocabulary being complete.
  //
  // The other spawn in this file keeps `'0'` on purpose, because spawn-node adds the +1. Two sites,
  // two rules: one delegates the increment and one must do it itself.
  //
  // The session marks and the API credentials go through their owner, runtimeSessionEnv, as spawn-node's do (G-4 of
  // 20261031-013928-urr-delivery): a local list of four names had fallen behind it, matching by exact case.
  const { env: sessionEnv } = runtimeSessionEnv(scrubbed, { authMode: 'subscription', runtime: FORGE_RUNTIME });
  const childEnv = { ...sessionEnv, GRAPH_NODE_DEPTH: String(DEPTH + 1) };
  const forgeStartedMs = Date.now();
  const r = await spawnForge({ runtime: FORGE_RUNTIME, prompt: forgePrompt, model, effort, cwd: wt, env: childEnv });
  // THE FORGE CALL'S ENTRY (runtime-call-telemetry.plan.md stage 3): a model call like any other, in the one shape.
  const call = callEntry({ reviewer: FORGE_RUNTIME_NAME, model, table: REVIEWER_TABLE, startedMs: forgeStartedMs, endedMs: Date.now(),
    exitCode: r.status ?? null, signal: r.signal ?? null, stdout: r.stdout ?? '', answered: runtimeAnswered(r.stdout ?? '', FORGE_RUNTIME) });
  // `r.out` IS BOTH STREAMS AND `r.stdout` IS THE ANSWER (G-38, in pool.mjs's own source). Parsing
  // the merged buffer means one warning line on stderr turns a good envelope into "no parseable
  // envelope" and the seed into NOT RUN — the harness's failure, attributed to nothing. The log
  // keeps both, because that is what a log is for.
  logLine(`forge ${seed}`, r.out);
  const env2 = readCliEnvelope(r.stdout);
  if (!env2.ok) {
    throw new Error(`the forge produced nothing usable — ${env2.why} (exit ${r.status}); `
      + `see ${path.relative(FRAMEWORK_ROOT, logPath)}`);
  }
  return { rationale: env2.text, cost_usd: env2.cost_usd, model, effort: effort ?? null, call };
}

/**
 * Ask the judge one question about one report.
 *
 * THROUGH external-review.mjs, because that is the single egress point the `external_panel` switch
 * gates — a second reviewer transport here would escape the operator's off switch entirely. Env
 * through reviewerEnv for the same reason the tie-break spawn uses it: a third-party CLI inherits
 * an allow-list, never the shell.
 */
async function askJudge({ label, wt, runDir, injected, groupId, excerpt, report, minutes }) {
  const promptPath = path.join(runDir, `judge-${label}.prompt.md`);
  fs.writeFileSync(promptPath, renderTemplate(readTemplate('second-opinion-judge.md'), {
    injected_error: injected,
    identified_value: IDENTIFIED,
    not_identified_value: NOT_IDENTIFIED,
    neither_value: VOTE_NEITHER,
    group_id: groupId,
    group_excerpt: excerpt,
    report,
  }, 'second-opinion-judge.md'));

  // The engine's home back after the vendor allow-list (G-10 of 20261030-171256-ciss-c-review), as run-graph's arms get it.
  const env = {
    ...reviewerEnv(judge.reviewer, process.env, {
      depth: 0, prefixes: envPrefixesOf(REVIEWER_TABLE[judge.reviewer]), names: envNamesOf(REVIEWER_TABLE[judge.reviewer]),
    }).env,
    ...engineLocationEnv(process.env),
  };
  const r = await shAsync(process.execPath, [
    path.join(HERE, 'external-review.mjs'),
    '--run-dir', runDir, '--node-id', `so-judge-${label}`,
    '--reviewer', judge.reviewer,
    ...(judge.model ? ['--model', judge.model] : []),
    ...(judge.effort ? ['--effort', judge.effort] : []),
    '--mode', 'tie-break',
    '--participants', JUDGE_PARTICIPANTS.join(','),
    '--prompt-file', promptPath,
    // The frozen contract's node_timeout_minutes, through check-timeout.mjs (G-11): a literal 20 was a second authority.
    '--timeout-minutes', String(minutes),
  ], { cwd: wt, env });
  logLine(`judge ${label}`, r.out);
  // external-review ALWAYS prints one structured response (exiting 0, or 5 for a judge that failed
  // its preflight, whose response says so), so an unparseable
  // stdout here is a fact about this harness's invocation, not about the reviewer.
  //
  // STDOUT ALONE, and the comment above already said so while the code read `r.out` — both streams
  // merged (G-38). One stderr line from external-review or the CLI beneath it would have sent a
  // perfectly good ruling to the fallback below, scoring the seed `no-vote` and quietly shrinking
  // the denominator. Exactly the defect the forge had, on the path the full pass depends on.
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { supports: null, rationale: '', not_checked: [{ item: 'judge', reason: 'no parseable ruling' }] };
  }
}

// A FILE BELOW THE RECREATED WORKTREE, named by a corpus manifest or by preserved model output (usage-report-reviewed-
// runs.plan.md stage 4): read through an owner rooted at the tree AS NAMED, so `..` or a link is refused (ECONFINED)
// and never followed out of the tree. Its real path was the root (G-4 of 20261102-231209-rbr-remediation-6-review), which
// resolved a link at the worktree root before the owner's root check saw it. null when the file is not there.
function readInTree(wt, rel) {
  const owner = confined(path.resolve(wt));
  const segments = String(rel).split(/[\\/]/);
  return owner.exists(segments) ? owner.read(segments) : null;
}

async function runSeed(c) {
  const say = (s) => console.log(`   ${s}`);
  console.log(`\n== seed ${JSON.stringify(c.seed)}`);
  if (c.unsafeSeed) {
    notRun.push({ seed: String(c.seed), reason: 'the seed name is not a single safe path segment' });
    return say('NOT RUN: the seed name is not a single safe path segment — it is joined into paths, so it gets none');
  }
  if (!fs.existsSync(c.runDir)) {
    notRun.push({ seed: c.seed, reason: 'no preserved run directory' });
    return say('NOT RUN: no preserved run directory');
  }
  const manifestPath = path.join(CORPUS_DIR, c.seed, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    notRun.push({ seed: c.seed, reason: 'no corpus manifest' });
    return say('NOT RUN: no corpus manifest');
  }
  // NOTHING BEFORE THE SEED'S try MAY THROW (G-7 of 20260929-145942-ssr-review-r2): seeds run in sequence, so one
  // unguarded parse here ended the whole benchmark and never recorded the seeds after it as NOT RUN.
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) {
    notRun.push({ seed: c.seed, reason: `corpus manifest unreadable (${e?.code ?? 'not valid JSON'})` });
    return say('NOT RUN: the corpus manifest could not be read');
  }
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length) {
    notRun.push({ seed: c.seed, reason: `manifest invalid: ${manifestErrors[0]}` });
    return say(`NOT RUN: manifest invalid — ${manifestErrors[0]}`);
  }

  // THE PRESERVED RUN'S OWN ROOT (G-5 of 20261029-235315-rdr-remediation-4-review): the owner below refuses a link under
  // its root, not at it, and the whole directory is copied further down, so a link or junction standing at the preserved
  // run path would carry an outside tree into the copy. Looked at before anything is read from it; never followed.
  let rootSt = null;
  try { rootSt = fs.lstatSync(c.runDir); } catch { /* absent: the strict reader below names it */ }
  if (rootSt && (rootSt.isSymbolicLink() || !rootSt.isDirectory())) {
    const why = 'the preserved run directory is a link or junction, or not a directory; it is not followed';
    notRun.push({ seed: c.seed, reason: `run.json refused — ${why}`, refused: { 'run.json': why } });
    return say(`NOT RUN: run.json refused — ${why}`);
  }
  // THROUGH THE SHARED STRICT READER (G-7): it refuses, by name, what collectRun would refuse later, instead of throwing.
  const record = readRunRecord(c.runDir);
  if (!record.ok) {
    notRun.push({ seed: c.seed, reason: `run.json refused — ${record.why}`, refused: { 'run.json': record.why } });
    return say(`NOT RUN: run.json refused — ${record.why}`);
  }
  const runJson = record.record;
  const commit = runJson.head_commit;
  if (!commit) {
    notRun.push({ seed: c.seed, reason: 'the preserved run.json records no head_commit' });
    return say('NOT RUN: run.json records no head_commit, so its tree cannot be recreated');
  }
  // THE RUN ID COMES FROM A run.json THIS PROCESS DID NOT WRITE, and it later becomes a path that
  // is copied into recursively (G-16). WITH THE OTHER PRECONDITIONS (G-4): the first version of
  // this guard sat after both mkdtempSync calls and before the try/finally, so rejecting an unsafe
  // id leaked two temp directories, skipped every cleanup path and aborted the remaining seeds. The
  // guard was right and its position was wrong — a precondition decided after the setup it was
  // meant to prevent is a precondition in name only.
  if (!isSafeRunId(runJson.run_id)) {
    notRun.push({ seed: c.seed, reason: `run_id ${JSON.stringify(runJson.run_id)} is not a safe path segment` });
    return say(`NOT RUN: run.json declares run_id ${JSON.stringify(runJson.run_id)}, which is not a `
      + 'single safe path segment — it is joined into the staging path and copied into, so a '
      + 'traversal there would escape the staging directory');
  }

  // The --rejudge folder's owner and the kept run's names below it; every read of the kept run goes through it.
  let kept = null;
  // EVERYTHING THAT CAN THROW IS MADE INSIDE THE SEED'S try (G-6 of 20260929-171706-ssr-review-r4): round 2 wrote the
  // rule above ("nothing before the seed's try may throw") and fixed only the parses, leaving the three directories
  // created here. They are declared here and made in the try, so a failure is this seed's NOT RUN and the finally
  // cleans up whatever did get made.
  let wt = null;
  let stagingParent = null;
  let copy = null;
  // What the seed already knew when something later threw (G-9 of ssr-review-r4): the late catch keeps it.
  let knownRefused = {};
  // THE RUN DIRECTORY GOES UNDER THE ENGINE'S OWN HOME, not beside the worktree in the temp root.
  // `runDirAllowed` (lib/reviews-root.mjs) accepts a run directory only inside the repository under
  // review or inside `quorateHome()`, and it is right to: "a directory carrying its own run.json is
  // not authority for where it may be." Two sibling mkdtemps satisfied neither, so every resume
  // refused before spawning anything and all six seeds came back NOT RUN.
  //
  // Inside `wt` was the other option and is the wrong one — that is the tree the node reads, and
  // this project has already paid for a live run directory landing in the reviewed tree
  // (`mirrorWorkingTree` copying it into the arms' checkout). The home is where the contract's
  // empty `reviews_dir` already stages every real run, so this is the sanctioned location rather
  // than a third convention invented for the bench.
  // AND ITS BASENAME MUST BE THE RUN ID (run-graph.mjs:213). A run directory that does not carry
  // its own name is refused — reasonably, since the id is how every artifact and every status file
  // refers back to it. `mkdtemp` names by random suffix, so the unique part is the PARENT and the
  // run directory itself is named exactly what its run.json says it is.
  try {
    wt = fs.mkdtempSync(path.join(os.tmpdir(), `quorate-so-${c.seed}-`));
    // THE TREE THAT RUN ACTUALLY REVIEWED, rebuilt from the commit it recorded. Rebuilding from
    // today's HEAD would resolve the anchor against a file that has since moved — the cross-tree
    // comparison the corpus already refuses elsewhere.
    let r = await withGitLock(() => gitAsync(['worktree', 'add', '--detach', wt, commit], { cwd: FRAMEWORK_ROOT }));
    if (r.status !== 0) throw new Error(`worktree add ${commit.slice(0, 8)} failed:\n${r.out}`);
    r = await gitAsync(['apply', path.join(CORPUS_DIR, c.seed, 'defect.patch')], { cwd: wt });
    if (r.status !== 0) throw new Error(`defect.patch did not apply to ${commit.slice(0, 8)}:\n${r.out}`);
    // Same reason bench-lenses strips it: a tree under review that contains its own answer key is
    // not a benchmark, and second-opinion reads this tree.
    fs.rmSync(path.join(wt, 'bench'), { recursive: true, force: true });

    // THE INTEGRITY CHECK. If the recreated tree does not put the defect where the pass recorded
    // it, something moved and every number from here would be about a different file.
    let seededText;
    try { seededText = readInTree(wt, manifest.defect.file); } catch (e) {
      if (e?.code !== 'ECONFINED') throw e;
      throw new Error(`defect.file ${JSON.stringify(String(manifest.defect.file))} is outside the recreated tree, or reached through a link; nothing is read`);
    }
    if (seededText === null) throw new Error(`defect.file missing from the recreated tree: ${manifest.defect.file}`);
    const anchored = resolveAnchor(seededText, manifest.defect.anchor);
    if (!anchored.ok) throw new Error(`${anchored.why} — the recreated tree does not carry this seed`);
    if (Number.isInteger(c.defectLine) && anchored.line !== c.defectLine) {
      throw new Error(
        `the recreated tree puts the defect at line ${anchored.line}; the pass recorded ` +
        `${c.defectLine}. The tree moved, so this run cannot be re-scored against it.`);
    }
    const defectLine = anchored.line;

    // ------------------------------------------------------------------ pick what to break
    // STAGED WHERE THE RECREATED TREE'S RUNS ARE (run-dir-trust.plan.md stage 3; ARCHITECTURE A-28): run-graph, capture and
    // spawn-node admit a run directory only when it is one of the repository's runs — its staging root under the engine's
    // home, keyed by that tree's own contract's project — so the copy goes there, under a unique parent, once the worktree
    // exists to read the project from. It was <home>/bench-second-opinion/, which every one of them now refuses.
    {
      const own = readContract({ repoRoot: wt });
      if (own.error) throw new Error(`the recreated tree's contract cannot be read (${own.error}), so where its runs are staged is unknown`);
      const stagingRoot = defaultReviewsRoot({ project: own.contract?.project ?? null, repoRoot: wt });
      fs.mkdirSync(stagingRoot, { recursive: true });
      stagingParent = fs.mkdtempSync(path.join(stagingRoot, `${c.seed}-`));
      copy = path.join(stagingParent, runJson.run_id);
    }
    // NO LINK IS COPIED (G-6 of 20261030-024618-rdr-remediation-6-review, G-5 its symptom): cpSync keeps a link as a link,
    // and the copy's nodes/ is read from (the control report, sent to an external judge) and deleted from with raw fs
    // calls, so a junction below the preserved run led both into another tree. Refused here, the seed NOT RUN naming it.
    fs.cpSync(c.runDir, copy, { recursive: true, filter: (from) => {
      const entry = fs.lstatSync(from);
      if (entry.isSymbolicLink()) throw new Error(`${path.relative(c.runDir, from)} in the preserved run is a link or junction; it is not copied or followed`);
      if (entry.isFile() && entry.nlink > 1) noteHardLink(c.seed, 'the preserved-run copy', path.relative(c.runDir, from));
      return true;
    } });

    // RE-POINT THE COPY AT THE TREE THAT NOW EXISTS. The preserved run.json pins `repo_root`,
    // `host.cwd` and `archive_to` at the temp worktree the ORIGINAL bench pass built — a directory
    // deleted the moment that pass ended. `capture.mjs` confines `--cwd` against `host.cwd` from
    // run.json (`:162-165`), so every barrier check was refused against a path that is not there,
    // and run-checks reported that as `FAIL build exit 2 -> null`. capture's own source already
    // names this symptom: a refused capture "reads as a broken build rather than a refused capture".
    //
    // Honest, and narrow. The run IS now against this tree: the worktree was rebuilt from the
    // commit run.json records and its anchor was checked against the line the pass measured, above.
    // What is NOT rewritten is everything that is a DECISION or a RECORD — the frozen `contract`
    // (which is the egress consent), `head_commit`, and the evidence logs, which contain the old
    // path because that is genuinely where the lenses looked. Rewriting those would be falsifying
    // the run rather than relocating it.
    {
      const rj = JSON.parse(fs.readFileSync(path.join(copy, 'run.json'), 'utf8'));
      rj.repo_root = wt;
      if (rj.host) rj.host.cwd = wt;
      // Nothing archives this run any more — the orchestrator is not involved — but the recorded
      // destination pointed into the seeded worktree, which is deleted when the seed ends. A field
      // naming a path nothing will ever write is worse than an absent one.
      rj.archive_to = null;
      fs.writeFileSync(path.join(copy, 'run.json'), JSON.stringify(rj, null, 2));
    }
    // RunRefused lands in this seed's catch: NOT RUN, with the refusal named (G-4 of ltb-review-r4). A node's
    // refusal, the reconcile artifacts' included, travels into the seed's record below.
    const { groupIndex, reconcileDecisions, refused: barrierRefused } = collectRun(copy);
    knownRefused = { ...barrierRefused };
    const tol = manifest.tolerance ?? args.tolerance;
    const barrier = scoreReconcile({
      groupIndex, decisions: reconcileDecisions, file: manifest.defect.file, defectLine, tolerance: tol,
    });
    if (barrier.state !== 'kept') {
      throw new Error(
        `the barrier did not keep this seed (${barrier.state}), so there is no correct anchor to ` +
        'move — a reconciliation that already lost the defect cannot carry an injected anchor error');
    }
    // The group to break is one the barrier KEPT and anchored on the seed. Prefer a `confirmed`
    // one: a symptom's anchor moving is a weaker claim, since it reaches the gate under its root.
    const targetId = barrier.anchored.find((id) => barrier.decisions[id]?.decision === 'confirmed')
      ?? barrier.anchored[0];

    const reconciledPath = path.join(copy, 'reconciled.md');
    const fgPath = path.join(copy, 'finding-groups.json');
    const originalMd = fs.readFileSync(reconciledPath, 'utf8');
    // CROSS-FILE ONLY WHEN THE RATIONALE IS BEING REWRITTEN. Under `borrow` the paragraph is left
    // standing and has to keep making sense above the new header, which is what confines the
    // destination to the same file — and, measured, to two of seven seeds.
    const targetHeader = groupHeaders(originalMd).find((h) => h.group_id === targetId);
    const payloadPathEarly = path.join(copy, 'evidence', 'reconcile', 'payload.json');
    const originalPayload = JSON.parse(fs.readFileSync(payloadPathEarly, 'utf8'));

    // ------------------------------------------------ the two mutations that move no anchor
    // Each refuses for its own measured reason, and the refusal is the seed being NOT RUN rather
    // than the mutation being weakened to fit: `deflate` will not nudge a severity one rung (two
    // reviewers disagree about that in good faith), and `drop` will not orphan a symptom.
    let mutated = null;
    if (args.mutation === 'deflate') {
      const decided = originalPayload.groups.find((g) => g.group_id === targetId) ?? {};
      const fall = deflatedSeverity({ severity: decided.severity, rungs: SEVERITY_RUNGS });
      if (!fall.ok) throw new Error(`cannot deflate ${targetId}: ${fall.why}`);
      mutated = applyDeflate({ reconciledMd: originalMd, payload: originalPayload, targetId, to: fall.to });
      say(`injected: ${targetId} ${fall.from} -> ${fall.to} (fell ${fall.fell} rungs)`);
    } else if (args.mutation === 'drop') {
      const dangle = dropWouldDangle({ payload: originalPayload, targetId });
      if (!dangle.ok) throw new Error(`cannot drop ${targetId}: ${dangle.why}`);
      mutated = applyDrop({ reconciledMd: originalMd, payload: originalPayload, targetId });
      say(`injected: ${targetId} ${mutated.ground_truth.from} -> dropped (nothing names it as a root cause)`);
    }

    let alt = args.mutation !== 'misanchor' ? { ok: true } : alternateAnchor({
      headers: groupHeaders(originalMd), targetId, tolerance: tol,
      allowCrossFile: args.rule === 'rewrite',
    });
    // SECOND SOURCE, and only under `rewrite`. A group header is not the only location a
    // reconciliation discusses — the section's own prose cites others — but a borrowed-and-unchanged
    // rationale has to keep making sense above the new header, and a line mined from inside that
    // very paragraph will not. With the paragraph regenerated, it will.
    if (!alt.ok && args.mutation === 'misanchor' && args.rule === 'rewrite' && targetHeader) {
      // Outside the tree, or through a link, there is no second source: the body is empty, as for a missing file.
      let headerText = null;
      try { headerText = readInTree(wt, targetHeader.file); } catch (e) { if (e?.code !== 'ECONFINED') throw e; }
      const body = headerText === null ? [] : headerText.split('\n');
      // BOUNDED AGAINST THE REAL FILE. A citation can name a line the file does not have, and an
      // anchor past EOF or on a blank line is catchable as nonsense rather than as a misjudgement —
      // a cruder error than the one being measured, and one a lucky auditor would "catch" without
      // ever checking the source.
      const pick = citedLines({ text: groupSection(originalMd, targetId), file: targetHeader.file, excludeLine: targetHeader.line, tolerance: tol })
        .find((n) => n <= body.length && String(body[n - 1] ?? '').trim().length > 0);
      if (pick) {
        alt = { ok: true, file: targetHeader.file, line: pick, borrowed_from: 'prose citation', cross_file: false };
      }
    }
    if (!alt.ok) throw new Error(`no admissible anchor to move ${targetId} to: ${alt.why}`);

    if (args.mutation === 'misanchor') {
      mutated = applyMisanchor({
        reconciledMd: originalMd,
        findingGroups: JSON.parse(fs.readFileSync(fgPath, 'utf8')),
        targetId, to: { file: alt.file, line: alt.line },
      });
      say(`injected: ${mutated.ground_truth.from} -> ${mutated.ground_truth.to} on ${targetId} `
        + `(${alt.cross_file ? 'cross-file, ' : ''}borrowed from ${alt.borrowed_from})`);
    }
    let reconciledMd = mutated.reconciled_md;
    let forge = null;

    // ------------------------------------------------------------- the rationale, rewritten
    const payloadPath = payloadPathEarly;
    // `misanchor` leaves the payload alone and moves finding-groups.json; the other two move the
    // payload and leave finding-groups.json alone. Written here rather than in each branch so one
    // place decides what reaches disk.
    if (mutated.payload) fs.writeFileSync(payloadPath, JSON.stringify(mutated.payload, null, 2));

    // RE-JUDGE MODE TAKES THE MUTATED ARTIFACTS WHOLESALE and forges nothing. The anchor move is
    // deterministic and reproduces above; the FORGE is not, so a fresh rationale would be a
    // different paragraph from the one the preserved report actually responded to — and the report
    // would then be judged against a mutation it never saw, which is the same error as judging the
    // control against the mutated excerpt. The kept run's reconciled.md already carries the exact
    // forged text, so it is copied rather than regenerated.
    if (args.rejudge) {
      // NOT THIS RUN'S OWN STAGING DIRECTORY. `--rejudge` is normally pointed at the staging root,
      // which is also where THIS invocation just created `<seed>-XXXXXX` for the copy it is about
      // to judge — so a plain name match can select the directory the harness made moments ago and
      // copy a file onto itself. Measured: `ENOENT ... copyfile <path> -> <same path>`, one seed of
      // six, decided by readdir order. The candidate must be a different directory AND actually
      // contain a report; matching on the name alone matched the harness's own output.
      //
      // THROUGH THE FOLDER'S OWNER (G-7 of 20261030-010649-rdr-remediation-5-review): the kept run was probed and copied
      // with existsSync and copyFileSync, so a link at the run, at nodes/ or at the report was followed and an outside
      // file became the report sent to the external judge. The folder the operator names is the root; a link at it (the
      // owner checks its root, G-6 and G-10 of 20261102-184751-rbr-remediation-2-review) or at any level below it is
      // refused, and the seed is NOT RUN with the refusal named.
      const keptRoot = confined(path.resolve(args.rejudge));
      let names = [];
      try { names = keptRoot.list([]); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const candidates = names
        .filter((d) => d.startsWith(`${c.seed}-`))
        .filter((d) => path.resolve(args.rejudge, d) !== path.resolve(stagingParent)
          && keptRoot.exists([d, runJson.run_id, 'nodes', 'second-opinion-report.md']))
        .sort();
      if (!candidates.length) {
        throw new Error(`no preserved run for '${c.seed}' under ${args.rejudge} carries a `
          + `second-opinion report for ${runJson.run_id}`);
      }
      // THE REPORT IS NOT COPIED HERE. `copy` currently holds the ORIGINAL run's report, and that
      // is the CONTROL — read a few lines below, before any spawn. Overwriting it now with the kept
      // MUTATED report would make the control a copy of the mutated one and every seed would agree
      // with itself. The mutated report is placed later, where the spawn would have put it.
      kept = { owner: keptRoot, segs: [candidates[0], runJson.run_id] };
      // The kept report is what --rejudge sends to the judge (G-8 of 20261031-055840-urr-remediation-3-review): named here,
      // when it is chosen, if it has another name.
      if (kept.owner.stat([...kept.segs, 'nodes', 'second-opinion-report.md']).nlink > 1) {
        noteHardLink(c.seed, '--rejudge', path.join(...kept.segs, 'nodes', 'second-opinion-report.md'));
      }
      for (const rel of [['reconciled.md'], ['finding-groups.json'], ['evidence', 'reconcile', 'payload.json']]) {
        let data;
        // Each copied file reaches the judge too, so a second name is noted as the report's is (prompt-bound-run-reads
        // census, G-9 of 20261115-005715-pbr-remediation-3-review): the bench's rule is to note and use, not to refuse.
        try { if (kept.owner.stat([...kept.segs, ...rel]).nlink > 1) noteHardLink(c.seed, '--rejudge', path.join(...kept.segs, ...rel)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        try { data = kept.owner.read([...kept.segs, ...rel], null); } catch (e) {
          if (e.code === 'ENOENT') throw new Error(`the preserved run is missing ${path.join(...rel)}: ${path.join(args.rejudge, ...kept.segs, ...rel)}`);
          throw e;
        }
        fs.mkdirSync(path.dirname(path.join(copy, ...rel)), { recursive: true });
        fs.writeFileSync(path.join(copy, ...rel), data);
      }
      reconciledMd = fs.readFileSync(reconciledPath, 'utf8');
      say('re-judging preserved artifacts — no forge, no audit, nothing spawned');
    } else if (args.rule === 'rewrite' && !args.dryRun) {
      const parts = splitGroupSection(reconciledMd, targetId);
      if (!parts.ok) throw new Error(`cannot isolate the reconciler's own prose: ${parts.why}`);
      const decided = reconcileDecisions?.[targetId] ?? {};
      // `from`/`to` mean a LOCATION for misanchor and a severity or decision for the others, so
      // each mutation hands the forge what its own prose needs. Only misanchor's is a file:line.
      const from = args.mutation === 'misanchor'
        ? { file: mutated.ground_truth.from.split(':')[0], line: Number(mutated.ground_truth.from.split(':').pop()) }
        : mutated.ground_truth.from;
      const to = args.mutation === 'misanchor' ? { file: alt.file, line: alt.line } : mutated.ground_truth.to;
      // A PARAGRAPH THAT WAS READ IS THE ONE THAT RUNS. `--forge-only` and a full pass forge
      // INDEPENDENTLY, so reading the cheap tier's output establishes that the forge can produce
      // sound prose — not that the paragraph a later pass used was sound. For `misanchor` and
      // `deflate` a bounded check covers every run regardless. For `drop` nothing does: its guard
      // is `bounded: false` and a human reading the text, and re-rolling throws that reading away.
      //
      // `--forged <file>` closes it the way `--rejudge` closes the same gap for reports. The ground
      // truth is compared before the rationale is accepted, because a paragraph written to justify
      // a DIFFERENT target or a different change is exactly the "judged against a mutation it never
      // saw" error this harness has already made once.
      if (forgedSource) {
        const entry = (forgedSource.seeds ?? []).find((s) => s.seed === c.seed);
        if (!entry?.rationale) throw new Error(`${path.basename(args.forged)} carries no forged rationale for ${c.seed}`);
        const want = mutated.ground_truth;
        const got = entry.ground_truth ?? {};
        if (entry.target_group !== targetId || got.from !== want.from || got.to !== want.to) {
          throw new Error(
            `the forged rationale for ${c.seed} was written for ${entry.target_group} `
            + `${got.from} -> ${got.to}, but this run injected ${targetId} ${want.from} -> ${want.to}`);
        }
        forge = {
          rationale: entry.rationale,
          cost_usd: 0,
          model: entry.forge?.model ?? null,
          effort: entry.forge?.effort ?? null,
          reused_from: path.basename(args.forged),
        };
        say(`reusing the forged rationale from ${forge.reused_from} — the paragraph that was read`);
      } else {
        forge = await forgeRationale({
          wt, runDir: copy, seed: c.seed, groupId: targetId,
          severity: decided.severity ?? '(unrecorded)', decision: decided.decision ?? '(unrecorded)',
          from, to, parts, contract: runJson.contract, mutation: args.mutation,
        });
      }
      // BEFORE ANYTHING IS SPENT ON IT. This is the check the original design asserted and did not
      // have; a rewrite that still betrays the injection is NOT RUN, never a miss.
      //
      // `bounded` travels with the answer because it is not the same guarantee for every mutation:
      // misanchor and deflate have a mechanical tell to look for, drop does not, and a row resting
      // on a prompt instruction must not be read as one resting on a check.
      const tell = tellForMutation({
        mutation: args.mutation, rationale: forge.rationale, original: parts.rationale,
        from, to, tolerance: tol,
      });
      if (!tell.ok) throw new Error(`the forged rationale is unusable: ${tell.why}`);
      forge.tell_bounded = tell.bounded;
      const spliced = applyRewrittenRationale({
        reconciledMd, payload: JSON.parse(fs.readFileSync(payloadPath, 'utf8')),
        groupId: targetId, rationale: forge.rationale,
      });
      reconciledMd = spliced.reconciled_md;
      fs.writeFileSync(payloadPath, JSON.stringify(spliced.payload, null, 2));
      say(`rewrote ${targetId}'s rationale (${forge.model}${forge.effort ? '/' + forge.effort : ''}, `
        + `$${(forge.cost_usd ?? 0).toFixed(4)}) — ${tell.why}`);
    }

    fs.writeFileSync(reconciledPath, reconciledMd);
    // ONLY WHAT THIS MUTATION TOUCHED. `misanchor` moves the anchor in finding-groups.json;
    // `deflate` and `drop` move severity and decision, which live in the payload and not there at
    // all. Writing `undefined` here threw mid-seed and was reported as NOT RUN — a harness fault
    // wearing a seed's failure, which is the shape every other check in this file exists to refuse.
    if (mutated.finding_groups) {
      fs.writeFileSync(fgPath, JSON.stringify(mutated.finding_groups, null, 2));
    }

    // ------------------------------------------------- the control, and clearing the node
    const reportPath = path.join(copy, 'nodes', 'second-opinion-report.md');
    const controlReport = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : null;
    if (!controlReport) throw new Error('the preserved run has no second-opinion report, so there is no control');

    // THREE PRICE TIERS, AND THIS IS THE BOUNDARY OF THE SECOND. Everything above is either free or
    // cents; the judgment-model spawn below is dollars. The tiers exist because each one establishes
    // the preconditions of the next, and a failure found at the cheap tier is a failure not paid for
    // at the expensive one:
    //
    //   --dry-run      $0      recreate the tree, check the anchor against the recorded line,
    //                          confirm the barrier KEPT the seed, find an admissible destination,
    //                          apply the mutation, confirm the rationale can be isolated and a
    //                          control report exists. Spawns nothing.
    //   --forge-only   ~cents  the above, plus the rewrite: one call at the reconciler's own model,
    //                          mechanically checked for the tell. Proves the forged error is usable
    //                          before anything audits it.
    //   (neither)      ~$2.11  the above, plus one second-opinion and two judge rulings per seed.
    //
    // The listing at the very top prices a pass without doing any of it.
    if (args.dryRun) {
      // The forge is the one billed step the dry run cannot perform, so it checks the precondition
      // the forge depends on instead: that the reconciler's own paragraph can be isolated from the
      // mechanical lines above it and the lenses' words below it. A section that will not split is
      // a seed the rewrite cannot use, and finding that out here costs nothing.
      let split = '(not applicable under --rule borrow)';
      if (args.rule === 'rewrite') {
        const parts = splitGroupSection(reconciledMd, targetId);
        if (!parts.ok) throw new Error(`cannot isolate the reconciler's own prose: ${parts.why}`);
        split = `${parts.rationale.length} bytes of rationale, ${parts.findings.split('\n').length} finding line(s) left alone`;
      }
      // THE ONE PRECONDITION THE DRY RUN USED TO SKIP, and it cost a full pass to learn. Every
      // other check here is about the artifacts; this one is about whether `run-graph` will accept
      // the run directory at all. It refused all six seeds — the worktree and the run copy were
      // sibling mkdtemps in the temp root, so the run dir was inside neither the repository under
      // review nor the engine's home — and because the dry run never invokes run-graph, no cheap
      // tier could see it. Asked of the one owner run-graph admits it with (admitRun, ARCHITECTURE A-28) rather than a
      // restatement of its rule: a second spelling here would eventually disagree with the one that decides.
      const placed = admitRun({ runDir: copy, repoRoot: wt });
      if (!placed.ok) throw new Error(`run-graph would refuse this run directory: ${placed.why}`);
      // The second of run-graph's two run-dir preconditions (`:213`). True by construction here,
      // and asserted anyway: both were found by SPENDING, one pass each, because the dry run
      // checked the artifacts and never asked whether the orchestrator would accept the directory
      // holding them. A change to how `copy` is named should cost $0 to discover, not $0.21.
      if (path.basename(copy) !== runJson.run_id) {
        throw new Error(`run-graph would refuse this run directory: basename ${path.basename(copy)} `
          + `does not match run.json.run_id ${runJson.run_id}`);
      }
      // AND ACTUALLY RUN THE EVIDENCE RECORDER, because three paid attempts died past this point
      // and every one of them was something the dry run declined to exercise. `capture.mjs` is how
      // a node records evidence, it costs a second and no model, and it is the one that refused
      // when run.json still pinned a deleted worktree — it confines `--cwd` against `host.cwd` from
      // run.json, so a stale pin refuses every capture the audited node attempts. The barrier that
      // first exposed this no longer runs; the confinement it proved still governs the node.
      // The lesson those attempts bought, applied: check what the NEXT tier does, not what is
      // convenient to check about the data.
      //
      // WITHOUT EXECUTING ANYTHING (G-8 of 20260929-162936-ssr-review-r3; operator, "1 fix with B"): this ran the
      // preserved contract's `build` through capture, so a dry run executed a project-declared command with no
      // opt-in. capture checks the run pin and --cwd confinement BEFORE its allow-list, so asking it to run a command
      // no contract declares proves the checks that sank those attempts pass — when, and only when, the refusal is
      // the allow-list's. What this no longer shows is capture writing its evidence file, since nothing runs.
      const probe = await shAsync(process.execPath, [
        path.join(HERE, 'capture.mjs'), '--run-dir', copy, '--node', 'pre-flight',
        '--name', 'dry-run-probe', '--cwd', wt, '--', process.execPath, '--quorate-dry-run-undeclared-probe',
      ], { cwd: wt });
      if (!/capture: refusing to execute/.test(String(probe.out))) {
        throw new Error(`the barrier's evidence recorder would refuse this run: `
          + `${String(probe.out).trim().split('\n')[0]}`);
      }
      say('capture reached its allow-list in this run dir — the pin and --cwd checks pass, and nothing was executed');
      // READY ONLY NOW (G-4 of 20260929-185355-ssr-review-r6): the row was pushed before the placement and capture
      // checks above, so a seed that then failed was counted both scoreable and NOT RUN.
      rows.push({ seed: c.seed, mutated: 'dry-run', control: 'dry-run' });
      perSeed.push({
        seed: c.seed, dry_run: true, rule: args.rule, ground_truth: mutated.ground_truth,
        target_group: targetId, borrowed_from: alt.borrowed_from, cross_file: Boolean(alt.cross_file),
        defect_line: defectLine, head_commit: commit, control_report_bytes: controlReport.length,
        // Every seed record carries the refusals the seed collected (G-7 of ssr-review-r6).
        refused: { ...knownRefused },
      });
      say(`would rewrite: ${split}`);
      say(`run dir accepted: inside ${placed.where}`);
      return say(`control report present, ${controlReport.length} bytes — nothing spawned`);
    }

    if (args.forgeOnly) {
      rows.push({ seed: c.seed, mutated: 'forge-only', control: 'forge-only' });
      perSeed.push({
        seed: c.seed, forge_only: true, rule: args.rule, ground_truth: mutated.ground_truth,
        target_group: targetId, borrowed_from: alt.borrowed_from, cross_file: Boolean(alt.cross_file),
        defect_line: defectLine, head_commit: commit,
        // The refusals the seed collected, as every seed record carries them (G-5 of ssr-review-r6; operator, "2 A").
        refused: { ...knownRefused },
        forge: forge && { model: forge.model, effort: forge.effort, cost_usd: forge.cost_usd, call: forge.call ?? null },
        // THE FORGED PARAGRAPH ITSELF, because this tier exists to be read. A mechanical check that
        // the tell is gone is not the same as a human agreeing the paragraph reads like the
        // reconciler — and that judgement cannot be made from a pass/fail.
        rationale: forge?.rationale ?? null,
      });
      return say('forge-only: nothing audited, nothing judged');
    }

    fs.rmSync(reportPath, { force: true });
    fs.rmSync(path.join(copy, 'nodes', 'second-opinion.status.json'), { force: true });

    // ------------------------------------------------------------ spawn the ONE node, directly
    // NOT `run-graph --resume`, and the reason is a measurement rather than a preference.
    //
    // A resume re-derives the grouping unconditionally: `run-graph.mjs:2729` writes
    // finding-groups.json from the lens reports on EVERY run. So the injected anchor survived in
    // reconciled.md and reverted in finding-groups.json, and `second-opinion` reported precisely
    // that — "finding-groups.json anchors G-3 at line 1014 ... reconciled.md renders it as :711".
    // An auditor catching THAT has found this harness, not a misjudged anchor. The mutation cannot
    // be made to survive the regroup without forging a lens's own finding, which is the one thing
    // this design refuses.
    //
    // A resume also re-runs the pre-flight barrier, which is cost and risk for a step that audits
    // a reconciliation rather than the tree.
    //
    // `spawnNode` in run-graph is a thin wrapper over this same CLI (`run-graph.mjs:1081-1163`), so
    // driving `spawn-node.mjs` is the sanctioned interface and not a second orchestrator. Every
    // value comes from the run's OWN FROZEN CONTRACT, never from today's — the same rule the rest
    // of this harness follows, and the reason a re-scored run is comparable to the pass it came
    // from. The brief is the one the ORIGINAL node was given, already on disk: rewriting it here
    // would put a second copy of the orchestrator's prose in a benchmark, where it would drift.
    const frozen = runJson.contract ?? {};
    const budget = String(frozen.review?.budget_usd_per_node ?? '').trim();
    // THE SETTING UNDER TEST, resolved in one place. `?? 'opus'` here meant a frozen contract with
    // no judgment model was benched silently on a model nobody declared — while the forge fifty
    // lines up THREW on the same absence. One file, one question, two answers.
    const setting = judgmentSetting({
      candidate: args.candidate, frozen, rosterDefaults: roster.default_models,
    });
    if (!setting.ok) throw new Error(setting.why);
    const soArgv = [
      path.join(HERE, 'spawn-node.mjs'),
      '--run-dir', copy, '--repo-root', wt,
      '--node-id', SPAWNED_NODE, '--mode', 'panel',
      '--schema-variant', 'none',
      '--model', setting.model,
      '--timeout-minutes', String(contractMinutes(frozen.review, 'node_timeout_minutes')),
      '--budget-usd', budget === '' ? 'none' : budget,
      '--skill-command', '/second-opinion',
      '--inline-skill',
    ];
    if (setting.effort) soArgv.push('--effort', setting.effort);
    // The copy's frozen runtime, chosen by the one owner (contract-runtime-and-session-files.plan.md stage 1).
    soArgv.push('--runtime', selectAdapters({ contract: frozen }).runtime);
    // addDirs: [repoRoot], plus the run directory itself — `widen` in run-graph adds it whenever the
    // run is staged OUTSIDE the tree under review, which is exactly where this one is.
    soArgv.push('--add-dir', wt, copy);
    // A FOURTH TIER: RE-JUDGE PRESERVED REPORTS AND SPAWN NOTHING.
    //
    // The judge is the part of this instrument most likely to need changing — it fired on five of
    // six CONTROLS, and diagnosing that is iterative. Re-running the audits to test a judge costs
    // $5.13 for reports that did not change, and pays it again on every attempt. The reports from a
    // `--keep` pass are on disk; the judge runs on the adjudicator's own vendor at $0 Anthropic.
    // So the expensive half is reusable, and the same reports judged under two prompts is a
    // cleaner comparison than two passes would be — the audits are IDENTICAL rather than merely
    // similar, so any difference in the rulings is the judge and nothing else.
    if (args.rejudge) {
      // Placed exactly where the spawn would have written it, and only now — the control was read
      // from this path above and must not have been this file.
      fs.writeFileSync(reportPath, kept.owner.read([...kept.segs, 'nodes', 'second-opinion-report.md'], null));
    } else {
      r = await shAsync(process.execPath, soArgv, {
        cwd: wt,
        env: { ...process.env, GRAPH_NODE_DEPTH: '0' }, // spawn-node adds the +1
      });
      logLine(`spawn-node ${c.seed}`, r.out);
    }
    if (!fs.existsSync(reportPath)) {
      throw new Error(`second-opinion produced no report — see ${path.relative(FRAMEWORK_ROOT, logPath)}`);
    }

    // THE MUTATION HAS TO HAVE BEEN THERE WHILE THE NODE READ IT, checked AFTER the spawn rather
    // than assumed from having written it before.
    //
    // Spawning the node directly removes the mechanism that undid it — `run-graph`'s unconditional
    // regroup at `:2729` — so this should now always pass. It is kept, and checked across every
    // artifact the mutation touches, precisely because it did NOT always pass: the version that
    // looked only at reconciled.md waved through a half-undone state and the audit reported the
    // two files contradicting each other. A guarantee that is currently true by construction is
    // the cheapest kind to keep verifying, and the most expensive kind to assume.
    const survived = injectionSurvived({
      mutation: args.mutation,
      reconciledMd: fs.readFileSync(reconciledPath, 'utf8'),
      findingGroups: JSON.parse(fs.readFileSync(fgPath, 'utf8')),
      payload: JSON.parse(fs.readFileSync(payloadPath, 'utf8')),
      targetId,
      groundTruth: mutated.ground_truth,
    });
    if (!survived.ok) {
      throw new Error(
        `the mutation did not survive to the audit — ${survived.why}. This seed cannot be scored `
        + 'against an error the node was not shown.');
    }
    const mutatedReport = fs.readFileSync(reportPath, 'utf8');

    // ------------------------------------------------------------------------------- judging
    // EACH REPORT IS JUDGED AGAINST THE RECONCILIATION IT ACTUALLY READ. This said "ONE VARIABLE.
    // The two prompts are identical except for the report, so a difference in the rulings is a
    // difference between the reports and nothing else" — which sounds like rigour and was the
    // defect. Holding the MUTATED excerpt constant meant the control report was shown beside a
    // reconciliation it never saw: the judge read a report discussing the defect at line 1014,
    // saw an excerpt anchored at 711, spotted the mismatch ITSELF, and credited the report with an
    // observation the report never made.
    //
    // Measured on five seeds under the tightened prompt: four of five controls scored `identified`,
    // every citation naming the TRUE line. Constant-excerpt was not a control at all — it was a
    // second way to produce the finding. Each report now gets its own reconciliation, so a report
    // that describes a correct anchor sits beside that correct anchor and there is no mismatch for
    // the judge to manufacture.
    const mutatedExcerpt = groupSection(reconciledMd, targetId) ?? '(no section rendered)';
    const controlExcerpt = groupSection(originalMd, targetId) ?? '(no section rendered)';
    const ask = (label, report, excerpt) => askJudge({
      label: `${c.seed}-${label}`, wt, runDir: copy,
      injected: mutated.ground_truth.statement, groupId: targetId, excerpt, report,
      minutes: contractMinutes(frozen.review, 'node_timeout_minutes'),
    });
    const mutatedRuling = await ask('mutated', mutatedReport, mutatedExcerpt);
    const controlRuling = await ask('control', controlReport, controlExcerpt);

    const scored = {
      seed: c.seed,
      mutated: scoreJudgedReport({
        vote: mutatedRuling.supports, rationale: mutatedRuling.rationale, report: mutatedReport,
      }),
      control: scoreJudgedReport({
        vote: controlRuling.supports, rationale: controlRuling.rationale, report: controlReport,
      }),
    };
    const { costsByNode, usageByNode, durationsByNode, configByNode, refused } = collectRun(copy);
    // COUNTED ONLY AFTER THE READ THAT CAN REFUSE IT (G-10 of 20260929-162936-ssr-review-r3): the row was pushed
    // first, so a RunRefused from the read above left a refused seed in the summary.
    rows.push({ seed: c.seed, mutated: scored.mutated.state, control: scored.control.state });
    perSeed.push({
      seed: c.seed,
      // Nodes and artifacts left out of this seed's score, and why.
      refused: { ...barrierRefused, ...refused },
      rule: args.rule,
      ground_truth: mutated.ground_truth,
      target_group: targetId,
      borrowed_from: alt.borrowed_from,
      cross_file: Boolean(alt.cross_file),
      // THE THIRD MODEL, NAMED IN THE ARTIFACT. A reader of this file alone must be able to see
      // that the error it scores was written by a model, which one, and what that cost — the whole
      // reason the rewrite needed arguing for is that it adds a forger to the instrument.
      forge: forge && {
        model: forge.model, effort: forge.effort, cost_usd: forge.cost_usd, call: forge.call ?? null,
        rationale_bytes: forge.rationale.length,
        // WHETHER THE PARAGRAPH WAS READ BEFORE IT RAN. A re-rolled rationale and a reused one are
        // different evidence — especially for `drop`, whose tell check is unbounded, where a reused
        // paragraph is the only kind anyone has actually inspected.
        reused_from: forge.reused_from ?? null,
        tell_bounded: forge.tell_bounded ?? null,
      },
      defect_line: defectLine,
      head_commit: commit,
      // THE SETTING THIS SEED'S NUMBER WAS PRODUCED AT, per seed rather than once at the top,
      // because the setting IN FORCE is a property of the run each seed came from. A corpus whose
      // preserved runs were minted at two different settings compares against two baselines, and
      // averaging over that silently is the shape I-3 asks the comparison to avoid.
      setting: {
        model: setting.model,
        effort: setting.effort,
        source: setting.source,
        is_candidate: setting.is_candidate,
        in_force: {
          model: frozen.review?.models?.judgment ?? null,
          effort: frozen.review?.effort?.judgment ?? null,
        },
      },
      mutated: scored.mutated,
      control: scored.control,
      judge: { id: judge.id ?? judge.reviewer, reviewer: judge.reviewer, model: judge.model ?? null, effort: judge.effort ?? null },
      // The judge's two calls' entries (runtime-call-telemetry.plan.md stage 3), answered when a ruling came back.
      judge_calls: {
        mutated: markAnswered(mutatedRuling?.call ?? null, mutatedRuling?.supports != null),
        control: markAnswered(controlRuling?.call ?? null, controlRuling?.supports != null),
      },
      // WHAT THIS PASS SPENT, SEPARATED FROM WHAT IT INHERITED (measured 2026-09-22).
      //
      // `collectRun` reads every node in the run directory, and this run directory is a COPY of a
      // finished pass — so `costsByNode` carries fifteen nodes that ran on 2026-09-21 alongside the
      // one node this pass spawned. Writing it out flat reported $19.30 for a pass that spent
      // $5.13: not an estimate that drifted, a number 3.8x wrong sitting in the artifact a reader
      // would quote. The same contamination applies to usage and durations, so all three are split
      // the same way rather than only the one that was noticed.
      //
      // `spent` is this pass: the re-spawned node plus the forge. `inherited` is the preserved
      // run's, kept because a per-node comparison against the original is the reason to look —
      // and NAMED, so it can never be summed into a total that claims to be a cost.
      ...splitSpend({
        costsByNode, durationsByNode, usageByNode, configByNode,
        nodeId: SPAWNED_NODE, extraUsd: forge?.cost_usd ?? null, extraLabel: 'forge_usd',
      }),
    });
    say(`mutated: ${scored.mutated.state} · control: ${scored.control.state}`);
    if (scored.mutated.quote) say(`cited: "${scored.mutated.quote.slice(0, 100)}"`);
  } catch (err) {
    // The refusal travels into the result file, not only the console (G-4 of 20260929-124952-ssr-review).
    // With what the seed had already collected (G-9 of 20260929-171706-ssr-review-r4), not only the refusal that ended it.
    const refusedNow = { ...knownRefused, ...(err?.name === 'RunRefused' ? { 'run.json': err.why } : {}) };
    notRun.push({ seed: c.seed, reason: String(err.message).split('\n')[0], ...(Object.keys(refusedNow).length ? { refused: refusedNow } : {}) });
    say(`NOT RUN: ${err.message}`);
  } finally {
    // The worktree always goes; the run COPY is kept only on request, because it holds the mutated
    // artifacts and both reports, which is what a disputed number is re-read from.
    // Only what setup actually made: a failure inside the try can come before any of it exists (G-6).
    // EVERY STEP GUARDED, AND A FAILURE SAID (G-10 of 20260929-181033-ssr-review-r5; G-9 of ssr-review-r2): a failed
    // worktree removal was swallowed by an empty catch, and an rmSync that threw here — a locked file on Windows —
    // left finally and ended the benchmark. Cleanup that fails leaves something behind; it is reported, not fatal.
    const cleanup = (what, step) => {
      try { return step(); } catch (e) { say(`cleanup: ${what} failed (${e?.code ?? String(e?.message ?? e).split('\n')[0]}); left in place`); return null; }
    };
    if (wt) {
      const removed = await withGitLock(() => gitAsync(['worktree', 'remove', '--force', wt], { cwd: FRAMEWORK_ROOT }))
        .catch((e) => ({ status: -1, out: String(e?.message ?? e) }));
      if (removed?.status !== 0) say(`cleanup: git worktree remove failed (${String(removed?.out ?? '').trim().split('\n')[0]}); \`git worktree prune\` clears the record`);
      cleanup('removing the recreated tree', () => fs.rmSync(wt, { recursive: true, force: true }));
    }
    // The PARENT goes, not just the run directory inside it — removing only `copy` would leave an
    // empty mkdtemp shell under the engine's home on every seed of every pass.
    // `kept` only for a copy that exists (G-11 of ssr-review-r5): copy is named before cpSync makes it.
    if (args.keep && copy && fs.existsSync(copy)) console.log(`   kept: ${copy}`);
    else if (stagingParent) cleanup('removing the staging directory', () => fs.rmSync(stagingParent, { recursive: true, force: true }));
  }
}

// SERIAL, deliberately. Each seed re-spawns one judgment node and two external judges; the pass
// this mutates already established the concurrency ceiling, and the value here is a clean number
// rather than a fast one.
//
// AND THE LOOP HOLDS THE GUARANTEE (option A of ssr-review-r5): one seed never ends the pass, whatever it throws and
// from wherever — setup, body or cleanup. Twice this was attempted by listing the calls before a seed's try, and each
// time a call nobody listed got out (G-6 of ssr-review-r4, G-8 of r5). A seed already recorded — scored, or NOT RUN by
// its own catch — is not recorded again.
const recorded = (seed) => perSeed.some((p) => p.seed === seed) || notRun.some((n) => n.seed === seed);
for (const c of candidates) {
  try {
    await runSeed(c);
  } catch (err) {
    const why = String(err?.message ?? err).split('\n')[0];
    if (!recorded(c.seed)) notRun.push({ seed: String(c.seed), reason: `the seed threw outside its own handling: ${why}` });
    console.log(`   NOT RUN: the seed threw outside its own handling — ${why}`);
  }
}

// NEITHER CHEAP TIER WRITES A RESULT FILE. They measured nothing, and a file in bench/results
// named like a measurement is read later as one — the reason this project names its empty result
// files rather than omitting them is the same reason it must not name a non-measurement as a
// result. `--forge-only` does leave its forged paragraphs, under a name that cannot be mistaken
// for a score, because reading them is the whole point of that tier.
if (args.dryRun) {
  console.log(`\n== dry run, mutation '${args.mutation}' (rule ${args.rule}) — nothing spawned, nothing spent`);
  console.log(`   ${perSeed.length}/${candidates.length} seed(s) would be scoreable`);
  if (notRun.length) for (const n of notRun) console.log(`   NOT RUN ${n.seed}: ${n.reason}`);
  for (const h of hardLinks) console.log(`   HARD LINK ${h.seed} (${h.where}): ${h.file}`);
  for (const l of refusalLines([...perSeed, ...notRun])) console.log(l);   // scored seeds' refusals too (G-6)
  console.log('   Re-run with QUORATE_BENCH=1 and no --dry-run to spend.');
  process.exit(perSeed.length ? 0 : 1);
}
if (args.forgeOnly) {
  // PER MUTATION, like the result path. Three mutations sharing one forge file is the overwrite
  // `--seed`, `--rejudge` and the result path each had to be fixed for — and it already happened
  // here: the `deflate` forge-only pass silently replaced the `misanchor` paragraphs, which is the
  // one artifact whose whole purpose is being read afterwards.
  // THE SAME RULE, and the forge file needs it for the same reason plus one of its own: a paragraph
  // written to mutate a reconciliation is independent of the setting the AUDIT then runs at, so a
  // candidate pass reusing `--forged` must not be reading a file some other pass overwrote.
  const forgePath = path.join(RESULTS_DIR, resultBasename({
    stamp, mutation: args.mutation, candidate: args.candidate,
  }).replace(/\.json$/, '.forge.json'));
  const spent = perSeed.reduce((a, s) => a + (s.forge?.cost_usd ?? 0), 0);
  // REDACTED WHOLE at the write (G-8 of 20260929-124952-ssr-review). The forge file is NOT tracked — .gitignore keeps
  // bench/results/*.forge.json on the untracked side as model text — so this guards a file that is read and may be
  // shared, not one git carries (corrected after G-5 of ssr-review-r6, which found this comment calling it tracked).
  // A forged paragraph holding a secret-shaped string is reused redacted by `--forged`.
  fs.writeFileSync(forgePath, JSON.stringify(redactTree({
    schema_version: 1, not_a_measurement: 'forged rationales only — nothing was audited or judged',
    mutated_from: path.basename(resultPath), injection_rule: args.rule, tolerance: args.tolerance,
    framework: frameworkStamp(FRAMEWORK_ROOT), seeds: perSeed, not_run: notRun, hard_links: hardLinks,
  }), null, 2) + '\n');
  console.log(`\n== forge only, rule ${args.rule} — ${perSeed.length}/${candidates.length} seed(s) forged, $${spent.toFixed(4)}`);
  if (notRun.length) for (const n of notRun) console.log(`   NOT RUN ${n.seed}: ${n.reason}`);
  for (const l of refusalLines([...perSeed, ...notRun])) console.log(l);   // scored seeds' refusals too (G-6)
  console.log(`   ${path.relative(FRAMEWORK_ROOT, forgePath)} — read the paragraphs before spending on the audit.`);
  process.exit(perSeed.length ? 0 : 1);
}

const summary = summariseSecondOpinion(rows);
// A REJUDGE IS AN EXPERIMENT ON THE JUDGE, NOT A MEASUREMENT OF THE AUDIT, so it writes its own
// path. Sharing the audited result's name would let a judge experiment silently replace the run
// that actually spawned the node — the same overwrite `--seed` already had to be fixed for, and
// this one would destroy something that cost $5.13 to produce.
// EVERY KNOB THAT CHANGES WHAT WAS MEASURED IS IN THE FILENAME, and `resultBasename` is where that
// is decided rather than here. The rule had been patched three times in place — `--seed`,
// `--rejudge`, per-mutation — and the fourth knob, the candidate setting, arrived without anyone
// noticing the pattern: a `--model sonnet` pass would have written over the opus baseline it exists
// to be compared against. Caught with the money about to be spent on it.
const outPath = path.join(RESULTS_DIR, resultBasename({
  stamp, mutation: args.mutation, rejudge: Boolean(args.rejudge), candidate: args.candidate,
}));
// REDACTED WHOLE at the tracked write (G-8, G-1 of 20260929-124952-ssr-review): the judge's verbatim quote, refusal
// reasons and NOT RUN reasons are all values here, and bench/results is tracked.
fs.writeFileSync(outPath, JSON.stringify(redactTree({
  schema_version: 1,
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  measured_at: new Date().toISOString().slice(0, 10),
  mutated_from: path.basename(resultPath),
  mutation: args.mutation,
  injection_rule: args.rule,
  tolerance: args.tolerance,
  // WHICH SETTING THIS PASS MEASURED — null when it ran the one already in force. A result file
  // that does not say is a number nobody can place beside another one, which is the comparison
  // I-3 asks for; the per-seed `setting` block carries the baseline each was measured against.
  candidate: args.candidate ?? null,
  framework: frameworkStamp(FRAMEWORK_ROOT),
  judge: { id: judge.id ?? judge.reviewer, reviewer: judge.reviewer, model: judge.model ?? null, effort: judge.effort ?? null },
  // WHAT THIS NUMBER IS NOT, in the artifact rather than only in the prose that quotes it. Every
  // caveat here is one a reader of the JSON alone would otherwise have to already know.
  caveats: [
    'One mutation shape (misanchor). This measures detection of errors of that shape, not of the '
    + 'distribution of mistakes a real reconciler makes.',
    ...(args.rule === 'rewrite' ? [
      'THREE MODELS: one forged the error by rewriting the reconciler\'s rationale to match a '
      + 'moved anchor, one audited it, one judged the audit. The forger is pinned to the model and '
      + 'effort the reconciler ran at, given no tools, and its output is checked mechanically for '
      + 'the tell (no line within tolerance of the true anchor; the injected line present). The '
      + 'forge is shown the real source at the destination, because without it the paragraph '
      + 'invents the line\'s contents and becomes checkably false about the FILE — a second and '
      + 'louder error than the misanchor, which would inflate recall. That bounds it; it does not '
      + 'make the injected error indistinguishable from a real one.',
    ] : [
      'RULE `borrow`: the rationale was left standing. Measured 2026-09-22, this corpus\'s '
      + 'rationales restate their own anchor by line number, so the paragraph under the moved '
      + 'header still names the real location. A catch here may be tamper-detection rather than '
      + 'the audit doing its job. Prefer --rule rewrite.',
    ]),
    'The ruling is a model grading a model. The verbatim-quote requirement and the control bound '
    + 'how wrong it can be silently; they do not make it a mechanical measurement.',
    'false_alarms is the instrument\'s own error rate and is never subtracted from recall.',
    'Seeds are few enough that one seed is a large fraction of the result; no aggregate threshold '
    + 'is honest here, per AC 8 of the parent request.',
  ],
  summary,
  // THE TOTAL, COMPUTED ONCE HERE so nobody has to sum a per-seed block to answer "what did this
  // cost". The first version of this file left only the per-node map, and summing it gave $19.30
  // for a pass that spent $5.13 — because the map is dominated by the preserved run's nodes. A
  // number a reader has to assemble is a number a reader will assemble wrongly.
  // ABSENCE RECORDED, NOT IMPUTED (G-7, panel-codex-contract). `?? 0` made a seed the vendor never
  // priced look like a seed that cost nothing, and always emitted a number. `sumSpend` keeps the
  // total null when nothing was priced and carries `absent` when only some seeds were — a partial
  // total that says it is partial. The same rule `splitSpend` already follows one field over.
  //
  // AND THE NOTE NAMES THE RUNTIME THAT RAN (panel-codex-arch). It said "Anthropic only" while the
  // forge runtime is selected from the adapter table at run time, so changing the default would
  // leave a durable artifact attributing this spend to whoever happened to be hardcoded (I-4, §4).
  spent: {
    second_opinion_usd: sumSpend(perSeed, 'second_opinion_usd'),
    forge_usd: sumSpend(perSeed, 'forge_usd'),
    total_usd: sumSpend(perSeed, 'total_usd'),
    $note: `Spend on the '${FORGE_RUNTIME_NAME}' node runtime only. The judge runs on the `
      + "adjudicator's own vendor and is not billed here. A null total means nothing was priced, "
      + 'which is not the same as nothing being spent; `absent` counts the seeds that reported none.',
  },
  not_run: notRun,
  hard_links: hardLinks,
  seeds: perSeed,
}), null, 2) + '\n');
// The bench run's telemetry record (telemetry-records.plan.md stage 3), beside its results; a note, never a failed bench.
{
  const tel = writeBenchRecord(outPath, { repoRoot: FRAMEWORK_ROOT });
  if (!tel.ok) console.error(`bench-second-opinion: ${tel.note}`);
}

console.log(`\n== second-opinion, mutation '${args.mutation}', judge ${judge.id ?? judge.reviewer}`);
console.log(`   scoreable ${summary.scoreable}/${summary.seeds}   caught ${summary.caught}   recall ${summary.recall ?? 'n/a'}`);
// BOTH DENOMINATORS AT THE GATE, not just in the JSON. A reader who sees only the line above cannot
// tell how many of those seeds the audit would have objected to with nothing injected.
{
  const cc = summary.clean_control;
  console.log(`   clean control only: ${cc.caught}/${cc.seeds}   recall ${cc.recall ?? 'n/a'}`
    + (cc.excluded - (cc.control_unverified ?? 0)
      ? `   (${cc.excluded - (cc.control_unverified ?? 0)} seed(s) excluded — the control already identified it)` : '')
    + (cc.control_unverified ? `   (${cc.control_unverified} seed(s) excluded — the control gave no verdict)` : ''));
}
console.log(`   false alarms on the control: ${summary.false_alarms}`);
if (notRun.length) for (const n of notRun) console.log(`   NOT RUN ${n.seed}: ${n.reason}`);
// EVERY REFUSAL ON STDOUT, a scored seed's included (G-6 of 20260929-195848-ssr-review-r7): they reached the result file
// and stderr only, so a partly refused pass read as clean to anyone reading this summary.
for (const l of refusalLines([...perSeed, ...notRun])) console.log(l);
{
  const so = sumSpend(perSeed, 'second_opinion_usd');
  const fg = sumSpend(perSeed, 'forge_usd');
  const usd = (n) => (n === null ? 'not priced' : `$${n.toFixed(2)}`);
  const both = so.total === null && fg.total === null ? null : (so.total ?? 0) + (fg.total ?? 0);
  const missing = so.absent + fg.absent;
  console.log(`   spent ${usd(both)} on '${FORGE_RUNTIME_NAME}' — ${usd(so.total)} second-opinion, `
    + `${usd(fg.total)} forge; the judge is billed by its own vendor`
    + (missing ? `\n   ${missing} seed value(s) reported no price and are NOT counted as zero` : ''));
}
console.log(`   ${path.relative(FRAMEWORK_ROOT, outPath)}`);
process.exit(summary.scoreable ? 0 : 1);
