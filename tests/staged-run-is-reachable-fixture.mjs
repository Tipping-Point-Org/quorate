// staged-run-is-reachable-fixture.mjs — the fixture and helpers regression-staged-run-is-reachable.test.mjs and its
// siblings share, moved out unchanged when the file was split (split-slow-test-files.md). Every top-level name is
// exported.


import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runScript, mintedRunDir, TEST_HOME } from './helpers.mjs';
import { isWithin } from '../scripts/lib/finding-scope.mjs';

// SLUGS UNIQUE PER PROCESS, because this suite runs concurrently WITH ITSELF on every push:
// `check-counted-facts` counts tests by spawning the whole suite again, so two copies of this file
// execute at once. A run id is `YYYYMMDD-HHMMSS-slug` — SECOND resolution — so two mints a
// millisecond apart with a fixed slug produce the SAME id. Each staging root is its own mkdtemp and
// does not collide, but the ARCHIVE destination is the shared `.claude/reviews/<run-id>` inside the
// repository, and this test deletes that path in `finally`. One copy's cleanup then removes the
// other copy's archive, and the assertion fails on a file that existed a moment earlier.
//
// Measured 2026-09-22 under three concurrent suites: "a finished run must be archived back into the
// tree, gate and all" failed in one of three, with nothing wrong in the engine. The pid makes the
// id unique without touching the id format, which is a decision this test has no business making.
const SLUG = (name) => `${name}${process.pid}`;

// `runScript` clears GRAPH_NODE_DEPTH for a reason helpers.mjs states: a developer's own value
// must not leak into a spawned script. The two spawns below bypass runScript, and the first time
// this suite ran INSIDE a lens — at depth 1, which is where the framework reviews itself — the
// external-review test died at exit 3 on its own recursion guard. A component spawned by a test is
// not a graph node spawning another; the guard is right and the test was wrong to inherit it.

/**
 * PATH with every directory holding a reviewer CLI stripped out.
 *
 * This test exists to exercise external-review's two PATH-RELATIVE GATES -- containment and
 * check-ignore -- both of which sit well before the vendor spawn. Its header claimed "no model is
 * spawned, which is what makes it cheap enough to run every time", resting that on the parenthetical
 * "an uninstalled vendor still exercises every gate". On a machine where codex IS installed that
 * premise is simply false, and the run that found this MEASURED the consequence: a real, billed
 * cloud review inside the DECLARED TEST COMMAND, 66.9s of its own 120s timeout, recorded in
 * evidence/pre-flight/test.log. TESTS-FAILING forces the gate to FAIL unconditionally, so vendor
 * latency could turn into a FAIL verdict about code nobody touched.
 *
 * Stripping the vendor from PATH makes the absence a FACT OF THE TEST rather than a fact about the
 * machine -- which is also the flakiness the arms objected to (ARCHITECTURE.md A-15: a probe must
 * not differ from production in any dimension that can fail; "is codex installed here" is one).
 * git and node stay reachable, because external-review asks git for the very roots being tested.
 */
function pathWithoutReviewerClis() {
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', '.ps1', ''] : [''];
  return (process.env.PATH ?? '')
    .split(sep)
    .filter((dir) => dir && !['codex', 'agy'].some((n) => exts.some((e) => {
      try { return fs.existsSync(path.join(dir, n + e)); } catch { return false; }
    })))
    .join(sep);
}

/**
 * Child env with the vendor unreachable and the recursion guard cleared.
 *
 * PATH is deleted case-insensitively before being re-set: on Windows `process.env` is a
 * case-insensitive proxy that usually spells it `Path`, so spreading it and then assigning `PATH`
 * hands the child TWO path variables and the one that wins is not the one this function filtered.
 */
function childEnv(home) {
  const env = { ...process.env, QUORATE_HOME: home, GRAPH_NODE_DEPTH: undefined };
  for (const k of Object.keys(env)) if (/^path$/i.test(k)) delete env[k];
  env.PATH = pathWithoutReviewerClis();
  return env;
}

/** A real mint, staged outside the repository, torn down afterwards. */
function withStagedRun(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-staged-'));
  const mint = runScript('new-run.mjs',
    ['--slug', SLUG('stagedprobe'), '--no-verify-sandbox', '--no-verify-reviewers', '--no-request', '--full-sweep', 'bench'],
    { env: { QUORATE_HOME: home } });
  try {
    assert.equal(mint.status, 0, `mint failed:\n${mint.output.slice(-400)}`);
    const runDir = mintedRunDir(mint.output);
    assert.ok(!isWithin(REPO_ROOT, runDir),
      `the run must be STAGED OUTSIDE the repository for this test to mean anything, got ${runDir}`);
    fn(runDir, home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}







export { SLUG, pathWithoutReviewerClis, childEnv, withStagedRun };
