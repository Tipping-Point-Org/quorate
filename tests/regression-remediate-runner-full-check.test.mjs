// THE REMEDIATION RUNNER, END TO END WITH A FAKE NODE, part 7 of 9: the follow-up mint's flags, a contract override,
// hooks without secrets, and remediation-verification stages 4c, 4d and 5: the runner's full check and evidence gate.
// Split from regression-remediate-runner.test.mjs (split-slow-test-files.md); the fixture is
// remediate-runner-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, SCRIPTS_DIR } from './helpers.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { git, fakeNode, remAt, fixture, runRem, readRem, linkReconcileInside, setContract, lockOf, CHECK_SCRIPT, checkedFixture, headOf, e2eFixture, e2eEnv, leftInTree, trackedSuite, repoLockOf, holdRepoLock, GUARD_TODAY } from './remediate-runner-fixture.mjs';

// --no-verify-reviewers REACHES THE FOLLOW-UP MINT (reviewer-preflight stage 3), as --no-verify-sandbox does: remediate
// mints the follow-up review itself, and with the panel on that mint checks the reviewers unless told not to. Red first:
// remediate did not know the flag.
test('remediate passes --no-verify-reviewers to the follow-up mint, which is stamped REVIEWERS-UNVERIFIED', (t) => {
  const f = fixture(t, { panel: true });
  const r = runRem(f, ['--no-verify-reviewers']);
  assert.equal(r.status, 0, r.output);
  const follow = JSON.parse(fs.readFileSync(path.join(readRem(f).followup_run_dir, 'run.json'), 'utf8'));
  assert.equal(follow.reviewer_preflight, 'skipped');
  assert.ok(follow.stamps.includes('REVIEWERS-UNVERIFIED'), follow.stamps.join(','));
});

// reviewer-credential-routing stage 3 (A-26): the remediation node edits source, and its run gets no gate, so an override
// of its runtime must reach remediate's own output. spawn-node prints the line from the run's FROZEN contract; remediate
// inherits its stderr. The frozen contract here overrides the runtime while the live one does not.
test('an override of the node runtime in the frozen contract reaches remediate\'s output, after the node line', (t) => {
  const f = fixture(t);
  const runJsonPath = path.join(remAt(f), 'run.json');
  const run = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));
  run.contract.reviewers = { claude: { cmd: 'overridden-runtime' } };
  fs.writeFileSync(runJsonPath, JSON.stringify(run, null, 2));
  const r = runScript('remediate.mjs', ['--run-dir', f.rem, '--runtime-bin', f.bin, '--no-verify-sandbox'],
    { cwd: f.repo, env: { ...f.env, FAKE_RUN_DIR: f.rem } });
  const at = r.output.indexOf('== remediation node');
  assert.ok(at > -1, r.output.slice(-800));
  assert.match(r.output.slice(at), /claude \(node runtime\) — cmd set by the contract; every node spawned on this runtime/,
    r.output.slice(-800));
});

// remediation-commit-env AC3 (G-2 of commit-recovery r7): the hooks a remediation commit runs inherited every operator
// secret. A pre-commit hook that records its environment shows what crossed.
test('a hook run by a remediation commit does not see a secret-shaped variable', (t) => {
  const f = fixture(t);
  const seen = path.join(f.repo, '..', 'hook-env.txt');
  const hook = path.join(f.repo, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, ['#!/bin/sh', `env > "${seen.split(path.sep).join('/')}"`, 'exit 0', ''].join('\n'));
  fs.chmodSync(hook, 0o755);
  // The secret's NAME is built at runtime (.gitleaksignore's rule for fixtures): written as a literal key-value pair,
  // the push scan's key-value rule flagged it in 746261ef.
  const secretName = 'GITHUB_' + 'TOKEN';
  const r = runScript('remediate.mjs', ['--run-dir', f.rem, '--runtime-bin', f.bin, '--no-verify-sandbox'],
    { cwd: f.repo, env: { ...f.env, FAKE_RUN_DIR: f.rem, [secretName]: 'should-not-cross', PLAIN_SETTING: 'kept' } });
  assert.equal(r.status, 0, r.output.slice(-800));
  const env = fs.readFileSync(seen, 'utf8');
  assert.match(env, /^PLAIN_SETTING=kept$/m, 'precondition: the hook ran and recorded its environment');
  assert.doesNotMatch(env, /GITHUB_TOKEN/, 'a secret-shaped variable reached the commit\'s hook');
});

