// A session's records: the stop record and the command log (session-record-files.plan.md; design decided S-D1..S-D4).
//
// Each record lives in a folder per session, so sessions running side by side never share a file (S-D1). Writers of one
// session that do share a file (parallel tool calls) append under a lock that names its owner, a process id and its
// start time; a lock is stale only when that process is gone or its pid was reused, never by its age, which is how the
// previous owner judged it and how two waiters could delete each other's fresh lock (G-6 of
// 20261025-021243-arp-remediation-3c-review). Files rotate by size inside the folder, under the same lock; folders past
// the retention age are removed when a session first writes (S-D2).
//
// Pure: the decisions only. scripts/io/session-record.mjs does the I/O, and the platform answers liveness and start time.

import { createHash } from 'node:crypto';

export const RECORDS = Object.freeze(['stops', 'commands']);
export const LINE_MAX_BYTES = 4 * 1024;
export const FILE_MAX_BYTES = 4 * 1024 * 1024;
export const RETENTION_DEFAULT_DAYS = 30;
// A start time read from the OS and the one the writer recorded agree to the second at best (ps prints seconds).
export const START_TOLERANCE_MS = 2000;

// Names Windows will not make as a folder, or makes as another (G-15 of 20261025-104155-srf-remediation-3-review): a
// device name, with or without an extension, and a name ending in a dot, which Windows strips (`foo.` is `foo`).
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;

/**
 * The folder name for a session id: the id when it is a safe single name on every platform. Any other nonempty id is
 * `~unknown-` and 16 hex digits of its hash, so two such sessions never share a folder (G-16 of
 * 20261114-022647-m2-7b-review: they all shared `unknown`, and a tail read of one could stop at the other's turn); `~`
 * is outside the safe alphabet, so no safe id is written there. A missing id names no session and is `~unknown`. An
 * upper-case letter is written `^` and the letter in lower case, so ids that differ only in case keep separate folders
 * on a case-insensitive file system; an id cannot hold `^`, so no two ids share a name, and a lower-case id is unchanged.
 */
export function sessionFolder(id) {
  const s = String(id ?? '');
  // `~unknown`, outside the safe alphabet, so the safe id `unknown` keeps a folder of its own (G-7 of
  // 20261114-032609-m2-7b-remediation-review: both were `unknown`).
  if (!s) return '~unknown';
  const hashed = () => `~unknown-${createHash('sha256').update(s).digest('hex').slice(0, 16)}`;
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(s) || s.endsWith('.') || WINDOWS_RESERVED.test(s)) return hashed();
  // The limit is on the name WRITTEN (G-7): escaping doubles an upper-case letter, so 128 of them made 256 characters.
  const folded = s.replace(/[A-Z]/g, (c) => `^${c.toLowerCase()}`);
  return folded.length <= 128 ? folded : hashed();
}

/** The lock's content: the writer's pid and the moment the lock was written. */
export function lockContent({ pid, writtenAt }) {
  return JSON.stringify({ pid, writtenAt });
}

/**
 * Whether a lock is still held. `isAlive(pid)` and `startedAt(pid)` are the platform's. Stale only when the owner is gone,
 * or when the process now under that pid started after the lock was written (the pid reused: the owner must have
 * started before it wrote the lock). Comparing with the moment the lock was written, not with a start time the writer
 * computed for itself, keeps a live owner whose runtime took seconds to start under load from reading as reused
 * (observed: such a lock was judged stale). An unreadable lock, or a start time the OS will not give, counts as held.
 */
export function lockState(text, { isAlive, startedAt }) {
  let o;
  try { o = JSON.parse(String(text ?? '')); } catch { return 'held'; }
  if (!Number.isSafeInteger(o?.pid) || o.pid <= 0) return 'held';
  if (!isAlive(o.pid)) return 'stale';
  const started = startedAt(o.pid);
  if (started == null || !Number.isFinite(o.writtenAt)) return 'held';
  return started > o.writtenAt + START_TOLERANCE_MS ? 'stale' : 'held';
}

