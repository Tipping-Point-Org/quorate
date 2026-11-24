// helpers.mjs — fixtures for the orchestration regression suite.
//
// EVERY test in this directory must be free and offline. The scripts under test spawn `claude`,
// so a test that reaches a model call costs real money on every commit and every pre-flight
// barrier. Each black-box test below is aimed at a guard that fires during argument parsing or
// environment inspection — strictly before any subprocess is launched — and asserts on the refusal
// itself. If you add a test here, check where it stops.
//
// THE CONSEQUENCE, stated because nothing else states it: the live transport to the reviewer
// CLIs is NEVER exercised by this suite. Every panel defect found so far has been a transport
// defect (a .ps1 shim needing a shell, cmd.exe mangling a multi-line prompt, an argv ceiling),
// and each is invisible from here by construction. `QUORATE_LIVE=1 node scripts/check-reviewers.mjs`
// is the deliberate, paid check that covers it. A verification framework that does not name
// what it leaves unchecked is the failure it exists to prevent.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as probeIo from '../scripts/io/reviewer-probe.mjs';
import { builtinReviewers, rawTable } from '../scripts/io/reviewers.mjs';
import { CONTRACT_CANDIDATES, chooseContractSource } from '../scripts/lib/contract-source.mjs';
import { parseContractYaml } from '../scripts/lib/contract-yaml.mjs';
import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';
import { commitEnvFor } from '../scripts/lib/decisions.mjs';

// fileURLToPath, not new URL(...).pathname: on Windows the latter yields a slash, the drive letter and its colon, then
// the folder with each space percent-encoded — a path that does not exist. That exact bug shipped once.
export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = path.resolve(TESTS_DIR, '..', 'scripts');

/**
 * A QUORATE_HOME for the whole suite, so no test writes into the operator's REAL home directory.
 *
 * Runs default to `<QUORATE_HOME>/reviews/<project>-<hash>` since graph_contract 2. Before this
 * existed, every test that minted a run and did not archive it left one in `~/.quorate` — outside
 * the repository under test, hidden by no gitignore, and removed by nothing. Twelve had piled up
 * within an hour of the default changing.
 *
 * The suite used to litter `.claude/reviews` instead, which is why the gitignore carries a
 * `*-tmptest-*` rule; that litter was at least inside the tree and visible. This one would not have
 * been.
 */
export const TEST_HOME = path.join(os.tmpdir(), 'quorate-test-home');
// AND FOR THE TEST PROCESS ITSELF (stdin-folder-owner.plan.md stage 1): runScript gave TEST_HOME to the scripts a test
// starts, but code a test runs in-process (runChild, spawnCapture, stdinFrom) read the operator's engine home, and every
// in-process spawn with an input would have made its stdin folder in `~/.quorate/stdin`. Set at import, overriding an
// operator's own QUORATE_HOME, so no test writes the operator's engine home; tests/run-all.mjs sets it for every test
// process too, for a file that imports no helper. A test that needs another home sets and restores it itself.
process.env.QUORATE_HOME = TEST_HOME;

// The repository under test, from git rather than by counting three directories up from this file.
// The old form encoded one installation depth and would silently resolve to the wrong real
// directory once the framework moves — the failure mode being tests that pass against the wrong
// tree.
export const REPO_ROOT = (() => {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', cwd: TESTS_DIR });
  if (r.status === 0 && r.stdout.trim()) return path.resolve(r.stdout.trim());
  return path.resolve(TESTS_DIR, '..', '..', '..'); // last resort outside a git checkout
})();

/**
 * The repository's release tags, for lib/compatibility.mjs's preRelease: the freeze must equal its owner until 1.0 is
 * TAGGED, not until VERSION reads 1.0.0 (G-16 of 20261123-161216-m3s9-review). A clone that fetched no tags reads none,
 * which keeps an untagged 1.0.0 to equality, the stricter side.
 */
export function releaseTags() {
  const r = spawnSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8', cwd: REPO_ROOT });
  return r.status === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : [];
}

