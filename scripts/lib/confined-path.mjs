// confined-path.mjs — THE ONE OWNER OF A PATH BELOW AN ADMITTED DIRECTORY (run-dir-descendants.plan.md stage 1; design
// run-dir-descendants.design.md, D-D1 A and D-D2 A).
//
// admitRun admits a run directory; what a script then did below it was composed per site, and each review found the
// neighbours of the sites the last remediation fixed (the round cap of 20261024-130245-rdt-remediation-4). Here every
// path below the admitted root is built from SAFE SINGLE NAMES and walked level by level: each level is lstat'ed before
// it is used, and a link or junction at ANY level is refused, whatever it leads to (D-D2 A; a link that resolves back
// inside the run is refused too, because what it resolves to can change). A missing directory is created
// non-recursively and lstat'ed again before the next level. A file is created exclusively (`wx`); an existing name, a
// dangling link included, is refused. An atomic replace writes its temporary file through the same exclusive create, in
// the same checked directory.
//
// THE RESIDUAL (D-D1 A): the check and the open are two calls, so a process that can write the run directory can swap a
// level for a link between them. That is narrowed, not closed; a post-open identity check or a native addon (D-D1 B, C)
// is not built. ARCHITECTURE.md A-30 states the rule and this residual.
//
// Pure: the platform arrives as `io` (ARCHITECTURE §2), so a fake filesystem is enough to test the decisions.

import path from 'node:path';

/**
 * How many temporary names a replace tries before it refuses (G-12 of 20261029-065343-rdd-remediation-2-review), and how
 * many numbered names io/atomic.mjs's freeEvidenceName hands out: one bound, stated once (G-6 of
 * 20261029-134336-rdd-remediation-3-review).
 */
export const TMP_MAX = 100;

/** A refusal: thrown, with the path and the reason, so a caller's existing catch reports it like any other write error. */
// `refusal` TAGS THE KIND a caller may branch on (G-4 of 20261107-220617-si-delivery): 'link', 'not-a-directory' or 'taken',
// so no caller has to match this file's prose, which may be reworded; null where no caller branches. 'not-a-file' too, and
// every not-a-directory refusal tagged (G-1 of 20261107-224233-si-remediation-review: three readers still matched prose).
function refused(where, why, refusal = null) {
  return Object.assign(new Error(`confined path refused: ${where} — ${why}`), { code: 'ECONFINED', path: where, refusal });
}
/** A missing name, as fs reports one, so a reader converted from raw fs keeps its ENOENT branch. */
function missing(where) {
  return Object.assign(new Error(`ENOENT: no such file or directory, ${where}`), { code: 'ENOENT', path: where });
}

/** A safe single name: not empty, no separator of either kind, not `.` or `..`, no NUL, no `:` (a Windows stream). */
export function unsafeSegment(seg) {
  if (typeof seg !== 'string' || seg === '') return 'an empty or non-string name';
  if (seg === '.' || seg === '..') return `"${seg}" names no single entry`;
  if (/[\\/]/.test(seg)) return `"${seg}" holds a path separator`;
  if (seg.includes('\0')) return 'a name holds NUL';
  if (seg.includes(':')) return `"${seg}" holds ":" (a drive or a Windows alternate stream)`;
  return null;
}

/**
 * At most `max + 1` bytes from an open descriptor, as a Buffer (G-7 of 20261112-063354-hl-remediation-4-review): a caller
 * bounding a file refuses one whose read returns more than `max`, having held no more than one byte past the bound. A
 * whole-file read after a stat allocated whatever the file had grown to before the check could refuse it. Here, beside
 * readBounded, because the descriptor is opened only by this owner (lib/egress-read.mjs re-exports it).
 */
export function readAtMost(fs, fd, max) {
  const cap = Math.max(0, Math.floor(Number(max))) + 1;
  const chunks = [];
  let got = 0;
  while (got < cap) {
    const buf = Buffer.alloc(Math.min(64 * 1024, cap - got));
    const n = fs.readSync(fd, buf, 0, buf.length, null);
    if (!n) break;
    chunks.push(n === buf.length ? buf : buf.subarray(0, n));
    got += n;
  }
  return Buffer.concat(chunks, got);
}

