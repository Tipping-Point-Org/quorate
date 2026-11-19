// Four findings of run 20260925-200721-platform-remediated, three of them in the previous pass's own
// fix for a refused kill (G-22 / G-18 of 20260925-015614-platform-review).
//
// G-19 (panel-codex-contract): the G-18 fix returned false on a non-ESRCH error BEFORE scheduling the
// SIGKILL escalation, so a refused SIGTERM lost the escalation the pre-refactor code always attempted.
// Report the refusal AND keep escalating: the two were never in conflict.
//
// G-23 (panel-codex-code) and G-26: after a refused kill, finish() released the worker but left the
// still-running child attached — its pipes could keep the orchestrator alive — and run-graph dropped
// it from `live`, so an interrupt's killAllLive could no longer reach it. A refused child is detached
// from the event loop and stays reachable for cleanup.
//
// G-15 (panel-codex-contract): lib/reviewers read process.execPath, host state the pure layer must
// receive. It is an interface member now, and the lock refuses the read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { posixProc } from '../scripts/platform/posix/index.mjs';
import { interfaceGaps } from '../scripts/platform/interface.mjs';
import { win32 } from '../scripts/platform/win32/index.mjs';
import { linux } from '../scripts/platform/linux/index.mjs';

const S = path.join(import.meta.dirname, '..', 'scripts');

test('G-19: a refused SIGTERM is reported AND still escalated to SIGKILL', async () => {
  const sent = [];
  const kill = (pid, sig) => { sent.push(sig); if (sig === 'SIGTERM') throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
  assert.equal(posixProc.killTreeNow(77, { escalateAfterMs: 5, kill }), false, 'the refusal is reported');
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(sent, ['SIGTERM', 'SIGKILL'], 'and the escalation the pre-refactor code always attempted still happens');
});

// G-23 and G-26 were pinned by matching run-graph's and run-child's source text (ledger
// tests/regression-refused-kill-followups.test.mjs:30). Since stopping-a-child stage 2 the captured child is
// scripts/io/spawn-capture.mjs and every stop goes through scripts/io/stop-child.mjs, and both properties are run with real
// children in regression-spawn-capture.test.mjs: a survivor is handed back to the caller, which keeps it reachable (G-23),
// and a process whose child's kill was refused still exits by itself (G-26).

test('G-15: the Node executable is an interface member, and lib/ reads no process.execPath', () => {
  for (const impl of [win32, linux]) assert.deepEqual(interfaceGaps(impl), []);
  assert.equal(typeof linux.execPath, 'function');
  const lib = fs.readFileSync(path.join(S, 'lib', 'reviewers.mjs'), 'utf8');
  assert.doesNotMatch(lib.replace(/^\s*(\/\/|\*).*$/gm, ''), /process\.execPath/);
});
