// write-all.mjs — EVERY BYTE OR A FAILURE, through a descriptor already open (G-11 of 20261112-035452-hl-delivery; G-4 and
// G-8 of 20261112-050334-hl-review-b). writeSync may write fewer bytes than given, and an ignored count left a truncated
// file that read as complete: the transcript copy's, and external-review's --out answer. The one helper the rule has, so
// its callers refuse alike.
import fs from 'node:fs';

/**
 * Write all of `data` (a Buffer, or text as UTF-8) to `fd`, calling writeSync until every byte is written; a write of
 * nothing throws. `retry` names error codes that mean "not now" (EAGAIN, from a non-blocking pipe), retried, not thrown.
 */
// `fsImpl`: the file system written through, for a caller that is given one (io/torn-tail.mjs's appendOwnFile).
export function writeAllSync(fd, data, { retry = [], fsImpl = fs } = {}) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  let wait = 1;
  for (let off = 0; off < buf.length;) {
    let n;
    try { n = fsImpl.writeSync(fd, buf, off, buf.length - off); } catch (e) {
      // WAITS BEFORE A RETRY (G-9 of 20261112-054852-hl-remediation-3-review): retrying at once spun a core while a pipe
      // stayed full. The wait doubles from 1 ms to at most 50 ms, and resets once a write lands.
      if (retry.includes(e?.code)) { sleepMs(wait); wait = Math.min(wait * 2, 50); continue; }
      throw e;
    }
    if (!(n > 0)) throw new Error(`a write of ${buf.length - off} bytes wrote ${n}`);
    off += n;
    wait = 1;
  }
}

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
/** A synchronous wait, for a caller that writes synchronously. */
function sleepMs(ms) { Atomics.wait(SLEEP, 0, 0, ms); }
