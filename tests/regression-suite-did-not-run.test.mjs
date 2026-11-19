// A SUITE THAT COULD NOT RUN WAS REPORTED AS ONE THAT RAN AND FAILED — and it forced the gate.
//
// Observed in the first real consumer run (20260915-021139, .sandbox/story-pipeline). pytest exited 2:
//
//   ImportError while importing test module 'tests/integration/test_live_adapters.py'
//   E   ModuleNotFoundError: No module named 'storypipe'
//   !!!!!!! Interrupted: 224 errors during collection !!!!!!!
//
// ZERO tests executed — the package was not installed. `run-checks` stamps TESTS-FAILING on any
// non-zero exit, and `run-graph` then forces `gate = 'FAIL'`, outranking every lens. So sixteen nodes
// were told "The declared suite RAN AND FAILED ... report anything the failures conceal", when there
// were no failures to conceal, and the consumer's verdict read as "your code is broken" when the true
// statement was "nothing was tested".
//
// THE ENGINE ALREADY HELD THE EVIDENCE AND DID NOT COMBINE IT. The same checks.json recorded
// `exit_code: 2` AND `tests_reported: null`, and the run carried BOTH TESTS-FAILING and
// TESTS-UNCOUNTED. A suite that ran and failed REPORTS A COUNT; one that could not be collected
// reports none. That pairing needs no knowledge of pytest's exit vocabulary, which matters because the
// runner is contract-declared and could be anything.
//
// The two facts belong in different places, which is the whole point:
//   ran and failed   -> deterministic, reproducible, uncorrelated with any model — it FORCES the gate
//   could not run    -> nothing was learned — it belongs in not_checked[] and CAPS, like UNTESTED
//
// The design comment above the forcing line asks for a signal "deterministic, reproducible, and
// uncorrelated with any model's judgment". A missing package is none of the three.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { classifySuiteOutcome, stampCaps } from '../scripts/lib/decisions.mjs';

// THE CONSUMER CASE, and its expectation is WEAKER than it was — deliberately, under G-32.
//
// This asserted `stamp === 'TESTS-DID-NOT-RUN'` for pytest's collection error. But that run printed
// "Interrupted: 224 errors during collection" and no summary line, so countTests returns NULL, and
// null is precisely the case G-32 says must not be read as a positive claim: the same input arrives
// from a red jest suite, where "never started" is false. The engine cannot tell the two apart from a
// count, and inventing the distinction is how a red suite silently lost its forced FAIL.
//
// What this test is FOR survives intact and is what it now pins: the consumer was told "your code is
// broken" about code no test examined, and that must never happen again. Not TESTS-FAILING, no forced
// gate, and a stamp that caps. The claim about WHY is what got dropped, because it was never evidenced.
test('the consumer case is not reported as a failure and does not force the gate', () => {
  const o = classifySuiteOutcome({ exitCode: 2, testsReported: null });
  assert.notEqual(o.stamp, 'TESTS-FAILING',
    'sixteen nodes were told "the declared suite RAN AND FAILED — report anything the failures '
    + 'conceal" when there were no failures to conceal');
  assert.equal(o.forcesGate, false,
    'forcing FAIL on an uninstalled package tells a consumer their code is broken when it was '
    + 'never examined — the opposite of what the barrier is for');
  assert.equal(stampCaps([o.stamp]), true, 'and it cannot reach PASS either');
});

test('a non-zero exit WITH a count is a genuine failure and still forces the gate', () => {
  const o = classifySuiteOutcome({ exitCode: 1, testsReported: 2100 });
  assert.equal(o.ran, true);
  assert.equal(o.stamp, 'TESTS-FAILING');
  assert.equal(o.forcesGate, true,
    'a red suite outranks every lens: deterministic, reproducible, uncorrelated with any model');
});

test('did-not-run does NOT force the gate', () => {
  assert.equal(classifySuiteOutcome({ exitCode: 2, testsReported: null }).forcesGate, false,
    'forcing FAIL on an uninstalled package tells a consumer their code is broken when it was '
    + 'never examined — the opposite of what the barrier is for');
});

test('a passing suite is neither', () => {
  const o = classifySuiteOutcome({ exitCode: 0, testsReported: 2100 });
  assert.equal(o.ran, true);
  assert.equal(o.stamp, null);
  assert.equal(o.forcesGate, false);
});

// zero counted is the same evidence as uncounted: the runner said so explicitly instead of unparseably.
test('zero reported tests counts as did-not-run', () => {
  assert.equal(classifySuiteOutcome({ exitCode: 5, testsReported: 0 }).stamp, 'TESTS-DID-NOT-RUN');
});

