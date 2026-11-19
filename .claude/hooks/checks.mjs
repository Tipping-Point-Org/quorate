#!/usr/bin/env node
// checks.mjs — the blocking pre-push quality gate.
//
// Runs the commands the repository DECLARES in the graph_contract block of CLAUDE.md, not a
// hardcoded list. The command set is read through `new-run.mjs --print-contract`, so there is
// exactly one YAML parser and one definition of "the checks" in the repo: a hook that
// reimplemented either would drift from the graph the first time the contract changed.
//
// Relationship to the verification graph: this is the cheap gate, the graph is the expensive
// one. This runs on every push and answers "does it build, lint, and pass tests". The graph
// runs on demand and answers "is it correct, conformant, and structurally sound". Neither
// replaces the other, and this one must stay fast enough that nobody reaches for --no-verify.
//
// Exit codes: 0 every declared check passed (or was declared empty and skipped)
//             1 a declared check failed — the push is blocked
//             2 configuration error (no contract, unparseable contract)

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function repoRoot() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('checks: not inside a git repository');
    process.exit(2);
  }
  return r.stdout.trim();
}

const root = repoRoot();

function findNewRun(here, repo) {
  const candidates = [
    path.join(here, '..', '..', 'scripts', 'new-run.mjs'),
    path.join(here, '..', 'scripts', 'new-run.mjs'),
    path.join(here, '..', 'skills', 'quorate', 'scripts', 'new-run.mjs'),
    path.join(here, '..', 'skills', 'scripts', 'new-run.mjs'),
    path.join(repo, 'scripts', 'new-run.mjs'),
    path.join(repo, '.claude', 'scripts', 'new-run.mjs'),
    path.join(repo, '.claude', 'skills', 'quorate', 'scripts', 'new-run.mjs'),
    path.join(repo, '.claude', 'skills', 'scripts', 'new-run.mjs'),
  ];
  // IT MUST BE A QUORATE CHECKOUT, not merely a file with the right name.
  //
  // Whatever this returns is executed with process.execPath on every `git push`, and has
  // lib/decisions.mjs and lib/locate.mjs dynamically imported from beside it. Four of the candidates
  // are rooted in the CONSUMER's repository, so a file the consumer created at
  // `scripts/new-run.mjs` — or a branch that added one — ran as the framework, with the framework's
  // trust (G-1). The consumer's own repository is not untrusted, but "the engine's file came from
  // the engine" is cheap to establish and is the difference between a name collision and an
  // execution.
  //
  // The marker is the plugin manifest at the framework root, which is what makes a directory a
  // quorate checkout at all. A candidate that fails it is skipped rather than run, and if every
  // candidate fails, the caller's existing library-load guard reports a configuration error with
  // remediation — the honest outcome for a checkout this hook cannot locate.
  const isFramework = (c) => fs.existsSync(path.join(path.dirname(c), '..', '.claude-plugin', 'plugin.json'));
  for (const c of candidates) {
    if (fs.existsSync(c) && isFramework(c)) return c;
  }
  // NO UNVALIDATED FALLBACK. This used to return candidate #2 regardless — the very candidate the
  // loop may have just rejected — so the identity gate above governed the happy path and was
  // bypassed on the one path where nothing legitimate was found. A gate with a hole in its default
  // branch is not a gate; it is a comment (found by the sweep that reviewed the gate's own commit).
  return null;
}

const NEW_RUN = findNewRun(HERE, root);
if (!NEW_RUN) {
  // A CONFIGURATION error (exit 2), not a failed check (exit 1) — the same distinction the library
  // guard below draws, for the same reason: nothing was checked, so nothing failed. It comes BEFORE the reader lookup,
  // which needs NEW_RUN (G-1 of 20261014-181622-lf-delivery: below it, this case was a TypeError).
  console.error('checks: could not locate a quorate checkout to run.');
  console.error('        Looked beside this hook and under the repository, and no candidate carried');
  console.error('        .claude-plugin/plugin.json — the marker that makes a directory this engine.');
  console.error('\nUpdate the quorate submodule, or bypass this once with `git push --no-verify`.');
  process.exit(2);
}

