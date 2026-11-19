// MONEY: ONE OWNER FOR AN UNUSABLE COST, AND ONE ADMISSION RULE (.claude/requests/reconcile-batches.plan.md stage 3;
// design §4 and §6 as amended 2026-10-07).
//
// G-2 of 20261007-050929-consumer-use-r4: a negative reported cost was trusted, and the rule for a usable cost lived in
// two places. G-9 of the same run: reconcile, and the --reconcile-twice calibration beside it, were launched without the
// per-run budget check the fan-out applies. Seen red on stage 2's commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, mintedRunDir } from './helpers.mjs';
import { nodeSpend } from '../scripts/lib/decisions.mjs';

async function fakeMain() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const all = process.argv.slice(2).join(' ');
  const runDir = process.env.FAKE_RUN_DIR;
  const runId = path.basename(runDir);
  const isReconcile = /intent_intact/.test(all);
  const cost = isReconcile && process.env.FAKE_COST ? Number(process.env.FAKE_COST) : 0.01;
  const out = (obj) => process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: cost,
    usage: { input_tokens: 1, output_tokens: 1 }, result: JSON.stringify(obj),
  }));
  if (isReconcile) {
    if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, 'reconcile\n');
    if (process.env.FAKE_NO_REPLY) { process.exitCode = 1; return; }   // a reconciler that returns nothing
    // The re-ask runs as its own node, `reconcile-reask`, with its own brief (reconcile-reask-record.plan.md stage 1).
    // The newest reconcile brief is this spawn's: the spawner writes it just before spawning.
    const briefName = fs.readdirSync(path.join(runDir, 'nodes')).filter((f) => /^reconcile(-reask)?-brief\.md$/.test(f))
      .sort((a, b) => fs.statSync(path.join(runDir, 'nodes', b)).mtimeMs - fs.statSync(path.join(runDir, 'nodes', a)).mtimeMs)[0];
    const brief = fs.readFileSync(path.join(runDir, 'nodes', briefName), 'utf8');
    const rel = /The groups you judge are in `([^`]+)`/.exec(brief)?.[1];
    const groups = JSON.parse(fs.readFileSync(path.join(runDir, rel), 'utf8')).groups;
    out({ schema_version: 1, run_id: runId, intent_intact: true,
      groups: groups.map((g) => ({ group_id: g.group_id, decision: 'confirmed', severity: 'LOW',
        rationale: 'the fake reconciler confirms every group it is given' })),
      summary: `fake reconciler judged ${groups.length} groups from ${rel}` });
    return;
  }
  const ev = path.join(runDir, 'evidence', 'ui-audit');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'fake.log'), 'fake evidence');
  const findings = [];
  // FAKE_COUNTS ("2,79") sets each file's number of groups; absent, every file has 8.
  const counts = process.env.FAKE_COUNTS ? process.env.FAKE_COUNTS.split(',').map(Number) : null;
  for (let f = 0; f < Number(process.env.FAKE_FILES); f++) {
    for (let i = 0; i < (counts ? counts[f] : 8); i++) {
      findings.push({ severity: 'LOW', basis: 'convention', file: `src/f${String(f).padStart(2, '0')}.js`, line: 1 + i * 10,
        claim: `fake finding ${f}-${i}: a stand-in claim long enough to pass the schema's minimum`, evidence_path: 'evidence/ui-audit/fake.log' });
    }
  }
  out({ schema_version: 1, run_id: runId, node_id: 'ui-audit', intent_sha: '', verdict: 'RISK', findings, checked_clean: [],
    not_checked: [{ item: 'everything a real lens reads', reason: 'this is a fake lens for the barrier test' }],
    out_of_scope_observations: [] });
}

