// THE REMEDIATION RUNNER, END TO END WITH A FAKE NODE, part 2 of 9: what the runner refuses or names: an archive
// refused, a graph node, the round cap, a link to the reviewed payload, a group never reported, a fix with no red or
// test, missing evidence. Split from regression-remediate-runner.test.mjs (split-slow-test-files.md); the fixture is
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

// G-12 of 20261015-220413-archive-fold-review: archiveStagedRun answers a refused or failed archive by returning the staged
// directory, and the runner minted the follow-up from it anyway — the follow-up then recorded the stale staged path.
test('G-12: an archive that is refused mints no follow-up, and says where the run is', (t) => {
  const f = fixture(t);
  const blocker = path.join(f.repo, '.claude', 'reviews', path.basename(f.rem));
  fs.mkdirSync(blocker, { recursive: true });   // archivePlan never archives over an existing directory
  const r = runRem(f);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /was not archived/);
  assert.ok(fs.existsSync(path.join(f.rem, 'run.json')), 'the run stays staged');
  const run = JSON.parse(fs.readFileSync(path.join(f.rem, 'run.json'), 'utf8'));
  assert.equal(run.followup_run_dir, undefined, `no follow-up minted: ${run.followup_run_dir}`);
  assert.equal(run.remediation_commits.length, 1, 'the commit is still recorded');
});

test('the runner refuses inside a graph node', (t) => {
  const f = fixture(t);
  const r = runScript('remediate.mjs', ['--run-dir', f.rem, '--runtime-bin', f.bin], { cwd: f.repo, env: { ...f.env, GRAPH_NODE_DEPTH: '1' } });
  assert.equal(r.status, 3, r.output);
  assert.match(r.output, /GRAPH_NODE_DEPTH/);
});

test('the remediation node contract refuses outside a remediation run and keeps the node from committing, spawning or reviewing', () => {
  const c = fs.readFileSync(path.join(SCRIPTS_DIR, '..', 'prompts', 'remediation', 'PROMPT.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(c, /Refuse if your brief does not name a remediation run/);
  assert.match(c, /You do not commit\*\*: you have no git grant/);
  assert.match(c, /Spawn anything: no node, no subagent, no review, no claim-check/);
  assert.match(c, /shared\/remediation\.md/, 'the rule it applies is the shared one');
});

// THE ROUND CAP, AT THE RUNNER (plan stage 4's fixture): three remediations in one chain, each of whose follow-up
// reviews confirmed a MEDIUM on a line that remediation's own commit wrote (git blame), so the fourth is refused and
// stamped, and nothing is spawned.
test('the runner stops at the round cap: three consecutive remediations whose own commits drew a MEDIUM', (t) => {
  const f = fixture(t);
  const write = (dir, obj) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(obj)); };
  // In the fixture repository's own archived run root: the runner reads each linked run through admitRun, which admits only
  // a run of the repository it runs for (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
  const home = path.join(f.repo, '.claude', 'reviews');
  // Three commits, each rewriting one line of src/a.js; commit k is "remediation k's" fix.
  const lines = ['l1', 'l2', 'l3'];
  const shas = [];
  for (let k = 0; k < 3; k++) {
    lines[k] = `fix ${k + 1}`;
    fs.writeFileSync(path.join(f.repo, 'src', 'a.js'), lines.join('\n') + '\n');
    git(f.repo, 'commit', '-qam', `remediation ${k + 1}`);
    shas.push(git(f.repo, 'rev-parse', 'HEAD').stdout.trim());
  }
  const head = shas[2];
  // V1 → R1 → V2 (follows R1, MEDIUM on line 1) → R2 → V3 (follows R2, line 2) → R3 → V4 (follows R3, line 3).
  const dir = (n) => path.join(home, n);
  write(dir('V1'), { run_id: 'V1' });
  for (let k = 1; k <= 3; k++) {
    write(dir(`R${k}`), { run_id: `R${k}`, remediates: `V${k}`, remediation_frame: { run_id: `V${k}`, run_dir: dir(`V${k}`) },
      remediation_commits: [shas[k - 1]] });
    const v = dir(`V${k + 1}`);
    write(v, { run_id: `V${k + 1}`, head_commit: head, follows_remediation: { run_id: `R${k}`, run_dir: dir(`R${k}`) } });
    fs.writeFileSync(path.join(v, 'finding-groups.json'), JSON.stringify({ groups: [{ group_id: 'G-1', file: 'src/a.js', line: k }] }));
    fs.mkdirSync(path.join(v, 'evidence', 'reconcile'), { recursive: true });
    fs.writeFileSync(path.join(v, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }] }));
  }
  // The fourth remediation works from V4: point the minted run's frame at it.
  const rj = path.join(remAt(f), 'run.json');
  const run = JSON.parse(fs.readFileSync(rj, 'utf8'));
  run.remediation_frame = { ...run.remediation_frame, run_id: 'V4', run_dir: dir('V4') };
  fs.writeFileSync(rj, JSON.stringify(run));
  const before = git(f.repo, 'rev-parse', 'HEAD').stdout.trim();
  const r = runScript('remediate.mjs', ['--run-dir', f.rem, '--runtime-bin', f.bin, '--no-verify-sandbox'],
    { cwd: f.repo, env: { ...f.env, FAKE_RUN_DIR: f.rem } });
  assert.equal(r.status, 4, r.output);
  assert.match(r.output, /round cap reached: 3 consecutive/);
  const after = JSON.parse(fs.readFileSync(rj, 'utf8'));
  assert.ok(after.stamps.includes('ROUND-CAP'));
  assert.equal(fs.existsSync(f.log), false, 'nothing was spawned');
  assert.equal(git(f.repo, 'rev-parse', 'HEAD').stdout.trim(), before, 'nothing was committed');
  // G-15 of the delivery review: the third remediation, whose own fix drew the third MEDIUM, is stamped too.
  // G-26 of the r2 review: with its own stamp, because it DID spawn and patch — ROUND-CAP means nothing was spawned.
  assert.ok((JSON.parse(fs.readFileSync(path.join(dir('R3'), 'run.json'), 'utf8')).stamps ?? []).includes('ROUND-CAP-REACHED'));
});

