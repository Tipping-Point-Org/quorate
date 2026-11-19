// atomic.mjs — durable JSON writes, in one place.
//
// run.json is a run's only durable record of the frozen contract, scope and intent sha; the
// ledger's hand-set statuses cannot be reconstructed from anything. A bare writeFileSync
// truncates before it writes, so an interruption inside the window destroys exactly the file
// that explains what was being done. run-graph learned this (its private writeJson), the ledger
// learned it separately (G-11 of the postbench2 run) — and run-checks and new-run kept bare
// writes because the cure was module-private both times (round-3 G-10). One home now: tmp,
// fsync, rename.
// MOVED OUT OF lib/ (os-platform-adapters stage 4): this module exists to do I/O, and lib/ does none.
// It reaches the filesystem through the platform layer, resolved at call time — see hostFs.
import path from 'node:path';
import { hostPlatform, hostFs as fs, hostProc } from '../platform/index.mjs';
import { tempNameFor, renameRetry } from '../lib/walk-rules.mjs';
import { TMP_MAX } from '../lib/confined-path.mjs';

/**
 * A temp path NO OTHER WRITER WILL CHOOSE.
 *
 * All three writers below used `${p}.tmp`, derived from the target alone — so two processes writing the
 * SAME file picked the same scratch name, the first renamed it away, and the second died on a rename
 * with nothing to rename:
 *
 *   ENOENT: rename '.claude/reviews/latest.txt.tmp' -> '.claude/reviews/latest.txt'
 *
 * That is the intermittent failure this suite chased for a week and could never reproduce in
 * isolation: three different tests (intent-drift, the egress allow-list, the intent settings file)
 * each mint a real run, `new-run` writes `latest.txt` through this function, and the runner executes
 * test files in parallel. Whichever mint lost the race crashed, and the test that owned it reported
 * something else — a stamp that should not be there, an allow-list that looked wrong — because the
 * mint it depended on had died for an unrelated reason.
 *
 * It is NOT only a test problem. Two `new-run` invocations in one repository is an ordinary thing for
 * a person to do, and this made one of them fail at the pointer write.
 *
 * pid plus a counter plus randomness: the pid separates processes, the counter separates two writes in
 * one process within the same millisecond, and the random suffix covers a recycled pid in a container.
 */
export function tempFor(p, { pid = process.pid, rand = randomSuffix } = {}) {
  return tempNameFor(p, { pid, rand: rand() });
}

/** Six base-36 characters. Kept beside tempFor so the default it injects is visible next to it. */
function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * THE RENAME IS THE ATOM — except on Windows, where it is not.
 *
 * Unique temp names stop two writers from fighting over one scratch file. They do NOT stop two
 * writers from renaming onto the same DESTINATION, and that is a second, independent defect on the
 * platform this project actually runs on: POSIX `rename(2)` replaces the destination atomically, and
 * Windows `MoveFileEx(REPLACE_EXISTING)` fails outright while any other handle is open on it —
 *
 *   EPERM: operation not permitted, rename 'latest.txt.112484.10.pc0nhy.tmp' -> 'latest.txt'
 *
 * — reproduced by four processes writing `latest.txt`, with the unique temp names already in place.
 * Nothing about the first fix was wrong; it simply uncovered the next layer, which was invisible while
 * the ENOENT was firing first.
 *
 * The cure is a BOUNDED retry on exactly the transient Windows codes, because the condition it
 * reports — another process holding the destination for a moment — clears in milliseconds. Three
 * things this deliberately does not do:
 *
 *  - it does not retry forever. graceful-fs backs off for 60 seconds; a pointer write that takes a
 *    minute has failed, and hiding that behind a long wait turns a visible crash into a wait nobody
 *    can see the end of.
 *  - it retries ONLY on win32, and only on EPERM/EACCES/EBUSY. Those three are how Windows reports a
 *    destination someone else holds open. An earlier version of this comment said EACCES "must
 *    surface on the first attempt" while the set below retried it — prose contradicting the code it
 *    sat above (G-13). On every other platform, and for every other errno, the first failure is the
 *    answer.
 *  - it does not leave the scratch file behind — and the first version of this claim was FALSE
 *    (G-17, three nodes across two families). Only this function's failure branch removed the temp,
 *    so a throw from writeFileSync, fsyncSync, or JSON.stringify on a cyclic object left a new orphan
 *    every time. The old fixed `${p}.tmp` was self-cleaning by accident: the next write reclaimed it.
 *    Unique names removed that, so every writer now cleans up on ANY failure, not just this one.
 *
 * What this does not buy, stated because the module would otherwise read as concurrency-safe: it
 * makes each write LAND, not each write SURVIVE. Last-write-wins is correct for `latest.txt` and for
 * a whole-file rewrite of run.json. It is NOT correct for `appendTextAtomic`, which is a
 * read-modify-write: two concurrent appends both read the old file and the second's rename discards
 * the first's addition. That is a lost update, no rename can fix it, and it is on the backlog rather
 * than papered over here.
 */
