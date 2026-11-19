// engine-git-env.plan.md (operator, 2026-10-23: G-D1 A, "continue" to the plans). Three reviews running found a git
// call outside the remediation runner's scoped wrapper carrying the operator's environment: G-9/G-11 of
// 20261023-073416-rer-remediation-2b-review, G-13 with G-2, G-3, G-10 of 20261023-081135-rer-remediation-3-review. A
// git process runs the repository's hooks, clean filters and fsmonitor, so whatever reaches git reaches them. Every git
// the engine starts now runs through one owner (scripts/io/git.mjs) in one policy (lib/decisions.mjs gitEnvFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitEnvFor } from '../scripts/lib/decisions.mjs';
import { gitSync, gitCommitSync, gitAsync } from '../scripts/io/git.mjs';

const SOURCE = {
  PATH: '/bin', HOME: '/h', GIT_AUTHOR_NAME: 'x', GIT_COMMITTER_EMAIL: 'c@x', SSH_AUTH_SOCK: '/tmp/agent.sock',
  GITHUB_TOKEN: 'ghp', AWS_SECRET_ACCESS_KEY: 'aws', DATABASE_URL: 'pg://', QUORATE_RUN_ID: 'r',
  ANTHROPIC_API_KEY: 'a', CLAUDE_CODE_OAUTH_TOKEN: 'o',
};
const GONE = ['GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL', 'QUORATE_RUN_ID', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];

test('stage 1: a read call loses secret-shaped names, the runtime auth, the run pin and the agent socket', () => {
  const env = gitEnvFor(SOURCE);
  for (const k of [...GONE, 'SSH_AUTH_SOCK']) assert.equal(k in env, false, `${k} reached git`);
  for (const k of ['PATH', 'HOME', 'GIT_AUTHOR_NAME', 'GIT_COMMITTER_EMAIL']) assert.equal(env[k], SOURCE[k], `${k} was lost`);
});

test('stage 1: a commit keeps the agent socket and the identity, and loses the same secrets', () => {
  const env = gitEnvFor(SOURCE, { commit: true });
  for (const k of GONE) assert.equal(k in env, false, `${k} reached the commit's hooks`);
  for (const k of ['SSH_AUTH_SOCK', 'GIT_AUTHOR_NAME', 'GIT_COMMITTER_EMAIL']) assert.equal(env[k], SOURCE[k], `${k} was lost`);
  // G-9 of 20261023-205906-ger-delivery: the keep-list matched exact case while SECRET_NAME folds, so on Windows, which
  // keeps a variable's stored case, a mixed-case socket, identity or config key was scrubbed from the commit.
  const folded = gitEnvFor({ Ssh_Auth_Sock: '/s', Git_Author_Name: 'n', Git_Config_Key_0: 'user.name', GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_VALUE_0: 'x', Github_Token: 'g' }, { commit: true });
  for (const k of ['Ssh_Auth_Sock', 'Git_Author_Name', 'Git_Config_Key_0']) assert.equal(k in folded, true, `${k} was lost by its case`);
  assert.equal('Github_Token' in folded, false, 'a mixed-case secret reached the commit');
});

test('stage 1: depth is at least 1, never lowered, and one spelling of it crosses (Windows keeps stored case)', () => {
  assert.equal(gitEnvFor({ PATH: '/bin' }).GRAPH_NODE_DEPTH, '1');
  assert.equal(gitEnvFor({ GRAPH_NODE_DEPTH: '0' }).GRAPH_NODE_DEPTH, '1');
  assert.equal(gitEnvFor({ GRAPH_NODE_DEPTH: '3' }).GRAPH_NODE_DEPTH, '3', 'a deeper caller is not reset to 1');
  assert.equal(gitEnvFor({ GRAPH_NODE_DEPTH: 'x' }).GRAPH_NODE_DEPTH, '1');
  const folded = gitEnvFor({ Graph_Node_Depth: '0', Ssh_Auth_Sock: '/s' });
  assert.deepEqual(Object.keys(folded).filter((k) => /graph_node_depth|ssh_auth_sock/i.test(k)), ['GRAPH_NODE_DEPTH']);
});

