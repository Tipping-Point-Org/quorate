// macOS RUNS ON EVERY PUSH TO THE PUBLIC REPOSITORY'S master, AND NOWHERE ELSE BUT BY HAND (m3-v1.plan.md stage 5, Q1);
// Windows the same on the private repository since 2026-11-23 (the last test).
//
// ROADMAP §M3 item 2 asks for all three systems tested for the 1.0 candidate, and under Q1 and D2 that is the public push
// run on each release commit. The matrix is one GitHub expression, and no test read it: a guard in the wrong order, or a
// clause gone, would put macOS on every private push (charged at about ten times the Linux rate) or on none at all, seen
// only when the release run came back without it. The expression's clauses are read here and evaluated for each event,
// first matching guard wins, as `a && x || b && y || z` does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const yml = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'checks.yml'), 'utf8').split('\r\n').join('\n');

/** The offline job's matrix as clauses: `{ guards: [...], jobs: [...] }`, the last with no guard. */
function clauses() {
  const m = /include: \$\{\{([\s\S]*?)\}\}\n/.exec(yml);
  assert.ok(m, 'checks.yml has no matrix include expression');
  return m[1].split(/\n\s*\|\|/).map((c) => {
    const json = /fromJSON\('(\[[^']*\])'\)/.exec(c);
    assert.ok(json, `a clause with no fromJSON list: ${c.trim()}`);
    const guards = c.slice(0, json.index).split('&&').map((g) => g.trim()).filter(Boolean);
    return { guards, jobs: JSON.parse(json[1]) };
  });
}

function jobsFor({ event, isPrivate, os = 'macos' }) {
  for (const { guards, jobs } of clauses()) {
    const holds = guards.every((g) => {
      const ev = /^github\.event_name == '([a-z_]+)'$/.exec(g);
      if (ev) return ev[1] === event;
      if (g === '!github.event.repository.private') return !isPrivate;
      const input = /^inputs\.os == '([a-z]+)'$/.exec(g);
      if (input) return input[1] === os;
      assert.fail(`a guard this test cannot evaluate: ${g}`);
    });
    if (holds) return jobs.map((j) => `${j.os}/${j.node}`);
  }
  return [];
}

const MAC = 'macos-latest/26';
const WIN = 'windows-latest/26';

test('a push to the public repository runs macOS and Windows beside every Linux job a private push runs', () => {
  const pub = jobsFor({ event: 'push', isPrivate: false });
  const priv = jobsFor({ event: 'push', isPrivate: true });
  assert.ok(pub.includes(MAC), `the public push runs no macOS job: ${pub}`);
  assert.deepEqual(pub.filter((j) => j !== MAC && j !== WIN).sort(), [...priv].sort(), 'the public push dropped a job the private push runs');
});

test('a private push and any pull request run no macOS; a hand-started run is macOS alone', () => {
  assert.ok(!jobsFor({ event: 'push', isPrivate: true }).includes(MAC), 'macOS on every private push');
  for (const isPrivate of [true, false]) {
    assert.ok(!jobsFor({ event: 'pull_request', isPrivate }).includes(MAC), `macOS on a pull request (private: ${isPrivate})`);
  }
  assert.deepEqual(jobsFor({ event: 'workflow_dispatch', isPrivate: true }), [MAC]);
});

test('the workflow runs on a push to master, so the public push is an event it receives', () => {
  assert.match(yml, /^on:\n {2}push:\n {4}branches: \[master\]/m);
});

// WINDOWS BY HAND ON THE PRIVATE REPOSITORY (operator, 2026-11-23: "if possible only use ubuntu budge leaving windows and
// macOS build only when changes affect theem"): a pull request and a private push run Linux alone, a dispatch with
// os: windows runs Windows alone, and the public push still runs all three systems.
test('a pull request and a private push run Linux only; a hand-started run with os windows is Windows alone', () => {
  for (const isPrivate of [true, false]) {
    assert.deepEqual(jobsFor({ event: 'pull_request', isPrivate }), ['ubuntu-latest/26'], `pull request (private: ${isPrivate})`);
  }
  const priv = jobsFor({ event: 'push', isPrivate: true });
  assert.ok(priv.length && priv.every((j) => j.startsWith('ubuntu-latest/')), `a private push runs off Linux: ${priv}`);
  assert.deepEqual(jobsFor({ event: 'workflow_dispatch', isPrivate: true, os: 'windows' }), [WIN]);
  const pub = jobsFor({ event: 'push', isPrivate: false });
  assert.ok(pub.includes(WIN) && pub.includes(MAC), `the public push lost Windows or macOS: ${pub}`);
});
