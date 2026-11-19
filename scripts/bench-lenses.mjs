#!/usr/bin/env node
// bench-lenses.mjs — the measurement loop: seed a known defect, run the graph, score the lenses.
//
// Everything else in this framework measures whether the process ran completely; nothing measures
// whether the lenses actually catch defects. This harness closes that: each corpus entry is a
// patch reintroducing one known defect (bench/corpus/<id>/), the graph reviews the seeded tree,
// and lib/bench-scoring.mjs decides which lenses landed on the seed. The output is the number the
// framework has never had — recall per lens, with cost beside it — and it is also the instrument
// that settles open runtime questions (e.g. reasoning effort medium vs high) by measurement
// instead of assertion.
//
// Mechanics reuse what the engine already guarantees: a known-good checkout reviews a BROKEN tree
// via --repo-root, so the seeded worktree never executes its own (seeded) orchestrator. Seeds
// recreate the PRE-DISCOVERY state — the patch also strips the defect's regression tests, because
// a defect the suite catches fails the pre-flight barrier and the benchmark would measure the
// tests instead of the reviewers.
//
//   node scripts/bench-lenses.mjs                    list the corpus and what a run would cost
//   QUORATE_BENCH=1 node scripts/bench-lenses.mjs [--seed <id>] [--tolerance N]
//   node scripts/bench-lenses.mjs --score-only --run-dir <abs> --manifest <path>
//
// The opt-in mirrors check-reviewers': a live benchmark spawns real model lenses per seed, which
// spends real quota, so it never runs implicitly. --score-only is free and is how the offline
// suite tests the scoring against a fabricated run directory.
//
// THE CONTRACT IT ANSWERS TO is this framework root's (bench-contract-root.design.md), never the directory it is
// launched from: the graphs are seeded from this tree. --score-only reads none; the listing reads it and names its
// overrides; a live run also refuses it while it is not committed, because the seeded tree is HEAD.
//
// Exit codes: 0 ran (or scored, or listed) · 1 corpus or run failure · 2 usage · 3 depth guard.

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runPool, shAsync, makeLock } from './io/pool.mjs';

import { validateManifest, scoreSeed, summarize, resolveAnchor, scoreReconcile } from './lib/bench-scoring.mjs';
// Reading a finished run's artifacts is shared with bench-second-opinion.mjs, which scores the
// audit OF the barrier — so there is one reader rather than two free to disagree about what a run
// says. It lived here as a private function until the second benchmark needed it.
import { collectRun, refusalLines, readNodeStatus } from './io/run-artifacts.mjs';
import { confined } from './io/confined-path.mjs';
import { redactTree } from './lib/redact.mjs';
import { frameworkStamp } from './io/version.mjs';
// The adapter table, for the runtime whose version actually resolved the model aliases (G-4).
import { selectAdapters, overrideLine, entrypoint } from './io/reviewers.mjs';
import { subscriptionProbeEnv } from './lib/decisions.mjs';
import { readContract } from './io/contract-reader.mjs';
import { benchContract, uncommittedContractRefusal, sumLensUsage, cacheReadTokens } from './lib/bench-settings.mjs';
import { CONTRACT_CANDIDATES } from './lib/contract-source.mjs';
import { admitRun, callerRepoRoot, printedRunDir, archivedReviewsDir } from './io/reviews-root.mjs';
import { gitSync } from './io/git.mjs';
import { writeBenchRecord } from './io/telemetry-record.mjs';

// Fails CLOSED like every entry point that starts graph work (disk-first-protocol §8): a lens
// that benchmarks lenses is an unbounded fan-out with a bill attached.
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

function die(msg) {
  console.error(`bench-lenses: ${msg}`);
  process.exit(2);
}

const args = { tolerance: 15 };
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['bench-lenses'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  for (const [flag, key] of Object.entries({ seed: 'seed', 'score-only': 'scoreOnly', 'run-dir': 'runDir', manifest: 'manifest', effort: 'effort', model: 'model' })) {
    if (v[flag] !== undefined) args[key] = v[flag];
  }
  for (const [flag, key] of Object.entries({ tolerance: 'tolerance', concurrency: 'concurrency', 'defect-line': 'defectLine' })) {
    if (v[flag] !== undefined) args[key] = Number(v[flag]);
  }
  // THE PANEL IS A KNOB BECAUSE IT CHANGES WHO REPORTS, and that is not a detail. A seed the
  // lens MISSED and an arm CAUGHT still scores as caught, so a sweep with arms cannot measure
  // whether a LENS setting regressed — the arms mask it, in the direction that looks fine.
  // review.effort.judgment moves every Claude lens and no arm, so isolating the lenses is the
  // only way to attribute a change to the knob under test. It rewrites the seeded contract
  // exactly as --effort does, because the contract comes from the corpus COMMIT and an
  // uncommitted edit would never reach the worktree.
  if (v['no-panel']) args.noPanel = true;
}
if (!Number.isInteger(args.tolerance) || args.tolerance < 0) die('--tolerance must be a non-negative integer');

