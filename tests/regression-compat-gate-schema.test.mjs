// gate.json's SHAPE IS A 1.x PROMISE (shared/compatibility.md, "gate.json"; m3-v1.plan.md stage 3).
//
// No schema existed for gate.json: verdict.schema.json is the node envelope's. A consumer reading gate.json (a CI step,
// version-gate) had only the writer's code to go by, and a renamed field would have reached them as a missing one. The
// schema is held two ways: every gate the real orchestrator writes validates against it, strictly, so a field added to
// the writer must be added to the schema; and no field frozen in compatibility.json leaves it or changes type.
//
// BEHAVIOUR, NOT SOURCE SHAPE: the real orchestrator runs in a throwaway repository (as regression-gate-reviewer-overrides
// does), `ui.surface: none` plus `--only ui-audit` reaching the gate with no model spawned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runScript, mintedRunDir, releaseTags } from './helpers.mjs';
import { checkSchema, schemaFieldTypes, freezeHolds, preRelease } from '../scripts/lib/compatibility.mjs';
import { summariseAdjudications } from '../scripts/lib/adjudication.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const schema = JSON.parse(read('scripts/gate.schema.json'));
const compat = JSON.parse(read('scripts/compatibility.json'));

function gateFrom({ build }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-gateschema-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-gateschemahome-'));
  try {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '.');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    fs.writeFileSync(path.join(dir, 'ok.js'), '');
    fs.writeFileSync(path.join(dir, 'fail.js'), 'process.exit(1);\n');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n'
      + `  build: "node ${build}"\n  test: "node ok.js"\nsource_globs: ["src/**"]\nui:\n  surface: none\n\`\`\`\n`);
    git('add', '-A');
    git('commit', '-qm', 'init');
    const mint = runScript('new-run.mjs', ['--slug', 'gs', '--no-verify-sandbox', '--no-request', '--full-sweep', '.'],
      { cwd: dir, env: { QUORATE_HOME: home } });
    assert.equal(mint.status, 0, mint.output.slice(-400));
    const runDir = mintedRunDir(mint.output);
    const graph = runScript('run-graph.mjs', ['--run-dir', runDir, '--skip-panel', '--no-archive', '--only', 'ui-audit'],
      { cwd: dir, env: { QUORATE_HOME: home } });
    const gatePath = path.join(runDir, 'gate.json');
    assert.ok(fs.existsSync(gatePath), `no gate.json:\n${graph.output.slice(-800)}`);
    return JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  } finally {
    for (const d of [dir, home]) fs.rmSync(d, { recursive: true, force: true });
  }
}

test('a finished gate and a forced BLOCKED gate both validate against gate.schema.json, strictly', () => {
  const finished = gateFrom({ build: 'ok.js' });
  const blocked = gateFrom({ build: 'fail.js' });
  assert.equal(blocked.gate, 'BLOCKED', 'the failing build did not force the pre-flight BLOCKED path');
  assert.equal(typeof blocked.reason, 'string', 'the forced path carries its reason');
  for (const [name, g] of [['finished', finished], ['blocked', blocked]]) {
    assert.deepEqual(checkSchema(schema, g, { strict: true }), [], `the ${name} gate does not match the schema`);
  }
});

// G-19 of 20261123-161216-m3s9-review: the gates above come from `--only ui-audit`, so no lens spawns and the gate's
// adjudication is always null; the summary run-graph writes there when a dispute is judged (summariseAdjudications, plus
// `crashed`, run-graph.mjs's gate) was never held to the schema, and its per_judge[].reviewer is null for a judge whose
// vote names no reviewer, where the schema said string.
test('a gate carrying a populated adjudication summary, from its real writer, validates strictly', () => {
  const base = gateFrom({ build: 'ok.js' });
  const summary = summariseAdjudications([
    { outcome: 'decided', decided: true, votes_cast: [{ judge: 'adj-codex', reviewer: 'codex', supports: 'lens', party: true }, { judge: 'adj-agy', supports: 'arm' }],
      absent: [{ judge: 'adj-third' }], invalid: [{ judge: 'adj-four', reviewer: 'agy' }], agreement: { pairs: [{ agree: false }] } },
    { outcome: 'absent', single_judge: true, votes_cast: [], absent: [{ judge: 'adj-codex', reviewer: 'codex' }] },
  ]);
  assert.ok(summary.per_judge.length >= 4, 'the fixture reached every per_judge branch');
  const g = { ...base, adjudication: { ...summary, crashed: null } };
  assert.deepEqual(checkSchema(schema, g, { strict: true }), [], 'the adjudication summary the writer emits does not match the schema');
});

