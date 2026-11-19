// lib/reviews-root.mjs, BOUND TO THIS HOST (os-platform-adapters criterion 5). lib/ takes the
// environment and home directory as arguments; the orchestration scripts get them from the platform
// here, so `quorateHome()` reads as it always did at their call sites.
import * as pure from '../lib/reviews-root.mjs';
import fs from 'node:fs';   // realpathSync.native, which the platform's fs does not carry (as io/snapshot.mjs)
import path from 'node:path';
import { gitSync } from './git.mjs';
import { hostPlatform, hostFs } from '../platform/index.mjs';
import { writeTextAtomic } from './atomic.mjs';
import { readContract } from './contract-reader.mjs';
import { confined } from './confined-path.mjs';
import { isWithin, canonicalSpelling, rootSpelling } from './finding-scope.mjs';

export * from '../lib/reviews-root.mjs';

// As the filesystem spells it (lib/finding-scope.mjs canonicalSpelling): a QUORATE_HOME or home directory under an 8.3
// short name is the long one, so every path derived from the home compares equal to the real paths made under it.
// AND ON ITS REAL PATH, links above it followed (rootSpelling; ci-path-identity.plan.md stage 1c): on macOS the home under
// /var was compared with run directories resolved under /private/var.
export const quorateHome = () => rootSpelling(pure.quorateHome(hostPlatform().env(), hostPlatform().homedir()));
// The repository and the home as the filesystem spells them, so the staging key (repoKey hashes the repository's path)
// is the same however the minting command spelled it: new-run given an 8.3 short --repo-root keyed one folder and the
// remediation runner, given git's long toplevel, looked in another (CI run 43281517496).
export const defaultReviewsRoot = (opts = {}) => pure.defaultReviewsRoot({
  ...opts,
  repoRoot: spelled(opts.repoRoot),
  home: opts.home ? spelled(opts.home) : quorateHome(),
});
// A relative path is passed on as given, for lib/ to refuse by its own rule.
// On the root's real path since ci-path-identity.plan.md stage 1c, so the key is one however the root was spelled.
function spelled(p) { return typeof p === 'string' && path.isAbsolute(p.trim()) ? rootSpelling(p.trim()) : p; }
// With the disk, so a declared reviews_dir is held to its real path too (G-10 of 20261013-042240-ledger-identity-remediation-4-review).
// AND WITH THE SPELLING THE CALLER GAVE (G-3, G-4 of 20261118-131040-cpi-remediation-review): the one owner of the run-root
// list receives what callerRepoRoot remembered, so every enumeration finds what admitRun admits, not admission alone.
export const repoRunRoots = (opts = {}) => pure.repoRunRoots({ ...opts, io: opts.io ?? hostPlatform(),
  repoSpellings: [...(opts.repoSpellings ?? []), ...rememberedSpelling(opts.repoRoot)] });
function rememberedSpelling(repoRoot) {
  if (!String(repoRoot ?? '').trim() || !path.isAbsolute(String(repoRoot).trim())) return [];
  const asGiven = givenSpellings.get(spellingKey(rootSpelling(path.resolve(String(repoRoot).trim()))));
  return asGiven ? [asGiven] : [];
}
// The same list as repoRunRoots, the caller's remembered spelling included (G-3 of 20261118-131040-cpi-remediation-review).
export const runBelongsToRepo = (opts = {}) => pure.runBelongsToRepo({ ...opts, io: opts.io ?? hostPlatform(),
  repoSpellings: [...(opts.repoSpellings ?? []), ...rememberedSpelling(opts.repoRoot)] });
/**
 * The repository a command runs for, as the CALLER establishes it (ARCHITECTURE A-28): `--repo-root` when given, else
 * git's toplevel of the working directory, else null, which admitRun refuses. Never a field of a run.
 */
