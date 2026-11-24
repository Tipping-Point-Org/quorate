// regression-rdd-delivery-remediation.test.mjs — the confirmed groups of review 20261029-050428-rdd-delivery that this
// remediation fixed.
//
// G-11 / G-12: confined-path's exclusive create left a partial file behind when its write failed, so a retry's exclusive
// create was refused by it and a failed replace left an orphan temporary file; and every fsync failure, EIO included,
// was reported as success.
// G-19 / G-17: remediate.mjs saveRun spread readRun's nullable result, so one failed read of run.json wrote a manifest
// holding only the patch; and readRun read run.json with a raw readFileSync, following a link the owner refuses.
// G-1: run-graph read checks.json, which drives the pre-flight and the gate, with a raw readFileSync below the run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { confined } from '../scripts/lib/confined-path.mjs';
import { confined as hostConfined } from '../scripts/io/confined-path.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', 'scripts');
const src = (name) => fs.readFileSync(path.join(scripts, name), 'utf8');

function tmpRoot(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rdd-rem-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// A filesystem whose next writeFileSync, or fsyncSync, fails once with `code`.
function failingFs({ write = null, fsync = null }) {
  let w = write; let f = fsync;
  return {
    ...fs,
    writeFileSync: (...a) => { if (w) { const code = w; w = null; throw Object.assign(new Error(code), { code }); } return fs.writeFileSync(...a); },
    fsyncSync: (...a) => { if (f) { const code = f; f = null; throw Object.assign(new Error(code), { code }); } return fs.fsyncSync(...a); },
  };
}

test('G-11: a failed exclusive create leaves no partial file, and a retry succeeds', (t) => {
  const root = tmpRoot(t);
  const owner = confined({ root, io: { fs: failingFs({ write: 'ENOSPC' }) } });
  assert.throws(() => owner.create(['a.json'], 'x'), /ENOSPC/);
  assert.equal(fs.existsSync(path.join(root, 'a.json')), false, 'the partial file was left at the target');
  owner.create(['a.json'], 'second');
  assert.equal(fs.readFileSync(path.join(root, 'a.json'), 'utf8'), 'second');
});

test('G-11: an fsync failure (EIO) is a failed write, not success, and leaves nothing behind', (t) => {
  const root = tmpRoot(t);
  assert.throws(() => confined({ root, io: { fs: failingFs({ fsync: 'EIO' }) } }).create(['b.json'], 'x'), /EIO/);
  assert.equal(fs.existsSync(path.join(root, 'b.json')), false);
});

test('G-12: a replace whose temporary write fails leaves no orphan .tmp file and keeps the old content', (t) => {
  const root = tmpRoot(t);
  fs.writeFileSync(path.join(root, 'run.json'), 'old');
  assert.throws(() => confined({ root, io: { fs: failingFs({ write: 'EIO' }) } }).replace(['run.json'], 'new'), /EIO/);
  assert.deepEqual(fs.readdirSync(root), ['run.json']);
  assert.equal(fs.readFileSync(path.join(root, 'run.json'), 'utf8'), 'old');
});

// RUN, NOT READ (G-11 of 20261124-180917-gsw-remediation-4-review-b): this test sliced remediate.mjs's source and checked
// one definition line for `catch`, so a reader answering null by any other spelling kept it green. saveRun's merge is
// lib/reviews-root's patchRunJson, and the merge is exercised: a record that cannot be read, cannot be parsed, or is not
// an object throws and leaves the file as it was, where a null-on-error read wrote a run.json holding only the patch.
test('G-19: saveRun merges the patch into a strictly read run.json, never a null-on-error read', async (t) => {
  const rr = await import('../scripts/lib/reviews-root.mjs');
  assert.equal(typeof rr.patchRunJson, 'function', 'no owner merges a patch into a strictly read run.json');
  const root = tmpRoot(t);
  const own = hostConfined(root);
  fs.writeFileSync(path.join(root, 'run.json'), JSON.stringify({ run_id: 'r', repo_root: '/x' }));
  rr.patchRunJson(own, { stamps: ['S'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'run.json'), 'utf8')), { run_id: 'r', repo_root: '/x', stamps: ['S'] });
  for (const body of ['{ not json', 'null', '[1]', '7']) {
    fs.writeFileSync(path.join(root, 'run.json'), body);
    assert.throws(() => rr.patchRunJson(own, { stamps: ['S'] }), undefined, `a run.json of ${body} was merged into`);
    assert.equal(fs.readFileSync(path.join(root, 'run.json'), 'utf8'), body, `a run.json of ${body} was overwritten by the patch`);
  }
  fs.rmSync(path.join(root, 'run.json'));
  assert.throws(() => rr.patchRunJson(own, { stamps: ['S'] }), (e) => e.code === 'ENOENT');
  assert.equal(fs.existsSync(path.join(root, 'run.json')), false, 'a missing run.json was created holding only the patch');
  // remediate's saveRun is that owner, so what is exercised above is what the runner writes with.
  assert.match(src('remediate.mjs'), /const saveRun = \([^)]*\) => patchRunJson\(/, 'remediate.mjs saveRun does not merge through patchRunJson');
});

