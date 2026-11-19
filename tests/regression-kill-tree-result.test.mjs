// G-22 and G-18 of run 20260925-015614-platform-review: a refused kill must be SEEN.
//
// G-22 (panel-codex-code): run-graph's killTreeOf discarded the platform's answer. On Windows a
// refused taskkill was treated as a kill, so the timeout path kept waiting for a 'close' from a child
// that was still alive — and a panel or adjudication pool hung instead of reaching the gate.
// spawn-node already handled exactly this (G-43); run-graph's copy was routed through the platform in
// stage 2 and kept ignoring the result.
//
// G-18 (panel-codex-security): the posix tree kill swallowed EVERY process.kill error as "already
// gone" and reported success. Only ESRCH means gone; EPERM means a credential-carrying child is still
// running while its caller believes otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { posixProc } from '../scripts/platform/posix/index.mjs';

const err = (code) => Object.assign(new Error(code), { code });

test('G-18: the posix tree kill reports a refused signal as a failure, and a missing group as gone', () => {
  assert.equal(posixProc.killTreeNow(4242, { kill: () => { throw err('EPERM'); } }), false,
    'EPERM: the group is alive and was not signalled');
  assert.equal(posixProc.killTreeNow(4242, { kill: () => { throw err('ESRCH'); } }), true,
    'ESRCH: nothing left to kill');
  const sent = [];
  assert.equal(posixProc.killTreeNow(4242, { kill: (pid, sig) => sent.push([pid, sig]) }), true);
  assert.deepEqual(sent, [[-4242, 'SIGTERM']], 'the negative pid reaches the whole group');
});

// G-22 (run-graph acts on a refused kill instead of waiting for a close that may never come) was pinned by matching
// run-graph's source. Since stopping-a-child stage 2 the captured child is scripts/io/spawn-capture.mjs, stopped through
// scripts/io/stop-child.mjs, and a refused or unconfirmed stop ending the wait is run with real children in
// regression-spawn-capture.test.mjs.
