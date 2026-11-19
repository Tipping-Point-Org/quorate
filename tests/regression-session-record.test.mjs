// The session records' owner (session-record-files.plan.md stage 1; design S-D1, S-D3, S-D2's rotation). The previous
// owner shared one file per repository between every session, rotated it under a lock judged stale by its age, and three
// remediations in a row each found a new defect in that machinery (G-6 of 20261025-021243-arp-remediation-3c-review: two
// waiters both cleared the lock, and the second deleted the first's fresh lock). Now a session has its own folder, and
// a lock names its owner: stale only when that process is gone or its pid was reused.
//
// Each sweep test passes sweepIntervalMs: 0: it tests the sweep itself, and several first writes in one test fall inside
// one interval (stop-record-bounds-and-kill-log.plan.md stage 2, BI-D2 A: at most one sweep per interval).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as lib from '../scripts/lib/session-record.mjs';
import { appendStopEvent, readStopEvents, readSessionTail, sessionDir } from '../scripts/io/stop-log.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = path.join(ROOT, 'scripts', 'io', 'stop-log.mjs');

function withRepo(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'srec-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'srec-repo-'));
  return Promise.resolve(fn({ home, repo })).finally(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  });
}

// G-7 of 20261025-104155-srf-remediation-3-review: the sweep removed another session's folder with no lock on it, from
// a freshness check made before the removal, so a session appending meanwhile lost its event. A folder whose lock a live
// writer holds is not removed, and the failure to take it is recorded.
test('regression: the retention sweep takes a folder\'s lock before it removes the folder', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 'old' }, { home });
  const old = sessionDir(repo, 'old', { home });
  fs.writeFileSync(path.join(old, '.lock'), lib.lockContent({ pid: process.pid, writtenAt: Date.now() }));
  const past = new Date(Date.now() - 40 * 86_400_000);
  for (const n of fs.readdirSync(old)) fs.utimesSync(path.join(old, n), past, past);
  const platform = { proc: { isAlive: () => true, startedAt: () => 0 }, transientRenameCodes: new Set() };
  appendStopEvent(repo, { at: 2, event: 'start', session: 'new' }, { home, retentionDays: 30, sweepIntervalMs: 0, lockWaitMs: 50, platform });
  assert.ok(fs.existsSync(path.join(old, 'current.jsonl')), 'a folder a live writer holds the lock of is not removed');
  const failed = readStopEvents(repo, { home }).events.filter((e) => e.event === 'retention-failed');
  assert.deepEqual(failed.map((e) => e.folders.map((f) => f.folder)), [['old']], 'and the sweep says it could not remove it');
  // Its lock released, the next sweep removes it.
  fs.rmSync(path.join(old, '.lock'));
  appendStopEvent(repo, { at: 3, event: 'start', session: 'newer' }, { home, retentionDays: 30, sweepIntervalMs: 0, lockWaitMs: 50, platform });
  assert.ok(!fs.existsSync(old), 'an expired folder no one holds is removed');
}));

test('regression: a session id names its folder only when it is a safe single name', () => {
  assert.equal(lib.sessionFolder('3b9b623f-6776-4444'), '3b9b623f-6776-4444');
  // A nonempty unsafe id keeps a folder of its own, named from its hash (G-16 of 20261114-022647-m2-7b-review).
  for (const bad of ['..', '.', 'a/b', 'a\\b', 'x'.repeat(200)]) assert.match(lib.sessionFolder(bad), /^~unknown-[0-9a-f]{16}$/, String(bad));
  for (const missing of ['', null]) assert.equal(lib.sessionFolder(missing), '~unknown', String(missing));
});

