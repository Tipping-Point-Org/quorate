// G-3, G-4 of 20261106-022028-stoplog-g8-remediation-2-review: io/stop-log.mjs separated a torn tail before its append
// (G-2 of 20261106-013812-stoplog-g8-remediation-review), and the two other JSONL appenders its census named did not:
// claim-check.mjs's step journal and io/stop-child.mjs's kill log joined their next record onto a partial last line, and a
// reader that skips an unparsable line lost both. All three now ask one owner, io/torn-tail.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopChild } from '../scripts/io/stop-child.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { withKill, makeLink } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G-4: a kill logged after a torn line is a line of its own', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-torn-kill-'));
  const before = process.env.QUORATE_KILL_LOG;
  t.after(() => {
    if (before === undefined) delete process.env.QUORATE_KILL_LOG; else process.env.QUORATE_KILL_LOG = before;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const log = path.join(dir, 'kills.jsonl');
  fs.writeFileSync(log, '{"at":"torn');
  process.env.QUORATE_KILL_LOG = log;
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', ...hostPlatform().proc.killableSpawnOptions() });
  await stopChild(child, { event: 'exit' });
  const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2, 'the kill was joined onto the torn line');
  assert.equal(lines[0], '{"at":"torn');
  assert.equal(JSON.parse(lines[1]).pid, child.pid);
});

// THE RECORD LOCK (stop-record-bounds-and-kill-log.plan.md stage 1; design KL-D1 B). The kill log's torn-tail check and
// its append are one operation (G-3 of 20261106-035103-stoplog-g8-remediation-3-review), under io/record-lock.mjs, the
// stop record's lock moved into its own owner. Two remediations each gave the kill log a private lock instead, and each
// drew a MEDIUM on its reclaim rule: never reclaimed (G-4 of 20261106-043201-stoplog-g8-remediation-4-review), then a
// failed reclaim marker taken as contention and the record appended unlocked (G-6 of
// 20261106-050324-stoplog-g8-remediation-5-review).
const tmp = (t, tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `q-rlock-${tag}-`)); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
// A platform whose process answers are the test's: `alive` pids live, each started at `starts[pid]` (else long ago).
const fakePlatform = ({ alive = [], starts = {} } = {}) => {
  const host = hostPlatform();
  return { ...host, proc: { ...host.proc, isAlive: (p) => alive.includes(p), startedAt: (p) => starts[p] ?? 1 } };
};
const lockOf = (pid, writtenAt = Date.now()) => JSON.stringify({ pid, writtenAt });

test('KL-D1: the kill log appends under the record lock and lets it go, on a line of its own', async (t) => {
  const { appendRecord } = await import('../scripts/io/torn-tail.mjs');
  const dir = tmp(t, 'held-during');
  const log = path.join(dir, 'kills.jsonl');
  fs.writeFileSync(log, '{"torn');
  assert.equal(appendRecord(log, '{"a":1}\n'), true);
  assert.equal(fs.existsSync(`${log}.lock`), false, 'the lock was left behind');
  assert.deepEqual(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean), ['{"torn', '{"a":1}']);
});

test('KL-D1: a lock held by a live writer is waited on, never removed, and past the wait the record is skipped, not appended unlocked', async (t) => {
  const { appendRecord } = await import('../scripts/io/torn-tail.mjs');
  const dir = tmp(t, 'live');
  const log = path.join(dir, 'kills.jsonl');
  const held = lockOf(4242);
  fs.writeFileSync(`${log}.lock`, held);
  const started = Date.now();
  assert.equal(appendRecord(log, '{"a":1}\n', { waitMs: 100, platform: fakePlatform({ alive: [4242] }) }), false);
  assert.ok(Date.now() - started >= 90, 'the append did not wait for the live holder');
  assert.equal(fs.existsSync(log), false, 'the record was appended without the lock');
  assert.equal(fs.readFileSync(`${log}.lock`, 'utf8'), held, "a live holder's lock was removed");
});

test('KL-D1: a lock whose holder is gone, or whose pid was reused since, is reclaimed at once', async (t) => {
  const { appendRecord } = await import('../scripts/io/torn-tail.mjs');
  const dir = tmp(t, 'stale');
  const log = path.join(dir, 'kills.jsonl');
  fs.writeFileSync(`${log}.lock`, lockOf(4242));
  let started = Date.now();
  assert.equal(appendRecord(log, '{"a":1}\n', { waitMs: 2_000, platform: fakePlatform() }), true, "a dead holder's lock was not reclaimed");
  assert.ok(Date.now() - started < 1_000, "the append waited on a dead holder's lock");
  fs.writeFileSync(`${log}.lock`, lockOf(4242, Date.now() - 60_000));
  started = Date.now();
  assert.equal(appendRecord(log, '{"b":2}\n', { waitMs: 2_000, platform: fakePlatform({ alive: [4242], starts: { 4242: Date.now() } }) }), true,
    'a lock whose pid now names a process started after it was written was not reclaimed');
  assert.ok(Date.now() - started < 1_000, 'the append waited on a reused pid');
  assert.deepEqual(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean), ['{"a":1}', '{"b":2}']);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n !== 'kills.jsonl'), [], 'a reclaimed lock was left behind');
});

