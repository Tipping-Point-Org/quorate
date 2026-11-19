// THE REMEDIATION RUNNER, END TO END WITH A FAKE NODE, part 9 of 9: new files under the full check, the repository
// lock, the elapsed line, the stop reason, the tree guard and run-dir-descendants. Split from
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

test('a cluster that adds a new file passes a full check that asks git whether the file is tracked', (t) => {
  const f = fixture(t);
  trackedSuite(f, 'src/new.js');
  const r = runRem(f, [], { FAKE_WRITE: JSON.stringify({ 'src/new.js': 'n\n' }),
    FAKE_FILES: JSON.stringify(['src/a.js', 'src/new.js', 'tests/a.test.js']) });
  const run = readRem(f);
  t.after(() => run.followup_run_dir && fs.rmSync(run.followup_run_dir, { recursive: true, force: true }));
  assert.equal(run.remediation_commits?.length, 1, r.output.slice(-800));
  assert.match(git(f.repo, 'show', '--name-only', '--format=', 'HEAD').stdout, /src\/new\.js/);
});

test('a refused candidate leaves its new file untracked, as the node left it', (t) => {
  const f = fixture(t);
  trackedSuite(f, 'src/absent.js');
  const r = runRem(f, [], { FAKE_WRITE: JSON.stringify({ 'src/new.js': 'n\n' }),
    FAKE_FILES: JSON.stringify(['src/a.js', 'src/new.js', 'tests/a.test.js']) });
  assert.equal(readRem(f).remediation_commits?.length ?? 0, 0, r.output.slice(-800));
  assert.equal(git(f.repo, 'ls-files', '--error-unmatch', 'src/new.js').status !== 0, true, 'the refused candidate\'s new file was left staged');
});

// A FAILED UNMARK REFUSES (G-3 of 20261020-132503-ciss-remediation-5-review): it was only printed, so the run went on with
// the candidate's new files recorded in the index as intent-to-add, and a passing candidate committed past it.
test('a full check that cannot unmark the candidate\'s new files refuses the candidate, naming them', (t) => {
  const f = fixture(t);
  trackedSuite(f, 'src/new.js');
  const r = runRem(f, ['--test-fail-unmark'], { FAKE_WRITE: JSON.stringify({ 'src/new.js': 'n\n' }),
    FAKE_FILES: JSON.stringify(['src/a.js', 'src/new.js', 'tests/a.test.js']) });
  const run = readRem(f);
  t.after(() => run.followup_run_dir && fs.rmSync(run.followup_run_dir, { recursive: true, force: true }));
  assert.equal(run.remediation_commits?.length ?? 0, 0, r.output.slice(-800));
  const e = (run.commit_check ?? []).find((c) => c.kind === 'tree-not-candidate');
  assert.ok(e && /src\/new\.js/.test(e.message) && /intent-to-add/.test(e.message), JSON.stringify(run.commit_check));
});

// THE RETRY STILL SEES THE MARKED FILE (G-2 of 20261020-202031-intent-unmark-remediation-review): new files were named only
// by `ls-files --others`, which no longer lists a file left intent-to-add, so --retry-commits skipped the unmark and
// committed past the refusal above.
test('a retry after a failed unmark still names the file left intent-to-add, and refuses while it cannot be unmarked', (t) => {
  const f = fixture(t);
  trackedSuite(f, 'src/new.js');
  runRem(f, ['--test-fail-unmark'], { FAKE_WRITE: JSON.stringify({ 'src/new.js': 'n\n' }),
    FAKE_FILES: JSON.stringify(['src/a.js', 'src/new.js', 'tests/a.test.js']) });
  assert.match(git(f.repo, 'status', '--porcelain').stdout, /^ A src\/new\.js$/m, 'the first run did not leave the file intent-to-add');
  const r = runRem(f, ['--retry-commits', '--test-fail-unmark']);
  const run = readRem(f);
  t.after(() => run.followup_run_dir && fs.rmSync(run.followup_run_dir, { recursive: true, force: true }));
  assert.equal(run.remediation_commits?.length ?? 0, 0, r.output.slice(-800));
  const e = (run.commit_check ?? []).filter((c) => c.kind === 'tree-not-candidate').at(-1);
  assert.ok(e && /src\/new\.js/.test(e.message) && /intent-to-add/.test(e.message), JSON.stringify(run.commit_check));
});