/**
 * WHICH LENSES AN OFFLINE TEST MAY NAME IN `--only`.
 *
 * Both are selected by a CONTRACT KEY a fixture controls — `ui.surface` and `commands.run` — so a
 * fixture declaring `ui.surface: none` can prove ui-audit will not spawn. Every other lens has
 * `condition: always` and will launch a judgment-tier model no matter what the fixture says.
 *
 * THIS LIST EXISTS BECAUSE THE SUITE SPENT $2.81. A new test passed `--only <every lens but
 * ui-audit>` on the reasoning that ui-audit was the one being excluded; four lenses ran —
 * arch-review, code-audit, security-audit, perf-audit — before it was killed mid-reconcile. A
 * sibling test called run-graph with no `--only` at all and would have run the full fan-out. The
 * rule they broke is the first paragraph of this file, and it was a comment.
 *
 * A comment is not a guard. The check below is.
 */
export const OFFLINE_SAFE_LENSES = Object.freeze(['ui-audit', 'feature-verify']);

/**
 * The environment for spawning a session hook (stop-guard, command-log) as the WORKING session: the caller's, without
 * the variables that mark a graph node. The suite itself runs at depth 1 inside a remediation's candidate check, and a
 * hook spawned there with the caller's environment read itself as a node, so the guard allowed every stop (found by
 * 20261025-082729-srf-remediation's full check: five stop-guard tests passed only where the depth was unset).
 */
export function sessionHookEnv(extra = {}) {
  const env = { ...commitEnvFor(process.env), ...extra }; // secret-shaped names and the runtime's auth do not cross (G-37)
  for (const k of ['GRAPH_NODE_DEPTH', 'QUORATE_RUN_ID', 'QUORATE_NODE_ID']) if (!Object.hasOwn(extra, k)) delete env[k];
  return env;
}

/**
 * Run one orchestration script and capture how it refused (or did not).
 *
 * `mayFanOut: true` opts out of the spend guard below, for a test that launches run-graph expecting
 * it to REFUSE before any node is spawned — an unusable run directory, a depth guard, a bad
 * argument. Pass it only when the refusal is the thing under test.
 */
const PROBING_SCRIPTS = new Set(['external-review.mjs', 'check-reviewers.mjs', 'run-graph.mjs', 'new-run.mjs', 'remediate.mjs']);
const probeDirs = [];
process.on('exit', () => { for (const d of probeDirs) fs.rmSync(d, { recursive: true, force: true }); });
function freshProbesDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-test-probes-'));
  probeDirs.push(d);
  return d;
}

// A MINT THAT WOULD CHECK REAL REVIEWERS (reviewer-preflight stage 3). With the panel on, new-run probes every panel arm
// and adjudicator before it creates the run — through the vendor CLIs on PATH, which on a developer's machine are the real,
// billed ones. Allowed only when the mint cannot probe (--no-verify-reviewers, --dry-run, --print-contract, or a contract
// with the panel off) or the test says it means to ({ mayProbe: true }, with fakes first on PATH). The records such a
// mint's children write land in the call's own QUORATE_REVIEWER_PROBES, which they inherit, never in TEST_HOME.
function mintMayProbe(args, cwd) {
  if (['--no-verify-reviewers', '--dry-run', '--print-contract'].some((f) => args.includes(f))) return false;
  const at = args.indexOf('--repo-root');
  const root = path.resolve(cwd, at === -1 ? '.' : String(args[at + 1] ?? '.'));
  const chosen = chooseContractSource(CONTRACT_CANDIDATES.map((rel) => {
    const abs = path.join(root, rel);
    return { path: rel, abs, text: fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null };
  }));
  if (!chosen.ok) return false;  // new-run refuses this contract before it could probe anything
  try { return parseContractYaml(chosen.yaml)?.review?.external_panel === true; } catch { return false; }
}

// NO TEST REACHES A REAL REVIEWER CLI. Since the reviewer preflight (stage 2), external-review PROBES the vendor before
// any refusal that comes later in it, so a test asserting such a refusal from a panel-on tree, with the developer's PATH,
// passed while billing a probe. And a fake placed first on PATH is not enough: agy is an .exe spawned without a shell,
// a lookup that tries .com and .exe only, so a fake agy.cmd was skipped and the real agy answered stage 3's tests.
// Every directory of the DEVELOPER'S PATH holding a reviewer CLI is removed from the PATH a script is given — the
// caller's PATH or the inherited one; a directory a test added (its fakes) is not in the developer's PATH and stays.
const REVIEWER_CLIS = ['codex', 'agy'];
const CLI_EXTS = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', '.com', '.ps1', ''] : [''];
const PATH_KEY = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
const REAL_CLI_DIRS = new Set(String(process.env[PATH_KEY] ?? '').split(path.delimiter).filter((d) => d
  && REVIEWER_CLIS.some((n) => CLI_EXTS.some((e) => { try { return fs.existsSync(path.join(d, n + e)); } catch { return false; } }))));
