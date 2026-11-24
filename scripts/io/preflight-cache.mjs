// THE I/O HALF OF THE PRE-FLIGHT CACHE (os-platform-adapters stage 4), moved out of lib/: hashing
// the files the declared checks read, and reading and writing cache entries. The decisions —
// freshness, stamps, what the key covers — stay pure in lib/preflight-cache.mjs, re-exported here
// so a caller imports one module.
import path from 'node:path';
import crypto from 'node:crypto';
import { gitSync } from './git.mjs';
import { hostFs as fs } from '../platform/index.mjs';
import { expandGlob, hashFiles } from './glob-walk.mjs';
import { unsafeSegment, confined } from './confined-path.mjs';
import { hardLinkReason, hardLinkRefused } from '../lib/egress-read.mjs';
import { isWithin, canonicalSpelling, firstLeadingOut, LEADS_OUT_KIND } from './finding-scope.mjs';
import { MANIFEST_HEURISTIC, PREFLIGHT_COMMAND_KEYS, preflightCachePath, preflightEvidenceDir, preflightEvictions } from '../lib/preflight-cache.mjs';

export * from '../lib/preflight-cache.mjs';

/**
 * WHICH FILES THE DECLARED CHECKS READ.
 *
 * Declared wins and is exact. Inferred is the fallback and says so — `inferred: true` travels with
 * the set and becomes a stamp, because the difference between "we read the set" and "we guessed it"
 * has to survive into the verdict.
 *
 * `contractSource` is always an input: the commands themselves live there, and so do the globs that
 * decide what else counts.
 */
