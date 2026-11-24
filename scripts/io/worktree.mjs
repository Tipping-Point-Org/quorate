// Did the tree move while the run was reading it?
//
// A run fans out for tens of minutes. Every finding it emits cites a file and a line. If the
// working tree changes underneath that — an operator edits a file, a rebase lands, a formatter
// runs — then those citations may name lines that no longer exist, and the gate has no way to say
// so. disk-first-protocol.md has declared a TREE-MOVED stamp for exactly this since the beginning.
//
// It was never implemented. Worse, the one field that would have enabled it lied: new-run wrote
// `worktree_sha: headSha` — the HEAD COMMIT under a name promising working-tree state. Editing a
// tracked file does not change HEAD, so even a correct re-read would have detected nothing. The
// field was inert twice over: never re-read, and incapable of answering the question if it had been.
//
// This hashes the CONTENT of the files actually under review, which is the precise thing: a run
// whose reviewed files are byte-identical at the barrier reviewed what it thought it did, whatever
// happened elsewhere in the repo.

// MOVED OUT OF lib/ (os-platform-adapters stage 4): this module exists to do I/O, and lib/ does none.
// It reaches the filesystem through the platform layer, resolved at call time — see hostFs.
import { judgeSnapshotEntries } from '../lib/snapshot-surface.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hostFs as fs } from '../platform/index.mjs';
import { gitSync } from './git.mjs';

import { walkRoot, matchesAnyGlob } from '../lib/contract-glob.mjs';
import { isSkippedDir } from '../lib/walk-rules.mjs';
import { isWithin } from './finding-scope.mjs';
import { SOURCE_STAMP } from '../lib/framework-source.mjs';


// The skip set is lib/walk-rules.mjs's isSkippedDir — one owner, shared with the glob walk (G-7).

// lstat, not stat: statSync FOLLOWS symlinks, so a directory link was walked as though it were a
// directory. A link pointing at a parent makes this recurse until the stack dies, and one pointing
// outside silently folded foreign files into the hash that decides whether the reviewed tree moved
// (G-33). A link is recorded as the file it is and never traversed; `visited` holds real paths so
// two routes to the same directory cannot be hashed twice.
//
// A PATH THE WALK CANNOT READ IS RECORDED, never dropped (G-9 of 20261001-155615-cgg-review-r3). Each failure returned
// silently, so an unlistable directory contributed nothing at mint and nothing at the gate, and TREE-MOVED could not see
// a change inside it — the G-8 fix one level up. `io.unreadable` collects them; worktreeSha makes the hash unrepeatable
// for each. An entry that is simply absent (ENOENT on lstat) is not unreadable: nothing is there to hash at either end.
function walk(abs, out, visited, skip = () => false, io = {}) {
  const readdir = io.readdir ?? ((d) => fs.readdirSync(d));
  const unreadable = (code) => { (io.unreadable ?? []).push({ abs, code }); };
  // PRUNED BEFORE DESCENDING (G-26). The exclusions were applied to the finished file list, so a
  // generated tree — a build output, a nested project's reviews directory — was walked in full,
  // every entry lstat'ed and every path retained, only to be discarded. Twice per run, at mint and
  // at the gate. Deciding at the directory costs one call instead of one per entry beneath it.
  //
  // The `skip` parameter was MISSING from this signature for an hour: the caller passed it, JavaScript
  // discarded it silently, and the comment above claimed a pruning that never happened — while the
  // measurement I quoted came from the surviving list filter instead (G-22, found by code-audit and
  // panel-codex-perf together). An arity mismatch is invisible in this language; the test below is
  // what makes it visible.
  if (skip(abs)) return;
  let st;
  try { st = fs.lstatSync(abs); } catch (e) { if (e.code !== 'ENOENT') unreadable(e.code ?? 'lstat'); return; }
  if (st.isSymbolicLink()) { out.push(abs); return; }
  if (st.isFile()) { out.push(abs); return; }
  if (!st.isDirectory()) return;
  let real;
  try { real = fs.realpathSync(abs); } catch (e) { unreadable(e.code ?? 'realpath'); return; }
  if (visited.has(real)) return;
  visited.add(real);
  let entries;
  try { entries = readdir(abs); } catch (e) { unreadable(e.code ?? 'readdir'); return; }
  for (const e of entries.sort()) {
    if (isSkippedDir(e)) continue;
    walk(path.join(abs, e), out, visited, skip, io);
  }
}

