// telemetry-run-time.plan.md stage 1 (operator, 2026-10-27: "I noticed the run itself took 30 minutes: this si one of the
// reasons I asked if we are measuring everything"): the records held every run's start and end and every task's, and the
// report showed neither a run's duration nor where it went. Review 20261027-015201-atl-delivery ran 30.4 minutes, its
// lenses about 20 seconds each; laid out by hand it was ~15.4 minutes of pre-flight, ~12 of arms run three at a time.
// It also counted ui-audit and feature-verify, skipped in this repository, as zero-time lens runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runScript, mintSlug, mintedRunId, mintedRunDir } from './helpers.mjs';
import { buildRunRecord, buildClaimCheckRecord, buildSubagentRecord, RECORD_STRING_FIELDS } from '../scripts/lib/telemetry-record.mjs';
import * as telemetryRecord from '../scripts/lib/telemetry-record.mjs';
import { runTimeline, reportFigures, renderReport } from '../scripts/lib/telemetry-report.mjs';
import { writeSuiteRecord, readRecords } from '../scripts/io/telemetry-record.mjs';

const REVIEW = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'telemetry', 'review-timeline.json'), 'utf8'));
const min = (ms) => Math.round(ms / 6000) / 10;

test('stage 1: a run\'s duration is its own start to its end', () => {
  assert.equal(min(runTimeline(REVIEW).run_ms), 30.4);
});

test('stage 1: the phases of the atl-delivery review come out as its hand-made timeline', () => {
  const p = runTimeline(REVIEW).phases;
  assert.equal(min(p.intent.span_ms), 0.6);
  assert.equal(min(p.fanout.span_ms), 11.9, 'lenses and arms, 16.9 to 28.8 minutes');
  assert.equal(min(p.fanout.lens_span_ms), 1.8, 'the lenses alone, 16.9 to 18.7');
  assert.equal(min(p.fanout.arm_span_ms), 11.9, 'the arms alone, three at a time');
  assert.equal(min(p.barrier.span_ms), 1.6, 'reconcile then second-opinion');
});

test('stage 1: a phase whose tasks are untimed reports how many, never zero', () => {
  const pre = runTimeline(REVIEW).phases.preflight;
  assert.equal(pre.span_ms, null, 'this run\'s checks carry no times');
  assert.equal(pre.untimed, 2, 'build and test ran untimed; the skipped checks are not counted');
  g4g15();
});

// G-5 of 20261027-103720-trt-remediation-3-review (operator, 2026-10-28: "C"): the fixture above was cut from a run whose
// checks were never timed, so no test showed the pre-flight phase as a span on a real record. This one is cut from the
// delivery review 20261027-071443-trt-delivery, whose build and test checks carry real starts and durations.
const TIMED = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'telemetry', 'review-timeline-timed.json'), 'utf8'));

test('stage 1: a real run with timed checks shows the pre-flight as a span', () => {
  const t = runTimeline(TIMED);
  assert.equal(min(t.run_ms), 31.9);
  assert.equal(t.phases.preflight.untimed, 0, 'build and test were timed; the skipped checks are not counted');
  assert.equal(min(t.phases.preflight.span_ms), 13.3, 'build from 07:15:12.2 to the test\'s end at 07:28:30.3');
  assert.ok(min(t.uncovered_ms) < 1, `the timed phases cover the run, uncovered ${min(t.uncovered_ms)} min`);
  assert.match(renderReport(reportFigures([TIMED])), /pre-flight\s+n=1 timed\s+median 13\.3 min\s+\(untimed 0 task\(s\)\)/);
});

test('stage 1: the time no task covers is reported, so an untimed phase is still visible', () => {
  const t = runTimeline(REVIEW);
  // 30.4 minutes less intent 0.6, fan-out 11.9 and barrier 1.6, the gaps between them included in "uncovered".
  assert.ok(min(t.uncovered_ms) >= 15.5 && min(t.uncovered_ms) <= 16.5, `uncovered ${min(t.uncovered_ms)} min`);
});

