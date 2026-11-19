// Review 20261101-023925-ar-remediation-2-review, remediated in 20261101-030723-ar-remediation-3: what decide.mjs leaves
// when a step fails. No seat and no model is reached from this file: every call is refused before the panel is asked.
//   G-6: --pending read every readdir failure as "no decisions", so an unreadable folder reported zero waiting.
//   G-9: a revote's claim directory was made before its preparation, so a revote refused during preparation left the
//        claim behind and every later revote was refused until it was removed by hand.
//   G-8: spends.json kept every ended run's spends, so it and each whole-file rewrite grew without bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript } from './helpers.mjs';
import { writeRunState } from '../scripts/io/run-state.mjs';
import { newRunState } from '../scripts/lib/run-state.mjs';

const Q = { question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }], category: 'delegable' };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function repo(contract = null) {
  const dir = tmp('decide-prep-');
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/decisions/\n');
  if (contract) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), contract);
  git('add', '-A'); git('commit', '-qm', 'init');
  return dir;
}

test('G-6: --pending fails when the decisions folder cannot be read, never reports zero waiting', () => {
  const dir = repo();
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    // A file where the folder should be: readdirSync fails with ENOTDIR, which is not "no decisions yet".
    fs.writeFileSync(path.join(dir, '.claude', 'decisions'), 'not a folder');
    const r = runScript('decide.mjs', ['--pending', '--repo-root', dir]);
    assert.notEqual(r.status, 0, `an unreadable decisions folder was reported as a result: ${r.output}`);
    assert.doesNotMatch(r.output, /0 postponed decision/);
    fs.rmSync(path.join(dir, '.claude', 'decisions'));
    const none = runScript('decide.mjs', ['--pending', '--repo-root', dir]);
    assert.equal(none.status, 0, `an absent folder is no decisions yet: ${none.output}`);
    assert.match(none.stdout, /0 postponed decision/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The panel on, and a contract override that puts a seat in the node runtime's family: decide refuses at the seats'
// family check, which runs after the work context is built, so it is a refusal during the revote's preparation.
const PANEL_CONTRACT = '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
  + 'review:\n  external_panel: true\n  decision_panel: on\nreviewers:\n  codex:\n    family: anthropic\n'
  + 'ui:\n  surface: none\n```\n';

test('G-9: a revote refused during its preparation leaves no claim, so the next revote is not held', () => {
  const dir = repo(PANEL_CONTRACT);
  try {
    const id = '20261031-120000-abcdef';
    const rec = path.join(dir, '.claude', 'decisions', id);
    fs.mkdirSync(rec, { recursive: true });
    fs.writeFileSync(path.join(rec, 'question.json'), JSON.stringify(Q));
    fs.writeFileSync(path.join(rec, 'outcome.json'), JSON.stringify({ outcome: 'revote' }));
    fs.writeFileSync(path.join(rec, 'note.md'), 'Cost matters more than freshness here.\n');
    const first = runScript('decide.mjs', ['--revote', id, '--repo-root', dir]);
    assert.notEqual(first.status, 0, first.output);
    assert.match(first.output, /same family/, `the fixture did not reach the seats' family check: ${first.output}`);
    assert.equal(fs.existsSync(path.join(rec, 'revote')), false, 'the refused revote left its claim directory behind');
    const again = runScript('decide.mjs', ['--revote', id, '--repo-root', dir]);
    assert.doesNotMatch(again.output, /already being revoted/, `the next revote was held by a stale claim: ${again.output}`);
    // The same for a new decision: refused during preparation, it leaves no record without an outcome.
    const qf = path.join(dir, 'q.json');
    fs.writeFileSync(qf, JSON.stringify(Q));
    const fresh = runScript('decide.mjs', ['--question', qf, '--repo-root', dir]);
    assert.match(fresh.output, /same family/, fresh.output);
    assert.deepEqual(fs.readdirSync(path.join(dir, '.claude', 'decisions')).filter((n) => /^\d{8}-/.test(n)), [id],
      'a refused question left a decision record behind');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const SPEND_CONTRACT = '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
  + 'review:\n  run_spend_max: 5\nui:\n  surface: none\n```\n';

test('G-8: counting a spend keeps the active run\'s spends and drops the ended runs\'', () => {
  const dir = repo(SPEND_CONTRACT);
  const home = tmp('decide-home-');
  try {
    const id = '20261031-120000-abcdef';
    const rec = path.join(dir, '.claude', 'decisions', id);
    fs.mkdirSync(rec, { recursive: true });
    fs.writeFileSync(path.join(rec, 'question.json'), JSON.stringify(Q));
    fs.writeFileSync(path.join(rec, 'outcome.json'), JSON.stringify({ outcome: 'majority', entry: 'E1' }));
    const env = { QUORATE_HOME: home };
    writeRunState(dir, newRunState({ plan: '.claude/requests/p.plan.md', startedAt: Date.parse('2026-10-31T10:00:00Z'), limitHours: null }), { home });
    assert.equal(runScript('decide.mjs', ['--count-spend', id, '--repo-root', dir], { env }).status, 0);
    writeRunState(dir, newRunState({ plan: '.claude/requests/p.plan.md', startedAt: Date.parse('2026-10-31T11:00:00Z'), limitHours: null }), { home });
    const next = runScript('decide.mjs', ['--count-spend', id, '--repo-root', dir], { env });
    assert.equal(next.status, 0, next.output);
    const spends = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'decisions', 'spends.json'), 'utf8'));
    assert.equal(Object.keys(spends).length, 1, `an ended run's spends were kept: ${JSON.stringify(Object.keys(spends))}`);
    assert.equal(Object.values(spends)[0].length, 1, 'the active run keeps its own count');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});