// THE ONE CONTRACT READER, beside the framework this hook located (ledger-findings.plan.md stage 4): it runs that same
// framework's new-run, and tells "no contract" from "cannot read one" by new-run's exit code. A framework copy without it
// is a configuration error (exit 2), named — nothing was checked, so nothing failed.
const READER = path.join(path.dirname(NEW_RUN), 'io', 'contract-reader.mjs');
if (!fs.existsSync(READER)) {
  console.error(`checks: the quorate copy at ${path.dirname(path.dirname(NEW_RUN))} has no scripts/io/contract-reader.mjs,`);
  console.error('        so the contract cannot be read. Update the quorate submodule, or bypass this once with `git push --no-verify`.');
  process.exit(2);
}
const { readContract } = await import(pathToFileURL(READER).href);

// ---------------------------------------------------------------- is this push even gated?
// Invoked from pre-push, git supplies one ref line per pushed ref on stdin. The DECISION lives in
// lib/push-gate.mjs so it can be unit-tested; the hook is a shim that decides nothing. Reading
// stdin only under the flag keeps this script usable by hand, where there is no ref list and
// blocking on a read that never resolves would be worse than useless.
if (process.argv.includes('--from-pre-push')) {
  const { pushNeedsGate, secretScanRanges, secretScanArgv, secretScanOutcome, secretScanPolicy, secretScanConfig } = await import(pathToFileURL(path.join(path.dirname(NEW_RUN), 'lib', 'push-gate.mjs')).href);
  let stdin = '';
  try {
    if (!process.stdin.isTTY) stdin = fs.readFileSync(0, 'utf8');
  } catch { /* unreadable stdin is handled below: pushNeedsGate fails closed on an empty list */ }

  // THE SECRET SCAN RUNS ON EVERY PUSH, before the protected-ref decision below exempts feature
  // branches: a secret pushed to any branch on the remote has already left the machine. Only the
  // commits this push adds are scanned. What each outcome means is lib/push-gate.mjs's to decide.
  {
    // WHETHER IT IS REQUIRED IS THE CONTRACT'S TO SAY (G-9 of 20260926-002850-m0-close):
    // `hooks.secret_scan: required | off`, absent meaning required, read through the engine like
    // every other contract key. A contract that cannot be read is treated as absent: required.
    const contract = readContract({ repoRoot: root }).contract ?? {};   // unreadable or absent: required
    const policy = secretScanPolicy(contract);
    if (policy.error) {
      console.error(`\n[FAIL] secret scan — ${policy.error}`);
      process.exit(2);
    }
    if (policy.mode === 'off') {
      console.error('pre-push: secret scan OFF by declaration (hooks.secret_scan: off) — this push was not scanned');
    } else {
      const { all, ranges } = secretScanRanges(stdin);
      // The framework's key-value rule (ledger-trust-boundaries 1b), unless the repository has its own config.
      const config = secretScanConfig({ repoRoot: root, frameworkRoot: path.dirname(path.dirname(NEW_RUN)), exists: fs.existsSync });
      for (const range of all ? [null] : ranges) {
        process.stdout.write(`\n[secret scan] gitleaks ${range ?? 'full history'}\n`);
        const r = spawnSync('gitleaks', secretScanArgv(root, range, { config }), { cwd: root, stdio: 'inherit' });
        const outcome = secretScanOutcome(r.error?.code === 'ENOENT' ? { missing: true } : { status: r.status });
        if (outcome.block) {
          console.error(`\n[FAIL] secret scan — ${outcome.message}`);
          console.error('\nUse `git push --no-verify` to bypass in an emergency.');
          process.exit(1);
        }
      }
    }
  }

  const { gate, reason } = pushNeedsGate(stdin);
  if (!gate) {
    console.error(`pre-push: ${reason} — checks skipped (they run when this lands on main/master, and in CI)`);
    process.exit(0);
  }
}

