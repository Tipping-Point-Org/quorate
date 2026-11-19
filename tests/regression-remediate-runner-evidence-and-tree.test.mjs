// THE REMEDIATION RUNNER, END TO END WITH A FAKE NODE, part 8 of 9: remediation-verification stages 5 and 7,
// candidate-check-boundaries, symptom admission, left-in-tree and the fmt baseline. Split from
// regression-remediate-runner.test.mjs (split-slow-test-files.md); the fixture is remediate-runner-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, SCRIPTS_DIR } from './helpers.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { git, fakeNode, remAt, fixture, runRem, readRem, linkReconcileInside, setContract, lockOf, CHECK_SCRIPT, checkedFixture, headOf, e2eFixture, e2eEnv, leftInTree, trackedSuite, repoLockOf, holdRepoLock, GUARD_TODAY } from './remediate-runner-fixture.mjs';

test('stage 5: a red that is a capture of the full test command does not count for a group', (t) => {
  const f = fixture(t);
  const ev = path.join(remAt(f), 'evidence', 'remediation');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'suite-red.txt'), ['$ node tests/run-all.mjs', '# admitted: test', '# cwd: x', '# exit: 1',
    '# timeout: 15 minute(s)', '# captured: 2026-10-13T09:00:00.000Z', '-'.repeat(72), ''].join('\n'));
  const head = headOf(f);
  runRem(f, [], { FAKE_RED_EVIDENCE: 'evidence/remediation/suite-red.txt' });
  assert.equal(headOf(f), head, 'nothing committed');
  assert.ok(readRem(f).commit_check.some((c) => c.kind === 'evidence-refused' && /not a test_one capture/.test(c.message)), JSON.stringify(readRem(f).commit_check));
});

// EVIDENCE GONE SINCE THE FIRST RUN is now refused before the re-plan (grounding-and-retry-evidence.plan.md stage 2; design
// GR-D2 A, operator 2026-11-03: "15 a"): the first run recorded the capture, and a retry trusts only what it recorded.
test('stage 5: evidence gone since the first run — the retry is refused before it plans, the cluster left pending', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  const head = headOf(f);
  runRem(f, [], { CHECK_MODE: 'fail' });
  assert.equal(readRem(f).clusters[0].pending_retry, true, 'precondition: pending after a red full check');
  assert.ok(readRem(f).evidence_record?.captures?.['evidence/remediation/green.txt'], 'the first run did not record the green');
  fs.rmSync(path.join(remAt(f), 'evidence', 'remediation', 'green.txt'));
  const r = runRem(f, ['--retry-commits'], { CHECK_MODE: 'pass' });
  assert.equal(headOf(f), head, 'nothing committed');
  assert.notEqual(r.status, 0);
  assert.match(r.output, /green\.txt changed since the first run read it \(it is missing now\)/);
  assert.equal(readRem(f).clusters[0].pending_retry, true, 'a refused retry leaves the cluster pending');
});

test('stage 7: a node that captured a failing then passing test_one run commits', (t) => {
  const f = e2eFixture(t);
  const head = headOf(f);
  const r = runRem(f, [], e2eEnv());
  assert.notEqual(headOf(f), head, r.output.slice(-1200));
  const run = readRem(f);
  assert.deepEqual(run.clusters.map((c) => Boolean(c.commit)), [true]);
  const fc = run.full_checks.at(-1);
  assert.equal(fc.results.test.exit_code, 0, JSON.stringify(fc));
  assert.equal(fc.results.test.tests, 2, 'the whole suite ran, both tests');
});

test('stage 7: a node that skipped its green commits nothing', (t) => {
  const f = e2eFixture(t);
  const head = headOf(f);
  runRem(f, [], e2eEnv({ FAKE_E2E_SKIP_GREEN: '1' }));
  assert.equal(headOf(f), head, 'nothing committed');
  assert.ok(readRem(f).commit_check.some((c) => c.kind === 'evidence-refused'), JSON.stringify(readRem(f).commit_check));
});

test('stage 7: a fix that breaks another test is refused by the candidate check, and retried after a fix inside its files', (t) => {
  const f = e2eFixture(t);
  const head = headOf(f);
  runRem(f, [], e2eEnv({ FAKE_E2E_FIX: 'fixed, and made far too long\n' }));
  assert.equal(headOf(f), head, 'nothing committed');
  const red = readRem(f).commit_check.find((c) => c.kind === 'full-run-red');
  assert.ok(red, JSON.stringify(readRem(f).commit_check));
  assert.match(red.message, /a stays short/, 'the failing test is named');
  fs.writeFileSync(path.join(f.repo, 'src', 'a.js'), 'fixed\n');   // inside the candidate: src/a.js
  const r = runRem(f, ['--retry-commits'], { NODE_TEST_CONTEXT: undefined });
  assert.notEqual(headOf(f), head, r.output.slice(-1200));
  assert.equal(git(f.repo, 'show', 'HEAD:src/a.js').stdout, 'fixed\n');
});

