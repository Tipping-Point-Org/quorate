// run-dir-descendants.plan.md stage 1 (design run-dir-descendants.design.md, D-D1 A, D-D2 A; operator, 2026-10-27:
// "Approved run-dir-descendants.plan.md"): admitRun admitted a run directory, and every path below it was composed per
// site, so each review found the neighbours of the sites the last remediation fixed (the round cap of
// 20261024-130245-rdt-remediation-4). One owner now builds every such path from safe single names, lstat'ing each
// level, refusing a link or junction at any level, creating exclusively.
//
// Links are planted as junctions on Windows (a file symlink needs a privilege this machine does not grant) and as
// symlinks elsewhere; a dangling one is made by removing its target.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confined, unsafeSegment } from '../scripts/io/confined-path.mjs';
import { freeEvidenceName } from '../scripts/io/atomic.mjs';

const KIND = process.platform === 'win32' ? 'junction' : 'dir';
function setup(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-confined-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const run = path.join(base, 'run');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(run);
  fs.mkdirSync(outside);
  return { base, run, outside, owner: confined(run) };
}
const refusedLink = (e) => e.code === 'ECONFINED' && /link or junction/.test(e.message);

test('stage 1: the happy path makes directories, creates, replaces and reads below the root', (t) => {
  const { run, owner } = setup(t);
  assert.equal(owner.dir(['evidence', 'code-audit']), path.join(run, 'evidence', 'code-audit'));
  owner.create(['evidence', 'code-audit', 'stdout.json'], '{"a":1}');
  assert.equal(owner.read(['evidence', 'code-audit', 'stdout.json']), '{"a":1}');
  owner.replace(['run.json'], '{"v":1}');
  owner.replace(['run.json'], '{"v":2}');
  assert.equal(fs.readFileSync(path.join(run, 'run.json'), 'utf8'), '{"v":2}');
  assert.deepEqual(fs.readdirSync(run).sort(), ['evidence', 'run.json'], 'no temporary file is left beside the replaced one');
});

test('stage 1: a link planted at each level is refused before anything is created at its target', (t) => {
  for (const depth of [1, 2]) {
    const { run, outside, owner } = setup(t);
    const levels = ['evidence', 'lens'].slice(0, depth);
    if (depth === 2) fs.mkdirSync(path.join(run, 'evidence'));
    fs.symlinkSync(outside, path.join(run, ...levels), KIND);
    for (const op of [() => owner.dir([...levels, 'x']), () => owner.create([...levels, 'f.txt'], 'x'),
      () => owner.replace([...levels, 'f.json'], '{}'), () => owner.read([...levels, 'f.txt'])]) {
      assert.throws(op, refusedLink, `a link at level ${depth} is refused`);
    }
    assert.deepEqual(fs.readdirSync(outside), [], `nothing was created through the link at level ${depth}`);
  }
});

test('stage 1: a link that resolves back inside the run is refused too (D-D2 A)', (t) => {
  const { run, owner } = setup(t);
  fs.mkdirSync(path.join(run, 'evidence', 'real'), { recursive: true });
  fs.symlinkSync(path.join(run, 'evidence', 'real'), path.join(run, 'evidence', 'lens'), KIND);
  assert.throws(() => owner.create(['evidence', 'lens', 'a.txt'], 'x'), refusedLink);
});

// G-10 of 20261102-184751-rbr-remediation-2-review: the owner did not check its own root, so every caller that named a
// root the operator gave (--replay-node, --rejudge) had to lstat it itself, and one (--rejudge, G-6) did not: a link at
// the root was followed. The owner now refuses a link or a non-directory at its root, before every operation.
test('G-10: a link or junction at the root itself, or a file there, is refused by every operation, nothing made at its target', (t) => {
  const { base, outside } = setup(t);
  fs.writeFileSync(path.join(outside, 'f.txt'), 'outside');
  const linked = path.join(base, 'linked-root');
  fs.symlinkSync(outside, linked, KIND);
  const owner = confined(linked);
  for (const op of [() => owner.dir(['x']), () => owner.create(['n.txt'], 'x'), () => owner.replace(['r.json'], '{}'),
    () => owner.read(['f.txt']), () => owner.exists(['f.txt']), () => owner.list([]), () => owner.stat(['f.txt']),
    () => owner.isFree(['f.txt']), () => owner.remove(['f.txt']), () => owner.resolve(['f.txt'])]) {
    assert.throws(op, refusedLink, `an operation through a linked root was not refused: ${op}`);
  }
  assert.deepEqual(fs.readdirSync(outside), ['f.txt'], 'something was made or removed through the linked root');
  const file = path.join(base, 'a-file');
  fs.writeFileSync(file, 'x');
  assert.throws(() => confined(file).list([]), (e) => e.code === 'ECONFINED' && /not a directory/.test(e.message));
  // A root not yet made is not a refusal: a read is ENOENT, as fs says it.
  assert.throws(() => confined(path.join(base, 'not-yet')).read(['a']), (e) => e.code === 'ENOENT');
});

