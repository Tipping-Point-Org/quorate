// THE RULES BEHIND WALKING, HASHING AND WRITING THE TREE — pure, and OS-agnostic, so they live in lib/
// (G-7 of 20260925-015614-platform-review, by the operator's rule of 2026-09-25: pure logic moves out
// of lib/ only when it is OS-specific, or for a reason other than the move itself).
//
// Stage 4 moved glob-walk, intent-cache, atomic and worktree out of lib/ wholesale, and these rules
// travelled with the I/O. The io/ modules now do only the reading and writing, and ask here what to
// read, in what order, and how to name what they write. Two of these were also duplicated — the skip
// set lived inline in glob-walk and again as SKIP_DIRS in worktree — and each has one owner now.

/** Directories no walk descends into: dependency trees and git's own store. ONE owner. */
const SKIPPED_DIRS = Object.freeze(['node_modules', '.git']);
export const isSkippedDir = (name) => SKIPPED_DIRS.includes(name);

// globWalkRoot lived here ("which directory do I read"), deliberately apart from lib/locate's globDirPrefix ("what
// prefix does this glob cover"). The two questions stay different, and both are now answered from one parse, as
// lib/contract-glob.mjs's walkRoot and coverPrefix (contract-glob-grammar stage 3).

/** A link enters a digest as its TARGET, never followed: what it points at is not its content. */
export const linkBody = (target) => `symlink:${target}`;

/**
 * Feed `entries` ([{ rel, body }]) into `hash` in relative-path order, framed `rel NUL body NUL`.
 * The order and framing ARE the cache key: change either and every existing entry stops matching.
 * `rel` is forward-slashed by the caller, so the key is the same on every operating system.
 */
export function digestInputs(hash, entries) {
  for (const e of [...entries].sort((a, b) => a.rel.localeCompare(b.rel))) {
    // A body may be a FUNCTION, read only when its turn comes (G-8): peak memory is then one file,
    // not the whole input set. A null body is left out entirely, path included.
    const body = typeof e.body === 'function' ? e.body() : e.body;
    if (body == null) continue;
    hash.update(e.rel);
    hash.update('\0');
    hash.update(body);
    hash.update('\0');
  }
  return hash;
}

/**
 * Which inputs make up the intent cache key: every declared doc glob and doc role, plus the request
 * and the node's instructions. The walk that expands them is io/intent-cache's; WHAT is keyed is this.
 */
export function intentInputSpec({ docPaths = [], docRoles = {}, requestPath = null, skillPath = null } = {}) {
  const roles = Object.values(docRoles ?? {}).map((r) => String(r ?? '').trim()).filter(Boolean);
  return {
    globs: [...(docPaths ?? []), ...roles],
    files: [requestPath, skillPath].filter(Boolean),
  };
}

// ---------------------------------------------------------------- atomic writes
export const RENAME_ATTEMPTS = 20;
export const RENAME_BACKOFF_MS = 5;

/**
 * The scratch name a durable write uses beside `p`: unique per process and per call, so two writers
 * to one target never share one. `pid` and `rand` are passed in — lib/ reads neither.
 */
export function tempNameFor(p, { pid, rand }) {
  if (!Number.isInteger(pid)) throw new Error('tempNameFor: pid is required — lib/ does not read the process');
  if (typeof rand !== 'string' || !rand) throw new Error('tempNameFor: rand is required');
  return `${p}.${pid}.${rand}.tmp`;
}

/**
 * Whether a failed rename is worth another attempt, and how long to wait first. Only the platform's
 * transient codes (a scanner briefly holding the file, on Windows) are retried, and never forever.
 */
export function renameRetry({ code, attempt, transientCodes }) {
  const retry = transientCodes.has(code) && attempt < RENAME_ATTEMPTS;
  return { retry, waitMs: retry ? RENAME_BACKOFF_MS * attempt : 0 };
}