// G-15 of 20261025-104155-srf-remediation-3-review: the predicate admitted names Windows cannot make as a folder (`CON`,
// `nul.txt`) or makes as another (`foo.` is `foo`), so two sessions could share a folder or one could not write at all.
test('regression: a session id Windows would not keep as its own folder names none', () => {
  for (const bad of ['CON', 'con', 'nul.txt', 'COM1', 'lpt9.log', 'aux', 'foo.', 'a..']) {
    assert.match(lib.sessionFolder(bad), /^~unknown-[0-9a-f]{16}$/, bad);
  }
  for (const good of ['console', 'com10', 'a.b', 'nulx', '3b9b623f-6776-4444']) assert.equal(lib.sessionFolder(good), good, good);
  // Ids that differ only in case keep folders that differ in more than case.
  const folded = ['abc', 'Abc', 'ABC', 'aBc'].map((s) => lib.sessionFolder(s).toLowerCase());
  assert.equal(new Set(folded).size, 4, `case-only variants must not share a folder: ${folded.join(', ')}`);
});

// G-4 of 20261025-104155-srf-remediation-3-review: stop-log kept its own nearest-existing-ancestor link resolver (realOf)
// beside the owner, lib/finding-scope.mjs's linkForms, so a containment fix had two places to reach.
test('regression: the session records resolve a path through links with the one owner', () => {
  const src = fs.readFileSync(OWNER, 'utf8');
  assert.doesNotMatch(src, /function realOf\(/, 'stop-log defines no link resolver of its own');
  assert.match(src, /linkForms\(/, 'it asks the owner');
});

test('regression: a lock is stale only when its owner is gone or its pid was reused, never by age', () => {
  const held = JSON.stringify({ pid: 10, writtenAt: 5000 });
  assert.equal(lib.lockState(held, { isAlive: () => false, startedAt: () => null }), 'stale');
  assert.equal(lib.lockState(held, { isAlive: () => true, startedAt: () => 4000 }), 'held', 'the owner started before it wrote the lock');
  assert.equal(lib.lockState(held, { isAlive: () => true, startedAt: () => 99_999 }), 'stale', 'a reused pid');
  assert.equal(lib.lockState(held, { isAlive: () => true, startedAt: () => null }), 'held', 'a start time the OS will not give');
  assert.equal(lib.lockState('', { isAlive: () => false, startedAt: () => null }), 'held', 'an unreadable lock is not deleted on a guess');
  // Nothing in the owner judges a lock by its age.
  const src = fs.readFileSync(OWNER, 'utf8');
  assert.ok(!/STALE_LOCK_MS|mtimeMs\s*>\s*STALE/.test(src), 'no age-based staleness remains');
});

test('regression: a line over the cap is cut and says so', () => {
  const line = lib.lineOf({ at: 1, event: 'command', command: 'x'.repeat(10_000) }, 1024);
  assert.ok(Buffer.byteLength(line) <= 1024);
  const o = JSON.parse(line);
  assert.equal(o.truncated, true);
  assert.ok(o.bytes > 10_000);
  assert.equal(o.at, 1);
});

// G-12 of 20261025-092319-srf-review-amended: a cut line dropped every object-valued field, so `writer` and `task`, which
// every line must carry, vanished from exactly the long lines, and the last-resort line dropped them too.
test('regression: a line over the cap keeps its writer and task', () => {
  const ctx = lib.lineContext({ now: 1, record: 'commands', session: 's', pid: 42, startedMs: 0, hookEvent: 'PreToolUse', depth: 1, run: 'r-1', node: 'code-audit' });
  for (const event of [
    { ...ctx, at: 1, event: 'command', command: 'x'.repeat(10_000), marks: ['fetch'] },
    { ...ctx, at: 1, event: 'command', a: 'x'.repeat(900), b: 'y'.repeat(900), c: 'z'.repeat(900), d: 'w'.repeat(900) },
  ]) {
    const line = lib.lineOf(event, 1024);
    assert.ok(Buffer.byteLength(line) <= 1024, `${Buffer.byteLength(line)} bytes`);
    const o = JSON.parse(line);
    assert.equal(o.truncated, true);
    assert.deepEqual(o.writer, ctx.writer);
    assert.deepEqual(o.task, ctx.task);
    assert.equal(o.session, 's');
  }
});

// G-11 of 20261025-095239-srf-remediation-2-review: the last resort kept `writer` and `task` cut only value by value, so a
// wide object kept every key and the line came back over the cap, unchecked.
test('regression: the last-resort line is never longer than the cap', () => {
  const wide = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, 'v'.repeat(60)]));
  for (const maxBytes of [256, 1024, 4096]) {
    const line = lib.lineOf({ at: 1, event: 'command', session: 's', writer: wide, task: wide, command: 'x'.repeat(10_000) }, maxBytes);
    assert.ok(Buffer.byteLength(line) <= maxBytes, `${Buffer.byteLength(line)} bytes over a ${maxBytes}-byte cap`);
    const o = JSON.parse(line);
    assert.equal(o.truncated, true);
    assert.equal(o.at, 1);
  }
});

