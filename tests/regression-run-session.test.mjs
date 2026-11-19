// autonomous-run.plan.md stage 7, the parts that do not wait on its open questions: a run started on one approved plan
// (design AR-D6), whose state survives a crash or a reboot outside the repository and is printed back into the session
// when it starts or resumes (stage 1: a SessionStart hook's output reaches the context on startup and resume, and a -p
// compaction fires none), and a resume line built from the runtime adapter's resume_argv, never a CLI literal (A-9).
// The time-limit stop and a quota stop are NOT here: their marker and their existence are the plan's open questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { newRunState, runStateErrors, limitState, runStateText, bindSession } from '../scripts/lib/run-state.mjs';
import { resumeLine } from '../scripts/lib/run-state.mjs';
import { runScript, REPO_ROOT } from './helpers.mjs';

const H = 3600_000;
const T0 = Date.parse('2026-10-31T20:00:00Z');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
/** The hook's environment: the test's home, no inherited depth, and today's CLI check already in the cache, so the hook
 * runs no version command (the suite is offline). */
function hookEnv(home) {
  fs.writeFileSync(path.join(home, 'cli-freshness.json'), JSON.stringify({ checked_day: new Date().toISOString().slice(0, 10), adapters: {} }));
  const env = { ...process.env, QUORATE_HOME: home };
  delete env.GRAPH_NODE_DEPTH;
  return env;
}

test('a run state holds the plan, the stage it runs until, its start, its limit and its session', () => {
  const s = newRunState({ plan: '.claude/requests/x.plan.md', until: 'Stage 5', startedAt: T0, limitHours: 72, session: null });
  assert.deepEqual(runStateErrors(s), []);
  assert.equal(s.limit_hours, 72);
  assert.equal(s.session, null);
  assert.deepEqual(runStateErrors({ ...s, plan: '' }).length, 1);
  assert.ok(runStateErrors({ ...s, limit_hours: 0 }).length, 'a limit is a positive number of hours or null');
  assert.deepEqual(runStateErrors({ ...s, limit_hours: null }), [], 'null is unlimited');
  assert.ok(runStateErrors(null).length);
});

test('the limit: hours from the start; null never ends; the state says when it ends', () => {
  const s = newRunState({ plan: 'p', startedAt: T0, limitHours: 2, session: null });
  assert.deepEqual(limitState(s, T0 + H), { reached: false, ends_at: new Date(T0 + 2 * H).toISOString() });
  assert.equal(limitState(s, T0 + 2 * H).reached, true, 'the limit is reached AT its hour, not after it');
  assert.deepEqual(limitState({ ...s, limit_hours: null }, T0 + 9999 * H), { reached: false, ends_at: null });
});

test('the session is bound once, by the first hook that sees one; a later id never replaces it', () => {
  const s = newRunState({ plan: 'p', startedAt: T0, limitHours: 72, session: null });
  const b = bindSession(s, 'abc');
  assert.equal(b.session, 'abc');
  assert.equal(bindSession(b, 'other'), null, 'already bound: nothing to write');
  assert.equal(bindSession(s, ''), null);
});

test('the text printed into the session names the plan, the stage, and when the run ends', () => {
  const s = newRunState({ plan: '.claude/requests/x.plan.md', until: 'Stage 5', startedAt: T0, limitHours: 72, session: 'abc' });
  const t = runStateText(s, T0 + H);
  assert.match(t, /x\.plan\.md/);
  assert.match(t, /Stage 5/);
  assert.match(t, /2026-11-03T20:00:00/);
  assert.match(runStateText({ ...s, limit_hours: null }, T0), /no time limit/);
  assert.match(runStateText(s, T0 + 80 * H), /limit reached/);
});

test('the resume line is the adapter\'s cmd and resume_argv with the session filled in, or a refusal', () => {
  const adapter = { cmd: 'rt', node_runtime: { resume_argv: ['--resume', '{{session}}'] } };
  assert.deepEqual(resumeLine(adapter, 'abc'), { ok: true, cmd: 'rt', argv: ['--resume', 'abc'] });
  assert.equal(resumeLine({ cmd: 'rt', node_runtime: {} }, 'abc').ok, false, 'no resume_argv: refused, never invented');
  assert.match(resumeLine(adapter, null).reason, /no session/);
});

