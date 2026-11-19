// Remediation of review 20260930-011534-m0-gate-review-r2 (operator, 2026-09-30: "do suggested for all 5" — fix
// G-16 with its symptom G-14, and G-15, overruling D1 for the two false-PASS paths; fix G-17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as decisions from '../scripts/lib/decisions.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');

// G-16: the gate read the status file's state and never the did-not-report bucket, so a REQUIRED lens whose status was
// OK but whose verdict.kept.json was missing or refused landed in that bucket and still let the gate compute PASS.
test('G-16: a required node in the did-not-report bucket blocks the gate, whatever its status file says', () => {
  assert.equal(typeof decisions.blockingSilence, 'function', 'nothing decides which silent nodes block the gate');
  const expected = [
    { node_id: 'code-audit', required: true },
    { node_id: 'panel-codex-code', required: false },
  ];
  assert.deepEqual(
    decisions.blockingSilence({ didNotReport: [{ node_id: 'code-audit', why: 'OK but verdict.kept.json was refused' }], expected }),
    ['code-audit'],
  );
});

// An aux node (reconcile, intent-capture, second-opinion, intent.md) has no row in expected; each is pushed into the
// bucket only by a branch that already decided its silence blocks, so its presence there blocks.
test('G-16: a node the bucket names that has no row in expected (an aux node) blocks the gate', () => {
  assert.deepEqual(decisions.blockingSilence({ didNotReport: [{ node_id: 'reconcile' }], expected: [] }), ['reconcile']);
});

// G-14's missing ARM is not made blocking: an unavailable arm is recorded, not fatal, by design
// (shared/external-reviewers.md, "hard — the transport or runtime broke | not_checked, arm unavailable").
test('G-14: a non-required arm in the bucket does not block — an unavailable arm is documented as recorded, not fatal', () => {
  const expected = [{ node_id: 'panel-codex-code', required: false }];
  assert.deepEqual(decisions.blockingSilence({ didNotReport: [{ node_id: 'panel-codex-code' }], expected }), []);
});

test('G-16: absent input is not a clean bill — a bucket that is not a list is refused', () => {
  assert.throws(() => decisions.blockingSilence({ didNotReport: undefined, expected: [] }), /did_not_report/);
});

test('G-16: run-graph\'s gate chain blocks on blockingSilence', () => {
  const s = read('scripts', 'run-graph.mjs');
  assert.match(s, /else if \(silentBlocking\.length\) gate = 'BLOCKED';/, 'the gate never consults the did-not-report bucket');
  assert.match(s, /const silentBlocking = blockingSilence\(\{ didNotReport: buckets\.did_not_report, expected \}\)/);
});

// G-15: a corrupt or unreadable reconcile payload collapsed the adjudication floor to PASS.
test('G-15: an unreadable, corrupt or wrong-shaped reconcile payload is refused, never a PASS floor', () => {
  assert.equal(typeof decisions.adjudicationFloor, 'function', 'the floor is decided inline with a catch returning PASS');
  const ran = { groupCount: 2, reconcileState: 'OK' };
  for (const payloadText of [null, '{not json', '{"groups": "x"}', '[]']) {
    const r = decisions.adjudicationFloor({ ...ran, payloadText });
    assert.equal(r.floor, undefined, `payload ${JSON.stringify(payloadText)} produced a floor`);
    assert.match(r.refused, /\S/, `payload ${JSON.stringify(payloadText)} was not refused with a reason`);
  }
});

test('G-15: a readable payload yields its floor, and a run with nothing to adjudicate floors at PASS', () => {
  const judged = JSON.stringify({ groups: [
    { decision: 'confirmed', severity: 'HIGH' }, { decision: 'dropped', severity: 'BLOCKER' },
  ] });
  const r = decisions.adjudicationFloor({ groupCount: 2, reconcileState: 'OK', payloadText: judged });
  assert.equal(r.floor, decisions.verdictFloorFromFindings([{ decision: 'confirmed', severity: 'HIGH' }]));
  assert.deepEqual(decisions.adjudicationFloor({ groupCount: 0, reconcileState: 'SKIPPED', payloadText: null }), { floor: 'PASS' });
  // A reconciler that did not report OK is already blocked by reconcileSilent; its payload is not read.
  assert.deepEqual(decisions.adjudicationFloor({ groupCount: 3, reconcileState: 'DEGRADED', payloadText: null }), { floor: 'PASS' });
});

test('G-15: run-graph records a refused payload as the reconciler not reporting, and no catch returns PASS', () => {
  const s = read('scripts', 'run-graph.mjs');
  assert.doesNotMatch(s, /catch \{ return 'PASS'; \}/, 'a failed payload read still returns a PASS floor');
  assert.match(s, /adjudicationFloor\(\{[\s\S]{0,300}\}\);[\s\S]{0,400}if \(adjudication\.refused[\s\S]{0,300}node_id: 'reconcile'/,
    'a refused payload does not reach the did-not-report bucket');
});

// G-17: the contract doc said nothing of the refusal of a glob or doc_roles value outside the repository.
test('G-17: the contract doc states that a glob or doc_roles value outside the repository is refused', () => {
  const s = read('shared', 'claude-md-contract.md');
  assert.match(s, /outside the repository[\s\S]{0,400}refused|refused[\s\S]{0,400}outside the repository/i);
  assert.match(s, /doc_roles[\s\S]{0,600}outside the repository/);
});
