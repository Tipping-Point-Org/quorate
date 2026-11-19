// transcript-copy.mjs — the session transcript the cross-family claim checker may read, redacted.
//
// claim-check-cross-family.plan.md stage 3 (operator, 2026-10-18: "The whole transcript"; reduced to the conversation
// since 2026-10-25, lib/transcript-reduce.mjs). Under
// `review.claim_check_transcript: cross-family` the checker of the other family reads the session's transcript to check
// an attribution, and that file leaves the machine with whatever the checker opens of it. So the checker is given a COPY
// in the check directory (which ignores itself), every line passed through redactClaim — the secret shapes every
// tracked write uses — and never the original. A transcript runs to hundreds of megabytes, so the copy streams line by
// line, and writes to a temporary name renamed into place: a copy cut short by an error is removed, never left looking
// complete. `transcript.json` beside it records what was done, for checked.md to say.
import fs from 'node:fs';
import path from 'node:path';
import { egress, egressReadLines, egressRootOf, EGRESS_MAX_FILE_BYTES } from './egress-read.mjs';
import { tooLargeRefused } from '../lib/egress-read.mjs';
import { redactClaim } from '../lib/redact.mjs';
import { reduceRecord, newReduceState } from '../lib/transcript-reduce.mjs';
import { tempFor, writeJsonAtomic } from './atomic.mjs';
import { writeAllSync } from './write-all.mjs';

const MARK = /\[redacted: /g;
/** The most a copy holds before it writes: lines gather to this many bytes (G-8 of 20261112-050334-hl-review-b). */
const CHUNK_BYTES = 1024 * 1024;
const marks = (s) => (s.match(MARK) ?? []).length;

/**
 * Copy `source` into `dir` as `transcript.redacted.jsonl`, redacted; returns (and writes) the record. THROUGH THE EGRESS
 * OWNER (hardlink-egress.plan.md stage 2): the copy is what the cross-family checker reads, so a transcript that is a link
 * or has a second name is refused, and the lines are read through the owner (lib/confined-path.mjs readLines, in bounded
 * chunks), never with a raw stream that would follow a link.
 */
export async function redactedTranscriptCopy(source, dir, opts = {}) {
  const abs = path.resolve(source);
  // ROOTED AT THE REPOSITORY for an in-repository transcript (G-2 of 20261112-054852-hl-remediation-3-review), as the draft
  // is: `opts.repoRoot` is the caller's repository, so a junction in any of the transcript's folders is refused.
  const at = egressRootOf(abs, opts.repoRoot);
  const stat = egress(at.root).stat(at.segments);
  const dest = path.join(dir, 'transcript.redacted.jsonl');
  const tmp = tempFor(dest);
  // Reduced (lib/transcript-reduce.mjs): commands and outputs dropped, text, question-tool exchanges and file-change
  // markers kept, before redaction, so only what is sent is redacted.
  // `malformed` (G-11 of 20261112-063354-hl-remediation-4-review): lines that could not be parsed, so were not sent; a torn
  // or corrupt transcript is a partial conversation, and the record says how much of it the checker never saw.
  const record = { source: abs, path: dest, bytes_in: stat.size, bytes_out: 0, lines_in: 0, lines: 0, redactions: 0, malformed: 0, reduced: true };
  const state = newReduceState();
  // A plain open: tempFor names a file no other writer uses (an exclusive create here read as a lock).
  const fd = fs.openSync(tmp, 'w');
  // IN BOUNDED CHUNKS (G-8 of 20261112-050334-hl-review-b; G-7 its symptom): one writeSync per kept line made a syscall
  // per line of a transcript of tens of thousands. Lines gather to CHUNK_BYTES, then are written every byte (G-11 of
  // 20261112-035452-hl-delivery, io/write-all.mjs); the rest after the last line.
  // BOUNDED ON THE COPY SENT (G-7 of 20261112-154323-hl-review-c; G-4, G-1 its symptoms; ARCHITECTURE A-30, operator
  // 2026-11-12: "A. Bound the copy sent (Recommended)"): the bytes kept are counted as they gather, and a copy that would
  // pass EGRESS_MAX_FILE_BYTES is refused with its size before that chunk is written, its temporary removed below.
  let pending = [];
  let pendingBytes = 0;
  let written = 0;
  const flush = () => { if (pendingBytes) writeAllSync(fd, Buffer.concat(pending, pendingBytes)); written += pendingBytes; pending = []; pendingBytes = 0; };
  try {
    egressReadLines(abs, (raw) => {
      record.lines_in += 1;
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { record.malformed += 1; return; }
      const reduced = reduceRecord(parsed, state);
      if (!reduced) return;
      const line = JSON.stringify(reduced);
      const red = redactClaim(line);
      record.redactions += marks(red) - marks(line);
      record.lines += 1;
      const buf = Buffer.from(`${red}\n`, 'utf8');
      pending.push(buf);
      pendingBytes += buf.length;
      if (written + pendingBytes > EGRESS_MAX_FILE_BYTES) throw tooLargeRefused(dest, written + pendingBytes, EGRESS_MAX_FILE_BYTES, true);
      if (pendingBytes >= CHUNK_BYTES) flush();
    }, undefined, { repoRoot: opts.repoRoot });
    flush();
    fs.closeSync(fd);
    fs.renameSync(tmp, dest);
  } catch (e) {
    try { fs.closeSync(fd); } catch { /* closed */ }
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  record.bytes_out = fs.statSync(dest).size;
  writeJsonAtomic(path.join(dir, 'transcript.json'), record);
  return record;
}
