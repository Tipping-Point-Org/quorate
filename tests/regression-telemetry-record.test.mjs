// telemetry-records.plan.md stage 2: one record per finished run, built by one pure module from the run's own files. The
// fixtures under tests/fixtures/telemetry/ were cut from REAL artifacts (a review with the panel, a re-ask, a claim
// check), keeping the fields the builder reads; model text was replaced by "MODEL TEXT" so a record that copied any of it
// is caught by the string-field walk below.

import { test } from 'node:test';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import {
  buildRunRecord, buildClaimCheckRecord, buildSubagentRecord, buildBenchRecord, groupCounts, familyOf, taskEntry, RECORD_STRING_FIELDS,
  RECORD_SCHEMA_VERSION, USAGE_STRING_FIELDS,
} from '../scripts/lib/telemetry-record.mjs';

const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'telemetry');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const ROSTER = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
// The runtime a Claude node ran on is the caller's to give (G-13 of 20261025-211318-tel-remediation-review): the builder
// keeps no vendor name of its own, so every test that expects one passes it.
const RUNTIME = 'claude';
// The adapter table a family is asked of (runtime-call-telemetry.plan.md stage 1): codex declares openai, claude anthropic.
const TABLE = builtinReviewers();

// Every string in a record sits under a key the builder declares, or inside the runtime's own usage objects (vendor
// labels such as the service tier). A string anywhere else is text the record should not have copied.
// Inside them, a string is allowed only under a vendor-label key: the usage objects are not a hole in the walk (G-25 of
// 20261025-203513-tel-delivery, which exempted every string nested under usage or model_usage).
// The builder's own list, imported rather than copied (G-24 of 20261025-211318-tel-remediation-review): a hand copy let
// the two drift, and shared/telemetry.md says the walk uses the builder's list.
const USAGE_LABELS = USAGE_STRING_FIELDS;
function strayStrings(v, key = '', inUsage = false, out = []) {
  if (Array.isArray(v)) { for (const x of v) strayStrings(x, key, inUsage, out); return out; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) strayStrings(x, k, inUsage || k === 'usage' || k === 'model_usage', out);
    return out;
  }
  if (typeof v === 'string' && !(inUsage ? USAGE_LABELS : RECORD_STRING_FIELDS).includes(key)) out.push(`${key}=${v.slice(0, 40)}`);
  return out;
}

function reviewRecord() {
  return buildRunRecord({
    kind: 'review', run: fx('review-run.json'), checks: fx('review-checks.json'), statuses: fx('review-statuses.json'),
    stdouts: fx('review-stdouts.json'), groups: fx('review-groups.json'), decisions: fx('review-decisions.json'),
    gate: fx('review-gate.json'), roster: ROSTER, selfReview: true, defaultRuntime: RUNTIME, table: TABLE,
  });
}

test('stage 2: a review record carries every task the run recorded, with time, tokens and status as recorded', () => {
  const rec = reviewRecord();
  const statuses = fx('review-statuses.json');
  assert.equal(rec.schema_version, RECORD_SCHEMA_VERSION);
  assert.equal(rec.kind, 'review');
  assert.equal(rec.run_id, fx('review-run.json').run_id);
  assert.equal(rec.development_data, true, 'the engine reviewing itself is the tool\'s development data (criterion 9)');
  // The set is the run's: every status passed in is a task, and every check row is one.
  const ids = rec.tasks.map((t) => t.id);
  for (const id of Object.keys(statuses)) assert.ok(ids.includes(id), `${id} has no task`);
  for (const row of fx('review-checks.json').results) assert.ok(ids.includes(`check:${row.check}`), `${row.check} has no task`);

  const lens = rec.tasks.find((t) => t.id === 'code-audit');
  const s = statuses['code-audit'];
  assert.equal(lens.task_kind, 'lens');
  assert.equal(lens.family, 'anthropic');
  assert.equal(lens.duration_ms, s.duration_ms);
  assert.deepEqual(lens.usage, s.usage, 'a usage object of counts and vendor labels survives the projection unchanged');
  assert.equal(lens.cost_usd, s.total_cost_usd);
  assert.equal(lens.exit_code, s.exit_code);
  assert.equal(lens.timed_out, s.timed_out);
  assert.equal(lens.duration_api_ms, fx('review-stdouts.json')['code-audit'].duration_api_ms, 'the stdout envelope adds what the status lacks');
  assert.equal(lens.terminal_reason, fx('review-stdouts.json')['code-audit'].terminal_reason);

  const arm = rec.tasks.find((t) => t.id === 'panel-codex-code');
  assert.equal(arm.task_kind, 'arm');
  assert.equal(arm.family, 'openai');
  assert.equal(arm.cost_usd, null, 'the vendor reports no cost: null, never 0');
  assert.equal(arm.exit_code, null, 'a field this run\'s arm status did not carry is absent, not zero');

  const skipped = rec.tasks.find((t) => t.id === 'ui-audit');
  assert.equal(skipped.usage, null);
  assert.equal(rec.gate.gate, fx('review-gate.json').gate);
  assert.deepEqual(rec.gate.stamps, fx('review-gate.json').stamps);
});

