// G-5 and G-7 of 20261024-080423-rrr-remediation-2-review. The re-ask's aggregated duration was null as soon as one
// batch had none (a refused spawn), so the batches that ran lost theirs, where the barrier's batched status sums what
// was measured. And gate.md said a refused re-ask was "not re-asked" with no reason: a refused spawn leaves `why` null
// and its cause in the attempt's validator_errors. Both are lib's now, so a test drives each rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../scripts/lib/reconcile-batches.mjs';

test('G-5 (rrr-2): the summed duration keeps the batches that ran when one has none', () => {
  assert.equal(typeof lib.knownDuration, 'function', 'reconcile-batches.mjs has no owner of the batched duration');
  const st = (duration_ms) => ({ status: { duration_ms } });
  assert.equal(lib.knownDuration([st(1000), st(null)]), 1000, 'a refused batch dropped the duration of the one that ran');
  assert.equal(lib.knownDuration([st(1000), st(250)]), 1250);
  assert.equal(lib.knownDuration([st(-5), st('7'), st(undefined)]), 0, 'a value that is not a duration was summed');
  assert.equal(lib.knownDuration([]), 0);
});

test('G-7 (rrr-2): a re-ask not launched names why, from its validator errors when a spawn was refused', () => {
  assert.equal(typeof lib.reaskWhy, 'function', 'reconcile-batches.mjs has no owner of the re-ask\'s reason');
  assert.equal(lib.reaskWhy({ why: 'the barrier\'s time was used up', validator_errors: ['x'] }), 'the barrier\'s time was used up');
  assert.equal(lib.reaskWhy({ why: null, validator_errors: ['policy refused the spawn', 'second'] }),
    'policy refused the spawn; second', 'a refused spawn\'s cause was hidden from the gate');
  assert.equal(lib.reaskWhy({ why: null }), null);
  assert.equal(lib.reaskWhy({ validator_errors: [] }), null);
});
