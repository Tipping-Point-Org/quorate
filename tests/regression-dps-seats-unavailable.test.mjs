// decision-panel-seats.plan.md stage 4 (design DP-D3 A, operator 2026-11-09: "A. Separate outcome (Recommended)"): in
// decision 20261107-213602-4f3308 only codex answered in all three rounds, and the decision was recorded "no majority
// after 3 round(s)", the words of a real split: a broken panel read as a divided one, and two more rounds were spent on
// one voice. And the reason a seat was silent was lost before the round loop saw it: decide.mjs's runSeat returned null
// for a failed external seat unless its envelope's not_checked said `quota`, and seatAnswerOf turned that into "no
// answer object", which is how agy's argv refusal read. Now each silent seat is recorded per round with why, and a round
// with fewer than two answering seats ends the decision at once as `seats-unavailable`, naming each silent seat, for the
// operator: no further rounds, no moderator, no revote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runDecision } from '../scripts/io/decision-run.mjs';
import { seatAnswerOf, roundQuorum, seatsUnavailableOutcome } from '../scripts/lib/decision-panel.mjs';
import { REPO_ROOT } from './helpers.mjs';

const Q = { question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }], category: 'delegable' };
const GROUNDING = { floor: 'convention', basisOf: () => 'convention' };
const tmp = (t, p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const answer = (choice) => ({ status: 'ok', choice, rationale: `because ${choice}`, other_text: '', change_of: '', what_would_change: `if not ${choice}`, citations: [] });

// ------------------------------------------------------------------------------------------------ the pure rules
test('a silent seat\'s reason survives into its answer, never "no answer object"', () => {
  assert.deepEqual(seatAnswerOf({ status: 'unavailable', reason: 'prompt is 33827 bytes; refused' }),
    { result: null, why: 'unavailable: prompt is 33827 bytes; refused' });
  assert.match(seatAnswerOf({ status: 'error', reason: 'spawn ENAMETOOLONG' }).why, /spawn ENAMETOOLONG/);
  assert.match(seatAnswerOf({ status: 'quota', reason: 'usage limit; resets 5pm' }).why, /usage limit; resets 5pm/);
  assert.equal(seatAnswerOf(null).why, 'no answer object', 'a seat that returned nothing at all still says so');
});

test('roundQuorum: fewer than two answering seats is not enough, and each silent seat is named with why', () => {
  const q = roundQuorum([['s1', { result: { choice: 'E1' }, why: null }], ['s2', { result: null, why: 'unavailable: x' }], ['s3', { result: null, why: 'no answer object' }]]);
  assert.equal(q.enough, false);
  assert.equal(q.answering, 1);
  assert.deepEqual(q.silent, [{ seat: 's2', why: 'unavailable: x' }, { seat: 's3', why: 'no answer object' }]);
  assert.equal(roundQuorum([['s1', { result: { choice: 'E1' } }], ['s2', { result: { choice: 'E2' } }], ['s3', { result: null, why: 'y' }]]).enough, true);
  const o = seatsUnavailableOutcome({ rounds: 1, silent: q.silent, answering: 1 });
  assert.equal(o.outcome, 'seats-unavailable');
  assert.equal(o.entry, null);
  assert.deepEqual(o.silent, q.silent);
});

// ------------------------------------------------------------------------------------------------ the round loop
test('two silent seats end the decision after one round as seats-unavailable, naming both with why, with no moderator', async (t) => {
  const dir = tmp(t, 'dps-su-');
  let calls = 0;
  const { outcome } = await runDecision({ grounding: GROUNDING, question: Q, recordDir: path.join(dir, 'rec'), seed: 'x',
    seats: ['s1', 's2', 's3'], context: '', caps: { cap: 3, hardCap: 6 },
    runSeat: async (seat) => {
      calls += 1;
      if (seat === 's1') return answer('E1');
      if (seat === 's2') return { status: 'unavailable', reason: 'prompt is 33827 bytes; agy receives it inline in argv' };
      return { status: 'error', reason: 'spawn ENAMETOOLONG' };
    },
    runModerator: async () => assert.fail('no moderator for a panel that is not quorate'),
  });
  assert.equal(outcome.outcome, 'seats-unavailable');
  assert.equal(calls, 3, 'more than one round was run on one voice');
  assert.equal(outcome.rounds, 1);
  assert.deepEqual(outcome.silent.map((s) => s.seat), ['s2', 's3']);
  assert.match(outcome.silent[0].why, /33827 bytes/);
  assert.match(outcome.silent[1].why, /ENAMETOOLONG/);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, 'rec', 'round-1-seats.json'), 'utf8'));
  assert.deepEqual(rec.silent.map((s) => s.seat), ['s2', 's3'], 'the round\'s record does not name the silent seats');
  assert.equal(rec.answering, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'rec', 'outcome.json'), 'utf8')).outcome, 'seats-unavailable');
});

