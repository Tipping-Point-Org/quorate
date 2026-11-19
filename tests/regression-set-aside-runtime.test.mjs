// THE SET-ASIDE, RUN RATHER THAN READ (G-8, G-9, G-11, G-12, G-13, G-6 of 20261108-065111-si-remediation-7-review). I-14 asks
// for a runtime test of the memory bound and I-16 admits source-shape reading only for the census, yet the bound was held by
// regexes over remediate.mjs. Here tests/tools/remediate-fs-probe.mjs, a preload, makes a removal fail as a locked file does,
// so the runner needs no further seam. The memory bound it also traced moved to tests/regression-set-aside-reads.test.mjs,
// over the imported module (runner-test-seam.plan.md stage 3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './helpers.mjs';
import { runRem, readRem, remAt, checkedFixture, e2eFixture, e2eEnv } from './remediate-runner-fixture.mjs';

const PROBE = path.join(REPO_ROOT, 'tests', 'tools', 'remediate-fs-probe.mjs');
const probeEnv = (extra) => ({ NODE_OPTIONS: `--import=${pathToFileURL(PROBE).href}`, ...extra });
const twoGroups = (f) => fs.writeFileSync(path.join(f.reviewed, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [
  { group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }, { group_id: 'G-2', decision: 'confirmed', severity: 'MEDIUM' }] }));

// ------------------------------------------------------------------------------------------------- I-14, the memory bound
// Its two tests here (six refused files traced through the preload, and the trace reading's own test) are removed
// (runner-test-seam.plan.md stage 3): tests/regression-set-aside-reads.test.mjs holds the read order, no overlap and the
// one-file bound over the imported module, each shown red on a mutation (a read during classification, a read nested in
// another, a callback that keeps every buffer) before these went.

// I-16 admits source-shape reading only for the census, and these three titles were the bound's whole test: they matched text.
test('G-12, G-11 (I-16): the memory bound is no longer held by tests that read remediate.mjs\'s source', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'tests', 'regression-set-aside-identity.test.mjs'), 'utf8');
  for (const title of ['G-11: the classifying states hold no bytes', 'classifying reads no file\\\'s bytes; each is read once',
    'G-2: the write-back holds one file\\\'s bytes at a time', 'G-10 of 20261107-220617-si-delivery: the write-back keeps no file bytes']) {
    assert.ok(!text.includes(title), `still a source-shape test of I-14: ${title}`);
  }
});

// ------------------------------------------------------------------------------------- I-11, a throw during the put-back
test('G-8 (I-11): a removal that throws during the put-back still writes every file back before the run exits, with a diagnostic rather than a stack', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const r = runRem(f, [], probeEnv({ PROBE_THROW_RM: 'tests/c.test.js', FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'b, from the node\n', 'tests/c.test.js': 'c, from the node\n' }),
    FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js', 'tests/c.test.js']) }));
  assert.notEqual(r.status, 0, r.output.slice(-800));
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'b.test.js'), 'utf8'), 'b, from the node\n', `the file already removed was left only in its copy:\n${r.output.slice(-1200)}`);
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'c.test.js'), 'utf8'), 'c, from the node\n');
  assert.match(r.output, /could not put tests\/c\.test\.js back to HEAD for the full check \(EBUSY\)/, r.output.slice(-1200));
  assert.doesNotMatch(r.output, /^\s+at .*(?:remediate|set-aside)\.mjs/m, 'the operator got a stack');   // the set-aside is scripts/io/set-aside.mjs
  const rem = readRem(f);
  assert.deepEqual(rem.set_aside.map((e) => [e.path, e.restored]), [['tests/b.test.js', true], ['tests/c.test.js', true]]);
  assert.ok(!fs.existsSync(path.join(remAt(f), ...rem.set_aside_dir.split('/'))), 'the copies were not removed once every file was back');
});

// --------------------------------------------------------------------------------------- the printed follow-up command
test('G-9: the printed follow-up command gives its script through printedArg, like the other paths on the line', (t) => {
  const f = e2eFixture(t);
  const r = runRem(f, [], e2eEnv());
  assert.equal(r.status, 0, r.output.slice(-800));
  assert.match(r.output, /^\s*node "[^"\r\n]*run-graph\.mjs" --run-dir "/m, `the run-graph path is raw on the printed line:\n${r.output.slice(-600)}`);
});

// ----------------------------------------------------------------------------------------------- the provisional seams
// G-6 (--test-edit-after-classify touched only a file being set aside) tested the seam itself; the seam is gone with
// --test-path-states (runner-test-seam.plan.md stage 2), and the runner refuses either flag as unknown.
test('runner-test-seam stage 2: --test-path-states and --test-edit-after-classify are refused as unknown flags', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  for (const flag of [['--test-path-states', '["src/a.js"]'], ['--test-edit-after-classify', 'tests/b.test.js']]) {
    const r = runRem(f, flag);
    assert.equal(r.status, 2, `${flag[0]}:\n${r.output.slice(-600)}`);
    assert.match(r.output, new RegExp(`remediate: .*${flag[0]}`), `${flag[0]} is not named in the refusal:\n${r.output.slice(-600)}`);
    assert.doesNotMatch(r.output, /test-path-states: /, 'the seam still printed states');
  }
});

// ---------------------------------------------------------------------------------------------- a matrix row that ran?
// G-13: on Windows without Developer Mode the file-link row of the pathState matrix never ran, and its test reported a full
// pass. Run for real, the row either reports a skip or ran; what a host can do decides which.
test('G-13: the pathState file-link row reports a skip where a file link cannot be made, never a silent pass', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-link-probe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'target'), 'x');
  let canLink = true;
  try { fs.symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'), 'file'); } catch (err) {
    if (err.code !== 'EPERM' || process.platform !== 'win32') throw err;
    canLink = false;
  }
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=pathState, executed', path.join('tests', 'regression-set-aside-identity.test.mjs')], { cwd: REPO_ROOT, env, encoding: 'utf8' });
  const count = (name) => Number(r.stdout.match(new RegExp(`(?:ℹ|#) ${name} (\\d+)`))?.[1] ?? NaN);
  assert.equal(r.status, 0, r.stdout.slice(-800));
  assert.equal(count('pass') + count('skipped'), 2, `the matrix and its file-link row are not two tests:\n${r.stdout.slice(-600)}`);
  assert.equal(count('skipped'), canLink ? 0 : 1, `canLink ${canLink}, but:\n${r.stdout.slice(-600)}`);
});
