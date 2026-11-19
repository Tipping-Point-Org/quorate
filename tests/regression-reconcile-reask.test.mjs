// reconcile-missing-groups.plan.md stage 1 (operator, 2026-10-23: "C"). The reconcile node read every group and
// submitted a payload that left some out, in four archived runs (20260915-191832-p1-rederive, 20260917-004143-release-
// gate3, 20261023-053248-rer-remediation-review, 20261023-205906-ger-delivery); the gate named the gap and nothing asked
// again, so each run could not be folded. The groups a reply misses now go back to the node once, as their own batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';

// Serialized into the fixture. The reconciler judges the groups file its brief names, leaving out FAKE_OMIT on its first
// call, and on every call when FAKE_OMIT_AGAIN is set.
async function fakeMain() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const all = process.argv.slice(2).join(' ');
  const runDir = process.env.FAKE_RUN_DIR;
  let noCost = !!process.env.FAKE_NO_COST;
  const out = (obj) => process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, num_turns: 1,
    ...(noCost ? {} : { total_cost_usd: 0.01 }),
    usage: { input_tokens: 1, output_tokens: 1 }, result: JSON.stringify(obj),
  }));
  const runId = path.basename(runDir);
  if (/intent_intact/.test(all)) {
    // The re-ask runs as its own node, `reconcile-reask`, with its own brief (reconcile-reask-record.plan.md stage 1).
    // The newest reconcile brief is this spawn's: the spawner writes it just before spawning.
    const briefName = fs.readdirSync(path.join(runDir, 'nodes')).filter((f) => /^reconcile(-reask)?-brief\.md$/.test(f))
      .sort((a, b) => fs.statSync(path.join(runDir, 'nodes', b)).mtimeMs - fs.statSync(path.join(runDir, 'nodes', a)).mtimeMs)[0];
    const brief = fs.readFileSync(path.join(runDir, 'nodes', briefName), 'utf8');
    const rel = /The groups you judge are in `([^`]+)`/.exec(brief)?.[1];
    const groups = JSON.parse(fs.readFileSync(path.join(runDir, rel), 'utf8')).groups;
    const calls = fs.existsSync(process.env.FAKE_LOG) ? fs.readFileSync(process.env.FAKE_LOG, 'utf8').split('\n').filter(Boolean).length : 0;
    fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ rel, ids: groups.map((g) => g.group_id) })}\n`);
    // G-10 of 20261023-224259-rmg-delivery: what a run that died while the re-ask is out would leave on disk.
    if (calls === 1 && process.env.FAKE_ONDISK_LOG) {
      const onDisk = [path.join(runDir, 'evidence', 'reconcile', 'payload.json'), path.join(runDir, 'evidence', 'reconcile-reask', 'first-payload.json')]
        .filter((p) => fs.existsSync(p)).map((p) => JSON.parse(fs.readFileSync(p, 'utf8')).groups.map((g) => g.group_id).sort().join(','));
      fs.writeFileSync(process.env.FAKE_ONDISK_LOG, JSON.stringify(onDisk));
    }
    if (calls === 1 && process.env.FAKE_NO_COST_REASK) noCost = true;
    const omit = calls === 0 || process.env.FAKE_OMIT_AGAIN ? process.env.FAKE_OMIT : null;
    // Every first-pass batch judges only FAKE_KEEP_ONLY, so the re-ask gets every other group.
    const keepOnly = process.env.FAKE_KEEP_ONLY && !/reask/.test(rel) ? process.env.FAKE_KEEP_ONLY : null;
    // The re-ask also judges FAKE_REASK_FOREIGN, a group it was not given.
    const foreign = /reask/.test(rel) && process.env.FAKE_REASK_FOREIGN ? [{ group_id: process.env.FAKE_REASK_FOREIGN }] : [];
    out({
      schema_version: 1, run_id: runId, intent_intact: true,
      groups: [...groups.filter((g) => g.group_id !== omit && (!keepOnly || g.group_id === keepOnly)), ...foreign].map((g) => ({ group_id: g.group_id, decision: 'confirmed',
        severity: 'LOW', rationale: 'the fake reconciler confirms what it does not omit' })),
      summary: `fake reconciler, call ${calls + 1}, from ${rel}`,
    });
    return;
  }
  if (process.env.FAKE_LENS_LOG) fs.appendFileSync(process.env.FAKE_LENS_LOG, 'lens\n');
  const ev = path.join(runDir, 'evidence', 'ui-audit');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'fake.log'), 'fake evidence\n');
  const findings = Array.from({ length: Number(process.env.FAKE_FINDINGS || 3) }, (_, i) => 1 + 20 * i).map((line, i) => ({ severity: 'LOW', basis: 'convention', file: 'src/a.js', line,
    claim: `fake finding ${i}: a stand-in claim long enough to pass the schema's minimum`, evidence_path: 'evidence/ui-audit/fake.log' }));
  out({ schema_version: 1, run_id: runId, node_id: 'ui-audit', intent_sha: '', verdict: 'RISK', findings,
    checked_clean: [], not_checked: [{ item: 'everything a real lens reads', reason: 'a fake lens for the barrier test' }],
    out_of_scope_observations: [] });
}

// The run's one recorded re-ask attempt, from gate.json's list (reconcile-reask-shape.plan.md stage 2): the fields a
// test pins, so cost and duration, which the fake reports, do not have to be spelled in every assertion.
export function oneAttempt(list) {
  assert.ok(Array.isArray(list) && list.length === 1, `one recorded attempt, as a list: ${JSON.stringify(list)}`);
  const [a] = list;
  return { groups: a.groups, batches: a.batches, judged: a.judged, missing: a.missing, state: a.state };
}

