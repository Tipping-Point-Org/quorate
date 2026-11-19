// G-9, G-6 and G-5 of run 20260925-015614-platform-review: three ways a write lost or corrupted data.
//
// G-9 (panel-codex-code): the intent cache was truncated and rewritten in place, so a run reading it
// while another wrote could parse half an entry — derived criteria, the thing every lens is judged
// against. It goes through the atomic writer every other artifact already uses.
//
// G-6 (panel-codex-security): appendTextAtomic treated EVERY read failure as "the file does not exist
// yet", so an existing file that merely could not be read at that moment was replaced by the new
// text alone. Only ENOENT means absent; anything else is thrown.
//
// G-5 (panel-codex-code): the ledger was loaded, merged and saved with nothing in between to stop a
// second fold doing the same, so the later save silently dropped the other run's findings. The
// read-modify-write takes a lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as atomic from '../scripts/io/atomic.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-integrity-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('G-6: an existing file that cannot be read is not overwritten by an append', (t) => {
  const p = path.join(tmp(t), 'report.md');
  fs.writeFileSync(p, 'earlier findings\n');
  const denied = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
  assert.throws(() => atomic.appendTextAtomic(p, 'new line\n', { read: denied }), /EACCES/);
  assert.equal(fs.readFileSync(p, 'utf8'), 'earlier findings\n', 'the earlier content survives');
  // ENOENT is the one error that really means "first write".
  const q = path.join(path.dirname(p), 'fresh.md');
  atomic.appendTextAtomic(q, 'first\n');
  assert.equal(fs.readFileSync(q, 'utf8'), 'first\n');
});

test('G-9: the intent cache is written atomically', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'io', 'intent-cache.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('export function writeIntentCache'), src.indexOf('\n}\n', src.indexOf('export function writeIntentCache')));
  assert.match(fn, /writeJsonAtomic\(/, 'through the atomic writer');
  assert.doesNotMatch(fn, /fs\.writeFileSync\(/, 'never truncate-and-rewrite in place');
});

test('G-5: a held lock makes the next writer wait, a stale one is reclaimed, and release frees it', (t) => {
  const lock = path.join(tmp(t), 'ledger.json.lock');
  const release = atomic.acquireFileLock(lock);
  assert.ok(fs.existsSync(lock), 'the lock is a file while held');
  assert.throws(() => atomic.acquireFileLock(lock, { timeoutMs: 150, sleep: () => {} }), /held/,
    'a second writer does not proceed while the first holds it');
  release();
  assert.ok(!fs.existsSync(lock), 'release removes it');
  const again = atomic.acquireFileLock(lock);
  again();
  // A lock left by a process that died is reclaimed once it is older than staleMs.
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lock, old, old);
  const reclaimed = atomic.acquireFileLock(lock, { staleMs: 1000 });
  reclaimed();
});

test('G-5: every ledger write path takes the lock before it loads', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'findings-ledger.mjs'), 'utf8');
  const writes = [...src.matchAll(/saveLedger\((?!ledger\) \{)/g)].length;
  const locks = [...src.matchAll(/lockLedger\(\)/g)].length;
  assert.ok(writes >= 3, 'three write paths: observe, mark-fixed, fold');
  assert.ok(locks >= writes, `each write path locks first (${locks} locks for ${writes} saves)`);
});

// A REGRESSION FROM THE G-5 LOCK, found while demonstrating G-4: the lock file was created before its
// directory existed, so a repository's FIRST ledger fold — no .claude/reviews/ yet — crashed with
// ENOENT where the unlocked save had always created the directory itself.
test('G-5 follow-up: the lock creates its directory, so a first-ever fold does not crash', (t) => {
  const lock = path.join(tmp(t), 'never', 'made', 'ledger.json.lock');
  const release = atomic.acquireFileLock(lock);
  assert.ok(fs.existsSync(lock));
  release();
});

// G-6 of run 20260925-200721-platform-remediated (code-audit): the stale-lock reclaim was
// check-then-remove. Two waiters could both judge the same old lock stale; A removed it and created a
// fresh one, then B — acting on its earlier judgement — removed A's FRESH lock and took it too. The
// `beforeReclaim` hook puts the other process's move exactly in that gap.
test('G-6: a waiter acting on a stale judgement never deletes a lock another waiter just took', (t) => {
  const lock = path.join(tmp(t), 'ledger.json.lock');
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lock, old, old);
  assert.throws(() => atomic.acquireFileLock(lock, {
    staleMs: 1000, timeoutMs: 100, sleep: () => {},
    // Another waiter reclaims first and holds a FRESH lock by the time this one acts.
    beforeReclaim: () => { fs.rmSync(lock, { force: true }); fs.writeFileSync(lock, 'A'); },
  }), /held/, 'the fresh lock is respected: this waiter waits, it does not delete');
  assert.equal(fs.readFileSync(lock, 'utf8'), 'A', 'the other waiter still holds its lock');
});

