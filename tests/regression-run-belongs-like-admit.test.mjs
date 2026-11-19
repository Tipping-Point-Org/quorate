// regression-run-belongs-like-admit.test.mjs — G-10 (and its symptom G-11) of 20261118-112631-cpi-review.
//
// runBelongsToRepo resolved the run directory to its real path but compared it, lexically, with a stagingRoot or a
// declared reviews_dir that kept its links, while admitRun resolves every root. A root spelled through a link above it
// (macOS's /var) therefore refused a run admitRun admits below it: the two owners of "does this run belong here"
// disagreed on one disk, against reviews-root's "one list, so the questions cannot disagree".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBelongsToRepo } from '../scripts/lib/reviews-root.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const LINK = process.platform === 'win32' ? 'junction' : 'dir';

test('a run below a stagingRoot spelled through a link above it belongs, as admitRun admits it (G-10)', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-run-belongs-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, 'real');
  const run = path.join(real, 'staging', '20261118-000000-r1');
  fs.mkdirSync(run, { recursive: true });
  fs.mkdirSync(path.join(base, 'repo'));
  fs.symlinkSync(real, path.join(base, 'link'), LINK);
  const io = hostPlatform();
  const r = runBelongsToRepo({ runDir: run, repoRoot: path.join(base, 'repo'), stagingRoot: path.join(base, 'link', 'staging'), io });
  assert.equal(r.ok, true, r.why);
  const viaLink = runBelongsToRepo({ runDir: path.join(base, 'link', 'staging', path.basename(run)), repoRoot: path.join(base, 'repo'),
    stagingRoot: path.join(real, 'staging'), io });
  assert.equal(viaLink.ok, true, viaLink.why);
});

test('a run directory that is itself a link leading out of the staging root does not belong', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-run-belongs-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const outside = path.join(base, 'outside', '20261118-000000-r2');
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.join(base, 'staging'));
  fs.mkdirSync(path.join(base, 'repo'));
  const linked = path.join(base, 'staging', '20261118-000000-r2');
  fs.symlinkSync(outside, linked, LINK);
  const r = runBelongsToRepo({ runDir: linked, repoRoot: path.join(base, 'repo'), stagingRoot: path.join(base, 'staging'), io: hostPlatform() });
  assert.equal(r.ok, false, 'a run linked out of the staging root was taken as one of its runs');
});
