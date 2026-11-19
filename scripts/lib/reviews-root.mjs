// reviews-root.mjs — WHERE A RUN'S ARTIFACTS LAND, and what bounds that choice.
//
// Runs used to be written inside the repository under review, at `.claude/reviews/`. That is what a
// consumer sees in `git status` while a sweep is running, and it forced four separate places to
// remember to EXCLUDE the run directory from something: the tree hash at mint, the tree hash at the
// gate, the working-tree mirror into the arms' checkout, and the intent sandbox. Two defects came
// from exactly that class — `mirrorWorkingTree` copied the LIVE run directory into the tree the
// external reviewers read, and `worktreeSha` once reported every run's own tree as moved. Each
// exclusion is a place to forget; moving the runs out removes the class rather than guarding it.
//
// THE BOUND DOES NOT DISAPPEAR, IT MOVES. `review.reviews_dir` is read from the CLAUDE.md of
// whatever tree the engine is pointed at, so before this it was confined to the repository root and
// three separate defects had already exploited the gap: an absolute value, a `..`, and a junction
// that made a nonexistent directory resolve out of the tree (G-16, G-34, G-32). Unbounded, the same
// key could now name any directory on the machine. So the allowed set is exactly two places: inside
// the repository under review, or inside quorate's own per-user home. Everything else is refused.
//
// The ledger is deliberately NOT here. It is the cross-run memory, it is one small tracked file, and
// it stays in the repository so a clone carries what recurred; only RUN directories move.

import path from 'node:path';
import { absolute, resolveFrom } from './paths.mjs';
import { isWithin, escapesBeforeCreate, canonicalSpelling, rootSpelling, isBelowRoot } from './finding-scope.mjs';
import crypto from 'node:crypto';

// NO ENVIRONMENT OR HOME READ HERE (os-platform-adapters criterion 5): both arrive as arguments.
// scripts/io/reviews-root.mjs supplies them from the platform for the orchestration scripts.

/** quorate's per-user root. Overridable so tests need not touch a real home directory. */
export function quorateHome(env, homedir) {
  if (!env || typeof env !== 'object' || typeof homedir !== 'string' || !homedir) {
    throw new Error('quorateHome: env and homedir are required — lib/ does not read the environment');
  }
  const declared = String(env.QUORATE_HOME ?? '').trim();
  // A RELATIVE QUORATE_HOME is refused, not resolved (G-15): resolving it read the working directory,
  // so the engine's home moved with wherever the command happened to be started.
  return declared ? absolute(declared, 'QUORATE_HOME') : path.join(homedir, '.quorate');
}

/**
 * A stable directory name for one repository.
 *
 * The project slug alone collides: two checkouts of the same project — a worktree, a sandbox clone,
 * a consumer's fork — would share a reviews root and interleave their runs. The path hash
 * disambiguates them while keeping the human-readable half first, so the directory is still
 * recognisable when an operator goes looking.
 */