test('stage 1: skipped tasks are counted apart and left out of every duration', () => {
  const fig = reportFigures([REVIEW]);
  const ui = fig.tasks['lens:ui-audit'];
  assert.ok(!ui || Object.values(ui).every((g) => g.n === 0), 'a skipped lens is not a run');
  assert.equal(fig.skipped['lens:ui-audit'], 1);
  assert.equal(fig.skipped['lens:feature-verify'], 1);
  const lens = Object.values(fig.tasks.lens)[0];
  assert.equal(lens.n, 6, 'six lenses ran');
  g8g9g10();
});

test('stage 1: the report prints run time and phases with their sample sizes', () => {
  const text = renderReport(reportFigures([REVIEW]));
  assert.match(text, /Run time per kind/);
  assert.match(text, /review\s+n=1\s+total 30\.4 min, median 30\.4 min/);
  assert.match(text, /pre-flight\s+n=0 timed.*untimed 2/);
  assert.match(text, /fan-out\s+n=1 timed\s+median 11\.9 min/);
  assert.match(text, /not covered by any task\s+n=1\s+median 1[56]\.\d min/);
  // G-6 of 20261027-083759-trt-remediation-review: a zero count without times was left out, not rendered beside its n.
  assert.match(text, /review\s+n=1\s+total 30\.4 min, median 30\.4 min\s+\(0 record\(s\) with no duration/);
  assert.match(text, /fan-out\s+n=1 timed\s+median 11\.9 min\s+\(untimed 0 task\(s\)\)/);
  // G-2 of 20261027-094343-trt-remediation-2-review: a zero count of records starting at the mint was left out.
  assert.match(text, /\(0 record\(s\) start at the mint/);
});

// ---------------------------------------------------------------------------------------------------------------- stage 2
// The record started at the MINT (run.json created_at): 166 of 349 reviews had more than five minutes between mint and first
// task, the worst 1,896 of 1,910 minutes, so a review minted and run later counted the idle wait as run time. The mint was
// untimed, lens and arm waits for a pool slot were invisible, and claim-check and subagent records had no start or end.

test('stage 2: a run record starts at run-graph\'s own start, not the mint, and says which', () => {
  const run = { run_id: 'r', created_at: '2026-10-27T00:00:00.000Z', graph_started_at: '2026-10-27T01:00:00.000Z',
    mint_started_at: '2026-10-26T23:59:00.000Z', mint_ended_at: '2026-10-27T00:00:30.000Z' };
  const rec = buildRunRecord({ kind: 'review', run, statuses: { 'code-audit': { state: 'OK',
    started_at: '2026-10-27T01:00:10.000Z', ended_at: '2026-10-27T01:02:00.000Z' } }, roster: { lenses: [{ id: 'code-audit' }] } });
  assert.equal(rec.started_at, '2026-10-27T01:00:00.000Z');
  assert.equal(rec.started_from, 'run');
  assert.equal(rec.mint.duration_ms, 90_000, 'the mint is its own figure, outside the run\'s window');
  assert.equal(runTimeline(rec).run_ms, 120_000, 'two minutes of run, not the hour after the mint');
  const old = buildRunRecord({ kind: 'review', run: { run_id: 'r', created_at: '2026-10-27T00:00:00.000Z' } });
  assert.equal(old.started_at, '2026-10-27T00:00:00.000Z');
  assert.equal(old.started_from, 'mint', 'a record from before graph_started_at says it starts at the mint');
  assert.equal(old.mint, null);
});

test('stage 2: a task held by a pool carries its wait for a slot; every task has the field', () => {
  const rec = buildRunRecord({ kind: 'review', run: { run_id: 'r' }, roster: { lenses: [{ id: 'code-audit' }] },
    statuses: { 'code-audit': { state: 'OK', started_at: '2026-10-27T01:03:00.000Z', ended_at: '2026-10-27T01:04:00.000Z' },
      reconcile: { state: 'OK', started_at: '2026-10-27T01:05:00.000Z', ended_at: '2026-10-27T01:06:00.000Z' } },
    queue: { 'code-audit': '2026-10-27T01:00:00.000Z' } });
  const by = Object.fromEntries(rec.tasks.map((t) => [t.id, t]));
  assert.equal(by['code-audit'].queued_ms, 180_000);
  assert.equal(by.reconcile.queued_ms, null, 'no pool held it: null, never zero');
  assert.ok(RECORD_STRING_FIELDS.includes('started_from'));
});

test('stage 2: the report prints the mint, the lens and arm waits, and how many records still start at the mint', () => {
  const run = { run_id: 'r', graph_started_at: '2026-10-27T01:00:00.000Z',
    mint_started_at: '2026-10-27T00:58:00.000Z', mint_ended_at: '2026-10-27T00:59:00.000Z' };
  const rec = buildRunRecord({ kind: 'review', run, roster: { lenses: [{ id: 'code-audit' }] },
    statuses: { 'code-audit': { state: 'OK', started_at: '2026-10-27T01:03:00.000Z', ended_at: '2026-10-27T01:04:00.000Z' } },
    queue: { 'code-audit': '2026-10-27T01:00:00.000Z' } });
  const text = renderReport(reportFigures([rec, { ...REVIEW, started_from: 'mint' }]));
  assert.match(text, /lens wait for a slot\s+n=\d+\s+median/);
  assert.match(text, /mint \(its own command\)\s+n=1\s+median 1\.0 min/);
  assert.match(text, /1 record\(s\) start at the mint/);
});

test('stage 2: claim-check and subagent records carry their own start and end', () => {
  const cc = buildClaimCheckRecord({ journal: [{ step: 'start', at: '2026-10-27T01:00:00.000Z' },
    { step: 'end', exit_code: 0, at: '2026-10-27T01:02:00.000Z' }] });
  assert.equal(runTimeline(cc).run_ms, 120_000);
  const sub = buildSubagentRecord({ proc: { started_at: '2026-10-27T01:00:00.000Z', ended_at: '2026-10-27T01:00:45.000Z' } });
  assert.equal(runTimeline(sub).run_ms, 45_000);
});

test('stage 2: new-run records its mint\'s start and end, and run-graph its own start and the fan-out\'s queue', (t) => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-trt-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), body); };
  put('src/app.js', 'export const x = 1;\n');
  const yaml = ['graph_contract_version: 5', 'project: trt', 'commands:', '  build: "node -e 0"', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:', '  external_panel: false'].join('\n');
  put('CLAUDE.md', '# fixture\n\n```yaml\n' + yaml + '\n```\n');
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  const slug = mintSlug('trt');
  const mint = runScript('new-run.mjs', ['--slug', slug, '--repo-root', repo, '--no-request', '--no-verify-sandbox', '--full-sweep', 'src'], { cwd: repo });
  assert.equal(mint.status, 0, mint.output.slice(-500));
  const runId = mintedRunId(mint.output, slug);
  const staged = mintedRunDir(mint.output);
  t.after(() => fs.rmSync(staged, { recursive: true, force: true }));
  const minted = JSON.parse(fs.readFileSync(path.join(staged, 'run.json'), 'utf8'));
  assert.ok(Date.parse(minted.mint_started_at) <= Date.parse(minted.mint_ended_at), JSON.stringify(minted.mint_started_at));
  assert.equal(minted.graph_started_at, undefined, 'the mint does not start the run');
  // G-13 of 20261027-071443-trt-delivery: a queue.json that cannot be read was taken for a first fan-out and overwritten,
  // its recorded waits lost without a word. It is kept aside and named.
  fs.writeFileSync(path.join(staged, 'queue.json'), '{"code-audit": "2026-10-27T00:00:00.000Z"');
  const graph = runScript('run-graph.mjs', ['--run-dir', staged, '--repo-root', repo, '--only', 'ui-audit', '--preflight', 'always'], { cwd: repo });
  const dir = [path.join(repo, '.claude', 'reviews', runId), staged].find((d) => fs.existsSync(path.join(d, 'run.json')));
  const ran = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  assert.ok(Date.parse(ran.graph_started_at) >= Date.parse(minted.mint_ended_at), `graph_started_at ${ran.graph_started_at}`);
  assert.ok(fs.existsSync(path.join(dir, 'queue.json')), 'run-graph wrote no queue.json');
  assert.match(graph.output, /queue\.json could not be read/, 'an unreadable queue.json was overwritten without a word');
  assert.equal(fs.readFileSync(path.join(dir, 'queue.unreadable.json'), 'utf8'), '{"code-audit": "2026-10-27T00:00:00.000Z"');
});

