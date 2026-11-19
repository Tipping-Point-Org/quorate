// THE REMEDIATION RUNNER, END TO END WITH A FAKE NODE, part 5 of 9: remediation-paths r2-r3 and
// remediation-run-ownership stages 1-3: merges, evidence that is a directory or a link, hooks at depth 1, a repository
// refused at the start, the run lock. Split from regression-remediate-runner.test.mjs (split-slow-test-files.md); the
// fixture is remediate-runner-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, SCRIPTS_DIR } from './helpers.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { git, fakeNode, remAt, fixture, runRem, readRem, linkReconcileInside, setContract, lockOf, CHECK_SCRIPT, checkedFixture, headOf, e2eFixture, e2eEnv, leftInTree, trackedSuite, repoLockOf, holdRepoLock, GUARD_TODAY } from './remediate-runner-fixture.mjs';

// G-13: a merged cluster that committed cleanly is recorded, but it is not a failure, so it does not stamp COMMIT-CHECK.
test('r2: a cleanly committed merge is recorded without stamping COMMIT-CHECK', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.reviewed, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [
    { group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }, { group_id: 'G-2', decision: 'confirmed', severity: 'LOW' }] }));
  runRem(f, [], { FAKE_SECOND: '1' });
  assert.ok(readRem(f).commit_check.some((e) => e.kind === 'merged'), JSON.stringify(readRem(f).commit_check));
  const run = readRem(f);
  assert.equal(run.remediation_commits.length, 1);
  assert.ok(!(run.stamps ?? []).includes('COMMIT-CHECK'), JSON.stringify(run.stamps));
});

// G-9 of 20261009-011732-remediation-paths-r1: the evidence check accepted any existing path under the run's evidence —
// a directory, or another node's artifact — as a group's red or green capture.
test('r2: red evidence that is a directory, or another node\'s artifact, is named', (t) => {
  for (const p of ['evidence/remediation', 'evidence/other-node/raw.log']) {
    const f = fixture(t);
    fs.mkdirSync(path.join(remAt(f), 'evidence', 'other-node'), { recursive: true });
    fs.writeFileSync(path.join(remAt(f), 'evidence', 'other-node', 'raw.log'), 'not the remediation\'s');
    runRem(f, [], { FAKE_RED_EVIDENCE: p });
    assert.ok((readRem(f).report_check ?? []).some((c) => c.includes(`red_evidence ${p}`)), `${p}: ${JSON.stringify(readRem(f).report_check)}`);
  }
});

// G-9 (c) of 20261009-014530-remediation-paths-r2: the runner's commit runs the project's hooks at depth 0, so a hook
// could start graph work past §8's guard. They run as a node's children do: GRAPH_NODE_DEPTH=1.
// G-10: a hook's raw output was copied into the TRACKED run.json; it goes to the run's evidence, and run.json names
// the file.
test('r3: hooks run at depth 1, and their output goes to evidence, not run.json', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, '.git', 'hooks', 'pre-commit'),
    ['#!/bin/sh', 'printf "%s" "$GRAPH_NODE_DEPTH" > .git/depth.txt', 'echo "hook-said-this-xyzzy" >&2', 'exit 1', ''].join('\n'));
  fs.chmodSync(path.join(f.repo, '.git', 'hooks', 'pre-commit'), 0o755);
  runRem(f);
  assert.equal(fs.readFileSync(path.join(f.repo, '.git', 'depth.txt'), 'utf8'), '1');
  const raw = fs.readFileSync(path.join(remAt(f), 'run.json'), 'utf8');
  assert.doesNotMatch(raw, /xyzzy/, 'no hook output in run.json');
  const entry = readRem(f).commit_check.find((e) => e.kind === 'hook-rejected');
  assert.ok(entry && entry.output, JSON.stringify(readRem(f).commit_check));
  assert.match(fs.readFileSync(path.join(remAt(f), entry.output), 'utf8'), /xyzzy/);
});

// G-8: containment was lexical and stat followed links, so evidence reached through a junction or symlink inside
// evidence/remediation, pointing outside the run, was accepted.
test('r3: evidence reached through a link that leaves the run is named', (t) => {
  const f = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'q-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'red.txt'), 'not this run\'s');
  fs.mkdirSync(path.join(remAt(f), 'evidence', 'remediation'), { recursive: true });
  fs.symlinkSync(outside, path.join(remAt(f), 'evidence', 'remediation', 'linked'), 'junction');
  runRem(f, [], { FAKE_RED_EVIDENCE: 'evidence/remediation/linked/red.txt' });
  assert.ok((readRem(f).report_check ?? []).some((c) => c.includes('red_evidence evidence/remediation/linked/red.txt')), JSON.stringify(readRem(f).report_check));
});