// How many seeds are reviewed at once. Each seed is a whole graph run that spawns its own lenses at
// `review.concurrency`, so the real ceiling on concurrent model processes is this number TIMES that
// one — the reason the default is deliberately small rather than "all of them".
const SEED_CONCURRENCY = args.concurrency ?? 3;
if (!Number.isInteger(SEED_CONCURRENCY) || SEED_CONCURRENCY < 1) die('--concurrency must be a positive integer');

function readManifest(file) {
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    die(`manifest ${file} did not parse: ${e.message}`);
  }
  const errors = validateManifest(m);
  if (errors.length) die(`manifest ${file} is invalid:\n  - ${errors.join('\n  - ')}`);
  return m;
}

// ---------------------------------------------------------------------------- score-only mode
if (args.scoreOnly) {
  if (!args.runDir || !args.manifest) die('--score-only requires --run-dir and --manifest');
  const manifest = readManifest(path.resolve(args.manifest));
  // --score-only has no seeded worktree, so it cannot resolve the anchor itself and the line has to
  // be supplied. That is not a gap left open: the line belongs to the TREE THE RUN REVIEWED, and an
  // archived run's tree is gone. Recomputing an anchor against today's checkout would confidently
  // score an old run against a file that has since moved — the cross-tree comparison this rework
  // exists to make impossible. Live runs record `defect_line` beside each score for exactly this.
  if (!Number.isInteger(args.defectLine) || args.defectLine < 1) {
    die('--score-only requires --defect-line <n>: the resolved line from the run being scored, ' +
      'which live runs record as `defect_line` in their result file');
  }
  // A REFUSED RUN IS NOT SCORED (G-4 of 20260929-010407-ltb-review-r4): a directory with no readable run.json
  // scored as zero findings. A node's refusal leaves the rest scoring, and travels in the output.
  // A SCORED RUN IS A RUN OF NO REPOSITORY (ARCHITECTURE A-28; run-dir-trust.plan.md stage 3): scoring reads its findings
  // and acts on no tree, so the owner admits it with noRepository — inside the repository or the engine's home, a readable
  // record, a run_id that is its directory's name — and the repository checks are not made.
  // Scored THROUGH the admitted directory (G-2 of 20261023-040306-rdt-remediation-2-review): rereading the caller's
  // spelling after admission let a link retargeted in between score a different directory's artifacts.
  const admitted = admitRun({ runDir: path.resolve(args.runDir), repoRoot: callerRepoRoot(), noRepository: true });
  if (!admitted.ok) die(`--score-only: --run-dir ${admitted.why}`);
  let collected;
  try { collected = collectRun(admitted.dir); } catch (err) {
    if (err?.name === 'RunRefused') die(`--score-only: ${err.message}`);
    throw err;
  }
  const { findingsByNode, costsByNode, refused } = collected;
  const score = scoreSeed({
    manifest, findingsByNode, defectLine: args.defectLine,
    tolerance: manifest.tolerance ?? args.tolerance,
  });
  // REDACTED WHOLE (G-8 of 20260929-124952-ssr-review): refusal reasons quote what they refused, and this output is
  // saved; every value is redacted here, at the write, not field by field.
  process.stdout.write(JSON.stringify(redactTree({
    schema_version: 1,
    score,
    summary: summarize([score], costsByNode),
    // Nodes left out of the score, and why — so the score cannot read as complete over dropped evidence.
    refused,
  }), null, 2) + '\n');
  process.exit(0);
}

// THE ONE CONTRACT A BENCH ANSWERS TO (bench-contract-root.design.md D1-D3): the FRAMEWORK root's, read ONCE, here. The
// graphs this bench runs are seeded from this tree, so the table, its override lines, the runtime and the declared
// settings the result records all come from this one value — two reads, each choosing its own root, is what let a bench
// launched from another project describe a contract its graphs never ran under (G-4 of
// 20261014-220944-lf-remediation-r5-review). Read AFTER --score-only, which scores an archived run and reads nothing
// (D2; G-1 of 20261014-200907-lf-remediation-r2-review); BEFORE the listing, which names the table's overrides and so
// refuses a contract it cannot read (D2 B; A-26). The runtime is chosen as new-run chooses it (review.runtime, else the
// table's default), so the result names the runtime the graphs' nodes spawn on (G-4 here is the alias resolver).
// readContract runs new-run.mjs --print-contract, the ONE contract parser: a second parser is how two components come
// to disagree about the same file.
let BENCH_DECLARED;
let declaredReview;
try { ({ reviewers: BENCH_DECLARED, review: declaredReview } = benchContract(readContract({ cwd: FRAMEWORK_ROOT }))); } catch (e) { die(e.message); }
// The one owner (contract-runtime-and-session-files.plan.md stage 1), as new-run chooses.
const BENCH_ADAPTERS = selectAdapters({ declared: BENCH_DECLARED, contract: { review: declaredReview } });
const BENCH_RUNTIME_TABLE = BENCH_ADAPTERS.table;
// EVERY OVERRIDE OF THIS TABLE, NAMED ONCE BEFORE ANYTHING THAT SPENDS (reviewer-credential-routing, A-26): the contract
// decided where an overridden built-in's credentials go.
for (const o of BENCH_ADAPTERS.overrides) console.error(`bench-lenses: ${overrideLine(o)}`);
let BENCH_RUNTIME_NAME;
try { BENCH_RUNTIME_NAME = BENCH_ADAPTERS.runtime; } catch (e) { die(e.message); }
// A LIVE RUN SPENDS ONLY ON A COMMITTED CONTRACT (bench-contract-root D1's amendment): the graphs are seeded from HEAD.
// Asked before the corpus is read, so before any --seed filtering; the listing spends nothing and is not asked.
if (process.env.QUORATE_BENCH === '1') {
  const st = gitSync(['status', '--porcelain', '--', ...CONTRACT_CANDIDATES], { cwd: FRAMEWORK_ROOT, encoding: 'utf8' });
  const refused = uncommittedContractRefusal({ status: st.status, stdout: st.stdout, stderr: st.stderr, error: st.error?.message });
  if (refused) die(refused);
}
const BENCH_RUNTIME = BENCH_RUNTIME_TABLE[BENCH_RUNTIME_NAME];

