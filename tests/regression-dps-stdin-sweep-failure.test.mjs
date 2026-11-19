// G-6 of 20261110-014035-dps-remediation-3-review: sweepStaleStdin swallowed a stale stdin folder's failed removal with
// no word, so a folder a persistent permission or filesystem error kept left a plaintext prompt on disk for good while
// every later sweep went on silently. A removal that fails is now said, naming the folder (never its contents). Since
// stdin-folder-owner.plan.md the sweep walks `<engine home>/stdin/` through its owner, and the failure is the owner's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sweepStaleStdin, STALE_STDIN_MS, STDIN_FOLDER } from '../scripts/io/stdin-file.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

const home = (t, p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const throwing = (code) => () => { const e = new Error(`${code}: refused`); e.code = code; throw e; };

test('G-6: a stale stdin folder whose removal fails is named, and not counted as removed', (t) => {
  const h = home(t, 'dps-sweepfail-');
  fs.mkdirSync(path.join(h, STDIN_FOLDER, 'old-1'), { recursive: true });
  const lines = [];
  const owner = { ...confined(h), remove: throwing('EPERM') };
  const removed = sweepStaleStdin({ home: h, owner, now: Date.now() + STALE_STDIN_MS + 60_000, write: (l) => lines.push(l) });
  assert.deepEqual(removed, []);
  assert.equal(lines.length, 1, 'a failed removal of a stale prompt folder was swallowed with no word');
  assert.match(lines[0], /old-1/);
  assert.match(lines[0], /EPERM/);
});

test('G-6: a folder gone before its removal is not reported', (t) => {
  const h = home(t, 'dps-sweepgone-');
  fs.mkdirSync(path.join(h, STDIN_FOLDER, 'gone-1'), { recursive: true });
  const lines = [];
  const owner = { ...confined(h), remove: throwing('ENOENT') };
  const removed = sweepStaleStdin({ home: h, owner, now: Date.now() + STALE_STDIN_MS + 60_000, write: (l) => lines.push(l) });
  assert.deepEqual(removed, []);
  assert.deepEqual(lines, []);
});