// THE RUNNER UNMARKS, AND PRINTS NO COMMAND (G-4 of 20261020-225653-intent-unmark-remediation-5-review; operator: "Runner
// does it, prints no command (Recommended)"). The printed `git reset` was quoted for a shell (G-3 of
// 20261020-210303-intent-unmark-remediation-2-review, G-2 of 20261020-214234-intent-unmark-remediation-3-review), and no
// quoting is right for every one: cmd.exe expands `%NAME%` and `!NAME!` inside double quotes, and briefArg's backslash
// rewrite renamed a POSIX `a\b.js`, so a pasted recovery reset a different path and left the file intent-to-add.
// --retry-commits names a file left intent-to-add (the test above) and unmarks it, so that is the recovery.
test('a failed unmark prints no git reset for any path, and --retry-commits unmarks the file itself', (t) => {
  for (const odd of ['src/x%PATH%.js', 'src/new x;y.js', 'src/a$(id).js']) {
    const f = fixture(t);
    trackedSuite(f, odd);
    const r = runRem(f, ['--test-fail-unmark'], { FAKE_WRITE: JSON.stringify({ [odd]: 'n\n' }),
      FAKE_FILES: JSON.stringify(['src/a.js', odd, 'tests/a.test.js']) });
    const run = readRem(f);
    t.after(() => run.followup_run_dir && fs.rmSync(run.followup_run_dir, { recursive: true, force: true }));
    assert.equal(run.remediation_commits?.length ?? 0, 0, r.output.slice(-800));
    const e = (run.commit_check ?? []).find((c) => c.kind === 'tree-not-candidate' && /intent-to-add/.test(c.message));
    assert.ok(e && e.message.includes(odd), r.output.slice(-800) + JSON.stringify(run.commit_check));
    assert.ok(!/git reset -q --/.test(e.message) && !/git reset -q --/.test(r.output), `a command was printed: ${e.message}`);
    assert.match(e.message, /--retry-commits unmarks them/, e.message);
  }
  const f = fixture(t);
  trackedSuite(f, 'src/new.js');
  runRem(f, ['--test-fail-unmark'], { FAKE_WRITE: JSON.stringify({ 'src/new.js': 'n\n' }),
    FAKE_FILES: JSON.stringify(['src/a.js', 'src/new.js', 'tests/a.test.js']) });
  assert.match(git(f.repo, 'status', '--porcelain').stdout, /^ A src\/new\.js$/m, 'the first run did not leave the file intent-to-add');
  const r = runRem(f, ['--retry-commits']);
  const run = readRem(f);
  t.after(() => run.followup_run_dir && fs.rmSync(run.followup_run_dir, { recursive: true, force: true }));
  assert.doesNotMatch(git(f.repo, 'status', '--porcelain').stdout, /^ A /m, `the retry left an intent-to-add entry: ${r.output.slice(-800)}`);
});

// ONE REMEDIATION PER REPOSITORY (remediation-consumer-findings.plan.md stage 2, AC6 and AC7; story-pipeline's 20261020-114215
// and -114309, launched a minute apart: both nodes completed and neither committed, each refusing every cluster over the
// other's files). The run lock serialised two runners on one run and nothing across runs.
test('stage 2: the repository lock\'s state from its record and this host', async () => {
  const { lockState } = await import('../scripts/lib/repo-lock.mjs');
  const rec = { run_id: 'r', pid: 42, host: 'h' };
  assert.equal(lockState({ record: rec, host: 'h', alive: true }), 'live');
  assert.equal(lockState({ record: rec, host: 'h', alive: false }), 'stale');
  assert.equal(lockState({ record: rec, host: 'other', alive: false }), 'foreign-host', 'another host\'s lock is never stale');
  assert.equal(lockState({ record: null, host: 'h', alive: false }), 'unreadable');
});

test('stage 2: a second runner is refused while another remediation holds the repository, and changes nothing (AC7)', async (t) => {
  const f = fixture(t);
  const p = await holdRepoLock(f, { pid: process.pid, host: os.hostname() });
  const lock = fs.readFileSync(p, 'utf8');
  const runBefore = fs.readFileSync(path.join(remAt(f), 'run.json'), 'utf8');
  const r = runRem(f);
  assert.equal(r.status, 8, r.output);
  assert.match(r.output, /other-remediation/, 'the holder\'s run is not named');
  assert.equal(fs.existsSync(f.log), false, 'a node was spawned');
  assert.equal(fs.readFileSync(p, 'utf8'), lock, 'the repository lock byte-for-byte');
  assert.equal(fs.readFileSync(path.join(remAt(f), 'run.json'), 'utf8'), runBefore, 'run.json byte-for-byte');
  assert.equal(fs.existsSync(lockOf(f)), false, 'the run lock was left behind');
  assert.equal(git(f.repo, 'status', '--porcelain').stdout.trim(), '', 'the working tree untouched');
});

