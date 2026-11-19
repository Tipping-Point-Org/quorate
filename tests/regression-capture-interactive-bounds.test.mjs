// CAPTURE'S INTERACTIVE FRONT END, ITS BOUNDS (remediation 20261116-005000-ci-remediation-3 of review
// 20261116-001508-ci-review-2). Each test names the group it exists for:
//   G-14  the per-stream output cap, review.capture_max_mb (absent = 1024 MB), status output_cap_reached, tree stopped
//   G-16  that key and that status documented in shared/claude-md-contract.md (I-14)
//   G-17  the contract no longer says commands.shell is "never consulted", which the code contradicts
//   G-2   --interactive refused inside a graph node, past which --mode run would escape the depth rule
//   G-7   the node runtime's authentication variables do not reach the command
//   G-8   a missing --stdin-file consumes no label and leaves no half-written evidence
//   G-15  an exact declared command with a read-only prefix is admitted as the contract wrote it
//   G-18  the doctrine no longer writes a bare `node capture.mjs …` a reader could copy and run

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, TEST_HOME } from './helpers.mjs';
import * as ci from '../scripts/io/capture-interactive.mjs';
import { admitCommand, readOnlyPrefixes } from '../scripts/lib/capture-admit.mjs';
const FAKE_KEY = ['sk', 'test', 'not', 'a', 'key'].join('-');

const CAPTURE = path.join(REPO_ROOT, 'scripts', 'capture.mjs');
const evidence = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-iab-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const baseEnv = () => ({ ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, QUORATE_HOME: TEST_HOME });

test('G-14: review.capture_max_mb is read, absent = 1024 MB, and a value that is not a number > 0 is refused', () => {
  assert.equal(typeof ci.captureMaxBytesFrom, 'function', 'no reader of review.capture_max_mb exists');
  assert.equal(ci.captureMaxBytesFrom({}), 1024 * 1024 * 1024);
  assert.equal(ci.captureMaxBytesFrom({ review: { capture_max_mb: 2 } }), 2 * 1024 * 1024);
  for (const bad of ['', null, 0, -1, 'lots']) assert.throws(() => ci.captureMaxBytesFrom({ review: { capture_max_mb: bad } }), /capture_max_mb/);
});

test('G-14: a stream reaching the cap keeps exactly the bytes up to it, stops the tree, and fails with output_cap_reached', async (t) => {
  const e = evidence(t);
  const cap = 0.01;   // MB
  const capBytes = Math.floor(cap * 1024 * 1024);
  const started = Date.now();
  const r = await ci.runInteractive({ source: 'node -e "process.stdout.write(Buffer.alloc(2000000,120));setTimeout(()=>{},20000)"',
    mode: 'run', evidenceDir: e, name: 'cap', cwd: REPO_ROOT, quiet: true, timeoutMinutes: 1, captureMaxMb: cap, env: baseEnv() });
  const status = JSON.parse(fs.readFileSync(path.join(e, 'cap', 'status.json'), 'utf8'));
  assert.equal(status.status, 'output_cap_reached', r.report);
  assert.equal(fs.statSync(path.join(e, 'cap', 'stdout')).size, capBytes);
  assert.notEqual(r.code, 0);
  assert.equal(status.timed_out, false, 'the tree was left to the deadline rather than stopped at the cap');
  assert.ok(Date.now() - started < 12_000);
});

test('G-16, G-17: the contract documents capture_max_mb and output_cap_reached, and no longer says commands.shell is never consulted', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8');
  assert.match(doc, /capture_max_mb/);
  assert.match(doc, /output_cap_reached/);
  assert.doesNotMatch(doc, /`commands\.shell` is never consulted/);
});

test('G-2: --interactive is refused inside a graph node', (t) => {
  const e = evidence(t);
  const r = spawnSync(process.execPath, [CAPTURE, '--interactive', '--mode', 'run', '--evidence-dir', e, '--name', 'node', '--',
    'node -e "1"'], { cwd: REPO_ROOT, encoding: 'utf8', env: { ...baseEnv(), GRAPH_NODE_DEPTH: '1' } });
  // Exit 3, the code shared/disk-first-protocol.md §8 gives every depth guard; and an unreadable depth fails closed too.
  assert.equal(r.status, 3, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /graph node/);
  assert.equal(fs.existsSync(path.join(e, 'node')), false);
  const unreadable = spawnSync(process.execPath, [CAPTURE, '--interactive', '--mode', 'run', '--evidence-dir', e, '--name', 'bad', '--',
    'node -e "1"'], { cwd: REPO_ROOT, encoding: 'utf8', env: { ...baseEnv(), GRAPH_NODE_DEPTH: 'x' } });
  assert.equal(unreadable.status, 3, `an unreadable depth was admitted: ${unreadable.stdout}${unreadable.stderr}`);
});