test('stage 1: the owner refuses `env` and any git variable outside its allow-list', () => {
  assert.throws(() => gitSync(['--version'], { env: { PATH: process.env.PATH } }), /option 'env' is not accepted/);
  assert.throws(() => gitSync(['--version'], { gitVars: { GIT_CONFIG_PARAMETERS: "'x.y=z'" } }), /GIT_CONFIG_PARAMETERS' refused/);
  assert.throws(() => gitSync(['--version'], { gitVars: { GITHUB_TOKEN: 'x' } }), /refused/);
  // G-7 of 20261023-205906-ger-delivery: gitCommitSync gave the agent socket to whatever it was asked to run.
  for (const a of [['status'], ['-c', 'x.y=z', 'status'], ['-C', '.', 'commit'], ['-c', 'x.y=z'], [],
    ['--literal-pathspecs', 'status']]) {
    assert.throws(() => gitCommitSync(a), /runs only `git commit`/, `not refused: ${JSON.stringify(a)}`);
  }
  // G-6 of 20261023-214545-ger-remediation-review: gitAsync accepted the sync options and shAsync ignored them (stdin is
  // `ignore`, its cap and decoding fixed), so `input`, `maxBuffer` and `encoding` were dropped in silence. Refused alike.
  for (const k of ['input', 'maxBuffer', 'encoding']) {
    assert.throws(() => gitAsync(['--version'], { [k]: k === 'maxBuffer' ? 1 : 'x' }), new RegExp(`option '${k}' is not accepted`), `${k} not refused`);
  }
});

// What a git hook or filter actually sees: git runs a `!`-alias through its shell with git's own environment.
function seenByGit(call, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qge-'));
  try {
    spawnSync('git', ['init', '-q', dir]);
    const dump = '!node -e "process.stdout.write(JSON.stringify(process.env))"';
    const r = call(['-c', `alias.qenv=${dump}`, 'qenv'], { cwd: dir, encoding: 'utf8', ...opts });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// What a commit's hook sees: gitCommitSync runs only `git commit` (G-7), so its environment is read from a pre-commit hook.
function seenByCommit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qge-'));
  try {
    spawnSync('git', ['init', '-q', dir]);
    const hooks = path.join(dir, 'qhooks');
    fs.mkdirSync(hooks);
    spawnSync('git', ['-C', dir, 'config', 'core.hooksPath', hooks]);
    // An identity of the repository's own: git refuses a commit with none BEFORE the pre-commit hook runs, and a CI
    // runner has none (ubuntu: ENOENT on env.json, the hook never ran), so the hook's view was never read there.
    spawnSync('git', ['-C', dir, 'config', 'user.name', 'qge']);
    spawnSync('git', ['-C', dir, 'config', 'user.email', 'qge@example.invalid']);
    const out = path.join(dir, 'env.json').split(path.sep).join('/');
    fs.writeFileSync(path.join(hooks, 'pre-commit'),
      `#!/bin/sh\nnode -e "require('fs').writeFileSync('${out}', JSON.stringify(process.env))"\nexit 1\n`);
    fs.chmodSync(path.join(hooks, 'pre-commit'), 0o755);
    const r = gitCommitSync(['commit', '--allow-empty', '-qm', 'x'], { cwd: dir, encoding: 'utf8' });
    assert.ok(fs.existsSync(out), `the pre-commit hook never ran: git commit exited ${r.status}: ${r.stderr}`);
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('stage 1: what git runs sees the scoped environment, the socket only under gitCommitSync', () => {
  const planted = { ['QGE_PROBE_' + 'TOKEN']: 'secret', SSH_AUTH_SOCK: 'qge-agent.sock', QUORATE_RUN_ID: 'pin', GRAPH_NODE_DEPTH: '0' };
  const saved = Object.fromEntries(Object.keys(planted).map((k) => [k, process.env[k]]));
  Object.assign(process.env, planted);
  try {
    const read = seenByGit(gitSync);
    assert.equal(read.QGE_PROBE_TOKEN, undefined, 'a secret-shaped name reached what git ran');
    assert.equal(read.QUORATE_RUN_ID, undefined, 'the run pin reached what git ran');
    assert.equal(read.SSH_AUTH_SOCK, undefined, 'the agent socket reached a read call');
    assert.equal(read.GRAPH_NODE_DEPTH, '1');
    const commit = seenByCommit();
    assert.equal(commit.QGE_PROBE_TOKEN, undefined);
    assert.equal(commit.SSH_AUTH_SOCK, 'qge-agent.sock', 'the commit lost the agent socket it may sign with');
    const vars = seenByGit(gitSync, { gitVars: { GIT_LITERAL_PATHSPECS: '1' } });
    assert.equal(vars.GIT_LITERAL_PATHSPECS, '1', 'an allowed git variable did not reach git');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// STAGE 3, THE ADOPTION TEST: every git the engine spawns goes through scripts/io/git.mjs. The set is not a list kept
// here: it is every call in scripts/ whose first argument is the literal `git` (any quote style; a spawn function by
// name, through io.proc, or a helper such as sh('git', ...)), or a shell command string that begins with `git `. An
// array whose first element is 'git' is not a call (capture.mjs's allow-list, push-gate's gitleaks mode). Residual,
// stated in the plan: a git binary named through a variable is not matched.
const SCRIPTS = new URL('../scripts/', import.meta.url);
const OWNER = path.join('io', 'git.mjs');
const GIT_CALL = /(?<![\w$.[])(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*\(\s*(['"`])git\1\s*[,)]/;
const SHELL_GIT = /\b(?:exec|execSync)\(\s*(['"`])git\s/;

/** The git spawns in one file's source, as "line: text", comments skipped. */
// Matched across the whole source, not line by line: a call whose `'git'` sits on the line after `spawnSync(` was
// invisible to a per-line scan (G-16 of 20261023-205906-ger-delivery). Comments are blanked per line first, so the line
// numbers stand, and a call is named by the line it starts on.
export function gitSpawns(src) {
  const lines = src.split('\n');
  const code = lines.map((l) => l.replace(/^\s*(\/\/|\*|\/\*).*$/, '').replace(/\s\/\/\s.*$/, '')).join('\n');
  const starts = new Set();
  for (const re of [GIT_CALL, SHELL_GIT]) {
    for (const m of code.matchAll(new RegExp(re.source, 'g'))) starts.add(code.slice(0, m.index).split('\n').length);
  }
  return [...starts].sort((a, b) => a - b).map((n) => `${n}: ${lines[n - 1].trim()}`);
}

function scriptFiles(dir = fileURLToPath(SCRIPTS), rel = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? scriptFiles(path.join(dir, e.name), path.join(rel, e.name))
    : /\.(mjs|js)$/.test(e.name) ? [path.join(rel, e.name)] : []));
}

test('stage 3: the matcher names every planted form, and not the forms that are not a git spawn', () => {
  for (const s of ["spawnSync('git', ['status'])", 'spawn("git", a)', 'execFileSync(`git`, a)', "io.proc.spawnSync('git', a)",
    "sh('git', ['rev-parse'])", "await shAsync('git', a)", "execSync('git status')", 'exec("git log", cb)',
    // G-16 of 20261023-205906-ger-delivery: a call split across lines was invisible to a line-by-line scan.
    "spawnSync(\n  'git',\n  ['status'],\n)", "execSync(\r\n  'git status')"]) {
    assert.equal(gitSpawns(s).length, 1, `not named: ${s}`);
  }
  for (const s of ["['git', 'diff'],", "return ['git', repoRoot, '--redact'];", "// spawnSync('git', a)", " * sh('git', a) in prose",
    "spawnSync('gitleaks', a)", "spawnSync(cmd, a)", "gitSync(['status'])"]) {
    assert.deepEqual(gitSpawns(s), [], `named: ${s}`);
  }
});

test('stage 3: every git spawn in scripts/ is in scripts/io/git.mjs (A-29)', () => {
  const found = scriptFiles().filter((f) => f !== OWNER)
    .flatMap((f) => gitSpawns(fs.readFileSync(path.join(fileURLToPath(SCRIPTS), f), 'utf8')).map((s) => `scripts/${f.split(path.sep).join('/')}:${s}`));
  assert.deepEqual(found, [], `git spawned outside its owner:\n${found.join('\n')}`);
});

// STAGE 4: the rule the adoption test holds is stated where a reader looks for it.
test('stage 4: ARCHITECTURE A-29 names the owner, and shared/remediation.md states the rule for every engine git call', () => {
  const arch = fs.readFileSync(new URL('../ARCHITECTURE.md', import.meta.url), 'utf8');
  assert.match(arch, /### A-29 — Every git process the engine starts runs through one owner/);
  assert.match(arch, /scripts\/io\/git\.mjs/);
  const doc = fs.readFileSync(new URL('../shared/remediation.md', import.meta.url), 'utf8');
  assert.match(doc, /every git process the engine starts/i);
  assert.match(doc, /gitEnvFor/);
  assert.doesNotMatch(doc, /every git call the runner makes/, 'the rule is stated for the runner only');
  // G-11 and G-12 of 20261023-214545-ger-remediation-review: the hooks paragraph restated A-29's guarantees (the scrub, the
  // depth floor, the socket's routing), a second definition that had already drifted once. It cites the owner and keeps
  // only what is the residual's own.
  const hooks = doc.slice(doc.indexOf("The same holds for the project's pre-commit hooks")).split(/\n\s*\n/)[0];
  assert.ok(hooks.length > 100, 'the hooks paragraph was not found');
  assert.match(hooks, /A-29/);
  for (const restated of [/GRAPH_NODE_DEPTH/, /All but `git commit` drop/, /are stripped, keeping what git needs/, /`GIT_AUTHOR_`\/`GIT_COMMITTER_`/]) {
    assert.doesNotMatch(hooks, restated, `the hooks paragraph restates A-29: ${restated}`);
  }
});