function runOnce(t, extraEnv, reviewYaml = [], plant = () => {}, { findings = 3 } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-reask-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), Array.from({ length: 20 * findings }, (_, i) => `// line ${i + 1}`).join('\n') + '\n');
  const yaml = ['graph_contract_version: 5', 'project: reask-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'review:', '  external_panel: false',
    '  models: { judgment: opus, mechanical: sonnet }', ...reviewYaml, 'ui:', '  surface: web', '  static_bundle: ""'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# fixture\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeMain.toString()})();\n`);
  const log = path.join(base, 'calls.jsonl');
  const noLogin = path.join(base, 'no-login');
  fs.mkdirSync(noLogin);
  const env = { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '',
    FAKE_LOG: log, FAKE_OMIT: 'G-2', ...extraEnv };
  const minted = runScript('new-run.mjs', ['--slug', 'reask', '--repo-root', repo, '--full-sweep', 'src',
    '--no-request', '--no-verify-sandbox', '--runtime-bin', bin], { cwd: repo, env });
  const runDir = mintedRunDir(minted.output);
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  plant(runDir);
  const graph = runScript('run-graph.mjs', ['--run-dir', runDir, '--repo-root', repo, '--only', 'ui-audit',
    '--skip-panel', '--no-archive', '--preflight', 'never', '--runtime-bin', bin], { cwd: repo, env: { ...env, FAKE_RUN_DIR: runDir } });
  const read = (p) => JSON.parse(fs.readFileSync(path.join(runDir, p), 'utf8'));
  const groups = read('finding-groups.json').groups;
  assert.equal(groups.length, findings, `the fixture's ${findings} findings did not reach the barrier:\n${graph.output.slice(-1500)}`);
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  return { runDir, read, graph, calls };
}

test('stage 1: a group the reply left out is asked again, alone, and the run judges every group', (t) => {
  const { read, calls, runDir } = runOnce(t, {});
  assert.equal(calls.length, 2, `the reconciler ran ${calls.length} time(s); the omitted group was not asked again`);
  assert.deepEqual(calls[1].ids, ['G-2'], 'the re-ask is given exactly the groups the reply missed');
  assert.deepEqual(read('evidence/reconcile/payload.json').groups.map((g) => g.group_id).sort(), ['G-1', 'G-2', 'G-3']);
  const gate = read('gate.json');
  assert.equal(JSON.stringify(gate.buckets.not_checked).match(/never adjudicated|left these unjudged/), null,
    `a judged group is still named as unjudged: ${JSON.stringify(gate.buckets.not_checked)}`);
  assert.deepEqual(oneAttempt(gate.reconcile_reask), { groups: ['G-2'], batches: 1, judged: ['G-2'], missing: [], state: 'OK' });
  assert.equal(read('nodes/reconcile.status.json').state, 'OK');
  assert.match(fs.readFileSync(path.join(runDir, 'gate.md'), 'utf8'), /re-asked[^\n]*G-2/i, 'gate.md names the re-ask');
});

test('stage 1: a group the re-ask also leaves out is named as unjudged, as before, after one re-ask only', (t) => {
  const { read, calls } = runOnce(t, { FAKE_OMIT_AGAIN: '1' });
  assert.equal(calls.length, 2, 'one re-ask, not a loop');
  const gate = read('gate.json');
  assert.match(JSON.stringify(gate.buckets.not_checked), /never adjudicated: G-2/);
  assert.deepEqual(oneAttempt(gate.reconcile_reask), { groups: ['G-2'], batches: 1, judged: [], missing: ['G-2'], state: 'OK' });
});

// G-8 and G-7 of 20261023-224259-rmg-delivery: the re-ask is granted and charged by batchFraction and batchCharge, as a
// batch is. A first reply whose cost is unknown is charged its whole grant, so a capped barrier has nothing left to
// re-ask with, and a re-ask that is not launched says so in the reconcile status, not only in the gate.
test('G-8: an unknown first cost is charged its grant, and a re-ask not launched is recorded in the status', (t) => {
  const { read, calls } = runOnce(t, { FAKE_NO_COST: '1' }, ['  budget_usd_per_barrier: 1.00']);
  assert.equal(calls.length, 1, 'the re-ask was granted the whole barrier budget again after a first call of unknown cost');
  const reask = read('nodes/reconcile.status.json').reask;
  assert.equal(reask?.[0]?.state, 'NOT-LAUNCHED', `the status does not record the re-ask that did not run: ${JSON.stringify(reask)}`);
  assert.deepEqual(reask[0].groups, ['G-2']);
  assert.equal(oneAttempt(read('gate.json').reconcile_reask).state, 'NOT-LAUNCHED');
});

// G-10 of 20261023-224259-rmg-delivery: the first reply's payload was deleted before the re-ask was awaited, so a run
// that died while the re-ask was out lost every group the first reply judged.
test('G-10: the first reply is on disk while the re-ask is out', (t) => {
  const onDiskLog = path.join(os.tmpdir(), `q-reask-ondisk-${process.pid}.json`);
  t.after(() => fs.rmSync(onDiskLog, { force: true }));
  runOnce(t, { FAKE_ONDISK_LOG: onDiskLog });
  const kept = JSON.parse(fs.readFileSync(onDiskLog, 'utf8'));
  assert.ok(kept.includes('G-1,G-3'), `while the re-ask ran, the first reply's judgments were only in memory: ${JSON.stringify(kept)}`);
});

// G-5 of 20261023-224259-rmg-delivery: spentSoFar counted an unreadable status as nothing spent, so a run whose earlier
// node's charge is unknown launched more paid children than its ceiling admits.
test('G-5: an unreadable status counts toward the run budget, so the barrier is refused past the ceiling', (t) => {
  const plant = (runDir) => fs.writeFileSync(path.join(runDir, 'nodes', 'planted.status.json'), '{ not json');
  const { read, calls } = runOnce(t, {}, ['  budget_usd_per_node: 1.00', '  budget_usd_per_barrier: 1.50', '  budget_usd_per_run: 2.50'], plant);
  const st = read('nodes/reconcile.status.json');
  assert.equal(st.state, 'BLOCKED', `the barrier launched as if the unreadable status had spent nothing: state ${st.state}`);
  assert.equal(calls.length, 0, 'the reconciler ran past the run budget');
});

