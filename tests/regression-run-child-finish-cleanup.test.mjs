// G-7, with its symptom G-6, of 20261122-014737-m3s7-b2-review-2 (I-1 of .claude/requests/m3-stage7-fixes.md).
// runChild's finish() closed stdout and stderr inside empty catches, so a close that failed never reached the result;
// and it began `if (done) return`, so a child that exited after a refused kill had already ended the node never had
// the stdin file's release retried, though the child's own handle was what had refused it until then.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChild, openChildStdio, recordRunOutcome } from '../scripts/io/run-child.mjs';
import { withKill } from './helpers.mjs';

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-child-finish-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return dir;
};

test('a failed close of an output descriptor reaches the result and the status', async (t) => {
  const dir = tmp(t);
  // No host refuses a close on request: the close is handed in, and the descriptor is still closed for real after.
  const closeFd = (fd) => { fs.closeSync(fd); throw Object.assign(new Error('EIO: close'), { code: 'EIO' }); };
  const res = await runChild({
    cmd: process.execPath, args: ['-e', ''], cwd: dir, env: process.env,
    stdoutPath: path.join(dir, 'out'), stderrPath: path.join(dir, 'err'),
    timeoutMs: 30_000, outputCapBytes: 1024 * 1024, closeFd,
  });
  assert.deepEqual(res.closeErrors, ['stdout: EIO', 'stderr: EIO'], 'a failed close was swallowed');
  const status = { validator_errors: [] };
  recordRunOutcome(status, res);
  assert.ok(status.validator_errors.some((e) => /stdout: EIO/.test(e)), 'the status does not say the close failed');
});

test('a child that exits after a refused kill ended the node still has its stdin released again', async (t) => {
  const dir = tmp(t);
  let releases = 0;
  const openStdio = (args) => {
    const s = openChildStdio(args);
    return { ...s, stdin: { fd: s.stdin.fd, release: () => { releases += 1; return s.stdin.release(); } } };
  };
  const kids = [];
  const res = await runChild(withKill({
    cmd: process.execPath, args: ['-e', 'setTimeout(() => {}, 1500)'], cwd: dir, env: process.env,
    stdoutPath: path.join(dir, 'out'), stderrPath: path.join(dir, 'err'),
    timeoutMs: 200, outputCapBytes: 1024 * 1024, input: 'prompt', openStdio,
    kill: (pid) => { kids.push(pid); return false; },
  }));
  assert.equal(res.killRefused, 'timeout');
  const atFinish = releases;
  // The child lives on and exits by itself; its exit must retry the release.
  for (let i = 0; i < 100 && releases === atFinish; i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.ok(releases > atFinish, 'the child exited after the node ended and its stdin file was never released again');
});
