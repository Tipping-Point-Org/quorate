// .claude/requests/check-outcomes.plan.md, stage 1 (design D1, amended: "Five: incomplete replaces killed"). capture.mjs
// writes exit 124 for every way a command ends without an exit of its own, and each reader worked out on its own whether
// the 124 was real; three remediation rounds each taught one reader one more case (the round cap of
// remediation-fmt-check-baseline). One function decides the outcome from the parsed header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptureHeader, checkOutcome, outcomeOfRecord, HEADER_RULE } from '../scripts/lib/capture-header.mjs';

const log = (...lines) => ['$ node fmt.cjs', '# admitted: fmt_check', ...lines, '# captured: 2026-10-18T00:00:00.000Z', HEADER_RULE, 'output', ''].join('\n');
const outcomeOf = (...lines) => checkOutcome(parseCaptureHeader(log(...lines))).outcome;

test('stage 1: every header shape has exactly one outcome', () => {
  assert.equal(outcomeOf('# exit: 0'), 'passed');
  assert.equal(outcomeOf('# exit: 1'), 'failed');
  assert.equal(outcomeOf('# exit: 124'), 'failed', 'a bare 124 is the command\'s own exit since ded43cb0');
  assert.equal(outcomeOf('# exit: 124', '# timed-out: killed by capture after 15 minute(s)'), 'timed-out');
  assert.equal(outcomeOf('# exit: 124 (signal SIGTERM)'), 'incomplete', 'a signal that was not capture\'s deadline');
  assert.equal(outcomeOf('# exit: 124', '# error: ENOBUFS'), 'incomplete', 'an overflow ran: it did not finish');
  assert.equal(outcomeOf('# exit: 124', '# error: ENOENT'), 'could-not-start');
  assert.equal(outcomeOf('# exit: 124', '# error: EACCES'), 'could-not-start');
});

test('stage 1: the deadline wins over the signal capture itself sent, and a header with no exit could not start', () => {
  assert.equal(outcomeOf('# exit: 124 (signal SIGKILL)', '# timed-out: killed by capture after 15 minute(s)'), 'timed-out');
  assert.equal(checkOutcome(parseCaptureHeader(log())).outcome, 'could-not-start');
  assert.equal(checkOutcome(null).outcome, 'could-not-start', 'no capture header at all');
});

test('stage 1: the detail names what decided it', () => {
  assert.match(checkOutcome(parseCaptureHeader(log('# exit: 124 (signal SIGTERM)'))).detail, /SIGTERM/);
  assert.match(checkOutcome(parseCaptureHeader(log('# exit: 124', '# error: ENOBUFS'))).detail, /ENOBUFS/);
  assert.match(checkOutcome(null).detail, /no capture header/);
});

test('stage 1: parseCaptureHeader reads the signal capture writes on the exit line', () => {
  assert.equal(parseCaptureHeader(log('# exit: 124 (signal SIGTERM)')).signal, 'SIGTERM');
  assert.equal(parseCaptureHeader(log('# exit: 1')).signal, undefined);
});

test('stage 1: a record with no outcome is derived from the fields it carries; one with an outcome keeps it', () => {
  assert.equal(outcomeOfRecord({ exit_code: 0 }), 'passed');
  assert.equal(outcomeOfRecord({ exit_code: 3 }), 'failed');
  assert.equal(outcomeOfRecord({ exit_code: 124, timed_out: true }), 'timed-out');
  assert.equal(outcomeOfRecord({ exit_code: 124, capture_error: 'ENOBUFS' }), 'incomplete');
  assert.equal(outcomeOfRecord({ exit_code: 124, capture_error: 'ENOENT' }), 'could-not-start');
  assert.equal(outcomeOfRecord({}), 'could-not-start');
  assert.equal(outcomeOfRecord({ exit_code: 0, outcome: 'incomplete' }), 'incomplete');
});

// ---------------------------------------------------------------------------------------- stage 2, the remediation readers
import { fullCheckVerdict } from '../scripts/lib/full-check.mjs';

const R = (o) => ({ exit_code: 0, tests: null, failing: null, failing_names: [], evidence_path: 'evidence/remediation-runner/fmt_check.log', ...o });
const fmt = (ran, baseline) => fullCheckVerdict({ declared: ['fmt_check'], ran: { fmt_check: ran }, baseline });

