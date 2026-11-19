// A REFUSED REMEDIATION COMMIT CAN BE RETRIED, WITH THE TRAILER THE CONSUMER'S HOOK ASKS FOR
// (.claude/requests/remediation-commit-recovery.md; operator, 2026-10-11: "Add retry + trailer (Recommended)").
// story-pipeline's remediation 20261010-235429-remediate-security-paths-settings fixed every group it was given, then its
// own contract-doc pre-commit hook refused the runner's commit and asked for a `Doc-Impact:` trailer. The runner
// composed the message with no way to add one, and a rerun skipped the commits whenever any were recorded, so the only
// way on was a hand commit that skips the runner's admission checks.
// Split into 5 files by split-slow-test-files.md; the others are regression-remediation-commit-recovery-*.test.mjs, and the
// fixture they share is remediation-commit-recovery-fixture.mjs.

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

test('AC1: a malformed --commit-trailer refuses the run before anything happens', (t) => {
  const f = fixture(t);
  for (const bad of ['no colon here', 'Doc-Impact:', 'Doc Impact: x', 'Doc-Impact: a\nSigned-off-by: b']) {
    const r = f.runRem(['--commit-trailer', bad]);
    assert.notEqual(r.status, 0, bad);
    assert.match(r.output, /--commit-trailer/);
  }
  assert.equal(f.spawns(), 0, 'nothing was spawned');
  assert.equal('remediation_commits' in f.readRem(), false, 'nothing was recorded');
});

test('AC1: trailers given on the first run reach every commit message and run.json', (t) => {
  const f = fixture(t);
  const r = f.runRem(['--commit-trailer', TRAILER, '--commit-trailer', 'Refs: G-1']);
  const run = f.readRem();
  assert.equal(run.remediation_commits.length, 1, r.output + JSON.stringify(run.commit_check));
  const msg = git(f.repo, 'log', '-1', '--format=%B').stdout;
  assert.ok(msg.includes(TRAILER) && msg.includes('Refs: G-1'), msg);
  assert.deepEqual(run.commit_trailers, [TRAILER, 'Refs: G-1']);
  noSecretReachesACleanFilter(t);   // G-5
});