test('stage 2: confirmed and corroborated are counted per family by the reconciler\'s decision', () => {
  const rec = reviewRecord();
  const decisions = fx('review-decisions.json');
  const confirmed = decisions.filter((d) => d.decision === 'confirmed').length;
  // Every finding of this run was an arm's: codex raised every group, and nothing is corroborated.
  assert.equal(rec.findings.per_family.openai.raised, fx('review-groups.json').length);
  assert.equal(rec.findings.per_family.openai.confirmed, confirmed);
  assert.equal(rec.findings.per_family.openai.corroborated, 0);

  // A group holding both families counts as corroborated only when the reconciler confirmed it.
  const groups = [
    { group_id: 'G-1', findings: [{ node_id: 'code-audit' }, { node_id: 'panel-codex-code', source: 'codex' }] },
    { group_id: 'G-2', findings: [{ node_id: 'code-audit' }, { node_id: 'panel-codex-code', source: 'codex' }] },
    { group_id: 'G-3', findings: [{ node_id: 'code-audit' }] },
  ];
  const c = groupCounts(groups, [
    { group_id: 'G-1', decision: 'confirmed' }, { group_id: 'G-2', decision: 'coincidence' }, { group_id: 'G-3', decision: 'confirmed' },
  ], { roster: ROSTER, defaultRuntime: RUNTIME, table: TABLE, table: TABLE });
  assert.deepEqual(c.per_family.anthropic, { raised: 3, confirmed: 2, corroborated: 1 });
  assert.deepEqual(c.per_family.openai, { raised: 2, confirmed: 1, corroborated: 1 });
});

test('stage 2: a family is the roster\'s declared one, else the reviewer, else the default runtime', () => {
  assert.equal(familyOf({ id: 'adj-agy' }, ROSTER, null, TABLE), (ROSTER.adjudicators.find((a) => a.id === 'adj-agy')).family);
  assert.equal(familyOf({ id: 'panel-codex-code' }, ROSTER, null, TABLE), 'openai');
  assert.equal(familyOf({ id: 'code-audit' }, ROSTER, RUNTIME, TABLE), 'anthropic');
  // A lens finding carries its model as `source`: that is not a family, so it falls to the default runtime.
  assert.equal(familyOf({ id: 'code-audit', source: 'opus' }, ROSTER, RUNTIME, TABLE), 'anthropic');
  assert.equal(familyOf({ id: 'unknown-node', source: 'codex' }, ROSTER, null, TABLE), 'openai', 'a declared reviewer still names its family');
});

test('stage 2: a re-ask batch is a task like a Claude node', () => {
  const rec = buildRunRecord({ kind: 'review', statuses: { 'reconcile-reask-1': fx('reask-status.json') }, roster: ROSTER });
  const t = rec.tasks[0];
  assert.equal(t.task_kind, 'reask');
  assert.equal(t.duration_ms, fx('reask-status.json').duration_ms);
  assert.deepEqual(t.usage, fx('reask-status.json').usage);
});

