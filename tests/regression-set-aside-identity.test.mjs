// ONE READER SAYS WHAT IS AT A SET-ASIDE PATH (set-aside-identity.plan.md stages 1-2; design SI-D1 A, SI-D2 A). Five
// reviews of the set-aside (20261107-184037-co-delivery to -211411-co-remediation-4-review) each found a raw read that had
// not learned what another had: a mode, an ENOENT, a link. The last found a link to matching bytes read as restored and its
// copy deleted. Every read of a set-aside path now goes through pathState, on confined(repo), which refuses a link or a
// junction at any level; the write-back writes back every entry it may, then stops naming the rest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { REPO_ROOT } from './helpers.mjs';
import { READ } from './tools/read-census.mjs';
import diagnosticsChannel from 'node:diagnostics_channel';
import { git as fixtureGit, remAt, runRem, readRem, checkedFixture } from './remediate-runner-fixture.mjs';
import { pathState, setAsideRefused, SetAsideError, SET_ASIDE_CHANNELS } from '../scripts/io/set-aside.mjs';
import { setAsideFixture, realCapabilities } from './tools/set-aside-capabilities.mjs';

const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs'), 'utf8');
// THE SET-ASIDE MOVED, markers and all, to scripts/io/set-aside.mjs (runner-test-seam.plan.md stage 1): the source reads of
// its functions read that file; what stays in the runner (committedDiffers, captureStart) is still read from remediate.mjs.
const mod = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'set-aside.mjs'), 'utf8');
const section = () => {
  const a = mod.indexOf('// --- set-aside: begin');
  const b = mod.indexOf('// --- set-aside: end');
  assert.ok(a >= 0 && b > a, 'the set-aside markers are missing');
  return mod.slice(a, b);
};
// A declaration at the start of a line, exported or not: the module exports pathState, setAsideRefused and writeBackSetAside.
const fnAt = (s, name) => { const i = s.indexOf(`\nfunction ${name}(`); return i >= 0 ? i : s.indexOf(`\nexport function ${name}(`); };
const twoGroups = (f) => fs.writeFileSync(path.join(f.reviewed, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [
  { group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }, { group_id: 'G-2', decision: 'confirmed', severity: 'MEDIUM' }] }));