export function noRealReviewers(env = {}) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path');
  const value = key ? env[key] : process.env[PATH_KEY];
  const kept = String(value ?? '').split(path.delimiter).filter((d) => d && !REAL_CLI_DIRS.has(d)).join(path.delimiter);
  // One key, spelled as the inherited one: on Windows process.env spells it `Path`, and a second spelling would hand the
  // child two variables, the unfiltered one possibly winning.
  return { ...(key && key !== PATH_KEY ? { [key]: undefined } : {}), [PATH_KEY]: kept };
}

// A PRIVATE DESIGN RECORD, ABSENT FROM THE PUBLIC MIRROR (m2-public-release.plan.md stage 2b; operator, 2026-11-13: "Keep,
// mark as private (Recommended)"). The release snapshot leaves .claude/requests/ and .claude/reviews/ out (ROADMAP D2), so
// a test that reads one of their files has nothing to read there. It skips with this reason, never silently; in this
// repository the file exists and the test runs. Pass as `test(name, { skip: privateRecord(rel) }, fn)`.
export function privateRecord(rel) {
  return fs.existsSync(path.join(REPO_ROOT, rel)) ? false
    : `${rel} is a private design record, kept out of the public mirror (ROADMAP D2), so there is nothing here to check`;
}

// A FILE THE RELEASE SNAPSHOT REPLACES (m2-public-release.plan.md stage 9c; the dry run of 7573fd44 found five tests red in
// the snapshot). publish/manifest.json's `replace` owns which published path takes which source's content, and the source
// never ships under its own name (lib/publish.mjs). So the source's presence is what tells the two trees apart: in this
// repository `CLAUDE.md` is the private contract and publish/CLAUDE.public.md the published one; in the snapshot,
// `CLAUDE.md` IS the published one and the source is absent.
const PUBLISH_REPLACE = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'publish', 'manifest.json'), 'utf8')).replace ?? {}; } catch { return {}; }
})();
// The file holding the published text of `target`: its replace source here, `target` itself in the snapshot.
export function publishedForm(target) {
  const from = PUBLISH_REPLACE[target];
  return from && fs.existsSync(path.join(REPO_ROOT, from)) ? from : target;
}
// A skip reason when `target` is, in this tree, the published replacement of a private file, so a check of the private
// file's text has nothing to read; false otherwise. Never silent: the caller names it as privateRecord's callers do.
export function replacedInSnapshot(target) {
  const from = PUBLISH_REPLACE[target];
  return from && !fs.existsSync(path.join(REPO_ROOT, from))
    ? `${target} here is the published form (publish/manifest.json replaces it with ${from}), so the private file's text is not here to check`
    : false;
}

// HOW LONG ONE runScript CHILD MAY RUN (2026-11-16; operator: "Capture + suite timeout now, rest drafted (Recommended)").
// spawnSync had no timeout, so a child that finished its work but never exited (capture.mjs inside process.exit, a Node
// bug: tests/regression-exit-deadlock-guards.test.mjs) held its test, and so the whole suite, for 3 h 40 min. The slowest
// test took about 102 s on 2026-11-16; ten minutes is well above it. A test needing longer passes its own timeoutMs.
export const RUN_SCRIPT_TIMEOUT_MS = 10 * 60_000;

