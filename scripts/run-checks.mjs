#!/usr/bin/env node
// run-checks.mjs — the pre-flight barrier. Runs the declared commands BEFORE any lens spawns,
// captures each to evidence, and stamps the run.
//
// Checks are split into two classes, and the distinction is load-bearing:
//
//   BARRIER   build — a broken build makes every other lens's findings suspect, because the
//             lens is reasoning about code the compiler has already rejected. Failure aborts
//             the run and nothing spawns.
//   EVIDENCE  test, lint, fmt_check, typecheck — a failure here is a FACT the lenses should
//             see, not a reason to refuse to look. Captured, stamped, and handed on.
//
// Exit codes: 0 barrier passed (evidence checks may have failed — read checks.json)
//             1 a barrier check failed; the run is BLOCKED and must spawn nothing
//             2 configuration error
//             3 recursion guard tripped

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
import path from 'node:path';

import { classifySuiteOutcome } from './lib/decisions.mjs';
import { outcomeOfRecord, statusOfOutcome, DONE_OUTCOMES } from './lib/capture-header.mjs';
import { preflightInputHash, writePreflightCache, preflightCacheMaxBytes, PREFLIGHT_COMMAND_KEYS } from './io/preflight-cache.mjs';
import { confined } from './io/confined-path.mjs';
import { checkTimeoutMinutes } from './lib/check-timeout.mjs';
import { runDeclaredChecks, countTestsInLog, countFailuresInLog } from './io/declared-checks.mjs';
import { admitRun, callerRepoRoot } from './io/reviews-root.mjs';

// Fails CLOSED on a value it cannot read, identically to new-run/run-graph/spawn-node. The old
// `Number.isFinite(DEPTH) && DEPTH > 0` admitted any non-numeric value as "not nested": '1x' and
// '' both yield NaN, fail the test, and the script proceeded as though at depth 0. The hardening
// was applied to the three orchestration scripts and not to this one, leaving the guarantee
// uneven and the runtime reference's claim that it was uniform simply untrue.
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
  console.error(`ABORT: GRAPH_NODE_DEPTH=${DEPTH} — a graph node may not run the pre-flight barrier (§8).`);
  process.exit(3);
}

function die(msg) {
  console.error(`run-checks: ${msg}`);
  process.exit(2);
}

const args = {};
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['run-checks'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  if (v['run-dir'] !== undefined) args.runDir = v['run-dir'];
  if (v['repo-root'] !== undefined) args.repoRoot = v['repo-root'];
  // The hash the spawner already computed BEFORE the checks, naming the tree they started from.
  if (v['input-hash'] !== undefined) args.inputHash = v['input-hash'];
  if (v['inputs-inferred']) args.inputsInferred = true;
}
if (!args.runDir) die('--run-dir is required');

const givenRunDir = path.resolve(args.runDir);
// A directory carrying its own run.json is not authority for where it may be, and its contract's commands are run below:
// admitted for the repository this command runs for, by the one owner (ARCHITECTURE A-28; G-16 and G-17 of
// 20261022-230755-ciss-d1-4-remediation-review: containment alone admitted another repository's staged run).
const admitted = admitRun({ runDir: givenRunDir, repoRoot: callerRepoRoot(args.repoRoot) });
if (!admitted.ok) die(`--run-dir ${admitted.why}${admitted.check === 'record' ? ' — create the run with new-run.mjs first' : ''}`);
const repoRoot = admitted.repoRoot;
// Everything after is done to the directory admitted, its real path (G-19 of 20261023-014400-rdt-delivery).
const runDir = admitted.dir;
const runJsonPath = path.join(runDir, 'run.json');

const runJson = admitted.record;
const commands = runJson.contract?.commands ?? {};

// HOW MANY EVIDENCE CHECKS MAY RUN AT ONCE. Default 1 — the behaviour this has always had.
//
// G-30 is right that the six evidence commands have no data dependency on one another and no
// ability to stop the run, so their wall clock is strictly additive for no structural reason. It is
// wrong that the fix is unconditional concurrency: these are commands a CONSUMING PROJECT declares,
// and this engine knows nothing about them. Two of them may bind the same port, share a build
// cache, write the same coverage file, or expect a database to themselves. Turning that on for
// every consumer would trade a slow pre-flight for intermittent failures in the one phase whose
// whole job is producing trustworthy evidence — and a flaky barrier is worse than a slow one.
//
// So it is declared, by the operator who knows whether their own commands are independent. The
// barrier class is unaffected: it runs first, alone, and stops the run on failure.
const checksConcurrency = Math.max(1, Number(runJson.contract?.review?.checks_concurrency ?? 1) || 1);
const NODE_ID = 'pre-flight';

