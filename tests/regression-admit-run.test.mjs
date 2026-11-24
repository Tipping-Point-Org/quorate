// regression-admit-run.test.mjs — run-dir-trust.plan.md stage 1 (design R-D2 A; G-12 of
// 20261022-230755-ciss-d1-4-remediation-review).
//
// Each entry script composed its own subset of the checks on a run directory a caller names, and remediate.mjs acted on
// the repo_root its run.json named after a containment check alone. admitRun is the one owner: every check, in order,
// and the repository it returns is the caller's, never the record's. Each test below is one way a counterfeit run is
// refused, with the check named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { admitRun, defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const io = hostPlatform();
const PROJECT = 'admit-test';

function world(t) {
  // NATIVE, as admitRun's is: the JS realpath keeps an 8.3 short name (a Windows runner's TEMP, C:\Users\RUNNER~1), so
  // the expected paths below were spelled short and the admitted ones long (CI run 43281517496).
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-admit-run-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const home = path.join(base, 'home');
  const repo = path.join(base, 'repo');
  const other = path.join(base, 'other');
  for (const d of [home, repo, other]) fs.mkdirSync(d, { recursive: true });
  const staged = (r = repo) => defaultReviewsRoot({ project: PROJECT, repoRoot: r, home });
  const put = (root, runId, record) => {
    const dir = path.join(root, runId);
    fs.mkdirSync(dir, { recursive: true });
    if (record !== undefined) fs.writeFileSync(path.join(dir, 'run.json'), typeof record === 'string' ? record : JSON.stringify(record));
    return dir;
  };
  const admit = (runDir, extra = {}) => admitRun({ runDir, repoRoot: repo, home, project: PROJECT, io, ...extra });
  return { base, home, repo, other, staged, put, admit };
}

const ID = '20260101-000000-run';

test('a run staged for this repository is admitted, and the repository returned is the caller\'s', (t) => {
  const w = world(t);
  const dir = w.put(w.staged(), ID, { run_id: ID, repo_root: w.repo });
  const r = w.admit(dir);
  assert.equal(r.ok, true, r.why);
  assert.equal(r.dir, fs.realpathSync.native(dir));
  assert.equal(r.repoRoot, fs.realpathSync.native(w.repo));
  assert.equal(r.record.run_id, ID);
});

// G-5 of 20261124-140633-gsw-remediation-review-b: run.json was read and parsed whole before its identity was checked, so
// a syntactically valid record of any size reached every entry point's allocation. It is refused above a bound (8 MiB).
// "BEFORE IT IS READ" IS OBSERVED, not implied (G-10 of 20261124-160743-gsw-remediation-2-review-b): the refusal alone
// passed for an admitRun that read and parsed the whole record first and checked its size after. The platform's
// readFileSync is watched, and the oversized record must never reach it.
test('a run.json larger than the bound is refused by its record, before it is read', (t) => {
  const w = world(t);
  const record = JSON.stringify({ run_id: ID, repo_root: w.repo, pad: 'x'.repeat(9 * 1024 * 1024) });
  const dir = w.put(w.staged(), ID, record);
  const reads = [];
  const watchedFs = Object.create(io.fs);
  Object.defineProperty(watchedFs, 'readFileSync', { value: (p, ...rest) => { reads.push(String(p)); return io.fs.readFileSync(p, ...rest); } });
  const watched = Object.create(io);
  Object.defineProperty(watched, 'fs', { value: watchedFs });
  const r = w.admit(dir, { io: watched });
  assert.equal(r.ok, false, 'an oversized run.json was admitted');
  assert.equal(r.check, 'record');
  assert.match(r.why, /larger than/);
  assert.deepEqual(reads.filter((p) => path.basename(p) === 'run.json'), [], 'the oversized run.json was read before it was refused');
});