export function runScript(name, args = [], { env = {}, cwd = REPO_ROOT, mayFanOut = false, mayProbe = false, timeoutMs = RUN_SCRIPT_TIMEOUT_MS } = {}) {
  if (name === 'new-run.mjs' && !mayProbe && mintMayProbe(args, cwd)) {
    throw new Error(
      'runScript would let this mint PROBE REAL REVIEWERS: the contract has review.external_panel on, and new-run checks\n'
      + '  every panel arm and adjudicator through the vendor CLIs on PATH before it creates the run. Pass\n'
      + '  --no-verify-reviewers (the run is stamped REVIEWERS-UNVERIFIED), or { mayProbe: true } with fake reviewers\n'
      + '  first on PATH when the check itself is under test.',
    );
  }
  if (name === 'run-graph.mjs' && !mayFanOut) {
    const at = args.indexOf('--only');
    const only = at === -1 ? null : String(args[at + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const unsafe = only === null ? ['(no --only at all)'] : only.filter((id) => !OFFLINE_SAFE_LENSES.includes(id));
    if (unsafe.length) {
      throw new Error(
        `runScript would let this test SPEND REAL MONEY: --only ${unsafe.join(', ')}.\n`
        + `  Every test in this directory must be free and offline. A lens with condition:always\n`
        + `  spawns a judgment-tier model whatever the fixture declares, so an offline test may only\n`
        + `  name a lens its contract can switch off: ${OFFLINE_SAFE_LENSES.join(', ')}.\n`
        + '  If the refusal BEFORE any spawn is what you are testing, pass { mayFanOut: true }.',
      );
    }
    // NAMED IS NOT SWITCHED OFF (2026-10-27): a lens on the list above is only offline when the run's FROZEN contract turns
    // it off. Five call sites named `--only ui-audit` against a fixture with no `ui:` block, and an absent surface is not
    // `none`, so ui-audit ran on opus at about $0.21 a call, every suite run, and the Claude CLI wrote the operator's own
    // ~/.claude.json (found by tup in the test-selection exploration). A fake runtime (--runtime-bin) spawns nothing real.
    if (!args.includes('--runtime-bin')) {
      const rd = args[args.indexOf('--run-dir') + 1];
      let contract = null;
      let frozen = null;
      try { frozen = JSON.parse(fs.readFileSync(path.join(rd, 'run.json'), 'utf8')); contract = frozen.contract ?? {}; } catch { /* below */ }
      const OFF = { 'ui-audit': (c) => c?.ui?.surface === 'none', 'feature-verify': (c) => !String(c?.commands?.run ?? '').trim() };
      const live = (only ?? []).filter((id) => !OFF[id]?.(contract));
      if (live.length) {
        throw new Error(
          `runScript would let this test SPEND REAL MONEY: --only ${live.join(', ')}, but the run's frozen contract does not `
          + `switch ${live.length > 1 ? 'them' : 'it'} off (${rd ? `${rd}/run.json` : 'no --run-dir'}). Declare \`ui: surface: none\` for `
          + 'ui-audit, an empty `commands.run` for feature-verify, in the fixture\'s contract.',
        );
      }
      // RECOVERY SPAWNS TOO (m2-public-release.plan.md stage 2b): a run with no request and no UNREQUESTED stamp fires
      // request-capture through the real runtime whatever --only selects. It never did in this repository, whose contract
      // declares a request, and did in a snapshot without .claude/requests/ (tests/regression-intent-drift-reach).
      // A minted run records `request`, null when it has none; a hand-written run.json without the key is not checked here.
      if (frozen && 'request' in frozen && frozen.request === null && !(frozen.stamps ?? []).includes('UNREQUESTED')) {
        throw new Error(
          `runScript would let this test SPEND REAL MONEY: ${rd}/run.json has no request and no UNREQUESTED stamp, so `
          + 'run-graph would fire request-capture recovery through the real runtime. Mint with --no-request, or pass --runtime-bin.',
        );
      }
    }
  }
  const res = spawnSync(process.execPath, [path.isAbsolute(name) ? name : path.join(SCRIPTS_DIR, name), ...args], {
    cwd,
    encoding: 'utf8',
    // Inherit, then override. A developer's own GRAPH_NODE_DEPTH or ANTHROPIC_API_KEY must not
    // decide whether a test passes — the depth tests set it explicitly, and everything else runs
    // with it absent.
    // QUORATE_RUN_ID cleared for the same reason as the depth guard (G-34): a developer running the
    // suite from inside a graph node would otherwise have every fixture run directory refused by
    // capture's run pin, at a guard unrelated to what these tests assert.
    // QUORATE_HOME too, for the same reason one level out: a mint writes there now, and the suite
    // must not leave anything in the operator's own home. A caller that needs its own home passes
    // one and wins, as with every other variable here.
    // The INHERITED half loses every secret-shaped name and the runtime's auth, by the engine's own commit scrub (G-37 of
    // 20261122-232627-m3s7-b4-review, I-22): spreading process.env whole handed ANTHROPIC_API_KEY and the developer's
    // other credentials to every child script. A test that needs one passes it in `env`, which still wins.
    env: {
      ...commitEnvFor(process.env),
      GRAPH_NODE_DEPTH: undefined,
      QUORATE_RUN_ID: undefined,
      QUORATE_HOME: TEST_HOME,
      // A RECORD DIRECTORY OF ITS OWN for every call that can probe a reviewer (reviewer-preflight stage 2): TEST_HOME
      // is shared by the whole suite and persists across runs, so a passing probe of one test's fake would otherwise count
      // for 24 hours in another test whose fake must fail. A test that seeds or reuses records passes its own.
      ...(PROBING_SCRIPTS.has(name) ? { QUORATE_REVIEWER_PROBES: freshProbesDir() } : {}),
      ...env,
      ...noRealReviewers(env),
    },
    timeout: timeoutMs,
  });
  // A child stopped at the timeout is a stall, said as one: its status is null and its output partial, which a test would
  // otherwise read as the script's own result.
  if (res.error?.code === 'ETIMEDOUT') {
    throw new Error(`runScript: ${name} did not exit within ${timeoutMs} ms and was stopped (a stalled child; `
      + `tests/regression-exit-deadlock-guards.test.mjs). Output so far:\n${String(res.stdout ?? '').slice(-2000)}${String(res.stderr ?? '').slice(-2000)}`);
  }
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
  };
}

/**
 * The run id a `new-run.mjs` invocation just minted, taken from ITS OWN output.
 *
 * Never read `.claude/reviews/latest.txt` for this. That file is global to the repository and is
 * rewritten by every mint, so two tests minting concurrently — which is the default, since the
 * runner executes test files in parallel — race: the second overwrites the pointer, the first reads
 * the other's run id, and then operates on (and deletes) a run directory belonging to a different
 * test. It surfaces as an unrelated `ENOENT ... gate.json` in whichever test lost, passes on
 * re-run, and passes in isolation, which is the worst diagnostic shape a failure can have.
 *
 * new-run prints the id on its own line; the slug makes the match unambiguous even if the output
 * grows. Asserting on exactly one match is deliberate — a helper that silently picks the first of
 * several would be the same class of positional guess.
 */
export function mintedRunId(output, slug) {
  const found = [...String(output ?? '').matchAll(new RegExp(`^(\\d{8}-\\d{6}-${slug})$`, 'gm'))]
    .map((m) => m[1]);
  assert.equal(found.length, 1,
    `expected exactly one run id for slug '${slug}' in new-run's output, found ${found.length}:\n${output}`);
  return found[0];
}

/**
 * A disposable run directory that this repository's scripts admit, for tests that drive them with --run-dir.
 *
 * A directory carrying its own self-consistent run.json is not authority for where it may be, and that file is what
 * decides which commands the already-authorised capture surface will execute (G-6). Every script that takes one admits
 * it through admitRun (ARCHITECTURE A-28), so a fixture under os.tmpdir() — or under `.sandbox/`, where this helper used
 * to put them — tests a shape no caller has. (scratchRunDir, a temp path for argument-validation tests, went with it:
 * spawn-node refuses such a directory before it reads an argument.)
 *
 * FRESH IN, NOTHING LEFT BEHIND (operator, 2026-09-25). Every call makes a new directory, and the
 * helper removes all it made when the process exits. This said "the caller removes the returned
 * base", and callers did not: 1,653 had piled up in five days. A caller may still remove its own
 * earlier; the exit sweep is forced, so a double removal is harmless.
 */
const madeRunDirs = new Set();
process.once('exit', () => {
  for (const d of madeRunDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort at exit */ } }
});
//
// STAGED WHERE THIS REPOSITORY'S RUNS ARE (run-dir-trust.plan.md stage 2; ARCHITECTURE A-28): a run directory is admitted
// only when it is one of the repository's runs, so a fixture under `.sandbox/` is refused like a counterfeit. It is made
// under the suite's QUORATE_HOME, in the staging root new-run itself uses for this repository, and names REPO_ROOT as
// its repo_root, as a minted run does. `project` is this repository's contract's.
export const REPO_PROJECT = 'quorate';
export function repoRunDir({ runId = '20260101-000000-test', prefix = 'quorate-run-', json = {} } = {}) {
  const staging = defaultReviewsRoot({ project: REPO_PROJECT, repoRoot: REPO_ROOT, home: TEST_HOME });
  fs.mkdirSync(staging, { recursive: true });
  const base = fs.mkdtempSync(path.join(staging, prefix));
  madeRunDirs.add(base);
  const dir = path.join(base, runId);
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
    run_id: runId, repo_root: REPO_ROOT, contract: {}, host: { cwd: REPO_ROOT }, ...json,
  }));
  return { base, dir, runId };
}