export function preflightInputSet({ repoRoot, contract = {}, contractSource = null, reviewsDir = null, listingMaxBuffer = 1 << 30 }) {
  const root = path.resolve(repoRoot);
  const declared = (contract.review?.preflight_inputs ?? [])
    .map((g) => String(g ?? '').trim())
    .filter(Boolean);

  // The reviews directory is generated output, never an input. Pruned during the walk rather than
  // filtered after it, for the reason glob-walk.mjs records (G-25).
  const reviewsAbs = reviewsDir ? path.resolve(reviewsDir) : null;
  // THROUGH THE OWNER (G-11 of 20261029-201447-rdr-remediation-review): a local startsWith did not fold case, so on a
  // filesystem that does, a reviews folder spelled in another case than the walk found it was not pruned.
  const prune = (abs) => Boolean(reviewsAbs) && isWithin(reviewsAbs, abs);

  const files = new Set();
  const add = (globs) => { for (const g of globs) for (const f of expandGlob(root, g, prune)) files.add(f); };

  const inferred = declared.length === 0;
  if (!inferred) {
    add(declared);
  } else {
    add([...(contract.source_globs ?? []), ...(contract.test_globs ?? [])].map((g) => String(g ?? '').trim()).filter(Boolean));
    for (const name of MANIFEST_HEURISTIC) {
      const p = path.join(root, name);
      if (fs.existsSync(p)) files.add(p);
    }
  }
  if (contractSource) files.add(path.resolve(root, contractSource));

  // GIT'S FILE LIST, NOT THE FOLDER (preflight-reuse-by-hash; operator, 2026-10-12: "Git's file list (Recommended)"). The
  // globs walk the disk, so an IGNORED file under one counted: the suite runner's own tests/.run-all-tap-*.txt, left by
  // a killed run, changed the hash and the next review re-ran everything. Tracked plus untracked-not-ignored is what the
  // checks can be said to read; a new untracked test still counts, so a result is never reused for a test it did not
  // run. When git cannot list the tree, the walk stands and `listedBy` says so, and the dirty rule then applies.
  //
  // THE CAP IS A PARAMETER (G-3 of 20261012-031702-preflight-reuse-review): spawnSync's default maxBuffer is 1 MiB, and
  // past it the listing died and silently fell back to the walk. A caller may lower it to prove the call uses it.
  // SUBMODULES (G-4): git lists one as a single gitlink entry (mode 160000), never the files inside, so those fell out of
  // the set and an edit inside one reused a stale result. A walked file under a gitlink stays an input.
  //
  // EVERY REPOSITORY LISTS ITS OWN FILES, ALL THE WAY DOWN (G-2 of 20261012-035748-preflight-reuse-r2; G-4 of
  // 20261012-042500-preflight-reuse-r3). A submodule's ignored files are not inputs, and neither level of a nested
  // submodule may fall out of the set: two patches, each one level deep, drew a MEDIUM a level lower. A gitlink whose
  // directory is a repository of its own is listed by that repository, recursively. A gitlink with no repository behind
  // it (not checked out) keeps the walk under it, the conservative side: more inputs, never fewer.
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const gitIn = (dir, args) => gitSync(args, { cwd: dir, encoding: 'utf8', maxBuffer: listingMaxBuffer });
  const isOwnRepo = (dir) => {
    const top = gitIn(dir, ['rev-parse', '--show-toplevel']);
    if (top.status !== 0) return false;
    // ONE FOLDER HOWEVER IT IS SPELLED (CI run 43281517496): git reports its toplevel long, and a directory under an 8.3
    // short name (a Windows runner's TEMP) compared unequal, so every submodule was walked and its ignored files hashed.
    const a = canonicalSpelling(path.resolve(top.stdout.trim()));
    const b = canonicalSpelling(path.resolve(dir));
    return isWithin(a, b) && isWithin(b, a);
  };
  // { known, walked } for the repository at `dir`, its paths prefixed by `prefix`; null when git cannot list it.
  const listRepo = (dir, prefix, depth) => {
    const listed = gitIn(dir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    const staged = listed.status === 0 ? gitIn(dir, ['ls-files', '-z', '-s']) : null;
    if (listed.status !== 0 || staged?.status !== 0) return null;
    const known = new Set(listed.stdout.split('\0').filter(Boolean).map((p) => `${prefix}${p}`));
    const walked = new Set();
    const gitlinks = staged.stdout.split('\0').filter((l) => l.startsWith('160000 ')).map((l) => l.slice(l.indexOf('\t') + 1));
    for (const g of gitlinks) {
      const sub = path.join(dir, g);
      const inner = depth < 32 && fs.existsSync(sub) && isOwnRepo(sub) ? listRepo(sub, `${prefix}${g}/`, depth + 1) : null;
      if (!inner) { walked.add(`${prefix}${g}`); continue; }
      for (const k of inner.known) known.add(k);
      for (const w of inner.walked) walked.add(w);
    }
    return { known, walked };
  };
  const listing = listRepo(root, '', 0);
  const known = listing?.known ?? null;
  // The walked gitlinks spread ONCE, and each file's relative path computed once (G-11 of
  // 20261029-212858-rdr-remediation-2-review): both were rebuilt for every candidate file.
  const walkedPrefixes = listing ? [...listing.walked].map((g) => `${g}/`) : [];
  const listedByGit = (f) => { const r = rel(f); return known.has(r) || walkedPrefixes.some((g) => r.startsWith(g)); };
  const kept = [...files]
    .filter((f) => !(reviewsAbs && isWithin(reviewsAbs, path.resolve(f))))
    .filter((f) => !known || listedByGit(f));

  return {
    files: kept,
    relFiles: kept.map(rel).sort(),
    listedBy: known ? 'git' : 'walk',
    inferred,
    why: inferred
      ? 'review.preflight_inputs is empty, so the set was inferred from source_globs, test_globs, the '
        + 'contract file and any root-level dependency manifest — a declared check may read a file '
        + 'none of those name'
      : 'review.preflight_inputs declares what the pre-flight reads',
  };
}

/**
 * The key an entry is stored under: the input files, plus the DECLARED COMMAND STRINGS.
 *
 * The commands belong in the key because changing `commands.test` changes what the result is a
 * result OF. A cache keyed only on files would serve a `pytest -x` outcome as if it answered for
 * `pytest --cov`, which is a different question with the same tree.
 */
export function preflightInputHash({ repoRoot, contract = {}, contractSource = null, reviewsDir = null }) {
  const set = preflightInputSet({ repoRoot, contract, contractSource, reviewsDir });
  const h = crypto.createHash('sha256');
  // Version the key. A change to WHAT goes into the hash must invalidate every existing entry, or a
  // pre-change entry would be read under post-change rules and match by accident.
  // v2 (check-outcomes.plan.md stage 3): results carry `outcome`, and a check that did not run to its own end is no
  // longer cached; a v1 entry, read under these rules, could replay a timed-out build as BLOCKED.
  h.update('preflight-v2\0');
  for (const k of PREFLIGHT_COMMAND_KEYS) {
    h.update(k);
    h.update('\0');
    h.update(String(contract.commands?.[k] ?? '').trim());
    h.update('\0');
  }
  hashFiles(h, path.resolve(repoRoot), set.files);
  return { hash: h.digest('hex'), inferred: set.inferred, why: set.why, file_count: set.files.length,
    listedBy: set.listedBy, relFiles: set.relFiles };
}

/**
 * Returns the cached entry, or null.
 *
 * A malformed entry is treated as ABSENT, never as valid — the same rule readIntentCache holds, and
 * for a sharper reason here: a half-written entry that parsed would let a run claim evidence it
 * does not have.
 */
// The file in a cached evidence folder naming the writer that copied it (G-5); never restored into a run.
const EVIDENCE_WRITER_MARK = '.quorate-cache-writer';

export function readPreflightCache(reviewsDir, hash) {
  try {
    // THROUGH THE OWNER (G-10 of 20261122-193909-llo-delivery): a raw read followed a link at .preflight-cache or at the
    // entry, so a JSON from outside the reviews root could stand in for a cached result. Refused, it reads as absent.
    const segs = path.relative(reviewsDir, preflightCachePath(reviewsDir, hash)).split(path.sep);
    const entry = JSON.parse(confined(reviewsDir).read(segs));
    if (!entry || typeof entry !== 'object') return null;
    if (typeof entry.input_sha256 !== 'string' || !entry.input_sha256) return null;
    if (!Array.isArray(entry.results)) return null;
    // THE JSON NAMES THE EVIDENCE COPY IT WAS WRITTEN WITH (G-5 of 20261122-214154-llo-remediation-2-review): two writers
    // of one hash published evidence and JSON separately, so one writer's results could stand beside the other's logs.
    // An entry whose evidence is another writer's copy reads as absent: a re-run, never a mismatched citation.
    if (entry.evidence_writer !== undefined) {
      const evSegs = path.relative(reviewsDir, preflightEvidenceDir(reviewsDir, hash)).split(path.sep);
      // Evidence that is gone is still a valid result whose gap the gate names (restorePreflightEvidence); evidence that
      // is present and not this JSON's copy is not.
      const own = confined(reviewsDir);
      if (own.exists(evSegs)) {
        let mark = null;
        try { mark = String(own.read([...evSegs, EVIDENCE_WRITER_MARK])); } catch { /* unmarked: not this JSON's copy */ }
        if (mark !== entry.evidence_writer) return null;
      }
    }
    return entry;
  } catch {
    return null;
  }
}

/**
 * THE CACHE CARRIES ITS EVIDENCE, or the reuse is a claim with a dangling citation.
 *
 * Each result in a reused `checks.json` names an `evidence_path` like
 * `evidence/pre-flight/build.log`. Relative to the REUSING run that file does not exist, and for an
 * entry seeded by `preflight.mjs` it exists nowhere at all — the seeder removes its own scratch
 * directory. So a reused run inherited the stamps a log produced (TESTS-THIN, TESTS-FAILING,
 * TESTS-UNCOUNTED) while the log itself was gone, which is this project's central complaint about
 * everyone else's tooling pointed at itself.
 *
 * Copying it in makes a reused run show exactly what a fresh one shows. The residual, named: the
 * cache grows by one copy of the captured output per distinct input set. It is machine-local, it is
 * ignored (REVIEWS_IGNORE_TEXT), and deleting `.preflight-cache/` costs one re-run.
 */
// A directory below a run copied out, through its owner: every entry stat'ed after the walk, a link refused, a
// directory descended, a file read and written into `dest` (a folder of the cache, not of a run).
// JUDGED WHOLE BEFORE IT WRITES (G-11, G-12 of 20261122-193909-llo-delivery): the walk ran with the writes, so a refusal
// found late left the files before it in the cache, and a hard-linked file was copied, its content any file's. The tree
// is listed first, every entry stat'ed through the owner (a link refused there) and every file asked hardLinkReason;
// only a tree with nothing refused is written.
// INTO THE CACHE THROUGH ITS OWNER, STAGED (G-4, G-5 of 20261122-204359-llo-remediation-review): `cache` is the owner of the
// reviews folder and `stage` the segments of a folder of this writer's own, made exclusively below .preflight-cache; the
// caller renames it into place only once the copy has succeeded, so a refused copy never removes the entry's evidence and
// two writers of one hash never share a folder.
function copyOutOfRun(owner, segs, cache, stage) {
  // THE OWNER FIRST (ARCHITECTURE A-30; G-19 of 20261122-193909-llo-delivery), then the walk, which refuses an inward link
  // too: stricter than the owner.
  const out = firstLeadingOut(owner.resolve(segs), { leaving: true });
  if (out) {
    throw Object.assign(new Error(`confined path refused: ${[...segs, out.path].join('/')} in the run is `
      + `${LEADS_OUT_KIND[out.kind] ?? out.kind}; nothing of the evidence is copied into the cache`), { code: 'ECONFINED', path: out.path });
  }
  const dirs = [[]];
  const files = [];
  const judge = (rel) => {
    for (const name of owner.list([...segs, ...rel])) {
      const here = [...rel, name];
      const st = owner.stat([...segs, ...here]);
      if (st.isDirectory()) { dirs.push(here); judge(here); } else if (st.isFile()) {
        if (hardLinkReason(st)) throw hardLinkRefused([...segs, ...here].join('/'), st);
        files.push(here);
      } else {
        // Not a regular file or a directory (G-3 of 20261122-204359-llo-remediation-review): refused, never dropped.
        throw Object.assign(new Error(`confined path refused: ${[...segs, ...here].join('/')} in the run is not a regular file, `
          + 'a directory or a link; nothing of the evidence is copied into the cache'), { code: 'ECONFINED', path: here.join('/') });
      }
    }
  };
  judge([]);
  cache.dirNew(stage);
  try {
    for (const d of dirs) if (d.length) cache.dir([...stage, ...d]);
    for (const f of files) cache.replace([...stage, ...f], owner.read([...segs, ...f], null));
  } catch (e) {
    try { cache.remove(stage, { recursive: true }); } catch { /* the copy's error is the one to report */ }
    throw e;
  }
}

// The segments of a cache path below the reviews folder, for its owner.
const cacheSegs = (reviewsDir, p) => path.relative(path.resolve(reviewsDir), path.resolve(p)).split(path.sep);

export function writePreflightCache(reviewsDir, hash, entry, { evidenceFrom = null, maxBytes, onCap = null, rename = (a, b) => fs.renameSync(a, b) } = {}) {
  const p = preflightCachePath(reviewsDir, hash);
  // THE CACHE'S OWN FOLDER THROUGH AN OWNER (G-4 of 20261122-204359-llo-remediation-review; ARCHITECTURE A-30): a raw
  // mkdir, rm and write followed a junction at .preflight-cache, so the documented pre-flight wrote and deleted
  // hash-named entries outside the reviews root. Every write, remove and rename below goes through `cache`.
  // The reviews folder itself is the caller's root, made when missing as before; the owner then refuses a link at it.
  fs.mkdirSync(path.resolve(reviewsDir), { recursive: true });
  const cache = confined(path.resolve(reviewsDir));
  const jsonSegs = cacheSegs(reviewsDir, p);
  cache.dir(jsonSegs.slice(0, -1));
  let writer = null;
  let lostRace = false;
  if (evidenceFrom) {
    // OUT OF THE RUN THROUGH ITS OWNER (run-dir-reads.plan.md stage 3): evidence/pre-flight is two levels below the run,
    // and its copy followed a link at either level or anywhere inside it, so a link planted in the run put a file from
    // outside into the cache, and from there into every run that reused it. Each level is walked; a link is refused.
    // THE CALLER'S OWNER, NOT ONE REBUILT HERE (G-10 of 20261029-224143-rdr-remediation-3-review): `{ owner, segs }`, the
    // owner of the run the caller admitted. A raw path is refused, never wrapped: its root was never admitted.
    if (typeof evidenceFrom?.owner?.exists !== 'function' || !Array.isArray(evidenceFrom.segs)) {
      throw new TypeError('writePreflightCache: evidenceFrom is { owner, segs }, the admitted run\'s owner, not a path');
    }
    const { owner, segs } = evidenceFrom;
    if (owner.exists(segs)) {
      // STAGED, THEN RENAMED (G-5 of 20261122-204359-llo-remediation-review): the destination was removed before the copy
      // judged its source, so a refused copy destroyed valid evidence, and two writers of one hash interleaved their
      // deletes and writes in one folder. The copy fills a folder of this writer's own (its name never matches an entry,
      // which ends in `.evidence`); only a whole copy replaces the entry's evidence, and a refusal leaves it as it was.
      const destSegs = cacheSegs(reviewsDir, preflightEvidenceDir(reviewsDir, hash));
      const stage = [...destSegs.slice(0, -1), `${destSegs.at(-1)}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`];
      copyOutOfRun(owner, segs, cache, stage);
      // This copy's mark, and the JSON below names it (G-5 of 20261122-214154-llo-remediation-2-review).
      writer = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
      try { cache.replace([...stage, EVIDENCE_WRITER_MARK], writer); } catch (e) {
        try { cache.remove(stage, { recursive: true }); } catch { /* the mark's error is the one to report */ }
        throw e;
      }
      // NEVER AN ENTRY CITING ABSENT EVIDENCE (G-3 of 20261122-214154-llo-remediation-2-review): the old evidence was
      // removed before the staged copy was renamed in, so a failed rename or a stop between the two left the old JSON, a
      // reusable entry, citing logs that were gone. The JSON leaves first (readPreflightCache keys on it, so a stop below
      // leaves no entry), the old evidence is renamed aside rather than removed, and a failed rename puts both back.
      const aside = [...destSegs.slice(0, -1), `${destSegs.at(-1)}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.old`];
      const oldJson = cache.exists(jsonSegs) ? cache.read(jsonSegs, null) : null;
      let moved = false;
      try {
        if (oldJson !== null) cache.remove(jsonSegs);
        if (cache.exists(destSegs)) { rename(cache.resolve(destSegs), cache.resolve(aside)); moved = true; }
        rename(cache.resolve(stage), cache.resolve(destSegs));
      } catch (e) {
        try { cache.remove(stage, { recursive: true }); } catch { /* the rename's error is the one to report */ }
        // Another writer of the same hash renamed its whole copy in first. Its evidence is not this writer's (the same
        // inputs do not make the same output: G-4 and G-5 of 20261122-214154-llo-remediation-2-review), so this writer's
        // JSON is not written beside it; the other writer's JSON is the one that names it.
        const raced = ['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(e?.code) && cache.exists(destSegs);
        if (raced) lostRace = true;
        if (!raced) {
          try {
            if (moved) rename(cache.resolve(aside), cache.resolve(destSegs));
            if (oldJson !== null) cache.replace(jsonSegs, oldJson);
            moved = false;
          } catch { /* the rename's error is the one to report */ }
          throw e;
        }
      }
      if (moved) cache.remove(aside, { recursive: true });
    }
  }
  // The JSON lands LAST. readPreflightCache keys on this file, so an interrupted copy above leaves
  // no entry rather than an entry whose evidence is half there. Through the owner's atomic replace, a temporary name
  // of its own per writer, so two runs writing the same entry never share one scratch file.
  if (!lostRace) {
    cache.replace(jsonSegs, `${JSON.stringify({ schema_version: 1, input_sha256: hash, ...entry, ...(writer ? { evidence_writer: writer } : {}) }, null, 2)}\n`);
  }
  // BOUNDED (G-10): after the write, not before, so the entry just paid for is the one kept.
  // `maxBytes` undefined means the caller did not ask for eviction; null means uncapped by declaration.
  if (maxBytes !== undefined) {
    const result = evictPreflightCache(reviewsDir, { maxBytes, keep: hash });
    if (onCap) onCap(result);
  }
  return p;
}

/** Bytes on disk under `p`, a file or a directory. */
function sizeOf(p) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((sum, name) => sum + sizeOf(path.join(p, name)), 0);
}

/**
 * Every entry in the cache, measured: its JSON plus its evidence directory, and when it was last used
 * (the JSON's mtime, which a reuse refreshes). A half-written `.tmp` is not an entry.
 */
function measuredEntries(reviewsDir) {
  const dir = path.dirname(preflightCachePath(reviewsDir, 'x'));
  if (!fs.existsSync(dir)) return [];
  const byHash = new Map();
  for (const name of fs.readdirSync(dir)) {
    const m = /^(.+?)\.(json|evidence)$/.exec(name);
    if (!m) continue;
    const e = byHash.get(m[1]) ?? { hash: m[1], bytes: 0, lastUsed: 0 };
    const full = path.join(dir, name);
    try {
      e.bytes += sizeOf(full);
      if (m[2] === 'json') e.lastUsed = fs.statSync(full).mtimeMs;
    } catch { continue; }   // removed while we looked
    byHash.set(m[1], e);
  }
  return [...byHash.values()];
}

/** Evict least-recently-used entries until the cache fits `maxBytes`; `keep` is never evicted. */
export function evictPreflightCache(reviewsDir, { maxBytes, keep }) {
  const plan = preflightEvictions(measuredEntries(reviewsDir), { maxBytes, keep });
  // Through the reviews folder's owner (G-4 of 20261122-204359-llo-remediation-review): a raw rm followed a junction.
  const cache = plan.evict.length ? confined(path.resolve(reviewsDir)) : null;
  for (const hash of plan.evict) {
    cache.remove(cacheSegs(reviewsDir, preflightCachePath(reviewsDir, hash)));
    cache.remove(cacheSegs(reviewsDir, preflightEvidenceDir(reviewsDir, hash)), { recursive: true });
  }
  return plan;
}

/** A REUSE COUNTS AS A USE (G-10): refresh the entry's recency so least-recently-used means that. */
export function touchPreflightCache(reviewsDir, hash) {
  const now = new Date();
  try { fs.utimesSync(preflightCachePath(reviewsDir, hash), now, now); } catch { /* gone: nothing to refresh */ }
}

/**
 * Restore a reused result's captured output into the run that is citing it.
 *
 * Returns whether every cited path now resolves. A reuse whose evidence could not be restored is
 * still a valid result — the exit codes and counts are in the entry — but the run must not claim
 * otherwise, so the caller records the gap rather than leaving a reader to discover it by ENOENT.
 */
export function restorePreflightEvidence(reviewsDir, hash, runOwner, { cacheFs = fs, cited = [] } = {}) {
  // THE CALLER'S OWNER, NOT ONE BUILT HERE (G-9 of 20261029-235315-rdr-remediation-4-review), as writePreflightCache
  // takes it: the owner of the run the caller admitted. A raw path is refused, never wrapped: its root was never admitted.
  if (typeof runOwner?.create !== 'function' || typeof runOwner?.remove !== 'function') {
    throw new TypeError('restorePreflightEvidence: runOwner is the admitted run\'s owner, not a path');
  }
  const src = preflightEvidenceDir(reviewsDir, hash);
  // THE ENTRY'S OWN ROOT IS LSTAT'ED TOO (G-5 of 20261029-055946-rdd-remediation-review): existsSync followed a link at
  // <hash>.evidence and the walk below read its target, so the check covered only the levels beneath it.
  let rootSt;
  try { rootSt = fs.lstatSync(src); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  if (rootSt.isSymbolicLink()) {
    throw Object.assign(new Error(`confined path refused: ${src} — a link or junction stands at the cached evidence entry; it is not installed in the run`), { code: 'ECONFINED', path: src });
  }
  if (!rootSt.isDirectory()) return false;
  // INTO THE RUN THROUGH ITS ONE OWNER (run-dir-descendants.plan.md stage 2): evidence/ and evidence/pre-flight are walked,
  // a link at either refused rather than removed or written through; the old folder is removed and made again by the
  // owner, so the copy lands in a directory nothing else placed there.
  // AND WHAT IS COPIED IS WALKED TOO (G-9 of 20261029-050428-rdd-delivery): a raw cpSync installed a link standing inside
  // the cache entry below the run. The entry is checked whole first, so a refused one writes nothing; then each folder is
  // made and each file created by the owner.
  // EVERY NAME IS CHECKED IN THE WALK TOO (G-7 of 20261029-065343-rdd-remediation-2-review): a name the owner refuses (a
  // `\` or `:` on POSIX) passed the walk, the old evidence was removed, and the owner refused it mid-copy. `cacheFs` is the
  // walk's filesystem, a seam for a test on a host that cannot hold such a name.
  const entries = [];
  const walk = (dir, segs) => {
    for (const e of cacheFs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const bad = unsafeSegment(e.name);
      if (bad) throw Object.assign(new Error(`confined path refused: ${p} — ${bad}; it is not installed in the run`), { code: 'ECONFINED', path: p });
      const st = cacheFs.lstatSync(p);
      if (st.isSymbolicLink()) {
        throw Object.assign(new Error(`confined path refused: ${p} — a link or junction stands in the cached evidence; it is not installed in the run`), { code: 'ECONFINED', path: p });
      }
      // Nor a hard-linked file (link-leaving-owner.plan.md stage 3, LL-D4): its content may be any file's.
      if (hardLinkReason(st)) {
        throw Object.assign(new Error(`confined path refused: ${p} — a hard-linked file stands in the cached evidence; it is not installed in the run`), { code: 'ECONFINED', path: p });
      }
      if (st.isDirectory()) { entries.push({ segs: [...segs, e.name], dir: true }); walk(p, [...segs, e.name]); } else if (st.isFile()) {
        // The cache's own mark of which writer copied this evidence (G-5) is the cache's, not the run's evidence.
        if (!(segs.length === 0 && e.name === EVIDENCE_WRITER_MARK)) entries.push({ segs: [...segs, e.name], from: p });
      }
      // Anything else (a FIFO, a socket, a device node) is refused, not dropped (G-3 of 20261122-204359-llo-remediation-review).
      else throw Object.assign(new Error(`confined path refused: ${p} — not a regular file, a directory or a link; it is not installed in the run`), { code: 'ECONFINED', path: p });
    }
  };
  walk(src, []);
  const owner = runOwner;
  owner.remove(['evidence', 'pre-flight'], { recursive: true });
  owner.dir(['evidence', 'pre-flight']);
  for (const e of entries) {
    if (e.dir) owner.dir(['evidence', 'pre-flight', ...e.segs]);
    else owner.create(['evidence', 'pre-flight', ...e.segs], cacheFs.readFileSync(e.from));
  }
  // WHAT IS CITED, NOT WHAT WAS COPIED (G-12 of 20261029-190658-rdr-delivery): true followed the copy, so an entry whose
  // cited logs were never cached (a refresh interrupted between its entry and its evidence) still read as restored.
  return cited.every((p) => !owner.isFree(String(p).split(/[\\/]/).filter(Boolean)));
}