/**
 * The owner for one admitted root. `root` is the real path admitRun returned, or a folder the operator named; a link
 * or junction at it, or a file, is refused before every operation (G-10). `rename` is the
 * replace's last step (io/atomic.mjs's durableRename where the host retries a scanner-held file).
 */
export function confined({ root, io, rename = null }) {
  if (!io?.fs) throw new Error('confined: io (the platform) is required');
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error(`confined: the admitted root must be an absolute path, got ${root}`);
  const fs = io.fs;
  const doRename = rename ?? ((a, b) => fs.renameSync(a, b));

  // lstat one level: null when it does not exist; a link at it is refused.
  const level = (p) => {
    let st;
    try { st = fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    if (st.isSymbolicLink()) throw refused(p, 'a link or junction stands here; nothing below an admitted directory is followed through one', 'link');
    return st;
  };
  // THE ROOT ITSELF, before every operation (G-10 of 20261102-184751-rbr-remediation-2-review): it was not checked, so
  // each caller naming a root the operator gave lstat'ed it itself, and one (--rejudge, G-6) did not. A link or junction
  // at the root is refused, as at any level below it; a file there is not a directory. A root not yet made is not a
  // refusal: what is asked below it is ENOENT, as fs says it.
  const rootLevel = () => {
    const st = level(root);
    if (st && !st.isDirectory()) throw refused(root, 'the admitted directory is not a directory', 'not-a-directory');
  };
  const check = (segments) => {
    if (!Array.isArray(segments) || !segments.length) throw refused(root, 'no name below the admitted directory was given');
    for (const s of segments) { const why = unsafeSegment(s); if (why) throw refused(path.join(root, ...segments.map(String)), why); }
    rootLevel();
  };
  // Walk the directory levels; `make` creates a missing one (non-recursively), else a missing one is ENOENT, as fs says
  // it (run-dir-reads.plan.md stage 1: a missing directory is not a refusal, and a reader's ENOENT branch keeps working).
  const walk = (dirs, make) => {
    let p = root;
    for (const s of dirs) {
      p = path.join(p, s);
      let st = level(p);
      if (!st) {
        if (!make) throw missing(p);
        try { fs.mkdirSync(p); } catch (e) { if (e.code !== 'EEXIST') throw e; }
        st = level(p);
        if (!st) throw refused(p, 'the directory vanished after it was created');
      }
      if (!st.isDirectory()) throw refused(p, 'this is not a directory', 'not-a-directory');
    }
    return p;
  };
  // `mode`, when given, is the new file's mode (G-7 of 20261110-202954-sfo-remediation-review-c): without it the file took
  // the process default, 0644 under a usual POSIX umask, so a stdin prompt was readable by other local accounts.
  const exclusive = (p, data, mode = null) => {
    if (level(p)) throw refused(p, 'the name is already taken; an exclusive create does not overwrite', 'taken');
    const fd = fs.openSync(p, 'wx', mode ?? undefined); // undefined is openSync's own default mode
    // A FAILED WRITE LEAVES NOTHING (G-11 of 20261029-050428-rdd-delivery): the partial file is removed, so a retry's
    // exclusive create is not refused by it, and a replace leaves no orphan temporary file (G-12). An fsync failure, EIO
    // among them, is a failed write, as in io/atomic.mjs's durableWrite: the two writers refuse alike.
    let ok = false;
    try {
      // An array is written chunk by chunk from the file's position, so a caller holding output in pieces never joins it.
      for (const chunk of Array.isArray(data) ? data : [data]) fs.writeFileSync(fd, chunk);
      fs.fsyncSync(fd);
      ok = true;
    } finally {
      // A CLOSE THAT THROWS still removes a failed write (G-9 of 20261029-055946-rdd-remediation-review): the remove ran
      // after the close, so a close error skipped it and masked the write's own error.
      try { fs.closeSync(fd); } catch (e) { if (ok) { ok = false; try { fs.rmSync(p, { force: true }); } catch { /* the close's error is the report */ } throw e; } }
      if (!ok) { try { fs.rmSync(p, { force: true }); } catch { /* the write's own error is the report */ } }
    }
    return p;
  };

  return {
    root,
    /** Make the directories `segments` names (each level checked); returns the absolute path. */
    dir(segments) { check(segments); return walk(segments, true); },
    /**
     * Make the LAST directory `segments` names EXCLUSIVELY (stdin-folder-owner.plan.md stage 1, design SF-D1 A): its
     * parents are made and checked as `dir` makes them, and the last level must not exist, a link or a folder already
     * there refused as `taken`, so a caller never takes a folder another made for its own. Returns the absolute path.
     * `mode`, when given, is the new folder's mode (G-7 of 20261110-202954-sfo-remediation-review-c).
     */
    dirNew(segments, { mode = null } = {}) {
      check(segments);
      const p = path.join(walk(segments.slice(0, -1), true), segments.at(-1));
      try { if (mode == null) fs.mkdirSync(p); else fs.mkdirSync(p, { mode }); } catch (e) {
        if (e.code === 'EEXIST') throw refused(p, 'the name is already taken; a new folder is made exclusively', 'taken');
        throw e;
      }
      const st = level(p);
      if (!st?.isDirectory()) throw refused(p, 'the folder vanished after it was created');
      return p;
    },
    /** The absolute path of `segments`, every level checked, nothing created; the last level may be missing. */
    resolve(segments) {
      check(segments);
      const p = path.join(walk(segments.slice(0, -1), false), segments.at(-1));
      level(p);
      return p;
    },
    /**
     * Create a file exclusively, making its directories; refuses an existing name, a dangling link included. `mode`, when
     * given, is the new file's mode (G-7 of 20261110-202954-sfo-remediation-review-c).
     */
    create(segments, data, { mode = null } = {}) {
      check(segments);
      return exclusive(path.join(walk(segments.slice(0, -1), true), segments.at(-1)), data, mode);
    },
    /**
     * Replace a file atomically: a temporary file created exclusively in the same checked directory, then renamed.
     * `mode`, when given, is set on the temporary file before the rename (G-8 of 20261107-195640-co-remediation-2-review):
     * the fresh file otherwise takes the process default, so a write-back of an executable lost its exec bit on POSIX.
     * `times` ({ atime, mtime }, in seconds), when given, is set on it there too, so the file appears with those times.
     */
    replace(segments, data, { mode = null, times = null } = {}) {
      check(segments);
      const dir = walk(segments.slice(0, -1), true);
      const target = path.join(dir, segments.at(-1));
      const st = level(target);
      if (st && !st.isFile()) throw refused(target, 'this is not a file', 'not-a-file');
      // THE FIRST FREE TEMPORARY NAME, not a random one (G-11 of 20261029-055946-rdd-remediation-review): the pure owner
      // drew entropy from node:crypto. The exclusive create still refuses a name another writer took between the two.
      // BOUNDED (G-12 of 20261029-065343-rdd-remediation-2-review): the search had no limit, one lstat per leftover, and
      // nothing removes the leftovers; it stops at TMP_MAX and refuses, as freeEvidenceName stops at 100.
      let tmp = null;
      for (let n = 1; n <= TMP_MAX; n++) {
        const t = path.join(dir, `${segments.at(-1)}.${n}.tmp`);
        if (level(t)) continue;
        try { exclusive(t, data); tmp = t; break; } catch (e) {
          if (e.code !== 'EEXIST' && !(e.code === 'ECONFINED' && e.refusal === 'taken')) throw e;
        }
      }
      if (!tmp) throw refused(target, `every temporary name up to .${TMP_MAX}.tmp is taken; remove the leftovers`);
      try { if (mode != null) fs.chmodSync(tmp, mode); if (times) fs.utimesSync(tmp, times.atime, times.mtime); doRename(tmp, target); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* the throw is the report */ } throw e; }
      return target;
    },
    /** Read a file below the root; a link at any level, the file included, is refused. */
    read(segments, encoding = 'utf8') {
      check(segments);
      const p = path.join(walk(segments.slice(0, -1), false), segments.at(-1));
      const st = level(p);
      if (!st) throw missing(p);
      if (!st.isFile()) throw refused(p, 'this is not a file', 'not-a-file');
      return fs.readFileSync(p, encoding);
    },
    /**
     * A file's bytes below the root, at most `max + 1` of them (readAtMost): the walk and the refusals are read's, and the
     * descriptor is opened after the check. A result longer than `max` is the caller's refusal.
     */
    readBounded(segments, max) {
      check(segments);
      const p = path.join(walk(segments.slice(0, -1), false), segments.at(-1));
      const st = level(p);
      if (!st) throw missing(p);
      if (!st.isFile()) throw refused(p, 'this is not a file', 'not-a-file');
      const fd = fs.openSync(p, 'r');
      try { return readAtMost(fs, fd, max); } finally { fs.closeSync(fd); }
    },
    /**
     * Read a file below the root line by line, handing each line (without its `\n`) to `onLine` as it completes, so no
     * whole-file string is held (usage-report-reviewed-runs.plan.md stage 3). The walk and the refusals are read's; the
     * file is read in `chunkBytes` pieces from the descriptor opened after the check. A `\n` byte never sits inside a
     * multi-byte UTF-8 sequence, so splitting the bytes there and decoding each line whole keeps every character.
     * A line longer than `maxLineBytes` is refused (ELINETOOLONG), naming its number, before more than that is held
     * (G-7 of 20261031-022756-urr-remediation-review): the pieces of an unended line grew without bound. The lines before
     * it have been handed over; the default, 64 MB, is far above any transcript record and still a bound.
     */
    readLines(segments, onLine, { chunkBytes = 64 * 1024, maxLineBytes = 64 * 1024 * 1024 } = {}) {
      check(segments);
      const p = path.join(walk(segments.slice(0, -1), false), segments.at(-1));
      const st = level(p);
      if (!st) throw missing(p);
      if (!st.isFile()) throw refused(p, 'this is not a file', 'not-a-file');
      const fd = fs.openSync(p, 'r');
      try {
        const buf = Buffer.alloc(chunkBytes);
        // THE PIECES OF THE LINE NOT YET ENDED, each copied once and joined once at its newline (G-7 of
        // 20261031-013928-urr-delivery): the remainder was concatenated with every chunk, quadratic in a long line.
        let pending = [];
        let pendingBytes = 0;
        let lineNo = 1;
        const tooLong = () => Object.assign(new Error(`line ${lineNo} of ${p} is longer than ${maxLineBytes} bytes; it is not read`),
          { code: 'ELINETOOLONG', path: p });
        let n;
        while ((n = fs.readSync(fd, buf, 0, chunkBytes, null)) > 0) {
          const data = buf.subarray(0, n);
          let start = 0;
          for (let i = data.indexOf(10); i !== -1; i = data.indexOf(10, start)) {
            if (pendingBytes + (i - start) > maxLineBytes) throw tooLong();
            onLine(pending.length ? Buffer.concat([...pending, data.subarray(start, i)]).toString('utf8') : data.toString('utf8', start, i));
            pending = [];
            pendingBytes = 0;
            lineNo++;
            start = i + 1;
          }
          if (start < n) {
            pendingBytes += n - start;
            if (pendingBytes > maxLineBytes) throw tooLong();
            pending.push(Buffer.from(data.subarray(start)));
          }
        }
        if (pending.length) onLine(Buffer.concat(pending).toString('utf8'));
      } finally {
        fs.closeSync(fd);
      }
    },
    // THE READ SIDE'S OTHER QUESTIONS (run-dir-reads.plan.md stage 1, R-D2 A): the helpers and the status probes asked
    // existsSync, readdirSync and statSync of a joined path, each following a link at any level. These walk as read does.
    /** Does the name exist? A missing name or directory level is false; a link at any level, the name included, is refused. */
    exists(segments) {
      check(segments);
      let dir = root;
      for (const s of segments.slice(0, -1)) {
        dir = path.join(dir, s);
        const st = level(dir);
        if (!st) return false;
        if (!st.isDirectory()) throw refused(dir, 'this is not a directory', 'not-a-directory');
      }
      return level(path.join(dir, segments.at(-1))) !== null;
    },
    /** A directory's names (`opts` as readdirSync's); `[]` lists the root itself. Every level, the directory included, walked. */
    list(segments, opts) {
      if (!Array.isArray(segments)) throw refused(root, 'the names to list must be an array');
      if (segments.length) check(segments); else rootLevel();
      const p = walk(segments, false);
      return opts === undefined ? fs.readdirSync(p) : fs.readdirSync(p, opts);
    },
    /** lstat of the name after the walk; missing is ENOENT, a link at any level, the name included, is refused. */
    stat(segments) {
      check(segments);
      const p = path.join(walk(segments.slice(0, -1), false), segments.at(-1));
      const st = level(p);
      if (!st) throw missing(p);
      return st;
    },
    /**
     * Remove a file, or a directory with `recursive`, below the root; a missing name is nothing to remove (false). A link
     * at any level, the name included, is refused, not removed: what stands there was not put there by a run writer.
     * With `empty`, a directory is removed only when it holds nothing, and one that does is left, its ENOTEMPTY thrown
     * (G-3 of 20261105-070121-crsf-remediation-2-review: the stop record did that raw, on a path resolved before its lock).
     */
    remove(segments, { recursive = false, empty = false } = {}) {
      check(segments);
      let dir = root;
      for (const s of segments.slice(0, -1)) {
        dir = path.join(dir, s);
        const st = level(dir);
        if (!st) return false;
        if (!st.isDirectory()) throw refused(dir, 'this is not a directory', 'not-a-directory');
      }
      const p = path.join(dir, segments.at(-1));
      const st = level(p);
      if (!st) return false;
      if (empty) {
        if (!st.isDirectory()) throw refused(p, 'this is not a directory; an empty-only remove takes a directory', 'not-a-directory');
        fs.rmdirSync(p);
        return true;
      }
      if (st.isDirectory() && !recursive) throw refused(p, 'this is a directory; pass recursive to remove it');
      fs.rmSync(p, { recursive: st.isDirectory(), force: true });
      return true;
    },
    /** Rename a file below the root to a free name below it; both ends checked, the target never overwritten. */
    rename(from, to) {
      check(from); check(to);
      const src = path.join(walk(from.slice(0, -1), false), from.at(-1));
      const st = level(src);
      if (!st) throw missing(src);
      if (!st.isFile()) throw refused(src, 'this is not a file', 'not-a-file');
      const dest = path.join(walk(to.slice(0, -1), true), to.at(-1));
      if (level(dest)) throw refused(dest, 'the name is already taken; a rename does not overwrite', 'taken');
      doRename(src, dest);
      return dest;
    },
    /** Is the name free? Missing is free; anything at it, a dangling link included, is not. */
    isFree(segments) {
      check(segments);
      // LEVEL BY LEVEL, as every other operation (G-12 of 20261029-055946-rdd-remediation-review): an lstat of the joined
      // parent follows a link at an earlier level, so a link there with a deeper directory missing read as free, unchecked.
      let dir = root;
      for (const s of segments.slice(0, -1)) {
        dir = path.join(dir, s);
        const st = level(dir);
        if (!st) return true;
        if (!st.isDirectory()) throw refused(dir, 'this is not a directory', 'not-a-directory');
      }
      try { fs.lstatSync(path.join(dir, segments.at(-1))); return false; } catch (e) { if (e.code === 'ENOENT') return true; throw e; }
    },
  };
}
