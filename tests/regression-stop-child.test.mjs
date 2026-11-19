// stopping-a-child.plan.md stage 1 (operator, 2026-10-02: "Approve, start (Recommended)"): one owner for stopping a child —
// the kill, its confirmation by the child's own exit, one deadline after an accepted kill, and the outcome said as one of
// three words. Each outcome is driven with a real child; where the operating system will not produce an outcome on demand
// (a refused kill; an accepted kill that never ends the child), the kill is injected, as run-child's tests do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { withKill } from './helpers.mjs';

const mod = await import('../scripts/io/stop-child.mjs').catch(() => ({}));
const POSIX = process.platform !== 'win32';

// A real child that stays alive until something ends it, started as every launcher starts one: killableSpawnOptions makes
// it a process-group leader on POSIX, which a group kill needs — started without it, the first Linux run of this file
// showed the kill reaching nothing, and the owner rightly reporting 'unconfirmed'.
const KILLABLE = hostPlatform().proc.killableSpawnOptions();
const sleeper = (extra = '') => spawn(process.execPath, ['-e', `${extra}; setInterval(() => {}, 1000)`], { stdio: 'ignore', ...KILLABLE });
const reallyKill = (child) => { try { child.kill('SIGKILL'); } catch {} };

test('stage 1: there is one owner, io/stop-child.mjs, with its named deadlines', () => {
  assert.equal(typeof mod.stopChild, 'function', 'nothing owns stopping a child');
  assert.equal(typeof mod.confirmGone, 'function', 'nothing owns confirming a pid it does not hold is gone');
  for (const k of ['ESCALATE_AFTER_MS', 'DEATH_GRACE_MS', 'SIGNAL_EXIT_DEADLINE_MS']) {
    assert.ok(Number.isInteger(mod[k]) && mod[k] > 0, `${k} is not a named deadline`);
  }
  assert.ok(mod.DEATH_GRACE_MS > mod.ESCALATE_AFTER_MS, 'the grace must outlast the escalation, or an escalated kill reads as unconfirmed');
});

test('stage 1: a child that exits when stopped is "exited", seen by its own exit event', async (t) => {
  const child = sleeper();
  t.after(() => reallyKill(child));
  const r = await mod.stopChild(child);
  assert.deepEqual(r, { outcome: 'exited', pid: child.pid });
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'reported exited, but the child never exited');
});

test('stage 1: a child that has already exited is "exited", and nothing is killed', async () => {
  const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  await new Promise((r) => child.on('exit', r));
  let kills = 0;
  const r = await mod.stopChild(child, withKill({ kill: () => { kills++; return true; } }));
  assert.equal(r.outcome, 'exited');
  assert.equal(kills, 0, 'a dead child was killed again');
});

test('stage 1: a kill the platform refuses is "refused", at once, and the child is not waited on', async (t) => {
  const child = sleeper();
  t.after(() => reallyKill(child));
  const started = Date.now();
  const r = await mod.stopChild(child, withKill({ kill: () => false, deathGraceMs: 10_000 }));
  assert.deepEqual(r, { outcome: 'refused', pid: child.pid });
  assert.ok(Date.now() - started < 5_000, 'a refused kill waited for an exit that will not come');
});

// ACCEPTED IS NOT EXITED (design 2A): the kill's return means "requested". A child that outlives the deadline is said as
// that, never as stopped.
test('stage 1: an accepted kill with no exit within the deadline is "unconfirmed", not "exited"', async (t) => {
  const child = sleeper();
  t.after(() => reallyKill(child));
  const r = await mod.stopChild(child, withKill({ kill: () => true, deathGraceMs: 300 }));
  assert.deepEqual(r, { outcome: 'unconfirmed', pid: child.pid });
  assert.equal(child.exitCode, null, 'the fixture child died; the test proves nothing');
});

// POSIX only: Windows ends a Node child on SIGTERM without running its handler, and taskkill /F cannot be ignored
// (measured by plan-review, round 1), so "a child that ignores the signal" cannot exist there.
test('stage 1: a child that ignores SIGTERM is escalated to SIGKILL and is "exited"', { skip: POSIX ? false : 'POSIX only: no Windows child can ignore the stop' }, async (t) => {
  const child = sleeper("process.on('SIGTERM', () => {})");
  t.after(() => reallyKill(child));
  await new Promise((r) => setTimeout(r, 200));   // let it install the handler
  const r = await mod.stopChild(child, { escalateAfterMs: 300, deathGraceMs: 5_000 });
  assert.equal(r.outcome, 'exited');
  assert.equal(child.signalCode, 'SIGKILL', 'it was not the escalation that ended it');
});

