#!/usr/bin/env node
// remediate — run the remediation node in a remediation run (remediate-rebuild.plan.md stage 4; design decisions 1, 5,
// 6 and 8, operator 2026-10-08).
//
//   node scripts/new-run.mjs --slug <slug> --remediates <reviewed run dir>     # mints the remediation run
//   node scripts/remediate.mjs --run-dir <remediation run dir> [--unsandboxed]  # this script
//
// What it does, in order:
//   1. refuses inside a graph node (§8), and outside a remediation run;
//   2. walks the round-cap chain (shared/remediation.md, Round cap) and STOPS at the cap — no fourth patch — stamping
//      ROUND-CAP here and on the remediation whose own fix reached it; refuses when the chain cannot be read
//      (CHAIN-UNKNOWN) rather than counting from a guess; stamps CHAIN-BROKEN when the review it works from is not the
//      follow-up the previous remediation minted;
//   3. records which files were already changed (dirty_at_start), renders the node's brief and spawns the `remediation`
//      node through spawn-node.mjs, in its own context, under the run's remediate-settings.json — or, with
//      --unsandboxed, without it, recorded on the run (UNSANDBOXED);
//   4. checks the report against the review's confirmed set and its own evidence (REPORT-CHECK), and each fixed group's
//      commit (COMMIT-CHECK);
//   5. mints the follow-up review of its own diff (new-run --follows-remediation, base = where this remediation began),
//      prints the command to run it, and does NOT run it — and never pushes. A mint that failed is retried by running
//      this again; the node is not spawned twice.
// The session that launched it then runs quorate:claim-check on the node's report (the node spawns nothing).
import fs from 'node:fs';
import { confirmedGroupIds } from './io/run-artifacts.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { runtimeBinArg, runtimeBinArgv } from './io/runtime-bin.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveFrameworkDirs } from './io/locate.mjs';
import { readTemplate } from './io/template.mjs';
import { writeRunRecord, ownerBelow, rootOf } from './io/telemetry-record.mjs';
import { selectAdapters } from './io/reviewers.mjs';
import { bestEffort } from './lib/telemetry-record.mjs';
import { confined } from './io/confined-path.mjs';
import { renderTemplate } from './lib/template.mjs';
import { budgetOf, briefArg, briefHead, printedArg, isGroupId, nodeExitMapping } from './lib/decisions.mjs';
import { redactTree, redactClaim } from './lib/redact.mjs';
import { REMEDIATE_LOCK, takeRemediateLock, setRemediateLockPhase, remediateLockTaken, releaseRemediateLock } from './lib/remediate-lock.mjs';
import { gitSync, gitCommitSync } from './io/git.mjs';
import { checkTimeoutMinutes } from './lib/check-timeout.mjs';
import { testOneTemplate } from './lib/test-one.mjs';
import { isWithin } from './io/finding-scope.mjs';
import { roundCapState, walkChain, ROUND_CAP, statusEntriesV2, planClusterCommits, COMMIT_CHECK_KINDS, commitCheckStamps, commitGate, runnerPathIn, admitGroups, trailerError, isPending, remediationEnd, pendingClusterLines, resolveLinkedRun, remediationTimeoutMinutes, treeGuardRefusals, gitIgnoresCase, anyStillChanged, evidencePaths, retryMismatch, leftInTree, stopReasonChecks, treeGuardMessage, repairReportErrors, repairGreenErrors, repairFileAdmission, repairPassCap, clusterFileRule, repairFailingLines, readmissionDecision, evidenceRecordDifference, normalizeReport, setAsideRecovery, COMMIT_CHECK_STAMP, REPORT_CHECK_STAMP, lsTreeEntries } from './lib/remediation-chain.mjs';
import { setAsideCapabilities, setAsideRefused, writeBackSetAside, SetAsideError } from './io/set-aside.mjs';
import { repoRunRoots, archiveStagedRun, inArchive, admitRun, callerRepoRoot, printedRunDir, quorateHome, readRunJson, patchRunJson } from './io/reviews-root.mjs';
import { frameworkMountRefusals } from './io/framework-mount.mjs';
import { hostPlatform } from './platform/index.mjs';
import { PREFLIGHT_COMMAND_KEYS } from './io/preflight-cache.mjs';
import { runDeclaredChecks, logCountsInLog, failingTestsInLog, outcomeInLog } from './io/declared-checks.mjs';
import { fullCheckVerdict, candidateCheckEnv, RUN_JSON_FAILING_NAMES } from './lib/full-check.mjs';
import { captureFacts } from './io/capture-facts.mjs';
import { repoLockPath, acquireRepoLock, releaseRepoLock } from './io/repo-lock.mjs';

// WHAT MUST RUN BEFORE ANY EXIT (G-10 of 20261107-195640-co-remediation-2-review): process.exit skips every pending
// finally, so a refusal that dies after a set-aside (stopOnUnrecorded among them) left its files unwritten until the next
// invocation. Each entry runs once, in order, after the message is printed; one that dies itself ends the run there.
const atDie = [];
const die = (msg, code = 2) => { console.error(`remediate: ${msg}`); for (const f of atDie.splice(0)) f(); process.exit(code); };
// The kill seams stand for a process killed there, which runs no handler, so they exit without atDie.
const killedHere = (msg) => { console.error(`remediate: ${msg}`); process.exit(2); };

// THE RECURSION GUARD, FIRST: this script spawns a node, so a graph node may not start it (§8).
const { raw: RAW_DEPTH, depth: PARSED_DEPTH } = nodeDepth(process.env);
const DEPTH = PARSED_DEPTH ?? NaN;
if (!Number.isInteger(DEPTH) || DEPTH !== 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} — a graph node may not start a remediation (§8).`);
  process.exit(3);
}

const args = {};
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md): a missing
  // value and an unknown flag are refused, naming the flag. `--commit-trailer` with no value is refused too; it was read
  // as '' and refused later by trailerError.
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS.remediate)); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  const take = {
    'run-dir': 'runDir',
    // The repository this remediation runs for (run-dir-trust.plan.md stage 2): absent, git's toplevel of where it is run.
    // The run is admitted only for it, and its own repo_root is never what the runner acts on (ARCHITECTURE A-28).
    'repo-root': 'repoRoot',
    // THE ONE EXPLICIT LIFT of the remediation policy (G-24): forwarded to spawn-node and recorded on the run.
    unsandboxed: 'unsandboxed',
    // Test seams, passed straight through: the fake runtime, and minting the follow-up without the live canary.
    // The fake runtime is --runtime-bin, read after this table through its one owner (the old spelling an alias).
    'no-verify-sandbox': 'noVerifySandbox',
    // Passed to the follow-up mint exactly as --no-verify-sandbox is (reviewer-preflight stage 3): that mint checks the
    // reviewers a panel-on run can call, and skipping it there stamps REVIEWERS-UNVERIFIED.
    'no-verify-reviewers': 'noVerifyReviewers',
    // A REFUSED COMMIT, RETRIED (remediation-commit-recovery; operator 2026-10-11: "Add retry + trailer (Recommended)"):
    // a consumer's hook may refuse the runner's commit and name a trailer as its remedy (story-pipeline's contract-doc
    // asks for `Doc-Impact:`). The operator's trailer lines go on every cluster commit; --retry-commits re-attempts the
    // clusters left pending (refused by git, a hook, or the runner's full check), without the node.
    'commit-trailer': 'commitTrailers',
    'retry-commits': 'retryCommits',
    // THE REPAIR PASS ON A REFUSED RUN (remediation-repair-pass.plan.md stage 3): with --retry-commits, a full check that
    // refuses the retried candidate on failing tests goes back to the node first, as on a first run.
    repair: 'repair',
    // GROUPS THE EVIDENCE GATE REFUSED, RE-ADMITTED (operator, 2026-11-03: "b"): with --retry-commits, a run that committed
    // nothing and planned no cluster has the groups its first run's evidence gate refused judged again by the gate as it
    // stands, and those it now admits planned as the first run would have; the retry then goes on as for any pending cluster.
    'readmit-evidence': 'readmitEvidence',
    // TEST-ONLY: force the unstaging after a refused commit to fail, so the record of a failed reset can be seen.
    'test-fail-reset': 'testFailReset',
    // TEST-ONLY: force the full check's unmarking of the candidate's new files to fail, so its refusal can be seen.
    'test-fail-unmark': 'testFailUnmark',
    // TEST-ONLY: exit (`die` or `throw`) right after the node returns, so the lock's keep rule can be seen.
    'test-fail-after-node': 'testFailAfterNode',
    // TEST-ONLY: the lock's removal fails as an access error would, so the handling of a lock left behind can be seen.
    'test-fail-unlink': 'testFailUnlink',
    // TEST-ONLY: the stray-commit check's `git rev-list` fails, so its handling can be seen.
    'test-fail-rev-list': 'testFailRevList',
    // TEST-ONLY: `git rev-parse HEAD` fails after a commit that landed, so its recording can be seen.
    'test-fail-rev-parse': 'testFailRevParse',
    // TEST-ONLY: exit right after the named cluster's attempt is saved, as a killed run would, so the per-attempt save
    // and the pending clusters it leaves can be seen.
    'test-die-after-cluster': 'testDieAfterCluster',
    // TEST-ONLY: exit the moment the named cluster's commit lands, before anything is saved, as a run killed in that
    // window would.
    'test-die-after-commit': 'testDieAfterCommit',
    // TEST-ONLY: the runner's log cannot be written, so a record saved before it can be seen.
    'test-fail-runner-log': 'testFailRunnerLog',
    // TEST-ONLY: the start commit cannot be read.
    'test-fail-start-head': 'testFailStartHead',
    // TEST-ONLY: the first write-back of a set-aside file fails, so CO-D3's stop can be seen (remediation-cluster-order.plan.md).
    'test-fail-write-back': 'testFailWriteBack',
    // TEST-ONLY: a lower bound for firstFree, so a set-aside that finds every number taken can be seen (set-aside-identity.plan.md, G-7).
    'test-first-free-max': 'testFirstFreeMax',
    // TEST-ONLY: the first write-back's bytes differ after writing, so its recovery by the printed retry can be seen (G-4).
    'test-mismatch-write-back': 'testMismatchWriteBack',
    // TEST-ONLY: the repair pass cap, in place of the roster's (remediation-repair-pass.plan.md stage 2).
    'test-repair-passes': 'testRepairPasses',
    // THE BENCH'S STOP (remediation-repair-pass.plan.md stage 4): after the full check and any repair pass, record and exit,
    // committing nothing, archiving nothing, minting no follow-up. scripts/bench-repair-pass.mjs measures with it.
    'measure-only': 'measureOnly',
    // THE BENCH'S REPLAY (repair-bench-replay.plan.md stage 2; BR-D1 A): with --measure-only on a first run, the first
    // node is installed from a recorded case instead of spawned, here at depth 0, after the guard above. The bench named
    // itself as the node runtime before, which ran its replay before its own depth guard (G-1 of
    // 20261102-060316-rrp-remediation-3-review).
    'replay-node': 'replayNode',
  };
  for (const [flag, key] of Object.entries(take)) if (v[flag] !== undefined) args[key] = v[flag];
  try { args.runtimeBin = runtimeBinArg(v); } catch (e) { die(e.message); }
}
if (!args.runDir) die('--run-dir is required: the remediation run new-run --remediates minted');
if (args.readmitEvidence && !args.retryCommits) die('--readmit-evidence runs only with --retry-commits: it re-plans the refused groups of a finished run, then retries them');
if (args.repair && !args.retryCommits) die('--repair runs only with --retry-commits: a first run gives the node its repair pass by itself');
if (args.replayNode && !args.measureOnly) die('--replay-node runs only with --measure-only: a replayed node is measured, never committed');
if (args.replayNode && args.retryCommits) die('--replay-node replays a first run\'s node; --retry-commits spawns no first node');
// One line, `Key: value` (lib's trailerError): anything else would put the operator's text into the message as something
// other than a trailer.
for (const t of args.commitTrailers ?? []) {
  const why = trailerError(t);
  if (why) die(`--commit-trailer ${JSON.stringify(t)} is refused: ${why} (e.g. "Doc-Impact: none - internal fix")`);
}
const trailers = args.commitTrailers ?? [];
const givenRunDir = path.resolve(args.runDir);
// ADMITTED BEFORE THE LOCK IS WRITTEN (ARCHITECTURE A-28; run-dir-trust.plan.md stage 2): a directory carrying its own
// run.json is not authority for where it may be, nor for the repository the runner locks, commits in and spawns a node in.
// The repository is the one this command runs for, and the run must be one of its remediation runs and name it (G-12 of
// 20261022-230755-ciss-d1-4-remediation-review: containment alone admitted another repository's staged run, whose
// repo_root the runner then acted on).
const admitted = admitRun({ runDir: givenRunDir, repoRoot: callerRepoRoot(args.repoRoot), need: { remediation: true } });
if (!admitted.ok) die(`--run-dir ${admitted.why}`);
// EVERYTHING AFTER IS DONE TO THE DIRECTORY ADMITTED (G-13 of 20261023-014400-rdt-delivery): its real path, not the one
// the caller spelled, which a link could repoint between the check and the use.
const runDir = admitted.dir;
const runJsonPath = path.join(runDir, 'run.json');
// THE RECORDED CASE, CHECKED BEFORE THE LOCK (BR-D2 A): any directory the caller names, read through its owner, whose
// replay.json names this run and this repository; it must hold the node's report and the status spawn-node wrote for it,
// which the commit gate reads. Nothing is installed until the first node's turn.
let replay = null;
if (args.replayNode) {
  const real = (p) => { try { return fs.realpathSync.native(path.resolve(String(p))); } catch { return null; } };
  let src = null; let record = null;
  // THE DIRECTORY ITSELF IS CHECKED (G-8 of 20261102-173413-rbr-remediation-review): a --replay-node that is a link or
  // junction, or not a directory, is refused by the owner, which checks its root (G-10 of
  // 20261102-184751-rbr-remediation-2-review: this entry script had its own lstat, a second copy of the rule).
  try { src = confined(path.resolve(String(args.replayNode))); record = JSON.parse(src.read(['replay.json'])); } catch (e) { die(`--replay-node ${args.replayNode}: its replay.json cannot be read: ${e.message}`); }
  if (!record || !real(record.run_dir) || real(record.run_dir) !== real(runDir)) die(`--replay-node: its replay.json names the run ${record?.run_dir}, not this one (${runDir})`);
  if (!real(record.worktree) || real(record.worktree) !== real(admitted.repoRoot)) die(`--replay-node: its replay.json names the repository ${record.worktree}, not this one (${admitted.repoRoot})`);
  if (!record.candidate || typeof record.candidate !== 'object' || Array.isArray(record.candidate)) die('--replay-node: its replay.json names no candidate');
  for (const f of ['payload.json', 'status.json']) if (!src.exists([f])) die(`--replay-node: the recorded case has no ${f}`);
  replay = { src, record, dir: src.root };
}
// THROUGH THE OWNER OF THE DIRECTORY READ (G-17 of 20261029-050428-rdd-delivery): a link at run.json, or at any level
// below the run, is refused rather than followed. loadRun throws; readRun is the lookup that answers null instead.
// Held to readRunJson's bound (G-10 of 20261124-170802-gsw-remediation-3-review-b): it read the record whole.
const loadRun = (dir) => readRunJson(dir === runDir ? owner : confined(dir), ['run.json']);
const readRun = (dir) => { try { return loadRun(dir); } catch { return null; } };
// Through the owner too (run-dir-reads.plan.md stage 4): a link at run.json is refused here, not followed.
try { if (!confined(runDir).exists(['run.json'])) die(`no run.json in ${runDir}`); } catch (e) { die(`run.json in ${runDir}: ${e.message}`); }

// ONE RUNNER PER RUN, AND THE LOCK COMES FIRST (remediation-run-ownership D2; G-5 of 20261009-014530-remediation-paths-r2).
// Created exclusively before run.json is read, so an invocation that waited behind another decides from the state the
// first one left. Its phase is written at each step; a process killed by a signal runs no handler, so the phase on disk
// is the only witness. ONE `exit` handler releases it (die calls process.exit, so code after a die never runs) — except
// while the node may have edited the working tree with no record of it (node-running, node-ran): re-running then would
// retake dirty_at_start over those edits, so the lock is kept and says so. A lock is never removed automatically.
const lockPath = path.join(runDir, REMEDIATE_LOCK);
// EVERY WRITE BELOW THE RUN THROUGH ITS ONE OWNER (run-dir-descendants.plan.md stage 2): the lock, run.json, the node's
// brief and the runner's own folder (runnerPathIn was lexical). A link at any level below the run is refused.
const owner = confined(runDir);
const runnerSegs = (...parts) => ['evidence', 'remediation-runner', ...parts];
const lockStartedAt = new Date().toISOString();
let lockPhase = null;
// The repository lock (stage 2 below), once this runner holds it: released and kept with the run lock.
let repoLock = null;
try {
  // Created exclusively WITH its content (G-3 of 20261009-041724-run-ownership-r1): an empty lock, killed before its
  // phase was written, gave the operator nothing to diagnose.
  // Through the lock's one owner, which archive-run.mjs takes it through too (G-3 of 20261121-193516-m3s7-b1-review).
  takeRemediateLock(owner, { pid: process.pid, startedAt: lockStartedAt, phase: 'started' });
  lockPhase = 'started';
} catch (e) {
  // The owner's exclusive create refuses a taken name before it opens, and `wx` refuses one taken in between (EEXIST).
  const taken = remediateLockTaken(e);   // by the tag (G-4 of 20261107-220617-si-delivery)
  if (!taken) die(`cannot create ${lockPath}: ${e.message}`);
  let held = '';
  // THROUGH THE RUN'S OWNER (G-14 of 20261103-191032-dr-remediation-3-review): a raw read followed a link at the lock's
  // path and printed what it led to.
  try { held = owner.read([REMEDIATE_LOCK]); } catch { /* named without its content */ }
  console.error(`remediate: another runner holds this run, or one was stopped while the node may have run: ${lockPath} ${held}`);
  console.error('remediate: if no runner is running, inspect the working tree (its phase says whether the node may have edited it:');
  console.error('  only "started" means it did not), then delete the lock. Nothing was changed.');
  process.exit(6);
}
const setLockPhase = (phase) => {
  lockPhase = phase;
  setRemediateLockPhase(owner, { pid: process.pid, startedAt: lockStartedAt, phase });
};
process.on('exit', (code) => {
  if (lockPhase === 'node-running' || lockPhase === 'node-ran') {
    console.error(`remediate: the node ran and its results were not saved — the lock is KEPT (${lockPath}, phase ${lockPhase}).`);
    console.error('  Inspect the working tree for its edits, then delete the lock before running again.');
    if (repoLock) console.error(`  The repository lock is kept with it (${repoLock}): no other remediation starts over that state. Delete both.`);
    return;
  }
  if (repoLock) {
    const failed = releaseRepoLock(repoLock);
    if (failed) {
      console.error(`remediate: the repository lock ${repoLock} could not be removed (${failed}). Delete it by hand once no runner is running.`);
      if (!code) process.exitCode = 7;
    }
  }
  try {
    if (args.testFailUnlink) throw Object.assign(new Error('test seam: unlink refused'), { code: 'EPERM' });
    if (!releaseRemediateLock(owner)) throw Object.assign(new Error('already gone'), { code: 'ENOENT' });
  } catch (e) {
    // Only "already gone" is ignored (G-5 of 20261009-035141-run-ownership-review): any other failure leaves a lock the
    // next invocation would refuse on as if the run were held, so it is named and the run exits 7.
    if (e?.code !== 'ENOENT') {
      // Exit 7 only where the run would otherwise have exited 0: a run that already failed keeps its own code (G-5 of
      // 20261009-041724-run-ownership-r1).
      console.error(`remediate: ${lockPath} could not be removed (${e?.code ?? e?.message}); its phase is ${lockPhase}. Delete it by hand once no runner is running.`);
      if (!code) process.exitCode = 7;
    }
  }
});

const run = readRun(runDir);
if (!run) die(`no readable run.json in ${runDir}`);
if (!run.remediates || !run.remediation_frame) die(`${run.run_id} is not a remediation run; mint one with new-run --remediates`);
// READ AGAIN UNDER THE LOCK, FOR THE STATE A RUNNER BEFORE THIS ONE LEFT (followup_run_dir), AND STILL THE RUN ADMITTED
// (G-13 of 20261023-014400-rdt-delivery): the frame, the reviewed run and the repository this runner acts on are the ones
// admitRun checked. A record rewritten between the two reads is refused, never acted on.
for (const k of ['run_id', 'remediates', 'remediation_frame', 'repo_root']) {
  if (JSON.stringify(run[k] ?? null) !== JSON.stringify(admitted.record[k] ?? null)) {
    die(`${runJsonPath} changed its ${k} after it was admitted; refusing to act on a record admitRun did not check`);
  }
}
if (run.followup_run_dir) die(`${run.run_id} has already been run and its follow-up minted; mint a new remediation run for the next round`);
const frame = run.remediation_frame;
// THE REVIEWED RUN, ADMITTED BEFORE ITS FIRST READ (run-dir-descendants.plan.md stage 3; G-20, G-1, G-21 of
// 20261024-122231-rdt-remediation-3-review): its finding groups, its reconcile payload, its record for the CHAIN-BROKEN
// scan and the brief's reconciled.md were all read through the path the frame recorded at mint, which a link could
// retarget. It is admitted once, for this repository, as the run the frame names; the admitted directory replaces the
// recorded one everywhere after, and a recorded path that does not admit is refused rather than read.
let reviewedDirCache;
const reviewedDir = () => {
  if (reviewedDirCache !== undefined) return reviewedDirCache;
  const a = frame?.run_dir ? admitRun({ runDir: frame.run_dir, repoRoot: repo }) : null;
  reviewedDirCache = a?.ok && a.record?.run_id === frame.run_id ? a.dir : null;
  if (frame?.run_dir && !reviewedDirCache) {
    die(`the reviewed run at ${frame.run_dir} is not admitted as ${frame.run_id} (${a?.ok ? `its record names ${a.record?.run_id}` : a?.why}); a recorded path is not read unadmitted`);
  }
  return reviewedDirCache;
};
// ITS FILES THROUGH ITS OWNER (run-dir-reads.plan.md stage 4; G-14, G-17, G-18 of 20261029-065343-rdd-remediation-2-review,
// G-7 of 20261029-134336-rdd-remediation-3-review): finding-groups.json and the reconcile payload were read raw below the
// admitted directory, so a link at evidence/, evidence/reconcile/ or at the file itself was followed. A link at any level
// is now refused; each caller's catch reads a refusal as the unreadable file it already handled.
const reviewedJson = (...segs) => JSON.parse(confined(reviewedDir()).read(segs));
const repo = admitted.repoRoot;
// ONE REMEDIATION PER REPOSITORY, BEFORE ANY WORK (remediation-consumer-findings.plan.md stage 2, AC6; operator, 2026-10-20:
// "Repository-wide lock (Recommended)"). The run lock above serialises runners on THIS run; two remediations of one
// repository launched a minute apart both completed and committed nothing, each refusing every cluster over the other's
// files (story-pipeline's 20261020-114215 and -114309). Keyed by git's common directory, so linked worktrees share it.
{
  let lockFile;
  try { lockFile = repoLockPath(repo); } catch (e) { die(`cannot locate the repository lock: ${e.message}`); }
  const got = acquireRepoLock(lockFile, run.run_id);
  if (!got.ok) {
    const holder = got.record?.run_id ?? '(unknown run)';
    if (got.state === 'live') console.error(`remediate: another remediation, ${holder}, is running in this repository (pid ${got.record.pid}); run this one after it ends. Nothing was changed.`);
    else if (got.state === 'stale') console.error(`remediate: a stale repository lock from ${holder} (pid ${got.record.pid} on this host is gone): a runner was stopped without releasing it. Check its run, then remove ${lockFile} and run again. Nothing was changed.`);
    else if (got.state === 'foreign-host') console.error(`remediate: ${holder} holds this repository's lock from host ${got.record.host}; whether it is still running cannot be known here. Nothing was changed.`);
    else console.error(`remediate: the repository lock ${lockFile} cannot be read; another remediation may hold it. Nothing was changed.`);
    process.exit(8);
  }
  repoLock = lockFile;
}
const contract = run.contract ?? {};
const review = contract.review ?? {};
const FRAMEWORK = resolveFrameworkDirs(path.dirname(fileURLToPath(import.meta.url)));
// Hooks run without the runtime's credentials, and at depth 1 like a node's children, so a hook cannot start graph
// work past §8's guard (G-9 of 20261009-014530-remediation-paths-r2). EVERY git process the runner starts gets it, not
// only the commit's (G-5 of 20261023-044746-rer-delivery): status and hash-object run a repository's clean filters too.
// The policy and its one owner: lib/decisions.mjs gitEnvFor, scripts/io/git.mjs (engine-git-env.plan.md stage 2, A-29).
// The SSH agent socket goes only to `git commit` itself, which may sign with it (G-3 of
// 20261023-062611-rer-remediation-review-2): status, add and hash-object run clean filters, which never need the agent.
const gitFor = (sub) => (sub === 'commit' ? gitCommitSync : gitSync);
const git = (...a) => gitFor(a[0])(a, { cwd: repo, encoding: 'utf8' });
// ONE WRITER FOR run.json, ATOMIC (G-12): the same owner new-run and run-graph use.
// Through the owner of the directory written: this run, or the archived one it became (run-dir-descendants stage 2).
// The record is read STRICTLY (G-19 of 20261029-050428-rdd-delivery): a read or parse failure throws, where readRun's
// null spread to nothing and the replace wrote a run.json holding only the patch.
// REDACTED, as every tracked write is (G-23 of 20261121-204740-m3s7-b1-remediation-review; I-8): run.json is archived into
// .claude/reviews and tracked, and its commit_check entries carry model prose.
// THE PATCH, NOT THE WHOLE RECORD (G-9 of 20261121-214741-m3s7-b1-remediation-2-review): redacting the merged record
// rewrote machine fields new-run wrote, such as repo_root, whenever a path segment was credential-shaped.
// THROUGH patchRunJson (G-11 of 20261124-180917-gsw-remediation-4-review-b): the strict merge is an owner a test runs, not
// a line of this script a test reads.
const saveRun = (patch, dir = runDir) => patchRunJson(dir === runDir ? owner : confined(dir), patch, {
  transform: (p) => redactTree({ ...p, ...(p.stamps instanceof Set ? { stamps: [...p.stamps] } : {}) }),
});
const stamps = new Set(run.stamps ?? []);   // written back as an array by saveRun
// THE RUN'S OWN START, as run-graph records it (G-12 of 20261027-071443-trt-delivery): without it the telemetry record
// started at the mint and counted the wait between the two commands as remediation time. A later runner keeps the first.
// Best-effort, a failure a note (G-9 of 20261027-083759-trt-remediation-review; I-11): telemetry never fails a run.
if (!run.graph_started_at) bestEffort(() => saveRun({ graph_started_at: new Date().toISOString() }), (why) => console.error(`remediate: graph_started_at not recorded (${why})`));
// THE FILE EACH REVIEWED GROUP WAS REPORTED AGAINST (remediation-evidence-rules.plan.md stage 3): a cluster that changes
// tests only is a fix when every group in it was reported against a test file. Unreadable, it is {}: no such cluster is.
const reviewedFilesOf = () => {
  try {
    const gs = reviewedJson('finding-groups.json').groups ?? [];
    return Object.fromEntries(gs.filter((g) => typeof g?.file === 'string' && g.file).map((g) => [g.group_id, g.file]));
  } catch { return {}; }
};
// THE EXCEPTIONS A COMMIT RESTS ON, recorded for the follow-up review on a first run's commit and a retry's alike (G-8 of
// 20261023-044746-rer-delivery): a cluster committed without a test, and each group declared to have no possible red.
function recordEvidenceExceptions(check, planned, label, id = planned.id) {
  // From the plan's fields, not its notes' wording (G-4 of 20261023-062611-rer-remediation-review-2).
  if (planned.without_test) check(id, 'committed-without-test', `${label}: committed without a test: every group in it declared no possible red (no_red)`);
  for (const d of planned.declared_no_red ?? []) check(id, 'declared-no-red', `${label}: ${d.group} declared no possible red: ${d.reason}`, { group: d.group, reason: d.reason });
}
// ...AND WITHDRAWN WHEN THAT COMMIT DOES NOT LAND (G-5 of 20261023-062611-rer-remediation-review-2): they are recorded
// before the attempt, so a run killed after its commit landed still has them, and a refused commit must not keep them.
const EVIDENCE_EXCEPTION_KINDS = new Set(['committed-without-test', 'declared-no-red']);
function withdrawEvidenceExceptions(list, id) {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].cluster === id && EVIDENCE_EXCEPTION_KINDS.has(list[i].kind)) list.splice(i, 1);
}
// THE TREE GUARD'S INPUTS (remediation-verification stage 4), resolved once. Excluded BY NAME: where this repository's runs
// live (the run-location owner) and this run's own directory. The framework's mount is a check input (io/framework-mount.mjs).
const guardExcluded = [...repoRunRoots({ repoRoot: repo, project: contract.project ?? null, declaredReviewsDir: review.reviews_dir ?? null }), runDir]
  .map((d) => path.resolve(d)).filter((d) => isWithin(repo, d) && d !== path.resolve(repo))
  .map((d) => path.relative(repo, d).split(path.sep).join('/'));
