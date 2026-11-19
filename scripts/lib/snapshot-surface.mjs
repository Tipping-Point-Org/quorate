// Which entries of a working-state snapshot the external arms may be shown (.claude/requests/
// arms-read-surface.md, step 2 of its named design, as the plan records it).
//
// The arms' directory is built from a snapshot of the working state — tracked files with their
// uncommitted changes, plus untracked files not ignored — and git itself puts outside content into
// that snapshot. Measured on Windows in the plan's Stage 0: `git add -A` walks THROUGH a junction and
// stores the file behind it as an ordinary blob, and a hard link to an outside file is stored as that
// file's bytes. Nothing downstream can tell those blobs from the repository's own, so this is the
// check that stands between them and a third-party reviewer's cloud.
//
// LEAVE OUT AND NAME, never refuse the snapshot (operator, 2026-09-26: "leave out and name"). One entry
// carrying nothing usable would otherwise cost every run its panel. A symlink entry is left out too:
// written as text it tells the arm only a path — possibly one naming a directory outside the
// repository — which is no more use to a review than its absence ("admit it as text: is as useful as
// ignoring the file").
//
// Pure: the caller supplies each entry's facts. Ids and counts arrive as STRINGS because an NTFS inode
// number exceeds a JavaScript number's exact range (Stage 0 measured 85568392920360010), and a rounded
// inode would group two different files as one.
import { isWithin } from './finding-scope.mjs';
import { contractNumber } from './check-timeout.mjs';

export const SYMLINK_MODE = '120000';
const REGULAR_MODES = new Set(['100644', '100755']);

/**
 * Why a git step of the snapshot builder failed, in a bounded line that keeps GIT'S OWN ERROR (20261001-205530
 * m0-pending-claims-review). The builder kept the first 300 characters of stderr, and git prints a `warning:` per file it
 * converts before its `error:`/`fatal:` lines — so `git add -A` failed twice in the suite with only three line-ending
 * warnings recorded and the cause cut off. Warnings are dropped and counted; the remaining lines are kept, bounded.
 */
export function gitFailureWhy(args, status, stderr) {
  const lines = String(stderr ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const warnings = lines.filter((l) => /^warning:/i.test(l));
  const rest = lines.filter((l) => !/^warning:/i.test(l));
  const shown = (rest.length ? rest : warnings).join(' | ').slice(0, 500);
  const omitted = rest.length && warnings.length ? ` (${warnings.length} warning(s) omitted)` : '';
  return `git ${args.slice(0, 3).join(' ')} exited ${status}: ${shown}${omitted}`;
}

/**
 * Did `git add -A` fail because a file VANISHED while git indexed the working tree? Measured 2026-10-01: with untracked
 * files being created and deleted under the repository, every build failed with `unable to index file … fatal: adding
 * files failed` (exit 128) — the arms-snapshot test's two suite failures, and the same exposure for a real review whose
 * working tree changes while its snapshot is built. Such a failure is worth retrying from a fresh index: the tree moved,
 * and a later attempt captures it as it then is. Any other failure is not.
 */
export const vanishedDuringAdd = (why) => /^git add\b/.test(String(why))
  && /unable to index file|No such file or directory|unable to stat/i.test(String(why));

/** How many times the builder tries `read-tree` + `add` before it fails closed on a tree that keeps moving. */
export const ADD_ATTEMPTS = 3;

export const PANEL_SNAPSHOT_DEFAULT_MB = 1024;

/**
 * The snapshot's size cap in bytes, from `review.panel_snapshot_max_mb` (operator, 2026-09-27: "B with
 * 1024 MB default"): ABSENT is 1024 MB, "" is uncapped (null) by declaration, a number is that many
 * megabytes — the convention `preflight_cache_max_mb` uses. The cap bounds the working state's changed
 * and untracked files, the guard against a linked directory leading to a large tree outside the
 * repository; over it, the arms' directory is not built and the run has no external panel.
 * @returns {bigint|null}
 */
export function panelSnapshotMaxBytes(contract = {}) {
  const review = contract?.review ?? {};
  if (!Object.hasOwn(review, 'panel_snapshot_max_mb')) return BigInt(PANEL_SNAPSHOT_DEFAULT_MB) * 1024n * 1024n;
  const v = review.panel_snapshot_max_mb;
  if (v === '') return null;
  // ONLY A NUMBER, OR ITS PLAIN DECIMAL TEXT (G-9 of 20260927-153422-ars-r4): `null` was read as uncapped,
  // and `Number()` made 1 MB of `true` and 2 MB of `[2]` — a declaration the key does not allow, obeyed. The grammar is
  // contractNumber's, its one owner (G-6 of 20261030-153323-ciss-s7-remediation-2-review).
  const n = contractNumber(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`review.panel_snapshot_max_mb must be a positive number of megabytes, or "" for uncapped — got ${JSON.stringify(v)}`);
  }
  return BigInt(Math.floor(n * 1024 * 1024));
}

