// Part 3 of 5 of regression-remediation-commit-recovery.test.mjs: what a retry commits, refuses and documents. Split by
// split-slow-test-files.md; the fixture is remediation-commit-recovery-fixture.mjs.

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

test('AC2: a retried cluster whose file is no longer changed is not committed, and is named', (t) => {
  const f = fixture(t);
  f.runRem();
  git(f.repo, 'checkout', '--', 'src/a.js');
  const before = f.head();
  const r = f.runRem(['--retry-commits', '--commit-trailer', TRAILER]);
  assert.notEqual(r.status, 0, r.output);
  assert.equal(f.head(), before);
  const retry = f.readRem().commit_retries?.[0];
  assert.ok(retry && retry.clusters[0].commit === null && /src\/a\.js/.test(retry.clusters[0].reason), JSON.stringify(retry));
});

test('AC2: --retry-commits refuses a run never run, and a run with no refused commit to retry', (t) => {
  const f = fixture(t);
  const never = f.runRem(['--retry-commits']);
  assert.notEqual(never.status, 0);
  assert.match(never.output, /--retry-commits/);
  assert.equal(f.spawns(), 0, 'the node was not spawned');
  const g = fixture(t, { hook: false });
  g.runRem();
  // A clean first run minted its follow-up; mint a run whose commits went through but whose follow-up is absent:
  const run = g.readRem();
  delete run.followup_run_dir; delete run.followup_run_id;
  fs.writeFileSync(path.join(g.at(), 'run.json'), JSON.stringify(run));
  const none = g.runRem(['--retry-commits']);
  assert.notEqual(none.status, 0);
  assert.match(none.output, /no cluster to retry/);
});

test('AC3: a rerun without --retry-commits behaves as before: nothing committed, exit 1', (t) => {
  const f = fixture(t);
  f.runRem();
  const before = f.head();
  const r = f.runRem();
  assert.equal(r.status, 1, r.output);
  assert.equal(f.head(), before);
  assert.equal(f.spawns(), 1);
});

