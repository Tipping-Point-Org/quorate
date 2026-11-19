// Part 4 of 5 of regression-remediation-commit-recovery.test.mjs: trailers across a retry, and a commit whose sha
// cannot be read. Split by split-slow-test-files.md; the fixture is remediation-commit-recovery-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, privateRecord } from './helpers.mjs';
import { admitGroups } from '../scripts/lib/remediation-chain.mjs';
import { COMMIT_CHECK_KINDS } from '../scripts/lib/remediation-chain.mjs';
import { trailerError, isPending } from '../scripts/lib/remediation-chain.mjs';
import { git, fakeNode, fixture, noSecretReachesACleanFilter, refusedCommitRecordsNoDeclaration, retryRecordsDeclaredNoRed, retryCommitsATestOnlyFix, recoveryWithdrawsUnlandedDeclaration, TRAILER, rerecordReport } from './remediation-commit-recovery-fixture.mjs';

// ------------------------------------------------- 20261011-011857-commit-recovery-r3
// G-6 (with G-10): a retry's commits carried only the retry's own trailers, dropping the first run's, so "every cluster
// commit the run makes" did not hold across attempts. The run's trailers are the union, recorded.
test('G-6: a retry commits with the first run\'s trailers and its own, and records the union', (t) => {
  const f = fixture(t);
  f.runRem(['--commit-trailer', 'Refs: G-1']);   // refused by the hook: no Doc-Impact
  f.runRem(['--retry-commits', '--commit-trailer', TRAILER]);
  const msg = git(f.repo, 'log', '-1', '--format=%B').stdout;
  assert.ok(msg.includes('Refs: G-1') && msg.includes(TRAILER), msg);
  assert.deepEqual(f.readRem().commit_trailers, ['Refs: G-1', TRAILER]);
});

test('G-8: a retry whose re-plan differs from the recorded accepted files is refused', (t) => {
  const f = fixture(t);
  f.runRem();
  const p = path.join(f.at(), 'evidence', 'remediation', 'payload.json');
  const payload = JSON.parse(fs.readFileSync(p, 'utf8'));
  payload.groups[0].files.push('src/b.js');
  fs.writeFileSync(p, JSON.stringify(payload));
  fs.writeFileSync(path.join(f.repo, 'src', 'b.js'), 'changed after the run\n');
  const before = f.head();
  // Not re-recorded, the edited report is refused before any re-plan.
  assert.match(f.runRem(['--retry-commits', '--commit-trailer', TRAILER]).output, /report of the node \(evidence\/remediation\/payload\.json\) changed since the first run read it/);
  rerecordReport(f);
  f.runRem(['--retry-commits', '--commit-trailer', TRAILER]);
  assert.equal(f.head(), before);
  const c = f.readRem().clusters[0];
  assert.match(c.reason, /recorded accepted files/, JSON.stringify(c));
});

// G-13: the request said a retry mints the follow-up "as a first run would"; since r1's G-3 it mints it only when no
// cluster is pending. The request records the amendment.
test('G-13: the request says the follow-up waits while a cluster is pending', { skip: privateRecord('.claude/requests/remediation-commit-recovery.md') }, () => {
  const req = fs.readFileSync(new URL('../.claude/requests/remediation-commit-recovery.md', import.meta.url), 'utf8');
  assert.match(req, /no cluster is (?:still )?pending/i);
});

// ------------------------------------------------- 20261011-014238-commit-recovery-r4
// G-2 (with G-6): a rev-parse failing after a commit that landed called die() before run.json was saved, so the commit
// was in history and nowhere in the run, and a retry could commit the cluster again. It is now recorded and saved.
test('G-2: a commit whose sha cannot be read is recorded as commit-unrecorded, not pending, and the run is saved', (t) => {
  const f = fixture(t, { hook: false });
  const before = f.head();
  const r = f.runRem(['--test-fail-rev-parse']);
  // The run STOPS, exit 1, once the record is saved (remediation-commit-recovery.design.md decision 2).
  assert.equal(r.status, 1, r.output);
  assert.notEqual(f.head(), before, 'the commit landed');
  const run = f.readRem();
  assert.ok(Array.isArray(run.remediation_commits), 'run.json was saved');
  assert.ok((run.commit_check ?? []).some((c) => c.kind === 'commit-unrecorded' && c.cluster === 'c1'), JSON.stringify(run.commit_check));
  assert.equal(run.clusters[0].pending_retry, false, 'a retry must not commit it again');
  assert.ok(run.stamps.includes('COMMIT-CHECK'));
  assert.equal(COMMIT_CHECK_KINDS['commit-unrecorded'].stamps, true);
});

