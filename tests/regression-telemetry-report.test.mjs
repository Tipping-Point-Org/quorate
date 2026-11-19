// telemetry-records.plan.md stage 4: `telemetry.mjs report` reads the records at the locations the stage 5 table lists and
// prints, each figure beside its sample size: records by kind; the tie-break count; per family groups raised, confirmed
// and corroborated; claim-check discards and revisions; time and tokens per lens and per task, per family, tokens per usage
// field and never summed across families; the development-data label. No threshold, no recommendation.

import { test } from 'node:test';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, SCRIPTS_DIR, withTempDir } from './helpers.mjs';
import { reportFigures, renderReport, selectRecords, recordDate, OTHER_COUNTS } from '../scripts/lib/telemetry-report.mjs';
import { buildRunRecord, buildClaimCheckRecord, buildSubagentRecord } from '../scripts/lib/telemetry-record.mjs';

const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'telemetry');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const ROSTER = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

const review = () => buildRunRecord({ kind: 'review', run: fx('review-run.json'), checks: fx('review-checks.json'),
  statuses: fx('review-statuses.json'), stdouts: fx('review-stdouts.json'), groups: fx('review-groups.json'),
  decisions: fx('review-decisions.json'), gate: fx('review-gate.json'), roster: ROSTER, selfReview: true,
  // The runtime is the caller's to give; the builder keeps no vendor name (G-13 of 20261025-211318-tel-remediation-review).
  defaultRuntime: 'claude', table: builtinReviewers() });
const check = () => buildClaimCheckRecord({ checkId: '20261025-164836-telemetry-approval', check: fx('claim-check-check.json'),
  arm: fx('claim-check-arm.json'), checked: fx('claim-check-checked.json'), roster: ROSTER });

test('stage 4: the figures carry every count with its sample size', () => {
  const r = review(); const c = check();
  const rem = buildRunRecord({ kind: 'remediation', statuses: { remediation: { state: 'OK' } }, roster: ROSTER });
  const fig = reportFigures([r, c, rem]);
  assert.equal(fig.records, 3);
  assert.deepEqual(fig.by_kind, { review: 1, 'claim-check': 1, remediation: 1 });
  assert.equal(fig.development_records, 1);
  assert.equal(fig.families.runs, 1);
  assert.deepEqual(fig.families.per_family.openai, r.findings.per_family.openai);
  assert.equal(fig.claims.checks, 1);
  assert.equal(fig.claims.dissolved, c.claims.dissolved);
  assert.equal(fig.claims.downgraded, c.claims.downgraded);
  // Time and tokens per lens: the lens's own row, its family's, with n.
  const lens = fig.tasks['lens:code-audit'].anthropic;
  const s = fx('review-statuses.json')['code-audit'];
  assert.equal(lens.n, 1);
  assert.equal(lens.duration_ms.total, s.duration_ms);
  assert.equal(lens.usage.output_tokens, s.usage.output_tokens);
  assert.equal(lens.cost_usd, s.total_cost_usd);
  // The arm's tokens stay in its family's row, under its own field names.
  const arm = fig.tasks['arm:panel-codex-code'].openai;
  assert.equal(arm.usage.reasoning_output_tokens, fx('review-statuses.json')['panel-codex-code'].usage.reasoning_output_tokens);
  assert.equal(arm.priced, 0, 'the vendor reported no cost, so nothing is priced');
  assert.equal(fig.tasks.lens.openai, undefined, 'no family\'s tokens were summed into another\'s');
});

test('stage 4: a tie-break is counted per judge call and per run', () => {
  const rec = buildRunRecord({ kind: 'review', statuses: { 'adjudicate-G-1-adj-agy': { state: 'OK' }, 'adjudicate-G-1-adj-codex': { state: 'OK' } }, roster: ROSTER });
  assert.deepEqual(reportFigures([rec]).tie_breaks, { judges: 2, runs: 1 });
});

test('stage 4: records are selected by kind and by date, the date from started_at or the run id', () => {
  const sub = buildSubagentRecord({ label: 'round-1', proc: {} });
  assert.equal(recordDate({ run_id: '20261025-164836-x' }), Date.parse('2026-10-25T00:00:00Z'));
  assert.equal(recordDate({ run_id: '2026-09-24T00-04-14-249Z' }), Date.parse('2026-09-24T00:00:00Z'));
  assert.equal(recordDate({ run_id: 'round-1' }), null);
  const recs = [review(), check(), sub];
  assert.equal(selectRecords(recs, { kind: 'claim-check' }).length, 1);
  assert.equal(selectRecords(recs, { since: '2026-10-25' }).length, 2, 'an undated record is not after any date');
  assert.throws(() => selectRecords(recs, { since: 'yesterday' }), /not a date/);
});

test('stage 4: the rendered report says each figure\'s n, labels development data, and lists other counts on --fields', () => {
  const text = renderReport(reportFigures([review(), check()]), {
    locations: [{ where: '.claude/reviews', found: 1 }, { where: 'bench/results', found: 0 }], fields: true });
  assert.match(text, /development data/);
  assert.match(text, /\b0\s+bench\/results/, 'an empty location is shown, not dropped');
  assert.match(text, /Claim checks \(n = 1\)/);
  assert.match(text, /lens:code-audit\s+anthropic\s+n=1/);
  assert.match(text, /none reported/, 'an unpriced row says so instead of $0');
  for (const f of OTHER_COUNTS) assert.ok(text.includes(f), `--fields omits "${f}"`);
  assert.doesNotMatch(text, /recommend|threshold/i, 'no threshold and no recommendation (criteria 2-5 are the second plan\'s)');
});

// G-11 of 20261110-234941-dps-remediation-7-review: A-9, a vendor name in a message is a defect even when it is correct.
test('G-11: the report\'s list of other counts names no vendor', () => {
  for (const f of OTHER_COUNTS) assert.doesNotMatch(f, /claude|anthropic|codex|openai|gemini|\bagy\b/i, `a vendor is named in "${f}"`);
});

test('stage 4: telemetry.mjs report reads every location and counts what it found in each', () => {
  withTempDir((dir) => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: tel-report',
      'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', '```', ''].join('\n'));
    const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x'); git('add', '-A'); git('commit', '-qm', 'f');
    const put = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };
    put(path.join(repo, '.claude', 'reviews', '20261025-000001-r', 'telemetry.json'), review());
    put(path.join(repo, '.claude', 'claim-checks', 'c1', 'telemetry.json'), check());
    put(path.join(repo, '.claude', 'plan-reviews', 'p', 'round-1', 'envelope.telemetry.json'),
      buildSubagentRecord({ envelope: fx('subagent-envelope.json'), label: 'round-1', pins: { model: 'opus', effort: 'low' } }));
    const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home') };
    delete env.GRAPH_NODE_DEPTH;
    const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'telemetry.mjs'), 'report', '--repo-root', repo], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /3 record\(s\)/);
    assert.match(r.stdout, /1\s+\S*\.claude[\\/]reviews/);
    assert.match(r.stdout, /1\s+\S*\.claude[\\/]plan-reviews/);
    assert.match(r.stdout, /0\s+\S*bench[\\/]results/);
    assert.match(r.stdout, /subagent/);
  });
});