// G-4 of 20261124-030759-m3s9-remediation-3-review-b: the adjudication summary's nested objects listed their properties
// and required none, so a writer that dropped a frozen field still validated. The agreement block and every per_judge row
// are always written whole by summariseAdjudications, so each field is required there.
test('G-4: an adjudication summary missing a frozen agreement or per_judge field does not validate', () => {
  const summary = summariseAdjudications([
    { outcome: 'decided', decided: true, votes_cast: [{ judge: 'adj-codex', reviewer: 'codex', supports: 'lens' }, { judge: 'adj-agy', supports: 'arm' }], agreement: { pairs: [] } },
  ]);
  const sub = schema.properties.adjudication;
  assert.deepEqual(checkSchema(sub, { ...summary, crashed: null }, { strict: true }), [], 'the whole summary validates');
  const { rate: _r, ...agreement } = summary.agreement;
  assert.ok(checkSchema(sub, { ...summary, agreement }).some((e) => /agreement\.rate: required/.test(e)), 'agreement.rate can be dropped');
  const [first, ...rest] = summary.per_judge;
  const { voted: _v, ...row } = first;
  assert.ok(checkSchema(sub, { ...summary, per_judge: [row, ...rest] }).some((e) => /per_judge\[0\]\.voted: required/.test(e)), 'per_judge[].voted can be dropped');
});

// G-4 of 20261124-040316-m3s9-remediation-4-review-b: the adjudication object itself required nothing, so `{}` or a
// summary that lost a count validated. The writer has two forms (run-graph.mjs's gate): the whole summary with `crashed`
// beside it, or `{ crashed }` alone when adjudication crashed before any summary existed. Each is required whole.
test('G-4: an empty or partial adjudication object does not validate; the writer\'s two forms do', () => {
  const sub = schema.properties.adjudication;
  const summary = { ...summariseAdjudications([{ outcome: 'decided', decided: true, votes_cast: [], agreement: { pairs: [] } }]), crashed: null };
  assert.deepEqual(checkSchema(sub, summary, { strict: true }), [], 'the whole summary validates');
  assert.deepEqual(checkSchema(sub, { ...summary, crashed: 'boom' }, { strict: true }), [], 'a summary with a crash beside it validates');
  assert.deepEqual(checkSchema(sub, { crashed: 'boom' }, { strict: true }), [], 'the crash-only form validates');
  assert.ok(checkSchema(sub, {}).length > 0, 'an empty adjudication object validates');
  const { decided: _d, ...partial } = summary;
  assert.ok(checkSchema(sub, partial).length > 0, 'a summary missing `decided` validates');
  assert.ok(checkSchema(sub, { crashed: 'boom', decided: 1 }).length > 0, 'a crash record carrying part of a summary validates');
  assert.ok(checkSchema(sub, { crashed: null }).length > 0, 'a crash-only record with no crash validates');
});