// G-3 of 20261023-231847-rmg-remediation-review: the unreadable status was charged Math.max of the two caps, which is
// Infinity when either tier is uncapped, and so charged $0 though the barrier's cap was finite.
test('G-3: an unreadable status is charged the finite cap when the other tier is uncapped', (t) => {
  const plant = (runDir) => fs.writeFileSync(path.join(runDir, 'nodes', 'planted.status.json'), '{ not json');
  const { read, calls } = runOnce(t, {}, ['  budget_usd_per_node: ""', '  budget_usd_per_barrier: 1.00', '  budget_usd_per_run: 1.50'], plant);
  const st = read('nodes/reconcile.status.json');
  assert.equal(st.state, 'BLOCKED', `the unreadable status was charged nothing beside an uncapped node tier: state ${st.state}`);
  assert.equal(calls.length, 0, 'the reconciler ran past the run budget');
});

// G-8 of 20261023-231847-rmg-remediation-review: a re-ask of unknown cost under an uncapped barrier is charged null by
// batchCharge, and the merge kept the first call's number, so the status reported a known partial total.
test('G-8: a re-ask of unknown cost leaves the reconcile total unknown, not the first call\'s cost', (t) => {
  const { read, calls } = runOnce(t, { FAKE_NO_COST_REASK: '1' }, ['  budget_usd_per_barrier: ""']);
  assert.equal(calls.length, 2, 'the re-ask did not run');
  // The re-ask's cost lives on its own node's status since reconcile-reask-record.plan.md stage 1 (RR-D2 A); the run's
  // spend sums both statuses, and the first reply's is no longer a composite.
  const reask = read('nodes/reconcile-reask.status.json');
  assert.equal(reask.total_cost_usd, null, `an unknown re-ask charge was dropped from the re-ask's total: ${reask.total_cost_usd}`);
  assert.notEqual(read('nodes/reconcile.status.json').total_cost_usd, null, 'the first reply\'s status absorbed the re-ask\'s unknown cost');
});

// G-5 (and its symptom G-4) of 20261023-231847-rmg-remediation-review: every missing group went into one re-ask, though
// one reply carries at most RECONCILE_MAX_GROUPS rows, so past 80 missing groups some could never be judged.
test('G-5: more than 80 missing groups are re-asked in batches of at most 80, and every one is judged', (t) => {
  const { read, calls } = runOnce(t, { FAKE_FINDINGS: '83', FAKE_KEEP_ONLY: 'G-1', FAKE_OMIT: '' }, [], () => {}, { findings: 83 });
  const reasks = calls.filter((c) => /reask/.test(c.rel));
  assert.ok(reasks.every((c) => c.ids.length <= 80), `a re-ask was given more groups than one reply can carry: ${reasks.map((c) => c.ids.length)}`);
  assert.equal(reasks.flatMap((c) => c.ids).length, 82, 'not every missing group was re-asked');
  assert.equal(read('evidence/reconcile/payload.json').groups.length, 83, 'a missing group was left unjudged');
  assert.deepEqual(oneAttempt(read('gate.json').reconcile_reask).missing, []);
});

// G-13 of 20261023-231847-rmg-remediation-review: gate.md said "re-asked once" on the NOT-LAUNCHED path too.
test('G-13: gate.md does not say a re-ask ran when it was not launched', (t) => {
  const { runDir, calls } = runOnce(t, { FAKE_NO_COST: '1' }, ['  budget_usd_per_barrier: 1.00']);
  assert.equal(calls.length, 1);
  const md = fs.readFileSync(path.join(runDir, 'gate.md'), 'utf8');
  const section = md.slice(md.indexOf('## Reconcile re-ask'));
  assert.doesNotMatch(section.split('\n## ')[0], /re-asked once/, 'gate.md says the re-ask ran');
  assert.match(section, /not re-asked/);
});