test('regression: the retention age follows the operator\'s words, a string or 0 meaning no limit', () => {
  assert.equal(lib.retentionDays({}), 30);
  assert.equal(lib.retentionDays({ session_record_retention_days: 7 }), 7);
  assert.equal(lib.retentionDays({ session_record_retention_days: 0 }), null);
  assert.equal(lib.retentionDays({ session_record_retention_days: '' }), null);
  assert.equal(lib.retentionDays({ session_record_retention_days: 'none' }), null);
  assert.throws(() => lib.retentionDays({ session_record_retention_days: -1 }), /positive whole number/);
  assert.throws(() => lib.retentionDays({ session_record_retention_days: 1.5 }), /positive whole number/);
  assert.equal(lib.expired(0, 31 * 86_400_000, 30), true);
  assert.equal(lib.expired(0, 31 * 86_400_000, null), false);
  assert.equal(lib.nextRotation(['current.jsonl', '1.jsonl', '3.jsonl']), 4);
});

test('regression: two sessions write two folders, and an unsafe id writes a folder of its own', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 'a' }, { home });
  appendStopEvent(repo, { at: 2, event: 'start', session: 'b' }, { home });
  appendStopEvent(repo, { at: 3, event: 'start', session: '../escape' }, { home });
  assert.ok(fs.existsSync(sessionDir(repo, 'a', { home })));
  assert.ok(fs.existsSync(sessionDir(repo, 'b', { home })));
  assert.ok(fs.existsSync(sessionDir(repo, '../escape', { home })));
  assert.ok(!fs.existsSync(sessionDir(repo, 'unknown', { home })), 'an unsafe id wrote the shared unknown folder');
  assert.deepEqual(readStopEvents(repo, { home }).events.map((e) => e.at), [1, 2, 3]);
}));

test('regression: a first write removes folders past the retention age and keeps the rest', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 'old' }, { home });
  appendStopEvent(repo, { at: 2, event: 'start', session: 'recent' }, { home });
  const old = sessionDir(repo, 'old', { home });
  const past = new Date(Date.now() - 40 * 86_400_000);
  for (const n of fs.readdirSync(old)) fs.utimesSync(path.join(old, n), past, past);
  fs.utimesSync(old, past, past);
  appendStopEvent(repo, { at: 3, event: 'start', session: 'new' }, { home, retentionDays: 30, sweepIntervalMs: 0 });
  assert.ok(!fs.existsSync(old), 'the folder past 30 days is removed');
  assert.ok(fs.existsSync(sessionDir(repo, 'recent', { home })), 'a recent one is kept');
  assert.ok(fs.existsSync(sessionDir(repo, 'new', { home })), 'and the sweeping session\'s own, just made, is kept');
}));

