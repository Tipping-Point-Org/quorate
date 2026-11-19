// A node's child process: spawned, watched for its timeout and its output cap, killed, and reported.
//
// MOVED OUT OF spawn-node.mjs (20261001-205530-m0-pending-claims-review: G-8, G-9, G-13), with the kill passed in, so the
// refused-kill path is driven by a test with a real child rather than matched in source — the operating system will not
// refuse a kill on request. The reasoning that shaped it stays with it:
//
// A WATCHDOG, NOT A PIPE (G-39). The node's stdout and stderr are files the child writes straight into; routing every
// node's output through this process would put a JS event loop in the data path of the one thing that is deliberately
// not buffered, and stdout carries the result envelope that must reach disk even if this process dies. Sampling the two
// files leaves the fast path a direct kernel write and still bounds it. The overshoot past the cap is (write rate x
// interval): 100 ms, because a child writing at memory speed produced 51 MB past a 2 MiB cap at 250 ms. The guarantee is
// "growth stops promptly", so the node reports the size it ACTUALLY reached, not the cap it was given.
//
// A REFUSED KILL IS ITS OWN OUTCOME (G-43, G-26, and now G-8/G-13). It must not leave the node hanging on an exit that
// may never come, so the node finishes — but as the timeout or overflow it was, with `killRefused` naming which and
// `killedTree` false, because the child is alive: the status said "killed" beside an orphan pid, and the refusal arrived
// as a spawn error, so the node read "spawn failed" and lost its overflow metadata. Once this process exits, nothing it
// owns can cap a child it could not kill (G-9): that is reported — refusedKillNote — and run-graph names the orphan at
// the gate if it still answers.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { stopChild, DEATH_GRACE_MS } from './stop-child.mjs';
import { stdinFrom } from './stdin-file.mjs';
import { stopRecord } from '../lib/stop-vocabulary.mjs';

export const OUTPUT_POLL_MS = 100;
// How long a child whose kill was ACCEPTED may take to exit before the node stops waiting (G-7 of
// 20261002-004527-confirm2-confirm) — owned by io/stop-child.mjs since stopping-a-child stage 1, re-exported for callers.
export { DEATH_GRACE_MS };

// THE SIZE OF WHAT THE CHILD WROTE, from the descriptors it writes to (run-dir-reads.plan.md stage 3): a stat of the
// path below the run followed a link standing there, so the cap could be judged on another file. A closed descriptor
// is 0, as a missing file was.
const fdSizeOr0 = (fd) => { try { return fs.fstatSync(fd).size; } catch { return 0; } };

/**
 * @returns {Promise<{exitCode, signal, timedOut, killedTree, overflowed, spawnError, orphanPid, killRefused, exitUnconfirmed, interrupted}>}
 *   killRefused: null | 'timeout' | 'output-cap' | 'interrupt'
 *   interrupted: null | the signal name the caller passed to interrupt()
 *
 * `onSpawn({ pid, interrupt })` hands the caller a way to stop the child for a reason of its own — a signal the caller
 * received (stopping-a-child stage 3: spawn-node passes SIGINT/SIGTERM on to its child, which on posix sits in a process
 * group of its own and is not reached by the group kill that reached spawn-node). `interrupt(signalName, { escalateAfterMs,
 * deathGraceMs })` goes through the same owner and the same one-kill-one-reason rule as the timeout and the cap.
 */
