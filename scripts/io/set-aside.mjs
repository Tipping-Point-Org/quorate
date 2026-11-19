// The set-aside of a refused cluster for the full check, and its write-back (remediation-cluster-order.plan.md, design
// CO-D1 A, CO-D2 A, CO-D3 A; set-aside-identity.plan.md). Moved out of scripts/remediate.mjs, whose private functions a test
// could reach only by running the whole runner or by reading its source (runner-test-seam.plan.md stage 1, design RT-D1 A).
//
// EVERYTHING IT TOUCHES ARRIVES AS A CAPABILITY, one argument built by setAsideCapabilities:
//   { tree, owner, git, run, firstFree, log }
// `tree` the confined repository, `owner` the run directory's owner, each with withFileBytes added; `git(args, { input })`
// one git process, returning { status, stdout, stderr }; `run` { dir, read(), save(fields) }, dir the run directory's path;
// `firstFree(taken)` the runner's bounded search; `log(line)` a printer. This module reads no process, argv, clock or
// environment, and spawns nothing itself.
//
// A REFUSAL IS A SetAsideError, never an exit (the plan's "Errors"): the runner catches it around each setAsideRefused call
// and dies there with its message, so the finisher it registered with atDie writes the files back after the reason is
// printed. writeBackSetAside returns what it could not write back, as before.
//
// IT IS OBSERVED THROUGH node:diagnostics_channel (design RT-D2 B), on the channels SET_ASIDE_CHANNELS names. A publish is
// synchronous, so a subscriber runs before the next step; a subscriber's throw does not reach this module.
import { createHash } from 'node:crypto';
import diagnosticsChannel from 'node:diagnostics_channel';
import { setAsidePlan, setAsideCandidates, setAsideRestoreNeeded, setAsideRestoredPaths, setAsideAtHead, setAsideMayOverwrite, setAsideWrittenState, rawDiffModeChangedPaths, lsTreeEntries, pathReadFailure } from '../lib/remediation-chain.mjs';

// --- set-aside: begin

/** The channel names, once: `classified`, `bytes-open`, `bytes-close`, `copy`, `write-back`, `git`. */
export const SET_ASIDE_CHANNELS = Object.freeze({
  classified: 'quorate:set-aside:classified',
  bytesOpen: 'quorate:set-aside:bytes-open',
  bytesClose: 'quorate:set-aside:bytes-close',
  copy: 'quorate:set-aside:copy',
  writeBack: 'quorate:set-aside:write-back',
  git: 'quorate:set-aside:git',
});
const channel = Object.fromEntries(Object.entries(SET_ASIDE_CHANNELS).map(([k, name]) => [k, diagnosticsChannel.channel(name)]));
const publish = (k, message) => { if (channel[k].hasSubscribers) channel[k].publish(message); };

/** What the set-aside refuses with, where the runner died before: the message, without the runner's prefix. */
export class SetAsideError extends Error {
  constructor(message) { super(message); this.name = 'SetAsideError'; }
}

/**
 * The one way the capabilities are built, by the runner and by a test alike, so every caller runs the shipped
 * withFileBytes: it reads the file at `segs`, calls `fn(bytes)` and returns fn's result, between a `bytes-open` and a
 * `bytes-close` event naming the path.
 */