// G-6 of 20261025-095239-srf-remediation-2-review: the sweep swallowed every stat and removal error, so a folder it could
// not remove outlived the retention age with nothing reported. A failure other than a folder already gone is recorded in
// the sweeping session's own record, where the summary reads it.
test('regression: a folder the sweep cannot remove is reported, not passed over in silence', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 'old' }, { home });
  const old = sessionDir(repo, 'old', { home });
  const past = new Date(Date.now() - 40 * 86_400_000);
  for (const n of fs.readdirSync(old)) fs.utimesSync(path.join(old, n), past, past);
  const removeDir = () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); };
  appendStopEvent(repo, { at: 2, event: 'start', session: 'new' }, { home, retentionDays: 30, sweepIntervalMs: 0, removeDir });
  const failed = readStopEvents(repo, { home }).events.filter((e) => e.event === 'retention-failed');
  assert.equal(failed.length, 1, 'the failed removal is recorded');
  assert.equal(failed[0].session, 'new');
  assert.deepEqual(failed[0].folders, [{ folder: 'old', code: 'EPERM' }]);
  // A folder another session removed first is not a failure.
  appendStopEvent(repo, { at: 3, event: 'start', session: 'newer' }, {
    home, retentionDays: 30, sweepIntervalMs: 0, removeDir: () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); },
  });
  assert.equal(readStopEvents(repo, { home }).events.filter((e) => e.event === 'retention-failed' && e.session === 'newer').length, 0);
}));

// G-9 of 20261025-104155-srf-remediation-3-review: a stat of the just-appended file that failed was swallowed, leaving the
// size at 0, so rotation was skipped on every append with nothing said. G-10: a session folder whose lstat failed was left
// out of every summary with no count. Both failures are said now. node:fs is patched for one path only.
function failingStat(name, match, fn) {
  const real = fs[name];
  fs[name] = function (p, ...rest) {
    if (match(String(p))) throw Object.assign(new Error(`EIO: ${name} failed`), { code: 'EIO' });
    return real.call(this, p, ...rest);
  };
  try { return fn(); } finally { fs[name] = real; }
}
// The platform the confined owner walks a record's levels with (contract-runtime-and-session-files.plan.md stage 3), with
// one call failing: its fs is frozen, so a copy is handed in rather than patched.
const platformFailing = (name, match) => {
  const base = hostPlatform();
  const real = base.fs[name];
  return { ...base, fs: { ...base.fs, [name](p, ...rest) {
    if (match(String(p))) throw Object.assign(new Error(`EIO: ${name} failed`), { code: 'EIO' });
    return real.call(base.fs, p, ...rest);
  } } };
};

test('regression: a failed stat of the current file is raised, not read as size 0', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home });
  assert.throws(
    // Through the owner's lstat since G-9 of 20261105-052942-crsf-delivery, so the owner's platform carries the failure.
    () => appendStopEvent(repo, { at: 2, event: 'start', session: 's' }, { home, platform: platformFailing('lstatSync', (p) => p.endsWith('current.jsonl')) }),
    /EIO/, 'the append says the file could not be sized, so rotation is never skipped in silence');
}));

test('regression: a session folder the summary cannot examine is named, not skipped', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 'good' }, { home });
  appendStopEvent(repo, { at: 2, event: 'start', session: 'bad' }, { home });
  const bad = sessionDir(repo, 'bad', { home });
  const r = readStopEvents(repo, { home, platform: platformFailing('lstatSync', (p) => p === bad) });
  assert.deepEqual(r.unreadableFolders, [{ folder: 'bad', code: 'EIO' }]);
  assert.deepEqual(r.events.map((e) => e.session), ['good']);
}));

// G-8 of 20261025-104155-srf-remediation-3-review: the retention-failed line was built from at, record and session only,
// so it lacked the datetime, writer, depth, hook and task every line of the record carries (lineContext).
test('regression: the retention-failed line carries the context every line carries', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 'old' }, { home });
  const old = sessionDir(repo, 'old', { home });
  const past = new Date(Date.now() - 40 * 86_400_000);
  for (const n of fs.readdirSync(old)) fs.utimesSync(path.join(old, n), past, past);
  const context = lib.lineContext({ now: 2, record: 'stops', session: 'new', pid: 7, startedMs: 1, hookEvent: 'Stop', request: 'r.md' });
  const removeDir = () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); };
  appendStopEvent(repo, { ...context, at: 2, event: 'start' }, { home, retentionDays: 30, sweepIntervalMs: 0, removeDir });
  const [line] = readStopEvents(repo, { home }).events.filter((e) => e.event === 'retention-failed');
  for (const k of Object.keys(context)) assert.deepEqual(line[k], context[k], `the retention-failed line keeps ${k}`);
  assert.equal(line.command, undefined, 'and none of the swept event\'s own fields');
}));

