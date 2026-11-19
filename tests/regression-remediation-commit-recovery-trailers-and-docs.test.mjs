// Part 5 of 5 of regression-remediation-commit-recovery.test.mjs: the trailers, the documented retry, and the recovery
// save. Split by split-slow-test-files.md; the fixture is remediation-commit-recovery-fixture.mjs.

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

// ------------------------------------------------- 20261011-044155-commit-recovery-design-r4
// G-4, G-16: the runner added a Remediation-Cluster trailer the operator never gave, against the request's non-goal "No
// automatic trailer: the words are the operator's"; and the test for that read only run.json, never the commit. The
// commit message itself is now checked: its trailers are the long-standing Remediates line and the operator's, nothing
// else. The cluster number lives in the subject.
test('G-4, G-16: a commit\'s trailers are Remediates and the operator\'s only; the cluster number is in the subject', (t) => {
  const f = fixture(t, { hook: false });
  f.runRem(['--commit-trailer', 'Refs: G-1']);
  const body = git(f.repo, 'log', '-1', '--format=%B').stdout.trim().split('\n');
  assert.match(body[0], /^remediation \S+: G-1 \(cluster 1\)$/, body[0]);
  const trailers = body.slice(1).filter((l) => /^[A-Za-z0-9-]+: /.test(l));
  assert.deepEqual(trailers.map((l) => l.split(':')[0]), ['Remediates', 'Refs'], body.join('\n'));
});

// G-15: the row said a retry covers only clusters git or a hook refused, and also never-attempted ones.
test('G-15: the remediate row says a retry covers refused and never-attempted clusters, in one place', () => {
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`')) ?? '';
  assert.doesNotMatch(row, /re-attempts only the clusters git or a hook refused/);
  assert.match(row, /never attempted/);
  assert.doesNotMatch(row, /Remediation-Cluster/);
});

// ------------------------------------------------- 20261011-051153-commit-recovery-design-r5
// G-7: a retry refused because its re-plan no longer matched the recorded files left the edits in the tree but cleared
// pending_retry, so the follow-up could be minted with uncommitted edits. A refused retry now leaves the cluster pending
// for exactly as long as any of its recorded files is still changed.
test('G-7: a refused retry whose edits are still in the tree stays pending, and no follow-up is minted', (t) => {
  const f = fixture(t);
  f.runRem();
  const p = path.join(f.at(), 'evidence', 'remediation', 'payload.json');
  const payload = JSON.parse(fs.readFileSync(p, 'utf8'));
  payload.groups[0].files.push('src/b.js');
  fs.writeFileSync(p, JSON.stringify(payload));
  fs.writeFileSync(path.join(f.repo, 'src', 'b.js'), 'changed after the run\n');
  rerecordReport(f);
  const r = f.runRem(['--retry-commits', '--commit-trailer', TRAILER]);
  assert.equal(r.status, 1, r.output);
  const run = f.readRem();
  assert.equal(run.clusters[0].pending_retry, true, JSON.stringify(run.clusters[0]));
  assert.equal(run.followup_run_dir, undefined);
});

test('G-5: the request\'s commit_retries shape names resolved_from', { skip: privateRecord('.claude/requests/remediation-commit-recovery.md') }, () => {
  const req = fs.readFileSync(new URL('../.claude/requests/remediation-commit-recovery.md', import.meta.url), 'utf8');
  assert.match(req, /\{id, commit, reason\?, resolved_from\?\}/);
});

// ------------------------------------------------- 20261011-053415-commit-recovery-design-r6
// G-14: with one cluster unrecorded and another pending, a later invocation left through the pending branch and never
// printed the hand-mint command the unrecorded commit needs. Both are printed.
test('G-14: an unrecorded cluster beside a pending one still gets its hand-mint command printed', (t) => {
  const f = fixture(t, { hook: false, two: true });
  f.runRem(['--test-fail-rev-parse']);   // c1 lands unrecorded and the run stops; c2 was never attempted
  const run = f.readRem();
  assert.equal(run.clusters.find((c) => c.id === 'c1').unrecorded, true);
  assert.equal(run.clusters.find((c) => c.id === 'c2').pending_retry, true);
  const again = f.runRem();
  assert.equal(again.status, 1);
  assert.match(again.output, /--retry-commits/, again.output);
  assert.match(again.output, /--follows-remediation/, again.output);
});

// G-12: remediation_start came from an unchecked rev-parse; a failure made stray-commit detection read "none" and broke
// the recovery range. It now refuses before the node is spawned.
test('G-12: a run whose start commit cannot be read refuses before spawning the node', (t) => {
  const f = fixture(t, { hook: false });
  const r = f.runRem(['--test-fail-start-head']);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /rev-parse HEAD/);
  assert.equal(f.spawns(), 0);
});

// G-4 declined by the operator (2026-10-11: "Keep it, decline G-4 (Recommended)"): the request's non-goal names the
// runner's own Remediates line as the one trailer it writes.
test('G-4: the request\'s non-goal names Remediates as the runner\'s own line', { skip: privateRecord('.claude/requests/remediation-commit-recovery.md') }, () => {
  const req = fs.readFileSync(new URL('../.claude/requests/remediation-commit-recovery.md', import.meta.url), 'utf8');
  assert.match(req, /No automatic trailer[^\n]*Remediates/);
});

// G-5 of 20261020-233727-intent-unmark-remediation-6-review: the runner stopped printing a `git reset` for a failed unmark
// (G-4 of 20261020-225653-intent-unmark-remediation-5-review), and the owning row still said the message names one.
test('G-5: the contract says a failed unmark is recovered by --retry-commits, with no reset command printed', () => {
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs` |'));
  assert.ok(row, 'the scripts/remediate.mjs row is missing');
  assert.ok(!/git reset -q --/.test(row), 'the row still names a git reset command for the operator to run');
  assert.match(row, /could not unmark[^|]*no command[^|]*--retry-commits/);
});

