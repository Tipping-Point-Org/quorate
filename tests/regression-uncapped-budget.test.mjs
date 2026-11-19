// The dollar caps were never asked for. The operator ran quorate uncapped, and the per-node cap
// then did the one thing a budget ceiling exists to prevent: it killed a required lens (arch-review)
// mid-verdict at $4.23 against a $4.00 cap, and the run came back BLOCKED with nothing behind the
// block. Found in 20260903-225529-full-sweep-approved. Uncapping had to be a real contract state,
// not a number bumped high enough to usually not bind — so "" / "none" means Infinity, ABSENT keeps
// the conservative default, and an unknown-cost node under an uncapped tier charges 0 rather than
// poisoning the run total with Infinity.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetOf, isUncappedBudget, nodeSpend } from '../scripts/lib/decisions.mjs';

test('an empty or "none" budget key is uncapped; a number is itself; ABSENT keeps the default', () => {
  assert.equal(budgetOf('', 2.5), Infinity, '"" means no ceiling, not $0');
  assert.equal(budgetOf('none', 2.5), Infinity);
  assert.equal(budgetOf(null, 2.5), Infinity);
  assert.equal(budgetOf(undefined, 2.5), 2.5, 'an ABSENT key stays bounded by the built-in default');
  assert.equal(budgetOf('4.00', 2.5), 4.0);
  assert.equal(budgetOf(7, 2.5), 7);
});

// G-21, found by the verify run that distrusted this very fix (code-audit + panel-codex-code).
// budgetOf fell through to Number(v), so a plausible contract typo yielded NaN — and every consumer
// tests Number.isFinite, which cannot separate NaN from the deliberate Infinity sentinel. The run
// went FULLY UNCAPPED (spawn-node got 'none'; `spent >= BUDGET_RUN` was dead because nothing
// compares >= NaN) while new-run's stamp predicate did not recognise NaN and wrote no
// UNCAPPED-BUDGET stamp: an unbounded run stamped as bounded. A typo is not consent to spend
// without limit.
test('regression: an unparseable budget is REFUSED, never silently reinterpreted as uncapped', () => {
  for (const bad of ['$4.00', '4 USD', 'abc', 'NaN', '4,00', {}, []]) {
    assert.throws(
      () => budgetOf(bad, 2.5),
      /budget must be a non-negative number/,
      `${JSON.stringify(bad)} must be refused, not turned into NaN/uncapped`,
    );
  }
});

test('regression: a negative budget is refused too', () => {
  assert.throws(() => budgetOf(-1, 2.5), /non-negative/);
  assert.throws(() => budgetOf('-2.5', 2.5), /non-negative/);
});

test('the uncapped sentinel and real numbers still pass after the tightening', () => {
  assert.equal(budgetOf('', 2.5), Infinity);
  assert.equal(budgetOf('none', 2.5), Infinity);
  assert.equal(budgetOf('4.00', 2.5), 4);
  assert.equal(budgetOf(0, 2.5), 0);
  assert.equal(budgetOf(undefined, 2.5), 2.5);
});

test('regression: 0 is a real ceiling, not "uncapped"', () => {
  // The trap: `Number("")` is 0, so a naive `Number(v)` would turn an uncapped tier into a $0 cap
  // that blocks every node. isUncappedBudget must distinguish "" (off) from 0 (a real, if absurd,
  // ceiling that lets nothing run).
  assert.equal(isUncappedBudget(0), false);
  assert.equal(budgetOf(0, 2.5), 0);
  assert.equal(budgetOf('', 2.5), Infinity);
});

test('regression: Infinity comparison never fires the run-budget guard', () => {
  // The enforcement is `spent >= CAP`. Nothing is ever >= Infinity, so an uncapped run simply never
  // trips the guard — the property the whole scheme relies on.
  assert.equal(9_999_999 >= budgetOf('', 12), false);
});

test('regression: an unknown-cost node under an uncapped tier charges 0, not Infinity', () => {
  // A launched node with no reported cost falls back to the cap. Under an uncapped tier that cap is
  // Infinity; returning it would poison spentSoFar and the run's reported total. It must charge 0.
  const UNCAPPED = { budgetNode: Infinity, budgetBarrier: Infinity };
  assert.equal(nodeSpend({ node_id: 'arch-review', launched: true }, UNCAPPED), 0);
  assert.equal(nodeSpend({ mode: 'reconcile', launched: true }, UNCAPPED), 0);
  // A finite cap still charges the cap for an unknown-cost node — uncapping must not change that.
  assert.equal(nodeSpend({ node_id: 'arch-review', launched: true }, { budgetNode: 4, budgetBarrier: 7 }), 4);
});
