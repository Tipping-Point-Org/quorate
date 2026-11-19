// THE ONE OWNER OF STOPPING A CHILD (stopping-a-child.design.md, decided 2026-10-02: 1A, 2A).
//
// Four reviews running found the same defect in a different launcher each time — a kill counted as a death, an accepted
// kill with no deadline, a launcher that waited forever — because "how do we stop this child, and what do we say about
// it" was answered separately in run-child, spawnCapture, killAllLive and the reaper. This module answers it once:
//
// - REQUESTED IS NOT STOPPED. The platform's killTree returns whether the kill was DELIVERED (posix) or taskkill exited 0
//   (win32). Only the child's own exit event, seen within the deadline, makes it "exited".
// - THREE OUTCOMES, NO FOURTH: 'exited' (seen), 'refused' (the platform would not kill it; it is alive), 'unconfirmed'
//   (no exit seen in time, after a kill that was accepted — or that failed on a process no longer there, when the stop
//   cannot wait for its exit; it may be alive). A caller says the last two as themselves.
// - A PID THIS PROCESS DOES NOT HOLD IS NEVER KILLED: after a restart it may name another process. It is polled.
//
// The platform's killTree stays the primitive under it (scripts/platform); this file is the only caller outside it.
import path from 'node:path';
import { hostPlatform } from '../platform/index.mjs';
import { PROC_MEMBERS } from '../platform/interface.mjs';
import { appendRecord, APPEND_LOCK_WAIT_MS } from './torn-tail.mjs';
import { FILE_MAX_BYTES } from '../lib/session-record.mjs';

// THE KILL LOG — a diagnostic, OFF unless QUORATE_KILL_LOG names a file (operator, 2026-10-07: "add the kill log and
// measure it", after asking why taskkill appears so often). Every tree kill the owner issues appends one JSON line —
// when, which pid, which signal, which process issued it, and the stack that asked — so where kills come from is
// measured rather than guessed. A failure to write the log never changes the kill.
// The records this process could not write, because another writer held the log's lock past its wait or an error was
// thrown: counted, so a log with lines missing says so rather than reading as complete (stop-record-bounds-and-kill-log
// .plan.md stage 1: a record is skipped, never appended unlocked).
// Each skip is also said on stderr, the pid and the log named (G-4 of 20261106-061604-srb-delivery): the count alone was
// read by no production code, so the operator who turned the log on could not see a record was missing.
let killLogSkips = 0;
export const killLogSkipped = () => killLogSkips;
// `logUntil` is the time the log's lock wait may not outlast (stopAll's one deadline; G-3 of
// 20261106-065312-srb-remediation-review): each child's kill is requested in turn, so N waits of APPEND_LOCK_WAIT_MS ran
// past it. A record whose wait would start at or after it is skipped, counted and said like any other. `killTree` is the
// platform's primitive unless a caller hands one in. `logWaitMs` is the longest lock wait: the exit hook gives 0, so its
// record is tried once and never waited for, since the hook only requests (A-25; G-5 of
// 20261106-073206-srb-remediation-2-review). The append never asks a live holder's start time, a PowerShell or ps launch
// of up to 5 s that ran before the wait's deadline was checked (G-3 of the same review): a live holder is held, so a lock
// left by a reused pid is not reclaimed by the kill log and its records are skipped, counted and said, until it goes. That
// residual is accepted (operator, 2026-11-06: "Accept skip, bound size (Recommended)", decision 20261106-135421-dfdc46).
// THE KILL LOG IS BOUNDED as the stop record is (the same decision; G-4 of 20261106-080520-srb-remediation-3-review: it
// grew without limit): past KILL_LOG_MAX_BYTES it is rotated to `<log>.1` under its lock, so it keeps two files.
export const KILL_LOG_MAX_BYTES = FILE_MAX_BYTES;
// `now` is the exit hook's (non-blocking-kill.plan.md stage 2, NB-D1 B): it takes the synchronous primitive, killTreeNow,
// since an exit handler cannot wait; every other stop takes killTree, which answers with a promise and, on win32, is given
// what remains of `logUntil` (stopAll's one deadline) as its timeout (NB-D2 A).
// EVERY KILL'S RECORD IS APPENDED BEFORE IT (I-5; non-blocking-kill.plan.md stage 2; G-2, G-3 of
// 20261106-190129-nbk-remediation-review). G-4 of 20261106-182300-nbk-delivery found that under stopAll each child's kill
// waited for every earlier child's append, and its fix appended each record after its kill, in a microtask that still
// blocked on the log's lock while taskkills were pending. stopAll now appends every child's record in ONE append, under
// one lock wait bounded by its deadline, before it requests any kill, and hands each stop `logged`, so none appends again.
// `proc` is the platform's process interface (the host's unless a caller hands one in), so which primitive a stop takes
// is tested by running it (G-11 of the same review); the record names that platform (G-4 of the remediation review).
// ONE SEAM, `proc` (stop-owner-seam.plan.md stage 1; design SS-D1 A, operator 2026-11-06): the owner reaches a kill only
// through the platform's process interface, the host's unless a caller hands one in, so the exit hook's `now` reaches
// only proc.killTreeNow and every other stop only proc.killTree. Three remediation rounds each closed one of three
// injectables (`kill`, `killTree`, `proc`) and the next review found another (G-2 of 20261106-203532-nbk-remediation-3-review:
// a `kill` override still carried an asynchronous answer into the exit hook).
function hostKillTree(pid, opts, { logUntil = null, logWaitMs = APPEND_LOCK_WAIT_MS, now = false, proc = null, logged = false } = {}) {
  if (!logged && process.env.QUORATE_KILL_LOG) {
    appendKillRecords([killRecordOf(pid, opts, callerStack(), { proc })], { logUntil, logWaitMs });
  }
  const p = proc ?? hostPlatform().proc;
  return now ? p.killTreeNow(pid, opts)
    : p.killTree(pid, logUntil != null ? { ...opts, timeoutMs: Math.max(0, logUntil - Date.now()) } : opts);
}

