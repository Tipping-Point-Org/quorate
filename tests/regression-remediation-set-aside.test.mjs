// A CLUSTER THE RUNNER REFUSES IS SET ASIDE, SO THE OTHERS COMMIT (remediation-cluster-order.plan.md stages 1-2; design
// CO-D1 A, CO-D2 A, CO-D3 A). Twice on 2026-11-06 (20261106-184639-nbk-remediation, 20261106-193734-nbk-remediation-2) a
// test-only cluster for a finding reported against a document was refused as no fix, its edit stayed in the tree, and the
// tree guard refused every committable cluster because a test file changed outside the candidate. The refused cluster's
// exact bytes are now copied under the run, its paths put back to HEAD for the check and the commits, and the bytes
// written back after them, each hash verified; a kill is recovered by the next invocation; a failed write-back stops.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git, remAt, runRem, readRem, checkedFixture, headOf } from './remediate-runner-fixture.mjs';
import { setAsidePlan, setAsideRestoreNeeded, COMMIT_CHECK_KINDS } from '../scripts/lib/remediation-chain.mjs';

const twoGroups = (f) => fs.writeFileSync(path.join(f.reviewed, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [
  { group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }, { group_id: 'G-2', decision: 'confirmed', severity: 'MEDIUM' }] }));

test('stage 1: a refused cluster that modifies a tracked file is set aside; the other commits, and its bytes come back exactly', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  fs.mkdirSync(path.join(f.repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, 'tests', 'old.test.js'), 'the old test\n');
  git(f.repo, 'add', 'tests/old.test.js');
  git(f.repo, 'commit', '-qm', 'a tracked test');
  const head = headOf(f);
  const bytes = 'a better old test\r\nwith a CRLF line\n';
  const r = runRem(f, [], { FAKE_WRITE: JSON.stringify({ 'tests/old.test.js': bytes }), FAKE_SECOND_FILES: JSON.stringify(['tests/old.test.js']) });
  assert.equal(git(f.repo, 'rev-list', '--count', `${head}..HEAD`).stdout.trim(), '1', JSON.stringify(readRem(f).commit_check.map((c) => [c.cluster, c.kind, c.message.slice(0, 160)])));
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'old.test.js'), 'utf8'), bytes, 'the bytes that came back differ');
  assert.deepEqual(readRem(f).set_aside.map((e) => [e.path, e.kind, e.restored]), [['tests/old.test.js', 'modified', true]]);
  assert.equal(git(f.repo, 'show', 'HEAD:tests/old.test.js').stdout, 'the old test\n', 'the refused edit was committed');
});

test('stage 1: a run killed after the set-aside is written back by the next invocation, and again changes nothing', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const env = { FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'a better test of b\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js']) };
  const killed = runRem(f, ['--test-die-after-cluster', 'c1'], env);
  assert.notEqual(killed.status, 0, killed.output.slice(-800));
  const b = path.join(f.repo, 'tests', 'b.test.js');
  assert.ok(!fs.existsSync(b), 'the set-aside new file was still in the tree while the commits ran');
  assert.deepEqual(readRem(f).set_aside.map((e) => e.restored), [false]);
  const again = runRem(f, ['--retry-commits']);
  assert.equal(fs.readFileSync(b, 'utf8'), 'a better test of b\n', again.output.slice(-800));
  assert.match(again.output, /wrote back the files a previous run set aside/);
  assert.deepEqual(readRem(f).set_aside.map((e) => e.restored), [true]);
  const third = runRem(f, ['--retry-commits']);
  assert.doesNotMatch(third.output, /wrote back/, 'a finished write-back ran again');
  assert.equal(fs.readFileSync(b, 'utf8'), 'a better test of b\n');
});

test('stage 2: a write-back that fails stops the run, names the file, keeps the copies, and the next run restores it', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const env = { FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'a better test of b\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js']) };
  const r = runRem(f, ['--test-fail-write-back'], env);
  assert.notEqual(r.status, 0, r.output.slice(-800));
  assert.match(r.output, /could not write back tests\/b\.test\.js/);
  // G-13: the one restoring command is printed, not only described.
  // The script's own path quoted too since G-9 of 20261108-043341-si-remediation-5-review-b.
  assert.match(r.output, /node "[^"]+\/remediate\.mjs" --repo-root "[^"]+" --run-dir "[^"]+" --retry-commits/, r.output.slice(-800));
  const rem = readRem(f);
  assert.ok(rem.commit_check.some((c) => c.kind === 'set-aside-unrestored'), JSON.stringify(rem.commit_check));
  assert.ok(rem.stamps.includes('COMMIT-CHECK'));
  assert.ok(fs.existsSync(path.join(remAt(f), ...rem.set_aside_dir.split('/'), 'manifest.json')), 'the copies were not kept');
  const again = runRem(f, ['--retry-commits']);
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'b.test.js'), 'utf8'), 'a better test of b\n', again.output.slice(-800));
});

