// lib/egress-read.mjs, BOUND TO THIS HOST (hardlink-egress.plan.md stage 1): the egress owner with the platform's
// filesystem, and the two forms its callers need, a file below a root they own and a single file a caller named.
import path from 'node:path';
// fstat, which the platform's filesystem does not offer: egressReadDeclared checks the descriptor it reads.
import nodeFs from 'node:fs';
import * as pure from '../lib/egress-read.mjs';
import { hostPlatform } from '../platform/index.mjs';

export {
  hardLinkReason, hardLinkRefused, refusalWords, refusalClass, refusedOrAbsent, refusalCause, REQUIRED_NOT_STARTED,
} from '../lib/egress-read.mjs';

/**
 * The bound on one file that leaves the machine whole, 8 MiB: held by the owner (G-5 of
 * 20261112-054852-hl-remediation-3-review; in lib/egress-read.mjs since G-8 of 20261112-073408-hl-remediation-5-review,
 * where the owner's whole-file read applies it), re-exported here and taken from here by the seat copy
 * (io/seat-copies.mjs SEAT_COPY_MAX_FILE_BYTES), so the one constant has no import cycle.
 */
export const EGRESS_MAX_FILE_BYTES = pure.EGRESS_MAX_FILE_BYTES;
const SEAT_COPY_MAX_FILE_BYTES = EGRESS_MAX_FILE_BYTES;

/** The egress owner for an admitted root (a repository, a run directory, a check directory). */
export const egress = (root, opts = {}) => pure.egress({ root, io: opts.io ?? hostPlatform() });

/**
 * THE ONE ENTRY FOR A RUN FILE WHOSE CONTENT REACHES A PROMPT (prompt-bound-run-reads.plan.md stage 1; operator,
 * 2026-11-14: "One owner for prompt-bound run reads (Recommended)"). A run's own files are read through the run owner
 * (`confined`), which refuses a link but cannot see a hard link; several of them fed a vendor's or a judge's prompt, and
 * three reviews running found them one or two at a time. This is the egress owner rooted at the admitted run directory:
 * a link or junction at any level below the run, a file with a second name, and a file over EGRESS_MAX_FILE_BYTES are
 * refused, each with its path and reason, in `confined`'s refusal shape, so a site's existing catch reports it.
 * `read(p, encoding)` takes a path below the run (absolute, or segments). The run directory itself is the caller's to
 * admit (admitRun); this owner only reads below it.
 */
export function egressRunReader(runDir, opts = {}) {
  const root = path.resolve(String(runDir));
  const own = egress(root, opts);
  const segmentsOf = (p) => {
    if (Array.isArray(p)) return p.map(String);
    const rel = path.relative(root, path.resolve(String(p)));
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw Object.assign(new Error(`confined path refused: ${p} — not below the run ${root}`), { code: 'ECONFINED', path: String(p), refusal: 'outside' });
    }
    return rel.split(path.sep);
  };
  return { root, read: (p, encoding = 'utf8') => own.read(segmentsOf(p), encoding) };
}

/**
 * The owner's root and the file's segments below it (hardlink-egress.plan.md, amended in delivery; G-6 of
 * 20261112-050334-hl-review-b): a path inside `repoRoot` is checked from the repository root, so a link or junction in any
 * of its folders is refused; a path outside it (a temporary prompt file), or any path when no repository is given, from
 * its own folder, as before.
 */
export function egressRootOf(abs, repoRoot = null) {
  if (repoRoot) {
    const root = path.resolve(String(repoRoot));
    const rel = path.relative(root, abs);
    if (rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) return { root, segments: rel.split(path.sep) };
  }
  return { root: path.dirname(abs), segments: [path.basename(abs)] };
}

/**
 * One file a caller named on its command line (a prompt file, a question, a draft), read whole through the owner rooted
 * as egressRootOf says: the file itself must be a plain file with one name, never a link, and no larger than the seat
 * copy's per-file bound (SEAT_COPY_MAX_FILE_BYTES, 8 MiB, the one constant both read; G-6 of 20261112-050334-hl-review-b),
 * refused with its size before it is read. `opts.repoRoot` is the caller's repository. Throws the owner's refusal, or the
 * read's own error (ENOENT among them).
 */
