// THE REMEDIATION RUNNER, END TO END WITH A FAKE NODE (remediate-rebuild.plan.md stage 4; design decisions 1, 5, 6, 8).
// A review with one confirmed group → new-run --remediates → remediate.mjs: the node is spawned in its own context under
// the remediation policy, with its own contract (prompts/remediation/PROMPT.md, not the session skill); it commits a test
// and a fix together reported as one cluster, which the runner commits; it records the remediation's commits and mints the follow-up
// review — carrying follows_remediation — without running it, and never pushes. A graph node may not start it (§8).
// Split into nine files by split-slow-test-files.md; the others are regression-remediate-runner-*.test.mjs, and the
// fixture they share is remediate-runner-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, SCRIPTS_DIR } from './helpers.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { git, fakeNode, remAt, fixture, runRem, readRem, linkReconcileInside, setContract, lockOf, CHECK_SCRIPT, checkedFixture, headOf, e2eFixture, e2eEnv, leftInTree, trackedSuite, repoLockOf, holdRepoLock, GUARD_TODAY } from './remediate-runner-fixture.mjs';

test('the runner spawns the remediation node, records its commits, and mints the follow-up review without running it', (t) => {
  const f = fixture(t);
  const head0 = git(f.repo, 'rev-parse', 'HEAD').stdout.trim();
  const r = runScript('remediate.mjs', ['--run-dir', f.rem, '--runtime-bin', f.bin, '--no-verify-sandbox'],
    { cwd: f.repo, env: { ...f.env, FAKE_RUN_DIR: f.rem } });
  assert.equal(r.status, 0, r.output);
  const run = JSON.parse(fs.readFileSync(path.join(remAt(f), 'run.json'), 'utf8'));
  assert.equal(run.remediation_commits.length, 1, 'one cluster, one commit');
  assert.equal(git(f.repo, 'rev-parse', 'HEAD~1').stdout.trim(), head0);
  const files = git(f.repo, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n').sort();
  assert.deepEqual(files, ['src/a.js', 'tests/a.test.js'], 'the test and the fix landed together');
  assert.ok(fs.existsSync(path.join(remAt(f), 'evidence', 'remediation', 'payload.json')), 'the report is kept');
  assert.equal(fs.readFileSync(f.log, 'utf8').trim(), 'contract', 'the node got its own contract, not the session skill');
  const follow = run.followup_run_dir;
  assert.ok(follow && fs.existsSync(path.join(follow, 'run.json')), 'the follow-up review was minted');
  t.after(() => fs.rmSync(follow, { recursive: true, force: true }));
  const fr = JSON.parse(fs.readFileSync(path.join(follow, 'run.json'), 'utf8'));
  assert.equal(fr.follows_remediation.run_id, run.run_id);
  assert.equal(fr.base_commit, head0, 'the follow-up reviews the remediation\'s own diff');
  assert.equal(fs.existsSync(path.join(follow, 'gate.json')), false, 'minted, not run');
  // The script path is printed quoted since G-9 of 20261108-065111-si-remediation-7-review (operator, 2026-11-08: "A. Fix 2
  // test lines, retry (Recommended)"), so the closing quote is accepted after it.
  assert.match(r.output, /run-graph\.mjs"? --run-dir/, 'the command to run it is printed');
  // With the repository it was admitted for (run-dir-descendants.plan.md stage 5; G-22 of 20261024-122231-rdt-remediation-
  // 3-review): run from another directory, the printed command no longer kept it.
  assert.match(r.output, /run-graph\.mjs"? --run-dir "[^"]+" --repo-root "[^"]+"/, 'the printed command carries --repo-root');
  // And the follow-up recorded is the directory admission returned (stage 3).
  assert.equal(fs.realpathSync.native(follow).toLowerCase(), follow.toLowerCase(), 'the recorded follow-up is a real path');
  assert.doesNotMatch(r.output, /git push/i);
  assert.match(r.output, /Nothing was pushed/, 'the runner says so');
});

// A REMEDIATION RUN MOVES BACK WHEN IT ENDS, like every run (story-pipeline, 2026-10-15; operator: "Self-archive + resolver
// (Recommended)"): only run-graph archived, so every remediate.mjs run stayed under the engine's home, its run.json out of
// the tree. It is archived before the follow-up is minted, so the follow-up records where the run now is.
test('a remediation run that ends is archived into the repository, and its follow-up names the archived run', (t) => {
  const f = fixture(t);
  const r = runRem(f);
  assert.equal(r.status, 0, r.output);
  const archived = path.join(f.repo, '.claude', 'reviews', path.basename(f.rem));
  assert.ok(fs.existsSync(path.join(archived, 'run.json')), `archived at ${archived}\n${r.output}`);
  assert.equal(fs.existsSync(f.rem), false, 'the staged copy is gone');
  assert.equal(fs.existsSync(path.join(archived, 'remediate.lock')), false, 'the lock does not travel');
  // Its telemetry record, written before the move so it travels with the run (telemetry-records.plan.md stage 3).
  const tel = JSON.parse(fs.readFileSync(path.join(archived, 'telemetry.json'), 'utf8'));
  assert.equal(tel.kind, 'remediation');
  assert.ok(tel.tasks.some((x) => x.id === 'remediation'), `no remediation task: ${JSON.stringify(tel.tasks.map((x) => x.id))}`);
  // Its own start, not the mint's (G-12 of 20261027-071443-trt-delivery): the wait between the two commands is not its time.
  assert.equal(tel.started_from, 'run', 'the remediation record starts at the mint');
  assert.ok(Date.parse(tel.started_at) >= Date.parse(JSON.parse(fs.readFileSync(path.join(archived, 'run.json'), 'utf8')).created_at));
  // Its own end, after the commits and checks that follow the last task (G-5 of 20261027-071443-trt-delivery).
  const lastTask = tel.tasks.map((x) => x.ended_at).filter(Boolean).sort().at(-1);
  assert.ok(tel.ended_at && tel.ended_at === JSON.parse(fs.readFileSync(path.join(archived, 'run.json'), 'utf8')).graph_ended_at,
    `the record ends at its last task (${tel.ended_at}), not when the runner finished`);
  assert.ok(tel.ended_at >= lastTask);
  assert.ok(fs.existsSync(path.join(archived, 'evidence', 'remediation', 'payload.json')), 'its evidence moves with it, ignored');
  const run = JSON.parse(fs.readFileSync(path.join(archived, 'run.json'), 'utf8'));
  assert.ok(run.followup_run_dir, 'the follow-up is recorded on the archived run');
  t.after(() => fs.rmSync(run.followup_run_dir, { recursive: true, force: true }));
  const fr = JSON.parse(fs.readFileSync(path.join(run.followup_run_dir, 'run.json'), 'utf8'));
  assert.equal(path.resolve(fr.follows_remediation.run_dir), archived);
});

// THE BACKLOG: runs a remediate.mjs before this one left staged are moved by archive-run.mjs, which refuses a run that has
// not ended — one never run, or one with a cluster pending for --retry-commits.
test('archive-run moves an ended staged run into the repository and refuses one that has not ended', (t) => {
  const f = fixture(t);
  const archive = (dir) => runScript('archive-run.mjs', ['--run-dir', dir], { cwd: f.repo, env: f.env });
  const fresh = archive(f.rem);
  assert.notEqual(fresh.status, 0, 'a remediation never run has not ended');
  assert.match(fresh.output, /has not ended/);
  assert.equal(runRem(f).status, 0);
  const archived = remAt(f);
  const followDir = readRem(f).followup_run_dir;
  t.after(() => fs.rmSync(followDir, { recursive: true, force: true }));
  fs.renameSync(archived, f.rem);   // as a run left staged before remediate.mjs archived
  const r = archive(f.rem);
  assert.equal(r.status, 0, r.output);
  assert.equal(fs.existsSync(f.rem), false);
  assert.ok(fs.existsSync(path.join(archived, 'run.json')), r.output);
  const g = fixture(t);
  fs.writeFileSync(path.join(g.repo, '.git', 'hooks', 'pre-commit'), ['#!/bin/sh', 'exit 1', ''].join('\n'));
  fs.chmodSync(path.join(g.repo, '.git', 'hooks', 'pre-commit'), 0o755);
  runRem(g);
  // g's own home: its run is staged there, and archive-run refuses a run outside its repository's run roots (G-1 of
  // 20261015-230146-archive-fold-remediation-review).
  const pending = runScript('archive-run.mjs', ['--run-dir', g.rem], { cwd: g.repo, env: g.env });
  assert.notEqual(pending.status, 0);
  assert.match(pending.output, /pending/);
  assert.ok(fs.existsSync(path.join(g.rem, 'run.json')), 'a pending run stays where --retry-commits finds it');
});

// THE ROUND COUNT FOLLOWS A RUN THAT MOVED: a follow-up review minted before the archive existed stores its remediation's
// staged path, and a remediation archived since is found by its id under the repository's run roots, not lost
// (CHAIN-UNKNOWN would stop every later remediation in that chain).
test('the chain finds a remediation archived after its follow-up recorded the staged path', (t) => {
  const f = fixture(t);
  const reviews = path.join(f.repo, '.claude', 'reviews');
  const write = (dir, obj) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(obj)); };
  write(path.join(reviews, '20261001-000000-v0'), { run_id: '20261001-000000-v0' });
  write(path.join(reviews, '20261001-000100-r0'), { run_id: '20261001-000100-r0', remediates: '20261001-000000-v0',
    remediation_frame: { run_id: '20261001-000000-v0', run_dir: path.join(f.env.QUORATE_HOME, 'gone', '20261001-000000-v0') },
    remediation_commits: [] });
  const rv = path.join(f.reviewed, 'run.json');
  const reviewed = JSON.parse(fs.readFileSync(rv, 'utf8'));
  reviewed.follows_remediation = { run_id: '20261001-000100-r0', run_dir: path.join(f.env.QUORATE_HOME, 'gone', '20261001-000100-r0') };
  fs.writeFileSync(rv, JSON.stringify(reviewed));
  const r = runRem(f);
  assert.doesNotMatch(r.output, /cannot establish the round count/, r.output);
  assert.equal(r.status, 0, r.output);
});

// G-9 of 20261015-220413-archive-fold-review: the run found by name was accepted whatever it was, so a stale link counted
// the round cap against a different run that happened to sit at that name. It must carry the link's run_id.
test('G-9: a run found by name that is not the linked run is not followed, and the count is unknown', (t) => {
  const f = fixture(t);
  const reviews = path.join(f.repo, '.claude', 'reviews');
  const write = (dir, obj) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(obj)); };
  write(path.join(reviews, '20261001-000000-v0'), { run_id: '20261001-000000-v0' });
  write(path.join(reviews, '20261001-000100-r0'), { run_id: '20261001-000100-someone-else', remediates: '20261001-000000-v0',
    remediation_frame: { run_id: '20261001-000000-v0', run_dir: path.join(f.env.QUORATE_HOME, 'gone', '20261001-000000-v0') },
    remediation_commits: [] });
  const rv = path.join(f.reviewed, 'run.json');
  const reviewed = JSON.parse(fs.readFileSync(rv, 'utf8'));
  reviewed.follows_remediation = { run_id: '20261001-000100-r0', run_dir: path.join(f.env.QUORATE_HOME, 'gone', '20261001-000100-r0') };
  fs.writeFileSync(rv, JSON.stringify(reviewed));
  const r = runRem(f);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /cannot establish the round count/);
  assert.equal(fs.existsSync(f.log), false, 'nothing was spawned');
});