// A PASSING run that counted nothing is NOT did-not-run — it is the uncounted case, already stamped.
test('a zero exit is never did-not-run, however uncountable', () => {
  const o = classifySuiteOutcome({ exitCode: 0, testsReported: null });
  assert.equal(o.stamp, null, 'TESTS-UNCOUNTED already covers an unparseable but passing run');
  assert.equal(o.ran, true);
});

// G-32 (HIGH, run 20260915-191832): UNKNOWN WAS READ AS A POSITIVE CLAIM.
//
// This function took `testsReported == null` to mean "the runner never started". But countTests
// returns null for every format it does not RECOGNISE — it knows cargo, node:test and pytest, and
// nothing else. Jest's "Tests: 1 failed, 5 passed" carries no timing tail and matches none of them.
// So a genuinely red jest, vitest, mocha or go suite was classified as one that never ran, and lost
// the forced FAIL that is the single verdict the gate says outranks every lens.
//
// countTests says so in its own docstring — "Unknown must mean unknown" — and this function was the
// one caller converting that unknown into an assertion. The three cases behind a non-zero exit are
// distinguishable without knowing any runner's exit vocabulary, which is the property that must not
// be traded away: a COUNT is evidence it ran, an explicit ZERO is evidence it did not, and NULL is
// the absence of evidence either way.
test('an unrecognised output format is unknown, not proof the runner never started', () => {
  const o = classifySuiteOutcome({ exitCode: 1, testsReported: null });
  assert.notEqual(o.stamp, 'TESTS-DID-NOT-RUN',
    'a red jest/vitest/mocha/go suite prints a format countTests does not parse. Calling that '
    + '"never started" states something no evidence supports, and silently drops a red suite.');
  assert.equal(o.ran, null, 'whether it ran is exactly what is not known');
  assert.equal(o.forcesGate, false,
    'it cannot force FAIL either — asserting failure on an unparsed log is the original defect '
    + 'with the sign flipped');
});

test('an explicit zero still means the runner ran nothing', () => {
  const o = classifySuiteOutcome({ exitCode: 5, testsReported: 0 });
  assert.equal(o.stamp, 'TESTS-DID-NOT-RUN',
    'the runner SAID zero — that is evidence, unlike a format nobody could parse');
  assert.equal(o.ran, false);
});

// G-48 (MEDIUM, run 20260915-191832): A SUITE THIS ENGINE KILLED WAS REPORTED AS ONE THAT NEVER RAN.
//
// run-checks calls capture.mjs with no --timeout-minutes, so capture applies its 10-minute default,
// SIGKILLs the child and records exit 124. A suite killed mid-flight has printed no summary line, so
// its count is null — and "too slow" then arrived wearing the same stamp as "could not start". A
// consumer suite longer than ten minutes is ordinary, and the operator got the wrong diagnosis: size
// your timeout is a different instruction from install your package.
//
// This one is NOT a runner-vocabulary problem, which is why it can be fixed at all: the engine chose
// the deadline, sent the signal, and wrote the exit code. A timeout is the engine's own fact about
// its own action, and refusing to record it is throwing away evidence nobody else could supply.
test('a suite the engine killed is reported as a timeout, not as one that never started', () => {
  const o = classifySuiteOutcome({ exitCode: 124, testsReported: null, timedOut: true });
  assert.equal(o.stamp, 'TESTS-TIMED-OUT',
    'the operator must be told to size the timeout, not to check their install');
  assert.notEqual(o.stamp, 'TESTS-DID-NOT-RUN', 'it started; it did not finish');
  assert.equal(o.forcesGate, false, 'a killed suite proves nothing about the code');
  assert.equal(stampCaps([o.stamp]), true, 'and nothing was established, so PASS is unreachable');
});

test('a timeout outranks the unparseable-output case that would otherwise catch it', () => {
  // Both are "non-zero exit, null count". The timeout is the MORE specific fact and must win, or the
  // engine discards something it alone knows in favour of admitting it knows nothing.
  const timed = classifySuiteOutcome({ exitCode: 124, testsReported: null, timedOut: true });
  const unknown = classifySuiteOutcome({ exitCode: 124, testsReported: null, timedOut: false });
  assert.equal(timed.stamp, 'TESTS-TIMED-OUT');
  assert.equal(unknown.stamp, 'TESTS-OUTCOME-UNKNOWN',
    'exit 124 alone is not proof of a timeout — capture maps every null status to 124, including a '
    + 'spawn failure and an output overflow, so the flag is the evidence and the code is not');
});