test('G-7: the node runtime\'s authentication variables do not reach the command', async (t) => {
  const e = evidence(t);
  const r = await ci.runInteractive({ source: 'node -e "process.stdout.write(String(process.env.ANTHROPIC_API_KEY))"',
    mode: 'run', evidenceDir: e, name: 'env', cwd: REPO_ROOT, quiet: true, timeoutMinutes: 1,
    env: { ...baseEnv(), ANTHROPIC_API_KEY: FAKE_KEY /* a made-up value, built at runtime (.gitleaksignore's convention) */ } });
  assert.equal(r.code, 0, r.report);
  assert.equal(fs.readFileSync(path.join(e, 'env', 'stdout'), 'utf8'), 'undefined');
});

test('G-8: a missing --stdin-file consumes no label and writes no evidence', async (t) => {
  const e = evidence(t);
  const r = await ci.runInteractive({ source: 'node -e "1"', mode: 'run', evidenceDir: e, name: 'nostdin', cwd: REPO_ROOT,
    stdinFile: path.join(e, 'absent.txt'), timeoutMinutes: 1, env: baseEnv() });
  assert.equal(r.code, 2, r.report);
  assert.equal(fs.existsSync(path.join(e, 'nostdin')), false, 'the label was made before the file was checked');
});

test('G-15: an exact declared command is admitted even when it begins with a read-only prefix', () => {
  const argv = ['git', 'diff', '--output=diff.txt'];
  const ro = readOnlyPrefixes(path.join(REPO_ROOT, 'scripts', 'find-inert-features.mjs'));
  assert.equal(admitCommand(argv, { declared: [], readOnly: ro, repoRoot: REPO_ROOT }).ok, false, 'the undeclared form stays refused');
  const r = admitCommand(argv, { declared: [{ key: 'test', argv }], readOnly: ro, repoRoot: REPO_ROOT });
  assert.equal(r.ok, true, r.why);
});

test('G-18: the doctrine writes no bare `node capture.mjs …` command', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8');
  assert.doesNotMatch(doc, /`node capture\.mjs …`/);
});

// Remediation 20261116-025551-ci-remediation-5 of review 20261116-021143-ci-remediation-4-review.
test('G-9 (r5): when only `combined` passes the cap, status names combined, not the incoming stream', async (t) => {
  const e = evidence(t);
  const cap = 0.01;
  const half = Math.floor(cap * 1024 * 1024 * 0.7);
  const r = await ci.runInteractive({ source: `node -e "process.stdout.write(Buffer.alloc(${half},120));process.stderr.write(Buffer.alloc(${half},121));setTimeout(()=>{},20000)"`,
    mode: 'run', evidenceDir: e, name: 'comb', cwd: REPO_ROOT, quiet: true, timeoutMinutes: 1, captureMaxMb: cap, env: baseEnv() });
  const status = JSON.parse(fs.readFileSync(path.join(e, 'comb', 'status.json'), 'utf8'));
  assert.equal(status.output_cap_reached, 'combined', r.report);
});

test('G-4 (r5): a finite capture_max_mb whose byte count overflows to Infinity is refused', () => {
  assert.throws(() => ci.captureMaxBytesFrom({ review: { capture_max_mb: 1e303 } }), /capture_max_mb/);
});

test('G-5 (r5): a resolved .cmd path holding % or ! is refused, as an argument holding them is', () => {
  for (const dir of [path.win32.join('C:', 'a%PATH%b'), path.win32.join('C:', 'a!x!b')]) {
    const env = { PATH: dir, PATHEXT: '.CMD' };
    const exists = (p) => p === path.win32.join(dir, 'tool.CMD');
    const r = ci.launchFor(['tool', 'ok'], { cwd: path.win32.join('C:', path.win32.sep), env, platform: 'win32', exists });
    assert.ok(r.refused, `the path ${dir} reached cmd.exe: ${JSON.stringify(r)}`);
  }
});

test('G-11 (r5): a contract that could not be read refuses the run rather than choosing the default runtime', async (t) => {
  const e = evidence(t);
  const r = await ci.runInteractive({ source: 'node -e "1"', mode: 'run', evidenceDir: e, name: 'noread', cwd: REPO_ROOT, quiet: true,
    timeoutMinutes: 1, env: baseEnv(), readContractFn: () => ({ error: 'the printed contract did not parse (test)' }) });
  assert.equal(r.code, 2, r.report);
  assert.match(r.report, /contract/);
  assert.equal(fs.existsSync(path.join(e, 'noread')), false);
});

