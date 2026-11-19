// autonomous-run.plan.md stage 8: the measure. What the decision panel decided is added up beside its sample size (the
// telemetry report's rule), next to the stop record split by whether the session ran with the panel on (criterion 8:
// "measured against the table under Why — stops and gaps — and so is whether the delegated decisions were sound"). The
// decision records here are WRITTEN BY runDecision with stub seats, so every field name is the writer's, never invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runDecision } from '../scripts/io/decision-run.mjs';
import { buildDecisionRecord } from '../scripts/lib/telemetry-record.mjs';
import { reportFigures, renderReport } from '../scripts/lib/telemetry-report.mjs';
import { readRecords } from '../scripts/io/telemetry-record.mjs';
import { sampleCandidates, SAMPLE_MARKS } from '../scripts/lib/decision-panel.mjs';
import { summary } from '../scripts/lib/stop-record.mjs';
import { runScript, REPO_ROOT } from './helpers.mjs';

const Q = { question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }], category: 'delegable' };
const SEATS = ['s1', 's2', 's3'];
const answer = (choice) => ({ status: 'ok', choice, rationale: `because ${choice}`, other_text: '', change_of: '', what_would_change: `if not ${choice}`, citations: [] });
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** A repository holding decisions written by runDecision: `specs` maps an id to the votes of its talk (and revote). */
async function repoWithDecisions(specs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-tel-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/decisions/\n');
  git('add', '-A'); git('commit', '-qm', 'init');
  for (const [id, s] of Object.entries(specs)) {
    const rec = path.join(dir, '.claude', 'decisions', id);
    fs.mkdirSync(rec, { recursive: true });
    fs.writeFileSync(path.join(rec, 'question.json'), JSON.stringify(Q));
    const run = (recordDir, votes, phase) => runDecision({ grounding: { floor: 'convention', basisOf: () => 'convention' },
      question: Q, recordDir, seed: id, seats: SEATS, context: '', caps: phase === 'revote' ? { cap: 1, hardCap: 1 } : { cap: 1, hardCap: 2 },
      runSeat: async (seat, _p, round) => votes[round]?.[seat] ?? null, runModerator: async () => s.extend ?? { extend: false, reason: 'no' }, phase,
    });
    await run(rec, s.first, 'first');
    if (s.revote) { fs.mkdirSync(path.join(rec, 'revote'), { recursive: true }); await run(path.join(rec, 'revote'), s.revote, 'revote'); }
    if (s.overrule) fs.writeFileSync(path.join(rec, 'overrule.json'), JSON.stringify({ at: '2026-10-31T12:00:00Z', operator_quote: 'no' }));
    if (s.sample) fs.writeFileSync(path.join(rec, 'sample.json'), JSON.stringify({ at: '2026-10-31T12:00:00Z', mark: s.sample, operator_quote: 'q' }));
  }
  return dir;
}

const UNANIMOUS = { 1: { s1: answer('E1'), s2: answer('E1'), s3: answer('E1') } };
const MAJORITY = { 1: { s1: answer('E2'), s2: answer('E2'), s3: answer('E1') } };
const SPLIT = { 1: { s1: answer('E1'), s2: answer('E2'), s3: null } };
const EXTENDED = { 1: SPLIT[1], 2: { s1: answer('E2'), s2: answer('E2'), s3: answer('E1') } };

