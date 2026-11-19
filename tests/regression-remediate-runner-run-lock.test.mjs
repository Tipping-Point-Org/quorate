// THE REMEDIATION RUNNER, END TO END WITH A FAKE NODE, part 6 of 9: remediation-run-ownership stage 3 and r1-r2: the
// run lock when the runner is killed, completes, cannot remove it, or fails its stray-commit check. Split from
// regression-remediate-runner.test.mjs (split-slow-test-files.md); the fixture is remediate-runner-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, SCRIPTS_DIR } from './helpers.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { git, fakeNode, remAt, fixture, runRem, readRem, linkReconcileInside, setContract, lockOf, CHECK_SCRIPT, checkedFixture, headOf, e2eFixture, e2eEnv, leftInTree, trackedSuite, repoLockOf, holdRepoLock, GUARD_TODAY } from './remediate-runner-fixture.mjs';

test('rro stage 3: a runner killed while the node runs leaves the lock at phase node-running', async (t) => {
  const f = fixture(t);
  const started = path.join(f.repo, '..', 'node-started');
  const release = path.join(f.repo, '..', 'node-release');
  const env = { ...process.env, ...f.env, FAKE_RUN_DIR: f.rem, FAKE_MODE: 'wait', FAKE_STARTED: started, FAKE_RELEASE: release, QUORATE_HOME: f.env.QUORATE_HOME };
  delete env.GRAPH_NODE_DEPTH; delete env.QUORATE_RUN_ID;
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, 'remediate.mjs'), '--run-dir', f.rem, '--runtime-bin', f.bin, '--no-verify-sandbox'],
    { cwd: f.repo, env, stdio: 'ignore' });
  const until = Date.now() + 60000;
  while (!fs.existsSync(started) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  assert.ok(fs.existsSync(started), 'the fake node started');
  const exited = new Promise((r) => child.on('exit', r));
  child.kill('SIGKILL');
  await exited;
  // The fake node writes its pid when it starts, so the wait below is for that process to be gone, whether it finished on
  // release or died with the runner (G-13 of 20261107-072037-split-delivery-3: the wait was for a `.done` file and ended
  // after 30 s unasserted, so a test could pass and delete its fixture while the orphan still ran).
  const pid = Number(fs.readFileSync(started, 'utf8'));
  const alive = () => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  let gone = false;
  try {
    assert.ok(fs.existsSync(lockOf(f)), 'the lock outlives a killed runner');
    assert.equal(JSON.parse(fs.readFileSync(lockOf(f), 'utf8')).phase, 'node-running');
  } finally {
    fs.writeFileSync(release, 'go');   // let the orphaned node finish before the fixture is removed
    const done = Date.now() + 120000;
    while (!(gone = !alive()) && Date.now() < done) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(Number.isInteger(pid) && pid > 0, `the fake node wrote no pid: ${pid}`);
  assert.ok(gone, `the orphaned fake node (pid ${pid}) was still running after 120 s; the fixture would be removed under it`);
});

// Guards, green at HEAD because no lock exists there: labelled, not red-first.
test('rro stage 3 (guard): a completed run, and a refusal before the spawn, leave no lock', (t) => {
  const f = fixture(t);
  runRem(f);
  assert.ok(!fs.existsSync(lockOf(f)), 'completed');
  const g = fixture(t);
  const rj = path.join(remAt(g), 'run.json');
  const { remediates, ...rest } = JSON.parse(fs.readFileSync(rj, 'utf8'));
  fs.writeFileSync(rj, JSON.stringify(rest));   // refused AFTER the lock is taken, before the spawn
  const r = runRem(g);
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(lockOf(g)), 'refused');
});

// G-5 of 20261009-035141-run-ownership-review: the lock's release swallowed EVERY unlink error, so an orderly run could
// report success while leaving remediate.lock behind, and the next invocation refused with exit 6 as though the run were
// held. Only "already gone" is ignored; any other failure is named and the run exits 7.
test('rro r1: a lock that cannot be removed is named, and the run exits 7', (t) => {
  const f = fixture(t);
  const r = runRem(f, ['--test-fail-unlink']);
  assert.equal(r.status, 7, r.output);
  assert.match(r.output, /remediate\.lock.*could not be removed/s);
});

// Round 2 of the remediation-run-ownership delivery review (20261009-041724-run-ownership-r1).
// G-8: the stray-commit check read `git rev-list`'s stdout without its status, so a git failure read as "no stray
// commits" and the runner committed on an unverified HEAD. A failure now stops the run before anything is committed.
test('rro r2: a failed stray-commit check commits nothing and keeps the lock', (t) => {
  const f = fixture(t);
  const head = git(f.repo, 'rev-parse', 'HEAD').stdout.trim();
  const r = runRem(f, ['--test-fail-rev-list']);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /rev-list/);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD').stdout.trim(), head, 'nothing committed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(remAt(f), 'remediate.lock'), 'utf8')).phase, 'node-ran', 'the node ran: the lock is kept');
});

// G-5: a lock that could not be removed set exit 7 over the run's own failure code, and said "this run finished".
test('rro r2: a lock left behind does not mask an earlier failure', (t) => {
  const f = fixture(t);
  const rj = path.join(remAt(f), 'run.json');
  // Already run: refused with exit 2, after the lock is taken. (Not a remediation run is refused before the lock now,
  // when the run is admitted: run-dir-trust.plan.md stage 2.)
  fs.writeFileSync(rj, JSON.stringify({ ...JSON.parse(fs.readFileSync(rj, 'utf8')), followup_run_dir: 'x' }));
  const r = runRem(f, ['--test-fail-unlink']);
  assert.equal(r.status, 2, r.output);
  assert.match(r.output, /could not be removed/);
  assert.doesNotMatch(r.output, /this run finished/);
});