// The retryable codes are a fact about the OPERATING SYSTEM and live in scripts/platform/win32/ —
// this module held a second copy, and two owners of one fact is what A-1 forbids.
// How many attempts, how long between them, and how a scratch file is named are RULES, in
// lib/walk-rules.mjs (G-7 of 20260925-015614-platform-review); this module performs the writes.

/**
 * Block this thread for `ms` WITHOUT burning a core.
 *
 * The first version spun: `while (Date.now() < until) {}`, up to 5ms x (1+...+19) = 950 ms per
 * contended write, with the spinning waiter competing for CPU against the very handle holder it was
 * waiting on (G-16, perf-audit and panel-codex-perf independently). Atomics.wait on a lock nobody
 * ever notifies is the synchronous sleep: it yields the core and returns on timeout. Synchronous
 * deliberately — every caller here is synchronous, and going async would change the ordering
 * guarantees they were written against.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Injected rather than read from module scope (A-2, G-15): the retryable codes, the two fs calls and
 * the sleep all arrive as parameters with defaults, which is the convention `freeEvidenceName` in
 * this same file already used for `exists`. It is also what makes the win32 retry branch testable off
 * win32: pass that platform's `transientRenameCodes`.
 */
export function durableRename(tmp, p, {
  transientCodes = hostPlatform().transientRenameCodes,
  rename = fs.renameSync,
  remove = (t) => fs.rmSync(t, { force: true }),
  sleep = sleepSync,
} = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      rename(tmp, p);
      return;
    } catch (err) {
      const next = renameRetry({ code: err.code, attempt, transientCodes });
      if (!next.retry) {
        try { remove(tmp); } catch { /* the throw below is the report */ }
        throw err;
      }
      sleep(next.waitMs);
    }
  }
}

/**
 * Write the bytes, fsync, rename — and remove the scratch file if ANY of that throws (G-17).
 *
 * The three writers had this body three times with one line different. Sharing it is what makes the
 * cleanup impossible to add to two of them and forget in the third.
 */
function durableWrite(p, render) {
  const tmp = tempFor(p);
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, render());
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    // `render()` runs inside this try on purpose: JSON.stringify of a cyclic object throws there, and
    // that was one of the orphan paths the finding named.
    try { fs.rmSync(tmp, { force: true }); } catch { /* the throw below is the report */ }
    throw err;
  }
  durableRename(tmp, p);
}

export function writeJsonAtomic(p, obj) {
  durableWrite(p, () => `${JSON.stringify(obj, null, 2)}\n`);
}

/**
 * A durable TEXT write — the same tmp/fsync/rename as the JSON one, for a file that is not JSON.
 *
 * `latest.txt` is the pointer milestone gating reads to find the current run, and it was written
 * bare (G-24): writeFileSync truncates before it writes, so an interruption inside that window
 * leaves the pointer EMPTY while the run directory it names is perfectly intact — a derived file
 * losing the reference to a durable one, which is the failure this module exists for.
 */
export function writeTextAtomic(p, text) {
  durableWrite(p, () => String(text));
}

