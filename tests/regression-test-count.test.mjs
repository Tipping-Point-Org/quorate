// The test count decides TESTS-THIN, which declares how much weight a passing test run can bear —
// a thin suite makes every finding claiming test coverage as mitigation inadmissible.
//
// countTests knew cargo and node:test, and returned 0 for everything else. Zero is
// indistinguishable from "a suite that ran no tests", so TESTS-THIN fired on every runner it did
// not know. Found by installing quorate into a real consuming project: pytest printed
// "3 failed, 2097 passed, 4 skipped, 2 warnings in 417.99s" and the run was stamped TESTS-THIN on
// 2100 executed tests. The degradation was applied on a parse failure, not on evidence.
//
// Two fixes, and the second matters more than the first: pytest is now recognised, and an
// UNRECOGNISED format returns null rather than 0 — so a runner nobody anticipated fails safe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countTests } from '../scripts/lib/test-count.mjs';

test('regression: pytest summaries are counted, not read as an empty suite', () => {
  // The exact line from the consumer run that exposed this.
  assert.equal(countTests('3 failed, 2097 passed, 4 skipped, 2 warnings in 417.99s (0:06:57)'), 2100);
  assert.equal(countTests('2101 passed in 400.00s'), 2101);
  assert.equal(countTests('1 failed, 2 passed in 0.53s'), 3);
});

test('regression: an UNRECOGNISED runner returns null, never 0', () => {
  // This is the half that generalises. 0 would stamp TESTS-THIN on a suite of unknown size.
  for (const unknown of ['Ran 12 examples, 0 failures', 'All checks passed!', '', 'BUILD SUCCESSFUL']) {
    assert.equal(countTests(unknown), null, `${JSON.stringify(unknown)} must read as unknown, not zero`);
  }
});

test('a runner that genuinely ran zero tests still reports 0, not null', () => {
  // The distinction the null exists to preserve: recognised-and-empty is a real, stampable fact.
  assert.equal(countTests('# pass 0\n# fail 0'), 0);
  assert.equal(countTests('test result: ok. 0 passed; 0 failed; 0 ignored; finished in 0.00s'), 0);
});

test('the formats already supported keep working', () => {
  assert.equal(countTests('test result: ok. 6 passed; 0 failed; 0 ignored; finished in 0.00s'), 6);
  assert.equal(countTests('# pass 42\n# fail 3'), 45);
  assert.equal(countTests('\u001b[34mℹ pass 42\u001b[39m'), 42, 'ANSI colour must be stripped first');
});

test('regression: cargo is not double-counted by the pytest branch', () => {
  // cargo's line carries BOTH "6 passed" and a "finished in 0.00s" tail, so a loose pytest pattern
  // would count it twice. It is excluded explicitly rather than left to regex luck.
  assert.equal(countTests('test result: ok. 6 passed; 0 failed; 0 ignored; finished in 0.51s'), 6);
});

test('prose in a failure message cannot inflate the count', () => {
  // Silent inflation is the worse error: it claims coverage that does not exist.
  const log = 'FAILED test_x.py::test_y - AssertionError: expected 5 passed items in 3 groups\n';
  assert.equal(countTests(log), null, 'a failure message is not a summary line');
});
