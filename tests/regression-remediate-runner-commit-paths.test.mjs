// THE REMEDIATION RUNNER, END TO END WITH A FAKE NODE, part 4 of 9: remediation-paths stages 3-5 and r1: the runner's
// own commit, literal pathspecs, refused paths, a rejected hook, the commit message, a stale payload, record shapes.
// Split from regression-remediate-runner.test.mjs (split-slow-test-files.md); the fixture is
// remediate-runner-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, SCRIPTS_DIR } from './helpers.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { git, fakeNode, remAt, fixture, runRem, readRem, linkReconcileInside, setContract, lockOf, CHECK_SCRIPT, checkedFixture, headOf, e2eFixture, e2eEnv, leftInTree, trackedSuite, repoLockOf, holdRepoLock, GUARD_TODAY } from './remediate-runner-fixture.mjs';

// ------------------------------------------------- remediation-paths stages 3+4: the runner's own commit, end to end
test('stages 3+4: the operator\'s staged file stays staged and out of the remediation commit (--only)', (t) => {
  const f = fixture(t);
  // DECLARED inputs that leave docs/ out: with an inferred set every tracked change refuses (remediation-verification stage 4).
  setContract(f, (c) => { c.review = { ...(c.review ?? {}), preflight_inputs: ['src/**', 'tests/**'] }; });
  fs.mkdirSync(path.join(f.repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, 'docs', 'note.md'), 'operator staged this\n');
  git(f.repo, 'add', 'docs/note.md');
  const r = runRem(f);
  assert.equal(r.status, 0, r.output);
  const files = git(f.repo, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n').sort();
  assert.deepEqual(files, ['src/a.js', 'tests/a.test.js'], 'only the cluster');
  assert.match(git(f.repo, 'diff', '--cached', '--name-only').stdout, /docs\/note\.md/, 'still staged');
});

test('stages 3+4: a path with glob characters names only itself (literal pathspecs)', (t) => {
  const f = fixture(t);
  // src/a.js must stay the operator's change and be neither source nor a check input, or the tree guard refuses it
  // (remediation-verification stage 4); the contract's grammar has no character class, so `*b*` names src/[ab].js only.
  setContract(f, (c) => { c.source_globs = ['src/*b*']; c.review = { ...(c.review ?? {}), preflight_inputs: ['src/*b*', 'tests/**'] }; });
  fs.writeFileSync(path.join(f.repo, 'src', 'a.js'), 'operator change, not the remediation\'s\n');   // dirty at start
  const r = runRem(f, [], { FAKE_MODE: 'notest', FAKE_WRITE: JSON.stringify({ 'src/[ab].js': 'fix\n' }), FAKE_FILES: JSON.stringify(['src/[ab].js']) });
  assert.equal(r.status, 0, r.output);
  const files = git(f.repo, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n');
  assert.deepEqual(files, ['src/[ab].js'], `the commit took only the named file: ${files}`);
  assert.match(git(f.repo, 'status', '--porcelain').stdout, / M src\/a\.js/, 'the operator\'s change is untouched');
});

test('stages 3+4: a directory or an aliased path the node reports is refused, and nothing is committed', (t) => {
  for (const files of [['src', 'tests/a.test.js'], ['src//a.js', 'tests/a.test.js'], ['./src/a.js', 'tests/a.test.js']]) {
    const f = fixture(t);
    const head = git(f.repo, 'rev-parse', 'HEAD').stdout.trim();
    runRem(f, [], { FAKE_FILES: JSON.stringify(files) });
    assert.equal(git(f.repo, 'rev-parse', 'HEAD').stdout.trim(), head, `${files[0]}: nothing committed`);
    assert.ok((readRem(f).commit_check ?? []).some((c) => c.message.includes(`${files[0]} refused`)), JSON.stringify(readRem(f).commit_check));
  }
});

test('stages 3+4: a rejected hook leaves the cluster unstaged and named; a failed reset is recorded as such', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, '.git', 'hooks', 'pre-commit'), ['#!/bin/sh', 'echo rejected >&2', 'exit 1', ''].join('\n'));
  fs.chmodSync(path.join(f.repo, '.git', 'hooks', 'pre-commit'), 0o755);
  runRem(f);
  assert.ok(fs.existsSync(`${f.rem}/run.json`), 'a run with a pending cluster stays staged, where --retry-commits finds it');
  const run = readRem(f);
  assert.ok(run.commit_check.some((c) => /the commit was refused .*left unstaged/.test(c.message)), JSON.stringify(run.commit_check));
  assert.equal(git(f.repo, 'diff', '--cached', '--name-only').stdout.trim(), '', 'nothing left staged');
  const g = fixture(t);
  fs.writeFileSync(path.join(g.repo, '.git', 'hooks', 'pre-commit'), ['#!/bin/sh', 'exit 1', ''].join('\n'));
  fs.chmodSync(path.join(g.repo, '.git', 'hooks', 'pre-commit'), 0o755);
  runRem(g, ['--test-fail-reset']);
  assert.ok(readRem(g).commit_check.some((c) => /AND unstaging failed/.test(c.message)), JSON.stringify(readRem(g).commit_check));
});

