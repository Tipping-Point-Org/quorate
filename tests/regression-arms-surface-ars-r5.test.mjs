// Remediation of review 20260927-200901-ars-r5: G-3, the source check judged the working tree AFTER
// `git add -A` had captured it, so a file changed in between was judged as it is now while the arm
// was shown what it was then.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildArmsSurface } from '../scripts/io/snapshot.mjs';

const SECRET = ['OUTSIDE', 'CONTENT', 'THAT', 'IS', 'LONG'].join('-'); // built at runtime (.gitleaksignore's convention)
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
function sandbox(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-arsr5-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const outside = path.join(d, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'creds.txt'), SECRET);
  const repo = path.join(d, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  return { d, outside, repo, base: git(repo, 'rev-parse', 'HEAD') };
}
/** Every file's bytes under `dir`, its object store included. */
const everything = (dir) => {
  let all = '';
  const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name === '.git') continue; const q = path.join(p, e.name);
    if (e.isDirectory()) walk(q); else all += fs.readFileSync(q, 'latin1'); } };
  walk(dir);
  return all + spawnSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: dir, encoding: 'latin1', maxBuffer: 1 << 30 }).stdout;
};

test('G-3: a file swapped between capture and judgement is left out and named, not judged as it is now', (t) => {
  const s = sandbox(t);
  // At capture, h.txt is a hard link to an outside file: `git add -A` takes the outside bytes.
  fs.linkSync(path.join(s.outside, 'creds.txt'), path.join(s.repo, 'h.txt'));
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: git(s.repo, 'rev-parse', 'HEAD'), baseCommit: s.base,
    dir: path.join(s.d, 'arms'), maxBytes: 1n << 30n,
    // ...and before the judge looks, it becomes an ordinary file of its own, so the judge sees one link.
    afterCapture: (repo) => { fs.rmSync(path.join(repo, 'h.txt')); fs.writeFileSync(path.join(repo, 'h.txt'), 'innocent'); } });
  assert.equal(r.ok, true, r.why);
  assert.doesNotMatch(everything(r.dir), new RegExp(SECRET), 'the outside bytes captured before the swap reached the arm');
  assert.ok(r.withheld.some((w) => w.path === 'h.txt' && /changed after/.test(w.why)), JSON.stringify(r.withheld));
});

// Found by claim-checking the remediation: mtime was compared in whole seconds, and Windows records no
// inode, so a swap to content of the SAME SIZE inside the same second passed there.
test('G-3: a same-size swap inside the same second is still caught', (t) => {
  const s = sandbox(t);
  fs.linkSync(path.join(s.outside, 'creds.txt'), path.join(s.repo, 'h.txt'));
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: git(s.repo, 'rev-parse', 'HEAD'), baseCommit: s.base,
    dir: path.join(s.d, 'arms'), maxBytes: 1n << 30n,
    afterCapture: (repo) => {
      const p = path.join(repo, 'h.txt');
      const was = fs.statSync(p);
      fs.rmSync(p);
      fs.writeFileSync(p, 'x'.repeat(SECRET.length));
      // back to the captured whole second, with a different fraction of it
      const sec = Math.floor(was.mtimeMs / 1000) + ((was.mtimeMs % 1000) < 500 ? 0.75 : 0.25);
      fs.utimesSync(p, sec, sec);
    } });
  assert.equal(r.ok, true, r.why);
  assert.doesNotMatch(everything(r.dir), new RegExp(SECRET), 'the outside bytes captured before the swap reached the arm');
  assert.ok(r.withheld.some((w) => w.path === 'h.txt'), JSON.stringify(r.withheld));
});

test('G-3: an unchanged file is not left out by the capture check', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.join(s.repo, 'keep.txt'), 'untouched');
  git(s.repo, 'add', 'keep.txt'); git(s.repo, 'commit', '-qm', 'an untouched tracked file');
  fs.writeFileSync(path.join(s.repo, 'new.txt'), 'new');
  fs.writeFileSync(path.join(s.repo, 'a.txt'), 'modified');
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: git(s.repo, 'rev-parse', 'HEAD'), baseCommit: s.base,
    dir: path.join(s.d, 'arms'), maxBytes: 1n << 30n });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.withheld, []);
  assert.equal(fs.readFileSync(path.join(r.dir, 'new.txt'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(r.dir, 'a.txt'), 'utf8'), 'modified');
  assert.equal(fs.readFileSync(path.join(r.dir, 'keep.txt'), 'utf8'), 'untouched');
});
