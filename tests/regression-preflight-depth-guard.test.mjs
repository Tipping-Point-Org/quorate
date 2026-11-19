// G-19 of run 20260925-015614-platform-review (panel-codex-arch): preflight.mjs could start the
// pre-flight barrier (run-checks.mjs) from inside a graph node, and it handed the child
// GRAPH_NODE_DEPTH '0' unconditionally — laundering the nesting depth instead of failing closed, at
// the one entry point that runs every declared command. §8: a graph node may not start graph work.
//
// The guard covers STARTING work, as the doctrine says of every guard: preflight's read-only
// FRESH/STALE check starts nothing and stays callable at any depth. An unreadable depth aborts
// regardless, as it does everywhere.
//
// The repository root is an empty temporary directory, so the unguarded code dies on "no contract"
// (exit 2) long before it could spawn anything — the red run does not recurse into this suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PREFLIGHT = path.join(import.meta.dirname, '..', 'scripts', 'preflight.mjs');
const run = (t, depth, args) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-pfdepth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return spawnSync(process.execPath, [PREFLIGHT, ...args, '--repo-root', dir], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, GRAPH_NODE_DEPTH: depth },
  });
};

test('G-19: --run from inside a graph node is refused before anything else', (t) => {
  const r = run(t, '1', ['--run']);
  assert.equal(r.status, 3, `exit 3, the recursion guard's code — stderr: ${r.stderr}`);
  assert.match(r.stderr, /GRAPH_NODE_DEPTH=1/);
});

test('G-19: an unreadable depth fails closed, as it does at every guarded entry point', (t) => {
  const r = run(t, 'abc', []);
  assert.equal(r.status, 3, `stderr: ${r.stderr}`);
  assert.match(r.stderr, /not a non-negative integer/);
});

test('G-19: the read-only freshness check stays callable from a node — it starts nothing', (t) => {
  const r = run(t, '1', []);
  assert.notEqual(r.status, 3, 'no --run, so the guard does not apply');
});

test('G-19: the child is handed the real depth, never a laundered 0', () => {
  const src = fs.readFileSync(PREFLIGHT, 'utf8');
  assert.doesNotMatch(src, /GRAPH_NODE_DEPTH:\s*'0'/);
});
