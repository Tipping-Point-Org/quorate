// PIPELINES, REDIRECTIONS AND "$( )" IN CAPTURE'S INTERACTIVE FRONT END (capture-interactive.plan.md stage 5; the
// handover's H#L105-L139; the operator's decisions 3 and 6 of the plan's stage 2 and decisions 4-6 of 2026-10-19). Built by
// the runner, scripts/io/run-pipeline.mjs, with no shell: every stage at once, pipefail by construction, a stage stopped
// by its downstream named as such, and every inner command run and captured before the command that uses it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, TEST_HOME } from './helpers.mjs';
import { runPipeline, pipelineExit } from '../scripts/io/run-pipeline.mjs';

const CAPTURE = path.join(REPO_ROOT, 'scripts', 'capture.mjs');
const evidence = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-pipe-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
// Forward slashes: inside the command string an unquoted backslash is a POSIX escape.
const fwd = (p) => p.split(path.sep).join('/');
const run = (e, name, src, extra = []) => {
  const r = spawnSync(process.execPath, [CAPTURE, '--interactive', '--mode', 'run', '--evidence-dir', e, '--name', name, ...extra, '--', src],
    { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, QUORATE_HOME: TEST_HOME } });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, status: () => JSON.parse(fs.readFileSync(path.join(e, name, 'status.json'), 'utf8')) };
};
const PRODUCER = `node -e "setInterval(()=>process.stdout.write('x\\n'),5)"`;
const TAKES_ONE = `node -e "process.stdin.once('data',()=>process.exit(0))"`;

test('a pipeline joins its stages through the runner, and the last stage\'s output is the result', (t) => {
  const e = evidence(t);
  const r = run(e, 'p', `node -e "console.log('a\\nb\\nc')" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(s.trim().split('\\n').length))"`);
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(path.join(e, 'p', 'stdout'), 'utf8').trim(), '3');
  assert.equal(r.status().stages.length, 2);
});

test('a stage stopped by its downstream is its own state, not a failure; --strict makes it one', (t) => {
  const e = evidence(t);
  const loose = run(e, 'loose', `${PRODUCER} | ${TAKES_ONE}`, ['--quiet']);
  assert.equal(loose.code, 0, loose.out);
  assert.match(loose.out, /stage 1 stopped by its downstream/);
  assert.equal(loose.status().stages[0].terminated_by_downstream_exit, true);
  const strict = run(e, 'strict', `${PRODUCER} | ${TAKES_ONE}`, ['--quiet', '--strict']);
  assert.notEqual(strict.code, 0, strict.out);
});

test('pipefail by construction: a failing stage before a succeeding one fails the pipeline with its code', (t) => {
  const e = evidence(t);
  const r = run(e, 'f', `node -e "process.exit(5)" | node -e "process.stdin.resume()"`, ['--quiet']);
  assert.equal(r.code, 5, r.out);
});

test('"$( )" inside double quotes runs first, is captured, and its output is substituted without its trailing newline', (t) => {
  const e = evidence(t);
  const r = run(e, 's', `node -e "console.log(process.argv[1])" "got=$(node -e "console.log(42)")"`);
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(path.join(e, 's', 'stdout'), 'utf8').trim(), 'got=42');
  assert.equal(fs.readFileSync(path.join(e, 's', 'subst-1', 'stdout'), 'utf8').trim(), '42', 'the inner command was not captured');
  const argv = JSON.parse(fs.readFileSync(path.join(e, 's', 'argv.json'), 'utf8'));
  assert.ok(argv.commands.some((c) => c.stages[0].argv.includes('got=42')), 'the resolved argv was not recorded');
});

test('a failing inner command fails the whole before anything after it runs', (t) => {
  const e = evidence(t);
  const marker = fwd(path.join(e, 'ran'));
  const r = run(e, 'x', `node -e "1" "$(node -e "process.exit(3)")" "$(node -e "require('fs').writeFileSync('${marker}','y')")"`, ['--quiet']);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /exited 3; nothing after it ran/);
  assert.equal(fs.existsSync(path.join(e, 'ran')), false, 'a command after the failing one ran');
});