test('stage 2: a stale lock on this host is named with how to remove it; another host\'s is never called stale', async (t) => {
  const f = fixture(t);
  const p = await holdRepoLock(f, { pid: 2147483646, host: os.hostname() });
  const stale = runRem(f);
  assert.equal(stale.status, 8, stale.output);
  assert.match(stale.output, /stale/);
  assert.ok(stale.output.includes(p), 'the lock to remove is not named');
  await holdRepoLock(f, { pid: process.pid, host: 'another-host.example' });
  const foreign = runRem(f);
  assert.equal(foreign.status, 8, foreign.output);
  assert.doesNotMatch(foreign.output, /stale|remove/i, 'another host\'s lock was called stale or removable');
});

test('stage 2: the repository lock is released where the run lock is, and kept where the run lock is kept (AC6)', async (t) => {
  const done = fixture(t);
  runRem(done);
  assert.equal(fs.existsSync(await repoLockOf(done)), false, 'a normal end left the repository lock');
  const refused = fixture(t);
  fs.writeFileSync(path.join(refused.repo, 'src', 'a.js'), 'the operator\'s edit\n');
  runRem(refused);
  assert.equal(fs.existsSync(await repoLockOf(refused)), false, 'a refusal before the node left the repository lock');
  const kept = fixture(t);
  runRem(kept, ['--test-fail-after-node', 'die']);
  assert.ok(fs.existsSync(lockOf(kept)), 'the run lock is kept');
  assert.ok(fs.existsSync(await repoLockOf(kept)), 'the repository lock was released while the run lock is kept');
});

test('stage 2: linked worktrees of one repository share one lock', async (t) => {
  const f = fixture(t);
  const wt = path.join(f.repo, '..', 'wt');
  git(f.repo, 'worktree', 'add', '-q', '--detach', wt);
  const { repoLockPath } = await import('../scripts/io/repo-lock.mjs');
  assert.equal(repoLockPath(wt, { home: f.env.QUORATE_HOME }), repoLockPath(f.repo, { home: f.env.QUORATE_HOME }));
});

// A CLOCK THE NODE CAN READ (remediation-consumer-findings.plan.md stage 3, AC3; operator, 2026-10-20: "Elapsed time in each
// capture's header (Recommended)"). The brief told a remediation node "this session 30 minute(s)" and nothing measured,
// and two nodes reported running out of it at 6.8 and 8.9 minutes (20261020-104558, story-pipeline's 20261020-103911).
test('stage 3: the elapsed line is written from the node\'s start and cap, read back, and absent from an old header', async () => {
  const { elapsedLine, parseCaptureHeader } = await import('../scripts/lib/capture-header.mjs');
  const env = { QUORATE_NODE_STARTED_AT: '2026-10-20T10:00:00.000Z', QUORATE_NODE_TIMEOUT_MINUTES: '30' };
  assert.equal(elapsedLine(env, Date.parse('2026-10-20T10:06:48.000Z')), '# elapsed: 6.8 of 30 minute(s)');
  assert.equal(elapsedLine({}, Date.now()), '# elapsed: unknown (not inside a node)');
  const rule = '-'.repeat(72);
  const h = parseCaptureHeader(`$ x\n# exit: 1\n# elapsed: 6.8 of 30 minute(s)\n# captured: 2026-10-20T10:06:48.000Z\n${rule}\n`);
  assert.deepEqual(h.elapsed, { minutes: 6.8, cap: 30 });
  assert.equal('elapsed' in parseCaptureHeader(`$ x\n# exit: 1\n# captured: 2026-10-20T10:06:48.000Z\n${rule}\n`), false, 'an old header');
});