test('two answering seats that disagree keep the outcome they had: no majority, not seats-unavailable', async (t) => {
  const dir = tmp(t, 'dps-su2-');
  const { outcome } = await runDecision({ grounding: GROUNDING, question: Q, recordDir: path.join(dir, 'rec'), seed: 'x',
    seats: ['s1', 's2', 's3'], context: '', caps: { cap: 1, hardCap: 1 },
    runSeat: async (seat) => (seat === 's1' ? answer('E1') : seat === 's2' ? answer('E2') : { status: 'unavailable', reason: 'down' }),
    runModerator: async () => null,
  });
  assert.equal(outcome.outcome, 'revote');
  const rec = JSON.parse(fs.readFileSync(path.join(dir, 'rec', 'round-1-seats.json'), 'utf8'));
  assert.deepEqual(rec.silent, [{ seat: 's3', why: 'unavailable: down' }], 'a silent seat in a quorate round is still recorded');
});

// ------------------------------------------------------------------------------------------------ the outcome's readers
// Every place in scripts/ that switches on a decision's outcome by name handles the new one; two of them failed open:
// decide.mjs's summary read any unknown outcome as "postponed", and its pending list held only postponed and to-operator.
test('census: every switch on a decision\'s outcome handles seats-unavailable', () => {
  const hits = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(r); continue; }
      if (!/\.mjs$/.test(e.name)) continue;
      const src = fs.readFileSync(path.join(REPO_ROOT, r), 'utf8');
      if (/outcome[^\n]{0,40}'to-operator'|'to-operator'[^\n]{0,80}outcome|'postponed'/.test(src)) hits.push(r);
    }
  };
  walk('scripts');
  assert.deepEqual(hits.sort(), ['scripts/decide.mjs', 'scripts/lib/decision-panel.mjs'], 'a reader of the outcome is not in this census');
  for (const f of hits) assert.match(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'), /'seats-unavailable'/, `${f} does not handle seats-unavailable`);
  const decide = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'decide.mjs'), 'utf8');
  assert.match(decide, /\['postponed', 'to-operator', 'seats-unavailable'\]\.includes\(/, 'the pending list does not hold it');
  assert.match(decide, /o\.outcome === 'seats-unavailable'/, 'the summary does not name it, and falls through to "postponed"');
});