test('stage 2: shared/telemetry.md defines a run\'s end as buildRunRecord computes it', () => {
  // G-3 (and its symptom G-12) of 20261027-083759-trt-remediation-review: the record's end became the later of the last
  // task's end and run.json's graph_ended_at, and the owning document still said the last task's end.
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'telemetry.md'), 'utf8').replace(/\r?\n\s*/g, ' ');
  assert.doesNotMatch(doc, /Its end is its last task's end\./, 'the document still ends a run at its last task');
  assert.match(doc, /graph_ended_at/, 'the document never defines graph_ended_at');
  // G-8 of 20261027-094343-trt-remediation-2-review: a mention passed, so wording saying the earlier value would too.
  assert.match(doc, /Its end is the later of its last non-skipped task's end and `run\.json`'s `graph_ended_at`/,
    'the document does not end a run at the later of its last task\'s end and graph_ended_at');
  const run = { run_id: 'r', graph_started_at: '2026-10-27T01:00:00.000Z', graph_ended_at: '2026-10-27T01:10:00.000Z' };
  const statuses = { 'code-audit': { state: 'OK', started_at: '2026-10-27T01:01:00.000Z', ended_at: '2026-10-27T01:02:00.000Z' } };
  assert.equal(buildRunRecord({ kind: 'review', run, statuses }).ended_at, run.graph_ended_at);
  assert.equal(buildRunRecord({ kind: 'review', run: { ...run, graph_ended_at: undefined }, statuses }).ended_at, '2026-10-27T01:02:00.000Z');
  // G-10 of 20261028-203526-trt-g5-review: both cases above pass an end that takes graph_ended_at whenever it is present.
  // A graph_ended_at before the last task's end must not shorten the run.
  assert.equal(buildRunRecord({ kind: 'review', run: { ...run, graph_ended_at: '2026-10-27T01:01:30.000Z' }, statuses }).ended_at,
    '2026-10-27T01:02:00.000Z', 'a graph_ended_at earlier than the last task\'s end was taken as the run\'s end');
});

