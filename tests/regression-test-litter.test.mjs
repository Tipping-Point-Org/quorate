// The test suite must not write into the history of the repository it tests.
//
// It did. Three run directories minted by the intent-drift probe were committed (0dab5dd), along
// with a `latest.txt` pointing at one of them — so the repository's recorded "most recent run" was
// a test fixture. They were untracked-then-tracked by an unrelated `git add -A`, which is how this
// class always lands: nobody decides to commit test litter, they just stage everything.
//
// helpers.mjs already carries the principle ("A test suite that silently writes into the tree it is
// testing is a small thing that hides a large one"). This is the enforcement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const ignored = (p) =>
  spawnSync('git', ['check-ignore', '-q', p], { cwd: REPO_ROOT }).status === 0;

// The slug the probe mints with is a LITERAL in the test. Reading it back means renaming the probe
// without extending .gitignore fails here, rather than silently resuming the old behaviour.
test('the run slug the drift probe mints is covered by .gitignore', () => {
  const probe = fs.readFileSync(
    path.join(REPO_ROOT, 'tests', 'regression-intent-drift-reach.test.mjs'), 'utf8');
  const slug = /const slug = `([a-z-]+)\$\{/.exec(probe)?.[1];
  assert.ok(slug, 'could not read the probe slug — if the test changed, this guard must change with it');

  assert.ok(ignored(`.claude/reviews/20260101-000000-${slug}123/`),
    `runs named '${slug}*' are not gitignored: the probe writes into .claude/reviews of the repository ` +
    `under test, and a stray 'git add -A' commits them`);
});

test('latest.txt is not tracked — the suite rewrites it on every run', () => {
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '.claude/reviews/latest.txt'],
    { cwd: REPO_ROOT }).status === 0;
  assert.equal(tracked, false,
    'latest.txt is a pointer the test suite rewrites; tracking it makes every suite run dirty the ' +
    'working tree and lets a test fixture become the repository\'s recorded latest run');
});

// Preservation was widened to EVERY seed so the envelopes carrying token accounting survive the
// worktree removal. The new `<stamp>-<seed>-run` name did not match the old `*-failed-run/` rule,
// leaving 2.8 MB of run forensics one `git add -A` from the history.
test('preserved bench run directories are ignored, but the scored results are not', () => {
  assert.ok(ignored('bench/results/2026-01-01T00-00-00-000Z-some-seed-run/'),
    'preserved per-seed run directories are machine-local forensics');
  assert.ok(ignored('bench/results/2026-01-01T00-00-00-000Z-some-seed-failed-run/'),
    'the failed-run case must stay covered by the widened rule');
  assert.equal(ignored('bench/results/2026-01-01T00-00-00-000Z.json'), false,
    'the scored result IS the recall record and must remain committable');
});

// The same guard for mintSlug(), which is what every OTHER test mints with. It did not have one,
// and the .gitignore rule written for it was `.claude/reviews/tmptest-*/` -- a pattern that matches
// nothing, because a run directory is `<timestamp>-<slug>` and the prefix is never the slug. So the
// rule was inert from the day it was added, and a fixture run reached a commit anyway.
//
// The sibling test above had the shape right all along, timestamp and all. This is that test for
// the other minting path: the prefix is read from helpers.mjs rather than restated, so renaming it
// fails here instead of quietly resuming the old behaviour.
test('the prefix mintSlug() mints with is covered by .gitignore', () => {
  const helpers = fs.readFileSync(path.join(REPO_ROOT, 'tests', 'helpers.mjs'), 'utf8');
  const prefix = /return `([a-z-]+)\$\{/.exec(helpers)?.[1];
  assert.ok(prefix, 'could not read the mintSlug prefix — if helpers.mjs changed, this guard must too');

  // A REALISTIC directory name. `.claude/reviews/${prefix}.../` is the shape the broken rule
  // assumed and no mint ever produces; asserting on it is how a rule that protects nothing passes
  // for protection.
  assert.ok(ignored(`.claude/reviews/20260101-000000-${prefix}abc123/`),
    `runs minted as '<timestamp>-${prefix}*' are not gitignored — which is the exact name new-run ` +
    'builds, and a stray `git add -A` commits them');
});
