// consumer-use-review-remediation-fixture.mjs — the fixture and helpers
// regression-consumer-use-review-remediation.test.mjs and its siblings share, moved out unchanged when the file was
// split (split-slow-test-files.md). Every top-level name is exported.


import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ------------------------------------------------------------------------------------------------ the harness
// A consuming fixture whose one lens (ui-audit, which the suite's spend guard allows) reports one LOW finding per
// ten lines of every source file — enough groups that the barrier must batch — and a fake reconciler that judges
// whatever groups file its brief names, after an optional delay.
async function fakeMain() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const all = process.argv.slice(2).join(' ');
  const runDir = process.env.FAKE_RUN_DIR;
  const runId = path.basename(runDir);
  const out = (obj) => process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, num_turns: 1,
    ...(process.env.FAKE_NO_COST ? {} : { total_cost_usd: 0.01 }),
    usage: { input_tokens: 1, output_tokens: 1 }, result: JSON.stringify(obj),
  }));
  if (/intent_intact/.test(all)) {
    if (process.env.FAKE_LOG) {
      const argv = process.argv.slice(2);
      const at = argv.indexOf('--max-budget-usd');
      fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ budget: at >= 0 ? Number(argv[at + 1]) : null })}\n`);
    }
    // The re-ask runs as its own node, `reconcile-reask`, with its own brief (reconcile-reask-record.plan.md stage 1).
    // The newest reconcile brief is this spawn's: the spawner writes it just before spawning.
    const briefName = fs.readdirSync(path.join(runDir, 'nodes')).filter((f) => /^reconcile(-reask)?-brief\.md$/.test(f))
      .sort((a, b) => fs.statSync(path.join(runDir, 'nodes', b)).mtimeMs - fs.statSync(path.join(runDir, 'nodes', a)).mtimeMs)[0];
    const brief = fs.readFileSync(path.join(runDir, 'nodes', briefName), 'utf8');
    // Batch 2 may be made slower than batch 1 (FAKE_RECONCILE_MS_2), so a fixture can starve only the second.
    const slow2 = /batch-2\.json/.test(brief) && process.env.FAKE_RECONCILE_MS_2;
    await new Promise((r) => setTimeout(r, Number(slow2 || process.env.FAKE_RECONCILE_MS || 0)));
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
  fs.writeFileSync(path.join(ev, 'fake.log'), 'fake evidence\n');
  const findings = [];
  for (let f = 0; f < 12; f++) {
    for (let i = 0; i < 8; i++) {
      findings.push({ severity: 'LOW', basis: 'convention', file: `src/f${String(f).padStart(2, '0')}.js`, line: 1 + i * 10,
        claim: `fake finding ${f}-${i}: a stand-in claim long enough to pass the schema's minimum`, evidence_path: 'evidence/ui-audit/fake.log' });
    }
  }
  out({ schema_version: 1, run_id: runId, node_id: 'ui-audit', intent_sha: '', verdict: 'RISK', findings, checked_clean: [],
    not_checked: [{ item: 'everything a real lens reads', reason: 'this is a fake lens for the barrier test' }],
    out_of_scope_observations: [] });
}

function batchedRun(t, { reviewYaml = [], env: extraEnv = {} } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-cur-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  for (let f = 0; f < 12; f++) {
    const p = path.join(repo, 'src', `f${String(f).padStart(2, '0')}.js`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Array.from({ length: 85 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n');
  }
  const yaml = ['graph_contract_version: 5', 'project: cur-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: web', '  static_bundle: ""', 'review:',
    '  external_panel: false', '  models: { judgment: opus, mechanical: sonnet }', ...reviewYaml].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# fixture\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeMain.toString()})();\n`);
  const noLogin = path.join(base, 'no-login');
  fs.mkdirSync(noLogin);
  const env = { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ...extraEnv };
  const minted = runScript('new-run.mjs', ['--slug', 'cur', '--repo-root', repo, '--full-sweep', 'src',
    '--no-request', '--no-verify-sandbox', '--runtime-bin', bin], { cwd: repo, env });
  const runDir = mintedRunDir(minted.output);
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  const graph = runScript('run-graph.mjs', ['--run-dir', runDir, '--repo-root', repo, '--only', 'ui-audit',
    '--skip-panel', '--no-archive', '--preflight', 'never', '--runtime-bin', bin], { cwd: repo, env: { ...env, FAKE_RUN_DIR: runDir } });
  const status = JSON.parse(fs.readFileSync(path.join(runDir, 'nodes', 'reconcile.status.json'), 'utf8'));
  return { runDir, graph, status };
}


// THE VALUES, not the property names (G-12 of 20261024-024945-rrs-delivery): asserting only that `timeoutMinutes:` and
// `budgetUsd:` occur passed with both set to the full barrier ceilings. Each must be a share of what is left, and what is
// left must be the ceiling less what was used. The check is also run against a source with full ceilings, which it must
// refuse, so it cannot pass for the wrong reason.
function remainingGrantProblems(g) {
  const loop = g.slice(g.indexOf('for (let i = 0; i < n; i++) {', g.indexOf('async function reconcileBatchLoop(')));
  const spawn = loop.slice(0, loop.indexOf('done.push('));
  const problems = [];  if (!/const minutesLeft = BARRIER_TIMEOUT - \(Date\.now\(\) - startedAt\) \/ 60000;/.test(spawn)) problems.push('minutesLeft is not the time left');
  if (!/const left = budgetLeft - spent;/.test(spawn)) problems.push('left is not the budget left');
  if (!/const grant = batchShare\(left, fraction\);/.test(spawn)) problems.push('the grant is not a share of the budget left');
  if (!/timeoutMinutes: batchShare\(minutesLeft, fraction\),/.test(spawn)) problems.push('timeoutMinutes is not a share of the time left');
  if (!/budgetUsd: grant\b/.test(spawn)) problems.push('budgetUsd is not the grant');
  if (!/spent \+= charge/.test(loop)) problems.push('nothing is subtracted as batches spend');
  return problems;
}












export { read, fakeMain, batchedRun, remainingGrantProblems };