// G-8 of 20261124-180917-gsw-remediation-4-review-b: admitRun held the bound by an lstat and then read the record with no
// bound, a second implementation of readRunJson's rule with a window between the two. A record that grows after the
// lstat (simulated: the lstat reports the size it had) must still be refused, by the bounded read itself, and the refusal
// is readRunJson's, the one owner of the run.json bound.
test('a run.json that grows past the bound after its lstat is still refused, by readRunJson\'s rule', (t) => {
  const w = world(t);
  const record = JSON.stringify({ run_id: ID, repo_root: w.repo, pad: 'x'.repeat(9 * 1024 * 1024) });
  const dir = w.put(w.staged(), ID, record);
  const stale = Object.create(io.fs);
  Object.defineProperty(stale, 'lstatSync', { value: (p, ...rest) => {
    const st = io.fs.lstatSync(p, ...rest);
    if (path.basename(String(p)) !== 'run.json') return st;
    return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: 100 });
  } });
  const grown = Object.create(io);
  Object.defineProperty(grown, 'fs', { value: stale });
  const r = w.admit(dir, { io: grown });
  assert.equal(r.ok, false, 'a run.json that grew after its size check was read whole and admitted');
  assert.equal(r.check, 'record');
  assert.match(r.why, /larger than the \d+-byte bound on a run\.json/, `refused by readRunJson's rule: ${r.why}`);
});

test('an archived run in the repository is admitted', (t) => {
  const w = world(t);
  const dir = w.put(path.join(w.repo, '.claude', 'reviews'), ID, { run_id: ID, repo_root: w.repo });
  assert.equal(w.admit(dir).ok, true);
});

test('outside both the repository and the home: refused by containment', (t) => {
  const w = world(t);
  const dir = w.put(w.other, ID, { run_id: ID, repo_root: w.repo });
  const r = w.admit(dir);
  assert.equal(r.ok, false);
  assert.equal(r.check, 'containment');
});

test('inside the home through a link to elsewhere: refused by containment', (t) => {
  const w = world(t);
  const target = w.put(w.other, ID, { run_id: ID, repo_root: w.repo });
  const root = w.staged();
  fs.mkdirSync(root, { recursive: true });
  const link = path.join(root, ID);
  fs.symlinkSync(target, link, 'junction');
  const r = w.admit(link);
  assert.equal(r.ok, false);
  assert.equal(r.check, 'containment');
});

test('no run.json, or one that does not parse to an object: refused by record', (t) => {
  const w = world(t);
  for (const [i, record] of [undefined, '{ "run_id": ', '[]', 'null'].entries()) {
    const dir = w.put(w.staged(), `${ID}${i}`, record);
    const r = w.admit(dir);
    assert.equal(r.ok, false, `record ${JSON.stringify(record)} was admitted`);
    assert.equal(r.check, 'record');
  }
});

test('a run_id that is absent, unsafe, or not the directory\'s name: refused by identity', (t) => {
  const w = world(t);
  for (const [i, runId] of [undefined, '../escape', `${ID}-other`].entries()) {
    const dir = w.put(w.staged(), `${ID}${i}`, { run_id: runId, repo_root: w.repo });
    const r = w.admit(dir);
    assert.equal(r.ok, false, `run_id ${JSON.stringify(runId)} was admitted`);
    assert.equal(r.check, 'identity');
  }
});

// G-12: runDirAllowed admits every repository's staged runs under the shared home.
test('another repository\'s staged run under the shared home: refused as not this repository\'s', (t) => {
  const w = world(t);
  const dir = w.put(w.staged(w.other), ID, { run_id: ID, repo_root: w.other });
  const r = w.admit(dir);
  assert.equal(r.ok, false);
  assert.equal(r.check, 'repository');
});