test('KL-D1: a lock at a link is refused and thrown, never followed, with nothing appended', async (t) => {
  const { appendRecord } = await import('../scripts/io/torn-tail.mjs');
  const dir = tmp(t, 'link');
  const outside = tmp(t, 'outside');
  const log = path.join(dir, 'kills.jsonl');
  if (!makeLink(t, { target: path.join(outside, 'x'), at: `${log}.lock`, type: 'file' })) { t.skip('no symlinks here'); return; }
  assert.throws(() => appendRecord(log, '{"a":1}\n', { waitMs: 0 }));
  assert.equal(fs.existsSync(log), false, 'the record was appended without the lock');
  assert.equal(fs.existsSync(path.join(outside, 'x')), false, 'the lock was followed outside its folder');
});

// G-7 of 20261106-065312-srb-remediation-review: no test reached a lock-open failure that is not contention. One is thrown,
// never taken as a held lock and never followed by an unlocked append.
test('KL-D1: a lock that cannot be opened for a reason other than contention is thrown, with the record unchanged', async (t) => {
  const { appendRecord } = await import('../scripts/io/torn-tail.mjs');
  const dir = tmp(t, 'open-error');
  const log = path.join(dir, 'kills.jsonl');
  fs.writeFileSync(log, '{"a":1}\n');
  fs.mkdirSync(`${log}.lock`);   // a folder at the lock: its create fails EEXIST, and reading it fails with no holder
  const started = Date.now();
  assert.throws(() => appendRecord(log, '{"b":2}\n', { waitMs: 2_000 }), (e) => e?.code !== 'ELOCKBUSY',
    'an open error was taken as a held lock');
  assert.ok(Date.now() - started < 1_000, 'an open error was waited on like contention');
  assert.equal(fs.readFileSync(log, 'utf8'), '{"a":1}\n', 'the record was changed');
  assert.ok(fs.statSync(`${log}.lock`).isDirectory(), 'the folder at the lock was removed');
});

test('KL-D1: a held lock cannot hold stopAll past its deadline with several children', async () => {
  const { APPEND_LOCK_WAIT_MS } = await import('../scripts/io/torn-tail.mjs');
  const { SIGNAL_EXIT_DEADLINE_MS, stopAll } = await import('../scripts/io/stop-child.mjs');
  assert.ok(3 * APPEND_LOCK_WAIT_MS <= SIGNAL_EXIT_DEADLINE_MS / 4,
    `three kill-log waits (${3 * APPEND_LOCK_WAIT_MS} ms) take more than a quarter of stopAll's deadline (${SIGNAL_EXIT_DEADLINE_MS} ms)`);
  // G-5, G-13 of 20261106-061604-srb-delivery: comparing the constants never called stopAll, and each child's deadline
  // started only after its own kill returned, so kills that each waited on a held log lock pushed the last child's deadline
  // back by every wait before it. Here each kill blocks as a lock wait does and never ends its child: three children
  // settle at stopAll's one deadline, not at the deadline plus the waits.
  const { EventEmitter } = await import('node:events');
  const child = (pid) => Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null, unref() {} });
  const WAIT = 150, DEADLINE = 600;
  const kill = () => { const until = Date.now() + WAIT; while (Date.now() < until) { /* a held lock's wait */ } return true; };
  const started = Date.now();
  const r = await stopAll([['a', child(901)], ['b', child(902)], ['c', child(903)]], withKill({ deadlineMs: DEADLINE, kill }));
  const took = Date.now() - started;
  assert.deepEqual(r.map((x) => x.outcome), ['unconfirmed', 'unconfirmed', 'unconfirmed']);
  assert.ok(took < DEADLINE + WAIT, `stopAll took ${took} ms, past its ${DEADLINE} ms deadline by the kills' waits`);
});