test('run-dir-reads stage 4: new-run mints no remediation from a reviewed run whose payload is reached through a link', (t) => {
  const f = fixture(t, { beforeRemediates: linkReconcileInside });
  assert.notEqual(f.mint.status, 0, `minted through the link:\n${f.mint.output.slice(-600)}`);
  assert.match(f.mint.output, /link or junction/, f.mint.output.slice(-600));
});

test('run-dir-reads stage 4: the runner does not read the reviewed payload through a link inside the reviewed run', (t) => {
  const f = fixture(t);
  linkReconcileInside(f.reviewed);
  runRem(f, [], { FAKE_MODE: 'empty' });
  assert.ok((readRem(f).report_check ?? []).some((c) => /reconcile payload could not be read/.test(c)),
    `the payload was read through the link: ${JSON.stringify(readRem(f).report_check)}`);
});

test('G-19: a confirmed group the node never reported is named, and the run is stamped', (t) => {
  const f = fixture(t);
  const r = runRem(f, [], { FAKE_MODE: 'empty' });
  const run = readRem(f);
  assert.ok((run.report_check ?? []).some((c) => /G-1: confirmed in the review, not reported/.test(c)), JSON.stringify(run.report_check) + r.output);
  assert.ok(run.stamps.includes('REPORT-CHECK'));
});

test('G-28: a fixed group with no red and no test in its commit is named, not silently passed', (t) => {
  const f = fixture(t);
  runRem(f, [], { FAKE_MODE: 'notest' });
  const run = readRem(f);
  assert.ok((run.commit_check ?? []).some((c) => /cluster c1 \(G-1\): committed without a test: every group in it declared no possible red/.test(c.message)), JSON.stringify(run.commit_check));
});

test('G-25: evidence a report cites that does not exist in the run is named', (t) => {
  const f = fixture(t);
  runRem(f, [], { FAKE_MODE: 'badevidence' });
  const run = readRem(f);
  assert.ok((run.report_check ?? []).some((c) => /G-1: red_evidence evidence\/remediation\/red\.txt is not a file/.test(c)), JSON.stringify(run.report_check));
  assert.ok(run.stamps.includes('REPORT-CHECK'));
});