// -------------------------------------------------------------------------------- the corpus
if (!fs.existsSync(CORPUS_DIR)) die(`no corpus at ${CORPUS_DIR}`);
const seeds = fs.readdirSync(CORPUS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((id) => !args.seed || id === args.seed)
  .sort();
if (!seeds.length) die(args.seed ? `no corpus entry named '${args.seed}'` : 'corpus is empty');

const entries = seeds.map((id) => {
  const dir = path.join(CORPUS_DIR, id);
  const manifest = readManifest(path.join(dir, 'manifest.json'));
  if (manifest.id !== id) die(`corpus/${id}: manifest id '${manifest.id}' does not match its directory`);
  const patch = path.join(dir, 'defect.patch');
  if (!fs.existsSync(patch)) die(`corpus/${id}: no defect.patch`);
  return { id, manifest, patch };
});

if (process.env.QUORATE_BENCH !== '1') {
  console.log(`bench-lenses: ${entries.length} seed(s) in the corpus:\n`);
  for (const e of entries) {
    console.log(`  ${e.id}`);
    console.log(`    ${e.manifest.title}`);
    // The ANCHOR, not a line: the listing runs against an unseeded tree, where the defect has no
    // line at all. Printing one would be printing a number nothing computed.
    const a = e.manifest.defect.anchor;
    console.log(`    expects: ${e.manifest.defect.lenses.join(', ')} at ${e.manifest.defect.file}`);
    console.log(`    anchored on: ${a.length > 76 ? `${a.slice(0, 73)}...` : a}`);
  }
  // The runtime choice, visible without spending (bench-contract-root stage 3): review.runtime, else the table's default.
  console.log(`\nThe node runtime a live run records: ${BENCH_RUNTIME_NAME}.`);
  console.log(
    `\nRunning them spawns real model lenses per seed — subscription quota, minutes per seed. ` +
      `Re-run with QUORATE_BENCH=1 to spend that deliberately. It is NOT part of commands.test.`,
  );
  process.exit(0);
}

// ------------------------------------------------------------------------------- live bench
function sh(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', ...opts });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
// The same shape for git, through the engine's one git owner (engine-git-env.plan.md stage 3, A-29).
function shGit(argv, opts = {}) {
  const r = gitSync(argv, { encoding: 'utf8', ...opts });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// shAsync and the git lock now live in lib/pool.mjs, beside runPool, because they are halves of the
// same guarantee and because a private helper can only be tested by GREPPING for its name — which
// still passes when the helper itself becomes blocking (G-59). One lock instance for this script's
// worktree operations: `git worktree add|remove` mutate .git/worktrees under a repository lock and
// are the one part of a concurrent seed that may not overlap another's.
const withGitLock = makeLock();

fs.mkdirSync(RESULTS_DIR, { recursive: true });
const startedAt = new Date().toISOString();
const stamp = startedAt.replace(/[:.]/g, '-');
const scores = [];
const notRun = [];
const perSeedRuns = [];
// Money and tokens spent by seeds that produced no score. Real spend, deliberately not mixed into
// perSeedRuns — see the finally block in runSeed().
const unscoredSpend = [];

// A lens's own status file decides whether the lens REPORTED. Findings alone cannot: a run where
// the lens never launched has zero findings, and zero findings scored as a miss is silence read
// as a verdict — recall 0 asserted about a lens that was never asked. The first live invocation
// of this harness produced exactly that (35 seconds, $0, reported as MISSED), so this rule is
// load-bearing, not theoretical.
function lensesThatReported(runDir, expectedLenses) {
  const ok = [];
  for (const lens of expectedLenses) {
    // Through the run's owner (G-19 of 20261029-212858-rdr-remediation-2-review): a link at the status is refused. And by
    // the one strict reader (G-3 of 20261029-224143-rdr-remediation-3-review): an OK with no valid findings_count is not
    // a report, so a malformed lens is NOT RUN rather than scored as a miss.
    const r = readNodeStatus(confined(runDir), lens);
    // And only a status that names THIS lens (G-2 of 20261029-235315-rdr-remediation-4-review): a misnamed status is not
    // this lens reporting, as collectRun already refuses it.
    if (r.ok && r.status.state === 'OK' && r.status.node_id === lens) ok.push(lens);
  }
  return ok;
}

// One seed, start to finish. Its console output is BUFFERED and flushed as a block when the seed
// finishes: with several seeds in flight the interleaved lines otherwise attribute one seed's
// result to another's header, and a benchmark whose transcript cannot be read per seed is a
// benchmark whose failures cannot be diagnosed.
async function runSeed(e) {
  const out = [`\n== seed ${e.id} — ${e.manifest.title}`];
  const say = (s) => out.push(s);
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), `quorate-bench-${e.id}-`));
  const log = path.join(RESULTS_DIR, `${stamp}-${e.id}.log`);
  const logLine = (label, text) => fs.appendFileSync(log, `\n===== ${label} =====\n${text}\n`);
  let runDir = null;
  let spendRecorded = false;
  let defectLine = null;

  try {
    let r = await withGitLock(() => shGit(['worktree', 'add', '--detach', wt, 'HEAD'], { cwd: FRAMEWORK_ROOT }));
    if (r.status !== 0) throw new Error(`worktree add failed:\n${r.out}`);

    r = shGit(['apply', e.patch], { cwd: wt });
    if (r.status !== 0) throw new Error(`defect.patch did not apply — regenerate the seed against the current tree:\n${r.out}`);

    // WHERE the defect is, resolved from the seeded file rather than remembered. defect.anchor names
    // it by content, so nothing above it can move it. A stored line rotted three times in one day of
    // ordinary edits, and every rot scored a correct finding as a MISS.
    // SWEEPING A KNOB IS A FLAG, NOT AN EDIT. The worktree is created from HEAD, so an uncommitted
    // change to this repository's own contract never reaches the seeded tree: a sweep run by
    // editing CLAUDE.md and re-running measures the COMMITTED setting every time while reporting it
    // as the new one. That happened on 2026-09-20 -- a pass labelled `high` ran entirely at xhigh,
    // and only the per-node effort the result records gave it away. The override is written INTO the
    // worktree, which is where --repo-root actually reads the contract from.
    //
    // The roster is the other half and behaves oppositely: it is read from the FRAMEWORK root, so a
    // per-lens `effort` there does reach the run and will silently mask this flag for that lens.
    // The result records the effort every node ACTUALLY ran at. Read that, never this flag, when
    // deciding what a number measured.
    if (args.effort || args.model || args.noPanel) {
      const contractPath = path.join(wt, 'CLAUDE.md');
      let c = fs.readFileSync(contractPath, 'utf8');
      // TEST THE PATTERN, NOT THE DIFF. This first read `if (c === before) throw`, which treats a
      // no-op replacement as a missing line -- so asking for the value the contract ALREADY holds
      // failed with "no effort line". That is the control arm of any sweep: `--effort xhigh`
      // against a contract already at xhigh is the comparison every other pass is measured from,
      // and it was the one setting the harness refused to run.
      const EFFORT_RE = /^(\s*effort:\s*\{[^}]*judgment:\s*)[A-Za-z]+/m;
      const MODEL_RE = /^(\s*models:\s*\{[^}]*judgment:\s*)[A-Za-z0-9._-]+/m;
      if (args.effort) {
        if (!EFFORT_RE.test(c)) throw new Error('--effort: no `effort: { judgment: ... }` line in the seeded contract');
        c = c.replace(EFFORT_RE, `$1${args.effort}`);
      }
      if (args.model) {
        if (!MODEL_RE.test(c)) throw new Error('--model: no `models: { judgment: ... }` line in the seeded contract');
        c = c.replace(MODEL_RE, `$1${args.model}`);
      }
      if (args.noPanel) {
        const PANEL_RE = /^(\s*external_panel:\s*)(true|false)/m;
        if (!PANEL_RE.test(c)) throw new Error('--no-panel: no `external_panel:` line in the seeded contract');
        c = c.replace(PANEL_RE, '$1false');
      }
      fs.writeFileSync(contractPath, c);
    }

    const seededFile = path.join(wt, e.manifest.defect.file);
    if (!fs.existsSync(seededFile)) {
      throw new Error(`defect.file is missing from the seeded worktree: ${e.manifest.defect.file}`);
    }
    const anchored = resolveAnchor(fs.readFileSync(seededFile, 'utf8'), e.manifest.defect.anchor);
    if (!anchored.ok) throw new Error(`${anchored.why} — regenerate the seed`);
    defectLine = anchored.line;

    // The checkout ships bench/corpus — every seed's manifest, naming its defect by file and
    // line. A tree under review that contains its own answer key is not a benchmark; nothing in
    // the 19-15 run's claims suggests the lens read it, but nothing stopped it either, and a
    // recall figure that cannot rule that out is not a recall figure. Note this also makes the
    // seeded pre-flight's test check fail on the framework's own meta-tests (corpus integrity,
    // counted facts) — recorded noise, not a stop: the engine's doctrine is that a broken suite
    // is a fact the lenses should see, and the benchmark reads lens status, never the gate.
    fs.rmSync(path.join(wt, 'bench'), { recursive: true, force: true });

    // The KNOWN-GOOD checkout's orchestrator reviews the SEEDED tree. The engine locates itself
    // relative to itself, so the seeded copy of these scripts never runs.
    r = await shAsync(process.execPath, [
      path.join(HERE, 'new-run.mjs'),
      '--repo-root', wt, '--slug', `bench-${e.id}`,
      // A contract-audit seed needs criteria to violate: its patch carries an APPROVED request
      // into the worktree and names it here, so intent-capture runs and the lens gets real I-n.
      // Every other seed suppresses the request stage, which stamps UNREQUESTED and skips
      // contract-audit -- irrelevant to the lenses those seeds measure.
      ...(e.manifest.request ? ['--request', e.manifest.request] : ['--no-request']),
      '--full-sweep', ...e.manifest.scope,
    ], { cwd: wt });
    logLine('new-run', r.out);
    if (r.status !== 0) throw new Error(`new-run failed — see ${path.relative(FRAMEWORK_ROOT, log)}`);
    const runId = (r.out.match(/(\d{8}-\d{6}-bench-[a-z0-9-]+)/) ?? [])[1];
    if (!runId) throw new Error(`could not read the run id from new-run output — see ${path.relative(FRAMEWORK_ROOT, log)}`);
    // WHERE THE RUN ACTUALLY IS, read from new-run's output instead of computed. The contract's
    // `review.reviews_dir: ""` STAGES a run under the engine's own home and moves it back into the
    // tree only when it ends -- so <worktree>/.claude/reviews/<id> does not exist yet, and
    // run-graph refuses the path outright: "is neither inside the repository". Every seed died at
    // exit 2 before a lens was spawned, which is why bench/results stops on the day staging landed
    // and the corpus has been unrunnable ever since. Same class as the defect second-opinion
    // diagnosed on 20260916-194910-release-gate: staging moved runs and a consumer assumed it had not.
    // Absolute, against the worktree the mint was given (G-3 of 20261023-014400-rdt-delivery): new-run prints an
    // in-repository run relative to its --repo-root, and run-graph below does not run in that directory.
    const printedDir = printedRunDir(r.out, wt);
    const archivedDir = path.join(archivedReviewsDir(wt), runId);
    runDir = printedDir ?? archivedDir;

    r = await shAsync(process.execPath, [
      path.join(HERE, 'run-graph.mjs'),
      '--run-dir', runDir, '--repo-root', wt,
      '--only', e.manifest.defect.lenses.join(','),
      // NO --skip-panel. AC3 of model-and-effort-reevaluation says "the arms are benched too", and
      // this flag made that unsatisfiable: it suppressed every shadow arm, so no external reviewer
      // had ever appeared in a bench result. An arm emits findings with file and line, so scoreSeed
      // scores it exactly like a lens -- the corpus could always have measured them and never did.
      //
      // The same flag also gates second-opinion, so dropping it costs a second-opinion per seed on
      // top of the arms. That is deliberate rather than overlooked: the operator's instruction is
      // that all three runtimes get measured, and second-opinion's cost and duration per setting
      // are worth having even while its RECALL needs a corpus of seeded reconciliation errors that
      // does not exist yet.
    ], { cwd: wt });
    logLine('run-graph', r.out);
    // ...and it is moved back when the run ends, so score wherever it actually landed.
    if (!fs.existsSync(runDir) && fs.existsSync(archivedDir)) runDir = archivedDir;
    // ADMITTED, AND READ THROUGH THE DIRECTORY IT ADMITTED (G-3 of 20261029-224143-rdr-remediation-3-review): the status
    // probe built its owner on this spelling, which a replaced or linked run root could point at another run.
    const admittedRun = admitRun({ runDir, repoRoot: wt });
    if (!admittedRun.ok) throw new Error(`run directory refused: ${admittedRun.why} — this seed is NOT RUN, never a miss`);
    runDir = admittedRun.dir;

    const reported = lensesThatReported(runDir, e.manifest.defect.lenses);
    const silent = e.manifest.defect.lenses.filter((l) => !reported.includes(l));
    // run-graph's own exit code is NOT the gate here: an --only run leaves every other required
    // lens unspawned, so its gate is BLOCKED and run-graph exits 1 by design. What decides
    // scoreability is whether the EXPECTED lens reported OK — the same status-not-verdict
    // separation the graph itself runs on.
    if (silent.length) {

      throw new Error(
        `run-graph exited ${r.status}; lens(es) that never reported OK: ${silent.join(', ')} — ` +
          `this seed is NOT RUN, never a miss. A lens that was not asked cannot have missed. ` +
          `See ${path.relative(FRAMEWORK_ROOT, log)}`,
      );
    }

    const {
      findingsByNode, costsByNode, usageByNode, turnsByNode, durationsByNode, configByNode,
      reconcileDecisions, groupIndex, refused,
    } = collectRun(runDir);   // RunRefused lands in the catch below: the seed is NOT RUN, never a miss (G-4)
    const tol = e.manifest.tolerance ?? args.tolerance;
    const score = scoreSeed({
      manifest: e.manifest, findingsByNode, defectLine, tolerance: tol,
    });
    // DID THE BARRIER KEEP IT? Detection was the only thing ever scored, so a reconcile that
    // discarded a true finding still read as recall 1.0. Scored on the same anchor and tolerance as
    // detection, so the two numbers are about the same defect.
    score.reconcile = scoreReconcile({
      groupIndex, decisions: reconcileDecisions,
      file: e.manifest.defect.file, defectLine, tolerance: tol,
    });
    // The resolved line travels into the artifact: without it an archived run cannot be re-scored,
    // because the tree that produced it is gone and the anchor would resolve against a different one.
    score.defect_line = defectLine;
    scores.push(score);
    perSeedRuns.push({ seed: e.id, costs: costsByNode, usage: usageByNode, turns: turnsByNode, duration_ms: durationsByNode, nodes: configByNode, refused });
    spendRecorded = true;
    say(
      score.caught
        ? `   caught by: ${score.caught_by.join(', ')}`
          + (score.reconcile.state === 'lost'
            ? `
   BARRIER LOST IT: reconcile decided ${JSON.stringify(score.reconcile.decisions)}`
            : score.reconcile.state === 'kept' ? '' : `
   reconcile: ${score.reconcile.state}`)
        : `   MISSED by ${reported.join(', ')} — the lens ran, reported OK, and did not land on the seed`,
    );
  } catch (err) {
    // The refusal travels into the result file, not only the console (G-4 of 20260929-124952-ssr-review).
    notRun.push({ seed: e.id, reason: String(err.message).split('\n')[0], ...(err?.name === 'RunRefused' ? { refused: { 'run.json': err.why } } : {}) });
    say(`   seed NOT RUN: ${err.message}`);
  } finally {
    // SPEND IS RECORDED EVEN WHEN THE SEED IS NOT SCORED. The push above sits after the silent-lens
    // throw, so a seed that spent real money and then failed contributed exactly $0 to the run's
    // own total — the same defect spawn-node fixed for a single node ("the cost of a failed node is
    // exactly as real as the cost of a successful one"), reappearing one layer up. It is kept
    // SEPARATE from perSeedRuns rather than merged into it: this spend bought no score, and folding
    // it into the per-lens figures would quietly worsen every recall-per-dollar number with money
    // that never bought a measurement.
    if (!spendRecorded && runDir && fs.existsSync(runDir)) {
      try {
        // ADMITTED FIRST (G-4 of 20261029-235315-rdr-remediation-4-review): a throw before or at admission leaves runDir on
        // its unadmitted spelling, and the run admission refused is not read here either. A refusal is recorded below.
        const spendRun = admitRun({ runDir, repoRoot: wt });
        if (!spendRun.ok) throw Object.assign(new Error(`run directory refused: ${spendRun.why}`), { name: 'RunRefused', why: spendRun.why });
        const { costsByNode, usageByNode, refused } = collectRun(spendRun.dir);
        if (Object.keys(costsByNode).length || Object.keys(usageByNode).length || Object.keys(refused).length) {
          unscoredSpend.push({ seed: e.id, costs: costsByNode, usage: usageByNode, refused });
        }
      } catch (err) {
        // The preserved run directory is the fallback record — but a refusal is SAID, never swallowed (G-4 of
        // ltb-review-r4): the host-bound reader's warning does not run on a throw, so this catch is the only voice.
        say(`   spend not recorded: ${String(err?.message ?? err).split('\n')[0]}`);
        // And RECORDED (G-4 of 20260929-124952-ssr-review): a reader of the result file must be able to tell a refused
        // run's missing spend from a seed that spent nothing.
        if (err?.name === 'RunRefused') unscoredSpend.push({ seed: e.id, costs: {}, usage: {}, refused: { 'run.json': err.why } });
      }
    }

    // EVERY run directory is preserved BEFORE the worktree goes, not just the failures. On failure
    // the run IS the diagnosis; on success it is the only copy of the envelopes — which carry the
    // token accounting — and those were being deleted with the worktree, leaving dollars as the
    // sole surviving measure of a run whose real budget is a token window.
    // A FAILED ARCHIVE MUST NOT BE FOLLOWED BY A DELETE.
    //
    // This block copies the run out because the worktree is about to go. The catch used to only
    // LOG, and the removal below ran unconditionally — so the one path where preservation matters,
    // preservation failing, destroyed the very run it had just failed to save. That is the defect
    // this block was added to fix (an earlier version removed the worktree unconditionally),
    // reintroduced inside the fix, and it is the shape of every lost-evidence bug: the cleanup is
    // unconditional while the thing justifying it is not.
    //
    // A leaked worktree is recoverable and visible in `git worktree list`. A deleted run directory
    // is neither. So on a failed copy the worktree STAYS, named loudly with the command to remove it
    // once the operator has what they need.
    let archived = true;
    if (runDir && fs.existsSync(runDir)) {
      const dest = path.join(RESULTS_DIR, `${stamp}-${e.id}-run`);
      try {
        // AWAITED, NOT BLOCKING (G-3). `fs.cpSync` held the shared event loop for as long as the
        // copy took — proportional to the archived bytes, and a run directory holds every node's
        // stdout — while the OTHER concurrent seed workers were mid-flight. They were not merely
        // idle during it: `shAsync` drains its children through this same loop, so a long copy
        // stops reading their pipes, and a child whose pipe is not drained blocks on write. So the
        // one worker archiving its result could stall every other worker's child, silently, and
        // the effect grows with both concurrency and the size of what is being preserved.
        //
        // That also makes the benchmark measure itself: seed timings taken while a neighbour was
        // copying are inflated by an amount nothing records, on a tool whose entire output is
        // comparative numbers.
        await fs.promises.cp(runDir, dest, { recursive: true });
        say(`   preserved the run at ${path.relative(FRAMEWORK_ROOT, dest)}`);
      } catch (e2) {
        archived = false;
        say(`   COULD NOT PRESERVE THE RUN: ${e2.message}`);
        say(`   keeping the worktree so the run survives: ${wt}`);
        say(`   remove it once you have what you need: git worktree remove --force "${wt}"`);
      }
    }
    if (archived) {
      // A FAILED REMOVAL MUST SAY SO (G-4). The result was discarded, so a worktree git refused to
      // remove — a file held open, a permission, a lock — left a registered worktree and a temp
      // directory behind while the bench reported a clean cleanup. Repeated across runs that
      // accumulates silently, and the next `git worktree add` inherits the mess.
      const rm = await withGitLock(() => shGit(['worktree', 'remove', '--force', wt], { cwd: FRAMEWORK_ROOT }));
      if (rm?.status !== 0) {
        say(`   WARNING: could not remove the worktree at ${wt}` +
          `${rm?.out ? `: ${String(rm.out).trim().slice(0, 200)}` : ''}`);
        say(`   it is still registered — clean up with: git worktree remove --force "${wt}"`);
      }
    }
  }
  process.stdout.write(`${out.join('\n')}\n`);
}