/**
 * A SMALL repository for find-inert-features to sweep (test-suite-cost.md). Tests that only need the detector to RUN
 * swept this repository, whose .claude/reviews holds tens of thousands of files: 79 s alone, 10 minutes under the
 * suite's contention. A git repository with a contract, one doc and one source file is all the detector needs to
 * complete. It lives under the repository's own .sandbox (gitignored), so a run.json may name it as host.cwd and
 * capture's confinement still holds; it is removed at exit with the run directories.
 */
export function detectorFixture() {
  const sandbox = path.join(REPO_ROOT, '.sandbox');
  fs.mkdirSync(sandbox, { recursive: true });
  const dir = fs.mkdtempSync(path.join(sandbox, 'quorate-detector-'));
  madeRunDirs.add(dir);
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'docs', 'a.md'), '# a\n\nThe `--frobnicate` flag turns frobnication on.\n');
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: detector-fixture',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: ["docs/**"]', 'ui:', '  surface: none', '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'fixture');
  return dir;
}

/**
 * THE CODES A PLATFORM REFUSES A LINK WITH, the one list (link-failure-owner.plan.md stage 1): Windows without the
 * privilege (EPERM), a filesystem that takes no links of the kind (ENOTSUP, EINVAL on some Windows volumes), access
 * (EACCES), and a hard link across volumes (EXDEV). Any other code is a fault in the test, and is rethrown: libuv's
 * catch-all UNKNOWN most of all, since it names no refusal (G-3 of 20261120-235710-lfo-delivery).
 */