test('stage 4c: a failing test refuses every planned cluster, retryable; a retry once it passes commits them', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  const head = headOf(f);
  const r = runRem(f, [], { CHECK_MODE: 'fail' });
  assert.notEqual(r.status, 0, 'a pending cluster stops the run before its follow-up');
  assert.equal(headOf(f), head, 'nothing committed');
  const run = readRem(f);
  const e = run.commit_check.find((c) => c.kind === 'full-run-red');
  assert.ok(e, JSON.stringify(run.commit_check));
  assert.match(e.message, /test 1 failing test\(s\): the guard holds/);
  assert.equal(run.clusters[0].pending_retry, true);
  // THE CHECKED STATE, recorded: HEAD and each candidate file's hash. The hashes go to an evidence file the run cites, not
  // into run.json: archived, run.json is tracked, and a hash keyed by a file name with "auth" in it is what a secret scan
  // reads as a credential (operator, 2026-10-15: "Fingerprint now, fix shape (Recommended)").
  const [fc] = run.full_checks;
  assert.equal(fc.head, head);
  assert.equal(fc.files, undefined, 'no hash map in run.json');
  assert.match(fc.files_at, /^evidence\/remediation-runner\/full-check-1\/checked-files\.json$/);
  const checked = JSON.parse(fs.readFileSync(path.join(remAt(f), fc.files_at), 'utf8'));
  assert.match(checked['src/a.js'], /^[0-9a-f]{40}$/);
  assert.match(fc.results.test.evidence_path, /^evidence\/remediation-runner\//);
  // Each check's own time (telemetry-records.plan.md stage 1b), kept in run.json as the pre-flight keeps it.
  assert.ok(Number.isFinite(Date.parse(fc.results.test.started_at)), `no started_at: ${fc.results.test.started_at}`);
  assert.ok(Number.isInteger(fc.results.test.duration_ms), `no duration_ms: ${fc.results.test.duration_ms}`);
  assert.match(git(f.repo, 'status', '--porcelain').stdout, / M src\/a\.js/, 'the fix stays in the working tree');
  const again = runRem(f, ['--retry-commits'], { CHECK_MODE: 'pass' });
  assert.notEqual(headOf(f), head, again.output.slice(-800));
  assert.deepEqual(git(f.repo, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n').sort(), ['src/a.js', 'tests/a.test.js']);
  assert.equal(readRem(f).full_checks.length, 2, 'the retry checked its candidate again');
});

test('stage 4c: a failing lint refuses; a failing audit is recorded and the commit proceeds', (t) => {
  const f = checkedFixture(t, { lint: 'node check.cjs lint' });
  const head = headOf(f);
  runRem(f, [], { LINT_EXIT: '1' });
  assert.equal(headOf(f), head, 'lint refused the commit');
  assert.ok(readRem(f).commit_check.some((c) => c.kind === 'full-run-red' && /lint exit 1/.test(c.message)), JSON.stringify(readRem(f).commit_check));
  const g = checkedFixture(t, { audit: 'node check.cjs audit' });
  const before = headOf(g);
  const r = runRem(g, [], { AUDIT_EXIT: '1' });
  assert.notEqual(headOf(g), before, r.output.slice(-800));
  assert.deepEqual(readRem(g).full_checks[0].advisory.map((a) => a.key), ['audit']);
});

test('stage 4c: a counted-facts drift alone commits and names the update; a non-zero exit with nothing failing does not', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  const head = headOf(f);
  const r = runRem(f, [], { CHECK_MODE: 'drift' });
  assert.notEqual(headOf(f), head, r.output.slice(-800));
  assert.match(r.output, /README\.md states 29 tests/);
  assert.equal(readRem(f).full_checks[0].count_update.tests, 30);
  const g = checkedFixture(t, { test: 'node check.cjs' });
  const before = headOf(g);
  runRem(g, [], { CHECK_MODE: 'exit1' });
  assert.equal(headOf(g), before, 'an exit 1 with no failing test and no drift is refused');
  assert.ok(readRem(g).commit_check.some((c) => c.kind === 'full-run-red'), JSON.stringify(readRem(g).commit_check));
});

test('stage 4c: an edit the node left outside its report refuses the candidate (tree-not-candidate), naming it', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  const head = headOf(f);
  runRem(f, [], { FAKE_WRITE: JSON.stringify({ 'src/left.js': 'an unreported edit\n' }) });
  assert.equal(headOf(f), head, 'nothing committed');
  const e = readRem(f).commit_check.find((c) => c.kind === 'tree-not-candidate');
  assert.ok(e, JSON.stringify(readRem(f).commit_check));
  assert.match(e.message, /src\/left\.js/);
  assert.equal(readRem(f).clusters[0].pending_retry, true);
});

test('stage 4c: the lock names the checking phase while the full check runs', () => {
  const src = fs.readFileSync(path.join(SCRIPTS_DIR, 'remediate.mjs'), 'utf8');
  const at = src.indexOf("setLockPhase('checking')");
  assert.ok(at !== -1 && at < src.indexOf('await runDeclaredChecks('), 'the phase is set before the checks run');
});

// ------------------------------------------------- remediation-verification stage 4d: what is committed is what was checked
// Before each cluster's `git add`, the tree guard, every remaining candidate file's hash and HEAD (advanced only by this
// invocation's own commits) are re-checked; a difference refuses the remaining clusters, retryable. After each commit the
// committed blobs are compared with the hashes recorded at check time: a hook can rewrite a file after the re-check.
test('stage 4d: a candidate file changed after the check refuses the cluster, retryable, and nothing is committed', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  const head = headOf(f);
  runRem(f, [], { CHECK_MODE: 'touch' });
  assert.equal(headOf(f), head, 'nothing committed');
  const e = readRem(f).commit_check.find((c) => c.kind === 'tree-not-candidate');
  assert.ok(e, JSON.stringify(readRem(f).commit_check));
  assert.match(e.message, /src\/a\.js changed since it was checked/);
  assert.equal(readRem(f).clusters[0].pending_retry, true);
});