/** The line of one event, never longer than the cap: its strings cut, and it says so with its original length. */
export function lineOf(event, maxBytes = LINE_MAX_BYTES) {
  const whole = `${JSON.stringify(event)}\n`;
  if (Buffer.byteLength(whole) <= maxBytes) return whole;
  const keep = Math.max(32, Math.floor(maxBytes / 8));
  const cut = { truncated: true, bytes: Buffer.byteLength(whole) };
  // Objects and arrays are cut inside rather than dropped: `writer` and `task` are objects, and every line carries them
  // (G-12 of 20261025-092319-srf-review-amended).
  const cutValue = (v, depth) => {
    if (typeof v === 'string') return v.slice(0, keep);
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
    if (depth >= 3 || typeof v !== 'object') return undefined;
    if (Array.isArray(v)) return v.slice(0, 16).map((x) => cutValue(x, depth + 1) ?? null);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cutValue(x, depth + 1)]));
  };
  for (const [k, v] of Object.entries(event ?? {})) cut[k] = cutValue(v, 0);
  const short = `${JSON.stringify(cut)}\n`;
  if (Buffer.byteLength(short) <= maxBytes) return short;
  // The last resort keeps the line's identity and its context, its own content gone.
  const minimal = { truncated: true, bytes: cut.bytes };
  for (const k of ['at', 'event', 'iso', 'record', 'session', 'writer', 'depth', 'hook', 'task', 'tool', 'toolUseId']) {
    if (Object.hasOwn(event ?? {}, k)) minimal[k] = cutValue(event[k], 0);
  }
  const last = `${JSON.stringify(minimal)}\n`;
  if (Buffer.byteLength(last) <= maxBytes) return last;
  // A wide `writer` or `task` keeps every key through cutValue, so the last resort is checked too, and narrows to the
  // line's scalar identity, then to the cut marker alone (G-11 of 20261025-095239-srf-remediation-2-review).
  const bare = { truncated: true, bytes: cut.bytes };
  for (const k of ['at', 'event', 'record', 'session', 'depth', 'hook', 'tool', 'toolUseId']) {
    const v = event?.[k];
    if (typeof v === 'string') bare[k] = v.slice(0, 64);
    else if (typeof v === 'number' || typeof v === 'boolean') bare[k] = v;
  }
  const narrow = `${JSON.stringify(bare)}\n`;
  if (Buffer.byteLength(narrow) <= maxBytes) return narrow;
  return `${JSON.stringify({ truncated: true, bytes: cut.bytes, at: typeof event?.at === 'number' ? event.at : undefined })}\n`;
}

/**
 * The retention age from the contract's `review` block, in days, or null for no limit. Absent means the default; a
 * positive whole number is that many days; 0 or any string means no limit (operator, 2026-10-25: "allowing 0 (or
 * another string) as no limit"); a negative or fractional number is refused. A mistyped number written as a string
 * reads as no limit: the stated residual.
 */
export function retentionDays(review) {
  if (!review || !Object.hasOwn(review, 'session_record_retention_days')) return RETENTION_DEFAULT_DAYS;
  const v = review.session_record_retention_days;
  if (typeof v === 'string' || v === 0 || v === null) return null;
  if (Number.isSafeInteger(v) && v > 0) return v;
  throw new Error(`review.session_record_retention_days must be a positive whole number of days, or 0 or a string for no limit; got ${JSON.stringify(v)}`);
}

/** Whether a session folder whose newest file was written at `newestMs` is past the retention age at `now`. */
export function expired(newestMs, now, days) {
  return days != null && Number.isFinite(newestMs) && now - newestMs > days * 86_400_000;
}

/** The next rotated file's number, from the folder's file names (`1.jsonl`, `2.jsonl`, … beside `current.jsonl`). */
export function nextRotation(names) {
  let max = 0;
  for (const n of names ?? []) { const m = /^(\d+)\.jsonl$/.exec(n); if (m) max = Math.max(max, Number(m[1])); }
  return max + 1;
}

