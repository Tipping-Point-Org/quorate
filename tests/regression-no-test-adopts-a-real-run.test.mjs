// THE SUITE WROTE INTO COMMITTED RUN DIRECTORIES, AND RACED ITSELF DOING IT.
//
// Two tests in regression-egress-consent-source.test.mjs picked a run directory like this:
//
//   const runs = fs.readdirSync('.claude/reviews').filter(d => exists(d + '/run.json'));
//   const runDir = path.join(REPO_ROOT, '.claude', 'reviews', runs[0]);
//
// `runs[0]` is whichever archived run sorts first — a REAL, TRACKED artifact of a real review. Both
// tests then wrote `<runDir>/evidence/x/y.log` and `fs.rmSync(<runDir>/evidence/x)`. Same directory,
// same node id, same name, and the runner executes test FILES in parallel. One test removed the
// directory the other was writing into:
//
//   ENOENT: no such file or directory, open '.claude/reviews/20260902-030556-postbench/evidence/x/y.log'
//
// That is what stamped TESTS-FAILING on run 20260914-004236 while the suite passed in isolation, and
// it is the same shape as the atomic.mjs defect fixed days earlier: SHARED MUTABLE STATE REACHED
// THROUGH A NAME THAT IS NOT UNIQUE. It also passed on the next run, which is worse than failing —
// a flake that clears itself teaches a reader to re-run rather than to look.
//
// Two separate harms, and the second outlives the race:
//   1. the collision itself;
//   2. a test mutating a committed review artifact at all. Those directories are EVIDENCE — other
//      tests assert against them, the ledger references them, and a review's own history is the one
//      thing this framework cannot regenerate.
//
// `helpers.repoRunDir()` already existed and does exactly what was needed: mkdtempSync inside the
// repo, unique by construction, with a minimal valid run.json. The fix is to use it.
//
// This guard is deterministic where the race is not. A timing bug cannot be pinned by a timing test,
// so what is pinned instead is the PROPERTY that made it possible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, TESTS_DIR, TEST_HOME, REPO_PROJECT } from './helpers.mjs';
import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';

/**
 * Every test file's CODE, minus its comments and minus this file.
 *
 * Comments are stripped because a source-shape check that reads prose fails on its own rationale: the
 * sentence explaining why `runs[0]` is forbidden contains `runs[0]`. That trap was hit three times in
 * one sitting — backticked `executed` in ARCHITECTURE.md, "decided by a SINGLE judge" in run-graph,
 * and here — and each time the wrong reflex is to reword the comment, which makes the check
 * defeatable by anyone who phrases things differently. A guard is about what the code does.
 */
function testSources() {
  return fs.readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.test.mjs') && !f.includes('no-test-adopts-a-real-run'))
    .map((f) => {
      const raw = fs.readFileSync(path.join(TESTS_DIR, f), 'utf8');
      const src = raw
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split(/\r?\n/)
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join('\n');
      return { file: f, src };
    });
}

test('no test reaches into .claude/reviews to borrow a real run directory', () => {
  // The shape: read the reviews directory, then index into the result.
  const ADOPTS = /readdirSync\(\s*path\.join\([^)]*['"]\.claude['"]\s*,\s*['"]reviews['"]/;
  const offenders = testSources()
    .filter(({ src }) => ADOPTS.test(src) && /\bruns\[\d+\]|\[0\]/.test(src))
    .map(({ file }) => file);

  assert.deepEqual(offenders, [],
    'a committed run directory is EVIDENCE, not a fixture. Two tests sharing `runs[0]` wrote and '
    + 'removed the same evidence/x path under the parallel runner, which is what stamped '
    + 'TESTS-FAILING on run 20260914-004236. helpers.repoRunDir() mints a unique one.');
});

test('no test deletes anything inside .claude/reviews', () => {
  const src = testSources();
  const offenders = src
    .filter(({ src: s }) => /rmSync\([^)]*reviews/.test(s)
      || /rmSync\(path\.join\(runDir, 'evidence'/.test(s))
    .map(({ file }) => file);

  assert.deepEqual(offenders, [],
    'removing a path under a real run directory destroys review evidence and is half of the race: '
    + 'one test rmSync-ed the directory another was writing into.');
});

// The replacement must actually be unique per call, or this trades one shared name for another.
test('repoRunDir mints a directory no other caller can collide with', async () => {
  const { repoRunDir } = await import('./helpers.mjs');
  const a = repoRunDir();
  const b = repoRunDir();
  try {
    assert.notEqual(a.dir, b.dir, 'two calls must not produce one directory');
    for (const r of [a, b]) {
      assert.ok(fs.existsSync(path.join(r.dir, 'run.json')), 'a run dir without run.json is refused by capture');
      // Where this repository's runs are staged, under the suite's home (run-dir-trust stage 2): a run directory is
      // admitted only there or in the repository's own run roots (ARCHITECTURE A-28).
      const staging = defaultReviewsRoot({ project: REPO_PROJECT, repoRoot: REPO_ROOT, home: TEST_HOME });
      assert.ok(path.resolve(r.dir).startsWith(path.resolve(staging) + path.sep),
        'the run admission requires the directory to sit in one of the repository\'s run roots');
    }
  } finally {
    fs.rmSync(a.base, { recursive: true, force: true });
    fs.rmSync(b.base, { recursive: true, force: true });
  }
});