test('stage 4d: a commit made after the check (HEAD moved by something else) refuses the cluster', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  runRem(f, [], { CHECK_MODE: 'commit' });
  assert.equal(git(f.repo, 'log', '-1', '--format=%s').stdout.trim(), 'made by the suite', 'only the suite\'s commit landed');
  const e = readRem(f).commit_check.find((c) => c.kind === 'tree-not-candidate');
  assert.ok(e, JSON.stringify(readRem(f).commit_check));
  assert.match(e.message, /HEAD moved/);
});

test('stage 4d: a hook that rewrites a file into the commit is named (committed-differs), never accepted silently', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  const hook = path.join(f.repo, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, ['#!/bin/sh', 'echo "// formatted" >> src/a.js', 'git add src/a.js', ''].join('\n'));
  fs.chmodSync(hook, 0o755);
  const head = headOf(f);
  runRem(f);
  assert.notEqual(headOf(f), head, 'the commit landed');
  assert.match(git(f.repo, 'show', 'HEAD:src/a.js').stdout, /formatted/, 'precondition: the hook changed what was committed');
  const e = readRem(f).commit_check.find((c) => c.kind === 'committed-differs');
  assert.ok(e, JSON.stringify(readRem(f).commit_check));
  assert.match(e.message, /src\/a\.js/);
});

test('stage 4d: a retry re-checks before its commit too — a candidate file changed by its check refuses it again', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  const head = headOf(f);
  runRem(f, [], { CHECK_MODE: 'fail' });
  assert.equal(readRem(f).clusters[0].pending_retry, true, 'precondition: the first run left the cluster pending');
  runRem(f, ['--retry-commits'], { CHECK_MODE: 'touch' });
  assert.equal(headOf(f), head, 'nothing committed');
  const last = readRem(f).commit_check.filter((c) => c.kind === 'tree-not-candidate').at(-1);
  assert.ok(last, JSON.stringify(readRem(f).commit_check));
  assert.match(last.message, /src\/a\.js changed since it was checked/);
  assert.equal(readRem(f).clusters[0].pending_retry, true);
});

test('stage 4d: a second cluster still commits after the first moved HEAD — the runner\'s own commits are its own', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  fs.writeFileSync(path.join(f.reviewed, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [
    { group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }, { group_id: 'G-2', decision: 'confirmed', severity: 'MEDIUM' }] }));
  const head = headOf(f);
  const r = runRem(f, [], {
    FAKE_WRITE: JSON.stringify({ 'src/b.js': 'fixed b\n', 'tests/b.test.js': 'red then green b\n' }),
    FAKE_SECOND_FILES: JSON.stringify(['src/b.js', 'tests/b.test.js']),
  });
  const run = readRem(f);
  assert.equal(run.remediation_commits.length, 2, `${JSON.stringify(run.commit_check)}\n${r.output.slice(-600)}`);
  assert.equal(git(f.repo, 'rev-list', '--count', `${head}..HEAD`).stdout.trim(), '2');
  assert.ok(!run.commit_check.some((c) => c.kind === 'tree-not-candidate'), JSON.stringify(run.commit_check));
});

// ------------------------------------------------- remediation-verification stage 5: the evidence gate, in the runner
// A group commits only on its own experiment: a test_one red that failed, then a later test_one green of the same test
// file, which the group commits (operator, 2026-10-13: "Evidence-gated (Recommended)"). Read from capture's header.
test('stage 5: a fixed group with no green commits nothing, refused at admission (evidence-refused)', (t) => {
  const f = fixture(t);
  const head = headOf(f);
  runRem(f, [], { FAKE_MODE: 'nogreen' });
  assert.equal(headOf(f), head, 'nothing committed');
  const e = readRem(f).commit_check.find((c) => c.kind === 'evidence-refused');
  assert.ok(e, JSON.stringify(readRem(f).commit_check));
  assert.match(e.message, /no green/);
});

// SEVERAL GREENS (20261014-190935-lf-remediation-2): a fix that changed two test files lists both greens; the runner read
// the list as one path, named it in report_check and refused the group.
test('several greens: a fix listing a green per changed test file commits, and nothing is named in report_check', (t) => {
  const f = fixture(t);
  const head = headOf(f);
  runRem(f, [], { FAKE_MODE: 'multigreen' });
  const run = readRem(f);
  assert.deepEqual(run.report_check ?? [], [], JSON.stringify(run.report_check));
  assert.notEqual(headOf(f), head, `committed: ${JSON.stringify(run.commit_check)}`);
  assert.ok(git(f.repo, 'show', '--name-only', '--format=', 'HEAD').stdout.includes('tests/b.test.js'), 'the second test file is in the commit');
});
