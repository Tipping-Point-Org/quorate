// G-14 of run 20260926-002850-m0-close (panel-codex-code), with its symptoms G-13, G-16 and G-17: a
// child whose kill the OS refused was left running. In run-graph it stayed in `live`, but only a
// signal ever stopped the held children, so a normal ending walked away from it. In spawn-node it was
// unref'd and the node exited with nothing recording the pid at all. Either way an external reviewer
// holding the operator's credentials could keep working and billing after the run said it was done.
//
// Now spawn-node records the survivor's pid as `orphan_pid`, and before the gate is written
// run-graph stops every leftover it holds once more and watches every recorded orphan, and names in
// the gate any not seen to exit. A process the OS will not stop cannot be made to stop; it can be made
// visible.
//
// stopping-a-child stage 4 (design 2A): "stopped" is an exit SEEN, through the one owner. The reaper
// used to kill and ask isAlive in the same breath, so a child still dying read as a survivor. The pure
// decision takes the stop and the wait as `io`; io/reap.mjs binds them to io/stop-child.mjs and is
// driven below with real children and real status files — replacing the test that matched run-graph's
// source for `orphan_pid`, `held: false` and `not_checked.push` (ledger
// tests/regression-refused-kill-reaped.test.mjs:40).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
// Namespace, not named, imports: at the commit before stage 4 a missing export must fail ITS test, not the whole file.
const lib = await import('../scripts/lib/reap.mjs');
const { reapLeftovers } = lib;
const survivorNote = (r) => { assert.equal(typeof lib.survivorNote, 'function', 'what the gate says has no owner'); return lib.survivorNote(r); };
import { hostPlatform } from '../scripts/platform/index.mjs';

const host = await import('../scripts/io/reap.mjs').catch(() => ({}));
const KILLABLE = hostPlatform().proc.killableSpawnOptions();
const sleeper = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', ...KILLABLE });
const reallyKill = (pid) => { try { process.kill(pid, 'SIGKILL'); } catch {} };
const alive = (pid) => hostPlatform().proc.isAlive(pid);

test('a leftover we hold is STOPPED through io; a recorded pid is only WATCHED, never stopped; a gone one is skipped', async () => {
  const stopped = [];
  const watched = [];
  const out = await reapLeftovers(
    [{ node: 'panel-codex-code', pid: 11, held: true, handle: 'h11' }, { node: 'code-audit', pid: 22, held: true },
      { node: 'gone', pid: 33, held: false }, { node: 'security-audit', pid: 44, held: false }],
    {
      stop: async (l) => { stopped.push(l.handle ?? l.pid); return { outcome: l.pid === 11 ? 'exited' : 'refused' }; },
      confirmGone: async (pid) => { watched.push(pid); return { outcome: 'unconfirmed' }; },
      isAlive: (pid) => pid !== 33,
    },
  );
  assert.deepEqual(stopped, ['h11', 22], 'the handle reaches the stop, and only held leftovers are stopped');
  assert.deepEqual(watched, [44], 'a recorded pid is watched, never stopped, and a gone one is not looked at');
  assert.deepEqual(out.map((o) => [o.node, o.held, o.outcome]), [
    ['panel-codex-code', true, 'exited'], ['code-audit', true, 'refused'], ['security-audit', false, 'unconfirmed']]);
});

test('every leftover is looked at together, so the wait is one deadline and not one per survivor', async () => {
  const later = (ms, outcome) => new Promise((r) => setTimeout(() => r({ outcome }), ms));
  const started = Date.now();
  await reapLeftovers([1, 2, 3, 4].map((pid) => ({ node: `n${pid}`, pid, held: pid % 2 === 0 })),
    { stop: () => later(400, 'unconfirmed'), confirmGone: () => later(400, 'unconfirmed'), isAlive: () => true });
  assert.ok(Date.now() - started < 1_200, 'the survivors were waited on one after another');
});

test('what the gate says: nothing for a seen exit, and a sentence per way a process outlived the run', () => {
  assert.equal(survivorNote({ pid: 1, held: true, outcome: 'exited' }), null);
  assert.equal(survivorNote({ pid: 1, held: false, outcome: 'exited' }), null);
  assert.match(survivorNote({ pid: 7, held: true, outcome: 'refused' }), /process 7 refused to be killed/);
  assert.match(survivorNote({ pid: 8, held: true, outcome: 'unconfirmed' }), /process 8 was not seen to exit after its stop/);
  assert.match(survivorNote({ pid: 9, held: false, outcome: 'unconfirmed' }), /process 9 outlived its node/);
});

// ------------------------------------------------------------------------------------------------- driven
function runNodes(t, statuses) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-reap-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [node, s] of Object.entries(statuses)) fs.writeFileSync(path.join(dir, `${node}.status.json`), JSON.stringify(s));
  fs.writeFileSync(path.join(dir, 'broken.status.json'), '{ not json');
  return dir;
}

