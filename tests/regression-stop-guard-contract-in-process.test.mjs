// G-15 of 20261123-161216-m3s9-review: on every turn start of a long run, stop-guard's run lines called
// io/contract-reader.mjs's readContract, which spawns a fresh node running new-run --print-contract with no timeout,
// while the same hook already read and parsed the contract in process (sessionContract, memoized per hook process). A
// hook is one process per event, so the spawn was paid on every turn of a run lasting up to 72 hours. The hook now
// takes the whole parsed contract from its one in-process read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, sessionHookEnv } from './helpers.mjs';
import { sessionContract } from '../scripts/io/session-contract.mjs';

test('stop-guard names neither the reader that spawns new-run nor its call', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'stop-guard.mjs'), 'utf8');
  assert.doesNotMatch(src, /contract-reader\.mjs|readContract\(/, 'stop-guard spawns new-run --print-contract on a turn start');
});

// G-12 of 20261123-174149-m3s9-remediation-review-b: the check above is a source match, so an aliased reader, an indirect
// call or a direct spawn of new-run --print-contract passes it. This one RUNS a turn start of an active run, with every
// child_process launch the hook process makes logged by a preload, and refuses any that runs new-run.
// G-13 of 20261124-021129-m3s9-remediation-2-review-b: the check above kept only the hook's own launches (s.pid ===
// turn.pid), so a descendant reaching new-run --print-contract passed it; the turn start launches the daily freshness
// refresh detached. Here every node process the turn start launches loads the same logger (it rides on each launch of
// node), the refresh's version queries are stubbed so none reaches a real CLI, and the test waits for the refresh to end.
test('a turn start of an active run launches no new-run process, in any process it starts', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-sg-desc-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-sg-desc-repo-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n  build: ""\nreview:\n  decision_panel: off\n```\n');
    fs.mkdirSync(path.join(repo, '.claude', 'requests'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'requests', 'a.plan.md'), '---\nstatus: approved (operator)\n---\n# a\n');
    const env = sessionHookEnv({ QUORATE_HOME: home });
    const start = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'run-session.mjs'), 'start', '--plan', '.claude/requests/a.plan.md', '--repo-root', repo], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(start.status, 0, start.stderr);
    const log = path.join(home, 'spawns.jsonl');
    const preload = path.join(home, 'log-spawns.mjs');
    const url = pathToFileURL(preload).href;
    fs.writeFileSync(preload, `import { createRequire, syncBuiltinESMExports } from 'node:module'; import fs from 'node:fs';
const cp = createRequire(import.meta.url)('node:child_process');
const note = (o) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ pid: process.pid, ...o }) + '\\n');
note({ started: process.argv.slice(1) });
process.on('exit', () => note({ exited: true }));
const refresh = process.argv.includes('freshness');
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
  const real = cp[name];
  cp[name] = function (...a) {
    note({ name, argv: a.filter((x) => typeof x === 'string' || Array.isArray(x)).flat().map(String) });
    if (refresh && a[0] !== process.execPath && name === 'spawnSync') return { pid: 0, status: 1, signal: null, stdout: '', stderr: 'stubbed', output: [null, '', 'stubbed'] };
    if (refresh && a[0] !== process.execPath && name === 'execFileSync') throw new Error('stubbed');
    if (a[0] === process.execPath && Array.isArray(a[1]) && name !== 'fork') a[1] = ['--import', ${JSON.stringify(url)}, ...a[1]];
    return real.apply(this, a);
  };
}
syncBuiltinESMExports();
`);
    const turn = spawnSync(process.execPath, ['--import', url, path.join(REPO_ROOT, 'scripts', 'stop-guard.mjs'), '--turn-start', '--repo-root', repo], {
      cwd: repo, env, encoding: 'utf8',
      input: JSON.stringify({ session_id: 'sg-desc', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'go on' }),
    });
    assert.equal(turn.status, 0, turn.stderr);
    assert.match(turn.stdout, /quorate run in progress/, 'the turn start did not reach the run lines it is about');
    const entries = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    // The refresh is detached and outlives the hook: wait for every process that started to exit.
    const deadline = Date.now() + 60_000;
    const open = () => { const e = entries(); const started = new Set(e.filter((x) => x.started).map((x) => x.pid)); for (const x of e) if (x.exited) started.delete(x.pid); return started; };
    const refreshStarted = () => entries().some((x) => x.pid !== turn.pid && x.started?.includes('freshness'));
    while ((!refreshStarted() || open().size) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    const all = entries();
    assert.ok(refreshStarted(), `the turn start launched no refresh, so its descendants were not exercised: ${JSON.stringify(all)}\n${turn.stdout}`);
    assert.deepEqual([...open()], [], 'a process the turn start launched had not ended in 60 s');
    assert.deepEqual(all.filter((s) => s.argv?.some((a) => /new-run(\.mjs)?\b|print-contract/.test(a))), [],
      'the turn start, or a process it launched, launched new-run --print-contract');
  } finally {
    for (const d of [repo, home]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('a turn start of an active run launches no new-run process', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-sg-spawn-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-sg-spawn-repo-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n  build: ""\nreview:\n  decision_panel: off\n```\n');
    fs.mkdirSync(path.join(repo, '.claude', 'requests'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'requests', 'a.plan.md'), '---\nstatus: approved (operator)\n---\n# a\n');
    const env = sessionHookEnv({ QUORATE_HOME: home });
    const start = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'run-session.mjs'), 'start', '--plan', '.claude/requests/a.plan.md', '--repo-root', repo], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(start.status, 0, start.stderr);
    const log = path.join(home, 'spawns.jsonl');
    const preload = path.join(home, 'log-spawns.mjs');
    fs.writeFileSync(preload, `import { createRequire, syncBuiltinESMExports } from 'node:module'; import fs from 'node:fs';
const cp = createRequire(import.meta.url)('node:child_process');
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
  const real = cp[name];
  cp[name] = function (...a) { fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ pid: process.pid, name, argv: a.filter((x) => typeof x === 'string' || Array.isArray(x)).flat().map(String) }) + '\\n'); return real.apply(this, a); };
}
syncBuiltinESMExports();
`);
    const turn = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, path.join(REPO_ROOT, 'scripts', 'stop-guard.mjs'), '--turn-start', '--repo-root', repo], {
      cwd: repo, env, encoding: 'utf8',
      input: JSON.stringify({ session_id: 'sg-spawn', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'go on' }),
    });
    assert.equal(turn.status, 0, turn.stderr);
    assert.match(turn.stdout, /quorate run in progress/, 'the turn start did not reach the run lines it is about');
    const spawns = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const own = spawns.filter((s) => s.pid === turn.pid);
    assert.deepEqual(own.filter((s) => s.argv.some((a) => /new-run(\.mjs)?\b|print-contract/.test(a))), [],
      'the turn start launched new-run --print-contract');
  } finally {
    for (const d of [repo, home]) fs.rmSync(d, { recursive: true, force: true });
  }
});

