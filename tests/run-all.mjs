#!/usr/bin/env node
// run-all.mjs — the project's whole test command, in one process.
//
// It exists because `commands.test` in the contract is argv-split with no shell (`shell: ""`), so
// `cargo test && node --test ...` is not expressible there. Rather than give the graph a shell —
// which would widen what every declared command can do, to save one `&&` — the composition lives
// here where it is readable.
//
// NO GRAPH_NODE_DEPTH GUARD, for the same reason capture.mjs and find-inert-features.mjs carry
// none: this starts no graph work. It runs `cargo test` and `node --test`, and the pre-flight
// barrier that invokes it already runs at depth 0. See shared/disk-first-protocol.md §8.
//
// Exit codes: 0 every suite passed · 1 at least one failed.

import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, '..', 'scripts');
const SUITE_REPORTER = path.join(HERE, 'tools', 'suite-file-reporter.mjs');

// From git, not by counting directories. See the matching note in helpers.mjs: a fixed depth
// encodes one installation layout and resolves to the wrong real directory in any other.
const REPO_ROOT = (() => {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', cwd: HERE });
  return r.status === 0 && r.stdout.trim()
    ? path.resolve(r.stdout.trim())
    : path.resolve(HERE, '..', '..', '..');
})();

// The product's test command comes from the CONTRACT, never from here. This file briefly hardcoded
// `cargo test -p novafind-core ...`, which put the name of the project being verified inside the
// verification framework — exactly the coupling the contract exists to prevent, and the first thing
// that would break on extracting .claude/skills to its own repository.
//
// Read through --print-contract rather than by parsing CLAUDE.md again: one parser, one place it
// can be wrong.
function productTestCommand() {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'new-run.mjs'), '--print-contract'], {
    cwd: REPO_ROOT, encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error('run-all: could not read the contract; running the orchestration suite only');
    return '';
  }
  try {
    return (JSON.parse(r.stdout).commands?.test_product ?? '').trim();
  } catch {
    return '';
  }
}

// WHETHER THIS RUN WRITES A SUITE RECORD (telemetry-run-time.plan.md stage 3): only in the developer's own checkout of the
// engine — the one with the machine-local, gitignored .claude/dev-install.json — and never from inside graph work. A
// remediation's candidate check runs here in place at GRAPH_NODE_DEPTH 1; the arms' snapshot, a fixture's copy, a fresh
// clone and the pinned dev install have no dev-install.json. Decided before anything is imported, so a copy of this
// file without the engine beside it runs as before.
const SUITE_RECORD = fs.existsSync(path.join(REPO_ROOT, '.claude', 'dev-install.json'))
  && ['', '0'].includes(process.env.GRAPH_NODE_DEPTH ?? '') && fs.existsSync(SUITE_REPORTER);

const productCmd = productTestCommand();
const SUITES = [];

// Empty is legitimate and is NOT silently skipped — a product with no declared tests is a fact the
// run should state, in the same spirit as every other empty contract key.
if (productCmd) {
  const [cmd, ...args] = productCmd.split(/\s+/);
  SUITES.push({ name: `product tests (${cmd})`, cmd, args });
} else {
  console.log('run-all: commands.test_product is empty — no product tests declared');
}

SUITES.push({
  name: 'orchestration regressions',
  cmd: process.execPath,
  // Derived from THIS file's location, not written as a literal. The literal was
  // `.claude/skills/tests/**/*.test.mjs`, which matched nothing once the framework moved to plugin
  // layout — and node --test reports success for a glob that matches no files, so the suite
  // announced "1/1 suite(s) passed" having run zero tests. A green light for an empty run is worse
  // than a red one.
  //
  // Node expands the glob itself, so this still survives argv-splitting with no shell.
  args: ['--test', path.join(HERE, '**', '*.test.mjs')],
  // Below this, something is wrong with discovery rather than with the code under test.
  minTests: 20,
});