test('G-17: remediate reads run.json through the confined owner, never a raw readFileSync', () => {
  const s = src('remediate.mjs');
  assert.doesNotMatch(s, /readFileSync\(\s*path\.join\(\s*\w+\s*,\s*'run\.json'\s*\)/, 'a raw read of run.json below a run');
  const defs = s.split('\n').filter((l) => /^const (readRun|loadRun) = /.test(l));
  assert.ok(defs.length, 'no run.json reader');
  // Through the owner: `.read(['run.json'])`, or the bounded reader given the owner (readRunJson(owner, ['run.json']); G-10
  // of 20261124-170802-gsw-remediation-3-review-b; operator, 2026-11-24: "I fix the test, add the census, retry (Recommended)").
  assert.ok(defs.some((l) => /\.read\(\['run\.json'\]\)|readRunJson\(\s*\(?dir === runDir \? owner : confined\(dir\)\)?\s*,\s*\['run\.json'\]\)/.test(l)),
    'the run.json reader does not go through the owner');
});

// G-4: the schema-less fallback's filter had branches for propose and tie-break only, so a claim-check answer, which
// carries no `verdict`, was discarded and the completed call reported unavailable.
test('G-4: the schema-less fallback keeps a claim-check answer, which has claims and no verdict', () => {
  const s = src('external-review.mjs');
  const start = s.indexOf('if (!p && !nativeSchema) {');
  assert.ok(start > 0, 'the schema-less fallback was not found');
  const filter = s.slice(start, s.indexOf('p = found.length', start));
  const pred = filter.slice(filter.indexOf('.filter((o) =>'));
  const keeps = (mode, o) => new Function('args', 'o', `return ${pred.slice('.filter((o) =>'.length, pred.lastIndexOf(');')).trim()};`)({ mode }, o);
  assert.ok(keeps('claim-check', { status: 'OK', claims: [], not_checked: [] }), 'a claim-check result is filtered out');
  assert.ok(!keeps('claim-check', { verdict: 'PASS' }), 'a verdict envelope is taken as a claim-check result');
  assert.ok(keeps('review', { verdict: 'PASS' }));
  assert.ok(keeps('tie-break', { supports: 'x' }));
});

// G-9: restorePreflightEvidence copied the cache entry into the run with a raw fs.cpSync, so a link inside the entry was
// installed below the admitted run directory.
test('G-9: a link inside a cached evidence entry is refused, not installed in the run', async (t) => {
  const { restorePreflightEvidence } = await import('../scripts/io/preflight-cache.mjs');
  const { preflightEvidenceDir } = await import('../scripts/lib/preflight-cache.mjs');
  const base = tmpRoot(t);
  const reviews = path.join(base, 'reviews');
  const run = path.join(reviews, 'run');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(run, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside\n');
  const hash = 'b'.repeat(64);
  const src = preflightEvidenceDir(reviews, hash);
  fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(src, 'sub', 'test.log'), 'cached\n');
  fs.symlinkSync(outside, path.join(src, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => restorePreflightEvidence(reviews, hash, hostConfined(run)), (e) => e.code === 'ECONFINED' && /link or junction/.test(e.message));
  const placed = path.join(run, 'evidence', 'pre-flight', 'escape');
  let st = null; try { st = fs.lstatSync(placed); } catch { /* absent */ }
  assert.equal(st, null, 'the cached link was installed below the run');
  fs.rmSync(path.join(src, 'escape'));
  assert.equal(restorePreflightEvidence(reviews, hash, hostConfined(run)), true);
  assert.equal(fs.readFileSync(path.join(run, 'evidence', 'pre-flight', 'sub', 'test.log'), 'utf8'), 'cached\n');
});

// G-12 of 20261029-190658-rdr-delivery (panel-codex-code): the restore returned true once it had copied what the cache
// held, so an entry whose cited evidence was never cached still read as restored. It answers for the paths cited.
test('G-12: the restore is true only when every cited evidence path is in the run', async (t) => {
  const { restorePreflightEvidence } = await import('../scripts/io/preflight-cache.mjs');
  const { preflightEvidenceDir } = await import('../scripts/lib/preflight-cache.mjs');
  const reviews = path.join(tmpRoot(t), 'reviews');
  const run = path.join(reviews, 'run');
  fs.mkdirSync(run, { recursive: true });
  const hash = 'c'.repeat(64);
  const cache = preflightEvidenceDir(reviews, hash);
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'test.log'), 'cached\n');
  assert.equal(restorePreflightEvidence(reviews, hash, hostConfined(run), { cited: ['evidence/pre-flight/test.log', 'evidence/pre-flight/build.log'] }), false,
    'build.log is cited and was never cached');
  assert.equal(restorePreflightEvidence(reviews, hash, hostConfined(run), { cited: ['evidence/pre-flight/test.log'] }), true);
});

