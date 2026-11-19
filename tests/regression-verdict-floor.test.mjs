// §2 states the floor plainly: FAIL is "at least one BLOCKER or HIGH finding the lens is prepared
// to defend", PASS is "found nothing above LOW", and "one FAIL verdict is a FAIL gate; the gate
// does not take a vote."
//
// Nothing enforced it. The validator stored payload.verdict exactly as the model produced it,
// applying only the roster's verdict CEILING, and writeGate reads node verdicts rather than
// severities — so a lens holding a BLOCKER could declare PASS and the gate would propagate it
// unchallenged. Found by absence: a repo-wide search for any comparison between a node's verdict
// and its kept findings' severities returned nothing.
//
// This is the system's own stated principle — a node cannot be trusted to disqualify its own
// output — unenforced at the one place it is most load-bearing. It is also the same defect twice:
// raised as G-44 in an earlier run, deferred, and raised again.
//
// The floor is derived from KEPT findings, after validation and after the severity clamp: "prepared
// to defend" means what survived, not what was claimed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictFloorFromFindings, raiseVerdict } from '../scripts/lib/decisions.mjs';

const F = (...sevs) => sevs.map((severity) => ({ severity }));

test('regression: a BLOCKER or HIGH forces a FAIL floor', () => {
  assert.equal(verdictFloorFromFindings(F('BLOCKER')), 'FAIL');
  assert.equal(verdictFloorFromFindings(F('HIGH')), 'FAIL');
  assert.equal(verdictFloorFromFindings(F('LOW', 'MEDIUM', 'HIGH')), 'FAIL');
});

test('MEDIUM forbids PASS but not RISK — PASS means nothing above LOW', () => {
  assert.equal(verdictFloorFromFindings(F('MEDIUM')), 'RISK');
  assert.equal(verdictFloorFromFindings(F('LOW', 'MEDIUM')), 'RISK');
});

test('only LOW findings, or none, leave PASS available', () => {
  assert.equal(verdictFloorFromFindings(F('LOW')), 'PASS');
  assert.equal(verdictFloorFromFindings([]), 'PASS');
});

test('regression: a lens declaring PASS while holding a BLOCKER is RAISED to FAIL', () => {
  assert.equal(raiseVerdict('PASS', verdictFloorFromFindings(F('BLOCKER'))), 'FAIL');
  assert.equal(raiseVerdict('RISK', verdictFloorFromFindings(F('HIGH'))), 'FAIL');
});

test('the floor never LOWERS a verdict — a lens may always judge worse than its findings', () => {
  // A lens is entitled to say FAIL on LOW findings if it is prepared to defend that; the floor
  // exists to stop under-reporting, not to overrule a reviewer's judgment downward.
  assert.equal(raiseVerdict('FAIL', 'PASS'), 'FAIL');
  assert.equal(raiseVerdict('RISK', 'PASS'), 'RISK');
  assert.equal(raiseVerdict('FAIL', 'RISK'), 'FAIL');
});

test('an unrecognised severity does not silently lower the floor', () => {
  // Model output, so it degrades safely rather than throwing — but it must not read as "harmless".
  assert.equal(verdictFloorFromFindings([{ severity: 'CATASTROPHIC' }]), 'RISK');
  assert.equal(verdictFloorFromFindings([{}]), 'RISK');
});
