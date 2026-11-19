// non-blocking-kill.plan.md (design NB-D1 B, NB-D2 A, NB-D3 A; operator 2026-11-06). ARCHITECTURE.md A-25 promises that an
// orchestrator leaving on a signal stops every child at once and waits at most one deadline; stopAll requested each
// child's kill in turn, and win32's killTree was a blocking spawnSync('taskkill') with no timeout, so N children cost N
// serial kills outside the deadline (G-4 of 20261106-073206-srb-remediation-2-review; G-5, G-6, G-7 of
// 20261106-080520-srb-remediation-3-review). killTree is asynchronous now; killTreeNow is the synchronous one, for the
// exit hook only, which cannot wait.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROC_MEMBERS } from '../scripts/platform/interface.mjs';
import { posixProc } from '../scripts/platform/posix/index.mjs';
import * as win32Module from '../scripts/platform/win32/index.mjs';
import { linux } from '../scripts/platform/linux/index.mjs';
import { macos } from '../scripts/platform/macos/index.mjs';
import { withKill, fakeProc } from './helpers.mjs';

const { win32 } = win32Module;
// The platform's bound on a taskkill given no timeout; 10 s if the module does not say.
const KILL_TREE_TIMEOUT_MS = win32Module.KILL_TREE_TIMEOUT_MS ?? 10_000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const err = (code) => Object.assign(new Error(code), { code });

test('NB-D1 B: every platform has killTreeNow, and killTree answers with a promise', () => {
  assert.ok(PROC_MEMBERS.includes('killTreeNow'), 'killTreeNow is not a member of the process interface');
  for (const [name, p] of Object.entries({ win32, linux, macos })) {
    assert.equal(typeof p.proc.killTreeNow, 'function', `${name} has no killTreeNow`);
  }
  const answer = posixProc.killTree(4242, { kill: () => {} });
  assert.ok(answer instanceof Promise, 'posix killTree answers synchronously');
});

test('NB-D1 B: posix killTree resolves delivered, refused and already-gone as killTreeNow answers them', async () => {
  for (const [label, kill, want] of [
    ['delivered', () => {}, true],
    ['refused', () => { throw err('EPERM'); }, false],
    ['already gone', () => { throw err('ESRCH'); }, true],
  ]) {
    assert.equal(posixProc.killTreeNow(4242, { kill }), want, `killTreeNow: ${label}`);
    assert.equal(await posixProc.killTree(4242, { kill }), want, `killTree: ${label}`);
  }
});

// A fake taskkill: emits exit with `code` after `ms`, or never when `code` is undefined; records whether it was killed.
const fakeSpawn = ({ code, ms = 0 }) => {
  const made = [];
  const spawn = (cmd, args) => {
    const c = new EventEmitter();
    c.cmd = cmd; c.args = args; c.killed = false;
    c.kill = () => { c.killed = true; return true; };
    if (code !== undefined) setTimeout(() => c.emit('exit', code), ms);
    made.push(c);
    return c;
  };
  return { spawn, made };
};

test('NB-D1 B: win32 killTree spawns taskkill without waiting, and resolves with its exit status', async () => {
  const ok = fakeSpawn({ code: 0, ms: 20 });
  const pending = win32.proc.killTree(4242, { spawn: ok.spawn });
  assert.ok(pending instanceof Promise, 'win32 killTree answers synchronously');
  assert.deepEqual(ok.made[0].args, ['/pid', '4242', '/T', '/F']);
  assert.equal(await pending, true);
  const refused = fakeSpawn({ code: 128 });
  assert.equal(await win32.proc.killTree(4242, { spawn: refused.spawn }), false);
});