// G-4 of 20261025-095239-srf-remediation-2-review: every poll of a held lock asked the platform for the holder's start
// time, which launches PowerShell or ps, so a waiter spawned a process every 20 ms. One holder's start time is asked once.
test('regression: a waiter asks for a live holder\'s start time once, not on every poll', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home });
  fs.writeFileSync(path.join(sessionDir(repo, 's', { home }), '.lock'), lib.lockContent({ pid: process.pid, writtenAt: Date.now() }));
  let calls = 0;
  const platform = { ...hostPlatform(), proc: { isAlive: () => true, startedAt: () => { calls += 1; return 0; } } };
  assert.throws(() => appendStopEvent(repo, { at: 2, event: 'x', session: 's' }, { home, platform, lockWaitMs: 300 }), /held by a live writer/);
  assert.equal(calls, 1, `the start time was asked ${calls} times`);
}));

// G-7 of 20261025-095239-srf-remediation-2-review: readSessionTail parsed the whole newest file, up to the rotation size,
// before asking whether its last events were enough. Its tail is read first, and the whole file only when that is not.
test('regression: a session\'s tail is read from the end before the whole file', () => withRepo(({ home, repo }) => {
  for (let i = 0; i < 1500; i += 1) appendStopEvent(repo, { at: i, event: i % 2 ? 'end' : 'start', session: 's', pad: 'p'.repeat(80) }, { home });
  const seen = [];
  const events = readSessionTail(repo, 's', (ev) => { seen.push(ev.length); return ev.some((e) => e.at === 1499); }, { home });
  assert.ok(seen[0] < 1500, `the first check saw ${seen[0]} events, the whole file`);
  assert.equal(events.at(-1).at, 1499);
  // Not enough in the tail: the whole file is read, as before.
  const all = readSessionTail(repo, 's', (ev) => ev.some((e) => e.at === 0), { home });
  assert.equal(all.length, 1500);
  assert.equal(all[0].at, 0);
}));

// G-5 of 20261025-092319-srf-review-amended: the retention age counted the folder's own time, so a folder whose files
// were all past the age was kept as long as something touched the folder itself.
test('regression: the retention age is the newest file\'s, not the folder\'s own time', () => withRepo(({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 'old' }, { home });
  const old = sessionDir(repo, 'old', { home });
  const past = new Date(Date.now() - 40 * 86_400_000);
  for (const n of fs.readdirSync(old)) fs.utimesSync(path.join(old, n), past, past);
  fs.utimesSync(old, new Date(), new Date());
  appendStopEvent(repo, { at: 2, event: 'start', session: 'new' }, { home, retentionDays: 30, sweepIntervalMs: 0 });
  assert.ok(!fs.existsSync(old), 'every file is 40 days old, so the folder is removed');
}));

// Writers of one session at once (parallel tool calls): every line lands whole, and of two writers that both find a
// stale lock exactly one reclaims it at a time, so neither line is lost.
const WRITER = `
  const [owner, repo, home, n, tag] = process.argv.slice(1);
  const { appendStopEvent } = await import(new URL('file:///' + owner.replace(/\\\\/g, '/')).href);
  for (let i = 0; i < Number(n); i++) appendStopEvent(repo, { at: Date.now(), event: 'command', session: 's', tag, i }, { home });
`;
function writer(repo, home, n, tag) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', WRITER, OWNER, repo, home, String(n), tag], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, err }));
  });
}

test('regression: parallel writers of one session leave every line whole', () => withRepo(async ({ home, repo }) => {
  const results = await Promise.all([1, 2, 3, 4].map((k) => writer(repo, home, 15, `w${k}`)));
  for (const r of results) assert.equal(r.code, 0, r.err);
  const { events, unreadable } = readStopEvents(repo, { home });
  assert.equal(unreadable, 0, 'no line was torn');
  assert.equal(events.length, 60);
}));

