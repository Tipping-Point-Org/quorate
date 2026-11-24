// G-8 of 20261122-002915-m3s7-b2-remediation-review. runChild opened stdout and stderr, then called stdinFrom(input);
// when stdinFrom threw, both output descriptors stayed open in this process for good. The failure is made real here: a
// relative QUORATE_HOME is refused by the engine-home owner, so the stdin file cannot be made and runChild rejects.
// Descriptors are handed out lowest-free-first, so a leak shows as the next open landing above the one before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChild } from '../scripts/io/run-child.mjs';

test('a stdin that cannot be made closes both output descriptors before runChild rejects', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-child-stdin-'));
  const saved = process.env.QUORATE_HOME;
  try {
    const probePath = path.join(dir, 'probe');
    const nextFd = () => { const fd = fs.openSync(probePath, 'w'); fs.closeSync(fd); return fd; };
    const before = nextFd();
    process.env.QUORATE_HOME = 'relative-home-is-refused';
    await assert.rejects(runChild({
      cmd: process.execPath, args: ['-e', ''], cwd: dir, env: process.env,
      stdoutPath: path.join(dir, 'stdout.json'), stderrPath: path.join(dir, 'stderr.log'),
      timeoutMs: 10_000, outputCapBytes: 1024, input: 'prompt',
    }));
    if (saved === undefined) delete process.env.QUORATE_HOME; else process.env.QUORATE_HOME = saved;
    assert.equal(nextFd(), before, 'an output descriptor was left open');
  } finally {
    if (saved === undefined) delete process.env.QUORATE_HOME; else process.env.QUORATE_HOME = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