test('stage 2: a claim-check record counts claims by grade and carries its checker as a task', () => {
  const checked = fx('claim-check-checked.json');
  const rec = buildClaimCheckRecord({ checkId: '20261025-164836-telemetry-approval', check: fx('claim-check-check.json'),
    arm: fx('claim-check-arm.json'), checked, roster: ROSTER, table: TABLE });
  assert.equal(rec.kind, 'claim-check');
  assert.equal(rec.claims.total, checked.claims.length);
  assert.equal(rec.claims.dissolved, checked.summary.dissolved);
  assert.equal(rec.claims.downgraded, checked.summary.downgrade);
  assert.equal(rec.claims.questions, checked.summary['ask-operator']);
  const t = rec.tasks.find((x) => x.id === 'claim-checker');
  assert.equal(t.family, 'openai');
  assert.equal(t.duration_ms, fx('claim-check-arm.json').duration_ms);
  assert.deepEqual(t.usage, fx('claim-check-arm.json').usage);
  assert.equal(t.exit_code, null, 'this check predates stage 1c: absent, not zero');
});

test('stage 2: no record carries a string outside the declared fields (no model text)', () => {
  const recs = [reviewRecord(), buildClaimCheckRecord({ check: fx('claim-check-check.json'), arm: fx('claim-check-arm.json'),
    checked: fx('claim-check-checked.json'), roster: ROSTER })];
  for (const r of recs) assert.deepEqual(strayStrings(r), [], `${r.kind}: strings outside the declared fields`);
  assert.equal(JSON.stringify(recs).includes('MODEL TEXT'), false, 'model text reached a record');
});

// ---------------------------------------------------------------------------------------------- stage 3's builders

test('stage 3: a remediation run\'s full checks are tasks, one per attempt and check', () => {
  const rec = buildRunRecord({ kind: 'remediation', fullChecks: [
    { results: { build: { exit_code: 0, outcome: 'passed', started_at: '2026-10-25T10:00:00.000Z', duration_ms: 1200 } } },
    { results: { build: { exit_code: 0, outcome: 'passed' } } },
  ] });
  const ids = rec.tasks.map((t) => t.id);
  assert.deepEqual(ids, ['full-check-1:build', 'full-check-2:build']);
  assert.equal(rec.tasks[0].duration_ms, 1200);
  assert.equal(rec.tasks[1].duration_ms, null, 'an attempt before stage 1b has no time: null, not zero');
});

test('stage 3: a subagent record carries the spawner\'s process facts and the runtime\'s envelope', () => {
  const envelope = fx('subagent-envelope.json');
  const rec = buildSubagentRecord({ envelope, label: 'tel-pr7', pins: { model: 'opus', effort: 'low' },
    proc: { started_at: '2026-10-25T13:00:00.000Z', ended_at: '2026-10-25T13:03:00.000Z', exit_code: 0, signal: null, timed_out: false, timeout_minutes: 30 } });
  const t = rec.tasks[0];
  assert.equal(rec.kind, 'subagent');
  assert.equal(rec.run_id, 'tel-pr7');
  assert.equal(t.model, 'opus');
  assert.equal(t.effort, 'low');
  assert.equal(t.exit_code, 0);
  assert.equal(t.timeout_minutes, 30);
  assert.equal(t.duration_ms, envelope.duration_ms, 'the runtime\'s own duration wins over the spawner\'s pair of times');
  assert.deepEqual(t.usage, envelope.usage);
  assert.equal(t.cost_usd, envelope.total_cost_usd);
  const none = buildSubagentRecord({ envelope: null, proc: { started_at: '2026-10-25T13:00:00.000Z', ended_at: '2026-10-25T13:00:02.000Z', exit_code: 1 } });
  assert.equal(none.tasks[0].state, 'NO-ENVELOPE');
  assert.equal(none.tasks[0].duration_ms, 2000, 'with no envelope, the spawner\'s times give the duration');
});

