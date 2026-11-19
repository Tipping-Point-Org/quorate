// feature-verify's whole contract is to exercise the built artifact and cite captured evidence, and
// it could not: `run` is absent from capture.mjs's declared-command allow-list AND from new-run's
// permission grants, each deliberately ("so the launch command stays denied to every lens").
// Putting commands.run into its brief — the earlier half of this fix — changed nothing, because the
// brief is not an enforcement layer. Combined with the empty-measurement rule, the lens was then
// GUARANTEED to report DEGRADED on exactly the projects that select it (G-36).
//
// The gate lives in capture.mjs and NOT in a settings file, because a settings file cannot see the
// inner command: capture spawns it itself, and the CLI permission layer only ever sees
// `node capture.mjs ...`, which every lens may already invoke.
//
// THE TRUST BASIS, stated rather than implied: `--node` is SELF-DECLARED, so this confines a
// careless lens, not a determined one. There is nowhere to put a secret that would make it
// stronger — node policy grants Read on the repo root and briefs live under .claude/reviews/, so
// every lens can read every other lens's brief. The residual is proportionate: the worst case is a
// lens launching the operator's own declared run command, bounded by the per-lens timeout. The
// boundary that matters for a THIRD party is the panel's env allow-list, which is closed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, REPO_ROOT, repoRunDir } from './helpers.mjs';

// A run whose contract declares a `run` command that terminates on every platform.
function inRun(fn) {
  // Inside the repository, where a real run directory lives — capture refuses one that is not (G-6).
  const { base, dir } = repoRunDir({
    runId: 'runner', prefix: 'quorate-runner-',
    json: { contract: { commands: { run: 'node --version', build: '', test: '', shell: '' } } },
  });
  try { return fn(dir); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

const capture = (dir, node, ...cmd) => runScript('capture.mjs', [
  '--run-dir', dir, '--node', node, '--name', 'launch', '--', ...cmd,
]);

test('regression: the runner lens MAY capture the declared run command', () => {
  inRun((dir) => {
    const r = capture(dir, 'feature-verify', 'node', '--version');
    assert.equal(r.status, 0, `the one lens whose job is to launch the product was refused:\n${r.output.slice(0, 400)}`);
    assert.match(r.stdout, /evidence\/feature-verify\/launch\.log/);

    // AND THE LAUNCH MUST BE ON DISK. feature-verify's only permitted basis is `measurement`, and
    // §4 requires an evidence_path CONTAINING that measurement — so a capture that printed a path
    // and wrote nothing would let the one lens whose job is to exercise the product cite evidence
    // that does not exist. Asserting the printed path proves it reported, not that it captured.
    const log = path.join(dir, 'evidence', 'feature-verify', 'launch.log');
    assert.ok(fs.existsSync(log), 'capture printed an evidence path it never wrote');
    assert.match(fs.readFileSync(log, 'utf8'), /\bv\d+\.\d+\.\d+/,
      "the log must contain the launched command's actual output, not merely its name");
  });
});

test('regression: every OTHER lens is still refused the run command', () => {
  inRun((dir) => {
    for (const node of ['code-audit', 'security-audit', 'arch-review']) {
      const r = capture(dir, node, 'node', '--version');
      assert.notEqual(r.status, 0, `${node} was allowed to launch the product`);
      assert.match(r.output, /refusing/i);
    }
  });
});

test('the runner gains ONLY the run command, not a general exemption', () => {
  inRun((dir) => {
    // Not the declared run command, and not in the read-only set: refused for the runner too.
    const r = capture(dir, 'feature-verify', 'node', '-e', 'console.log(1)');
    assert.notEqual(r.status, 0, 'the runner must not become an arbitrary-command channel');
  });
});

test('the runner still cannot escape the tail guard', () => {
  inRun((dir) => {
    const r = capture(dir, 'feature-verify', 'git', 'grep', '-nOcat', 'x');
    assert.notEqual(r.status, 0, 'containment applies to the runner like every other node');
  });
});

test('a run whose contract declares no run command grants the runner nothing', () => {
  const { base, dir } = repoRunDir({
    runId: 'norun', prefix: 'quorate-norunner-',
    json: { contract: { commands: { run: '', shell: '' } } },
  });
  try {
    const r = capture(dir, 'feature-verify', 'node', '--version');
    assert.notEqual(r.status, 0, 'an empty commands.run must grant nothing at all');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// WHO MAY LAUNCH commands.run WAS A LITERAL IN TWO MODULES that never communicate — capture.mjs
// enforcing the grant, run-graph offering it in the brief — while lens-roster.json declares every
// other per-lens property (allowed_basis, timeout_minutes, condition, intent). Renaming the lens in
// the roster left both literals pointing at a node that does not exist: the run command granted to
// nobody, offered to no one, and nothing red anywhere (G-5).
test('the runner identity is declared in the roster and travels through run.json', () => {
  const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
  const declared = roster.lenses.filter((l) => l.may_launch_run).map((l) => l.id);
  assert.deepEqual(declared, ['feature-verify'], 'exactly one lens may launch the declared run command');

  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /roster\.lenses \?\? \[\]\)\.filter\(\(l\) => l\.may_launch_run\)/,
    'the orchestrator must derive the list from the roster');
  assert.match(graph, /runJson\.runner_nodes \?\? \[\]\)\.includes\(e\.node_id\)/,
    'and grant the brief from what it wrote into the run');
  assert.doesNotMatch(graph, /e\.node_id === 'feature-verify'/, 'the literal is the defect');

  const cap = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'capture.mjs'), 'utf8');
  assert.match(cap, /Array\.isArray\(rj\.runner_nodes\)/,
    'the enforcement point reads the run, which is its only authority');
});

// A RUN MINTED BY AN OLDER ENGINE has no runner_nodes, and must not lose the grant it always had.
test('an older run without runner_nodes still lets feature-verify launch the run command', () => {
  const { base, dir } = repoRunDir({
    runId: 'legacy-runner', prefix: 'quorate-legacy-',
    json: { contract: { commands: { run: 'node --version', shell: '' } } },   // no runner_nodes
  });
  try {
    const r = runScript('capture.mjs', [
      '--run-dir', dir, '--node', 'feature-verify', '--name', 'launch', '--', 'node', '--version',
    ]);
    assert.equal(r.status, 0, `the fallback must keep working: ${r.output.slice(-300)}`);

    // ...and the grant is still exactly one node wide.
    const other = runScript('capture.mjs', [
      '--run-dir', dir, '--node', 'code-audit', '--name', 'launch', '--', 'node', '--version',
    ]);
    assert.notEqual(other.status, 0, 'every other lens is still refused the run command');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
