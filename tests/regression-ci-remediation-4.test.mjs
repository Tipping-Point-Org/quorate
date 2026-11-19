// CAPTURE'S INTERACTIVE FRONT END, REMEDIATION 20261116-015805-ci-remediation-4 of review 20261116-013621-review.
// Each test names the group it exists for:
//   G-7   the contract's runtime adapter decides which auth is removed from an interactive command, not the fixed set
//   G-3   output exactly at review.capture_max_mb is not output_cap_reached (the cap is on output beyond the limit)
//   G-4   `combined` is held to the cap like each stream it joins
//   G-6   an empty --stdin-file is refused, not run as no stdin
//   G-11  a stage that cannot start stops its upstream stages, so the pipeline exits 127 rather than waiting to 124
//   G-8   the output-cap report says the tree was stopped only when the stop owner saw every stage end
//   G-14  the doctrine names the declared-command exception to the read-only git tail rules
//   G-15  the doctrine no longer says capture.mjs carries no depth guard

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { REPO_ROOT, TEST_HOME } from './helpers.mjs';
import * as ci from '../scripts/io/capture-interactive.mjs';
import { runPipeline, pipelineExit } from '../scripts/io/run-pipeline.mjs';
const FAKE_KEY = ['sk', 'test', 'not', 'a', 'key'].join('-');

const evidence = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-cir4-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const baseEnv = () => ({ ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, QUORATE_HOME: TEST_HOME });

test('G-7: an interactive command loses the auth the chosen runtime adapter keeps, whatever its name', async (t) => {
  const e = evidence(t);
  const runtime = { node_runtime: { session_env: { keep_auth: ['OPENAI_API_KEY'] } } };
  const r = await ci.runInteractive({ source: 'node -e "process.stdout.write(String(process.env.OPENAI_API_KEY))"',
    mode: 'run', evidenceDir: e, name: 'env', cwd: REPO_ROOT, quiet: true, timeoutMinutes: 1, runtime,
    env: { ...baseEnv(), OPENAI_API_KEY: FAKE_KEY } }); // a made-up value, built at runtime (.gitleaksignore's convention)
  assert.equal(r.code, 0, r.report);
  assert.equal(fs.readFileSync(path.join(e, 'env', 'stdout'), 'utf8'), 'undefined', 'the runtime\'s credential reached the command');
});

// REVERSED by G-5 of 20261116-031337-ci-remediation-5-review, to the operator's rule (2026-11-15: "Cap per stream, stop
// and fail (Recommended)": a stream that REACHES the cap stops the tree and fails the call). This test pinned the earlier
// edge, output exactly at the cap left uncapped; changed in the session on the operator's word ("Fix that test, commit by
// hand, close (Recommended)").
test('G-3: output exactly at the cap reaches it: output_cap_reached, the call fails, the bytes kept', async (t) => {
  const e = evidence(t);
  const cap = 0.01;
  const capBytes = Math.floor(cap * 1024 * 1024);
  const r = await ci.runInteractive({ source: `node -e "process.stdout.write(Buffer.alloc(${capBytes},120))"`,
    mode: 'run', evidenceDir: e, name: 'exact', cwd: REPO_ROOT, quiet: true, timeoutMinutes: 1, captureMaxMb: cap, env: baseEnv() });
  const status = JSON.parse(fs.readFileSync(path.join(e, 'exact', 'status.json'), 'utf8'));
  assert.equal(status.status, 'output_cap_reached', r.report);
  assert.equal(r.code, 1, r.report);
  assert.equal(fs.statSync(path.join(e, 'exact', 'stdout')).size, capBytes);
});

test('G-4: combined is held to the cap when stdout and stderr together pass it', async (t) => {
  const e = evidence(t);
  const cap = 0.01;
  const capBytes = Math.floor(cap * 1024 * 1024);
  const half = Math.floor(capBytes * 0.7);
  const r = await ci.runInteractive({
    source: `node -e "process.stdout.write(Buffer.alloc(${half},120));process.stderr.write(Buffer.alloc(${half},121))"`,
    mode: 'run', evidenceDir: e, name: 'comb', cwd: REPO_ROOT, quiet: true, timeoutMinutes: 1, captureMaxMb: cap, env: baseEnv() });
  const combined = fs.statSync(path.join(e, 'comb', 'combined')).size;
  assert.ok(combined <= capBytes, `combined held ${combined} B past the ${capBytes} B cap`);
  const status = JSON.parse(fs.readFileSync(path.join(e, 'comb', 'status.json'), 'utf8'));
  assert.equal(status.status, 'output_cap_reached', r.report);
});