test('stage 3: a bench record has a task per seed and node, and the recall it measured', () => {
  const results = fx('bench-results.json');
  const rec = buildBenchRecord({ results, label: '2026-09-24T00-04-14-249Z' });
  const first = results.runs[0];
  const node = Object.keys(first.usage)[0];
  const t = rec.tasks.find((x) => x.id === `${first.seed}:${node}`);
  assert.ok(t, 'a seed\'s node has no task');
  assert.deepEqual(t.usage, first.usage[node]);
  assert.equal(t.cost_usd, first.costs[node]);
  assert.equal(t.duration_ms, first.duration_ms[node]);
  assert.equal(rec.recall.overall, results.summary.overall_recall);
  assert.equal(rec.cost_usd, results.total_cost_usd);
});

test('stage 3: the subagent and bench records carry no string outside the declared fields', () => {
  const recs = [
    buildSubagentRecord({ envelope: fx('subagent-envelope.json'), pins: { model: 'opus', effort: 'low' }, label: 'tel-pr7' }),
    buildBenchRecord({ results: fx('bench-results.json'), label: 'x' }),
  ];
  for (const r of recs) assert.deepEqual(strayStrings(r), [], `${r.kind}: strings outside the declared fields`);
  assert.equal(JSON.stringify(recs).includes('MODEL TEXT'), false);
});

test('stage 3: a second-opinion bench record reads seeds[].spent, and an unpriced seed stays null', () => {
  const results = fx('bench-second-opinion.json');
  const rec = buildBenchRecord({ results, label: 'so' });
  assert.equal(rec.tasks.length, results.seeds.length);
  assert.equal(rec.tasks[0].id, `${results.seeds[0].seed}:second-opinion`);
  assert.equal(rec.tasks[0].usage, null);
  assert.equal(rec.tasks[0].cost_usd, null, 'nothing priced is not nothing spent: null, never 0');
  assert.equal(rec.recall.overall, results.summary.recall);
  assert.deepEqual(strayStrings(rec), []);
});

// ------------------------------------------------------------------ remediation of 20261025-203513-tel-delivery

test('G-9/G-25: a string the runtime put in its usage objects reaches the record only under a vendor-label key', () => {
  const status = { model: 'opus', usage: { input_tokens: 3, service_tier: 'standard', note: 'MODEL TEXT',
    server_tool_use: { web_search_requests: 0, detail: 'MODEL TEXT' } }, model_usage: { 'opus-x': { inputTokens: 3, why: 'MODEL TEXT' } } };
  const rec = buildRunRecord({ kind: 'review', statuses: { 'code-audit': status }, roster: ROSTER });
  assert.equal(JSON.stringify(rec).includes('MODEL TEXT'), false, 'model text inside usage reached the tracked record');
  assert.deepEqual(strayStrings(rec), []);
  const t = rec.tasks[0];
  assert.equal(t.usage.input_tokens, 3, 'the counts are kept');
  assert.equal(t.usage.service_tier, 'standard', 'a vendor label is kept');
  assert.equal(t.usage.server_tool_use.web_search_requests, 0);
  assert.equal(t.model_usage['opus-x'].inputTokens, 3);
  // The same rule on the stdout envelope's copy, which a backfill reads from gitignored evidence.
  const fromOut = buildRunRecord({ kind: 'review', statuses: { 'code-audit': { model: 'opus' } },
    stdouts: { 'code-audit': { usage: { output_tokens: 1, text: 'MODEL TEXT' }, modelUsage: { m: { costUSD: 1, x: 'MODEL TEXT' } } } }, roster: ROSTER });
  assert.equal(JSON.stringify(fromOut).includes('MODEL TEXT'), false);
});

test('G-13: a bench node with no usage entry is still a task, with what the bench recorded for it', () => {
  const rec = buildBenchRecord({ results: { runs: [{ seed: 's1', usage: { a: { input_tokens: 1 } },
    nodes: { a: { model: 'opus' }, b: { model: 'opus' } }, costs: { a: 1, b: 2, c: 3 }, duration_ms: { b: 50, d: 7 }, turns: { e: 2 } }] } });
  const ids = rec.tasks.map((t) => t.id).sort();
  assert.deepEqual(ids, ['s1:a', 's1:b', 's1:c', 's1:d', 's1:e'], 'a node recorded in nodes, costs, duration_ms or turns has a task');
  const b = rec.tasks.find((t) => t.id === 's1:b');
  assert.equal(b.cost_usd, 2);
  assert.equal(b.duration_ms, 50);
  assert.equal(b.usage, null, 'no usage entry: null, not dropped');
});

