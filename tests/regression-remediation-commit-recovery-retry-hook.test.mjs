// Part 2 of 5 of regression-remediation-commit-recovery.test.mjs: --retry-commits after a hook rejected a cluster.
// Split by split-slow-test-files.md; the fixture is remediation-commit-recovery-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';
import { admitGroups } from '../scripts/lib/remediation-chain.mjs';
import { COMMIT_CHECK_KINDS } from '../scripts/lib/remediation-chain.mjs';
import { trailerError, isPending } from '../scripts/lib/remediation-chain.mjs';
import { git, fakeNode, fixture, noSecretReachesACleanFilter, refusedCommitRecordsNoDeclaration, retryRecordsDeclaredNoRed, retryCommitsATestOnlyFix, recoveryWithdrawsUnlandedDeclaration, TRAILER, rerecordReport } from './remediation-commit-recovery-fixture.mjs';

test('AC2: --retry-commits commits a hook-rejected cluster with the trailer, without spawning the node again', (t) => {
  const f = fixture(t);
  const before = f.head();
  f.runRem();
  assert.equal(f.head(), before, 'the hook refused the first attempt');
  assert.ok(f.readRem().commit_check.some((c) => c.kind === 'hook-rejected'), JSON.stringify(f.readRem().commit_check));
  const r = f.runRem(['--retry-commits', '--commit-trailer', TRAILER]);
  assert.equal(r.status, 0, r.output);
  assert.equal(f.spawns(), 1, 'the node was spawned once');
  const run = f.readRem();
  assert.notEqual(f.head(), before, 'committed on retry');
  assert.ok(git(f.repo, 'log', '-1', '--format=%B').stdout.includes(TRAILER));
  assert.equal(run.clusters[0].commit, f.head());
  assert.deepEqual(run.remediation_commits, [f.head()]);
  assert.equal(run.commit_retries.length, 1);
  assert.deepEqual(run.commit_retries[0].trailers, [TRAILER]);
  assert.deepEqual(run.commit_retries[0].clusters.map((c) => [c.id, c.commit]), [['c1', f.head()]]);
  assert.ok(run.followup_run_dir, 'the follow-up review was minted');
  retryRecordsDeclaredNoRed(t);   // G-8
  retryCommitsATestOnlyFix(t);    // G-17
  refusedCommitRecordsNoDeclaration(t);   // G-5 of rer-remediation-review-2
});