// G-14 / G-6 of 20261107-184037-co-delivery: a kill while copying left a set-aside-<n> folder that run.json did not
// name, and the next set-aside reused <n>, hit EEXIST on the exclusive create, and crashed on every later run.
test('G-14: a set-aside folder a killed run left unrecorded does not wedge the next set-aside', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const orphan = path.join(remAt(f), 'evidence', 'remediation-runner', 'set-aside-1', 'files');
  fs.mkdirSync(orphan, { recursive: true });
  fs.writeFileSync(path.join(orphan, '1'), 'a partial copy\n');
  const head = headOf(f);
  const r = runRem(f, [], { FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'a better test of b\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js']) });
  assert.equal(git(f.repo, 'rev-list', '--count', `${head}..HEAD`).stdout.trim(), '1', r.output.slice(-800));
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'b.test.js'), 'utf8'), 'a better test of b\n');
  assert.ok(!fs.existsSync(path.join(remAt(f), 'evidence', 'remediation-runner', 'set-aside-1')), 'the orphan folder was left behind');
});

// The write-back a killed run leaves, with the run directory and the file it set aside.
const killedSetAside = (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const env = { FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'a better test of b\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js']) };
  const killed = runRem(f, ['--test-die-after-cluster', 'c1'], env);
  assert.notEqual(killed.status, 0, killed.output.slice(-800));
  const rem = readRem(f);
  return { f, b: path.join(f.repo, 'tests', 'b.test.js'), dir: path.join(remAt(f), ...rem.set_aside_dir.split('/')) };
};

// G-10: an unreadable manifest was taken for no manifest, and the only copies of edits already put back were deleted.
test('G-10: a corrupt manifest keeps the copies, stops the run and records set-aside-unrestored', (t) => {
  const { f, dir } = killedSetAside(t);
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{ not json');
  const again = runRem(f, ['--retry-commits']);
  assert.notEqual(again.status, 0, again.output.slice(-800));
  assert.ok(fs.existsSync(path.join(dir, 'files', '1')), 'the only copy of the set-aside edit was deleted');
  const rem = readRem(f);
  assert.ok(rem.set_aside, 'the record of the set-aside was cleared');
  assert.ok((rem.commit_check ?? []).some((c) => c.kind === 'set-aside-unrestored'), JSON.stringify(rem.commit_check));
  assert.ok(rem.stamps.includes('COMMIT-CHECK'));
});

// G-11: the write-back replaced whatever differed from the copy, so an edit made while it was set aside was lost.
test('G-11: an edit made at a set-aside path after it was put back is not overwritten by the write-back', (t) => {
  const { f, b, dir } = killedSetAside(t);
  fs.writeFileSync(b, 'the operator wrote this meanwhile\n');
  const again = runRem(f, ['--retry-commits']);
  assert.equal(fs.readFileSync(b, 'utf8'), 'the operator wrote this meanwhile\n', 'the write-back overwrote a newer edit');
  assert.notEqual(again.status, 0, again.output.slice(-800));
  assert.match(again.output, /could not write back tests\/b\.test\.js/);
  assert.ok(fs.existsSync(path.join(dir, 'files', '1')), 'the copy was not kept');
});

// G-7: each manifest entry names the HEAD blob its path was put back to (null for a new file).
test('G-7: every manifest entry names HEAD\'s blob', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  fs.mkdirSync(path.join(f.repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, 'tests', 'old.test.js'), 'the old test\n');
  git(f.repo, 'add', 'tests/old.test.js');
  git(f.repo, 'commit', '-qm', 'a tracked test');
  const blob = git(f.repo, 'rev-parse', 'HEAD:tests/old.test.js').stdout.trim();
  runRem(f, ['--test-die-after-cluster', 'c1'], { FAKE_WRITE: JSON.stringify({ 'tests/old.test.js': 'a better old test\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/old.test.js']) });
  const rem = readRem(f);
  const manifest = JSON.parse(fs.readFileSync(path.join(remAt(f), ...rem.set_aside_dir.split('/'), 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.entries.map((e) => [e.path, e.head_blob]), [['tests/old.test.js', blob]]);
  assert.deepEqual(rem.set_aside.map((e) => [e.path, e.head_blob]), [['tests/old.test.js', blob]]);
});

// G-8: the plan's run record is an array, `set_aside: [{ path, kind, sha256, restored }]` (I-5), not an object.
test('G-8: run.json records set_aside as the plan\'s array of per-path records', (t) => {
  const { f } = killedSetAside(t);
  const rem = readRem(f);
  assert.ok(Array.isArray(rem.set_aside), JSON.stringify(rem.set_aside));
  assert.deepEqual(rem.set_aside.map((e) => [e.path, e.kind, typeof e.sha256, e.restored]), [['tests/b.test.js', 'new', 'string', false]]);
  assert.equal(typeof rem.set_aside_dir, 'string');
});

test('stage 1: an edit outside every planned cluster still refuses the candidate (stage 4c unchanged)', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  const head = headOf(f);
  const r = runRem(f, [], { FAKE_WRITE: JSON.stringify({ 'tests/stray.test.js': 'not reported\n' }) });
  assert.equal(headOf(f), head, r.output.slice(-800));
  assert.ok(readRem(f).commit_check.some((c) => c.kind === 'tree-not-candidate'), JSON.stringify(readRem(f).commit_check));
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'stray.test.js'), 'utf8'), 'not reported\n');
});