test('G-14: a second-opinion bench seed\'s forge spend is a task of its own', () => {
  const rec = buildBenchRecord({ results: { seeds: [
    { seed: 's1', spent: { second_opinion_usd: 1.5, forge_usd: 0.25, total_usd: 1.75 } },
    { seed: 's2', spent: { second_opinion_usd: 1, forge_usd: null } },
  ] } });
  const forge = rec.tasks.find((t) => t.id === 's1:forge');
  assert.ok(forge, 'the forge spend has no task');
  assert.equal(forge.cost_usd, 0.25);
  assert.equal(rec.tasks.reduce((n, t) => n + (t.cost_usd ?? 0), 0), 2.75, 'every dollar the bench recorded is in a task');
});

test('G-10: every task carries the whole task shape, an absent field as null', () => {
  const keys = Object.keys(buildRunRecord({ kind: 'review', statuses: { x: {} } }).tasks[0]);
  const rec = buildRunRecord({ kind: 'remediation', checks: { results: [{ check: 'build', status: 'PASS', exit_code: 0 }] },
    fullChecks: [{ results: { test: { exit_code: 0 } } }] });
  const bench = buildBenchRecord({ results: { runs: [{ seed: 's', usage: { a: {} } }], seeds: [{ seed: 't', spent: {} }] } });
  const cc = buildClaimCheckRecord({ check: { arm: { reviewer: 'codex' } } });
  for (const t of [...rec.tasks, ...bench.tasks, ...cc.tasks]) {
    for (const k of keys) assert.ok(Object.hasOwn(t, k), `${t.id} has no ${k}`);
  }
  assert.equal(rec.tasks[0].ended_at, null);
  assert.equal(rec.tasks[0].cost_usd, null);
});

test('G-8: the subagent and same-family claim checker are their own task kinds, not other', () => {
  assert.equal(buildSubagentRecord({ envelope: null }).tasks[0].task_kind, 'subagent');
  assert.equal(buildClaimCheckRecord({ sameFamily: {} }).tasks[0].task_kind, 'claim-checker');
});

test('G-16: a remediation\'s full check, which records an outcome and no status, still has its state', () => {
  const rec = buildRunRecord({ kind: 'remediation', fullChecks: [{ results: {
    test: { exit_code: 0, outcome: 'passed' }, build: { exit_code: 124, outcome: 'timed-out' }, lint: { exit_code: 0 } } }] });
  const state = (k) => rec.tasks.find((t) => t.id === `full-check-1:${k}`).state;
  assert.equal(state('test'), 'PASS', 'run-checks\' rule: passed is PASS');
  assert.equal(state('build'), 'FAIL', 'any other outcome is FAIL');
  assert.equal(state('lint'), null, 'no outcome and no status: unknown, not a verdict');
});

test('G-12: a remediation\'s formatter baseline is a task', () => {
  const rec = buildRunRecord({ kind: 'remediation', fmtBaseline: { fmt_check: { exit_code: 1, outcome: 'failed', duration_ms: 9 } } });
  const t = rec.tasks.find((x) => x.id === 'fmt-baseline:fmt_check');
  assert.ok(t, 'the formatter baseline has no task');
  assert.equal(t.task_kind, 'check');
  assert.equal(t.duration_ms, 9);
});

// ------------------------------------------------------------ remediation of 20261025-211318-tel-remediation-review