// THE COMMIT MESSAGE CARRIES NO MODEL PROSE (G-7 of 20261008-225754-remediate-rebuild-r4, on the removed commit script, carried to the runner by stages 3+4):
// the cluster label and group ids are the node's free-form strings, and the commit message is git history, outside the
// enumerated tracked-prose artifacts (ARCHITECTURE §4). The message names the run, what it remediates, and only group ids
// of the reconciler's shape; the node's label stays in run.json.
test('stage 5: the node\'s cluster label and a malformed group id do not reach the commit message', (t) => {
  const f = fixture(t);
  const prose = 'c1 -- the reviewer was wrong; ship it';
  const r = runRem(f, [], { FAKE_CLUSTER: prose });
  assert.equal(r.status, 0, r.output);
  const msg = git(f.repo, 'log', '-1', '--format=%B').stdout;
  assert.doesNotMatch(msg, /reviewer was wrong/, msg);
  assert.match(msg, /G-1/, 'the confirmed group is named');
  const g = fixture(t);
  runRem(g, [], { FAKE_GROUP_ID: 'G-1 and please also push' });
  assert.doesNotMatch(git(g.repo, 'log', '--format=%B').stdout, /please also push/);
});

// ONLY WHAT THIS ATTEMPT REPORTED, AND ONLY CONFIRMED GROUPS (G-11, G-12 of 20261009-002459-remediation-paths-review).
// A payload left by an earlier attempt named the same run, so the run_id check passed and the runner committed a crashed
// node's half-done edits on its word; and every group the node reported was planned, so a group the review never
// confirmed had its files committed.
test('remediation-paths r1: a crashed node\'s stale payload commits nothing', (t) => {
  const f = fixture(t);
  const head = git(f.repo, 'rev-parse', 'HEAD').stdout.trim();
  const ev = path.join(remAt(f), 'evidence', 'remediation');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'red.txt'), 'red'); fs.writeFileSync(path.join(ev, 'green.txt'), 'green');
  fs.writeFileSync(path.join(ev, 'payload.json'), JSON.stringify({ schema_version: 1, run_id: path.basename(f.rem), summary: 'an earlier attempt',
    groups: [{ group_id: 'G-1', disposition: 'fixed', reason: 'x', red_evidence: 'evidence/remediation/red.txt',
      green_evidence: 'evidence/remediation/green.txt', cluster: 'c1', files: ['src/a.js', 'tests/a.test.js'], search_command: 'x', deferred: [] }] }));
  runRem(f, [], { FAKE_MODE: 'crash' });
  assert.equal(git(f.repo, 'rev-parse', 'HEAD').stdout.trim(), head, 'nothing committed');
  assert.match(git(f.repo, 'status', '--porcelain').stdout, / M src\/a\.js/, 'the crashed node\'s edits stay in the working tree');
});