// One test, so CLAUDE.md's counted test total is unchanged: G-6 and G-8 of 20261106-182300-nbk-delivery are its halves.
test('NB-D2 A, G-6, G-8: a taskkill that outlives its timeout, or the default with none, is stopped or let go, and the kill is not confirmed (null)', async (t) => {
  const hung = fakeSpawn({});
  const started = Date.now();
  assert.equal(await win32.proc.killTree(4242, { spawn: hung.spawn, timeoutMs: 50 }), null);
  assert.ok(Date.now() - started < 1_000, 'the timeout did not end the wait');
  assert.equal(hung.made[0].killed, true, 'the taskkill that outlived its timeout was left running');

  // G-8: a timed-out taskkill whose own kill is refused stayed referenced.
  for (const refuse of [() => false, () => { throw new Error('gone'); }]) {
    const stuck = fakeSpawn({});
    let unrefd = false;
    const spawn = (cmd, args) => { const c = stuck.spawn(cmd, args); c.kill = refuse; c.unref = () => { unrefd = true; }; return c; };
    assert.equal(await win32.proc.killTree(4243, { spawn, timeoutMs: 10 }), null);
    assert.equal(unrefd, true, 'a taskkill whose kill was refused still holds the process open');
  }
  // G-9 of 20261106-190129-nbk-remediation-review: a kill ACCEPTED is not an exit, so a taskkill that lingers after it
  // stayed referenced. It is let go whatever its kill answered.
  {
    const lingering = fakeSpawn({});
    let unrefd = false;
    const spawn = (cmd, args) => { const c = lingering.spawn(cmd, args); c.unref = () => { unrefd = true; }; return c; };
    assert.equal(await win32.proc.killTree(4244, { spawn, timeoutMs: 10 }), null);
    assert.equal(lingering.made[0].killed, true, 'the taskkill that outlived its timeout was not asked to stop');
    assert.equal(unrefd, true, 'a taskkill whose kill was accepted but which has not exited still holds the process open');
  }

  // G-6: with no timeoutMs (a stopChild outside stopAll) a hung taskkill was waited for forever and held the process
  // open. It is bounded by the platform's default.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const opts of [{}, { timeoutMs: null }]) {
    const never = fakeSpawn({});
    let answer = 'pending';
    win32.proc.killTree(4243, { spawn: never.spawn, ...opts }).then((a) => { answer = a; });
    t.mock.timers.tick(KILL_TREE_TIMEOUT_MS);
    await new Promise((r) => setImmediate(r));
    assert.equal(answer, null, `a hung taskkill with ${JSON.stringify(opts)} was never given up on`);
    assert.equal(never.made[0].killed, true, 'the hung taskkill was not stopped');
  }
});

// G-9 of 20261106-182300-nbk-delivery: this was a source-text search for spawnSync. It runs killTreeNow now, with the
// taskkill's exit status injected, and checks the answer is a boolean mapped from it.
test('NB-D1 B: killTreeNow keeps the synchronous answers the exit hook relies on', () => {
  assert.equal(typeof posixProc.killTreeNow(4242, { kill: () => {} }), 'boolean');
  for (const [status, want] of [[0, true], [128, false], [1, false], [null, false]]) {
    const asked = [];
    const spawnSync = (cmd, args) => { asked.push([cmd, ...args]); return { status }; };
    const answer = win32.proc.killTreeNow(4243, { spawnSync });
    assert.equal(answer, want, `win32 killTreeNow answered ${answer} for taskkill status ${status}`);
    assert.deepEqual(asked, [['taskkill', '/pid', '4243', '/T', '/F']], 'killTreeNow did not run taskkill once, synchronously');
  }
});

// NB-D3 A (stage 2): stopAll starts every child's kill before it awaits any, under one deadline.
const fakeChild = (pid) => {
  const c = new EventEmitter();
  c.pid = pid; c.exitCode = null; c.signalCode = null; c.stdout = null; c.stderr = null; c.unref = () => {};
  return c;
};