test('G-14: a node the roster does not name, with no declared reviewer as source, is family unknown (I-6)', () => {
  assert.equal(familyOf({ id: 'not-a-rostered-node' }, ROSTER, RUNTIME, TABLE), 'unknown');
  assert.equal(familyOf({ id: 'not-a-rostered-node', source: 'some-model' }, ROSTER, RUNTIME, TABLE), 'unknown');
  // An unknown finding does not make a runtime-family group look corroborated.
  const c = groupCounts([{ group_id: 'G-1', findings: [{ node_id: 'code-audit' }, { node_id: 'stray' }] }],
    [{ group_id: 'G-1', decision: 'confirmed' }], { roster: ROSTER, defaultRuntime: RUNTIME, table: TABLE, table: TABLE });
  assert.deepEqual(c.per_family.anthropic, { raised: 1, confirmed: 1, corroborated: 0 }, 'claude counted once, in its own group');
  assert.equal(c.per_family.unknown.raised, 1);
  // The engine's own nodes still run on the runtime.
  assert.equal(familyOf({ id: 'reconcile' }, ROSTER, RUNTIME, TABLE), 'anthropic');
  assert.equal(familyOf({ id: 'reconcile-reask-2' }, ROSTER, RUNTIME, TABLE), 'anthropic');
});

test('G-13: the builder keeps no vendor name: a runtime the caller does not give is unknown', () => {
  assert.equal(familyOf({ id: 'code-audit' }, ROSTER, null, TABLE), 'unknown');
  assert.equal(familyOf({ id: 'code-audit' }, ROSTER, 'other-runtime', { 'other-runtime': { cmd: 'o', family: 'other-family' } }), 'other-family');
  const rec = buildRunRecord({ kind: 'review', statuses: { 'code-audit': {} }, roster: ROSTER });
  assert.equal(rec.tasks[0].family, 'unknown');
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'telemetry-record.mjs'), 'utf8');
  assert.equal(/defaultRuntime\s*=\s*'claude'/.test(src), false, 'a vendor literal as the default runtime');
});

test('G-16: a node task and a check task have the same keys', () => {
  const node = buildRunRecord({ kind: 'review', statuses: { x: {} } }).tasks[0];
  const check = buildRunRecord({ kind: 'review', checks: { results: [{ check: 'build', status: 'PASS' }] } }).tasks[0];
  assert.deepEqual(Object.keys(node).sort(), Object.keys(check).sort());
  assert.equal(node.outcome, null);
});

test('G-12: a usage label is kept only as a short label, and a deep usage object cannot overflow the stack', () => {
  const rec = buildRunRecord({ kind: 'review', statuses: { 'code-audit': { usage: {
    input_tokens: 1, service_tier: 'standard', provider: 'MODEL TEXT that is a sentence, not a label', type: 'x'.repeat(200) } } } });
  const u = rec.tasks[0].usage;
  assert.equal(u.service_tier, 'standard');
  assert.equal(Object.hasOwn(u, 'provider'), false, 'free text under a generic label key reached the record');
  assert.equal(Object.hasOwn(u, 'type'), false, 'an unbounded string under a label key reached the record');
  let deep = { input_tokens: 1 };
  for (let i = 0; i < 100000; i += 1) deep = { nested: deep };
  assert.doesNotThrow(() => buildRunRecord({ kind: 'review', statuses: { x: { usage: deep } } }));
});

test('G-18: a bench seed paid for and not scored (unscored_spend) is a task, marked unscored', () => {
  const rec = buildBenchRecord({ results: { runs: [{ seed: 's1', costs: { a: 1 } }],
    unscored_spend: [{ seed: 's2', costs: { 'intent-capture': 1.65 }, usage: { 'intent-capture': { input_tokens: 4 } }, refused: {} }] } });
  const t = rec.tasks.find((x) => x.id === 's2:intent-capture');
  assert.ok(t, 'the unscored spend has no task');
  assert.equal(t.cost_usd, 1.65);
  assert.equal(t.state, 'UNSCORED');
  assert.equal(rec.tasks.find((x) => x.id === 's1:a').state, null);
});

// ------------------------------------------------------------ remediation of 20261025-215217-tel-remediation-2-review

