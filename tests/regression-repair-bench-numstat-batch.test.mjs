// G-4 of 20261111-192009-runtime-bin-remediation-review: bench-repair-pass started one `git diff --numstat` per changed
// file, inside its per-file loop, while the blob reads beside it were already batched (G-1 of
// 20261108-021347-si-remediation-2-review). A case changing F files paid F process launches. The line counts now come from
// one batch, lib/repair-bench.mjs numstatOfBlobPairs: the before blobs and the after blobs each put in one flat tree, one
// `git diff-tree --numstat` between them. Held here: the batch answers what a per-pair diff answers (absent sides, equal
// blobs, a binary file unknown, a failed batch unknown and never 0 lines), in a fixed number of git calls whatever the
// number of files, and the bench no longer starts a numstat per file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitSync } from '../scripts/io/git.mjs';
import { REPO_ROOT } from './helpers.mjs';

function repo(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'numstat-batch-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(gitSync(['init', '-q'], { cwd: dir, encoding: 'utf8' }).status, 0);
  const blob = (text) => gitSync(['hash-object', '-w', '--stdin'], { cwd: dir, encoding: 'utf8', input: text }).stdout.trim();
  return { dir, blob };
}

test('one batch answers what a diff per pair answers, in three git calls whatever the number of files', async (t) => {
  const { numstatOfBlobPairs } = await import('../scripts/lib/repair-bench.mjs');
  assert.equal(typeof numstatOfBlobPairs, 'function', 'no batched numstat');
  const { dir, blob } = repo(t);
  const a = blob('one\ntwo\nthree\n');
  const b = blob('one\n2\nthree\nfour\n');
  const bin = blob(Buffer.from([0, 1, 2, 0, 3]).toString('latin1'));
  const bin2 = blob(Buffer.from([0, 9, 9, 0, 3]).toString('latin1'));
  const pairs = [
    { before: a, after: b },        // changed: 2 added, 1 removed
    { before: null, after: a },     // added whole: 3, 0
    { before: b, after: null },     // removed whole: 0, 4
    { before: a, after: a },        // unchanged: 0, 0
    { before: null, after: null },  // absent both sides: 0, 0
    { before: bin, after: bin2 },   // binary: unknown
  ];
  const calls = [];
  const run = (args, input) => { calls.push(args[0]); return gitSync(args, { cwd: dir, encoding: 'utf8', input }); };
  const got = numstatOfBlobPairs(run, pairs);
  assert.deepEqual(got.slice(0, 5).map(({ added, removed }) => [added, removed]), [[2, 1], [3, 0], [0, 4], [0, 0], [0, 0]]);
  assert.equal(got[5].added, null, 'a binary file counted as lines');
  assert.match(got[5].why, /numstat/);
  assert.ok(calls.length <= 3, `${calls.length} git calls for ${pairs.length} pairs: ${calls}`);
  calls.length = 0;
  numstatOfBlobPairs(run, [...pairs, ...pairs, ...pairs]);
  assert.ok(calls.length <= 3, `${calls.length} git calls for ${pairs.length * 3} pairs: the count grows with the files`);
});

test('a failed batch is unknown for every pair, never 0 lines', async (t) => {
  const { numstatOfBlobPairs } = await import('../scripts/lib/repair-bench.mjs');
  const { dir, blob } = repo(t);
  const a = blob('x\n');
  const missing = 'f'.repeat(40);
  const run = (args, input) => gitSync(args, { cwd: dir, encoding: 'utf8', input });
  const got = numstatOfBlobPairs(run, [{ before: a, after: missing }, { before: null, after: a }]);
  for (const g of got) {
    assert.equal(g.added, null, `a failed batch read as ${g.added} lines`);
    assert.match(g.why, /git .* exited/);
  }
  assert.deepEqual(numstatOfBlobPairs(() => { throw new Error('not called'); }, []), []);
});

test('bench-repair-pass starts no git diff --numstat per file', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-repair-pass.mjs'), 'utf8');
  const hits = src.split(/\r?\n/).map((l, i) => [l.replace(/^\s*\/\/.*$/, ''), i + 1])
    .filter(([l]) => /['"]diff['"]\s*,\s*['"]--numstat['"]/.test(l)).map(([l, n]) => `${n}: ${l.trim()}`);
  assert.deepEqual(hits, [], 'a numstat launched per file');
  assert.match(src, /numstatOfBlobPairs\(/, 'the bench does not use the batch');
});
