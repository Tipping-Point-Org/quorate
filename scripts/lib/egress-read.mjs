// egress-read.mjs — THE ONE OWNER OF A FILE WHOSE CONTENT LEAVES THE MACHINE OR ENTERS THE INTENT SANDBOX
// (hardlink-egress.plan.md stage 1; design hardlink-egress.design.md, HL-D1 B, operator 2026-11-12).
//
// A file with a second name (`nlink > 1`) passed every check that refuses only symbolic links: its content is another
// file's, under a name the check accepted, so a draft, a seat's copy or an intent document named in one place could
// carry a file from anywhere the operator can read (G-1, G-2, G-3 of 20261111-235524-runtime-bin-remediation-5-review).
// This owner reads such a file only when it has one name. It is built on `confined`, so a link or junction at any level,
// or an unsafe name, is refused by that one owner; it adds the link count, from `confined`'s own lstat, and nothing else.
// Local reads keep using `confined` (HL-D1 B: a hard link below a run or a ledger is not content leaving).
//
// A refusal is `confined`'s shape (code ECONFINED, refusal 'hard-link', the path and the count in the message), so every
// site reports it the way it already reports a refused link. THE RESIDUAL is `confined`'s (ARCHITECTURE A-30): the stat
// and the open are two calls, so a second name made between them is not seen.
//
// Pure: the platform arrives as `io` (ARCHITECTURE §2).

import path from 'node:path';
import { confined, readAtMost } from './confined-path.mjs';

export { readAtMost };

/** Why a regular file with `nlink` names may not leave, or null. A directory or a single-named file is not refused here. */
export function hardLinkReason(st, where) {
  if (!st || typeof st.isFile !== 'function' || !st.isFile()) return null;
  const n = Number(st.nlink);
  if (!(n > 1)) return null;
  return `a hard link: ${n} names point at this file, so its content may be another file's; what leaves the machine or `
    + 'enters the intent sandbox is read only from a file with one name';
}

/** The refusal thrown for a hard-linked file: `confined`'s shape, so a caller's existing catch reports it. */
export function hardLinkRefused(where, st) {
  return Object.assign(new Error(`confined path refused: ${where} — ${hardLinkReason(st, where)}`),
    { code: 'ECONFINED', path: where, refusal: 'hard-link', nlink: Number(st.nlink) });
}

/**
 * What a refusal is, in the words a section or the gate says it in (G-9 of 20261114-231942-pbr-delivery; ARCHITECTURE A-1):
 * the one mapping from a refusal code, which run-graph inlined twice.
 */
export function refusalWords(e) {
  if (e?.refusal === 'hard-link') return 'a file with more than one name';
  if (e?.refusal === 'too-large') return 'a file over the bound on what leaves the machine';
  // Every other kind in its own words (G-3 of 20261114-235051-pbr-remediation-review): all of them were said as a link, so
  // a directory standing at a file's name, or a path outside the run, was recorded with a false cause.
  if (e?.refusal === 'link') return 'a link or junction';
  if (e?.refusal === 'not-a-file') return 'something that is not a file';
  if (e?.refusal === 'not-a-directory') return 'something that is not a directory';
  if (e?.refusal === 'outside') return 'a path outside the run';
  if (e?.refusal === 'taken') return 'a name already taken';
  // A READ THAT FAILED IS SAID BY ITS CODE (G-6 of 20261115-031845-pbr-1b-remediation-2-review): a prompt-bound site
  // handles every failure by its class now, and an EISDIR or EACCES is not a refusal of the path.
  if (e?.code && e.code !== 'ECONFINED') return `a file that could not be read (${e.code})`;
  if (e instanceof SyntaxError) return 'a file that is not valid JSON';
  return 'a path the owner refuses';
}

/**
 * A-30'S REFUSAL CLASSES, OWNED ONCE (G-28 of 20261116-221234-m2-9a-high-2; ARCHITECTURE A-1, A-30): a refusal and an
 * absence are one class, which a required input meets by starting no node and a context input by being left out; any
 * other failure ('other') is the caller's to re-throw. run-graph, spawn-node and new-run each held their own copy.
 */