// The census as a function of the source text, so a test can show it refuses a moved declaration.
const censusOf = (text) => {
  const a = text.indexOf('// --- set-aside: begin');
  const b = text.indexOf('// --- set-aside: end');
  assert.ok(a >= 0 && b > a, 'the set-aside markers are missing');
  const s = text.slice(a, b);
  const hits = s.split('\n').filter((l) => !/^\s*\/\//.test(l) && READ.test(l));
  assert.deepEqual(hits, [], 'a raw read of a set-aside path, not pathState');
  // THE MOVED LIST (runner-test-seam.plan.md stage 1): setAsideFinisher stays in the runner with its atDie registration, so
  // it left this list; the module's other functions joined it.
  for (const fn of ['pathStat', 'pathState', 'headFacts', 'kindsOfPaths', 'setAsideRefused', 'copyOneAside', 'writeBackSetAside', 'writeCopyBack']) {
    assert.match(s, new RegExp(`\\n(?:export )?function ${fn}\\(`), `${fn} is declared outside the set-aside markers`);
  }
};

test('stage 1 census: between the set-aside markers no read of the read family, and every set-aside function is inside them', () => {
  censusOf(mod);
  for (const gone of ['sha256OfFile', 'lstatKind', 'kindOfPath(', 'modeOfFile']) {
    assert.ok(!src.includes(gone), `${gone} is still in remediate.mjs`);
    assert.ok(!mod.includes(gone), `${gone} is in scripts/io/set-aside.mjs`);
  }
});

// G-5 of 20261108-060730-si-remediation-6-review-b: the plan names pathStat beside pathState, and the census's list left it out.
test('G-5: the census refuses a source whose pathStat is declared outside the set-aside markers', () => {
  const end = '// --- set-aside: end';
  const moved = mod.replace('\nfunction pathStat(', '\nfunction pathStatInside(').replace(end, `${end}\nfunction pathStat(p) { return p; }`);
  assert.throws(() => censusOf(moved), /pathStat is declared outside the set-aside markers/);
});

// "stage 1 (G-6): the kinds come from one ls-tree and one hash-object --stdin-paths" matched kindsOfPaths's source. REPLACED
// (runner-test-seam.plan.md stage 4) by tests/regression-set-aside-behaviour.test.mjs "G-6: classifying three refused files
// starts one ls-tree …", which counts the calls on the module's `git` channel.

// The source half of this test (a failed ls-tree read as unreadable) is REPLACED by tests/regression-set-aside-behaviour.test.mjs
// "G-6 of 20261107-220617-si-delivery: a failed ls-tree reads every refused file as unreadable"; lib's parse stays here.
test('G-6 of 20261107-220617-si-delivery: lib parses an ls-tree in one pass, and its two readers agree', async () => {
  const chain = await import('../scripts/lib/remediation-chain.mjs');
  const m = chain.lsTreeEntries('100755 blob abc123\trun.sh\0' + '100644 blob def\tsub/a b.js\0');
  assert.deepEqual(m.get('run.sh'), { mode: '100755', type: 'blob', hash: 'abc123' });
  assert.deepEqual(m.get('sub/a b.js'), { mode: '100644', type: 'blob', hash: 'def' });
  assert.equal(m.size, 2);
  assert.equal(chain.lsTreeEntries('').size, 0);
  // The two readers agree: the single-path reader is the map's answer.
  assert.equal(chain.lsTreeEntry('100644 blob abc\tother\0', 'run.sh'), null);
});

const fnOf = (name, next) => {
  const s = section();
  const a = fnAt(s, name);
  const b = fnAt(s, next);
  assert.ok(a >= 0 && b > a, `${name} is not found before ${next} in scripts/io/set-aside.mjs`);
  return s.slice(a, b);
};

// pathState's own answers for a link and a missing parent are run, not read: "G-7: pathState, executed, …" below, on the real
// capabilities (runner-test-seam.plan.md stage 4 removed this test's source match of pathStat and pathState). What stays is
// the owner's tags, and the census that no reader of the owner matches its prose.
test('G-4 of 20261107-220617-si-delivery: pathState tells a link from a missing parent by the owner\'s refusal tag, not its English', async (t) => {
  const os = await import('node:os');
  const { confined } = await import('../scripts/io/confined-path.mjs');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-sai-refusal-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'root'));
  fs.mkdirSync(path.join(base, 'elsewhere'));
  fs.writeFileSync(path.join(base, 'root', 'f'), 'x');
  fs.symlinkSync(path.join(base, 'elsewhere'), path.join(base, 'root', 'j'), process.platform === 'win32' ? 'junction' : 'dir');
  const owner = confined(path.join(base, 'root'));
  assert.throws(() => owner.stat(['j', 'a']), (e) => e.code === 'ECONFINED' && e.refusal === 'link');
  assert.throws(() => owner.stat(['f', 'a']), (e) => e.code === 'ECONFINED' && e.refusal === 'not-a-directory');
  assert.throws(() => owner.create(['f'], 'y'), (e) => e.code === 'ECONFINED' && e.refusal === 'taken');
  // The same rule in the other readers of the frame's files: remediate.mjs's lock and the owner's own temporary name.
  const lib = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'confined-path.mjs'), 'utf8');
  for (const [name, text] of [['remediate.mjs', src], ['io/set-aside.mjs', mod], ['lib/confined-path.mjs', lib]]) {
    assert.doesNotMatch(text, /\/(already taken|a link or junction stands here|this is not a directory)\/\.test\(/, `${name} still reads the owner's prose`);
  }
});

test('G-7 of 20261107-220617-si-delivery: which clusters a set-aside considers is lib\'s one rule, read by setAsidePlan and the runner alike', async () => {
  const chain = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(typeof chain.setAsideCandidates, 'function');
  const clusters = [{ id: 'a', committable: true, accepted: ['x'] }, { id: 'b', committable: false, accepted: ['y', 'z'] },
    { id: 'c', committable: false, accepted: ['w'], refused: [{ path: 'v' }] }, { id: 'd', committable: false, accepted: [] }, null];
  assert.deepEqual(chain.setAsideCandidates(clusters), ['y', 'z']);
  assert.deepEqual(chain.setAsidePlan(clusters, new Map([['y', 'modified'], ['z', 'modified']])).aside.map((c) => c.id), ['b']);
  // That the module classifies by this rule is run, not read (runner-test-seam.plan.md stage 4): tests/regression-set-aside-
  // behaviour.test.mjs "G-7 of 20261107-220617-si-delivery: only the refused clusters' files are classified".
});

// "G-8, G-9 of 20261107-220617-si-delivery" matched the copy's and the put-back guard's source. REPLACED (runner-test-seam.plan.md
// stage 4) by tests/regression-set-aside-behaviour.test.mjs "G-8 of 20261107-220617-si-delivery: a file whose stat moved between
// classification and its copy is refused" (G-8), and held by tests/regression-set-aside-faults.test.mjs "the put-back guard: an
// edit made after the copy is still named as a change" (G-9).

