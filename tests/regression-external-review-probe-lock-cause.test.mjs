// G-18 of 20261122-035227-m3s7-b3-review: the catch around withProbeLockAsync also caught a failure of runProbe or
// writeProbeRecord inside the held lock, and reported every one as "the probe's lock could not be taken". The cause is
// told apart by whether the callback was entered. Held by the source: the lock's contention cannot be timed from a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'scripts', 'external-review.mjs'), 'utf8');

test('a failure inside the held probe lock is not reported as a lock that could not be taken', () => {
  const at = src.indexOf('record = await withProbeLockAsync(');
  assert.ok(at > 0, 'the probe lock is not where this test looks');
  const block = src.slice(src.lastIndexOf('try {', at), src.indexOf("return record?.state === 'passed'", at));
  const cb = block.slice(block.indexOf('async () => {'), block.indexOf('} catch (e) {'));
  assert.match(cb, /^async \(\) => \{\s*(?:\/\/[^\n]*\s*)*held = true;/, 'the callback does not record that the lock was taken');
  const handler = block.slice(block.indexOf('} catch (e) {'));
  assert.match(handler, /held \?/, 'the catch reports every error as the lock not taken');
  assert.match(handler, /while its lock was held/);
});
