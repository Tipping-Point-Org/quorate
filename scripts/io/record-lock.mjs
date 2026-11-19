// THE RECORD LOCK (stop-record-bounds-and-kill-log.plan.md stage 1; design KL-D1 B, operator 2026-11-06): the one lock
// the session records and the kill log take, moved out of io/stop-log.mjs, where it was the stop record's own. The kill
// log had grown a private lock of its own over two remediations, each drawing a MEDIUM on its reclaim rule (G-4 of
// 20261106-043201-stoplog-g8-remediation-4-review, G-6 of 20261106-050324-stoplog-g8-remediation-5-review); it takes
// this one instead.
//
// The rule: the lock names its holder (pid and the moment it was written, lib/session-record.mjs `lockContent`). One held
// by a live holder is waited on, up to `waitMs`, then refused with the lock named. One whose holder is gone, or whose pid
// now belongs to a process started after the lock was written (`lockState`), is stale: it is renamed aside to a unique
// name and removed, so of two writers that both find it stale only the one whose rename succeeds goes on. On Windows a
// lock just removed stays "delete pending" for a moment and opening or reading it fails with one of the platform's
// transient codes: busy, not broken, so those wait like a held lock. Any other error is thrown, with `fn` not run.
// Every path is resolved and read through the caller's confined owner, so a link at the lock is refused, never followed.
import fs from 'node:fs';
import { hostPlatform } from '../platform/index.mjs';
import { lockContent, lockState } from '../lib/session-record.mjs';
import { writeAllSync } from './write-all.mjs';

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Thrown when the lock is still held (or busy) at the deadline; `fn` was not run. */
export class LockBusyError extends Error {
  constructor(message, lock) { super(message); this.code = 'ELOCKBUSY'; this.lock = lock; }
}

/**
 * Run `fn` holding the lock at `lsegs` below the confined owner `own`, and return what it returns. `make` names a folder to
 * remake when the lock's folder is gone (a sweep removed it while the writer waited: G-7 of
 * 20261025-104155-srf-remediation-3-review); without it, a missing folder is thrown. `platform` is the host's unless a
 * caller hands one in (its `proc.isAlive`, `proc.startedAt` and `transientRenameCodes`). `label` names the caller in the
 * refusal.
 */
export function withRecordLock(own, lsegs, fn, { waitMs, probeStart = true, platform = hostPlatform(), make = null, label = 'record-lock' } = {}) {
  if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error(`${label}: a lock wait must be a number of milliseconds`);
  let lock = lsegs.join('/');
  const deadline = Date.now() + waitMs;
  const transient = platform.transientRenameCodes ?? new Set();
  const busy = (why) => {
    if (Date.now() >= deadline) throw new LockBusyError(`${label}: the lock ${lock} ${why} past ${waitMs} ms`, lock);
    pause(Math.min(20, Math.max(1, deadline - Date.now())));
  };
  // A holder's start time is asked once per wait, not on every poll: asking launches PowerShell or ps (G-4 of
  // 20261025-095239-srf-remediation-2-review). An answer the OS would not give is asked again. A pid reused inside one wait
  // reads with its old start time as held, so the wait ends in a refusal, never in a removed live lock.
  // `probeStart: false` never asks (G-3 of 20261106-073206-srb-remediation-2-review): the ask is a launch of up to 5 s that
  // runs before the deadline is checked, so a caller whose wait must stay bounded declines it, and a live holder is held.
  const starts = new Map();
  const startedAt = (p) => {
    if (!probeStart) return null;
    if (starts.has(p)) return starts.get(p);
    const s = platform.proc.startedAt(p);
    if (s != null) starts.set(p, s);
    return s;
  };
  for (;;) {
    let fd;
    try { lock = own.resolve(lsegs); fd = fs.openSync(lock, 'wx'); } catch (e) {
      if (transient.has(e.code)) { busy('stayed busy'); continue; }
      if (make && e.code === 'ENOENT') { own.dir(make); busy('stayed busy'); continue; }
      if (e.code !== 'EEXIST') throw e;
      let text = null;
      try { text = own.read(lsegs); } catch (r) {
        if (r.code === 'ENOENT') continue;
        if (transient.has(r.code)) { busy('stayed busy'); continue; }
        throw r;
      }
      if (lockState(text, { isAlive: (p) => platform.proc.isAlive(p), startedAt }) === 'stale') {
        const aside = [...lsegs.slice(0, -1), `${lsegs[lsegs.length - 1]}.stale.${process.pid}.${Date.now()}`];
        try { own.rename(lsegs, aside); own.remove(aside); } catch (r) {
          if (transient.has(r.code)) { busy('stayed busy'); continue; }
          if (r.code !== 'ENOENT') throw r;
        }
        continue;
      }
      busy('is held by a live writer');
      continue;
    }
    try {
      // Every byte, or a throw (G-2 of 20261114-042824-m2-7b-remediation-2-review): a short write left a truncated lock.
      writeAllSync(fd, lockContent({ pid: process.pid, writtenAt: Date.now() }));
      return fn();
    } finally {
      // The lock is removed even when the close throws (G-8 of 20261105-052942-crsf-delivery): it was skipped, and a lock
      // owned by this live process blocked every later append until it exited.
      try { fs.closeSync(fd); } finally { own.remove(lsegs); }
    }
  }
}

/** Whether a name in a folder is a record lock, or a stale one set aside: neither is a write of the record. */
export const isRecordLockName = (n, lockName) => n === lockName || n.startsWith(`${lockName}.`);
