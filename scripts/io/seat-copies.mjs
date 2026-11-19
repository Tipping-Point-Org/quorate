// THE COPIES A NODE-RUNTIME CALL OF THE DECISION PANEL STANDS AMONG (decision-panel-seats.plan.md stage 1; operator,
// 2026-11-09: "A. Copy cited files in (Recommended)"). The seat and the revote note's author each run in an empty
// directory of their own under the engine's home, outside the repository, and the runtime's CLI refuses a Read outside
// its working directory (<TEMP>\dps-stage1-live.txt, the design's "DP-D4, measured"). So every path the call's work
// context names is copied into that directory at the same repository-relative path, and the relative path it is sent
// resolves there. Paths, not contents, are what the prompt carries; the copy is what the model may open.
//
// BOTH SIDES THROUGH AN OWNER (ARCHITECTURE A-30): each file is read through the egress owner (`confined` plus a file's link count) rooted at the repository, so a
// link or junction at any level, the file included, is refused, as is any name that is not a safe single segment (`..`,
// an absolute spelling, a drive); and written through the caller's owner of the engine's home, an exclusive create in
// directories it made and checked. A refused path is named with why and not copied; a path with nothing at it (a changed
// file git lists as deleted) is named as missing.
import { egress, EGRESS_MAX_FILE_BYTES } from './egress-read.mjs';
import { redactionPatterns } from '../lib/secret-shapes.mjs';

// Every shape redaction applies, a vendor token's and a named value's (`password: ...`) alike: a file that holds one is not
// copied where a cloud model may open it (G-1 of 20261109-232630-dps-delivery; G-5 of 20261110-001436-dps-remediation-review,
// where the named-value shapes were left out and a `password:` file was copied). Only files git does not track are screened,
// so a refusal of prose that merely looks like a named value costs a seat one scratch file, named, never a tracked one.
const SECRET_PATTERNS = redactionPatterns().map(([re]) => new RegExp(re.source, re.flags.replace('g', '')));

/**
 * Copy `paths` (repository-relative, as git or the contract spells them) from `repoRoot` into the directory `segs` names
 * below `owner` (a confined owner of the engine's home). `refused` are paths already refused upstream (lib
 * seatCopyPaths: evidence outside the repository), carried into the result. Returns `{copied, missing, refused}`.
 */
/** The bounds on one call's copies (G-8 of 20261109-232630-dps-delivery): a file's size, and the call's total. */
// The per-file bound is the egress owner's (G-5 of 20261112-054852-hl-remediation-3-review): one constant, no import cycle.
export const SEAT_COPY_MAX_FILE_BYTES = EGRESS_MAX_FILE_BYTES;
export const SEAT_COPY_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

// BUILT ONCE PER tracked LIST (G-4 of 20261110-010058-dps-remediation-2-review): decide.mjs passes the same `git ls-files`
// array to every seat call of every round, and the normalized set of all its paths was rebuilt for each.
// HELD ONLY WHILE THE ARRAY'S CONTENTS ARE WHAT IT WAS BUILT FROM (G-4 of 20261110-014035-dps-remediation-3-review): keyed
// by identity alone, an array changed after a first call was answered from its earlier contents. Each entry keeps a copy
// of the array it was built from and is rebuilt when an element differs; the compare is far cheaper than the rebuild.
const trackedSets = new WeakMap();
function trackedSet(tracked, caseInsensitive, fold) {
  let entry = trackedSets.get(tracked);
  // A FROZEN LIST CANNOT CHANGE, so it is not compared (G-1 of 20261110-022503-dps-remediation-4-review): the compare
  // still read every element on every call. decide.mjs freezes the list it passes; any other array is compared as before.
  // Only a list frozen when its entry was built: one frozen later may have changed in between.
  const unchanged = entry && (entry.frozen
    || (entry.from.length === tracked.length && entry.from.every((s, i) => s === tracked[i])));
  if (!unchanged) {
    entry = { from: tracked.slice(), byCase: new Map(), frozen: Object.isFrozen(tracked) };
    trackedSets.set(tracked, entry);
  }
  let set = entry.byCase.get(caseInsensitive);
  if (!set) { set = new Set(tracked.map((s) => fold(String(s).split(/[\\/]/).join('/')))); entry.byCase.set(caseInsensitive, set); }
  return set;
}

// The text screen can read only text (G-5 of 20261110-014035-dps-remediation-3-review): a binary credential, a PKCS#12
// bundle or a DER key, matches no pattern after a UTF-8 decode. A file that is not UTF-8 text, or holds a NUL, is not text.
// Returns the decoded text, or null when it is not text: the screen reads the string this decode made, rather than
// decoding the same bytes a second time (G-2 of 20261110-022503-dps-remediation-4-review).
const TEXT = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function textOf(data) {
  if (data.includes(0)) return null;
  try { return TEXT.decode(data); } catch { return null; }
}