// A PROC HANDED IN IS A WHOLE PROCESS INTERFACE (SS-D2 B): every member PROC_MEMBERS names, as the platform's own
// interface check holds an implementation to, refused naming each one missing. A fake built over the host's interface
// (tests/helpers.mjs) is whole by construction.
function procOf(proc, who) {
  if (proc == null) return hostPlatform().proc;
  const missing = PROC_MEMBERS.filter((k) => typeof proc?.[k] !== 'function');
  if (missing.length) throw new TypeError(`${who}: proc is not a whole process interface; missing ${missing.join(', ')}`);
  return proc;
}

// The stack that asked for the kill, from the frame above the one that calls this.
const callerStack = () => String(new Error().stack ?? '').split('\n').slice(3, 8).map((l) => l.trim());

// One kill's record: when, which pid, which signal, which platform's primitive (the handed-in proc's id, null if it names
// none: never the host's for a kill the host did not make), which process issued it, and the stack.
const killRecordOf = (pid, opts, caller, { proc = null } = {}) => ({
  at: new Date().toISOString(), pid, signal: opts?.signal ?? null,
  platform: proc ? (proc.id ?? null) : hostPlatform().id,
  by_pid: process.pid, by: String(process.argv[1] ?? '').split(/[\\/]/).pop(), caller,
});

// THE BATCH IS APPENDED IN PIECES THAT EACH FIT THE CAP (G-1 of 20261106-200030-nbk-remediation-2-review): stopAll's one
// append of every child's record could take the live log past KILL_LOG_MAX_BYTES, since a rotation bounds what is there
// before an append, not the append. A piece is at most the cap; a single record larger than it is refused by appendRecord
// and skipped. A piece whose lock is held past its wait skips every piece after it, so one held lock costs one wait.
function piecesOf(lines, maxBytes) {
  const pieces = [];
  let cur = [], bytes = 0;
  for (const l of lines) {
    const b = Buffer.byteLength(l.text);
    if (cur.length && bytes + b > maxBytes) { pieces.push(cur); cur = []; bytes = 0; }
    cur.push(l); bytes += b;
  }
  if (cur.length) pieces.push(cur);
  return pieces;
}

