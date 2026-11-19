// G-8 of 20261024-041845-rrs-remediation-2-review. reaskMissing counted a re-ask as launched by `loop.done.length`,
// while reaskOutcome counted only entries whose status is not `launched: false`. The loop records a refused spawn, so a
// re-ask whose every batch was refused skipped the NOT-LAUNCHED branch: it was said to have run, its merged payload was
// written, and the report hash was replaced with null. One owner decides what launched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../scripts/lib/reconcile-batches.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G-8: a refused spawn is not launched, by the one owner', () => {
  assert.equal(typeof lib.launchedBatches, 'function', 'one owner counts the launched batches');
  const refused = { status: { state: 'BLOCKED', launched: false } };
  const ran = { status: { state: 'OK', launched: true } };
  assert.equal(lib.launchedBatches([refused]), 0);
  assert.equal(lib.launchedBatches([ran, refused]), 1);
  assert.equal(lib.reaskOutcome({ planned: 1, done: [refused], exhausted: null, firstStatus: {} }).batches, 0);
});

test('G-8: reaskMissing and the batch merge take launched from that owner, not from loop.done.length', () => {
  const src = fs.readFileSync(path.join(root, 'scripts', 'run-graph.mjs'), 'utf8');
  const start = src.indexOf('async function reaskMissing(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.doesNotMatch(body, /const launched = loop\.done\.length/, 'a refused spawn no longer counts as launched');
  assert.match(body, /const launched = outcome\.batches/, 'launched is reaskOutcome\'s count');
  assert.doesNotMatch(src, /done\.some\(\(d\) => d\.status\.launched !== false\)/, 'the barrier merge has no copy of the rule');
});
