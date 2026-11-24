// G-10 of 20261122-002915-m3s7-b2-remediation-review. copyTrackedInto skipped a tracked file on ANY lstat failure, not
// only the deletion from the working tree its comment names, so a file that stands but answers EACCES or EIO was left
// out of the arms' framework copy and the copy still reported ok: true. Only ENOENT or ENOTDIR is a deletion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { copyTrackedInto } from '../scripts/io/worktree.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-tracked-lstat-'));
  const src = path.join(root, 'src');
  const dest = path.join(root, 'dest');
  fs.mkdirSync(src);
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(src, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(src, 'b.txt'), 'b\n');
  execFileSync('git', ['init', '-q'], { cwd: src });
  execFileSync('git', ['add', 'a.txt', 'b.txt'], { cwd: src });
  return { root, src, dest };
}

for (const code of ['EACCES', 'EIO']) {
  test(`an lstat ${code} on a tracked file fails the copy rather than leaving the file out`, (t) => {
    const { root, src, dest } = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    // No host answers EACCES on request, so the copy's lstat is handed in; every other file is the real one's.
    const lstat = (p, o) => {
      if (path.basename(String(p)) === 'b.txt') throw Object.assign(new Error(`${code}: ${p}`), { code });
      return fs.lstatSync(p, o);
    };
    const r = copyTrackedInto(src, dest, { lstat });
    assert.equal(r.ok, false, 'a tracked file that could not be judged was dropped and the copy said ok');
    assert.match(r.why, /b\.txt/);
  });
}

test('a tracked file deleted from the working tree is still skipped', (t) => {
  const { root, src, dest } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.rmSync(path.join(src, 'b.txt'));
  const r = copyTrackedInto(src, dest);
  assert.equal(r.ok, true);
  assert.equal(r.copied, 1);
});