test('regression: two writers that find a stale lock both get their line in', () => withRepo(async ({ home, repo }) => {
  appendStopEvent(repo, { at: 1, event: 'start', session: 's' }, { home });
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', windowsHide: true });
  fs.writeFileSync(path.join(sessionDir(repo, 's', { home }), '.lock'), JSON.stringify({ pid: Number(dead.stdout), writtenAt: 1 }));
  const results = await Promise.all([writer(repo, home, 1, 'x'), writer(repo, home, 1, 'y')]);
  for (const r of results) assert.equal(r.code, 0, r.err);
  assert.deepEqual(readStopEvents(repo, { home }).events.map((e) => e.tag).filter(Boolean).sort(), ['x', 'y']);
}));

test('regression: the platform says when this process started, and nothing for a process that is gone', () => {
  const p = hostPlatform().proc;
  assert.equal(typeof p.startedAt, 'function');
  const mine = p.startedAt(process.pid);
  // G-22 of 20261025-092319-srf-review-amended: null was accepted here, so the test could not fail when a platform gave
  // no start time for its own live process, which every lock check of a live owner relies on.
  assert.ok(Number.isFinite(mine), `startedAt of this process says ${mine}`);
  assert.ok(Math.abs(mine - (Date.now() - process.uptime() * 1000)) < 5000, `startedAt says ${mine}`);
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', windowsHide: true });
  assert.equal(p.startedAt(Number(dead.stdout)), null);
  assert.equal(p.startedAt(-1), null);
});

// Stage 2: the retention age is the contract's review.session_record_retention_days, read in process by the hooks
// (io/session-contract.mjs), and 0 keeps every folder.
test('regression: the hooks take the retention age from the contract', () => withRepo(({ home, repo }) => {
  const contract = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').replace(/session_record_retention_days: 30/, 'session_record_retention_days: 0');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), contract);
  const old = sessionDir(repo, 'old', { home });
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'current.jsonl'), '{"at":1,"event":"start","session":"old"}\n');
  const past = new Date(Date.now() - 400 * 86_400_000);
  fs.utimesSync(path.join(old, 'current.jsonl'), past, past);
  fs.utimesSync(old, past, past);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'command-log.mjs'), '--repo-root', repo], {
    input: JSON.stringify({ tool_name: 'Bash', session_id: 'new', tool_input: { command: 'git status' } }),
    encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home }, windowsHide: true,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(old), 'with 0, a folder 400 days old is kept');
}));

// Stage 3 (S-D4): what a line says. The operator: "include in the line the task/lens, datetime, and what the parallel
// writer "name"/"sub-task"/etc. And any info that can help identify issues."
test('regression: every line carries datetime, writer, depth, hook and task; a node\'s task is its run and node', () => withRepo(({ home, repo }) => {
  // The fixture declares its own request: the published contract names none (request: ""), so a copy of the tree's
  // CLAUDE.md held the public repository's suite to the private one's plan in flight (the stage 9c dry run of 7573fd44).
  const contract = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').replace(/^(\s*request:\s*)".*"/m, '$1".claude/requests/fixture.plan.md"');
  assert.match(contract, /request:\s*"\.claude\/requests\/fixture\.plan\.md"/, 'precondition: the fixture contract declares its request');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), contract);
  const run = (env) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'command-log.mjs'), '--repo-root', repo], {
    input: JSON.stringify({ tool_name: 'Bash', session_id: 's', hook_event_name: 'PreToolUse', tool_use_id: 'toolu_1', tool_input: { command: 'git status' } }),
    encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home, ...env }, windowsHide: true,
  });
  const clean = { ...process.env }; delete clean.GRAPH_NODE_DEPTH; delete clean.QUORATE_RUN_ID; delete clean.QUORATE_NODE_ID;
  assert.equal(spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'command-log.mjs'), '--repo-root', repo], {
    input: JSON.stringify({ tool_name: 'Bash', session_id: 's', hook_event_name: 'PreToolUse', tool_use_id: 'toolu_0', tool_input: { command: 'ls' } }),
    encoding: 'utf8', env: { ...clean, QUORATE_HOME: home }, windowsHide: true,
  }).status, 0);
  assert.equal(run({ GRAPH_NODE_DEPTH: '1', QUORATE_RUN_ID: 'r-1', QUORATE_NODE_ID: 'code-audit' }).status, 0);
  const [session, node] = readStopEvents(repo, { home, log: 'commands' }).events;
  for (const e of [session, node]) {
    assert.match(e.iso, /^\d{4}-\d\d-\d\dT/);
    assert.equal(e.record, 'commands');
    assert.equal(e.hook, 'PreToolUse');
    assert.ok(Number.isInteger(e.writer.pid));
  }
  assert.equal(session.depth, 0);
  assert.match(session.task.request, /\.plan\.md$|\.md$/, 'the working session\'s task is the plan in flight');
  assert.equal(session.toolUseId, 'toolu_0');
  assert.deepEqual([node.depth, node.task], [1, { run: 'r-1', node: 'code-audit' }]);
}));

