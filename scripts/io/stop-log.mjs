// The session records' files (session-record-files.plan.md stage 1): the stop record and the command log, a folder per
// session under the engine's home and keyed by repository, so nothing of them reaches any repository or git. What a
// line means is lib/stop-record.mjs's and lib/command-log.mjs's; what a lock, a rotation and the retention age mean is
// lib/session-record.mjs's. This module finds the folders, appends under the lock, rotates, sweeps and reads back.

import fs from 'node:fs';
import path from 'node:path';
import { quorateHome } from './reviews-root.mjs';
import { repoKey } from '../lib/reviews-root.mjs';
import { isWithin, linkForms, rootSpelling } from './finding-scope.mjs';
import { hostPlatform } from '../platform/index.mjs';
import { confined } from './confined-path.mjs';
import { endsMidLine, appendOwnFile } from './torn-tail.mjs';
import { withRecordLock, isRecordLockName, LockBusyError } from './record-lock.mjs';
import {
  RECORDS, LINE_MAX_BYTES, FILE_MAX_BYTES, RETENTION_DEFAULT_DAYS,
  sessionFolder, lineOf, expired, nextRotation, olderRotations, contextOf, newestEvents,
} from '../lib/session-record.mjs';

export const STOP_LOG_MAX_BYTES = FILE_MAX_BYTES;
const CURRENT = 'current.jsonl';
const LOCK = '.lock';
const LOCK_WAIT_MS = 10_000;


/** A record's folder for a repository (every session's folder is inside it). `home` is injectable for tests. */
export function stopLogPath(repoRoot, { home = quorateHome(), log = 'stops' } = {}) {
  if (!RECORDS.includes(log)) throw new Error(`stop-log: '${log}' is not a record name (${RECORDS.join(', ')})`);
  // A home inside the repository would put the personal record where git can reach it (G-5 of
  // 20261024-224631-arp-remediation-review), decided on real paths (G-3 of 20261024-235344-arp-remediation-2-review).
  // Each path's real form, its nearest existing ancestor resolved through every link, so a home not made yet is placed
  // where it would be made: linkForms's, the rule's one owner (G-4 of 20261025-104155-srf-remediation-3-review: stop-log
  // kept a copy). A path it cannot resolve is refused.
  const key = (p) => {
    const forms = linkForms(path.resolve(p));
    if (!forms) throw new Error(`stop-log: ${p} could not be resolved through its links`);
    const real = forms[forms.length - 1];
    return hostPlatform().caseInsensitiveFs ? real.toLowerCase() : real;
  };
  if (isWithin(key(repoRoot), key(home))) {
    throw new Error(`the engine home ${home} is inside the repository ${repoRoot}; the session records must live outside it`);
  }
  // Keyed by the repository on its real path (rootSpelling; ci-path-identity.plan.md stage 1c), as run-state and repoKey's
  // other callers are: the hook and the reader given two spellings of one repository wrote and read two folders (macOS).
  const keyed = rootSpelling(path.resolve(repoRoot));
  return path.join(home, log, repoKey(path.basename(keyed), keyed));
}

/** The folder of one session's record. */
export const sessionDir = (repoRoot, session, opts = {}) => path.join(stopLogPath(repoRoot, opts), sessionFolder(session));

// THE ENGINE HOME'S OWNER (contract-runtime-and-session-files.plan.md stage 3; design CR-D3 A, ARCHITECTURE.md A-30): every
// path of the stop record and the command log is checked level by level through `confined`, rooted at the engine's home,
// so a link at the home, at the record's folder, at a session's folder or at a file is refused, never followed. The
// owner offers no append, no held descriptor and no tail read, so those three are raw calls on the paths it checked (the
// census names them, tests/regression-confined-write-adoption.test.mjs); a swap between the check and the call is A-30's
// stated residual. `segs` names the record's folder below the home.
function recordOwner(repoRoot, opts = {}) {
  const dir = stopLogPath(repoRoot, opts);
  const home = path.resolve(opts.home ?? quorateHome());
  fs.mkdirSync(home, { recursive: true });
  // `platform` is the caller's (tests hand in one with a failing call); absent, the host's.
  return { own: confined(home, opts.platform ? { io: opts.platform } : {}), segs: path.relative(home, path.resolve(dir)).split(path.sep), dir };
}

