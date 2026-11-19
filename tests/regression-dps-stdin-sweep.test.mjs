// G-11 of 20261109-232630-dps-delivery (root of G-7): io/stdin-file.mjs's release() swallows a removal that a child still
// holding the file refused (on Windows), and nothing swept later, so each such call left a plaintext prompt copy on disk
// for good. The next stdinFrom call now removes every stdin folder older than STALE_STDIN_MS, and leaves a young one,
// which may still be a live child's stdin. Since stdin-folder-owner.plan.md (SF-D1 A, SF-D2 A) the folders live in
// `<engine home>/stdin/`, every one of them this module's, so nothing outside that folder is looked at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stdinFrom, STDIN_FOLDER } from '../scripts/io/stdin-file.mjs';

const DAY_AND_A_HOUR = 25 * 60 * 60 * 1000;

test('a stdin folder an earlier call could not remove is swept by the next call once stale; a young one is left', (t) => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dps-sweep-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, STDIN_FOLDER);
  const old = path.join(dir, 'old-1');
  const young = path.join(dir, 'new-1');
  for (const d of [old, young]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'stdin'), 'a prompt copy'); }
  const past = new Date(Date.now() - DAY_AND_A_HOUR);
  fs.utimesSync(old, past, past);
  // Beside the engine home, and old: never this module's to look at.
  const other = path.join(home, 'not-ours-old');
  fs.mkdirSync(other);
  fs.utimesSync(other, past, past);
  const s = stdinFrom('text', { home });
  s.release();
  assert.ok(!fs.existsSync(old), 'a stale stdin folder, a prompt copy an earlier release could not remove, survived');
  assert.ok(fs.existsSync(young), 'a young stdin folder, possibly a live child\'s stdin, was removed');
  assert.ok(fs.existsSync(other), 'a folder outside stdin/ was removed');
  assert.deepEqual(fs.readdirSync(dir), ['new-1'], 'this call\'s own folder was not released');
});