// THE REPOSITORY'S CASE RULE for every path comparison below (candidate-check-boundaries.plan.md stage 1, amended
// 2026-10-14; G-9 of 20261014-022857-ccb-delivery): git's own core.ignorecase, because the paths compared are git's and the
// platform's flag hard-codes macOS as case-insensitive though case-sensitive volumes exist.
const CASE_INSENSITIVE = (() => { try { return gitIgnoresCase(git('config', '--bool', 'core.ignorecase')); } catch (e) { return die(`the repository's case rule cannot be read: ${e.message}`); } })();
// WHAT REACHES CODE THE REMEDIATOR WROTE (candidate-check-boundaries.plan.md stage 2): the platform's process basics,
// the git identity and the contract's declared names, by the platform's environment case rule; decided once, in lib.
const CANDIDATE_ENV = { basics: hostPlatform().processEnvBasics, declared: review.candidate_env ?? [],
  caseInsensitiveEnv: hostPlatform().caseInsensitiveEnv };
const guardContractSource = run.contract_source
  ? path.relative(repo, path.resolve(repo, run.contract_source)).split(path.sep).join('/') : null;
// `entries` is statusEntriesV2's answer; `candidate` the repository-relative paths the commit will carry.
const treeGuard = (entries, candidate) => [
  ...treeGuardRefusals({
    files: [...entries.files, ...entries.refused.filter((r) => !r.path.endsWith('/')).map((r) => r.path)],
    untracked: entries.untracked, candidate, contract, contractSource: guardContractSource, excludedDirs: guardExcluded,
    caseInsensitive: CASE_INSENSITIVE,
  }),
  ...frameworkMountRefusals(repo, FRAMEWORK.frameworkRoot),
];
// THE RUNNER'S OWN FOLDER (remediation-run-ownership D1; G-9 of 20261009-021636-remediation-paths-r3). evidence/remediation/
// is the node's, and the admission rule for a fix's evidence; everything the runner writes for itself is built here, and
// a name that exists is never reused, so nothing is truncated. A part may not climb out or be absolute.
const runnerPath = (...parts) => runnerPathIn(runDir, ...parts);
// BOUNDED (G-6 of 20261107-203720-co-remediation-3-review): a run directory holding this many numbered names is refused,
// not searched without end.
const FIRST_FREE_MAX = 10000;
const firstFree = (taken) => { const max = Number(args.testFirstFreeMax) || FIRST_FREE_MAX; for (let n = 1; n <= max; n += 1) if (!taken(n)) return n; return die(`${max} numbered names are already taken in the runner's folder of ${runDir}; nothing more is written there`); };
// --replay-node (repair-bench-replay.plan.md stage 2): what the recorded node left, installed where the spawned node would
// have left it: its captures and report in evidence/remediation/ and its status in nodes/, through the run's owner, both
// renamed to this run; its candidate written into the repository, each path through the repository's owner. It stands in
// for a spawn that exited 0, and everything after the spawn runs on it unchanged.
function installReplay({ src, record }) {
  for (const name of src.list(['evidence'])) owner.replace(['evidence', 'remediation', name], src.read(['evidence', name], null));
  const named = (text) => { const o = JSON.parse(text); o.run_id = run.run_id; return `${JSON.stringify(o, null, 2)}\n`; };
  owner.replace(['nodes', 'remediation.status.json'], named(src.read(['status.json'])));
  const tree = confined(repo);
  for (const [rel, hash] of Object.entries(record.candidate)) {
    const segs = String(rel).split(/[\\/]/).filter((x) => x && x !== '.');
    if (hash === 'absent') { if (tree.exists(segs)) tree.remove(segs); continue; }
    const blob = gitSync(['cat-file', '--filters', `--path=${rel}`, String(hash)], { cwd: repo, encoding: 'buffer' });
    if (blob.status !== 0) die(`--replay-node: the candidate's ${rel} (${hash}) cannot be read from git`);
    // THE MODE OF THE FILE IT REPLACES (G-7 of 20261107-203720-co-remediation-3-review): replace makes a fresh file, which
    // otherwise takes the process default and drops an exec bit; a path new to the tree keeps the default.
    const prior = tree.exists(segs) ? fs.statSync(path.join(repo, ...segs)).mode & 0o777 : null;
    tree.replace(segs, blob.stdout, { mode: prior });
  }
  owner.replace(['evidence', 'remediation', 'payload.json'], named(src.read(['payload.json'])));
  return { status: 0, signal: null };
}
// --measure-only (stage 4 of remediation-repair-pass.plan.md): the record saved, the lock released, nothing committed.
function endMeasureOnly(refusal, save) {
  save();
  setLockPhase('saved');
  console.log(`remediate: --measure-only: the candidate is ${refusal ? `refused (${refusal.kind})` : 'green'}; nothing committed, archived or minted`);
  process.exit(0);
}

// ------------------------------------------------------------------- the node: its limits, its brief lines, its argv
// One place for the first pass and a repair pass (remediation-repair-pass.plan.md stage 2), so the two are spawned alike.
const repoRel = (p) => path.relative(repo, p).split(path.sep).join('/');
let nodeLimitsCache = null;
/**
 * THE NODE'S OWN LIMIT (remediation-verification stage 2): the roster's remediation entry when it declares one, else the
 * contract's node limit, and the repair pass cap from the same entry (repairPassCap). Read from the roster beside this
 * engine, the one spawn-node and run-graph read. Decided BEFORE the brief, which states it (stage 3).
 */