// reconcile-missing-groups.plan.md stage 3: a FINISHED run, archived into the repository, with a group its reconciler
// left out (as 20261023-205906-ger-delivery and 20261023-053248-rer-remediation-review are) is re-asked by --resume:
// only the missing groups go to the reconcile node, no lens or arm runs again, and the run stays where it is.
test('stage 3: --resume on an archived run re-asks only its unjudged groups, and re-runs no lens', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-reask-resume-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), Array.from({ length: 60 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n');
  const yaml = ['graph_contract_version: 5', 'project: reask-resume', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'review:', '  external_panel: false',
    '  models: { judgment: opus, mechanical: sonnet }', 'ui:', '  surface: web', '  static_bundle: ""'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# fixture\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  const gitIn = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  gitIn('init', '-q'); gitIn('-c', 'user.email=x@x', '-c', 'user.name=x', 'add', '-A');
  gitIn('-c', 'user.email=x@x', '-c', 'user.name=x', 'commit', '-qm', 'init');
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeMain.toString()})();\n`);
  const log = path.join(base, 'calls.jsonl');
  const lensLog = path.join(base, 'lens.log');
  const noLogin = path.join(base, 'no-login');
  fs.mkdirSync(noLogin);
  const env = { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '',
    FAKE_LOG: log, FAKE_LENS_LOG: lensLog, FAKE_OMIT: 'G-2', QUORATE_HOME: path.join(base, 'home') };
  const minted = runScript('new-run.mjs', ['--slug', 'reask-resume', '--repo-root', repo, '--full-sweep', 'src',
    '--no-request', '--no-verify-sandbox', '--runtime-bin', bin], { cwd: repo, env });
  const staged = mintedRunDir(minted.output);
  const graphArgs = ['--repo-root', repo, '--only', 'ui-audit', '--skip-panel', '--preflight', 'never', '--runtime-bin', bin];
  // The first run: the reply and its re-ask both leave G-2 out, and the run is archived into the repository.
  runScript('run-graph.mjs', ['--run-dir', staged, ...graphArgs], { cwd: repo, env: { ...env, FAKE_RUN_DIR: staged, FAKE_OMIT_AGAIN: '1' } });
  const archived = path.join(repo, '.claude', 'reviews', path.basename(staged));
  assert.ok(fs.existsSync(path.join(archived, 'gate.json')), 'the fixture run was not archived into the repository');
  const read = (p) => JSON.parse(fs.readFileSync(path.join(archived, p), 'utf8'));
  assert.deepEqual(oneAttempt(read('gate.json').reconcile_reask).missing, ['G-2'], 'the fixture must leave G-2 unjudged');
  const lensRuns = () => fs.readFileSync(lensLog, 'utf8').split('\n').filter(Boolean).length;
  const reconcileCalls = () => fs.readFileSync(log, 'utf8').trim().split('\n').length;
  // reconcile-reask-shape.plan.md stage 2 (RA-D2 A, once per run): a resume of a run whose status records an attempt
  // makes no reconcile call, and its gate still names the recorded attempt (G-6, G-3/G-8 of
  // 20261024-000248-rmg-remediation-2-review).
  const withRecord = { reconcile: reconcileCalls() };
  const r0 = runScript('run-graph.mjs', ['--run-dir', archived, '--resume', ...graphArgs], { cwd: repo, env: { ...env, FAKE_RUN_DIR: archived } });
  assert.equal(reconcileCalls(), withRecord.reconcile, `a recorded attempt was asked again:\n${r0.output.slice(-1200)}`);
  assert.deepEqual(oneAttempt(read('gate.json').reconcile_reask).missing, ['G-2'], 'the resume dropped the recorded attempt');
  assert.match(fs.readFileSync(path.join(archived, 'gate.md'), 'utf8'), /re-asked once[^\n]*G-2/);
  // A run from before the re-ask has no record and missing groups, as the two stuck runs do: it is re-asked once.
  const statusPath = path.join(archived, 'nodes', 'reconcile.status.json');
  const { reask: _dropped, ...noRecord } = read('nodes/reconcile.status.json');
  fs.writeFileSync(statusPath, JSON.stringify(noRecord));
  // reconcile-reask-shape.plan.md stage 3 (RA-D3 A; G-7 of 20261024-000248-rmg-remediation-2-review): a re-ask that judges
  // nothing leaves reconciled.md byte-identical, so second-opinion, reused because nothing was judged, audited it.
  fs.writeFileSync(path.join(archived, 'nodes', 'second-opinion.status.json'),
    JSON.stringify({ node_id: 'second-opinion', state: 'OK', launched: true, total_cost_usd: 0.01 }));
  const renderBefore = fs.readFileSync(path.join(archived, 'reconciled.md'));
  const rNone = runScript('run-graph.mjs', ['--run-dir', archived, '--resume', ...graphArgs],
    { cwd: repo, env: { ...env, FAKE_RUN_DIR: archived, FAKE_OMIT_AGAIN: '1' } });
  assert.deepEqual(oneAttempt(read('gate.json').reconcile_reask).judged, [], `the re-ask judged something:\n${rNone.output.slice(-800)}`);
  assert.ok(fs.readFileSync(path.join(archived, 'reconciled.md')).equals(renderBefore), 'a re-ask that judged nothing re-rendered reconciled.md');
  assert.match(rNone.output, /second-opinion REUSED/, 'second-opinion was not reused over an unchanged reconciled.md');
  fs.writeFileSync(statusPath, JSON.stringify(noRecord));
  const before = { lens: lensRuns(), reconcile: reconcileCalls() };
  // G-11 of 20261023-231847-rmg-remediation-review: an audit of the reconciled.md the re-ask is about to re-render.
  fs.writeFileSync(path.join(archived, 'nodes', 'second-opinion.status.json'),
    JSON.stringify({ node_id: 'second-opinion', state: 'OK', launched: true, total_cost_usd: 0.01 }));
  // The resume, with a reconciler that now answers.
  const r = runScript('run-graph.mjs', ['--run-dir', archived, '--resume', ...graphArgs], { cwd: repo, env: { ...env, FAKE_RUN_DIR: archived } });
  assert.equal(lensRuns(), before.lens, `--resume re-ran a lens:\n${r.output.slice(-1200)}`);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(calls.length, before.reconcile + 1, `one re-ask, not a whole reconcile:\n${r.output.slice(-1200)}`);
  assert.deepEqual(calls.at(-1).ids, ['G-2']);
  assert.deepEqual(read('evidence/reconcile/payload.json').groups.map((g) => g.group_id).sort(), ['G-1', 'G-2', 'G-3']);
  assert.doesNotMatch(JSON.stringify(read('gate.json').buckets.not_checked), /never adjudicated/);
  // G-13 of 20261023-224259-rmg-delivery: reconciled.md, remediate's work list, is rendered again from the merged payload.
  assert.match(fs.readFileSync(path.join(archived, 'reconciled.md'), 'utf8'), /^### G-2 /m, 'reconciled.md still leaves out the group the re-ask judged');
  assert.ok(fs.existsSync(path.join(archived, 'gate.json')), 'the run moved');
  assert.doesNotMatch(r.output, /second-opinion REUSED/, 'second-opinion was reused though the re-ask re-rendered reconciled.md');
});

// reconcile-missing-groups.plan.md stage 4: the documents that own each rule state it.
// G-9 of 20261024-072605-rrr-remediation-review: a failed latest.txt write after archiving was swallowed by an empty
// catch, so the pointer could name an older run with nothing said. The run still completes, and now says so.
test('G-9 (rrr-2): an archived run whose latest.txt cannot be written says so, and still completes', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-latest-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), Array.from({ length: 60 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n');
  const yaml = ['graph_contract_version: 5', 'project: latest-pointer', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'review:', '  external_panel: false',
    '  models: { judgment: opus, mechanical: sonnet }', 'ui:', '  surface: web', '  static_bundle: ""'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# fixture\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  const gitIn = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  gitIn('init', '-q'); gitIn('-c', 'user.email=x@x', '-c', 'user.name=x', 'add', '-A');
  gitIn('-c', 'user.email=x@x', '-c', 'user.name=x', 'commit', '-qm', 'init');
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeMain.toString()})();\n`);
  const noLogin = path.join(base, 'no-login');
  fs.mkdirSync(noLogin);
  const env = { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '',
    FAKE_LOG: path.join(base, 'calls.jsonl'), FAKE_OMIT: 'none', QUORATE_HOME: path.join(base, 'home') };
  const minted = runScript('new-run.mjs', ['--slug', 'latest-pointer', '--repo-root', repo, '--full-sweep', 'src',
    '--no-request', '--no-verify-sandbox', '--runtime-bin', bin], { cwd: repo, env });
  const staged = mintedRunDir(minted.output);
  // A directory where the pointer goes: the atomic write's rename onto it fails on every platform.
  const pointer = path.join(repo, '.claude', 'reviews', 'latest.txt');
  fs.rmSync(pointer, { recursive: true, force: true });
  fs.mkdirSync(pointer, { recursive: true });
  fs.writeFileSync(path.join(pointer, 'keep'), 'x');
  const r = runScript('run-graph.mjs', ['--run-dir', staged, '--repo-root', repo, '--only', 'ui-audit', '--skip-panel',
    '--preflight', 'never', '--runtime-bin', bin], { cwd: repo, env: { ...env, FAKE_RUN_DIR: staged } });
  const archived = path.join(repo, '.claude', 'reviews', path.basename(staged));
  assert.ok(fs.existsSync(path.join(archived, 'gate.json')), `the fixture run was not archived:\n${r.output.slice(-1500)}`);
  assert.match(r.output, /latest\.txt not updated/, `a failed latest.txt write was not named:\n${r.output.slice(-1500)}`);
});