// The shared decisions come from the framework the resolved new-run.mjs belongs to — the same
// dynamic resolution findNewRun already did, extended to the library. This kills the hook's two
// private copies: the argv-split (G-1) and the framework-root derivation (G-4), each of which
// had begun drifting from the module that owns the fact.
let contractArgv, resolveFrameworkDirs;
try {
  ({ contractArgv } = await import(pathToFileURL(path.join(path.dirname(NEW_RUN), 'lib', 'decisions.mjs')).href));
  // scripts/io/, not lib/: lib/locate takes the platform as `io` (os-platform-adapters stage 3), and
  // the bound version supplies it. This file and that module always come from the same checkout —
  // an installed hook is a shim into the framework — so they cannot disagree about the split.
  ({ resolveFrameworkDirs } = await import(pathToFileURL(path.join(path.dirname(NEW_RUN), 'io', 'locate.mjs')).href));
} catch (e) {
  // A missing library is a CONFIGURATION error (exit 2, with remediation), never 'a declared
  // check failed' (exit 1): unguarded, a rejected top-level await died with a stack trace and
  // Node's exit 1, inverting this file's own documented exit-code contract on exactly the
  // checkouts least equipped to interpret it — a stale submodule or broken layout (G-1).
  console.error(`checks: could not load the framework's shared libraries beside ${NEW_RUN}`);
  console.error(`        (${e.message})`);
  console.error('\nThe framework checkout is incomplete or stale. Update the quorate submodule,');
  console.error('or bypass this once with `git push --no-verify`.');
  process.exit(2);
}

const read = readContract({ repoRoot: root });
if (!read.contract) {
  console.error('checks: could not read the graph_contract block from CLAUDE.md');
  console.error(String(read.message ?? read.error ?? '').trim());
  // DERIVED, not a literal (G-2). This named `.claude/skills/shared/claude-md-contract.md`, a path
  // that exists in NEITHER layout — this repository has no `.claude/skills/` at all, and the
  // documented consumer mount puts the file under `.claude/skills/quorate/shared/`. The one
  // remediation offered on a configuration failure pointed at nothing, on the checkout least
  // equipped to work out where the file really is. The framework root is derivable from the
  // new-run.mjs this hook already located.
  const contractDoc = path.join(path.dirname(path.dirname(NEW_RUN)), 'shared', 'claude-md-contract.md');
  console.error(`\nAdd the block documented in ${contractDoc},`);
  console.error('or bypass this once with `git push --no-verify`.');
  process.exit(2);
}

const contract = read.contract;

const commands = contract.commands ?? {};

// Order matters: fail on the cheapest, most-deterministic check first so a formatting slip does
// not cost a full test run before it is reported.
const ORDER = [
  { key: 'fmt_check', label: 'format', fix: 'run the formatter and re-stage' },
  { key: 'lint', label: 'lint', fix: 'fix the diagnostics above' },
  { key: 'typecheck', label: 'typecheck', fix: 'fix the type errors above' },
  { key: 'build', label: 'build', fix: 'fix the build errors above' },
  { key: 'test', label: 'tests', fix: 'fix the failing tests above' },
  // Supply-chain checks run LAST despite being fast, because they are the one class of failure
  // the commit being pushed usually did not cause: an advisory published upstream overnight
  // blocks a push that touched nothing related. Ordering them last means the developer sees
  // every failure they can actually fix before hitting one they cannot.
  { key: 'audit', label: 'advisories', fix: 'update the affected dependency, or --no-verify if the advisory is upstream and unactionable' },
  { key: 'deny', label: 'dependencies', fix: 'resolve the banned or duplicate dependency above' },
];

const skipped = [];
let failed = null;
let testsCounted = null;

for (const c of ORDER) {
  const cmd = (commands[c.key] ?? '').trim();
  if (!cmd) {
    // A check the contract does not declare is SKIPPED and named, never silently treated as a
    // pass. This is the same degradation rule the lenses follow (disk-first-protocol §7).
    skipped.push(c.key);
    continue;
  }
  process.stdout.write(`\n[${c.label}] ${cmd}\n`);
  // contractArgv is the SHARED decision (lib/decisions.mjs), the same one run-checks uses:
  // `commands.shell` empty means argv-split with no shell. The first fix here reimplemented the
  // two-line parse character for character, which left the entry points free to drift again —
  // the exact defect the fix was closing (G-1). One owner now.
  const argv = contractArgv(cmd, commands.shell);
  // Streaming for EVERY step, the test step included. The count the counted-facts step reuses
  // arrives through QUORATE_COUNT_FILE — run-all writes its orchestration-suite count to a file
  // this hook names — which replaces both the whole-run buffering (a silent terminal for the
  // suite's entire duration, G-2) and the first-match scrape that read the PRODUCT suite's count
  // whenever commands.test_product was itself a node --test run (G-3).
  const isTest = c.key === 'test';
  const countFile = path.join(os.tmpdir(), `quorate-count-${process.pid}.txt`);
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: root, shell: false, stdio: 'inherit',
    ...(isTest ? { env: { ...process.env, QUORATE_COUNT_FILE: countFile } } : {}),
  });
  if (isTest) {
    try {
      const n = fs.readFileSync(countFile, 'utf8').trim();
      if (/^\d+$/.test(n)) testsCounted = n;
      fs.unlinkSync(countFile);
    } catch { /* an absent count file just means the counter re-counts */ }
  }
  if (r.status !== 0) {
    failed = { ...c, cmd, code: r.status };
    break;
  }
}