function nodeLimits() {
  if (nodeLimitsCache) return nodeLimitsCache;
  try {
    const roster = JSON.parse(fs.readFileSync(path.join(FRAMEWORK.scriptsDir, 'lens-roster.json'), 'utf8'));
    // The remediation entry sits under barrier_nodes; lenses is searched too, so a move between the two cannot lose it.
    const entry = [...(roster.barrier_nodes ?? []), ...(roster.lenses ?? [])].find((l) => l?.id === 'remediation');
    nodeLimitsCache = { nodeTimeoutMinutes: remediationTimeoutMinutes(entry, review), captureLimitMinutes: checkTimeoutMinutes(run.contract ?? {}),
      // TEST-ONLY override, so a fixture can run at a cap the shipped roster does not hold.
      repairCap: args.testRepairPasses !== undefined ? repairPassCap({ repair_passes: Number(args.testRepairPasses) }) : repairPassCap(entry) };
  } catch (e) { die(`the remediation node's limits cannot be decided: ${e.message}`); }
  return nodeLimitsCache;
}
/** One line of the node's brief, from its template in the prompt library, with its trailing newline dropped. */
const briefLine = (name, vars) => renderTemplate(readTemplate(name), vars, name).replace(/\n+$/, '');
/** WHAT THE NODE IS TOLD (stage 3): its narrow command, rendered from the frozen contract, and both limits. */
function nodeBriefLines() {
  const { nodeTimeoutMinutes, captureLimitMinutes } = nodeLimits();
  // A REFUSED RUN DIRECTORY IS A DIAGNOSTIC (G-5 of 20261108-032104-si-remediation-4-review), not an uncaught throw.
  let runDirArg;
  try { runDirArg = briefArg(runDir); } catch (e) { die(`the node's brief cannot name its run directory: ${e.message}`); }
  // THE HEAD IS CHECKED TOO (G-24 of 20261121-204740-m3s7-b1-remediation-review; I-9): it cannot be quoted, since the
  // node's allow-list prefix-matches it, so one a shell would split or expand refuses the launch.
  let captureHead;
  try { captureHead = briefHead(repoRel(path.join(FRAMEWORK.scriptsDir, 'capture.mjs'))); } catch (e) { die(`the node's brief cannot name capture.mjs: ${e.message}`); }
  const captureStart = `node ${captureHead} --run-dir ${runDirArg} --node remediation --name <slug> --`;
  const testOne = testOneTemplate(run.contract ?? {});
  // The node's instructions are the prompt library's (consumer-owned-configuration.md AC2), filled from the run.
  const testOneLine = testOne.ok && testOne.argv
    ? briefLine('remediation-test-one.md', { capture: captureStart, argv: testOne.argv.join(' ') })
    // G-7 of 20261013-220031-rv-delivery: the evidence gate admits only test_one captures, so telling the node to use the
    // full suite sent it to make evidence that could never commit (plan stage 8).
    : briefLine('remediation-test-one-none.md', {});
  const limitsLine = briefLine('remediation-limits.md', { capture_minutes: captureLimitMinutes, node_minutes: nodeTimeoutMinutes });
  return { capture_cmd: `${captureStart} <command>`, test_one: testOneLine, limits: limitsLine };
}
/** The runtime this run's nodes spawn on, chosen by the one owner from the run's frozen contract; refused if unknown. */
function nodeRuntime() {
  try { return selectAdapters({ contract }).runtime; } catch (e) { die(e.message); }
}
/** That runtime's adapter entry, whose node_runtime.exit names the reason field (G-19 of 20261121-193516-m3s7-b1-review). */
function nodeRuntimeAdapter() {
  const a = selectAdapters({ contract });
  return a.table[a.runtime] ?? {};
}
/** The argv spawn-node runs a remediation node with: `nodeId` its own, `variant` its report's schema. */
function nodeSpawnArgv(nodeId, variant) {
  const budget = budgetOf(review.budget_usd_per_node, 2.5);
  // THE REVIEWED RUN IS GRANTED ONLY AS ADMITTED (G-14 of 20261023-014400-rdt-delivery): the raw frame path went to the
  // write-capable node as --add-dir while the chain walk found the run by its id, so a frame naming a valid run_id and any
  // existing directory exposed that directory. It is granted when admitRun admits it for this repository as that run, by
  // its real path. Since run-dir-descendants stage 3 that is the one admission every read uses (reviewedDir above), and a
  // reviewed run that does not admit has already refused the run rather than reaching here ungranted.
  const reviewedGrant = reviewedDir();
  return [
    path.join(FRAMEWORK.scriptsDir, 'spawn-node.mjs'),
    '--run-dir', runDir, '--repo-root', repo,
    '--node-id', nodeId, '--mode', 'remediate', '--schema-variant', variant,
    '--skill-command', '/remediation', '--inline-skill',
    // THE RUN IT MUST READ, AS A DIRECTORY (story-pipeline, 20261010-190952-remediate-docs-arch-stage0): the node's cwd is
    // the repository, and a run staged outside it (reviews_dir "") was reachable only through a path-scoped Read rule,
    // which grants nothing on Windows (contract-glob-grammar stage 2b). Denied its own brief, the node refused. The
    // repository stays the first directory; this run, and the reviewed run, are added when they lie outside it.
    '--add-dir', repo, ...[runDir, reviewedGrant].filter((d) => d && !isWithin(repo, path.resolve(d))),
    '--timeout-minutes', String(nodeLimits().nodeTimeoutMinutes),
    '--budget-usd', Number.isFinite(budget) ? String(budget) : 'none',
    // THE FROZEN RUNTIME (G-18): the policy new-run wrote is in that runtime's vocabulary. Chosen by the one owner
    // (contract-runtime-and-session-files.plan.md stage 1), from the run's frozen contract.
    '--runtime', nodeRuntime(),
    ...(args.unsandboxed ? ['--unsandboxed'] : []),
    ...runtimeBinArgv(args.runtimeBin),
  ];
}

const lit = (...a) => gitFor(a[0])(['--literal-pathspecs', ...a], { cwd: repo, encoding: 'utf8' });

/**
 * THE RUNNER CHECKS THE COMMIT CANDIDATE, IN PLACE (remediation-verification.plan.md stage 4; operator, 2026-10-13: "The
 * runner, once (Recommended)", "In place, guarded (Recommended)"). `candidate`: every file the planned commits carry.
 * The tree guard first — nothing but the candidate may differ in what the checks read — then the checked state is
 * recorded (HEAD, each candidate file's hash or `absent`), then every declared pre-flight command runs through the one
 * core into evidence/remediation-runner/, in the candidate checks' allow-list (candidateCheckEnv: the platform's process
 * basics, the git identity, QUORATE_HOME and review.candidate_env, plus the channel files and the depth). Returns
 * null when the candidate may be committed, else { kind, message } for every planned cluster.
 */
async function fullCheck(candidate) {
  const files = [...new Set(candidate)].sort();
  const st = git('status', '--porcelain=v2', '-z', '--untracked-files=all');
  const refuse = (message) => ({ refusal: { kind: 'tree-not-candidate', message }, state: null });
  if (st.status !== 0) return refuse(`git status failed, so the tree cannot be checked: ${st.stderr.trim()}`);
  const guard = treeGuard(statusEntriesV2(st.stdout), new Set(files));
  if (guard.length) return refuse(guardMessage(guard));
  const head = git('rev-parse', 'HEAD');
  if (head.status !== 0 || !head.stdout.trim()) return refuse(`git rev-parse HEAD failed, so the checked state cannot be recorded: ${String(head.stderr ?? '').trim()}`);
  const all = hashesOf(files);
  if (all.error) return refuse(`${all.error}, so the checked state cannot be recorded`);
  const hashes = Object.fromEntries(files.map((p) => [p, all.hashes[p]]));
  const commands = contract.commands ?? {};
  const declared = PREFLIGHT_COMMAND_KEYS.filter((k) => String(commands[k] ?? '').trim());
  // THE CHANNEL FILES ARE FRESH (stage 4): a folder of this check's own, and a file already there refuses the check.
  const name = `full-check-${firstFree((n) => !owner.isFree(runnerSegs(`full-check-${n}`)))}`;
  owner.dir(runnerSegs(name));
  // THE HASHES ARE EVIDENCE, cited from run.json rather than written into it: an archived run.json is tracked, and a hash
  // keyed by a file name with "auth" or "token" in it reads as a credential to the push's secret scan (operator,
  // 2026-10-15: "Fingerprint now, fix shape (Recommended)").
  owner.replace(runnerSegs(name, 'checked-files.json'), `${JSON.stringify(hashes, null, 2)}\n`);
  const filesAt = path.relative(runDir, runnerPath(name, 'checked-files.json')).split(path.sep).join('/');
  const record = { at: new Date().toISOString(), head: head.stdout.trim(), files_at: filesAt, declared };
  const prior = readRun(runDir).full_checks ?? [];
  // Saved BEFORE the checks, so a kill during them leaves the state that was being checked on disk.
  saveRun({ full_checks: [...prior, record] });
  const countFile = runnerPath(name, 'test.count.txt');
  const factsFile = runnerPath(name, 'test.facts.json');
  // Through the owner (run-dir-reads.plan.md stage 4): a link standing at either file is not "absent"; it is stale.
  const presentBelowRun = (f) => { try { return owner.exists(path.relative(runDir, f).split(path.sep)); } catch { return true; } };
  const staleBefore = [countFile, factsFile].filter(presentBelowRun);
  setLockPhase('checking');
  // A NEW FILE IS CHECKED AS GIT WILL COMMIT IT (remediation 20261020-125626-ciss-remediation-5): with the node's new
  // module untracked, a check that asks git what is tracked failed on the candidate, so a fix adding a file could never
  // commit. Each untracked candidate file is marked intent-to-add for the checks, and unmarked after, whatever they decide.
  const listed = files.length ? lit('ls-files', '--others', '--exclude-standard', '-z', '--', ...files) : { status: 0, stdout: '' };
  if (listed.status !== 0) return refuse(`git ls-files failed, so the candidate's new files cannot be named: ${String(listed.stderr ?? '').trim()}`);
  // A FILE ALREADY INTENT-TO-ADD IS NEW TOO (G-2 of 20261020-202031-intent-unmark-remediation-review): a failed unmark leaves
  // it in the index, where `--others` no longer lists it, so --retry-commits skipped the unmark and committed past the
  // refusal. Against the index, git diff reports exactly those entries as added.
  const marked = files.length ? lit('diff', '--name-only', '--no-renames', '--diff-filter=A', '-z', '--', ...files) : { status: 0, stdout: '' };
  if (marked.status !== 0) return refuse(`git diff failed, so the candidate's intent-to-add files cannot be named: ${String(marked.stderr ?? '').trim()}`);
  const newFiles = [...new Set([...listed.stdout.split('\0'), ...marked.stdout.split('\0')].filter(Boolean))];
  if (newFiles.length) {
    const added = lit('add', '--intent-to-add', '--', ...newFiles);
    if (added.status !== 0) return refuse(`git add --intent-to-add failed, so the candidate cannot be checked as committed: ${String(added.stderr ?? '').trim()}`);
  }
  // A FAILED UNMARK REFUSES THE CANDIDATE (G-3 of 20261020-132503-ciss-remediation-5-review): printed only, the run went on
  // with the index holding the new files as intent-to-add, and a passing candidate committed past it.
  let unmarkFailed = null;
  // THE RUNNER UNMARKS, AND PRINTS NO COMMAND (G-4 of 20261020-225653-intent-unmark-remediation-5-review; operator: "Runner
  // does it, prints no command (Recommended)"). A printed `git reset` was quoted for a shell (G-3 of
  // 20261020-210303-intent-unmark-remediation-2-review, G-2 of 20261020-214234-intent-unmark-remediation-3-review), and no
  // quoting is right for every one: cmd.exe expands `%NAME%` inside double quotes, and briefArg's backslash rewrite renamed
  // a POSIX path, so the pasted reset named another file. --retry-commits names a file left intent-to-add (`marked` above)
  // and unmarks it after its check, so it is the recovery, and nothing is pasted into a shell.
  const unmark = () => {
    if (!newFiles.length) return;
    const r = args.testFailUnmark ? { status: 1, stderr: 'test seam: unmark forced to fail' } : lit('reset', '-q', '--', ...newFiles);
    if (r.status !== 0) {
      unmarkFailed = `git reset could not unmark ${newFiles.join(', ')}, so the index still holds them as intent-to-add (${String(r.stderr ?? '').trim()}); `
        + '--retry-commits unmarks them after it checks the candidate again';
      console.error(`remediate: full check: ${unmarkFailed}`);
    }
  };
  let ran;
  try {
    ({ ran } = await runDeclaredChecks({
    runDir, repoRoot: repo, commands, nodeId: 'remediation-runner', timeoutMinutes: checkTimeoutMinutes(contract), keys: declared,
    barrierKeys: new Set(['build']), concurrency: Math.max(1, Number(review.checks_concurrency ?? 1) || 1),
    shell: String(commands.shell ?? '').trim(), label: 'remediate: full check',
    envOf: (key) => candidateCheckEnv(process.env, key === 'test' ? { QUORATE_COUNT_FILE: countFile, QUORATE_FACTS_FILE: factsFile } : {},
      CANDIDATE_ENV),
    }));
  } finally {
    unmark();
  }
  const results = {};
  for (const [key, r] of ran) {
    const log = r.evidence_path;
    results[key] = {
      // The outcome runDeclaredChecks read from the log's header (check-outcomes.plan.md stage 2), with the header's facts.
      exit_code: r.exit_code, evidence_path: log, outcome: r.outcome, outcome_detail: r.outcome_detail, timed_out: r.timed_out === true,
      ...(r.capture_error ? { capture_error: r.capture_error } : {}),
      // Each check's own time (telemetry-records.plan.md stage 1b), as the pre-flight's checks.json carries it.
      started_at: r.started_at ?? null, duration_ms: r.duration_ms ?? null,
      ...(log ? logCountsInLog(runDir, log) : { tests: null, failing: null, failing_names: [] }),
    };
  }
  const readOr = (f, parse) => { try { return parse(owner.read(path.relative(runDir, f).split(path.sep))); } catch { return null; } };
  const count = readOr(countFile, (t) => { const n = Number(t.trim()); return Number.isFinite(n) && t.trim() !== '' ? n : null; });
  const facts = readOr(factsFile, JSON.parse);
  const channels = { count, facts, ...(staleBefore.length ? { stale: `${staleBefore.join(', ')} existed before the check, so neither channel can be trusted` } : {}) };
  // A baseline recorded before check-outcomes carries no outcome: read it from its log, which carries the signal the
  // record's fields do not (plan stage 2; plan-review round 4). Only with that log gone is it derived from the fields.
  const recordedBaseline = readRun(runDir).fmt_baseline;
  const oldBase = recordedBaseline?.fmt_check;
  const baseline = oldBase && !oldBase.outcome && oldBase.evidence_path && presentBelowRun(path.join(runDir, oldBase.evidence_path))
    ? { ...recordedBaseline, fmt_check: { ...oldBase, ...(({ outcome, detail }) => ({ outcome, outcome_detail: detail }))(outcomeInLog(runDir, oldBase.evidence_path)) } }
    : recordedBaseline;
  const verdict = fullCheckVerdict({ declared, ran: results, channels, baseline });
  if (verdict.stamps.some((s) => s.key === 'fmt_check')) stamps.add('FMT-DIRTY');
  const done = { ...record, results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { ...v, failing_names: v.failing_names.slice(0, RUN_JSON_FAILING_NAMES) }])),
    refusals: verdict.refusals, advisory: verdict.stamps, unfinished: verdict.unfinished, count_update: verdict.countUpdate };
  saveRun({ stamps, full_checks: [...prior, done] });
  for (const s of verdict.stamps) console.error(`remediate: full check: ${s.key} ${s.why} — recorded, not refused`);
  for (const u of verdict.unfinished) console.error(`remediate: full check: ${u.key} ${u.why} — recorded, not refused, no stamp`);
  if (verdict.countUpdate) {
    console.error(`remediate: full check: the counted facts drifted, and nothing else failed; the commit proceeds. Update the stated count:\n  ${verdict.countUpdate.message}`);
  }
  if (verdict.commit && unmarkFailed) return { refusal: { kind: 'tree-not-candidate', message: unmarkFailed }, state: { ...record, files: hashes } };
  if (verdict.commit) return { refusal: null, state: { ...record, files: hashes } };
  return { refusal: { kind: 'full-run-red', message: `the full check refused the candidate: ${verdict.refusals.map((r) => `${r.key} ${r.why}`).join('; ')}${unmarkFailed ? `; and ${unmarkFailed}` : ''}`,
    fmt_turned_red: verdict.refusals.some((r) => r.turned_red) }, state: { ...record, files: hashes } };
}

/**
 * THE REPAIR PASS (remediation-repair-pass.plan.md stages 2 and 3; design RP-D1 A, operator 2026-11-01: "1 a"). The full
 * check refused the candidate on failing tests the node never ran (two remediations in a row did). Up to `cap` times: the
 * node is spawned again, fresh, as remediation-repair-<n>, given every failing test with its file and the check's log;
 * its report is read by lib's repairReportErrors, the files it changed are admitted into the clusters it names by lib's
 * repairFileAdmission (the planner's own file rule), and the widened candidate is checked again. A pass whose report or
 * files cannot be admitted, or that changed nothing, ends the passes and the refusal stands, its edits left in the tree.
 * Only a refusal by failing tests alone is offered: a build, lint or typecheck failure is refused as before.
 * `targets`: [{ id, accepted, record }] — the clusters in the checked candidate; `accepted` is extended in place, and
 * `record` (the cluster's run.json entry) gets the same files and `repair_added`. Every pass is saved in `repair_passes`.
 */