test('stage 1: an exclusive create refuses an existing file and a dangling link', (t) => {
  const { run, base, owner } = setup(t);
  owner.create(['a.txt'], 'one');
  assert.throws(() => owner.create(['a.txt'], 'two'), (e) => e.code === 'ECONFINED' && /already taken/.test(e.message));
  assert.equal(fs.readFileSync(path.join(run, 'a.txt'), 'utf8'), 'one');
  const gone = path.join(base, 'gone');
  fs.mkdirSync(gone);
  fs.symlinkSync(gone, path.join(run, 'dangling'), KIND);
  fs.rmSync(gone, { recursive: true });
  assert.throws(() => owner.create(['dangling'], 'x'), refusedLink, 'a dangling link at the name is refused');
  assert.equal(fs.existsSync(gone), false, 'nothing was created at the dangling link\'s target');
});

test('stage 1: an unsafe segment is refused', (t) => {
  const { owner } = setup(t);
  for (const seg of ['', '.', '..', 'a/b', 'a\\b', 'a:b', 'a\0b']) {
    assert.ok(unsafeSegment(seg), `"${seg}" is unsafe`);
    assert.throws(() => owner.create([seg], 'x'), (e) => e.code === 'ECONFINED', `"${seg}" is refused`);
  }
  assert.throws(() => owner.create([], 'x'), (e) => e.code === 'ECONFINED');
  assert.equal(unsafeSegment('stdout.json'), null);
});

test('stage 1: the root must be absolute, and isFree treats a dangling link as taken', (t) => {
  assert.throws(() => confined('relative/run'), /absolute/);
  const { run, base, owner } = setup(t);
  assert.equal(owner.isFree(['new.json']), true);
  const gone = path.join(base, 'gone2');
  fs.mkdirSync(gone);
  fs.symlinkSync(gone, path.join(run, 'taken'), KIND);
  fs.rmSync(gone, { recursive: true });
  assert.equal(owner.isFree(['taken']), false);
});

test('stage 1: freeEvidenceName does not hand out a name a dangling link holds', (t) => {
  const { run, base, owner } = setup(t);
  const gone = path.join(base, 'gone3');
  fs.mkdirSync(gone);
  fs.symlinkSync(gone, path.join(run, 'stdout.json'), KIND);
  fs.rmSync(gone, { recursive: true });
  // Through the owner, the only form it takes (G-10 of 20261029-190658-rdr-delivery).
  assert.equal(freeEvidenceName({ owner, segments: [] }, 'stdout', '.json'), path.join(run, 'stdout.2.json'),
    'existsSync reads a dangling link as free, and the write would follow it');
});

test('stage 2: remove takes a file or, when asked, a directory, and refuses a link rather than removing it', (t) => {
  const { run, outside, owner } = setup(t);
  owner.create(['evidence', 'a', 'payload.json'], '{}');
  assert.equal(owner.remove(['evidence', 'a', 'payload.json']), true);
  assert.equal(owner.remove(['evidence', 'a', 'payload.json']), false, 'a missing name is nothing to remove');
  assert.equal(owner.remove(['nope', 'x.json']), false, 'a missing directory is nothing to remove');
  assert.throws(() => owner.remove(['evidence', 'a']), (e) => e.code === 'ECONFINED' && /recursive/.test(e.message));
  assert.equal(owner.remove(['evidence', 'a'], { recursive: true }), true);
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'x');
  fs.symlinkSync(outside, path.join(run, 'evidence', 'lnk'), KIND);
  assert.throws(() => owner.remove(['evidence', 'lnk'], { recursive: true }), refusedLink);
  assert.deepEqual(fs.readdirSync(outside), ['keep.txt'], 'nothing behind the link was removed');
});