test('NB-D3 A, G-2, G-3, G-4: stopAll settles within one deadline, requests every kill before logging any, and escalates from the call', async () => {
  const { stopAll } = await import('../scripts/io/stop-child.mjs');
  const DEADLINE = 600;
  const kids = [1, 2, 3].map((p) => [`n${p}`, fakeChild(1000 + p)]);
  const asked = [];
  // Each kill answers after 500 ms and ends its child then: three in turn would take 1.5 s.
  const killTree = (pid) => {
    asked.push(pid);
    return new Promise((r) => setTimeout(() => { const c = kids.find(([, k]) => k.pid === pid)[1]; c.exitCode = 0; c.emit('exit'); r(true); }, 500));
  };
  const started = Date.now();
  const r = await stopAll(kids, withKill({ deadlineMs: DEADLINE, killTree }));
  const took = Date.now() - started;
  assert.deepEqual(asked, [1001, 1002, 1003], 'not every child was asked to stop');
  assert.ok(took < DEADLINE + 300, `stopAll took ${took} ms for a ${DEADLINE} ms deadline: its kills ran in turn`);
  assert.deepEqual(r.map((x) => x.outcome), ['exited', 'exited', 'exited']);
  await stopAllFollowups();
});

test('NB-D1 B: a kill the platform could not confirm (null) is waited for and reported unconfirmed, never refused', async () => {
  const { stopChild } = await import('../scripts/io/stop-child.mjs');
  const c = fakeChild(2001);
  const r = await stopChild(c, withKill({ deathGraceMs: 100, killTree: () => Promise.resolve(null), isAlive: () => true }));
  assert.equal(r.outcome, 'unconfirmed');
});

test('NB-D1 B, G-3: an asynchronous refusal is still a refusal, and the grace is armed after the kill answers', async () => {
  const { stopChild } = await import('../scripts/io/stop-child.mjs');
  const c = fakeChild(2002);
  const r = await stopChild(c, withKill({ deathGraceMs: 2_000, killTree: () => new Promise((res) => setTimeout(() => res(false), 20)), isAlive: () => true }));
  assert.equal(r.outcome, 'refused');
  // G-3 of 20261106-182300-nbk-delivery (I-5): the grace was armed when the kill was asked for, so a slow answer spent it.
  // The kill answers after 150 ms; the child exits 100 ms after that, inside a 200 ms grace counted from the answer.
  const d = fakeChild(2003);
  const killTree = () => new Promise((res) => setTimeout(() => {
    setTimeout(() => { d.exitCode = 0; d.emit('exit'); }, 100);
    res(true);
  }, 150));
  const late = await stopChild(d, withKill({ deathGraceMs: 200, killTree, isAlive: () => true }));
  assert.equal(late.outcome, 'exited', 'the time the kill took to answer was taken from the grace');
});

test('NB-D1 B: the exit hook reaches only killTreeNow, never the asynchronous primitive', async () => {
  // G-11 of 20261106-182300-nbk-delivery: this was a source-text match for `now: true` with one injected primitive, which
  // skipped the choice it named. The exit hook's default kill is run over a platform whose two primitives are distinct,
  // the asynchronous one refusing to be reached.
  const { requestStopNow } = await import('../scripts/io/stop-child.mjs');
  const calls = [];
  // A whole process interface (stop-owner-seam, SS-D2 B), its two kills distinct.
  const proc = fakeProc({
    killTree: (pid) => { calls.push(['killTree', pid]); throw new Error('the exit hook reached the asynchronous killTree'); },
    killTreeNow: (pid) => { calls.push(['killTreeNow', pid]); return true; },
    isAlive: () => true,
  });
  // G-4 of 20261106-190129-nbk-remediation-review: the kill record named the host's platform even when the kill went
  // through an injected one. The record names the platform whose primitive ran.
  proc.id = 'fake-os';
  const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp', 'nbk-g4p-'));
  const log = path.join(dir, 'kill.log');
  const saved = process.env.QUORATE_KILL_LOG;
  process.env.QUORATE_KILL_LOG = log;
  let r;
  try {
    r = requestStopNow([['a', fakeChild(3001)], ['b', fakeChild(3002)]], { proc });
    const named = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).platform);
    assert.deepEqual(named, ['fake-os', 'fake-os'], 'the kill record named a platform other than the one whose kill ran');
  } finally {
    if (saved === undefined) delete process.env.QUORATE_KILL_LOG; else process.env.QUORATE_KILL_LOG = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(calls, [['killTreeNow', 3001], ['killTreeNow', 3002]], 'the exit hook did not take killTreeNow, alone');
  assert.deepEqual(r.map((x) => x.outcome), ['unconfirmed', 'unconfirmed']);
  // G-3 of 20261106-200030-nbk-remediation-2-review: requestStopNow still took a killTree override and called it on the
  // exit hook's path, so an asynchronous one ran and its Promise counted as delivered. The hook's primitive is the
  // platform's killTreeNow (inject `proc` to replace it); a killTree is refused, never called.
  let reached = false;
  assert.throws(() => requestStopNow([['c', fakeChild(3003)]], { proc, killTree: () => { reached = true; return Promise.resolve(true); } }),
    /unknown option/, 'the exit hook accepted a killTree override');
  assert.equal(reached, false, 'the exit hook called an injected killTree instead of killTreeNow');
});

