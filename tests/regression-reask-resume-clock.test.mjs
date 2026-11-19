// G-11 of 20261024-032927-rrs-remediation-review: a --resume re-ask started its clock at Date.now(), so it was given
// the barrier's whole timeout and the time the original reconcile already used was ignored, though its budget was
// charged for that reconcile. The re-ask's start is the resume's now less the first reply's recorded duration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../scripts/lib/reconcile-batches.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G-11: a resumed re-ask is started as if the original reconcile had just used its recorded time', () => {
  assert.equal(typeof lib.reaskResumeStart, 'function', 'lib owns the resumed re-ask\'s start time');
  assert.equal(lib.reaskResumeStart({ now: 1_000_000, firstStatus: { duration_ms: 240_000 } }), 760_000);
  // An unknown or unusable duration charges no time, as before: nothing is known to have been used.
  assert.equal(lib.reaskResumeStart({ now: 1_000_000, firstStatus: {} }), 1_000_000);
  assert.equal(lib.reaskResumeStart({ now: 1_000_000, firstStatus: { duration_ms: -5 } }), 1_000_000);
  const src = fs.readFileSync(path.join(root, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.doesNotMatch(src, /reaskMissing\([^)]*Date\.now\(\)\)/, 'the resume does not start the re-ask on a fresh clock');
});
