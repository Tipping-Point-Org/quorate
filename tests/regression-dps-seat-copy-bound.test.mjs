// G-8 of 20261109-232630-dps-delivery (G-9 its symptom): copyIntoSeatDir read every cited path whole into memory and wrote
// a full copy for every seat and revote author, with no limit on a file's size or on the total, so a work context naming a
// large file cost memory and disk in proportion to it, every seat and every round. A file over the per-file bound, or one
// that would take the call past its total, is now refused, named with why, and never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyIntoSeatDir } from '../scripts/io/seat-copies.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dps-seatcap-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(home, 'seat'), { recursive: true });
  return { repo, home, owner: confined(home) };
}

test('a file over the per-file bound is refused with why, and not copied', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'src', 'small.txt'), 'x'.repeat(10));
  fs.writeFileSync(path.join(f.repo, 'src', 'big.txt'), 'y'.repeat(200));
  const r = copyIntoSeatDir({ repoRoot: f.repo, owner: f.owner, segs: ['seat'], paths: ['src/small.txt', 'src/big.txt'],
    maxFileBytes: 100, maxTotalBytes: 1000 });
  assert.deepEqual(r.copied, ['src/small.txt']);
  assert.equal(r.refused.length, 1, 'the oversized file was copied whole');
  assert.equal(r.refused[0].path, 'src/big.txt');
  assert.match(r.refused[0].why, /200 bytes.*100/);
  assert.ok(!fs.existsSync(path.join(f.home, 'seat', 'src', 'big.txt')));
});

test('a file that would take the call past its total bound is refused; the ones before it are copied', (t) => {
  const f = fixture(t);
  for (const n of ['a', 'b', 'c']) fs.writeFileSync(path.join(f.repo, 'src', `${n}.txt`), n.repeat(40));
  const r = copyIntoSeatDir({ repoRoot: f.repo, owner: f.owner, segs: ['seat'], paths: ['src/a.txt', 'src/b.txt', 'src/c.txt'],
    maxFileBytes: 100, maxTotalBytes: 100 });
  assert.deepEqual(r.copied, ['src/a.txt', 'src/b.txt']);
  assert.deepEqual(r.refused.map((x) => x.path), ['src/c.txt']);
  assert.match(r.refused[0].why, /total/);
});

test('the bounds have defaults: an ordinary call copies an ordinary file', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'src', 'a.txt'), 'hello');
  const r = copyIntoSeatDir({ repoRoot: f.repo, owner: f.owner, segs: ['seat'], paths: ['src/a.txt', 'src/gone.txt'] });
  assert.deepEqual(r.copied, ['src/a.txt']);
  assert.deepEqual(r.missing, ['src/gone.txt']);
  assert.equal(fs.readFileSync(path.join(f.home, 'seat', 'src', 'a.txt'), 'utf8'), 'hello');
});