// G-19: the deletion case through the fixture and the runner's own kindOfPath, not synthetic kinds handed to setAsidePlan.
test('G-19: a refused cluster that deletes a tracked file is not set aside, the deletion stays, and the record says why', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  fs.mkdirSync(path.join(f.repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, 'tests', 'old.test.js'), 'the old test\n');
  git(f.repo, 'add', 'tests/old.test.js');
  git(f.repo, 'commit', '-qm', 'a tracked test');
  const r = runRem(f, [], { FAKE_RM: JSON.stringify(['tests/old.test.js']), FAKE_SECOND_FILES: JSON.stringify(['tests/old.test.js']) });
  const rem = readRem(f);
  const kept = (rem.commit_check ?? []).filter((c) => c.kind === 'set-aside-kept');
  assert.equal(kept.length, 1, JSON.stringify(rem.commit_check) + r.output.slice(-600));
  assert.match(kept[0].message, /tests\/old\.test\.js is a deleted/);
  assert.ok(!rem.set_aside?.length, JSON.stringify(rem.set_aside));
  assert.ok(!fs.existsSync(path.join(f.repo, 'tests', 'old.test.js')), 'the deletion was undone');
});

test('stage 1: setAsidePlan sets aside only a refused cluster of modified or new regular files, and says why it keeps the rest', () => {
  const kinds = new Map(Object.entries({ 'a.js': 'modified', 'b.js': 'new', 'l.js': 'link', 'd.js': 'deleted', 'm.js': 'mode-only', 'x/': 'directory' }));
  const { aside, kept } = setAsidePlan([
    { id: 'c1', committable: true, accepted: ['a.js'], refused: [] },
    { id: 'c2', committable: false, accepted: ['a.js', 'b.js'], refused: [] },
    { id: 'c3', committable: false, accepted: ['l.js'], refused: [] },
    { id: 'c4', committable: false, accepted: ['d.js'], refused: [] },
    { id: 'c5', committable: false, accepted: ['m.js'], refused: [] },
    { id: 'c6', committable: false, accepted: ['b.js'], refused: [{ path: 'n/', reason: 'a nested repository' }] },
    { id: 'c7', committable: false, accepted: [], refused: [] },
  ], kinds);   // a Map, read through pathState (G-2 of 20261107-220617-si-delivery)
  assert.deepEqual(aside, [{ id: 'c2', files: [{ path: 'a.js', kind: 'modified' }, { path: 'b.js', kind: 'new' }] }]);
  assert.deepEqual(kept.map((k) => k.id), ['c3', 'c4', 'c5', 'c6']);
  assert.match(kept[0].why, /l\.js is a link/);
  assert.match(kept[1].why, /d\.js is a deleted/);
  assert.match(kept[2].why, /m\.js is a mode-only change/);
  assert.match(kept[3].why, /a file of it was refused \(n\/\)/);
});

test('stage 1: setAsideRestoreNeeded finds only the entries whose bytes differ, so a finished write-back finds none', () => {
  const entries = [{ path: 'a', sha256: '1' }, { path: 'b', sha256: '2' }];
  // pathState results, one per path (G-2 of 20261107-220617-si-delivery).
  assert.deepEqual(setAsideRestoreNeeded(entries, new Map([['a', { kind: 'file', sha256: '1' }], ['b', { kind: 'absent' }]])).map((e) => e.path), ['b']);
  assert.deepEqual(setAsideRestoreNeeded(entries, new Map([['a', { kind: 'file', sha256: '1' }], ['b', { kind: 'file', sha256: '2' }]])), []);
});

test('stage 2: the two set-aside kinds are commit-check kinds; only the unrestored one stamps', () => {
  assert.deepEqual(COMMIT_CHECK_KINDS['set-aside-unrestored'], { stamps: true, cluster: false });
  assert.deepEqual(COMMIT_CHECK_KINDS['set-aside-kept'], { stamps: false, cluster: true });
});