// remediation-run-ownership stage 1 (D3): the plumbing half of G-9 (a) of 20261009-014530-remediation-paths-r2, which a
// planner unit test cannot see — the runner must PASS dirty_at_start.refused. A nested repository the operator had
// changed sits inside source_globs; the node turns it into plain files and reports one with a test.
test('rro stage 1: a repository refused at the start stays out of the commit when the node flattens it', (t) => {
  const f = fixture(t);
  const vendor = path.join(f.repo, 'src', 'vendor');
  fs.mkdirSync(vendor, { recursive: true });
  git(vendor, 'init', '-q');
  fs.writeFileSync(path.join(vendor, 'lib.js'), 'operator\'s nested repository\n');
  const head = git(f.repo, 'rev-parse', 'HEAD').stdout.trim();
  runRem(f, [], { FAKE_RM: JSON.stringify(['src/vendor/.git']), FAKE_WRITE: JSON.stringify({ 'src/vendor/x.js': 'flattened\n' }),
    FAKE_FILES: JSON.stringify(['src/vendor/x.js', 'tests/a.test.js']) });
  assert.equal(git(f.repo, 'rev-parse', 'HEAD').stdout.trim(), head, 'nothing committed');
  const e = (readRem(f).commit_check ?? []).find((x) => x.kind === 'refused-file' && /src\/vendor\/x\.js/.test(x.message));
  assert.ok(e && /refused at the start/.test(e.message), JSON.stringify(readRem(f).commit_check));
});

// remediation-run-ownership stage 2 (D1): G-9 of 20261009-021636-remediation-paths-r3. The runner's commit output went to
// evidence/remediation/commit-N.log, truncating — a node capture of that name was overwritten. And an earlier attempt's
// payload was renamed beside the new one, inside the node's folder. Both now go to evidence/remediation-runner/.
test('rro stage 2: a rejected commit leaves the node\'s captures byte-for-byte; its output goes to the runner\'s folder', (t) => {
  const f = fixture(t);
  const ev = path.join(remAt(f), 'evidence', 'remediation');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'commit-1.log'), 'the node\'s own capture\n');
  fs.writeFileSync(path.join(f.repo, '.git', 'hooks', 'pre-commit'), ['#!/bin/sh', 'echo "hook-output-q7" >&2', 'exit 1', ''].join('\n'));
  fs.chmodSync(path.join(f.repo, '.git', 'hooks', 'pre-commit'), 0o755);
  runRem(f);
  assert.equal(fs.readFileSync(path.join(ev, 'commit-1.log'), 'utf8'), 'the node\'s own capture\n');
  const entry = readRem(f).commit_check.find((e) => e.kind === 'hook-rejected');
  assert.ok(entry && entry.output.startsWith('evidence/remediation-runner/'), JSON.stringify(entry));
  assert.match(fs.readFileSync(path.join(remAt(f), entry.output), 'utf8'), /hook-output-q7/);
  assert.equal(readRem(f).clusters[0].output, entry.output);
});

test('rro stage 2: an earlier attempt\'s payload moves into the runner\'s folder, not beside the new one', (t) => {
  const f = fixture(t);
  const ev = path.join(remAt(f), 'evidence', 'remediation');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'payload.json'), '{"earlier":true}');
  runRem(f);
  assert.equal(fs.readFileSync(path.join(remAt(f), 'evidence', 'remediation-runner', 'attempt-1', 'payload.json'), 'utf8'), '{"earlier":true}');
  assert.deepEqual(fs.readdirSync(path.join(remAt(f), 'evidence', 'remediation')).filter((n) => n.startsWith('payload.')), ['payload.json'], 'only this attempt\'s payload in the node\'s folder');
});

test('rro stage 3: a second runner finding the lock refuses with exit 6 and changes nothing, the lock included', (t) => {
  const f = fixture(t);
  const lock = JSON.stringify({ pid: 999999, started_at: '2026-10-09T00:00:00.000Z', phase: 'node-running' });
  fs.writeFileSync(lockOf(f), lock);
  const runBefore = fs.readFileSync(path.join(remAt(f), 'run.json'), 'utf8');
  const head = git(f.repo, 'rev-parse', 'HEAD').stdout.trim();
  const r = runRem(f);
  assert.equal(r.status, 6, r.output);
  assert.match(r.output, /remediate\.lock/);
  assert.equal(fs.readFileSync(lockOf(f), 'utf8'), lock, 'the lock byte-for-byte');
  assert.equal(fs.readFileSync(path.join(remAt(f), 'run.json'), 'utf8'), runBefore, 'run.json byte-for-byte');
  assert.equal(git(f.repo, 'rev-parse', 'HEAD').stdout.trim(), head);
  assert.equal(git(f.repo, 'status', '--porcelain').stdout.trim(), '', 'the working tree untouched');
});

test('rro stage 3: an exit after the node ran — a die or a throw — keeps the lock at phase node-ran', (t) => {
  for (const how of ['die', 'throw']) {
    const f = fixture(t);
    runRem(f, ['--test-fail-after-node', how]);
    assert.ok(fs.existsSync(lockOf(f)), `${how}: the lock is kept`);
    assert.equal(JSON.parse(fs.readFileSync(lockOf(f), 'utf8')).phase, 'node-ran', how);
  }
});