async function repairPasses({ targets, refusal, state, cap, persist = () => {} }) {
  let done = 0;
  while (refusal?.kind === 'full-run-red' && done < cap) {
    const last = (readRun(runDir)?.full_checks ?? []).at(-1);
    const log = last?.results?.test?.evidence_path;
    const testsOnly = Array.isArray(last?.refusals) && last.refusals.length > 0 && last.refusals.every((r) => r.key === 'test');
    const failing = testsOnly && log ? failingTestsInLog(runDir, log) : [];
    if (!failing.length) {
      if (done === 0) console.error('remediate: repair pass not offered: the full check did not refuse on failing tests alone');
      break;
    }
    done += 1;
    const n = (readRun(runDir)?.repair_passes ?? []).length + 1;
    const nodeId = `remediation-repair-${n}`;
    const entry = { pass: n, node_id: nodeId, started_at: new Date().toISOString(), failing: failing.map((t) => t.name),
      brief: `nodes/${nodeId}-brief.md`, report: `evidence/${nodeId}/payload.json` };
    const record = (fields) => {
      Object.assign(entry, fields);
      saveRun({ repair_passes: [...(readRun(runDir)?.repair_passes ?? []).filter((p) => p.pass !== n), entry] });
    };
    const lines = nodeBriefLines();
    const brief = renderTemplate(readTemplate('remediation-repair-brief.md'), {
      run_id: run.run_id, pass: String(n), cap: String(cap),
      failing: repairFailingLines(failing),
      log_path: path.join(runDir, log),
      clusters: targets.map((t) => `- ${t.id}: ${t.accepted.join(', ')}`).join('\n'),
      capture_cmd: lines.capture_cmd, test_one: lines.test_one, limits: lines.limits,
    }, 'remediation-repair-brief.md');
    owner.replace(['nodes', `${nodeId}-brief.md`], brief);
    const before = git('status', '--porcelain=v2', '-z', '--untracked-files=all');
    // A refused pass keeps its times, a git failure's too (G-13 of 20261102-033648-rrp-remediation-review), and every
    // field the contract documents on a pass (G-14 of 20261102-044855-rrp-remediation-2-review): before the spawn, no node
    // ran and nothing changed; after it, what changed is unknown, null.
    const notRun = { node_exit: null, node_state: null, changed: [] };
    if (before.status !== 0) { record({ ended_at: new Date().toISOString(), ...notRun, outcome: 'refused', why: `git status failed before the pass: ${before.stderr.trim()}` }); break; }
    const beforeFiles = statusEntriesV2(before.stdout).files;
    const beforeHashes = hashesOf(beforeFiles);
    if (beforeHashes.error) { record({ ended_at: new Date().toISOString(), ...notRun, outcome: 'refused', why: beforeHashes.error }); break; }
    record({});
    console.log(`== repair pass ${n} of ${cap} (${failing.length} failing test(s)) ==`);
    setLockPhase('node-running');
    const spawned = spawnSync(process.execPath, nodeSpawnArgv(nodeId, 'remediation-repair'), { cwd: repo, stdio: 'inherit', env: { ...process.env, GRAPH_NODE_DEPTH: '0' } });
    setLockPhase('node-ran');
    let payload = null;
    try { payload = JSON.parse(owner.read(['evidence', nodeId, 'payload.json'])); } catch { /* none: refused below */ }
    // NORMALIZED WHERE IT IS READ, before any consumer (G-12 of 20261104-060910-epo-delivery): repairReportErrors read the
    // node's spelling, and only the fixed failures' greens were normalized after it.
    payload = normalReport(payload);
    let nodeState = null;
    try { nodeState = JSON.parse(owner.read(['nodes', `${nodeId}.status.json`])).state ?? null; } catch { /* unknown */ }
    const after = git('status', '--porcelain=v2', '-z', '--untracked-files=all');
    const ran = { node_exit: spawned.status, node_state: nodeState, changed: null };
    if (after.status !== 0) { record({ ended_at: new Date().toISOString(), ...ran, outcome: 'refused', why: `git status failed after the pass: ${after.stderr.trim()}` }); break; }
    const afterEntries = statusEntriesV2(after.stdout);
    const afterHashes = hashesOf(afterEntries.files);
    if (afterHashes.error) { record({ ended_at: new Date().toISOString(), ...ran, outcome: 'refused', why: afterHashes.error }); break; }
    const changed = [...new Set([...afterEntries.files, ...beforeFiles])]
      .filter((p) => beforeHashes.hashes[p] !== afterHashes.hashes[p]);
    const errors = spawned.status !== 0 || nodeState !== 'OK'
      ? [`the repair node did not finish OK (spawn-node exited ${spawned.status}, state ${nodeState ?? 'unknown'})`]
      : repairReportErrors(payload, { runId: run.run_id, pass: n, clusterIds: targets.map((t) => t.id), failing, caseInsensitive: CASE_INSENSITIVE });
    // EACH FIXED TEST'S GREEN, from capture's own header: a test_one capture of that test's file, passing, in the node's
    // evidence folder (the evidence gate's reading, stage 5 of remediation-verification).
    const fixed = (payload?.failures ?? []).filter((f) => f?.disposition === 'fixed');
    for (const f of fixed) if (f?.evidence_path_refused) errors.push(`${f.test_name ?? 'a fixed test'}: a cited evidence path is refused (${f.evidence_path_refused})`);
    const facts = captureFacts(runDir, fixed.map((f) => f.green_evidence));
    errors.push(...repairGreenErrors(fixed, facts, { pass: n, failing, caseInsensitive: CASE_INSENSITIVE }));
    const admission = repairFileAdmission({ failures: payload?.failures ?? [], clusters: targets, changed, status: afterEntries,
      dirtyAtStart: readRun(runDir).dirty_at_start?.files ?? [], refusedAtStart: readRun(runDir).dirty_at_start?.refused ?? [],
      contract, caseInsensitive: CASE_INSENSITIVE });
    for (const r of admission.refused) errors.push(`${r.path} refused — ${r.reason}`);
    for (const p of admission.unlisted) errors.push(`${p} changed during the pass and is listed in no answer`);
    const why = errors.length ? errors.join('; ') : !changed.length ? 'the pass changed nothing' : !fixed.length ? 'the pass fixed no failing test' : null;
    const timing = { ended_at: new Date().toISOString(), node_exit: spawned.status, node_state: nodeState, changed };
    if (why) {
      record({ ...timing, outcome: 'refused', why });
      console.error(`remediate: repair pass ${n} not admitted: ${why}; the full check's refusal stands, and the pass's edits are left in the working tree`);
      break;
    }
    for (const t of targets) {
      const add = admission.additions[t.id] ?? [];
      if (!add.length) continue;
      t.accepted.push(...add);
      if (t.record && t.record.accepted !== t.accepted) t.record.accepted = [...t.accepted];
      if (t.record) t.record.repair_added = [...(t.record.repair_added ?? []), ...add];
    }
    record({ ...timing, added: admission.additions });
    recordRepairGreens(fixed);
    persist();
    ({ refusal, state } = await fullCheck(targets.flatMap((t) => t.accepted)));
    record({ outcome: refusal ? 'still-red' : 'green', full_check: (readRun(runDir)?.full_checks ?? []).length - 1, ...(refusal ? { why: refusal.message } : {}) });
  }
  return { refusal, state };
}

// A red or a green may list several captures (lib's evidencePaths), so each is read on its own.
// EVERY READ OF A NODE'S REPORT GOES THROUGH THE OWNER (evidence-path-owner.plan.md stage 2): its evidence paths in normal
// form, the run directory and the platform's case rule given, so no reader below sees a spelling.
// The repository's case rule, core.ignorecase (CASE_INSENSITIVE), as for every path the remediation path compares.
// The places this same run has lived, for an absolute path written before it moved (G-7 of 20261104-060910-epo-delivery):
// its id below each root where this repository's runs live, never any directory that merely carries the id.
const formerRunDirs = () => repoRunRoots({ repoRoot: repo, project: contract.project ?? null, home: quorateHome(), declaredReviewsDir: review.reviews_dir ?? null })
  .map((d) => path.resolve(d, run.run_id)).filter((d) => d !== path.resolve(runDir));
// THE WHOLE REPORT, not a caller's pick of its items and fields (G-10, G-12 of 20261104-060910-epo-delivery).
const normalReport = (report) => normalizeReport(report, { runDir: path.resolve(runDir), caseInsensitive: CASE_INSENSITIVE, formerRunDirs: formerRunDirs() });
const evidencePathsOf = (groups) => (groups ?? []).flatMap((g) => [...evidencePaths(g?.red_evidence), ...evidencePaths(g?.green_evidence)]).filter((p) => typeof p === 'string' && p);
// THE EVIDENCE AS IT IS NOW, in evidence_record's shape (design GR-D2 A): the report's hash and each cited capture's, read
// through the run's confined owner. A missing file is 'absent'; one the owner refuses (a link) is named by its refusal.
function captureHash(segs) {
  try { return createHash('sha256').update(owner.read(segs)).digest('hex'); } catch (e) {
    return e?.code === 'ENOENT' ? 'absent' : `unreadable (${e?.code ?? e?.message})`;
  }
}
function evidenceRecordNow(paths, repairPaths = []) {
  const captures = {};
  for (const p of [...new Set(paths)].sort()) captures[p] = captureHash(p.split('/').filter(Boolean));
  const repair_captures = {};
  for (const p of [...new Set(repairPaths)].sort()) repair_captures[p] = captureHash(p.split('/').filter(Boolean));
  return { payload: captureHash(['evidence', 'remediation', 'payload.json']), captures, ...(repairPaths.length ? { repair_captures } : {}) };
}
// AN ADMITTED REPAIR PASS'S GREENS JOIN THE RECORD (G-11 of 20261104-072059-epo-remediation-review): they admitted its
// files, so a retry refuses one that changed after, as it refuses a group's capture. Normal forms only: the report was
// normalized where it was read (normalReport).
function recordRepairGreens(fixed) {
  const greens = fixed.map((f) => f?.green_evidence).filter((p) => typeof p === 'string' && p);
  const rec = readRun(runDir).evidence_record;
  if (!greens.length || !rec || typeof rec !== 'object') return;
  saveRun({ evidence_record: { ...rec, repair_captures: { ...(rec.repair_captures ?? {}), ...evidenceRecordNow([], greens).repair_captures } } });
}
function refuseOnEvidenceChange(label, groups) {
  const record = readRun(runDir).evidence_record;
  const why = evidenceRecordDifference(record, evidenceRecordNow(evidencePathsOf(groups), Object.keys(record?.repair_captures ?? {})));
  if (why) die(`${label}: refused, nothing is planned or committed: ${why} (grounding-and-retry-evidence.plan.md stage 2)`);
}
// The files of clusters THIS run refused for changing no source file (stage 5): when one blocks another cluster, the
// refusal names it as the cause (lib's treeGuardMessage). Filled from the plan, and on a retry from the recorded clusters.
const ownRefusedTestOnly = new Map();
const NOT_A_FIX = 'its accepted files include no source_globs path, so it is not a fix';
const noteOwnRefused = (clusters) => {
  for (const c of clusters ?? []) {
    if (c && !c.committable && (c.notes ?? []).includes(NOT_A_FIX)) for (const p of c.accepted ?? []) ownRefusedTestOnly.set(p, { id: c.id, groups: c.groups });
  }
};
const guardMessage = (guard) => treeGuardMessage(guard, ownRefusedTestOnly);
// A file's content as git would store it (`hash-object` applies the path's filters), or `absent`.
function hashOf(p) {
  if (!fs.existsSync(path.join(repo, p))) return { hash: 'absent' };
  const h = git('hash-object', '--', p);
  return h.status === 0 ? { hash: h.stdout.trim() } : { error: `git hash-object ${p} failed: ${h.stderr.trim()}` };
}
// Many files in ONE git process (G-8 of 20261014-000825-rv-delivery-remediation-2-review: one spawn per file, before every
// cluster, was O(c^2) spawns). `--stdin-paths` applies each path's filters as hashOf does; a path holding a newline cannot
// cross that channel and goes through hashOf. Returns { hashes: {path: hash | 'absent'} } or { error }.
function hashesOf(paths) {
  const hashes = {};
  const batch = [];
  for (const p of new Set(paths)) {
    if (p.includes('\n')) { const h = hashOf(p); if (h.error) return h; hashes[p] = h.hash; }
    else if (!fs.existsSync(path.join(repo, p))) hashes[p] = 'absent';
    else batch.push(p);
  }
  if (!batch.length) return { hashes };
  const h = gitSync(['hash-object', '--stdin-paths'], { cwd: repo, encoding: 'utf8', input: `${batch.join('\n')}\n` });
  const out = h.status === 0 ? h.stdout.split('\n').map((x) => x.trim()).filter(Boolean) : [];
  if (h.status !== 0 || out.length !== batch.length) return { error: `git hash-object --stdin-paths failed: ${String(h.stderr ?? '').trim() || `${out.length} hashes for ${batch.length} files`}` };
  batch.forEach((p, i) => { hashes[p] = out[i]; });
  return { hashes };
}

/**
 * WHAT IS COMMITTED IS WHAT WAS CHECKED (remediation-verification stage 4): before each cluster's `git add`, the tree
 * guard holds for the whole tree, every file still to be committed hashes as recorded, and HEAD is the checked HEAD
 * advanced only by this invocation's own commits, in order (`own`). Returns null, or the refusal for this cluster and
 * every one after it. Files already committed are not re-hashed: the blob comparison after each commit covers them.
 */
function recheck(state, own, remaining) {
  const st = git('status', '--porcelain=v2', '-z', '--untracked-files=all');
  if (st.status !== 0) return { kind: 'tree-not-candidate', message: `git status failed, so the tree cannot be re-checked: ${st.stderr.trim()}` };
  const guard = treeGuard(statusEntriesV2(st.stdout), new Set(Object.keys(state.files)));
  if (guard.length) return { kind: 'tree-not-candidate', message: guardMessage(guard) };
  const now = hashesOf(remaining);
  if (now.error) return { kind: 'tree-not-candidate', message: `${now.error}, so the files cannot be re-checked` };
  for (const p of [...new Set(remaining)]) {
    if (now.hashes[p] !== state.files[p]) return { kind: 'tree-not-candidate', message: `${p} changed since it was checked (${state.files[p]} then, ${now.hashes[p]} now); the commit would carry what was not checked` };
  }
  const rl = git('rev-list', '--reverse', `${state.head}..HEAD`);
  if (rl.status !== 0) return { kind: 'tree-not-candidate', message: `git rev-list failed, so whether HEAD moved cannot be told: ${rl.stderr.trim()}` };
  const moved = rl.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
  if (moved.length !== own.length || moved.some((c, i) => c !== own[i])) {
    return { kind: 'tree-not-candidate', message: `HEAD moved since the check by commits this run did not make (${moved.filter((c) => !own.includes(c)).join(', ') || 'a rewrite of its own'}); the checked state no longer holds` };
  }
  return null;
}

// AFTER EACH COMMIT: the committed blobs against the hashes recorded at check time, since a pre-commit hook such as a
// formatter can rewrite a file after the re-check. Returns the files that differ, each with what was committed.
function committedDiffers(state, files) {
  if (!files.length) return [];
  // ONE ls-tree FOR THE CLUSTER (G-8 of 20261108-021347-si-remediation-2-review), not a rev-parse per file and an ls-tree per
  // failed lookup. A FAILED READ IS NOT AN ABSENT PATH (G-11 of 20261107-224233-si-remediation-review): absent only when HEAD's
  // tree, read successfully, does not list it; a failed ls-tree names every file as unverified, never as a match.
  const ls = git('ls-tree', '-z', 'HEAD', '--', ...files.map((p) => `:(literal)${p}`));
  if (ls.status !== 0) return files.map((p) => `${p} (checked ${state.files[p]}; the committed state could not be read: ${(ls.stderr || '').trim() || `ls-tree exit ${ls.status}`})`);
  const entries = lsTreeEntries(ls.stdout);
  const out = [];
  for (const p of files) {
    const want = state.files[p];
    const have = entries.get(p)?.hash ?? 'absent';
    if (have !== want) out.push(`${p} (checked ${want}, committed ${have})`);
  }
  return out;
}

// ------------------------------------------------------------------- a refused cluster set aside for the full check
// remediation-cluster-order.plan.md (design CO-D1 A, CO-D2 A, CO-D3 A). A planned cluster ruled not committable kept its
// edits in the tree, and the tree guard then refused every committable cluster for a test file changed outside the
// candidate (20261106-184639-nbk-remediation, 20261106-193734-nbk-remediation-2). Its exact bytes are copied under the
// run directory, through the A-30 owner, with a manifest written last; its paths go back to HEAD for the check and the
// commits; the bytes are written back after, each hash verified. lib's setAsidePlan decides which clusters qualify.

// THE SET-ASIDE ITSELF lives in scripts/io/set-aside.mjs (runner-test-seam.plan.md stage 1, design RT-D1 A), between its
// markers; what stays here is what the runner owns: the tree it builds, the capabilities it passes, the finisher registered
// with atDie, the printed retry, and its test seams.
// THE WORKING TREE'S FILES ARE WRITTEN THROUGH AN OWNER TOO (A-30): the set-aside puts a path back, or writes its bytes
// back, through confined(repo), which refuses a link at any level, so a write-back cannot follow one out of the repository.
const tree = confined(repo);

