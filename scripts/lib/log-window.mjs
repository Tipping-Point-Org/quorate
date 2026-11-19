// log-window.mjs — the head and tail of a captured command's output, without ever joining it.
//
// capture.mjs writes a bounded log: the first quarter and the last three quarters of the cap, with
// the middle dropped and the drop stated. Building that window used to start with
// `Buffer.concat([stdout, stderr])` — a full copy of everything the command produced, up to the
// 64 MiB spawn buffer — only to keep about a megabyte of it. The one script whose input class is a
// project's own build and test output doubled its peak memory at exactly the moment that output was
// already enormous (G-8).
//
// Extracted rather than left inline because the correctness question — does the window hold the
// REAL first and last bytes of the virtual stream? — is only answerable by a test, and a test cannot
// reach a slice buried in a CLI whose commands are allow-listed.

/**
 * The `len` bytes starting at `from` of the virtual stream formed by concatenating `pieces`, as the
 * subarrays that make it up. Nothing is copied: each returned buffer is a view into a piece.
 *
 * Out-of-range requests return what actually exists, so a caller asking for a window larger than the
 * stream gets the whole stream rather than an exception.
 */
export function sliceStream(pieces, from, len) {
  const out = [];
  let at = 0;
  let cursor = Math.max(0, from);
  let want = Math.max(0, len);
  for (const buf of pieces) {
    if (want <= 0) break;
    const start = Math.max(0, cursor - at);
    if (start < buf.length) {
      const take = Math.min(buf.length - start, want);
      out.push(buf.subarray(start, start + take));
      want -= take;
      cursor += take;
    }
    at += buf.length;
  }
  return out;
}

/**
 * Head, notice, tail — the pieces of a truncated log, in order.
 *
 * HEAD AND TAIL, not head alone. For the two command classes capture exists to run — a declared
 * build and a declared test suite — the diagnosis is at the END: which test failed, the error list,
 * the summary counts. Keeping only the head meant a lens capturing a >1 MiB failing run cited a log
 * that stopped mid-run (G-9).
 *
 * THE NOTICE IS INSIDE `max`, NOT ON TOP OF IT (G-5). It used to be excluded — documented, and
 * still wrong: capture's caller bounds the log ON DISK at the figure I-30 states, so every byte the
 * framework adds has to come out of the budget or the artifact exceeds the limit by exactly the
 * bookkeeping the limit was written in. The notice's own length depends on the numbers it prints,
 * which depend on the split, so it is rendered, measured, and the window recomputed against what is
 * left; a second render can differ by a digit, and the tail absorbs the difference. The result is
 * never larger than `max`.
 *
 * @param {Buffer[]} pieces  the stream in order, conventionally [stdout, stderr]
 * @param {number} max       total bytes to keep, INCLUDING the notice
 * @param {(info: {total: number, headBytes: number, tailBytes: number, dropped: number}) => Buffer} notice
 */
export function logWindow(pieces, max, notice) {
  const total = pieces.reduce((n, b) => n + b.length, 0);
  if (total <= max) return [...pieces];

  // RESERVED AT THE WORST CASE, then padded — not iterated to a fixed point, which may not have
  // one. Each number the notice prints is at most `total`, so rendering it with `total` in every
  // slot gives an upper bound on its length that no real render can exceed. The split is computed
  // against what that leaves, the notice is rendered with the TRUE numbers, and the difference is
  // padded with spaces.
  //
  // The first attempt at this recomputed the split after rendering and clamped the tail to fit —
  // which made the window one byte shorter than the notice it had already printed, so the log
  // stated a tail length it did not contain. A truncation notice is the one line in the artifact a
  // reader has to take on trust; it does not get to be approximately right.
  const reserve = notice({ total, headBytes: total, tailBytes: total, dropped: total }).length;
  const budget = Math.max(0, max - reserve);
  const headBytes = Math.floor(budget / 4);
  const tailBytes = budget - headBytes;

  const note = notice({ total, headBytes, tailBytes, dropped: total - headBytes - tailBytes });
  const padded = note.length < reserve
    ? Buffer.concat([note, Buffer.from(' '.repeat(reserve - note.length))])
    : note;

  return [
    ...sliceStream(pieces, 0, headBytes),
    padded,
    ...sliceStream(pieces, total - tailBytes, tailBytes),
  ];
}


/**
 * A STREAM KEPT AS ITS HEAD AND TAIL (capture-interactive.plan.md stage 3). capture.mjs read its command through spawnSync
 * into one buffer of up to 64 MiB, then kept a window of it. The async core streams instead, so a collector keeps each
 * stream's first and last `limit` bytes and its true total: memory is bounded by 4 x limit whatever the command prints,
 * and every window logWindow takes of at most `limit` bytes is inside what was kept.
 *
 * `take(name, chunk)` is the collector io/spawn-capture.mjs calls; `result()` gives `{ stdout, stderr }`, each
 * `{ head, tail, total }`. Pure: it holds Buffers and does no I/O.
 */
export function headTailKeeper(limit) {
  if (!Number.isInteger(limit) || limit <= 0) throw new RangeError(`headTailKeeper: limit must be a positive integer, got ${limit}`);
  const fresh = () => ({ head: [], headLen: 0, tail: [], tailLen: 0, total: 0 });
  const streams = { stdout: fresh(), stderr: fresh() };
  const take = (name, chunk) => {
    const s = streams[name];
    if (!s) throw new RangeError(`headTailKeeper: no stream named ${name}`);
    const d = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    s.total += d.length;
    const room = limit - s.headLen;
    if (room > 0) { const part = d.subarray(0, room); s.head.push(part); s.headLen += part.length; }
    s.tail.push(d);
    s.tailLen += d.length;
    // Trimmed only once it holds twice the limit, so the work per byte stays constant.
    if (s.tailLen > 2 * limit) {
      const all = Buffer.concat(s.tail);
      s.tail = [all.subarray(all.length - limit)];
      s.tailLen = limit;
    }
  };
  const done = (s) => {
    const tail = Buffer.concat(s.tail);
    return { head: Buffer.concat(s.head), tail: tail.subarray(Math.max(0, tail.length - limit)), total: s.total };
  };
  return { take, result: () => ({ stdout: done(streams.stdout), stderr: done(streams.stderr) }) };
}

/**
 * A kept stream as a piece logWindow and sliceStream can read: the whole Buffer when the head holds all of it, else an
 * object of the stream's true `length` whose `subarray` answers from the head or the tail. A range that is in neither
 * (the dropped middle) is refused, never invented: logWindow asks only for the first and last bytes, each within limit.
 */
export function keptStreamView({ head, tail, total }) {
  if (head.length >= total) return head;
  const tailStart = total - tail.length;
  return {
    length: total,
    subarray(start = 0, end = total) {
      if (end <= head.length) return head.subarray(start, end);
      if (start >= tailStart) return tail.subarray(start - tailStart, end - tailStart);
      throw new RangeError(`keptStreamView: bytes ${start}-${end} of ${total} are in the dropped middle`);
    },
  };
}