test('stage 1: the exit event is the caller\'s choice — "close" for a child whose pipes must drain', async (t) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'], ...KILLABLE });
  t.after(() => reallyKill(child));
  child.stdout.resume(); child.stderr.resume();
  const r = await mod.stopChild(child, { event: 'close' });
  assert.equal(r.outcome, 'exited');
});

// A RECORDED PID IS POLLED, NEVER KILLED (design 2A; the rule in lib/reap.mjs): after a restart the pid may be reused.
test('stage 1: confirmGone polls a pid it does not hold and never kills it', async () => {
  let alive = 3;
  const r = await mod.confirmGone(4242, { isAlive: () => alive-- > 0, pollMs: 10, deadlineMs: 1_000 });
  assert.deepEqual(r, { outcome: 'exited', pid: 4242 });
  const stuck = await mod.confirmGone(4243, { isAlive: () => true, pollMs: 10, deadlineMs: 100 });
  assert.deepEqual(stuck, { outcome: 'unconfirmed', pid: 4243 });
});

// ------------------------------------------------------------------------------------------------- refusal design
// stopping-a-child-refusal.design.md (decided 2026-10-03, 1A): a kill whose primitive returns false is a refusal only for a
// process still there. Windows' taskkill exits 128 both for "not found" and for "Access is denied" (measured), so the owner
// asks: the child's own handle, then isAlive(pid).
test('refusal design (1A): a false kill for a child that is already gone is waited for and is "exited", not "refused"', async (t) => {
  const child = sleeper();
  t.after(() => reallyKill(child));
  // The primitive ends the child and still reports failure — what a second taskkill does for a tree the first has ended.
  const kill = (pid) => { try { process.kill(pid, 'SIGKILL'); } catch {} return false; };
  const r = await mod.stopChild(child, withKill({ kill, isAlive: () => false, deathGraceMs: 10_000 }));
  assert.deepEqual(r, { outcome: 'exited', pid: child.pid });
});

test('refusal design (1A): a false kill for a child still there is "refused", at once', async (t) => {
  const child = sleeper();
  t.after(() => reallyKill(child));
  const started = Date.now();
  const r = await mod.stopChild(child, withKill({ kill: () => false, isAlive: () => true, deathGraceMs: 10_000 }));
  assert.deepEqual(r, { outcome: 'refused', pid: child.pid });
  assert.ok(Date.now() - started < 5_000, 'a refusal waited for an exit');
});

// G-1 and G-7 of 20261003-012557-stop-child-refusal-review: this test first asserted "exited" for a child the hook found
// gone — but A-25 defines exited as the child's own exit event, and an exit hook cannot wait for one. Gone-but-unseen is
// "unconfirmed", as the hook already says for an accepted kill; still there is "refused".
test('refusal design (1A): the exit hook\'s stop — gone but unseen is "unconfirmed", still there is "refused"', (t) => {
  const a = sleeper();
  const b = sleeper();
  t.after(() => { reallyKill(a); reallyKill(b); });
  const gone = mod.requestStopNow([['a', a]], withKill({ kill: () => false, isAlive: () => false }));
  const there = mod.requestStopNow([['b', b]], withKill({ kill: () => false, isAlive: () => true }));
  assert.equal(gone[0].outcome, 'unconfirmed', 'the hook called a child exited without seeing its exit (A-25)');
  assert.equal(there[0].outcome, 'refused');
});

// G-4 of 20261003-012557-stop-child-refusal-review: stopChild dropped `killSignal` for `supersede`, and a caller still
// passing the old option was silently given SIGTERM-plus-escalation. An option the owner does not know is refused.
test('G-4: stopChild refuses an option it does not know, instead of ignoring it', (t) => {
  const child = sleeper();
  t.after(() => reallyKill(child));
  assert.throws(() => mod.stopChild(child, { killSignal: 'SIGKILL', kill: () => true }), /killSignal/);
});

// G-8 of 20261002-235323-stop-child-confirm-2: under 'close', a child whose handle had exited but whose pipes had not drained
// was still sent a kill — on a pid that may already belong to another process.
test('G-8: a child whose handle has exited is not killed, only waited for', async (t) => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('x')"], { stdio: ['ignore', 'pipe', 'pipe'], ...KILLABLE });
  t.after(() => reallyKill(child));
  await new Promise((r) => child.once('exit', r));   // exited; 'close' may still be pending
  let kills = 0;
  child.stdout.resume(); child.stderr.resume();
  const r = await mod.stopChild(child, withKill({ event: 'close', kill: () => { kills++; return true; }, deathGraceMs: 5_000 }));
  assert.equal(kills, 0, 'a child that had already exited was sent a kill');
  assert.equal(r.outcome, 'exited');
});