// THE WRITE-BACK SEAMS ARE A CHANGE TO THE `tree` PASSED IN (runner-test-seam.plan.md stage 1), so the module reads no argv:
// --test-fail-write-back makes the write-back's first replace throw, --test-mismatch-write-back makes it write the copy's
// bytes and one line more, so the hash check after it fails and a --retry-commits has to overwrite what it left. Neither
// acts on the runner's own `tree`.
const setAsideTree = (() => {
  if (!args.testFailWriteBack && !args.testMismatchWriteBack) return tree;
  let first = true;
  return { ...tree, replace(segs, data, opts) {
    if (!first) return tree.replace(segs, data, opts);
    first = false;
    if (args.testFailWriteBack) throw Object.assign(new Error('test seam: the write-back fails'), { code: 'ETEST' });
    return tree.replace(segs, Buffer.concat([Buffer.from(data), Buffer.from('test seam: a byte the write did not put there\n')]), opts);
  } };
})();
// ONE CAPABILITY ARGUMENT, through the module's one builder, which adds withFileBytes: git through the runner's own git
// processes (gitFor's environment, A-29), run.json through its one writer, firstFree's bound from --test-first-free-max.
const setAsideCaps = setAsideCapabilities({
  tree: setAsideTree,
  owner,
  git: (argv, { input } = {}) => gitFor(argv[0])(argv, { cwd: repo, encoding: 'utf8', ...(input === undefined ? {} : { input }) }),
  run: { dir: runDir, read: () => readRun(runDir), save: (fields) => saveRun(fields) },
  firstFree,
  log: (line) => console.error(line),
});
// A SET-ASIDE'S REFUSAL IS THE RUNNER'S DIE (the plan's "Errors"): this catches a SetAsideError and dies with its message; die
// prints the reason, then the finisher registered with atDie writes the files back, so the reason always comes first. ONE
// OWNER for a first run and a retry (G-8 of 20261108-222629-rts-delivery): the refusal handling and the set-aside-kept message
// were written at each. The caller registers setAsideFinisher first and calls this inside its try.
function setAsideForCheck(aside, clusters, check) {
  try { Object.assign(aside, setAsideRefused(setAsideCaps, clusters, aside)); } catch (err) { if (err instanceof SetAsideError) die(err.message); throw err; }
  for (const k of aside.kept) check(k.id, 'set-aside-kept', `cluster ${k.id}: not set aside for the full check (${k.why}); its edits stay in the working tree and may block the others`);
}

// THE RESTORING COMMAND IS PRINTED (G-13, I-8): the write-back runs first on any invocation of this run, so a retry
// that commits nothing new restores the bytes.
const writeBackFailure = (failed, dirName) => `could not write back ${failed.map((f) => `${f.path} (${f.why})`).join(', ')}, set aside for the full check; their bytes are kept under ${dirName} in the run directory, and this command writes them back once the cause is fixed:\n  node ${printedArg(path.join(FRAMEWORK.scriptsDir, 'remediate.mjs'))} --repo-root ${printedArg(repo)} --run-dir ${printedArg(runDir)} --retry-commits`;

// ONE OWNER of the write-back after the commits, for a first run and a retry alike (G-16): it was two identical closures.
// Registered to run on die too (G-10), so a refusal that exits through process.exit still writes the files back.
function setAsideFinisher(aside, check, save) {
  const finish = () => {
    if (!aside.record) return;
    const dirName = aside.record.dir.join('/');
    const failed = writeBackSetAside(setAsideCaps, dirName);
    aside.record = null;
    if (failed.length) { check(null, 'set-aside-unrestored', writeBackFailure(failed, dirName)); save(); die(writeBackFailure(failed, dirName)); }
  };
  atDie.push(finish);
  return finish;
}
// The --test-path-states and --test-edit-after-classify seams are gone (runner-test-seam.plan.md stage 2): pathState's rows and
// the same-size edit are tests that import scripts/io/set-aside.mjs and run it.

/**
 * Commit one admitted cluster's accepted files: the ONE commit path, for a first run and a retry alike. Returns
 * { commit } or { commit: null, kind, reason, output }. The consumer's hooks always run; nothing passes --no-verify.
 */
// A git command's raw output goes to the run's evidence, never into the tracked run.json, which names the file (G-10 of
// 20261009-014530-remediation-paths-r2). In the runner's folder (D1), named by the cluster and the first free attempt;
// `wx` refuses to overwrite. Returns the path relative to the run.
function runnerLog(clusterId, text) {
  if (args.testFailRunnerLog) throw Object.assign(new Error('test seam: runner log refused'), { code: 'EACCES' });
  const stem = `commit-${String(clusterId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)}`;
  const k = firstFree((n) => !owner.isFree(runnerSegs(`${stem}-${n}.log`)));
  owner.create(runnerSegs(`${stem}-${k}.log`), text);   // exclusive, as `wx` was
  return path.relative(runDir, runnerPath(`${stem}-${k}.log`)).split(path.sep).join('/');
}

/**
 * THE RUN STOPS ON AN UNRECORDED COMMIT, after it is saved (design decision 2). The caller has already saved the cluster
 * as `unrecorded`; the raw output then goes to the runner's log, best effort and saved again if written; then the run
 * exits 1 with the operator's next steps. No follow-up is minted for it (decision 3).
 */
function stopOnUnrecorded(record, result, save, checks) {
  try {
    const output = runnerLog(record.id, result.raw);
    record.output = output;
    const entry = [...checks].reverse().find((e) => e.cluster === record.id && e.kind === 'commit-unrecorded');
    if (entry) entry.output = output;
    save();
  } catch (err) {
    // The record is saved already; only the raw output is lost, and that is NAMED, not swallowed (G-10 of
    // 20261108-043341-si-remediation-5-review-b): it was the only copy of the commit's and rev-parse's diagnostics.
    console.error(`remediate: could not keep the raw output of cluster ${record.id} in the runner's log (${err?.code ?? err?.message ?? err}); the commit and rev-parse diagnostics are lost`);
  }
  die(`cluster ${record.id}: ${result.reason}. The run is saved. Find the commit with git log ${printedArg(`${run.remediation_start ?? readRun(runDir).remediation_start}..HEAD`)}, `
    + `then mint its follow-up review by hand: node ${printedArg(path.join(FRAMEWORK.scriptsDir, 'new-run.mjs'))} --repo-root ${printedArg(repo)} --base `
    + `${printedArg(String(readRun(runDir).remediation_start))} --follows-remediation ${printedArg(runDir)}`, 1);
}

// THE COMMIT'S SUBJECT: run id, the reconciler-shaped group ids and the cluster's number in the plan. It is how a later
// invocation finds a commit that landed before the run could save it (G-9 of 20261011-031727-commit-recovery-design-review)
// — in the subject, not a runner-added trailer: trailers are the operator's (the request's non-goal; G-4 of
// 20261011-044155-commit-recovery-design-r4, operator 2026-10-11: "Move it into the subject").
const commitHeader = (runId, groups, seq) => `remediation ${runId}: ${(groups ?? []).filter(isGroupId).join(', ') || 'no group id of the reconciler\'s shape'}`
  + (seq ? ` (cluster ${seq})` : '');

function commitCluster(c, withTrailers = trailers) {
  // NO MODEL PROSE IN GIT HISTORY (G-7 of 20261008-225754-remediate-rebuild-r4): the cluster label and group ids are
  // the node's free-form strings. The message carries the run ids, only group ids of the reconciler's shape (the
  // shape's one owner, isGroupId), the cluster's sequence number in the plan, and the operator's trailers; the node's
  // label stays in run.json's `clusters`.
  const message = `${commitHeader(run.run_id, c.groups, c.seq)}\n\n`
    + `Remediates: ${run.remediates}\n${withTrailers.map((t) => `${t}\n`).join('')}`;
  const added = lit('add', '--', ...c.accepted);
  const committed = added.status === 0 ? lit('commit', '--only', '-m', message, '--', ...c.accepted) : added;
  if (committed.status === 0 && args.testDieAfterCommit === c.id) killedHere(`test seam: exit as the commit of ${c.id} landed`);
  if (committed.status === 0) {
    // A COMMIT WHOSE SHA CANNOT BE READ is returned as `unrecorded`, with nothing written yet: the caller saves the run
    // FIRST and then stops (remediation-commit-recovery.design.md, operator 2026-10-11: "Save first, then stop"). Three
    // reviews running found a new hole in each attempt to recover from this inside the run.
    const head = args.testFailRevParse ? { status: 128, stdout: '', stderr: 'test seam: rev-parse failed' } : git('rev-parse', 'HEAD');
    if (head.status === 0 && head.stdout.trim()) return { commit: head.stdout.trim() };
    return { commit: null, kind: 'commit-unrecorded', unrecorded: true, raw: [committed.stdout ?? '', `rev-parse: ${head.stderr ?? ''}`].join('\n'),
      reason: 'the commit landed, but git rev-parse HEAD failed, so its sha is not recorded; find it in git log, and do not retry this cluster' };
  }
  // Unstage what this call staged — exact, because no accepted file was changed before the remediation began — and
  // CHECK it (G-7 of 20261008-225754-remediate-rebuild-r4): a failed reset is recorded as such.
  const reset = args.testFailReset ? { status: 1, stderr: 'test seam: reset forced to fail' } : lit('reset', '-q', '--', ...c.accepted);
  // The log is best effort: a write that fails must not throw before the caller saves (G-11 of
  // 20261011-031727-commit-recovery-design-review).
  let output = null;
  try { output = runnerLog(c.id, [committed.stdout ?? '', committed.stderr ?? '', reset.status === 0 ? '' : `reset: ${reset.stderr ?? ''}`].join('\n')); } catch { /* named below */ }
  const where = output ? `output: ${output}` : 'its output could not be written to the runner\'s log';
  return {
    commit: null, ...(output ? { output } : {}), kind: reset.status === 0 ? 'hook-rejected' : 'reset-failed',
    reason: reset.status === 0
      ? `the commit was refused (${where}); its changes are left unstaged in the working tree`
      : `the commit was refused AND unstaging failed (${where}); the index holds the cluster's files staged`,
  };
}

/**
 * RESOLVE CLUSTERS LEFT `attempting` (G-9, G-8 of 20261011-031727-commit-recovery-design-review). A run killed between a
 * commit landing and the save that records it leaves the cluster `attempting`. The commit is its own record: its subject
 * (this run's id, the groups, and the cluster's number when it has one), in `remediation_start..HEAD`. Found: the
 * cluster is committed with that sha. Not found: the commit never landed, and the cluster stays pending. Mutates `r`,
 * and returns the patch of the run fields it changed, or null: the function that changes them names them, so a caller
 * cannot leave one out (recovery-save-owner.plan.md, RS-D1 A; G-6, G-9 of 20261023-081135-rer-remediation-3-review).
 */
function resolveAttempts(r) {
  const open = (r.clusters ?? []).filter((c) => c.attempting);
  if (!open.length) return null;
  const changed = new Set(['clusters']);
  const log = git('log', '--format=%H%x1f%B%x1e', `${r.remediation_start}..HEAD`);
  if (log.status !== 0) die(`git log failed, so a commit that may have landed for ${open.map((c) => c.id).join(', ')} cannot be looked up: ${String(log.stderr ?? '').trim()}`);
  const entries = log.stdout.split('\x1e').map((s) => s.trim()).filter(Boolean).map((e) => {
    const [sha, body = ''] = e.split('\x1f');
    return { sha: sha.trim(), body: body.replace(/^\s+/, '') };
  });
  for (const c of open) {
    const header = commitHeader(r.run_id, c.groups, c.seq);
    const hit = entries.find((e) => e.body.split('\n')[0] === header);
    const fromRetry = c.attempting === 'retry';
    delete c.attempting;
    if (hit) {
      c.commit = hit.sha;
      c.pending_retry = false;
      delete c.reason; delete c.output;
      r.remediation_commits = [...new Set([...(r.remediation_commits ?? []), hit.sha])];
      changed.add('remediation_commits');
    } else if (Array.isArray(r.commit_check)) {   // G-5: it never landed
      withdrawEvidenceExceptions(r.commit_check, c.id);
      changed.add('commit_check');
    }
    // A RETRY'S ATTEMPT gets the cluster it lost to the kill, in its own commit_retries entry (G-5 of
    // 20261011-034854-commit-recovery-design-r2): the latest attempt, the one that was running.
    const last = fromRetry ? (r.commit_retries ?? []).at(-1) : null;
    if (last && !last.clusters.some((x) => x.id === c.id)) {
      last.clusters.push(hit ? { id: c.id, commit: hit.sha, resolved_from: 'git log' }
        : { id: c.id, commit: null, reason: 'the run stopped during this attempt and no commit for it is in git log' });
      changed.add('commit_retries');
    }
  }
  return Object.fromEntries([...changed].map((k) => [k, r[k]]));
}

/**
 * --readmit-evidence (operator, 2026-11-03: "b"): the first run's own two planning steps, admitGroups then
 * planClusterCommits, over the same report and captures, judged by the gate as it stands now. readmissionDecision decides
 * whether the run qualifies. The clusters are recorded pending, so the retry below re-plans, checks and commits them as
 * any pending cluster. The files are git's answer now: what the node left in the tree is not re-hashed against its run
 * (no record of it exists for a run whose full check never ran), so an edit made to them since is committed as found.
 */
function readmitEvidenceRefused() {
  let payload = null;
  try { payload = JSON.parse(owner.read(['evidence', 'remediation', 'payload.json'])); } catch { /* below */ }
  payload = normalReport(payload);
  if (!Array.isArray(payload?.groups)) die('--readmit-evidence: the report of the node (evidence/remediation/payload.json) cannot be read');
  let confirmed = null;
  const symptoms = {};
  let severity = {};
  try {
    const reconciled = reviewedJson('evidence', 'reconcile', 'payload.json').groups ?? [];
    severity = Object.fromEntries(reconciled.map((g) => [g.group_id, g.severity]));
    confirmed = confirmedGroupIds({ groups: reconciled });
    for (const g of reconciled) if (g.decision === 'symptom' && typeof g.root_cause_group === 'string') symptoms[g.group_id] = g.root_cause_group;
  } catch (e) { die(`--readmit-evidence: the reviewed run's reconcile payload cannot be read, so the confirmed set is unknown: ${e.message}`); }
  const deferredSet = new Set(Array.isArray(frame?.groups) ? frame.deferred ?? [] : []);
  const deferredFindingFiles = {};
  if (deferredSet.size) {
    try {
      for (const g of reviewedJson('finding-groups.json').groups ?? []) if (deferredSet.has(g.group_id) && g.file) (deferredFindingFiles[g.group_id] ??= []).push(g.file);
    } catch (e) { die(`--readmit-evidence: the reviewed run's finding-groups.json cannot be read, so the deferred-file overlap cannot be checked: ${e.message}`); }
  }
  refuseOnEvidenceChange('--readmit-evidence', payload.groups);
  const evidence = captureFacts(runDir, evidencePathsOf(payload.groups));
  const admitted = admitGroups({ groups: payload.groups, confirmed, deferred: [...deferredSet], symptoms, deferredFindingFiles, evidence, contract,
    caseInsensitive: CASE_INSENSITIVE });
  const decision = readmissionDecision({ run, nowChecks: admitted.checks });
  if (decision.why) die(`--readmit-evidence: ${run.run_id} cannot be re-admitted: ${decision.why}`);
  const now = git('status', '--porcelain=v2', '-z', '--untracked-files=all');
  if (now.status !== 0) die(`git status failed, so nothing can be re-planned: ${now.stderr.trim()}`);
  const plan = planClusterCommits({
    groups: admitted.plannable, status: statusEntriesV2(now.stdout), dirtyAtStart: run.dirty_at_start?.files ?? [], refusedAtStart: run.dirty_at_start?.refused ?? [],
    contract, severityOf: (id) => severity[id], confirmed, symptoms, reviewedFiles: reviewedFilesOf(), caseInsensitive: CASE_INSENSITIVE,
  });
  if (!plan.some((c) => c.committable)) die(`--readmit-evidence: the gate now admits ${decision.readmitted.join(', ')}, but no cluster planned from them can be committed: ${plan.flatMap((c) => c.notes).join('; ') || 'none planned'}`);
  const clusters = plan.map((c, i) => ({ id: c.id, merged_from: c.merged_from, groups: c.groups, accepted: c.accepted, refused: c.refused,
    notes: c.notes, commit: null, seq: i + 1, readmitted: true, ...(c.committable ? { pending_retry: true } : {}) }));
  const checks = [...(run.commit_check ?? []), { cluster: null, kind: 'readmitted',
    message: `re-admitted by --readmit-evidence: ${decision.readmitted.join(', ')}, refused by the evidence gate on the first run, admitted by it now; clusters ${clusters.map((c) => c.id).join(', ')} planned`,
    groups: decision.readmitted }];
  saveRun({ clusters, commit_check: checks });
  Object.assign(run, readRun(runDir));
  console.error(`remediate: --readmit-evidence: ${decision.readmitted.join(', ')} re-admitted; ${clusters.filter((c) => c.pending_retry).length} cluster(s) pending for this retry`);
}

// A SET-ASIDE LEFT BY A KILLED RUN is written back before anything is planned (remediation-cluster-order.plan.md stage 1).
// A record with no entries is a kill while copying (G-14): its write-back removes the partial copies.
// Read through lib's one reader, which also reads the record 85f45c55 wrote (G-5 of 20261107-191838-co-remediation-review).
const pendingSetAside = setAsideRecovery(run);
if (pendingSetAside) {
  const failed = writeBackSetAside(setAsideCaps, pendingSetAside.dir);
  if (failed.length) {
    // RECORDED, as finishSetAside records it (I-8): the kind and its stamp, not only the message. The stamp is the kind's
    // owner's answer (G-6 of 20261107-191838-co-remediation-review), never a second copy of it.
    const message = writeBackFailure(failed, pendingSetAside.dir);
    const entry = { cluster: null, kind: 'set-aside-unrestored', message };
    saveRun({ commit_check: [...(run.commit_check ?? []), entry],
      stamps: commitCheckStamps([entry]) ? [...new Set([...(run.stamps ?? []), COMMIT_CHECK_STAMP])] : (run.stamps ?? []) });
    die(message);
  }
  console.error(`remediate: wrote back the files a previous run set aside for its full check (${pendingSetAside.paths.join(', ')})`);
  Object.assign(run, readRun(runDir));
}