let failed = 0;
// THE COUNTED-FACTS OUTCOME, for the remediation runner (remediation-verification stage 4; operator, 2026-10-13: "Gate on
// failing tests"): a drift alone may commit, so the runner must tell a drift from every other cause of exit 1 — the
// floor, a failing product suite — without reading prose. Written to the file the caller names, as the count is.
const factsOut = { tests: null, min_tests: null, drifted: false, message: '', failed_suites: [] };
for (const s of SUITES) {
  console.log(`\n=== ${s.name} ===`);
  // STREAM live to the terminal (stdio inherit) while a TAP reporter to a temp file gives the
  // count — no silent terminal for the suite's duration (G-1), and no whole-run buffer (G-2).
  // For a node --test suite: dual reporters, spec to inherited stdout, tap to the count file.
  // A non-node suite (a product's `cargo test`) streams and its minTests is not enforced here.
  const isNodeTest = s.cmd === process.execPath && s.args.includes('--test');
  const tapFile = isNodeTest ? path.join(HERE, `.run-all-tap-${process.pid}-${SUITES.indexOf(s)}.txt`) : null;
  // THE SUITE RECORD (telemetry-run-time.plan.md stage 3): each test file's time and counts, for the orchestration suite.
  const filesFile = s.minTests && SUITE_RECORD ? path.join(HERE, `.run-all-files-${process.pid}.jsonl`) : null;
  // Reporter flags must precede `--test` in node's arg parser, so they are prepended, not appended.
  const spawnArgs = tapFile
    ? ['--test-reporter=spec', '--test-reporter-destination=stdout',
       '--test-reporter=tap', `--test-reporter-destination=${tapFile}`,
       ...(filesFile ? [`--test-reporter=${pathToFileURL(SUITE_REPORTER).href}`, `--test-reporter-destination=${filesFile}`] : []),
       ...s.args]
    : s.args;
  const startedAt = new Date().toISOString();
  // NO TEST REACHES THE OPERATOR'S CLAUDE ACCOUNT OR HOME (2026-10-27; operator: "That's unacceptable"). Five call sites
  // started the real Claude CLI by accident, which spent on opus and wrote ~/.claude.json, a backup and a session key. The
  // offline guard in helpers.mjs stops that route; this stops every route, for the orchestration suite: each test
  // process inherits a throwaway CLAUDE_CONFIG_DIR and blank credentials, so a real CLI started anywhere in the tree can
  // neither authenticate nor write to the home, and anything it writes lands here, where the check after the run sees it.
  const claudeConfig = s.minTests ? fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-suite-claude-')) : null;
  // AND NO TEST WRITES THE OPERATOR'S ENGINE HOME (stdin-folder-owner.plan.md stage 1): every test process gets the suite's
  // own, the same folder tests/helpers.mjs names TEST_HOME, whatever QUORATE_HOME the operator's shell carries.
  const suiteEnv = claudeConfig
    ? { ...process.env, QUORATE_HOME: path.join(os.tmpdir(), 'quorate-test-home'), CLAUDE_CONFIG_DIR: claudeConfig,
      CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' }
    : process.env;
  const r = spawnSync(s.cmd, spawnArgs, { cwd: REPO_ROOT, stdio: 'inherit', shell: false, env: suiteEnv });
  if (claudeConfig) {
    const leaked = fs.readdirSync(claudeConfig);
    fs.rmSync(claudeConfig, { recursive: true, force: true });
    if (leaked.length) {
      console.error(`run-all: a test started the real Claude CLI: it wrote ${leaked.slice(0, 5).join(', ')} into the suite's throwaway `
        + 'config folder. No test may reach a real model or the home folder; find the spawn and give it a fake runtime.');
      failed++;
      factsOut.failed_suites.push(`${s.name} (a real Claude CLI ran)`);
    }
  }
  if (filesFile && !r.error) {
    try {
      const { writeSuiteRecord } = await import(pathToFileURL(path.join(SCRIPTS_DIR, 'io', 'telemetry-record.mjs')).href);
      const w = writeSuiteRecord(REPO_ROOT, { linesFile: filesFile, startedAt, endedAt: new Date().toISOString(), exitCode: r.status });
      if (!w.ok) console.error(`run-all: ${w.note}`);
    } catch (e) { console.error(`run-all: suite record not written: ${e.message}`); }
    try { fs.unlinkSync(filesFile); } catch { /* never written: the record above said so */ }
  }
  let tap = '';
  if (tapFile) { try { tap = fs.readFileSync(tapFile, 'utf8'); fs.unlinkSync(tapFile); } catch { /* count falls to 0 */ } }

  if (r.error) {
    console.error(`run-all: could not launch ${s.cmd}: ${r.error.message}`);
    failed++;
    factsOut.failed_suites.push(s.name);
    continue;
  }
  if (r.status !== 0) {
    console.error(`run-all: ${s.name} FAILED (exit ${r.status})`);
    failed++;
    factsOut.failed_suites.push(s.name);
    continue;
  }

  // A suite that ran NOTHING is not a suite that passed. node --test exits 0 for a glob matching no
  // files, so a stale path reports success having verified nothing — and the pre-flight barrier
  // would record `PASS test` for it. Assert a floor, and say plainly what it means when unmet:
  // discovery is broken, not the code. The count comes from the TAP `# tests N` plan line.
  if (s.minTests) {
    const ran = Number(tap.replace(/\x1b\[[0-9;]*m/g, '').match(/^\s*#\s*tests\s+(\d+)/m)?.[1] ?? 0);
    // The orchestration suite's count, written to a file the CALLER names. The pre-push hook used
    // to scrape the first 'tests N' line out of the combined output — which is the PRODUCT
    // suite's count the moment commands.test_product is itself a node --test run, so the hook
    // verified CLAUDE.md's number against a suite that never counted the regression tests (G-3) —
    // and had to buffer the whole run to scrape at all, presenting a silent terminal for the
    // duration (G-2). A named file has no first-match ambiguity and costs the streaming nothing.
    if (process.env.QUORATE_COUNT_FILE) {
      try { fs.writeFileSync(process.env.QUORATE_COUNT_FILE, String(ran)); } catch { /* a courtesy; the suite result is the contract */ }
    }
    factsOut.tests = ran;
    factsOut.min_tests = s.minTests;
    if (ran < s.minTests) {
      console.error(
        `run-all: ${s.name} reported ${ran} test(s), expected at least ${s.minTests}. ` +
        `A suite that discovers nothing must not pass — check the test glob, not the code.`,
      );
      failed++;
      factsOut.failed_suites.push(`${s.name} (below its floor of ${s.minTests})`);
    } else {
      // THE STATED COUNTS, CHECKED WITH THE COUNT THIS RUN JUST READ (operator, 2026-10-07). A test inside the suite
      // used to run check-counted-facts with no count, which re-ran the whole suite: 135.5 s of a 139 s wall-clock.
      // Here the count is already known, so the check costs a file read, and every local run and review pre-flight
      // still fails on a CLAUDE.md or README.md number the tree no longer has.
      const facts = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'check-counted-facts.mjs'), '--tests-count', String(ran)],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (facts.status !== 0) {
        console.error(`run-all: counted facts drifted —\n${facts.stdout ?? ''}${facts.stderr ?? ''}`);
        failed++;
        factsOut.drifted = true;
        factsOut.message = `${facts.stdout ?? ''}${facts.stderr ?? ''}`.trim();
      }
    }
  }
}

// Report both suites even when the first fails. A run that stops at the first red hides how much
// else is broken, and the pre-flight barrier captures this output as evidence — partial evidence
// is what makes a reviewer guess.
if (process.env.QUORATE_FACTS_FILE) {
  try { fs.writeFileSync(process.env.QUORATE_FACTS_FILE, JSON.stringify(factsOut)); } catch { /* absent: the runner refuses a drift it cannot read */ }
}
console.log(`\nrun-all: ${SUITES.length - failed}/${SUITES.length} suite(s) passed`);
process.exit(failed ? 1 : 0);
