// autonomous-run.plan.md stage 7: a reviewer or runtime CLI due an update for several days is reported, never updated
// (autonomous-run.md criterion 13: "report if CLI needs to be updated after a few days without it"). The CLIs checked
// are DERIVED from the adapter table and the roster, never listed (A-9; plan-review round 2). Fixtures are the outputs
// stage 1 measured on 2026-10-31: `2.1.316 (Claude Code)`, `codex-cli 0.163.0` against a published 0.166.0, `1.4.12`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, compareVersions, freshnessStep, dueClis, freshnessAdapters, DUE_AFTER_DAYS }
  from '../scripts/lib/cli-freshness.mjs';

test('versions are read from the CLIs\' own output, as stage 1 recorded it', () => {
  assert.equal(parseVersion('2.1.316 (Claude Code)'), '2.1.316');
  assert.equal(parseVersion('codex-cli 0.163.0'), '0.163.0');
  assert.equal(parseVersion('1.4.12'), '1.4.12');
  assert.equal(parseVersion('0.166.0\n'), '0.166.0');
  assert.equal(parseVersion('no version here'), null);
  assert.equal(compareVersions('0.163.0', '0.166.0'), -1);
  assert.equal(compareVersions('2.1.316', '2.1.316'), 0);
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1, 'numeric, not text, order');
});

test('behind is dated the first day it is seen; due after the threshold; current clears it', () => {
  assert.equal(DUE_AFTER_DAYS, 3);
  const d1 = freshnessStep(undefined, { installed: 'codex-cli 0.163.0', latest: '0.166.0', today: '2026-10-31' });
  assert.deepEqual(d1, { installed: '0.163.0', latest: '0.166.0', state: 'behind', behind_since: '2026-10-31' });
  const d2 = freshnessStep(d1, { installed: 'codex-cli 0.163.0', latest: '0.166.0', today: '2026-11-02' });
  assert.equal(d2.behind_since, '2026-10-31', 'a later check keeps the first date');
  assert.equal(freshnessStep(d1, { installed: 'codex-cli 0.166.0', latest: '0.166.0', today: '2026-11-02' }).state, 'current');
  assert.equal(freshnessStep(undefined, { installed: '1.4.12', latest: null, today: '2026-10-31' }).state, 'not-checked',
    'an adapter that declares no published-version query is not checked, never "current"');
  assert.equal(freshnessStep(undefined, { installed: null, latest: '0.166.0', today: '2026-10-31' }).state, 'not-checked');
});

// G-8 of 20261105-004603-ar-d1-c-review: a day whose query failed wrote `not-checked` with no date, so one network blip
// restarted the behind clock, and a query failing every few days kept a CLI from ever being reported due.
test('a day whose query failed keeps the behind date: the clock is not restarted by a blip', () => {
  const d1 = freshnessStep(undefined, { installed: 'codex-cli 0.163.0', latest: '0.166.0', today: '2026-10-31' });
  const blip = freshnessStep(d1, { installed: 'codex-cli 0.163.0', latest: null, today: '2026-11-01' });
  assert.equal(blip.state, 'not-checked');
  assert.equal(blip.behind_since, '2026-10-31', 'the failed day dropped the date it was behind since');
  const d3 = freshnessStep(blip, { installed: 'codex-cli 0.163.0', latest: '0.166.0', today: '2026-11-03' });
  assert.equal(d3.behind_since, '2026-10-31', 'the next good day counted from today, not from the first day behind');
  assert.deepEqual(dueClis({ adapters: { codex: d3 } }, '2026-11-03').map((d) => d.days), [3]);
  assert.equal(freshnessStep(undefined, { installed: null, latest: null, today: '2026-11-01' }).behind_since, undefined,
    'never behind: no date');
  const caughtUp = freshnessStep(blip, { installed: 'codex-cli 0.166.0', latest: '0.166.0', today: '2026-11-02' });
  assert.equal(caughtUp.behind_since, undefined, 'current clears it');
});

// G-7 of 20261105-004603-ar-d1-c-review: the threshold is stated in three places (the constant, session-rules' "A long
// run", the adapter table's latest_version doc) with nothing tying them, so one could change and the others not.
test('the days a CLI must be behind are stated where the code reads them, everywhere they are stated', async () => {
  const fs = (await import('node:fs')).default;
  const path = (await import('node:path')).default;
  const { REPO_ROOT } = await import('./helpers.mjs');
  const rules = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'session-rules.md'), 'utf8');
  const longRun = rules.slice(rules.indexOf('### A long run'));
  assert.match(longRun, new RegExp(`behind for \\*\\*${DUE_AFTER_DAYS} days\\*\\* or more`), 'session-rules states another threshold');
  const doc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'reviewers.json'), 'utf8'));
  const latest = JSON.stringify(doc).match(/"latest_version":"([^"]*(?:\\.[^"]*)*)"/)?.[1] ?? '';
  assert.match(latest, new RegExp(`behind for ${DUE_AFTER_DAYS} days or more`), 'the adapter table\'s doc states another threshold');
});

