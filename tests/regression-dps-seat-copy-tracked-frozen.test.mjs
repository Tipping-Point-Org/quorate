// G-1 of 20261110-022503-dps-remediation-4-review: copyIntoSeatDir compared the whole tracked array with its cached copy
// on every call, so T tracked files over R seat rounds cost T x R string compares even when the array never changed. A
// frozen array cannot change, so its cached set is used with no compare; decide.mjs freezes the `git ls-files` list it
// passes to every seat call. An array that is not frozen is still compared, so one changed after a first call is not
// answered from its earlier contents (G-4 of 20261110-014035-dps-remediation-3-review).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyIntoSeatDir } from '../scripts/io/seat-copies.mjs';

function counting(list) {
  const state = { reads: 0 };
  const proxy = new Proxy(Object.freeze(list), { get(target, k, r) {
    if (typeof k === 'string' && /^\d+$/.test(k)) state.reads += 1;
    return Reflect.get(target, k, r);
  } });
  return { proxy, state };
}

test('G-1: a frozen tracked list is not rescanned on a later seat call', (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-frozen-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'tracked text\n');
  const names = Array.from({ length: 500 }, (_, i) => `dir/f${i}.txt`).concat(['a.txt']);
  const { proxy, state } = counting(names);
  const owner = { create() {} };
  const first = copyIntoSeatDir({ repoRoot, owner, segs: ['s'], paths: ['a.txt'], tracked: proxy });
  assert.deepEqual(first.copied, ['a.txt']);
  state.reads = 0;
  for (let i = 0; i < 3; i += 1) {
    const again = copyIntoSeatDir({ repoRoot, owner, segs: ['s'], paths: ['a.txt'], tracked: proxy });
    assert.deepEqual(again.copied, ['a.txt']);
  }
  assert.equal(state.reads, 0, `${state.reads} element reads of a frozen tracked list over three later calls: it was rescanned each call`);
});

test('G-1: decide.mjs freezes the tracked list it hands every seat call', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'decide.mjs'), 'utf8');
  assert.match(src, /const trackedFiles = Object\.freeze\(nulList\(gitOut\(\['ls-files', '-z'\]\)\)\);/,
    'decide.mjs passes a tracked list that is not frozen, so every seat call rescans it');
});
