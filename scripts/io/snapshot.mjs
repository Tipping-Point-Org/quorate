// The directory an external reviewer reads, built from a SNAPSHOT of the working state
// (.claude/requests/arms-read-surface.md; plan Stage 2). It replaced a `git worktree` checkout that was
// patched, mirrored, and then searched for links leading out — a search that missed another kind of
// path in each of three review rounds.
//
// Steps, as the plan records them after its Stage 0 probes:
//   0. Size cap (operator: "size cap A"): list the untracked and modified paths — paths only, no
//      contents read — and sum their sizes. Over the cap, refuse before anything is read.
//   1. Snapshot into a THROWAWAY index and object directory, the repository's own store a read-only
//      alternate: `read-tree <head>`, `add -A`, `write-tree`. The operator's index and object store are
//      not touched (criterion 3).
//   2. Judge every entry at its source (lib/snapshot-surface.mjs) and take out what must not be shown:
//      left out and named, never a refused snapshot.
//   3. `checkout-index` into a fresh directory with core.symlinks=false.
//   4. Its OWN repository, made with no template: a filtered STAND-IN for the base (excluded roots,
//      withheld entries and every link entry removed) installed under the base's id by a replace ref,
//      plus the snapshot commit on top, so `git diff <base>` works for the arm as it does for the lens
//      (operator: "option 1"). No fetch, so nothing records the source repository's path.
//   5. `beforeAssert(dir)` for the caller's additions (the framework copy), then the assertion: no link
//      and no hard link anywhere in the directory.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judgeSnapshotEntries, SYMLINK_MODE, gitFailureWhy, vanishedDuringAdd, ADD_ATTEMPTS } from '../lib/snapshot-surface.mjs';
import { isWithin } from '../lib/finding-scope.mjs';
import { gitSync } from './git.mjs';
import { hardLinkReason } from '../lib/egress-read.mjs';

const BIG = 1 << 30;   // no listing this builder runs may fail on output size (criterion 2)
const REGULAR_FILE_MODES = new Set(['100644', '100755']);
const posix = (p) => p.split(path.sep).join('/');
const IDENTITY = { GIT_AUTHOR_NAME: 'quorate', GIT_AUTHOR_EMAIL: 'quorate@localhost', GIT_COMMITTER_NAME: 'quorate', GIT_COMMITTER_EMAIL: 'quorate@localhost' };