test('AC4: the remediate row and the skill document the retry and the trailer', () => {
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`')) ?? '';
  for (const s of ['--retry-commits', '--commit-trailer', 'commit_retries', 'commit_trailers']) assert.ok(row.includes(s), s);
  const skill = fs.readFileSync(new URL('../skills/remediate/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /--retry-commits/);
  assert.match(skill, /--commit-trailer/);
});

// The LOWs of 20261011-000159-commit-admission-r2, folded in.
test('r2 G-1, G-10, G-11: COMMIT-CHECK\'s explanation and the §7 row name the new kinds', () => {
  const stamps = JSON.parse(fs.readFileSync(new URL('../prompts/_templates/stamp-consequences.json', import.meta.url), 'utf8'));
  const text = JSON.stringify(stamps['COMMIT-CHECK'] ?? stamps);
  const protocol = fs.readFileSync(new URL('../shared/disk-first-protocol.md', import.meta.url), 'utf8');
  const row = protocol.split('\n').find((l) => l.startsWith('| `COMMIT-CHECK`')) ?? '';
  for (const k of ['not-committable', 'deferred-file-unchecked']) {
    assert.ok(text.includes(k), `stamp-consequences names ${k}`);
    assert.ok(row.includes(k), `§7 names ${k}`);
  }
});

test('r2 G-5: a deferred-file entry records the path as the node reported it', () => {
  const { checks } = admitGroups({ caseInsensitive: true, 
    groups: [{ group_id: 'G-1', disposition: 'fixed', cluster: 'c1', files: ['src/Mixed.js'] }],
    confirmed: ['G-1', 'G-2'], deferred: ['G-2'], deferredFindingFiles: { 'G-2': ['SRC/mixed.js'] },
  });
  const e = checks.find((c) => c.kind === 'deferred-file');
  assert.equal(e?.file, 'src/Mixed.js', JSON.stringify(checks));
});

// G-3 (with G-11, G-12): a follow-up was minted as soon as ANY cluster committed, and a minted follow-up refuses
// --retry-commits, so a hook-rejected cluster beside a committed one could not be recovered — and the follow-up reviewed
// a diff with the rejected edits still in the tree. While a refused cluster is pending, no follow-up is minted.
test('G-3: with one cluster committed and one hook-rejected, no follow-up is minted until the retry', (t) => {
  const f = fixture(t, { hook: 'g2', two: true });
  const first = f.runRem();
  assert.equal(first.status, 1, first.output);
  assert.match(first.output, /--retry-commits/);
  const run1 = f.readRem();
  assert.equal(run1.remediation_commits.length, 1, JSON.stringify(run1.clusters));
  assert.equal(run1.followup_run_dir, undefined, 'no follow-up while c2 is pending');
  const r = f.runRem(['--retry-commits', '--commit-trailer', TRAILER]);
  assert.equal(r.status, 0, r.output);
  const run2 = f.readRem();
  assert.equal(run2.remediation_commits.length, 2);
  assert.ok(run2.followup_run_dir, 'minted once nothing is pending');
  assert.equal(f.spawns(), 1);
});

test('G-3: discarding the refused edits and retrying records the cluster refused and mints the follow-up', (t) => {
  const f = fixture(t, { hook: 'g2', two: true });
  f.runRem();
  git(f.repo, 'checkout', '--', 'src/b.js', 'tests/b.test.js');
  f.runRem(['--retry-commits']);
  const run = f.readRem();
  assert.equal(run.clusters.find((c) => c.id === 'c2').commit, null);
  assert.ok(run.followup_run_dir, 'the operator abandoned c2, so the follow-up of c1 is minted');
});

// G-8: a failed retry left the cluster's reason and output at the first attempt's values.
test('G-8: a retry the hook refuses again records its own output on the cluster', (t) => {
  const f = fixture(t);
  f.runRem();
  const firstOutput = f.readRem().clusters[0].output;
  f.runRem(['--retry-commits']);
  const c = f.readRem().clusters[0];
  assert.ok(c.output && c.output !== firstOutput, `${firstOutput} -> ${c.output}`);
  assert.equal(f.readRem().commit_retries[0].clusters[0].commit, null);
});

// G-6, G-5: the retry re-implemented admission and skipped the planner's rules; it now goes through planClusterCommits,
// so a refused file is named with the same kind a first run uses.
test('G-6: a retry names a file git no longer lists as changed with the planner\'s refused-file', (t) => {
  const f = fixture(t);
  f.runRem();
  git(f.repo, 'checkout', '--', 'tests/a.test.js');
  const before = f.head();
  f.runRem(['--retry-commits', '--commit-trailer', TRAILER]);
  assert.equal(f.head(), before);
  const checks = f.readRem().commit_check;
  assert.ok(checks.some((c) => c.kind === 'refused-file' && /tests\/a\.test\.js/.test(c.message)), JSON.stringify(checks));
});

// G-7: which kinds a retry may re-attempt is the vocabulary's property, not a list in the runner.
// remediation-verification stage 4 adds the runner's own refusals, full-run-red and tree-not-candidate: both leave the
// cluster's edits in the tree for a retry that checks the candidate again.
test('G-7: retryable is a property of COMMIT_CHECK_KINDS, true only for hook-rejected, reset-failed and the full check\'s two', () => {
  const retryable = Object.entries(COMMIT_CHECK_KINDS).filter(([, v]) => v.retryable).map(([k]) => k).sort();
  assert.deepEqual(retryable, ['full-run-red', 'hook-rejected', 'reset-failed', 'tree-not-candidate']);
});

test('G-12: the remediate row says no follow-up is minted while a refused cluster is pending', () => {
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`')) ?? '';
  assert.match(row, /pending/);
});

// G-10 (with G-11): abandoning a pending cluster was documented as "the follow-up is minted", which holds only when
// some other cluster was committed; with nothing committed, nothing is minted.
test('G-10: the remediate row and the skill say an abandoned retry mints the follow-up only if something was committed', () => {
  const doc = fs.readFileSync(new URL('../shared/claude-md-contract.md', import.meta.url), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`')) ?? '';
  assert.match(row, /abandon[^.]*if (?:any|another) cluster was committed/i);
  assert.match(row, /pending_retry\?/, 'pending_retry is in the documented cluster shape');
  const skill = fs.readFileSync(new URL('../skills/remediate/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /if (?:any|another) cluster was committed/i);
});

// G-3: the trailer rule required a leading letter, stricter than "Key: value"; and with G-5 it was a pure decision living
// in the orchestrator. Both rules now live in lib/remediation-chain.mjs.
test('G-3, G-5: trailerError accepts any Key of letters, digits and dashes, and isPending lives in lib', () => {
  for (const ok of ['Doc-Impact: none', '2nd-Key: x', '-Weird: y']) assert.equal(trailerError(ok), null, ok);
  for (const bad of ['no colon', 'Key:', 'Two Words: x', 'Key: a\nB: c']) assert.ok(trailerError(bad), bad);
  assert.equal(isPending({ id: 'c1', commit: null, pending_retry: true }, {}), true);
  assert.equal(isPending({ id: 'c1', commit: 'abc' }, {}), false);
  assert.equal(isPending({ id: 'c1', commit: null }, { commit_check: [{ cluster: 'c1', kind: 'hook-rejected' }] }), true, 'an older run');
});
