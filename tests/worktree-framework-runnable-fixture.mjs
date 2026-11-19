// worktree-framework-runnable-fixture.mjs — the fixture and helpers regression-worktree-framework-runnable.test.mjs and
// its siblings share, moved out unchanged when the file was split (split-slow-test-files.md). Every top-level name is
// exported.


import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { copyTrackedInto } from '../scripts/io/worktree.mjs';
import { frameworkStamp } from '../scripts/io/version.mjs';

/**
 * Is quorate INSTALLED in this worktree, by quorate's own definition?
 *
 * "The files are present" is not that definition, and using it was the mistake this function
 * replaces: presence is what a `ls` proves, while being installed is what the documented procedure
 * produces — mounted where the plugin is discovered, with a contract the engine can read. quorate
 * already owns that question in `check-install.mjs`, so the test asks IT rather than inventing a
 * weaker criterion and calling the result active.
 *
 * Run from INSIDE the worktree, because that is where the arm stands.
 */
function assertInstalled(dir, fwRel, layout) {
  const r = spawnSync(process.execPath,
    [path.join(dir, fwRel, 'scripts', 'check-install.mjs')], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0,
    `${layout}: quorate is not installed in the arms' checkout, by its own check:\n`
    + `${r.stdout}${r.stderr}`);
  return r;
}

/** What an arm standing in `dir` must be able to reach, given the framework at `fw` within it. */
function assertRunnable(dir, fwRel, layout) {
  const fw = path.join(dir, fwRel);
  for (const rel of ['shared/disk-first-protocol.md', 'scripts/find-inert-features.mjs']) {
    assert.ok(fs.existsSync(path.join(fw, rel)),
      `${layout}: ${rel} is missing from the arms' checkout, and the arm is ordered to use it`);
  }
  // PRESENT IS NOT RUNNABLE. The detector is a script the arm executes, so the test executes it --
  // from inside the worktree, the way the arm does.
  const r = spawnSync(process.execPath,
    [path.join(fw, 'scripts', 'find-inert-features.mjs'), '--repo-root', dir],
    { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0,
    `${layout}: the detector did not run in the worktree:\n${(r.stderr || '').slice(0, 600)}`);
}






export { assertInstalled, assertRunnable };