// Exported as the default of buildArmsSurface's `runGit` seam, so a test can fail one step on purpose.
// `maxBuffer` is a parameter so a test can prove the cap is honoured with a few files, not 12,000 (test-suite-cost.md).
export function git(cwd, args, { env = {}, input, maxBuffer = BIG } = {}) {
  const r = gitSync(args, { cwd, input, maxBuffer, gitVars: { GIT_LITERAL_PATHSPECS: '1', ...env } });
  if (r.error) return { ok: false, why: `git ${args[0]}: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, why: gitFailureWhy(args, r.status, r.stderr) };
  return { ok: true, out: r.stdout };
}
// NAMES ARE BYTES (G-2 of 20260927-052117-ars-r3). Decoding a listing as UTF-8 turned a legal POSIX name
// that is not UTF-8 into a different string, and the removal fed back to git then matched nothing: the
// build was refused and the run lost its panel. Lists stay Buffers; a name is decoded only when it
// survives the round trip, and one that does not is left out and named, removed by its own bytes.
const nulRaw = (buf) => {
  const out = []; let s = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0) { if (i > s) out.push(buf.subarray(s, i)); s = i + 1; }
  if (s < buf.length) out.push(buf.subarray(s));
  return out;
};
const utf8 = (b) => { const s = b.toString('utf8'); return Buffer.from(s, 'utf8').equals(b) ? s : null; };
const pathspecs = (raws) => Buffer.concat(raws.flatMap((r, i) => (i ? [Buffer.from([0]), r] : [r])));

/**
 * Where one build of a run's arms' directory goes: a fresh name under the run's arms root (`armsRoot`, under quorate's
 * own home). Unique to the build, so a directory an earlier attempt left never refuses this one (G-4 of
 * 20261003-171229-arms-dir-ownership-confirm); the root is the run's, so a resume reclaims it whole.
 */
export function armsBuildDir(root) {
  return path.join(root, crypto.randomBytes(6).toString('hex'));
}

/**
 * Remove the run's arms root — every build an earlier attempt of the run left. It lives under quorate's own home, so it
 * is the run's by location (arms-directory-home.design.md): no record names what to remove, so none can fail to parse
 * or disagree with the name (G-2, G-3, G-5 of 20261003-183350-arms-dir-ownership-confirm-3). A removal that fails is
 * reported: cleanup never throws into the run.
 *
 * EVERY COMPONENT BELOW THE HOME IS CHECKED (G-5 of 20261003-194617-arms-dir-home-confirm): only the root was, so a
 * link at an ancestor — `<home>/arms` — was followed and the matching subtree under its target removed. A root outside
 * the home, or a link or non-directory at any level BELOW the home, is refused; the caller builds nothing there.
 *
 * THE HOME ITSELF IS TRUSTED, AS DECLARED (G-6 of 20261003-202230-arms-dir-home-confirm-2): QUORATE_HOME is the
 * operator's chosen location and may be a link to another drive, so it is followed; refusing one would leave that
 * operator with no panel. This comment once promised the home itself was checked too. Containment is
 * asked of isWithin, its one owner.
 * @returns {{ removed: boolean, refused?: string, failed?: string }}
 */
export function reclaimArmsRoot(root, { home, rm = (p) => fs.rmSync(p, { recursive: true, force: true }) } = {}) {
  const h = path.resolve(home), r = path.resolve(root);
  if (r === h || !isWithin(h, r)) return { removed: false, refused: `${root} is outside quorate's home` };
  const rel = path.relative(h, r);
  let at = path.resolve(home);
  for (const part of rel.split(path.sep)) {
    at = path.join(at, part);
    let st;
    try { st = fs.lstatSync(at); } catch (e) {
      return e.code === 'ENOENT' ? { removed: false } : { removed: false, failed: e.message };
    }
    if (st.isSymbolicLink()) return { removed: false, refused: `${at} is a link (a link is never followed)` };
    if (!st.isDirectory()) return { removed: false, refused: `${at} is not a directory` };
  }
  try { rm(root); return { removed: true }; } catch (e) { return { removed: false, failed: e.message }; }
}

/**
 * Build the arms' directory at `dir` (which must not exist). `onCreated(dir)` is called once, when the build has
 * created it exclusively: from then on it is the caller's to remove, and never before.
 * @returns {{ ok: boolean, why?: string, dir?: string, withheld: Array<{path:string, why:string}>, bytes?: bigint }}
 */
export function buildArmsSurface({ repoRoot, headCommit, baseCommit, dir, exclude = [], maxBytes, beforeAssert = null, afterCapture = null, onCreated = null, runGit = git, listingMaxBuffer = BIG }) {
  // EVERY GIT CALL HERE CARRIES THE LISTING CAP (G-1 of 20261012-054024-test-cost-review): the cap is a parameter so a test
  // proves it with a few files (test-suite-cost.md), and a call that bypassed it would be the original defect again.
  // Through the runGit seam, so a test can see the cap on EVERY call (G-9 of 20261012-060750-test-cost-r2): a tiny cap
  // fails at the first call and never reaches the rest.
  const g = (cwd, args, opts = {}) => runGit(cwd, args, { maxBuffer: listingMaxBuffer, ...opts });
  const withheld = [];
  const fail = (why) => ({ ok: false, why, withheld });
  if (maxBytes !== null && typeof maxBytes !== 'bigint') return fail('buildArmsSurface: maxBytes must be a bigint, or null for uncapped');
  if (fs.existsSync(dir)) return fail(`buildArmsSurface: ${dir} already exists`);
  const repo = path.resolve(repoRoot);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-snapshot-'));
  try {
    // 0. size cap, from paths alone
    const others = g(repo, ['ls-files', '--others', '--exclude-standard', '-z']);
    const modified = g(repo, ['ls-files', '--modified', '-z']);
    // Staged changes too: a file already added is "modified" against HEAD but not against the index,
    // and `add -A` still takes it. Compares object ids only, so it reads no contents either.
    const staged = g(repo, ['diff', '--cached', '--name-only', '-z', headCommit]);
    for (const r of [others, modified, staged]) if (!r.ok) return fail(r.why);
    let bytes = 0n;
    const seen = new Set();
    const repoPrefix = Buffer.from(repo + path.sep);
    for (const raw of [...nulRaw(others.out), ...nulRaw(modified.out), ...nulRaw(staged.out)]) {
      const key = raw.toString('latin1');
      if (seen.has(key)) continue;
      seen.add(key);
      try { bytes += fs.lstatSync(Buffer.concat([repoPrefix, raw]), { bigint: true }).size; } catch { /* deleted since listed */ }
      if (maxBytes !== null && bytes > maxBytes) return fail(`the working state's changed and untracked files exceed the ${maxBytes}-byte cap — a linked directory may lead to a large tree outside the repository`);
    }

    // 1. snapshot into a throwaway index and object store
    // THE STORE IS WHERE GIT SAYS IT IS (G-4 of 20260927-012913-arms-read-surface). `<repo>/.git/objects`
    // exists only when .git is a directory; in a linked worktree or a submodule it is a FILE, the alternate
    // pointed at nothing, and the run lost its panel.
    const common = g(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (!common.ok) return fail(common.why);
    const env = { GIT_INDEX_FILE: path.join(work, 'index'), GIT_OBJECT_DIRECTORY: path.join(work, 'objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(common.out.toString().trim(), 'objects') };
    fs.mkdirSync(env.GIT_OBJECT_DIRECTORY);
    // Only roots INSIDE the repository, asked of isWithin, containment's one owner (G-3 of 20261012-073027-g4-exclude-
    // review). A spelled-out `startsWith('..')` dropped an in-repo root NAMED `..private`, which then never reached
    // `:(exclude)` and leaked to the arms (G-4 of 20261012-063656-test-cost-r3). The repository itself is no exclude.
    // REAL PATHS, NOT SPELLINGS (G-3 of 20261012-181312-g4-exclude-r2): a lexical comparison is case-sensitive, so on a
    // case-insensitive filesystem an exclude spelled in another case was judged outside and dropped, and its root
    // leaked. `realpathSync.native` gives the on-disk case and resolves links. A root is kept when either its spelling
    // or its real path is inside: when in doubt, exclude more.
    const realOf = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
    const repoAbs = path.resolve(repo);
    const repoReal = realOf(repoAbs) ?? repoAbs;
    const inside = (abs) => {
      const real = realOf(abs);
      return (abs !== repoAbs && isWithin(repoAbs, abs)) || (real !== null && real !== repoReal && isWithin(repoReal, real));
    };
    // The pathspec is relative to the repository, from the real path when that is inside (it carries the on-disk case),
    // else from the spelling.
    const relOf = (abs) => {
      const real = realOf(abs);
      return posix(real !== null && isWithin(repoReal, real) ? path.relative(repoReal, real) : path.relative(repoAbs, abs));
    };
    const excludedRels = exclude.map((e) => path.resolve(repo, e)).filter(inside).map(relOf);
    // An exclude naming a path git already ignores makes `git add` exit 1 (Stage 0); those need no exclude.
    const toExclude = excludedRels
      .filter((rel) => gitSync(['check-ignore', '-q', '--', rel], { cwd: repo }).status !== 0);
    // A FILE THAT VANISHES MID-ADD IS RETRIED, from a fresh index (lib/snapshot-surface.mjs's vanishedDuringAdd): the
    // working tree moved under git, and failing there cost every arm its directory. Bounded, and any other failure, or
    // a tree still moving on the last attempt, fails closed with git's own error.
    for (let attempt = 1; ; attempt++) {
      let failed = null;
      for (const step of [['read-tree', headCommit], ['add', '-A', '--', '.', ...toExclude.map((e) => `:(exclude)${e}`)]]) {
        // The exclude magic needs pathspec parsing, so literal pathspecs are off for `add` alone.
        const r = runGit(repo, step, { maxBuffer: listingMaxBuffer, env: step[0] === 'add' ? { ...env, GIT_LITERAL_PATHSPECS: '0' } : env });
        if (!r.ok) { failed = r.why; break; }
      }
      if (!failed) break;
      if (!vanishedDuringAdd(failed) || attempt >= ADD_ATTEMPTS) {
        return fail(attempt > 1 ? `${failed} (after ${attempt} attempts; the working tree kept changing)` : failed);
      }
    }
    // Every `git rm --cached` here is FORCED (-f): it keeps its safety check even on a throwaway index, and
    // refused a tracked file whose version differed at the base, at HEAD and on disk — the ledger — which
    // cost review 20260927-033113-ars-r2 its panel. A throwaway index has nothing to lose.
    //
    // AN EXCLUDED ROOT IS EXCLUDED WHOLE (G-5 of the same review): `read-tree` seeded the index with every
    // TRACKED file under it, and the exclusions above applied only to `add`.
    for (const rel of excludedRels) {
      const r = g(repo, ['rm', '-r', '-q', '-f', '--cached', '--ignore-unmatch', '--', rel], { env });
      if (!r.ok) return fail(r.why);
    }
    let tree = g(repo, ['write-tree'], { env });
    if (!tree.ok) return fail(tree.why);
    // A test seam: what the working tree does between capture and judgement (G-3 of 20260927-200901-ars-r5).
    if (afterCapture) afterCapture(repo);

    // 2. judge each entry at its source; take out what must not be shown
    const listing = g(repo, ['ls-tree', '-r', '-z', tree.out.toString().trim()], { env });
    if (!listing.ok) return fail(listing.why);
    const realRepoRoot = fs.realpathSync(repo);
    // WHAT GIT SAW WHEN IT CAPTURED EACH FILE (G-3 of 20260927-200901-ars-r5). The judge looks at the
    // working tree AFTER `git add -A` took its bytes, so a file changed in between — a hard link to an
    // outside file replaced by an ordinary one — was judged as it is now while the arm was shown what it
    // was then. The index records each captured file's size, mtime and (where the platform gives one)
    // inode; a file that no longer matches, or whose details cannot be read, is left out and named.
    // Windows records no inode, so there the match rests on size and mtime to the nanosecond: a swap
    // that restores both exactly still passes there — it needs write access to the operator's tree,
    // timed between two git calls.
    const debug = g(repo, ['ls-files', '--debug', '-z'], { env });
    if (!debug.ok) return fail(debug.why);
    const captured = new Map();
    for (let i = 0; i < debug.out.length;) {
      const nul = debug.out.indexOf(0, i);
      if (nul < 0) break;
      const key = debug.out.subarray(i, nul).toString('latin1');
      let j = nul + 1;
      const lines = [];
      for (let k = 0; k < 5; k++) { const nl = debug.out.indexOf(10, j); lines.push(debug.out.subarray(j, nl).toString()); j = nl + 1; }
      const text = lines.join('\n');
      const mt = /mtime: (\d+):(\d+)/.exec(text);
      captured.set(key, { mtime: BigInt(mt[1]), mtimeNs: BigInt(mt[2]), ino: BigInt(/ino: (\d+)/.exec(text)[1]), size: BigInt(/size: (\d+)/.exec(text)[1]) });
      i = j;
    }
    const U32 = 0xffffffffn;   // the index keeps inode and size in 32 bits
    const changedSinceCapture = (raw, st) => {
      const c = captured.get(raw.toString('latin1'));
      if (!st || !c) return true;
      // To the nanosecond where git recorded one: whole seconds let a same-size swap inside the same
      // second through on Windows, where there is no inode to compare (found claim-checking this fix).
      const sameTime = st.mtimeNs / 1_000_000_000n === c.mtime && (c.mtimeNs === 0n || st.mtimeNs % 1_000_000_000n === c.mtimeNs);
      return (st.size & U32) !== c.size || !sameTime || (c.ino !== 0n && (st.ino & U32) !== c.ino);
    };
    const undecodable = [];
    const changed = [];
    const entries = nulRaw(listing.out).flatMap((line) => {
      const tab = line.indexOf(9);
      const mode = /^(\d+) /.exec(line.subarray(0, tab).toString())[1];
      const raw = line.subarray(tab + 1);
      const rel = utf8(raw);
      if (rel === null) { undecodable.push(raw); return []; }
      const abs = path.join(repo, ...rel.split('/'));
      let real = null; let st = null;
      try { real = fs.realpathSync(abs); } catch { /* unresolvable */ }
      try { st = fs.lstatSync(abs, { bigint: true }); } catch { /* gone */ }
      // Only content git read from disk is at stake: a link entry is withheld by the judge, and a
      // submodule is a pointer, not bytes.
      if (REGULAR_FILE_MODES.has(mode) && changedSinceCapture(raw, st)) { changed.push(rel); return []; }
      return { path: rel, mode, real, dev: String(st?.dev ?? 0n), ino: String(st?.ino ?? 0n), nlink: String(st?.nlink ?? 1n) };
    });
    // A link into an EXCLUDED root is as bad as one out of the repository (G-14b of the same review): a
    // junction to a run's evidence stays inside the repository and got past the exclusions.
    const excludedRealRoots = excludedRels.map((rel) => {
      const abs = path.join(repo, ...rel.split('/'));
      try { return fs.realpathSync(abs); } catch { return path.resolve(realRepoRoot, ...rel.split('/')); }
    });
    const verdict = judgeSnapshotEntries({ realRepoRoot, entries, excludedRealRoots });
    withheld.push(...verdict.withheld);
    for (const raw of undecodable) withheld.push({ path: raw.toString('utf8'), why: 'its name is not valid UTF-8, so it cannot be judged at its source' });
    for (const rel of changed) withheld.push({ path: rel, why: 'it changed after git captured it, or its details could not be read, so what was captured cannot be judged' });
    // Removed by their own bytes: a decoded name would match nothing for an undecodable one.
    const withheldRaw = [...verdict.withheld.map((w) => Buffer.from(w.path, 'utf8')), ...changed.map((p) => Buffer.from(p, 'utf8')), ...undecodable];
    if (withheldRaw.length) {
      const rm = g(repo, ['rm', '-q', '-f', '--cached', '--pathspec-from-file=-', '--pathspec-file-nul'],
        { env, input: pathspecs(withheldRaw) });
      if (!rm.ok) return fail(rm.why);
      tree = g(repo, ['write-tree'], { env });
      if (!tree.ok) return fail(tree.why);
    }
    const treeId = tree.out.toString().trim();

    // 3. materialise, links as plain files (none remain after step 2)
    // EXCLUSIVE (G-7 of 20261002-225920-stop-child-confirm): the check at the top is advice, this is the claim. A
    // directory that appeared since is someone else's: refused, never checked out into. `onCreated` is how the caller
    // learns the directory is the run's to remove — and the only way, so it never removes one it did not make.
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    try { fs.mkdirSync(dir); } catch (e) {
      if (e.code === 'EEXIST') return fail(`buildArmsSurface: ${dir} already exists`);
      throw e;
    }
    if (onCreated) onCreated(dir);
    const co = g(repo, ['-c', 'core.symlinks=false', 'checkout-index', '-a', `--prefix=${posix(path.resolve(dir))}/`], { env });
    if (!co.ok) return fail(co.why);

    // 4. its own repository: the snapshot committed on top of the base, so `git diff <base>` works for the
    // arm as for the lens (operator: "option 1").
    //
    // THE BASE IS FILTERED TOO (G-4 of 20260927-021924-ars-r1). It was fetched whole, so what the
    // exclusions keep out of view — tracked past runs — was readable with `git show <base>:<path>`. The
    // base's tree is taken with the same excluded roots removed, committed as a STAND-IN, and installed
    // under the base's own id with a replace ref (refs/replace/<base>): the arm names the id it was told,
    // git hands it the stand-in, and the real base commit is never copied in. No fetch, so nothing in the
    // new repository records the source's path either (FETCH_HEAD did).
    const resolvedBase = g(repo, ['rev-parse', '--verify', `${baseCommit}^{commit}`]);
    if (!resolvedBase.ok) return fail(resolvedBase.why);
    const baseId = resolvedBase.out.toString().trim();
    const baseEnv = { ...env, GIT_INDEX_FILE: path.join(work, 'base-index') };
    const baseSteps = [['read-tree', baseId], ...excludedRels.map((rel) => ['rm', '-r', '-q', '-f', '--cached', '--ignore-unmatch', '--', rel])];
    for (const step of baseSteps) {
      const r = g(repo, step, { env: baseEnv });
      if (!r.ok) return fail(r.why);
    }
    // WHAT THE SNAPSHOT LEFT OUT, THE BASE LEAVES OUT (found by claim-checking the ars-r1 remediation):
    // otherwise the arm's `git diff <base>` shows every left-out entry as deleted — the class G-5 fixed
    // for submodules — and the base still presents it.
    //
    // AND NO LINK ENTRY AT ALL (G-4 of 20260927-052117-ars-r3): the snapshot judges only what the working
    // state still has, so a link the base holds and the working state deleted was never withheld, and its
    // target text stayed readable with `git show <base>:<path>`. Every 120000 entry of the base goes.
    const baseListing = g(repo, ['ls-files', '-s', '-z'], { env: baseEnv });
    if (!baseListing.ok) return fail(baseListing.why);
    const baseLinks = nulRaw(baseListing.out).filter((l) => l.subarray(0, SYMLINK_MODE.length + 1).toString() === `${SYMLINK_MODE} `)
      .map((l) => l.subarray(l.indexOf(9) + 1));
    const baseDrop = [...withheldRaw, ...baseLinks];
    if (baseDrop.length) {
      // -r: a path withheld as a LINK in the snapshot can be a DIRECTORY at the base (a tracked directory
      // replaced by a link out); without it the build was refused on POSIX and the run lost its panel.
      const r = g(repo, ['rm', '-r', '-q', '-f', '--cached', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul'],
        { env: baseEnv, input: pathspecs(baseDrop) });
      if (!r.ok) return fail(r.why);
    }
    const baseTree = g(repo, ['write-tree'], { env: baseEnv });
    if (!baseTree.ok) return fail(baseTree.why);
    const standIn = g(repo, ['commit-tree', baseTree.out.toString().trim(), '-m', 'the base commit, with the directories excluded from the arms removed'], { env: { ...env, ...IDENTITY } });
    if (!standIn.ok) return fail(standIn.why);
    const standInId = standIn.out.toString().trim();
    const commit = g(repo, ['commit-tree', treeId, '-p', baseId, '-m', 'the working state under review'], { env: { ...env, ...IDENTITY } });
    if (!commit.ok) return fail(commit.why);
    const commitId = commit.out.toString().trim();
    // The stand-in with all its objects, and the snapshot commit with its tree — NOT its parent chain.
    const baseObjects = g(repo, ['rev-list', '--objects', standInId], { env });
    const snapObjects = g(repo, ['rev-list', '--objects', '--no-walk', commitId], { env });
    for (const r of [baseObjects, snapObjects]) if (!r.ok) return fail(r.why);
    const objects = { out: Buffer.concat([baseObjects.out, snapObjects.out]) };
    // NO TEMPLATE (G-7 of 20260927-052117-ars-r3): `init` copies init.templateDir / GIT_TEMPLATE_DIR into
    // .git, and a template is the operator's, not the snapshot's. An empty --template copies nothing.
    const init = g(dir, ['init', '-q', '--template=']);
    if (!init.ok) return fail(init.why);
    // THROUGH A FILE, NOT MEMORY (G-7 of the same review): `--stdout` held the whole pack in this process
    // between two git processes. pack-objects writes <base>-<hash>.pack and .idx; both go straight into
    // the new repository's pack directory.
    const packBase = path.join(work, 'snapshot');
    const pack = g(repo, ['pack-objects', '-q', packBase], { env, input: objects.out });
    if (!pack.ok) return fail(pack.why);
    const packHash = pack.out.toString().trim();
    const packDir = path.join(dir, '.git', 'objects', 'pack');
    fs.mkdirSync(packDir, { recursive: true });
    for (const ext of ['pack', 'idx']) fs.copyFileSync(`${packBase}-${packHash}.${ext}`, path.join(packDir, `pack-${packHash}.${ext}`));
    // REPLACE REFS PINNED ON (G-6 of 20260927-052117-ars-r3): the base reaches the arm only through the
    // replace ref, and a global `core.useReplaceRefs=false` cost the arm its diff with nothing recorded.
    // The repository's own config outranks the global one. (GIT_NO_REPLACE_OBJECTS outranks both, and is
    // not among the variables a reviewer inherits — lib/decisions.mjs reviewerEnv.)
    for (const step of [['update-ref', 'HEAD', commitId], ['update-ref', `refs/replace/${baseId}`, standInId],
      ['config', 'core.useReplaceRefs', 'true'], ['read-tree', 'HEAD']]) {
      const r = g(dir, step);
      if (!r.ok) return fail(r.why);
    }

    // 5. the caller's additions, then: nothing in the directory is a link or a hard link
    if (beforeAssert) {
      const added = beforeAssert(dir);
      if (added && added.ok === false) return fail(added.why);
    }
    const bad = [];
    // .git INCLUDED (G-7 of the same review): the arm reads the whole directory, its repository too.
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) bad.push(`${p} is a link`);
      else if (e.isDirectory()) walk(p);
      else if (hardLinkReason(fs.lstatSync(p, { bigint: true }))) bad.push(`${p} is a hard link`);   // the one single-path rule
    } };
    walk(dir);
    if (bad.length) return fail(`the finished directory holds what it must not: ${bad.slice(0, 3).join('; ')}`);
    return { ok: true, dir, withheld, bytes };
  } catch (e) {
    return fail(`buildArmsSurface: ${e.message}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
