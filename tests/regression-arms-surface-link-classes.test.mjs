// arms-read-surface, Stage 4 (request criterion 1): every way outside content reached the arms'
// directory in the review rounds that led to this request, each placed in a fixture repository and
// shown not to reach the directory the builder hands over. Three classes are held elsewhere: the
// junction the snapshot walks through and the outside hard link (regression-arms-surface-builder), and
// the framework copy's hard link (regression-framework-copy-surface).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildArmsSurface } from '../scripts/io/snapshot.mjs';
import { copyTrackedInto } from '../scripts/io/worktree.mjs';

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
const SECRET = ['OUTSIDE', 'CONTENT'].join('-'); // built at runtime (.gitleaksignore's convention)

function sandbox(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-classes-')));
  t.after(() => {
    const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name); if (e.isSymbolicLink()) fs.rmSync(q, { force: true }); else if (e.isDirectory()) walk(q); } };
    try { walk(d); } catch { /* best effort */ }
    fs.rmSync(d, { recursive: true, force: true });
  });
  const outside = path.join(d, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'creds.txt'), SECRET);
  const repo = path.join(d, 'repo');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'docs', 'a.md'), 'public');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'build/\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  return { d, outside, repo, base: git(repo, 'rev-parse', 'HEAD').trim() };
}
const build = (s) => buildArmsSurface({ repoRoot: s.repo, headCommit: git(s.repo, 'rev-parse', 'HEAD').trim(), baseCommit: s.base,
  dir: path.join(s.d, 'arms'), maxBytes: 1n << 30n });
/** Every file's bytes under `dir`, as one string: the outside content must not be in it. */
const everything = (dir) => {
  let all = '';
  const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name === '.git') continue; const q = path.join(p, e.name);
    if (e.isDirectory()) walk(q); else all += fs.readFileSync(q, 'utf8'); } };
  walk(dir);
  // AND ITS OBJECT STORE (G-12 of review 20260927-052117-ars-r3): content can reach the arm as a git
  // object and never as a file, so every object's content is read too.
  if (fs.existsSync(path.join(dir, '.git'))) {
    all += spawnSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: dir, encoding: 'latin1', maxBuffer: 1 << 30 }).stdout;
  }
  return all;
};

// G-12 of review 20260927-052117-ars-r3: the absence check must see the arms' object store, since G-4 of
// that review showed outside content can reach the arm as a git object and never as a file.
test('the absence check reads the object store of the arms repository, not only its files', (t) => {
  const s = sandbox(t);
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: git(s.repo, 'rev-parse', 'HEAD').trim(), baseCommit: s.base,
    dir: path.join(s.d, 'arms'), maxBytes: 1n << 30n,
    beforeAssert: (dir) => { spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: SECRET }); } });
  assert.equal(r.ok, true, r.why);
  assert.match(everything(r.dir), new RegExp(SECRET), 'a secret planted as a git object went unseen');
});

test('a link committed to the tracked tree (m0-close G-11 class)', (t) => {
  const s = sandbox(t);
  // committed by plumbing, so no link privilege is needed: a 120000 entry whose target is outside
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: s.repo, input: path.join(s.outside, 'creds.txt'), encoding: 'utf8' }).stdout.trim();
  git(s.repo, 'update-index', '--add', '--cacheinfo', `120000,${blob},leak.md`);
  git(s.repo, 'commit', '-qm', 'a committed link');
  // and on disk, as a clone would have it: a real link where git may create one, a text file holding
  // the target where it may not (Windows without the symlink privilege) — mode 120000 either way.
  git(s.repo, 'checkout', '--', 'leak.md');
  const r = build(s);
  assert.equal(r.ok, true, r.why);
  assert.doesNotMatch(everything(r.dir), new RegExp(SECRET));
  assert.equal(fs.existsSync(path.join(r.dir, 'leak.md')), false, 'the link entry is left out, not written as text');
  assert.ok(r.withheld.some((w) => w.path === 'leak.md'), JSON.stringify(r.withheld));
});

test('a link introduced by the uncommitted diff: a tracked directory replaced by a link out', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.join(s.outside, 'a.md'), SECRET);
  fs.rmSync(path.join(s.repo, 'docs'), { recursive: true });
  link(s.outside, path.join(s.repo, 'docs'));
  const r = build(s);
  assert.equal(r.ok, true, r.why);
  assert.doesNotMatch(everything(r.dir), new RegExp(SECRET));
  // AND NAMED (G-14 of review 20260927-153422-ars-r4): this link is left out by the source check, so it is
  // named. On Windows git walks through the junction (`docs/a.md`); on POSIX the link is one entry (`docs`).
  assert.ok(r.withheld.some((w) => w.path === 'docs' || w.path.startsWith('docs/')), JSON.stringify(r.withheld));
});

test('a link in an ignored path never enters the snapshot', (t) => {
  const s = sandbox(t);
  fs.mkdirSync(path.join(s.repo, 'build'));
  link(s.outside, path.join(s.repo, 'build', 'out'));
  const r = build(s);
  assert.equal(r.ok, true, r.why);
  assert.equal(fs.existsSync(path.join(r.dir, 'build')), false);
  assert.doesNotMatch(everything(r.dir), new RegExp(SECRET));
});

test('a submodule path replaced on disk by a link to a non-git directory (m0-close-r3 G-4 class)', (t) => {
  const s = sandbox(t);
  const inner = path.join(s.d, 'inner');
  fs.mkdirSync(inner);
  git(inner, 'init', '-q'); fs.writeFileSync(path.join(inner, 'x.md'), 'x'); git(inner, 'add', '-A'); git(inner, 'commit', '-qm', 'i');
  git(s.repo, 'submodule', 'add', '-q', inner, 'sub'); git(s.repo, 'commit', '-qm', 'sub');
  fs.rmSync(path.join(s.repo, 'sub'), { recursive: true, force: true });
  link(s.outside, path.join(s.repo, 'sub'));
  const r = build(s);
  assert.equal(r.ok, true, r.why);
  assert.doesNotMatch(everything(r.dir), new RegExp(SECRET));
});

test('a link inside a populated submodule — the framework copy, which is how a submodule reaches the arms', (t) => {
  const s = sandbox(t);
  const fw = path.join(s.d, 'framework');
  fs.mkdirSync(path.join(fw, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(fw, 'shared', 'doc.md'), 'doctrine');
  git(fw, 'init', '-q');
  link(s.outside, path.join(fw, 'shared', 'linked'));
  git(fw, 'add', '-A'); git(fw, 'commit', '-qm', 'fw');
  const dest = path.join(s.d, 'fwcopy');
  const r = copyTrackedInto(fw, dest);
  assert.equal(r.ok, true, r.why);
  assert.doesNotMatch(everything(dest), new RegExp(SECRET));
  assert.ok(fs.existsSync(path.join(dest, 'shared', 'doc.md')));
});