console.log(`\n== bench: ${entries.length} seed(s), ${SEED_CONCURRENCY} at a time ==`);
await runPool(entries, runSeed, SEED_CONCURRENCY);

// Completion order is now arrival order, which is not seed order. Sorting restores a result file
// that is diffable between runs: an unsorted one changes shape whenever two seeds happen to finish
// in a different sequence, which reads as a change in the measurement when nothing measured moved.
const byId = (a, b) => String(a.seed).localeCompare(String(b.seed));
scores.sort(byId);
notRun.sort(byId);
perSeedRuns.sort(byId);

unscoredSpend.sort(byId);

const sumCosts = (rows) => rows.reduce(
  (sum, s) => sum + Object.values(s.costs).reduce((a, b) => a + b, 0), 0,
);
const scoredCost = sumCosts(perSeedRuns);
const unscoredCost = sumCosts(unscoredSpend);
const totalCost = scoredCost + unscoredCost;

// TOKENS, totalled the way dollars are. The quota that actually binds an operator is a token
// window, and until now every artifact this harness wrote could only answer in dollars — a derived
// figure, and the wrong unit. Cache reads are kept as their own line rather than folded into the
// input total: they are the bulk of the traffic and are not billed or rationed like fresh input,
// so summing them together would produce one big number that means nothing.
// Thinking is nested under output_tokens_details, inside output_tokens as the vendor reports it, so
// no reader counts it twice (sumLensUsage, lib/bench-settings.mjs; G-4 of 20261114-174045-m2-pred1-review).
const usageTotal = sumLensUsage([...perSeedRuns, ...unscoredSpend]);
// Per-lens costs aggregated across seeds — the value summarize() was handed an empty map in
// place of, leaving cost_usd null in every committed artifact while the total proved the data
// existed (G-8).
const aggCosts = {};
for (const r of perSeedRuns) {
  for (const [node, c] of Object.entries(r.costs)) aggCosts[node] = (aggCosts[node] ?? 0) + c;
}