export function copyIntoSeatDir({ repoRoot, owner, segs, paths = [], refused = [],
  maxFileBytes = SEAT_COPY_MAX_FILE_BYTES, maxTotalBytes = SEAT_COPY_MAX_TOTAL_BYTES, tracked = null, caseInsensitive = false }) {
  // THROUGH THE EGRESS OWNER (hardlink-egress.plan.md stage 2): what `confined` refuses, and a file with a second name,
  // whose content may be another file's (G-3 of 20261111-235524-runtime-bin-remediation-5-review: a tracked file skips the
  // credential screen, so a hard link to anything the operator can read went to every seat's vendor).
  const from = egress(repoRoot);
  // EVERY FILE GIT DOES NOT TRACK IS SCREENED (G-1; G-2 and G-7 of 20261110-001436-dps-remediation-review): a file nobody
  // committed, a scratch credentials file among them, is what the seat's vendor may read. The screen was a list of the
  // untracked files git does not ignore, so an IGNORED file a question cited (`.env`) was never on it, and on a
  // case-insensitive file system a cited spelling cased unlike git's missed it and the same file was copied unscreened.
  // So the test is inverted: a path is passed unscreened only when it is one git tracks (`tracked`, as `git ls-files`
  // spells them), compared case-folded where the file system folds case; anything else, and everything when `tracked`
  // is not given, is screened. Tracked files are not: they are already in the repository the arms read.
  const fold = (s) => (caseInsensitive ? s.toLowerCase() : s);
  const known = trackedSet(tracked ?? [], caseInsensitive, fold);
  const isTracked = (rel) => tracked !== null && known.has(fold(rel.join('/')));
  const out = { copied: [], missing: [], refused: [...refused] };
  let total = 0;
  for (const p of paths) {
    // Split on either separator and keep every piece, so an absolute or `..` spelling reaches the owner's check whole.
    const rel = String(p).split(/[\\/]/);
    let data;
    try {
      // BOUNDED BEFORE IT IS READ (G-8): every cited file was read whole and copied for every seat and round, with no
      // limit. Its size is asked first, through the same owner, and one over a bound is refused, named, and never read.
      const size = from.stat(rel).size;
      if (size > maxFileBytes) { out.refused.push({ path: p, why: `${size} bytes, over the ${maxFileBytes}-byte bound on one seat copy` }); continue; }
      if (total + size > maxTotalBytes) { out.refused.push({ path: p, why: `would take this call's copies past their ${maxTotalBytes}-byte total` }); continue; }
      // No further than one byte past the per-file bound (G-9 of 20261112-063354-hl-remediation-4-review), so a file that
      // grew after its stat is refused below without being held whole.
      data = from.readBounded(rel, Math.min(maxFileBytes, maxTotalBytes - total));
    } catch (e) {
      if (e?.code === 'ENOENT') { out.missing.push(p); continue; }
      if (e?.code === 'ECONFINED') {
        out.refused.push({ path: p, why: e.refusal === 'link' ? 'a link or junction stands on its path; nothing is copied through one'
          : e.refusal === 'hard-link' ? `a hard link (${e.nlink} names point at this file), so its content may be another file's; it is not copied where the seat's vendor may read it`
          : e.message });
        continue;
      }
      throw e;
    }
    // THE BOUNDS HOLD ON WHAT WAS READ, not only on what stat said before it (G-6 of 20261110-001436-dps-remediation-review):
    // a file that grew between the two is refused here, as one over the bound at stat would have been.
    if (data.length > maxFileBytes) { out.refused.push({ path: p, why: `${data.length} bytes, over the ${maxFileBytes}-byte bound on one seat copy` }); continue; }
    if (total + data.length > maxTotalBytes) { out.refused.push({ path: p, why: `would take this call's copies past their ${maxTotalBytes}-byte total` }); continue; }
    if (!isTracked(rel)) {
      const text = textOf(data);
      if (text === null) {
        out.refused.push({ path: p, why: 'a file git does not track that is not text: the credential screen reads only text, so it is not copied where the seat\'s vendor may read it' });
        continue;
      }
      if (SECRET_PATTERNS.some((re) => re.test(text))) {
        out.refused.push({ path: p, why: 'a file git does not track, holding what looks like a credential: it is not copied where the seat\'s vendor may read it' });
        continue;
      }
    }
    // Counted only once the copy is made (G-6): a refused credential file no longer spends the total a clean one needs.
    total += data.length;
    owner.create([...segs, ...rel], data);
    out.copied.push(p);
  }
  return out;
}