export function egressReadFile(file, encoding = 'utf8', opts = {}) {
  const abs = path.resolve(String(file));
  const { root, segments } = egressRootOf(abs, opts.repoRoot);
  const own = egress(root, opts);
  const st = own.stat(segments);
  const max = opts.maxBytes ?? SEAT_COPY_MAX_FILE_BYTES;
  if (st && typeof st.isFile === 'function' && st.isFile() && Number(st.size) > max) throw tooLarge(abs, Number(st.size), max);
  // AND WHAT WAS READ (G-6 of 20261112-054852-hl-remediation-3-review): a file that grew between the stat and the read is
  // refused by the bytes actually read. THE READ ITSELF IS BOUNDED (G-7 of 20261112-063354-hl-remediation-4-review): no
  // more than one byte past the bound is read, so a file that grew is refused without ever being held whole.
  const buf = own.readBounded(segments, max);
  if (buf.length > max) throw tooLarge(abs, buf.length, max, true);
  return encoding ? buf.toString(encoding) : buf;
}

/** The refusal of a file over the bound on what leaves the machine, with its size (`atLeast`: what a bounded read saw). */
function tooLarge(abs, size, max, atLeast = false) {
  return pure.tooLargeRefused(abs, size, max, atLeast);
}

/**
 * The same, for a file read line by line (lib/confined-path.mjs readLines), so a large file is never held whole: rooted
 * as egressRootOf says, and not size-bound (a transcript is read a line at a time).
 */
export function egressReadLines(file, onLine, readOpts = undefined, opts = {}) {
  const abs = path.resolve(String(file));
  const { root, segments } = egressRootOf(abs, opts.repoRoot);
  return egress(root, opts).readLines(segments, onLine, readOpts);
}

/**
 * Why a document bound for the intent sandbox may not go, or null: the hard-link half of the owner's rule for a site
 * that keeps its own rule for declared links (io/doc-snapshot.mjs), so the file is stat'ed as the link leads.
 */
export function hardLinkWhyAt(file, opts = {}) {
  const fs = (opts.io ?? hostPlatform()).fs;
  let st;
  // FAILS CLOSED (G-9 of 20261112-035452-hl-delivery): a stat that fails is no evidence of one name, so it is a refusal.
  try { st = fs.statSync(file); } catch (e) {
    return `a file whose link count could not be read (${e?.code ?? e?.message ?? 'stat failed'}), so it is not known to have one name`;
  }
  return pure.hardLinkReason(st, file);
}

/**
 * A document bound for the intent sandbox, read whole from ONE descriptor whose link count is checked (G-5 of
 * 20261112-050334-hl-review-b): the site keeps its own rule for declared links (io/doc-snapshot.mjs), so the file is opened
 * as the link leads, and its `nlink` comes from fstat of that open file, not from a stat before a separate copy. Returns
 * the content as a Buffer, or throws `hardLinkRefused` for a file with a second name; a failing open, fstat or read throws
 * (fails closed, as hardLinkWhyAt does). `opts.fs` replaces the filesystem in a test.
 */
export function egressReadDeclared(file, opts = {}) {
  const fs = opts.fs ?? nodeFs;
  // BOUNDED (G-8 of 20261112-054852-hl-remediation-3-review): a declared document is held whole, so one over the bound on
  // a file that leaves the machine is refused by its size before it is read, and by the bytes read after.
  const max = opts.maxBytes ?? SEAT_COPY_MAX_FILE_BYTES;
  const fd = fs.openSync(file, 'r');
  try {
    const st = fs.fstatSync(fd);
    if (pure.hardLinkReason(st, file)) throw pure.hardLinkRefused(String(file), st);
    if (Number(st.size) > max) throw tooLarge(String(file), Number(st.size), max);
    // Read no further than one byte past the bound (G-8 of 20261112-063354-hl-remediation-4-review), so a document that
    // grew after the fstat is refused without being held whole.
    const content = pure.readAtMost(fs, fd, max);
    if (content.length > max) throw tooLarge(String(file), content.length, max, true);
    return content;
  } finally {
    fs.closeSync(fd);
  }
}
