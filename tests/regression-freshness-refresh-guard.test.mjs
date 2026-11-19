// G-2 and G-3 of 20261105-013235-ar-d1-c-remediation-review: the hook's detached freshness refresh checked only the
// cache's date. Every turn start before the first refresh wrote the cache spawned another refresh, a refresh that kept
// failing respawned on every turn, a repository whose contract overrides an adapter read another repository's answer as
// its own, and the override notice the refresh printed went to an ignored stdout (A-26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshFreshnessDetached } from '../scripts/io/cli-freshness.mjs';

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

test('G-3: an override the refresh runs is named by the hook that starts it', () => withHome((home) => {
  stale(home);
  const { spawn } = spawner();
  const said = [];
  refreshFreshnessDetached({ home, now: new Date('2026-11-05T10:00:00Z'), spawn, declared: { codex: { cmd: '/opt/other-codex' } }, say: (l) => said.push(l) });
  assert.ok(said.some((l) => /codex/.test(l)), `the override was not named: ${JSON.stringify(said)}`);
}));