export function runChild({
  cmd, args = [], cwd, env, stdoutPath, stderrPath, timeoutMs, outputCapBytes,
  // `proc` replaces the platform's process interface inside the stop owner, for tests only: no OS refuses a kill on
  // request. The owner's one seam (stop-owner-seam, SS-D1 A).
  proc: proc_ = null,
  spawnOptions = {}, pollMs = OUTPUT_POLL_MS, deathGraceMs = DEATH_GRACE_MS, onSpawn = null,
  // Text the child reads as its stdin (decision-panel-seats.plan.md stage 2): the node runtime's prompt, when it goes by
  // stdin, from a file (io/stdin-file.mjs), never a pipe this process must hold. Absent, stdin stays 'ignore'.
  input = null,
}) {
  return new Promise((resolve) => {
    const outFd = fs.openSync(stdoutPath, 'w');
    const errFd = fs.openSync(stderrPath, 'w');
    const stdin = stdinFrom(input);
    let timedOut = false;
    let killedTree = false;
    let overflowed = false;
    let killRefused = null;
    // The pid of a child whose kill was refused: recorded, so run-graph can name it (G-14).
    let orphanPid = null;
    let exitUnconfirmed = false;
    let interrupted = null;
    let killing = false;
    let done = false;

    // detached (through spawnOptions) makes the child a process-group leader, so a group kill reaches what it spawns.
    const child = spawn(cmd, args, {
      cwd, env,
      // Inherited stdin would let the child block on a TTY: it is 'ignore', or a file holding `input`, so the child
      // never waits on the parent's terminal, and the parent never waits on the child's reading (a pipe's close does).
      stdio: [stdin.fd, outFd, errFd],
      ...spawnOptions,
      windowsHide: true,
    });
    // The child holds its own handle on the file now; this process's goes, and the folder too where the host allows.
    stdin.release();
    // Never child.unref() while it runs — we must observe 'exit'.

    const finish = (exitCode, signal, spawnError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(sizeWatch);
      try { fs.closeSync(outFd); } catch {}
      try { fs.closeSync(errFd); } catch {}
      // The stdin file's folder, if the child's handle refused its removal at the spawn.
      stdin.release();
      resolve({ exitCode, signal, timedOut, killedTree, overflowed, spawnError, orphanPid, killRefused, exitUnconfirmed, interrupted });
    };
    // A kill the OS refused: the child is alive, so it is not "killed"; it must not hold this process open; and the
    // node finishes now, as the outcome that asked for the kill.
    //
    // ONE KILL, ONE REASON (G-7, with G-6, of 20261001-234443-pending-claims-confirm-2). The first watchdog to fire disarms
    // the other: the output-cap kill left the timeout armed, so while a correctly killed child was still dying — killTree
    // escalates over seconds — the timer fired a second kill, which taskkill refuses for a process already going, and
    // the node's real reason was overwritten by a refused timeout kill. finish() still disarms both on exit.
    // THROUGH THE ONE OWNER (stopping-a-child stage 2): io/stop-child.mjs issues the kill, sees the exit, and gives an
    // accepted kill its grace deadline (G-7 of 20261002-004527-confirm2-confirm). An exit ends the node through the
    // 'exit' listener below; a refused or unconfirmed stop ends it here, as the reason that asked for the kill, with the
    // child named and not counted as killed. The owner unrefs a child it could not confirm gone.
    // The stop under way, so a later one can SUPERSEDE it: aborting clears its deadline and silences its outcome, and only
    // the superseding stop's outcome is recorded (G-3 of 20261002-225920-stop-child-confirm).
    let inFlight = null;
    const kill = (reason, { escalateAfterMs, deathGraceMs: grace = deathGraceMs, supersede = false } = {}) => {
      clearTimeout(timer);
      clearInterval(sizeWatch);
      killing = true;
      killedTree = true;
      inFlight?.abort();
      const ctl = new AbortController();
      inFlight = ctl;
      const timing = { deathGraceMs: grace, ...(escalateAfterMs != null ? { escalateAfterMs } : {}), supersede };
      stopChild(child, { event: 'exit', ...timing, abortSignal: ctl.signal, ...(proc_ ? { proc: proc_ } : {}) }).then(({ outcome }) => {
        // Superseded: the stop that replaced it speaks for the child. Exited: the 'exit' listener below ends the node.
        if (ctl.signal.aborted || outcome === 'exited') return;
        killedTree = false;
        orphanPid = child.pid;
        if (outcome === 'refused') {
          killRefused = reason;
          finish(null, 'SIGKILL-REFUSED', null);
        } else {
          exitUnconfirmed = true;
          finish(null, 'KILL-UNCONFIRMED', null);
        }
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill('timeout');
    }, timeoutMs);

    const sizeWatch = setInterval(() => {
      // ONE SHOT: a second sample after the first kill worked once reported that kill as refused, and won the race.
      if (overflowed) return;
      if (fdSizeOr0(outFd) + fdSizeOr0(errFd) <= outputCapBytes) return;
      overflowed = true;
      clearInterval(sizeWatch);
      kill('output-cap');
    }, pollMs);
    sizeWatch.unref();

    // THE CALLER'S OWN REASON TO STOP (stage 3). One kill, one reason: a kill already under way keeps its reason, and the
    // interrupt is not issued twice.
    if (onSpawn) {
      onSpawn({
        pid: child.pid,
        interrupt: (signalName, timing = {}) => {
          if (done) return false;
          interrupted = signalName;
          // A KILL ALREADY UNDER WAY does not keep its grace (G-3 of 20261002-215002-stop-child-review): left to run out
          // its own deadline — 15 s by default — it outlasted the orchestrator's escalation. It is SUPERSEDED by one stop
          // through the owner, SIGKILL at once with the caller's deadline, whose three outcomes are recorded as they are:
          // the first answer kept a deadline of its own and always said "unconfirmed", so a refused escalation was
          // misreported (G-3 of 20261002-225920-stop-child-confirm). The reason that started the stop stays recorded in
          // its own flag (timedOut, overflowed); the stop now answers for the interrupt.
          kill('interrupt', killing ? { ...timing, supersede: true } : timing);
          return true;
        },
      });
    }

    child.on('error', (err) => finish(null, null, err));
    // A FINAL SIZE CHECK AT EXIT (stopping-a-child stage 2; ledger io/run-child.mjs:100): a child that wrote past the cap
    // and exited between two samples was accepted as within it. The output is not cut — the files are what the child
    // wrote — but it is reported as the overflow it was. Only for a child that exited ON ITS OWN: one already being
    // killed has its reason, and a second one recorded beside it is the double reason G-7 removed.
    child.on('exit', (code, signal) => {
      if (!killing && !overflowed && fdSizeOr0(outFd) + fdSizeOr0(errFd) > outputCapBytes) overflowed = true;
      finish(code, signal, null);
    });
  });
}

/**
 * The run's outcome, onto a node's status: the fields, and the refusal or unconfirmed exit said as itself. The one place
 * spawn-node records it (G-18 of 20261002-004527-confirm2-confirm: the refused-kill test could only check that spawn-node
 * called runChild, and removing its handling of the refusal left that test green).
 */
export function recordRunOutcome(status, res) {
  status.exit_code = res.exitCode;
  status.signal = res.signal;
  status.timed_out = res.timedOut;
  status.killed_tree = res.killedTree;
  // STOPPED BECAUSE THE NODE RUNNER WAS (stage 3): the signal it received, said as the reason.
  if (res.interrupted) {
    status.interrupted = res.interrupted;
    // The signal, as the reason; what became of the child is the stop's outcome, said below by the owner — this said
    // "stopped its child" even when the child refused the kill (G-5 of 20261003-041945-stop-child-vocabulary-review).
    status.validator_errors.push(`interrupted: the node runner received ${res.interrupted}`);
    if (res.killedTree) status.validator_errors.push(stopRecord({ outcome: 'exited', pid: null, context: 'node' }).sentence);
  }
  // STILL RUNNING after a refused or unconfirmed stop (G-14): the fields and the sentence are lib/stop-vocabulary.mjs's
  // (stopping-a-child-vocabulary, 1A/2A); run-graph names the pid at the gate if it still answers.
  const outcome = res.killRefused ? 'refused' : res.exitUnconfirmed ? 'unconfirmed' : null;
  if (outcome) {
    const { fields, sentence } = stopRecord({ outcome, pid: res.orphanPid, reason: res.killRefused ?? null, context: 'node' });
    Object.assign(status, fields);
    status.validator_errors.push(sentence);
  }
  return status;
}

/**
 * How a stop ended, in the few words the timeout and overflow sentences carry (stopping-a-child stage 6; ledger
 * spawn-node.mjs:1520). Three outcomes, three phrases: both sentences said "the kill was refused" for every kill not
 * counted as done, so an accepted kill whose exit was merely not seen was misdiagnosed as a refusal beside its own
 * `kill_unconfirmed` record — and sent the operator to look for a permissions problem that did not exist.
 */
export function stopPhrase({ killedTree, exitUnconfirmed, killRefused, orphanPid }) {
  if (killedTree) return stopRecord({ outcome: 'exited', pid: null, context: 'phrase' }).sentence;
  if (exitUnconfirmed) return stopRecord({ outcome: 'unconfirmed', pid: orphanPid, context: 'phrase' }).sentence;
  if (killRefused) return stopRecord({ outcome: 'refused', pid: orphanPid, reason: killRefused, context: 'phrase' }).sentence;
  // NO KILL AT ALL (G-4 of 20261002-215002-stop-child-review): the final size check marks a child that wrote past the cap
  // and exited between two samples as overflowed. Not a stop outcome, so not the vocabulary's.
  return 'the child exited on its own, past the cap, before any kill';
}

/** What a node's status says about a kill the OS refused — lib/stop-vocabulary.mjs's sentence, kept here for its callers. */
export function refusedKillNote({ killRefused, orphanPid }) {
  if (!killRefused) return null;
  return stopRecord({ outcome: 'refused', pid: orphanPid, reason: killRefused, context: 'node' }).sentence;
}