test('G-2 of 20261107-220617-si-delivery: setAsideRestoreNeeded takes pathState results and setAsidePlan the kinds read from them, not path callbacks', async () => {
  const chain = await import('../scripts/lib/remediation-chain.mjs');
  const entries = [{ path: 'a', sha256: '1', mode: 0o644 }, { path: 'b', sha256: '2', mode: 0o644 }, { path: 'c', sha256: '3', mode: 0o755 },
    { path: 'l', sha256: '4', mode: 0o644 }];
  const states = new Map([['a', { kind: 'file', sha256: '1', mode: 0o644 }], ['b', { kind: 'absent' }],
    ['c', { kind: 'file', sha256: '3', mode: 0o644 }], ['l', { kind: 'link' }]]);
  assert.deepEqual(chain.setAsideRestoreNeeded(entries, states).map((e) => e.path), ['b', 'c', 'l']);
  assert.deepEqual(chain.setAsideRestoreNeeded([{ path: 'z', sha256: '9' }], new Map()).map((e) => e.path), ['z'], 'a path with no state is not restored');
  assert.throws(() => chain.setAsideRestoreNeeded(entries, (p) => p), /pathState results/);
  const plan = chain.setAsidePlan([{ id: 'k', committable: false, accepted: ['a', 'q'] }], new Map([['a', 'modified']]));
  assert.deepEqual(plan.kept, [{ id: 'k', why: 'q is a unreadable' }], 'a path with no kind is read as unreadable, by lib');
  assert.throws(() => chain.setAsidePlan([], () => 'modified'), /a Map/);
  // That the module passes them Maps is run, not read (runner-test-seam.plan.md stage 4): both throw a TypeError on anything
  // else, and every set-aside and write-back in tests/regression-set-aside-faults.test.mjs "the sweep" calls both.
});

test('stage 1: a refused cluster whose file sits below a junction is not set aside, and nothing is read or written through it', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const outside = path.join(path.dirname(f.repo), 'outside-dir');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'x.test.js'), 'outside the repository\n');
  const r = runRem(f, [], { FAKE_JUNCTION: JSON.stringify({ 'tests/sub': outside }), FAKE_SECOND_FILES: JSON.stringify(['tests/sub/x.test.js']) });
  const rem = readRem(f);
  assert.ok(!(rem.set_aside ?? []).some((e) => e.path.startsWith('tests/sub/')), `set aside through a junction:\n${r.output.slice(-800)}`);
  assert.equal(fs.readFileSync(path.join(outside, 'x.test.js'), 'utf8'), 'outside the repository\n', 'a file outside the repository was changed');
  assert.deepEqual(fs.readdirSync(outside), ['x.test.js'], 'something was written through the junction');
});

test('stage 1, SI-D2 A: a set-aside path replaced by a link is not read as restored; the run stops naming it, its copy kept', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const env = { FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'a better test of b\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js']) };
  const killed = runRem(f, ['--test-die-after-cluster', 'c1'], env);
  assert.notEqual(killed.status, 0, killed.output.slice(-800));
  const b = path.join(f.repo, 'tests', 'b.test.js');
  assert.ok(!fs.existsSync(b), 'the new file was not set aside');
  const outside = path.join(path.dirname(f.repo), 'link-target');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, b, process.platform === 'win32' ? 'junction' : 'dir');
  const again = runRem(f, ['--retry-commits']);
  assert.notEqual(again.status, 0, again.output.slice(-800));
  assert.match(again.output, /tests\/b\.test\.js \(it is now a link, so nothing was written through it\)/);
  assert.deepEqual(fs.readdirSync(outside), [], 'the write-back wrote through the link');
  const rem = readRem(f);
  assert.ok(fs.existsSync(path.join(remAt(f), ...rem.set_aside_dir.split('/'), 'manifest.json')), 'the copies were not kept');
  assert.deepEqual(rem.set_aside.map((e) => [e.path, e.restored]), [['tests/b.test.js', false]]);
});