// THE LOCK IS io/record-lock.mjs's (stop-record-bounds-and-kill-log.plan.md stage 1, KL-D1 B): moved out of here so the
// kill log takes the same rule rather than one of its own. A session folder's lock is `.lock` inside it; `make` remakes a
// folder a sweep removed while the writer waited for its lock (G-7 of 20261025-104155-srf-remediation-3-review); the sweep
// itself passes none, so it never brings back a folder it lost.
function underLock(own, dsegs, fn, { waitMs = LOCK_WAIT_MS, platform = hostPlatform(), make = false } = {}) {
  return withRecordLock(own, [...dsegs, LOCK], fn, { waitMs, platform, make: make ? dsegs : null, label: 'stop-log' });
}

// The newest write time among a session folder's files, for the retention age; the folder's own time when it holds none
// yet, so a folder just made is new, never "written at time 0".
// The folder's own time counts only then: touched later, it kept an expired folder forever (G-5 of
// 20261025-092319-srf-review-amended).
// The lock and a lock set aside are not writes of the record: the sweep holds the lock while it asks.
const isLockName = (n) => isRecordLockName(n, LOCK);
// Listed and stat'ed through the owner (G-9 of 20261105-052942-crsf-delivery): a raw statSync followed a link inside the
// folder, so an outside file's time kept an expired folder alive. A link there is refused, and the sweep reports it.
function newestWrite(own, dsegs) {
  let newest = -Infinity;
  for (const n of own.list(dsegs)) {
    if (isLockName(n)) continue;
    try { newest = Math.max(newest, own.stat([...dsegs, n]).mtimeMs); } catch (e) { if (e?.code !== 'ENOENT') throw e; /* removed meanwhile */ }
  }
  return Number.isFinite(newest) ? newest : own.stat(dsegs).mtimeMs;
}

// A folder's record files, its lock left for underLock to release; through the owner, a link among them refused.
const removeRecordFiles = (own, dsegs) => {
  for (const n of own.list(dsegs)) if (!isLockName(n)) own.remove([...dsegs, n], { recursive: true });
};

// Remove the record's session folders past the retention age (S-D2), each found through the record folder's own
// listing. A folder another session removes first is simply gone; any other failure is returned, folder and code, for the
// caller to record (G-6 of 20261025-095239-srf-remediation-2-review: swallowed, it kept a folder past retention unreported).
// Each folder is judged and emptied holding its lock, as an append is, and only the empty folder is removed after: the
// sweep acted on an unlocked freshness check, so an event appended meanwhile was removed with the folder (G-7 of
// 20261025-104155-srf-remediation-3-review). A writer that arrives between the two keeps the folder (it is not empty),
// and one that finds it gone makes it again (underLock).
function sweep(own, segs, days, keep, { now = Date.now(), removeDir = removeRecordFiles, lockWaitMs = LOCK_WAIT_MS, platform } = {}) {
  const failed = [];
  if (days == null) return failed;
  for (const name of own.list(segs)) {
    if (name === keep) continue;   // the session doing the sweep
    const dsegs = [...segs, name];
    try {
      // Through the owner: a link at a session's folder is refused and reported, never followed and emptied.
      if (!own.stat(dsegs).isDirectory()) continue;
      if (!expired(newestWrite(own, dsegs), now, days)) continue;
      const emptied = underLock(own, dsegs, () => {
        if (!expired(newestWrite(own, dsegs), now, days)) return false;   // written since it was first judged
        removeDir(own, dsegs);
        return true;
      }, { waitMs: lockWaitMs, ...(platform ? { platform } : {}) });
      if (emptied) {
        // Through the owner, empty only (G-3 of 20261105-070121-crsf-remediation-2-review): raw, on the path resolved before
        // the lock, a link put at the folder meanwhile was not checked again.
        try { own.remove(dsegs, { empty: true }); } catch (r) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(r?.code)) throw r; }
      }
    } catch (e) {
      if (e?.code !== 'ENOENT') failed.push({ folder: name, code: e?.code ?? 'unknown' });
    }
  }
  return failed;
}