// G-5 of 20261124-040316-m3s9-remediation-4-review-b: a reconcile_reask item required nothing, so `{}` validated and the
// renderer, which reads its groups, would meet a record that names none. Both writers (notLaunchedAttempt, and the
// launched attempt in run-graph.mjs) always write the fields required here.
test('G-5: an empty or partial reconcile_reask record does not validate; the writer\'s record does', async () => {
  const { notLaunchedAttempt } = await import('../scripts/lib/reconcile-batches.mjs');
  const item = schema.properties.reconcile_reask.items;
  const rec = notLaunchedAttempt({ missing: ['G-2'], planned: 1, why: 'budget', node: null });
  assert.deepEqual(checkSchema(item, rec, { strict: true }), [], 'the not-launched record validates');
  assert.ok(checkSchema(item, {}).length > 0, 'an empty re-ask record validates');
  for (const k of ['node', 'state', 'groups', 'judged', 'missing']) {
    const { [k]: _x, ...rest } = rec;
    assert.ok(checkSchema(item, rest).some((e) => e.includes(`.${k}: required`)), `a re-ask record missing \`${k}\` validates`);
  }
});

// THE CENSUS of G-4 and G-5's class: an object in gate.json's schema that declares properties and requires none lets
// any of them be dropped and still validate. Every such object requires its fields.
function objectsWithoutRequired(s, where = '$', out = []) {
  if (!s || typeof s !== 'object') return out;
  if (s.properties && !(Array.isArray(s.required) && s.required.length)) out.push(where);
  for (const [k, x] of Object.entries(s.properties ?? {})) objectsWithoutRequired(x, `${where}.${k}`, out);
  if (s.items) objectsWithoutRequired(s.items, `${where}[]`, out);
  if (s.additionalProperties && typeof s.additionalProperties === 'object') objectsWithoutRequired(s.additionalProperties, `${where}.*`, out);
  return out;
}
test('census: every object gate.schema.json declares properties for requires them', () => {
  assert.deepEqual(objectsWithoutRequired(schema), [], 'these objects declare properties and require none, so an empty or partial one validates');
});

// G-11 of 20261123-174149-m3s9-remediation-review-b: every gate above has an empty buckets.ok and a null
// reconcile_reask, so a field the writer adds to an OK bucket entry or a re-ask record could not fail this file. Here the
// real orchestrator runs with a fake runtime: its ui-audit lens reports OK, and its reconciler leaves G-2 out of its first
// reply, so the gate carries both, as the writer emits them.
async function fakeRuntime() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const all = process.argv.slice(2).join(' ');
  const runDir = process.env.FAKE_RUN_DIR;
  const out = (obj) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1,
    total_cost_usd: 0.01, usage: { input_tokens: 1, output_tokens: 1 }, result: JSON.stringify(obj) }));
  const runId = path.basename(runDir);
  if (/intent_intact/.test(all)) {
    const briefName = fs.readdirSync(path.join(runDir, 'nodes')).filter((f) => /^reconcile(-reask)?-brief\.md$/.test(f))
      .sort((a, b) => fs.statSync(path.join(runDir, 'nodes', b)).mtimeMs - fs.statSync(path.join(runDir, 'nodes', a)).mtimeMs)[0];
    const rel = /The groups you judge are in `([^`]+)`/.exec(fs.readFileSync(path.join(runDir, 'nodes', briefName), 'utf8'))?.[1];
    const groups = JSON.parse(fs.readFileSync(path.join(runDir, rel), 'utf8')).groups;
    const first = !/reask/.test(rel);
    out({ schema_version: 1, run_id: runId, intent_intact: true, summary: 'fake reconciler',
      groups: groups.filter((g) => !first || g.group_id !== 'G-2').map((g) => ({ group_id: g.group_id, decision: 'confirmed', severity: 'LOW', rationale: 'fake' })) });
    return;
  }
  const ev = path.join(runDir, 'evidence', 'ui-audit');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'fake.log'), 'fake evidence\n');
  const findings = [1, 21, 41].map((line, i) => ({ severity: 'LOW', basis: 'convention', file: 'src/a.js', line,
    claim: `fake finding ${i}: a stand-in claim long enough to pass the schema's minimum`, evidence_path: 'evidence/ui-audit/fake.log' }));
  out({ schema_version: 1, run_id: runId, node_id: 'ui-audit', intent_sha: '', verdict: 'RISK', findings, checked_clean: [],
    not_checked: [{ item: 'everything a real lens reads', reason: 'a fake lens' }], out_of_scope_observations: [] });
}