// G-23 of 20261025-092319-srf-review-amended: this matched the two assignments in the spawners' source, and passed if
// later code dropped or overwrote them before the child ran. Now the child itself says what it was given.
function envSpy(dir) {
  const seen = path.join(dir, 'seen.json');
  const bin = path.join(dir, 'fake-claude.mjs');
  fs.writeFileSync(bin, [
    "import fs from 'node:fs';",
    `fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ node: process.env.QUORATE_NODE_ID ?? null, run: process.env.QUORATE_RUN_ID ?? null, depth: process.env.GRAPH_NODE_DEPTH ?? null }));`,
    "process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '{}' }));",
  ].join('\n'));
  return { bin, seen: () => JSON.parse(fs.readFileSync(seen, 'utf8')) };
}

test('regression: both spawners deliver the child\'s task beside its depth', async () => {
  const { repoRunDir, sessionHookEnv, runScript } = await import('./helpers.mjs');
  const base = sessionHookEnv();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srec-spawn-'));
  const { dir } = repoRunDir({ prefix: 'quorate-srec-', json: { run_id: '20260101-000000-test', contract: { source_globs: ['scripts/**'] }, stamps: [] } });
  try {
    const sub = envSpy(path.join(tmp));
    fs.mkdirSync(path.join(tmp, 'check-1'));
    fs.writeFileSync(path.join(tmp, 'prompt.md'), 'p');
    const s = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'spawn-subagent.mjs'), '--prompt-file', path.join(tmp, 'prompt.md'),
      '--out', path.join(tmp, 'check-1', 'e.json'), '--repo-root', ROOT, '--runtime-bin', sub.bin], { cwd: ROOT, encoding: 'utf8', env: base, windowsHide: true });
    assert.equal(s.status, 0, s.stderr);
    assert.deepEqual([sub.seen().node, sub.seen().depth], ['subagent:check-1', '1']);

    const nodeDir = path.join(tmp, 'n');
    fs.mkdirSync(nodeDir);
    const spy = envSpy(nodeDir);
    // Through runScript: it sets the test engine home that repoRunDir staged the run under.
    // The intent node: the one mode that needs no roster-resolved arguments, and its task is named the same way.
    fs.mkdirSync(path.join(dir, 'sandbox', 'intent-capture'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'intent-settings.json'), JSON.stringify({ permissions: { deny: ['Grep'] } }));
    const n = runScript('spawn-node.mjs', ['--run-dir', dir, '--repo-root', ROOT,
      '--node-id', 'intent-capture', '--mode', 'intent', '--prompt', 'x', '--timeout-minutes', '1',
      '--settings', path.join(dir, 'intent-settings.json'), '--add-dir', path.join(dir, 'sandbox', 'intent-capture'),
      '--runtime-bin', spy.bin]);
    assert.ok(fs.existsSync(path.join(nodeDir, 'seen.json')), `spawn-node ran no child: ${n.output.slice(-600)}`);
    assert.deepEqual(spy.seen(), { node: 'intent-capture', run: '20260101-000000-test', depth: '1' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