// G-3 of 20261105-070121-crsf-remediation-2-review (panel-codex-contract): the stop record removed an emptied session
// folder with a raw rmdirSync, on a path resolved before its lock was taken, because the owner had no empty-only remove.
// It has one: a directory with something in it is left, and said so (ENOTEMPTY); a link is refused, never removed.
test('G-3: remove with empty removes an empty directory only, and refuses a link at it', (t) => {
  const { run, outside, owner } = setup(t);
  owner.dir(['sessions', 'a']);
  owner.create(['sessions', 'b', 'current.jsonl'], 'x\n');
  assert.equal(owner.remove(['sessions', 'a'], { empty: true }), true);
  assert.equal(fs.existsSync(path.join(run, 'sessions', 'a')), false, 'the empty folder was not removed');
  assert.throws(() => owner.remove(['sessions', 'b'], { empty: true }), (e) => e.code === 'ENOTEMPTY');
  assert.equal(fs.readFileSync(path.join(run, 'sessions', 'b', 'current.jsonl'), 'utf8'), 'x\n', 'a folder in use lost its record');
  assert.equal(owner.remove(['sessions', 'gone'], { empty: true }), false, 'a missing folder is nothing to remove');
  fs.symlinkSync(outside, path.join(run, 'sessions', 'lnk'), KIND);
  assert.throws(() => owner.remove(['sessions', 'lnk'], { empty: true }), refusedLink);
  assert.equal(fs.existsSync(outside), true, 'what the link led to was removed');
});

test('stage 2: rename moves a file to a free name, refusing a taken name and a link at either end', (t) => {
  const { run, outside, owner } = setup(t);
  owner.create(['queue.json'], 'bad');
  assert.equal(owner.rename(['queue.json'], ['queue.unreadable.json']), path.join(run, 'queue.unreadable.json'));
  owner.create(['queue.json'], 'bad again');
  assert.throws(() => owner.rename(['queue.json'], ['queue.unreadable.json']), (e) => e.code === 'ECONFINED' && /already taken/.test(e.message));
  fs.symlinkSync(outside, path.join(run, 'aside'), KIND);
  assert.throws(() => owner.rename(['queue.json'], ['aside', 'q.json']), refusedLink);
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing was moved through the link');
});

// keepBatchReport copied from `report_path`, a field read from a status file with no `..` check (io/run-artifacts.mjs).
test('stage 2: keepBatchReport keeps no report a status names outside the run or through a link', async (t) => {
  const { keepBatchReport } = await import('../scripts/io/run-artifacts.mjs');
  const { run, base, outside } = setup(t);
  fs.writeFileSync(path.join(base, 'secret.md'), 'not the run\'s\n');
  fs.mkdirSync(path.join(run, 'evidence'));
  const to = path.join(run, 'evidence', 'batch-1-report.md');
  keepBatchReport({ runDir: run, status: { report_path: '../secret.md', report_sha256: null }, to });
  assert.equal(fs.existsSync(to), false, 'a report named by `..` was copied into the run');
  fs.writeFileSync(path.join(outside, 'r.md'), 'through a link\n');
  fs.symlinkSync(outside, path.join(run, 'nodes'), KIND);
  keepBatchReport({ runDir: run, status: { report_path: 'nodes/r.md', report_sha256: null }, to });
  assert.equal(fs.existsSync(to), false, 'a report reached through a link was copied into the run');
});

// isFree lstat'ed the joined parent first, which follows a link at an earlier level: with a deeper directory missing it
// read ENOENT and answered free without the link ever being looked at (G-12 of 20261029-055946-rdd-remediation-review).
test('G-12: isFree refuses a link at an earlier level even when a deeper directory is missing', (t) => {
  const { run, outside, owner } = setup(t);
  fs.symlinkSync(outside, path.join(run, 'nodes'), KIND);
  assert.throws(() => owner.isFree(['nodes', 'missing', 'r.md']), refusedLink);
  assert.throws(() => owner.isFree(['nodes', 'r.md']), refusedLink);
});