// G-7 of 20261123-174149-m3s9-remediation-review-b: an unreadable contract was taken as the panel off, in silence, and
// the stop was recorded as panel-off. It is said, and the record does not claim a panel state nobody read.
test('a Stop with an unreadable contract says so and does not record the panel as off', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-sg-unreadable-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-sg-home-'));
  try {
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'stop-guard.mjs'), '--repo-root', repo], {
      input: JSON.stringify({ session_id: 'sg-unreadable', cwd: repo, hook_event_name: 'Stop', last_assistant_message: 'Done.' }),
      encoding: 'utf8', env: sessionHookEnv({ QUORATE_HOME: home }), windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /contract could not be read/i, 'an unreadable contract changed the decision in silence');
    const lines = [];
    const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else lines.push(...fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)); } };
    walk(home);
    const ev = lines.map((l) => JSON.parse(l)).find((e) => e.event === 'end' || e.event === 'blocked');
    assert.ok(ev, 'the stop was not recorded');
    assert.notEqual(ev.panel, 'off', 'an unread contract was recorded as the panel off');
  } finally {
    for (const d of [repo, home]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('sessionContract gives the whole parsed contract, so a hook needs no second read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-sessioncontract-'));
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\nreviewers:\n  codex:\n    bin: codex\nreview:\n  decision_panel: off\n```\n');
    const read = sessionContract(dir);
    assert.equal(read.unreadable, undefined);
    assert.equal(read.contract?.project, 't', 'the whole block, not only its review half');
    assert.deepEqual(read.contract?.reviewers, { codex: { bin: 'codex' } });
    const none = sessionContract(path.join(dir, 'missing'));
    assert.equal(none.contract, null);
    assert.ok(none.unreadable, 'no contract is said, not read as an empty one');
    assert.equal(none.absent, true, 'no contract is told apart from one that cannot be read (G-13)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