function run(t, { files = 12, reviewYaml = [], env: extra = {}, graphArgs = [] }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-rbm-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  const lines = Array.from({ length: 800 }, (_, i) => `// line ${i + 1}`).join(String.fromCharCode(10));
  for (let f = 0; f < files; f++) {
    const p = path.join(repo, 'src', `f${String(f).padStart(2, '0')}.js`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, lines);
  }
  const yaml = ['graph_contract_version: 5', 'project: rbm-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: web', '  static_bundle: ""', 'review:',
    '  external_panel: false', '  models: { judgment: opus, mechanical: sonnet }', ...reviewYaml].join(String.fromCharCode(10));
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', yaml, '```', ''].join(String.fromCharCode(10)));
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeMain.toString()})();`);
  const noLogin = path.join(base, 'no-login');
  fs.mkdirSync(noLogin);
  const log = path.join(base, 'calls.log');
  const env = { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '',
    FAKE_FILES: String(files), FAKE_LOG: log, ...extra };
  const minted = runScript('new-run.mjs', ['--slug', 'rbm', '--repo-root', repo, '--full-sweep', 'src',
    '--no-request', '--no-verify-sandbox', '--runtime-bin', bin], { cwd: repo, env });
  const runDir = mintedRunDir(minted.output);
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  runScript('run-graph.mjs', ['--run-dir', runDir, '--repo-root', repo, '--only', 'ui-audit',
    '--skip-panel', '--no-archive', '--preflight', 'never', '--runtime-bin', bin, ...graphArgs],
    { cwd: repo, env: { ...env, FAKE_RUN_DIR: runDir } });
  const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(runDir, rel), 'utf8')); } catch { return null; } };
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(/\s+/).filter(Boolean).length : 0;
  return { status: read('nodes/reconcile.status.json'), gate: JSON.stringify(read('gate.json') ?? ''), calls, read };
}

// ------------------------------------------------------------------------------------------------- G-2
test('nodeSpend treats a negative reported cost as unknown, never as a refund', () => {
  const spend = nodeSpend({ total_cost_usd: -5, launched: true, mode: 'lens' }, { budgetNode: 2, budgetBarrier: 6 });
  assert.equal(spend, 2, 'a negative cost is unusable: charged as unknown, at the node cap');
});

test('a batch reporting a negative cost is charged as unknown — its whole grant', (t) => {
  const { status } = run(t, { env: { FAKE_COST: '-1' } });
  const b = status?.batches?.[0];
  assert.ok(b, `the barrier did not batch: ${JSON.stringify(status)?.slice(0, 300)}`);
  assert.equal(b.charge_usd, b.grant_usd, `charged ${b.charge_usd} against a grant of ${b.grant_usd}`);
});

// ------------------------------------------------------------------------------------------------- G-9
const TIGHT = ['  budget_usd_per_node: 0.1', '  budget_usd_per_barrier: 1'];

test('reconcile is not launched when the run budget cannot cover the barrier, and the gate says why', (t) => {
  const { calls, gate } = run(t, { files: 3, reviewYaml: [...TIGHT, '  budget_usd_per_run: 0.5'] });
  assert.equal(calls, 0, 'the run could not afford the barrier, so reconcile must not be spawned');
  assert.match(gate, /run budget cannot cover the barrier/, `gate: ${gate.slice(0, 400)}`);
});

test('the calibration is not launched when the run can afford one barrier but not two', (t) => {
  const { calls, gate } = run(t, { files: 3, reviewYaml: [...TIGHT, '  budget_usd_per_run: 1.5'], graphArgs: ['--reconcile-twice'] });
  assert.equal(calls, 1, 'reconcile runs, the calibration does not');
  assert.match(gate, /reconcile-b[^}]*run budget cannot cover the calibration/, `gate: ${gate.slice(0, 600)}`);
});

// ------------------------------------------------------------------------------------------- the two rules, as functions
test('usableCost accepts a finite cost of zero or more, and nothing else', async () => {
  const { usableCost } = await import('../scripts/lib/decisions.mjs');
  assert.equal(usableCost(0), 0);
  assert.equal(usableCost(1.25), 1.25);
  for (const bad of [-0.01, NaN, Infinity, null, undefined, '1']) assert.equal(usableCost(bad), null, `${String(bad)} is unusable`);
});

test('admitSpend admits when spent plus the reservation fits, and says why it refuses', async () => {
  const { admitSpend } = await import('../scripts/lib/decisions.mjs');
  assert.equal(admitSpend({ spent: 9.49, reserve: 2.5, budgetRun: 12 }), null);
  assert.match(admitSpend({ spent: 9.99, reserve: 2.5, budgetRun: 12, what: 'the barrier' }), /run budget cannot cover the barrier/);
  assert.equal(admitSpend({ spent: 5, reserve: Infinity, budgetRun: 12 }), null, 'an uncapped reservation has no size');
  assert.match(admitSpend({ spent: 13, reserve: Infinity, budgetRun: 12 }), /run budget exhausted before launch/);
});