export function repoKey(project, repoRoot) {
  const slug = String(project ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const hash = crypto.createHash('sha256').update(absolute(repoRoot, 'repoKey: repoRoot')).digest('hex').slice(0, 8);
  return `${slug || 'project'}-${hash}`;
}

/**
 * Where a repository's finished runs are archived, and beside them its ledger (lib/ledger.mjs `ledgerPathFor`). One
 * owner of the layout (G-1 of 20261013-023310-ledger-identity-remediation-2-review): findings-ledger recognised the
 * repository's ledger by matching `.claude` and `reviews` itself while `repoRunRoots` built the same path, so a move of
 * either would have left runRoots quietly reading only the ledger's siblings.
 */
export const ARCHIVED_REVIEWS = '.claude/reviews';
export function archivedReviewsDir(repoRoot) {
  return path.join(absolute(repoRoot, 'archivedReviewsDir: repoRoot'), ARCHIVED_REVIEWS);
}

/** Where runs go when the contract does not say. */
export function defaultReviewsRoot({ project, repoRoot, home } = {}) {
  if (typeof home !== 'string' || !home) throw new Error('defaultReviewsRoot: home is required — see quorateHome');
  return path.join(home, 'reviews', repoKey(project, repoRoot));
}

/**
 * Where one run's arms' directories go: under quorate's own home, which nothing else writes to, so the directory is the
 * run's by location (arms-directory-home.design.md). It was in the shared temp directory, and four rounds each found a
 * new way that proving a path there was the run's could fail.
 */
//
// Keyed by the repository as the reviews root is (G-8 of 20261003-194617-arms-dir-home-confirm): by run id alone, two
// repositories starting the same slug in the same second shared one root, and either run's reclaim could delete the
// other's live surface. The run id is judged by isSafeRunId, its one owner.
export function armsRoot({ home, project, repoRoot, runId } = {}) {
  const h = absolute(home, 'armsRoot: home');
  if (!isSafeRunId(runId)) throw new Error(`armsRoot: not a run id, got ${JSON.stringify(runId)}`);
  return path.join(h, 'arms', repoKey(project, repoRoot), runId);
}

/**
 * May this directory hold run artifacts?
 *
 * `isWithin` is supplied by the caller rather than reimplemented: one owner decides what containment
 * means, and a second copy here would eventually disagree with the one guarding finding paths (G-24).
 */
export function reviewsRootAllowed({ repoRoot, home, candidate, isWithin }) {
  // This guard could never fire: path.resolve('') is the working directory, never empty. An empty
  // candidate is now the refusal it was written to be, rather than silently "here".
  if (!String(candidate ?? '').trim()) return { ok: false, why: 'review.reviews_dir resolved to nothing' };
  const dir = absolute(candidate, 'reviewsRootAllowed: candidate');
  // The repository root itself would make every run write over the tree it is reviewing.
  if (dir === absolute(repoRoot, 'reviewsRootAllowed: repoRoot')) {
    return { ok: false, why: `review.reviews_dir is the repository root itself (${dir})` };
  }
  if (dir === absolute(home, 'reviewsRootAllowed: home')) {
    return { ok: false, why: `review.reviews_dir is quorate's home itself (${dir}); use a subdirectory` };
  }
  // WHICH container allowed it, returned rather than inferred. The caller still has to run the
  // symlink-escape check that G-32 and G-34 exist for, and that check needs the boundary the path
  // was accepted against: testing an in-home reviews root for escape from the REPOSITORY would
  // pass everything and protect nothing.
  if (isWithin(repoRoot, dir)) return { ok: true, dir, container: absolute(repoRoot, 'reviewsRootAllowed: repoRoot'), where: 'repository' };
  if (isWithin(home, dir)) return { ok: true, dir, container: absolute(home, 'reviewsRootAllowed: home'), where: 'quorate home' };
  return {
    ok: false,
    why: `review.reviews_dir (${dir}) is neither inside the repository under review (${repoRoot}) `
      + `nor inside quorate's home (${home}). The key is read from the contract of whatever tree the `
      + 'engine is pointed at, so an unbounded value would let that tree choose any directory on this '
      + 'machine to write into — which is the path traversal the threat model names in scope.',
  };
}

/**
 * MAY THIS RUN DIRECTORY BE USED? The same bound as `reviewsRootAllowed`, asked of one run.
 *
 * `--run-dir` decides where every artifact of a run is written AND supplies the `contract` that every
 * subsequent spawn is configured from — commands, models, reviewers, the declared runtime. A
 * counterfeit directory accepted here redirects the writes and configures everything downstream, so
 * run-graph, capture and external-review each refuse one they do not trust (G-26, G-6, G-3).
 *
 * That control was "inside the repository under review". Runs now default to the engine's own home,
 * so the same control has to admit exactly two containers instead of one — and NOT simply widen to
 * "anywhere", which would delete it. A directory carrying its own run.json is still not authority for
 * where it may be.
 */
export function runDirAllowed({ repoRoot, home, runDir, isWithin, escapesAfterRealpath }) {
  if (!String(runDir ?? '').trim()) return { ok: false, why: 'no run directory was given' };
  const dir = absolute(runDir, 'runDirAllowed: runDir');
  for (const [container, where] of [[repoRoot, 'repository under review'], [home, "the engine's home"]]) {
    if (!container) continue;
    const root = absolute(container, 'runDirAllowed: container');
    if (isWithin(root, dir) && !escapesAfterRealpath(root, dir)) return { ok: true, dir, container: root, where };
  }
  return {
    ok: false,
    why: `${dir} is neither inside the repository under review (${repoRoot}) nor inside `
      + `the engine's home (${home}), or it leaves one through a link. A directory `
      + 'carrying its own run.json is not authority for where it may be.',
  };
}

/**
 * STAGED OUTSIDE, RETURNED AFTER — the plan for putting a finished run back in the tree.
 *
 * Runs are written outside the repository so a review never mutates the tree it is reviewing: that
 * is what removed the need to exclude a LIVE run directory from the tree hash, the arms' mirror and
 * the intent sandbox. But the committed evidence trail was worth keeping, and an out-of-tree run
 * exists only on the machine that produced it.
 *
 * So the two goals are separable: stage the run where nothing can see it while it is being written,
 * and move it back once it is finished and inert.
 *
 * THE MOVE IS COPY-THEN-RENAME, NOT A DIRECT COPY INTO PLACE. Home and repository are routinely on
 * different volumes (C: and F: here), so this is a copy plus a delete rather than a rename — and a
 * copy that fails halfway leaves a PARTIAL run directory in the tree, which reads as a complete one
 * and is worse than no archive at all. Copying to a temp name beside the destination and renaming
 * within that directory makes the visible step atomic: the same tmp/rename shape every durable write
 * in this engine already uses.
 */
export function archivePlan({ runDir, archiveTo, repoRoot, exists = () => false, realpath, caseInsensitive = false }) {
  // CHECKED BEFORE RESOLVING: path.resolve('') returns the CURRENT DIRECTORY, so an empty runDir
  // resolves to something truthy and would have planned an archive of wherever this process happens
  // to be standing.
  if (!String(runDir ?? '').trim() || !String(archiveTo ?? '').trim()) {
    return { ok: false, why: 'nothing to archive' };
  }
  if (typeof realpath !== 'function') throw new Error('archivePlan: realpath is required — the destination is judged through links');
  const from = absolute(runDir, 'archivePlan: runDir');
  const root = absolute(archiveTo, 'archivePlan: archiveTo');
  // THE ONE DESTINATION new-run WRITES, AND STILL INSIDE ONCE LINKS ARE RESOLVED (G-16). The archive
  // deletes a temp directory and copies the run there, so a forged run.json.archive_to — or a
  // .claude/reviews that is a link out of the repository — aimed a recursive delete anywhere.
  const repo = absolute(repoRoot, 'archivePlan: repoRoot');
  const expected = archivedReviewsDir(repo);   // the owner's spelling (G-10 of 20261023-014400-rdt-delivery)
  const key = (p) => (caseInsensitive ? p.toLowerCase() : p);
  if (key(root) !== key(expected)) {
    return { ok: false, why: `archive_to ${root} is not this repository's ${expected}; a run is archived nowhere else` };
  }
  const realOf = (p) => {   // the nearest existing ancestor's real path: a first archive has no reviews dir yet
    for (let at = p; ; at = path.dirname(at)) {
      try { return realpath(at); } catch (e) { if (e?.code !== 'ENOENT' || path.dirname(at) === at) throw e; }
    }
  };
  if (!isWithin(realOf(repo), realOf(root))) {
    return { ok: false, why: `${root} resolves outside the repository through a link; refusing to archive into it` };
  }
  const name = path.basename(from);
  const to = path.join(root, name);
  // NEVER OVER AN EXISTING RUN. A run id collision means two runs share an identity, and silently
  // replacing the older one destroys the artifact a finding may already cite.
  if (exists(to)) {
    return { ok: false, why: `${to} already exists; refusing to archive over a run that is already there` };
  }
  return { ok: true, from, to, tmp: path.join(root, `.archiving-${name}`) };
}

/**
 * The ignore rule a reviews directory carries, so no consuming project has to be told to add one.
 *
 * ONE OWNER, because it is now written in TWO places and they must not drift: new-run writes it into
 * the reviews root at mint, and run-graph writes it into the ARCHIVE DESTINATION when a staged run
 * lands there. Those were the same directory until graph_contract 2 moved runs out of the tree,
 * after which the rule was written where git cannot see it and the bytes were delivered where git
 * keeps them forever (G-28) -- captured build and test logs that inherit the operator's whole
 * environment under §3's accepted residual, raw vendor responses, adjudication prompts.
 *
 * §3 accepts that inheritance on the stated ground that captured output is never committed. This
 * string is what makes the sentence true, so it is not a formatting detail.
 */
export const REVIEWS_IGNORE_TEXT = [
  '# Written by quorate. Captured command output may hold a connection string, an environment',
  '# dump, or a token inside an error — see disk-first-protocol.md §3, whose acceptance of',
  '# environment inheritance rests on that output never being committed.',
  '*/evidence/',
  '# The pre-flight cache: a record that THESE commands passed on THIS machine, with this',
  '# toolchain. Committed, a teammate cloning the repository would inherit one machine\'s',
  '# "the tests passed" as their own and skip running them. This repository has paid for that',
  '# class of file twice already — two machine-local reviewer probe records (since retired) were',
  '# both tracked once. An undeclared reviews_dir stages runs under the engine\'s home, where the',
  '# cache is machine-local by construction; this line is for a project that DECLARED one inside',
  '# its own tree, where it would otherwise be tracked.',
  '.preflight-cache/',
  '',
].join(String.fromCharCode(10));

/**
 * The gate's not-checked entry for archiving a run into `archiveRoot`, or null when there is nothing to say
 * (contract-glob-grammar stage 6, design §4). `ignored` is git's answer — would the run's evidence be ignored there
 * (io/reviews-root's evidenceIgnoredByGit): `true`, `false`, or `null` when git could not say. Anything but `true`
 * withholds the evidence, which then stays staged at `runDir/evidence`, and the entry says where. `missing` names the
 * lines of quorate's .gitignore an edited file lacks, for the operator to add; it no longer decides anything.
 *
 * This replaced `withholdsEvidence(missing)`, which decided from quorate's own reading of the .gitignore and so missed a
 * broad re-include such as `!*\/` (r5 G-5), and repeated the `*\/evidence/` literal it was checking for (r5 G-4).
 */
export function archiveEvidenceEntry({ archiveRoot, runDir, ignored, missing = [] }) {
  if (ignored === true && !(missing ?? []).length) return null;
  const evidence = path.join(runDir, 'evidence');
  const parts = [];
  if ((missing ?? []).length) parts.push(`${path.join(archiveRoot, '.gitignore')} exists but lacks ${missing.join(', ')}`);
  if (ignored === false) {
    parts.push(`git would not ignore this run's evidence at ${archiveRoot}, so its evidence/ is not archived into the `
      + `repository: it stays staged at ${evidence}`);
  } else if (ignored !== true) {
    parts.push(`git could not say whether this run's evidence would be ignored at ${archiveRoot}, so its evidence/ is `
      + `not archived into the repository: it stays staged at ${evidence}`);
  }
  return { node_id: 'archive', why: `${parts.join('. ')}.` };
}

// Which of REVIEWS_IGNORE_TEXT's rules an existing `.gitignore` does not put in force (G-9 of
// 20260929-225147-m0-gate-review). Read IN ORDER, as git reads it: a rule counts only if it appears and no later
// negation (`!` naming the same directory) undoes it. Set membership alone passed the evidence rule followed by its
// negation, which leaves evidence tracked. Pure: it takes the file's text. (A line comment, because the rule itself
// contains the characters that end a block comment.)
export function ignoreRulesMissing(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const rules = REVIEWS_IGNORE_TEXT.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  // The directory a rule names, stripped of `*/` and a trailing `/`: `*/evidence/` names `evidence`.
  const core = (r) => r.replace(/^!/, '').replace(/^(\*\*?\/)+/, '').replace(/\/\**$/, '').replace(/\/$/, '');
  return rules.filter((rule) => {
    const at = lines.lastIndexOf(rule);
    if (at < 0) return true;
    return lines.slice(at + 1).some((l) => l.startsWith('!') && core(l).split('/').includes(core(rule)));
  });
}

/**
 * The directories the panel mirror must NOT copy into the arms' checkout.
 *
 * A live run's artifacts are untracked and not ignored, so they sit in the untracked set
 * `mirrorWorkingTree` copies -- and that checkout is what a third-party cloud reviewer reads. The
 * call site passed `path.dirname(runDir)` under a comment claiming it "covers this run and every
 * archived one". It did, until graph_contract 2 staged runs under the engine's per-user home: from
 * then on that path resolved OUTSIDE the repository and matched nothing `git ls-files --others`
 * could ever list, while the destination archived runs actually land in was excluded by nothing
 * (G-37). The guard still looked present, which is why two lenses had to find it by reading.
 *
 * Self-triggering, needing no unusual sequence: run A archives into `.claude/reviews/<id>` and is
 * untracked, which makes `git status --porcelain` non-empty, which makes the next mint record
 * `dirty: true`, which brings run B to the mirror -- carrying run A's briefs, arm prompts, reports
 * and gate across to the vendor.
 *
 * BOTH roots, because either may be the one inside the repository: a project that DECLARES
 * reviews_dir writes its runs straight into the tree and has no archive step at all.
 *
 * Extracted rather than computed inline because the defect WAS the computed value -- a path that
 * silently stopped naming anything. A decision that can go inert is a decision worth a test.
 */
export function panelMirrorExclusions({ runDir, archiveTo, repoRoot }) {
  const roots = [];
  if (String(runDir ?? '').trim()) roots.push(path.dirname(absolute(runDir, 'panelMirrorExclusions: runDir')));
  const archive = String(archiveTo ?? '').trim()
    ? absolute(archiveTo, 'panelMirrorExclusions: archiveTo')
    : archivedReviewsDir(repoRoot);   // the owner's spelling (G-10 of 20261023-014400-rdt-delivery)
  roots.push(archive);
  return [...new Set(roots)];
}

/**
 * Is this string safe to join into a filesystem path as a single segment?
 *
 * A run id is READ FROM A run.json THE CALLER DID NOT WRITE — `bench-second-opinion` stages a
 * preserved run by `path.join(stagingParent, runJson.run_id)` before copying into it recursively,
 * so a crafted run could supply `..` segments and make the copy land outside its staging directory
 * (G-16, panel-codex-security). LOW, because the preserved run comes from the operator's own disk
 * and exploiting it takes a hand-edited run.json — and still a string from a file treated as a path.
 *
 * capture.mjs already refuses a run directory that is not inside a permitted container. This is the
 * same rule one layer earlier, where the path is BUILT rather than accepted: containment checked
 * after the fact tells you the copy went somewhere wrong, which is late.
 *
 * Deliberately a WHITELIST. A blacklist of `..` and separators is a guess about which spellings a
 * filesystem honours, and this has to hold on both Windows and POSIX — where the separator, the
 * case rules and the meaning of a leading letter-colon all differ. Every run id this engine mints
 * is `<timestamp>-<slug>`, so the permitted set is narrow and the refusal costs nothing real.
 */
export function isSafeRunId(id) {
  if (typeof id !== 'string' || !id) return false;
  if (id === '.' || id === '..') return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

/**
 * The runs that cite `runId` as the source of something they reused: `checks_reused_from` (a reused pre-flight, run-graph)
 * and `intent_reused_from` (a reused intent). Returns `[{ run_id, field }]`. A run that cites it holds evidence it depends
 * on, so the run must not be deleted (archive-run's refusal; story-pipeline, 2026-10-16). The chain links
 * (`follows_remediation`, `remediation_frame`) are not checked: a run with no gate.json never minted anything.
 */
export function runCitations(runId, records) {
  const out = [];
  for (const r of records ?? []) {
    for (const field of ['checks_reused_from', 'intent_reused_from']) {
      if (r && r[field] === runId) out.push({ run_id: r.run_id, field });
    }
  }
  return out;
}

/**
 * WHICH OF THE CALLER'S OTHER SPELLINGS NAME THE REPOSITORY AT `repoRoot`: those that are absolute and whose WHOLE native
 * real path, a link at the last name followed, is the repository's own, by the platform's case rule. The one rule
 * repoRunRoots (enumeration) and admitRun (admission) both ask (G-6 of 20261118-142344-cpi-remediation-2-review): each
 * carried its own, one on rootSpelling and one on the whole real path, so a spelling that is itself a link to the
 * repository was admitted and never enumerated. A spelling that cannot be resolved names nothing; a repository that cannot
 * be resolved is taken on its rootSpelling.
 */
export function sameRepoSpellings({ repoRoot, repoSpellings = [], io }) {
  if (!io?.fs || typeof io.caseInsensitiveFs !== 'boolean') throw new Error('sameRepoSpellings: io (the platform) is required');
  const real = (p) => (io.fs.realpathSync.native ?? io.fs.realpathSync)(p);
  const fold = (s) => (io.caseInsensitiveFs ? String(s).toLowerCase() : String(s));
  const given = absolute(repoRoot, 'sameRepoSpellings: repoRoot');
  let repo;
  try { repo = real(given); } catch { repo = rootSpelling(given, io); }
  return (Array.isArray(repoSpellings) ? repoSpellings : []).filter((s) => {
    if (typeof s !== 'string' || !path.isAbsolute(s)) return false;
    try { return fold(real(s)) === fold(repo); } catch { return false; }
  });
}

/**
 * Where the repository at `repoRoot` keeps its runs: its `.claude/reviews/` (archived), its declared `reviews_dir`, and
 * the engine's staging root for it. One list, so the question "does this run belong here" and the question "which runs
 * are there" cannot disagree (G-4 and G-2 of 20261013-000416-ledger-identity-review: the ledger looked only beside itself).
 */
export function repoRunRoots({ repoRoot, project = null, home: givenHome = null, stagingRoot = null, declaredReviewsDir = null, io = null, dropped = null, repoSpellings = [] }) {
  // EVERY ROOT AS THE FILESYSTEM SPELLS IT, given the disk (canonicalSpelling, CI run 43281517496): a repository or home
  // handed in under an 8.3 short name derived roots no realpath'd run directory is lexically inside, and a staging key
  // (repoKey hashes the repository's path) the minting command, given the other spelling, never wrote under. The key of
  // the spelling given is asked too, so a run staged before the respelling is still found.
  // ON THE ROOT'S REAL PATH since ci-path-identity.plan.md stage 1c (rootSpelling: links above a root followed, /var to
  // /private/var on macOS). The links-kept spelling's key is still asked below, so a run staged under it is still found.
  const given = absolute(repoRoot, 'repoRunRoots: repoRoot');
  const repo = io ? rootSpelling(given, io) : given;
  const spelledKey = io ? canonicalSpelling(given, io) : given;
  const home = givenHome && io ? rootSpelling(givenHome, io) : givenHome;
  // EVERY ROOT ON REAL PATHS, given the disk (ledger-findings.plan.md stage 6; design D7): the archived folder and the
  // staging root were never checked, so a link at `.claude/reviews`, or at the staging root, made whatever it led to a
  // folder --summary reads and the migration joins run ids under. The archived one must resolve inside the repository,
  // the staging one inside quorate's home — the check the declared reviews_dir already had (below).
  // A ROOT LEFT OUT IS REPORTED (G-7 of 20261105-154708-crsf-remediation-5-review): `dropped`, when given, receives
  // `{ root, reason }` for each, so a caller that names unreadable roots names this one too, rather than reporting none
  // while every run behind the link goes unseen.
  const roots = [];
  // A root that does not exist holds no run, so leaving it out hides nothing and is not reported (a staging root under a
  // home not made yet resolves through an ancestor outside that home).
  const drop = (root, reason) => {
    if (!Array.isArray(dropped)) return;
    if (io && !io.fs.existsSync(root)) return;
    dropped.push({ root, reason });
  };
  const archived = archivedReviewsDir(repo);
  if (!io || !escapesBeforeCreate(repo, archived, io)) roots.push(archived);
  else drop(archived, 'its real path resolves outside the repository');
  // ONLY WHERE new-run MAY WRITE (G-13 of 20261013-023310-ledger-identity-remediation-2-review): the declared value came
  // straight from --print-contract, which does not bound it, so an absolute or `..` reviews_dir made a folder outside
  // the repository and quorate's home a root that --summary and the migration list and parse. new-run refuses to mint
  // there, so no run of this repository can be in it.
  if (String(declaredReviewsDir ?? '').trim()) {
    // Spelled as the filesystem spells it, as the repository and the home it is held to are (canonicalSpelling).
    const resolved = resolveFrom(repo, 'repoRunRoots: repoRoot', declaredReviewsDir);
    const declared = io ? canonicalSpelling(resolved, io) : resolved;
    // Below a root by belowRoot too (ci-path-identity.plan.md stage 1c): the repository and the home are on their real
    // paths, the declared folder as spelled, so a folder under macOS's /var was outside both (CI run 44240829385). The
    // real-path check below still refuses a link at the declared path that leads out.
    const within = (r, c) => (io ? isBelowRoot(r, c, io) : isWithin(r, c));   // one predicate (G-9)
    let allowed = home
      ? reviewsRootAllowed({ repoRoot: repo, home, candidate: declared, isWithin: within }).ok
      : declared !== repo && within(repo, declared);
    // AND ON REAL PATHS, given the disk (G-10 of 20261013-042240-ledger-identity-remediation-4-review): containment was
    // lexical only, so a link or junction in the repository at the declared path made whatever it led to a root that
    // --summary and --migrate-identity list and parse. It must resolve inside the repository or quorate's home.
    // NOT THE REPOSITORY OR THE HOME ITSELF, on real paths too: reviewsRootAllowed's equality is lexical, and the declared
    // folder spelled through a link above them would pass it.
    if (allowed && io) {
      const fold = (s) => (io.caseInsensitiveFs ? String(s).toLowerCase() : String(s));
      // The declared folder on its WHOLE real path, a link at it followed: rootSpelling keeps a root's own name since the
      // rule became strictly above (G-2 of 20261118-112631-cpi-review), and a declared folder that is a link to the
      // repository itself must still be the repository here.
      let whole;
      try { whole = (io.fs.realpathSync.native ?? io.fs.realpathSync)(declared); } catch { whole = rootSpelling(declared, io); }
      const real = fold(whole);
      if (real === fold(repo) || (home && real === fold(home))) allowed = false;
    }
    if (allowed && io) {
      const leaves = (root) => escapesBeforeCreate(root, declared, io);
      if (leaves(repo) && (!home || leaves(home))) allowed = false;
    }
    if (allowed) roots.push(declared);
    else drop(declared, 'it resolves outside the repository and quorate\'s home');
  }
  if (stagingRoot) roots.push(io ? canonicalSpelling(stagingRoot, io) : absolute(stagingRoot, 'repoRunRoots: stagingRoot'));
  else if (home) {
    // AND EVERY OTHER SPELLING THE CALLER GAVE OF THIS REPOSITORY (G-3 of 20261118-131040-cpi-remediation-review): the key
    // of a --repo-root spelled through a link above it, under which a run was staged before stage 1c. It was threaded
    // through admitRun alone, so telemetry, citation and archival enumeration missed those runs. Only a spelling whose
    // real path is this repository counts, given the disk; without it, none does.
    // Which of them is decided by sameRepoSpellings, the one rule admitRun asks too (G-6 of
    // 20261118-142344-cpi-remediation-2-review): this filter compared rootSpelling, which keeps a link at the last name, so a
    // spelling that is itself a link to the repository was admitted and never enumerated.
    const others = io ? sameRepoSpellings({ repoRoot: given, repoSpellings, io }) : [];
    for (const keyed of new Set([repo, spelledKey, given, ...others])) {
      const staging = defaultReviewsRoot({ project, repoRoot: keyed, home });
      if (!io || !escapesBeforeCreate(home, staging, io)) roots.push(staging);
      else drop(staging, 'its real path resolves outside quorate\'s home');
    }
  }
  return roots;
}

/**
 * Does `runDir` belong to the repository at `repoRoot`? Only where that repository's runs live: its
 * `.claude/reviews/` (archived), its declared `reviews_dir`, or the engine's staging root for it.
 *
 * G-4 of 20260925-015614-platform-review: findings-ledger chose WHICH ledger to write from the
 * `repo_root` of a caller-chosen run.json, unverified, so a run directory whose run.json named another
 * tree made the fold create or replace that tree's ledger. The run's own location is the evidence;
 * the field it carries is only a claim.
 */
export function runBelongsToRepo({ runDir, repoRoot, project = null, home = null, stagingRoot = null, declaredReviewsDir = null, io = null, repoSpellings = [] }) {
  // Spelled as the filesystem spells it, given the disk, as the roots it is compared with are (repoRunRoots).
  // On its real path, as the roots are since ci-path-identity.plan.md stage 1c; a link below the home that leads out of it
  // then resolves outside every root and is refused.
  // COMPARED AS admitRun COMPARES (G-10 and G-11 of 20261118-112631-cpi-review): the run on its own real path, every root
  // on its rootSpelling, by the platform's case rule. The run was resolved and a declared reviews_dir or stagingRoot kept
  // its links, so a root spelled through macOS's /var refused the runs admitRun admitted below it.
  const fold = (s) => (io?.caseInsensitiveFs ? String(s).toLowerCase() : String(s));
  const given = absolute(runDir, 'runBelongsToRepo: runDir');
  let run = given;
  if (io) {
    try { run = (io.fs.realpathSync.native ?? io.fs.realpathSync)(given); } catch { run = rootSpelling(given, io); }
  }
  const repo = absolute(repoRoot, 'runBelongsToRepo: repoRoot');
  // THE SAME LIST, given the same disk (ledger-findings.plan.md stage 6): without io this kept a declared root the io list
  // drops, so "does this run belong here" and "which runs are there" disagreed — against this file's own promise.
  const homes = repoRunRoots({ repoRoot: repo, project, home, stagingRoot, declaredReviewsDir, io, repoSpellings })
    .map((h) => (io ? rootSpelling(h, io) : h));
  if (homes.some((h) => isWithin(fold(h), fold(run)))) return { ok: true };
  return {
    ok: false,
    why: `run ${run} does not belong to the repository its run.json names (${repo}): it is in none of `
      + `${homes.join(', ')}`,
  };
}

/**
 * THE RUN DIRECTORY new-run PRINTED, as an absolute path (G-15, G-3 of 20261023-014400-rdt-delivery). new-run prints a
 * run inside the repository relative to its --repo-root, so a caller that took the line as it stood resolved it against
 * its own working directory: remediate recorded a null follow-up, and bench-lenses lost every seed, for an in-repository
 * reviews_dir. `repoRoot` is the --repo-root the mint was given. Null when no `run dir:` line was printed.
 */
export function printedRunDir(output, repoRoot) {
  const m = /^run dir:\s*(.+)$/m.exec(String(output ?? ''));
  return m ? resolveFrom(repoRoot, 'printedRunDir: repoRoot', m[1].trim()) : null;
}

/**
 * ADMIT A RUN DIRECTORY A CALLER NAMES — the one owner (run-dir-trust.plan.md stage 1; ARCHITECTURE A-28).
 *
 * `--run-dir`, `--remediates` and `--follows-remediation` name a directory whose run.json then configures what the
 * script does: the commands it runs, the repository it locks, commits in and spawns a node in. Each entry script used to
 * compose its own subset of the checks, and the rounds of G-12 of 20261022-230755-ciss-d1-4-remediation-review came
 * from that: containment alone admits every repository's staged runs under the shared home, and remediate.mjs then acted
 * on the `repo_root` the run named.
 *
 * Every check, in order, before any field is returned:
 *   containment — inside the repository or the home, lexically and after realpath (runDirAllowed);
 *   record      — run.json read and parsed to an object;
 *   identity    — run_id a safe segment, equal to the real directory's name;
 *   requirement — what the caller names in `need` (`remediation`: the record carries remediates and remediation_frame);
 *   repository  — the run inside this repository's run roots (runBelongsToRepo), and its repo_root, after realpath, this
 *                 repository (a record with no repo_root predates the field and names none). `repoRoot` is the one the CALLER established (--repo-root, or git's toplevel of where it
 *                 runs), never a field of the run; `project` and `declaredReviewsDir` come from that repository's own
 *                 contract, which the io/ re-export reads.
 * `noRepository: true` is a caller declaring that it reads a run of no repository (a ledger named directly, a scored
 * bench run): the repository checks are skipped, and the result says so with `repository: null`.
 *
 * Returns { ok: true, dir, repoRoot, record, where, repository } or { ok: false, check, why }.
 */
export function admitRun({ runDir, repoRoot, home, project = null, declaredReviewsDir = null, io, need = {}, noRepository = false, repoSpellings = [] }) {
  if (!io?.fs || typeof io.caseInsensitiveFs !== 'boolean') throw new Error('admitRun: io (the platform) is required');
  const refuse = (check, why) => ({ ok: false, check, why });
  if (!String(runDir ?? '').trim()) return refuse('containment', 'no run directory was given');
  const hasRepo = Boolean(String(repoRoot ?? '').trim());
  if (!noRepository && !hasRepo) {
    return refuse('repository', 'no repository was established to admit the run for; a run directory\'s own repo_root is not '
      + 'authority for where the engine acts');
  }
  // BY THE PLATFORM'S CASE RULE (archive-run's G-3 of 20261015-220413-archive-fold-review): --run-dir may be spelled in
  // any case where the filesystem ignores it, and realpath keeps the case it was given.
  // NATIVE where the platform has it: the JS realpath keeps a Windows 8.3 short name (C:\Users\RUNNER~1) that git reports
  // long, so one place read as two (findings-ledger, CI run 37552051536, 2026-10-06), and it keeps the given casing.
  const real = (p) => (io.fs.realpathSync.native ?? io.fs.realpathSync)(p);
  const fold = (s) => (io.caseInsensitiveFs ? String(s).toLowerCase() : String(s));
  const within = (parent, child) => isWithin(fold(parent), fold(child));
  const escapes = (root, abs) => {
    try { return !within(real(root), real(abs)); } catch { return true; }
  };
  // EVERY ROOT ON ITS REAL PATH before one is compared with another (ci-path-identity.plan.md stage 1; PR #3's macOS job,
  // CI run 44206754901). canonicalSpelling keeps a link where it stands, and /var is a link to /private/var, so a run
  // directory resolved below was compared with a home and a repository spelled through the link, and every run under the
  // temporary folder was refused. A link STRICTLY ABOVE a root is where that root lives; a link AT a root is kept for
  // A-30 to refuse (the rule decided 2026-11-18, G-2 of 20261118-112631-cpi-review). A path that does not
  // exist yet is resolved through its deepest existing ancestor, the rest joined on as given.
  // The one owner of that resolution is rootSpelling (lib/finding-scope.mjs, stage 1c).
  const resolved = (p) => rootSpelling(p, io);
  // THE RUN DIRECTORY ITSELF IS NEVER RESOLVED (G-12 of 20261118-112631-cpi-review; the rule decided 2026-11-18,
  // .claude/requests/ci-path-identity.rule-decision.md): only the roots are. It keeps its names (canonicalSpelling) and is
  // placed below a resolved root lexically or by belowRoot, so the lexical half of A-28's containment still refuses a
  // --run-dir named through a link outside both roots; the real-path half (escapes) is the other.
  const spelledRun = path.isAbsolute(String(runDir)) ? canonicalSpelling(runDir, io) : runDir;
  const placedWithin = (parent, child) => isBelowRoot(parent, child, io);   // one predicate (G-9)
  const placed = runDirAllowed({ repoRoot: hasRepo ? resolved(repoRoot) : null, home: home ? resolved(home) : home,
    runDir: spelledRun, isWithin: placedWithin, escapesAfterRealpath: escapes });
  if (!placed.ok) return refuse('containment', placed.why);
  let dir;
  try { dir = real(placed.dir); } catch (e) { return refuse('containment', `${placed.dir} cannot be resolved (${e.message})`); }
  let record;
  // A STANDING LINK AT run.json IS REFUSED, NOT FOLLOWED (G-13 of 20261030-124823-ciss-stage7; A-30): only the directory
  // was realpathed, so a linked record configured every caller.
  const recordPath = path.join(dir, 'run.json');
  let st = null;
  try { st = io.fs.lstatSync(recordPath); } catch (e) { return refuse('record', `no readable run.json in ${dir} (${e.code ?? e.message})`); }
  if (st.isSymbolicLink()) return refuse('record', `the run.json in ${dir} is a link; a link below a run is refused`);
  if (!st.isFile()) return refuse('record', `the run.json in ${dir} is not a file`);
  try { record = JSON.parse(io.fs.readFileSync(recordPath, 'utf8')); } catch (e) {
    return refuse('record', `no readable run.json in ${dir} (${e.code ?? e.message})`);
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return refuse('record', `the run.json in ${dir} is not an object`);
  if (!isSafeRunId(record.run_id) || fold(path.basename(dir)) !== fold(record.run_id)) {
    return refuse('identity', `${dir} is not the run its run.json names (run_id ${JSON.stringify(record.run_id ?? null)})`);
  }
  // A REQUIREMENT NOT IMPLEMENTED HERE IS REFUSED, NEVER IGNORED (G-11 of 20261023-014400-rdt-delivery): only
  // `remediation` was read, so a caller naming `ended` was admitted an unfinished run. A run's end is archive-run's rule.
  const unknownNeeds = Object.keys(need ?? {}).filter((k) => k !== 'remediation' && need[k]);
  if (unknownNeeds.length) {
    return refuse('requirement', `admitRun does not check ${unknownNeeds.join(', ')}; the caller must check it itself`);
  }
  if (need.remediation && (!record.remediates || !record.remediation_frame)) {
    return refuse('requirement', `${record.run_id} is not a remediation run; mint one with new-run --remediates`);
  }
  if (noRepository) return { ok: true, dir, repoRoot: null, record, where: placed.where, repository: null };
  let repo;
  try { repo = real(absolute(repoRoot, 'admitRun: repoRoot')); } catch (e) {
    return refuse('repository', `the repository ${repoRoot} cannot be resolved (${e.message})`);
  }
  // runBelongsToRepo's question, asked of the owner of the list (repoRunRoots) by the platform's case rule. The staging
  // root is keyed by the repository's path as the minting command spelled it (respelled by canonicalSpelling, links kept, since
  // CI run 43281517496), so both spellings' roots are asked.
  // Each root is then resolved (stage 1 of ci-path-identity.plan.md, above), so the refusal names what was compared.
  // And every other spelling the CALLER gave of this repository (repoSpellings; G-5 of 20261118-112631-cpi-review), so the
  // key of a --repo-root spelled through a link above it, under which a run was staged before stage 1c, is still asked.
  // Only a spelling of this same repository counts: one whose real path is another is dropped.
  // Decided by sameRepoSpellings, the rule repoRunRoots asks too (G-6 of 20261118-142344-cpi-remediation-2-review).
  const extra = sameRepoSpellings({ repoRoot, repoSpellings, io });
  const roots = [...new Set([...new Set([absolute(repoRoot, 'admitRun: repoRoot'), repo, ...extra])]
    .flatMap((r) => repoRunRoots({ repoRoot: r, project, home, declaredReviewsDir, io })).map(resolved))];
  if (!roots.some((r) => within(r, dir))) {
    return refuse('repository', `${dir} is not one of ${repo}'s runs: it is in none of ${[...new Set(roots)].join(', ')}`);
  }
  // A RECORD THAT PREDATES repo_root (sixty archived runs here) names no other repository: its location, checked above,
  // is the evidence, and every caller acts on the repository returned, never on the field. A repo_root that IS there must
  // name this repository.
  if (record.repo_root === undefined) return { ok: true, dir, repoRoot: repo, record, where: placed.where, repository: repo };
  let recorded = null;
  if (typeof record.repo_root === 'string' && record.repo_root.trim() && path.isAbsolute(record.repo_root)) {
    try { recorded = real(record.repo_root); } catch { recorded = null; }
  }
  if (recorded === null || fold(recorded) !== fold(repo)) {
    return refuse('repository', `${record.run_id} names repo_root ${JSON.stringify(record.repo_root ?? null)}, not ${repo}, the `
      + 'repository this command runs for');
  }
  return { ok: true, dir, repoRoot: repo, record, where: placed.where, repository: repo };
}