test('a gate with an OK lens in buckets.ok and a recorded re-ask, from the real writer, validates strictly', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-gateschema-ok-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), Array.from({ length: 60 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n');
  const yaml = ['graph_contract_version: 6', 'project: gs-ok', 'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]',
    'doc_paths: []', 'review:', '  external_panel: false', '  models: { judgment: opus, mechanical: sonnet }', 'ui:', '  surface: web', '  static_bundle: ""'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# fixture\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeRuntime.toString()})();\n`);
  const noLogin = path.join(base, 'no-login');
  fs.mkdirSync(noLogin);
  const env = { QUORATE_HOME: home, CLAUDE_CONFIG_DIR: noLogin, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' };
  const minted = runScript('new-run.mjs', ['--slug', 'gs-ok', '--repo-root', repo, '--full-sweep', 'src', '--no-request', '--no-verify-sandbox', '--runtime-bin', bin], { cwd: repo, env });
  const runDir = mintedRunDir(minted.output);
  const graph = runScript('run-graph.mjs', ['--run-dir', runDir, '--repo-root', repo, '--only', 'ui-audit', '--skip-panel', '--no-archive',
    '--preflight', 'never', '--runtime-bin', bin], { cwd: repo, env: { ...env, FAKE_RUN_DIR: runDir } });
  const gatePath = path.join(runDir, 'gate.json');
  assert.ok(fs.existsSync(gatePath), `no gate.json:\n${graph.output.slice(-800)}`);
  const g = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  assert.ok(g.buckets.ok.some((b) => b.node_id === 'ui-audit'), `the fixture did not reach buckets.ok: ${JSON.stringify(g.buckets)}`);
  assert.ok(Array.isArray(g.reconcile_reask) && g.reconcile_reask.length === 1, `the fixture did not reach the re-ask record: ${JSON.stringify(g.reconcile_reask)}`);
  assert.deepEqual(checkSchema(schema, g, { strict: true }), [], 'the OK bucket or re-ask record the writer emits does not match the schema');
});

test('no field frozen at 1.0 leaves the schema or changes type, and before 1.0 every field is frozen', () => {
  const now = schemaFieldTypes(schema);
  const { missing, changed, unfrozen } = freezeHolds({
    frozen: new Map(Object.entries(compat.gate_fields)), current: now, preRelease: preRelease(read('VERSION'), releaseTags()),
  });
  assert.deepEqual(missing, [], 'these gate.json fields are frozen for 1.x and gone from the schema');
  assert.deepEqual(changed, [], 'these gate.json fields changed type or enum');
  assert.deepEqual(unfrozen, [], 'these schema fields are not frozen: before 1.0 compatibility.json gate_fields must equal the schema');
  assert.equal(now.get('gate'), 'string{BLOCKED,FAIL,PASS,RISK}', 'the four gate verdicts are fixed');
});

test('checkSchema refuses what a reader would trip on: a wrong type, a verdict outside its enum, a missing field', () => {
  const s = { type: 'object', required: ['gate'], properties: { gate: { type: 'string', enum: ['PASS'] }, n: { type: ['number', 'null'] } } };
  assert.deepEqual(checkSchema(s, { gate: 'PASS', n: null }), []);
  assert.equal(checkSchema(s, { gate: 'MAYBE' }).length, 1);
  assert.equal(checkSchema(s, { n: 'x' }).length, 2);
  assert.deepEqual(checkSchema(s, { gate: 'PASS', extra: 1 }), [], 'a reader ignores what it does not know');
  assert.equal(checkSchema(s, { gate: 'PASS', extra: 1 }, { strict: true }).length, 1, 'strict reports an undeclared field');
});