test('G-15: unknown is no family, so a known family beside an unclassified finding is not corroborated', () => {
  const confirmed = (findings) => groupCounts([{ group_id: 'G-1', findings }], [{ group_id: 'G-1', decision: 'confirmed' }],
    { roster: ROSTER, defaultRuntime: RUNTIME, table: TABLE, table: TABLE }).per_family;
  const lone = confirmed([{ node_id: 'code-audit' }, { node_id: 'stray' }]);
  assert.equal(lone.anthropic.corroborated, 0, 'a claude finding beside an unknown one was counted as cross-family agreement');
  assert.equal(lone.unknown.corroborated, 0, 'unknown was counted as corroborating');
  // Two known families still corroborate each other, and an unknown third adds nothing.
  const arm = ROSTER.panel_arms.find((a) => familyOf({ id: a.id }, ROSTER, RUNTIME, TABLE) !== 'anthropic');
  const armFamily = familyOf({ id: arm.id }, ROSTER, RUNTIME, TABLE);
  const both = confirmed([{ node_id: 'code-audit' }, { node_id: arm.id }, { node_id: 'stray' }]);
  assert.equal(both.anthropic.corroborated, 1);
  assert.equal(both[armFamily].corroborated, 1);
  assert.equal(both.unknown.corroborated, 0);
});

test('G-14: a check\'s state from its outcome has one owner, the capture header\'s rule run-checks also uses', () => {
  const src = (p) => fs.readFileSync(path.join(REPO_ROOT, 'scripts', ...p.split('/')), 'utf8');
  for (const f of ['lib/telemetry-record.mjs', 'run-checks.mjs']) {
    assert.equal(/=== 'passed'\s*\?\s*'PASS'/.test(src(f)), false, `${f} keeps its own copy of the passed-is-PASS rule`);
    assert.match(src(f), /statusOfOutcome/, `${f} does not use the one rule`);
  }
});

// G-10 of 20261025-232315-tel-remediation-4-review: a string under a vendor-label key was tested against the label shape
// only, never against the secret shapes its keys are tested against, so a token in `provider` reached a tracked record;
// and a primitive returned before the depth check, so a value nested eight levels deep or more survived.
test('G-10: a usage label with a secret shape is dropped, and so is anything nested eight levels deep', () => {
  const token = ['ghp', 'Z'.repeat(36)].join('_');
  const t = taskEntry('code-audit', { usage: { provider: token, service_tier: 'standard' } }, null, { roster: ROSTER, defaultRuntime: RUNTIME, table: TABLE, table: TABLE });
  assert.equal(t.usage.provider, undefined, 'a secret-shaped label reached the record');
  assert.equal(t.usage.service_tier, 'standard');
  assert.equal(taskEntry('x', { stop_reason: token }).stop_reason, null, 'a secret-shaped result label reached the record');
  let deep = { input_tokens: 5 };
  for (let i = 0; i < 9; i += 1) deep = { n: deep };
  const kept = JSON.stringify(taskEntry('x', { usage: deep }).usage);
  assert.equal(kept.includes('input_tokens'), false, `a value nested past the depth limit was kept: ${kept}`);
});

// G-15 of 20261025-235636-tel-remediation-5-review: only the token shapes were tested, the credential NAME=value shapes
// (keepName) were filtered out, and a label may hold `:`, so a credential name with its value passed as a label or key.
test('G-15: a label or key holding a credential name and its value is dropped, in any case', () => {
  const pw = 'pass' + 'word';
  for (const v of [`${pw}:x1abcdefgh`, `${pw.toUpperCase()}:x1abcdefgh`, `db_${pw}=AbCdEfGhIjKlMnOpQrSt`]) {
    const t = taskEntry('code-audit', { usage: { provider: v, [v]: 3, service_tier: 'standard' }, stop_reason: v }, null,
      { roster: ROSTER, defaultRuntime: RUNTIME, table: TABLE, table: TABLE });
    assert.equal(t.usage.provider, undefined, `a credential-shaped label reached the record: ${v}`);
    assert.equal(Object.hasOwn(t.usage, v), false, `a credential-shaped key reached the record: ${v}`);
    assert.equal(t.stop_reason, null, `a credential-shaped result label reached the record: ${v}`);
    assert.equal(t.usage.service_tier, 'standard');
  }
});