test('a timeout that still managed to report a count is a real failure', () => {
  // The suite ran, printed failures, then was killed. Its count is evidence, and a red suite is the
  // one verdict that outranks every lens — losing it to the timeout branch would be the G-32 defect
  // recreated one case over.
  // A FAILING count, not the total (G-3 of 20261018-035437-co-delivery): 40 tests that all passed before the kill are not this.
  const o = classifySuiteOutcome({ exitCode: 124, testsReported: 40, testsFailing: 40, timedOut: true });
  assert.equal(o.stamp, 'TESTS-FAILING');
  assert.equal(o.forcesGate, true);
});

// THIS PINNED CALL'S EXPECTATION CHANGED, on purpose (G-3 of 20261018-041929-co-remediation-review). It used to read
// `{ exitCode: 124, testsReported: 40, timedOut: true }` -> TESTS-FAILING. The operator decided G-48's rule on 2026-10-18
// ("Failing count only (Recommended)", .claude/requests/check-outcomes.plan.md): a suite that did not run to its own end
// is TESTS-FAILING only on a printed FAILING count, and a total alone is not one, with or without an outcome given.
test('a killed suite that printed a total but no failing count timed out; it is not failing (decided 2026-10-18)', () => {
  const o = classifySuiteOutcome({ exitCode: 124, testsReported: 40, timedOut: true });
  assert.equal(o.stamp, 'TESTS-TIMED-OUT', 'the old pinned call; its expectation changed by the operator\'s decision');
  assert.equal(o.forcesGate, false);
});

test('the unknown outcome caps the gate and cannot be silent', () => {
  const o = classifySuiteOutcome({ exitCode: 1, testsReported: null });
  assert.ok(o.stamp, 'an unreadable suite result must leave a mark; silence here reads as success');
  assert.equal(stampCaps([o.stamp]), true,
    'nothing was established about the suite, so the run must not be able to reach PASS on it');
});

// G-85 (MEDIUM, run 20260915-191832): THIS TEST IS WHY G-63 SHIPPED GREEN.
//
// It used to read `assert.match(runGraphSource, /TESTS-DID-NOT-RUN/)` under the name "the stamp is
// wired into the engine and carries a consequence". The only occurrence of that string in
// run-graph.mjs was a COMMENT claiming the stamp caps like UNTESTED — so the assertion passed while
// no gate branch read the stamp at all, and the feature was inert from the commit that introduced it.
// A source-shape assertion standing in for behaviour is exactly what A-16 names; the stamp list is
// now data (CAPPING_STAMPS) precisely so this can call the decision instead of grepping for a name.
test('TESTS-DID-NOT-RUN caps the gate, which is the consequence three documents promise it has', () => {
  assert.equal(stampCaps(['TESTS-DID-NOT-RUN']), true,
    'decisions.mjs:416, I-20 and stamp-consequences.json all say this stamp caps like UNTESTED. '
    + 'While nothing read it, a suite that never started reached PASS when the lenses passed — the '
    + 'opposite wrong verdict from the one 665dee7 set out to fix (G-63).');
});

test('the capping stamps are the ones the gate actually caps on', () => {
  for (const s of ['UNBUILT', 'UNTESTED', 'TREE-MOVED']) {
    assert.equal(stampCaps([s]), true, `${s} has always capped and must keep capping`);
  }
  assert.equal(stampCaps([]), false, 'no stamp, no cap');
  assert.equal(stampCaps(['UNCAPPED-BUDGET', 'UNSWEPT-DIFF']), false,
    'provenance stamps are not verdict ceilings — widening this list silently would cap every run');
});

test('the gate reads the declared list rather than spelling the stamps inline', () => {
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /if \(stampCaps\(stamps\)\) ceiling = 'RISK'/,
    'the ceiling must come from CAPPING_STAMPS. An inline condition is how a stamp gets promised '
    + 'by three documents and delivered by none, with nothing able to tell the difference.');
});

test('run-checks uses the shared classification', () => {
  const checks = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-checks.mjs'), 'utf8');
  assert.match(checks, /classifySuiteOutcome/,
    'run-checks must use the shared decision rather than re-deriving `!passed` locally');
});

test('every stamp this suite can raise states its consequence', () => {
  // I-49: a node told a bare stamp name is told nothing.
  const table = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'prompts', '_templates', 'stamp-consequences.json'), 'utf8'));
  assert.ok(typeof table['TESTS-DID-NOT-RUN'] === 'string' && table['TESTS-DID-NOT-RUN'].length > 40,
    'a node told TESTS-DID-NOT-RUN must be told what follows from it');
  assert.ok(!/RAN AND FAILED/.test(table['TESTS-DID-NOT-RUN']),
    'that is the sentence this stamp exists to stop being said');
});
