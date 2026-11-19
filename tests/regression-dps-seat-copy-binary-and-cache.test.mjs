// G-5 and G-4 of 20261110-014035-dps-remediation-3-review, in io/seat-copies.mjs.
//   G-5  an untracked file was screened only by text patterns over a UTF-8 decode, so a binary credential (a PKCS#12
//        bundle, a DER key) matched nothing and was copied where the seat's vendor may read it. A file git does not track
//        that is not text is now refused, named with why: the screen can read only text.
//   G-4  the tracked set was cached by the array's identity, so an array changed after a first call was answered from
//        its earlier contents. The cache now holds only while the array's contents are what it was built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyIntoSeatDir } from '../scripts/io/seat-copies.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

const TOKEN = ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');

function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dps-bin-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  const home = path.join(dir, 'home');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(path.join(home, 'seat'), { recursive: true });
  return { repo, home, owner: confined(home) };
}

test('G-5: an untracked binary file (a PKCS#12-like bundle) is refused with why, and not copied', (t) => {
  const { repo, home, owner } = fixture(t);
  // DER-encoded bytes as a PKCS#12 bundle begins: a SEQUENCE header, then bytes no text decode keeps.
  fs.writeFileSync(path.join(repo, 'client.p12'), Buffer.from([0x30, 0x82, 0x0a, 0x00, 0x02, 0x01, 0x03, 0x30, 0x82, 0xff, 0xfe, 0x00, 0x9c]));
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'plain text\n');
  const r = copyIntoSeatDir({ repoRoot: repo, owner, segs: ['seat'], paths: ['client.p12', 'notes.txt'], tracked: [] });
  assert.ok(!fs.existsSync(path.join(home, 'seat', 'client.p12')), 'an untracked binary credential was copied for the seat\'s vendor');
  assert.deepEqual(r.refused.map((x) => x.path), ['client.p12']);
  assert.match(r.refused[0].why, /not text/);
  assert.deepEqual(r.copied, ['notes.txt']);
});

test('G-5: a tracked binary file is not screened, as tracked files are not', (t) => {
  const { repo, owner } = fixture(t);
  fs.writeFileSync(path.join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
  const r = copyIntoSeatDir({ repoRoot: repo, owner, segs: ['seat'], paths: ['logo.png'], tracked: ['logo.png'] });
  assert.deepEqual(r.copied, ['logo.png']);
});

test('G-4: a tracked list changed after a first call is read as it is now, never from the earlier contents', (t) => {
  const { repo, owner } = fixture(t);
  fs.writeFileSync(path.join(repo, 'fixture.txt'), `a fixture with ${TOKEN}\n`);
  const tracked = ['other.txt'];
  const first = copyIntoSeatDir({ repoRoot: repo, owner, segs: ['seat'], paths: ['fixture.txt'], tracked });
  assert.deepEqual(first.copied, [], 'untracked at the first call, so screened and refused');
  tracked.push('fixture.txt');
  fs.mkdirSync(path.join(path.dirname(repo), 'home', 'seat2'));
  const second = copyIntoSeatDir({ repoRoot: repo, owner, segs: ['seat2'], paths: ['fixture.txt'], tracked });
  assert.deepEqual(second.copied, ['fixture.txt'], 'the cached set answered from the array\'s earlier contents');
});