test('G-13: the runtime\'s result labels reach a record only as short labels, never as vendor text', () => {
  const t = (out) => taskEntry('code-audit', {}, out, { roster: ROSTER, defaultRuntime: RUNTIME, table: TABLE, table: TABLE });
  const text = 'MODEL TEXT\nthat spans lines and is not a label';
  const e = t({ api_error_status: text, stop_reason: text, subtype: text, terminal_reason: text });
  for (const k of ['api_error_status', 'stop_reason', 'subtype', 'terminal_reason']) assert.equal(e[k], null, `${k} carried free text`);
  assert.equal(t({ api_error_status: 'x'.repeat(200) }).api_error_status, null, 'an unbounded label reached the record');
  // A status code and the runtime's own labels are kept.
  const ok = t({ api_error_status: 529, stop_reason: 'end_turn', subtype: 'success', terminal_reason: 'completed' });
  assert.equal(ok.api_error_status, '529');
  assert.equal(ok.stop_reason, 'end_turn');
  assert.equal(ok.subtype, 'success');
  assert.equal(ok.terminal_reason, 'completed');
});

// ---------------------------------------------------------------------------------------------- runtime-call-telemetry stage 5
// A task's process facts come from its call's entry (lib/call-entry.mjs) when it has one; a status from before the entries
// keeps giving them as before.

test('runtime-call-telemetry stage 5: a task takes its process facts and outcome from its call entry', () => {
  const call = { reviewer: 'codex', model: 'gpt-5.6-sol', family: 'openai', started_at: '2026-10-26T01:00:00.000Z',
    ended_at: '2026-10-26T01:00:05.000Z', duration_ms: 5000, exit_code: 3, signal: null, timed_out: false, timeout_minutes: 30,
    usage: { input_tokens: 10, output_tokens: 2 }, outcome: 'no-answer' };
  // The status says otherwise (the wrapper's exit 0, its own times): the call entry, measured at the vendor process, wins.
  const t = taskEntry('panel-codex-code', { exit_code: 0, started_at: '2026-10-26T00:59:59.000Z', duration_ms: 9999, usage: { input_tokens: 1 }, call },
    null, { roster: ROSTER, defaultRuntime: RUNTIME, table: TABLE });
  assert.equal(t.exit_code, 3, 'the vendor\'s exit code, not the wrapper\'s');
  assert.equal(t.duration_ms, 5000);
  assert.equal(t.started_at, call.started_at);
  assert.deepEqual(t.usage, call.usage);
  assert.equal(t.outcome, 'no-answer');
  assert.equal(t.family, 'openai');
  assert.equal(t.timeout_minutes, 30);
  // No entry: the status's own facts, as before.
  const old = taskEntry('panel-codex-code', { exit_code: 0, duration_ms: 9999 }, null, { roster: ROSTER, defaultRuntime: RUNTIME, table: TABLE });
  assert.equal(old.exit_code, 0);
  assert.equal(old.duration_ms, 9999);
  assert.equal(old.outcome, null);
});

test('runtime-call-telemetry stage 5: a bench seed\'s forge and judge calls are tasks by their entries', () => {
  const entry = (outcome) => ({ family: 'anthropic', duration_ms: 1200, exit_code: 0, outcome, usage: { output_tokens: 7 } });
  const rec = buildBenchRecord({ results: { seeds: [{ seed: 's1', spent: {}, forge: { call: entry('answered'), cost_usd: 0.4 },
    judge_calls: { mutated: entry('answered'), control: entry('no-answer') } }] } });
  const ids = rec.tasks.map((t) => t.id);
  assert.ok(ids.includes('s1:forge') && ids.includes('s1:judge-mutated') && ids.includes('s1:judge-control'), ids.join(', '));
  const forge = rec.tasks.find((t) => t.id === 's1:forge');
  assert.equal(forge.duration_ms, 1200);
  assert.equal(forge.cost_usd, 0.4);
  assert.equal(rec.tasks.find((t) => t.id === 's1:judge-control').outcome, 'no-answer');
  assert.deepEqual(strayStrings(rec), []);
});
