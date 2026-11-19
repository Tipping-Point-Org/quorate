// How many tests did the declared test command actually run?
//
// The number is not decoration: it decides TESTS-THIN, which declares how much weight a passing
// test run can bear. An undercount stamps a well-tested tree as thin; an overcount claims coverage
// that does not exist.
//
// Formats are matched INDIVIDUALLY and specifically, never by one loose pattern. A regex general
// enough to catch every runner also catches prose inside a failure message and inflates the count,
// and silent inflation is the worse error.

/** Strip ANSI colour. node:test emits "\x1b[34mℹ pass 42\x1b[39m", so a line-anchored pattern
 *  never matches the marker — the escape sequence sits in front of it. */
const decolour = (s) => String(s ?? '').replace(/?\[[0-9;]*m/g, '');

/**
 * Returns the number of tests reported, or NULL when no known format was recognised.
 *
 * The null is load-bearing. This used to return 0 for an unrecognised runner, which is
 * indistinguishable from "a suite that ran zero tests" — so TESTS-THIN fired on every runner the
 * function did not know. Observed on a real consuming project: pytest printed
 * "3 failed, 2097 passed, 4 skipped" and the run was stamped TESTS-THIN on 2101 tests, which makes
 * every finding claiming test coverage as mitigation inadmissible, on the strength of a parse
 * failure. Unknown must mean unknown.
 */
export function countTests(logText) {
  const txt = decolour(logText);
  let total = 0;
  let matched = false;

  // cargo: "test result: ok. 6 passed; 0 failed; 0 ignored; ... finished in 0.00s"
  for (const m of txt.matchAll(/test result:.*?(\d+) passed;\s*(\d+) failed/g)) {
    total += Number(m[1]) + Number(m[2]);
    matched = true;
  }

  // node:test: a TAP "# pass 42" / "# fail 0" pair, or the ℹ-prefixed spec reporter. Anchored to
  // line starts so a test NAME containing "pass 3" cannot contribute.
  for (const m of txt.matchAll(/^\s*(?:#|ℹ)\s*pass\s+(\d+)/gm)) { total += Number(m[1]); matched = true; }
  for (const m of txt.matchAll(/^\s*(?:#|ℹ)\s*fail\s+(\d+)/gm)) { total += Number(m[1]); matched = true; }

  // pytest: "3 failed, 2097 passed, 4 skipped, 2 warnings in 417.99s (0:06:57)".
  // Identified by BOTH a comma-separated count list AND pytest's timing tail, so prose cannot
  // match. cargo's line also carries "finished in 0.00s" and a passed count, so it is excluded
  // explicitly rather than left to regex luck — it was already counted above.
  for (const line of txt.split('\n')) {
    if (/test result:/.test(line)) continue;
    if (!/\bin\s+[\d.]+s\b/.test(line)) continue;
    if (!/\b\d+\s+(?:passed|failed)\b/.test(line)) continue;
    for (const m of line.matchAll(/\b(\d+)\s+(?:passed|failed)\b/g)) { total += Number(m[1]); matched = true; }
    break; // pytest prints exactly one summary line; never sum a second
  }

  return matched ? total : null;
}

/**
 * How many tests FAILED, in the same formats countTests recognises, or NULL when none was recognised
 * (remediation-verification.plan.md, stage 4: the runner's check of the whole reads failures, not only the exit code,
 * because a suite can exit non-zero with nothing failing — a counted-facts drift, a test-count floor). Unknown is
 * unknown here too: a runner this does not know is never read as zero failures.
 */
export function countFailures(logText) {
  const txt = decolour(logText);
  let failed = 0;
  let matched = false;
  for (const m of txt.matchAll(/test result:.*?\d+ passed;\s*(\d+) failed/g)) { failed += Number(m[1]); matched = true; }
  for (const m of txt.matchAll(/^\s*(?:#|ℹ)\s*fail\s+(\d+)/gm)) { failed += Number(m[1]); matched = true; }
  for (const line of txt.split('\n')) {
    if (/test result:/.test(line)) continue;
    if (!/\bin\s+[\d.]+s\b/.test(line)) continue;
    if (!/\b\d+\s+(?:passed|failed)\b/.test(line)) continue;
    const f = /\b(\d+)\s+failed\b/.exec(line);
    failed += f ? Number(f[1]) : 0;
    matched = true;
    break; // pytest prints exactly one summary line
  }
  return matched ? failed : null;
}