// ONE LIST OF CHECKS (G-13 of 20260925-200721-platform-remediated): the keys are PREFLIGHT_COMMAND_KEYS, the list the
// pre-flight cache keys on; this file kept a second copy, and adding a check to one would have left the cache
// reusing a result for a check it never ran. Only the class is decided here: `build` is the barrier, the rest evidence.
//
// Supply-chain checks (`audit`, `deny`) are deliberately `evidence`, not `barrier`: an advisory published upstream
// overnight is a fact the lenses should see, not a reason to refuse to review the change in front of them — and
// unlike a broken build it says nothing about whether the code under review is analysable. They are also the least
// correlated evidence in the whole system: a CVE database and a dependency graph share no failure mode with a language
// model, which is exactly why they are worth capturing (shared/external-reviewers.md).
const BARRIER_CHECKS = new Set(['build']);
const CHECKS = PREFLIGHT_COMMAND_KEYS.map((key) => ({ key, class: BARRIER_CHECKS.has(key) ? 'barrier' : 'evidence' }));
// WHAT IS NOT HERE, AND WHO OWNS IT. Raised by a codex arm reviewing the story-pipeline fixture:
// "the barrier records no entry for `run` at all... a declared run command that cannot start is
// caught by nothing until feature-verify tries it". The claim is true and the exclusion is correct
// — `run` launches the product, which may be a server that never exits, and a barrier that hangs on
// it would cost every run rather than catch a rare broken one. But the list said none of that; the
// key was simply missing, and a reader could not tell a decision from an oversight.
//
// Each key here is executed by exactly one owner, and this is the whole map:
//   build test lint fmt_check typecheck audit deny   this barrier, above
//   bench                                            perf-audit, which needs the measurement
//   test_product                                     run-all.mjs, the consuming project's own suite
//   run                                              feature-verify, the only node that may launch
//                                                    the product, through its own declared route
// EXECUTABLE_COMMAND_KEYS in lib/decisions.mjs owns which keys a node may execute AT ALL, and says
// there why `run` is not among them. The regression beside this list checks the two against each
// other, so a key added to the contract cannot go unexercised by both without someone saying so.
const NOT_AT_THE_BARRIER = Object.freeze({
  bench: 'perf-audit runs it; the barrier has no use for a measurement',
  test_product: "run-all.mjs runs the consuming project's own suite",
  run: 'feature-verify is the only node that may launch the product, and it may never exit',
  test_one: 'a template the remediation node fills with one test file through capture; it cannot run as written',
});

// Where capture.mjs is, and why it is located from the scripts rather than the reviewed tree, is the shared core's
// (io/declared-checks.mjs).
const shellPrefix = (commands.shell ?? '').trim();
// THE CEILING EACH CHECK RUNS UNDER (M1 stage 5): passed to capture rather than left to its 10-minute default, which a
// consumer's 11-minute suite hit on every review. A value it cannot honour stops the pre-flight here, named.
let checkTimeout;
try { checkTimeout = checkTimeoutMinutes(runJson.contract ?? {}); } catch (e) { console.error(`run-checks: ${e.message}`); process.exit(2); }

const results = [];
const stamps = new Set(runJson.stamps ?? []);
let barrierFailed = null;