// How long after a sweep began the next may begin (BI-D2 A), and the marker that holds when the last one did.
export const STOP_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const SWEEP_MARK = '.last-sweep';
// Whether a sweep is due, and if so the marker set to now, through the owner (a link at it refused). A marker that cannot
// be read as a time is due: a sweep too many costs one listing, one too few keeps an expired folder.
// The read and the replace are one operation under the record folder's lock (G-6 of 20261106-061604-srb-delivery):
// unlocked, two sessions whose first writes came together both read the old marker, both set it and both swept. The
// first look is unlocked, so a write inside the interval takes no lock; a due one is looked at again holding it, and a
// lock still held past the wait is another session marking, so this one does not sweep.
// The marker's own answer: false inside the interval, true past it or unreadable as a time, null when there is none.
function markerDue(own, segs, intervalMs, now = Date.now()) {
  let text;
  try { text = own.read([...segs, SWEEP_MARK]); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
  const last = Number(String(text).trim());
  return !(Number.isFinite(last) && last <= now && now - last < intervalMs);
}
function sweepDue(own, segs, intervalMs, { now = Date.now(), lockWaitMs = LOCK_WAIT_MS, platform } = {}) {
  const msegs = [...segs, SWEEP_MARK];
  const due = () => markerDue(own, segs, intervalMs, now) !== false;
  if (!due()) return false;
  try {
    return underLock(own, segs, () => {
      if (!due()) return false;   // another session marked it meanwhile
      own.replace(msegs, String(now));
      return true;
    }, { waitMs: lockWaitMs, ...(platform ? { platform } : {}) });
  } catch (e) {
    if (e instanceof LockBusyError) return false;
    throw e;
  }
}

// Whether a record file ends in a torn line is io/torn-tail.mjs's, the one owner every JSONL appender asks (G-3, G-4 of
// 20261106-022028-stoplog-g8-remediation-2-review). The path is the one the owner resolved, read raw like the append on it.

/**
 * Append one event to its session's record (the session is the event's `session`). The first write after the sweep
 * interval sweeps folders past `retentionDays`; a file past `fileMaxBytes` is rotated inside the lock.
 */
export function appendStopEvent(repoRoot, event, {
  maxBytes = LINE_MAX_BYTES, fileMaxBytes = FILE_MAX_BYTES, lockWaitMs = LOCK_WAIT_MS,
  retentionDays = RETENTION_DEFAULT_DAYS, platform, removeDir, sweepIntervalMs = STOP_SWEEP_INTERVAL_MS, ...opts
} = {}) {
  // A test's platform with its own fs is the owner's too; one carrying only process calls is the lock's alone.
  const { own, segs } = recordOwner(repoRoot, { ...opts, ...(platform?.fs ? { platform } : {}) });
  const folder = sessionFolder(event?.session);
  const first = !own.exists([...segs, folder]);
  own.dir([...segs, folder]);
  // The age is asked for only here, on a session's first write: a caller may pass a function that reads the contract.
  // `removeDir` is test-only, the way a removal that fails is reached.
  // AT MOST ONE SWEEP PER STOP_SWEEP_INTERVAL_MS (stop-record-bounds-and-kill-log.plan.md stage 2; design BI-D2 A): every
  // new session's first write listed, stat'ed and judged every kept folder (G-1 of
  // 20261106-013812-stoplog-g8-remediation-review). The marker in the record folder holds when the last sweep began; it
  // is written before the sweep, so sessions starting together do not all sweep.
  // The age is asked first: a write with retention off sweeps nothing, so it does not take the interval from the next
  // session that would.
  // A LATER WRITE SWEEPS TOO once the interval has passed (G-7 of 20261106-061604-srb-delivery): asked only on a first
  // write, a session still writing when the hour passed never swept. A later write asks the age only when a marker stands
  // and is due, so a record with retention off, which never sets one, still reads the age on a first write alone.
  const asks = first || markerDue(own, segs, sweepIntervalMs) === true;
  const days = asks ? (typeof retentionDays === 'function' ? retentionDays() : retentionDays) : null;
  const failed = days != null && sweepDue(own, segs, sweepIntervalMs, { lockWaitMs, ...(platform ? { platform } : {}) })
    ? sweep(own, segs, days, folder, { lockWaitMs, ...(removeDir ? { removeDir } : {}), ...(platform ? { platform } : {}) })
    : [];
  // A folder the sweep could not remove is recorded in this session's own record, ahead of the event that swept.
  const report = failed.length
    ? lineOf({ ...contextOf(event), at: event?.at, event: 'retention-failed', record: event?.record, session: event?.session, folders: failed }, maxBytes)
    : '';
  const line = lineOf(event, maxBytes);
  const file = own.resolve([...segs, folder, CURRENT]);   // a link at the file is refused
  underLock(own, [...segs, folder], () => {
    // ON A LINE OF ITS OWN, IN ONE WRITE (G-2 of 20261106-013812-stoplog-g8-remediation-review): a torn tail left by an
    // earlier short write had the next event joined onto it, and the reader skipped the joined line, losing an event this
    // writer had reported written. A file not ending in a newline gets one first; the report and the event go together.
    // A hard link at the file is refused too, on the open file (G-8 of 20261114-022647-m2-7b-review): see appendOwnFile.
    appendOwnFile(file, (endsMidLine(file) ? '\n' : '') + report + line);
    // Not caught: a stat that fails left the size at 0, so rotation was skipped on every append with nothing said and the
    // file grew past its bound (G-9 of 20261025-104155-srf-remediation-3-review). The writer's caller reports it.
    const size = own.stat([...segs, folder, CURRENT]).size;
    if (size > fileMaxBytes) {
      // The current file and one previous are kept (shared/session-rules.md): the rotations before this one are removed.
      const names = own.list([...segs, folder]);
      own.rename([...segs, folder, CURRENT], [...segs, folder, `${nextRotation(names)}.jsonl`]);
      for (const n of olderRotations(names)) own.remove([...segs, folder, n]);
    }
  }, { waitMs: lockWaitMs, make: true, ...(platform ? { platform } : {}) });
  return file;
}

// A file of a session's record, read through the owner (a link at it refused); missing is empty.
const readText = (own, fsegs) => { try { return own.read(fsegs); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } };
function parseLines(text) {
  const events = [];
  let unreadable = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { unreadable += 1; }
  }
  return { events, unreadable };
}