/**
 * @param {{ realRepoRoot: string, entries: Array<{ path: string, mode: string, real: string|null,
 *   dev: string, ino: string, nlink: string }>}} args — `real` is the entry's resolved real path in the
 *   working tree, or null when it could not be resolved. `excludedRealRoots` (optional): real paths of
 *   the directories excluded from what the arms see; an entry whose real location is inside one is
 *   left out too.
 * @returns {{ admitted: string[], withheld: Array<{ path: string, why: string }> }}
 */
export function judgeSnapshotEntries({ realRepoRoot, entries, excludedRealRoots = [] }) {
  for (const e of entries) {
    for (const k of ['dev', 'ino', 'nlink']) {
      if (typeof e[k] !== 'string') throw new TypeError(`judgeSnapshotEntries: ${e.path}: ${k} must be a string (a bigint rendered as text), got ${typeof e[k]}`);
    }
  }
  const withheld = new Map();
  const groups = new Map();   // "dev:ino" -> { nlink, paths }
  for (const e of entries) {
    if (e.mode === SYMLINK_MODE) { withheld.set(e.path, 'a symbolic link: its text is only a path, possibly one outside the repository, and nothing a review can use'); continue; }
    if (!e.real) { withheld.set(e.path, 'its real location could not be resolved, so it is not assumed to be inside the repository'); continue; }
    if (!isWithin(realRepoRoot, e.real)) { withheld.set(e.path, `is really ${e.real}, outside the repository (reached through a linked directory)`); continue; }
    // Inside the repository but inside an EXCLUDED root — a run's own artifacts reached through a link
    // (G-14b of 20260927-012913-arms-read-surface). The exclusion is about what the arms may see, not
    // about how a path is spelled.
    const inExcluded = excludedRealRoots.find((root) => isWithin(root, e.real));
    if (inExcluded) { withheld.set(e.path, `is really ${e.real}, inside ${inExcluded}, which is excluded from what the arms see`); continue; }
    // REGULAR FILES ONLY (G-5 of 20260927-021924-ars-r1). A submodule entry (160000) is a DIRECTORY, and
    // a directory's link count on POSIX is 2 or more — not a hard link. Treated as one, every submodule
    // was left out and the arm's `git diff <base>` showed it deleted.
    if (REGULAR_MODES.has(e.mode) && BigInt(e.nlink) > 1n) {
      const key = `${e.dev}:${e.ino}`;
      if (!groups.has(key)) groups.set(key, { nlink: BigInt(e.nlink), paths: [] });
      groups.get(key).paths.push(e.path);
    }
  }
  for (const g of groups.values()) {
    if (BigInt(g.paths.length) >= g.nlink) continue;
    for (const p of g.paths) withheld.set(p, `a hard link with ${g.paths.length} of ${g.nlink} links in the snapshot — the others may be outside the repository`);
  }
  return {
    admitted: entries.map((e) => e.path).filter((p) => !withheld.has(p)),
    withheld: [...withheld].map(([p, why]) => ({ path: p, why })),
  };
}
