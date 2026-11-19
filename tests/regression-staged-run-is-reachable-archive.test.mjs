// Part 2 of 2 of regression-staged-run-is-reachable.test.mjs: a staged run gated and archived, and the operator home.
// Split by split-slow-test-files.md; the fixture is staged-run-is-reachable-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runScript, mintedRunDir, TEST_HOME } from './helpers.mjs';
import { isWithin } from '../scripts/lib/finding-scope.mjs';
import { SLUG, pathWithoutReviewerClis, childEnv, withStagedRun } from './staged-run-is-reachable-fixture.mjs';

// DEFECT 3's consequence — the run completes and returns to the tree.
test('a staged run reaches its gate and is archived back into the repository', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-staged-'));
  let archived = null;
  try {
    const mint = runScript('new-run.mjs',
      ['--slug', SLUG('stagedgate'), '--no-verify-sandbox', '--no-verify-reviewers', '--no-request', '--full-sweep', 'bench'],
      { env: { QUORATE_HOME: home } });
    assert.equal(mint.status, 0, mint.output.slice(-300));
    const runDir = mintedRunDir(mint.output);

    // `--only ui-audit` selects a lens whose condition is unmet here (ui.surface: none), so NOTHING
    // spawns and no model is billed — while run-graph still has to accept the run directory, write a
    // gate, and archive. That is the whole out-of-tree path for the price of a process.
    const graph = runScript('run-graph.mjs',
      ['--run-dir', runDir, '--skip-panel', '--only', 'ui-audit'], { env: { QUORATE_HOME: home } });
    assert.notEqual(graph.status, 2,
      `run-graph refused the staged run directory outright:\n${graph.output.slice(-400)}`);

    archived = path.join(REPO_ROOT, '.claude', 'reviews', path.basename(runDir));
    assert.ok(fs.existsSync(path.join(archived, 'gate.md')),
      'a finished run must be archived back into the tree, gate and all — that is what keeps the '
      + 'committed evidence trail growing without anything to back up separately');
    assert.ok(!fs.existsSync(runDir), 'and the staged copy must be gone, not left as a second truth');
  } finally {
    if (archived) fs.rmSync(archived, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the suite itself never writes into the operator home', () => {
  // Runs default under QUORATE_HOME, so a test that minted one without overriding it left a staged
  // run in ~/.quorate: outside the repository, hidden by no gitignore, cleaned by nothing. Twelve
  // had accumulated within an hour of the default changing.
  assert.ok(TEST_HOME.startsWith(os.tmpdir()),
    'helpers must point every spawned script at a temp home, not the real one');
});