test('stage 4: the barrier, the ledger and the contract document state the re-ask and the unjudged entry', () => {
  const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');
  const protocol = read('shared/disk-first-protocol.md');
  assert.match(protocol, /asked again once/i, 'disk-first-protocol does not state the re-ask');
  assert.match(protocol, /--resume[^.]*re-ask/i, 'disk-first-protocol does not state the re-ask on --resume');
  // reconcile-reask-shape.plan.md stage 4: the re-ask runs in batches packed as the barrier's, once per run, its record a
  // list on the status; a resume after an attempt reports it (G-10 of 20261024-000248-rmg-remediation-2-review).
  assert.doesNotMatch(protocol, /as one more batch of the same node/, 'disk-first-protocol still says the re-ask is one batch');
  assert.match(protocol, /re-ask[^.]*batches packed as the barrier's/i, 'disk-first-protocol does not say how the re-ask is batched');
  assert.match(protocol, /once per run/i, 'disk-first-protocol does not say the re-ask is once per run');
  assert.match(protocol, /`reask`[^.]*list/i, 'disk-first-protocol does not say the record is a list');
  assert.match(protocol, /--resume[^.]*already[^.]*reports/i, 'disk-first-protocol does not say a resume after an attempt reports it');
  // reconcile-reask-record.plan.md stage 3 (RR-D1 A, RR-D2 A): the re-ask is its own node, the first reply's files are
  // never written by it, and the merged payload is written once.
  assert.doesNotMatch(protocol, /asked again once, alone, in the same node/, 'disk-first-protocol still runs the re-ask in the same node');
  assert.match(protocol, /own node, `reconcile-reask`/, 'disk-first-protocol does not name the re-ask\'s node');
  assert.match(protocol, /first reply's[^.]*never written by (it|the re-ask)/i, 'disk-first-protocol does not say the first reply\'s files are left alone');
  assert.match(protocol, /merged payload is written once/i, 'disk-first-protocol does not say the merged payload is written once');
  // G-10 of 20261024-072605-rrr-remediation-review: it also said the first reply's status and payload were never written,
  // while the re-ask adds its record to that status and writes the merged payload over that payload.
  assert.doesNotMatch(protocol, /first reply's (payload|status)[^.;]*never written/i, 'disk-first-protocol says the first reply\'s status or payload is never written');
  assert.match(protocol, /first reply's status gains only the `reask` record/i, 'disk-first-protocol does not say what the re-ask adds to the first reply\'s status');
  assert.match(protocol, /reconcile-reask\.status\.json/, 'the run layout does not list the re-ask node\'s status');
  // ALL FOUR OF ITS ARTIFACTS, its report included, and the attempt's report hash (I-10, I-8; G-11 of
  // 20261024-064941-rrr-delivery: the report was left out), and the shape on the NOT-LAUNCHED path too.
  // G-8 of 20261024-083753-rrr-remediation-3-review: it then promised the re-ask a report of its own, which no reconcile
  // node writes, in the sentence that said its report fields are null.
  assert.doesNotMatch(protocol, /brief, status, report and payload are its own/i, 'disk-first-protocol promises the re-ask a report no reconcile node writes');
  assert.match(protocol, /brief, status and payload are its own, and it writes no report/i, 'disk-first-protocol does not say the re-ask writes no report');
  assert.match(protocol, /each re-ask batch's status, payload and report/i, 'the run layout does not keep each re-ask batch\'s report');
  assert.match(protocol, /totals and report hash, null for a reconcile node/i, 'disk-first-protocol does not say the attempt\'s report hash is null');
  assert.match(protocol, /`NOT-LAUNCHED`[^.]*same fields/i, 'disk-first-protocol does not give the NOT-LAUNCHED attempt the same shape');
  const ledger = read('shared/ledger-transitions.md');
  assert.match(ledger, /`unjudged`/, 'ledger-transitions does not name the unjudged sighting');
  assert.doesNotMatch(ledger, /a payload that judged fewer groups than were formed/, 'ledger-transitions still refuses a partly judged run');
  assert.match(read('shared/claude-md-contract.md'), /--resume[^.]*(unjudged|left( groups)? out)/i, 'the contract document does not state --resume\'s re-ask');
  // A POINTER, NOT A SECOND COPY (G-10 of 20261024-024945-rrs-delivery): the contract doc restated the once-per-run rule
  // the protocol owns, under the unrelated reviews_dir key, where the two could drift.
  const contract = read('shared/claude-md-contract.md');
  assert.doesNotMatch(contract, /already re-asked|does not ask again/i, 'the contract document restates the protocol\'s once-per-run rule');
  assert.match(contract, /--resume[^.]*left groups out[^.]*shared\/disk-first-protocol\.md`, Batched reconcile/i, 'the contract document must point at the owner');
});

// reconcile-reask-shape.plan.md stage 1 (RA-D1 A; G-4, G-10 of 20261024-000248-rmg-remediation-2-review): the re-ask
// sliced the missing groups into 80-group chunks BY POSITION, so a file's groups could be split across two re-ask
// replies and a root-cause link between them cleared, through a second loop that granted, charged and validated beside
// the barrier's own. It now runs through the barrier's batch loop, partitioned by file as the barrier's batches are.
async function fakeBig() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const all = process.argv.slice(2).join(' ');
  const runDir = process.env.FAKE_RUN_DIR;
  const runId = path.basename(runDir);
  const out = (obj) => process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, num_turns: 1,
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
    const reask = /reask/.test(rel);
    fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ rel, reask, groups: groups.map((g) => [g.group_id, g.file]) })}\n`);
    const row = (g) => ({ group_id: g.group_id, decision: 'confirmed', severity: 'LOW', rationale: 'fake' });
    // The first pass judges one group per batch; the re-ask judges all it is given, and in the batch holding src/f2.js
    // names a src/f0.js group as a root cause, which that reply did not judge.
    let rows = reask ? groups.map(row) : [row(groups[0])];
    if (reask && groups.some((g) => g.file === 'src/f2.js')) {
      const all = JSON.parse(fs.readFileSync(path.join(runDir, 'finding-groups.json'), 'utf8')).groups;
      const other = all.find((g) => g.file === 'src/f0.js' && !groups.some((x) => x.group_id === g.group_id));
      if (other) rows[0] = { ...rows[0], decision: 'symptom', root_cause_group: other.group_id };
    }
    out({ schema_version: 1, run_id: runId, intent_intact: true, groups: rows, summary: `fake, ${rel}` });
    return;
  }
  const ev = path.join(runDir, 'evidence', 'ui-audit');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'fake.log'), 'fake evidence\n');
  const findings = [];
  for (let f = 0; f < 3; f++) {
    for (let i = 0; i < 30; i++) {
      findings.push({ severity: 'LOW', basis: 'convention', file: `src/f${f}.js`, line: 1 + i * 10,
        claim: `fake finding ${f}-${i}: a stand-in claim long enough to pass the schema's minimum`, evidence_path: 'evidence/ui-audit/fake.log' });
    }
  }
  out({ schema_version: 1, run_id: runId, node_id: 'ui-audit', intent_sha: '', verdict: 'RISK', findings,
    checked_clean: [], not_checked: [{ item: 'everything', reason: 'a fake lens' }], out_of_scope_observations: [] });
}