// EVERY CHECK RUNS, THEN IS INTERPRETED IN DECLARED ORDER (G-30). The RUNNING — each check through capture, the barrier
// first and alone, the evidence checks pooled when review.checks_concurrency allows — is the shared core's
// (io/declared-checks.mjs, remediation-verification.plan.md stage 4), which the remediation runner's check of the commit
// candidate calls too. What a result means here — the stamps, test counting, the barrier row — stays below.
//
// THE INPUTS HASHED BEFORE THE CHECKS, here when the spawner passed none (G-10 of
// 20261114-032609-m2-7b-remediation-review): the fallback hashed only after them, so a tree that moved while they ran
// was cached under content they did not all see. A hash that cannot be computed now means no cache entry, never a later
// hash; and the inputs are hashed again after the checks, below, and the result cached only when the two agree.
const hashInputs = () => preflightInputHash({
  repoRoot,
  contract: runJson.contract ?? {},
  contractSource: runJson.contract_source ?? null,
  reviewsDir: path.dirname(runDir),
});
let startHash = null;
let startHashError = null;
if (/^[0-9a-f]{64}$/.test(String(args.inputHash ?? ''))) {
  // WHICH FILES THE RESULT DESCRIBES (preflight-reuse-by-hash AC5; G-10 of 20261012-031702-preflight-reuse-review): with a
  // passed hash, the list its caller hashed, recorded in run.json before this ran.
  startHash = { hash: args.inputHash, inferred: args.inputsInferred === true,
    // The list only as run.json records it against this hash (G-8 of 20261114-042824), else unknown.
    relFiles: Array.isArray(runJson.checks_input_files) && runJson.checks_input_files_sha256 === args.inputHash
      ? runJson.checks_input_files : null };
} else {
  try { startHash = hashInputs(); } catch (e) { startHashError = e.message; }
}
const { ran } = await runDeclaredChecks({
  runDir, repoRoot, commands, nodeId: NODE_ID, timeoutMinutes: checkTimeout,
  keys: CHECKS.map((c) => c.key), barrierKeys: BARRIER_CHECKS, concurrency: checksConcurrency,
  shell: shellPrefix, label: 'run-checks',
});

for (const { key, class: cls } of CHECKS) {
  const cmd = (commands[key] ?? '').trim();
  if (!cmd) {
    results.push({ check: key, class: cls, status: 'SKIPPED', reason: `commands.${key} is empty in graph_contract` });
    if (key === 'build') stamps.add('UNBUILT');
    if (key === 'test') stamps.add('UNTESTED');
    continue;
  }

  const r = ran.get(key);
  // A DECLARED check with no result means a barrier failed before it could run. It must not be
  // recorded as SKIPPED-because-empty: that says the project declares no such command, which is a
  // different and false statement about the contract.
  if (!r) {
    results.push({
      check: key, class: cls, status: 'SKIPPED', command: cmd,
      reason: 'not run: a barrier check failed first',
    });
    continue;
  }
  // THE OUTCOME, NOT THE EXIT (check-outcomes.plan.md stage 3): runDeclaredChecks read it from the log's header. A check
  // that did not run to its own end is FAIL, with its outcome on the result, and is named in not_checked[] by the gate.
  const outcome = outcomeOfRecord(r);
  const status = statusOfOutcome(outcome);
  const passed = status === 'PASS';
  results.push({ check: key, class: cls, status, ...r, outcome });

  if (key === 'test') {
    // A FAILING test suite was, until now, recorded and otherwise ignored: the check printed FAIL
    // and the gate still returned PASS. `UNTESTED` covered only the case where commands.test is
    // EMPTY, so "no tests exist" lowered the ceiling while "the tests exist and they are red" did
    // not. Adding a regression suite to this command would have been theatre without this — a
    // resurfaced bug would turn a test red and change nothing downstream.
    //
    // A red test is the strongest signal the barrier produces: deterministic, reproducible, and
    // uncorrelated with any model's judgment. It outranks every lens opinion in the run, so it
    // forces the gate rather than merely capping it.
    // The count has to be taken BEFORE the verdict, because the verdict now depends on it: a
    // non-zero exit with an explicit ZERO counted is a suite that never started, not one that
    // failed — and a non-zero exit with an UNPARSEABLE count is neither, because the rule stated
    // twelve lines below for TESTS-THIN ("null means the runner's output matched NO known format,
    // which is not the same as a suite of zero tests") applies here too. It did not, and that was
    // G-32: the same file held the principle and the violation.
    const n = r.evidence_path ? countTestsInLog(runDir, r.evidence_path) : null;
    const suite = classifySuiteOutcome({
      exitCode: r.exit_code,
      testsReported: n,
      // n is the TOTAL; a suite that did not finish is failing only on this (G-3 of 20261018-035437-co-delivery).
      testsFailing: r.evidence_path ? countFailuresInLog(runDir, r.evidence_path) : null,
      timedOut: r.timed_out === true,
      outcome,
    });
    if (suite.stamp) stamps.add(suite.stamp);
    results[results.length - 1].tests_reported = n;
    results[results.length - 1].suite_ran = suite.ran;
    // Not a failure — a declaration about how much weight a passing test run can bear.
    //
    // null means the runner's output matched NO known format, which is not the same as a suite of
    // zero tests and must not be stamped as one. This fired for real: pytest printed
    // "3 failed, 2097 passed, 4 skipped" and the run was stamped TESTS-THIN on 2100 executed
    // tests, making every coverage-based mitigation inadmissible on the strength of a parse
    // failure. An unknown count is named instead, so the gap is visible rather than asserted.
    if (n !== null && n < 5) stamps.add('TESTS-THIN');
    if (n === null) stamps.add('TESTS-UNCOUNTED');
  }
  // FMT-DIRTY means the formatter ran and failed (plan stage 3): one that did not finish is a not_checked[] entry instead.
  if (key === 'fmt_check' && outcome === 'failed') stamps.add('FMT-DIRTY');

  if (!passed && cls === 'barrier') {
    // NOT a `break` any more. Nothing downstream RAN — the spawning phase above stopped at the
    // broken barrier, which is what "nothing downstream is meaningful once the build is broken"
    // actually buys. But the interpretation loop must keep going, or the declared checks after it
    // get no row at all and checks.json shows a project that declares four commands as having
    // declared one. They now carry an explicit "not run: a barrier check failed first", which is a
    // different fact from "not declared" and the artifact should not conflate them.
    barrierFailed = key;
  }
}

