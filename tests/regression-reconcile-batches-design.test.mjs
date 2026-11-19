// BATCHED RECONCILE AS ONE OWNED UNIT (.claude/requests/reconcile-batches.plan.md, stage 1; design §2, §3).
//
// The merge of batch replies validated nothing (G-3 HIGH of 20261007-050929-consumer-use-r4): a reply could omit,
// repeat or invent group ids, and a root-cause link could point outside its batch or at no group at all. Each case
// below drives a fake reconciler that misbehaves in one way, and asserts what the merged payload, the gate's
// Not-checked table and the batch's own status say. Seen red on the b5e95d2 engine before stage 1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, mintedRunDir } from './helpers.mjs';

// The fake: one LOW finding per ten lines of every source file (lens: ui-audit, which the suite's spend guard allows),
// and a reconciler that judges the groups file its brief names, misbehaving as FAKE_MODE says on batch 1 (or on the
// only batch when unbatched).
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
    if ((first && mode === 'omit') || mode === 'omit-always') rows = rows.filter((r) => r.group_id !== 'G-1');
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
function run(t, { mode, files = 12 }) {
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
  runScript('run-graph.mjs', ['--run-dir', runDir, '--repo-root', repo, '--only', 'ui-audit',
    '--skip-panel', '--no-archive', '--preflight', 'never', '--runtime-bin', bin], { cwd: repo, env: { ...env, FAKE_RUN_DIR: runDir } });
  const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(runDir, rel), 'utf8')); } catch { return null; } };
  const gate = read('gate.json');
  return {
    payload: read('evidence/reconcile/payload.json'),
    notChecked: JSON.stringify(gate?.buckets?.not_checked ?? gate ?? ''),
    batch1: read('evidence/reconcile-batches/batch-1-status.json'),
    reask: gate?.reconcile_reask ?? null,
  };
}

// Since reconcile-missing-groups.plan.md stage 1 a group a batch left out is asked again once: the batch's status still
// records what its reply missed, and the gate names the group as unjudged only when the re-ask missed it too.
test('a batch reply that omits a group: the batch status records it; the gate names it only if the re-ask misses it too', (t) => {
  const answered = run(t, { mode: 'omit' });
  assert.deepEqual(answered.batch1?.validation?.missing, ['G-1'], 'the batch status must record what its reply missed');
  assert.doesNotMatch(answered.notChecked, /left these unjudged: G-1\b|never adjudicated/, `not_checked: ${answered.notChecked.slice(0, 600)}`);
  // A list of one attempt since reconcile-reask-shape.plan.md stage 2 (RA-D2 A).
  assert.equal(answered.reask?.length, 1, JSON.stringify(answered.reask));
  const [a] = answered.reask;
  assert.deepEqual({ groups: a.groups, judged: a.judged, missing: a.missing, state: a.state }, { groups: ['G-1'], judged: ['G-1'], missing: [], state: 'OK' });
  // THE WHOLE RECORD, not a projection (G-13 of 20261024-024945-rrs-delivery): its batches, cost and duration fields and
  // their spellings were unasserted, which is where G-7's planned-for-launched count went undetected.
  // Since reconcile-reask-record.plan.md stage 2 (RR-D2 A) the attempt also names its node and carries that node's
  // measured cost beside its charge.
  assert.deepEqual(Object.keys(a).sort(),
    ['batches', 'batches_planned', 'duration_ms', 'groups', 'judged', 'missing', 'node', 'report_sha256', 'state', 'total_cost_usd', 'total_cost_usd_known'], JSON.stringify(a));
  // Its report hash too (I-8; G-9 and G-13 of 20261024-064941-rrr-delivery): null for a reconcile node, which writes none.
  assert.ok(a.report_sha256 === null || typeof a.report_sha256 === 'string', JSON.stringify(a));
  assert.equal(a.node, 'reconcile-reask');
  assert.equal(a.batches, 1, 'the batches the re-ask launched');
  assert.equal(a.batches_planned, 1);
  assert.ok(a.total_cost_usd === null || typeof a.total_cost_usd === 'number', JSON.stringify(a));
  assert.ok(a.duration_ms === null || typeof a.duration_ms === 'number', JSON.stringify(a));
  const missedAgain = run(t, { mode: 'omit-always' });
  assert.match(missedAgain.notChecked, /batch 1 of \d+ left these unjudged: G-1\b/, `not_checked: ${missedAgain.notChecked.slice(0, 600)}`);
  assert.deepEqual(missedAgain.reask?.[0]?.missing, ['G-1']);
});

test('a batch reply that repeats a group: one row kept, the repeat named and recorded', (t) => {
  const { payload, notChecked, batch1 } = run(t, { mode: 'repeat' });
  assert.equal(payload.groups.filter((g) => g.group_id === 'G-1').length, 1, 'a repeated row must not be merged twice');
  assert.match(notChecked, /batch 1 of \d+ repeated: G-1\b/, `not_checked: ${notChecked.slice(0, 600)}`);
  assert.deepEqual(batch1?.validation?.repeated, ['G-1']);
});

