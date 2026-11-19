// The ledger's coverage of a file must follow the same scope rule as usage-report's (lib/reviewed-run.mjs inScope).
//
// G-9 (root of G-10) of 20261031-022756-urr-remediation-review: coverageOf compared every scope as a literal prefix, so a
// full sweep's `.` normalised to an empty prefix and a glob stayed literal text: neither covered an ordinary file, and the
// ledger could not record silence or confirm a fix for such a run, while usage-report credited the same scope.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coveredByRun } from '../scripts/lib/ledger.mjs';
import { inScope } from '../scripts/lib/reviewed-run.mjs';

test('G-9: a `.` or glob scope covers the files it names, in the ledger as in usage-report', () => {
  const cases = [
    [['.'], 'scripts/a.mjs', true],
    [['./'], 'a.txt', true],
    [['scripts/**'], 'scripts/lib/a.mjs', true],
    [['*.txt'], 'a.txt', true],
    [['*.txt'], 'a.mjs', false],
    [['scripts'], 'scripts/a.mjs', true],
    [['scripts'], 'tests/a.mjs', false],
  ];
  for (const [scope, file, want] of cases) {
    assert.equal(inScope(scope, file), want, `usage-report: ${scope} / ${file}`);
    assert.equal(coveredByRun(file, scope), want, `ledger: ${scope} / ${file}`);
  }
});

test('G-9: a path that climbs above the root is covered by no scope, `.` included', () => {
  assert.equal(coveredByRun('../outside.txt', ['.']), false);
  assert.equal(coveredByRun('scripts/../../x', ['scripts/**']), false);
  assert.equal(coveredByRun('scripts/../x.mjs', ['scripts']), false);
});