// G-4 of 20261107-191838-co-remediation-review: a write-back whose hash check failed left bytes that match neither HEAD
// nor the copy, so the printed --retry-commits refused them as "changed since it was set aside" and never recovered them.
test('G-4: a write-back whose hash differs after writing is written back by the retry command it prints', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const env = { FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'a better test of b\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js']) };
  const r = runRem(f, ['--test-mismatch-write-back'], env);
  assert.notEqual(r.status, 0, r.output.slice(-800));
  assert.match(r.output, /could not write back tests\/b\.test\.js \(its hash differs after writing\)/, r.output.slice(-800));
  const again = runRem(f, ['--retry-commits']);
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'b.test.js'), 'utf8'), 'a better test of b\n', again.output.slice(-800));
  assert.deepEqual(readRem(f).set_aside.map((e) => e.restored), [true]);
});

// G-3 of 20261107-191838-co-remediation-review: atHead compared the blob only, so a chmod made at a set-aside path after
// it was put back passed, and the write-back's replace discarded it. POSIX only: win32 has no executable bit to change.
test('G-3: a mode change made at a set-aside path after it was put back is not overwritten by the write-back', { skip: process.platform === 'win32' && 'win32 has no executable bit' }, (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  fs.mkdirSync(path.join(f.repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, 'tests', 'old.test.js'), 'the old test\n');
  git(f.repo, 'add', 'tests/old.test.js');
  git(f.repo, 'commit', '-qm', 'a tracked test');
  const env = { FAKE_WRITE: JSON.stringify({ 'tests/old.test.js': 'a better old test\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/old.test.js']) };
  const killed = runRem(f, ['--test-die-after-cluster', 'c1'], env);
  assert.notEqual(killed.status, 0, killed.output.slice(-800));
  const p = path.join(f.repo, 'tests', 'old.test.js');
  assert.equal(fs.readFileSync(p, 'utf8'), 'the old test\n', 'the set-aside path was not put back to HEAD');
  fs.chmodSync(p, 0o755);
  const again = runRem(f, ['--retry-commits']);
  assert.match(again.output, /changed since it was set aside/, again.output.slice(-800));
  assert.equal(fs.statSync(p).mode & 0o111, 0o111, 'the mode change was overwritten');
});

// G-5, through the runner: a run killed under 85f45c55 recorded set_aside: { dir, entries }; the next invocation writes it back.
test('G-5: a set-aside recorded in the 85f45c55 shape by a killed run is written back by the next invocation', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const env = { FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'a better test of b\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js']) };
  const killed = runRem(f, ['--test-die-after-cluster', 'c1'], env);
  assert.notEqual(killed.status, 0, killed.output.slice(-800));
  const runJson = path.join(remAt(f), 'run.json');
  const rec = JSON.parse(fs.readFileSync(runJson, 'utf8'));
  rec.set_aside = { dir: rec.set_aside_dir, entries: rec.set_aside };
  delete rec.set_aside_dir;
  fs.writeFileSync(runJson, JSON.stringify(rec, null, 2));
  const again = runRem(f, ['--retry-commits']);
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'b.test.js'), 'utf8'), 'a better test of b\n', again.output.slice(-800));
  assert.match(again.output, /wrote back the files a previous run set aside/);
});

// G-5 of 20261107-191838-co-remediation-review: the recovery guard read only the set_aside_dir + array record, so a run
// killed under 85f45c55, which wrote set_aside: { dir, entries }, was skipped and its set-aside edits stayed under evidence/.
test('G-5: setAsideRecovery finds a pending set-aside in the current record AND the earlier { dir, entries } record', async () => {
  const lib = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(typeof lib.setAsideRecovery, 'function', 'setAsideRecovery is the one reader of a set-aside record');
  const { setAsideRecovery } = lib;
  const dir = 'evidence/remediation-runner/set-aside-1';
  assert.deepEqual(setAsideRecovery({ set_aside_dir: dir, set_aside: [{ path: 'a', restored: true }, { path: 'b', restored: false }] }), { dir, paths: ['b'] }, 'only what this pass still has to write back (G-4 of 20261108-234028)');
  assert.deepEqual(setAsideRecovery({ set_aside_dir: dir, set_aside: [] }), { dir, paths: [] }, 'a kill while copying');
  assert.equal(setAsideRecovery({ set_aside_dir: dir, set_aside: [{ path: 'a', restored: true }] }), null, 'finished');
  assert.deepEqual(setAsideRecovery({ set_aside: { dir, entries: [{ path: 'a', restored: false }] } }), { dir, paths: ['a'] }, 'the 85f45c55 record');
  assert.equal(setAsideRecovery({ set_aside: { dir, entries: [{ path: 'a', restored: true }] } }), null, 'a finished 85f45c55 record');
  assert.equal(setAsideRecovery({ set_aside: null, set_aside_dir: null }), null);
  assert.equal(setAsideRecovery({}), null);
});