const result = {
  schema_version: 1,
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  tolerance: args.tolerance,
  // Recall is computed over seeds whose lenses actually reported; an entry in not_run[] is a fact
  // about the harness or the run, never about the lens.
  not_run: notRun,
  scores,
  summary: summarize(scores, aggCosts),
  // The configuration that produced this artifact, so two result files are comparable without
  // operator memory (G-7): which commit the seeds ran against, and per seed, each node's
  // effective model, effort, cost and turns as its own status file recorded them (G-6).
  // WHAT PRODUCED THIS NUMBER. A recall figure with no configuration attached is not a
  // measurement, it is an anecdote — and criterion 12 of the approved request requires that these
  // results "identify their own configuration". They did not: every result file on disk records
  // tolerance, scores and cost, and no model at all.
  //
  // The alias is not enough on its own and that is the important part. `opus` and `sonnet` are
  // FLOATING POINTERS — the provider updates the model behind them, and a result measured against
  // last month's `opus` says nothing certain about this month's, in either direction: the new model
  // may be better at one lens and worse at another. So the alias, the CLI that resolved it, and the
  // date are all recorded, and a reader comparing two result files must check all three before
  // treating a difference as a change in the framework rather than in the model underneath it.
  config: {
    corpus_commit: shGit(['rev-parse', 'HEAD'], { cwd: FRAMEWORK_ROOT }).out.trim(),
    framework: frameworkStamp(FRAMEWORK_ROOT, { layout: 'bench' }),
    // Declared in the REPOSITORY's contract, read at a different moment from the sweep — so when
    // `--effort`/`--model` are given these describe a setting the run did not use. Measured on the
    // two archived sweeps and it is worse than stale, it is off by one: the xhigh run records
    // `high` and the medium run records `xhigh`, each having captured the contract as it stood
    // before its own flag. A reader trusting this field attributes every number to the previous
    // setting. Kept because it is a true fact about the contract; no longer the only record.
    declared_models: declaredReview?.models ?? null,
    declared_effort: declaredReview?.effort ?? null,
    // WHAT THIS SWEEP WAS ASKED TO RUN, which is the question `declared_effort` reads like an
    // answer to and is not. `null` where no flag was given, which is itself the useful statement:
    // this pass took the contract as it found it. The per-seed `runs[].nodes` remain the record of
    // what each node ACTUALLY ran under, and are what to trust when any of these disagree.
    override: {
      model: args.model ?? null,
      effort: args.effort ?? null,
      // `null` means the sweep took the contract as it found it, which for this key is the
      // difference between a comparison about lenses and one the arms can mask.
      external_panel: args.noPanel ? false : null,
    },
    // The resolver. A model alias means whatever this CLI version resolved it to on this date.
    // FROM THE RUNTIME, not a literal binary (G-4, panel-codex-arch). This invoked `claude
    // --version` and recorded the answer as `claude_version`, while the node runtime is selectable —
    // so a benchmark configured for another runtime attributed model-alias resolution to a provider
    // it never used, in the one file whose entire purpose is making two measurements comparable.
    // Same rename new-run already made for run.json.host: `runtime` plus `runtime_version`, because
    // a field naming one vendor cannot record a run that used another.
    runtime: BENCH_RUNTIME_NAME,
    // SCRUBBED, as new-run's version probe is (G-23): sh() with no env handed the runtime every secret the shell held
    // (plan-review round 11 of reviewer-credential-routing). A version string is not worth a credential.
    runtime_version: (sh(BENCH_RUNTIME.cmd, entrypoint(BENCH_RUNTIME, 'version_argv'), { env: subscriptionProbeEnv(process.env, BENCH_RUNTIME).env }).out || 'unknown')
      .trim().split(String.fromCharCode(10))[0],
    node_version: process.version,
    measured_at: startedAt,
    alias_caveat:
      'Model aliases float: the provider may replace the model behind "opus"/"sonnet" at any time. '
      + 'A result is only comparable to another with the same runtime_version and a nearby '
      + 'measured_at. Re-measure before trusting an older number, and never carry a recall figure '
      + 'forward across a model change in either direction.',
  },
  runs: perSeedRuns,
  total_cost_usd: Number(totalCost.toFixed(2)),
  // Broken out so the total can never again be read as "what the scored seeds cost". It is what
  // the RUN cost; the split says how much of it bought a measurement.
  scored_cost_usd: Number(scoredCost.toFixed(2)),
  unscored_cost_usd: Number(unscoredCost.toFixed(2)),
  unscored_spend: unscoredSpend,
  total_usage: usageTotal,
};
const outFile = path.join(RESULTS_DIR, `${stamp}.json`);
// REDACTED WHOLE at the tracked write (G-8, G-12 of 20260929-124952-ssr-review; ledger-trust-boundaries' one redaction
// owner at every tracked write): refusal reasons, NOT RUN reasons and claims are all values in this object.
fs.writeFileSync(outFile, JSON.stringify(redactTree(result), null, 2) + '\n');
// The bench run's telemetry record (telemetry-records.plan.md stage 3), beside its results; a note, never a failed bench.
{
  const tel = writeBenchRecord(outFile, { repoRoot: FRAMEWORK_ROOT });
  if (!tel.ok) console.error(`bench-lenses: ${tel.note}`);
}

