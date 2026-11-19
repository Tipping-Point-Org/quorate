#!/usr/bin/env node
// THE REPAIR PASS, MEASURED ON REAL REFUSALS (remediation-repair-pass.plan.md stage 4; the operator, 2026-11-01: "2 lets
// measure before deciding 3 measure before deciding as well"). RP-D2 (how many passes) and RP-D3 (whether the stuck
// 20261101-075544-dr-remediation-2 goes through one) wait on these figures.
//
//   node scripts/bench-repair-pass.mjs --case <remediation run id> [--case ...] [--cap 3] [--results <file>]
//
// For each case: a remediation run of this repository whose full check refused its candidate, and every hash that check
// recorded (checked-files.json) a blob git still holds. It is rebuilt and replayed in a worktree under the engine's home:
//   1. a detached worktree at the head that check recorded;
//   2. a scratch review run minted there (new-run --full-sweep), its reconcile payload, reconciled.md, gate.json and
//      finding-groups.json copied from the case's reviewed run, so the same groups are confirmed;
//   3. a scratch remediation run minted from it (new-run --remediates);
//   4. THIS ENGINE's remediate.mjs run on it with --replay-node naming the case's record: the first node is not run again
//      but installed by the runner, at depth 0 (repair-bench-replay.plan.md; G-1 of 20261102-060316-rrp-remediation-3-
//      review, when this script stood in as the node runtime and its replay ran before its depth guard) — the case's own
//      report, captures and node status copied into the scratch run and its candidate blobs written into the worktree —
//      and the repair passes spawn the node runtime as on any run. --measure-only stops the runner before any commit,
//      archive or follow-up mint;
//   5. a first invocation at a cap of 0, so the full check runs once: a case whose failing tests are not the ones the case
//      recorded is reported "not reproduced" and not measured;
//   6. then --retry-commits --repair at the cap, recording each pass, each full check, the repair's diff against the
//      candidate, and each repair node's whole output (its tokens and vendor cost);
//   7. the worktree removed. The scratch runs stay staged under the engine's home, machine-local, as the raw record.
// Results: one result.json per case under <home>/bench-repair/, and the table every one of them adds up to, each figure
// beside its n, in --results (default bench/repair-pass/RESULTS.md).
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { runtimeBinArg, runtimeBinArgv } from './io/runtime-bin.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
import { confined, TMP_MAX } from './io/confined-path.mjs';
import { gitSync } from './io/git.mjs';
import { lsTreeEntries } from './lib/remediation-chain.mjs';
import { isWithin } from './io/finding-scope.mjs';
import { admitRun, callerRepoRoot, repoRunRoots, quorateHome } from './io/reviews-root.mjs';
import { readContract } from './io/contract-reader.mjs';
import { renderTemplate } from './lib/template.mjs';
import { readTemplate } from './io/template.mjs';
import { redactClaim } from './lib/redact.mjs';
import { repairBenchSummary, checkMs, failingOf, reproduced, repairRunOutcome, changedFiles, afterCleanup, numstatOfBlobPairs, RUN_JSON_FAILING_NAMES } from './lib/repair-bench.mjs';