export const LINK_REFUSALS = Object.freeze(['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL', 'EXDEV']);
const KIND = { file: 'file symlink', dir: 'directory symlink', junction: 'directory junction', hard: 'hard link' };

/**
 * A LINK, OR A SAID SKIP: THE ONE PLACE A TEST CATCHES A LINK FAILURE (link-failure-owner.plan.md; design LF-D1 A).
 * Makes a link of `type` (`file`, `dir`, `junction` or `hard`) at `at` to `target`. On a platform's refusal it makes the
 * fallback if one is given, a junction at `at` to `fallback.dir` (a junction can only target a directory), and calls
 * `t.diagnostic('link fallback: directory junction')`; with none, or a refused fallback, it calls `t.skip(<why>)` and
 * returns null, and the caller returns. A hard link takes no fallback. Any other error is rethrown. Returns
 * `{ kind, target }` for the link made. `fs` is injectable for the helper's own tests. The census
 * (regression-link-failures-not-silent) refuses a link call caught anywhere else.
 */
export function makeLink(t, { target, at, type = 'file', fallback = null, fs: io = fs }) {
  const make = (ty, to) => (ty === 'hard' ? io.linkSync(to, at) : io.symlinkSync(to, at, ty));
  const refused = (e) => LINK_REFUSALS.includes(e?.code);
  try { make(type, target); return { kind: KIND[type], target }; } catch (e) {
    if (!refused(e)) throw e;
    if (type === 'hard' || !fallback?.dir) {
      t.skip(`this platform refused a ${KIND[type]} (${e.code}) and the test has no fallback, so its link check did not run`);
      return null;
    }
    try { make('junction', fallback.dir); } catch (e2) {
      if (!refused(e2)) throw e2;
      t.skip(`this platform refused a ${KIND[type]} (${e.code}) and its junction fallback (${e2.code}), so the link check did not run`);
      return null;
    }
    t.diagnostic('link fallback: directory junction');
    return { kind: KIND.junction, target: fallback.dir };
  }
}

/** A disposable directory, removed even when the test throws. */
export function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-verify-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * What the barrier decided, for a ledger fold (ledger-identity plan, stage 5): finding-groups.json plus the merged
 * reconcile payload, one group per finding (`{ file, line, severity, claim, node }`), each `confirmed` at its own
 * severity unless it says `decision`. `judge` limits which groups the payload judges (a batched barrier that failed
 * part-way). The fold reads these, not the kept verdicts.
 */