function appendKillRecords(records, { logUntil, logWaitMs }) {
  const log = process.env.QUORATE_KILL_LOG;
  if (!log || !records.length) return;
  const skipped = (piece, why) => {
    killLogSkips += piece.length;
    for (const { pid } of piece) {
      try { process.stderr.write(`stop-child: the kill log record for pid ${pid} was skipped (${why}): ${log}\n`); } catch { /* diagnostic only */ }
    }
  };
  let held = null;
  for (const piece of piecesOf(records.map((r) => ({ pid: r.pid, text: `${JSON.stringify(r)}\n` })), KILL_LOG_MAX_BYTES)) {
    if (held) { skipped(piece, held); continue; }
    const left = logUntil == null ? null : logUntil - Date.now();
    if (left != null && left <= 0) { skipped(piece, "stopAll's deadline had passed"); continue; }
    const waitMs = left == null ? logWaitMs : Math.min(logWaitMs, left);
    try {
      // On a line of its own after a torn tail (G-4 of 20261106-022028-stoplog-g8-remediation-2-review), checked and
      // appended under the record lock, since parent and child processes inherit the variable and append alike (G-3 of
      // 20261106-035103-stoplog-g8-remediation-3-review; KL-D1 B).
      const written = appendRecord(log, piece.map((l) => l.text).join(''),
        { waitMs: Math.max(0, waitMs), probeStart: false, maxBytes: KILL_LOG_MAX_BYTES });
      if (!written) { held = 'its lock was held past the wait'; skipped(piece, held); }
    } catch (e) {
      // A folder that does not exist is a wrongly set QUORATE_KILL_LOG, and is not created (operator, 2026-11-06: "creating
      // the folder is the wrong decision. The correct one is finding out why an inexistent folder was referenced"; "Name
      // the cause, then fix"; G-3 of 20261106-155048-srb-d1-remediation-2-review). The append creates the file, so ENOENT
      // here can only be its folder; the line names that cause so the reference can be corrected.
      if (e?.code === 'ENOENT') skipped(piece, `the folder ${path.dirname(path.resolve(log))} does not exist; QUORATE_KILL_LOG names a file in it, so check where it is set`);
      else skipped(piece, String(e?.code ?? e?.message ?? e));
    }
  }
}

// SIGTERM, then SIGKILL for whatever ignored it, after this long (posix; taskkill /F is already forceful).
export const ESCALATE_AFTER_MS = 5_000;
// How long an accepted kill may take to end the child before it is "unconfirmed". It outlasts the escalation by 10 s, so
// an escalated kill is seen as an exit, not reported as a survivor (G-7 of 20261002-004527-confirm2-confirm).
export const DEATH_GRACE_MS = 15_000;
// On SIGINT/SIGTERM, how long run-graph waits for its children before exiting and naming the unconfirmed ones
// (design 3A): an interrupt still ends promptly.
export const SIGNAL_EXIT_DEADLINE_MS = 5_000;
// Inside that deadline, the SIGKILL for whatever ignored the SIGTERM (posix), so its exit can still be SEEN before the
// orchestrator gives up — escalating at ESCALATE_AFTER_MS would fire at the deadline itself, after the last look. Later
// than the nested hop's deadline below, so a node runner is given the time to stop its own child first.
export const SIGNAL_ESCALATE_AFTER_MS = 4_000;
// THE NESTED HOP (design §5, "spawn-node passes SIGINT/SIGTERM on to its child"). On posix a node runner and its model
// child are two process groups, so the orchestrator's group kill reaches the runner and not the child; the runner stops
// the child itself, and must be done — the child's exit seen or its pid recorded, the status written — before the
// orchestrator escalates. So its escalation and its deadline both sit inside SIGNAL_ESCALATE_AFTER_MS.
export const NESTED_ESCALATE_AFTER_MS = 1_500;
export const NESTED_SIGNAL_DEADLINE_MS = 3_000;
// A child already past its OWN timeout is unresponsive, so it gets no grace for SIGTERM: the SIGKILL follows at once
// (spawnCapture's timeout; G-22). Named here because it is an escalation, and escalations are this file's.
export const ESCALATE_AT_ONCE_MS = 0;
// The grace given under spawn-node's test-only --test-stop seam: the kill is injected and never ends the child, so the
// default 15 s would only slow the tests that drive it.
export const TEST_SEAM_GRACE_MS = 500;
// How often a pid this process does not hold is asked whether it is still alive.
export const GONE_POLL_MS = 100;
// How long the end-of-run reaper watches a RECORDED orphan for an exit already under way — an escalation its node started,
// a Windows job ending it with its node. Short, because it is not a second grace period: the node that recorded the pid
// had already given up on it after its own, and nothing here will kill it (design 2A), so a long wait buys only delay.
export const ORPHAN_SETTLE_MS = 2_000;