// The depth guard first (G-3 of 20261102-161123-rbr-delivery): only the die it needs is defined before it.
const die = (m, code = 2) => { console.error(`bench-repair-pass: ${m}`); process.exit(code); };
{
  const { raw, depth } = nodeDepth(process.env);
  if (!Number.isInteger(depth) || depth < 0) die(`GRAPH_NODE_DEPTH=${JSON.stringify(raw)} is not a non-negative integer (§8)`, 3);
  if (depth > 0) die(`GRAPH_NODE_DEPTH=${depth}: a graph node may not start a benchmark (§8)`, 3);
}
const SELF = fileURLToPath(import.meta.url);
const SCRIPTS = path.dirname(SELF);
const segsOf = (rel) => String(rel).split(/[\\/]/).filter((s) => s && s !== '.');
// The longest part of an attempt directory's name taken from its case id: with the 15-character time, a "-" and a
// "-<n>" suffix it stays far below every platform's name limit, however long the id (G-2).
const CASE_NAME_MAX = 80;
let v;
try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['bench-repair-pass'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
const cases = v.case ?? [];
// With no --case, only the table is written again, from the cases already measured (a result.json corrected by hand,
// such as a rebuilt diff, is then shown).
const cap = v.cap === undefined ? 3 : Number(v.cap);
if (!Number.isInteger(cap) || cap < 1) die(`--cap must be a whole number of passes, at least 1, not ${JSON.stringify(v.cap)}`);
const repo = callerRepoRoot(v['repo-root']);
const contractRead = readContract({ repoRoot: repo });
if (contractRead.error) die(`the contract of ${repo} cannot be read: ${contractRead.error}`);
const contract = contractRead.contract ?? {};
// A repair pass runs on the node runtime spawn-node resolves, as on any run. --runtime-bin (TEST-ONLY; --claude-bin its
// alias for one release) names a fake one, handed on to remediate.mjs as its --runtime-bin test seam.
let nodeBin;
try { nodeBin = runtimeBinArg(v); } catch (e) { die(e.message); }
const home = confined(quorateHome());
const benchRoot = home.dir(['bench-repair']);
const bench = confined(benchRoot);
const resultsFile = path.resolve(repo, v.results ?? path.join('bench', 'repair-pass', 'RESULTS.md'));
const git = (cwd, ...a) => gitSync(a, { cwd, encoding: 'utf8' });
const node = (script, argv, opts = {}) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...argv],
  { cwd: opts.cwd ?? repo, encoding: 'utf8', env: { ...process.env, ...(opts.env ?? {}) }, maxBuffer: 256 * 1024 * 1024 });
const mintedDir = (out) => (String(out).match(/^run dir:\s*(.+)$/m)?.[1] ?? '').trim();

function findRun(id) {
  for (const root of repoRunRoots({ repoRoot: repo, project: contract.project ?? null, declaredReviewsDir: contract.review?.reviews_dir ?? null, home: quorateHome() })) {
    const a = admitRun({ runDir: path.join(root, id), repoRoot: repo });
    if (a.ok) return a;
  }
  return null;
}

