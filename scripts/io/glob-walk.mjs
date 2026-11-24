// glob-walk.mjs — expand ONE contract glob into concrete files, safely.
//
// EXTRACTED FROM intent-cache.mjs, unchanged, because a second consumer arrived. The pre-flight
// cache has to answer the same question the intent cache does — "which files does this declared
// glob actually name?" — and writing a second walker beside this one would have been the defect
// this repository keeps paying for: two owners of one fact, drifting until they disagree about what
// a contract glob means.
//
// The three comments below are not decoration. Each records a defect that reached a run, and they
// travel with the function so a future reader cannot re-introduce one by rewriting the walk:
//
//   G-17  THE PATTERN IS APPLIED, not just its base directory.
//   G-19  lstat and a visited set of REAL paths — a directory link took run creation down.
//   G-25  PRUNED DURING THE WALK, not filtered after it.

// MOVED OUT OF lib/ (os-platform-adapters stage 4): this module exists to do I/O, and lib/ does none.
// It reaches the filesystem through the platform layer, resolved at call time — see hostFs.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostFs as fs } from '../platform/index.mjs';
import { isWithin } from '../lib/finding-scope.mjs';
import { isSkippedDir, digestInputs, linkBody } from '../lib/walk-rules.mjs';
import { walkRoot, matchesGlob, validateGlob } from '../lib/contract-glob.mjs';

/**
 * Expand one glob entry into concrete files.
 *
 * THE PATTERN IS APPLIED, not just its base directory (G-17). This derived the directory before a
 * glob's first wildcard and then walked EVERY file beneath it, matching or not — so `**\/*.md`
 * resolved to a base of `.` and hashed the entire repository: every script, every test, every
 * bench artifact.
 *
 * That is not merely slow. The caller promises the hash covers "exactly the inputs X reads", and
 * this made it cover the whole tree — so the pinned result was invalidated by any source edit, and
 * a cache that exists to keep something STABLE was reset by changes to the code being judged
 * against it. The failure is silent and looks like nothing: a fresh derivation, twelve minutes, no
 * message.
 *
 * The matcher is lib/contract-glob.mjs's `matchesGlob`, the one every reader of a contract glob uses. This comment
 * said the matcher here was "the same one scope derivation uses" while scope derivation compiled its own (new-run's
 * globToRe); a second matcher is a second vocabulary, and the two did disagree about what a contract glob means.
 */
