// THE BATCHED BARRIER, RUN. regression-reconcile-batches pins the split and the merge as functions; this runs the
// graph on a consuming fixture with a fake runtime, so a lens reports more groups than one reconcile reply can carry
// and the barrier has to judge them in batches. A barrier that only LOOKED batched in source — a loop that ran once,
// a brief that kept naming finding-groups.json, a merge that dropped a batch — fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, mintedRunDir } from './helpers.mjs';
import { RECONCILE_MAX_GROUPS } from '../scripts/lib/reconcile-batches.mjs';

const FILES = 12;
const PER_FILE = 8;             // 96 groups: more than one batch, and no file larger than a batch
const LINES = PER_FILE * 10 + 5;

// Serialized into the fixture. It never reads stdin and prints exactly one envelope.
async function fakeMain() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const argv = process.argv.slice(2);
  const all = argv.join(' ');
  const runDir = process.env.FAKE_RUN_DIR;
  const out = (obj) => process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, num_turns: 1,
    usage: { input_tokens: 1, output_tokens: 1 }, result: JSON.stringify(obj),
  }));
  const runId = path.basename(runDir);
  if (/intent_intact/.test(all)) {
    // THE RECONCILER: judge exactly the groups file the brief names.
    // The re-ask runs as its own node, `reconcile-reask`, with its own brief (reconcile-reask-record.plan.md stage 1).
    // The newest reconcile brief is this spawn's: the spawner writes it just before spawning.
    const briefName = fs.readdirSync(path.join(runDir, 'nodes')).filter((f) => /^reconcile(-reask)?-brief\.md$/.test(f))
      .sort((a, b) => fs.statSync(path.join(runDir, 'nodes', b)).mtimeMs - fs.statSync(path.join(runDir, 'nodes', a)).mtimeMs)[0];
    const brief = fs.readFileSync(path.join(runDir, 'nodes', briefName), 'utf8');
    const rel = /The groups you judge are in `([^`]+)`/.exec(brief)?.[1];
    const groups = JSON.parse(fs.readFileSync(path.join(runDir, rel), 'utf8')).groups;
    fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ rel, n: groups.length })}\n`);
    out({
      schema_version: 1, run_id: runId, intent_intact: true,
      groups: groups.map((g) => ({ group_id: g.group_id, decision: 'confirmed', severity: 'LOW',
        rationale: 'the fake reconciler confirms every group it is given' })),
      summary: `fake reconciler judged ${groups.length} groups from ${rel}`,
    });
    return;
  }
  // A LENS (ui-audit, the one lens a fixture's contract switches on, so the suite's spend guard allows it):
  // one LOW finding per ten lines of every source file, so the groups do not merge.
  const ev = path.join(runDir, 'evidence', 'ui-audit');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'fake.log'), 'fake evidence\n');
  const findings = [];
  for (let f = 0; f < Number(process.env.FAKE_FILES); f++) {
    for (let i = 0; i < Number(process.env.FAKE_PER_FILE); i++) {
      findings.push({ severity: 'LOW', basis: 'convention', file: `src/f${String(f).padStart(2, '0')}.js`, line: 1 + i * 10,
        claim: `fake finding ${f}-${i}: a stand-in claim long enough to pass the schema's minimum`, evidence_path: 'evidence/ui-audit/fake.log' });
    }
  }
  out({ schema_version: 1, run_id: runId, node_id: 'ui-audit', intent_sha: '', verdict: 'RISK', findings,
    checked_clean: [], not_checked: [{ item: 'everything a real lens reads', reason: 'this is a fake lens for the barrier test' }],
    out_of_scope_observations: [] });
}

test('a barrier with more groups than one reply carries judges them all, in batches, inside one reconcile node', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-batch-e2e-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  for (let f = 0; f < FILES; f++) {
    const p = path.join(repo, 'src', `f${String(f).padStart(2, '0')}.js`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Array.from({ length: LINES }, (_, i) => `// line ${i + 1}`).join('\n') + '\n');
  }
  const yaml = ['graph_contract_version: 5', 'project: batch-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'review:', '  external_panel: false',
    '  models: { judgment: opus, mechanical: sonnet }', 'ui:', '  surface: web', '  static_bundle: ""'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# fixture\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeMain.toString()})();\n`);
  const log = path.join(base, 'calls.jsonl');
  const noLogin = path.join(base, 'no-login');
  fs.mkdirSync(noLogin);
  const env = { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '',
    FAKE_LOG: log, FAKE_FILES: String(FILES), FAKE_PER_FILE: String(PER_FILE) };

  const minted = runScript('new-run.mjs', ['--slug', 'batche2e', '--repo-root', repo, '--full-sweep', 'src',
    '--no-request', '--no-verify-sandbox', '--runtime-bin', bin], { cwd: repo, env });
  const runDir = mintedRunDir(minted.output);
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  const graph = runScript('run-graph.mjs', ['--run-dir', runDir, '--repo-root', repo, '--only', 'ui-audit',
    '--skip-panel', '--no-archive', '--preflight', 'never', '--runtime-bin', bin], { cwd: repo, env: { ...env, FAKE_RUN_DIR: runDir } });

  const lensStatus = (() => { try { return fs.readFileSync(path.join(runDir, 'nodes', 'ui-audit.status.json'), 'utf8'); } catch (e) { return e.message; } })();  const groups = JSON.parse(fs.readFileSync(path.join(runDir, 'finding-groups.json'), 'utf8')).groups;
  assert.equal(groups.length, FILES * PER_FILE,
    `the lens's findings did not reach the barrier:\n${graph.output.slice(-1500)}\nui-audit status: ${lensStatus.slice(0, 1500)}`);
  assert.ok(groups.length > RECONCILE_MAX_GROUPS, 'the fixture must exceed one batch, or it tests nothing');

  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(calls.length >= 2, `the reconciler ran ${calls.length} time(s); more groups than the cap need batches`);
  for (const c of calls) {
    assert.match(c.rel, /^finding-groups\.batch-\d+\.json$/, 'each batch must be told its own groups file');
    assert.ok(c.n <= RECONCILE_MAX_GROUPS, `a batch of ${c.n} groups exceeds the cap`);
  }
  assert.equal(calls.reduce((a, c) => a + c.n, 0), groups.length, 'the batches together cover every group once');

  const status = JSON.parse(fs.readFileSync(path.join(runDir, 'nodes', 'reconcile.status.json'), 'utf8'));
  assert.equal(status.state, 'OK', `reconcile state: ${status.state}`);
  assert.equal(status.batches.length, calls.length, 'the status records each batch');
  const payload = JSON.parse(fs.readFileSync(path.join(runDir, 'evidence', 'reconcile', 'payload.json'), 'utf8'));
  assert.deepEqual(payload.groups.map((g) => g.group_id).sort(), groups.map((g) => g.group_id).sort(),
    'the merged payload judges every group exactly once');
  const gate = JSON.parse(fs.readFileSync(path.join(runDir, 'gate.json'), 'utf8'));
  const unjudged = JSON.stringify(gate).match(/finding group\(s\) were never adjudicated/);
  assert.equal(unjudged, null, 'no group may be left unjudged');
  const reconciled = fs.readFileSync(path.join(runDir, 'reconciled.md'), 'utf8');
  assert.match(reconciled, /Batch 1 of \d+/, 'each batch\'s summary is kept');
});