test('stage 2: every telemetry-only write in run-graph and remediate goes through bestEffort, a failure a note', () => {
  // G-9 of 20261027-083759-trt-remediation-review: saveRun({graph_started_at}) and saveRun({graph_ended_at}) ran unguarded,
  // so a run.json write error threw out of remediate after its commits (telemetry is a note, never a failed run).
  // G-6 and G-9 of 20261027-094343-trt-remediation-2-review: the check was a try/catch regex on graph_* lines only, so it
  // passed a catch that rethrows and never looked at queue.json, written unguarded and only for telemetry's queued_ms.
  // Each write is now a call of the one helper, whose not rethrowing is checked here by making it fail.
  const sites = {
    'remediate.mjs': [/saveRun\(\{ graph_started_at/, /saveRun\(\{ graph_ended_at/],
    'run-graph.mjs': [/runJson\.graph_started_at = new Date/, /graph_ended_at = new Date/, /writeJson\(queuePath, queue\)/],
    'new-run.mjs': [/runJson\.mint_ended_at = new Date/],
  };
  const outside = [];
  for (const [file, patterns] of Object.entries(sites)) {
    const lines = fs.readFileSync(path.join(REPO_ROOT, 'scripts', file), 'utf8').split(/\r?\n/);
    for (const re of patterns) {
      const at = lines.findIndex((l) => re.test(l));
      assert.ok(at > 0, `${file}: no line matches ${re}`);
      assert.equal(lines.filter((l) => re.test(l)).length, 1, `${file}: more than one write matches ${re}`);
      // The write sits on the helper's own line, or inside the block arrow it opened above and has not yet closed.
      let open = at;
      while (open >= 0 && !/bestEffort\(/.test(lines[open])) open--;
      const inside = open === at
        || (open >= 0 && /bestEffort\(\(\) => \{\s*$/.test(lines[open]) && !lines.slice(open + 1, at).some((l) => /^\s*\}, \(why\)/.test(l)));
      if (!inside) outside.push(`${file}:${at + 1}: ${lines[at].trim()}`);
    }
  }
  assert.deepEqual(outside, [], `telemetry written outside bestEffort:\n${outside.join('\n')}`);
  assert.equal(typeof telemetryRecord.bestEffort, 'function');
  const notes = [];
  const failed = telemetryRecord.bestEffort(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
    (why) => notes.push(why));
  assert.equal(failed, false, 'a failed write is reported as not done');
  assert.deepEqual(notes, ['EACCES'], 'a failed write leaves its note, by code');
  assert.equal(telemetryRecord.bestEffort(() => {}, (why) => notes.push(why)), true);
  assert.equal(notes.length, 1, 'a write that succeeded left a note');
});

test('stage 2: a queue.json that parses to no object is kept aside under a name of its own, never over an earlier one', (t) => {
  // G-11 of 20261027-083759-trt-remediation-review: a parsed scalar was taken for a queue and threw on its first wait, and
  // every recovery took the one name queue.unreadable.json, so a second replaced (or, on Windows, lost) the first's file.
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-trt-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), body); };
  put('src/app.js', 'export const x = 1;\n');
  // ui-audit stays ON (no `ui: surface: none`), because the fan-out must hold a node to write its wait, and it runs on a
  // FAKE runtime: until 2026-10-27 this test ran it on opus for real (~$0.21 a suite run). The guard environment, as in
  // regression-cgg-r3-remediation, makes any real CLI that slipped past the fake unable to authenticate.
  const yaml = ['graph_contract_version: 5', 'project: trt', 'commands:', '  build: "node -e 0"', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'review:', '  external_panel: false'].join('\n');
  put('CLAUDE.md', '# fixture\n\n```yaml\n' + yaml + '\n```\n');
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  const fakeDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-trt-fake-')));
  t.after(() => fs.rmSync(fakeDir, { recursive: true, force: true }));
  const fake = path.join(fakeDir, 'fake-runtime.mjs');
  fs.writeFileSync(fake, "process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{}', "
    + "total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }));\n");
  fs.mkdirSync(path.join(fakeDir, 'no-login'));
  const guard = { CLAUDE_CONFIG_DIR: path.join(fakeDir, 'no-login'), CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' };
  const slug = mintSlug('trt');
  const mint = runScript('new-run.mjs', ['--slug', slug, '--repo-root', repo, '--no-request', '--no-verify-sandbox', '--full-sweep', 'src', '--runtime-bin', fake], { cwd: repo, env: guard });
  assert.equal(mint.status, 0, mint.output.slice(-500));
  const runId = mintedRunId(mint.output, slug);
  const staged = mintedRunDir(mint.output);
  t.after(() => fs.rmSync(staged, { recursive: true, force: true }));
  fs.writeFileSync(path.join(staged, 'queue.unreadable.json'), 'an earlier recovery');
  fs.writeFileSync(path.join(staged, 'queue.json'), '5');
  const graph = runScript('run-graph.mjs', ['--run-dir', staged, '--repo-root', repo, '--only', 'ui-audit', '--preflight', 'always', '--skip-panel', '--runtime-bin', fake], { cwd: repo, env: guard });
  const dir = [path.join(repo, '.claude', 'reviews', runId), staged].find((d) => fs.existsSync(path.join(d, 'run.json')));
  assert.doesNotMatch(graph.output, /TypeError/, graph.output.slice(-800));
  assert.match(graph.output, /queue\.json could not be read/, `a scalar queue.json was taken for a queue:\n${graph.output.slice(-1200)}`);
  assert.equal(fs.readFileSync(path.join(dir, 'queue.unreadable.json'), 'utf8'), 'an earlier recovery', 'the earlier recovery was replaced');
  const asides = fs.readdirSync(dir).filter((f) => /^queue\.unreadable-\d+\.json$/.test(f));
  assert.deepEqual(asides.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')), ['5'], 'the scalar queue was not kept aside');
  const queue = JSON.parse(fs.readFileSync(path.join(dir, 'queue.json'), 'utf8'));
  assert.equal(typeof queue['ui-audit'], 'string', 'the fan-out wrote no wait');
});

// ---------------------------------------------------------------------------------------------------------------- stage 3
// The suite's time was one figure per review pre-flight (untimed in every run so far), and nothing said which test files
// it went to. run-all now writes, in the developer's own checkout only, a record of each test file's time and counts.

const SUITE_FIXTURE = fs.readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'telemetry', 'suite-files.jsonl'), 'utf8');
const stringKeys = (v, out = []) => {
  if (Array.isArray(v)) v.forEach((x) => stringKeys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (typeof x === 'string') out.push(k); else stringKeys(x, out); }
  return out;
};
const suiteRoot = (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-suite-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};
const posix = (p) => p.split(path.sep).join('/');

test('stage 3: a suite record holds each test file by its repository-relative path, its time and counts, and nothing else', (t) => {
  const root = suiteRoot(t);
  const lines = SUITE_FIXTURE.split('\n').filter(Boolean).map((l) => l.replace('<repo>', posix(root)));
  lines.push(JSON.stringify({ event: 'file', file: path.join(os.tmpdir(), 'elsewhere.test.mjs'), duration_ms: 1 }));
  const linesFile = path.join(root, 'lines.jsonl');
  fs.writeFileSync(linesFile, `${lines.join('\n')}\n`);
  const w = writeSuiteRecord(root, { linesFile, startedAt: '2026-10-27T10:00:00.000Z', endedAt: '2026-10-27T10:00:30.000Z', exitCode: 0 });
  assert.equal(w.ok, true, w.note);
  assert.equal(path.dirname(w.path), path.join(root, '.claude', 'suite-runs'));
  const rec = JSON.parse(fs.readFileSync(w.path, 'utf8'));
  assert.equal(rec.kind, 'suite');
  assert.deepEqual(rec.files.map((f) => f.file), ['tests/regression-telemetry-run-time.test.mjs',
    'tests/regression-bench-and-counts.test.mjs', 'tests/regression-adapter-tool-lists.test.mjs'],
  'slowest first, and the file outside the root left out');
  assert.equal(rec.tests, 63);
  assert.equal(rec.files[1].duration_ms, 3333.5792);
  const text = JSON.stringify(rec);
  assert.ok(!text.includes(posix(root)) && !text.includes(JSON.stringify(root).slice(1, -1)), 'an absolute path reached the record');
  for (const k of stringKeys(rec)) assert.ok(RECORD_STRING_FIELDS.includes(k), `string field ${k} is not in RECORD_STRING_FIELDS`);
  assert.equal(runTimeline(rec).run_ms, 30_000);
  assert.equal(runTimeline(rec).uncovered_ms, null, 'a record with no tasks has no uncovered time to report');
});

test('stage 3: git ignores the suite records and the reporter\'s scratch file', () => {
  const r = spawnSync('git', ['check-ignore', '.claude/suite-runs/suite-x.json', 'tests/.run-all-files-1.jsonl'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.stdout.trim().split(/\r?\n/).length, 2, r.stdout + r.stderr);
});

test('stage 3: the report reads the suite records and prints the slowest files with their sample sizes', (t) => {
  const root = suiteRoot(t);
  const linesFile = path.join(root, 'lines.jsonl');
  fs.writeFileSync(linesFile, SUITE_FIXTURE.replaceAll('<repo>', posix(root)));
  writeSuiteRecord(root, { linesFile, startedAt: '2026-10-27T10:00:00.000Z', endedAt: '2026-10-27T10:00:30.000Z', exitCode: 0 });
  const { records, locations } = readRecords(root);
  assert.equal(records.filter((r) => r.kind === 'suite').length, 1);
  assert.ok(locations.some((l) => l.where === path.join(root, '.claude', 'suite-runs') && l.found === 1));
  const text = renderReport(reportFigures(records));
  assert.match(text, /suite\s+n=1\s+total 0\.5 min/);
  assert.match(text, /Suite: the 3 slowest test file\(s\)/);
  assert.match(text, /0\.4 min\s+n=1\s+tests\/regression-telemetry-run-time\.test\.mjs/);
});

// run-all.mjs in a fixture copy beside a 21-test suite (minTests is 20), the contract read and the counted-facts check
// stubbed, the engine's io, lib and platform linked so the record is written by the code under test.
function runAllCopy(t, { devInstall = false, depth = null } = {}) {
  const repo = suiteRoot(t);
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  for (const d of ['tests/tools', 'scripts', '.claude']) fs.mkdirSync(path.join(repo, d), { recursive: true });
  for (const f of ['run-all.mjs', 'tools/suite-file-reporter.mjs']) fs.copyFileSync(path.join(REPO_ROOT, 'tests', f), path.join(repo, 'tests', f));
  for (const d of ['io', 'lib', 'platform']) fs.symlinkSync(path.join(REPO_ROOT, 'scripts', d), path.join(repo, 'scripts', d), 'junction');
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.mjs'), "import { test } from 'node:test';\nfor (let i = 0; i < 21; i++) test(`t${i}`, () => {});\n");
  fs.writeFileSync(path.join(repo, 'scripts', 'new-run.mjs'), "console.log(JSON.stringify({ commands: { test_product: '' } }));\n");
  fs.writeFileSync(path.join(repo, 'scripts', 'check-counted-facts.mjs'), 'process.exit(0);\n');
  if (devInstall) fs.writeFileSync(path.join(repo, '.claude', 'dev-install.json'), '{}\n');
  // Without the parent's NODE_TEST_CONTEXT, which makes a nested `node --test` skip its files, and with the depth asked for.
  const { NODE_TEST_CONTEXT, GRAPH_NODE_DEPTH, ...env } = process.env;
  const r = spawnSync(process.execPath, [path.join(repo, 'tests', 'run-all.mjs')],
    { cwd: repo, encoding: 'utf8', env: { ...env, ...(depth === null ? {} : { GRAPH_NODE_DEPTH: depth }) } });
  const dir = path.join(repo, '.claude', 'suite-runs');
  const records = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  return { status: r.status, out: `${r.stdout}${r.stderr}`, records, recordPath: records.length ? path.join(dir, records[0]) : null };
}

test('stage 3: run-all writes a suite record only in a checkout with dev-install.json, and never from graph work', (t) => {
  const none = runAllCopy(t);
  assert.equal(none.status, 0, none.out.slice(-600));
  assert.deepEqual(none.records, [], 'a copy without dev-install.json (a fixture, a snapshot, a clone) wrote a record');
  const node = runAllCopy(t, { devInstall: true, depth: '1' });
  assert.equal(node.status, 0, node.out.slice(-600));
  assert.deepEqual(node.records, [], 'a candidate check (GRAPH_NODE_DEPTH 1) wrote a record');
  const own = runAllCopy(t, { devInstall: true });
  assert.equal(own.status, 0, own.out.slice(-600));
  assert.equal(own.records.length, 1, `no record in the developer's checkout:\n${own.out.slice(-600)}`);
  // G-17 of 20261027-071443-trt-delivery: an empty record passed. It holds the one test file, its 21 tests and its time.
  const rec = JSON.parse(fs.readFileSync(own.recordPath, 'utf8'));
  assert.deepEqual(rec.files.map((f) => f.file), ['tests/a.test.mjs'], JSON.stringify(rec.files));
  assert.equal(rec.files[0].tests, 21);
  assert.equal(typeof rec.files[0].duration_ms, 'number');
});

// ------------------------------------------------------------------------------------------- 20261027-071443-trt-delivery
// Folded into the stage-1 tests above, so the suite's stated count holds: G-4 and G-15 in "a phase whose tasks are
// untimed", G-8, G-9 and G-10 in "skipped tasks are counted apart".
function g4g15() {
  const rec = buildRunRecord({ kind: 'review', run: { run_id: 'r', graph_started_at: '2026-10-27T01:00:00.000Z' },
    checks: { results: [{ check: 'test', status: 'PASS', started_at: '2026-10-27T01:00:00.000Z', duration_ms: 120_000 }] } });
  const check = rec.tasks.find((t) => t.id === 'check:test');
  assert.equal(check.ended_at, '2026-10-27T01:02:00.000Z');
  assert.equal(runTimeline(rec).phases.preflight.span_ms, 120_000);
  assert.equal(rec.ended_at, '2026-10-27T01:02:00.000Z', 'a check ending last ends the run');
  // G-15: a skipped task's stub never sets the run's end.
  const skip = buildRunRecord({ kind: 'review', run: { run_id: 'r' }, roster: { lenses: [{ id: 'code-audit' }, { id: 'ui-audit' }] },
    statuses: { 'code-audit': { state: 'OK', started_at: '2026-10-27T01:00:00.000Z', ended_at: '2026-10-27T01:01:00.000Z' },
      'ui-audit': { state: 'SKIPPED', started_at: '2026-10-27T01:30:00.000Z', ended_at: '2026-10-27T01:30:00.000Z' } } });
  assert.equal(skip.ended_at, '2026-10-27T01:01:00.000Z', 'a skipped stub set the run\'s end');
}

// G-8, G-9, G-10: the report names records with no duration as such, gives the uncovered time its n, and every skipped
// kind its total.
function g8g9g10() {
  const text = renderReport(reportFigures([REVIEW, { ...REVIEW, ended_at: null }]));
  assert.match(text, /\(1 record\(s\) with no duration: a start or an end missing\)/);
  assert.match(text, /not covered by any task\s+n=1\s+median/);
  assert.match(text, /^ {2}lens {30} 4$/m, 'the skipped lenses\' total, two in each record');
  assert.match(text, /^ {2}lens:ui-audit\s+2$/m);
}

// G-3 and G-4 of 20261105-004603-ar-d1-c-review: a line of the suite reporter's file or of a claim check's step journal
// that did not parse was dropped with nothing recorded, so a record missing entries read as complete. Torn lines are
// still tolerated (a kill cuts the last one), and each record now says how many it could not read.
test('a suite record and a claim-check record count the lines they could not parse', async (t) => {
  const root = suiteRoot(t);
  const linesFile = path.join(root, 'lines.jsonl');
  fs.writeFileSync(linesFile, `${JSON.stringify({ event: 'file', file: path.join(root, 'tests', 'a.test.mjs'), duration_ms: 5 })}\n{ torn\nnot json either\n`);
  const w = writeSuiteRecord(root, { linesFile, startedAt: '2026-10-27T10:00:00.000Z', endedAt: '2026-10-27T10:00:30.000Z', exitCode: 0 });
  assert.equal(w.ok, true, w.note);
  assert.equal(JSON.parse(fs.readFileSync(w.path, 'utf8')).unparsed_lines, 2, 'the suite record dropped malformed lines without counting them');
  const { writeClaimCheckRecord } = await import('../scripts/io/telemetry-record.mjs');
  const checkDir = path.join(root, 'check');
  fs.mkdirSync(checkDir);
  fs.writeFileSync(path.join(checkDir, 'steps.jsonl'), `${JSON.stringify({ step: 'start', at: '2026-10-27T10:00:00.000Z' })}\n{"step": "cut\n`);
  const c = writeClaimCheckRecord(checkDir, { repoRoot: root });
  assert.equal(c.ok, true, c.note);
  assert.equal(JSON.parse(fs.readFileSync(c.path, 'utf8')).journal_unparsed_lines, 1, 'the journal dropped a malformed line without counting it');
});