test('driven: a held child is stopped and seen to exit; a recorded orphan that answers is named and left running', { timeout: 30_000 }, async (t) => {
  assert.equal(typeof host.reapRun, 'function', 'the reap has no owner a test can drive');
  const held = sleeper();
  const orphan = sleeper();
  const dead = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  await new Promise((r) => dead.on('exit', r));
  t.after(() => { reallyKill(held.pid); reallyKill(orphan.pid); });
  const nodesDir = runNodes(t, {
    'security-audit': { state: 'BLOCKED', orphan_pid: orphan.pid },
    'arch-review': { state: 'BLOCKED', orphan_pid: dead.pid },
    'code-audit': { state: 'OK' },
  });
  const { stopped, notChecked } = await host.reapRun({ held: [['panel-codex-code', held], ['exited-arm', dead]], nodesDir });
  assert.deepEqual(stopped, [{ node: 'panel-codex-code', pid: held.pid }]);
  assert.ok(held.exitCode !== null || held.signalCode !== null, 'reported stopped, but the held child never exited');
  assert.deepEqual(notChecked.map((n) => n.node_id), ['security-audit'], 'a gone or exited process was named, or the orphan was not');
  assert.match(notChecked[0].why, new RegExp(`process ${orphan.pid} outlived its node`));
  assert.equal(alive(orphan.pid), true, 'a recorded pid was killed — it may belong to another process by now');
});

// G-2 of 20261002-215002-stop-child-review: a recorded orphan kept only its pid, so whether its node said kill_refused or
// kill_unconfirmed was lost and the gate gave one combined sentence for both — the distinction A-25 says is never blurred.
for (const [field, value, says, never] of [
  ['kill_refused', 'timeout', /refused/, /not seen to exit|accepted/],
  ['kill_unconfirmed', true, /not seen to exit/, /refused/],
]) {
  test(`G-2: a recorded orphan whose node said ${field} is named as that, not as "refused or unconfirmed"`, { timeout: 30_000 }, async (t) => {
    const orphan = sleeper();
    t.after(() => reallyKill(orphan.pid));
    const nodesDir = runNodes(t, { 'security-audit': { state: 'BLOCKED', orphan_pid: orphan.pid, [field]: value } });
    const { notChecked } = await host.reapRun({ held: [], nodesDir, io: { confirmGone: async () => ({ outcome: 'unconfirmed' }) } });
    assert.equal(notChecked.length, 1);
    assert.match(notChecked[0].why, says, notChecked[0].why);
    assert.doesNotMatch(notChecked[0].why, never, `the ${field} survivor is worded as the other case: ${notChecked[0].why}`);
    assert.doesNotMatch(notChecked[0].why, /refused or whose exit was never confirmed/, 'still the combined sentence');
  });
}

for (const outcome of ['refused', 'unconfirmed']) {
  test(`driven: a held child whose stop is ${outcome} reaches the gate's not_checked, with its pid`, async (t) => {
    const held = sleeper();
    t.after(() => reallyKill(held.pid));
    const nodesDir = runNodes(t, {});
    const { stopped, notChecked } = await host.reapRun({
      held: [['panel-codex-security', held]], nodesDir, io: { stop: async () => ({ outcome }) },
    });
    assert.deepEqual(stopped, []);
    assert.equal(notChecked.length, 1);
    assert.equal(notChecked[0].node_id, 'panel-codex-security');
    assert.ok(notChecked[0].why.includes(`process ${held.pid}`), notChecked[0].why);
  });
}

// The one wiring line, matched and nothing more: the reap's behaviour is driven above; this holds only that run-graph
// reaps BEFORE it writes the gate, so a survivor can reach it.
test('run-graph reaps before it writes the gate', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
  const reap = src.indexOf('await reapRun({ held: live.entries(), nodesDir })');
  assert.ok(reap > -1, 'run-graph no longer reaps through io/reap.mjs');
  assert.ok(reap < src.indexOf('const gate = writeGate(null, null);'), 'the reap comes after the gate, so no survivor reaches it');
});

// "spawn-node records the pid of a child whose kill was refused" was pinned by matching run-child's source. Since
// stopping-a-child stage 2 the stop is scripts/io/stop-child.mjs's, and the property is run with real children: the pid
// kept (`orphanPid`) in regression-pending-claims-remediation.test.mjs, and the status carrying it in
// regression-stop-on-exit.test.mjs (spawn-node driven with a refused and an unconfirmed kill).

// G-15 of 20260926-044637-m0-close-r2 (panel-codex-contract): the SIGINT/SIGTERM path. killAllLive
// discarded killTreeOf's answer and wrote a generic BLOCKED stub, then the handler exits before the
// end-of-run reaper — so a child the OS refused to stop kept running with the operator's credentials
// and nothing named its pid. The other kill paths honour kill-or-report; this one now does too.
//
// REPLACED BY DRIVEN TESTS (stopping-a-child stage 3): killAllLive is gone, and regression-stop-on-exit drives the
// interrupt with real children — a refused and an unconfirmed stop each recorded with its pid before the exit — and
// stoppedStatusFields, which puts the pid and its sentence in the stub.