/**
 * Content hash of the files under `paths`, relative to `repoRoot`.
 *
 * `excludeDir` drops the run directory tree: a run writes its own artifacts continuously, and
 * counting them would make every run report its own tree as having moved — the same trap the
 * intent-input hash has to avoid, for the same reason.
 *
 * Returns null when there is nothing to hash, so "no scope" reads as "cannot tell" rather than as
 * a hash that would spuriously match or differ.
 */
export function worktreeSha({ repoRoot, paths = [], excludeDir = null, generatedGlobs = [], readFile = (f) => fs.readFileSync(f), readdir }) {
  const unreadable = [];
  const root = path.resolve(repoRoot);
  const files = [];
  // ONE visited set across every scope entry, not one per entry: two entries can name overlapping
  // directories (`scripts` and `scripts/lib`), and hashing the same file twice would make the sha
  // depend on how the scope was spelled rather than on what the tree contains.
  const visited = new Set();
  const excl = excludeDir ? path.resolve(excludeDir) : null;
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');

  // GENERATED TREES ARE NOT REVIEWED SOURCE, and the contract already says which they are.
  // SKIP_DIRS hardcoded node_modules and .git while `generated_globs` sat unread, so a scope path
  // covering a generated tree — a build output, a bundle, the reviews directory of a nested project
  // — was read and sha256'd in full, twice per run, for a hash whose only job is to notice edits to
  // the source under review (G-32). Worse than the cost: a generator rewriting its own output
  // mid-run would raise TREE-MOVED over files no finding could ever cite.
  //
  // EXACT, through the grammar's one owner (G-12 of 20261001-022902-contract-glob-grammar-review). This pruned by
  // covering PREFIX, so a narrow generated glob — `scripts/**/*.txt` — excluded all of `scripts/`, and an edit to
  // reviewed source there never moved the hash. matchesAnyGlob prunes a directory only when a glob covers it whole
  // (`dist/**` matches `dist` itself), and otherwise skips only the files a glob matches. `excludeDir` stays separate
  // because it answers a different question — the run's own artifacts, which the contract does not name.
  const genGlobs = generatedGlobs ?? [];

  // The exclusions, hoisted so the WALK can refuse a directory rather than collect every entry
  // beneath it and drop them afterwards (G-26). Same two rules the filter below applies, expressed
  // once and consulted at both ends.
  const skip = (abs) => {
    const a = path.resolve(abs);
    // Through the host-aware owner (G-13 of 20261029-212858-rdr-remediation-2-review): a case-sensitive prefix hashed a
    // differently cased excluded folder on a case-folding filesystem.
    if (excl && isWithin(excl, a)) return true;
    const r = rel(a);
    return matchesAnyGlob(genGlobs, r);
  };

  for (const p of paths) {
    const clean = String(p ?? '').trim();
    if (!clean) continue;
    // Scope entries are plain paths, not globs, but tolerate a trailing glob if one appears: where to start walking is
    // the one owner's walkRoot (contract-glob-grammar stage 3, inventory L). `.` is the whole-repository sweep, which
    // the grammar does not accept as a glob but new-run accepts as a --full-sweep path. Only an entry carrying `*` is
    // a glob: a derived scope path like `src/[ab].js` is a file name, and the grammar refused it as a character class.
    const base = /^\.[\\/]*$/.test(clean) ? '' : clean.includes('*') ? walkRoot(clean).base : clean.replace(/[\\/]+$/, '');
    walk(path.resolve(root, base || '.'), files, visited, skip, { readdir, unreadable });
  }

  // Still filtered here as well as pruned in the walk: a scope entry can NAME an excluded path
  // directly, in which case the walk was handed the file itself rather than reaching it through a
  // directory, and one guard at each end costs nothing.
  // KEYED ONCE PER FILE, not twice per COMPARISON (G-30, perf-audit). The comparator called `rel()`
  // on both operands — path.relative plus a split/join allocation — so a sort of n files ran it
  // 2·n·log n times over a derived key that never changes. worktreeSha runs twice per run (at mint
  // and at the gate) and its result decides TREE-MOVED, so this sat on a path the whole gate waits
  // for. Decorate, sort, undecorate: the same order, the same comparator, n keys instead of n log n.
  const kept = [...new Set(files)]
    .filter((f) => !skip(f))
    .map((f) => ({ f, key: rel(f) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((x) => x.f);
  if (!kept.length && !unreadable.length) return null;

  const h = crypto.createHash('sha256');
  for (const f of kept) {
    let body;
    try {
      // A LINK IS HASHED AS A LINK. walk() records a symlink without traversing it, on the stated
      // basis that the link "is recorded as the file it is" — and then readFileSync DEREFERENCED it
      // and hashed the target's bytes (G-27). For a file link pointing out of the tree that folds a
      // foreign file into the hash, so an unrelated file edited elsewhere raises TREE-MOVED and caps
      // the gate at RISK over something no finding could cite: the directory-link fix (G-33) with
      // the file-link half missing. What identifies a link is where it points.
      const st = fs.lstatSync(f);
      body = st.isSymbolicLink()
        ? Buffer.from(`symlink:${fs.readlinkSync(f)}`)
        : readFile(f);
    } catch (e) {
      // A FILE THAT CANNOT BE READ IS NOT VOUCHED FOR (G-8 of 20261001-034021-cgg-remediation-review). It was dropped from
      // the hash, so a file unreadable at mint and at the gate could change between them with the two hashes equal, and
      // the gate called the tree stable. A token unique to this call makes the hash unrepeatable: the gate's comparison
      // fails, and TREE-MOVED says the reviewed files could not be shown unchanged — the fail-closed answer.
      body = Buffer.from(`unreadable:${e.code ?? 'error'}:${crypto.randomUUID()}`);
    }
    h.update(rel(f));
    h.update('\0');
    h.update(body);
    h.update('\0');
  }
  // Every path the walk could not read, with the same unrepeatable token as an unreadable file (G-9): a hash that never
  // saw a subtree cannot vouch that it did not change.
  for (const u of unreadable) h.update(`${rel(u.abs)}\0unreadable:${u.code}:${crypto.randomUUID()}\0`);
  return h.digest('hex');
}

// ------------------------------------------------------------------------------- framework copy
// The arms' directory itself is built by io/snapshot.mjs (arms-read-surface). What was here — a
// `git worktree` checkout, a mirror of the working tree into it, and a search of it for links leading
// out — was replaced, because each review round found another kind of path that search missed.
/**
 * Copy one checkout's TRACKED files into a directory inside a fresh worktree.
 *
 * WHY THIS EXISTS. `git worktree add` checks out tracked files and leaves every submodule an empty
 * directory. In THIS repository that costs nothing — quorate is the repository, so its doctrine and
 * its detector scripts are ordinary tracked files and appear in any checkout. In the documented
 * consumer mount the framework IS a submodule at `.claude/skills/quorate`, so the arms' isolated
 * checkout contains an empty directory where every lens prompt says the doctrine lives.
 *
 * Measured in the story-pipeline fixture on the first full consumer-mount run: panel-codex-docs
 * came back DEGRADED reporting "The required doctrine file and mandatory find-inert-features.mjs
 * detector were absent" — an accurate report about a checkout the orchestrator had built for it,
 * recorded in the gate as the ARM being unavailable.
 *
 * WHY NOT `git submodule update --init`. That was the first attempt and it does not populate from
 * the superproject's `.git/modules`; it re-CLONES. Measured in the fixture, where it failed outright
 * with `transport 'file' not allowed` — git has refused file:// submodule clones since
 * CVE-2022-39253. A real consumer, whose submodule URL is an https remote, would instead have
 * reached the NETWORK: slow, fallible, and a silent dependency on connectivity in the middle of a
 * review. The framework checkout is already on disk at the commit the consumer pinned. Copying from
 * it is local, offline and exact.
 *
 * TRACKED FILES ONLY, from `git ls-files`. The arms are third-party cloud reviewers, so what lands
 * in their tree is what leaves the machine — and the source directory holds untracked machine-local
 * artifacts, `.claude/panel-check.json` among them. A recursive directory copy would put this
 * operator's transport probe, and any other untracked file, in front of a vendor. That is the exact
 * exposure the worktree exists to prevent: "measured on this repository, 23 evidence directories in
 * the tree and ZERO in a worktree of the same commit".
 */
// EVERY GIT LISTING HERE GOES THROUGH THIS, capped (G-3 of 20260926-060936-m0-close-r3; arms-read-surface criterion 2):
// past spawnSync's default 1 MiB a listing returns status null with an empty stderr. The cap is a parameter so a test
// can prove it is honoured with a few files rather than 12,000 (test-suite-cost.md).
const LISTING_MAX_BUFFER = 1 << 30;
const gitListing = (args, opts = {}) =>
  gitSync(args, { encoding: 'utf8', maxBuffer: LISTING_MAX_BUFFER, ...opts });

// `lstat` is a parameter so a test can make a standing file answer EACCES, which no host does on request (G-10).
// `listFiles` and `writeStamp` likewise (G-9, G-10 of 20261122-014737-m3s7-b2-review-2): no Windows or macOS file system
// holds a non-UTF-8 name, and no host refuses one write on request.
const listTracked = (srcRoot, maxBuffer) =>
  gitListing(['ls-files', '-s', '-z'], { cwd: srcRoot, encoding: 'buffer', maxBuffer });
const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });
export function copyTrackedInto(srcRoot, destDir, {
  listingMaxBuffer = LISTING_MAX_BUFFER, lstat = (p, o) => fs.lstatSync(p, o),
  listFiles = listTracked, writeStamp = (file, text) => fs.writeFileSync(file, text),
} = {}) {
  // RAW BYTES, decoded strictly (G-9 of 20261122-014737-m3s7-b2-review-2): decoding the listing as UTF-8 turned a
  // non-UTF-8 tracked name into U+FFFD, a name that is not the file's. Such a name is refused by name, never mangled.
  const r = listFiles(srcRoot, listingMaxBuffer);
  if (r.status !== 0) {
    return { ok: false, why: `git ls-files failed: ${String(r.stderr ?? '').trim().slice(0, 200)}` };
  }
  const raw = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(String(r.stdout ?? ''), 'utf8');
  const lines = [];
  let start = 0;
  for (let i = 0; i <= raw.length; i += 1) {
    if (i < raw.length && raw[i] !== 0) continue;
    if (i > start) {
      const bytes = raw.subarray(start, i);
      try { lines.push(fatalUtf8.decode(bytes)); } catch {
        return { ok: false, why: `a tracked name is not UTF-8 and cannot be copied by name: ${bytes.toString('latin1').slice(0, 200)}` };
      }
    }
    start = i + 1;
  }
  const staged = lines
    .map((line) => /^(\d+) \w+ \d\t([\s\S]+)$/.exec(line)).filter(Boolean).map((m) => ({ mode: m[1], rel: m[2] }));
  if (!staged.length) return { ok: false, why: 'no tracked files at the source' };
  // THE SNAPSHOT'S RULE, ON THIS ROUTE TOO (arms-read-surface criterion 8): the same decision the arms'
  // snapshot applies (lib/snapshot-surface.mjs) — a link, a file reached through a linked directory,
  // and a hard link with links outside the framework are left out and named, never copied. The
  // hard-link case is new: copyFileSync copies a hard link's bytes like any file's. It replaces the
  // mirror's link rule here (G-11 of 20260925-200721-platform-remediated), which it covers.
  const src = path.resolve(srcRoot);
  const realSrc = (() => { try { return fs.realpathSync(src); } catch { return src; } })();
  const entries = [];
  for (const { mode, rel } of staged) {
    if (mode === '160000') continue;   // a submodule of the framework itself: nothing to copy
    const from = path.join(srcRoot, rel);
    let st = null; let real = null;
    // Deleted in the working tree is ENOENT or ENOTDIR, and only that is skipped (G-10 of
    // 20261122-002915-m3s7-b2-remediation-review): any other failure is a file that stands and could not be judged.
    try { st = lstat(from, { bigint: true }); } catch (e) {
      if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') continue;
      return { ok: false, why: `reading ${rel}: ${e?.message ?? e}` };
    }
    try { real = fs.realpathSync(from); } catch { /* unresolvable: judged as such */ }
    entries.push({ path: rel, mode: st.isSymbolicLink() ? '120000' : mode, real, dev: String(st.dev), ino: String(st.ino), nlink: String(st.nlink) });
  }
  const verdict = judgeSnapshotEntries({ realRepoRoot: realSrc, entries });
  const refused = verdict.withheld.map((w) => ({ rel: w.path, why: w.why }));
  let copied = 0;
  for (const rel of verdict.admitted) {
    const from = path.join(srcRoot, rel);
    const to = path.join(destDir, rel);
    try {
      if (!fs.statSync(from).isFile()) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied += 1;
    } catch (e) {
      return { ok: false, why: `copying ${rel}: ${e.message}` };
    }
  }
  // THE SOURCE'S IDENTITY, WRITTEN DOWN, because the copy loses it and git answers anyway.
  //
  // A copied framework has no `.git`, so `git -C <copy> rev-parse HEAD` walks UP and answers with
  // the enclosing worktree's commit — the reviewed PROJECT's. Measured: check-install run inside a
  // populated consumer worktree reported `quorate mounted at .claude/skills/quorate @ 4850c47`,
  // which is the story-pipeline fixture's commit presented as quorate's version. A confidently
  // wrong attribution, which is the one thing frameworkStamp promises never to produce, and it is
  // this copy that introduced it.
  //
  // A marker file rather than a smarter probe: "is this directory its own git root" cannot separate
  // a copy from the LEGACY vendored-in-tree layout, where the enclosing commit genuinely is the
  // framework's version. The copier knows which case it is, so it says so.
  // A stamp that could not be WRITTEN fails the copy (G-10 of 20261122-014737-m3s7-b2-review-2): swallowed, the copy
  // said ok with no stamp, and the copy's version then answers with the enclosing repository's commit. A commit git
  // cannot name degrades to 'unknown' inside a written stamp, which is the honest direction.
  try {
    const head = gitListing(['-C', srcRoot, 'rev-parse', 'HEAD']);
    const porcelain = gitListing(['-C', srcRoot, 'status', '--porcelain', '--', '.']);
    writeStamp(path.join(destDir, SOURCE_STAMP), `${JSON.stringify({
      commit: head.status === 0 ? head.stdout.trim() : 'unknown',
      dirty: porcelain.status === 0 ? porcelain.stdout.trim().length > 0 : null,
      // NO `copied_from` (G-10 of 20261121-233915-m3s7-b2-review): the source checkout's absolute path, in a file the
      // external reviewers read, disclosed the operator's local path to the panel's vendors, and no reader used it.
      copied_at: new Date().toISOString(),
    }, null, 2)}\n`);
  } catch (e) {
    return { ok: false, why: `writing ${SOURCE_STAMP}: ${e?.message ?? e}` };
  }
  return { ok: true, copied, refused };
}