/**
 * The same durability for TEXT, and for an APPEND that must not half-land.
 *
 * `fs.appendFileSync` on an artifact a reader may already be holding is two hazards at once: an
 * interruption mid-append leaves a truncated tail in a file nothing marks as incomplete, and the
 * file changes UNDER whoever consumed it. reconciled.md is exactly that file — second-opinion
 * audits it, and the tie-break rulings were appended afterwards (G-48), so the adjudication a
 * reader ends up with is not the version that was audited.
 *
 * Read, concatenate, write to a tmp, fsync, rename. The rename is the atom: a reader sees either
 * the old file or the whole new one, and never a partial tail.
 */
export function appendTextAtomic(p, text, { read = (q) => fs.readFileSync(q, 'utf8') } = {}) {
  let existing = '';
  // ONLY ENOENT MEANS "FIRST WRITE" (G-6 of 20260925-015614-platform-review). Every read failure was
  // treated that way, so a file that existed but could not be read at that moment was replaced by
  // the new text alone — the earlier content silently gone. Anything else is the caller's to see.
  try { existing = read(p); } catch (e) { if (e?.code !== 'ENOENT') throw e; }
  durableWrite(p, () => existing + text);
}

/**
 * Remove a stale lock — but only while holding `<lock>.reclaim`, and only if it is STILL stale then
 * (G-6 of 20260925-200721-platform-remediated). Check-then-remove let two waiters both judge one old
 * lock stale: the first removed it and took a fresh one, and the second, acting on its earlier
 * judgement, removed that fresh lock and took it as well — two holders of an exclusive lock.
 * Serialising the reclaim and re-checking under it means a stale judgement can only ever delete a lock
 * that is still stale. A reclaim file left by a process that died mid-reclaim is itself removed after
 * RECLAIM_STALE_MS; a reclaim takes microseconds, so anything that old is abandoned.
 */
const RECLAIM_STALE_MS = 10_000;

/**
 * Whether the lock at `lockPath` has been abandoned: null when it no longer exists. Age alone was the
 * evidence, and a held lock is never touched, so a holder still working past staleMs lost its lock
 * (G-6's second half). The lock names its holder's pid; a named holder that is alive is never
 * abandoned, whatever the age. Age decides for a holder that has exited or is not named.
 */
function abandoned(lockPath, staleMs) {
  // NULL MEANS VANISHED, AND ONLY THAT (G-4 of 20260926-002850-m0-close). Every stat or read failure
  // returned null, which the caller retries at once without sleeping or checking its deadline — so a
  // lock that exists but cannot be read (EACCES, EBUSY, a directory) spun a core forever. Anything but
  // ENOENT means "it exists and its holder cannot be told": held, which sleeps and times out.
  const gone = (e) => (e?.code === 'ENOENT' ? null : false);
  let age;
  try { age = Date.now() - fs.statSync(lockPath).mtimeMs; } catch (e) { return gone(e); }
  if (age <= staleMs) return false;
  let pid = NaN;
  try { pid = Number(fs.readFileSync(lockPath, 'utf8').trim()); } catch (e) { return gone(e); }
  return !(Number.isInteger(pid) && pid > 0 && hostProc.isAlive(pid));
}

// TRUE MEANS LOOK AGAIN NOW, FALSE MEANS WAIT (G-9 of 20261029-190658-rdr-delivery): a marker that stands, or that
// exists but cannot be stat'd or removed, returned to a caller that retried at once, the spin G-4 removed from
// abandoned(). Only a marker that vanished, or one this call reclaimed or removed, retries without waiting.
function reclaimIfStillStale(lockPath, staleMs, beforeReclaim) {
  const reclaim = `${lockPath}.reclaim`;
  try {
    fs.closeSync(fs.openSync(reclaim, 'wx'));
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e;
    try {
      if (Date.now() - fs.statSync(reclaim).mtimeMs > RECLAIM_STALE_MS) fs.rmSync(reclaim, { force: true }); else return false;
      return true;   // an abandoned marker removed: look again now
    } catch (e2) { return e2?.code === 'ENOENT'; }
  }
  try {
    if (beforeReclaim) beforeReclaim();   // test seam: another process's move, at the worst moment
    if (abandoned(lockPath, staleMs)) fs.rmSync(lockPath, { force: true });
  } finally {
    fs.rmSync(reclaim, { force: true });
  }
  return true;
}

