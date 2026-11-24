// G-8 of 20261121-233915-m3s7-b2-review: runChild opened a node's stdout and stderr below the run with a raw
// openSync(path, 'w'), so a link already standing at stdout.json or stderr.log was followed: the truncation and the
// child's output landed on a file outside the run. A hard link needs no privilege on any platform, so it is the case
// this test can always build; a symbolic link is refused by the same lstat check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChild } from '../scripts/io/run-child.mjs';

const ECHO = ['-e', 'process.stdout.write("child output")'];

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-child-links-'));
  const run = path.join(base, 'run');
  const outside = path.join(base, 'outside.txt');
  fs.mkdirSync(run);
  fs.writeFileSync(outside, 'precious');
  return { base, run, outside };
}

for (const which of ['stdoutPath', 'stderrPath']) {
  test(`G-8: a hard link at ${which} is refused, and the file it names is untouched`, async () => {
    const { base, run, outside } = fixture();
    try {
      const paths = { stdoutPath: path.join(run, 'stdout.json'), stderrPath: path.join(run, 'stderr.log') };
      fs.linkSync(outside, paths[which]);
      let refused = null;
      try {
        await runChild({ cmd: process.execPath, args: ECHO, cwd: run, env: process.env, ...paths,
          timeoutMs: 30_000, outputCapBytes: 1 << 20 });
      } catch (e) { refused = e; }
      assert.equal(fs.readFileSync(outside, 'utf8'), 'precious', 'the file outside the run was not truncated or written');
      assert.ok(refused, 'the run is refused rather than written through the link');
      assert.match(String(refused.message), /hard link/);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
}

test('G-8: a plain file already at stdout.json is still truncated and written', async () => {
  const { base, run } = fixture();
  try {
    const stdoutPath = path.join(run, 'stdout.json');
    fs.writeFileSync(stdoutPath, 'old');
    const res = await runChild({ cmd: process.execPath, args: ECHO, cwd: run, env: process.env,
      stdoutPath, stderrPath: path.join(run, 'stderr.log'), timeoutMs: 30_000, outputCapBytes: 1 << 20 });
    assert.equal(res.exitCode, 0);
    assert.equal(fs.readFileSync(stdoutPath, 'utf8'), 'child output');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
