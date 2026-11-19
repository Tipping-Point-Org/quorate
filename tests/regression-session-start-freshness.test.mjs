// G-12 of 20261105-004603-ar-d1-c-review (HIGH): the SessionStart hook ran the daily CLI check synchronously, so the
// first session of each day waited on every version query (network included, up to 30 s each), in the hook's own
// environment; and its one catch named every bind, freshness or write error as "run state could not be read". The
// amended stage 7 (operator "C", 2026-11-04): the hook reads the check from its cache only, a stale cache is refreshed
// by a DETACHED process whose environment is scrubbed, and only an unreadable state prints a line.
// G-21 of the same run: turn starts read the cache only and never refreshed it, so a long session crossing dates never
// compared again; a turn start now starts the same detached refresh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('the session-start hook reads the CLI check from its cache only, and names only an unreadable state', () => {
  const src = read('scripts/run-session.mjs');
  const hook = src.slice(src.indexOf("if (v['session-start'])"), src.indexOf('// ---------------------------------------------------------------------------- the commands'));
  const calls = [...hook.matchAll(/checkFreshness\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 1, 'the hook prints the cached check');
  for (const c of calls) assert.match(c, /cacheOnly:\s*true/, `the hook ran the version queries synchronously: checkFreshness(${c})`);
  assert.match(hook, /refreshFreshnessDetached\(/, 'a stale cache is refreshed by a detached process');
  // The one named catch wraps the read alone. Its sentence is the prompt library's run-state-unreadable.md, the one
  // stop-guard's turn start prints (G-8 of 20261106-022028-stoplog-g8-remediation-2-review: an inline literal here was a
  // second owner; operator, 2026-11-06: "Session-commit, retry (Recommended)", decision 20261106-030815-95c5fe).
  const named = /try\s*\{([^{}]*)\}\s*catch\s*\(e\)\s*\{\s*process\.stdout\.write\(noticeText\('run-state-unreadable\.md'/.exec(hook);
  assert.ok(named, 'an unreadable state still prints its line');
  assert.match(named[1], /^\s*state\s*=\s*readRunState\(repoRoot\);\s*$/, `the named catch wraps more than the read: ${named[1]}`);
});

test('a turn start refreshes a stale cache the same way, so a long session keeps comparing', () => {
  const src = read('scripts/stop-guard.mjs');
  const fn = src.slice(src.indexOf('async function turnStartRunLinesOf'), src.indexOf('function decisionPanelHere'));
  assert.match(fn, /refreshFreshnessDetached\(/, 'a turn start never refreshed the cache');
});

test('the refresh: detached, output ignored, secrets scrubbed, and only when the cache is not from today', async () => {
  const { refreshFreshnessDetached } = await import('../scripts/io/cli-freshness.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ssf-home-'));
  try {
    const now = new Date('2026-11-05T10:00:00Z');
    const calls = [];
    const spawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { on() {}, unref() {} }; };
    const env = { PATH: '/bin', ['MY_' + 'TOKEN']: 's3cret', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'o' };
    fs.writeFileSync(path.join(home, 'cli-freshness.json'), JSON.stringify({ checked_day: '2026-11-04', adapters: {} }));
    assert.equal(refreshFreshnessDetached({ repoRoot: home, home, now, env, spawn }), true);
    assert.equal(calls.length, 1);
    const { cmd, args, opts } = calls[0];
    assert.equal(cmd, process.execPath);
    assert.ok(args.includes('freshness'), args.join(' '));
    assert.equal(opts.detached, true);
    assert.equal(opts.stdio, 'ignore');
    for (const k of ['MY_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) assert.equal(opts.env[k], undefined, `${k} reached the refresh`);
    assert.equal(opts.env.PATH, '/bin');
    assert.equal(opts.env.QUORATE_HOME, home);
    fs.writeFileSync(path.join(home, 'cli-freshness.json'), JSON.stringify({ checked_day: '2026-11-05', adapters: {} }));
    assert.equal(refreshFreshnessDetached({ repoRoot: home, home, now, env, spawn }), false, 'today\'s cache: nothing started');
    assert.equal(calls.length, 1);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