test('G-3 (r5): labels older than review.session_record_retention_days are pruned, and only this front end\'s own', async (t) => {
  const e = evidence(t);
  const old = path.join(e, 'old');
  fs.mkdirSync(old);
  for (const f of ['stdout', 'stderr', 'combined', 'argv.json']) fs.writeFileSync(path.join(old, f), '');
  fs.writeFileSync(path.join(old, 'status.json'), JSON.stringify({ schema_version: 1, writer: ci.WRITER, label: 'old' }));
  const foreign = path.join(e, 'foreign');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'notes.txt'), 'not a label');
  const past = new Date(Date.now() - 40 * 86_400_000);
  for (const p of [path.join(old, 'status.json'), path.join(foreign, 'notes.txt')]) fs.utimesSync(p, past, past);
  const r = await ci.runInteractive({ source: 'node -e "1"', mode: 'run', evidenceDir: e, name: 'new', cwd: REPO_ROOT, quiet: true,
    timeoutMinutes: 1, env: baseEnv(), readContractFn: () => ({ contract: { review: { session_record_retention_days: 30 } } }) });
  assert.equal(r.code, 0, r.report);
  assert.equal(fs.existsSync(old), false, 'a label past the retention age was kept');
  assert.equal(fs.existsSync(foreign), true, 'a directory this front end did not write was pruned');
  assert.equal(fs.existsSync(path.join(e, 'new', 'status.json')), true);
});

test('G-14 (r5): a command not on PATH is a stage that could not start, exit 127, not a refusal', async (t) => {
  const e = evidence(t);
  const r = await ci.runInteractive({ source: 'q-no-such-command-r5', mode: 'run', evidenceDir: e, name: 'missing', cwd: REPO_ROOT,
    quiet: true, timeoutMinutes: 1, env: baseEnv() });
  assert.equal(r.code, 127, r.report);
  const status = JSON.parse(fs.readFileSync(path.join(e, 'missing', 'status.json'), 'utf8'));
  assert.equal(status.stages.length, 1);
  assert.equal(status.stages[0].error, 'ENOENT');
});

test('G-15 (r5): each stage of a pipeline has its own stderr file', async (t) => {
  const e = evidence(t);
  const r = await ci.runInteractive({ source: `node -e "process.stderr.write('A1')" | node -e "process.stderr.write('B2')"`,
    mode: 'run', evidenceDir: e, name: 'per', cwd: REPO_ROOT, quiet: true, timeoutMinutes: 1, env: baseEnv() });
  assert.equal(r.code, 0, r.report);
  assert.equal(fs.readFileSync(path.join(e, 'per', 'stderr.stage-1'), 'utf8'), 'A1');
  assert.equal(fs.readFileSync(path.join(e, 'per', 'stderr.stage-2'), 'utf8'), 'B2');
  assert.equal(ci.fetchSaved({ evidenceDir: e, name: 'per', stream: 'stderr.stage-2', mode: 'run' }).report, 'B2');
});

test('G-13 (r5): a stage stopped by its downstream is reported with its own exit and the --strict note', async (t) => {
  const e = evidence(t);
  const r = await ci.runInteractive({ source: `node -e "setInterval(()=>process.stdout.write('x'.repeat(65536)),1)" | node -e "process.exit(0)"`,
    mode: 'run', evidenceDir: e, name: 'down', cwd: REPO_ROOT, quiet: true, timeoutMinutes: 1, env: baseEnv() });
  assert.match(r.report, /stage 1 stopped by its downstream \((exit|signal) [^;]+; counted as stopped, not failed, unless --strict\)/, r.report);
});

test('G-10 (r5): a survivor of the cap stop is phrased by the stop vocabulary, not inline', async () => {
  const { stopRecord } = await import('../scripts/lib/stop-vocabulary.mjs');
  const said = ci.capNote('stdout', 10, [{ stage: 0, outcome: 'unconfirmed', pid: 4242 }]);
  assert.ok(said.includes(stopRecord({ outcome: 'unconfirmed', pid: 4242, context: 'captured' }).sentence), said);
});