test('stage 7: a fix outside the candidate\'s files is refused on retry, saying to mint a new remediation run', (t) => {
  const f = e2eFixture(t);
  const head = headOf(f);
  runRem(f, [], e2eEnv({ FAKE_E2E_FIX: 'fixed, and made far too long\n' }));
  fs.writeFileSync(path.join(f.repo, 'tests', 'other.test.js'), "require('node:test').test('relaxed', () => {});\n");   // outside it
  runRem(f, ['--retry-commits'], { NODE_TEST_CONTEXT: undefined });
  assert.equal(headOf(f), head, 'nothing committed');
  const last = readRem(f).commit_check.filter((c) => c.kind === 'tree-not-candidate').at(-1);
  assert.ok(last, JSON.stringify(readRem(f).commit_check));
  assert.match(last.message, /tests\/other\.test\.js/);
  assert.match(last.message, /new remediation run/);
});

// ------------------------------------------------- candidate-check-boundaries stage 2: what reaches the candidate's code
// D1 + D2 (operator, 2026-10-14: "Allow-list", "Decided once in lib"): a real capture.mjs, run by the runner's candidate
// check, executes a script that records the environment names it received. Only the platform's basics, the git
// identity, the declared names, the channel files and the depth may arrive.
test('candidate-check-boundaries stage 2: the candidate check\'s command receives only the allow-listed environment', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'envdump.cjs'), [
    "require('node:fs').writeFileSync('envdump.json', JSON.stringify(Object.keys(process.env)));",
    "console.log('# tests 1'); console.log('# pass 1'); console.log('# fail 0');",
  ].join('\n'));
  setContract(f, (c) => { c.commands = { ...(c.commands ?? {}), test: 'node envdump.cjs' }; c.review = { ...(c.review ?? {}), candidate_env: ['JAVA_HOME'] }; });
  const extra = { FOO: 'opaque', GIT_CONFIG_PARAMETERS: "'http.extraheader=x'", SECRET_TOKEN: 's', JAVA_HOME: '/j' };
  const r = runRem(f, [], extra);
  const dump = path.join(f.repo, 'envdump.json');
  assert.ok(fs.existsSync(dump), `the candidate check did not run the command: ${r.output.slice(-600)}\n${JSON.stringify(readRem(f).full_checks ?? readRem(f).commit_check)}`);
  const raw = JSON.parse(fs.readFileSync(dump, 'utf8'));
  const names = raw.map((n) => n.toUpperCase());
  for (const absent of ['FOO', 'GIT_CONFIG_PARAMETERS', 'SECRET_TOKEN', 'QUORATE_RUN_ID']) assert.ok(!names.includes(absent), `${absent} reached the candidate's code`);
  for (const present of ['PATH', 'JAVA_HOME', 'GRAPH_NODE_DEPTH', 'QUORATE_COUNT_FILE']) assert.ok(names.includes(present), `${present} did not reach it`);
  // EXACT NAME-SET EQUALITY (I-14; G-18 of 20261014-022857-ccb-delivery): the checks above are a subset, and any further
  // name could cross beside them unseen. Expected, from what was sent: the platform's basics, the git identity, QUORATE_HOME
  // and the declared JAVA_HOME, by the platform's environment case rule; plus the depth and the channel files the runner sets.
  const { processEnvBasics: basics, caseInsensitiveEnv: ci } = hostPlatform();
  const fold = (n) => (ci ? n.toUpperCase() : n);
  const allowed = [...basics, 'QUORATE_HOME', 'JAVA_HOME'].map(fold);
  const admits = (n) => /^GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL|DATE)$/.test(fold(n))
    || allowed.some((e) => (e.endsWith('*') ? fold(n).startsWith(e.slice(0, -1)) : fold(n) === e));
  const sent = { ...process.env, ...f.env, ...extra };
  // macOS's CoreFoundation sets __CF_USER_TEXT_ENCODING in a process that starts without it, so the child holds it after
  // the allow-list dropped it (ci-path-identity.plan.md stage 3b; CI run 44220656481). It is set by the OS in the child,
  // it carries no value from the runner, and it is the only name allowed this way.
  const osAdded = process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : [];
  const expected = new Set([...Object.keys(sent).filter((k) => sent[k] !== undefined && admits(k)).map(fold),
    'GRAPH_NODE_DEPTH', 'QUORATE_COUNT_FILE', 'QUORATE_FACTS_FILE', ...osAdded.filter((n) => raw.includes(n))]);
  assert.deepEqual([...new Set(raw.map(fold))].sort(), [...expected].sort(), 'the names that reached the candidate\'s code');
});

