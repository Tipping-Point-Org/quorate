// regression-ciss-d1-r3-coverage-unknown.test.mjs — G-9 and G-11 of review 20261021-190234-ciss-d1-remediations-review.
//
// A failed `git ls-files` was stamped CONTRACT-PARTIAL, the stamp whose meaning is that uncovered tracked files were
// FOUND, and the reason went to stderr only: a reader could not tell coverage never checked from coverage partial, and
// the protocol's stamp row (G-11) went stale. An unknown coverage now has its own stamp, COVERAGE-UNKNOWN, with its row
// and consequence, and the reason is kept in run.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('G-9: new-run stamps an unknown coverage COVERAGE-UNKNOWN, not CONTRACT-PARTIAL, and records the reason', () => {
  const src = read('scripts/new-run.mjs');
  const branch = src.match(/if \(coverage\.unknown\) \{([\s\S]*?)\} else if \(uncovered\.length\)/);
  assert.ok(branch, 'new-run branches on coverage.unknown before the uncovered files');
  assert.match(branch[1], /stamps\.push\('COVERAGE-UNKNOWN'\)/);
  assert.doesNotMatch(branch[1], /CONTRACT-PARTIAL/);
  assert.match(src, /contract_coverage_unknown: coverage\.unknown/, 'run.json keeps the reason');
});

test('G-11: the stamp table and the stamp consequences describe the two stamps apart', () => {
  const doc = read('shared/disk-first-protocol.md');
  assert.match(doc, /^\| `COVERAGE-UNKNOWN` \|/m, 'the protocol has a COVERAGE-UNKNOWN row');
  const consequences = JSON.parse(read('prompts/_templates/stamp-consequences.json'));
  assert.equal(typeof consequences['COVERAGE-UNKNOWN'], 'string');
  assert.match(consequences['COVERAGE-UNKNOWN'], /not checked/i);
});
