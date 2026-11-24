// gate.json IS CHECKED AGAINST ITS SCHEMA WHERE IT IS WRITTEN (gate-schema-at-writer.plan.md; design GS-D1..GS-D4 A).
//
// M3 stage 9's chain found the schema and its one writer apart in five reviews running (G-19, G-4 twice, G-5, G-9 and
// G-6): the schema was held only by tests that build gates, so whatever no test built drifted. Stage 1: an older
// engine's re-ask record (a single object, before 337ef0ba) is read into the current shape, null for what it never
// recorded. Stage 2: run-graph checks every gate strictly before writing it; one that fails is written BLOCKED, stamped
// GATE-SCHEMA, its reason naming the errors, and what is written validates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runScript, mintedRunDir } from './helpers.mjs';
import * as compat from '../scripts/lib/compatibility.mjs';
// A namespace import, so a missing fitToSchema fails its own test rather than the whole file's import.
const { checkSchema } = compat;
const fitToSchema = (...a) => { assert.equal(typeof compat.fitToSchema, 'function', 'lib/compatibility.mjs has no fitToSchema'); return compat.fitToSchema(...a); };
import { reaskAttempts, REASK_ATTEMPT_FIELDS } from '../scripts/lib/reconcile-batches.mjs';

const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'gate.schema.json'), 'utf8'));
// The shape run-graph wrote before 337ef0ba (reconcile-reask-shape stage 2), as `git show 337ef0ba~1:scripts/run-graph.mjs`
// shows it: one object, no node, batches, batches_planned, total_cost_usd_known or report_sha256.
const OLDER_REASK = { groups: ['G-2'], state: 'OK', judged: ['G-2'], missing: [], total_cost_usd: 0.1, duration_ms: 1200 };

test('stage 1: reaskAttempts reads an older single-object re-ask into the current shape, null for what it never recorded', () => {
  const [a, ...rest] = reaskAttempts({ reask: OLDER_REASK });
  assert.deepEqual(rest, []);
  for (const k of REASK_ATTEMPT_FIELDS) assert.ok(Object.hasOwn(a, k), `the normalized attempt has no ${k}`);
  assert.equal(a.node, null);
  assert.equal(a.batches, null);
  assert.equal(a.total_cost_usd_known, null);
  assert.equal(a.report_sha256, null);
  assert.deepEqual(a.groups, ['G-2'], 'a field the older record had is kept');
  assert.deepEqual(checkSchema(schema.properties.reconcile_reask.items, a, { strict: true }), [], 'the normalized older attempt does not validate');
  assert.deepEqual(reaskAttempts({ reask: [OLDER_REASK] })[0], a, 'a list holding the older shape is normalized the same way');
  assert.deepEqual(reaskAttempts({}), []);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-gsw-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-gswhome-'));
  t.after(() => { for (const d of [dir, home]) fs.rmSync(d, { recursive: true, force: true }); });
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, 'ok.js'), '');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
    '# t\n\n```yaml\ngraph_contract_version: 6\nproject: t\ncommands:\n'
    + '  build: "node ok.js"\n  test: "node ok.js"\nsource_globs: ["src/**"]\nui:\n  surface: none\n```\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  const env = { QUORATE_HOME: home };
  const mint = runScript('new-run.mjs', ['--slug', 'gsw', '--no-verify-sandbox', '--no-request', '--full-sweep', '.'], { cwd: dir, env });
  assert.equal(mint.status, 0, mint.output.slice(-400));
  const runDir = mintedRunDir(mint.output);
  const graph = (extra = []) => runScript('run-graph.mjs', ['--run-dir', runDir, '--skip-panel', '--no-archive', '--only', 'ui-audit', ...extra],
    { cwd: dir, env });
  const gate = () => JSON.parse(fs.readFileSync(path.join(runDir, 'gate.json'), 'utf8'));
  return { runDir, graph, gate };
}

// Edit one node status in place: the writer copies a status's fields into the gate, so a status is how a resumed run
// carries an older engine's record, or a mistyped one, into it.
function editStatus(runDir, node, edit) {
  const p = path.join(runDir, 'nodes', `${node}.status.json`);
  const st = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  fs.writeFileSync(p, JSON.stringify(edit(st), null, 2));
}

test('stage 1: a resumed run whose reconcile status holds the older re-ask writes a gate that validates strictly', (t) => {
  const { runDir, graph, gate } = fixture(t);
  graph();
  editStatus(runDir, 'reconcile', (st) => ({ ...st, reask: OLDER_REASK }));
  const r = graph(['--resume']);
  const g = gate();
  assert.ok(Array.isArray(g.reconcile_reask), `the resumed gate carries no re-ask record:\n${r.output.slice(-600)}`);
  assert.deepEqual(checkSchema(schema, g, { strict: true }), [], 'the resumed gate does not match its schema');
  assert.ok(!(g.stamps ?? []).includes('GATE-SCHEMA'), 'the older shape was refused rather than read');
});