// G-15 of 20261107-220617-si-delivery: the case I-7 names is a link to a FILE holding the saved bytes, which a reader that
// follows links hashes as restored. The test above links an empty directory, which no hash ever matches.
test('stage 1, SI-D2 A (G-15): a set-aside path replaced by a file link to the same bytes is not read as restored; its copy is kept', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const bytes = 'a better test of b\n';
  const env = { FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': bytes }), FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js']) };
  const killed = runRem(f, ['--test-die-after-cluster', 'c1'], env);
  assert.notEqual(killed.status, 0, killed.output.slice(-800));
  const b = path.join(f.repo, 'tests', 'b.test.js');
  assert.ok(!fs.existsSync(b), 'the new file was not set aside');
  const target = path.join(path.dirname(f.repo), 'same-bytes.js');
  fs.writeFileSync(target, bytes);
  try { fs.symlinkSync(target, b, 'file'); } catch (err) {
    // A file symlink needs a privilege Windows grants only in Developer Mode; Linux and macOS run this case.
    if (err.code === 'EPERM' && process.platform === 'win32') { t.skip('file symlinks need Developer Mode on Windows'); return; }
    throw err;
  }
  assert.ok(fs.lstatSync(b).isSymbolicLink(), 'the fixture did not make a link');
  const again = runRem(f, ['--retry-commits']);
  assert.notEqual(again.status, 0, again.output.slice(-800));
  assert.match(again.output, /tests\/b\.test\.js \(it is now a link, so nothing was written through it\)/);
  assert.ok(fs.lstatSync(b).isSymbolicLink(), 'the link was replaced or followed');
  assert.equal(fs.readFileSync(target, 'utf8'), bytes, 'the link target was changed');
  const rem = readRem(f);
  assert.deepEqual(rem.set_aside.map((e) => [e.path, e.restored]), [['tests/b.test.js', false]], 'a link to matching bytes was read as restored');
  const files = path.join(remAt(f), ...rem.set_aside_dir.split('/'), 'files');
  assert.deepEqual(fs.readdirSync(files), ['1'], 'the copy was deleted though nothing was written back');
});

// G-14 of 20261107-220617-si-delivery: the junction-parent test above refuses before the copy, so the restore check and the
// write-back never met a linked parent. Here the parent becomes a junction after the copy.
test('stage 1 (G-14): a set-aside path whose parent becomes a junction after the copy is not read as restored, and nothing is written through it', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const env = { FAKE_WRITE: JSON.stringify({ 'tests/sub/b.test.js': 'b, from the node\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/sub/b.test.js']) };
  const killed = runRem(f, ['--test-die-after-cluster', 'c1'], env);
  assert.notEqual(killed.status, 0, killed.output.slice(-800));
  const sub = path.join(f.repo, 'tests', 'sub');
  assert.ok(!fs.existsSync(path.join(sub, 'b.test.js')), 'the new file was not set aside');
  fs.rmSync(sub, { recursive: true, force: true });
  const outside = path.join(path.dirname(f.repo), 'parent-target');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, sub, process.platform === 'win32' ? 'junction' : 'dir');
  const again = runRem(f, ['--retry-commits']);
  assert.notEqual(again.status, 0, again.output.slice(-800));
  assert.match(again.output, /tests\/sub\/b\.test\.js \(it is now a link, so nothing was written through it\)/);
  assert.deepEqual(fs.readdirSync(outside), [], 'the write-back wrote through the linked parent');
  const rem = readRem(f);
  assert.deepEqual(rem.set_aside.map((e) => [e.path, e.restored]), [['tests/sub/b.test.js', false]], 'a path below a linked parent was read as restored');
  assert.ok(fs.existsSync(path.join(remAt(f), ...rem.set_aside_dir.split('/'), 'manifest.json')), 'the copies were not kept');
});

test('stage 2, SI-D2 A: of two set-aside files, the unchanged one is written back and its copy removed; the changed one is named, its copy kept', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const env = { FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'b, from the node\n', 'tests/c.test.js': 'c, from the node\n' }),
    FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js', 'tests/c.test.js']) };
  const killed = runRem(f, ['--test-die-after-cluster', 'c1'], env);
  assert.notEqual(killed.status, 0, killed.output.slice(-800));
  fs.writeFileSync(path.join(f.repo, 'tests', 'c.test.js'), 'an edit made meanwhile\n');
  const again = runRem(f, ['--retry-commits']);
  assert.notEqual(again.status, 0, again.output.slice(-800));
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'b.test.js'), 'utf8'), 'b, from the node\n', 'the unchanged entry was not written back');
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'c.test.js'), 'utf8'), 'an edit made meanwhile\n', 'the edit made meanwhile was overwritten');
  assert.match(again.output, /tests\/c\.test\.js \(it changed since it was set aside, so it was not overwritten\)/);
  const rem = readRem(f);
  assert.deepEqual(Object.fromEntries(rem.set_aside.map((e) => [e.path, e.restored])), { 'tests/b.test.js': true, 'tests/c.test.js': false });
  const files = path.join(remAt(f), ...rem.set_aside_dir.split('/'), 'files');
  assert.deepEqual(fs.readdirSync(files), ['2'], "only the changed entry's copy is kept");
});

