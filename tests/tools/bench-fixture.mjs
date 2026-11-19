// A FRAMEWORK OF ITS OWN FOR THE BENCH TOOLS (bench-contract-root.plan.md stage 1). bench-lenses and bench-second-opinion
// read the contract of the framework they live in (design D1), so a test of that read needs a framework root whose
// contract the test writes — the real repository's would be the only one any test could exercise, and
// test-suite-cost.md moved tests off it. This builds the least a bench needs to run its no-spend paths: a copy of
// scripts/ (lens-roster.json included, which bench-second-opinion's listing reads), the plugin marker, ONE corpus seed
// with its manifest and patch (bench-lenses refuses an empty corpus), ONE results file (bench-second-opinion's listing
// starts from it), and a CLAUDE.md per test. The bench is launched from a SEPARATE throwaway project whose own contract
// overrides a built-in too, so every test also shows which root was read.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from '../helpers.mjs';

const SEED = 'clamp-silent-noop';
const RESULT = '2026-09-24T00-04-14-249Z.json';

// Block YAML, two levels deep, as the existing fixtures write a contract (regression-standalone-override-lines).
const block = (key, obj) => [`${key}:`, ...Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object'
  ? [`  ${k}:`, ...Object.entries(v).map(([kk, vv]) => `    ${kk}: ${JSON.stringify(vv)}`)]
  : [`  ${k}: ${JSON.stringify(v)}`]))];

/** A contract block as CLAUDE.md carries it, with optional `reviewers` and `review` maps. */
export function contractText({ project = 'fw', reviewers = null, review = null } = {}) {
  const lines = ['graph_contract_version: 6', `project: ${project}`];
  if (reviewers) lines.push(...block('reviewers', reviewers));
  if (review) lines.push(...block('review', review));
  return ['# fixture', '', '```yaml', ...lines, '```', ''].join('\n');
}

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

/**
 * Build a framework fixture under a fresh temp dir and a throwaway launch project beside it. `contract` is the
 * framework's CLAUDE.md text (null: none), `launchContract` the throwaway's, `gitRepo` makes the framework a committed
 * git repository. Removed when the test ends.
 */
export function benchFixture(t, { contract = contractText(), launchContract = contractText({ project: 'elsewhere', reviewers: { agy: { cmd: 'elsewhere-agy' } } }), gitRepo = false } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-bench-fw-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const fw = path.join(base, 'fw');
  fs.cpSync(path.join(REPO_ROOT, 'scripts'), path.join(fw, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(fw, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'), path.join(fw, '.claude-plugin', 'plugin.json'));
  fs.cpSync(path.join(REPO_ROOT, 'bench', 'corpus', SEED), path.join(fw, 'bench', 'corpus', SEED), { recursive: true });
  fs.mkdirSync(path.join(fw, 'bench', 'results'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'bench', 'results', RESULT), path.join(fw, 'bench', 'results', RESULT));
  if (contract !== null) fs.writeFileSync(path.join(fw, 'CLAUDE.md'), contract);
  if (gitRepo) {
    git(fw, 'init', '-q'); git(fw, 'config', 'user.email', 'x@x'); git(fw, 'config', 'user.name', 'x');
    git(fw, 'add', '-A'); git(fw, 'commit', '-qm', 'fixture');
  }
  const launch = path.join(base, 'launch');
  fs.mkdirSync(launch);
  if (launchContract !== null) fs.writeFileSync(path.join(launch, 'CLAUDE.md'), launchContract);
  return { fw, launch, git: (...a) => git(fw, ...a) };
}

/** Run one of the fixture's bench scripts from the launch project. `env` adds to a scrubbed copy of process.env. */
export function runBench(fx, script, args = [], env = {}) {
  const r = spawnSync(process.execPath, [path.join(fx.fw, 'scripts', script), ...args], {
    cwd: fx.launch, encoding: 'utf8',
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, GRAPH_NODE_DEPTH: undefined, QUORATE_BENCH: '', ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