function replayCase(id) {
  const started = Date.now();
  const result = { case: id, started_at: new Date(started).toISOString(), cap };
  // One directory per attempt (G-5 of 20261102-161123-rbr-delivery): two attempts of one id in one second shared one.
  // The name is made from the id with every character outside [A-Za-z0-9_-] replaced and its length capped, so a
  // malformed --case is recorded as that case and never throws out of the bench (G-2 of
  // 20261102-173413-rbr-remediation-review): replacing only \ / : NUL left ? * " < > |, a trailing dot and an
  // over-long id, each refused by Windows (G-2 of 20261102-184751-rbr-remediation-2-review). The record keeps the id.
  const stem = `${new Date(started).toISOString().replace(/[-:]/g, '').slice(0, 15)}-${String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, CASE_NAME_MAX)}`;
  // CLAIMED, not checked then made (G-2): the directory is an attempt's only when its claim file is created exclusively
  // in it, so two processes choosing the same name cannot both take it; the loser tries the next.
  let caseName = null;
  // Any other failure to claim is this case's error, returned, never an abort of the cases after it.
  try {
    for (let n = 1; n <= TMP_MAX && !caseName; n++) {
      const name = n === 1 ? stem : `${stem}-${n}`;
      if (bench.exists([name])) continue;
      try { bench.create([name, 'claim'], `${process.pid}\n`); caseName = name; } catch (e) {
        if (e.code !== 'EEXIST' && !(e.code === 'ECONFINED' && e.refusal === 'taken')) throw e;
      }
    }
  } catch (e) {
    return { case: id, status: 'error', why: `no attempt directory could be claimed for it: ${String(e?.message ?? e).slice(0, 400)}` };
  }
  if (!caseName) return { case: id, status: 'error', why: `every attempt name up to ${stem}-${TMP_MAX} is taken` };
  // EVERY CASE IS RECORDED, measured or not, so the table says what was tried and why it was not measured.
  const done = (fields) => {
    Object.assign(result, fields, { wall_ms: Date.now() - started });
    bench.replace([caseName, 'result.json'], `${JSON.stringify(result, null, 2)}\n`);
    return result;
  };
  // Whatever throws inside a case (a record of it gone or unreadable) is that case's error, recorded, never an abort of
  // the cases after it (the class of G-6 of 20261102-161123-rbr-delivery).
  try { return body(); } catch (e) { return done({ status: 'error', why: `the case could not be replayed: ${String(e?.message ?? e).slice(0, 400)}` }); }
  function body() {
  const found = findRun(id);
  if (!found) return done({ status: 'not-found', why: `${id} is not admitted as a run of ${repo}` });
  const orig = confined(found.dir);
  const run = found.record;
  const check = (run.full_checks ?? []).find((f) => (f.refusals ?? []).length);
  if (!check) return done({ status: 'not-refused', why: 'no full check of this run refused its candidate' });
  // A missing or unreadable artifact is this case's record, never an abort of the cases after it (G-6 of
  // 20261102-161123-rbr-delivery).
  let candidate;
  try { candidate = JSON.parse(orig.read(segsOf(check.files_at))); } catch (e) { candidate = null; result.files_at_error = String(e?.message ?? e); }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return done({ status: 'not-rebuildable', why: `the refused check's checked-files artifact (${check.files_at}) is missing or unreadable` });
  }
  // ONE git for every blob (G-3 of 20261102-173413-rbr-remediation-review): a `cat-file -e` per file was F processes.
  // A hash that is not hex cannot be one line of the batch, so it is missing; a line not naming a found object is too.
  const held = Object.entries(candidate).filter(([, h]) => h !== 'absent');
  const hexOk = held.map(([, h]) => typeof h === 'string' && /^[0-9a-f]{4,64}$/i.test(h));
  const asked = held.filter((_, i) => hexOk[i]);
  const batch = asked.length ? gitSync(['cat-file', '--batch-check'], { cwd: repo, encoding: 'utf8', input: asked.map(([, h]) => `${h}\n`).join('') }) : { status: 0, stdout: '' };
  // A FAILED cat-file IS NOT A MISSING BLOB (G-1 of 20261108-032104-si-remediation-4-review): it was reported as "git no
  // longer holds" every one of them.
  if (batch.status !== 0) return done({ status: 'error', why: `git cat-file --batch-check failed (exit ${batch.status}): ${String(batch.stderr ?? '').trim().slice(0, 400)}` });
  const lines = String(batch.stdout ?? '').split('\n');
  const inGit = new Set(batch.status === 0 ? asked.filter((_, i) => /^[0-9a-f]+ \S+ \d+$/i.test(lines[i] ?? '')).map(([p]) => p) : []);
  const missing = held.filter(([p]) => !inGit.has(p)).map(([p]) => p);
  if (missing.length) return done({ status: 'not-rebuildable', why: `git no longer holds the candidate's ${missing.join(', ')}` });
  // Every failing name, from the check's own log: run.json keeps RUN_JSON_FAILING_NAMES (G-3 of
  // 20261102-033648-rrp-remediation-review), read from its owner (G-4 of 20261102-173413-rbr-remediation-review).
  const logOf = (dir, test) => { try { return test?.evidence_path ? dir.read(segsOf(test.evidence_path)) : null; } catch { return null; } };
  const recorded = failingOf(check.results?.test, logOf(orig, check.results?.test));
  if (!recorded) return done({ status: 'not-rebuildable', why: `the refused check's log is gone and run.json's failing names may be cut to ${RUN_JSON_FAILING_NAMES}, so its failures are not known` });
  Object.assign(result, { head: check.head, candidate_files: Object.keys(candidate).length, recorded_failing: recorded,
    recorded_refusals: check.refusals.map((r) => r.key) });
  const reviewedId = run.remediation_frame?.run_id;
  const reviewedAt = reviewedId ? admitRun({ runDir: run.remediation_frame.run_dir, repoRoot: repo }) : null;
  if (!reviewedAt?.ok) return done({ status: 'not-rebuildable', why: `its reviewed run ${reviewedId} is not admitted` });
  const reviewed = confined(reviewedAt.dir);

  const caseDir = bench.dir([caseName]);
  const wtPath = path.join(caseDir, 'wt');
  const add = git(repo, 'worktree', 'add', '--detach', wtPath, check.head);
  if (add.status !== 0) return done({ status: 'error', why: `git worktree add failed: ${add.stderr.trim()}` });
  try {
    // A scratch review whose confirmed groups are the case's: its own mint, the reviewed run's judgement copied in.
    const flags = ['--repo-root', wtPath, '--no-verify-sandbox', '--no-verify-reviewers'];
    // new-run probes its runtime's version on every mint, so the override reaches both mints as it reaches remediate
    // (G-4 of 20261111-224124-runtime-bin-d1-review).
    const rev = node('new-run.mjs', [...flags, ...runtimeBinArgv(nodeBin), '--slug', 'bench-rev', '--no-request', '--full-sweep', 'scripts'], { cwd: wtPath });
    const revDir = mintedDir(rev.stdout);
    if (rev.status !== 0 || !revDir) return done({ status: 'error', why: `the scratch review did not mint: ${(rev.stderr || rev.stdout).trim().slice(-400)}` });
    const scratchRev = confined(revDir);
    for (const segs of [['reconciled.md'], ['gate.json'], ['evidence', 'reconcile', 'payload.json'], ['finding-groups.json']]) {
      if (reviewed.exists(segs)) scratchRev.replace(segs, reviewed.read(segs, null));
    }
    const rem = node('new-run.mjs', [...flags, ...runtimeBinArgv(nodeBin), '--slug', 'bench-fix', '--remediates', revDir], { cwd: wtPath });
    const remDir = mintedDir(rem.stdout);
    if (rem.status !== 0 || !remDir) return done({ status: 'error', why: `the scratch remediation did not mint: ${(rem.stderr || rem.stdout).trim().slice(-400)}` });
    result.scratch_runs = { review: path.basename(revDir), remediation: path.basename(remDir) };
    // What the replayed first node hands over: the case's report and captures, and the candidate.
    bench.dir([caseName, 'replay', 'evidence']);
    const replay = confined(bench.dir([caseName, 'replay']));
    const origPayload = orig.read(['evidence', 'remediation', 'payload.json']);
    replay.replace(['payload.json'], origPayload);
    // Only the captures the report cites: the rest of the node's folder is spawn-node's own output for that spawn.
    const cited = new Set((JSON.parse(origPayload).groups ?? []).flatMap((g) => [g.red_evidence, g.green_evidence])
      .flatMap((f) => String(f ?? '').split(';')).map((p) => p.trim()).filter(Boolean));
    for (const rel of cited) {
      const segs = segsOf(rel);
      if (segs.length !== 3 || segs[0] !== 'evidence' || segs[1] !== 'remediation' || !orig.exists(segs)) continue;
      replay.replace(['evidence', segs[2]], orig.read(segs, null));
    }
    // The status spawn-node wrote for the case's node, which the runner's commit gate reads, and the envelope it names.
    if (!orig.exists(['nodes', 'remediation.status.json'])) return done({ status: 'not-rebuildable', why: 'the case\'s node status (nodes/remediation.status.json) is gone' });
    const origStatus = orig.read(['nodes', 'remediation.status.json']);
    replay.replace(['status.json'], origStatus);
    const out = segsOf(JSON.parse(origStatus).stdout_path ?? '');
    if (out.length === 3 && out[0] === 'evidence' && out[1] === 'remediation' && orig.exists(out)) replay.replace(['evidence', out[2]], orig.read(out, null));
    replay.replace(['replay.json'], `${JSON.stringify({ run_dir: remDir, worktree: wtPath, candidate }, null, 2)}\n`);
    const remediate = (extra, log) => {
      const r = node('remediate.mjs', ['--repo-root', wtPath, '--run-dir', remDir, ...runtimeBinArgv(nodeBin), ...flags.slice(2), ...extra], { cwd: wtPath });
      bench.replace([caseName, log], `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
      return r;
    };
    const runRecord = () => JSON.parse(confined(remDir).read(['run.json']));
    // 5. Reproduce: the full check once, no pass.
    const first = remediate(['--replay-node', replay.root, '--test-repair-passes', '0', '--measure-only'], 'remediate-1.log');
    const fc0 = (runRecord().full_checks ?? [])[0];
    const got = fc0 ? failingOf(fc0.results?.test, logOf(confined(remDir), fc0.results?.test)) : null;
    result.reproduce = { exit: first.status, failing: got, refusals: (fc0?.refusals ?? []).map((r) => r.key),
      check_ms: fc0 ? checkMs(fc0.results) : null };
    // Only a run that reached its end, refusing on the original check's refusals (G-3 of 20261102-044855-rrp-remediation-
    // 2-review): a killed run may already have written a matching check.
    const same = reproduced({ exit: first.status, check: fc0, failing: got, recorded, recordedRefusals: result.recorded_refusals });
    if (!same) return done({ status: 'not-reproduced', why: !fc0 ? `no full check ran (exit ${first.status})` : first.status !== 0 ? `the reproducing run ended with exit ${first.status}${first.signal ? ` (${first.signal})` : ''} before its --measure-only end` : `the full check failed on ${JSON.stringify(got)} (${(fc0.refusals ?? []).map((r) => r.key).join(', ') || 'nothing'}), not the recorded ${JSON.stringify(recorded)} (${result.recorded_refusals.join(', ')})` });
    // 6. The repair passes, at the cap.
    const second = remediate(['--retry-commits', '--repair', '--test-repair-passes', String(cap), '--measure-only'], 'remediate-2.log');
    const rec = runRecord();
    const passes = [];
    const remRun = confined(remDir);
    for (const p of rec.repair_passes ?? []) {
      let status = null; let output = null;
      try { status = JSON.parse(remRun.read(['nodes', `${p.node_id}.status.json`])); } catch { /* recorded as unknown */ }
      try { output = JSON.parse(remRun.read(['evidence', p.node_id, 'stdout.json'])); } catch { /* recorded as unknown */ }
      if (output) bench.replace([caseName, `${p.node_id}.stdout.json`], `${JSON.stringify(output, null, 2)}\n`);
      const fc = Number.isInteger(p.full_check) ? rec.full_checks[p.full_check] : null;
      passes.push({ pass: p.pass, outcome: p.outcome, why: p.why ?? null, changed: Array.isArray(p.changed) ? p.changed : null, added: p.added ?? {},
        node_ms: status?.duration_ms ?? null, node_state: p.node_state ?? null,
        check_ms: fc ? checkMs(fc.results) : null,
        cost_usd: output?.total_cost_usd ?? null, usage: output?.usage ?? null, model_usage: output?.modelUsage ?? null });
    }
    // The repair's diff against the candidate, file by file: each changed file's blob now against the candidate's.
    // A file the candidate does not hold is compared with its blob at the head, where it has one: the repair edited it
    // (the first run of the bench compared such a file with an empty one and counted the whole file as added).
    // A pass whose change set was not recorded makes the whole diff unknown, printed n/a (G-3 of
    // 20261102-060316-rrp-remediation-3-review): counted as no change, it understated the repair.
    const changed = changedFiles(passes);
    let added = 0; let removed = 0;
    const files = [];
    const unknown = [];
    // BATCHED (G-1 of 20261108-021347-si-remediation-2-review): the head's blobs from one ls-tree and the repaired files'
    // blobs from one hash-object --stdin-paths, not a rev-parse and a hash-object per file. A name holding a line break
    // cannot go in that batch (one path per line), and a batch whose answer does not line up is unknown, never guessed.
    const list = changed ?? [];
    const headLs = list.length ? git(wtPath, 'ls-tree', '-z', check.head, '--', ...list.map((p) => `:(literal)${p}`)) : null;
    // A FAILED ls-tree IS NOT "ABSENT AT HEAD" (G-1 of 20261108-032104-si-remediation-4-review): read as an empty map, every
    // head-only file counted as wholly added. Each path the candidate does not hold is then unknown.
    const headFailed = Boolean(headLs && headLs.status !== 0);
    const headAt = headLs && !headFailed ? lsTreeEntries(headLs.stdout) : new Map();
    const wt = confined(wtPath);
    const present = list.filter((p) => !/[\r\n]/.test(p) && wt.exists(segsOf(p)));
    const hashed = present.length ? gitSync(['hash-object', '-w', '--stdin-paths'], { cwd: wtPath, encoding: 'utf8', input: `${present.join('\n')}\n` }) : null;
    const hashes = hashed && hashed.status === 0 ? hashed.stdout.trim().split(/\r?\n/) : [];
    const nowOf = new Map(hashes.length === present.length ? present.map((p, i) => [p, hashes[i]]) : []);
    const pending = [];
    for (const p of list) {
      if (headFailed && !(p in candidate)) {
        unknown.push({ path: p, why: `git ls-tree of the head failed (exit ${headLs.status})` });
        files.push({ path: p, before: null, after: null, added: null, removed: null, before_from: 'head' });
        continue;
      }
      const was = p in candidate ? (candidate[p] !== 'absent' ? candidate[p] : null) : (headAt.get(p)?.hash ?? null);
      const exists = /[\r\n]/.test(p) ? null : wt.exists(segsOf(p));
      if (exists === null || (exists && !nowOf.has(p))) {
        unknown.push({ path: p, why: exists === null ? 'its name holds a line break' : 'git hash-object could not hash it' });
        files.push({ path: p, before: was, after: null, added: null, removed: null, before_from: p in candidate ? 'candidate' : 'head' });
        continue;
      }
      const entry = { path: p, before: was, after: exists ? nowOf.get(p) : null, added: null, removed: null, before_from: p in candidate ? 'candidate' : 'head' };
      files.push(entry);
      pending.push(entry);
    }
    // ONE BATCH for every file's line counts (G-4 of 20261111-192009-runtime-bin-remediation-review): a numstat per file
    // was one process launch per file. A failed batch, or a binary file's "-" counts, is unknown, never 0 lines (G-7 of
    // 20261102-161123-rbr-delivery).
    const counts = numstatOfBlobPairs((a, input) => gitSync(a, { cwd: wtPath, encoding: 'utf8', input: input ?? undefined }), pending);
    pending.forEach((entry, i) => {
      const c = counts[i];
      if (c.why) { unknown.push({ path: entry.path, why: c.why }); return; }
      entry.added = c.added; entry.removed = c.removed;
      added += c.added; removed += c.removed;
    });
    // A run that did not reach its --measure-only end (which exits 0) crashed or was stopped: its passes are kept, and the
    // case is not counted, so a crash is never read as "never green" (G-6 of 20261102-033648-rrp-remediation-review), and
    // that is read before the pass count, so a crash before any pass is never an ordinary no-pass (G-4 of
    // 20261102-044855-rrp-remediation-2-review).
    const outcome = repairRunOutcome({ exit: second.status, passes: passes.length });
    const diff = changed === null || unknown.length ? null : { files: changed.length, added, removed, per_file: files };
    if (unknown.length) Object.assign(result, { diff_unknown: unknown, diff_per_file: files });
    if (outcome === 'error') {
      return done({ status: 'error', exit: second.status, passes, diff,
        why: `the repair run ended with exit ${second.status}${second.signal ? ` (${second.signal})` : ''} before its --measure-only end; its passes are recorded, not counted` });
    }
    // NO PASS RAN: the retry's own check of the candidate did not refuse on failing tests alone (20261024-003108-rmg-
    // remediation-3b: it timed out at the old head's 15-minute check limit), so nothing of the repair pass was measured.
    if (outcome === 'no-pass') {
      const last = (rec.full_checks ?? []).at(-1);
      return done({ status: 'no-pass', exit: second.status,
        why: `no repair pass was offered: the retry's check refused on ${(last?.refusals ?? []).map((r) => `${r.key} (${r.why})`).join('; ') || 'nothing'}` });
    }
    const green = passes.findIndex((p) => p.outcome === 'green');
    return done({ status: 'measured', exit: second.status, green_after: green === -1 ? 'never' : green + 1, passes, diff });
  } finally {
    const rm = git(repo, 'worktree', 'remove', '--force', wtPath);
    if (rm.status !== 0) console.error(`bench-repair-pass: the worktree ${wtPath} was not removed: ${rm.stderr.trim()}`);
    git(repo, 'worktree', 'prune');
    // A worktree left behind fails the case and the bench (G-4 of 20261102-060316-rrp-remediation-3-review).
    const left = afterCleanup(result, { removed: rm.status === 0, worktree: wtPath });
    if (left.status) done(left);
  }
  }
}