test('a batch reply that invents a group outside its batch: the row dropped, named and recorded', (t) => {
  const { payload, notChecked, batch1 } = run(t, { mode: 'invent' });
  assert.ok(!payload.groups.some((g) => g.group_id === 'G-998'), 'a row for a group outside the batch must not be merged');
  assert.match(notChecked, /batch 1 of \d+ judged groups it was not given: G-998\b/, `not_checked: ${notChecked.slice(0, 600)}`);
  assert.deepEqual(batch1?.validation?.foreign, ['G-998']);
});

test('a root-cause link to a group in another batch is cleared and named', (t) => {
  const { payload, notChecked } = run(t, { mode: 'crosslink' });
  const linked = payload.groups.filter((g) => g.root_cause_group === 'G-1');
  assert.deepEqual(linked, [], 'a link the batch could not have verified must not survive the merge');
  assert.match(notChecked, /root-cause link cleared: G-\d+ -> G-1\b/, `not_checked: ${notChecked.slice(0, 600)}`);
});

test('an unbatched barrier: a root-cause link to a group that does not exist is cleared and named', (t) => {
  const { payload, notChecked } = run(t, { mode: 'dangling', files: 3 });
  assert.ok(!payload.groups.some((g) => g.root_cause_group === 'G-997'), 'a dangling link must not be printed');
  assert.match(notChecked, /root-cause link cleared: G-1 -> G-997\b/, `not_checked: ${notChecked.slice(0, 600)}`);
});

// ------------------------------------------------------------------------------------------- the rules, as functions
test('validateBatchReply keeps one row per given id and reports what is foreign, repeated and missing', async () => {
  const { validateBatchReply } = await import('../scripts/lib/reconcile-batches.mjs');
  const batch = [{ group_id: 'G-1' }, { group_id: 'G-2' }, { group_id: 'G-3' }];
  const v = validateBatchReply(batch, { groups: [{ group_id: 'G-1' }, { group_id: 'G-1' }, { group_id: 'G-9' }, { group_id: 'G-2' }] });
  assert.deepEqual(v.rows.map((r) => r.group_id), ['G-1', 'G-2']);
  assert.deepEqual(v.repeated, ['G-1']);
  assert.deepEqual(v.foreign, ['G-9']);
  assert.deepEqual(v.missing, ['G-3']);
  assert.deepEqual(validateBatchReply(batch, null).missing, ['G-1', 'G-2', 'G-3'], 'no reply misses every group');
});

test('checkRootLinks clears a link to a group the same rows do not hold, and keeps the rest', async () => {
  const { checkRootLinks } = await import('../scripts/lib/reconcile-batches.mjs');
  const { rows, cleared } = checkRootLinks([
    { group_id: 'G-1', root_cause_group: '' },
    { group_id: 'G-2', root_cause_group: 'G-1' },
    { group_id: 'G-3', root_cause_group: 'G-7', rationale: 'kept' },
  ]);
  assert.equal(rows[1].root_cause_group, 'G-1', 'a link inside the set stands');
  assert.equal(rows[2].root_cause_group, '', 'a link outside it is cleared');
  assert.equal(rows[2].rationale, 'kept', 'and the row keeps its rationale');
  assert.deepEqual(cleared, [{ from: 'G-3', to: 'G-7' }]);
});

test('coverageGaps names missing, duplicated and unknown ids once, skipping those a batch already named', async () => {
  const { coverageGaps } = await import('../scripts/lib/reconcile-batches.mjs');
  const rows = [{ group_id: 'G-1' }, { group_id: 'G-1' }, { group_id: 'G-9' }];
  assert.deepEqual(coverageGaps(['G-1', 'G-2', 'G-3'], rows), { missing: ['G-2', 'G-3'], duplicated: ['G-1'], unknown: ['G-9'] });
  assert.deepEqual(coverageGaps(['G-1', 'G-2', 'G-3'], rows, ['G-2', 'G-1']), { missing: ['G-3'], duplicated: [], unknown: ['G-9'] });
});

test('the batch note is a template, filled with exactly its four slots', () => {
  const tpl = fs.readFileSync(new URL('../prompts/_templates/reconcile-batch-note.md', import.meta.url), 'utf8');
  const slots = [...new Set([...tpl.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(slots, ['batch', 'max', 'of', 'total']);
  const g = fs.readFileSync(new URL('../scripts/run-graph.mjs', import.meta.url), 'utf8');
  assert.match(g, /readTemplate\('reconcile-batch-note\.md'\)/, 'run-graph renders the note from the template');
  assert.doesNotMatch(g, /Set root_cause_group only to a group in your file/, 'and carries no copy of its prose');
});