// keepBatchReport swallowed ECONFINED and returned the refused report_path as though it had been kept (G-8 of
// 20261029-055946-rdd-remediation-review): the refusal is said, and the refused path is not handed on as the report.
test('G-8: keepBatchReport reports a refused report_path rather than returning it as kept', async (t) => {
  const { keepBatchReport } = await import('../scripts/io/run-artifacts.mjs');
  const { run, outside } = setup(t);
  fs.mkdirSync(path.join(run, 'evidence'));
  const to = path.join(run, 'evidence', 'batch-1-report.md');
  const out = keepBatchReport({ runDir: run, status: { report_path: '../secret.md', report_sha256: 'x' }, to });
  assert.equal(out.report_path, null, 'a refused report_path was returned as the kept report');
  assert.match(String(out.refused), /\.\./, 'the refusal is not said');
  fs.writeFileSync(path.join(outside, 'r.md'), 'through a link\n');
  fs.symlinkSync(outside, path.join(run, 'nodes'), KIND);
  const linked = keepBatchReport({ runDir: run, status: { report_path: 'nodes/r.md', report_sha256: 'y' }, to });
  assert.equal(linked.report_path, null);
  assert.match(String(linked.refused), /link or junction/);
});

// A report_path naming a missing file skipped the copy and still returned that path and hash as the kept report (G-8 of
// 20261029-065343-rdd-remediation-2-review): a report never preserved was recorded as retained.
test('G-8 (r2): keepBatchReport does not return a missing report as kept', async (t) => {
  const { keepBatchReport } = await import('../scripts/io/run-artifacts.mjs');
  const { run } = setup(t);
  fs.mkdirSync(path.join(run, 'evidence'));
  const to = path.join(run, 'evidence', 'batch-1-report.md');
  const out = keepBatchReport({ runDir: run, status: { report_path: 'nodes/gone.md', report_sha256: 'z' }, to });
  assert.equal(out.report_path, null, 'a missing report was returned as the kept report');
  assert.equal(out.report_sha256, null);
  assert.match(String(out.refused), /no such file|missing/, 'the missing report is not said');
  assert.equal(fs.existsSync(to), false);
});

// The exclusive create closed the descriptor before removing a failed write, so a close that threw skipped the remove and
// masked the write's error (G-9 of 20261029-055946-rdd-remediation-review).
test('G-9: a failed write is removed even when the close throws, and the write\'s own error is the one thrown', async (t) => {
  const { confined: pureConfined } = await import('../scripts/lib/confined-path.mjs');
  const { run } = setup(t);
  const io = { fs: { ...fs,
    writeFileSync: (fd, chunk) => { if (typeof fd === 'number') throw Object.assign(new Error('write failed'), { code: 'EIO' }); return fs.writeFileSync(fd, chunk); },
    closeSync: (fd) => { fs.closeSync(fd); throw Object.assign(new Error('close failed'), { code: 'EIO' }); } } };
  const owner = pureConfined({ root: run, io });
  assert.throws(() => owner.create(['a.txt'], 'x'), /write failed/);
  assert.equal(fs.existsSync(path.join(run, 'a.txt')), false, 'the partial file was left behind');
  const okWriteBadClose = pureConfined({ root: run, io: { fs: { ...fs, closeSync: io.fs.closeSync } } });
  assert.throws(() => okWriteBadClose.create(['b.txt'], 'x'), /close failed/);
  assert.equal(fs.existsSync(path.join(run, 'b.txt')), false, 'a file whose close failed was left behind');
});

