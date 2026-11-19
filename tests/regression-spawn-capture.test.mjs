// stopping-a-child.plan.md stage 2: the captured child (panel arms, adjudicators) and the node's child, driven with real
// children. spawnCapture was a closure inside run-graph, its properties pinned by matching run-graph's source text
// (ledger tests/regression-refused-kill-followups.test.mjs:30, G-23); it is a module now, and each property is run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { runChild } from '../scripts/io/run-child.mjs';

const mod = await import('../scripts/io/spawn-capture.mjs').catch(() => ({}));
const KILLABLE = hostPlatform().proc.killableSpawnOptions();
const node = (code) => [process.execPath, ['-e', code], { ...KILLABLE }];
// Every child a test leaves alive is ended by the test, whatever it asserted.
const reap = (t) => { const pids = []; t.after(() => { for (const p of pids) { try { process.kill(p, 'SIGKILL'); } catch {} } }); return pids; };

test('stage 2: spawnCapture is a module the caller drives, telling it of the child through onSpawn and onDone', () => {
  assert.equal(typeof mod.spawnCapture, 'function', 'spawnCapture is still a closure inside run-graph');
});

test('stage 2: a child that exits is captured whole, and onDone says nothing survived', async () => {
  let spawned = null;
  let doneWith;
  const r = await mod.spawnCapture(...node("process.stdout.write('hello'); process.stderr.write('warn')"), {
    timeoutMs: 30_000, onSpawn: (c) => { spawned = c; }, onDone: (d) => { doneWith = d; },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'hello');
  assert.equal(r.stderr, 'warn');
  assert.ok(spawned?.pid, 'the caller was not told of the child, so an interrupt could not reach it');
  assert.deepEqual(doneWith, { survivor: null });
  assert.deepEqual(r.capped, { stdout: 0, stderr: 0 });
});

// THE WAIT HAS AN END (design 1A; confirm3 G-12, ledger run-graph.mjs:2250): a stop not seen to end the child left
// spawnCapture waiting on a 'close' that never came.
for (const outcome of ['unconfirmed', 'refused']) {
  test(`stage 2: past its timeout, a child the stop leaves ${outcome} ends the wait, and is handed back as a survivor`, async (t) => {
    const pids = reap(t);
    let doneWith;
    const t0 = Date.now();
    const r = await mod.spawnCapture(...node('setInterval(() => {}, 1000)'), {
      timeoutMs: 200,
      onSpawn: (c) => pids.push(c.pid),
      onDone: (d) => { doneWith = d; },
      stop: async (child) => ({ outcome, pid: child.pid }),
    });
    assert.ok(Date.now() - t0 < 10_000, 'spawnCapture waited on a child that was not going to close');
    assert.equal(r.timedOut, true);
    assert.equal(r.survivor?.outcome, outcome);
    assert.deepEqual(doneWith, { survivor: r.survivor }, 'the caller dropped the survivor, so killAllLive could not reach it');
    assert.match(String(r.error?.message), /timed out/);
    // G-8 of 20261003-041945-stop-child-vocabulary-review (HIGH): every timed-out capture's stderr said "[killed by
    // orchestrator]", this survivor included — a false claim the operator would read beside its orphan_pid.
    // A CLAIM of a kill — "refused to be killed" is the refusal itself, not a claim.
    assert.doesNotMatch(r.stderr, /was killed|killed by|tree killed/, `a ${outcome} survivor is said to have been killed: ${r.stderr}`);
  });
}

test('stage 2: past its timeout, a child the stop ends is not a survivor', async () => {
  const r = await mod.spawnCapture(...node('setInterval(() => {}, 1000)'), { timeoutMs: 200 });
  assert.equal(r.timedOut, true);
  assert.equal(r.survivor, null);
  // The owner's words for a seen exit after the stop (stopping-a-child-vocabulary; G-8): no kill claimed, the exit seen.
  assert.match(r.stderr, /timed out after 200ms: the child \(pid \d+\) exited after its stop/);
});

// EVERY CAP IS SAID (ledger run-graph.mjs:2230): output past the cap was dropped with nothing recording it.
test('stage 2: output past the cap is dropped AND counted, on the result and in stderr', async () => {
  const r = await mod.spawnCapture(...node("process.stdout.write('x'.repeat(5000))"), { timeoutMs: 30_000, maxBytes: 1000 });
  assert.equal(r.stdout.length, 1000);
  assert.equal(r.capped.stdout, 4000);
  assert.match(r.stderr, /output capped: 4000 bytes of stdout dropped past 1000 bytes/);
});

// A FINAL SIZE CHECK AT EXIT (ledger io/run-child.mjs:100): a child that wrote past the cap and exited between two
// samples was accepted as within it.
test('stage 2: runChild reports a child that wrote past the cap and exited between samples as overflowed', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-rc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = await runChild({
    cmd: process.execPath, args: ['-e', "process.stdout.write('x'.repeat(50000))"], cwd: os.tmpdir(), env: process.env,
    stdoutPath: path.join(dir, 'out'), stderrPath: path.join(dir, 'err'),
    timeoutMs: 30_000, outputCapBytes: 1000, pollMs: 60_000,
  });
  assert.equal(res.exitCode, 0);
  assert.equal(res.overflowed, true, 'an output past the cap was accepted because the child exited between samples');
});

// A CHILD NOT CONFIRMED GONE DOES NOT HOLD THIS PROCESS OPEN (G-26 of 20260925-200721-platform-remediated, which was
// pinned by matching run-child's source for `child.unref()`). Run in a process of its own: it must exit by itself while
// its child, whose kill was refused, is still running.
test('stage 2: a process whose child\'s kill was refused still exits by itself', async (t) => {
  const pids = reap(t);
  const owner = new URL('../scripts/io/stop-child.mjs', import.meta.url).href;
  const platform = new URL('../scripts/platform/index.mjs', import.meta.url).href;
  const script = `
    import { spawn } from 'node:child_process';
    import { stopChild } from ${JSON.stringify(owner)};
    import { hostPlatform } from ${JSON.stringify(platform)};
    const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log(c.pid);
    // The stop owner's one seam, a whole process interface whose kills refuse (stop-owner-seam, SS-D1 A).
    const proc = { ...hostPlatform().proc, killTree: () => Promise.resolve(false), killTreeNow: () => false };
    const r = await stopChild(c, { proc });
    console.log(r.outcome);`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  let guard;
  const exited = await Promise.race([
    new Promise((r) => p.on('exit', () => r(true))),
    // A guard against a parent held open for good, not a timing bound: 10 s failed under the full suite's load while
    // passing alone 5 of 5 (2026-10-03), as the stage-3 driver's 20 s guard had.
    new Promise((r) => { guard = setTimeout(() => r(false), 60_000); }),
  ]);
  // Cleared once the race is decided: left pending, it held this file's process open 60 s after its last test, so the
  // file took 62 s in every full run against about 1 s of tests (split-slow-test-files.md, 2026-11-07).
  clearTimeout(guard);
  const [childPid, outcome] = out.trim().split(/\s+/);
  if (childPid) pids.push(Number(childPid));
  if (!exited) { try { p.kill('SIGKILL'); } catch {} }
  assert.equal(exited, true, 'a refused child held its parent open');
  assert.equal(outcome, 'refused');
});