// G-6's second half: the lock's age was the only evidence of abandonment, and a held lock is never
// touched, so a holder still working past staleMs had its lock reclaimed from under it. The lock now
// names its holder, and age decides only for a holder that is gone or unnamed.
test('G-6: a lock whose holder is still alive is never reclaimed for age alone', (t) => {
  const lock = path.join(tmp(t), 'ledger.json.lock');
  fs.writeFileSync(lock, String(process.pid));          // a live holder: this very process
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lock, old, old);
  assert.throws(() => atomic.acquireFileLock(lock, { staleMs: 1000, timeoutMs: 100, sleep: () => {} }), /held/);
  assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid), 'the live holder keeps its lock');
  // A holder that has exited is abandoned, and its lock is reclaimed as before.
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
  fs.writeFileSync(lock, dead);
  fs.utimesSync(lock, old, old);
  atomic.acquireFileLock(lock, { staleMs: 1000, timeoutMs: 100, sleep: () => {} })();
});

// G-4 of run 20260926-002850-m0-close (panel-codex-code, panel-codex-security): `abandoned()` returned
// null — "the lock vanished, retry now" — for ANY stat or read failure, and that branch retried before
// sleeping or checking timeoutMs. A lock that exists but cannot be read spun one core forever instead
// of timing out with the documented error. Reproduced without special permissions: a lock path that is
// a DIRECTORY exists (so `wx` fails) and reads as EISDIR on every pass. Run in a child, because with
// the defect the call never returns.
test('G-4: a lock that exists but cannot be read times out with the lock error, it does not spin', (t) => {
  const d = tmp(t);
  const lock = path.join(d, 'ledger.json.lock');
  fs.mkdirSync(lock);
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lock, old, old);
  const atomicUrl = new URL('../scripts/io/atomic.mjs', import.meta.url).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const a = await import(${JSON.stringify(atomicUrl)});
     try { a.acquireFileLock(${JSON.stringify(lock)}, { staleMs: 1000, timeoutMs: 300 }); console.log('ACQUIRED'); }
     catch (e) { console.log('THREW ' + e.message); }`],
  // 120 s, not 15 (ledger data-integrity:120): the limit tells a SPIN (never returns) from a return, so it
  // needs headroom for a child that is merely slow to start under full-suite load. 15 s was not: the
  // test took 15.0 s in the suite and 0.4 s alone, and a slow start read as a spin. A real spin still
  // never returns, so it still fails, only later.
  { encoding: 'utf8', timeout: 120_000 });
  assert.notEqual(r.error?.code, 'ETIMEDOUT', 'the call spun instead of returning');
  assert.match(r.stdout, /THREW .*held/, `it times out with the lock error: ${r.stdout}${r.stderr}`);
});

// G-9 of run 20261029-190658-rdr-delivery (panel-codex-code): the same spin, one call down. A `.reclaim` marker that
// exists but cannot be removed returned from reclaimIfStillStale, and the caller retried at once without sleeping or
// checking timeoutMs. Reproduced as G-4 was: the marker is a DIRECTORY, so `wx` fails and its removal fails every pass.
test('G-9: a reclaim marker that cannot be removed times out with the lock error, it does not spin', (t) => {
  const d = tmp(t);
  const lock = path.join(d, 'ledger.json.lock');
  fs.writeFileSync(lock, '');
  fs.mkdirSync(`${lock}.reclaim`);
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lock, old, old);
  fs.utimesSync(`${lock}.reclaim`, old, old);
  const atomicUrl = new URL('../scripts/io/atomic.mjs', import.meta.url).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const a = await import(${JSON.stringify(atomicUrl)});
     try { a.acquireFileLock(${JSON.stringify(lock)}, { staleMs: 1000, timeoutMs: 300 }); console.log('ACQUIRED'); }
     catch (e) { console.log('THREW ' + e.message); }`],
  // 20 s: the spin never returns, and a call that returns does so in well under a second.
  { encoding: 'utf8', timeout: 20_000 });
  assert.notEqual(r.error?.code, 'ETIMEDOUT', 'the call spun instead of returning');
  assert.match(r.stdout, /THREW .*held/, `it times out with the lock error: ${r.stdout}${r.stderr}`);
});