export function writeReconciled(runDir, findings, { judge = null } = {}) {
  const groups = findings.map((f, i) => ({
    group_id: `G-${i + 1}`, file: f.file, line: f.line,
    findings: [{ node_id: f.node ?? 'code-audit', severity: f.severity, claim: f.claim ?? '' }],
  }));
  fs.writeFileSync(path.join(runDir, 'finding-groups.json'), JSON.stringify({ run_id: path.basename(runDir), groups }));
  const rows = groups.map((g, i) => ({ group_id: g.group_id, decision: findings[i].decision ?? 'confirmed', severity: findings[i].severity }));
  fs.mkdirSync(path.join(runDir, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'evidence', 'reconcile', 'payload.json'),
    JSON.stringify({ run_id: path.basename(runDir), groups: judge === null ? rows : rows.slice(0, judge) }));
}

/** Minimal run directory: enough shape for logic under test, no model involved. */
export function makeRunDir(dir, { runId = '20260101-000000-test', nodes = {} } = {}) {
  const nodesDir = path.join(dir, 'nodes');
  fs.mkdirSync(nodesDir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'run.json'),
    JSON.stringify({ run_id: runId, contract: {}, stamps: [] }, null, 2),
  );
  for (const [id, status] of Object.entries(nodes)) {
    fs.writeFileSync(
      path.join(nodesDir, `${id}.status.json`),
      JSON.stringify({ schema_version: 1, run_id: runId, node_id: id, ...status }, null, 2),
    );
  }
  return { runDir: dir, nodesDir };
}

/**
 * Every node prompt and skill in the framework, as absolute file paths.
 *
 * TWO LIBRARIES SINCE 2026-09-09. `prompts/<id>/PROMPT.md` holds the twelve contracts the
 * orchestrator spawns; `skills/<id>/SKILL.md` holds the ten a person invokes. Tests that enumerate
 * "every skill" mean every set of model instructions this framework ships, which is both.
 *
 * Centralised because three tests hardcoded `skills/**` and all three went red the moment the split
 * landed — and a test that reads one directory does not fail loudly here, it silently checks a
 * smaller population. `regression-doctrine-path` asserting the doctrine reference on 10 files
 * instead of 22 would still have been green.
 */
export function instructionFiles() {
  const out = [];
  for (const [dir, file] of [['prompts', 'PROMPT.md'], ['skills', 'SKILL.md']]) {
    const base = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = path.join(base, d.name, file);
      if (fs.existsSync(p)) out.push(p);
    }
  }
  return out.sort();
}

/** One node's instructions by id, whichever library holds them. Throws rather than returning null. */
export function instructionFile(id) {
  const candidates = [
    path.join(REPO_ROOT, 'prompts', id, 'PROMPT.md'),
    path.join(REPO_ROOT, 'skills', id, 'SKILL.md'),
  ];
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) throw new Error(`no instructions for '${id}' in prompts/ or skills/`);
  return hit;
}

/**
 * A run slug no concurrent mint can collide with.
 *
 * FIXED SLUGS ARE RACY, and not for the reason it looks. `new-run` builds run ids as
 * `YYYYMMDD-HHMMSS-<slug>` and REFUSES an existing directory, so two mints in the same second with
 * the same slug is a hard failure — and the full suite reliably produces exactly that, because
 * `check-counted-facts` spawns an inner `node --test` over the whole suite to count it. Every test
 * file therefore runs TWICE, concurrently, during a full run.
 *
 * The symptom is the worst shape a failure can have: green in isolation, red about once per full
 * run, and pointing at whatever the test was actually asserting rather than at the collision.
 * regression-intent-drift-reach already randomised its slug for this reason; the next test to mint
 * one did not, and lost an hour to it. Now there is one way to ask.
 */