for (const id of cases) {
  console.log(`== ${id} ==`);
  const r = replayCase(id);
  console.log(`${id}: ${r.status}${r.green_after !== undefined ? `, green after ${r.green_after}` : ''}${r.why ? ` (${r.why})` : ''}`);
  if (r.worktree_left) process.exitCode = 1;
}
// THE TABLE, from every case measured so far (each result.json under the engine's home), each figure beside its n.
const all = [];
// A record that cannot be read or parsed is listed as unreadable, never an abort of the table (G-5 of
// 20261102-173413-rbr-remediation-review).
for (const name of bench.list([])) {
  let rec;
  try {
    if (!bench.exists([name, 'result.json'])) continue;
    rec = JSON.parse(bench.read([name, 'result.json']));
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw new Error('not a JSON object');
    // The summary maps passes, so a record whose passes is not a list is unreadable, never a throw out of the table (G-5
    // of 20261102-184751-rbr-remediation-2-review).
    if (rec.passes !== undefined && rec.passes !== null && (!Array.isArray(rec.passes)
      || rec.passes.some((p) => !p || typeof p !== 'object'))) throw new Error('its passes is not a list of objects');
  } catch (e) {
    rec = { case: name, status: 'unreadable', why: `its result.json cannot be read: ${String(e?.message ?? e).slice(0, 200)}` };
  }
  all.push(rec);
}
// Asked of isWithin, containment's one owner (G-2 of 20261105-151040-crsf-remediation-4b-review): `startsWith('..')`
// read an in-repository results file under `..x` as outside, and re-rooted its writer at the file's parent.
const inRepo = isWithin(repo, resultsFile);
const out = inRepo ? confined(repo) : confined(path.dirname(resultsFile));
// The table is a tracked file carrying run text (a pass's why), so it goes through the redaction owner (G-12 of
// 20261102-161123-rbr-delivery).
out.replace(inRepo ? segsOf(path.relative(repo, resultsFile)) : [path.basename(resultsFile)],
  redactClaim(renderTemplate(readTemplate('repair-bench-results.md'), repairBenchSummary(all), 'repair-bench-results.md')));
console.log(`bench-repair-pass: ${all.length} case(s) in ${path.relative(repo, resultsFile).split(path.sep).join('/')}`);