const hasExited = (child) => child.exitCode !== null || child.signalCode !== null;

/**
 * Stop a child this process holds.
 *
 * `event` is the exit event that counts: 'exit' for a child writing to files, 'close' for one whose pipes must drain
 * first. `proc`, the platform's process interface, is the one thing a caller may hand in (stop-owner-seam, SS-D1 A): a
 * refused kill, and an accepted kill that never ends the child, cannot be produced on request by any operating system, and
 * are the two outcomes the callers most need tested, so a test hands in a whole interface whose killTree answers as it needs.
 *
 * REFUSED MEANS STILL THERE (stopping-a-child-refusal.design.md, decided 2026-10-03: 1A). A kill whose primitive returns
 * false is a refusal only for a process that is still there. Measured on Windows: a second `taskkill /T /F` for a tree the
 * first has just ended exits 128 "not found" — the same code as "Access is denied" — so the primitive cannot say which, and
 * the owner asks: the child's own handle first, then `isAlive(pid)`. One already gone is waited for like any accepted kill.
 *
 * @returns {Promise<{ outcome: 'exited' | 'refused' | 'unconfirmed', pid: number }>}
 */
export function stopChild(child, {
  event = 'exit',
  escalateAfterMs = ESCALATE_AFTER_MS,
  deathGraceMs = DEATH_GRACE_MS,
  // A SUPERSEDING stop replaces one already under way (design 2A): it does not wait for a SIGTERM to be ignored, so it
  // sends SIGKILL at once. The owner chooses the signal; the caller says only that it is superseding.
  supersede = false,
  // SUPERSEDED: aborting settles this stop at once and clears its deadline, so a stop a caller has replaced does not hold
  // the process open until its own deadline fires (G-3 of 20261002-225920-stop-child-confirm). Its outcome is no statement
  // about the child — the caller replaced it — and it does not unref the child, which the superseding stop still holds.
  abortSignal = null,
  // The time the grace may not outlast (stopAll's one deadline); null = deathGraceMs from when the kill returns.
  deadlineAt = null,
  // The platform's process interface; null = the host's. Its killTree is the stop's one primitive, and its isAlive asks.
  proc = null,
  // The time posix's SIGKILL is due (stopAll's call plus its escalation; G-2 of 20261106-182300-nbk-delivery): a kill
  // requested late in stopAll escalates at that time, not escalateAfterMs after its own late request. null =
  // escalateAfterMs from the request.
  escalateBy = null,
  // The kill's record is already on disk (stopAll appends every child's before it requests any); the default kill does
  // not append it again.
  logged = false,
  ...unknown
} = {}) {
  // AN OPTION THE OWNER DOES NOT KNOW IS REFUSED (G-4 of 20261003-012557-stop-child-refusal-review): `killSignal` was
  // replaced by `supersede`, and a caller still passing it was silently given SIGTERM-plus-escalation. `kill` and
  // `killTree` are refused the same way since stop-owner-seam (SS-D1 A): the seam is `proc`.
  const extra = Object.keys(unknown);
  if (extra.length) throw new TypeError(`stopChild: unknown option(s): ${extra.join(', ')}`);
  const pr = procOf(proc, 'stopChild');
  const kill = (pid) => hostKillTree(pid, supersede ? { signal: 'SIGKILL' }
    : { signal: 'SIGTERM', escalateAfterMs: escalateBy == null ? escalateAfterMs : Math.max(0, escalateBy - Date.now()) },
  { logUntil: deadlineAt, logged, proc });
  const isAlive = (p) => pr.isAlive(p);
  const pid = child.pid;
  return new Promise((resolve) => {
    if (event === 'exit' && hasExited(child)) return resolve({ outcome: 'exited', pid });
    let settled = false;
    let deadline = null;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      abortSignal?.removeEventListener('abort', onAbort);
      child.off(event, onExit);
      // A child that is not confirmed gone must not hold this process open: nothing here waits for it any longer — unless
      // this stop was superseded, and the stop that replaced it is still waiting.
      if (outcome !== 'exited' && !abortSignal?.aborted) child.unref();
      resolve({ outcome, pid });
    };
    const onExit = () => settle('exited');
    const onAbort = () => settle('unconfirmed');
    if (abortSignal?.aborted) return settle('unconfirmed');
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    // Listened for BEFORE the kill, so an exit the kill causes at once cannot be missed.
    child.once(event, onExit);
    // 'close' on a child that has already closed will not fire again.
    if (event === 'close' && hasExited(child) && [child.stdout, child.stderr].every((s) => !s || s.destroyed)) {
      return settle('exited');
    }
    // A CHILD WHOSE HANDLE HAS EXITED IS NOT KILLED (G-8 of 20261002-235323-stop-child-confirm-2): under 'close' it may only be
    // draining its pipes, and its pid may already belong to another process. It is waited for.
    // THE KILL IS REQUESTED, NOT WAITED FOR (non-blocking-kill.plan.md stage 2, NB-D3 A): the primitive answers with a
    // promise, so stopAll starts every child's kill before any is awaited. THE GRACE IS ARMED WHEN THE KILL ANSWERS (I-5;
    // G-3 of 20261106-182300-nbk-delivery), so the time taskkill takes to answer is not taken from it, and a refusal is
    // judged before it. Under stopAll its one deadline is armed at once, so a kill that never answers is still bounded.
    const armGrace = () => {
      clearTimeout(deadline);
      const grace = deadlineAt == null ? deathGraceMs : Math.max(0, Math.min(deathGraceMs, deadlineAt - Date.now()));
      deadline = setTimeout(() => settle('unconfirmed'), grace);
    };
    if (hasExited(child)) return armGrace();
    let pending;
    try { pending = kill(pid); } catch { pending = false; }
    if (settled) return;
    if (deadlineAt != null) deadline = setTimeout(() => settle('unconfirmed'), Math.max(0, deadlineAt - Date.now()));
    Promise.resolve(pending).catch(() => false).then((delivered) => {
      if (settled) return;
      // Refused only if still there (1A): a kill that failed on a process already gone is waited for like an accepted
      // one. A kill not confirmed (null: win32's taskkill outlived its timeout) is waited for too, never a refusal.
      if (delivered === false && !hasExited(child) && isAlive(pid)) return settle('refused');
      armGrace();
    });
  });
}

