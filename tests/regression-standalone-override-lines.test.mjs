// reviewer-credential-routing.plan.md stage 3 (D1 = A, A-26): the standalone tools that build their own
// reviewer table from the LIVE contract name every override of it once, at start, before anything that
// spends: check-reviewers (before its QUORATE_LIVE refusal), bench-lenses (before its QUORATE_BENCH
// opt-in, so the bare listing shows it), bench-second-opinion (before its opt-in, so its bare listing shows it).
// check-reviewers runs in a throwaway project whose contract overrides a built-in reviewer and the node runtime; the
// benches read their FRAMEWORK root's contract (bench-contract-root D1), so theirs is a framework fixture's.
//
// And bench-lenses' version probe of the node runtime stops inheriting the whole environment (plan-review
// round 11): it gets subscriptionProbeEnv, as new-run's version probe already does (G-23).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, REPO_ROOT } from './helpers.mjs';
import { benchFixture, runBench, contractText } from './tools/bench-fixture.mjs';

function project(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'q-standalone-ovr-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 6', 'project: t',
    'reviewers:', '  codex:', '    cmd: "other-codex"', '  claude:', '    cmd: "other-claude"', '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'init');
  return repo;
}

const REVIEWER_LINE = /codex — cmd set by the contract; CODEX_\*, OPENAI_\* go to it/;
const NODE_LINE = /claude \(node runtime\) — cmd set by the contract; every node spawned on this runtime/;

test('check-reviewers names the overrides of its table before refusing to spend without QUORATE_LIVE', (t) => {
  const cwd = project(t);
  const r = runScript('check-reviewers.mjs', [], { cwd, env: { QUORATE_LIVE: '' } });
  assert.match(r.output, /QUORATE_LIVE/, `precondition: refused for want of the opt-in\n${r.output.slice(-600)}`);
  assert.match(r.stderr, REVIEWER_LINE, r.output.slice(-600));
});

// THE OVERRIDE LIVES WHERE THE BENCH READS (bench-contract-root.plan.md stage 5): a bench answers to its FRAMEWORK
// root's contract (design D1), so the override these two cases expect named goes into a framework fixture of its own
// (tests/tools/bench-fixture.mjs), not into the directory the bench is launched from — which carries a contract of its
// own that must NOT be named. The point is unchanged: the overrides of the table a bench uses are named before
// anything spends, in the bare listing.
const fixtureContract = () => contractText({ reviewers: { codex: { cmd: 'other-codex' }, claude: { cmd: 'other-claude' } } });

test('a bare bench-lenses (no QUORATE_BENCH) names the overrides of its table', (t) => {
  const fx = benchFixture(t, { contract: fixtureContract() });
  const r = runBench(fx, 'bench-lenses.mjs');
  assert.match(r.output, /seed\(s\) in the corpus/, `precondition: the no-spend listing\n${r.output.slice(-600)}`);
  assert.match(r.stderr, NODE_LINE, r.output.slice(-600));
  assert.match(r.stderr, REVIEWER_LINE);
});

// The bare listing, not --dry-run: both spend nothing and both pass the table, but --dry-run checks every seed's run dir
// and took 151 s in this test.
test('a bare bench-second-opinion (no QUORATE_BENCH) names the overrides of its table', (t) => {
  const fx = benchFixture(t, { contract: fixtureContract() });
  const r = runBench(fx, 'bench-second-opinion.mjs');
  assert.match(r.output, /seed\(s\) from/, `precondition: the no-spend listing\n${r.output.slice(-600)}`);
  assert.match(r.stderr, NODE_LINE, r.output.slice(-600));
  assert.match(r.stderr, REVIEWER_LINE);
});

test('bench-lenses probes the runtime version with subscriptionProbeEnv, not the inherited environment', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-lenses.mjs'), 'utf8');
  const probe = src.match(/runtime_version:\s*\(sh\(BENCH_RUNTIME\.cmd,[^\n]*/);
  assert.ok(probe, 'the version probe call site was not found');
  // With the runtime it probes (G-11 of 20261103-022403-rbr-remediation-8-review).
  assert.match(probe[0], /env:\s*subscriptionProbeEnv\(process\.env, BENCH_RUNTIME\)\.env/,
    'sh() without env inherits every secret the shell holds (GITHUB_TOKEN, AWS_*); new-run\'s probe is scrubbed (G-23)');
});