export function refusalClass(e) {
  if (e?.code === 'ECONFINED') return 'refused';
  if (e?.code === 'ENOENT') return 'absent';
  return 'other';
}
export const refusedOrAbsent = (e) => refusalClass(e) !== 'other';
/** What stands at a path a site could not open, in the owner's words: an absence is never said as a refusal. */
export function refusalCause(e) {
  const c = refusalClass(e);
  if (c === 'refused') return `${refusalWords(e)} stands there`;
  if (c === 'absent') return 'nothing stands there';
  return refusalWords(e);
}
/** The outcome of a required input refused or absent: the node it feeds is not started (A-30). */
export const REQUIRED_NOT_STARTED = 'not started (a required input)';

/**
 * The bound on one file that leaves the machine whole, 8 MiB (ARCHITECTURE A-30): held HERE, by the owner's whole-file
 * read (G-8 of 20261112-073408-hl-remediation-5-review), and re-exported by io/egress-read.mjs for its callers.
 */
export const EGRESS_MAX_FILE_BYTES = 8 * 1024 * 1024;

/** The refusal of a file over the bound on what leaves the machine, with its size (`atLeast`: what a bounded read saw). */
export function tooLargeRefused(where, size, max, atLeast = false) {
  return Object.assign(new Error(`confined path refused: ${where} — ${atLeast ? 'at least ' : ''}${size} bytes, over the ${max}-byte bound on a file that leaves the machine`),
    { code: 'ECONFINED', path: where, refusal: 'too-large', size });
}

/**
 * The owner for one root: `read(segments, encoding, { maxBytes })`, `readBounded(segments, max)`,
 * `readLines(segments, onLine, opts)` and `stat(segments)`, each refusing what `confined` refuses and a regular file with
 * more than one name; `read` also refuses a file over `maxBytes` (EGRESS_MAX_FILE_BYTES by default).
 */
export function egress({ root, io }) {
  const own = confined({ root, io });
  const where = (segments) => path.join(root, ...segments.map(String));
  const guard = (segments) => {
    const st = own.stat(segments);
    if (hardLinkReason(st)) throw hardLinkRefused(where(segments), st);
    return st;
  };
  return {
    root,
    stat: guard,
    // BOUNDED AT THE OWNER (G-8 of 20261112-073408-hl-remediation-5-review; G-9 its symptom): the whole-file read had no
    // limit, so a caller that sent its content (the adjudication excerpt, a decision's request) bypassed A-30's 8 MiB
    // bound. Refused by the stat's size before the read, and by the bytes read after, never more than one past the bound.
    read(segments, encoding = 'utf8', { maxBytes = EGRESS_MAX_FILE_BYTES } = {}) {
      const st = guard(segments);
      if (st && typeof st.isFile === 'function' && st.isFile() && Number(st.size) > maxBytes) {
        throw tooLargeRefused(where(segments), Number(st.size), maxBytes);
      }
      // THE READ ITSELF IS BOUNDED (G-9 of 20261112-154323-hl-review-c): confined's whole-file read held a file that grew
      // between the stat and the read in full before the length check refused it. readBounded reads at most one byte past
      // the bound, so the check after it refuses a grown file having held no more than that. A platform with no descriptor
      // reads (a test's fake filesystem that serves only readFileSync) keeps the whole-file read; the length check below
      // refuses alike either way.
      const bounded = typeof io?.fs?.openSync === 'function' && typeof io?.fs?.readSync === 'function';
      // NO SECOND COPY (G-4 of 20261114-231942-pbr-delivery): both reads already return a Buffer, which Buffer.from copied
      // byte for byte, up to the bound; only a fake filesystem's string is wrapped.
      const raw = bounded ? own.readBounded(segments, maxBytes) : own.read(segments, null);
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (buf.length > maxBytes) throw tooLargeRefused(where(segments), buf.length, maxBytes, true);
      return encoding ? buf.toString(encoding) : buf;
    },
    /** The file's bytes, at most `max + 1` of them (readAtMost): a result longer than `max` is the caller's refusal. */
    // Through confined's own bounded read (the confined read and write censuses): a descriptor opened here, on a joined
    // path, was a raw open beside the owner.
    readBounded(segments, max) { guard(segments); return own.readBounded(segments, max); },
    readLines(segments, onLine, opts) { guard(segments); return own.readLines(segments, onLine, opts); },
  };
}