test('G-6: an empty --stdin-file is refused and consumes no label', async (t) => {
  const e = evidence(t);
  const r = await ci.runInteractive({ source: 'node -e "1"', mode: 'run', evidenceDir: e, name: 'emptystdin', cwd: REPO_ROOT,
    stdinFile: '', timeoutMinutes: 1, env: baseEnv() });
  assert.equal(r.code, 2, r.report);
  assert.equal(fs.existsSync(path.join(e, 'emptystdin')), false, 'the command ran with no stdin and used the label');
});

test('G-11: a stage that cannot start stops its upstream, so the pipeline exits 127 and does not wait for the deadline', async () => {
  const kids = [];
  const spawn = () => {
    const k = new EventEmitter();
    k.stdout = null; k.stderr = null; k.pid = 1000 + kids.length;
    const i = kids.length;
    kids.push(k);
    if (i === 1) setImmediate(() => k.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
    return k;
  };
  const stop = (k) => { setImmediate(() => k.emit('close', null, 'SIGTERM')); return Promise.resolve({ outcome: 'exited', pid: k.pid }); };
  const stages = [{ cmd: 'producer', args: [], shell: false }, { cmd: 'missing', args: [], shell: false }];
  const started = Date.now();
  const res = await runPipeline(stages, { cwd: REPO_ROOT, env: {}, timeoutMs: 3000, graceMs: 10, spawn, stop });
  assert.equal(res.timedOut, false, 'the upstream ran until the deadline');
  assert.equal(pipelineExit(res), 127);
  assert.ok(Date.now() - started < 2000);
});

test('G-14: the doctrine names the declared-command exception to the read-only git tail rules', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8');
  const at = doc.indexOf('What `capture.mjs` refuses in the tail of a read-only git command');
  assert.ok(at >= 0);
  assert.match(doc.slice(at, at + 1500), /exact(ly)? (match|matches) a declared command|exact declared command/);
});

test('G-15: the doctrine no longer says capture.mjs carries no depth guard', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8');
  assert.doesNotMatch(doc, /Two scripts deliberately carry no\s+guard, because a node must be able to call them at depth 1: `capture\.mjs`/);
});

test('G-11: a stage whose spawn throws stops its upstream too', async () => {
  const kids = [];
  const spawn = () => {
    if (kids.length === 1) { kids.push(null); throw Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' }); }
    const k = new EventEmitter();
    k.stdout = null; k.stderr = null; k.pid = 2000;
    kids.push(k);
    return k;
  };
  const stop = (k) => { setImmediate(() => k.emit('close', null, 'SIGTERM')); return Promise.resolve({ outcome: 'exited', pid: k.pid }); };
  const res = await runPipeline([{ cmd: 'producer', args: [], shell: false }, { cmd: 'bad', args: [], shell: false }],
    { cwd: REPO_ROOT, env: {}, timeoutMs: 3000, graceMs: 10, spawn, stop });
  assert.equal(res.timedOut, false, 'the upstream ran until the deadline');
  assert.equal(pipelineExit(res), 127);
});

test('G-8: the cap report says the tree was stopped only when no stage survived the stop', async () => {
  assert.equal(typeof ci.capNote, 'function', 'the cap clause is written inline, unconditionally "the tree was stopped"');
  assert.match(ci.capNote('stdout', 10, []), /the tree was stopped/);
  const said = ci.capNote('stdout', 10, [{ stage: 0, outcome: 'refused', pid: 4242 }]);
  assert.doesNotMatch(said, /the tree was stopped/);
  assert.match(said, /4242/);
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'capture-interactive.mjs'), 'utf8');
  assert.doesNotMatch(src, /B; the tree was stopped\)/, 'the report still asserts the stop inline');
});