// ------------------------------------------------- 20261011-020259-commit-recovery-r5
// G-5: an unrecorded commit's change went unreviewed while the run said "nothing was committed". G-2: its raw stderr went
// into tracked run.json. Since the round-cap design step (remediation-commit-recovery.design.md decisions 2-3, operator
// 2026-10-11: "Save first, then stop"): the run stops and tells the operator how to find the sha and mint the follow-up
// by hand, on this and every later invocation; the raw output stays in the runner's log.
test('G-5, G-2: an unrecorded commit stops the run with the recovery command, mints nothing, and keeps raw output out of run.json', (t) => {
  const f = fixture(t, { hook: false });
  const r = f.runRem(['--test-fail-rev-parse']);
  // Quoted through printedArg since G-11 of 20261108-043341-si-remediation-5-review-b: remediation_start is reread from run.json.
  assert.match(r.output, /git log "[0-9a-f]+\.\.HEAD"/, r.output);
  assert.match(r.output, /--follows-remediation/);
  const run = f.readRem();
  assert.equal(run.followup_run_dir, undefined, 'no follow-up is minted for an unrecorded commit');
  assert.equal(run.clusters[0].unrecorded, true);
  const e = run.commit_check.find((c) => c.kind === 'commit-unrecorded');
  assert.ok(e && e.output && fs.existsSync(path.join(f.at(), e.output)), JSON.stringify(e));
  assert.doesNotMatch(JSON.stringify(run), /test seam: rev-parse failed/, 'raw stderr is not in run.json');
  assert.match(fs.readFileSync(path.join(f.at(), e.output), 'utf8'), /test seam: rev-parse failed/);
  const again = f.runRem();
  assert.equal(again.status, 1);
  assert.match(again.output, /--follows-remediation/, 'a later invocation repeats the recovery command');
  assert.equal(f.readRem().followup_run_dir, undefined);
});

// ------------------------------------------------- the round-cap design step (remediation-commit-recovery.design.md)
// r6 G-2: a log write failing after the commit landed recreated the unrecorded state. The record is saved first.
test('design 1-2: an unrecorded commit is saved even when its log cannot be written', (t) => {
  const f = fixture(t, { hook: false });
  const r = f.runRem(['--test-fail-rev-parse', '--test-fail-runner-log']);
  assert.equal(r.status, 1, r.output);
  const run = f.readRem();
  assert.equal(run.clusters[0].unrecorded, true, JSON.stringify(run.clusters));
  assert.ok(run.commit_check.some((c) => c.kind === 'commit-unrecorded'));
  // G-10 of 20261108-043341-si-remediation-5-review-b: the failed write of the only raw output is named, not swallowed.
  assert.match(r.output, /could not keep the raw output of cluster [^\n]*\(EACCES\)/, r.output);
});

// Decision 1: every planned cluster is recorded before the first commit, and the run is saved after each attempt, so a
// run killed mid-loop leaves its unattempted clusters pending — and --retry-commits commits them.
test('design 1: a run killed after its first cluster leaves the second pending, and a retry commits it', (t) => {
  const f = fixture(t, { hook: false, two: true });
  const r = f.runRem(['--test-die-after-cluster', 'c1']);
  assert.notEqual(r.status, 0, r.output);
  const run = f.readRem();
  const c1 = run.clusters.find((c) => c.id === 'c1');
  const c2 = run.clusters.find((c) => c.id === 'c2');
  assert.ok(c1.commit && c2.commit === null && c2.pending_retry === true, JSON.stringify(run.clusters));
  assert.deepEqual(run.commit_trailers, [], 'commit_trailers is recorded, empty when none (r6 G-7)');
  const retry = f.runRem(['--retry-commits']);
  assert.equal(retry.status, 0, retry.output);
  assert.ok(f.readRem().clusters.find((c) => c.id === 'c2').commit);
  assert.equal(f.spawns(), 1);
});

