// regression-ciss-d1-contract-coverage.test.mjs — G-23 of review 20261021-162807-ciss-d1-review.
//
// new-run's contract-coverage check read `git ls-files` with `if (!r.out) return []`: a git that failed, or an output
// cut short by spawnSync's default buffer, read as "every tracked file is covered", and CONTRACT-PARTIAL was suppressed
// in the unsafe direction. The listing's outcome is now decided in one pure function, and a listing that did not
// complete leaves coverage UNKNOWN, which new-run stamps COVERAGE-UNKNOWN with the reason (since G-9 of
// 20261021-190234-ciss-d1-remediations-review; regression-ciss-d1-r3-coverage-unknown pins the stamp).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as scope from '../scripts/lib/finding-scope.mjs';

const contract = { source_globs: ['src/**'] };

test('G-23: a failed or truncated git ls-files leaves coverage unknown, never covered', () => {
  assert.equal(typeof scope.contractCoverage, 'function', 'contractCoverage is the decision new-run uses');
  for (const listing of [
    { status: 128, stdout: '', stderr: 'fatal: not a git repository' },
    { status: null, error: new Error('spawnSync git ENOBUFS'), stdout: 'src/a.js\0' },
    { status: 1, stdout: 'src/a.js\0' },
  ]) {
    const r = scope.contractCoverage(listing, contract);
    assert.ok(r.unknown, `listing ${JSON.stringify({ ...listing, error: String(listing.error ?? '') })} must leave coverage unknown`);
    assert.deepEqual(r.uncovered, []);
  }
});

test('G-23: a completed listing reports the uncovered files, NUL-separated', () => {
  const r = scope.contractCoverage({ status: 0, stdout: 'src/a.js\0other/b.txt\0' }, contract);
  assert.equal(r.unknown, null);
  assert.deepEqual(r.uncovered, ['other/b.txt']);
});

test('G-23: new-run stamps an unknown coverage rather than reading it as covered, and asks git with -z and a raised buffer', () => {
  const src = fs.readFileSync(new URL('../scripts/new-run.mjs', import.meta.url), 'utf8');
  assert.match(src, /contractCoverage\(/);
  assert.match(src, /'ls-files', '-z'/);
  assert.match(src, /coverage\.unknown/);
  assert.doesNotMatch(src, /if \(!r\.out\) return \[\];\s*return uncoveredFiles/);
});