if (args.retryCommits) {
  // ------------------------------------------------------------------------- a retry of refused commits (no node)
  if (!run.remediation_commits) die('--retry-commits: this run has not been run yet; run it without --retry-commits first');
  // A commit that landed before its save is found first, so it is never committed twice (G-9 of the design review).
  const recovered = resolveAttempts(run);
  if (recovered) saveRun(recovered);
  if (args.readmitEvidence) readmitEvidenceRefused();
  const retryable = (run.clusters ?? []).filter((c) => isPending(c, run));
  // ONLY A RECOVERY, nothing left to retry: on to the follow-up, which the recovered commit needs (G-6 of
  // 20261011-034854-commit-recovery-design-r2). Neither: there is nothing for --retry-commits to do.
  // An unrecorded cluster is not retried, and the follow-up section below prints its manual recovery (G-4 of
  // 20261011-041804-commit-recovery-design-r3).
  const unrecordedLeft = (run.clusters ?? []).some((c) => c.unrecorded);
  // THE EVIDENCE RECORD FIRST, when nothing would be retried (G-15 of 20261103-234542-gre-delivery): a missing or changed
  // record was never named, because "no cluster to retry" short-circuited the comparison below. --readmit-evidence has
  // compared it already.
  if (!retryable.length && !recovered && !unrecordedLeft && !args.readmitEvidence) {
    // AN UNREADABLE REPORT IS NAMED TOO (G-9 of 20261104-004602-gre-remediation-review): swallowed, it fell through to "no
    // cluster to retry", and the evidence the comparison needs went unnamed.
    let report = null; let why = null;
    try { report = JSON.parse(owner.read(['evidence', 'remediation', 'payload.json'])); } catch (e) { why = e.code ?? e.message; }
    if (!Array.isArray(report?.groups)) {
      die(`--retry-commits: refused, nothing is planned or committed: the node's report (evidence/remediation/payload.json) cannot be read (${why ?? 'no groups list'}), so the evidence record cannot be compared (grounding-and-retry-evidence.plan.md stage 2)`);
    }
    refuseOnEvidenceChange('--retry-commits', normalReport(report).groups);
  }
  if (!retryable.length && !recovered && !unrecordedLeft) die('--retry-commits: no cluster to retry — none is pending (refused by git, a hook, the full check, or a tree that was not the candidate)');
  if (retryable.length) {
  // RE-PLANNED BY THE ONE PLANNER (G-6 of 20261011-003134-commit-recovery-review): the retried clusters' reported groups,
  // from the node's saved report, against git's answer NOW — so every file rule a first run applies (changed, not dirty
  // at the start, not inside a repository, source or test, a test present) applies again, by the same code.
  let saved = null;
  try { saved = JSON.parse(owner.read(['evidence', 'remediation', 'payload.json'])); } catch { /* below */ }
  saved = normalReport(saved);
  if (!Array.isArray(saved?.groups)) die('--retry-commits: the node\'s report (evidence/remediation/payload.json) cannot be read, so the clusters cannot be re-planned');
  const now = git('status', '--porcelain=v2', '-z', '--untracked-files=all');
  if (now.status !== 0) die(`git status failed, so the files cannot be re-checked; nothing is committed: ${now.stderr.trim()}`);
  let severity = {};
  // The symptom links the first run planned by, so a symptom joined to its root is re-planned as one cluster (G-4 of
  // 20261015-022849-symptom-remediation-review).
  let confirmed = null;
  const symptoms = {};
  try {
    const reconciled = reviewedJson('evidence', 'reconcile', 'payload.json').groups ?? [];
    severity = Object.fromEntries(reconciled.map((g) => [g.group_id, g.severity]));
    confirmed = confirmedGroupIds({ groups: reconciled });
    for (const g of reconciled) if (g.decision === 'symptom' && typeof g.root_cause_group === 'string') symptoms[g.group_id] = g.root_cause_group;
  } catch { /* severity only orders the clusters; without the links a joined cluster re-plans as two and is refused */ }
  const attempt = { at: new Date().toISOString(), trailers, clusters: [] };
  // EVERY CLUSTER COMMIT THE RUN MAKES carries the run's trailers (G-6, G-10 of 20261011-011857-commit-recovery-r3): the
  // first run's, then this retry's, in order and without repeats, recorded back as the run's commit_trailers.
  const runTrailers = [...new Set([...(run.commit_trailers ?? []), ...trailers])];
  const clusters = (run.clusters ?? []).map((c) => ({ ...c }));
  const commits = [...run.remediation_commits];
  const checks = [...(run.commit_check ?? [])];
  const check = (cluster, kind, message, extra = {}) => {
    if (!COMMIT_CHECK_KINDS[kind]) throw new Error(`commit_check kind ${kind} is not in COMMIT_CHECK_KINDS`);
    checks.push({ cluster, kind, message, ...extra });
  };
  const save = () => {
    if (commitCheckStamps(checks)) stamps.add(COMMIT_CHECK_STAMP);
    saveRun({ stamps, clusters, remediation_commits: commits, commit_check: checks, commit_retries: [...(run.commit_retries ?? []), attempt],
      commit_trailers: runTrailers });
  };
  // A REFUSED RETRY STAYS PENDING while its edits are still in the tree (G-7 of 20261011-051153-commit-recovery-design-r5):
  // the follow-up waits until they are committed, or discarded and a retry records them refused.
  // By the path key (G-14 of 20261014-022857-ccb-delivery): a case-only respelling is still the same file.
  const changedNow = statusEntriesV2(now.stdout).files;
  const stillChanged = (c) => anyStillChanged(c.accepted, changedNow, { caseInsensitive: CASE_INSENSITIVE });
  const toRetry = clusters.filter((x) => retryable.some((r) => r.id === x.id));
  // THE RECORDED ACCEPTED FILES ARE THE ONES RETRIED (G-8 of 20261011-011857-commit-recovery-r3): a re-plan that accepts a
  // different set — a report edited since, a file changed since — is refused, never committed. And the recorded GROUPS
  // (G-4 of 20261015-025724-symptom-remediation-2-review): a group the gate drops can leave the paths unchanged.
  // The evidence gate on the retry's re-plan too (stage 5): the same captures, read again.
  refuseOnEvidenceChange('--retry-commits', saved.groups);
  const retryEvidence = captureFacts(runDir, evidencePathsOf(saved.groups));
  const plans = new Map(toRetry.map((c) => {
    const planned = planClusterCommits({
      groups: saved.groups.filter((g) => c.groups.includes(g.group_id)), status: statusEntriesV2(now.stdout),
      dirtyAtStart: run.dirty_at_start?.files ?? [], refusedAtStart: run.dirty_at_start?.refused ?? [], contract, severityOf: (id) => severity[id],
      evidence: retryEvidence, confirmed, symptoms, reviewedFiles: reviewedFilesOf(), caseInsensitive: CASE_INSENSITIVE,
    });
    const p = planned.length === 1 ? planned[0] : null;
    // THE FILES A REPAIR PASS ADDED (remediation-repair-pass.plan.md stage 3): recorded on the cluster, not in the node's
    // report, so the re-plan adds them back, each by the same file rule, and matches the recorded accepted files again.
    if (p && (c.repair_added ?? []).length) {
      const rule = clusterFileRule({ status: statusEntriesV2(now.stdout), dirtyAtStart: run.dirty_at_start?.files ?? [],
        refusedAtStart: run.dirty_at_start?.refused ?? [], contract, caseInsensitive: CASE_INSENSITIVE });
      for (const added of c.repair_added) {
        const { path: at, reason } = rule(added);
        if (reason) { p.refused.push({ path: at, reason }); p.committable = false; } else if (!p.accepted.includes(at)) p.accepted.push(at);
      }
    }
    return [c.id, p];
  }));
  // THE RETRY'S CANDIDATE is the union of the clusters it may commit, re-planned on the current HEAD and checked ONCE
  // before the loop (remediation-verification stage 4).
  noteOwnRefused((run.clusters ?? []).filter((c) => !c.commit));
  const retryCandidate = toRetry.map((c) => [c, plans.get(c.id)]).filter(([c, p]) => p && p.committable && !retryMismatch(p, c));
  // A re-plan the retry rules not committable is set aside too (remediation-cluster-order.plan.md stage 1).
  const aside = { kept: [], record: null };
  const finishSetAside = setAsideFinisher(aside, check, save);
  // INSIDE THE try (G-8 of 20261108-065111-si-remediation-7-review, I-11): a throw once paths are put back still writes them back.
  try {
  if (retryCandidate.length) setAsideForCheck(aside, [...plans.values()].filter(Boolean), check);
  let { refusal: fullRefusal, state: checked } = retryCandidate.length
    ? await fullCheck(retryCandidate.flatMap(([, p]) => p.accepted)) : { refusal: null, state: null };
  // --repair (stage 3): the retried candidate's refusal goes back to the node first. A file a pass admits joins both the
  // re-plan and the recorded cluster, so the comparison below still holds them equal.
  if (args.repair && fullRefusal && retryCandidate.length) {
    ({ refusal: fullRefusal, state: checked } = await repairPasses({
      targets: retryCandidate.map(([c, p]) => ({ id: c.id, accepted: p.accepted, record: c })),
      refusal: fullRefusal, state: checked, cap: nodeLimits().repairCap, persist: save }));
  }
  if (args.measureOnly) { finishSetAside(); endMeasureOnly(fullRefusal, save); }
  let blocked = fullRefusal;
  const own = [];   // this retry's commits: HEAD may advance by these alone (a retry records its own HEAD at its own check)
  setLockPhase('committing');
  // Each retried cluster's position, looked up once (G-5 of 20261104-020352-gre-remediation-2-review): an indexOf per
  // candidate inside the per-cluster filter made the suffix selection cubic in the clusters. Absent is undefined, which,
  // as indexOf's -1 did, is never >= i.
  const retryAt = new Map(toRetry.map((x, j) => [x, j]));
  for (const [i, c] of toRetry.entries()) {
    const label = `cluster ${c.id} (${c.groups.join(', ')})`;
    const p = plans.get(c.id);
    const mismatch = p && p.committable ? retryMismatch(p, c) : null;
    const inCandidate = p && p.committable && !mismatch;
    // Only the clusters IN the checked candidate are re-hashed (G-10 of 20261014-000825-rv-delivery-remediation-2-review):
    // a re-plan excluded from it was never hashed, so comparing its files would name a mismatch nothing checked.
    if (inCandidate && !blocked && checked) {
      blocked = recheck(checked, own, retryCandidate.filter(([x]) => retryAt.get(x) >= i).flatMap(([, x]) => x.accepted));
    }
    let result;
    // Whether the formatter turned red is the latest attempt's too, so a retry refused otherwise drops it (G-3 of
    // 20261017-212703-fmt-remediation-2-review); the full-check branch below records it again.
    delete c.fmt_turned_red;
    if (mismatch) {
      // A FIX OUTSIDE THE RECORDED FILES cannot be accepted here (remediation-verification stage 4): it was never checked;
      // nor one whose recorded group no longer passes its evidence gate (G-4).
      result = { commit: null, reason: `not retried: ${mismatch}; its changes are left in the working tree for the operator — to start over, discard them and mint a new remediation run` };
      check(c.id, 'refused-cluster', `${label}: ${result.reason}`);
      c.pending_retry = stillChanged(c);
    } else if (p && p.committable && blocked) {
      result = { commit: null, reason: `not retried: ${blocked.message}; its changes are left in the working tree` };
      check(c.id, blocked.kind, `${label}: ${result.reason}`);
      c.pending_retry = true;
      if (blocked.fmt_turned_red) c.fmt_turned_red = true;
    } else if (!p || !p.committable) {
      for (const r of p?.refused ?? []) check(c.id, 'refused-file', `${label}: ${r.path} refused — ${r.reason}`);
      const why = !p ? 'its groups no longer plan as one cluster'
        : p.refused.length ? `${p.refused.map((r) => r.path).join(', ')} refused` : p.notes.join('; ');
      result = { commit: null, reason: `not retried (${why}); its changes are left in the working tree for the operator` };
      check(c.id, 'refused-cluster', `${label}: ${result.reason}`);
      c.pending_retry = stillChanged(c);
    } else {
      // 'retry': a resolution of this attempt writes the cluster into this retry's commit_retries entry (G-5).
      c.attempting = 'retry';
      // A first run that recorded them before its own attempt is not recorded twice (G-8 of 20261023-044746-rer-delivery).
      if (!checks.some((x) => x.cluster === c.id && (x.kind === 'declared-no-red' || x.kind === 'committed-without-test'))) {
        recordEvidenceExceptions(check, p, label, c.id);
      }
      save();
      result = commitCluster({ ...c, accepted: p.accepted }, runTrailers);
      delete c.attempting;
      if (!result.commit) {
        if (!result.unrecorded) withdrawEvidenceExceptions(checks, c.id);
        check(c.id, result.kind, `${label}: ${result.reason}`, result.output ? { output: result.output } : {});
        c.pending_retry = Boolean(COMMIT_CHECK_KINDS[result.kind]?.retryable);
        if (result.unrecorded) c.unrecorded = true;
      } else {
        c.pending_retry = false;
        own.push(result.commit);
        const differs = checked ? committedDiffers(checked, p.accepted) : [];
        if (differs.length) check(c.id, 'committed-differs', `${label}: committed, but ${differs.join('; ')} — something, such as a hook, changed it after the check`);
      }
    }
    // THE CLUSTER SAYS WHAT ITS LATEST ATTEMPT DID (G-8): a failed retry's reason and output replace the first's.
    if (result.commit) { c.commit = result.commit; c.accepted = p.accepted; delete c.reason; delete c.output; commits.push(result.commit); }
    else { c.reason = result.reason; if (result.output) c.output = result.output; else delete c.output; }
    attempt.clusters.push({ id: c.id, commit: result.commit, ...(result.reason ? { reason: result.reason } : {}) });
    // SAVED AFTER EACH ATTEMPT, as on a first run (design decision 1); an unrecorded commit then stops the run (decision 2).
    save();
    if (result.unrecorded) stopOnUnrecorded(c, result, save, checks);
  }
  } finally { finishSetAside(); }
  setLockPhase('saved');
  }
}