test('stage 2: a signal-killed fmt_check after a passing baseline refuses without the format advice (round 3 G-2)', () => {
  const v = fmt(R({ exit_code: 124, outcome: 'incomplete', outcome_detail: 'stopped by SIGTERM' }), { fmt_check: { exit_code: 0, outcome: 'passed' } });
  assert.equal(v.commit, false);
  assert.equal(v.refusals[0].turned_red, undefined, 'the operator is told to format a check that never finished');
  assert.match(v.refusals[0].why, /stopped before it finished/);
});

test('stage 2: a signal-killed baseline with a failing candidate stamps, naming the baseline as stopped', () => {
  const v = fmt(R({ exit_code: 1, outcome: 'failed' }), { fmt_check: { exit_code: 124, outcome: 'incomplete', outcome_detail: 'stopped by SIGTERM' } });
  assert.equal(v.commit, true);
  assert.match(v.stamps[0].why, /baseline did not run to completion \(stopped before it finished/);
});

test('stage 2: an fmt_check that did not finish, after a baseline that did not pass, stamps nothing and is recorded', () => {
  const v = fmt(R({ exit_code: 124, outcome: 'timed-out', timed_out: true }), { fmt_check: { exit_code: 1, outcome: 'failed' } });
  assert.equal(v.commit, true);
  assert.deepEqual(v.stamps, [], 'FMT-DIRTY would claim the formatter ran and failed');
  assert.deepEqual(v.unfinished.map((u) => [u.key, u.outcome]), [['fmt_check', 'timed-out']]);
});

test('stage 2: fmt_check never captured (the barrier broke) after a baseline that did not pass stamps nothing; after one that passed it refuses', () => {
  const none = fullCheckVerdict({ declared: ['fmt_check'], ran: {}, baseline: { fmt_check: { exit_code: 1, outcome: 'failed' } } });
  assert.deepEqual(none.stamps, []);
  assert.deepEqual(none.unfinished.map((u) => u.outcome), ['not-run']);
  const passed = fullCheckVerdict({ declared: ['fmt_check'], ran: {}, baseline: { fmt_check: { exit_code: 0, outcome: 'passed' } } });
  assert.equal(passed.commit, false);
});

// ---------------------------------------------------------------------------------------- stage 3, the review pre-flight
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';
import { classifySuiteOutcome } from '../scripts/lib/decisions.mjs';
import { preflightNotChecked } from '../scripts/lib/preflight-cache.mjs';

test('stage 3: a suite that could not start did not run; one stopped after printing failures still failed', () => {
  assert.equal(classifySuiteOutcome({ exitCode: 124, testsReported: null, outcome: 'could-not-start' }).stamp, 'TESTS-DID-NOT-RUN');
  assert.equal(classifySuiteOutcome({ exitCode: 124, testsReported: 40, testsFailing: 40, outcome: 'incomplete' }).stamp, 'TESTS-FAILING', 'G-48: the count ranks first');
  assert.equal(classifySuiteOutcome({ exitCode: 124, testsReported: null, outcome: 'incomplete' }).stamp, 'TESTS-OUTCOME-UNKNOWN');
  assert.equal(classifySuiteOutcome({ exitCode: 124, testsReported: null, outcome: 'timed-out' }).stamp, 'TESTS-TIMED-OUT');
  assert.equal(classifySuiteOutcome({ exitCode: 124, testsReported: null }).stamp, 'TESTS-OUTCOME-UNKNOWN', 'without an outcome, as before');
});

test('stage 3: the gate names a check that did not run to completion', () => {
  const out = preflightNotChecked({ state: 'ran', commands: { build: 'b' },
    results: [{ check: 'build', outcome: 'could-not-start', outcome_detail: 'ENOENT' }, { check: 'test', outcome: 'failed' }] });
  assert.deepEqual(out.map((e) => e.node_id), ['commands.build']);
  assert.match(out[0].why, /did not run to completion \(could-not-start: ENOENT\)/);
});

function project(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-outcomes-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# t', '', '```yaml', 'graph_contract_version: 6', 'project: outcomes',
    'commands:', '  build: "quorate-no-such-command-xyz"', '  test: ""', 'source_globs: ["src/**"]', 'ui:', '  surface: none',
    'review:', '  preflight_inputs: ["src/**", "CLAUDE.md"]', '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'init');
  const env = { QUORATE_HOME: path.join(base, 'home') };
  return { repo, env, pf: (args = []) => runScript('preflight.mjs', args, { cwd: repo, env }) };
}

test('stage 3: a build that could not start is not cached, and the seed does not say it was', (t) => {
  const p = project(t);
  const r = p.pf(['--run']);
  assert.doesNotMatch(r.output, /The result is cached/, r.output.slice(-800));
  assert.match(r.output, /Not cached: a check did not run to completion/);
  assert.match(p.pf().output, /\bSTALE\b/, 'a cached replay would read FRESH and BLOCK every review');
});

test('stage 3: the cache key is versioned v2, so no entry from before outcomes is replayed', () => {
  assert.match(fs.readFileSync(new URL('../scripts/io/preflight-cache.mjs', import.meta.url), 'utf8'), /h\.update\('preflight-v2\\0'\)/);
});

// G-3 of 20261018-035437-co-delivery: countTests is a TOTAL, so reading it as a failing count stamped a suite that printed
// only passing tests and was then stopped TESTS-FAILING, and forced the gate to FAIL on a run nothing showed was red.
test('G-3: a suite stopped after printing only passing tests is not failing; one that printed failures still is', () => {
  for (const outcome of ['incomplete', 'timed-out']) {
    const o = classifySuiteOutcome({ exitCode: 124, testsReported: 40, testsFailing: 0, outcome });
    assert.notEqual(o.stamp, 'TESTS-FAILING', `${outcome}: 40 tests ran, none failed`);
    assert.equal(o.forcesGate, false);
    assert.equal(classifySuiteOutcome({ exitCode: 124, testsReported: 40, testsFailing: 3, outcome }).stamp, 'TESTS-FAILING');
  }
  assert.equal(classifySuiteOutcome({ exitCode: 124, testsReported: 40, testsFailing: 0, outcome: 'incomplete' }).stamp, 'TESTS-OUTCOME-UNKNOWN');
  assert.equal(classifySuiteOutcome({ exitCode: 124, testsReported: 40, testsFailing: 0, outcome: 'timed-out' }).stamp, 'TESTS-TIMED-OUT');
  assert.equal(classifySuiteOutcome({ exitCode: 124, testsReported: 40, testsFailing: 0, timedOut: true }).stamp, 'TESTS-TIMED-OUT',
    'without an outcome, the timeout flag reads the failing count too');
});

// G-2 of 20261018-041929-co-remediation-review: an explicit 'failed' outcome skipped the branch that reads the failing count,
// so a suite that printed failures but no readable total was stamped unknown or did-not-run, and lost the forced FAIL.
// Operator, 2026-10-18 ("Failing count only (Recommended)"): a printed failing count is TESTS-FAILING, whatever the outcome.
test('G-2: a printed failing count with no readable total is failing, whatever the outcome', () => {
  for (const testsReported of [null, 0]) {
    for (const outcome of ['failed', undefined]) {
      const o = classifySuiteOutcome({ exitCode: 1, testsReported, testsFailing: 3, outcome });
      assert.equal(o.stamp, 'TESTS-FAILING', `outcome ${outcome}, total ${testsReported}: 3 failures were printed`);
      assert.equal(o.forcesGate, true);
    }
  }
  // G-25 of 20261020-094311-ciss-delivery: the 'passed' outcome, and a zero exit with no outcome, returned clean before the
  // failing count was read, so a command that exits 0 while printing failing tests was stamped clean.
  for (const outcome of ['passed', undefined]) {
    const o = classifySuiteOutcome({ exitCode: 0, testsReported: 40, testsFailing: 3, outcome });
    assert.equal(o.stamp, 'TESTS-FAILING', `exit 0, outcome ${outcome}: 3 failures were printed`);
    assert.equal(o.forcesGate, true);
  }
  // G-22 of 20261020-105833-ciss-remediation-2-review: the protocol's TESTS-FAILING row still said "returned non-zero".
  const row = fs.readFileSync(new URL('../shared/disk-first-protocol.md', import.meta.url), 'utf8')
    .split('\n').find((l) => l.startsWith('| `TESTS-FAILING` |')) ?? '';
  const condition = row.split(' | ')[1] ?? '';
  assert.doesNotMatch(condition, /and returned non-zero$/, 'the row says a printed failing count at exit 0 is not TESTS-FAILING');
  assert.match(condition, /failing count[\s\S]*exit 0|exit 0[\s\S]*failing count/, 'the row names a printed failing count at exit 0');
});

test('G-3: run-checks hands the classification the failing count, not only the total', () => {
  const src = fs.readFileSync(new URL('../scripts/run-checks.mjs', import.meta.url), 'utf8');
  assert.match(src, /testsFailing: /);
  assert.match(src, /countFailuresInLog\(runDir, r\.evidence_path\)/);
});

// G-14 of 20261018-035437-co-delivery: the unfinished-barrier path wrote BLOCKED and exited before preflightNotChecked ran,
// so gate.json's not_checked[] omitted the build its headline said did not finish. Run end to end, for $0 (--only ui-audit).
test('G-14: a barrier that could not start is named in the BLOCKED gate\'s not_checked[]', (t) => {
  const p = project(t);
  const mint = runScript('new-run.mjs', ['--slug', 'g14', '--no-verify-sandbox', '--no-request', '--full-sweep', '.'],
    { cwd: p.repo, env: p.env });
  assert.equal(mint.status, 0, mint.output.slice(-400));
  const runDir = mintedRunDir(mint.output);
  const g = runScript('run-graph.mjs', ['--run-dir', runDir, '--skip-panel', '--no-archive', '--only', 'ui-audit'],
    { cwd: p.repo, env: p.env });
  assert.equal(g.status, 1, g.output.slice(-800));
  const gate = JSON.parse(fs.readFileSync(path.join(runDir, 'gate.json'), 'utf8'));
  assert.equal(gate.gate, 'BLOCKED');
  const entry = (gate.buckets?.not_checked ?? []).find((e) => (e.node_id ?? e.item) === 'commands.build');
  assert.ok(entry, `the build did not run to completion and not_checked[] does not name it: ${JSON.stringify(gate.buckets?.not_checked)}`);
  assert.match(entry.why, /did not run to completion \(could-not-start/);
});

// Both only observable inside a review run (nothing is cached when a check does not finish), so pinned at the source.
test('stage 3: in a review, FMT-DIRTY is stamped only for a formatter that ran and failed', () => {
  const src = fs.readFileSync(new URL('../scripts/run-checks.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(key === 'fmt_check' && outcome === 'failed'\) stamps\.add\('FMT-DIRTY'\);/);
  assert.doesNotMatch(src, /key === 'fmt_check' && !passed/);
});

test('stage 3: the pre-flight gate names a barrier that did not run to completion', () => {
  const src = fs.readFileSync(new URL('../scripts/run-graph.mjs', import.meta.url), 'utf8');
  assert.match(src, /pre-flight barrier did not run to completion \(\$\{barrier\.outcome\}/);
  assert.match(src, /'pre-flight barrier failed; nothing was spawned'/, 'a barrier that failed still says failed');
});

// ---------------------------------------------------------------------------------------- stage 4, the evidence gate
import { evidenceRefusal } from '../scripts/lib/remediation-chain.mjs';

const H = (o) => ({ admitted: 'test_one', file: 'tests/a.test.js', captured: '2026-10-18T00:00:00.000Z', timed_out: false, ...o });
const GROUP = { group_id: 'G-1', red_evidence: 'r.log', green_evidence: 'g.log', files: ['src/a.js', 'tests/a.test.js'] };
const CONTRACT = { source_globs: ['src/**'], test_globs: ['tests/**'], commands: { test_one: 'node --test {file}' } };
const gate = (red, green) => evidenceRefusal(GROUP, { 'r.log': red, 'g.log': green }, CONTRACT, { caseInsensitive: false });
const GREEN = H({ exit: 0, captured: '2026-10-18T00:05:00.000Z' });

test('stage 4: a red that never ran (exit 124 with a capture error) is refused, naming the outcome', () => {
  const why = gate(H({ exit: 124, error: 'ENOENT' }), GREEN);
  assert.match(String(why), /did not run to completion \(could-not-start: ENOENT\)/);
});

test('stage 4: a red stopped by a signal is refused; a red that ran and failed is admitted', () => {
  assert.match(String(gate(H({ exit: 124, signal: 'SIGTERM' }), GREEN)), /did not run to completion \(incomplete/);
  assert.equal(gate(H({ exit: 1 }), GREEN), null);
});
