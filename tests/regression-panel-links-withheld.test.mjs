// Links into the external reviewers' checkout. The arms send whatever they read to their vendor's
// cloud, and the operator's consent covers the REPOSITORY — not whatever a link in it points at.
//
// Tracked links in the reviewed project (found while settling G-11, reproduced under Linux git in
// WSL): `git worktree add` recreated a committed `leak.md -> ../outside/credentials` as a real link,
// and reading leak.md in the arms' checkout returned the outside file's bytes. On Windows without the
// symlink privilege the same commit arrives as a text file holding the path, which is why the
// decision is taken from git's record and must come out the same on every OS.
//
// G-11 of run 20260925-200721-platform-remediated (panel-codex-code): copyTrackedInto, which copies
// the framework into that checkout, used statSync and copyFileSync — both FOLLOW links — so a link
// in the framework's tree was materialised as its target's bytes. It now applies the snapshot's rule.
//
// Since arms-read-surface the arms' directory is a snapshot, not a checkout: the cases that exercised
// withholdLinksLeaving on a checkout (a tracked link; a tracked path made a link on disk) are held by
// tests/regression-arms-surface-link-classes.test.mjs against the builder that replaced it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyTrackedInto } from '../scripts/io/worktree.mjs';

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const tmp = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-links-')));
  t.after(() => {
    spawnSync('git', ['worktree', 'prune'], { cwd: path.join(d, 'repo') });
    fs.rmSync(d, { recursive: true, force: true });
  });
  return d;
};


test('G-11: the framework copy does not follow a link out of the framework\'s tree', (t) => {
  const d = tmp(t);
  const src = path.join(d, 'repo');
  fs.mkdirSync(path.join(src, 'docs'), { recursive: true });
  git(src, 'init', '-q');
  fs.writeFileSync(path.join(src, 'README.md'), 'readme');
  fs.writeFileSync(path.join(src, 'docs', 'a.md'), 'public');
  git(src, 'add', '-A');
  git(src, 'commit', '-qm', 'framework');
  // The tracked docs/ is now a link to somewhere else holding a file of the same name. A junction on
  // Windows (no privilege needed), a directory link elsewhere.
  const out = path.join(d, 'outside');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'a.md'), 'SECRET');
  fs.rmSync(path.join(src, 'docs'), { recursive: true });
  fs.symlinkSync(out, path.join(src, 'docs'), 'junction');

  const dest = path.join(d, 'dest');
  const r = copyTrackedInto(src, dest);
  assert.equal(r.ok, true, r.why);
  assert.equal(fs.existsSync(path.join(dest, 'docs', 'a.md')), false, 'the outside bytes are not copied');
  assert.deepEqual((r.refused ?? []).map((x) => x.rel), ['docs/a.md']);
  assert.equal(fs.readFileSync(path.join(dest, 'README.md'), 'utf8'), 'readme', 'ordinary files still copy');
});

test('run-graph builds the arms\' directory before any arm reads it, and the gate names every entry left out', () => {
  // Since arms-read-surface the directory is a snapshot (buildArmsSurface), which leaves out and names
  // whatever resolves outside the repository; the framework copy runs inside it, before its final
  // no-links assertion. Both kinds of withheld entry must reach the gate.
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
  const start = src.indexOf('panelBuilt = buildArmsSurface({');
  assert.ok(start > -1, 'the arms\' directory is built by the snapshot builder');
  assert.ok(start < src.indexOf('const armSurface = panelReadSurface('), 'before the arms are given a surface');
  const block = src.slice(start, src.indexOf('const armSurface = panelReadSurface('));
  assert.match(block, /beforeAssert:[\s\S]*copyTrackedInto\(/, 'the framework is copied inside the build, before its assertion');
  assert.match(block, /sub\.refused/, 'framework files refused by the copy are collected');
  assert.match(block, /panelBuilt\.withheld/, 'snapshot entries left out are collected');
  assert.ok((block.match(/mirrorRefusals\.push/g) ?? []).length >= 2, 'both reach the gate');
});

// G-12 and G-11 of run 20260926-002850-m0-close. G-12 (security-audit): the withholding failed OPEN —
// on `ok:false` the checkout was handed over anyway. G-11 (panel-codex-security): it ran before the
// dirty-tree patch, and `git apply` can turn a tracked file into a link on disk without touching the
// index, so neither the timing nor git's record could see it. Falling back to the repository root is
// no answer either: it holds the same links in their real place. So the check runs on the FINISHED
// surface, judges every listed path on disk as well as git's record, and when no surface can be shown
// free of outward links, no external reviewer runs at all — each arm is recorded SKIPPED with why.
import { panelReadSurface } from '../scripts/lib/capabilities.mjs';

test('G-12: no surface is handed over that was not shown free of outward links', () => {
  // The withholding once failed OPEN: on ok:false the checkout was handed over anyway. The builder's
  // last step asserts the finished directory holds no link and no hard link, and fails the build
  // otherwise (regression-arms-surface-builder); a failed build is no surface, and never the root.
  assert.equal(panelReadSurface({ built: { ok: true, dir: '/arms' }, frameworkReady: true }).cwd, '/arms');
  const unsafe = panelReadSurface({ built: { ok: false, why: 'the finished directory holds a link' }, frameworkReady: true });
  assert.equal(unsafe.cwd, null, 'not handed over, and not swapped for the repository root either');
  assert.equal(unsafe.stamp, 'PANEL-NO-SAFE-SURFACE');
  assert.equal(panelReadSurface({}).cwd, null, 'unstated means unbuilt');
});


test('G-12/G-11: the finished directory is judged, and a refused surface spawns no reviewer', () => {
  // G-11: a link appeared AFTER the check (the dirty-tree patch ran later). The snapshot builder has no
  // patch step — content enters as blobs — and its assertion runs last, after the framework copy.
  const builder = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'io', 'snapshot.mjs'), 'utf8');
  assert.ok(builder.indexOf('beforeAssert(dir)') > -1 && builder.indexOf('beforeAssert(dir)') < builder.indexOf('is a link'),
    'the caller\'s additions run before the final no-links assertion');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
  const arm = src.slice(src.indexOf('async function spawnPanelArm(arm) {'));
  assert.match(arm.slice(0, 3000), /if \(!armSurface\.cwd\)[\s\S]{0,200}writeStatusStub\(arm\.id, 'SKIPPED'/, 'each arm is recorded, not silently dropped');
});