test('redirections: > writes a file, 2>&1 joins stderr to it, < reads one, all relative to the caller\'s directory', (t) => {
  const e = evidence(t);
  const out = fwd(path.join(e, 'out.txt'));
  const w = run(e, 'w', `node -e "console.log('to-file'); console.error('err')" > ${out} 2>&1`, ['--quiet']);
  assert.equal(w.code, 0, w.out);
  assert.deepEqual(fs.readFileSync(path.join(e, 'out.txt'), 'utf8').trim().split(/\r?\n/), ['to-file', 'err']);
  const r = run(e, 'r', `node -e "process.stdin.pipe(process.stdout)" < ${out}`, ['--quiet']);
  assert.equal(r.code, 0, r.out);
  assert.match(fs.readFileSync(path.join(e, 'r', 'stdout'), 'utf8'), /to-file/);
});

test('read-only admits no redirection but 2>&1, and holds every stage and every inner command to the allow-list', (t) => {
  const e = evidence(t);
  const ro = (name, src) => spawnSync(process.execPath, [CAPTURE, '--interactive', '--mode', 'read-only', '--evidence-dir', e, '--name', name, '--quiet', '--', src],
    { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, QUORATE_HOME: TEST_HOME } });
  assert.equal(ro('a', 'git status > x.txt').status, 2);
  assert.equal(ro('b', 'git status | node -e "1"').status, 2, 'a second stage outside the allow-list ran');
  assert.equal(ro('c', 'git log "$(node -e "console.log(1)")"').status, 2, 'an inner command outside the allow-list ran');
  assert.equal(ro('d', 'git rev-parse --is-inside-work-tree 2>&1').status, 0);
});

test('the runner\'s deadline stops every stage still running, and says it was the deadline', async () => {
  const forever = { cmd: process.execPath, args: ['-e', 'setInterval(()=>{},1e3)'], shell: false };
  const r = await runPipeline([forever, forever], { cwd: REPO_ROOT, env: process.env, timeoutMs: 500 });
  assert.equal(r.timedOut, true);
  assert.equal(pipelineExit(r), 124);
  assert.ok(r.stopSentence, 'the stop is said in the owner\'s words');
});

test('the exit rule, decided offline: rightmost failure, a stage that could not start, downstream stops by --strict', () => {
  const ok = { status: 0, terminated_by_downstream_exit: false };
  assert.equal(pipelineExit({ stages: [{ status: 2 }, ok] }), 2);
  assert.equal(pipelineExit({ stages: [{ status: 2 }, { status: 7 }] }), 7);
  assert.equal(pipelineExit({ stages: [{ status: null, error: new Error('ENOENT') }, ok] }), 127);
  assert.equal(pipelineExit({ stages: [{ status: 1, terminated_by_downstream_exit: true }, ok] }), 0);
  assert.equal(pipelineExit({ stages: [{ status: 1, terminated_by_downstream_exit: true }, ok] }, { strict: true }), 1);
});

// G-11 of 20261115-220919-ci-delivery: `2>&1` was a flag set whatever its position, so `2>&1 > f` put stderr in f where
// POSIX leaves it on the original stdout, and `2>&1 2> f` kept it merged where POSIX sends it to f. Redirections now apply
// in order; `2>&1` before stdout's own redirection, which the runner cannot express, is refused rather than run otherwise.
test('redirections apply in order: 2>&1 before > is refused, 2>&1 then 2> sends stderr to the file', (t) => {
  const e = evidence(t);
  const out = fwd(path.join(e, 'o.txt'));
  const before = run(e, 'b', `node -e "console.log('o'); console.error('x')" 2>&1 > ${out}`, ['--quiet']);
  assert.equal(before.code, 2, before.out);
  assert.match(before.out, /2>&1.*before/);
  assert.equal(fs.existsSync(path.join(e, 'o.txt')), false, 'a refused command opened its redirection');
  const err = fwd(path.join(e, 'err.txt'));
  const later = run(e, 'l', `node -e "console.log('o'); console.error('x')" 2>&1 2> ${err}`, ['--quiet']);
  assert.equal(later.code, 0, later.out);
  assert.equal(fs.readFileSync(path.join(e, 'err.txt'), 'utf8').trim(), 'x');
  assert.equal(fs.readFileSync(path.join(e, 'l', 'stdout'), 'utf8').trim(), 'o');
});