test('G-17 (r5): an upstream stage is stopped once, however many downstream stages close', async () => {
  const { runPipeline } = await import('../scripts/io/run-pipeline.mjs');
  const { EventEmitter } = await import('node:events');
  const calls = [];
  let pid = 100;
  const spawn = () => {
    const k = Object.assign(new EventEmitter(), { pid: pid++, stdout: null, stderr: null });
    if (k.pid > 100) setImmediate(() => k.emit('close', 0, null));
    return k;
  };
  const stop = (k) => { calls.push(k.pid); setImmediate(() => k.emit('close', null, 'SIGTERM')); return Promise.resolve({ outcome: 'exited', pid: k.pid }); };
  const stages = [0, 1, 2].map(() => ({ cmd: 'x', args: [], shell: false }));
  await runPipeline(stages, { cwd: REPO_ROOT, env: {}, spawn, stop, graceMs: 0 });
  assert.deepEqual(calls, [100], `stage 1 was stopped ${calls.length} times`);
});

test('G-6 (r5): the saved streams are owner-only on POSIX', { skip: process.platform === 'win32' ? 'mode bits are not POSIX on win32' : false }, async (t) => {
  const e = evidence(t);
  await ci.runInteractive({ source: 'node -e "1"', mode: 'run', evidenceDir: e, name: 'mode', cwd: REPO_ROOT, quiet: true,
    timeoutMinutes: 1, env: baseEnv() });
  for (const f of ['stdout', 'stderr', 'combined', 'status.json', 'argv.json']) {
    assert.equal(fs.statSync(path.join(e, 'mode', f)).mode & 0o077, 0, `${f} is readable by others`);
  }
});

// Amended by G-5 and G-19 of 20261116-031337-ci-remediation-5-review: the plan's stage 7 says "a stream reaching it stops",
// so the contract says reaching, and the code stops at the cap rather than one byte past it.
test('G-18 (r5): the contract says output reaching the cap stops the tree, and that a stop not confirmed is named', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8');
  assert.doesNotMatch(doc, /output past it stops/, 'the contract still says only output past the cap stops the tree');
  assert.match(doc, /reaching it stops the command's tree/);
});

// G-12 of 20261116-221234-m2-9a-high-2: past SUBST_MAX_BYTES a "$( )" only noted it was over, and its command ran on to
// its own exit, the output cap or the deadline, although the outcome was already decided.
test('G-12 (9a-high-2): a "$( )" printing past its limit is stopped there, not left to run', async (t) => {
  const e = evidence(t);
  const started = Date.now();
  const r = await ci.runInteractive({
    source: `node -e "process.exit(0)" "$(node -e 'process.stdout.write(Buffer.alloc(${ci.SUBST_MAX_BYTES + 65536},120));setTimeout(()=>{},30000)')"`,
    mode: 'run', evidenceDir: e, name: 'subst-over', cwd: REPO_ROOT, quiet: true, timeoutMinutes: 1, env: baseEnv() });
  assert.notEqual(r.code, 0, r.report);
  assert.match(r.report, /past what a "\$\( \)" may substitute/, r.report);
  assert.ok(Date.now() - started < 20_000, `the substitution's command ran on for ${Date.now() - started} ms after it was over`);
});

// G-14 of 20261116-221234-m2-9a-high-2: --fetch read the saved stream as UTF-8 and printed it with a newline added, then
// called process.exit after the write, so bytes that are not UTF-8 came back as U+FFFD and the "byte-exact" save was not
// what a fetch returned.
test('G-14 (9a-high-2): --fetch returns the saved stream byte for byte', (t) => {
  const e = evidence(t);
  const env = baseEnv();
  const cap = spawnSync(process.execPath, [CAPTURE, '--interactive', '--mode', 'run', '--evidence-dir', e, '--name', 'bytes', '--quiet', '--',
    'node -e "process.stdout.write(Buffer.from([0xff,0xfe,0x80,0x41,0x0a,0xc3]))"'], { cwd: REPO_ROOT, env });
  assert.equal(cap.status, 0, String(cap.stdout) + String(cap.stderr));
  const saved = fs.readFileSync(path.join(e, 'bytes', 'stdout'));
  assert.deepEqual([...saved], [0xff, 0xfe, 0x80, 0x41, 0x0a, 0xc3]);
  const f = spawnSync(process.execPath, [CAPTURE, '--interactive', '--mode', 'read-only', '--evidence-dir', e, '--name', 'bytes',
    '--fetch', 'stdout'], { cwd: REPO_ROOT, env });
  assert.equal(f.status, 0, String(f.stderr));
  assert.deepEqual([...f.stdout], [...saved], 'the fetched bytes are not the saved bytes');
});
