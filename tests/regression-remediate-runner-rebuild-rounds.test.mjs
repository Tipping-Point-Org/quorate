// THE REMEDIATION RUNNER, END TO END WITH A FAKE NODE, part 3 of 9: the remediate rebuild's delivery rounds r1-r3:
// --unsandboxed, a follow-up minted on rerun, an unreadable chain link, the operator's files before the node, test-only
// commits, missing green. Split from regression-remediate-runner.test.mjs (split-slow-test-files.md); the fixture is
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

test('G-24: --unsandboxed is forwarded and recorded on the run', (t) => {
  const f = fixture(t);
  const r = runRem(f, ['--unsandboxed']);
  assert.equal(r.status, 0, r.output);
  const run = readRem(f);
  assert.equal(run.unsandboxed, true);
  assert.ok(run.stamps.includes('UNSANDBOXED'));
  const st = JSON.parse(fs.readFileSync(path.join(remAt(f), 'nodes', 'remediation.status.json'), 'utf8'));
  assert.equal(st.sandboxed, false, 'the node actually ran without the sandbox');
});

test('G-21: a follow-up that was never minted is minted on a rerun, without spawning the node again', (t) => {
  const f = fixture(t);
  assert.equal(runRem(f).status, 0);
  const run = readRem(f);
  fs.rmSync(run.followup_run_dir, { recursive: true, force: true });
  delete run.followup_run_id; delete run.followup_run_dir;
  fs.writeFileSync(path.join(remAt(f), 'run.json'), JSON.stringify(run));
  const calls = fs.readFileSync(f.log, 'utf8');
  const r = runRem(f);
  assert.equal(r.status, 0, r.output);
  assert.equal(fs.readFileSync(f.log, 'utf8'), calls, 'the node was not spawned again');
  const again = readRem(f);
  assert.ok(again.followup_run_dir && fs.existsSync(path.join(again.followup_run_dir, 'run.json')));
  t.after(() => fs.rmSync(again.followup_run_dir, { recursive: true, force: true }));
});

test('G-13, G-1: a chain link that cannot be read stops the runner instead of resetting the count', (t) => {
  const f = fixture(t);
  const rv = path.join(f.reviewed, 'run.json');
  const reviewed = JSON.parse(fs.readFileSync(rv, 'utf8'));
  reviewed.follows_remediation = { run_id: 'gone', run_dir: path.join(path.dirname(f.repo), 'no-such-run') };
  fs.writeFileSync(rv, JSON.stringify(reviewed));
  const r = runRem(f);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /cannot establish the round count/);
  assert.ok(readRem(f).stamps.includes('CHAIN-UNKNOWN'));
  assert.equal(fs.existsSync(f.log), false, 'nothing was spawned');
});

// ------------------------------------------------- round 1's review, 20261008-221517-remediate-rebuild-r2
test('G-15 (r2): an untracked file the operator had before the remediation is recorded as changed', (t) => {
  const f = fixture(t);
  // Outside source, test and the check inputs, since such a file now refuses (remediation-verification stage 4, below).
  fs.mkdirSync(path.join(f.repo, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, 'notes', 'operator new file.txt'), 'mine\n');
  runRem(f);
  assert.ok(readRem(f).dirty_at_start.files.includes('notes/operator new file.txt'), JSON.stringify(readRem(f).dirty_at_start));
  assert.deepEqual(readRem(f).dirty_at_start.untracked, ['notes/operator new file.txt']);
});