if (!run.remediation_commits) {
  // ----------------------------------------------------------------------------------------- 2. the round cap
  // A follow-up review found a MEDIUM in the previous remediation's OWN fixes when the line a confirmed MEDIUM+ group
  // cites was last changed by one of that remediation's commits — `git blame`, a proxy (shared/remediation.md). A record
  // that cannot be read, or a blame that fails, is UNKNOWN (null), never "no MEDIUM" (G-13).
  const ownMedium = (followup, remediation) => {
    const commits = new Set(remediation.remediation_commits ?? []);
    let groups;
    let decided;
    try {
      // Through the owner of the directory the chain scan admitted (run-dir-reads.plan.md stage 4).
      const followupOwner = confined(followup.run_dir);
      groups = JSON.parse(followupOwner.read(['finding-groups.json'])).groups ?? [];
      decided = JSON.parse(followupOwner.read(['evidence', 'reconcile', 'payload.json'])).groups ?? [];
    } catch { return null; }
    const at = Object.fromEntries(groups.map((g) => [g.group_id, g]));
    for (const d of decided) {
      if (d.decision !== 'confirmed' || !['BLOCKER', 'HIGH', 'MEDIUM'].includes(d.severity)) continue;
      const g = at[d.group_id];
      // A confirmed MEDIUM+ the chain cannot place in a file and line is UNKNOWN, not "no MEDIUM" (G-12 of the r2 review).
      if (!g?.file || !(Number(g.line) > 0)) return null;
      const b = git('blame', '--porcelain', '-L', `${g.line},${g.line}`, followup.head_commit ?? 'HEAD', '--', g.file);
      if (b.status !== 0) return null;
      if (commits.has(b.stdout.split(/\s/)[0])) return true;
    }
    return false;
  };
  // A RUN THAT MOVED IS FOUND BY ITS NAME under this repository's run roots: a link stores the path a run had when it was
  // recorded, and a remediation is archived after its follow-up names it staged (story-pipeline, 2026-10-15).
  const runRoots = repoRunRoots({ repoRoot: repo, project: contract.project ?? null, declaredReviewsDir: review.reviews_dir ?? null });
  // Only the linked run itself is followed: lib's resolveLinkedRun checks the run_id (G-9 of 20261015-220413-archive-fold-review).
  // Each place it looks is ADMITTED by the one owner for this repository (ARCHITECTURE A-28; run-dir-trust.plan.md stage 3):
  // the recorded path, the last resort, was read with no containment at all.
  // AND READ THROUGH THE DIRECTORY IT ADMITTED (G-13 of 20261023-040306-rdt-remediation-2-review): returning only the
  // record put the candidate's spelling back as run_dir, so the round-cap scan reread a path a link could retarget.
  const admit = (dir) => admitRun({ runDir: dir, repoRoot: repo });
  const readRunWithDir = (dir, runId = null) => resolveLinkedRun({ dir, runId, roots: runRoots, admit, join: path.join, basename: path.basename });
  const { links, unknown } = walkChain({ reviewedDir: reviewedDir(), readRun: readRunWithDir, ownMedium });
  if (unknown) {
    stamps.add('CHAIN-UNKNOWN');
    saveRun({ stamps, chain_unknown: unknown });
    die(`cannot establish the round count: ${unknown}. Nothing was spawned; repair or name the missing run, or have the `
      + 'operator decide (shared/remediation.md, Round cap).', 5);
  }
  const cap = roundCapState(links.map((l) => l.own_medium));
  if (cap.capped) {
    stamps.add('ROUND-CAP');
    saveRun({ stamps, round_cap: { consecutive: cap.consecutive, chain: links } });
    // AND ON THE REMEDIATION WHOSE OWN FIX REACHED IT (G-15): the third is where the cap was met; this run is where it
    // was found.
    const last = links[links.length - 1];
    const lastRun = last?.remediation_dir ? readRun(last.remediation_dir) : null;
    // Its own stamp, because that run DID spawn and patch, and ROUND-CAP says nothing was spawned (G-26 of the r2 review).
    if (lastRun) saveRun({ stamps: [...new Set([...(lastRun.stamps ?? []), 'ROUND-CAP-REACHED'])] }, last.remediation_dir);
    die(`round cap reached: ${cap.consecutive} consecutive remediations (cap ${ROUND_CAP}) drew a new MEDIUM in their own `
      + 'fixes — stop patching and run a design step (shared/design-step.md). Nothing was spawned.', 4);
  }

  // CHAIN-BROKEN: the previous remediation in this repository minted a follow-up review, and this remediation works from
  // a different review. The count restarts, as shared/remediation.md says, and the stamp keeps that visible.
  const reviewed = readRun(reviewedDir()) ?? {};
  if (!reviewed.follows_remediation) {
    const roots = [...new Set([path.dirname(runDir), run.archive_to].filter(Boolean))];
    let last = null;
    // AN INCOMPLETE CENSUS IS NAMED (G-12 of 20261105-163851-crsf-d1-review): every listing error read as an empty root,
    // and a link child was skipped as not a directory, so CHAIN-BROKEN could be suppressed with no warning. Only ENOENT is
    // absence; any other error, and a link child (never followed), is named on stderr below.
    const censusUnread = [];
    for (const root of roots) {
      let entries = [];
      // THROUGH THE OWNER ITS SIBLINGS LIST WITH (link-leaving-owner.plan.md stage 2; archive-run.mjs, telemetry.mjs): a raw
      // readdirSync followed a link standing at a root, so the run.json files beyond it entered the chain census.
      try { entries = ownerBelow(root, rootOf(root, repo)).list([], { withFileTypes: true }); } catch (e) {
        if (e.code !== 'ENOENT') censusUnread.push(`${root} (${e.code ?? e.message})`);
        continue;
      }
      for (const e of entries) {
        if (e.isSymbolicLink()) { censusUnread.push(`${path.join(root, e.name)} (a link, not followed)`); continue; }
        if (!e.isDirectory()) continue;
        // ADMITTED BEFORE IT IS READ (G-16 of 20261029-055946-rdd-remediation-review): a counterfeit directory under a scanned
        // root supplied the run.json fields that decide the chain. One the owner refuses is not a prior run.
        const a = admit(path.join(root, e.name));
        if (!a.ok) continue;
        const r = readRun(a.dir);
        // An admitted run that cannot be reread is named, not skipped (G-12 of 20261105-181450-crsf-d1-remediation-2-review):
        // it may be the newest prior remediation, and leaving it out in silence suppressed CHAIN-BROKEN with no trace.
        if (!r) { censusUnread.push(`${a.dir} (run.json unreadable)`); continue; }
        // The newest kept as the scan goes (G-12 of 20261105-173030-crsf-d1-remediation-review): every one was collected and
        // sorted only to read the last. A tie keeps the later scanned, as the stable sort it replaces did.
        if (r?.remediates && r.run_id !== run.run_id && r.followup_run_id && r.created_at < run.created_at
          && (!last || String(r.created_at).localeCompare(String(last.created_at)) >= 0)) last = r;
      }
    }
    if (censusUnread.length) {
      console.error(`remediate: the CHAIN-BROKEN census is incomplete, so a broken chain may go unstamped: not read `
        + `${censusUnread.join(', ')}`);
    }
    if (last && last.followup_run_id !== frame.run_id) {
      stamps.add('CHAIN-BROKEN');
      saveRun({ stamps, chain_broken: { previous_remediation: last.run_id, its_followup: last.followup_run_id } });
      console.error(`remediate: CHAIN-BROKEN — ${frame.run_id} is not ${last.followup_run_id}, the follow-up ${last.run_id} `
        + 'minted; the round count restarts here (shared/remediation.md, Round cap)');
    }
  }

  // ----------------------------------------------------------------------------------------- 3. the node
  // Its limits, its narrow command and its spawn argv are built once, for this node and a repair pass alike (nodeLimits,
  // nodeBriefLines, nodeSpawnArgv above).
  nodeLimits();
  const { capture_cmd: captureCmd, test_one: testOneLine, limits: limitsLine } = nodeBriefLines();
  const brief = renderTemplate(readTemplate('remediate-brief.md'), {
    run_id: run.run_id,
    remediates: run.remediates,
    doctrine_path: repoRel(path.join(FRAMEWORK.frameworkRoot, 'shared', 'disk-first-protocol.md')),
    remediation_doctrine: repoRel(path.join(FRAMEWORK.frameworkRoot, 'shared', 'remediation.md')),
    reconciled_md: path.join(reviewedDir(), 'reconciled.md'),   // the admitted run's, not the recorded path (stage 3)
    // THE OPERATOR'S SCOPE (remediation-group-scope.md): a run minted with --groups works on those groups only, and the
    // rest are deferred by the operator, quoted, so the node neither fixes nor reports them.
    work_list: Array.isArray(frame.groups)
      ? briefLine('remediation-work-list.md', { groups: frame.groups.join(', '), quote: redactClaim(frame.scope_quote),
        deferred: (frame.deferred ?? []).join(', ') || 'none' })
      : 'Work list: every confirmed group in reconciled.md.',
    frame: JSON.stringify({ run_id: frame.run_id, base: frame.base, base_commit: frame.base_commit,
      scope: frame.scope?.paths ?? [], request: frame.request?.path ?? null }),
    capture_cmd: captureCmd,
    test_one: testOneLine,
    limits: limitsLine,
    brief_feedback: '',
  }, 'remediate-brief.md');
  owner.replace(['nodes', 'remediation-brief.md'], brief);

  // Files the operator had changed, staged or not, before the node starts: the runner will not commit them (G-9, G-10).
  // Untracked files too, raw paths (-z), and a git that cannot answer stops the run (G-15 of the r2 review).
  // git's own answer, parsed once (remediation-paths stage 2): the changed files, and the entries that are repositories
  // rather than files — a nested repository or submodule the operator had changed is recorded as such.
  const status = git('status', '--porcelain=v2', '-z', '--untracked-files=all');
  if (status.status !== 0) die(`git status failed, so the files changed before this remediation cannot be recorded: ${status.stderr.trim()}`);
  // ONE OBJECT, both lists (G-10 of 20261009-002459-remediation-paths-review): the changed files and the refused entries.
  const dirtyAtStart = statusEntriesV2(status.stdout);
  // THE TREE GUARD, BEFORE THE NODE (remediation-verification stage 4; operator, 2026-10-13: "Refuse; commit or stash
  // first (Recommended)"). The runner checks its candidate in this working tree, so an operator's edit to a source, test
  // or check-input file would be checked as though the commit carried it. Nothing is a candidate yet, so every such edit
  // refuses here, before anything is spawned. A changed submodule is classified by its path like a tracked file.
  const preNode = treeGuard(dirtyAtStart, new Set());
  if (preNode.length) {
    die(`the working tree has changes the runner's checks would read, and no commit would carry them; commit or stash them first. Nothing was spawned:\n${
      preNode.map((r) => `  ${r.path} — ${r.why}`).join('\n')}`);
  }
  // CHECKED (G-12 of 20261011-053415-commit-recovery-design-r6): stray-commit detection, the git-log recovery range and the
  // printed hand-mint command all start here; a start that cannot be read refuses before the node is spawned.
  const startRead = args.testFailStartHead ? { status: 128, stdout: '', stderr: 'test seam: rev-parse failed' } : git('rev-parse', 'HEAD');
  if (startRead.status !== 0 || !startRead.stdout.trim()) die(`git rev-parse HEAD failed, so where this remediation starts cannot be recorded; nothing was spawned: ${String(startRead.stderr ?? '').trim()}`);
  const startHead = startRead.stdout.trim();
  if (args.unsandboxed) stamps.add('UNSANDBOXED');
  saveRun({ stamps, dirty_at_start: dirtyAtStart, remediation_start: startHead, ...(trailers.length ? { commit_trailers: trailers } : {}),
    unsandboxed: Boolean(args.unsandboxed) });
  // THE FORMATTER BEFORE THE NODE (remediation-fmt-check-baseline.md): fmt_check run once on the tree as it is now, so the
  // full check can tell a failure the node's files caused (refused) from formatting debt already there (stamped). Recorded
  // on the run, so --retry-commits judges against the same baseline. No declared fmt_check, no baseline.
  if (String(contract.commands?.fmt_check ?? '').trim()) {
    const { ran: baseRan } = await runDeclaredChecks({
      runDir, repoRoot: repo, commands: contract.commands, nodeId: 'remediation-runner', timeoutMinutes: checkTimeoutMinutes(contract),
      keys: ['fmt_check'], barrierKeys: new Set(), concurrency: 1, shell: String(contract.commands.shell ?? '').trim(),
      label: 'remediate: fmt_check baseline', envOf: () => candidateCheckEnv(process.env, {}, CANDIDATE_ENV),
    });
    // What capture says beside the exit is recorded too (G-8 of 20261017-215958-fmt-remediation-3-review): a formatter that
    // could not start or timed out exits 124 as capture's, and the record must not read as the formatter's own result.
    const r = baseRan.get('fmt_check');
    const log = r?.evidence_path;
    // Its outcome too (check-outcomes.plan.md stage 2), so a retry reads the baseline as it was decided.
    saveRun({ fmt_baseline: { fmt_check: r ? { exit_code: r.exit_code, evidence_path: log, outcome: r.outcome, outcome_detail: r.outcome_detail,
      timed_out: r.timed_out === true, ...(r.capture_error ? { capture_error: r.capture_error } : {}),
      started_at: r.started_at ?? null, duration_ms: r.duration_ms ?? null } : null } });
  }

  const spawnArgv = nodeSpawnArgv('remediation', 'remediation');
  // A REPORT FROM THIS ATTEMPT ONLY (G-11 of 20261009-002459-remediation-paths-review): an earlier attempt's payload names
  // the same run, so nothing after the spawn could tell it from a fresh one. It is moved aside, kept as evidence — into
  // the runner's folder, not beside the node's new one (D1).
  const payloadPath = path.join(runDir, 'evidence', 'remediation', 'payload.json');
  if (!owner.isFree(['evidence', 'remediation', 'payload.json'])) {
    const n = firstFree((k) => !owner.isFree(runnerSegs(`attempt-${k}`)));
    owner.rename(['evidence', 'remediation', 'payload.json'], runnerSegs(`attempt-${n}`, 'payload.json'));
  }
  console.log(`== remediation node (remediates ${run.remediates})${args.unsandboxed ? ' — UNSANDBOXED' : ''}${replay ? ` — REPLAYED by --replay-node from ${replay.dir}, not spawned` : ''} ==`);
  setLockPhase('node-running');
  const spawned = replay ? installReplay(replay) : spawnSync(process.execPath, spawnArgv, { cwd: repo, stdio: 'inherit', env: { ...process.env, GRAPH_NODE_DEPTH: '0' } });
  setLockPhase('node-ran');
  if (args.testFailAfterNode === 'die') die('test seam: exit after the node ran');
  if (args.testFailAfterNode === 'throw') throw new Error('test seam: throw after the node ran');
  if (spawned.status !== 0) console.error(`remediate: spawn-node exited ${spawned.status}; recording what landed`);

  // ----------------------------------------------------------------------------------------- 4. what landed
  // The node has no way to commit; a commit made since the start anyway is named, never adopted.
  const revList = args.testFailRevList ? { status: 128, stdout: '', stderr: 'test seam: rev-list failed' } : git('rev-list', '--reverse', `${startHead}..HEAD`);
  // Its status checked (G-8 of 20261009-041724-run-ownership-r1): a failure read as "no stray commits" and the runner
  // committed on a HEAD it had not verified.
  if (revList.status !== 0) die(`git rev-list failed, so whether the node committed cannot be told; nothing is committed: ${String(revList.stderr ?? '').trim()}`);
  const strayCommits = revList.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  let payload = null;
  try { payload = JSON.parse(owner.read(['evidence', 'remediation', 'payload.json'])); } catch { /* none */ }
  payload = normalReport(payload);
  // THE REPORT AGAINST WHAT IT WAS GIVEN (G-19, G-25): every group the review confirmed is answered; the report names
  // this run; every evidence path it cites exists inside this run's evidence.
  const reportCheck = [];
  let confirmed = [];
  // Each symptom's root, from the same reconciliation: a symptom reported with its root is admitted as the root's.
  const symptoms = {};
  let confirmedKnown = false;
  try {
    const reconciled = reviewedJson('evidence', 'reconcile', 'payload.json').groups ?? [];
    confirmed = confirmedGroupIds({ groups: reconciled });
    for (const g of reconciled) if (g.decision === 'symptom' && typeof g.root_cause_group === 'string') symptoms[g.group_id] = g.root_cause_group;
    confirmedKnown = true;
  } catch { reportCheck.push('the reviewed run\'s reconcile payload could not be read, so the confirmed set was not compared'); }
  const reported = new Set((payload?.groups ?? []).map((g) => g.group_id));
  // A SCOPED RUN answers for its work list and for nothing the operator deferred (remediation-group-scope.md AC5).
  const deferredSet = new Set(Array.isArray(frame.groups) ? frame.deferred ?? [] : []);
  if (Array.isArray(frame.groups)) {
    for (const id of frame.groups) if (!reported.has(id)) reportCheck.push(`${id}: in the work list, not reported`);
    for (const id of reported) if (deferredSet.has(id)) reportCheck.push(`${id}: deferred by the operator, but reported`);
  } else {
    for (const id of confirmed) if (!reported.has(id)) reportCheck.push(`${id}: confirmed in the review, not reported`);
  }
  if (!payload) reportCheck.push('the node returned no report');
  else if (payload.run_id !== run.run_id) reportCheck.push(`the report names run ${payload.run_id}, not ${run.run_id}`);
  // The REMEDIATION node's own captures (capture.mjs --node remediation), and only regular files (G-9 of
  // 20261009-011732-remediation-paths-r1): a directory, or another node's artifact, is not this fix's evidence.
  // THROUGH THE OWNER (run-dir-reads.plan.md stage 4, R-D3 A): containment was lexical and stat followed links (G-8 of
  // 20261009-014530-remediation-paths-r2), then by real path, which admitted a link resolving back inside the folder.
  // Each level below the run is now walked and a link at any of them refused; only a regular file is evidence. The paths
  // are the normal forms the report's read gave (evidence-path-owner.plan.md stage 2), `evidence/remediation/<name>`.
  const isFile = (p) => {
    try { return owner.stat(String(p).split('/')).isFile(); } catch { return false; }
  };
  for (const g of payload?.groups ?? []) {
    // A FIX WITH NO GREEN is half an experiment (G-22 of the r2 review): the re-check that shows it passes is missing.
    // With no red either, the claim was declared not expressible as a test and there was no experiment to finish: the
    // evidence gate admits it, so it is not a report defect (G-11 of 20261014-000825-rv-delivery-remediation-2-review).
    if (g.disposition === 'fixed' && g.red_evidence && !g.green_evidence) reportCheck.push(`${g.group_id}: fixed with no green_evidence`);
    for (const [k, p] of [...evidencePaths(g.red_evidence).map((q) => ['red_evidence', q]), ...evidencePaths(g.green_evidence).map((q) => ['green_evidence', q])]) {
      if (!p) continue;
      if (g.evidence_path_refused || !isFile(p)) reportCheck.push(`${g.group_id}: ${k} ${p} is not a file in this run's evidence/remediation`);
    }
  }
  // A STOP REASON HELD TO THE NODE'S OWN RECORD (remediation-consumer-findings.plan.md stage 4): the status spawn-node
  // wrote, and the runtime's terminal_reason from the node's envelope. Unreadable means nothing to hold a claim to.
  {
    const nodeRecord = {};
    try {
      const st = JSON.parse(owner.read(['nodes', 'remediation.status.json']));
      Object.assign(nodeRecord, { duration_ms: st.duration_ms, timeout_minutes: st.timeout_minutes, subtype: st.subtype, total_cost_usd: st.total_cost_usd });
      // The reason's field is the runtime adapter's exit.reason_field (G-19 of 20261121-193516-m3s7-b1-review), read as
      // spawn-node reads it; a literal `.terminal_reason` recorded null for a runtime spelling it otherwise.
      if (st.stdout_path) {
        const envelope = JSON.parse(owner.read(String(st.stdout_path).split(/[\\/]/)));
        const reasonField = nodeExitMapping(nodeRuntimeAdapter()).reasonField;
        nodeRecord.terminal_reason = reasonField ? (envelope?.[reasonField] ?? null) : null;
      }
    } catch { /* checked against what was read */ }
    const cap = String(review.budget_usd_per_node ?? '').trim();
    reportCheck.push(...stopReasonChecks(payload?.groups ?? [], nodeRecord, { budgetUsd: cap === '' || !Number.isFinite(Number(cap)) ? null : Number(cap) }));
  }
  // THE RUNNER COMMITS EACH CLUSTER (remediation-paths stages 3+4; design decisions 1-3, operator 2026-10-08). What may
  // be committed is decided by lib's planClusterCommits against git's own answer, taken now; the runner only executes
  // it. Every git call that stages or commits uses LITERAL pathspecs, so a path containing `*`, `?` or `[` names only
  // itself; `commit --only` takes exactly the cluster's paths, so anything the operator had staged stays staged and out.
  // ONE ENTRY SHAPE (G-14 of 20261009-002459-remediation-paths-review): {cluster, kind, message}, plus the fields a kind
  // carries (output; group, disposition, blocked_by, file, deferred from admission), so a reader tells the failure modes
  // apart without parsing prose. `cluster` is null for what belongs to no cluster.
  const commitCheck = [];
  const check = (cluster, kind, message, extra = {}) => {
    if (!COMMIT_CHECK_KINDS[kind]) throw new Error(`commit_check kind ${kind} is not in COMMIT_CHECK_KINDS`);
    commitCheck.push({ cluster, kind, message, ...extra });
  };
  for (const c of strayCommits) check(null, 'stray-commit', `commit ${c} was made during the node's run, not by the runner; it is not adopted`);
  const after = git('status', '--porcelain=v2', '-z', '--untracked-files=all');
  if (after.status !== 0) die(`git status failed after the node exited, so nothing can be committed safely: ${after.stderr.trim()}`);
  let severity = {};
  try {
    severity = Object.fromEntries((reviewedJson('evidence', 'reconcile', 'payload.json').groups ?? [])
      .map((g) => [g.group_id, g.severity]));
  } catch { /* named above in report_check */ }
  // WHAT MAY BE PLANNED (G-11, G-12 of 20261009-002459-remediation-paths-review; G-10 of 20261009-011732-remediation-
  // paths-r1): the pure gate decides from structured facts — the node's exit AND its recorded state, a report naming
  // this run, a known confirmed set — and then only the groups the review confirmed are planned.
  const plannable = [];
  let nodeState = null;
  try { nodeState = JSON.parse(owner.read(['nodes', 'remediation.status.json'])).state ?? null; } catch { /* unknown: refused below */ }
  const refusal = commitGate({ exitStatus: spawned.status, nodeState, confirmedKnown, payloadRunId: payload ? payload.run_id : null, runId: run.run_id });
  if (refusal) check(refusal.cluster, refusal.kind, refusal.message);
  // WHICH GROUPS MAY BE PLANNED is lib's admitGroups (G-3, G-4 of 20261010-200303-group-scope-r2): deferred and
  // unconfirmed groups refused, refusal spread through shared clusters and files, and a committed file that holds a
  // deferred finding noted. Where the deferred findings sit comes from the reviewed run's finding-groups.json.
  if (!refusal) {
    const deferredFindingFiles = {};
    try {
      for (const g of reviewedJson('finding-groups.json').groups ?? []) {
        if (deferredSet.has(g.group_id) && g.file) (deferredFindingFiles[g.group_id] ??= []).push(g.file);
      }
    } catch {
      // SAID, NOT SKIPPED (G-6 of 20261010-204008-group-scope-r3): without the locations the overlap cannot be checked.
      if (deferredSet.size) check(null, 'deferred-file-unchecked', `the reviewed run's finding-groups.json could not be read: the deferred-file overlap was not checked`);
    }
    // THE EVIDENCE GATE (stage 5): the facts each cited capture's header records, read here and judged by lib.
    // THE EVIDENCE RECORD (design GR-D2 A): what the report and every cited capture held when this gate read them, so a retry
    // can tell they are the same.
    saveRun({ evidence_record: evidenceRecordNow(evidencePathsOf(payload?.groups)) });
    const evidence = captureFacts(runDir, evidencePathsOf(payload?.groups));
    const admitted = admitGroups({ groups: payload?.groups ?? [], confirmed, deferred: [...deferredSet], symptoms, deferredFindingFiles, evidence, contract,
      caseInsensitive: CASE_INSENSITIVE });
    plannable.push(...admitted.plannable);
    // The entry's own fields (group, disposition, blocked_by, …) travel with it (G-3 of 20261010-233649-commit-admission-review).
    for (const { kind, message, ...fields } of admitted.checks) check(null, kind, message, fields);
  }
  const plan = planClusterCommits({
    groups: plannable, status: statusEntriesV2(after.stdout), dirtyAtStart: readRun(runDir).dirty_at_start?.files ?? [], refusedAtStart: readRun(runDir).dirty_at_start?.refused ?? [],
    contract, severityOf: (id) => severity[id], confirmed, symptoms, reviewedFiles: reviewedFilesOf(), caseInsensitive: CASE_INSENSITIVE,
  });
  noteOwnRefused(plan);
  // WHAT THE NODE'S RUN LEFT IN THE TREE IS NAMED (remediation-left-in-tree.md): every path changed during it that no
  // planned cluster carries, from git's answer, so a red test a node wrote before it stopped is not left behind unnamed.
  // A submodule or nested repository is in `refused`, not `files`, and is named too (G-6 of 20261017-195046-lit-review).
  const atStart = readRun(runDir).dirty_at_start ?? {};
  const afterNode = statusEntriesV2(after.stdout);
  for (const file of leftInTree({ before: [...(atStart.files ?? []), ...(atStart.refused ?? []).map((r) => r.path)],
    after: [...afterNode.files, ...afterNode.refused.map((r) => r.path)],
    accepted: plan.flatMap((c) => c.accepted), caseInsensitive: CASE_INSENSITIVE })) {
    check(null, 'left-in-tree', `${file} changed during the node's run and no cluster commits it: it is left in the working tree; commit or discard it`, { file });
    console.error(`remediate: ${file} changed during the node's run and is not committed: it is left in the working tree; commit or discard it`);
  }
  const commits = [];
  // EVERY PLANNED CLUSTER IS RECORDED BEFORE THE FIRST COMMIT, and the run is saved after each attempt
  // (remediation-commit-recovery.design.md decision 1): nothing after a landed commit can lose it, and a run killed
  // mid-loop leaves its unattempted clusters pending for --retry-commits.
  const clusters = plan.map((c, i) => ({ id: c.id, merged_from: c.merged_from, groups: c.groups, accepted: c.accepted, refused: c.refused,
    notes: c.notes, commit: null, seq: i + 1, ...(c.committable ? { pending_retry: true } : {}) }));
  const save = () => {
    if (reportCheck.length) stamps.add(REPORT_CHECK_STAMP);
    if (commitCheckStamps(commitCheck)) stamps.add(COMMIT_CHECK_STAMP);   // `merged` alone records, does not stamp (G-13)
    saveRun({ stamps, remediation_commits: commits, clusters, report_check: reportCheck, commit_check: commitCheck,
      commit_trailers: trailers, remediation_state: payload ? 'reported' : 'no-report' });
  };
  save();
  // THE CANDIDATE, CHECKED ONCE before the first commit (remediation-verification stage 4): every committable cluster's
  // files. A refusal is retryable on every one of them.
  const committable = plan.filter((c) => c.committable);
  // A REFUSED CLUSTER IS SET ASIDE for the check and the commits (remediation-cluster-order.plan.md stage 1), and written
  // back after them; one that cannot be (a link, a deletion, …) stays and is named.
  const aside = { kept: [], record: null };
  const finishSetAside = setAsideFinisher(aside, check, save);
  // INSIDE THE try (G-8 of 20261108-065111-si-remediation-7-review, I-11): a throw once paths are put back still writes them back.
  try {
  if (committable.length) setAsideForCheck(aside, plan, check);
  let { refusal: fullRefusal, state: checked } = committable.length
    ? await fullCheck(committable.flatMap((c) => c.accepted)) : { refusal: null, state: null };
  // THE REPAIR PASS (remediation-repair-pass.plan.md stage 2): a refusal on failing tests goes back to the node first.
  // A cluster's plan and its record share one `accepted` list, so a file a pass admits is in both.
  if (fullRefusal && committable.length) {
    ({ refusal: fullRefusal, state: checked } = await repairPasses({
      targets: committable.map((c) => ({ id: c.id, accepted: c.accepted, record: clusters[plan.indexOf(c)] })),
      refusal: fullRefusal, state: checked, cap: nodeLimits().repairCap, persist: save }));
  }
  if (args.measureOnly) { finishSetAside(); endMeasureOnly(fullRefusal, save); }
  let blocked = fullRefusal;
  // COMMITTING, not saved (G-12 of the design review): commits are being made, and one may land before its save.
  setLockPhase('committing');
  for (const [i, c] of plan.entries()) {
    const record = clusters[i];
    const label = `cluster ${c.id} (${c.groups.join(', ')})`;
    if (c.merged_from.length > 1) check(c.id, 'merged', `${label}: clusters ${c.merged_from.join(', ')} shared a file, or held a symptom and its root, and were committed as one`);
    for (const r of c.refused) check(c.id, 'refused-file', `${label}: ${r.path} refused — ${r.reason}`);
    if (!c.committable) {
      record.reason = `not committed (${c.refused.length ? 'a file was refused' : c.notes.join('; ')}); its changes are left in the working tree for the operator`;
      check(c.id, 'refused-cluster', `${label}: ${record.reason}`);
      save();
      continue;
    }
    // RE-CHECKED BEFORE ITS `git add` (stage 4): a refusal here holds for this cluster and every one after it.
    if (!blocked && checked) blocked = recheck(checked, commits, plan.slice(i).filter((x) => x.committable).flatMap((x) => x.accepted));
    if (blocked) {
      record.reason = `not committed: ${blocked.message}; its changes are left in the working tree`;
      record.pending_retry = true;
      // A FIELD, not a sentence to parse (G-3 of 20261017-212703-fmt-remediation-2-review): pendingClusterLines reads it.
      if (blocked.fmt_turned_red) record.fmt_turned_red = true;
      check(c.id, blocked.kind, `${label}: ${record.reason}`);
      save();
      continue;
    }
    recordEvidenceExceptions(check, c, label);
    record.attempting = true;
    save();
    const result = commitCluster({ ...c, seq: record.seq });
    delete record.attempting;
    if (result.commit) {
      record.commit = result.commit;
      record.pending_retry = false;
      commits.push(record.commit);
      const differs = checked ? committedDiffers(checked, c.accepted) : [];
      if (differs.length) check(c.id, 'committed-differs', `${label}: committed, but ${differs.join('; ')} — something, such as a hook, changed it after the check`);
    } else {
      record.reason = result.reason;
      record.pending_retry = Boolean(COMMIT_CHECK_KINDS[result.kind]?.retryable);
      if (result.unrecorded) record.unrecorded = true;
      else { record.output = result.output; withdrawEvidenceExceptions(commitCheck, c.id); }
      check(c.id, result.kind, `${label}: ${record.reason}`, result.output ? { output: result.output } : {});
    }
    save();
    if (args.testDieAfterCluster === c.id) killedHere(`test seam: exit after cluster ${c.id}`);
    if (result.unrecorded) stopOnUnrecorded(record, result, save, commitCheck);
  }
  } finally { finishSetAside(); }
  setLockPhase('saved');
}

