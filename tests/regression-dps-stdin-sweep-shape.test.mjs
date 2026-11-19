// G-4 of 20261110-022503-dps-remediation-4-review: sweepStaleStdin removed, recursively and with force, every old folder
// in the temporary directory whose name merely STARTED with the stdin prefix, so an unrelated `quorate-stdin-backup` was
// deleted with its contents; and every lstat failure was taken as "gone already", so an EACCES or EIO left a plaintext
// prompt folder on disk with no word. The name test that answered the first (mkdtemp's shape) was itself defeated (G-6
// of 20261110-025747-dps-remediation-5-review), and stdin-folder-owner.plan.md (SF-D1 A) removed the guess: the sweep
// looks only in `<engine home>/stdin/`, where every folder is this module's. Held here: no folder of the temporary
// directory, of any shape, is ever touched; an examination that fails other than ENOENT is said, naming the folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sweepStaleStdin, STALE_STDIN_MS, STDIN_FOLDER } from '../scripts/io/stdin-file.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

const LATER = () => Date.now() + STALE_STDIN_MS + 60_000;
const dir = (t, p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const throwing = (code) => () => { const e = new Error(`${code}: refused`); e.code = code; throw e; };

test('G-4: an old folder of the temporary directory, of any name or shape, is left with its contents', (t) => {
  const home = dir(t, 'dps-sweepshape-home-');
  const tmp = dir(t, 'dps-sweepshape-tmp-');
  const names = ['quorate-stdin-backup', 'quorate-stdin-', 'quorate-stdin-abc', 'quorate-stdin-abc12-x', 'quorate-stdin-aB3xY9'];
  for (const name of names) {
    fs.mkdirSync(path.join(tmp, name));
    fs.writeFileSync(path.join(tmp, name, 'stdin'), 'not a prompt copy of this home');
    const past = new Date(Date.now() - STALE_STDIN_MS - 3_600_000);
    fs.utimesSync(path.join(tmp, name), past, past);
  }
  const removed = sweepStaleStdin({ home, tmp, now: LATER(), write: () => {} });
  assert.deepEqual(removed, [], 'the sweep removed a folder outside the engine home\'s stdin folder');
  for (const name of names) assert.ok(fs.existsSync(path.join(tmp, name, 'stdin')), `${name}, not this module's, was deleted`);
});

test('G-4: an examination that fails other than ENOENT is said, and the folder is not counted as removed', (t) => {
  const home = dir(t, 'dps-sweeplstat-');
  fs.mkdirSync(path.join(home, STDIN_FOLDER, 'f-Qw12er'), { recursive: true });
  const lines = [];
  const removed = sweepStaleStdin({ home, owner: { ...confined(home), stat: throwing('EACCES') }, now: LATER(), write: (l) => lines.push(l) });
  assert.deepEqual(removed, [], 'a folder whose examination failed was counted as swept');
  assert.equal(lines.length, 1, 'an examination failure on a stdin folder was swallowed as "gone already"');
  assert.match(lines[0], /f-Qw12er/);
  assert.match(lines[0], /EACCES/);
});

test('G-4: an examination that fails ENOENT is a folder gone already and says nothing', (t) => {
  const home = dir(t, 'dps-sweepenoent-');
  fs.mkdirSync(path.join(home, STDIN_FOLDER, 'f-Zz9yX8'), { recursive: true });
  const lines = [];
  const removed = sweepStaleStdin({ home, owner: { ...confined(home), stat: throwing('ENOENT') }, now: LATER(), write: (l) => lines.push(l) });
  assert.deepEqual(removed, []);
  assert.deepEqual(lines, []);
});