// G-23: spawn-node composed the node's policy path lexically and handed it on unchecked, so a link standing at
// intent-settings.json redirected the policy the node runs under.
test('G-23: a link standing at the run\'s policy file is refused, not handed to the node', async () => {
  const { repoRunDir, runScript, REPO_ROOT } = await import('./helpers.mjs');
  const { dir } = repoRunDir({ prefix: 'quorate-rdd-policy-', json: { contract: { source_globs: ['scripts/**'] }, stamps: [] } });
  const elsewhere = path.join(dir, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.symlinkSync(elsewhere, path.join(dir, 'intent-settings.json'), 'junction');
  const r = runScript('spawn-node.mjs', [
    '--run-dir', dir, '--repo-root', REPO_ROOT, '--node-id', 'intent-capture', '--mode', 'intent', '--prompt', 'x',
    '--add-dir', path.join(dir, 'docs'),
    '--settings', path.join(dir, 'intent-settings.json'), '--print-cmd',
  ]);
  assert.notEqual(r.status, 0, `spawn-node accepted a policy path that is a link: ${r.output.slice(-400)}`);
  assert.match(r.output, /link or junction/);
});

test('G-1: run-graph reads checks.json through the run owner', () => {
  const s = src('run-graph.mjs');
  assert.doesNotMatch(s, /readFileSync\(\s*path\.join\(\s*runDir\s*,\s*'checks\.json'\s*\)/, 'a raw read of checks.json');
  const fn = s.slice(s.indexOf('function readChecksJson('), s.indexOf('const runPreflight = '));
  assert.match(fn, /runOwner\.read\(\['checks\.json'\]\)/);
});