// G-3, G-2 of 20261106-065312-srb-remediation-review: the test above injects the kill, so the kill log's own lock wait,
// on stopAll's default kill path, was never inside it: with N children and a held log lock, the serial waits (200 ms each)
// ran past the one deadline before every child had been asked to stop. The waits are now bounded by what is left of it.
test("G-3: stopAll's default kill path holds the kill log's lock waits inside its one deadline, however many children", async (t) => {
  const { stopAll } = await import('../scripts/io/stop-child.mjs');
  const { EventEmitter } = await import('node:events');
  const dir = tmp(t, 'stopall-log');
  const log = path.join(dir, 'kills.jsonl');
  fs.writeFileSync(`${log}.lock`, 'held');   // unparsable: held, waited on, never reclaimed
  const before = process.env.QUORATE_KILL_LOG;
  const write = process.stderr.write;
  t.after(() => {
    if (before === undefined) delete process.env.QUORATE_KILL_LOG; else process.env.QUORATE_KILL_LOG = before;
    process.stderr.write = write;
  });
  process.env.QUORATE_KILL_LOG = log;
  process.stderr.write = () => true;
  // The default kill, logging each child, over a platform kill accepted at once that never ends the child: what is timed is
  // the log's waits. The platform's own kill requests are not bounded by the deadline (stopAll's comment says so).
  const child = (pid) => Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null, unref() {} });
  const N = 12;
  const kids = Array.from({ length: N }, (_, i) => [`n${i}`, child(4_000_000 + i * 4)]);
  const { APPEND_LOCK_WAIT_MS } = await import('../scripts/io/torn-tail.mjs');
  const DEADLINE = 400;
  const asked = [];
  const started = Date.now();
  const r = await stopAll(kids, withKill({ deadlineMs: DEADLINE, killTree: (pid) => { asked.push(pid); return true; } }));
  const took = Date.now() - started;
  process.stderr.write = write;
  assert.equal(asked.length, N, 'a child was not asked to stop');
  assert.deepEqual(r.map((x) => x.outcome), kids.map(() => 'unconfirmed'));
  // Unbounded, the waits alone are N x APPEND_LOCK_WAIT_MS (2.4 s); bounded, they end at the deadline.
  assert.ok(took < DEADLINE + APPEND_LOCK_WAIT_MS,
    `stopAll took ${took} ms, past its ${DEADLINE} ms deadline by the kill log's lock waits (unbounded: ${N * APPEND_LOCK_WAIT_MS} ms)`);
  assert.equal(fs.existsSync(log), false, 'a record was appended without the lock');
});

// G-5 of 20261106-073206-srb-remediation-2-review: requestStopNow, the exit hook's stop, logged each kill with the full
// APPEND_LOCK_WAIT_MS lock wait, so a held kill-log lock blocked the hook once per child before its kill. The hook only
// requests (A-25): its log record is tried once, never waited for.
test('G-5: the exit hook never waits on the kill log\'s lock, however many children', async (t) => {
  const { requestStopNow } = await import('../scripts/io/stop-child.mjs');
  const { APPEND_LOCK_WAIT_MS } = await import('../scripts/io/torn-tail.mjs');
  const { EventEmitter } = await import('node:events');
  const dir = tmp(t, 'exit-hook-log');
  const log = path.join(dir, 'kills.jsonl');
  fs.writeFileSync(`${log}.lock`, 'held');   // unparsable: held, never reclaimed
  const before = process.env.QUORATE_KILL_LOG;
  const write = process.stderr.write;
  t.after(() => {
    if (before === undefined) delete process.env.QUORATE_KILL_LOG; else process.env.QUORATE_KILL_LOG = before;
    process.stderr.write = write;
  });
  // Pids of children already gone, so no kill can reach a live process whatever path it takes.
  const gone = [];
  for (let i = 0; i < 4; i++) {
    const c = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await new Promise((r) => c.once('exit', r));
    gone.push(c.pid);
  }
  const child = (pid) => Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null, unref() {} });
  process.env.QUORATE_KILL_LOG = log;
  process.stderr.write = () => true;
  const asked = [];
  const started = Date.now();
  // The exit hook's primitive is the platform's killTreeNow, replaced through `proc` (G-3 of
  // 20261106-200030-nbk-remediation-2-review: a killTree override is refused there).
  const proc = { ...hostPlatform().proc, killTreeNow: (pid) => { asked.push(pid); return true; } };
  const r = requestStopNow(gone.map((p, i) => [`n${i}`, child(p)]), { proc });
  const took = Date.now() - started;
  process.stderr.write = write;
  assert.equal(r.length, gone.length);
  assert.ok(took < APPEND_LOCK_WAIT_MS,
    `the exit hook took ${took} ms on a held kill-log lock (one wait per child: ${gone.length * APPEND_LOCK_WAIT_MS} ms)`);
  assert.deepEqual(asked, gone, 'a child was not asked to stop through the given tree kill');
  assert.equal(fs.existsSync(log), false, 'a record was appended without the lock');
});

