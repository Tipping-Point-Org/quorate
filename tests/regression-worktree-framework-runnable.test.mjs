// A PANEL WORKTREE MUST LEAVE QUORATE RUNNABLE, in whichever layout the project mounts it.
//
// The rule, in the operator's words: if you are trying to RUN quorate inside the worktree, it has
// to be active there; if you are not, nothing is needed. The arms are trying to. The
// doc-consistency lens and the codex arm shadowing it are both ordered to
// `node <framework-root>/scripts/find-inert-features.mjs` -- "Run the detector. Do not eyeball
// this." -- and every lens prompt names the doctrine file the brief points at.
//
// In THIS repository both are ordinary tracked files at the worktree root, so a bare
// `git worktree add` satisfies the rule by accident. In the documented consumer mount the framework
// is a submodule, and `git worktree add` leaves every submodule an EMPTY DIRECTORY: measured in the
// story-pipeline fixture, panel-codex-docs came back DEGRADED reporting "The required doctrine file
// and mandatory find-inert-features.mjs detector were absent" -- an accurate report about a
// checkout this engine built for it, recorded in the gate as the arm being unavailable.
//
// The accident is the problem. Nothing held the two layouts to the same standard, so the one that
// worked for free hid the one that did not.
//
// PRESENCE IS NOT INSTALLATION, and the first version of this file got that wrong. It argued that
// quorate was "active" in its own worktree because the detector was a tracked file there and
// executed — which is a criterion invented to fit the evidence, not the one the project publishes.
// The operator's correction was exact: "this do not make them active. following any install
// procedure does." QUORATE.md's procedure is mount, then declare the contract; check-install.mjs is
// quorate's own answer to whether both hold. So these tests ask that tool, from inside the
// worktree, instead of settling for a file that happens to run.
//
// It is not a formality. The detector refuses outright without a readable graph_contract, and the
// story-pipeline fixture's own worktree reports STALE today — two ways an "obviously present"
// framework is not an installed one.
// Split into 2 files by split-slow-test-files.md; the others are regression-worktree-framework-runnable-*.test.mjs, and the
// fixture they share is worktree-framework-runnable-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { copyTrackedInto } from '../scripts/io/worktree.mjs';
import { frameworkStamp } from '../scripts/io/version.mjs';
import { assertInstalled, assertRunnable } from './worktree-framework-runnable-fixture.mjs';

test('self layout: a worktree of this repository leaves the detector runnable', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-selfwt-')));
  fs.rmSync(dir, { recursive: true, force: true });   // worktree add wants a non-existent path
  try {
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', dir, 'HEAD'], { cwd: REPO_ROOT });
    // frameworkRoot === repoRoot here, so the framework prefix is empty: the files sit at the root.
    assertRunnable(dir, '.', 'self');
    // The self case answers "nothing to install" and exits 0 -- quorate's own verdict, and a
    // DEFINITIONAL one: frameworkRoot equals repoRoot, so the mount question is skipped rather
    // than satisfied. Asserted anyway, because the day that stops being true is the day a
    // self-review is running against something nobody installed.
    const r = assertInstalled(dir, '.', 'self');
    assert.match(r.stdout, /running inside the framework repository itself/);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: REPO_ROOT });
    spawnSync('git', ['worktree', 'prune'], { cwd: REPO_ROOT });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