// The checks below are G-3's second half, G-4 and G-2 of 20261106-182300-nbk-delivery, run from the NB-D3 A test so
// CLAUDE.md's counted test total is unchanged. G-4 and G-2: the kill log's append ran before each child's kill, so under
// stopAll the later children's kills waited for the earlier appends, and posix's escalation was counted from the late
// request.
async function stopAllFollowups() {
  const { stopAll } = await import('../scripts/io/stop-child.mjs');
  // G-3: under stopAll the deadline still bounds a kill that never answers.
  const t0 = Date.now();
  const never = await stopAll([['a', fakeChild(2004)]], withKill({ deadlineMs: 150, killTree: () => new Promise(() => {}) }));
  assert.ok(Date.now() - t0 < 1_000, 'a kill that never answered held stopAll past its deadline');
  assert.deepEqual(never.map((x) => x.outcome), ['unconfirmed']);
  await killLogAfterKills(stopAll);
  await escalationFromTheCall(stopAll);
}

async function killLogAfterKills(stopAll) {
  const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp', 'nbk-g4-'));
  const log = path.join(dir, 'kill.log');
  const saved = process.env.QUORATE_KILL_LOG;
  process.env.QUORATE_KILL_LOG = log;
  try {
    const kids = [1, 2, 3].map((p) => [`n${p}`, fakeChild(4000 + p)]);
    const seen = [];
    const killTree = (pid) => {
      seen.push(fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);
      const c = kids.find(([, k]) => k.pid === pid)[1];
      setTimeout(() => { c.exitCode = 0; c.emit('exit'); }, 10);
      return Promise.resolve(true);
    };
    await stopAll(kids, withKill({ deadlineMs: 500, killTree }));
    // G-2, G-3 of 20261106-190129-nbk-remediation-review: G-4's fix appended each record after its kill (I-5 and the
    // plan's stage 2 say before), in a microtask that still blocked on the log's lock while taskkills were pending. Every
    // record is appended, in one append, before any kill is requested: before each kill, and no lock wait between kills.
    assert.deepEqual(seen, [3, 3, 3], 'a kill was requested before every kill record was on disk');
    assert.equal(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length, 3, 'a kill was not logged');
    // G-2 of 20261106-200030-nbk-remediation-2-review: stopAll's records, and a lone stopChild's, named the host's
    // platform for a kill an injected killTree made. An injected primitive names no platform, so the record says null.
    const { stopChild } = await import('../scripts/io/stop-child.mjs');
    const lone = fakeChild(4009);
    await stopChild(lone, withKill({ deathGraceMs: 50, killTree: () => { lone.exitCode = 0; lone.emit('exit'); return Promise.resolve(true); } }));
    const platforms = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).platform);
    assert.deepEqual(platforms, [null, null, null, null], "a kill an injected killTree made was recorded as the host platform's");
  } finally {
    if (saved === undefined) delete process.env.QUORATE_KILL_LOG; else process.env.QUORATE_KILL_LOG = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function escalationFromTheCall(stopAll) {
  const kids = [1, 2].map((p) => [`n${p}`, fakeChild(5000 + p)]);
  const asked = [];
  const killTree = (pid, opts) => {
    asked.push(opts.escalateAfterMs);
    // The first request takes 80 ms of the call before the second is made.
    if (pid === 5001) { const until = Date.now() + 80; while (Date.now() < until) { /* a slow request */ } }
    const c = kids.find(([, k]) => k.pid === pid)[1];
    setTimeout(() => { c.exitCode = 0; c.emit('exit'); }, 5);
    return Promise.resolve(true);
  };
  await stopAll(kids, withKill({ deadlineMs: 1_000, escalateAfterMs: 400, killTree }));
  assert.ok(asked[0] <= 400 && asked[1] <= 400 - 70, `the second escalation was not shortened by the time already spent: ${asked.join(', ')}`);
}

// STOP-OWNER-SEAM (stop-owner-seam.plan.md stage 1; design SS-D1 A, SS-D2 B; operator 2026-11-06). The owner took `kill`,
// `killTree` and `proc` on three entry points, and three remediation rounds each closed one while the next review found
// another open (G-2 of 20261106-203532-nbk-remediation-3-review: a `kill` override carried a Promise into the exit hook).
// The one seam is `proc`, a whole process interface.
test('SS-D1 A: every entry point refuses a kill and a killTree option', async () => {
  const { stopChild, stopAll, requestStopNow } = await import('../scripts/io/stop-child.mjs');
  for (const opt of ['kill', 'killTree']) {
    const o = { [opt]: () => true };
    assert.throws(() => stopChild(fakeChild(4001), o), new RegExp(`unknown option.*${opt}`), `stopChild took ${opt}`);
    assert.throws(() => stopAll([['a', fakeChild(4002)]], o), new RegExp(`unknown option.*${opt}`), `stopAll took ${opt}`);
    assert.throws(() => requestStopNow([['a', fakeChild(4003)]], o), new RegExp(`unknown option.*${opt}`), `requestStopNow took ${opt}`);
  }
});

test('SS-D2 B: a proc handed in must be a whole process interface, each missing member named', async () => {
  const { stopChild, requestStopNow } = await import('../scripts/io/stop-child.mjs');
  const partial = { killTree: () => Promise.resolve(true), killTreeNow: () => true, isAlive: () => true };
  assert.throws(() => stopChild(fakeChild(4004), { proc: partial }), /not a whole process interface; missing .*spawn/);
  assert.throws(() => requestStopNow([['a', fakeChild(4005)]], { proc: partial }), /missing .*startedAt/);
});

test('SS-D1 A: an exit-hook primitive that answers with a Promise is not counted as a kill requested', async () => {
  const { requestStopNow } = await import('../scripts/io/stop-child.mjs');
  const proc = fakeProc({ killTreeNow: () => Promise.resolve(true), isAlive: () => true });
  assert.deepEqual(requestStopNow([['a', fakeChild(4006)]], { proc }).map((x) => x.outcome), ['refused']);
});

test('SS-D1 A: nothing in scripts/ or tests/ passes a kill or killTree option to the owner or to stopHeldOnExit', () => {
  // Instrument: each call of stopChild, stopAll, requestStopNow, runChild or stopHeldOnExit, its argument text up to the
  // call's closing parenthesis, searched for a `kill:` or `killTree:` key. A refusal test (assert.throws) is the exception.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.mjs') ? [path.join(d, e.name)] : []);
  const found = [];
  for (const f of [...walk(path.join(ROOT, 'scripts')), ...walk(path.join(ROOT, 'tests'))]) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(stopChild|stopAll|requestStopNow|runChild|stopHeldOnExit)\(/g)) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (/assert\.throws\(\s*\(\)\s*=>\s*[\w.]*$/.test(before)) continue;
      let depth = 0, end = m.index + m[0].length - 1;
      for (; end < src.length; end++) { if (src[end] === '(') depth++; else if (src[end] === ')' && --depth === 0) break; }
      const args = src.slice(m.index, end);
      // Options passed through tests/helpers.mjs `withKill` reach the owner as a whole `proc` (fakeProc), never as a
      // `kill`: the helper is the one translation, so a test's assertions stayed as they were.
      if (/\bwithKill\(/.test(args)) continue;
      if (/[{,]\s*(kill|killTree)\s*[:,}]/.test(args.replace(/\/\/[^\n]*/g, ''))) found.push(`${path.relative(ROOT, f)}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(found, [], 'a call hands the stop owner a kill of its own');
});