test('due: behind for at least the threshold, by date', () => {
  const cache = { adapters: {
    codex: { state: 'behind', behind_since: '2026-10-31', installed: '0.163.0', latest: '0.166.0' },
    runtime: { state: 'current', installed: '2.1.316', latest: '2.1.316' },
    agy: { state: 'not-checked', installed: '1.4.12', latest: null },
  } };
  assert.deepEqual(dueClis(cache, '2026-11-02'), []);
  assert.deepEqual(dueClis(cache, '2026-11-03').map((d) => d.name), ['codex']);
  assert.equal(dueClis(cache, '2026-11-03')[0].days, 3);
});

test('the set checked is the node runtime plus every reviewer the roster uses, each once', () => {
  const roster = {
    panel_arms: [{ reviewer: 'codex' }, { reviewer: 'codex' }],
    adjudicators: [{ reviewer: 'agy' }, { reviewer: 'codex' }],
    proposers: { codex: {}, agy: {} },
    claim_checker: { reviewer: 'codex' },
    decision_panel: { seats: [{ reviewer: 'codex' }, { reviewer: 'other-vendor' }] },
  };
  assert.deepEqual(freshnessAdapters({ defaultNodeRuntime: 'rt', roster }), ['rt', 'codex', 'agy', 'other-vendor']);
  assert.deepEqual(freshnessAdapters({ defaultNodeRuntime: 'rt', roster: {} }), ['rt']);
});

test('the daily check: the adapters\' own commands, stage 1\'s outputs, a cache that dates the lag, and no command twice a day', async () => {
  const fs = (await import('node:fs')).default;
  const os = (await import('node:os')).default;
  const path = (await import('node:path')).default;
  const { checkFreshness } = await import('../scripts/io/cli-freshness.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  try {
    const calls = [];
    // Answers by command line, as stage 1 measured them on 2026-10-31.
    const OUT = { '--version': { codex: 'codex-cli 0.163.0', agy: '1.4.12' }, '@openai/codex': '0.166.0' };
    const run = (c) => {
      calls.push([c.cmd, ...c.version_argv].join(' '));
      if (c.version_argv.includes('@openai/codex')) return { ok: true, version: OUT['@openai/codex'] };
      if (c.version_argv.includes('@anthropic-ai/claude-code')) return { ok: true, version: '2.1.316' };
      if (c.cmd === 'codex') return { ok: true, version: OUT['--version'].codex };
      if (c.cmd === 'agy') return { ok: true, version: OUT['--version'].agy };
      return { ok: true, version: '2.1.316 (Claude Code)' };
    };
    const day = (d) => new Date(`${d}T12:00:00Z`);
    assert.deepEqual(checkFreshness({ home, now: day('2026-10-31'), run }), [], 'behind one day is not due');
    const n = calls.length;
    assert.ok(calls.some((c) => c.includes('@openai/codex')), 'the published version is asked of the adapter\'s own query');
    checkFreshness({ home, now: day('2026-10-31'), run });
    assert.equal(calls.length, n, 'the same day reads the cache');
    const due = checkFreshness({ home, now: day('2026-11-03'), run });
    assert.equal(due.length, 1);
    assert.match(due[0], /codex 0\.163\.0 is behind 0\.166\.0 for 3 days \(since 2026-10-31\)/);
    const all = checkFreshness({ home, now: day('2026-11-03'), run, all: true }).join('\n');
    assert.match(all, /agy: not-checked/, 'an adapter with no published-version query is named not checked');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// G-1 of 20261105-004603-ar-d1-c-review: the check built only the built-in table, so a contract overriding an adapter's
// CLI had the freshness check query and report the built-in one, not the CLI the engine actually runs.
test('the daily check asks the CLI the contract declares, an override of a built-in included, and names the override', async () => {
  const fs = (await import('node:fs')).default;
  const os = (await import('node:os')).default;
  const path = (await import('node:path')).default;
  const { checkFreshness } = await import('../scripts/io/cli-freshness.mjs');
  const { builtinReviewers } = await import('../scripts/io/reviewers.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-ovr-'));
  try {
    const codex = builtinReviewers().codex;
    const declared = { codex: { ...codex, cmd: 'my-codex', latest_version: { cmd: 'my-npm', argv: ['view', 'my-codex', 'version'] } } };
    const calls = [];
    const run = (c) => { calls.push([c.cmd, ...c.version_argv].join(' ')); return { ok: true, version: '1.0.0' }; };
    const all = checkFreshness({ home, now: new Date('2026-11-05T12:00:00Z'), run, all: true, declared }).join('\n');
    assert.ok(calls.some((c) => c.startsWith('my-codex ')), `the overriding CLI was never asked: ${calls.join(' | ')}`);
    assert.ok(calls.some((c) => c === 'my-npm view my-codex version'), 'the override\'s published-version query was never asked');
    assert.ok(!calls.some((c) => c.startsWith('codex ')), 'the built-in CLI was asked although the contract overrides it');
    assert.match(all, /codex/, 'the override is named in the full listing');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