/**
 * An exclusive lock on `lockPath`, for a read-modify-write that must not interleave with another
 * process's (G-5 of 20260925-015614-platform-review: two ledger folds each loaded the same snapshot,
 * and the later save dropped the other's findings). Returns the release function, which is also
 * registered to run on process exit, so a `die()` mid-write still lets go.
 *
 * The lock is a file created with O_EXCL, holding its holder's pid. One left behind by a process that
 * died is reclaimed once it is older than `staleMs` — a crash must not lock the ledger forever — but
 * never while that pid is alive, however old the lock (G-6). A writer that cannot
 * get it within `timeoutMs` throws, naming the file, rather than waiting without end.
 */
export function acquireFileLock(lockPath, { timeoutMs = 30_000, staleMs = 120_000, sleep = sleepSync, beforeReclaim = null } = {}) {
  // The directory may not exist yet — a repository's FIRST ledger fold has no .claude/reviews/. The
  // save this lock guards always created it; taking the lock first without doing so crashed that
  // first fold with ENOENT (found while demonstrating G-4, a regression from the G-5 lock).
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });   // names its holder (G-6)
      break;
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      const gone = abandoned(lockPath, staleMs);
      if (gone === null) continue;   // released meanwhile
      if (gone && reclaimIfStillStale(lockPath, staleMs, beforeReclaim)) continue;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`lock ${lockPath} is held by another process (waited ${timeoutMs} ms); `
          + `if nothing else is running, delete it`);
      }
      sleep(50);
    }
  }
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    try { fs.rmSync(lockPath, { force: true }); } catch { /* already gone */ }
  };
  process.once('exit', release);
  return release;
}

/**
 * A free name under `dir`, so a second write never lands on the first one's file.
 *
 * The sibling of the durable write above: that one is about a write that is interrupted, this one is
 * about a write that SUCCEEDS and destroys the record it lands on. /request's critique retries once
 * under the same node id, and the retry deleted the first attempt's raw log and envelope — the two
 * artifacts that say why the retry was needed at all. Evidence a later write can silently replace is
 * not evidence, it is a cache.
 *
 * The first write keeps the plain name, so every existing reader is unaffected; each retry lands
 * beside it as `raw.2.log`, `raw.3.log`, and the caller must cite the name it was GIVEN rather than
 * the one it assumed (G-13).
 *
 * THROWS at a hundred rather than picking a victim. The first version stopped its loop at `n < 100`
 * while still returning the taken `.99` path, so the hundredth attempt overwrote the ninety-ninth —
 * a bound that failed into the exact defect it guarded, and only after enough retries that nobody
 * would be watching (G-10). A hundred attempts on one node id is a loop, not a retry pattern.
 */
export function freeEvidenceName(at, base, ext) {
  // AN OWNER AND THE NAMES BELOW IT (run-dir-reads.plan.md stage 3; G-2 of 20261029-134336-rdd-remediation-3-review): a
  // folder below a run is given as { owner, segments }, and each candidate is tested through owner.isFree, every level
  // walked, rather than by an lstat of a joined path. ONLY THAT FORM (G-10 of 20261029-190658-rdr-delivery): a raw folder
  // was still accepted beside it, so a caller could choose a name without the owner.
  if (!at || typeof at !== 'object' || typeof at.owner?.isFree !== 'function' || !Array.isArray(at.segments)) {
    throw new TypeError('freeEvidenceName: give the folder as { owner, segments }, an owner and the names below it');
  }
  const { owner, segments } = at;
  const exists = (p) => !owner.isFree([...segments, path.basename(p)]);
  const dir = path.join(owner.root, ...segments);
  let p = path.join(dir, `${base}${ext}`);
  for (let n = 2; exists(p); n++) {
    if (n > TMP_MAX) throw new Error(`refusing to write a ${TMP_MAX}th ${base}${ext} in ${dir} — something is retrying without bound`);
    p = path.join(dir, `${base}.${n}${ext}`);
  }
  return p;
}