test('stage 3: the node gets its start and cap, a capture it runs shows them, and its brief says where to read them', (t) => {
  const f = e2eFixture(t);
  runRem(f, [], e2eEnv());
  const ev = path.join(remAt(f), 'evidence', 'remediation');
  const red = fs.readdirSync(ev).find((n) => /^red/.test(n));
  assert.ok(red, fs.readdirSync(ev).join(', '));
  assert.match(fs.readFileSync(path.join(ev, red), 'utf8'), /^# elapsed: \d+(\.\d)? of \d+ minute\(s\)$/m, 'the capture carries no elapsed line');
  const brief = fs.readFileSync(path.join(remAt(f), 'nodes', 'remediation-brief.md'), 'utf8');
  assert.match(brief, /# elapsed:/, 'the brief does not say where the node reads its elapsed time');
});

// THE NODE'S STOP REASON, CHECKED AGAINST ITS RECORD (remediation-consumer-findings.plan.md stage 4, AC1 and AC2). Two nodes
// wrote "the 30-minute limit was spent" for groups they never reached, at 6.8 and 8.9 minutes, `completed`
// (20261020-104558, story-pipeline's 20261020-103911); both operators were told it.
test('stage 4: the stop-reason truth table', async () => {
  const { stopReasonChecks } = await import('../scripts/lib/remediation-chain.mjs');
  const rec = { duration_ms: 409918, timeout_minutes: 30, terminal_reason: 'completed', subtype: 'success', total_cost_usd: 3.9 };
  const g = (o) => ({ group_id: 'G-1', disposition: 'not-fixed', ...o });
  const one = (o, r = rec, cap = null) => stopReasonChecks([g(o)], r, { budgetUsd: cap });
  assert.match(one({ stop_reason: 'limit', limit_kind: 'session-time' }).join(), /G-1: .*session-time.* 6\.8 of 30 minute/);
  assert.deepEqual(one({ stop_reason: 'limit', limit_kind: 'session-time' }, { ...rec, duration_ms: 30 * 60_000, terminal_reason: 'timeout' }), []);
  assert.match(one({ stop_reason: 'limit', limit_kind: 'turns' }).join(), /G-1: .*turns/);
  assert.deepEqual(one({ stop_reason: 'limit', limit_kind: 'turns' }, { ...rec, subtype: 'error_max_turns' }), []);
  assert.match(one({ stop_reason: 'limit', limit_kind: 'budget' }).join(), /G-1: .*budget.*uncapped/);
  assert.match(one({ stop_reason: 'limit', limit_kind: 'budget' }, rec, 10).join(), /G-1: .*budget/);
  assert.deepEqual(one({ stop_reason: 'limit', limit_kind: 'budget' }, { ...rec, total_cost_usd: 10 }, 10), []);
  assert.match(one({}).join(), /G-1: not-fixed with no stop_reason/);
  assert.match(one({ stop_reason: 'limit' }).join(), /G-1: .*no limit_kind/);
  assert.match(one({ stop_reason: 'blocked' }).join(), /G-1: .*no stop_cause/);
  assert.deepEqual(one({ stop_reason: 'blocked', stop_cause: 'the write was denied' }), []);
  assert.deepEqual(one({ stop_reason: 'not-attempted' }), []);
  assert.deepEqual(stopReasonChecks([{ group_id: 'G-2', disposition: 'fixed' }, { group_id: 'G-3', disposition: 'declined' }], rec, {}), [],
    'fixed and declined take no stop reason');
});

test('stage 4: a node claiming the session limit after 6.8 minutes, completed, is named in the report check', (t) => {
  const f = fixture(t);
  runRem(f, [], { FAKE_GROUP_EXTRA: JSON.stringify({ disposition: 'not-fixed', stop_reason: 'limit', limit_kind: 'session-time' }),
    FAKE_TERMINAL_REASON: 'completed' });
  const run = readRem(f);
  assert.ok((run.report_check ?? []).some((c) => /G-1: .*session-time/.test(c)), JSON.stringify(run.report_check));
});

test('stage 5: the tree-guard message is today\'s byte for byte unless the blocker is this run\'s own refused cluster', async () => {
  const { treeGuardMessage } = await import('../scripts/lib/remediation-chain.mjs');
  const guard = [{ path: 'tests/x.test.js', why: 'a test file changed outside the candidate' }];
  // Pinned from the runner before this change: it cannot fail before it, only after a wrong edit.
  assert.equal(treeGuardMessage(guard, new Map()), GUARD_TODAY);
  const owned = new Map([['tests/x.test.js', { id: 'c2', groups: ['G-2'] }]]);
  const m = treeGuardMessage(guard, owned);
  assert.ok(m.startsWith(GUARD_TODAY), 'the existing text changed');
  assert.match(m, /tests\/x\.test\.js is in cluster c2 \(G-2\), which this run refused because it changes no source file/);
  assert.match(m, /inspect it, then commit or discard it, then run --retry-commits/);
});

// REWRITTEN by remediation-cluster-order.plan.md stage 1: a test-only cluster refused as no fix blocked every other
// cluster (the tree guard saw its test changed outside the candidate), and the operator had to commit it and retry
// (20261106-184639-nbk-remediation, 20261106-193734-nbk-remediation-2). It is now set aside for the check and the
// commits, and written back after them.
test('stage 5: a test-only cluster refused as no fix is set aside, so the other commits on the first run, and its file comes back', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  fs.writeFileSync(path.join(f.reviewed, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [
    { group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }, { group_id: 'G-2', decision: 'confirmed', severity: 'MEDIUM' }] }));
  const head = headOf(f);
  const r = runRem(f, [], { FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'a better test of b\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js']) });
  assert.equal(git(f.repo, 'rev-list', '--count', `${head}..HEAD`).stdout.trim(), '1', r.output.slice(-800));
  const rem = readRem(f);
  assert.ok(!rem.commit_check.some((c) => c.kind === 'tree-not-candidate'), JSON.stringify(rem.commit_check));
  assert.ok(rem.commit_check.some((c) => c.kind === 'refused-cluster' && c.cluster === 'c2'), JSON.stringify(rem.commit_check));
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'b.test.js'), 'utf8'), 'a better test of b\n', 'the refused file is not back');
  assert.deepEqual(rem.set_aside.map((e) => [e.path, e.kind, e.restored]), [['tests/b.test.js', 'new', true]]);
  assert.ok(!fs.existsSync(path.join(remAt(f), ...rem.set_aside_dir.split('/'))), 'the copies were kept after every hash matched');
});