// The owner, declared pure with the platform arriving as `io`, drew its temporary names from node:crypto's randomBytes
// (G-11 of 20261029-055946-rdd-remediation-review). The name is now the first free one in the checked directory.
test('G-11: the pure owner imports nothing host-bound, and a replace still leaves no temporary file', async (t) => {
  const src = fs.readFileSync(new URL('../scripts/lib/confined-path.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from 'node:crypto'/, 'the pure owner draws entropy from the host');
  const { run, owner } = setup(t);
  fs.writeFileSync(path.join(run, 'run.json.1.tmp'), 'a stale temporary file');
  owner.replace(['run.json'], '{"v":1}');
  owner.replace(['run.json'], '{"v":2}');
  assert.equal(fs.readFileSync(path.join(run, 'run.json'), 'utf8'), '{"v":2}');
  assert.deepEqual(fs.readdirSync(run).sort(), ['run.json', 'run.json.1.tmp'], 'a temporary file was left, or a stale one taken');
});

// replace searched <name>.<n>.tmp with no bound, one lstat per leftover, and nothing removes the leftovers (G-12 of
// 20261029-065343-rdd-remediation-2-review). It stops at a bound and refuses, as freeEvidenceName stops at 100.
test('G-12 (r2): replace refuses rather than probing temporary names without a bound', (t) => {
  const { run, owner } = setup(t);
  for (let n = 1; n <= 100; n++) fs.writeFileSync(path.join(run, `run.json.${n}.tmp`), '');
  assert.throws(() => owner.replace(['run.json'], '{}'), (e) => e.code === 'ECONFINED' && /temporary/.test(e.message),
    'replace probed past the bound');
  assert.equal(fs.existsSync(path.join(run, 'run.json')), false);
});

// The pre-flight cache restored a reused result into evidence/pre-flight with a recursive mkdir, a recursive remove and a
// copy, none of which looked at what stood at evidence/ (io/preflight-cache.mjs, through run-graph and run-checks).
test('stage 2: restorePreflightEvidence refuses a link at evidence/ and copies nothing through it', async (t) => {
  const { restorePreflightEvidence } = await import('../scripts/io/preflight-cache.mjs');
  const { preflightEvidenceDir } = await import('../scripts/lib/preflight-cache.mjs');
  const { run, base, outside } = setup(t);
  const reviews = path.join(base, 'reviews');
  const src = preflightEvidenceDir(reviews, 'a'.repeat(64));
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'test.log'), 'cached\n');
  fs.symlinkSync(outside, path.join(run, 'evidence'), KIND);
  assert.throws(() => restorePreflightEvidence(reviews, 'a'.repeat(64), confined(run)), refusedLink);
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing was copied through the link');
  fs.rmSync(path.join(run, 'evidence'));
  assert.equal(restorePreflightEvidence(reviews, 'a'.repeat(64), confined(run)), true);
  assert.equal(fs.readFileSync(path.join(run, 'evidence', 'pre-flight', 'test.log'), 'utf8'), 'cached\n');
});

// The restore removed evidence/pre-flight before the owner saw each cached name, so a name it refuses (`\` or `:` on
// POSIX) left the old evidence deleted and the new copy partial (G-7 of 20261029-065343-rdd-remediation-2-review). The
// walk's filesystem is faked here, since Windows cannot hold such a name.
test('G-7: restorePreflightEvidence refuses an unsafe cached name before it removes the old evidence', async (t) => {
  const { restorePreflightEvidence } = await import('../scripts/io/preflight-cache.mjs');
  const { preflightEvidenceDir } = await import('../scripts/lib/preflight-cache.mjs');
  const { run, base } = setup(t);
  const reviews = path.join(base, 'reviews');
  const src = preflightEvidenceDir(reviews, 'b'.repeat(64));
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.log'), 'cached\n');
  fs.mkdirSync(path.join(run, 'evidence', 'pre-flight'), { recursive: true });
  fs.writeFileSync(path.join(run, 'evidence', 'pre-flight', 'old.log'), 'old\n');
  const BAD = 'bad:name.log';
  const real = path.join(src, 'a.log');
  const cacheFs = { ...fs,
    readdirSync: (d, o) => { const out = fs.readdirSync(d, o); return d === src ? [...out, { name: BAD }] : out; },
    lstatSync: (p) => fs.lstatSync(p === path.join(src, BAD) ? real : p),
    readFileSync: (p, ...r) => fs.readFileSync(p === path.join(src, BAD) ? real : p, ...r) };
  assert.throws(() => restorePreflightEvidence(reviews, 'b'.repeat(64), confined(run), { cacheFs }), (e) => e.code === 'ECONFINED');
  assert.equal(fs.readFileSync(path.join(run, 'evidence', 'pre-flight', 'old.log'), 'utf8'), 'old\n',
    'the old evidence was removed before the cached names were checked');
});

// run-checks writes checks.json and run.json at the run's root by the owner's replace; a link planted at the name itself
// is refused, not renamed over.
test('stage 2: replace refuses a link standing at the file\'s own name', (t) => {
  const { run, outside, owner } = setup(t);
  fs.symlinkSync(outside, path.join(run, 'checks.json'), KIND);
  assert.throws(() => owner.replace(['checks.json'], '{}'), refusedLink);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.ok(fs.lstatSync(path.join(run, 'checks.json')).isSymbolicLink(), 'the link was left as it stood');
});