export function mintSlug(prefix) {
  // PREFIXED SO GIT IGNORES IT. A test that mints a run writes into the repository's real reviews
  // directory — that is the point, it is exercising the real path — and removes it in a finally.
  // But `check-counted-facts` spawns an inner `node --test`, so two copies run at once and one
  // copy's cleanup can still be in flight when something else stages the tree. Twice now a fixture
  // run has been swept into a commit that way.
  //
  // `.gitignore` carries `.claude/reviews/tmptest-*/`, so a run minted by a test cannot be
  // committed by accident regardless of who wins that race. The cleanup still runs; this is what
  // makes losing the race harmless instead of embarrassing.
  return `tmptest-${String(prefix).replace(/[^a-z0-9]/g, '')}${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * The run directory new-run just minted, read from its output rather than guessed from a layout.
 *
 * Tests used to rebuild this path themselves — `path.join(project, '.claude', 'reviews', id)` — which
 * encoded WHERE runs live into every test that merely needed one. When run directories moved out of
 * the reviewed tree by default, three tests broke that had nothing to do with the change: they were
 * asserting a location they never meant to pin. new-run prints the path it created; that is the
 * authority, and it is also what an operator copies.
 */
export function mintedRunDir(output) {
  const m = String(output ?? '').match(/^run dir:\s*(.+)$/m);
  assert.ok(m, `new-run printed no run directory:\n${output}`);
  return m[1].trim();
}

/**
 * A PASSING probe record for a fake reviewer, written where a test's calls will look (reviewer-preflight stage 2). A test
 * whose fake stands for a WORKING reviewer says so explicitly with this; one that does not seed has its fake probed, and a
 * fake whose answer is not its mode's shape is then refused (exit 5) — which is what a refusal test asserts.
 *
 * The key is computed by the engine's own code, so it is the key external-review computes: the built-in adapter's
 * definition, the model and effort passed, the mode and schema route, the FAKE's version (run on `pathValue`), this host.
 * It refuses the shared TEST_HOME: a record there would satisfy other tests' refusal cases.
 */
export function seedReviewerProbe(probesDirPath, { reviewer = 'codex', model = '', effort = '', mode = 'review', route = 'native', pathValue }) {
  // CASE-INSENSITIVE ON WINDOWS (G-15 of 20261010-085904-reviewer-preflight-r9): a differently cased path is the same dir.
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  if (!probesDirPath || norm(probesDirPath).startsWith(norm(TEST_HOME))) {
    throw new Error('seedReviewerProbe: pass a probes directory of the test\'s own, never one under the shared TEST_HOME');
  }
  const io = probeIo;
  const adapter = builtinReviewers()[reviewer];
  const limits = io.probeLimits(adapter, rawTable().probe_defaults);
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const version = io.cliVersion(adapter, limits, { env: { ...commitEnvFor(process.env), ...(pathValue ? { [pathKey]: pathValue } : {}) } });
  if (!version.ok) throw new Error(`seedReviewerProbe: the fake's version command failed: ${version.reason}`);
  const combination = {
    adapter: reviewer, adapter_hash: io.adapterHash(adapter), model, effort, mode, route,
    cli_version: version.version, host: os.hostname(), probe_code_hash: io.frameworkProbeCodeHash(),
  };
  const record = { ...combination, key: io.probeKey(combination), state: 'passed', reason: null, checked_at: new Date().toISOString(), ms: 0 };
  fs.mkdirSync(probesDirPath, { recursive: true });
  fs.writeFileSync(path.join(probesDirPath, `${record.key}.json`), JSON.stringify(record, null, 2));
  return record;
}

// THE STOP OWNER'S ONE SEAM (stop-owner-seam.plan.md stage 1; design SS-D1 A, SS-D2 B): a test reaches the owner's kill
// only through `proc`, a whole process interface. `fakeProc` builds one over the host's, putting a test's members on top:
// `kill(pid, opts)` stands for both primitives, answered synchronously by killTreeNow and as a promise by killTree (called
// at once, so a test that counts calls sees them in the same turn); or `killTree` / `killTreeNow` given apart; and
// `isAlive`. `withKill` turns an options object still written with `kill`, `killTree`, `killTreeNow` or `isAlive` into the
// one seam, so a test's assertions stay as they were.
import { hostPlatform as hostPlatformForFakes } from '../scripts/platform/index.mjs';
export function fakeProc({ kill = null, killTree = null, killTreeNow = null, isAlive = null, id } = {}) {
  const p = { ...hostPlatformForFakes().proc };
  if (kill) {
    p.killTreeNow = (pid, o) => kill(pid, o);
    p.killTree = (pid, o) => { try { return Promise.resolve(kill(pid, o)); } catch (e) { return Promise.reject(e); } };
  }
  if (killTree) p.killTree = killTree;
  if (killTreeNow) p.killTreeNow = killTreeNow;
  if (isAlive) p.isAlive = isAlive;
  if (id !== undefined) p.id = id;
  return p;
}
export function withKill(opts = {}) {
  const { kill, killTree, killTreeNow, isAlive, ...rest } = opts;
  if (kill === undefined && killTree === undefined && killTreeNow === undefined && isAlive === undefined) return opts;
  return { ...rest, proc: fakeProc({ kill, killTree, killTreeNow, isAlive }) };
}
