// The bench reads below a recreated worktree and a preserved run only through owners
// (usage-report-reviewed-runs.plan.md stage 4).
//
// G-3 and G-4 of 20261030-174958-ciss-c-remediation-review; G-2, G-3 and G-4 of 20261030-195117-ciss-remaining-
// remediation-review: `manifest.defect.file` (a corpus manifest's name, checked only as a nonempty string) and
// `targetHeader.file` (from preserved, model-written reconciler output) were joined onto the recreated worktree and read
// raw, so `..` or a link inside the tree read a file from elsewhere on the machine. Both now go through one reader,
// readInTree, an owner rooted at the worktree's real path, where `..` and a link are refused.
//
// And the preserved run's own root (G-5 of 20261029-235315-rdr-remediation-4-review), held here by what the bench does,
// a dry run that spends nothing: the source-text test that held it matched `lstatSync(c.runDir)` before the first
// `readRunRecord(c.runDir)` in the file, so a fix adding an earlier reader broke it while the check still stood.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { benchFixture, runBench } from './tools/bench-fixture.mjs';

const RESULT = '2026-09-24T00-04-14-249Z';
const SEED = 'clamp-silent-noop';
// THE ENGINE'S HOME IS THE FIXTURE'S (usage-report-followup.plan.md stage 1): without it the bench staged its copy under the
// operator's own ~/.quorate, and every suite run left a folder there.
const home = (fx) => ({ QUORATE_HOME: path.join(path.dirname(fx.fw), 'home') });
const dryRun = (fx) => runBench(fx, 'bench-second-opinion.mjs',
  ['--from', path.join(fx.fw, 'bench', 'results', `${RESULT}.json`), '--seed', SEED, '--dry-run'], home(fx));

test('G-5: a link or junction at the preserved run directory is refused before anything is read from it', (t) => {
  const fx = benchFixture(t);
  const outside = path.join(path.dirname(fx.fw), 'outside-run');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'run.json'), JSON.stringify({ run_id: 'outside', head_commit: 'abc' }));
  // A junction needs no privilege on Windows; elsewhere this is a directory symlink.
  fs.symlinkSync(outside, path.join(fx.fw, 'bench', 'results', `${RESULT}-${SEED}-run`), 'junction');
  const r = dryRun(fx);
  assert.match(r.output, /NOT RUN: run\.json refused — the preserved run directory is a link or junction/, r.output.slice(-800));
});

// G-2 and G-3 of 20261030-195117-ciss-remaining-remediation-review: --candidate read each preserved run's run.json raw to
// learn the setting in force, so a link at the run, or at run.json, supplied it from outside.
test('--candidate does not read the setting in force through a link at the preserved run', (t) => {
  const fx = benchFixture(t);
  const outside = path.join(path.dirname(fx.fw), 'outside-run');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'run.json'), JSON.stringify({ run_id: 'outside', head_commit: 'abc',
    contract: { review: { models: { judgment: 'OUTSIDE-MODEL' }, effort: { judgment: 'low' } } } }));
  fs.symlinkSync(outside, path.join(fx.fw, 'bench', 'results', `${RESULT}-${SEED}-run`), 'junction');
  const r = runBench(fx, 'bench-second-opinion.mjs',
    ['--from', path.join(fx.fw, 'bench', 'results', `${RESULT}.json`), '--seed', SEED, '--model', 'OUTSIDE-MODEL', '--dry-run'], home(fx));
  assert.doesNotMatch(r.output, /in force: OUTSIDE-MODEL/, `the setting was read through the link:\n${r.output.slice(-800)}`);
});

test('a manifest defect.file outside the recreated tree is refused, and nothing outside is read', (t) => {
  const fx = benchFixture(t, { gitRepo: true });
  // The seed's patch edits this test; the fixture tree must hold it for the worktree to be recreated.
  fs.mkdirSync(path.join(fx.fw, 'tests'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'tests', 'regression-caps.test.mjs'), path.join(fx.fw, 'tests', 'regression-caps.test.mjs'));
  const manifestPath = path.join(fx.fw, 'bench', 'corpus', SEED, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  // The worktree is made under the temporary directory, so `../<name>` names a file beside it, outside the tree, and the
  // file carries the seed's anchor, so a raw read would go on as though it were the seeded file.
  const name = `outside-defect-${process.pid}-${Date.now()}.mjs`;
  const outside = path.join(os.tmpdir(), name);
  fs.writeFileSync(outside, `${manifest.defect.anchor}\n`);
  t.after(() => fs.rmSync(outside, { force: true }));
  manifest.defect.file = `../${name}`;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fx.git('add', '-A');
  fx.git('commit', '-qm', 'the manifest names a file outside the tree');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: fx.fw, encoding: 'utf8' }).stdout.trim();
  const run = path.join(fx.fw, 'bench', 'results', `${RESULT}-${SEED}-run`);
  fs.mkdirSync(path.join(run, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: `${RESULT}-${SEED}-run`, head_commit: head, contract: { review: {} } }));
  const r = dryRun(fx);
  assert.match(r.output, /defect\.file .* is outside the recreated tree, or reached through a link; nothing is read/, r.output.slice(-800));
});

test('both reads below the recreated worktree go through readInTree', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-second-opinion.mjs'), 'utf8');
  assert.doesNotMatch(src, /path\.join\(wt, (manifest\.defect|targetHeader)\.file\)/, 'a name from a manifest or a model is joined onto the tree raw');
  assert.match(src, /readInTree\(wt, manifest\.defect\.file\)/);
  assert.match(src, /readInTree\(wt, targetHeader\.file\)/);
});