// ------------------------------------------------------------------------------------------------ through decide.mjs
// The runtime seat answers through a fake runtime (--runtime-bin); both external seats are fakes declared in the fixture's
// contract (agy is an .exe spawned without a shell, so a PATH shim is never found: reviewer-preflight-fixture.mjs) whose
// every call fails, so each envelope carries a not_checked reason.
function fakeRuntime(dir) {
  const bin = path.join(dir, 'fake-runtime.mjs');
  const seat = { status: 'ok', choice: 'E1', rationale: 'the size bounds the disk', other_text: '', change_of: '', what_would_change: 'a measured cost', citations: [] };
  fs.writeFileSync(bin, [
    "import fs from 'node:fs';",
    "try { fs.readFileSync(0, 'utf8'); } catch {}",
    `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, result: ${JSON.stringify(JSON.stringify(seat))} }));`,
  ].join('\n'));
  return bin;
}
function failingReviewer(dir, name) {
  const bin = path.join(dir, `fake-${name}.mjs`);
  fs.writeFileSync(bin, [
    "if (process.argv.includes('--version')) { process.stdout.write('fake 1.0\\n'); process.exit(0); }",
    "try { require('node:fs').readFileSync(0); } catch {}",
    `process.stderr.write('${name} fake: the service is down for maintenance\\n');`,
    'process.exit(1);',
  ].join('\n').replace("require('node:fs')", "(await import('node:fs'))"));
  return bin;
}
function decideFixture(t) {
  const dir = tmp(t, 'dps-decide-');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  const fwd = (p) => p.split(path.sep).join('/');
  const node = fwd(process.execPath);
  const codex = fwd(failingReviewer(dir, 'codex'));
  const agy = fwd(failingReviewer(dir, 'agy'));
  const limits = ['    probe_timeout_minutes: 0.5', '    version_timeout_seconds: 10', '    check_margin_seconds: 2'];
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 5', 'project: t', 'commands:',
    '  build: ""', '  test: ""', 'review:', '  external_panel: true', '  decision_panel: on', '  grounding_floor: convention',
    '  models: { judgment: opus, mechanical: sonnet }', '  effort: { judgment: low }', 'reviewers:',
    '  codex:', ...limits, `    cmd: "${node}"`, '    needs_shell_on_windows: false', `    version_argv: ["${codex}", "--version"]`, `    base_argv: ["${codex}", "exec"]`,
    '  agy:', ...limits, `    cmd: "${node}"`, `    version_argv: ["${agy}", "--version"]`, `    base_argv: ["${agy}"]`,
    '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/decisions/\n');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  const q = path.join(dir, 'question.json');
  fs.writeFileSync(q, JSON.stringify(Q));
  const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home'), QUORATE_REVIEWER_PROBES: path.join(dir, 'probes') };
  delete env.GRAPH_NODE_DEPTH;
  const decide = (args) => spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'decide.mjs'), '--repo-root', repo, ...args],
    { cwd: repo, encoding: 'utf8', env, timeout: 240_000 });
  return { dir, repo, q, decide, runtime: fakeRuntime(dir) };
}

test('through decide.mjs: two external seats whose envelopes fail end the decision as seats-unavailable, for the operator', (t) => {
  const f = decideFixture(t);
  const r = f.decide(['--question', f.q, '--runtime-bin', f.runtime]);
  assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  assert.match(r.stdout, /seats unavailable/i, `the summary does not say the seats were unavailable:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /postponed|no majority/i, 'a broken panel read as a postponed or divided one');
  for (const s of ['codex', 'agy']) assert.match(r.stdout, new RegExp(s), `the summary does not name the silent seat ${s}`);
  const decisions = path.join(f.repo, '.claude', 'decisions');
  const id = fs.readdirSync(decisions).find((n) => /^\d{8}-\d{6}-[0-9a-f]{6}$/.test(n));
  const outcome = JSON.parse(fs.readFileSync(path.join(decisions, id, 'outcome.json'), 'utf8'));
  assert.equal(outcome.outcome, 'seats-unavailable');
  assert.equal(outcome.rounds, 1);
  assert.deepEqual(outcome.silent.map((s) => s.seat).sort(), ['agy', 'codex']);
  for (const s of outcome.silent) {
    assert.doesNotMatch(s.why, /no answer object/, `${s.seat}'s reason was lost: ${s.why}`);
    // The envelope's own not_checked reason, not a stand-in for one that was never written.
    assert.match(s.why, /^unavailable: /, s.why);
    assert.doesNotMatch(s.why, /wrote no envelope|gave no answer and no reason/, `${s.seat}'s envelope reason did not reach the outcome: ${s.why}`);
  }
  const round = JSON.parse(fs.readFileSync(path.join(decisions, id, 'round-1-seats.json'), 'utf8'));
  for (const s of round.silent) assert.doesNotMatch(s.why, /no answer object/, `${s.seat}'s reason was lost in the round's record: ${s.why}`);
  assert.equal(fs.existsSync(path.join(decisions, id, 'round-2-seats.json')), false, 'a second round was run on one voice');
  const pending = f.decide(['--pending']);
  assert.equal(pending.status, 0, pending.stderr);
  assert.match(pending.stdout, new RegExp(id), `the decision is not in the operator's pending list:\n${pending.stdout}`);
});