test('run-session: start refuses a plan that is not approved; status, the session-start hook and stop round-trip', () => {
  const home = tmp('rs-home-');
  const repo = tmp('rs-repo-');
  try {
    spawnSync('git', ['init', '-q'], { cwd: repo });
    fs.mkdirSync(path.join(repo, '.claude', 'requests'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'requests', 'd.plan.md'), '---\nstatus: draft\n---\n# d\n');
    fs.writeFileSync(path.join(repo, '.claude', 'requests', 'a.plan.md'), '---\nstatus: approved (operator)\n---\n# a\n');
    const env = { QUORATE_HOME: home };
    const run = (args, input) => runScript('run-session.mjs', [...args, '--repo-root', repo], { env, cwd: repo, ...(input ? { input } : {}) });
    const draft = run(['start', '--plan', '.claude/requests/d.plan.md']);
    assert.notEqual(draft.status, 0);
    assert.match(draft.stderr, /not approved/);
    const ok = run(['start', '--plan', '.claude/requests/a.plan.md', '--until', 'Stage 3']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(run(['status']).stdout, /a\.plan\.md/);
    const again = run(['start', '--plan', '.claude/requests/a.plan.md']);
    assert.notEqual(again.status, 0, 'one run at a time: start refuses while a run is active');
    const hook = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'run-session.mjs'), '--session-start'], {
      cwd: repo, env: hookEnv(home),
      input: JSON.stringify({ session_id: 'sess-1', source: 'resume', cwd: repo }), encoding: 'utf8',
    });
    assert.equal(hook.status, 0);
    assert.match(hook.stdout, /a\.plan\.md/);
    assert.match(run(['status']).stdout, /sess-1/, 'the hook bound the session');
    // A compaction under -p fires no SessionStart (stage 1): the stop guard's turn start prints the run too.
    const turn = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'stop-guard.mjs'), '--turn-start'], {
      cwd: repo, env: hookEnv(home), encoding: 'utf8',
      input: JSON.stringify({ session_id: 'sess-1', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'go on' }),
    });
    assert.equal(turn.status, 0, turn.stderr);
    assert.match(turn.stdout, /quorate run in progress: plan \.claude\/requests\/a\.plan\.md, until Stage 3/);
    // The resume line: the runtime adapter's cmd and resume_argv with the bound session, from the shipped table.
    const resume = runScript('resume-run.mjs', ['--repo-root', repo], { env, cwd: repo });
    assert.equal(resume.status, 0, resume.stderr);
    assert.match(resume.stdout, /--resume sess-1/);
    assert.equal(run(['stop']).status, 0);
    const none = runScript('resume-run.mjs', ['--repo-root', repo], { env, cwd: repo });
    assert.equal(none.status, 1, 'no active run: nothing to resume');
    const quiet = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'run-session.mjs'), '--session-start'], {
      cwd: repo, env: hookEnv(home), input: '{"session_id":"x"}', encoding: 'utf8',
    });
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stdout, '', 'no active run: the hook prints nothing');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// G-26 of 20261104-223634-ar-d1-review: both hooks wrapped the run-state read in a bare catch, so a corrupt state file was
// silently treated as no run, and a resumed session got neither its plan nor its time limit. Still exit 0, but say so.
test('a run state that cannot be read is named at session start and at turn start, never treated as no run', async () => {
  const { runStatePath } = await import('../scripts/io/run-state.mjs');
  const home = tmp('rs-home3-');
  const repo = tmp('rs-repo3-');
  try {
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const p = runStatePath(repo, { home });
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{ torn');
    const hook = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'run-session.mjs'), '--session-start'], {
      cwd: repo, env: hookEnv(home), input: JSON.stringify({ session_id: 's', cwd: repo }), encoding: 'utf8',
    });
    assert.equal(hook.status, 0, 'the hook never fails the session');
    assert.match(hook.stdout, /run state could not be read/, 'session start: a corrupt run state was silent');
    const turn = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'stop-guard.mjs'), '--turn-start'], {
      cwd: repo, env: hookEnv(home), encoding: 'utf8',
      input: JSON.stringify({ session_id: 's', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'go on' }),
    });
    assert.equal(turn.status, 0, turn.stderr);
    assert.match(turn.stdout, /run state could not be read/, 'turn start: a corrupt run state was silent');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// G-13 of 20261105-004603-ar-d1-c-review: `start` checked for an active run and then wrote, with nothing between, so two
// starts at once both saw none and the later one silently replaced the first run. The start's write is now exclusive.
test('two starts at once: the start\'s write is exclusive, so the second never replaces the first run', async () => {
  const { writeRunState, readRunState } = await import('../scripts/io/run-state.mjs');
  const home = tmp('rs-home4-');
  const repo = tmp('rs-repo4-');
  try {
    const first = newRunState({ plan: '.claude/requests/a.plan.md', startedAt: T0, limitHours: 72, session: null });
    const second = newRunState({ plan: '.claude/requests/b.plan.md', startedAt: T0 + H, limitHours: 72, session: null });
    writeRunState(repo, first, { home, exclusive: true });
    assert.throws(() => writeRunState(repo, second, { home, exclusive: true }), /already active/);
    assert.equal(readRunState(repo, { home }).plan, first.plan, 'the second start replaced the first run');
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-session.mjs'), 'utf8');
    const start = src.slice(src.indexOf("if (cmd === 'start')"), src.indexOf("} else if (cmd === 'status')"));
    assert.match(start, /writeRunState\([^)]*exclusive:\s*true/, 'start writes the state without the exclusive create');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// G-13 of the same run, its other half: the plan was admitted by a lexical containment check, so a link inside the
// repository leading out of it had an approved file elsewhere recorded as the run's in-repository plan.
test('start refuses a plan reached through a link that leads out of the repository', () => {
  const home = tmp('rs-home5-');
  const repo = tmp('rs-repo5-');
  const outside = tmp('rs-out5-');
  try {
    spawnSync('git', ['init', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(outside, 'x.plan.md'), '---\nstatus: approved\n---\n# x\n');
    fs.symlinkSync(outside, path.join(repo, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const r = runScript('run-session.mjs', ['start', '--plan', 'linked/x.plan.md', '--repo-root', repo], { env: { QUORATE_HOME: home }, cwd: repo });
    assert.notEqual(r.status, 0, 'a plan outside the repository, through a link, was started on');
    assert.match(r.stderr, /no plan at/);
  } finally {
    for (const d of [home, repo, outside]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('the session-start hook never fails the session: bad input, inside a graph node, or no repository print nothing', () => {
  const home = tmp('rs-home2-');
  try {
    for (const [input, extra] of [['not json', {}], ['{"session_id":"x"}', { GRAPH_NODE_DEPTH: '1' }]]) {
      const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'run-session.mjs'), '--session-start'], {
        cwd: os.tmpdir(), env: { ...process.env, QUORATE_HOME: home, ...extra }, input, encoding: 'utf8',
      });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
    }
    const nested = runScript('run-session.mjs', ['status'], { env: { QUORATE_HOME: home, GRAPH_NODE_DEPTH: '1' } });
    assert.equal(nested.status, 3, 'the commands refuse inside a graph node (§8)');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