// The record's repo_root is a claim: a run in this repository's own roots that names another tree is refused, so no
// caller can act on the tree it names.
test('a run in this repository\'s roots whose repo_root names another tree: refused by repository', (t) => {
  const w = world(t);
  for (const [i, claimed] of [w.other, null, '', 42, 'relative/path', path.join(w.base, 'nowhere')].entries()) {
    const dir = w.put(w.staged(), `${ID}${i}`, { run_id: `${ID}${i}`, repo_root: claimed });
    const r = w.admit(dir);
    assert.equal(r.ok, false, `repo_root ${JSON.stringify(claimed)} was admitted`);
    assert.equal(r.check, 'repository');
  }
});

test('a remediation is required by name: a review run is refused', (t) => {
  const w = world(t);
  const review = w.put(w.staged(), ID, { run_id: ID, repo_root: w.repo });
  const r = w.admit(review, { need: { remediation: true } });
  assert.equal(r.ok, false);
  assert.equal(r.check, 'requirement');
  const rem = w.put(w.staged(), `${ID}-rem`, { run_id: `${ID}-rem`, repo_root: w.repo, remediates: 'x', remediation_frame: {} });
  assert.equal(w.admit(rem, { need: { remediation: true } }).ok, true);
});

test('noRepository skips only the repository checks, and says so', (t) => {
  const w = world(t);
  const dir = w.put(w.staged(w.other), ID, { run_id: ID, repo_root: w.other });
  const r = w.admit(dir, { noRepository: true });
  assert.equal(r.ok, true, r.why);
  assert.equal(r.repoRoot, null);
  assert.equal(r.repository, null);
  const bad = w.put(w.staged(w.other), `${ID}x`, { run_id: 'not-the-name', repo_root: w.other });
  assert.equal(w.admit(bad, { noRepository: true }).check, 'identity');
});

test('no repository established and noRepository not declared: refused, never read from the record', (t) => {
  const w = world(t);
  const dir = w.put(w.staged(), ID, { run_id: ID, repo_root: w.repo });
  const r = admitRun({ runDir: dir, repoRoot: '', home: w.home, project: PROJECT, io });
  assert.equal(r.ok, false);
  assert.equal(r.check, 'repository');
});

// archive-run's G-3 of 20261015-220413-archive-fold-review, kept by the owner: on a case-insensitive filesystem a run
// directory spelled in other casing is the same run, and realpath keeps the casing it was given.
test('on a case-insensitive filesystem, a run directory spelled in other casing is admitted', { skip: io.caseInsensitiveFs ? false : 'case-sensitive filesystem' }, (t) => {
  const w = world(t);
  const dir = w.put(w.staged(), ID, { run_id: ID, repo_root: w.repo });
  const r = w.admit(dir.toUpperCase());
  assert.equal(r.ok, true, r.why);
});

// Sixty archived runs here predate repo_root. Absent, it names no other repository, and the caller acts on the one
// returned; the run's location is still checked.
test('a record with no repo_root is admitted for the caller\'s repository only where that repository keeps its runs', (t) => {
  const w = world(t);
  const own = w.put(path.join(w.repo, '.claude', 'reviews'), ID, { run_id: ID });
  const r = w.admit(own);
  assert.equal(r.ok, true, r.why);
  assert.equal(r.repoRoot, fs.realpathSync.native(w.repo));
  const elsewhere = w.put(w.staged(w.other), ID, { run_id: ID });
  assert.equal(w.admit(elsewhere).check, 'repository');
});

// A REQUIREMENT THE OWNER DOES NOT IMPLEMENT IS REFUSED, NEVER IGNORED (G-11 of 20261023-014400-rdt-delivery): only
// need.remediation was read, so a caller passing need.ended got success for a run that had not ended.
test('a need admitRun does not implement (ended) is refused by requirement, not silently admitted', (t) => {
  const w = world(t);
  const dir = w.put(w.staged(), ID, { run_id: ID, repo_root: w.repo });
  const r = w.admit(dir, { need: { ended: true } });
  assert.equal(r.ok, false, 'need.ended was ignored and an unfinished run admitted');
  assert.equal(r.check, 'requirement');
  assert.match(r.why, /ended/);
});