export function setAsideCapabilities({ tree, owner, git, run, firstFree, log }) {
  // THE SHAPE THE PLAN DEFINES (G-7 of 20261108-234028-rts-remediation-review-b): the runner passed { read, save }, and this
  // header documented that narrower shape with no amendment. Refused here, so the runner cannot start without it.
  if (typeof run?.dir !== 'string' || !run.dir) throw new TypeError('setAsideCapabilities: run.dir must be the run directory\'s path');
  const withBytes = (base, root) => ({
    ...base,
    withFileBytes(segs, fn) {
      const p = segs.join('/');
      publish('bytesOpen', { root, path: p });
      try {
        const raw = base.read(segs, null);
        return fn(Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
      } finally { publish('bytesClose', { root, path: p }); }
    },
  });
  return { tree: withBytes(tree, 'tree'), owner: withBytes(owner, 'owner'), git, run, firstFree, log };
}

// Every git call, published on the `git` channel with its argument array.
// (Published through the channel object, not publish(<name>, ...): A-29's census reads a call whose first argument is the
// string git as a spawn.)
const gitOf = (caps) => (argv, opts = {}) => {
  if (channel.git.hasSubscribers) channel.git.publish({ args: [...argv] });
  return caps.git(argv, opts);
};

const treeSegs = (p) => p.split('/');

// WHAT IS AT A SET-ASIDE PATH, from one reader (set-aside-identity.plan.md stage 1, design SI-D1 A). Six raw reads decided
// it, each through path.join(repo, p), so a link at the leaf or at a parent level was followed, and each fix taught one of
// them a fact the next review found another had not learned (20261107-184037-co-delivery to -211411-co-remediation-4-
// review). Everything below asks this, through confined(repo), whose stat and read refuse a link or junction at any level:
// { kind: absent | file | link | directory | unreadable, mode, sha256, bytes }.
// What a stat says is at `p`, reading no bytes: the classification's read (G-7, G-13 of 20261108-032104-si-remediation-4-review,
// I-10: every file was read before the first copy was written). `size` and `mtime_ms` let the copy's one read be checked
// against the state that classified it. What a refused or failed read means is lib's pathReadFailure (G-15).
function pathStat(caps, p) {
  let st;
  try { st = caps.tree.stat(treeSegs(p)); } catch (err) { return pathReadFailure(err); }
  if (!st.isFile()) return { kind: 'directory' };
  return { kind: 'file', mode: st.mode & 0o777, links: st.nlink, size: st.size, mtime_ms: st.mtimeMs };
}

// THE BYTES ONLY INSIDE withFileBytes (runner-test-seam.plan.md stage 3, design RT-D3 A): the file is read in the
// capability's callback, hashed there, and handed to `use` (the copy loop's write of its copy) before the callback returns;
// what this returns holds no bytes. A read that fails is lib's pathReadFailure; a failure of `use` is its own, and passes.
// ITS LINK COUNT TOO (G-9 of 20261108-021347-si-remediation-2-review): a file with another name is set aside and named.
export function pathState(caps, p, use = null) {
  const s = pathStat(caps, p);
  if (s.kind !== 'file') return s;
  let read = false;
  let sha256;
  try {
    sha256 = caps.tree.withFileBytes(treeSegs(p), (bytes) => {
      read = true;
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (use) use(bytes);
      return hash;
    });
  } catch (err) {
    if (read) throw err;
    return pathReadFailure(err);
  }
  return { ...s, sha256 };
}

// A FILE'S BYTES LIVE IN A FRAME THAT ENDS (repair of 20261108-072045-si-remediation-8, I-14): a loop's own variables keep
// their last value in the frame between iterations, so the copy loop and the write-back loop each held earlier files' bytes
// past the point they were used, and on a loaded machine a forced collection still counted three files at once. Since stage
// 3 no state holds bytes at all: they exist only inside a withFileBytes callback, one file at a time.

// What git says of the tracked entries among `entries`, for lib's setAsideAtHead. BATCHED (G-1 of 20261108-060730-si-remediation-6-review-b):
// one `hash-object --stdin-paths` and one `diff --raw`, not two processes per entry. The blobs are hashed through git so the
// repository's filters apply as they did to the checkout; the mode is git's own answer, so core.fileMode decides as it does
// for `git status` (G-3 of 20261107-191838-co-remediation-review). `stateOf` is what the caller read for a path. A batch that
// fails answers nothing, which reads as not at HEAD. A name holding a line break cannot join the batch, and was never set
// aside (kindsOfPaths).
function headFacts(caps, entries, stateOf) {
  const git = gitOf(caps);
  const tracked = entries.filter((e) => e.kind !== 'new' && stateOf(e.path).kind === 'file' && !/[\r\n]/.test(e.path));
  const paths = tracked.map((e) => e.path);
  const blobs = new Map();
  const headNow = new Map();
  if (!paths.length) return { blobs, modeChanged: new Set(), headNow };
  const h = git(['hash-object', '--stdin-paths'], { input: `${paths.join('\n')}\n` });
  const hashes = h.status === 0 ? h.stdout.trim().split(/\r?\n/) : [];
  if (hashes.length === paths.length) paths.forEach((p, i) => blobs.set(p, hashes[i]));
  const d = git(['diff', '--raw', '--no-renames', '-z', 'HEAD', '--', ...paths.map((p) => `:(literal)${p}`)]);
  if (d.status !== 0) blobs.clear();
  // WHAT A MANIFEST WITH NO head_blob IS HELD TO (G-3 of 20261108-234028-rts-remediation-review-b): the blob HEAD holds now, asked
  // only when such an entry is among them. A failed ls-tree answers nothing, which reads as not at HEAD.
  const legacy = tracked.filter((e) => !('head_blob' in e)).map((e) => e.path);
  if (legacy.length) {
    const l = git(['ls-tree', '-z', 'HEAD', '--', ...legacy.map((p) => `:(literal)${p}`)]);
    if (l.status === 0) for (const [p, entry] of lsTreeEntries(l.stdout)) if (entry.type === 'blob') headNow.set(p, entry.hash);
  }
  return { blobs, modeChanged: d.status === 0 ? rawDiffModeChangedPaths(d.stdout) : new Set(), headNow };
}

// What the working tree holds at each of `paths`, for setAsidePlan: modified | new | deleted | link | directory |
// unreadable | mode-only. BATCHED (G-6 of 20261107-211411-co-remediation-4-review): one `git ls-tree` for HEAD's entries
// and one `git hash-object --stdin-paths` for the files' blobs, not two git processes per file; each answer kept per path.
// ITS STATES TOO (G-8 of 20261107-220617-si-delivery): `states`, when given, keeps each path's pathState, so the copy is made
// from the read that classified it rather than a second read that could disagree.
function kindsOfPaths(caps, paths, states = new Map()) {
  const git = gitOf(caps);
  const kinds = new Map();
  const files = [];
  for (const p of paths) {
    // A STAT, NOT A READ (G-7, G-13 of 20261108-032104-si-remediation-4-review): no file's bytes are read here; the copy reads
    // each file as it is copied, checks that read against this state's mode, size and time, and the put-back's guard reads it
    // once more (G-10 of 20261108-065111-si-remediation-7-review), one file's bytes at a time.
    const s = pathStat(caps, p);
    states.set(p, s);
    if (s.kind === 'absent') kinds.set(p, 'deleted');
    else if (s.kind !== 'file') kinds.set(p, s.kind);
    // A LINE BREAK IN A NAME (G-12 of 20261108-021347-si-remediation-2-review): --stdin-paths reads one path per line, so it
    // split the batch and lost every file's hash. That path alone is unreadable; the others are still hashed.
    else if (/[\r\n]/.test(p)) kinds.set(p, 'unreadable');
    else files.push(p);
  }
  if (!files.length) return kinds;
  // LITERAL PATHS, NOT PATHSPECS (G-14 of 20261107-224233-si-remediation-review): a tracked name holding `[c]` was matched as
  // a pattern, read as new and removed rather than put back to HEAD.
  const listed = git(['ls-tree', '-z', 'HEAD', '--', ...files.map((p) => `:(literal)${p}`)]);
  const blobs = git(['hash-object', '--stdin-paths'], { input: `${files.join('\n')}\n` });
  // A FAILED ls-tree IS NOT AN UNTRACKED PATH (G-6 of 20261107-220617-si-delivery): read as one, a tracked modified file was
  // classified new, removed instead of put back to HEAD, and the full check ran on the wrong tree. Unreadable keeps it.
  if (listed.status !== 0) { for (const p of files) kinds.set(p, 'unreadable'); return kinds; }
  const hashes = blobs.status === 0 ? blobs.stdout.trim().split(/\r?\n/) : [];
  const entries = lsTreeEntries(listed.stdout);   // one parse, not one per file
  files.forEach((p, i) => {
    const entry = entries.get(p) ?? null;
    // HEAD'S BLOB FROM THIS ls-tree (G-8 of 20261108-032104-si-remediation-4-review): the copy step ran a rev-parse per file.
    if (entry) states.set(p, { ...states.get(p), head_blob: entry.hash });
    // ITS WORKTREE BLOB TOO (G-7 of 20261108-043341-si-remediation-5-review-b, I-11): the first list a second batched
    // hash-object after the copies is compared with, path by path, so a same-size, same-time edit is caught.
    if (hashes.length === files.length) states.set(p, { ...states.get(p), worktree_blob: hashes[i] });
    if (!entry) kinds.set(p, 'new');
    else if (entry.type !== 'blob' || entry.mode === '120000') kinds.set(p, 'link');
    else if (hashes.length !== files.length) kinds.set(p, 'unreadable');
    else kinds.set(p, hashes[i] === entry.hash ? 'mode-only' : 'modified');
  });
  return kinds;
}

// Copy aside every qualifying cluster's files, write the manifest last, then put their paths back to HEAD. Returns what
// was kept in the tree (with why) and the record the write-back needs, or null when nothing was set aside.
// THE FINISHER HOLDS THE RECORD BEFORE THE FIRST PUT-BACK (G-11, G-12 of 20261107-203720-co-remediation-3-review):
// `holder` is the object setAsideFinisher was registered with, so a die() while paths are put back writes them back.
// A REFUSAL THROWS A SetAsideError (runner-test-seam.plan.md stage 1), which the runner turns into its die.
export function setAsideRefused(caps, clusters, holder = {}) {
  const { tree, owner, run, firstFree, log } = caps;
  const git = gitOf(caps);
  const states = new Map();
  const kinds = kindsOfPaths(caps, setAsideCandidates(clusters), states);   // lib's one rule of which clusters qualify (G-7)
  const { aside, kept } = setAsidePlan(clusters, kinds);
  // ONE EVENT, AFTER THE BATCHED hash-object HAS FILLED EACH WORKTREE BLOB AND setAsidePlan HAS CHOSEN (the plan's
  // "Channels"): every path's state and the files set aside. A subscriber runs here, before the first copy.
  publish('classified', { states: new Map([...states].map(([p, s]) => [p, { ...s }])), files: aside.flatMap((c) => c.files.map((f) => f.path)) });
  if (!aside.length) return { kept, record: null };
  // THE FOLDER IS NAMED IN run.json BEFORE THE FIRST COPY (G-14, G-6 of 20261107-184037-co-delivery): a kill while copying
  // then leaves a record with no entries and no manifest, which the next invocation's write-back removes. A folder left
  // unrecorded by an older run, with no manifest, never had its paths touched and is removed; one with a manifest is kept
  // and skipped. BOUNDED as the runner log's numbers are (G-7 of 20261107-211411-co-remediation-4-review): firstFree.
  const base = run.read().set_aside_count ?? 0;
  const dirOf = (k) => ['evidence', 'remediation-runner', `set-aside-${k}`];
  const n = firstFree((k) => {
    if (k <= base) return true;
    if (owner.isFree(dirOf(k))) return false;
    if (owner.isFree([...dirOf(k), 'manifest.json'])) {
      // A REFUSAL, NOT A STACK (G-2 of 20261108-234028-rts-remediation-review-b): the runner dies with a SetAsideError's message.
      try { owner.remove(dirOf(k), { recursive: true }); } catch (err) { throw new SetAsideError(`could not remove ${dirOf(k).join('/')}, an earlier run's partial copies, in the run directory (${err.code ?? err.message}); nothing was put back`); }
      return false;
    }
    return true;
  });
  const dir = dirOf(n);
  // A WRITE THAT FAILS BEFORE THE PUT-BACK IS A REFUSAL, NOT A STACK (G-2's census, 20261108-234028-rts-remediation-review-b): the
  // runner dies with a SetAsideError's message. No path has been touched yet, and the next invocation removes what was copied.
  const beforePutBack = (what, fn) => {
    try { return fn(); } catch (err) {
      if (err instanceof SetAsideError) throw err;
      throw new SetAsideError(`could not write ${what} in the run directory (${err.code ?? err.message}); nothing was put back`);
    }
  };
  beforePutBack('the set-aside record', () => run.save({ set_aside_count: n, set_aside_dir: dir.join('/'), set_aside: [] }));
  const entries = [];
  for (const c of aside) {
    for (const f of c.files) {
      const classified = states.get(f.path);
      const copy = String(entries.length + 1);
      const s = beforePutBack(`the copy of ${f.path}`, () => copyOneAside(caps, f.path, classified, [...dir, 'files', copy]));
      // HEAD's blob, so the put-back is checked against it and the write-back knows the state it may replace (G-7, I-2):
      // the classification's ls-tree answer (G-8 of 20261108-032104-si-remediation-4-review).
      const headBlob = f.kind === 'new' ? null : classified.head_blob ?? null;
      if (f.kind !== 'new' && !headBlob) throw new SetAsideError(`could not read HEAD's blob of ${f.path} to set it aside; nothing was put back`);
      // ITS MODE TOO (G-8 of 20261107-195640-co-remediation-2-review): the write-back's replace makes a fresh file.
      // MORE THAN ONE LINK IS NAMED, NOT REFUSED (the plan's G-2; operator, 2026-10-31): the write-back's replace breaks the
      // link and leaves the other name as it was, so the operator is told the path and how many names it had.
      entries.push({ cluster: c.id, path: f.path, kind: f.kind, sha256: s.sha256, head_blob: headBlob, mode: s.mode,
        ...(s.links > 1 ? { links: s.links } : {}), copy });
      if (s.links > 1) log(`remediate: set aside for the full check: ${f.path} has ${s.links} links; it is set aside and written back, and its other names are left as they are`);
    }
  }
  // CONTENT IDENTITY, NOT ONLY MODE, SIZE AND TIME (G-7 of 20261108-043341-si-remediation-5-review-b, I-11): one more
  // batched hash-object over the copied paths, compared path by path with the classification's, so an edit that kept the
  // size and the timestamp dies here, before the manifest and before anything is put back.
  if (entries.length) {
    const copiedPaths = entries.map((e) => e.path);
    const again = git(['hash-object', '--stdin-paths'], { input: `${copiedPaths.join('\n')}\n` });
    const now = again.status === 0 ? again.stdout.trim().split(/\r?\n/) : [];
    if (now.length !== copiedPaths.length) throw new SetAsideError(`could not hash the set-aside files again after copying them (${String(again.stderr ?? '').trim() || `${now.length} hashes for ${copiedPaths.length} files`}); nothing was put back`);
    copiedPaths.forEach((p, i) => {
      const first = states.get(p)?.worktree_blob;
      if (!first || now[i] !== first) throw new SetAsideError(`${p} changed after it was classified (${first ?? 'no blob'} then, ${now[i]} after the copy), so it was not set aside; nothing was put back`);
    });
  }
  beforePutBack('the manifest', () => owner.replace([...dir, 'manifest.json'], `${JSON.stringify({ entries }, null, 2)}\n`));
  beforePutBack('the set-aside record', () => run.save({ set_aside_count: n, set_aside_dir: dir.join('/'), set_aside: entries.map(({ copy, ...e }) => ({ ...e, restored: false })) }));
  holder.record = { dir, entries };
  // AN UNEXPECTED THROW IS A DIAGNOSTIC (G-8 of 20261108-065111-si-remediation-7-review, I-11): a removal Windows refuses on a
  // locked file threw past die, so what was already put back stayed only in its copy until the next invocation.
  let putting = null;
  try {
  for (const e of entries) {
    // STILL THE BYTES THAT WERE COPIED (G-9 of 20261107-220617-si-delivery): an edit made after the copy is not discarded by
    // the put-back, to be overwritten later by the stale copy. A window remains between this read and git's write.
    // THE MODE AND THE KIND TOO (G-16 of 20261107-224233-si-remediation-review): a chmod after the copy, bytes unchanged,
    // passed a hash-only guard and was lost to the checkout and the stale mode written back.
    putting = e.path;
    // WHAT IT READ IS WHAT IT SAYS (runner-test-seam.plan.md stage 3; found by the fault sweep): a read that failed, or a path
    // no longer a file, was reported as a change, sending the operator to look for an edit nobody made.
    const now = pathState(caps, e.path);
    const kept = `so it was not put back to HEAD for the full check; its earlier bytes are kept under ${dir.join('/')} and the next run of this command writes back only what still matches`;
    if (now.kind === 'unreadable') throw new SetAsideError(`${e.path} could not be read (${now.why}), ${kept}`);
    if (now.kind !== 'file') throw new SetAsideError(`${e.path} is now ${now.kind === 'absent' ? 'absent' : `a ${now.kind}`}, ${kept}`);
    if (now.sha256 !== e.sha256 || now.mode !== e.mode) throw new SetAsideError(`${e.path} changed after it was copied aside, ${kept}`);
    if (e.kind === 'new') {
      tree.remove(treeSegs(e.path));
      continue;
    }
    // THROUGH GIT'S CHECKOUT, so the repository's own filters write it and its index entry is refreshed. `git restore
    // --worktree` wrote the same bytes but left the index's stat entry stale, and with core.autocrlf=true `git status` still
    // listed the file as modified (remediation-cluster-order stage 1, 2026-11-07). The index entry already equals HEAD.
    const r = git(['checkout', 'HEAD', '--', `:(literal)${e.path}`]);
    if (r.status !== 0) throw new SetAsideError(`could not put ${e.path} back to HEAD for the full check (${r.stderr.trim()}); its bytes are kept under ${dir.join('/')} and the next run of this command writes them back`);
  }
  } catch (err) {
    // A GUARD'S OWN REFUSAL PASSES UNCHANGED (runner-test-seam.plan.md stage 1): only a failure that is not yet a refusal is
    // wrapped in the put-back's message, so the guard's reason is never buried inside another sentence.
    if (err instanceof SetAsideError) throw err;
    throw new SetAsideError(`could not put ${putting} back to HEAD for the full check (${err.code ?? err.message}); its bytes are kept under ${dir.join('/')} and the next run of this command writes them back`);
  }
  // CHECKED, not assumed (G-9, I-2): the full check must not run on a tree that still holds a refused file, or on one a
  // put-back left unlike HEAD. Once over all of them, in one batch (G-1 of 20261108-060730-si-remediation-6-review-b), from a
  // stat, so no file's bytes are read for it.
  const putBack = new Map(entries.map((e) => [e.path, pathStat(caps, e.path)]));
  const facts = headFacts(caps, entries, (p) => putBack.get(p));
  for (const e of entries) {
    if (setAsideAtHead(e, putBack.get(e.path), facts)) continue;
    if (e.kind === 'new') throw new SetAsideError(`could not remove ${e.path} for the full check; its bytes are kept under ${dir.join('/')} and the next run of this command writes them back`);
    throw new SetAsideError(`${e.path} does not match HEAD's blob ${e.head_blob} after it was put back for the full check; its bytes are kept under ${dir.join('/')} and the next run of this command writes them back`);
  }
  log(`remediate: set aside for the full check: ${entries.map((e) => e.path).join(', ')} (cluster(s) ${aside.map((c) => c.id).join(', ')}, not committable); written back after the commits`);
  return { kept, record: { dir, entries } };
}

// One file read and copied, refused if it is not what classified it. What it returns carries no bytes.
// THE COPY IS WRITTEN INSIDE THE READ (runner-test-seam.plan.md stage 3): the stat is checked against the classification
// first, then the file is read once, in withFileBytes, and its copy created in that callback, so its bytes end with it.
function copyOneAside(caps, p, classified, segs) {
  const notAFile = (s) => new SetAsideError(`${p} is no longer a regular file it can set aside (it is ${s.kind === 'absent' ? 'absent' : `a ${s.kind}`}); nothing was put back`);
  const st = pathStat(caps, p);
  if (st.kind !== 'file') throw notAFile(st);
  if (!classified || st.mode !== classified.mode || st.size !== classified.size || st.mtime_ms !== classified.mtime_ms) throw new SetAsideError(`${p} changed after it was classified, so it was not set aside; nothing was put back`);
  const s = pathState(caps, p, (bytes) => caps.owner.create(segs, bytes));
  if (s.kind !== 'file') throw notAFile(s);
  publish('copy', { path: p, copy: segs.join('/') });
  return s;
}

// Write back what a set-aside left, from its manifest: idempotent, so a kill at any step is recovered by running it again.
// A folder without its manifest means the paths were never touched: its partial copies are removed. Returns the files it
// could not write back, each with why.
// THE REST IS WRITTEN, THEN IT STOPS (design SI-D2 A): an entry whose path is not as the set-aside left it is skipped and
// named; every other entry is written back and its copy removed; the skipped entries' copies and the manifest are kept.
export function writeBackSetAside(caps, dirName) {
  const { owner, run, log } = caps;
  const dir = dirName.split('/');
  let manifest = null;
  // ABSENT IS NOT UNREADABLE (G-10 of 20261107-184037-co-delivery): only a manifest that is not there means the paths were
  // never touched.
  try { manifest = JSON.parse(owner.read([...dir, 'manifest.json'])); } catch (err) {
    if (err.code !== 'ENOENT') return [{ path: `${dirName}/manifest.json`, why: `the manifest cannot be read (${err.code ?? err.message}); nothing was written back or removed` }];
  }
  if (!manifest) {
    // A FAILED REMOVAL IS RETURNED, NOT THROWN (G-2 of 20261108-234028-rts-remediation-review-b): thrown, a locked folder ended
    // recovery in a stack rather than a recorded set-aside-unrestored. The record stays, so the retry removes it.
    try { owner.remove(dir, { recursive: true }); } catch (err) {
      if (err.code !== 'ENOENT') return [{ path: dirName, why: `its partial copies could not be removed (${err.code ?? err.message}); no path was touched` }];
    }
    run.save({ set_aside: null, set_aside_dir: null });
    return [];
  }
  if (!Array.isArray(manifest.entries)) return [{ path: `${dirName}/manifest.json`, why: 'the manifest names no entries; nothing was written back or removed' }];
  const failed = [];
  // WHAT A PREVIOUS WRITE-BACK LEFT when its hash check failed (G-4 of 20261107-191838-co-remediation-review), read through
  // lib's one decoding of the record (G-7 of 20261107-195640-co-remediation-2-review).
  // ITS MODE TOO (G-13 of 20261108-021347-si-remediation-2-review): a chmod made since the failed write is not the runner's.
  const record = run.read();
  const leftByWrite = setAsideWrittenState(record);
  // WHAT AN EARLIER PASS HANDED BACK STAYS HANDED BACK (G-5 of 20261108-222629-rts-delivery): its copy is gone and its path is
  // the operator's again, so it is not judged from its bytes. Judged, an edit or a reset to HEAD failed it again, and recovery
  // died on every invocation until the path held bytes whose copy no longer existed.
  const handedBack = setAsideRestoredPaths(record, dirName);
  const open = manifest.entries.filter((e) => !handedBack.has(e.path));
  // ONE STATE PER PATH (SI-D1 A): the restore decision and the overwrite guard read the same answer. A link, a directory or
  // an unreadable path is never "restored": its sha256 and mode are absent, so setAsideRestoreNeeded selects it.
  // WITHOUT THE BYTES (G-10 of 20261107-220617-si-delivery): only kind, sha256 and mode are read here, so no file's bytes
  // are held for every entry at once.
  const states = new Map(open.map((e) => [e.path, pathState(caps, e.path)]));
  const written = [];
  const needed = setAsideRestoreNeeded(open, states);
  const facts = headFacts(caps, needed, (p) => states.get(p));
  for (const e of needed) {
    const state = states.get(e.path);
    try {
      // ONLY OVER THE STATE THE SET-ASIDE LEFT (G-11): HEAD's blob, or absent for a new file, or the exact bytes a failed
      // write-back of it left (G-4). Anything else is not the runner's to overwrite.
      const leftHere = leftByWrite.get(e.path);
      if (state.kind === 'link' || state.kind === 'directory' || state.kind === 'unreadable') {
        failed.push({ path: e.path, why: `it is now ${state.kind === 'unreadable' ? `unreadable (${state.why})` : `a ${state.kind}`}, so nothing was written through it` });
        continue;
      }
      if (!setAsideMayOverwrite(e, state, facts, leftHere)) { failed.push({ path: e.path, why: 'it changed since it was set aside, so it was not overwritten' }); continue; }
      // READ AGAIN JUST BEFORE THE WRITE (G-11 of 20261107-220617-si-delivery): the guard above used the state read before
      // the loop, so an edit made since then would be overwritten. A path that moved from that state is skipped and named.
      // ONE FILE'S BYTES AT A TIME (G-2 of 20261108-060730-si-remediation-6-review-b): this keeps none, and writeCopyBack's
      // frame, which holds the copy and then the written file, ends before the next entry.
      const now = pathState(caps, e.path);
      if (now.kind !== state.kind || now.sha256 !== state.sha256 || now.mode !== state.mode) { failed.push({ path: e.path, why: 'it changed since it was set aside, so it was not overwritten' }); continue; }
      const refused = writeCopyBack(caps, e, dir);
      if (refused) { failed.push(refused); continue; }
      written.push(e);
    } catch (err) { failed.push({ path: e.path, why: err.code ?? err.message }); }
  }
  const bad = new Map(failed.map((f) => [f.path, f]));
  // WHAT A FAILED WRITE LEFT, KEPT ACROSS A SKIP (found by the runner-test-seam stage 4 tests): an entry whose write fails in
  // this pass records what this write left; one skipped in this pass keeps what an earlier failed write left, as read through
  // lib above. Dropped, a retry after the cause was fixed refused the runner's own failed write as a change.
  const leftBy = (e) => {
    const f = bad.get(e.path);
    if (!f) return null;
    if (f.written) return { sha256: f.written, mode: Number.isInteger(f.writtenMode) ? f.writtenMode : null };
    return leftByWrite.get(e.path) ?? null;
  };
  run.save({ set_aside_dir: dirName, set_aside: manifest.entries.map(({ copy, ...e }) => {
    const left = leftBy(e);
    return { ...e, restored: !bad.has(e.path),
      ...(left ? { written_sha256: left.sha256, ...(Number.isInteger(left.mode) ? { written_mode: left.mode } : {}) } : {}) };
  }) });
  if (!failed.length) {
    // A REMOVAL THAT FAILS IS NAMED (G-12): the bytes are back, but source copies left in evidence/ must not go unsaid.
    try { owner.remove(dir, { recursive: true }); } catch (err) {
      log(`remediate: wrote back every set-aside file, but could not remove the copies under ${dirName} in the run directory (${err.code ?? err.message}); delete that folder by hand`);
    }
  } else {
    // Only the copies of the entries written back go; the skipped entries' copies and the manifest stay (SI-D2 A).
    // EVERY RESTORED ENTRY'S COPY (G-14 of 20261108-021347-si-remediation-2-review): one already matching its copy, after an
    // interrupted earlier write-back, is restored without being written here, and its copy went unremoved.
    // A FAILED REMOVAL IS NAMED (G-10 of 20261108-032104-si-remediation-4-review): only an absent copy is silent.
    for (const e of manifest.entries.filter((x) => !bad.has(x.path))) {
      try { owner.remove([...dir, 'files', e.copy]); } catch (err) {
        if (err.code !== 'ENOENT') log(`remediate: wrote back ${e.path}, but could not remove the copy of it under ${dirName} in the run directory (${err.code ?? err.message}); delete it by hand`);
      }
    }
  }
  return failed;
}

// One entry's copy written to its path and read back: what the write-back records if the two differ, otherwise null.
// THE RUNNER'S TWO WRITE-BACK SEAMS act on the `tree` it passes in (runner-test-seam.plan.md stage 1), not here: a first
// `replace` that throws, or one that writes other bytes than it is given.
// THE COPY'S BYTES ONLY INSIDE withFileBytes (runner-test-seam.plan.md stage 3): read and written in one callback, which
// ends before the written file is read back, through pathState, in a callback of its own.
function writeCopyBack(caps, e, dir) {
  caps.owner.withFileBytes([...dir, 'files', e.copy], (copyBytes) => caps.tree.replace(treeSegs(e.path), copyBytes,
    { mode: e.mode ?? null }));   // a manifest written before `mode` existed keeps the process default, as before
  publish('writeBack', { path: e.path });
  const after = pathState(caps, e.path);
  // ITS MODE TOO (G-18 of 20261107-224233-si-remediation-review): a wrong-mode write is not restored, and its copy stays.
  if (after.kind !== 'file' || after.sha256 !== e.sha256 || (e.mode != null && after.mode !== e.mode)) return { path: e.path, why: 'its hash differs after writing', written: after.sha256 ?? null, writtenMode: after.mode ?? null };
  return null;
}
// --- set-aside: end
