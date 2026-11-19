// regression-root-cross-volume.test.mjs — G-7 of 20261118-112631-cpi-review.
//
// rootSpelling kept the links-kept spelling whenever the real path lay on another volume root, to keep a mapped drive
// from being respelled as its share. A junction to another volume ABOVE the engine's home (C:\Users\x -> F:\x) then left
// every root on C: while admitRun took each run directory's real path on F:, so every staged run was refused: I-1's
// failure, moved off macOS. Only a share resolution keeps the given spelling now. The volumes are simulated through the
// platform's realpath, since a CI machine has one drive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rootSpelling } from '../scripts/lib/finding-scope.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const LINK = process.platform === 'win32' ? 'junction' : 'dir';

function volumes(t, target) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-cross-volume-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'real', 'home'), { recursive: true });
  const link = path.join(base, 'link');
  fs.symlinkSync(path.join(base, 'real'), link, LINK);
  const host = hostPlatform();
  const realOf = (p) => {
    const r = fs.realpathSync.native(p);
    return r.toLowerCase().startsWith(path.join(base, 'real').toLowerCase()) ? path.join(target, path.relative(path.join(base, 'real'), r)) : r;
  };
  realOf.native = realOf;
  return { link, io: { ...host, fs: { ...host.fs, realpathSync: realOf } } };
}

test('a root below a junction to another volume is spelled on that volume (G-7)', { skip: process.platform !== 'win32' && 'drive letters are win32' }, (t) => {
  const { link, io } = volumes(t, 'Z:\\moved');
  assert.equal(rootSpelling(path.join(link, 'home'), io), path.join('Z:\\moved', 'home'));
});

test('a root resolving to a share keeps the spelling given', { skip: process.platform !== 'win32' && 'shares are win32' }, (t) => {
  const { link, io } = volumes(t, '\\\\server\\share');
  assert.equal(rootSpelling(path.join(link, 'home'), io), path.join(link, 'home'));
});