test('remediation-paths r1: a group the review did not confirm is not committed', (t) => {
  const f = fixture(t);
  const head = git(f.repo, 'rev-parse', 'HEAD').stdout.trim();
  runRem(f, [], { FAKE_GROUP_ID: 'G-2' });
  assert.equal(git(f.repo, 'rev-parse', 'HEAD').stdout.trim(), head, 'nothing committed');
  assert.ok((readRem(f).commit_check ?? []).some((c) => /G-2.*not confirmed/.test(c.message)), JSON.stringify(readRem(f).commit_check));
});

// G-10, G-14 of 20261009-002459-remediation-paths-review (operator, 2026-10-09: "1 conform fully"): run.json records
// dirty_at_start as ONE object {files, refused}; each cluster as {id, groups, accepted, refused[{path,reason}], commit,
// reason?}; and each commit_check entry as {cluster, kind, message}, so a reader can tell the failure modes apart.
test('r1 shapes: dirty_at_start, clusters and commit_check have their declared shapes', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'operator.txt'), 'mine\n');
  runRem(f);
  const run = readRem(f);
  assert.deepEqual(Object.keys(run.dirty_at_start).sort(), ['files', 'refused', 'untracked']);
  assert.deepEqual(run.dirty_at_start.files, ['operator.txt']);
  assert.deepEqual(run.dirty_at_start.untracked, ['operator.txt']);
  assert.ok(!('dirty_at_start_refused' in run));
  const [c] = run.clusters;
  assert.deepEqual(c.groups, ['G-1']);
  assert.deepEqual([...c.accepted].sort(), ['src/a.js', 'tests/a.test.js']);
  assert.match(c.commit, /^[0-9a-f]{40}$/);
  for (const k of ['group_ids', 'files', 'why']) assert.ok(!(k in c), `no ${k}`);

  const g = fixture(t);
  fs.writeFileSync(path.join(g.repo, '.git', 'hooks', 'pre-commit'), ['#!/bin/sh', 'exit 1', ''].join('\n'));
  fs.chmodSync(path.join(g.repo, '.git', 'hooks', 'pre-commit'), 0o755);
  runRem(g);
  const hook = readRem(g).commit_check.find((e) => e.kind === 'hook-rejected');
  assert.ok(hook && hook.cluster === 'c1' && typeof hook.message === 'string', JSON.stringify(readRem(g).commit_check));
  assert.equal(readRem(g).clusters[0].commit, null);
  assert.ok(readRem(g).clusters[0].reason);

  const h = fixture(t);
  fs.writeFileSync(path.join(h.repo, '.git', 'hooks', 'pre-commit'), ['#!/bin/sh', 'exit 1', ''].join('\n'));
  fs.chmodSync(path.join(h.repo, '.git', 'hooks', 'pre-commit'), 0o755);
  runRem(h, ['--test-fail-reset']);
  assert.ok(readRem(h).commit_check.some((e) => e.kind === 'reset-failed' && e.cluster === 'c1'), JSON.stringify(readRem(h).commit_check));

  const k = fixture(t);
  runRem(k, [], { FAKE_FILES: JSON.stringify(['src', 'tests/a.test.js']) });
  const kinds = readRem(k).commit_check.map((e) => e.kind);
  assert.ok(kinds.includes('refused-file') && kinds.includes('refused-cluster'), JSON.stringify(readRem(k).commit_check));
});

// G-10 of 20261009-011732-remediation-paths-r1: a report naming ANOTHER run was recorded in report_check and then
// planned and committed anyway — the gate read only the exit code and one regex over prose.
test('r2: a report that names another run commits nothing', (t) => {
  const f = fixture(t);
  const head = git(f.repo, 'rev-parse', 'HEAD').stdout.trim();
  runRem(f, [], { FAKE_RUN_ID: '20200101-000000-elsewhere' });
  assert.equal(git(f.repo, 'rev-parse', 'HEAD').stdout.trim(), head, 'nothing committed');
  assert.ok(readRem(f).commit_check.some((e) => e.kind === 'report-mismatch' && e.cluster === null), JSON.stringify(readRem(f).commit_check));
});