test('stage 1 (RA-D1): the re-ask runs through the barrier\'s batch loop, each file\'s groups kept together', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-reask-big-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  for (let f = 0; f < 3; f++) fs.writeFileSync(path.join(repo, 'src', `f${f}.js`), Array.from({ length: 320 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n');
  const yaml = ['graph_contract_version: 5', 'project: reask-big', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'review:', '  external_panel: false',
    '  models: { judgment: opus, mechanical: sonnet }', 'ui:', '  surface: web', '  static_bundle: ""'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# fixture\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeBig.toString()})();\n`);
  const log = path.join(base, 'calls.jsonl');
  const noLogin = path.join(base, 'no-login');
  fs.mkdirSync(noLogin);
  const env = { CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', FAKE_LOG: log };
  const minted = runScript('new-run.mjs', ['--slug', 'reask-big', '--repo-root', repo, '--full-sweep', 'src',
    '--no-request', '--no-verify-sandbox', '--runtime-bin', bin], { cwd: repo, env });
  const runDir = mintedRunDir(minted.output);
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  const r = runScript('run-graph.mjs', ['--run-dir', runDir, '--repo-root', repo, '--only', 'ui-audit', '--skip-panel',
    '--no-archive', '--preflight', 'never', '--runtime-bin', bin], { cwd: repo, env: { ...env, FAKE_RUN_DIR: runDir } });
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const reasks = calls.filter((c) => c.reask);
  assert.ok(reasks.length >= 2, `more than ${80} missing groups need more than one re-ask batch:\n${r.output.slice(-1500)}`);
  // No file's groups are split across two re-ask replies.
  const filesOf = reasks.map((c) => new Set(c.groups.map(([, file]) => file)));
  for (const file of ['src/f0.js', 'src/f1.js', 'src/f2.js']) {
    assert.ok(filesOf.filter((s) => s.has(file)).length <= 1, `${file}'s groups were split across re-ask batches: ${JSON.stringify(reasks.map((c) => c.groups.length))}`);
  }
  assert.ok(reasks.every((c) => c.groups.length <= 80));
  const read = (p) => JSON.parse(fs.readFileSync(path.join(runDir, p), 'utf8'));
  assert.equal(read('evidence/reconcile/payload.json').groups.length, 90, 'every group judged after the re-ask');
  assert.match(JSON.stringify(read('gate.json').buckets.not_checked), /root-cause link cleared/, 'a cross-batch link in the re-ask is cleared and named');
  // The first pass's batch artifacts stay its own: each still holds the one row that pass judged.
  const firstBatches = fs.readdirSync(path.join(runDir, 'evidence', 'reconcile-batches')).filter((n) => /payload\.json$/.test(n));
  assert.ok(firstBatches.length >= 2);
  for (const n of firstBatches) assert.equal(read(`evidence/reconcile-batches/${n}`).groups.length, 1, `${n} was overwritten by the re-ask`);
  assert.ok(fs.readdirSync(path.join(runDir, 'evidence', 'reconcile-reask')).some((n) => /payload/.test(n)), 'the re-ask keeps its own artifacts');
  // Its batches share one node id, so its status is aggregated: both batches' cost is counted (reconcile-reask-record
  // stage 1), not only the last batch's.
  const reaskStatus = read('nodes/reconcile-reask.status.json');
  assert.equal(reaskStatus.batches?.length, reasks.length, 'the re-ask status records each batch');
  assert.ok(Math.abs(reaskStatus.total_cost_usd - 0.01 * reasks.length) < 1e-9, `the re-ask status counts one batch's cost: ${reaskStatus.total_cost_usd}`);
});

// reconcile-reask-record.plan.md stage 1 (RR-D1 A; G-10 of 20261023-224259-rmg-delivery, G-8 and G-9 of
// 20261024-052401-rrs-remediation-3b-review): the re-ask spawned under the first reply's node id, so its first batch
// wrote over the first reply's payload, status and report, and each later step chose between a backup and the live copy.
// It now runs as `reconcile-reask`: the first reply's files are its own, and there is nothing to back up.
test('stage 1 (RR-D1): the re-ask runs as its own node, and the first reply\'s status is left as it wrote it', (t) => {
  const { read, runDir, calls } = runOnce(t, {});
  assert.equal(calls.length, 2, 'the fixture did not re-ask');
  assert.ok(fs.existsSync(path.join(runDir, 'nodes', 'reconcile-reask.status.json')), 'the re-ask has no status of its own');
  assert.ok(fs.existsSync(path.join(runDir, 'nodes', 'reconcile-reask-brief.md')), 'the re-ask has no brief of its own');
  // A reconcile node writes no report (its status's report_path is null); its record is the payload and the status.
  const first = read('nodes/reconcile.status.json');
  assert.equal(first.total_cost_usd, 0.01, `the first reply's status carries a composite cost: ${first.total_cost_usd}`);
  assert.equal(first.session_id === read('nodes/reconcile-reask.status.json').session_id, false, 'the first reply\'s status was rewritten by the re-ask');
  assert.ok(fs.existsSync(path.join(runDir, 'evidence', 'reconcile-reask', 'payload.json')), 'the re-ask wrote no payload of its own');
  for (const backup of ['first-payload.json', 'first-report.md']) {
    assert.equal(fs.existsSync(path.join(runDir, 'evidence', 'reconcile-reask', backup)), false, `${backup}: a backup of a file the re-ask no longer touches`);
  }
  assert.deepEqual(read('evidence/reconcile/payload.json').groups.map((g) => g.group_id).sort(), ['G-1', 'G-2', 'G-3']);
});

// reconcile-reask-record.plan.md stage 2 (RR-D2 A): the attempt record points at the re-ask node's own aggregated status,
// and carries its totals, so the gate's record and the node's status cannot disagree.
test('stage 2 (RR-D2): the attempt names the re-ask node and carries its status\'s totals', (t) => {
  const { read } = runOnce(t, {});
  const [attempt] = read('gate.json').reconcile_reask;
  const st = read('nodes/reconcile-reask.status.json');
  assert.equal(attempt.node, 'reconcile-reask', `the attempt does not name the node it ran as: ${JSON.stringify(attempt)}`);
  assert.equal(attempt.total_cost_usd, st.total_cost_usd);
  assert.equal(attempt.total_cost_usd_known, st.total_cost_usd_known);
  assert.equal(attempt.duration_ms, st.duration_ms);
  assert.equal(attempt.state, st.state);
  // AND ITS REPORT HASH (I-8; G-9 of 20261024-064941-rrr-delivery), as that status holds it: the field was left out.
  assert.ok('report_sha256' in attempt, `the attempt carries no report hash: ${JSON.stringify(attempt)}`);
  assert.equal(attempt.report_sha256, st.report_sha256 ?? null);
  // NULL, STATED (G-9 of 20261024-083753-rrr-remediation-3-review): `?? null` alone held only the field's shape. A
  // reconcile node writes no report (disk-first-protocol, Batched reconcile), so a hash here came from somewhere else.
  assert.equal(st.report_sha256 ?? null, null, `the re-ask's status carries a report hash a reconcile node never writes: ${st.report_sha256}`);
  assert.equal(attempt.report_sha256, null, `the attempt carries a report hash a reconcile node never writes: ${attempt.report_sha256}`);
});

// G-7 of 20261024-083753-rrr-remediation-3-review: the protocol said latest.txt is written when an archived run moves
// into place and a failed write never fails the run, while new-run writes it at mint, unguarded, and that is the only
// write for a project that declares reviews_dir.
test('G-7 (rrr-3): disk-first-protocol states both latest.txt writers and what each failure does', () => {
  const protocol = fs.readFileSync(new URL('../shared/disk-first-protocol.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.doesNotMatch(protocol, /It is written when an archived run moves into place/, 'disk-first-protocol names only the archive write');
  assert.match(protocol, /`new-run` writes it at mint[^.]*a failure there fails the mint/i, 'disk-first-protocol does not state the mint write');
  assert.match(protocol, /declares `reviews_dir` gets the mint's write only/i, 'disk-first-protocol does not say reviews_dir runs get only the mint write');
  assert.match(protocol, /`archive-run` and `remediate` archive without writing it/i, 'disk-first-protocol does not say which archivers leave it alone');
});

// G-8 of 20261024-064941-rrr-delivery: the NOT-LAUNCHED attempt named no node and carried no known cost, so the attempt
// shape the protocol states held on every path but this one.
test('G-8 (rrr): a re-ask not launched records the attempt shape every attempt has', (t) => {
  const { read } = runOnce(t, { FAKE_NO_COST: '1' }, ['  budget_usd_per_barrier: 1.00']);
  const [a] = read('nodes/reconcile.status.json').reask;
  assert.equal(a.state, 'NOT-LAUNCHED');
  assert.equal(a.node, 'reconcile-reask', `the NOT-LAUNCHED attempt names no node: ${JSON.stringify(a)}`);
  for (const k of ['total_cost_usd', 'total_cost_usd_known', 'duration_ms', 'report_sha256']) {
    assert.ok(k in a, `the NOT-LAUNCHED attempt has no ${k}: ${JSON.stringify(a)}`);
  }
});

// The batch loop's record of a node that is not `reconcile` (G-4, G-5, G-7 of 20261024-064941-rrr-delivery): its gaps
// were attributed to `reconcile`, each batch's report was not kept, and the re-ask's aggregate took the report of the
// last batch spawned, a failed one included. These read the source's spelling until G-11 of
// 20261024-072605-rrr-remediation-review: a correct rewrite failed them and wrong code spelled right passed. G-4 and G-7
// are now behaviour; G-5 is too, through the function the loop calls (G-10 of 20261024-083753-rrr-remediation-3-review),
// because no reconcile node writes a report for a run to keep.
test('G-4 (rrr): the batch loop attributes its gaps to the node it runs', (t) => {
  const { read, calls } = runOnce(t, { FAKE_REASK_FOREIGN: 'G-1' });
  assert.equal(calls.length, 2, 'the fixture did not re-ask');
  const notChecked = read('gate.json').buckets.not_checked;
  const foreign = notChecked.filter((b) => /judged groups it was not given: G-1/.test(b.why));
  assert.equal(foreign.length, 1, `the re-ask's foreign row is not named once: ${JSON.stringify(notChecked)}`);
  assert.equal(foreign[0].node_id, 'reconcile-reask', `the re-ask's gap is attributed to ${foreign[0].node_id}, not the node that ran`);
});
test('G-5 (rrr): the batch loop keeps each batch\'s report beside its status and payload', async (t) => {
  const { keepBatchReport } = await import('../scripts/io/run-artifacts.mjs');
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-batch-report-'));
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(runDir, 'nodes'));
  fs.mkdirSync(path.join(runDir, 'evidence'));
  fs.writeFileSync(path.join(runDir, 'nodes', 'reconcile-reask-report.md'), 'batch one\n');
  const to = path.join(runDir, 'evidence', 'batch-1-report.md');
  const status = { report_path: 'nodes/reconcile-reask-report.md', report_sha256: 's1' };
  assert.deepEqual(keepBatchReport({ runDir, status, to }), { report_path: status.report_path, report_sha256: 's1' });
  assert.equal(fs.readFileSync(to, 'utf8'), 'batch one\n', 'the batch\'s report was not kept');
  // The next spawn rewrites the node's report; the kept copy is the batch's own.
  fs.writeFileSync(path.join(runDir, 'nodes', 'reconcile-reask-report.md'), 'batch two\n');
  assert.equal(fs.readFileSync(to, 'utf8'), 'batch one\n');
  // No report (every reconcile node): nothing is written, and the fields are null.
  const none = path.join(runDir, 'evidence', 'batch-2-report.md');
  assert.deepEqual(keepBatchReport({ runDir, status: { report_path: null, report_sha256: null }, to: none }), { report_path: null, report_sha256: null });
  assert.equal(fs.existsSync(none), false, 'a report was kept for a node that wrote none');
  // And the loop calls it, for each batch, so this test is about the loop's copy and not a function beside it.
  const src = fs.readFileSync(new URL('../scripts/run-graph.mjs', import.meta.url), 'utf8');
  const loop = src.slice(src.indexOf('async function reconcileBatchLoop('), src.indexOf('async function runBatchedReconcile('));
  assert.match(loop, /keepBatchReport\(\{[^}]*`batch-\$\{i \+ 1\}-report\.md`/, 'reconcileBatchLoop does not keep each batch\'s report through keepBatchReport');
});
test('G-7 (rrr): the re-ask\'s aggregate takes its report from the last batch whose reply was used', async () => {
  const { lastUsedReport } = await import('../scripts/lib/reconcile-batches.mjs');
  const rep = (n) => ({ report_path: `r${n}.md`, report_sha256: `s${n}` });
  const used = (n) => ({ status: { state: 'OK' }, payload: { groups: [] }, report: rep(n) });
  assert.deepEqual(lastUsedReport([used(1), used(2), { status: { state: 'TIMEOUT' }, payload: null, report: rep(3) }]), rep(2),
    'a failed batch, whose reply is never merged, gave the aggregate its report');
  assert.deepEqual(lastUsedReport([used(1), { status: { state: 'OK' }, payload: null, report: rep(2) }]), rep(1),
    'an OK batch with no payload gave the aggregate its report');
  assert.deepEqual(lastUsedReport([]), { report_path: null, report_sha256: null });
});