// THE TREE GUARD BEFORE THE NODE (remediation-verification stage 4; operator, 2026-10-13: "Refuse; commit or stash first
// (Recommended)"). The runner checks its candidate in the working tree, so an operator's edit the checks would read, and
// no commit would carry, refuses before anything is spawned. Untracked or not, staged or not.
test('remediation-verification stage 4: an operator\'s source, test or tracked edit refuses before the node, and nothing is spawned', (t) => {
  for (const [rel, staged] of [['src/operator new file.js', false], ['tests/b.test.js', false], ['docs/note.md', true]]) {
    const f = fixture(t);
    fs.mkdirSync(path.dirname(path.join(f.repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(f.repo, rel), 'mine\n');
    if (staged) git(f.repo, 'add', rel);
    const r = runRem(f);
    assert.notEqual(r.status, 0, `${rel}: ${r.output}`);
    assert.match(r.output, /commit or stash them first/, rel);
    assert.ok(r.output.includes(rel), `${rel} is named: ${r.output}`);
    assert.equal(fs.existsSync(f.log), false, `${rel}: nothing was spawned`);
    assert.equal(fs.existsSync(path.join(remAt(f), 'remediate.lock')), false, `${rel}: the lock is released`);
  }
});

test('G-20 (r2): a commit with only a test in it does not pass as a fix', (t) => {
  const f = fixture(t);
  runRem(f, [], { FAKE_MODE: 'testonly' });
  assert.ok((readRem(f).commit_check ?? []).some((c) => /cluster c1 \(G-1\): .*its accepted files include no source_globs path/.test(c.message)), JSON.stringify(readRem(f).commit_check));
});

test('G-22 (r2): a fixed group with no green evidence is named', (t) => {
  const f = fixture(t);
  runRem(f, [], { FAKE_MODE: 'nogreen' });
  assert.ok((readRem(f).report_check ?? []).some((c) => /G-1: fixed with no green_evidence/.test(c)), JSON.stringify(readRem(f).report_check));
});

// G-11 of 20261014-000825-rv-delivery-remediation-2-review: a fixed group whose claim is not expressible as a test leaves
// red_evidence empty and has no green either; the evidence gate admits it ("passes as before"), and REPORT-CHECK named it
// all the same, so one group was committed and stamped defective at once.
test('G-11: a fixed group with no red and no green is not a report defect', (t) => {
  const f = fixture(t);
  const head = git(f.repo, 'rev-parse', 'HEAD').stdout.trim();
  runRem(f, [], { FAKE_MODE: 'notest-nogreen' });
  const run = readRem(f);
  assert.ok(!(run.report_check ?? []).some((c) => /no green_evidence/.test(c)), JSON.stringify(run.report_check));
  assert.notEqual(git(f.repo, 'rev-parse', 'HEAD').stdout.trim(), head, `committed: ${JSON.stringify(run.commit_check)}`);
});

test('G-12 (r2): a confirmed MEDIUM the chain cannot place in a file is unknown, and nothing is spawned', (t) => {
  const f = fixture(t);
  // Where this repository keeps its runs, so each is admitted and the chain is unknown for the reason this test names (the
  // MEDIUM's place), not because a run was refused (run-dir-descendants.plan.md stage 3 admits the reviewed run first).
  const home = path.join(f.repo, '.claude', 'reviews');
  const write = (d, obj) => { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'run.json'), JSON.stringify(obj)); };
  const v1 = path.join(home, 'V1');
  const r1 = path.join(home, 'R1');
  const v2 = path.join(home, 'V2');
  write(v1, { run_id: 'V1' });
  write(r1, { run_id: 'R1', remediates: 'V1', remediation_frame: { run_id: 'V1', run_dir: v1 }, remediation_commits: ['abc'] });
  write(v2, { run_id: 'V2', head_commit: 'HEAD', follows_remediation: { run_id: 'R1', run_dir: r1 } });
  fs.writeFileSync(path.join(v2, 'finding-groups.json'), JSON.stringify({ groups: [{ group_id: 'G-1' }] }));
  fs.mkdirSync(path.join(v2, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(v2, 'evidence', 'reconcile', 'payload.json'),
    JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }] }));
  const rj = path.join(remAt(f), 'run.json');
  const run = JSON.parse(fs.readFileSync(rj, 'utf8'));
  run.remediation_frame = { ...run.remediation_frame, run_id: 'V2', run_dir: v2 };
  fs.writeFileSync(rj, JSON.stringify(run));
  const r = runRem(f);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /cannot establish the round count/);
  // For the reason this test names: whether the MEDIUM is in R1's own fixes, not a run that could not be read or admitted.
  assert.match(r.output, /whether V2 found a MEDIUM in R1's own fixes cannot be established/, r.output.slice(-600));
  assert.equal(fs.existsSync(f.log), false, 'nothing was spawned');
});

// ------------------------------------------------- round 2's review, 20261008-223642-remediate-rebuild-r3
test('G-13 (r3): when the globs overlap, a test-only commit still does not pass as a fix (test_globs win)', (t) => {
  const f = fixture(t);
  // Widen source_globs to cover the tests too, as quorate's own `**/*.test.mjs` overlaps its sources.
  const rj = path.join(remAt(f), 'run.json');
  const run = JSON.parse(fs.readFileSync(rj, 'utf8'));
  run.contract.source_globs = ['src/**', 'tests/**'];
  fs.writeFileSync(rj, JSON.stringify(run));
  runRem(f, [], { FAKE_MODE: 'testonly' });
  assert.ok((readRem(f).commit_check ?? []).some((c) => /cluster c1 \(G-1\): .*its accepted files include no source_globs path/.test(c.message)), JSON.stringify(readRem(f).commit_check));
});

test('G-12 (r3): a partial disposition with a commit is commit-checked too', (t) => {
  const f = fixture(t);
  runRem(f, [], { FAKE_MODE: 'partialtestonly' });
  assert.ok((readRem(f).commit_check ?? []).some((c) => /cluster c1 \(G-1\): .*its accepted files include no source_globs path/.test(c.message)), JSON.stringify(readRem(f).commit_check));
});