// COUNTED-FACTS ORDERING (G-2): this runs on `!failed`, and the command loop breaks on the first
// failure — including audit/deny, which are ordered last precisely because an upstream advisory is
// not the pushed commit's fault. So a stale documented count could be masked by an unrelated
// supply-chain failure for one push cycle. Accepted as a LOW: the push is BLOCKED either way, so
// nothing false passes the gate; the cost is one extra cycle, and reordering counted-facts before
// audit/deny would trade that for running a doc check before the code checks it documents.
// One framework-own check beyond the contract: numbers the FRAMEWORK's docs state must match the
// framework's tree. Three rules, each bought by a reviewed defect:
//
//   FRAMEWORK REPO ONLY (G-3). check-counted-facts verifies the engine's own CLAUDE.md/QUORATE.md
//   against the engine's own skills/ and tests/. Running it from a consumer's push gate blocked
//   the consumer on facts they neither own nor can fix, while never checking their docs at all.
//   A consumer push skips it, NAMED, like every other undeclared check.
//
//   REUSE THE COUNT (G-3). The test step above already ran the suite; passing --tests-count means
//   the counter does not run it a second (and, through the dogfood test, third) time on a gate
//   whose own header demands it stay fast enough that nobody reaches for --no-verify.
//
//   ABSENCE IS NOT A PASS (G-2). In the framework repo, a missing checker is a configuration
//   failure, not a silent skip — the exact absent-file-reads-as-pass defect the pre-push hook
//   bodies were themselves rewritten to fix.
if (!failed) {
  const factsScript = path.join(path.dirname(NEW_RUN), 'check-counted-facts.mjs');
  // From the module that owns the fact (lib/locate.mjs), not a second inline derivation seeded
  // by this hook's own candidate list (G-4): a layout locate.mjs learns about and this file did
  // not would have silently turned the framework repo into a "consumer" and skipped the gate.
  const frameworkRoot = path.resolve(resolveFrameworkDirs(path.dirname(NEW_RUN)).frameworkRoot);
  if (path.resolve(root) !== frameworkRoot) {
    skipped.push('counted facts (framework-internal; verifies the engine\'s own docs)');
  } else if (!fs.existsSync(factsScript)) {
    failed = {
      label: 'counted facts', cmd: `node ${factsScript}`, code: 2,
      fix: 'check-counted-facts.mjs is missing beside new-run.mjs — the framework checkout is incomplete',
    };
  } else {
    const argvFacts = [factsScript, ...(testsCounted ? ['--tests-count', testsCounted] : [])];
    process.stdout.write(`\n[counted facts] node ${path.relative(root, factsScript)}${testsCounted ? ` --tests-count ${testsCounted}` : ''}\n`);
    const r = spawnSync(process.execPath, argvFacts, { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) {
      failed = {
        label: 'counted facts', cmd: `node ${factsScript}`, code: r.status,
        fix: 'update the stated count in CLAUDE.md to match the tree',
      };
    }
  }
}

console.log('');
if (skipped.length) console.log(`skipped (not declared): ${skipped.join(', ')}`);

if (failed) {
  console.error(`\n[FAIL] ${failed.label} exited ${failed.code} — ${failed.fix}`);
  console.error(`       ${failed.cmd}`);
  console.error('\nUse `git push --no-verify` to bypass in an emergency.');
  process.exit(1);
}

console.log('[OK] all declared checks passed.');
process.exit(0);