// recovery-save-owner.plan.md (RS-D1 A; G-6, G-9 of 20261023-081135-rer-remediation-3-review): the fields resolveAttempts
// changes were spelled by hand at its two callers, and the lists already disagreed. G-8 of rer-remediation-2b-review was
// one such field (commit_check) missing from a list. resolveAttempts now returns the patch of what it changed, and both
// callers save exactly that, so a field it starts to change cannot be left out by a caller.
test('RS-D1: both callers save the patch resolveAttempts returns, and the two paths record the same fields', (t) => {
  const src = fs.readFileSync(new URL('../scripts/remediate.mjs', import.meta.url), 'utf8');
  const lines = src.split('\n');
  const callers = lines.map((l, i) => [l, i]).filter(([l]) => /resolveAttempts\((run|done)\)/.test(l) && !/function /.test(l));
  assert.equal(callers.length, 2, 'the two callers of resolveAttempts');
  for (const [, i] of callers) {
    const near = lines.slice(i, i + 4).join('\n');
    assert.match(near, /saveRun\((recovered|patch)\)/, `a caller saves a hand-listed patch:\n${near}`);
    assert.doesNotMatch(near, /saveRun\(\{\s*clusters:/, `a caller names the recovered fields itself:\n${near}`);
  }
  const recorded = (retry) => {
    const f = fixture(t, { hook: false, mode: 'no-red' });
    f.runRem(['--test-die-after-commit', 'c1']);
    f.runRem(retry ? ['--retry-commits'] : []);
    const run = f.readRem();
    return { keys: ['clusters', 'remediation_commits', 'commit_retries', 'commit_check'].filter((k) => k in run),
      cluster: Object.keys(run.clusters[0]).sort(), check: (run.commit_check ?? []).map((c) => c.kind).sort() };
  };
  assert.deepEqual(recorded(true), recorded(false), 'the retry path and the follow-up path recorded different fields');
});
