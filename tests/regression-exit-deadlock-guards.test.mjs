// A PROCESS THAT FINISHED ITS WORK BUT NEVER EXITED (2026-11-16; operator: "Capture + suite timeout now, rest drafted
// (Recommended)"). The full suite sat 3 h 40 min on one capture.mjs child, which had written its log, its preview and its
// result path and then waited forever inside process.exit. A dump read with cdb showed the deadlock: the main thread in
// node::DisposePlatform joining V8's worker threads (uv_thread_join), and a V8 worker in a Maglev compile job parked in
// CollectionBarrier::AwaitCollectionBackground, waiting for a garbage collection the exiting main thread never runs. A Node
// bug (nodejs/node#64274), Node 24.13.1 on Windows; capture.mjs met it about 1 run in 3 over `git log -p` of this
// repository's whole history, and the same capture ending by process.exitCode stalled 0 of 12 (F:-local probes, recorded in
// .claude/requests/exit-deadlock.followup.md).
//
// Three halves, and the limit of the first stated: capture's end is held by a READ OF ITS SOURCE, because the deadlock is a
// race that a test would need about a dozen 16-second runs to show. The other 192 process.exit calls in the engine are the
// follow-up draft's, not this test's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as helpers from './helpers.mjs';

const { REPO_ROOT, runScript } = helpers;

test('capture.mjs ends by process.exitCode, with no process.exit after its work', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'capture.mjs'), 'utf8');
  // The work is done once the log is created through the owner; nothing after it may end the process by process.exit.
  const at = src.indexOf('owner.create([\'evidence\', opts.node, logName]');
  assert.ok(at > 0, 'the log write was not found; this census no longer sees capture\'s end');
  const after = src.slice(at).replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(after, /process\.exit\(/, 'capture ends by process.exit, which can deadlock after large output');
  assert.match(after, /process\.exitCode\s*=\s*exitCode/, 'capture does not set its exit code for a natural end');
});

test('runScript stops a child that outlives its timeout, and says it stalled', () => {
  assert.throws(() => runScript('check-syntax.mjs', [], { timeoutMs: 50 }),
    /did not exit within 50 ms/, 'a child past its timeout was waited on, or its end read as a result');
});

test('runScript has a default timeout, so one stalled child cannot block the suite', () => {
  const ms = helpers.RUN_SCRIPT_TIMEOUT_MS;
  assert.equal(typeof ms, 'number', 'helpers.mjs exports no RUN_SCRIPT_TIMEOUT_MS');
  assert.ok(ms >= 5 * 60_000 && ms <= 30 * 60_000, `default ${ms} ms: above the slowest test (about 102 s), below an unnoticed hour`);
});