export function expandGlob(repoRoot, pattern, prune = () => false) {
  const clean = String(pattern ?? '').trim();
  if (!clean) return [];
  // WHERE TO START and WHAT MATCHES are the grammar's, and live in lib/contract-glob.mjs (contract-glob-grammar stage 3):
  // this module only reads. A glob outside the grammar is refused here too — new-run and preflight refuse such a
  // contract first; this is the backstop, and the hash callers treat the throw as unproven freshness.
  const why = validateGlob(clean);
  if (why) throw new Error(`the glob ${JSON.stringify(clean)} is refused: ${why}`);
  const root = walkRoot(clean);
  const abs = path.resolve(repoRoot, root.base || '.');
  // A CONTRACT GLOB NAMES FILES IN THE REPOSITORY (G-7 of 20260925-200721-platform-remediated): a root that resolves
  // outside it — `../x/**`, or an absolute path — walked and hashed a tree that is not the project's. REFUSED, not
  // dropped (G-22 of 20260929-225147-m0-gate-review): returning nothing left it out of the pre-flight and intent hashes,
  // so an edit there kept a cached result looking fresh. new-run and preflight refuse such a contract up front
  // (contractGlobErrors, lib/contract-glob.mjs); this throw is the backstop, and the hash callers treat it as unproven freshness.
  if (!isWithin(path.resolve(repoRoot), abs)) {
    throw new Error(`the glob ${JSON.stringify(clean)} walks from outside the repository; a contract glob names files in the project`);
  }
  const out = [];
  // lstat, and a visited set of REAL paths — the rule lib/worktree.mjs walks by for links, and for the
  // same reason. NOT its rule for an entry that cannot be read: worktree records one, this walk skips it, because it
  // selects files and guards no boundary (link-leaving-owner.plan.md stage 4, design LL-D3). statSync FOLLOWS directory links, so a declared tree containing a link to an
  // ancestor recursed until the stack died and took run CREATION down with it (G-19). A link is
  // recorded as the file it is and never traversed; two routes to one directory are walked once.
  const visited = new Set();
  const walk = (p) => {
    let st;
    try { st = fs.lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) { out.push(p); return; }
    if (st.isFile()) { out.push(p); return; }
    if (!st.isDirectory()) return;
    let real;
    try { real = fs.realpathSync(p); } catch { return; }
    if (visited.has(real)) return;
    visited.add(real);
    let entries;
    try { entries = fs.readdirSync(p); } catch { return; }
    for (const e of entries.sort()) {
      if (isSkippedDir(e)) continue;   // the one owner of the skip set, shared with worktree (G-7)
      // PRUNED DURING THE WALK, not filtered after it (G-25, perf-audit). The comment here used to
      // say "a run directory is generated output, never an input" — and named only node_modules and
      // .git, while reviewsDir was removed from the FINISHED list by the caller. So an entry whose
      // first wildcard sits at or above a generated tree — `**/*.md` resolves its base to the
      // repository root — lstat'd every file under `.claude/reviews/**`, which accumulates a
      // directory per run holding per-node output capped at 64 MiB. Excluded from the hash and
      // walked anyway is the worst of both: the cost with none of the benefit.
      const child = path.join(p, e);
      if (prune(child)) continue;
      walk(child);
    }
  };
  walk(abs);
  // A pattern with no wildcard is a literal path or a directory, and everything under it was
  // declared by naming it — nothing to filter. Only a glob narrows its own subtree.
  if (!root.wildcard) return out;
  return out.filter((f) => matchesGlob(clean, path.relative(repoRoot, f)));
}

/**
 * Hash a set of files by repo-relative PATH and content, in sorted order.
 *
 * Stable across machines and independent of directory-listing order, which is what lets a cache
 * entry written on one checkout be compared against another. Shared by the intent cache and the
 * pre-flight cache so the two cannot disagree about what "the same inputs" means.
 *
 * Name AND content: a file that moves is a different input even if its bytes are identical.
 *
 * A link is hashed as WHERE IT POINTS, never by dereferencing it. Reading through the link would
 * fold a file outside the declared set into the hash that decides whether a result may be reused
 * (G-27's sibling).
 */
export function hashFiles(hash, repoRoot, files) {
  // This function READS; the order and framing that make the key are digestInputs's (G-7), and how a
  // link is represented is linkBody's. A file that is GONE (ENOENT, ENOTDIR) is left out, as before; one that stands and
  // cannot be read gets a body no other digest shares (G-4 of 20261122-014737-m3s7-b2-review-2): left out, it hashed as
  // absent, and a cached result was reused for an input set whose unreadable member could have changed. An input that
  // cannot be read cannot be shown unchanged, so its digest matches no stored result.
  const rel = (f) => path.relative(repoRoot, f).split(path.sep).join('/');
  // One file in memory at a time (G-8): each body is read when digestInputs reaches it, not up front.
  const read = (f) => {
    try {
      const st = fs.lstatSync(f);
      return st.isSymbolicLink() ? Buffer.from(linkBody(fs.readlinkSync(f))) : fs.readFileSync(f);
    } catch (e) {
      if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return null;
      return Buffer.from(`unreadable ${e?.code ?? 'error'} ${randomUUID()}`);
    }
  };
  return digestInputs(hash, [...files].map((f) => ({ rel: rel(f), body: () => read(f) })));
}