test('stage 2: a gate that fails its schema is written BLOCKED, stamped GATE-SCHEMA, the field named, and validates', (t) => {
  const { runDir, graph, gate } = fixture(t);
  graph();
  assert.deepEqual(checkSchema(schema, gate(), { strict: true }), [], 'the first gate should already validate');
  // The framework stamp the writer copies from run.json, its version written as a number and carrying a field the schema
  // does not declare (GS-D4 A: strict): nothing upstream refuses either, and both reach gate.framework.
  const rjPath = path.join(runDir, 'run.json');
  const rj = JSON.parse(fs.readFileSync(rjPath, 'utf8'));
  rj.framework = { ...rj.framework, version: 7, undeclared_here: true };
  fs.writeFileSync(rjPath, JSON.stringify(rj, null, 2));
  const r = graph(['--resume']);
  const g = gate();
  assert.equal(g.gate, 'BLOCKED', `the mistyped gate was not blocked:\n${r.output.slice(-600)}`);
  assert.ok(g.stamps.includes('GATE-SCHEMA'), 'the stamp is missing');
  assert.match(g.reason, /framework\.version/, 'the reason does not name the mistyped field');
  assert.match(g.reason, /framework\.undeclared_here: not declared/, 'the reason does not name the undeclared field');
  assert.notEqual(r.status, 0, 'a BLOCKED gate exits 1');
  // EVERY error, framework's included (G-10 of 20261124-131313-gsw-delivery): those are the errors injected above, and a
  // filter on them let a gate that passed no strict check be written (G-7). The fallback is said on stderr (I-6).
  assert.deepEqual(checkSchema(schema, g, { strict: true }), [], 'the written BLOCKED gate does not validate strictly');
  assert.match(r.output, /run-graph: the BLOCKED gate still did not match gate\.schema\.json/, 'the fallback is not said on stderr');
  assert.equal(g.framework.commit, rj.framework.commit, 'a declared field that validated was not kept');
});

test('stage 2: a mistyped nested field the schema declares (a re-ask record) is repaired, not written as is', (t) => {
  const { runDir, graph, gate } = fixture(t);
  graph();
  // groups as a string where the schema declares an array of strings: reaskAttempts keeps a field the record has.
  editStatus(runDir, 'reconcile', (st) => ({ ...st, reask: [{ ...OLDER_REASK, groups: 'G-2', undeclared_nested: 1 }] }));
  const r = graph(['--resume']);
  const g = gate();
  assert.equal(g.gate, 'BLOCKED', `the mistyped gate was not blocked:\n${r.output.slice(-600)}`);
  assert.ok(g.stamps.includes('GATE-SCHEMA'), 'the stamp is missing');
  assert.deepEqual(checkSchema(schema, g, { strict: true }), [], 'the written BLOCKED gate does not validate strictly');
  assert.match(r.output, /run-graph: the BLOCKED gate still did not match gate\.schema\.json/, 'the fallback is not said on stderr');
});

test('fitToSchema: keeps what validates, replaces what does not with the least value its schema admits', () => {
  const s = { type: 'object', required: ['a', 'b', 'c'], properties: {
    a: { type: 'string' }, b: { type: ['number', 'null'] },
    c: { type: 'object', required: ['x', 'y'], properties: { x: { type: 'boolean' }, y: { type: 'array', items: { type: 'string' } } } },
  } };
  const v = { a: 'kept', b: 'bad', c: { x: 'bad', y: ['ok', 3], z: 1 }, extra: true };
  const out = fitToSchema(s, v);
  assert.deepEqual(out, { a: 'kept', b: null, c: { x: false, y: ['ok'] } });
  assert.deepEqual(checkSchema(s, out, { strict: true }), []);
  assert.equal(fitToSchema(s, { a: 'x', b: 1, c: { x: true, y: [] } }).a, 'x', 'a valid value is returned as is');
});

// G-2 of 20261124-140633-gsw-remediation-review-b: the object branch required `properties`, so an object schema defined
// only by `additionalProperties` (adjudication.per_judge[].votes) fell to its least value, and one mistyped vote count
// erased every valid one in the BLOCKED gate's fallback.
test('fitToSchema: an object schema with only additionalProperties keeps each entry that fits', () => {
  const votes = { type: 'object', additionalProperties: { type: 'integer' } };
  assert.deepEqual(fitToSchema(votes, { kept: 2, bad: 'x' }), { kept: 2, bad: 0 });
  const nested = { type: 'object', required: ['votes'], properties: { votes } };
  const out = fitToSchema(nested, { votes: { a: 1, b: 'x', c: 3 } });
  assert.deepEqual(out, { votes: { a: 1, b: 0, c: 3 } });
  assert.deepEqual(checkSchema(nested, out, { strict: true }), []);
});