/**
 * The rotated files a rotation removes, from the folder's names before it: every one of them, so the record keeps the
 * current file and the one just rotated (G-5 of 20261025-080709-srf-delivery: each was kept, and a session grew without
 * bound).
 */
export function olderRotations(names) {
  return (names ?? []).filter((n) => /^\d+\.jsonl$/.test(n));
}

/**
 * What every line of a session record carries besides its own event (S-D4; operator, 2026-10-25: "include in the line
 * the task/lens, datetime, and what the parallel writer "name"/"sub-task"/etc. And any info that can help identify
 * issues"): the datetime, the record, the session, the writer, the depth, the hook event, and the task: a graph node's
 * run and node id, or the working session's plan in flight.
 */
export function lineContext({ now, record, session, pid, startedMs, hookEvent, depth = 0, run = null, node = null, request = null }) {
  return {
    iso: new Date(now).toISOString(),
    record,
    session: session ?? null,
    writer: { pid, started: Number.isFinite(startedMs) ? new Date(startedMs).toISOString() : null },
    depth,
    hook: hookEvent ?? null,
    task: depth >= 1 ? { run: run || null, node: node || null } : { request: request || null },
  };
}

// lineContext's fields, in its order: kept beside it so a field added there reaches every line built from another's.
// Derived from lineContext, its one owner (G-18 of 20261114-022647-m2-7b-review): a list of its own could miss a field
// lineContext gains, and the sweep's own lines would then lack it.
const CONTEXT_KEYS = Object.freeze(Object.keys(lineContext({ now: 0 })));

/**
 * The context of an event's line, for a line the writer adds of its own (the sweep's `retention-failed`): it was built
 * from at, record and session only, so it lacked the datetime, writer, depth, hook and task every line carries (G-8 of
 * 20261025-104155-srf-remediation-3-review).
 */
export function contextOf(event) {
  const out = {};
  for (const k of CONTEXT_KEYS) if (event && Object.hasOwn(event, k)) out[k] = event[k];
  return out;
}

/**
 * The newest `maxEvents` events of a read, held at most `maxEvents` at a time (G-9 of
 * 20261105-173030-crsf-d1-remediation-review; moved here from scripts/io/stop-log.mjs, G-8 of
 * 20261105-181450-crsf-d1-remediation-2-review, since which events a read keeps is a decision, not I/O).
 * A min-heap on `at`: under the cap an event joins it; at the cap it replaces the oldest held unless it is older still,
 * and either way `keep` returns 1, the one event dropped (else 0). A tie replaces, so the later read is kept. Each held
 * event carries its read order, `s`, and the heap and `events()` order by (`at`, `s`): a heap is not stable, so events of
 * one millisecond came back out of their read order. `events()` returns the held events oldest first.
 */
export function newestEvents(maxEvents) {
  const heap = [];
  let seq = 0;
  const older = (a, b) => ((a.e.at ?? 0) - (b.e.at ?? 0) || a.s - b.s) < 0;
  const swap = (i, j) => { const t = heap[i]; heap[i] = heap[j]; heap[j] = t; };
  const up = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (!older(heap[i], heap[p])) return; swap(i, p); i = p; } };
  const down = (i) => {
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < heap.length && older(heap[l], heap[m])) m = l;
      if (r < heap.length && older(heap[r], heap[m])) m = r;
      if (m === i) return;
      swap(i, m); i = m;
    }
  };
  return {
    keep(e) {
      const h = { e, s: seq++ };
      if (heap.length < maxEvents) { heap.push(h); up(heap.length - 1); return 0; }
      if (!older(h, heap[0])) { heap[0] = h; down(0); }
      return 1;
    },
    events: () => heap.sort((a, b) => (older(a, b) ? -1 : older(b, a) ? 1 : 0)).map((h) => h.e),
  };
}
