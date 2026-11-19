// G-7 of 20261110-202954-sfo-remediation-review-c: confined's exclusive create opened its file with openSync(p, 'wx') and
// no mode, and its directory create called mkdirSync with no mode, so under a usual POSIX umask a child's stdin prompt
// (which can carry source or credentials) was 0644 inside a 0755 folder, readable by any other local account until it was
// removed, and removal can be delayed (a refused release, the day-old sweep). Now `create` and `dirNew` take a `mode`,
// and io/stdin-file.mjs makes each call's folder 0700 and its stdin file 0600. The modes are checked at the calls the
// owner makes (a recording platform), so the check holds on Windows too, where fs ignores a POSIX mode; on POSIX the
// file's own mode bits are checked as well.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { confined } from '../scripts/lib/confined-path.mjs';
import { stdinFrom } from '../scripts/io/stdin-file.mjs';

const tmp = (t, p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

// A platform whose fs records every mkdirSync and openSync call, and otherwise is the host's.
function recordingIo() {
  const host = hostPlatform();
  const calls = [];
  const recFs = { ...host.fs };
  for (const op of ['mkdirSync', 'openSync']) {
    recFs[op] = (...args) => { calls.push({ op, args }); return host.fs[op](...args); };
  }
  const io = Object.create(host);
  Object.defineProperty(io, 'fs', { value: recFs });
  return { io, calls };
}

test('confined.create and dirNew pass the mode they are given to the open and the mkdir', (t) => {
  const root = tmp(t, 'sfo-mode-lib-');
  const { io, calls } = recordingIo();
  const owner = confined({ root, io });
  const d = owner.dirNew(['a', 'b'], { mode: 0o700 });
  owner.create(['a', 'b', 'f'], 'secret', { mode: 0o600 });
  const mk = calls.find((c) => c.op === 'mkdirSync' && c.args[0] === d);
  assert.ok(mk, 'dirNew made no folder');
  assert.equal(mk.args[1]?.mode ?? mk.args[1], 0o700, 'dirNew did not pass its mode to mkdirSync');
  const op = calls.find((c) => c.op === 'openSync' && c.args[0] === path.join(d, 'f'));
  assert.ok(op, 'create opened no file');
  assert.equal(op.args[2], 0o600, 'create did not pass its mode to openSync');
});

test('G-7: stdinFrom makes its folder 0700 and its stdin file 0600, never the process default', (t) => {
  const home = tmp(t, 'sfo-mode-');
  const { io, calls } = recordingIo();
  const s = stdinFrom('a prompt holding a secret', { home, io, sweep: () => [] });
  try {
    const folderCall = calls.find((c) => c.op === 'mkdirSync' && path.dirname(c.args[0]) === path.join(home, 'stdin'));
    assert.ok(folderCall, 'no per-call folder was made below stdin/');
    assert.equal(folderCall.args[1]?.mode ?? folderCall.args[1], 0o700, 'the stdin folder was made with the process default mode');
    const fileCall = calls.find((c) => c.op === 'openSync' && path.basename(c.args[0]) === 'stdin' && c.args[1] === 'wx');
    assert.ok(fileCall, 'the stdin file was not created through the owner');
    assert.equal(fileCall.args[2], 0o600, 'the stdin file was created with the process default mode');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(folderCall.args[0]).mode & 0o077, 0, 'the stdin folder is readable by others');
      assert.equal(fs.statSync(fileCall.args[0]).mode & 0o077, 0, 'the stdin file is readable by others');
    }
  } finally { s.release(); }
});
