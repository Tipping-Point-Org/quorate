// G-8 of 20261105-181450-crsf-d1-remediation-2-review: readStopEvents' choice of which events a read keeps (the heap's
// order, its tie-break, what is dropped) was written inside the Host I/O module, while every other session-record
// decision lives in scripts/lib/session-record.mjs (ARCHITECTURE.md §2). It is lib's `newestEvents` now, tested pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../scripts/lib/session-record.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G-8: lib/session-record.mjs keeps the newest events, oldest first, ties in read order', () => {
  assert.equal(typeof lib.newestEvents, 'function', 'the selection rule is not in lib');
  const k = lib.newestEvents(3);
  let dropped = 0;
  for (const e of [{ at: 5, id: 'a' }, { at: 1, id: 'b' }, { at: 5, id: 'c' }, { at: 9, id: 'd' }, { at: 0, id: 'e' }]) dropped += k.keep(e);
  assert.equal(dropped, 2);
  assert.deepEqual(k.events().map((e) => e.id), ['a', 'c', 'd'], 'the newest three, a tie kept in read order');
});

test('G-8: the Host I/O module no longer carries the heap', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'io', 'stop-log.mjs'), 'utf8');
  assert.doesNotMatch(src, /const older = /, 'stop-log.mjs still owns the heap order');
  assert.match(src, /newestEvents\(maxEvents\)/, 'stop-log.mjs reads through lib');
});
