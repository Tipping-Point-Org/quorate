// The degraded caps: a severity ceiling that silently disabled itself, and a verdict ceiling that
// was never a separate concept until it had to be.
//
// Found by: contract-audit + code-audit, 20260804-184124-fullsweep (G-7 in that run's numbering).
// The evidence was contract-audit's own status file: no severity_clamped counter, and four HIGH
// findings out of an inferred-request run that was supposed to make HIGH impossible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampSeverity, capVerdict } from '../scripts/lib/decisions.mjs';
import { repoRunDir, runScript } from './helpers.mjs';

// THE BUG. The clamp guarded with `RUNGS.includes(ceiling)` and fell through when it failed. Every
// degraded lens was handed 'RISK' — a VERDICT — in the severity slot, so the guard failed, the
// clamp was skipped entirely, and expected.json/the brief/the docs all reported a cap that did not
// exist. Silence was the failure mode; this test makes noise the failure mode.
test('regression: a verdict in the severity slot throws instead of silently disabling the clamp', () => {
  assert.throws(
    () => clampSeverity('HIGH', { ceiling: 'RISK' }),
    /not a severity|must be one of/,
    'RISK is a verdict; passing it here must be fatal, never a no-op',
  );
});

test('regression: a degraded lens cannot ship a HIGH finding under a MEDIUM ceiling', () => {
  assert.equal(clampSeverity('HIGH', { ceiling: 'MEDIUM' }), 'MEDIUM');
  assert.equal(clampSeverity('BLOCKER', { ceiling: 'MEDIUM' }), 'MEDIUM');
  assert.equal(clampSeverity('LOW', { ceiling: 'MEDIUM' }), 'LOW', 'clamping must not RAISE');
});

test('a floor lifts, a ceiling caps, and both together still order correctly', () => {
  assert.equal(clampSeverity('LOW', { floor: 'MEDIUM' }), 'MEDIUM');
  assert.equal(clampSeverity('BLOCKER', { floor: 'LOW', ceiling: 'HIGH' }), 'HIGH');
});

// Model output degrades safely; our configuration fails loudly. The asymmetry is deliberate.
test('an unrecognised severity from a model floors to LOW rather than throwing', () => {
  assert.equal(clampSeverity('CATASTROPHIC'), 'LOW');
  assert.equal(clampSeverity(undefined), 'LOW');
});

test('regression: verdict ceilings are their own parameter and cap independently', () => {
  assert.equal(capVerdict('FAIL', 'RISK'), 'RISK');
  assert.equal(capVerdict('PASS', 'RISK'), 'PASS', 'a ceiling must never raise a verdict');
  assert.equal(capVerdict('FAIL', null), 'FAIL', 'no ceiling means no change');
  assert.throws(() => capVerdict('FAIL', 'MEDIUM'), /must be one of/, 'a severity is not a verdict');
});

// The same rule, enforced at the process boundary — proving the CLI rejects the misconfiguration
// rather than accepting it and dying later, or worse, accepting it and doing nothing.
test('regression: spawn-node refuses --severity-ceiling RISK at argument-parse time', () => {
  const r = runScript('spawn-node.mjs', [
    // One of this repository's runs, so admission passes and the ceiling is what refuses (run-dir-trust.plan.md stage 3,
    // ARCHITECTURE A-28). --print-cmd: no child is spawned should the refusal ever regress.
    '--print-cmd', '--run-dir', repoRunDir({ prefix: 'quorate-caps-' }).dir, '--node-id', 'x', '--mode', 'lens',
    '--schema-variant', 'code', '--skill-command', '/x',
    '--allowed-basis', 'convention', '--severity-ceiling', 'RISK',
  ]);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /--severity-ceiling must be one of/);
  assert.match(r.output, /--verdict-ceiling/, 'the refusal must say where RISK belongs');
});