test('a decision record is built from the final outcome, its revote and the operator\'s overrule and mark', async () => {
  const dir = await repoWithDecisions({
    '20261031-100000-aaaaaa': { first: UNANIMOUS, sample: 'agree' },
    '20261031-110000-bbbbbb': { first: SPLIT, revote: SPLIT, overrule: true },
  });
  try {
    const base = path.join(dir, '.claude', 'decisions');
    const a = buildDecisionRecord('20261031-100000-aaaaaa', { first: read(path.join(base, '20261031-100000-aaaaaa', 'outcome.json')), sample: { mark: 'agree' } });
    assert.equal(a.kind, 'decision');
    assert.equal(a.run_id, '20261031-100000-aaaaaa', 'the id dates the record (recordDate reads its prefix)');
    assert.deepEqual([a.outcome, a.agreement, a.rounds, a.revoted, a.overruled, a.sample], ['majority', 'unanimous', 1, false, false, 'agree']);
    const b = buildDecisionRecord('20261031-110000-bbbbbb', {
      first: read(path.join(base, '20261031-110000-bbbbbb', 'outcome.json')),
      revote: read(path.join(base, '20261031-110000-bbbbbb', 'revote', 'outcome.json')), overrule: { operator_quote: 'no' },
    });
    assert.deepEqual([b.outcome, b.agreement, b.rounds, b.revoted, b.overruled, b.sample], ['postponed', 'none', 2, true, true, null],
      'the revote decides the outcome, and its rounds add to the talk\'s');
    assert.throws(() => buildDecisionRecord('20261031-110000-bbbbbb', { first: null }), /outcome/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the report counts decisions by outcome and agreement, reversals and the operator\'s marks, each with its n', async () => {
  const dir = await repoWithDecisions({
    '20261031-100000-aaaaaa': { first: UNANIMOUS, sample: 'agree' },
    '20261031-101000-cccccc': { first: MAJORITY, sample: 'differ', overrule: true },
    '20261031-102000-dddddd': { first: EXTENDED, extend: { extend: true, reason: 'converging' } },
    '20261031-103000-eeeeee': { first: SPLIT, revote: MAJORITY },
    '20261031-104000-ffffff': { first: SPLIT },
  });
  try {
    const { records, locations } = readRecords(dir, { runRoots: [] });
    const decisions = records.filter((r) => r.kind === 'decision');
    assert.equal(decisions.length, 5);
    assert.ok(locations.some((l) => l.where === path.join(dir, '.claude', 'decisions') && l.found === 5), 'the location and its count are listed');
    const f = reportFigures(records).decisions;
    assert.equal(f.n, 5);
    assert.deepEqual(f.by_outcome, { majority: 4, revote: 1 });
    assert.deepEqual(f.by_agreement, { unanimous: 1, majority: 1, 'moderator-extended': 1, 'majority-on-revote': 1, none: 1 });
    assert.equal(f.revoted, 1);
    assert.deepEqual(f.overruled, { n: 4, count: 1 }, 'reversals are counted against the delegated (majority) decisions');
    assert.deepEqual(f.sample, { n: 2, agree: 1, differ: 1 });
    assert.equal(f.rounds.n, 5);
    const text = renderReport(reportFigures(records));
    assert.match(text, /Decisions \(n = 5\)/);
    assert.match(text, /overruled by the operator: 1 of 4/);
    assert.match(text, /sampled \(n = 2\): 1 agree, 1 would have chosen differently/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a decision folder that cannot be read is named, never counted as no decision', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-tel-bad-'));
  try {
    const rec = path.join(dir, '.claude', 'decisions', '20261031-100000-aaaaaa');
    fs.mkdirSync(rec, { recursive: true });
    fs.writeFileSync(path.join(rec, 'outcome.json'), '{ torn');
    const { records, unreadable } = readRecords(dir, { runRoots: [] });
    assert.equal(records.filter((r) => r.kind === 'decision').length, 0);
    assert.equal(unreadable.length, 1);
    assert.match(unreadable[0], /outcome\.json/);
    // A folder with no outcome yet (a decision still running) is not a record and not an error.
    fs.rmSync(path.join(rec, 'outcome.json'));
    assert.deepEqual(readRecords(dir, { runRoots: [] }).unreadable, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the sample lists the newest delegated decisions not yet marked, n of them', () => {
  assert.deepEqual(SAMPLE_MARKS, ['agree', 'differ']);
  const d = (id, outcome, extra = {}) => ({ id, final: { outcome, label: `L${id}`, agreement: 'majority' }, sampled: false, ...extra });
  const all = [d('20261031-100000-aaaaaa', 'majority'), d('20261031-110000-bbbbbb', 'postponed'),
    d('20261031-120000-cccccc', 'majority', { sampled: true }), d('20261031-130000-dddddd', 'majority'),
    d('20261031-140000-eeeeee', 'majority')];
  assert.deepEqual(sampleCandidates(all, 2).map((x) => x.id), ['20261031-140000-eeeeee', '20261031-130000-dddddd']);
  assert.deepEqual(sampleCandidates(all, 10).map((x) => x.id), ['20261031-140000-eeeeee', '20261031-130000-dddddd', '20261031-100000-aaaaaa'],
    'only majorities not yet marked; a postponed decision was never delegated');
  assert.throws(() => sampleCandidates(all, 0), /whole number/);
});

test('decide.mjs --sample lists them, --sample-mark records the operator\'s mark, and the words are required', async () => {
  const dir = await repoWithDecisions({ '20261031-100000-aaaaaa': { first: UNANIMOUS }, '20261031-110000-bbbbbb': { first: SPLIT } });
  try {
    const s = runScript('decide.mjs', ['--sample', '--size', '5', '--repo-root', dir]);
    assert.equal(s.status, 0, s.output);
    assert.match(s.stdout, /20261031-100000-aaaaaa\s+.*Which bound\?.*Size cap.*unanimous/);
    assert.doesNotMatch(s.stdout, /20261031-110000-bbbbbb/);
    assert.equal(runScript('decide.mjs', ['--sample-mark', '20261031-100000-aaaaaa', '--mark', 'agree', '--repo-root', dir]).status, 2,
      'only the operator marks a sample');
    assert.equal(runScript('decide.mjs', ['--sample-mark', '20261031-100000-aaaaaa', '--mark', 'maybe', '--operator-quote', 'q', '--repo-root', dir]).status, 2);
    assert.equal(runScript('decide.mjs', ['--sample-mark', '20261031-110000-bbbbbb', '--mark', 'agree', '--operator-quote', 'q', '--repo-root', dir]).status, 2,
      'a decision the panel did not take cannot be marked');
    const m = runScript('decide.mjs', ['--sample-mark', '20261031-100000-aaaaaa', '--mark', 'differ', '--operator-quote', 'I would take age', '--repo-root', dir]);
    assert.equal(m.status, 0, m.output);
    const mark = read(path.join(dir, '.claude', 'decisions', '20261031-100000-aaaaaa', 'sample.json'));
    assert.deepEqual([mark.mark, mark.operator_quote], ['differ', 'I would take age']);
    assert.match(runScript('decide.mjs', ['--sample', '--size', '5', '--repo-root', dir]).stdout, /0 decision\(s\) to sample/, 'a marked decision is not offered again');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the stop summary splits turn ends by whether the session ran with the decision panel on', () => {
  const ev = [
    { at: 0, event: 'start', session: 'a' }, { at: 10, event: 'end', kind: 'named', reason: 'question', session: 'a', panel: 'on' },
    { at: 70, event: 'start', session: 'a' }, { at: 80, event: 'end', kind: 'named', reason: 'done', session: 'a', panel: 'on' },
    { at: 0, event: 'start', session: 'b' }, { at: 5, event: 'end', kind: 'named', reason: 'question', session: 'b', panel: 'off' },
    { at: 105, event: 'start', session: 'b' },
    { at: 0, event: 'start', session: 'c' }, { at: 1, event: 'end', kind: 'unnamed', session: 'c' },
  ];
  const s = summary(ev);
  assert.deepEqual(s.byPanel, {
    on: { turnEnds: 2, involuntary: 0, gapMs: 60 }, off: { turnEnds: 1, involuntary: 0, gapMs: 100 }, 'not recorded': { turnEnds: 1, involuntary: 0, gapMs: 0 },
  });
});

// G-20 of 20261105-004603-ar-d1-c-review (with its symptom G-22): a StopFailure turn end (a usage limit, an API error)
// carried no panel state and, having no end time, was left out of byPanel, so those endings vanished from the flag-on
// and flag-off counts session-rules promises. G-10 of the same run: a state never seen had no row, so a record of
// flag-off turns only reported no flag-on count at all rather than zero.
test('every turn end is filed under the panel state, a StopFailure included, and both states always have a row', async () => {
  const { stopFailureEvent } = await import('../scripts/lib/stop-record.mjs');
  const failed = stopFailureEvent({ session_id: 'a', error: 'rate_limit' }, { at: 20, panel: 'on' });
  assert.equal(failed.panel, 'on', 'the StopFailure event carries no panel state');
  const ev = [
    { at: 0, event: 'start', session: 'a' }, { ...failed, session: 'a' },
    { at: 0, event: 'start', session: 'b' }, { at: 5, event: 'end', kind: 'named', reason: 'done', session: 'b', panel: 'off' },
  ];
  const s = summary(ev);
  assert.deepEqual(s.byPanel.on, { turnEnds: 0, involuntary: 1, gapMs: 0 }, 'the involuntary ending vanished from the flag-on count');
  assert.deepEqual(s.byPanel.off, { turnEnds: 1, involuntary: 0, gapMs: 0 });
  assert.deepEqual(summary([{ at: 0, event: 'start', session: 'b' }, { at: 5, event: 'end', kind: 'named', reason: 'done', session: 'b', panel: 'off' }]).byPanel.on,
    { turnEnds: 0, involuntary: 0, gapMs: 0 }, 'flag-off only: the flag-on row is missing rather than zero');
  const guard = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'stop-guard.mjs'), 'utf8');
  assert.match(guard, /stopFailureEvent\(input, \{ at, panel: decisionPanelHere\(repoRoot\) \}\)/, 'the guard records a StopFailure without the panel state');
});