// A session folder's files in write order, as segments below the home: the rotated ones by number, then the current one.
function sessionFiles(own, dsegs) {
  let names = [];
  try { names = own.list(dsegs); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const rotated = names.filter((n) => /^\d+\.jsonl$/.test(n)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  return [...rotated, ...(names.includes(CURRENT) ? [CURRENT] : [])].map((n) => [...dsegs, n]);
}
const sessionSegs = (repoRoot, session, opts) => {
  const { own, segs } = recordOwner(repoRoot, opts);
  return { own, dsegs: [...segs, sessionFolder(session)] };
};

/** One session's events, oldest first: only its own folder is read. */
export function readSessionEvents(repoRoot, session, opts = {}) {
  const { own, dsegs } = sessionSegs(repoRoot, session, opts);
  // The count of lines that did not parse rides on the array, as readSessionTail's does (G-8 of 20261106-005647-stoplog-g8-review).
  const r = parseLines(sessionFiles(own, dsegs).map((f) => readText(own, f)).join(''));
  return Object.assign(r.events, { unreadable: r.unreadable });
}

/**
 * One session's newest events, oldest first: its files read newest first, stopping at the first whose events satisfy
 * `enough` (G-16 of 20261025-080709-srf-delivery: the turn start parsed the whole session to learn what its newest turn
 * event decides).
 */
// The array returned carries `unreadable`, the count of lines in what was read that did not parse (G-8 of
// 20261106-005647-stoplog-g8-review: both paths dropped it, so a torn newest line was skipped with nothing said).
export function readSessionTail(repoRoot, session, enough, opts = {}) {
  let events = [];
  let unreadable = 0;
  const { own, dsegs } = sessionSegs(repoRoot, session, opts);
  const files = sessionFiles(own, dsegs).reverse();
  // The newest file's last lines first: parsing all of it, up to the rotation size, on every turn start was the cost
  // (G-7 of 20261025-095239-srf-remediation-2-review). Only when they are not enough is the whole file read.
  if (files.length) {
    const tail = readEnd(own, files[0], TAIL_BYTES);
    if (tail != null) {
      const last = parseLines(tail);
      if (enough(last.events)) return Object.assign(last.events, { unreadable: last.unreadable });
    }
  }
  for (const f of files) {
    const r = parseLines(readText(own, f));
    events = r.events.concat(events);
    unreadable += r.unreadable;
    if (enough(events)) break;
  }
  return Object.assign(events, { unreadable });
}

const TAIL_BYTES = 64 * 1024;
// The complete lines in a file's last `bytes`, or null when the file is no longer than that (it is then read whole). The
// cut starts after the first newline in the window, which is never inside a UTF-8 character.
function readEnd(own, fsegs, bytes) {
  let fd;
  // The path checked through the owner (a link at any level refused), then opened: the owner holds no descriptor.
  try { fd = fs.openSync(own.resolve(fsegs), 'r'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= bytes) return null;
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, size - bytes);
    const text = buf.subarray(0, n).toString('utf8');
    const nl = text.indexOf('\n');
    return nl < 0 ? '' : text.slice(nl + 1);
  } finally { fs.closeSync(fd); }
}

/**
 * The most events one read holds (G-5 of 20261105-154708-crsf-remediation-5-review; contract-runtime-and-session-files
 * .plan.md stage 3, amended 2026-11-05, operator: "Bound it (Recommended)"). Retention may be off, so it is no bound.
 */
export const STOP_READ_MAX_EVENTS = 200_000;
// The sessions a read visits, the newest by their folder's newest write (BI-D1 A). With each session holding at most two
// files of FILE_MAX_BYTES, this bounds what a read opens and parses however retention is set.
export const STOP_READ_MAX_SESSIONS = 1_000;

/**
 * Every session's events for a repository, in time order, the newest `maxEvents` (default STOP_READ_MAX_EVENTS) only:
 * `dropped` counts the older ones left out. A line that does not parse is skipped and counted. What is held is at most
 * the cap plus one rotated file's, which the record's rotation bounds.
 */
export function readStopEvents(repoRoot, opts = {}) {
  const { own, segs, dir: recordDir } = recordOwner(repoRoot, opts);
  // A caller's cap may only lower the owner's (G-9 of 20261106-005647-stoplog-g8-review): any larger value was taken,
  // so the read held past STOP_READ_MAX_EVENTS and the summary advertised the larger number as its limit.
  const maxEvents = Number.isInteger(opts.maxEvents) && opts.maxEvents > 0
    ? Math.min(opts.maxEvents, STOP_READ_MAX_EVENTS) : STOP_READ_MAX_EVENTS;
  // The same for sessions: a caller may only lower the owner's cap.
  const maxSessions = Number.isInteger(opts.maxSessions) && opts.maxSessions > 0
    ? Math.min(opts.maxSessions, STOP_READ_MAX_SESSIONS) : STOP_READ_MAX_SESSIONS;
  let listed = [];
  try { listed = own.list(segs); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  // A session folder that cannot be examined is named in `unreadableFolders`, never left out in silence (G-10 of
  // 20261025-104155-srf-remediation-3-review); one removed meanwhile is simply gone.
  const all = { events: [], unreadable: 0, unreadableFolders: [], dropped: 0, maxEvents, sessionsLeftOut: 0, maxSessions };
  // AT MOST THE NEWEST STOP_READ_MAX_SESSIONS SESSIONS ARE READ (stop-record-bounds-and-kill-log.plan.md stage 2; design
  // BI-D1 A, operator 2026-11-06): only what was HELD was capped, so with retention off every file of every kept session
  // was read and parsed (G-8 of 20261105-173030-crsf-d1-remediation-review, "Bound it too"; G-3 of
  // 20261106-013812-stoplog-g8-remediation-review). Each folder is stat'ed for its newest write, the newest are read, and
  // how many were left out is said, as it is for events.
  const dated = [];
  for (const name of listed) {
    const dsegs = [...segs, name];
    try {
      if (!own.stat(dsegs).isDirectory()) continue;
      dated.push({ name, at: newestWrite(own, dsegs) });
    } catch (e) {
      if (e?.code !== 'ENOENT') all.unreadableFolders.push({ folder: name, code: e?.code ?? 'unknown' });
    }
  }
  dated.sort((a, b) => b.at - a.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  all.sessionsLeftOut = Math.max(0, dated.length - maxSessions);
  const names = dated.slice(0, maxSessions).map((d) => d.name);
  // AT MOST THE CAP, EVER (G-9 of 20261105-173030-crsf-d1-remediation-review): the newest `maxEvents`, held at most that
  // many at a time. Which events are kept, in what order, is lib's `newestEvents` (G-8 of
  // 20261105-181450-crsf-d1-remediation-2-review): a decision, not I/O.
  const newest = newestEvents(maxEvents);
  const keep = (e) => { all.dropped += newest.keep(e); };
  for (const name of names) {
    // ONE FILE AT A TIME, KEPT AS IT GOES (G-9 of 20261105-163851-crsf-d1-review): a whole session's files were joined,
    // parsed and pushed before any trim, so one session past the cap was held in full. Now what is held is at most the cap
    // plus one rotated file. One at a time: a spread passes every event as an argument, past the engine's limit for a long
    // session (G-7 of 20261025-080709-srf-delivery).
    // The listing and every file read inside the same catch as the stat (G-10 of 20261106-005647-stoplog-g8-review): only
    // the stat was, so one file the owner refused, or one EACCES, threw out of the whole read and no session was summed.
    // Events already kept from the folder stay; the folder is named, so what it held is not taken for complete.
    try {
      for (const f of sessionFiles(own, [...segs, name])) {
        const r = parseLines(readText(own, f));
        for (const e of r.events) keep(e);
        all.unreadable += r.unreadable;
      }
    } catch (e) {
      if (e?.code !== 'ENOENT') all.unreadableFolders.push({ folder: name, code: e?.code ?? 'unknown' });
    }
  }
  all.events = newest.events();
  return { file: recordDir, ...all };
}