// run-dir-reads.plan.md stage 1 (design run-dir-reads.design.md, R-D2 A; operator, 2026-10-29: "Approve"): the read
// helpers and the status probes read below a run with raw fs, because the owner offered `read` and nothing to ask whether
// a name exists, to list a directory, or to stat a name. It gains `exists`, `list` and `stat`, each walking every level
// as `read` does. G-13 of 20261029-134336-rdd-remediation-3-review: no test made the FINAL name a link; these do, for
// all four read operations.
test('run-dir-reads stage 1: exists, list and stat answer below the root', (t) => {
  const { owner } = setup(t);
  owner.create(['nodes', 'a.status.json'], '{}');
  assert.equal(owner.exists(['nodes', 'a.status.json']), true);
  assert.equal(owner.exists(['nodes', 'b.status.json']), false, 'a missing name is false');
  assert.equal(owner.exists(['missing', 'b.status.json']), false, 'a missing directory level is false');
  assert.deepEqual(owner.list(['nodes']), ['a.status.json']);
  assert.deepEqual(owner.list([]).sort(), ['nodes'], 'the root itself can be listed');
  assert.deepEqual(owner.list(['nodes'], { withFileTypes: true }).map((d) => [d.name, d.isFile()]), [['a.status.json', true]]);
  assert.equal(owner.stat(['nodes', 'a.status.json']).isFile(), true);
  assert.equal(owner.stat(['nodes']).isDirectory(), true);
});

test('run-dir-reads stage 1: a missing name throws ENOENT from read, list and stat, at the leaf or a directory level', (t) => {
  const { owner } = setup(t);
  owner.dir(['nodes']);
  const enoent = (e) => e.code === 'ENOENT';
  for (const segs of [['nodes', 'gone.json'], ['gone', 'x.json']]) {
    assert.throws(() => owner.read(segs), enoent, `read ${segs.join('/')}`);
    assert.throws(() => owner.stat(segs), enoent, `stat ${segs.join('/')}`);
  }
  assert.throws(() => owner.list(['gone']), enoent);
  assert.throws(() => owner.list(['nodes', 'gone']), enoent);
});

test('run-dir-reads stage 1 (G-13): a link at each directory level and at the final name is refused by every read', (t) => {
  for (const depth of [1, 2]) {
    const { run, outside, owner } = setup(t);
    fs.writeFileSync(path.join(outside, 'f.json'), '{}');
    const levels = ['evidence', 'lens'].slice(0, depth);
    if (depth === 2) fs.mkdirSync(path.join(run, 'evidence'));
    fs.symlinkSync(outside, path.join(run, ...levels), KIND);
    for (const [name, op] of [['read', () => owner.read([...levels, 'f.json'])], ['exists', () => owner.exists([...levels, 'f.json'])],
      ['list', () => owner.list([...levels])], ['stat', () => owner.stat([...levels, 'f.json'])]]) {
      assert.throws(op, refusedLink, `${name}: a link at level ${depth} is refused`);
    }
  }
  // THE FINAL NAME: a junction (Windows) or symlink to a directory standing where a file or directory is asked for.
  const { run, outside, owner } = setup(t);
  fs.writeFileSync(path.join(outside, 'f.json'), '{}');
  fs.mkdirSync(path.join(run, 'nodes'));
  fs.symlinkSync(outside, path.join(run, 'nodes', 'leaf'), KIND);
  for (const [name, op] of [['read', () => owner.read(['nodes', 'leaf'])], ['exists', () => owner.exists(['nodes', 'leaf'])],
    ['list', () => owner.list(['nodes', 'leaf'])], ['stat', () => owner.stat(['nodes', 'leaf'])]]) {
    assert.throws(op, refusedLink, `${name}: a link at the final name is refused`);
  }
});

test('run-dir-reads stage 1 (G-6): the bound of 100 temporary names is one constant, which freeEvidenceName imports', () => {
  const lib = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'lib', 'confined-path.mjs'), 'utf8');
  const atomic = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'io', 'atomic.mjs'), 'utf8');
  assert.match(lib, /^export const TMP_MAX = 100;$/m);
  assert.match(atomic, /import \{[^}]*\bTMP_MAX\b[^}]*\} from '\.\.\/lib\/confined-path\.mjs'/);
  assert.doesNotMatch(atomic.slice(atomic.indexOf('export function freeEvidenceName')), /\b100\b/, 'freeEvidenceName restates 100');
});