// G-9, G-17 of 20261108-021347-si-remediation-2-review (the plan's "Decided during delivery", G-2): a set-aside path whose
// file has more than one link is set aside, written back, and named with its link count in the output and in run.json.
test('G-9: a set-aside file with two hard links is set aside and written back, its path and link count named in stdout and run.json', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const other = path.join(path.dirname(f.repo), 'other-name.js');
  const env = { FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'b, from the node\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js']),
    FAKE_HARDLINK: JSON.stringify({ 'tests/b.test.js': other }) };
  const killed = runRem(f, ['--test-die-after-cluster', 'c1'], env);
  assert.notEqual(killed.status, 0, killed.output.slice(-800));
  assert.ok(!fs.existsSync(path.join(f.repo, 'tests', 'b.test.js')), `the multi-link file was not set aside:\n${killed.output.slice(-800)}`);
  assert.match(killed.output, /tests\/b\.test\.js has 2 links/, 'the link count is not named in the output');
  const aside = readRem(f).set_aside;
  assert.deepEqual(aside.map((e) => [e.path, e.links]), [['tests/b.test.js', 2]], 'the run.json entry names no link count');
  const again = runRem(f, ['--retry-commits']);
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'b.test.js'), 'utf8'), 'b, from the node\n', `not written back:\n${again.output.slice(-800)}`);
  assert.equal(fs.readFileSync(other, 'utf8'), 'b, from the node\n', 'the other name was changed');
  assert.deepEqual(readRem(f).set_aside.map((e) => [e.path, e.links, e.restored]), [['tests/b.test.js', 2, true]]);
});

// G-7 of 20261108-021347-si-remediation-2-review: the run directory in the node's capture command goes through briefArg,
// which refuses a character double quotes do not neutralise, rather than raw inside double quotes.
test('G-7: the capture command given to the node quotes the run directory through briefArg', () => {
  const line = src.split('\n').find((l) => l.includes('const captureStart ='));
  assert.ok(line, 'captureStart is gone');
  // Through briefArg still, now caught into a diagnostic (G-5 of 20261108-032104-si-remediation-4-review).
  assert.match(line, /--run-dir \$\{runDirArg\}/);
  assert.match(src, /try \{ runDirArg = briefArg\(runDir\); \}/);
  assert.doesNotMatch(line, /"\$\{runDir\}"/, 'the run directory is still put raw inside double quotes');
});

// G-13 of 20261108-021347-si-remediation-2-review: a retry may overwrite only what a failed write left, mode included, so a
// chmod made since is not taken for the runner's state.
test('G-13: a failed write-back records its mode, and a retry overwrites only that hash at that mode', async () => {
  const chain = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(typeof chain.setAsideWrittenState, 'function', 'lib does not decode the mode a failed write left');
  const m = chain.setAsideWrittenState({ set_aside_dir: 'd', set_aside: [{ path: 'a', restored: false, written_sha256: 'h', written_mode: 0o644 },
    { path: 'b', restored: false, written_sha256: 'k' }, { path: 'c', restored: true }] });
  assert.deepEqual([...m], [['a', { sha256: 'h', mode: 0o644 }], ['b', { sha256: 'k', mode: null }]]);
  assert.deepEqual([...chain.setAsideWrittenBytes({ set_aside_dir: 'd', set_aside: [{ path: 'a', written_sha256: 'h', written_mode: 0o644 }] })], [['a', 'h']]);
  // The module's half (it records the mode and authorises on it) is run, not read (runner-test-seam.plan.md stage 4):
  // tests/regression-set-aside-behaviour.test.mjs "G-13: a retry overwrites only what a failed write-back left, at the mode it left".
});

// "G-14: a partial write-back removes the copy of every restored entry" (G-14 of 20261108-021347-si-remediation-2-review) and
// "G-12: a path holding a line break is kept out of the --stdin-paths batch" matched writeBackSetAside's and kindsOfPaths's
// source. REPLACED (runner-test-seam.plan.md stage 4) by the tests of the same names in tests/regression-set-aside-behaviour.test.mjs.