const k = (n) => `${(n / 1000).toFixed(1)}k`;
console.log(`\nbench-lenses: ${result.summary.caught}/${result.summary.seeds} seed(s) caught` +
  (notRun.length ? `, ${notRun.length} seed(s) NOT RUN` : '') +
  ` — $${result.total_cost_usd}` +
  (unscoredCost > 0 ? ` ($${result.unscored_cost_usd} of it on seeds that produced no score)` : ''));
console.log(
  `tokens: ${k(usageTotal.input_tokens)} in, ${k(usageTotal.output_tokens)} out ` +
  `(${k(usageTotal.output_tokens_details.thinking_tokens)} of it thinking), ` +
  `${k(usageTotal.cache_creation_input_tokens)} cache-write, ${k(cacheReadTokens(usageTotal))} cache-read`); // both vendors' spellings (G-1 of 20261114-195905-m2-pred1-remediation-2-review)
// EVERY REFUSAL ON STDOUT, a scored seed's included (G-6 of 20260929-195848-ssr-review-r7, found in bench-second-opinion
// and the same here): a seed's node refusals reached the result file and stderr only.
for (const l of refusalLines([...perSeedRuns, ...unscoredSpend, ...notRun])) console.log(l);
console.log(`wrote ${path.relative(FRAMEWORK_ROOT, outFile)}`);
process.exit(notRun.length ? 1 : 0);
