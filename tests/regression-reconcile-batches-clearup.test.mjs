// WHAT A FRESH RECONCILE CLEARS, AND WHAT A RESUME MAY REUSE (.claude/requests/reconcile-batches.plan.md, stage 2;
// design §5; G-8 of 20261007-050929-consumer-use-r4).
//
// A fresh reconcile removed only reconciled.md and the payload, so an earlier --reconcile-twice attempt's calibration
// brief, status, evidence and reconcile-divergence.json survived into a run that never calibrated. The design names
// every artifact either reconcile writes, in one list, cleared before a fresh reconcile; a drift test keeps the list
// complete. Seen red on stage 1's commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, mintedRunDir, REPO_ROOT } from './helpers.mjs';

async function fakeMain() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const all = process.argv.slice(2).join(' ');
  const runDir = process.env.FAKE_RUN_DIR;
  const runId = path.basename(runDir);
  const out = (obj) => process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.01,
    usage: { input_tokens: 1, output_tokens: 1 }, result: JSON.stringify(obj),
  }));
  if (/intent_intact/.test(all)) {
    // The re-ask runs as its own node, `reconcile-reask`, with its own brief (reconcile-reask-record.plan.md stage 1).
    // The newest reconcile brief is this spawn's: the spawner writes it just before spawning.
    const briefName = fs.readdirSync(path.join(runDir, 'nodes')).filter((f) => /^reconcile(-reask)?-brief\.md$/.test(f))
      .sort((a, b) => fs.statSync(path.join(runDir, 'nodes', b)).mtimeMs - fs.statSync(path.join(runDir, 'nodes', a)).mtimeMs)[0];
    const brief = fs.readFileSync(path.join(runDir, 'nodes', briefName), 'utf8');
    const rel = /The groups you judge are in `([^`]+)`/.exec(brief)?.[1];
    const groups = JSON.parse(fs.readFileSync(path.join(runDir, rel), 'utf8')).groups;
    const first = rel === 'finding-groups.json' || /batch-1\.json$/.test(rel);
    const row = (id) => ({ group_id: id, decision: 'confirmed', severity: 'LOW',
      rationale: 'the fake reconciler confirms every group it is given' });
    let rows = groups.map((g) => row(g.group_id));
    const mode = process.env.FAKE_MODE;
    if (first && mode === 'omit') rows = rows.slice(1);
    if (first && mode === 'repeat') rows = [...rows, row(rows[0].group_id)];
    if (first && mode === 'invent') rows = [...rows, row('G-998')];
    if (first && mode === 'dangling') rows[0] = { ...rows[0], decision: 'symptom', root_cause_group: 'G-997' };
    if (!first && mode === 'crosslink') {
      rows[0] = { ...rows[0], decision: 'symptom', root_cause_group: 'G-1' };   // G-1 is in batch 1
    }
    out({ schema_version: 1, run_id: runId, intent_intact: true, groups: rows,
      summary: `fake reconciler judged ${rows.length} rows from ${rel}` });
    return;
  }
  const ev = path.join(runDir, 'evidence', 'ui-audit');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'fake.log'), 'fake evidence\n');
  const findings = [];
  for (let f = 0; f < Number(process.env.FAKE_FILES); f++) {
    for (let i = 0; i < 8; i++) {
      findings.push({ severity: 'LOW', basis: 'convention', file: `src/f${String(f).padStart(2, '0')}.js`, line: 1 + i * 10,
        claim: `fake finding ${f}-${i}: a stand-in claim long enough to pass the schema's minimum`, evidence_path: 'evidence/ui-audit/fake.log' });
    }
  }
  out({ schema_version: 1, run_id: runId, node_id: 'ui-audit', intent_sha: '', verdict: 'RISK', findings, checked_clean: [],
    not_checked: [{ item: 'everything a real lens reads', reason: 'this is a fake lens for the barrier test' }],
    out_of_scope_observations: [] });
}

// files: 12 makes 96 groups (two batches); 3 makes 24 (unbatched).
function run(t, { mode, files = 12, plant = null }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-rbd-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  for (let f = 0; f < files; f++) {
    const p = path.join(repo, 'src', `f${String(f).padStart(2, '0')}.js`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Array.from({ length: 85 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n');
  }
  const yaml = ['graph_contract_version: 5', 'project: rbd-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: web', '  static_bundle: ""', 'review:',
    '  external_panel: false', '  models: { judgment: opus, mechanical: sonnet }'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# fixture\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeMain.toString()})();\n`);
  const noLogin = path.join(base, 'no-login');
  fs.mkdirSync(noLogin);
  const env = { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '',
    FAKE_MODE: mode, FAKE_FILES: String(files) };
  const minted = runScript('new-run.mjs', ['--slug', 'rbd', '--repo-root', repo, '--full-sweep', 'src',
    '--no-request', '--no-verify-sandbox', '--runtime-bin', bin], { cwd: repo, env });
  const runDir = mintedRunDir(minted.output);
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  if (plant) plant(runDir);
  runScript('run-graph.mjs', ['--run-dir', runDir, '--repo-root', repo, '--only', 'ui-audit',
    '--skip-panel', '--no-archive', '--preflight', 'never', '--runtime-bin', bin], { cwd: repo, env: { ...env, FAKE_RUN_DIR: runDir } });
  const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(runDir, rel), 'utf8')); } catch { return null; } };
  const gate = read('gate.json');
  return {
    runDir,
    payload: read('evidence/reconcile/payload.json'),
    notChecked: JSON.stringify(gate?.buckets?.not_checked ?? gate ?? ''),
    batch1: read('evidence/reconcile-batches/batch-1-status.json'),
  };
}