// ------------------------------------------------------- remediation of 20261007-073125-reconcile-batches-review
// G-15: each batch was granted an even share of the budget but the WHOLE remaining time, so a hung early batch could use
// the barrier's time and starve the rest; the protocol promises an even share of both. G-11: total_cost_usd_known
// added any number, bypassing usableCost, so a negative cost was counted as measured.
// The share itself became proportional to the groups (story-pipeline, 2026-10-08; the test below pins it); G-15's own
// claim is only that an early batch is never handed ALL the time left.
test('review G-15: an early batch is granted a share of the time still left, not all of it', (t) => {
  const { read, status } = run(t, { reviewYaml: ['  barrier_timeout_minutes: 20'] });
  assert.ok(status?.batches?.length >= 2, 'the fixture must batch');
  const first = read('evidence/reconcile-batches/batch-1-status.json');
  assert.ok(first?.timeout_minutes < 20 - 0.5,
    `batch 1 of ${status.batches_planned} was given ${first?.timeout_minutes} of 20 minutes`);
});

test('review G-11: the measured part of a batched cost counts only usable costs', (t) => {
  const { status } = run(t, { env: { FAKE_COST: '-1' } });
  assert.equal(status.total_cost_usd_known, 0, `a negative cost was counted as measured: ${status.total_cost_usd_known}`);
});

// ------------------------------------------------------- shares follow the groups (story-pipeline, 2026-10-08)
// The even share was by batch COUNT: story-pipeline's run 20261008-003626-round2-review split 82 groups as 80 + 2, the
// 80-group batch was granted 35/2 = 17.5 minutes beside a 2-group batch, and was killed (an 80-group reconcile had taken
// 12-13 minutes on earlier runs). A batch's share of the time and budget left follows its share of the groups left.
test('a batch is granted the time left in proportion to its groups, not one share per batch', (t) => {
  const { read, status } = run(t, { reviewYaml: ['  barrier_timeout_minutes: 20'] });
  assert.equal(status?.batches_planned, 2, 'the fixture must split 96 groups into 80 + 16');
  const first = read('evidence/reconcile-batches/batch-1-status.json');
  const expected = 20 * 80 / 96;
  assert.ok(Math.abs(first?.timeout_minutes - expected) < 0.2,
    `batch 1 (80 of 96 groups) was given ${first?.timeout_minutes} of 20 minutes; its share is ${expected.toFixed(2)}`);
});

// ------------------------------------------------------- a floor for a small batch (G-7 of 20261008-021115-batch-share-review)
// The proportional share had no floor: batching closes a batch before a file that would overflow it, so a 2-group batch
// can come before a 79-group one and was granted 35 x 2/81 = 0.86 minutes, under a reconcile node's measured 39-61 s.
// Operator, 2026-10-08: "D" -- the floor is the smaller of 5 minutes and an even share of what is left.
test('review G-7: a small batch ahead of a large one is granted the floor, not a sliver of the time', (t) => {
  const { read, status } = run(t, { files: 2, env: { FAKE_COUNTS: '2,79' }, reviewYaml: ['  barrier_timeout_minutes: 35'] });
  assert.equal(status?.batches_planned, 2, 'the fixture must split 81 groups into 2 + 79');
  const first = read('evidence/reconcile-batches/batch-1-status.json');
  assert.ok(Math.abs(first?.timeout_minutes - 5) < 0.2,
    `batch 1 (2 of 81 groups) was given ${first?.timeout_minutes} of 35 minutes; its floor is 5`);
});

// ------------------------------------------------------- the LOWs on the same loop (20261008-021115-batch-share-review)
test('review G-8: a batch that returns no reply has its groups named on its own status', (t) => {
  const { read, status } = run(t, { env: { FAKE_NO_REPLY: '1' } });
  assert.ok(status?.batches_planned >= 2, 'the fixture must batch');
  const first = read('evidence/reconcile-batches/batch-1-status.json');
  assert.equal(first?.validation?.missing?.length, 80, `batch 1 status: ${JSON.stringify(first?.validation)}`);
});

test('review G-9: the merged status reports the barrier time, not the last batch share', (t) => {
  const { status } = run(t, { reviewYaml: ['  barrier_timeout_minutes: 20'] });
  assert.ok(status?.batches_planned >= 2, 'the fixture must batch');
  assert.equal(status.timeout_minutes, 20, `merged timeout_minutes: ${status.timeout_minutes}`);
});