// G-8 of 20261108-021347-si-remediation-2-review: committedDiffers ran rev-parse per committed file, and ls-tree again per
// failed lookup; one ls-tree of HEAD for the cluster answers every file.
test('G-8: committedDiffers reads HEAD\'s entries with one ls-tree, not a git process per file', () => {
  const fn = src.slice(src.indexOf('\nfunction committedDiffers('), src.indexOf('\n// ------', src.indexOf('\nfunction committedDiffers(')));
  assert.equal((fn.match(/git\(/g) ?? []).length, 1, 'more than one git call in committedDiffers');
  assert.match(fn, /git\('ls-tree', '-z', 'HEAD', '--', \.\.\.files\.map\(\(p\) => `:\(literal\)\$\{p\}`\)\)/);
  assert.doesNotMatch(fn, /for \(const p of files\)[\s\S]*git\(/, 'a git call inside the per-file loop');
});

test('stage 1 (G-7): with every folder number below the bound taken, the set-aside dies naming the run directory, and nothing is put back', (t) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  for (const k of [1, 2]) {
    const d = path.join(remAt(f), 'evidence', 'remediation-runner', `set-aside-${k}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ entries: [] }));
  }
  const r = runRem(f, ['--test-first-free-max', '2'], { FAKE_WRITE: JSON.stringify({ 'tests/b.test.js': 'kept in the tree\n' }), FAKE_SECOND_FILES: JSON.stringify(['tests/b.test.js']) });
  assert.notEqual(r.status, 0, r.output.slice(-800));
  assert.match(r.output, /2 numbered names are already taken in the runner's folder of /);
  assert.ok(!fs.existsSync(path.join(remAt(f), 'evidence', 'remediation-runner', 'set-aside-3')), 'a third folder was made past the bound');
  assert.equal(fs.readFileSync(path.join(f.repo, 'tests', 'b.test.js'), 'utf8'), 'kept in the tree\n', 'the file was put back though nothing was set aside');
});

// "G-8 of 20261108-032104-si-remediation-4-review: HEAD's blob comes from the batched ls-tree" matched the source. REPLACED
// (runner-test-seam.plan.md stage 4) by tests/regression-set-aside-behaviour.test.mjs "G-6: classifying three refused files …",
// which finds no rev-parse on the `git` channel and HEAD's blob on every entry.

test('G-15 of 20261108-032104-si-remediation-4-review: what a refused or failed read means is lib\'s rule, called directly', async () => {
  const chain = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(typeof chain.pathReadFailure, 'function', 'the mapping is only grepped for in pathState\'s source');
  const tag = (code, refusal) => Object.assign(new Error('prose that must not matter'), { code, refusal });
  assert.deepEqual(chain.pathReadFailure(tag('ENOENT')), { kind: 'absent' });
  assert.deepEqual(chain.pathReadFailure(tag('ENOTDIR')), { kind: 'absent' });
  assert.deepEqual(chain.pathReadFailure(tag('ECONFINED', 'link')), { kind: 'link' });
  assert.deepEqual(chain.pathReadFailure(tag('ECONFINED', 'not-a-directory')), { kind: 'absent' });
  assert.deepEqual(chain.pathReadFailure(tag('ECONFINED', 'taken')), { kind: 'unreadable', why: 'ECONFINED' });
  assert.deepEqual(chain.pathReadFailure(tag('EACCES')), { kind: 'unreadable', why: 'EACCES' });
  // That pathStat answers through it is run, not read (runner-test-seam.plan.md stage 4): "G-7: pathState, executed, …" below,
  // whose missing parent and file-as-parent rows are absent and whose junction row is a link, and the put-back guard's
  // EINJECTED row in tests/regression-set-aside-faults.test.mjs (unreadable, its code named).
});

// G-8 of 20261108-060730-si-remediation-6-review-b: the I-11 test read the order of source fragments and made no edit. The
// edit is made between classification and copy, keeping the file's size and its timestamp, so only the second hash can see
// it: the mode, size and time check passes it. Made from a subscriber to the module's `classified` channel, which runs before
// the first copy (runner-test-seam.plan.md stage 2), where it was made by the runner's --test-edit-after-classify seam.
test('G-7 of 20261108-043341-si-remediation-5-review-b (I-11), G-8: a same-size, same-timestamp edit between classification and copy stops the set-aside with nothing put back', (t) => {
  const f = setAsideFixture(t, { committed: { 'src/a.js': 'a\n' }, working: { 'tests/b.js': 'b, from the node\n' } });
  const b = path.join(f.repo, 'tests', 'b.js');
  const seconds = 1700000000;   // whole seconds, so the edit can restore the timestamp exactly
  fs.utimesSync(b, seconds, seconds);
  const { caps, record } = realCapabilities(f);
  const edited = [];
  const edit = ({ files }) => {
    if (!files.includes('tests/b.js')) return;
    const bytes = fs.readFileSync(b);
    bytes[0] ^= 1;   // 'b' becomes 'c': one byte, the size kept
    fs.writeFileSync(b, bytes);
    fs.utimesSync(b, seconds, seconds);
    edited.push('tests/b.js');
  };
  diagnosticsChannel.subscribe(SET_ASIDE_CHANNELS.classified, edit);
  t.after(() => diagnosticsChannel.unsubscribe(SET_ASIDE_CHANNELS.classified, edit));
  let err = null;
  try { setAsideRefused(caps, [{ id: 'c2', committable: false, accepted: ['tests/b.js'] }], {}); } catch (e) { err = e; }
  assert.deepEqual(edited, ['tests/b.js'], 'the subscriber made no edit, so this tested nothing');
  assert.ok(err instanceof SetAsideError, `the set-aside did not refuse: ${err?.stack ?? 'it completed'}`);
  assert.match(err.message, /^tests\/b\.js changed after it was classified \([0-9a-f]+ then, [0-9a-f]+ after the copy\), so it was not set aside; nothing was put back$/);
  assert.equal(fs.readFileSync(b, 'utf8'), 'c, from the node\n', 'the edit made after classification was put back or lost');
  assert.equal(fs.statSync(b).mtimeMs, seconds * 1000, 'the edit moved the timestamp, so this did not test content identity');
  assert.deepEqual(record.set_aside, [], 'the run recorded entries for a set-aside that stopped');
  assert.ok(!fs.existsSync(path.join(f.runDir, ...record.set_aside_dir.split('/'), 'manifest.json')), 'a manifest was written, so a retry would write stale bytes back');
});

// G-7 of 20261108-060730-si-remediation-6-review-b: pathState itself never ran; the tests read its source and called its two
// parts apart. It is imported and run over the real capabilities (runner-test-seam.plan.md stage 2), where the runner's
// --test-path-states seam printed its answers; every row of that test is kept, and bytes_length is dropped, since stage 3
// makes pathState return no bytes.
const pathStates = (f, paths) => {
  const { caps } = realCapabilities(f);
  return Object.fromEntries(paths.map((p) => { const { bytes, ...s } = pathState(caps, p); return [p, s]; }));
};
test('G-7: pathState, executed, on a file, a missing path, a missing parent, a file as a parent, a directory, a link and a junction at a parent level', (t) => {
  const f = setAsideFixture(t, { committed: { 'src/a.js': 'a\n' } });
  const outside = path.join(f.base, 'matrix-outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'x.js'), 'outside\n');
  fs.symlinkSync(outside, path.join(f.repo, 'through'), process.platform === 'win32' ? 'junction' : 'dir');
  const paths = ['src/a.js', 'src/missing.js', 'gone/parent/x.js', 'src/a.js/below', 'src', 'through', 'through/x.js'];
  const s = pathStates(f, paths);
  const file = s['src/a.js'];
  assert.equal(file.kind, 'file');
  assert.equal(file.sha256, createHash('sha256').update('a\n').digest('hex'), 'not the hash of the bytes at the path');
  assert.equal(file.size, 2);
  assert.equal(file.links, 1);
  assert.ok(Number.isInteger(file.mode), 'no mode');
  for (const p of ['src/missing.js', 'gone/parent/x.js', 'src/a.js/below']) assert.deepEqual(s[p], { kind: 'absent' }, p);
  assert.deepEqual(s.src, { kind: 'directory' });
  assert.deepEqual(s.through, { kind: 'link' }, 'a link at the leaf');
  assert.deepEqual(s['through/x.js'], { kind: 'link' }, 'a junction at a parent level was followed');
  assert.equal(fs.readFileSync(path.join(outside, 'x.js'), 'utf8'), 'outside\n');
});

// G-13 of 20261108-065111-si-remediation-7-review: this row sat inside the test above, an EPERM swallowed and its assertion
// conditioned away, so a host that cannot make a file link reported a full pass. Its own test, with a visible skip.
test('G-13: pathState, executed, on a file link', (t) => {
  const f = setAsideFixture(t, { committed: { 'src/a.js': 'a\n' } });
  const target = path.join(f.base, 'matrix-target.js');
  fs.writeFileSync(target, 'outside\n');
  try { fs.symlinkSync(target, path.join(f.repo, 'src', 'link.js'), 'file'); } catch (err) {
    // A file symlink needs a privilege Windows grants only in Developer Mode; Linux and macOS run this case.
    if (err.code === 'EPERM' && process.platform === 'win32') { t.skip('file symlinks need Developer Mode on Windows'); return; }
    throw err;
  }
  assert.deepEqual(pathStates(f, ['src/link.js'])['src/link.js'], { kind: 'link' }, 'a file link was followed');
  assert.equal(fs.readFileSync(target, 'utf8'), 'outside\n');
});

// G-6, G-1 of 20261108-060730-si-remediation-6-review-b: the batching was counted in source text, and the restore checks started
// two git processes per entry. GIT_TRACE counts the real ones, git itself writing each process it starts, one file against three.
const gitCallsFor = (t, names) => {
  const f = checkedFixture(t, { test: 'node check.cjs' });
  twoGroups(f);
  const rel = names.map((n) => `tests/${n}.test.js`);
  for (const p of rel) fs.writeFileSync(path.join(f.repo, p), 'committed\n');
  fixtureGit(f.repo, 'add', '--', ...rel);
  fixtureGit(f.repo, 'commit', '-qm', 'the refused cluster\'s files, tracked');
  const trace = path.join(path.dirname(f.repo), 'git-trace.log');
  const r = runRem(f, [], { GIT_TRACE: trace, FAKE_SECOND_FILES: JSON.stringify(rel),
    FAKE_WRITE: JSON.stringify(Object.fromEntries(rel.map((p) => [p, `${p}, from the node\n`]))) });
  for (const p of rel) assert.equal(fs.readFileSync(path.join(f.repo, p), 'utf8'), `${p}, from the node\n`, `${p} was not written back:\n${r.output.slice(-800)}`);
  assert.deepEqual(readRem(f).set_aside.map((e) => [e.path, e.restored]), rel.map((p) => [p, true]), `not set aside and restored:\n${r.output.slice(-800)}`);
  return fs.readFileSync(trace, 'utf8').split(/\r?\n/).map((l) => l.match(/trace: built-in: git (.*)$/)?.[1]).filter(Boolean);
};
const countOf = (calls, re) => calls.filter((c) => re.test(c)).length;

test('G-6: classifying three files starts one ls-tree naming all three and one hash-object per batch, by git\'s own trace', (t) => {
  const calls = gitCallsFor(t, ['b', 'c', 'd']);
  const lists = calls.filter((c) => /^ls-tree\b/.test(c) && /tests\/[bcd]\.test\.js/.test(c));
  assert.equal(lists.length, 1, `not one ls-tree of the refused files:\n${lists.join('\n')}`);
  for (const n of ['b', 'c', 'd']) assert.ok(lists[0].includes(`tests/${n}.test.js`), `the one ls-tree does not name ${n}`);
  assert.deepEqual(calls.filter((c) => /^hash-object\b/.test(c) && !/--stdin-paths/.test(c)), [], 'a hash-object per file');
});

test('G-1: the restore checks are batched: three files start as many hash-object and diff --raw processes as one', (t) => {
  const one = gitCallsFor(t, ['b']);
  const three = gitCallsFor(t, ['b', 'c', 'd']);
  for (const re of [/^hash-object\b/, /^diff --raw\b/]) {
    assert.equal(countOf(three, re), countOf(one, re), `${re} grows with the files: ${countOf(one, re)} for one, ${countOf(three, re)} for three`);
    assert.ok(countOf(one, re) > 0, `${re} never ran, so this counted nothing`);
  }
});

test('G-1: lib reads which paths changed mode from one diff --raw -z of many', async () => {
  const chain = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(typeof chain.rawDiffModeChangedPaths, 'function');
  const out = ':100644 100755 abc 000 M\0run.sh\0' + ':100644 100644 def 000 M\0same mode.js\0' + ':100755 100644 fed 000 M\0sub/x y.sh\0';
  assert.deepEqual([...chain.rawDiffModeChangedPaths(out)], ['run.sh', 'sub/x y.sh']);
  assert.equal(chain.rawDiffModeChangedPaths('').size, 0);
});

// The memory bound itself (I-14: the states hold no bytes, each copy from its own read, the bytes do not accumulate, in the
// copy and in the write-back) is run, not read: tests/regression-set-aside-runtime.test.mjs (G-12 of
// 20261108-065111-si-remediation-7-review).

// "G-4 of 20261108-043341-si-remediation-5-review-b: pathState does not copy the Buffer its read already returned" matched the
// source. REPLACED (runner-test-seam.plan.md stage 4) by tests/regression-set-aside-behaviour.test.mjs "G-4 of
// 20261108-043341-si-remediation-5-review-b: withFileBytes hands the callback the Buffer its read returned".
