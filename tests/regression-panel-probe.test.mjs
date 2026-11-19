// The live-transport gap, and the two ways of hiding it.
//
// The offline suite stops before every spawn, so no test here can see a transport regression —
// that is what scripts/check-reviewers.mjs is for. What CAN be pinned offline is the two decisions
// that make its report honest:
//
//   1. an absent CLI ('unavailable', a fact about the operator's machine) must never be reported
//      as the same thing as a broken shipped transport ('malformed', a fact about our code).
//      Collapsing them would let a transport regression hide behind an uninstalled reviewer.
//   2. the check must refuse to spend money unless the operator asked for it, so no hook, habit
//      or barrier can quietly turn the free suite into a billed one.
//
// Found by: cross-project review, 2026-08-24 — the framework whose entire job is driving three
// CLIs had nothing that ever invoked one, and did not say so anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyPanelProbe } from '../scripts/lib/decisions.mjs';
import { runScript } from './helpers.mjs';

const envelope = (over = {}) => ({
  schema_version: 1,
  source: 'agy',
  verdict: 'PASS',
  findings: [],
  checked_clean: [],
  not_checked: [],
  ...over,
});

test('an arm that answered in the envelope shape is reachable', () => {
  const { state } = classifyPanelProbe(envelope(), 'agy');
  assert.equal(state, 'reachable');
});

test('regression: an absent CLI is unavailable, NOT malformed', () => {
  // external-review.mjs reports absence by naming the reviewer in not_checked[] — the same shape a
  // real run would carry. Reading that as a broken transport would send someone debugging this
  // repository over a missing PATH entry.
  const env = envelope({
    verdict: 'RISK',
    not_checked: [{ item: "external reviewer 'agy'", reason: "'agy' is not on PATH" }],
  });
  const { state, reason } = classifyPanelProbe(env, 'agy');
  assert.equal(state, 'unavailable');
  assert.match(reason, /PATH/, 'the operator needs the reason, not just the state');
});

test('regression: a broken shipped transport is malformed, NOT unavailable', () => {
  // These are OUR failures: nothing parseable on stdout, the wrong schema version, or an envelope
  // attributed to a different arm. Each would otherwise read as "that CLI is not installed".
  assert.equal(classifyPanelProbe(null, 'agy').state, 'malformed');
  assert.equal(classifyPanelProbe(envelope({ schema_version: 2 }), 'agy').state, 'malformed');
  assert.equal(classifyPanelProbe(envelope({ source: 'codex' }), 'agy').state, 'malformed');
});

test("another arm's not_checked entry does not mark this arm unavailable", () => {
  const env = envelope({
    not_checked: [{ item: "external reviewer 'codex'", reason: 'timed out' }],
  });
  assert.equal(classifyPanelProbe(env, 'agy').state, 'reachable');
});

// check-panel.mjs's two refusals moved with it (reviewer-preflight stage 4): refusing to spend without QUORATE_LIVE=1
// is regression-reviewer-preflight's check-reviewers test, and refusing a reviewer it does not know is
// regression-tiebreak-probe's (its fixture name, like this one, can never become valid).

test('regression: an unpinned-runtime note does not make a reachable arm look unavailable', () => {
  // The classifier matched any not_checked item CONTAINING the reviewer's name. When the adapter
  // began reporting an unpinned model as `{item: "codex model"}`, a live probe that returned PASS
  // was classified `unavailable` — a working transport reported as a broken one. Found by the
  // 2026-08-31 live probe; the offline suite could not see it because both arms answered.
  const envelope = {
    schema_version: 1, source: 'codex', verdict: 'PASS',
    not_checked: [
      { item: 'codex model', reason: 'not pinned; ambient default' },
      { item: 'codex reasoning effort', reason: 'not pinned; ambient default' },
    ],
  };
  assert.deepEqual(classifyPanelProbe(envelope, 'codex'), { state: 'reachable', reason: 'verdict PASS' });
});

test('the arm genuinely not running is still unavailable, by the exact item unavailable() writes', () => {
  for (const item of ["external reviewer 'codex'", "external proposer 'codex'"]) {
    const envelope = {
      schema_version: 1, source: 'codex', verdict: 'RISK',
      not_checked: [{ item, reason: "'codex' is not on PATH" }],
    };
    assert.deepEqual(
      classifyPanelProbe(envelope, 'codex'),
      { state: 'unavailable', reason: "'codex' is not on PATH" },
    );
  }
});