// G-3 of 20261106-073206-srb-remediation-2-review: a lock with a live, parsable holder made the record lock ask the
// platform for the holder's start time (PowerShell or ps, up to 5 s) before the wait's deadline was checked, so the kill
// log's bounded wait was not bounded. The kill log does not ask: a live holder is held, waited on and skipped past.
test("G-3: the kill log's append never asks a live holder's start time", async (t) => {
  const { appendRecord } = await import('../scripts/io/torn-tail.mjs');
  const dir = tmp(t, 'no-probe');
  const log = path.join(dir, 'kills.jsonl');
  fs.writeFileSync(`${log}.lock`, lockOf(4242));
  let probes = 0;
  const host = hostPlatform();
  const platform = { ...host, proc: { ...host.proc, isAlive: (p) => p === 4242, startedAt: () => { probes += 1; return 1; } } };
  assert.equal(appendRecord(log, '{"a":1}\n', { waitMs: 0, probeStart: false, platform }), false);
  assert.equal(probes, 0, "the kill log's append asked the holder's start time, outside its wait");
  assert.equal(fs.existsSync(log), false, 'the record was appended without the lock');
  const s = src('scripts/io/stop-child.mjs');
  assert.match(s, /appendRecord\(log, [\s\S]*?probeStart: false/, "the kill log's append does not decline the start-time probe");
});

test('KL-D1: a kill whose log record is skipped is counted, and the kill still runs', async (t) => {
  const { stopChild: stop, killLogSkipped } = await import('../scripts/io/stop-child.mjs');
  const dir = tmp(t, 'skip');
  const before = process.env.QUORATE_KILL_LOG;
  t.after(() => { if (before === undefined) delete process.env.QUORATE_KILL_LOG; else process.env.QUORATE_KILL_LOG = before; });
  const log = path.join(dir, 'kills.jsonl');
  fs.writeFileSync(`${log}.lock`, lockOf(process.pid));   // held by a live writer: this process, written now
  process.env.QUORATE_KILL_LOG = log;
  const skips = killLogSkipped();
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', ...hostPlatform().proc.killableSpawnOptions() });
  // G-4 of 20261106-061604-srb-delivery: the count was read by no production code, so a skipped record was invisible to
  // the operator who turned the log on. Each skip is said on stderr, the pid and the log named.
  const said = [];
  const write = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => { said.push(String(chunk)); return write.call(process.stderr, chunk, ...rest); };
  let r;
  try { r = await stop(child, { event: 'exit' }); } finally { process.stderr.write = write; }
  assert.ok(said.some((l) => l.includes(String(child.pid)) && l.includes(log)), `the skipped record was not said on stderr: ${JSON.stringify(said)}`);
  assert.equal(r.outcome, 'exited', 'the kill did not run while the log was locked');
  assert.equal(killLogSkipped(), skips + 1, 'the skipped record was not counted');
  assert.equal(fs.existsSync(log), false, 'the record was appended without the lock');
});

// THE CENSUSES COUNT SITES, NOT FILES (G-8, G-9, G-10 of 20261106-065312-srb-remediation-review): each collapsed its
// matches to file names and allowed whole files, so a second lock, or an unlocked tail check, added to an allowed file
// left it green. Each allowed file now names how many sites it holds, and each torn-tail call is judged where it stands.
const sitesOf = (s, re) => (s.match(new RegExp(re.source, 'g')) ?? []).length;
// Files whose site count differs from the allow-list's: a file not on it, or one holding more or fewer sites than named.
// An allowed file no longer scanned is stale too (G-8 of 20261106-073206-srb-remediation-2-review).
const censusMisses = (files, re, allowed) => [...files
  .map(([f, s]) => [f, sitesOf(s, re)])
  .filter(([f, n]) => n > 0 ? allowed[f]?.[0] !== n : allowed[f] !== undefined)
  .map(([f, n]) => `${f}: ${n} site(s), allowed ${allowed[f]?.[0] ?? 0}`),
...Object.keys(allowed).filter((f) => !files.some(([g]) => g === f)).map((f) => `${f}: allowed, but not found`)];
// Every `endsMidLine(` call (not its definition) that no withRecordLock( or underLock( call's argument list encloses.
const unlockedTailChecks = (s) => {
  const spans = [];
  for (const m of s.matchAll(/(?<!function )\b(?:withRecordLock|underLock)\(/g)) {
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < s.length; i++) { if (s[i] === '(') depth++; else if (s[i] === ')' && --depth === 0) break; }
    spans.push([m.index, i]);
  }
  return [...s.matchAll(/(?<!function )\bendsMidLine\(/g)].filter((m) => !spans.some(([a, b]) => m.index > a && m.index < b)).map((m) => m.index);
};
const EXCL = /['"](?:wx|ax)\+?['"]/;
const LOCKNAME = /\.lock['"`]/;
test('the censuses count sites: a second lock or an unlocked tail check in an allowed file is caught', () => {
  assert.deepEqual(censusMisses([['a.mjs', "open(x, 'wx'); open(y, 'wx')"]], EXCL, { 'a.mjs': [1, 'one lock'] }).length, 1,
    "a second exclusive create in an allowed file was not caught");
  assert.deepEqual(censusMisses([['a.mjs', "'a.lock' `${b}.lock`"]], LOCKNAME, { 'a.mjs': [1, 'one lock'] }).length, 1,
    'a second `.lock` in an allowed file was not caught');
  assert.equal(unlockedTailChecks('underLock(own, s, () => { endsMidLine(f); });\nif (endsMidLine(g)) x();').length, 1,
    'an unlocked tail check beside a locked one was not caught');
  // G-8 of 20261106-073206-srb-remediation-2-review: a stale entry, a file allowed but no longer under scripts/, was checked
  // only by asserting the allow-list's own literal count was positive, which cannot fail.
  assert.equal(censusMisses([['a.mjs', "open(x, 'wx')"]], EXCL, { 'a.mjs': [1, 'one lock'], 'gone.mjs': [1, 'removed'] }).length, 1,
    'an allowed file that is no longer scanned was not caught');
});

test('one record lock: no lock is created outside the named lock owners', () => {
  // Instrument: every exclusive create ('wx', 'ax') under scripts/, counted per file. Each allowed file names its count
  // and its reason; any other site is a lock rule of its own, the class this plan ends.
  const ALLOWED = {
    'scripts/io/record-lock.mjs': [1, 'the record lock'],
    'scripts/io/atomic.mjs': [2, 'acquireFileLock and its reclaim marker (the ledger, decisions, probes, the run state; CR-D4)'],
    'scripts/io/repo-lock.mjs': [1, 'one remediation per repository (pid plus host)'],
    'scripts/external-review.mjs': [1, "--out created exclusively: a caller's output file, not a lock"],
    'scripts/findings-ledger.mjs': [2, 'the migration report created exclusively: a report, not a lock'],
    'scripts/lib/confined-path.mjs': [1, "the confined owner's exclusive create: the primitive, not a lock"],
    // G-10 of 20261122-214154-llo-remediation-2-review: removed, then created new, so no link at its name is written through.
    'scripts/publish.mjs': [1, "the public secret scan's record created exclusively: a record, not a lock"],
  };
  assert.deepEqual(censusMisses(scriptFiles(), EXCL, ALLOWED), [], 'an exclusive create outside the named lock owners');
});

// G-14 of 20261106-061604-srb-delivery: the census above sees only a literal 'wx', so a `<file>.lock` made any other way
// (the confined owner's create, a replace, writeFileSync) was invisible, the second lock pattern the plan's census names.
function scriptFiles() {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.mjs') ? [path.join(d, e.name)] : []);
  return walk(path.join(ROOT, 'scripts')).map((f) => [path.relative(ROOT, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')]);
}
test('one record lock: no `<file>.lock` is named outside the named lock owners', () => {
  // Instrument: every literal under scripts/ naming a file ending `.lock` (closing on a quote or a backtick: 'x.lock',
  // `${k}.lock`, '.lock'), counted per file. Each allowed file names its count and its reason.
  const ALLOWED = {
    'scripts/io/torn-tail.mjs': [2, "appendRecord's `<file>.lock`, the record lock (its comment and its call)"],
    'scripts/io/stop-log.mjs': [2, "a session folder's `.lock`, the record lock (io/record-lock.mjs; its constant and its comment)"],
    'scripts/io/repo-lock.mjs': [1, 'one remediation per repository (pid plus host)'],
    'scripts/io/reviewer-probe.mjs': [2, "a probe key's lock, through io/atomic.mjs acquireFileLock"],
    'scripts/decide.mjs': [2, 'the decision record and the spend count, through io/atomic.mjs acquireFileLock'],
    'scripts/findings-ledger.mjs': [2, 'the ledger, through io/atomic.mjs acquireFileLock'],
    // remediate.mjs and archive-run.mjs name no `.lock` literal of their own: both take remediate.lock through
    // lib/remediate-lock.mjs's REMEDIATE_LOCK (G-3 of 20261121-193516-m3s7-b1-review).
    'scripts/lib/remediate-lock.mjs': [1, "remediate.lock's one owner, the protocol remediate.mjs and archive-run.mjs share (G-3 of 20261121-193516-m3s7-b1-review)"],
    'scripts/lib/preflight-cache.mjs': [8, "dependency manifests (uv.lock, Cargo.lock): file names, not locks"],
  };
  assert.deepEqual(censusMisses(scriptFiles(), LOCKNAME, ALLOWED), [], 'a `<file>.lock` outside the named lock owners');
});

// G-2 of 20261106-061604-srb-delivery: a tail check and an append are one operation (G-3 of
// 20261106-035103-stoplog-g8-remediation-3-review), so every torn-tail check under scripts/ is either inside the record
// lock or named here as a single writer, with its reason. claim-check's journal was neither.
test('one record lock: every torn-tail check is under the record lock or a named single writer', () => {
  const SINGLE_WRITER = {};
  const found = scriptFiles().flatMap(([f, s]) => unlockedTailChecks(s).map((at) => [f, at]));
  assert.deepEqual(found.filter(([f]) => !SINGLE_WRITER[f]).map(([f, at]) => `${f}@${at}`), [],
    'a torn-tail check and append outside the record lock, not named as a single writer');
});

test('G-3 (r3): io/stop-child.mjs appends the kill log through appendRecord, not a check and an append of its own', () => {
  const s = src('scripts/io/stop-child.mjs');
  assert.match(s, /appendRecord\(log, /);
  assert.doesNotMatch(s, /endsMidLine\(/, 'the kill log checks its tail outside the lock');
});

test('G-3: the claim-check step journal separates a torn tail before it appends', () => {
  const s = src('scripts/claim-check.mjs');
  const line = s.split('\n').find((l) => /const journal = /.test(l));
  assert.ok(line, 'the journal writer is present');
  // Through appendRecord, the torn-tail check and the append under the record lock (G-2 of 20261106-061604-srb-delivery).
  assert.match(line, /appendRecord\(journalPath, /, 'the journal appends with no torn-tail check under the record lock');
});

test('one owner: io/stop-log.mjs uses io/torn-tail.mjs, with no copy of its own', async () => {
  assert.ok(!/function endsMidLine/.test(src('scripts/io/stop-log.mjs')), 'stop-log keeps its own copy');
  const { endsMidLine } = await import('../scripts/io/torn-tail.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-torn-'));
  try {
    const f = path.join(dir, 'x.jsonl');
    assert.equal(endsMidLine(f), false, 'missing');
    fs.writeFileSync(f, '');
    assert.equal(endsMidLine(f), false, 'empty');
    fs.writeFileSync(f, '{}\n');
    assert.equal(endsMidLine(f), false, 'whole');
    fs.writeFileSync(f, '{}\n{"a');
    assert.equal(endsMidLine(f), true, 'torn');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// G-4 of 20261106-080520-srb-remediation-3-review (operator, 2026-11-06: "Accept skip, bound size (Recommended)"): the
// kill log grew without limit. Past its cap it is rotated under its lock to <file>.1, replacing the previous one.
test('the kill log is bounded: past its cap it rotates to <file>.1, keeping the current file and one previous', async (t) => {
  const { appendRecord } = await import('../scripts/io/torn-tail.mjs');
  const { KILL_LOG_MAX_BYTES } = await import('../scripts/io/stop-child.mjs');
  assert.ok(Number.isFinite(KILL_LOG_MAX_BYTES) && KILL_LOG_MAX_BYTES > 0, 'the kill log has no size cap');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-kill-rotate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'kills.jsonl');
  const line = `${JSON.stringify({ pad: 'x'.repeat(40) })}\n`;
  for (let i = 0; i < 5; i++) assert.equal(appendRecord(log, line, { maxBytes: 100 }), true);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['kills.jsonl', 'kills.jsonl.1'], 'the log was not rotated, or kept more than two files');
  assert.ok(fs.statSync(path.join(dir, 'kills.jsonl.1')).size <= 100 + line.length, 'the previous file outgrew one append past the cap');
  assert.ok(fs.statSync(log).size <= 100 + line.length);
  const s = fs.readFileSync(path.join(ROOT, 'scripts', 'io', 'stop-child.mjs'), 'utf8');
  assert.match(s, /maxBytes: KILL_LOG_MAX_BYTES/, 'the kill log append passes no cap');

  // G-1 of 20261106-200030-nbk-remediation-2-review: appendRecord rotated before an append but never bounded the append
  // itself, and stopAll joins every child's record into one, so one large batch took the live log past its cap. A record
  // larger than the cap is refused with nothing appended, and stopAll's batch is appended in pieces that each fit.
  fs.writeFileSync(log, '');
  assert.throws(() => appendRecord(log, `${'x'.repeat(150)}\n`, { maxBytes: 100 }), 'a record larger than the cap was accepted');
  assert.equal(fs.statSync(log).size, 0, 'a record larger than the cap was appended');
  const { stopAll } = await import('../scripts/io/stop-child.mjs');
  const { EventEmitter } = await import('node:events');
  const before = process.env.QUORATE_KILL_LOG;
  t.after(() => { if (before === undefined) delete process.env.QUORATE_KILL_LOG; else process.env.QUORATE_KILL_LOG = before; });
  const child = (pid) => Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null, unref() {} });
  const killTree = (pid, _o, kids) => { const c = kids.get(pid); c.exitCode = 0; c.emit('exit'); return Promise.resolve(true); };
  const run = async (n, file) => {
    process.env.QUORATE_KILL_LOG = file;
    const kids = new Map(Array.from({ length: n }, (_, i) => [5_000_000 + i * 4, null]).map(([p]) => [p, child(p)]));
    await stopAll([...kids].map(([p, c]) => [`n${p}`, c]), withKill({ deadlineMs: 20_000, killTree: (p, o) => killTree(p, o, kids) }));
    return [...kids.keys()];
  };
  const big = path.join(dir, 'big.jsonl');
  await run(1, big);
  const perRecord = fs.statSync(big).size;
  fs.rmSync(big);
  const pids = await run(Math.ceil(KILL_LOG_MAX_BYTES / perRecord) + 50, big);
  assert.ok(fs.existsSync(`${big}.1`), 'the batch did not pass the cap, so it tested nothing');
  for (const f of [big, `${big}.1`].filter((f) => fs.existsSync(f))) {
    assert.ok(fs.statSync(f).size <= KILL_LOG_MAX_BYTES, `${path.basename(f)} is ${fs.statSync(f).size} bytes, past the kill log's cap of ${KILL_LOG_MAX_BYTES}`);
  }
  assert.equal(JSON.parse(fs.readFileSync(big, 'utf8').split('\n').filter(Boolean).pop()).pid, pids.at(-1), "the batch's last record was not logged");
});

// G-7 of 20261106-144637-srb-d1-review: the rotation ran after the append, in the same try, so a rotation that failed
// threw with the record already on disk, against appendRecord's contract ("any other error is thrown, with nothing
// appended"), and stop-child counted a written kill as skipped; and the previous file was removed before the rename that
// could still fail. The rotation now runs before the append, and the previous file is set aside, not removed, until the
// current one has taken its place.
test('G-7: a rotation that fails throws with nothing appended, and the previous file is kept', async (t) => {
  const { appendRecord } = await import('../scripts/io/torn-tail.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-kill-rotate-fail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'kills.jsonl');
  const line = `${JSON.stringify({ pad: 'x'.repeat(40) })}\n`;
  assert.equal(appendRecord(log, line, { maxBytes: 100 }), true);
  // A directory where the previous file goes: the owner refuses to remove or move it, so the rotation fails.
  fs.mkdirSync(path.join(dir, 'kills.jsonl.1'));
  fs.writeFileSync(path.join(dir, 'kills.jsonl.1', 'kept'), 'history');
  const before = fs.readFileSync(log, 'utf8');
  assert.throws(() => appendRecord(log, line, { maxBytes: 100 }));
  assert.equal(fs.readFileSync(log, 'utf8'), before, 'the rotation threw with the record already appended');
  assert.equal(fs.readFileSync(path.join(dir, 'kills.jsonl.1', 'kept'), 'utf8'), 'history', 'the previous file was lost');
});

// A platform whose rename fails terminally (EIO, retried by no platform) when its source is named `failing`; every other
// rename is the host's. The owner's rename goes through its platform, so this is the failure a rotation meets.
function failingRename(failing) {
  const host = hostPlatform();
  return { ...host, fs: { ...host.fs, renameSync: (a, b) => {
    if (path.basename(a) === failing) throw Object.assign(new Error(`EIO: rename '${a}'`), { code: 'EIO' });
    return host.fs.renameSync(a, b);
  } } };
}

// G-4, G-1 of 20261106-151751-srb-d1-remediation-review: the owner's rename was durableRename, which removes its source
// when a rename fails terminally, so a rotation whose rename failed deleted the live kill log (G-4) or the session record
// holding the event just written (G-1, io/stop-log.mjs).
test('G-4: an owner rename that fails terminally keeps its source', async (t) => {
  const { confined } = await import('../scripts/io/confined-path.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-own-rename-fail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'live.jsonl'), 'records\n');
  const own = confined(dir, { io: failingRename('live.jsonl') });
  assert.throws(() => own.rename(['live.jsonl'], ['live.jsonl.1']), (e) => e.code === 'EIO', 'the failing rename did not fail');
  assert.equal(fs.existsSync(path.join(dir, 'live.jsonl')), true, 'the failed rename deleted its source');
  assert.equal(fs.readFileSync(path.join(dir, 'live.jsonl'), 'utf8'), 'records\n');
});

// G-4, G-11 of the same review: the rotation's own failure, with a previous file present, so the rollback that puts the
// previous file back is run (the directory test above refuses before anything is set aside).
test('G-4: a rotation whose rename fails keeps the live log and restores the previous file', async (t) => {
  const { appendRecord } = await import('../scripts/io/torn-tail.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-kill-rollback-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'kills.jsonl');
  const line = `${JSON.stringify({ pad: 'x'.repeat(40) })}\n`;
  fs.writeFileSync(`${log}.1`, 'previous\n');
  fs.writeFileSync(log, line);
  assert.throws(() => appendRecord(log, line, { maxBytes: 60, platform: failingRename('kills.jsonl') }), (e) => e.code === 'EIO');
  assert.equal(fs.existsSync(log) && fs.readFileSync(log, 'utf8'), line, 'the live log was lost or changed');
  assert.equal(fs.existsSync(`${log}.1`) && fs.readFileSync(`${log}.1`, 'utf8'), 'previous\n', 'the previous file was not restored');
  assert.equal(fs.existsSync(`${log}.1.old`), false, 'the previous file was left aside');
});

// G-3 of the same review: a leftover <file>.1.old with no <file>.1 is the only previous file, left by an interrupted
// rotation; it was removed unconditionally, so a rotation that then failed had lost it.
test('G-3: a leftover .1.old with no .1 is restored, not removed', async (t) => {
  const { appendRecord } = await import('../scripts/io/torn-tail.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-kill-aside-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'kills.jsonl');
  const line = `${JSON.stringify({ pad: 'x'.repeat(40) })}\n`;
  fs.writeFileSync(`${log}.1.old`, 'only previous\n');
  fs.writeFileSync(log, line);
  assert.throws(() => appendRecord(log, line, { maxBytes: 60, platform: failingRename('kills.jsonl') }), (e) => e.code === 'EIO');
  assert.equal(fs.existsSync(`${log}.1`) && fs.readFileSync(`${log}.1`, 'utf8'), 'only previous\n', 'the only previous file was removed');
});

// G-7 of the same review: the cap counted the record's bytes only, and a torn tail's newline went on top, so the file
// could end one byte past its bound.
test('G-7: the separating newline counts toward the cap', async (t) => {
  const { appendRecord } = await import('../scripts/io/torn-tail.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-kill-cap-nl-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'kills.jsonl');
  const record = '{"a":1}\n';
  fs.writeFileSync(log, '{"torn');
  const maxBytes = fs.statSync(log).size + Buffer.byteLength(record);
  assert.equal(appendRecord(log, record, { maxBytes }), true);
  assert.ok(fs.statSync(log).size <= maxBytes, `the file is ${fs.statSync(log).size} bytes, past its cap of ${maxBytes}`);
});

// G-3 of 20261106-155048-srb-d1-remediation-2-review (operator, 2026-11-06: "creating the folder is the wrong decision. The
// correct one is finding out why an inexistent folder was referenced"; "Name the cause, then fix"): a kill log in a folder
// that does not exist is not created, and the skip names that folder and the variable that named it.
test('a kill log in a folder that does not exist is not created, and the skip names the missing folder', async (t) => {
  const { stopChild: stop, killLogSkipped } = await import('../scripts/io/stop-child.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-kill-nodir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const missing = path.join(dir, 'not-made');
  const log = path.join(missing, 'kills.jsonl');
  const before = process.env.QUORATE_KILL_LOG;
  t.after(() => { if (before === undefined) delete process.env.QUORATE_KILL_LOG; else process.env.QUORATE_KILL_LOG = before; });
  process.env.QUORATE_KILL_LOG = log;
  const said = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s, ...rest) => { said.push(String(s)); return true; };
  t.after(() => { process.stderr.write = write; });
  const skips = killLogSkipped();
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', ...hostPlatform().proc.killableSpawnOptions() });
  const r = await stop(child, { event: 'exit' });
  process.stderr.write = write;
  assert.equal(r.outcome, 'exited', 'the kill did not run');
  assert.equal(killLogSkipped(), skips + 1, 'the skip was not counted');
  assert.equal(fs.existsSync(missing), false, 'the missing folder was created');
  const line = said.find((s) => s.includes('kill log record'));
  assert.ok(line, 'the skip was not said');
  assert.ok(line.includes(`the folder ${path.resolve(missing)} does not exist`), `the skip does not name the missing folder: ${line}`);
  assert.match(line, /QUORATE_KILL_LOG/, 'the skip does not name the variable that pointed there');
});