/**
 * Stop every held child AT ONCE and wait at most one deadline for all of them (design 3A): an interrupt still ends
 * promptly however many children there are, and each child's outcome is its own. `entries` is [key, child] pairs.
 *
 * WHAT THE DEADLINE BOUNDS (G-2, G-3 of 20261106-065312-srb-remediation-review): the waits for each child's exit, and the
 * kill log's lock waits, which end at it (a record due after it is skipped and counted). The platform's kill requests are
 * inside it too since non-blocking-kill.plan.md stage 2 (NB-D3 A): killTree answers with a promise, every child's kill is
 * started before any is awaited, and win32's taskkill is given what remains of the deadline as its timeout. Before, each
 * request was a synchronous taskkill made in turn, ~350 ms each, added to the deadline per child.
 *
 * @returns {Promise<Array<{ key, outcome: 'exited' | 'refused' | 'unconfirmed', pid: number }>>}
 */
export function stopAll(entries, {
  deadlineMs = SIGNAL_EXIT_DEADLINE_MS,
  escalateAfterMs = SIGNAL_ESCALATE_AFTER_MS,
  // The platform's process interface; null = the host's (stop-owner-seam, SS-D1 A).
  proc = null,
  ...unknown
} = {}) {
  const extra = Object.keys(unknown);
  if (extra.length) throw new TypeError(`stopAll: unknown option(s): ${extra.join(', ')}`);
  procOf(proc, 'stopAll');
  // ONE DEADLINE, FROM THE CALL (G-5 of 20261106-061604-srb-delivery): each child's kill is requested in turn and may wait
  // on the kill log's lock, so a deadline started after each kill put the last child's past this one by every wait before
  // it. Each stop is given what is left of the call's deadline when its kill has returned, and each log wait what is left
  // of it before the kill.
  const started = Date.now();
  const until = started + deadlineMs;
  const list = [...entries];
  // Every record before any kill, in one append (I-5; G-2, G-3 of 20261106-190129-nbk-remediation-review): the children
  // the default kill will reach, which are those whose handle has not exited (stopChild kills no other), decided in this
  // same turn.
  const logged = Boolean(process.env.QUORATE_KILL_LOG);
  if (logged) {
    const caller = callerStack();
    appendKillRecords(list.filter(([, child]) => !hasExited(child))
      .map(([, child]) => killRecordOf(child.pid, { signal: 'SIGTERM' }, caller, { proc })),
      { logUntil: until, logWaitMs: APPEND_LOCK_WAIT_MS });
  }
  return Promise.all(list.map(([key, child]) =>
    stopChild(child, { event: 'exit', escalateAfterMs, escalateBy: started + escalateAfterMs, deathGraceMs: deadlineMs, deadlineAt: until,
      logged, ...(proc ? { proc } : {}) })
      .then((r) => ({ key, ...r }))));
}