const checksJson = {
  run_id: runJson.run_id,
  ran_at: new Date().toISOString(),
  barrier_failed: barrierFailed,
  results,
  stamps: [...stamps],
};
// Through the run's one owner (run-dir-descendants.plan.md stage 2): a temporary file and a rename, as writeJsonAtomic
// wrote it, with every level below the run checked and a link refused.
confined(runDir).replace(['checks.json'], `${JSON.stringify(checksJson, null, 2)}\n`);

runJson.stamps = [...stamps];
runJson.checks_ran_at = checksJson.ran_at;

// SEED THE CACHE THE NEXT RUN CONSULTS.
//
// Keyed on the files the declared checks read plus the command strings themselves, so a result is
// offered back only for the question it actually answered. Whether it may then be USED is
// preflightDecision's call, not this one's — a dirty worktree invalidates the entry independently
// of the digest, so an entry written here while the tree was dirty is stored and simply not served
// until the tree is clean. That is deliberate: committing a dirty tree unchanged should not cost
// seven minutes to re-establish what was just measured.
//
// `barrier_failed` rides along because a cached FAILURE is still a result. A cache that only ever
// carries good news is not a cache of the outcome.
// A RESULT ABOUT THE ENGINE IS NOT A RESULT ABOUT THE TREE, AND MUST NOT BE CACHED.
//
// `evidence_path` is what capture.mjs prints on stdout once it has launched the command — a FAILING
// command still gets one, because the failure is in the log. `null` means capture never got that
// far: it refused the run directory, could not confine `--cwd`, or could not write. That is this
// engine declining to run the check, and it is recorded as `FAIL` because run-checks reads the exit
// code and exit 2 is capture's refusal, not the command's verdict.
//
// Caching it makes an engine fault STICKY and dresses it as the project's build being broken: every
// later run on an unchanged tree would be BLOCKED by a cached `barrier_failed: build` without
// re-running anything. Observed on the first real seeding of this repository — a seed run.json
// missing `host.cwd` made every check exit 2, and the cached entry then reported quorate's own
// build as failing on a tree that compiles.
//
// So the entry is written only when every check that RAN produced evidence. Refusing to cache is
// always safe: the next run re-runs.
const ranWithoutEvidence = results.filter((r) => r.status !== 'SKIPPED' && !r.evidence_path);
// A CHECK THAT DID NOT RUN TO ITS OWN END describes the run, not the tree (check-outcomes.plan.md stage 3; plan-review
// round 4): a build that timed out, was stopped or could not start, cached, would be replayed as BLOCKED — "re-running it
// would fail identically" — on every unchanged input hash. Refusing to cache is always safe.
const notDone = results.filter((r) => r.status !== 'SKIPPED' && r.evidence_path && !DONE_OUTCOMES.includes(r.outcome));
if (ranWithoutEvidence.length) {
  console.error(
    `run-checks: not caching this result — ${ranWithoutEvidence.map((r) => r.check).join(', ')} `
    + 'produced no evidence path, which means capture.mjs refused rather than the command failing. '
    + 'A fault in the engine must not be cached as a verdict about the tree.',
  );
} else if (notDone.length) {
  console.error(
    `run-checks: not caching this result — ${notDone.map((r) => `${r.check} (${r.outcome})`).join(', ')} did not run to `
    + 'completion, which says something about this run, not about the tree.',
  );
} else if (!startHash?.hash) {
  console.error(`run-checks: not caching this result — the inputs could not be hashed before the checks ran`
    + `${startHashError ? ` (${startHashError})` : ''}, so no key names the content they started from.`);
} else try {
  // HASHED BEFORE THE CHECKS (found planning G-10 of 20260925-015614-platform-review; G-10 of
  // 20261114-032609-m2-7b-remediation-review), by the spawner or above, and AGAIN NOW: the entry is keyed on the start
  // hash, and written only when the inputs still hash to it. The file list is the start's, never a second listing.
  const { hash, inferred, relFiles } = startHash;
  const endHash = hashInputs().hash;
  if (endHash !== hash) {
    throw Object.assign(new Error('the inputs moved while the checks ran'), { code: 'EINPUTSMOVED' });
  }
  runJson.checks_input_sha256 = hash;
  runJson.checks_inputs_inferred = inferred;
  writePreflightCache(path.dirname(runDir), hash, {
    inferred,
    run_id: runJson.run_id,
    ran_at: checksJson.ran_at,
    // Recorded so a reader can audit WHICH TREE this evidence describes, which is the whole of what
    // reuse has to stay accountable for. Not part of the key: the key is the inputs, and the tree
    // identity is the audit trail.
    head_commit: runJson.head_commit ?? null,
    worktree_sha: runJson.worktree_sha ?? null,
    dirty_when_produced: runJson.dirty ?? null,
    input_files: relFiles ?? null,
    commands: Object.fromEntries(CHECKS.map(({ key }) => [key, (commands[key] ?? '').trim()])),
    barrier_failed: barrierFailed,
    results,
    stamps: [...stamps],
  }, {
    // The captured output travels with the entry. A reused run inheriting TESTS-THIN from a log it
    // cannot open is a stamp whose evidence is gone — see writePreflightCache.
    // The admitted run's owner (G-10 of 20261029-224143-rdr-remediation-3-review), never a path the helper re-roots.
    evidenceFrom: { owner: confined(runDir), segs: ['evidence', NODE_ID] },
    // BOUNDED BY SIZE (G-10): review.preflight_cache_max_mb, default 256 MB, "" = uncapped.
    maxBytes: preflightCacheMaxBytes(runJson.contract ?? {}),
    onCap: (cap) => { if (cap.overCap) runJson.checks_cache_over_cap = true; },
  });
} catch (e) {
  // A cache that cannot be written must never fail the barrier it is a convenience for. The next
  // run finds no entry and re-runs, which is the safe direction.
  console.error(e?.code === 'EINPUTSMOVED'
    ? `run-checks: not caching this result — ${e.message}, so it describes no one state of them`
    : `run-checks: could not write the pre-flight cache entry (${e.message}); the next run will re-run the checks`);
}

confined(runDir).replace(['run.json'], `${JSON.stringify(runJson, null, 2)}\n`); // through the run's owner (stage 2) — this write lands right after the longest, most interrupt-prone phase of a run

for (const r of results) {
  const detail =
    r.status === 'SKIPPED'
      ? r.reason
      : `exit ${r.exit_code}${r.tests_reported != null ? `, ${r.tests_reported} tests` : ''} -> ${r.evidence_path}`;
  console.log(`${r.status.padEnd(7)} ${r.check.padEnd(10)} ${detail}`);
}
console.log(`stamps: ${[...stamps].join(', ') || '(none)'}`);

if (barrierFailed) {
  console.error(
    `\nBARRIER FAILED: ${barrierFailed}. The run is BLOCKED and must spawn nothing —\n` +
      `a lens reasoning about code the compiler rejected produces findings nobody can trust.`,
  );
  process.exit(1);
}
process.exit(0);
