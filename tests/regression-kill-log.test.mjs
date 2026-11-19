// THE KILL LOG (operator, 2026-10-07: "add the kill log and measure it"). Asked why taskkill appears so often, the
// answer had to be measured: with QUORATE_KILL_LOG naming a file, every tree kill io/stop-child.mjs issues appends one
// JSON line saying when, which pid, which signal, which process and which caller. Unset, it writes nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { stopChild } from '../scripts/io/stop-child.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

// STARTED AS EVERY LAUNCHER STARTS ONE (killableSpawnOptions): on POSIX the tree kill signals the child's process group,
// which a child not started as a group leader does not have — this test's first version passed on Windows (taskkill /T
// walks the parent-child tree) and left the child running on Linux, reported as `unconfirmed` (CI run 37654413813).
const KILLABLE = hostPlatform().proc.killableSpawnOptions();
function sleeper() {
  return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', ...KILLABLE });
}

async function withLog(t, value, fn) {
  const before = process.env.QUORATE_KILL_LOG;
  if (value === null) delete process.env.QUORATE_KILL_LOG; else process.env.QUORATE_KILL_LOG = value;
  t.after(() => { if (before === undefined) delete process.env.QUORATE_KILL_LOG; else process.env.QUORATE_KILL_LOG = before; });
  return fn();
}

test('with QUORATE_KILL_LOG set, a tree kill appends one line naming the pid, the signal and the caller', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-killlog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'kills.jsonl');
  const child = sleeper();
  const { outcome } = await withLog(t, log, () => stopChild(child, { event: 'exit' }));
  assert.equal(outcome, 'exited');
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 1, 'one kill, one line');
  assert.equal(lines[0].pid, child.pid);
  assert.ok(lines[0].signal, 'the signal is recorded');
  assert.ok(Array.isArray(lines[0].caller) && lines[0].caller.length > 0, 'and who asked');
});

test('with QUORATE_KILL_LOG unset, a tree kill writes nothing', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-killlog-off-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const child = sleeper();
  await withLog(t, null, () => stopChild(child, { event: 'exit' }));
  assert.deepEqual(fs.readdirSync(dir), [], 'no log unless one is asked for');
});