// A SYMPTOM IS FIXED WITH ITS ROOT (skills/remediate: "`symptom` and its `root_cause_group` are the canonical cluster").
// Observed on 20261014-184502-lf-remediation: the node fixed G-16 and reported its symptom G-19 with it; admission refused
// G-19 as "unconfirmed-group" (a symptom is not `confirmed`), and the refusal spread to G-16 and G-13 — nothing committed
// (ledger scripts/lib/remediation-chain.mjs:70). A reported symptom whose root is confirmed and not deferred is admitted
// as its root's; one whose root is deferred is refused as deferred; any other unconfirmed group is refused as before.
test('symptom admission: a reported symptom of a confirmed root is admitted, and does not refuse its root', async () => {
  const { admitGroups } = await import('../scripts/lib/remediation-chain.mjs');
  const G = (id, files, extra = {}) => ({ group_id: id, disposition: 'fixed', files, red_evidence: '', green_evidence: '', cluster: 'c1', ...extra });
  const groups = [G('G-16', ['src/a.js', 'tests/a.test.js']), G('G-19', ['tests/a.test.js'])];
  const ok = admitGroups({ groups, confirmed: ['G-16'], symptoms: { 'G-19': 'G-16' }, caseInsensitive: false });
  assert.deepEqual(ok.plannable.map((g) => g.group_id), ['G-16', 'G-19']);
  assert.deepEqual(ok.checks, []);
  const rootDeferred = admitGroups({ groups: [G('G-19', ['tests/a.test.js'])], confirmed: ['G-16'], deferred: ['G-16'],
    symptoms: { 'G-19': 'G-16' }, caseInsensitive: false });
  assert.equal(rootDeferred.checks[0]?.kind, 'deferred-group', 'a symptom of a deferred root is deferred with it');
  const stray = admitGroups({ groups: [G('G-7', ['src/a.js'])], confirmed: ['G-16'], symptoms: { 'G-19': 'G-16' }, caseInsensitive: false });
  assert.equal(stray.checks[0]?.kind, 'unconfirmed-group', 'a group that is no confirmed root\'s symptom is still refused');
});

test('symptom admission: the runner reads each symptom\'s root from the reviewed run and commits root and symptom', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.reviewed, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [
    { group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' },
    { group_id: 'G-2', decision: 'symptom', severity: 'MEDIUM', root_cause_group: 'G-1' }] }));
  const head = headOf(f);
  runRem(f, [], { FAKE_SECOND: '1' });   // G-2 reported beside G-1, naming the same files
  const run = readRem(f);
  assert.ok(!(run.commit_check ?? []).some((c) => c.kind === 'unconfirmed-group' || c.kind === 'shared-with-refused'),
    JSON.stringify(run.commit_check));
  assert.notEqual(headOf(f), head, `nothing committed: ${JSON.stringify(run.commit_check)}`);
});

test('left-in-tree: a node that commits nothing has every file it wrote named, stamped and printed', (t) => {
  const f = fixture(t);
  const r = runRem(f, [], { FAKE_FILES: '[]', FAKE_WRITE: JSON.stringify({ 'tests/orphan.test.js': 'red, never green\n' }) });
  const run = readRem(f);
  assert.equal((run.remediation_commits ?? []).length, 0, 'nothing should have been committed');
  assert.deepEqual(leftInTree(run), ['src/a.js', 'tests/a.test.js', 'tests/orphan.test.js'], JSON.stringify(run.commit_check));
  assert.ok(run.stamps.includes('COMMIT-CHECK'));
  assert.match(r.output, /tests\/orphan\.test\.js/, 'the path is not printed');
});

test('left-in-tree: a file a cluster commits, or one changed before the node started, is not named', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.repo, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, 'notes', 'mine.txt'), 'the operator\'s\n');
  // Outside the checked globs: a stray file under tests/** already refuses the candidate (tree-not-candidate), named there.
  const r = runRem(f, [], { FAKE_WRITE: JSON.stringify({ 'docs/left.md': 'a scratch note the node wrote\n' }) });
  assert.equal(r.status, 0, r.output);
  const run = readRem(f);
  t.after(() => run.followup_run_dir && fs.rmSync(run.followup_run_dir, { recursive: true, force: true }));
  assert.equal(run.remediation_commits.length, 1);
  assert.deepEqual(leftInTree(run), ['docs/left.md']);
});

