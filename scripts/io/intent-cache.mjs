// Intent pinning: derive the criteria ONCE per distinct set of inputs, then reuse them.
//
// Why this exists. intent-capture derives numbered criteria from the declared documents inside the
// Rule 2 sandbox. It is a model call, so it is not deterministic — three consecutive runs over the
// SAME documents produced 56, then 49, then 38 criteria, with three different hashes. That is a
// 32% swing in the bar the code is judged against, which makes two runs of identical code
// incomparable: contract-audit's FAIL or PASS is measured against criteria that moved for reasons
// having nothing to do with the code. A verification loop whose yardstick is re-drawn every run
// cannot tell "the fix landed" from "the criteria changed".
//
// The fix is to key the derived intent on a hash of exactly the inputs that produced it. Same
// inputs => reuse, and the run records WHICH run first derived them. Change any declared document,
// the request, or the intent-capture skill itself, and the hash moves and the criteria are derived
// again. This is deliberately NOT a cache for speed (though it does save the intent node's ~12
// minutes); it is what makes the bar stable enough to verify against.
//
// The residual, named rather than hidden: the hash covers the declared documents, the request and
// the skill. An input that is none of those — a change in model, or in the framework version that
// renders the criteria — does not move the hash. `intent_reused_from` in run.json is the thread to
// pull when a reused intent looks wrong, and --fresh-intent forces re-derivation.

// MOVED OUT OF lib/ (os-platform-adapters stage 4): this module exists to do I/O, and lib/ does none.
// It reaches the filesystem through the platform layer, resolved at call time — see hostFs.
import path from 'node:path';
import { hostFs as fs } from '../platform/index.mjs';
import crypto from 'node:crypto';
import { expandGlob, hashFiles } from './glob-walk.mjs';
import { writeJsonAtomic } from './atomic.mjs';
import { redactTree } from '../lib/redact.mjs';
import { intentInputSpec } from '../lib/walk-rules.mjs';
import { isWithin } from './finding-scope.mjs';

// THE WALK LIVES IN glob-walk.mjs. It was here, and the pre-flight cache needed the same question
// answered -- "which files does this declared glob actually name?" -- so it moved rather than being
// copied. Three defects are recorded in its comments (G-17, G-19, G-25) and they belong with the
// code that can re-introduce them, not with one of two callers.

/**
 * Hash exactly the inputs intent-capture reads. Paths are recorded repo-relative and sorted, so
 * the hash is stable across machines and independent of directory-listing order.
 *
 * `reviewsDir` is excluded explicitly: run artifacts are output, and letting them in would move
 * the hash on every run.
 */
export function intentInputHash({ repoRoot, docPaths = [], docRoles = {}, requestPath = null, skillPath = null, reviewsDir = null }) {
  const h = crypto.createHash('sha256');
  const files = new Set();
  // The one exclusion the walk can apply before descending. Everything the filter below drops is
  // dropped here too; the difference is that this one never reads the tree (G-25).
  // THROUGH THE HOST-AWARE OWNER (G-9 of 20261029-212858-rdr-remediation-2-review): a local case-sensitive prefix took a
  // differently cased reviews folder's files into the hash on a case-folding filesystem.
  const reviewsAbs = reviewsDir ? path.resolve(reviewsDir) : null;
  const prune = (abs) => Boolean(reviewsAbs) && isWithin(reviewsAbs, path.resolve(abs));
  // WHAT is keyed is a rule (lib/walk-rules.mjs's intentInputSpec, G-7); expanding it is this module's.
  const spec = intentInputSpec({ docPaths, docRoles, requestPath, skillPath });
  for (const g of spec.globs) for (const f of expandGlob(repoRoot, g, prune)) files.add(f);
  for (const f of spec.files) files.add(path.resolve(repoRoot, f));

  // Sorting, link handling and the path+content update sequence live in hashFiles, shared with the
  // pre-flight cache. The digest is unchanged by the move: same files, same order, same bytes.
  return hashFiles(
    h,
    repoRoot,
    [...files].filter((f) => !prune(f)),
  ).digest('hex');
}

export const intentCachePath = (reviewsDir, hash) =>
  path.join(reviewsDir, '.intent-cache', `${hash}.json`);

/** Returns the cached entry, or null. A malformed entry is treated as absent, never as valid. */
export function readIntentCache(reviewsDir, hash) {
  try {
    const entry = JSON.parse(fs.readFileSync(intentCachePath(reviewsDir, hash), 'utf8'));
    if (typeof entry?.intent_md !== 'string' || !entry.intent_md.trim()) return null;
    return entry;
  } catch {
    return null;
  }
}

export function writeIntentCache(reviewsDir, hash, entry) {
  const p = intentCachePath(reviewsDir, hash);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // ATOMICALLY (G-9 of 20260925-015614-platform-review). It truncated and rewrote in place, so a run
  // reading while another wrote could parse half an entry — derived criteria every lens is judged by.
  // REDACTED (ledger-trust-boundaries 1b): the cache is tracked under .claude/reviews/.intent-cache/ and carries the
  // intent-capture node's text, which is model output — a tracked write like any other.
  writeJsonAtomic(p, redactTree({ schema_version: 1, input_sha256: hash, ...entry }));
  return p;
}
