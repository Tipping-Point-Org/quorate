// A JSONL FILE'S TORN TAIL, said in one place (G-3, G-4 of 20261106-022028-stoplog-g8-remediation-2-review): an append
// after an earlier short write joined its record onto the partial line, and a reader that skips an unparsable line lost
// both. Every appender of a JSONL record file asks this first and writes a newline ahead of its line when it is true.
import nodeFs from 'node:fs';
import path from 'node:path';
import { hostPlatform } from '../platform/index.mjs';
import { confined } from './confined-path.mjs';
import { withRecordLock, LockBusyError } from './record-lock.mjs';
import { writeAllSync } from './write-all.mjs';
import { hardLinkReason } from '../lib/egress-read.mjs';

/**
 * Whether `file`'s last byte is not a newline: a torn line at its end. Missing or empty is not. `fsImpl` is any object
 * with Node's synchronous statSync, openSync, readSync and closeSync (the platform's fs carries them).
 */
export function endsMidLine(file, fsImpl = nodeFs) {
  let size;
  try { size = fsImpl.statSync(file).size; } catch (e) { if (e?.code === 'ENOENT') return false; throw e; }
  if (size === 0) return false;
  const fd = fsImpl.openSync(file, 'r');
  try {
    const b = Buffer.alloc(1);
    fsImpl.readSync(fd, b, 0, 1, size - 1);
    return b[0] !== 0x0a;
  } finally { fsImpl.closeSync(fd); }
}

/**
 * Append `text` to `file` only when the file has one name. Judged on the open file (fstat), so the file checked is the
 * file written (G-8 of 20261114-022647-m2-7b-review): a check that refuses only symbolic links let a hard link at a
 * record file alias a file outside it, and the append wrote there. A refused file throws EHARDLINK and nothing is
 * written. Every JSONL appender of a record goes through here; its torn-tail check stays its caller's, under its lock.
 */
export function appendOwnFile(file, text, fsImpl = nodeFs) {
  const fd = fsImpl.openSync(file, 'a');
  try {
    const st = fsImpl.fstatSync(fd);
    if (hardLinkReason(st)) {   // the one single-path rule (link-leaving-owner.plan.md stage 4)
      throw Object.assign(new Error(`refusing to append to ${file}: a hard link (${st.nlink} names point at this file), so its content may be another file's`),
        { code: 'EHARDLINK', nlink: st.nlink });
    }
    // Every byte, or a throw, through the rule's one helper (G-1 of 20261114-032609-m2-7b-remediation-review): writeSync
    // may write part of what it is given and return the count, and one call left a record truncated while its caller
    // reported the append done.
    writeAllSync(fd, text, { fsImpl });
  } finally { fsImpl.closeSync(fd); }
}

// How long appendRecord waits for another writer's lock. The kill log is appended on the kill path, once per child,
// inside stopAll's deadline (io/stop-child.mjs SIGNAL_EXIT_DEADLINE_MS), so the wait is short: a record that cannot get
// the lock in time is skipped and counted, never appended without it.
export const APPEND_LOCK_WAIT_MS = 200;

/**
 * Append `record` (one line, its newline included) to a JSONL file other processes append to as well, on a line of its
 * own: the torn-tail check and the append are one operation under the record lock (io/record-lock.mjs; design KL-D1 B,
 * stop-record-bounds-and-kill-log.plan.md stage 1), at `<file>.lock` beside it, through a confined owner rooted at the
 * file's folder. It replaced a private lock that two remediations each drew a MEDIUM on (G-4 of
 * 20261106-043201-stoplog-g8-remediation-4-review: never reclaimed; G-6 of 20261106-050324-stoplog-g8-remediation-5-review:
 * a failed reclaim taken as contention, then an unlocked append). Returns true when appended, false when the lock was
 * still held or busy at `waitMs` (nothing appended); any other error is thrown, with nothing appended by this call except
 * when the append itself fails part way: a short write can leave a fragment, which the next append's torn-tail newline
 * separates (G-2 of 20261106-151751-srb-d1-remediation-review). `platform` is the host's unless a caller hands one in.
 */
// `maxBytes`, when given, bounds the file as the stop record is bounded (operator, 2026-11-06: "Accept skip, bound size
// (Recommended)"; G-4 of 20261106-080520-srb-remediation-3-review): when the append would take a non-empty file past it,
// the file is first renamed to `<file>.1`, replacing the previous one, under the same lock, so the current file and one
// previous are kept. BEFORE the append, not after (G-7 of 20261106-144637-srb-d1-review): a rotation that failed after
// the append threw with the record on disk, against the contract above. The previous file is set aside to `<file>.1.old`
// and removed only once the current file has taken its place; a failed rename puts it back, and the owner's rename never
// removes its source (io/confined-path.mjs; G-4 of 20261106-151751-srb-d1-remediation-review).
// A LEFTOVER `<file>.1.old` IS RESTORED when `<file>.1` is missing (G-3 of that review): a rotation interrupted after its
// first rename left the previous file only there, and removing it unconditionally lost it. Beside a `<file>.1` it is the
// older generation, already replaced, and is removed.
function rotate(own, name) {
  const prev = `${name}.1`, aside = `${name}.1.old`;
  if (own.exists([aside])) {
    if (own.exists([prev])) own.remove([aside]); else own.rename([aside], [prev]);
  }
  const hadPrev = own.exists([prev]);
  if (hadPrev) own.rename([prev], [aside]);
  try { own.rename([name], [prev]); } catch (e) {
    if (hadPrev) own.rename([aside], [prev]);
    throw e;
  }
  if (hadPrev) own.remove([aside]);
}

// A RECORD LARGER THAN `maxBytes` IS REFUSED, thrown with nothing appended (G-1 of 20261106-200030-nbk-remediation-2-review):
// the rotation bounds what the file holds before an append, so an append bigger than the cap took the file past it.
export function appendRecord(file, record, { waitMs = APPEND_LOCK_WAIT_MS, probeStart = true, maxBytes = null, platform = hostPlatform() } = {}) {
  if (maxBytes != null && Buffer.byteLength(record) > maxBytes) {
    throw Object.assign(new RangeError(`appendRecord: a ${Buffer.byteLength(record)}-byte record is larger than the cap of ${maxBytes} bytes: ${file}`),
      { code: 'ERECORDCAP' });
  }
  const own = confined(path.dirname(path.resolve(file)), { io: platform });
  const name = path.basename(file);
  try {
    withRecordLock(own, [`${name}.lock`], () => {
      const target = own.resolve([name]);
      // The separating newline counts toward the cap (G-7 of 20261106-151751-srb-d1-remediation-review): the record's
      // bytes alone let a torn file end one byte past it.
      if (maxBytes != null && own.exists([name])) {
        const size = own.stat([name]).size;
        const sep = endsMidLine(target) ? 1 : 0;
        if (size > 0 && size + sep + Buffer.byteLength(record) > maxBytes) rotate(own, name);
      }
      appendOwnFile(target, `${endsMidLine(target) ? '\n' : ''}${record}`);
    }, { waitMs, probeStart, platform, label: 'torn-tail' });
    return true;
  } catch (e) {
    if (e instanceof LockBusyError) return false;
    throw e;
  }
}