// As the filesystem spells it (canonicalSpelling, links kept): a --repo-root under an 8.3 short name was recorded short
// in run.json (archive_to, repo_root) and compared with the long form git and realpath report (CI run 43281517496).
const givenSpellings = new Map();
// KEYED BY THE PLATFORM'S CASE RULE (G-3 of 20261118-142344-cpi-remediation-2-review): rootSpelling keeps the last name as
// given, so the same repository asked with another casing of it, where the filesystem ignores case, missed the spelling.
const spellingKey = (p) => (hostPlatform().caseInsensitiveFs ? String(p).toLowerCase() : String(p));
export function callerRepoRoot(given) {
  // On its real path since ci-path-identity.plan.md stage 1c (rootSpelling): a --repo-root spelled through a link above
  // it keyed a staging folder no caller given the real spelling looked in.
  if (String(given ?? '').trim()) {
    const resolved = rootSpelling(path.resolve(given));
    // THE SPELLING GIVEN IS REMEMBERED (G-5 of 20261118-112631-cpi-review): repoRunRoots derives the old links-kept key
    // from what it is handed, so a run staged before stage 1c under a link-spelled --repo-root was orphaned once this
    // returned the resolved path. admitRun (below) asks that spelling's roots too.
    givenSpellings.set(spellingKey(resolved), canonicalSpelling(path.resolve(given)));
    return resolved;
  }
  const r = gitSync(['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? rootSpelling(path.resolve(r.stdout.trim())) : null;
}

/**
 * admitRun (lib), bound to this host: the platform, the engine's home, and where this repository keeps its runs read
 * from ITS OWN contract (run-dir-trust.plan.md stage 1), never from the run being admitted. A caller that already holds
 * that contract passes `project` and `declaredReviewsDir` and nothing is spawned; otherwise the one contract reader is
 * asked, and a contract that cannot be read refuses rather than guessing where the runs live.
 */
export function admitRun(opts = {}) {
  let { project, declaredReviewsDir } = opts;
  if (!opts.noRepository && String(opts.repoRoot ?? '').trim() && project === undefined) {
    const read = readContract({ repoRoot: opts.repoRoot });
    if (read.error) {
      return { ok: false, check: 'repository', why: `the contract of ${opts.repoRoot} cannot be read (${read.error}); refusing to guess where its runs live` };
    }
    project = read.contract?.project ?? null;
    declaredReviewsDir = read.contract?.review?.reviews_dir || null;
  }
  // Relative paths are resolved here, where the working directory may be read; lib/ refuses them.
  const abs = (p) => (String(p ?? '').trim() ? path.resolve(p) : p);
  const repoRoot = abs(opts.repoRoot);
  // The same lookup repoRunRoots makes (rememberedSpelling), by the platform's case rule (G-3 of
  // 20261118-142344-cpi-remediation-2-review): this one asked the map by the raw resolved path, with neither its rule nor its key.
  return pure.admitRun({ ...opts, runDir: abs(opts.runDir), repoRoot, project: project ?? null, declaredReviewsDir: declaredReviewsDir ?? null,
    home: opts.home ?? quorateHome(), io: opts.io ?? hostPlatform(), repoSpellings: [...(opts.repoSpellings ?? []), ...rememberedSpelling(repoRoot)] });
}
/**
 * The reviews root's `.gitignore`, written when absent — the ONE owner (G-28). Every writer into a
 * reviews root calls this first: new-run at mint, run-graph at archive, and preflight when it seeds.
 * preflight had no copy, so seeding before the first mint left `.preflight-cache/` visible to git.
 * Only when absent, so an operator who edited it keeps their version. Atomic, because mints race.
 *
 * AN EXISTING FILE IS CHECKED, NOT TRUSTED (G-24 of 20260925-200721-platform-remediated): it was accepted as it stood,
 * so an empty or stale one left `evidence/` — captured output that may hold a credential — on the tracked side with
 * nothing said. It is still never rewritten; the rules it lacks are returned, and the caller says so.
 * Returns { written, missing }: `missing` lists each rule of REVIEWS_IGNORE_TEXT the existing file does not carry.
 */
export function ensureReviewsIgnore(dir) {
  const ignorePath = path.join(dir, '.gitignore');
  if (hostFs.existsSync(ignorePath)) {
    return { written: false, missing: pure.ignoreRulesMissing(hostFs.readFileSync(ignorePath, 'utf8')) };
  }
  hostFs.mkdirSync(dir, { recursive: true });
  writeTextAtomic(ignorePath, pure.REVIEWS_IGNORE_TEXT);
  return { written: true, missing: [] };
}

/**
 * The same question, READ-ONLY, for a directory the run will archive into later (G-19 of 20260929-225147-m0-gate-review):
 * the gap has to reach the run's not_checked[] before the gate is written, and the archive comes after it. An absent
 * file is no gap — ensureReviewsIgnore writes the full one at archive.
 */
export function reviewsIgnoreGaps(dir) {
  const ignorePath = path.join(dir, '.gitignore');
  return hostFs.existsSync(ignorePath) ? pure.ignoreRulesMissing(hostFs.readFileSync(ignorePath, 'utf8')) : [];
}

/**
 * Move a finished run from staging into the repository (`plan` from lib's archivePlan): copy to `tmp` beside `to`, then
 * rename, because home and repository are routinely on different volumes and a half-finished copy must never read as
 * a complete run. With `withholdEvidence` (G-8 of 20260930-225320-m0-gate-review-r4) the run's `evidence/` is not
 * copied and stays in staging, outside the repository; everything else moves. Returns { to, evidenceLeftAt }.
 * Throws after removing `tmp`, leaving the staged run whole, so the caller can say where it is.
 */
export function archiveRun(plan, { withholdEvidence = false, skip = [], rm = hostFs.rmSync } = {}) {
  const evidence = path.join(plan.from, 'evidence');
  const skipped = new Set(skip.map((n) => path.join(plan.from, n)));
  // Through the host-aware owner (G-12 of 20261029-212858-rdr-remediation-2-review), not a local case-sensitive prefix.
  const withheld = (src) => skipped.has(src) || (withholdEvidence && isWithin(evidence, path.resolve(src)));
  try {
    hostFs.mkdirSync(path.dirname(plan.tmp), { recursive: true });
    rm(plan.tmp, { recursive: true, force: true });
    hostFs.cpSync(plan.from, plan.tmp, { recursive: true, filter: (src) => !withheld(src) });
    hostFs.renameSync(plan.tmp, plan.to);
  } catch (e) {
    // THE CLEANUP NEVER REPLACES THE ERROR (G-9 of 20261023-014400-rdt-delivery): an EPERM or EBUSY here threw the
    // removal's error out of the recovery path instead of the one that stopped the archive.
    try { rm(plan.tmp, { recursive: true, force: true }); } catch { /* the original error is the one to report */ }
    throw e;
  }
  // THE ARCHIVE HAS HAPPENED; cleaning up the staged copy is a separate step, and its failure must not throw past a
  // completed archive (r5's G-2). It is reported, so the caller can say what was left behind.
  try {
    // Through the run's owner (run-dir-reads.plan.md stage 3): a link at evidence/ is refused here, and the refusal is
    // reported as a cleanup that failed, with the staged copy kept, rather than followed.
    if (withholdEvidence && confined(plan.from).exists(['evidence'])) {
      for (const name of hostFs.readdirSync(plan.from)) {
        if (name !== 'evidence') hostFs.rmSync(path.join(plan.from, name), { recursive: true, force: true });
      }
      return { to: plan.to, evidenceLeftAt: evidence, cleanupFailed: null };
    }
    hostFs.rmSync(plan.from, { recursive: true, force: true });
    return { to: plan.to, evidenceLeftAt: null, cleanupFailed: null };
  } catch (e) {
    return { to: plan.to, evidenceLeftAt: withholdEvidence ? evidence : null, cleanupFailed: e.message };
  }
}

/**
 * IS THIS RUN WHERE IT BELONGS: no `archiveTo` (a declared reviews_dir wrote it there), or its directory is in `archiveTo`
 * by this platform's filesystem case rule. The ONE answer archiveStagedRun and its callers give (G-3, G-12 of
 * 20261015-220413-archive-fold-review): archive-run compared case-sensitively and contradicted the archive on Windows.
 */
//
// BOTH SIDES ON REAL PATHS (G-2 of 20261016-214749-sp-bugs-remediation-2-review): archive-run hands in a real runDir, and
// archive_to was recorded through whatever path reached the repository, so a link or subst drive made an archived run
// "not in place". A side that does not exist is compared as resolved.
export function inArchive(runDir, archiveTo) {
  if (!archiveTo) return true;
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const key = (p) => (hostPlatform().caseInsensitiveFs ? real(p).toLowerCase() : real(p));
  return key(path.dirname(runDir)) === key(archiveTo);
}

/**
 * ARCHIVE A FINISHED STAGED RUN, the one sequence every caller uses (run-graph at its gate, remediate.mjs when a
 * remediation ends, archive-run.mjs for a run left staged): plan, the reviews .gitignore, git's answer on the evidence,
 * then the move. `skip` names top-level entries left behind (a runner's own lock). A run already in `archiveTo`, or one
 * with no `archiveTo` (a declared reviews_dir), stays where it is. Never throws: returns the run's directory now, and
 * every problem goes to `log` with where the run is.
 */
export function archiveStagedRun({ runDir, archiveTo, repoRoot, skip = [], log = () => {}, rm = hostFs.rmSync }) {
  const stays = runDir;
  if (inArchive(runDir, archiveTo)) return stays;
  let plan;
  try {
    plan = pure.archivePlan({
      runDir, archiveTo, repoRoot, exists: hostFs.existsSync,
      realpath: hostFs.realpathSync, caseInsensitive: hostPlatform().caseInsensitiveFs,
    });
  } catch (e) { log(`archive: ${e.message}; the run stays at ${runDir}`); return stays; }
  if (!plan.ok) { log(`archive: ${plan.why}; the run stays at ${runDir}`); return stays; }
  try {
    hostFs.mkdirSync(path.dirname(plan.tmp), { recursive: true });
    // THE IGNORE RULE ARRIVES WITH THE BYTES (G-28). new-run writes it into the reviews root, which for a staged run is
    // under the engine's home -- a directory git cannot see. §3 accepts environment inheritance in captured output on the
    // ground that it is never committed, so the rule has to exist wherever the output lands. Written at ARCHIVE time,
    // because a mint must leave the reviewed tree untouched; only when absent, so an operator's edit is kept.
    const ig = ensureReviewsIgnore(path.dirname(plan.to));
    if (ig.missing.length) log(reviewsIgnoreWarning(path.dirname(plan.to), ig.missing));   // G-24
    // WITHHELD UNLESS GIT SAYS IGNORED (G-8 of r4; contract-glob-grammar stage 6): asked after the .gitignore is written,
    // about the evidence at its destination; anything but "ignored" keeps the evidence staged.
    // The staged run's owner, rooted at the directory archivePlan resolved from the caller's admitted run.
    const withholdEvidence = evidenceIgnoredByGit(path.dirname(plan.to), path.basename(plan.to), confined(plan.from)) !== true;
    const moved = archiveRun(plan, { withholdEvidence, skip, rm });
    if (moved.evidenceLeftAt) log(`evidence withheld from the repository; it stays at ${moved.evidenceLeftAt}`);
    if (moved.cleanupFailed) log(`the run is archived, but its staged copy at ${plan.from} could not be removed (${moved.cleanupFailed})`);
    return moved.to;
  } catch (e) {
    // The staged run is still whole and still readable. Saying where it is beats losing it. The temp copy's removal is
    // guarded (G-9 of 20261023-014400-rdt-delivery): this function never throws, and an unguarded rmSync here did.
    let leftTmp = null;
    try { rm(plan.tmp, { recursive: true, force: true }); } catch (r) { leftTmp = r.message; }
    log(`archive: could not move the run into the tree (${e.message}); it stays at ${runDir}`
      + (leftTmp ? `; its partial copy at ${plan.tmp} could not be removed (${leftTmp})` : ''));
    return stays;
  }
}

/**
 * Would git ignore this run's evidence once archived under `archiveRoot`? (contract-glob-grammar stage 6, design §4.)
 * Git's answer, not a parser's: quorate read the reviews .gitignore itself and missed a broad re-include such as `!*\/`
 * (r5 G-5). `true` ignored, `false` not, `null` git could not say (not a repository, git missing) — which withholds.
 * Git's other exclude sources count too, which is the right answer to the question that matters here: would a commit
 * from this machine carry the evidence. Measured on a path that does not exist yet, 2026-10-01.
 */
//
// EVERY REAL EVIDENCE FILE, NOT A STAND-IN (G-3 of 20261001-031029-invoke-security-audit-cgg-high). This asked about one
// invented dotfile name, so a .gitignore ignoring only dotfiles under evidence/ answered "ignored" while
// the logs stayed trackable. `evidenceDir` is where the run's evidence is now (staged); each file is asked about at the
// path it would have under `archiveRoot/<runId>/evidence/`, and the answer is `true` only if git ignores all of them.
// An empty or absent evidence directory has nothing to carry: `true`.
//
// A DIRECTORY THAT CANNOT BE LISTED IS UNKNOWN, NOT EMPTY (G-7 of 20261001-034021-cgg-remediation-review): the walk
// swallowed the error, so an unreadable evidence directory gave an empty list and the answer "ignored" — the archive then
// moved files nobody had asked git about. Any listing failure but an absent root is `null`, which withholds.
export function evidenceIgnoredByGit(archiveRoot, runId, runOwner, { readdir = null } = {}) {
  // LISTED THROUGH THE RUN'S OWNER (run-dir-reads.plan.md stage 3): evidence/ sits below the run, and a listing that
  // followed a link there asked git about files that are not the run's. A link at any level is refused, which the walk
  // reads as unknown: null, so the evidence is withheld.
  // THE CALLER'S OWNER, NOT ONE REBUILT HERE (G-10 of 20261029-235315-rdr-remediation-4-review): the owner of the run the
  // caller admitted. A path is refused, never wrapped: its root was never admitted.
  if (typeof runOwner?.list !== 'function' || typeof runOwner?.root !== 'string') {
    throw new TypeError('evidenceIgnoredByGit: runOwner is the admitted run\'s owner, not a path');
  }
  const evidenceDir = path.join(runOwner.root, 'evidence');
  if (!readdir) readdir = (d, o) => runOwner.list(path.relative(runOwner.root, d).split(path.sep), o);
  const rels = [];
  const walk = (dir, prefix) => {
    let entries;
    try { entries = readdir(dir, { withFileTypes: true }); } catch (e) {
      if (prefix === '' && e.code === 'ENOENT') return true;
      return false;
    }
    for (const e of entries) {
      // A link among the entries is not the run's file to ask git about: unknown, so withheld.
      if (e.isSymbolicLink?.()) return false;
      if (e.isDirectory()) { if (!walk(path.join(dir, e.name), `${prefix}${e.name}/`)) return false; }
      else rels.push(`${runId}/evidence/${prefix}${e.name}`);
    }
    return true;
  };
  if (!walk(evidenceDir, '')) return null;
  if (!rels.length) return true;
  const r = gitSync(['check-ignore', '--stdin', '-z'], { cwd: archiveRoot, input: rels.join('\0'), encoding: 'utf8' });
  if (r.status !== 0 && r.status !== 1) return null;
  const ignored = new Set(String(r.stdout ?? '').split('\0').filter(Boolean));
  return rels.every((p) => ignored.has(p));
}

/**
 * The same question before the archive, for the gate: with no .gitignore at `archiveRoot` yet, the archive writes the
 * full one (ensureReviewsIgnore), so the evidence WILL be ignored; otherwise git is asked about the file as it stands.
 */
export function evidenceWillBeIgnored(archiveRoot, runId, runOwner) {
  if (typeof runOwner?.list !== 'function') throw new TypeError('evidenceWillBeIgnored: runOwner is the admitted run\'s owner, not a path');
  if (!hostFs.existsSync(path.join(archiveRoot, '.gitignore'))) return true;
  return evidenceIgnoredByGit(archiveRoot, runId, runOwner);
}

/** The warning for a reviews .gitignore that lacks rules — one wording for every caller. */
export const reviewsIgnoreWarning = (dir, missing) => `${path.join(dir, '.gitignore')} exists but lacks ${missing.join(', ')}: `
  + 'captured evidence there may be committed. Add the missing lines; quorate does not rewrite a .gitignore you edited.';
