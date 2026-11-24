// G-2 and G-3 of 20261105-013235-ar-d1-c-remediation-review: the hook's detached freshness refresh checked only the
// cache's date. Every turn start before the first refresh wrote the cache spawned another refresh, a refresh that kept
// failing respawned on every turn, a repository whose contract overrides an adapter read another repository's answer as
// its own, and the override notice the refresh printed went to an ignored stdout (A-26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshFreshnessDetached, checkFreshness } from '../scripts/io/cli-freshness.mjs';

const stale = (home, extra = {}) => fs.writeFileSync(path.join(home, 'cli-freshness.json'), JSON.stringify({ checked_day: '2026-11-04', adapters: {}, ...extra }));
const withHome = (fn) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'frg-home-'));
  try { return fn(home); } finally { fs.rmSync(home, { recursive: true, force: true }); }
};
const spawner = () => { const calls = []; return { calls, spawn: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { on() {}, unref() {} }; } }; };

test('G-2: a refresh in flight is not started again, and a failed one is retried only after a wait', () => withHome((home) => {
  stale(home);
  const { calls, spawn } = spawner();
  const now = new Date('2026-11-05T10:00:00Z');
  assert.equal(refreshFreshnessDetached({ home, now, spawn, declared: {} }), true);
  assert.equal(refreshFreshnessDetached({ home, now: new Date(now.getTime() + 1000), spawn, declared: {} }), false, 'a second turn start spawned a duplicate refresh');
  assert.equal(calls.length, 1);
  // The first refresh died before writing the cache: retried after the wait, not on every turn.
  assert.equal(refreshFreshnessDetached({ home, now: new Date(now.getTime() + 60 * 60 * 1000), spawn, declared: {} }), true);
  assert.equal(calls.length, 2);
}));

test('G-2: today\'s cache from a table with other overrides is not current for this one', () => withHome((home) => {
  fs.writeFileSync(path.join(home, 'cli-freshness.json'), JSON.stringify({ checked_day: '2026-11-05', adapters: {} }));
  const { calls, spawn } = spawner();
  const declared = { codex: { cmd: '/opt/other-codex' } };
  assert.equal(refreshFreshnessDetached({ home, now: new Date('2026-11-05T10:00:00Z'), spawn, declared }), true, 'another table\'s answer was taken as this one\'s');
  assert.equal(calls.length, 1);
}));

// G-2 of 20261124-021129-m3s9-remediation-2-review-b: the child's error event only took the recorded start back, so a
// refresh that could not start was retried in silence and the operator never learnt the CLIs were not being checked.
test('G-2: a refresh that fails to start is said on the next turn start, and only until a check runs', () => withHome((home) => {
  stale(home);
  const handlers = {};
  const spawn = () => ({ on(ev, fn) { handlers[ev] = fn; }, unref() {} });
  const now = new Date('2026-11-05T10:00:00Z');
  assert.equal(refreshFreshnessDetached({ home, now, spawn, declared: {} }), true);
  assert.equal(typeof handlers.error, 'function', 'the child has no error handler');
  handlers.error(new Error('spawn node ENOENT'));
  const lines = checkFreshness({ cacheOnly: true, home, now: new Date(now.getTime() + 1000), declared: {} });
  assert.ok(lines.some((l) => /could not start/.test(l) && /ENOENT/.test(l)), `a failed refresh went unsaid: ${JSON.stringify(lines)}`);
  // Its start is still taken back, so a later turn retries.
  assert.equal(refreshFreshnessDetached({ home, now: new Date(now.getTime() + 2000), spawn, declared: {} }), true, 'the failed start held off the retry');
  // A check that ran writes a cache with no failure in it.
  checkFreshness({ force: true, home, now, declared: {}, run: () => ({ ok: false }) });
  assert.ok(!checkFreshness({ cacheOnly: true, home, now, declared: {} }).some((l) => /could not start/.test(l)), 'a failure outlived the check that followed it');
}));

// G-5 of 20261124-030759-m3s9-remediation-3-review-b: a spawn that threw synchronously took the start back but recorded no
// error, so the same unstarted refresh went unsaid on that spelling of the failure.
test('G-5: a refresh whose spawn throws is said on the next turn start, as an error event is', () => withHome((home) => {
  stale(home);
  const spawn = () => { throw new Error('spawn EACCES'); };
  const now = new Date('2026-11-05T10:00:00Z');
  assert.throws(() => refreshFreshnessDetached({ home, now, spawn, declared: {} }), /EACCES/);
  const lines = checkFreshness({ cacheOnly: true, home, now: new Date(now.getTime() + 1000), declared: {} });
  assert.ok(lines.some((l) => /could not start/.test(l) && /EACCES/.test(l)), `a refresh whose spawn threw went unsaid: ${JSON.stringify(lines)}`);
}));

test('G-3: an override the refresh runs is named by the hook that starts it', () => withHome((home) => {
  stale(home);
  const { spawn } = spawner();
  const said = [];
  refreshFreshnessDetached({ home, now: new Date('2026-11-05T10:00:00Z'), spawn, declared: { codex: { cmd: '/opt/other-codex' } }, say: (l) => said.push(l) });
  assert.ok(said.some((l) => /codex/.test(l)), `the override was not named: ${JSON.stringify(said)}`);
}));
