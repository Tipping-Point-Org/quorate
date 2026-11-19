// G-10 of 20261025-222928-tel-remediation-3-review: notAMeasurement, a pure decision over an already-parsed results file,
// was owned by the I/O module (scripts/io/telemetry-record.mjs), so reusing the policy meant importing the file system.
// ARCHITECTURE §2 puts a pure decision in scripts/lib; the I/O module re-exports the one owner rather than keeping a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../scripts/lib/telemetry-record.mjs';
import * as io from '../scripts/io/telemetry-record.mjs';

test('notAMeasurement is owned by lib/telemetry-record.mjs, and the I/O module\'s is the same function', () => {
  assert.equal(typeof lib.notAMeasurement, 'function', 'lib/telemetry-record.mjs does not own notAMeasurement');
  assert.equal(io.notAMeasurement, lib.notAMeasurement, 'the I/O module keeps its own copy of the predicate');
  assert.equal(lib.notAMeasurement({ not_a_measurement: 'forge' }), true);
  assert.equal(lib.notAMeasurement({ not_a_measurement: false }), false);
  assert.equal(lib.notAMeasurement(null), false);
});