/**
 * The exit hook's stop: the kill REQUESTED for every held child, synchronously — the only kind of work an 'exit' handler
 * may do — and nothing waited for. So nothing it returns is 'exited' unless the child had already gone: an accepted
 * kill is 'unconfirmed', said as itself, never counted as a death.
 *
 * @returns {Array<{ key, outcome: 'exited' | 'refused' | 'unconfirmed', pid: number }>}
 */
export function requestStopNow(entries, {
  // The platform's process interface; null = the host's. The hook reaches its killTreeNow and nothing else: no `kill` or
  // `killTree` option exists to hand it an asynchronous primitive (stop-owner-seam, SS-D1 A; G-2 of
  // 20261106-203532-nbk-remediation-3-review).
  proc = null,
  ...unknown
} = {}) {
  const extra = Object.keys(unknown);
  if (extra.length) throw new TypeError(`requestStopNow: unknown option(s): ${extra.join(', ')}`);
  const pr = procOf(proc, 'requestStopNow');
  const kill = (pid) => hostKillTree(pid, { signal: 'SIGKILL' }, { logWaitMs: 0, now: true, proc });
  const isAlive = (p) => pr.isAlive(p);
  return [...entries].map(([key, child]) => {
    const pid = child.pid;
    if (hasExited(child)) return { key, outcome: 'exited', pid };
    let delivered;
    try { delivered = kill(pid); } catch { delivered = false; }
    // Only a boolean is an answer: killTreeNow is synchronous by its contract, and anything else (a Promise above all) is
    // no statement that a kill was requested, so it is judged as not delivered.
    if (typeof delivered !== 'boolean') delivered = false;
    if (delivered !== false) return { key, outcome: 'unconfirmed', pid };
    // Refused only if still there (1A). A process no longer there is NOT 'exited' here: A-25 defines exited by the child's
    // own exit event, and this hook cannot wait for one — it is 'unconfirmed', as an accepted kill is (G-1, G-7 of
    // 20261003-012557-stop-child-refusal-review).
    return { key, outcome: isAlive(pid) ? 'refused' : 'unconfirmed', pid };
  });
}

/**
 * Whether a pid this process does NOT hold — recorded by an earlier run, or a child it already gave up on — has gone.
 * Polled, never killed. `isAlive` defaults to the platform's.
 *
 * @returns {Promise<{ outcome: 'exited' | 'unconfirmed', pid: number }>}
 */
export async function confirmGone(pid, {
  isAlive = (p) => hostPlatform().proc.isAlive(p),
  pollMs = GONE_POLL_MS,
  deadlineMs = DEATH_GRACE_MS,
} = {}) {
  const until = Date.now() + deadlineMs;
  for (;;) {
    if (!isAlive(pid)) return { outcome: 'exited', pid };
    if (Date.now() >= until) return { outcome: 'unconfirmed', pid };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