// ------------------------------------------------------------------------------------------- 5. the follow-up review
let done = readRun(runDir);
// A commit that landed before the run that made it could save it is found in git log first (G-9 of the design review).
const recovered = resolveAttempts(done);
if (recovered) {
  saveRun(recovered);
  done = readRun(runDir);
}
const commits = done.remediation_commits ?? [];
// NO FOLLOW-UP WHILE A REFUSED CLUSTER IS PENDING (G-3, G-11 of 20261011-003134-commit-recovery-review): a minted follow-up
// closes the run to --retry-commits, and it would review a diff while the refused edits are still in the tree. A pending
// cluster ends when a retry commits it, or when the operator discards its edits and retries, which records it refused.
// WHETHER THE RUN HAS ENDED is lib's remediationEnd, the rule archive-run.mjs applies too (G-11 of
// 20261015-220413-archive-fold-review): it was rebuilt here inline, so the two could disagree about one run.
const end = remediationEnd(done);
const { pending, unrecorded } = end;
if (pending.length) {
  // EACH WITH ITS RECORDED REASON (G-1 of 20261017-210240-fmt-remediation-review): the runner's full check refuses too.
  for (const line of pendingClusterLines(pending)) console.error(`remediate: ${line}`);
  console.error('remediate: no follow-up review is minted until it is resolved. Re-attempt it, without the node, with:');
  console.error(`  node ${printedArg(path.join(FRAMEWORK.scriptsDir, 'remediate.mjs'))} --repo-root ${printedArg(repo)} --run-dir ${printedArg(runDir)} --retry-commits [--commit-trailer "Key: value" ...]`);
  console.error('  To abandon it instead, discard its edits from the working tree and run the same command: it is then recorded refused.');
}
// NO FOLLOW-UP FOR AN UNRECORDED COMMIT, on this or any later invocation (design decision 3): the operator finds its sha
// and mints the follow-up by hand. Printed whether or not another cluster is pending (G-14 of
// 20261011-053415-commit-recovery-design-r6): the pending branch used to exit first and lose it.
if (unrecorded.length) {
  console.error(`remediate: ${unrecorded.map((x) => `cluster ${x.id}`).join(', ')} committed with an unrecorded sha; no follow-up review is minted.`);
  console.error(`  Find it with git log ${printedArg(`${done.remediation_start}..HEAD`)}, then: node ${printedArg(path.join(FRAMEWORK.scriptsDir, 'new-run.mjs'))} --repo-root ${printedArg(repo)} --base ${printedArg(String(done.remediation_start))} --follows-remediation ${printedArg(runDir)}`);
}
if (end.why) {
  if (!pending.length && !unrecorded.length) console.error(`remediate: ${run.run_id} has not ended: ${end.why}; no follow-up review is minted.`);
  process.exit(1);
}
// THE RUN HAS ENDED: nothing pending, nothing unrecorded. It moves back into the repository like every run (story-pipeline,
// 2026-10-15: only run-graph archived, so every remediation stayed under the engine's home). BEFORE the follow-up is
// minted, so the follow-up records where the run now is. The lock is not carried; the staged copy, lock included, is
// removed once the archive is whole, and the exit handler then finds nothing to release.
// THE RUN'S TELEMETRY RECORD (telemetry-records.plan.md stage 3), before the run moves, so it is archived with it; one that
// cannot be built is a note, never a failed run.
{
  // THE RUN'S OWN END (G-5 of 20261027-071443-trt-delivery): the commits and full checks follow the node's last task.
  bestEffort(() => saveRun({ graph_ended_at: new Date().toISOString() }), (why) => console.error(`remediate: graph_ended_at not recorded (${why})`));
  const tel = writeRunRecord(runDir, { recordKind: 'remediation', repoRoot: repo });
  if (!tel.ok) console.error(`remediate: ${tel.note}`);
}
const finalDir = archiveStagedRun({ runDir, archiveTo: run.archive_to, repoRoot: repo, skip: [REMEDIATE_LOCK],
  log: (m) => console.error(`remediate: ${m}`) });
// A REFUSED OR FAILED ARCHIVE returns the staged directory (G-12 of 20261015-220413-archive-fold-review): nothing is minted
// from it, or the follow-up would record the stale staged path. archiveStagedRun has said why; the run is whole, staged.
if (finalDir === runDir && !inArchive(runDir, run.archive_to)) {
  die(`${run.run_id} was not archived, so no follow-up review is minted; it stays at ${runDir}. Resolve the reason above, then run `
    + `this command again with --run-dir ${printedArg(runDir)} (the node will not be spawned again).`);
}
if (!commits.length) {
  console.log('remediate: nothing was committed, so there is no diff to review; no follow-up minted');
  // NOT A CLEAN NO-OP when the report or the commits failed their check (story-pipeline, 20261010-190952): a node that
  // refused at once answered no group, and exit 0 read as "nothing to do".
  const failed = (done.stamps ?? []).filter((s) => s === REPORT_CHECK_STAMP || s === COMMIT_CHECK_STAMP);
  if (failed.length) console.error(`remediate: ${failed.join(', ')} — see report_check and commit_check in ${path.join(finalDir, 'run.json')}`);
  process.exit(done.remediation_state === 'reported' && !failed.length ? 0 : 1);
}
const mint = spawnSync(process.execPath, [
  path.join(FRAMEWORK.scriptsDir, 'new-run.mjs'),
  '--repo-root', repo, '--slug', `${String(run.run_id).replace(/^\d{8}-\d{6}-/, '')}-review`,
  '--base', done.remediation_start, '--follows-remediation', finalDir,
  ...(args.noVerifySandbox ? ['--no-verify-sandbox'] : []),
  ...(args.noVerifyReviewers ? ['--no-verify-reviewers'] : []),
  ...runtimeBinArgv(args.runtimeBin),
], { cwd: repo, encoding: 'utf8', env: process.env });
const out = `${mint.stdout ?? ''}${mint.stderr ?? ''}`;
// Absolute, against the repository the mint was given (G-15 of 20261023-014400-rdt-delivery): new-run prints an
// in-repository run relative to it.
const followDir = printedRunDir(out, repo);
if (mint.status !== 0 || !followDir) {
  die(`the follow-up review could not be minted; run this command again with --run-dir ${printedArg(finalDir)} to retry (the node will not be spawned again):\n${out}`);
}
// ADMITTED BEFORE IT IS READ OR RECORDED (run-dir-descendants.plan.md stage 3): new-run's printed path is text from a
// child's output; the follow-up is admitted for this repository, and the directory admitted is what is read and recorded.
const followAdmission = admitRun({ runDir: followDir, repoRoot: repo });
if (!followAdmission.ok) die(`the follow-up review new-run printed (${followDir}) is not admitted: ${followAdmission.why}`);
const follow = followAdmission.record;
saveRun({ followup_run_id: follow?.run_id ?? null, followup_run_dir: followAdmission.dir }, finalDir);
const relOut = (p) => path.relative(repo, p).split(path.sep).join('/');
console.log(`\nremediate: ${commits.length} commit(s); follow-up review minted, not run:`);
// ITS SCRIPT TOO (G-9 of 20261108-065111-si-remediation-7-review): a framework path holding a space split the pasted line.
console.log(`  node ${printedArg(relOut(path.join(FRAMEWORK.scriptsDir, 'run-graph.mjs')))} --run-dir ${printedArg(followAdmission.dir)} --repo-root ${printedArg(repo)}`);   // the repository admitted (G-22)
console.log('Next: run quorate:claim-check on evidence/remediation/payload.json, then the review above. Nothing was pushed.');
