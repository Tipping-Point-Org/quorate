// CAPTURE'S INTERACTIVE FRONT END (capture-interactive.plan.md stage 4, the operator's decisions in its stage 2). Driven
// through `capture.mjs --interactive`, as a session would call it, with an evidence directory outside any repository.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, TEST_HOME } from './helpers.mjs';
import { resolveCommand, launchFor, previewLinesFrom } from '../scripts/io/capture-interactive.mjs';

const CAPTURE = path.join(REPO_ROOT, 'scripts', 'capture.mjs');
const evidence = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ia-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const run = (args, cwd = REPO_ROOT) => {
  const r = spawnSync(process.execPath, [CAPTURE, ...args], { cwd, encoding: 'utf8',
    env: { ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, QUORATE_HOME: TEST_HOME } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('a command runs with its streams kept apart, each on disk, its argv recorded and its status written', (t) => {
  const e = evidence(t);
  const r = run(['--interactive', '--mode', 'run', '--evidence-dir', e, '--name', 'one', '--',
    'node -e "console.log(\'out-line\'); console.error(\'err-line\'); process.exit(4)"']);
  assert.equal(r.code, 4, r.out);
  assert.match(r.out, /capture: exit 4 · stdout \d+ B · stderr \d+ B/);
  assert.match(r.out, /--- stdout[^\n]*\nout-line/);
  assert.match(r.out, /--- stderr[^\n]*\nerr-line/);
  const dir = path.join(e, 'one');
  assert.equal(fs.readFileSync(path.join(dir, 'stdout'), 'utf8').trim(), 'out-line');
  assert.equal(fs.readFileSync(path.join(dir, 'stderr'), 'utf8').trim(), 'err-line');
  assert.match(fs.readFileSync(path.join(dir, 'combined'), 'utf8'), /out-line[\s\S]*err-line|err-line[\s\S]*out-line/);
  const argv = JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8'));
  // Every command the string ran, inner ones included, each with its stages (stage 5: "$( )" and pipelines).
  assert.deepEqual(argv.commands[0].stages[0].argv.slice(0, 2), ['node', '-e']);
  assert.equal(argv.mode, 'run');
  const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  assert.equal(status.exit, 4);
  assert.equal(status.bytes.stderr > 0, true);
});

test('quiet returns status and sizes only; a label is used once; fetch returns a saved stream whole', (t) => {
  const e = evidence(t);
  const q = run(['--interactive', '--mode', 'run', '--evidence-dir', e, '--name', 'q', '--quiet', '--', 'node -e "console.log(7)"']);
  assert.equal(q.code, 0, q.out);
  assert.doesNotMatch(q.out, /---/);
  const again = run(['--interactive', '--mode', 'run', '--evidence-dir', e, '--name', 'q', '--', 'node -e "1"']);
  assert.equal(again.code, 2, again.out);
  assert.match(again.out, /used once/);
  const f = run(['--interactive', '--mode', 'read-only', '--evidence-dir', e, '--name', 'q', '--fetch', 'stdout']);
  assert.equal(f.code, 0, f.out);
  assert.equal(f.out.trim(), '7');
});

test('outside the subset is refused by name, and nothing runs or is written', (t) => {
  const e = evidence(t);
  for (const src of ['echo $HOME', 'ls *.js', 'a && b', 'echo `x`']) {
    const r = run(['--interactive', '--mode', 'run', '--evidence-dir', e, '--name', 'x', '--', src]);
    assert.equal(r.code, 2, `${src}: ${r.out}`);
    assert.match(r.out, /outside the subset/);
  }
  assert.deepEqual(fs.readdirSync(e), [], 'a refused command wrote evidence');
});

test('read-only applies the lens allow-list: an undeclared command is refused, a git inspection runs', (t) => {
  const e = evidence(t);
  const no = run(['--interactive', '--mode', 'read-only', '--evidence-dir', e, '--name', 'n', '--', 'node -e "1"']);
  assert.equal(no.code, 2, no.out);
  assert.match(no.out, /refusing to execute/);
  const tail = run(['--interactive', '--mode', 'read-only', '--evidence-dir', e, '--name', 'm', '--', 'git diff --output=x']);
  assert.equal(tail.code, 2, tail.out);
  const yes = run(['--interactive', '--mode', 'read-only', '--evidence-dir', e, '--name', 'g', '--quiet', '--', 'git rev-parse --is-inside-work-tree']);
  assert.equal(yes.code, 0, yes.out);
  assert.equal(fs.readFileSync(path.join(e, 'g', 'stdout'), 'utf8').trim(), 'true');
});

test('the mode is always stated, the front ends do not mix flags, and evidence never lands where git tracks it', (t) => {
  const e = evidence(t);
  assert.equal(run(['--interactive', '--evidence-dir', e, '--name', 'a', '--', 'node -e "1"']).code, 2, 'no --mode');
  assert.match(run(['--interactive', '--run-dir', e, '--mode', 'run', '--evidence-dir', e, '--name', 'a', '--', 'x']).out, /lens front end's/);
  assert.match(run(['--mode', 'run', '--run-dir', e, '--node', 'n', '--name', 'a', '--', 'git', 'status']).out, /belongs to --interactive/);
  const inside = path.join(REPO_ROOT, 'tests', `q-ia-tracked-${process.pid}`);
  const r = run(['--interactive', '--mode', 'run', '--evidence-dir', inside, '--name', 'a', '--', 'node -e "1"']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /not ignored/);
  assert.equal(fs.existsSync(inside), false, 'the refused evidence directory was created');
});

test('the preview masks a secret shape; the file keeps the bytes the command printed', (t) => {
  const e = evidence(t);
  const token = `ghp_${'A1b2C3d4E5'.repeat(4).slice(0, 36)}`;
  const r = run(['--interactive', '--mode', 'run', '--evidence-dir', e, '--name', 's', '--', `node -e "console.log('${token}')"`]);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, new RegExp(token), 'the preview showed the token');
  assert.equal(fs.readFileSync(path.join(e, 's', 'stdout'), 'utf8').trim(), token);
});

test('resolution and the Windows .cmd rule, decided offline', () => {
  const seen = new Set(['C:\\bin\\npm.cmd', 'C:\\bin\\node.exe', '/usr/bin/git']);
  const exists = (p) => seen.has(p);
  const winEnv = { PATH: 'C:\\bin', PATHEXT: '.exe;.cmd' };
  assert.equal(resolveCommand('npm', { cwd: 'C:\\w', env: winEnv, platform: 'win32', exists }), 'C:\\bin\\npm.cmd');
  assert.equal(resolveCommand('git', { cwd: '/w', env: { PATH: '/usr/bin' }, platform: 'linux', exists }), '/usr/bin/git');
  assert.equal(resolveCommand('nope', { cwd: '/w', env: { PATH: '/usr/bin' }, platform: 'linux', exists }), null);
  // A DIRECTORY named like the command, earlier in PATH, does not mask the real one (G-10 of 20261117-013640-m2-9a-final):
  // the default check takes a runnable regular file, as a shell skips such an entry. On the host, with real folders.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q-ia-path-'));
  try {
    const win = process.platform === 'win32';
    const file = win ? 'qtool.CMD' : 'qtool';
    const a = path.join(root, 'a'); const b = path.join(root, 'b');
    fs.mkdirSync(path.join(a, file), { recursive: true });
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(b, file), win ? '@echo off\r\n' : '#!/bin/sh\n', { mode: 0o755 });
    const env = { PATH: [a, b].join(path.delimiter), PATHEXT: '.CMD' };
    assert.equal(resolveCommand('qtool', { cwd: root, env }), path.join(b, file),
      'a directory earlier in PATH masked the runnable file after it');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  const cmd = launchFor(['npm', 'run', 'a b'], { cwd: 'C:\\w', env: winEnv, platform: 'win32', exists });
  assert.equal(cmd.shell, true);
  assert.deepEqual(cmd.args, ['run', '"a b"']);
  for (const bad of ['50%', 'hi!', 'say "x"']) {
    assert.match(launchFor(['npm', bad], { cwd: 'C:\\w', env: winEnv, platform: 'win32', exists }).refused, /cmd\.exe would reinterpret/);
  }
  assert.equal(launchFor(['node', '50%'], { cwd: 'C:\\w', env: winEnv, platform: 'win32', exists }).shell, false, 'an .exe takes any argument');
});

test('the preview default is the contract key, absent = 120, a bad value refused', () => {
  assert.equal(previewLinesFrom({}), 120);
  assert.equal(previewLinesFrom({ review: { capture_preview_lines: 40 } }), 40);
  assert.throws(() => previewLinesFrom({ review: { capture_preview_lines: 'many' } }), /whole number/);
});

// G-6 of 20261115-220919-ci-delivery: the work-tree probe ran git at the directory or its parent only, so a nested new
// path inside the repository (parent missing too) made git fail to start and was taken as outside any work tree.
test('a nested new evidence directory inside the work tree is refused, and nothing is created', () => {
  const top = path.join(REPO_ROOT, 'tests', `q-ia-nested-${process.pid}`);
  const inside = path.join(top, 'a', 'b');
  try {
    const r = run(['--interactive', '--mode', 'run', '--evidence-dir', inside, '--name', 'a', '--', 'node -e "1"']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /not ignored/);
    assert.equal(fs.existsSync(top), false, 'the refused nested evidence directory was created');
  } finally { fs.rmSync(top, { recursive: true, force: true }); }
});

// G-2 of 20261115-220919-ci-delivery: --fetch was served before --mode was checked, so a fetch stating no mode, or a
// mode that does not exist, succeeded while every interactive call is required to state one.
test('a fetch states its mode like every interactive call: none, or an unknown one, is refused', (t) => {
  const e = evidence(t);
  assert.equal(run(['--interactive', '--mode', 'run', '--evidence-dir', e, '--name', 'f', '--quiet', '--', 'node -e "console.log(1)"']).code, 0);
  const none = run(['--interactive', '--evidence-dir', e, '--name', 'f', '--fetch', 'stdout']);
  assert.equal(none.code, 2, none.out);
  assert.match(none.out, /--mode must be one of/);
  const bad = run(['--interactive', '--mode', 'whatever', '--evidence-dir', e, '--name', 'f', '--fetch', 'stdout']);
  assert.equal(bad.code, 2, bad.out);
  const ok = run(['--interactive', '--mode', 'read-only', '--evidence-dir', e, '--name', 'f', '--fetch', 'stdout']);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(ok.out.trim(), '1');
});

// G-17 of 20261115-220919-ci-delivery: the contract says every value but a whole number >= 0 is refused, and null and ""
// were taken as absent, running at 120 with no diagnostic.
test('review.capture_preview_lines declared empty or null is refused, not read as absent', () => {
  assert.throws(() => previewLinesFrom({ review: { capture_preview_lines: '' } }), /whole number/);
  assert.throws(() => previewLinesFrom({ review: { capture_preview_lines: null } }), /whole number/);
  assert.equal(previewLinesFrom({ review: {} }), 120);
});

// G-10 of 20261115-220919-ci-delivery: --stdin-file was read whole into one string before the command started. It is now
// the first stage's descriptor, streamed; this holds that the bytes still arrive, and that a stage's own `<` still wins.
test('--stdin-file reaches the first stage byte for byte, and a `<` the stage names wins over it', (t) => {
  const e = evidence(t);
  const inFile = path.join(e, 'in.txt');
  fs.writeFileSync(inFile, 'line-one\nline-two\n');
  const r = run(['--interactive', '--mode', 'run', '--evidence-dir', e, '--name', 'si', '--quiet', '--stdin-file', inFile, '--',
    'node -e "process.stdin.pipe(process.stdout)"']);
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(path.join(e, 'si', 'stdout'), 'utf8'), 'line-one\nline-two\n');
  const other = path.join(e, 'other.txt');
  fs.writeFileSync(other, 'from-redirect\n');
  const w = run(['--interactive', '--mode', 'run', '--evidence-dir', e, '--name', 'sw', '--quiet', '--stdin-file', inFile, '--',
    `node -e "process.stdin.pipe(process.stdout)" < ${other.split(path.sep).join('/')}`]);
  assert.equal(w.code, 0, w.out);
  assert.equal(fs.readFileSync(path.join(e, 'sw', 'stdout'), 'utf8'), 'from-redirect\n');
  const missing = run(['--interactive', '--mode', 'run', '--evidence-dir', e, '--name', 'sm', '--stdin-file', path.join(e, 'none'), '--', 'node -e "1"']);
  assert.equal(missing.code, 2, missing.out);
});