// run-dir-descendants.plan.md stage 2: the runner's own folder was built lexically (runnerPathIn) and written with a
// recursive mkdir, so a link at evidence/ below the run, even one resolving back inside it, carried the runner's logs,
// the moved-aside payload and the checked hashes wherever it led. Through the one owner, the link is refused.
test('run-dir-descendants stage 2: a link at evidence/remediation-runner resolving inside the run is refused, nothing written through it', (t) => {
  const f = fixture(t);
  const run = remAt(f);
  const inner = path.join(run, 'inner-runner');
  fs.mkdirSync(inner);
  fs.mkdirSync(path.join(run, 'evidence'), { recursive: true });
  fs.rmSync(path.join(run, 'evidence', 'remediation-runner'), { recursive: true, force: true });
  fs.symlinkSync(inner, path.join(run, 'evidence', 'remediation-runner'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = runRem(f);
  assert.notEqual(r.status, 0, `the runner wrote through the link:\n${r.output.slice(-800)}`);
  assert.match(r.output, /link or junction/, r.output.slice(-800));
  assert.deepEqual(fs.readdirSync(inner), [], 'nothing was created through the link');
});

// run-dir-descendants.plan.md stage 3 (G-20, G-1, G-21 of 20261024-122231-rdt-remediation-3-review): the reviewed run's
// finding groups, reconcile payload and record were read through the path the frame recorded at mint. A frame pointing
// at a directory no run may be in is refused before anything there is read, and nothing is spawned.
test('run-dir-descendants stage 3: a reviewed run the frame records outside every admitted place is refused unread', (t) => {
  const f = fixture(t);
  const fake = path.join(path.dirname(f.repo), 'counterfeit', 'V9');
  fs.mkdirSync(path.join(fake, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(fake, 'run.json'), JSON.stringify({ run_id: 'V9' }));
  fs.writeFileSync(path.join(fake, 'finding-groups.json'), JSON.stringify({ groups: [{ group_id: 'G-1' }] }));
  fs.writeFileSync(path.join(fake, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'HIGH' }] }));
  const rj = path.join(remAt(f), 'run.json');
  const run = JSON.parse(fs.readFileSync(rj, 'utf8'));
  run.remediation_frame = { ...run.remediation_frame, run_id: 'V9', run_dir: fake };
  fs.writeFileSync(rj, JSON.stringify(run));
  const r = runRem(f);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /a recorded path is not read unadmitted/, r.output.slice(-600));
  assert.equal(fs.existsSync(f.log), false, 'nothing was spawned');
});