// What an interrupted earlier attempt with --reconcile-twice leaves behind, planted before this run's barrier.
const STALE = [
  'reconcile-divergence.json',
  'nodes/reconcile-b-brief.md',
  'nodes/reconcile-b.status.json',
  'evidence/reconcile-b/payload.json',
  'finding-groups.batch-9.json',
  'evidence/reconcile-batches/batch-9-status.json',
];
function plantStale(runDir) {
  for (const rel of STALE) {
    fs.mkdirSync(path.dirname(path.join(runDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(runDir, rel), '{"stale": true}\n');
  }
}

test("a fresh reconcile clears every artifact an earlier attempt left, the calibration's included", (t) => {
  const { runDir } = run(t, { mode: 'none', plant: plantStale });
  const left = STALE.filter((rel) => fs.existsSync(path.join(runDir, rel)));
  assert.deepEqual(left, [], `stale artifacts survived a fresh reconcile: ${left.join(', ')}`);
});

test("the artifact list is the design's, and a resume reuses only an OK reconcile with its render and payload", async () => {
  const { RECONCILE_ARTIFACTS, reconcileReusable } = await import('../scripts/lib/reconcile-batches.mjs');
  assert.deepEqual([...RECONCILE_ARTIFACTS].sort(), [
    'evidence/reconcile-b/', 'evidence/reconcile-batches/', 'evidence/reconcile/payload.json',
    'finding-groups.batch-*.json', 'finding-groups.reask-*.json', 'evidence/reconcile-reask/', 'nodes/reconcile-reask-brief.md', 'nodes/reconcile-reask.status.json', 'nodes/reconcile-b-brief.md', 'nodes/reconcile-b.status.json',
    'nodes/reconcile-brief.md', 'reconcile-divergence.json', 'reconciled.md',
  ].sort());
  const ok = { resume: true, nothingReRun: true, statusState: 'OK', artifactsPresent: true };
  assert.equal(reconcileReusable(ok), true);
  for (const [k, v] of [['resume', false], ['nothingReRun', false], ['statusState', 'DEGRADED'], ['artifactsPresent', false]]) {
    assert.equal(reconcileReusable({ ...ok, [k]: v }), false, `${k}=${v} must not be reusable`);
  }
});

// THE DRIFT GUARD: every artifact path run-graph writes for reconcile or reconcile-b is in the list, except a named
// exempt set. Its red is not a run against an older engine (the list does not exist there): it is this test with one
// entry removed from the list, recorded in the stage's evidence.
const EXEMPT = {
  'nodes/reconcile.status.json': 'the input the resume check reads, rewritten by every spawn',
  // The re-ask's backup of it is gone since it runs as its own node (G-12 of 20261024-064941-rrr-delivery: this said otherwise).
  'nodes/reconcile-report.md': "the node's report, rewritten by every spawn; a reconcile node writes none, and run-graph does not write it",
  'evidence/reconcile/': "the node's captured evidence other than its payload, which the design keeps on purpose",
};
test('every reconcile and reconcile-b artifact run-graph writes is in RECONCILE_ARTIFACTS or named exempt', async () => {
  const { RECONCILE_ARTIFACTS } = await import('../scripts/lib/reconcile-batches.mjs');
  const g = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const written = new Set();
  // A path spelled with `${nodeId}` is read as each reconcile node it can name (G-12 of 20261024-064941-rrr-delivery):
  // reduced to `*`, the re-ask's brief writer became nodes/*-brief.md, which the reconcile filter dropped.
  const RECONCILE_NODES = ['reconcile', 'reconcile-b', 'reconcile-reask'];
  for (const m of g.matchAll(/path\.join\((?:runDir|nodesDir)((?:,\s*(?:'[^']*'|`[^`]*`))+)\)/g)) {
    const raw = [...m[1].matchAll(/'([^']*)'|`([^`]*)`/g)].map((x) => x[1] ?? x[2]);
    const spellings = raw.some((p) => p.includes('${nodeId}'))
      ? RECONCILE_NODES.map((id) => raw.map((p) => p.replaceAll('${nodeId}', id))) : [raw];
    for (const s of spellings) {
      const parts = s.map((p) => p.replace(/\$\{[^}]+\}/g, '*'));
      const rel = (m[0].includes('nodesDir') ? ['nodes', ...parts] : parts).join('/');
      if (/reconcile|finding-groups\.batch|reconciled\.md/.test(rel)) written.add(rel);
    }
  }
  assert.ok(written.size >= 5, `the scan found too few reconcile paths to mean anything: ${[...written].join(', ')}`);
  // THE RE-ASK'S BRIEF IS SEEN (G-12 of 20261024-064941-rrr-delivery): its writer spells the path `${nodeId}-brief.md`.
  assert.ok(written.has('nodes/reconcile-reask-brief.md'), `the scan cannot see the re-ask's brief writer: ${[...written].join(', ')}`);
  const covered = (rel) => RECONCILE_ARTIFACTS.some((a) => (a.endsWith('/') ? rel.startsWith(a) || rel === a.slice(0, -1) : rel === a))
    || Object.keys(EXEMPT).some((e) => (e.endsWith('/') ? rel.startsWith(e) : rel === e));
  const uncovered = [...written].filter((rel) => !covered(rel));
  assert.deepEqual(uncovered, [], `written but neither listed nor exempt: ${uncovered.join(', ')}`);
});
