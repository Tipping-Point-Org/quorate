// Regression tests for the set-aside path (remediation 20261107-205850-co-remediation-4, remediating
// 20261107-203720-co-remediation-3-review). Each test names the group it exists for.
//
// G-3: setAsideRestoreNeeded filtered on the file's hash alone, so an entry whose bytes matched but whose mode did not
// was skipped, recorded restored, and its copy removed with the mode never put back.
// G-7: installReplay wrote a replayed blob through tree.replace with no mode, so an executable lost its exec bit.
// G-8: lstatKind read every lstat failure as 'deleted', so EACCES or EIO counted as a successful removal.
// G-11 (G-12 its symptom): setAsideFinisher was registered after setAsideRefused returned, so a die() inside it ran no
// write-back and the operator's edits stayed only in the run directory.
// G-6: firstFree searched numbered names with no bound.
// G-9: kindOfPath parsed `git ls-tree` output inline, a decision outside lib.
// G-13: the contract promised a mode change is detected unconditionally; git's answer depends on core.fileMode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chain from '../scripts/lib/remediation-chain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const remediateSrc = () => fs.readFileSync(path.join(here, '..', 'scripts', 'remediate.mjs'), 'utf8');
// THE SET-ASIDE'S HALVES OF THESE TESTS RUN THE MODULE (runner-test-seam.plan.md stage 4): their source matches of
// scripts/io/set-aside.mjs are replaced by tests in tests/regression-set-aside-behaviour.test.mjs, named at each test; the
// runner's call sites, firstFree and installReplay stay in remediate.mjs and are still read there.
const fnBody = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  const next = src.indexOf('\n}\n', start);
  return src.slice(start, next + 2);
};

test('G-3: a set-aside entry whose bytes match but whose mode differs still needs restoring', () => {
  const entries = [{ path: 'run.sh', sha256: 'h', mode: 0o755 }, { path: 'a.txt', sha256: 'h2', mode: 0o644 }];
  // pathState results, one per path, carrying the bytes' hash and the mode together (G-2 of 20261107-220617-si-delivery).
  const file = (sha256, mode) => ({ kind: 'file', sha256, mode });
  const needed = chain.setAsideRestoreNeeded(entries, new Map([['run.sh', file('h', 0o644)], ['a.txt', file('h', 0o644)]]));
  assert.deepEqual(needed.map((e) => e.path), ['run.sh', 'a.txt'], 'run.sh by its mode, a.txt by its bytes');
  assert.deepEqual(chain.setAsideRestoreNeeded([{ path: 'x', sha256: 'h', mode: 0o644 }], new Map([['x', file('h', 0o644)]])), [], 'bytes and mode both match');
  assert.deepEqual(chain.setAsideRestoreNeeded([{ path: 'x', sha256: 'h' }], new Map([['x', file('h', 0o755)]])), [], 'a manifest written before mode existed is judged by bytes');
  // The write-back's half: "G-3 of 20261107-205850-co-remediation-4: an entry whose bytes match its copy but whose mode does
  // not is not taken as restored" (tests/regression-set-aside-behaviour.test.mjs).
});

test('G-7: the replay installer writes each candidate blob with the mode of the file it replaces', () => {
  const body = fnBody(remediateSrc(), 'installReplay');
  assert.match(body, /tree\.replace\(segs, blob\.stdout, \{ mode:/, 'replace is given a mode');
});

test('G-8: only a missing path reads as deleted; another lstat failure is not proof of absence', async () => {
  // MOVED to pathState, the one reader (set-aside-identity.plan.md stage 1): lstatKind is gone, the rule is unchanged.
  // MOVED AGAIN to lib's pathReadFailure (G-15 of 20261108-032104-si-remediation-4-review), and called here, not grepped.
  // That pathStat and pathState answer through lib's rule is run: regression-set-aside-identity's "G-7: pathState, executed, …"
  // rows, and the put-back guard's EINJECTED row in tests/regression-set-aside-faults.test.mjs (unreadable, not absent).
  const { pathReadFailure } = await import('../scripts/lib/remediation-chain.mjs');
  assert.deepEqual(pathReadFailure(Object.assign(new Error('x'), { code: 'ENOENT' })), { kind: 'absent' }, 'ENOENT is what means absent');
  assert.equal(pathReadFailure(Object.assign(new Error('x'), { code: 'EIO' })).kind, 'unreadable', 'another failure is named unreadable');
  // atHead's half: "G-8 of 20261107-205850-co-remediation-4: a put-back that leaves a directory where HEAD has a file stops the
  // run" (tests/regression-set-aside-behaviour.test.mjs).
});

test('G-11: the set-aside finisher is registered before setAsideRefused runs, at both call sites', () => {
  const src = remediateSrc();
  // setAsideForCheck is the one caller of setAsideRefused (G-8 of 20261108-222629-rts-delivery).
  assert.equal([...src.matchAll(/setAsideRefused\(setAsideCaps/g)].length, 1, 'one call of setAsideRefused, in setAsideForCheck');
  const calls = [...src.matchAll(/setAsideForCheck\(/g)].map((m) => m.index).filter((i) => !src.slice(i - 9, i).includes('function'));
  assert.equal(calls.length, 2, 'two call sites');
  for (const i of calls) {
    const before = src.slice(Math.max(0, i - 600), i);
    assert.match(before, /setAsideFinisher\(aside, check, save\)/, 'the finisher is registered before the set-aside starts');
  }
  // The module's half: "G-11: the record is handed to the finisher's holder before the first path is put back"
  // (tests/regression-set-aside-behaviour.test.mjs).
});

test('G-6: firstFree searches a bounded range of numbered names', () => {
  const line = remediateSrc().match(/^const firstFree = [^\n]*$/m);
  assert.ok(line, 'firstFree is one line');
  assert.doesNotMatch(line[0], /while \(taken\(n\)\) n \+= 1/, 'an unbounded search');
  assert.match(line[0], /FIRST_FREE_MAX|die\(/, 'a cap that refuses');
});

test('G-9: parsing a git ls-tree entry is a pure decision in lib, not a regex in remediate.mjs', () => {
  assert.equal(typeof chain.lsTreeEntry, 'function');
  assert.deepEqual(chain.lsTreeEntry('100755 blob abc123\trun.sh\0', 'run.sh'), { mode: '100755', type: 'blob', hash: 'abc123' });
  assert.equal(chain.lsTreeEntry('100644 blob abc\tother\0', 'run.sh'), null);
  assert.equal(chain.lsTreeEntry('', 'run.sh'), null);
  // That the module parses ls-tree through lib is run: "G-6: classifying three refused files …" and "G-14: … a bracketed name
  // is put back to HEAD" in tests/regression-set-aside-behaviour.test.mjs read every kind from one ls-tree's parse.
});

test('G-13: the contract says a mode-only change since set-aside is seen where git reports modes (core.fileMode)', () => {
  const contract = fs.readFileSync(path.join(here, '..', 'shared', 'claude-md-contract.md'), 'utf8');
  const row = contract.split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs` |'));
  assert.ok(row);
  assert.match(row, /its mode included[^.]*core\.fileMode/, 'the mode promise names the git setting it depends on');
});