// r6 G-9, G-10: the row's clusters shape names unrecorded, and it says a refused commit leaves its changes unstaged and
// that the run is saved after every attempt.
test('r6 G-9, G-10: the remediate row documents unrecorded, the per-attempt save and the unstaged refusal', () => {
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`')) ?? '';
  assert.match(row, /unrecorded\?/);
  assert.match(row, /saved before (?:the first|every) commit/i);
  assert.match(row, /hook refus[^.]*unstaged/i);
});

// ------------------------------------------------- 20261011-031727-commit-recovery-design-review
// G-9 (HIGH, with G-8): a commit could land before run.json was saved; a run killed in that window showed the cluster
// uncommitted and pending, a retry then found a clean tree and refused it, and the landed commit went unreviewed. The
// commit itself is now the record: the cluster is saved `attempting` first, its message carries this run's id and a
// Remediation-Cluster trailer, and any later invocation resolves an attempting cluster from git log.
test('G-9: a commit that landed before the save is found in git log by a later invocation, and gets its follow-up', (t) => {
  const f = fixture(t, { hook: false });
  const r = f.runRem(['--test-die-after-commit', 'c1']);
  assert.notEqual(r.status, 0, r.output);
  const run1 = f.readRem();
  assert.equal(run1.clusters[0].attempting, true, JSON.stringify(run1.clusters));
  assert.equal(run1.clusters[0].commit, null);
  const landed = f.head();
  // The cluster number is in the subject, not a runner-added trailer (G-4 of 20261011-044155-commit-recovery-design-r4;
  // operator, 2026-10-11: "Move it into the subject").
  assert.match(git(f.repo, 'log', '-1', '--format=%s').stdout, /\(cluster 1\)$/m);
  const again = f.runRem();
  assert.equal(again.status, 0, again.output);
  const run2 = f.readRem();
  assert.equal(run2.clusters[0].commit, landed);
  assert.equal(run2.clusters[0].attempting, undefined);
  assert.deepEqual(run2.remediation_commits, [landed]);
  assert.ok(run2.followup_run_dir, 'the landed commit gets its follow-up review');
  recoveryWithdrawsUnlandedDeclaration(t);   // G-8 of rer-remediation-2b-review
});

test('G-9: --retry-commits resolves an attempting cluster from git log instead of committing it again', (t) => {
  const f = fixture(t, { hook: false });
  f.runRem(['--test-die-after-commit', 'c1']);
  const landed = f.head();
  f.runRem(['--retry-commits']);
  assert.equal(f.head(), landed, 'nothing committed twice');
  assert.equal(f.readRem().clusters[0].commit, landed);
});

// G-11: a refused commit's log write could throw before the save, breaking "saved after every attempt".
test('G-11: a refused commit whose log cannot be written is still recorded and saved', (t) => {
  const f = fixture(t);
  const r = f.runRem(['--test-fail-runner-log']);
  assert.equal(r.status, 1, r.output);
  const run = f.readRem();
  assert.equal(run.clusters[0].pending_retry, true, JSON.stringify(run.clusters));
  assert.ok(run.commit_check.some((c) => c.kind === 'hook-rejected'), JSON.stringify(run.commit_check));
});

// G-12: the lock read `saved` from before the first commit; it reads `committing` while commits are made.
test('G-12, G-7, G-10: the lock phase committing is documented, and the request is amended for the decided behaviour', { skip: privateRecord('.claude/requests/remediation-commit-recovery.md') }, () => {
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`')) ?? '';
  assert.match(row, /`committing`/);
  assert.match(row, /attempting\?/);
  const protocol = fs.readFileSync(new URL('../shared/disk-first-protocol.md', import.meta.url), 'utf8');
  assert.match(protocol, /left at `committing`/, 'the §1 layout names a lock a killed run leaves while committing');
  const req = fs.readFileSync(new URL('../.claude/requests/remediation-commit-recovery.md', import.meta.url), 'utf8');
  assert.match(req, /never attempted/i);
  assert.match(req, /unrecorded[^.]*no follow-up/i);
});

// ------------------------------------------------- 20261011-034854-commit-recovery-design-r2
// G-6: --retry-commits that found a landed commit in git log, with nothing else pending, said "none was refused" and
// minted no follow-up, so the recovered commit stayed unreviewed. It now proceeds to the follow-up.
test('G-6: a retry that only recovers a landed commit mints its follow-up and exits 0', (t) => {
  const f = fixture(t, { hook: false });
  f.runRem(['--test-die-after-commit', 'c1']);
  const r = f.runRem(['--retry-commits']);
  assert.equal(r.status, 0, r.output);
  assert.ok(f.readRem().followup_run_dir, 'the recovered commit gets its follow-up review');
});

// G-5: a retry killed after its commit landed left that attempt's commit_retries entry without the cluster; the
// resolution now writes it into the attempt it belonged to.
test('G-5: a commit recovered from a killed retry is written into that retry\'s commit_retries entry', (t) => {
  const f = fixture(t);
  f.runRem();   // the hook refuses: no Doc-Impact
  f.runRem(['--retry-commits', '--commit-trailer', TRAILER, '--test-die-after-commit', 'c1']);
  const landed = f.head();
  f.runRem(['--retry-commits']);
  const run = f.readRem();
  const entry = run.commit_retries[0].clusters.find((c) => c.id === 'c1');
  assert.ok(entry && entry.commit === landed && entry.resolved_from === 'git log', JSON.stringify(run.commit_retries));
});

// ------------------------------------------------- 20261011-041804-commit-recovery-design-r3
// G-10: the row still said --retry-commits refuses with nothing retryable, and its commit_retries shape lacked
// resolved_from. G-4: --retry-commits on a run whose only problem is an unrecorded commit said "no cluster to retry"
// instead of the manual follow-up command.
test('G-10: the remediate row documents the recovery-only retry and resolved_from', () => {
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`')) ?? '';
  assert.match(row, /resolved_from\?/);
  assert.match(row, /only (?:recovers|recovered)[^.]*follow-up/i);
});

test('G-4: --retry-commits on an unrecorded run prints the manual follow-up command', (t) => {
  const f = fixture(t, { hook: false });
  f.runRem(['--test-fail-rev-parse']);
  const r = f.runRem(['--retry-commits']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /--follows-remediation/, r.output);
});