// G-6 of 20261017-195046-lit-review: only statusEntriesV2's `files` reached leftInTree, and a nested repository or submodule
// lands in its `refused`, so another repository the node's run created was left in the tree, named nowhere. One that was
// there before the node started is the operator's, and stays unnamed.
test('left-in-tree: a nested repository the node\'s run created is named; one there before it started is not', (t) => {
  const f = fixture(t);
  const before = path.join(f.repo, 'docs', 'theirs');
  fs.mkdirSync(before, { recursive: true });
  git(before, 'init', '-q');
  fs.writeFileSync(path.join(before, 'x.md'), 'the operator\'s nested repository\n');
  runRem(f, [], { FAKE_GIT_INIT: JSON.stringify(['docs/nested']), FAKE_WRITE: JSON.stringify({ 'docs/nested/n.md': 'inside\n' }) });
  const run = readRem(f);
  t.after(() => run.followup_run_dir && fs.rmSync(run.followup_run_dir, { recursive: true, force: true }));
  assert.deepEqual(leftInTree(run), ['docs/nested/'], JSON.stringify(run.commit_check));
  assert.ok(run.stamps.includes('COMMIT-CHECK'));
});

// THE FORMATTER BEFORE THE NODE, END TO END (remediation-fmt-check-baseline.md). The fixture's fmt_check fails on the
// node's fix and, in the second case, on the tree before it too.
test('fmt baseline: a formatter that passed before the node and fails on its fix refuses the candidate', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'fmt.cjs'), "process.exit(require('node:fs').readFileSync('src/a.js', 'utf8').startsWith('fixed') ? 1 : 0);\n");
  setContract(f, (c) => { c.commands = { ...(c.commands ?? {}), fmt_check: 'node fmt.cjs' }; });
  runRem(f);
  const run = readRem(f);
  const baseLog = run.fmt_baseline?.fmt_check?.evidence_path ? path.join(remAt(f), run.fmt_baseline.fmt_check.evidence_path) : null;
  assert.equal(run.fmt_baseline?.fmt_check?.exit_code, 0, baseLog && fs.existsSync(baseLog) ? fs.readFileSync(baseLog, 'utf8') : JSON.stringify(run.fmt_baseline));
  assert.equal((run.remediation_commits ?? []).length, 0, 'the candidate the formatter turned red was committed');
  assert.ok((run.commit_check ?? []).some((e) => e.kind === 'full-run-red' && /fmt_check/.test(e.message)), JSON.stringify(run.commit_check));
});

test('fmt baseline: formatting debt already there before the node still only stamps', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'fmt.cjs'), 'process.exit(1);\n');
  setContract(f, (c) => { c.commands = { ...(c.commands ?? {}), fmt_check: 'node fmt.cjs' }; });
  const r = runRem(f);
  const run = readRem(f);
  t.after(() => run.followup_run_dir && fs.rmSync(run.followup_run_dir, { recursive: true, force: true }));
  assert.equal(run.fmt_baseline?.fmt_check?.exit_code, 1);
  assert.equal(run.remediation_commits.length, 1, r.output);
  assert.ok(run.stamps.includes('FMT-DIRTY'));
});

// THE RETRY READS THE BASELINE IT RECORDED (check-outcomes.plan.md stage 5, design D4; replaces the source-text pin that
// round 3's G-8 found could not fail). Step 3 is the one that pins the retry's own reading: a retry that re-measured the
// baseline on the unformatted tree would see it fail, only stamp, and commit.
test('check-outcomes stage 5: a refused formatter stays refused on a retry, and commits once the files are formatted', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'fmt.cjs'), "process.exit(require('node:fs').readFileSync('src/a.js', 'utf8').startsWith('fixed') ? 1 : 0);\n");
  setContract(f, (c) => { c.commands = { ...(c.commands ?? {}), fmt_check: 'node fmt.cjs' }; });
  runRem(f);
  assert.equal(readRem(f).fmt_baseline?.fmt_check?.outcome, 'passed', 'precondition: the baseline passed');
  assert.equal((readRem(f).remediation_commits ?? []).length, 0, 'precondition: the formatter refused the candidate');
  const again = runRem(f, ['--retry-commits']);
  const pending = readRem(f);
  assert.equal((pending.remediation_commits ?? []).length, 0, `a retry before formatting committed:\n${again.output.slice(-600)}`);
  assert.ok((pending.clusters ?? []).some((c) => c.fmt_turned_red === true), 'the retry no longer says the formatter turned red');
  fs.writeFileSync(path.join(f.repo, 'src', 'a.js'), 'Fixed, formatted\n');
  const done = runRem(f, ['--retry-commits']);
  const run = readRem(f);
  t.after(() => run.followup_run_dir && fs.rmSync(run.followup_run_dir, { recursive: true, force: true }));
  assert.equal(run.remediation_commits.length, 1, done.output.slice(-600));
});
