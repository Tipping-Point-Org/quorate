// THE RUN STATE'S LOCK IS THE ENGINE'S FILE LOCK (contract-runtime-and-session-files.plan.md stage 2; design CR-D4 A,
// operator 2026-11-05). io/run-state.mjs had its own bind lock, judged stale by its age alone (BIND_LOCK_STALE_MS, 30 s),
// never by whether its holder still ran (G-4 of 20261105-031048-ar-d1-c-remediation-3-review): a binder paused past 30 s
// lost its lock to a stop, and the stopped run came back. Bind and clear now take acquireFileLock (io/atomic.mjs), which
// reclaims a lock only when its holder's pid is gone AND it is older than staleMs, the rule the ledger and the decision
// panel already use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { newRunState } from '../scripts/lib/run-state.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const state = () => newRunState({ plan: '.claude/requests/a.plan.md', startedAt: Date.now(), limitHours: 72 });
const age = (p, ms) => { const t = new Date(Date.now() - ms); fs.utimesSync(p, t, t); };
// A pid that has exited: a child run to completion.
const deadPid = () => spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' }).pid;

test('a lock held by a live process is not reclaimed, however old: a stop is refused and the state stays', async () => {
  const { clearRunState, writeRunState, runStatePath } = await import('../scripts/io/run-state.mjs');
  const home = tmp('rsl-home-'); const repo = tmp('rsl-repo-');
  try {
    writeRunState(repo, state(), { home });
    const p = runStatePath(repo, { home });
    fs.writeFileSync(`${p}.bind`, String(process.pid));   // this test's own process: alive
    age(`${p}.bind`, 60 * 60 * 1000);                      // an hour old: past every age rule
    assert.throws(() => clearRunState(repo, { home, lockTimeoutMs: 300 }), /bind/, 'a live holder\'s lock was taken by its age');
    assert.ok(fs.existsSync(p), 'the state was removed under a live holder\'s lock');
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); }
});

test('a lock left by a dead holder is reclaimed once it is past staleMs: the stop goes on', async () => {
  const { clearRunState, writeRunState, runStatePath } = await import('../scripts/io/run-state.mjs');
  const home = tmp('rsl-home-'); const repo = tmp('rsl-repo-');
  try {
    writeRunState(repo, state(), { home });
    const p = runStatePath(repo, { home });
    fs.writeFileSync(`${p}.bind`, String(deadPid()));
    age(`${p}.bind`, 10 * 60 * 1000);
    clearRunState(repo, { home, lockTimeoutMs: 2000 });
    assert.ok(!fs.existsSync(p), 'a dead holder\'s stale lock kept the run alive');
    assert.ok(!fs.existsSync(`${p}.bind`), 'the stop left its lock behind');
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); }
});

test('a bind while the lock is held binds nothing and returns the state; with it free, it binds', async () => {
  const { bindRunState, writeRunState, readRunState, runStatePath } = await import('../scripts/io/run-state.mjs');
  const home = tmp('rsl-home-'); const repo = tmp('rsl-repo-');
  try {
    writeRunState(repo, state(), { home });
    const p = runStatePath(repo, { home });
    fs.writeFileSync(`${p}.bind`, String(process.pid));
    age(`${p}.bind`, 60 * 60 * 1000);
    const held = bindRunState(repo, 'sess-a', { home, lockTimeoutMs: 300 });
    assert.equal(held?.session ?? null, null, 'a bind went ahead under a live holder\'s lock');
    fs.rmSync(`${p}.bind`, { force: true });
    assert.equal(bindRunState(repo, 'sess-a', { home })?.session, 'sess-a');
    assert.equal(readRunState(repo, { home }).session, 'sess-a');
    assert.ok(!fs.existsSync(`${p}.bind`), 'the bind left its lock behind');
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); }
});

test('the run state keeps no lock rule of its own', () => {
  const src = fs.readFileSync(new URL('../scripts/io/run-state.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /BIND_LOCK_STALE_MS|mtimeMs/, 'a second, age-only lock rule is back');
  assert.match(src, /acquireFileLock\(/);
});
