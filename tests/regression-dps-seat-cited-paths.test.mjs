// decision-panel-seats.plan.md stage 1 (design DP-D4, "DP-D4, measured"; operator, 2026-11-09: "A. Copy cited files in
// (Recommended)"): the node-runtime decision seat runs in an empty directory outside the repository, and in decision
// 20261106-213306-68fec6 it answered "I could not read the design note (the path does not exist here)": the cited
// `.claude/requests/stop-owner-seam.design.md` was repository-relative and resolved against that empty directory. Given
// the path absolute, the CLI refused the Read outside its working directory (C:\work\temp\dps-stage1-live.txt). So before
// the seat (and the revote note's author, which stands in an empty directory too and is given the same work context)
// runs, every path its work context names is copied into its directory at the same repository-relative path, through
// the confined owners (ARCHITECTURE A-30): read through the repository's owner, written through the engine home's. A
// link, or a path outside the repository, is refused and named, never followed or copied; the seat is still sent the
// relative paths, never the files' contents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seatCopyPaths, workContextText } from '../scripts/lib/decision-panel.mjs';
import { copyIntoSeatDir } from '../scripts/io/seat-copies.mjs';
import { confined } from '../scripts/io/confined-path.mjs';
import { REPO_ROOT } from './helpers.mjs';

/** Every file below `dir`, as repository-relative forward-slash paths, sorted. */
function treeOf(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, ...rel), { withFileTypes: true })) {
      if (e.isDirectory()) walk([...rel, e.name]); else out.push([...rel, e.name].join('/'));
    }
  };
  walk([]);
  return out.sort();
}

test('DP-D4: the paths to copy are the request, the changed files and the in-repository evidence, each once', () => {
  const evidence = [
    { inRepo: true, rel: '.claude/requests/y.design.md', canonical: '.claude/requests/y.design.md' },
    { inRepo: false, rel: 'run/evidence/e.txt', canonical: 'C:/home/.quorate/reviews/run/evidence/e.txt' },
  ];
  const { copy, refused } = seatCopyPaths({ request: '.claude/requests/x.plan.md', files: ['scripts/a.mjs', '.claude/requests/x.plan.md', ''], evidence });
  assert.deepEqual(copy, ['.claude/requests/x.plan.md', 'scripts/a.mjs', '.claude/requests/y.design.md']);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].path, 'C:/home/.quorate/reviews/run/evidence/e.txt');
  assert.match(refused[0].why, /outside the repository/);
});

test('DP-D4: the seat\'s directory holds each named file at its relative path, byte for byte, and nothing else', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dps-repo-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dps-home-'));
  try {
    fs.mkdirSync(path.join(repo, '.claude', 'requests'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'scripts'));
    fs.writeFileSync(path.join(repo, '.claude', 'requests', 'x.plan.md'), '# plan\nline two\n');
    fs.writeFileSync(path.join(repo, 'scripts', 'a.mjs'), Buffer.from([0, 1, 2, 255, 10]));
    fs.writeFileSync(path.join(repo, 'unnamed.md'), 'not named, never copied\n');
    const owner = confined(path.resolve(home));
    const segs = ['decision-surfaces', 'seat-1'];
    owner.dir(segs);
    const r = copyIntoSeatDir({ repoRoot: path.resolve(repo), owner, segs, paths: ['.claude/requests/x.plan.md', 'scripts/a.mjs', 'gone.md'],
      // Tracked, so its binary bytes are copied as they stand: an untracked file that is not text is refused (G-5 of
      // 20261110-014035-dps-remediation-3-review), tests/regression-dps-seat-copy-binary-and-cache.test.mjs.
      tracked: ['.claude/requests/x.plan.md', 'scripts/a.mjs'] });
    const dest = path.join(home, ...segs);
    assert.deepEqual(treeOf(dest), ['.claude/requests/x.plan.md', 'scripts/a.mjs'], 'the directory holds something other than the named files');
    assert.equal(fs.readFileSync(path.join(dest, '.claude', 'requests', 'x.plan.md'), 'utf8'), '# plan\nline two\n');
    assert.deepEqual([...fs.readFileSync(path.join(dest, 'scripts', 'a.mjs'))], [0, 1, 2, 255, 10], 'a copy is not byte for byte');
    assert.deepEqual(r.copied, ['.claude/requests/x.plan.md', 'scripts/a.mjs']);
    // A changed file git lists as deleted has nothing to copy: named as missing, not an error.
    assert.deepEqual(r.missing, ['gone.md']);
    assert.deepEqual(r.refused, []);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('DP-D4: a path through a link, a path outside the repository, and an absolute path are refused, none copied', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dps-repo-'));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'dps-elsewhere-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dps-home-'));
  try {
    fs.writeFileSync(path.join(elsewhere, 'secret.md'), 'outside the repository\n');
    fs.writeFileSync(path.join(repo, 'ok.md'), 'ok\n');
    // A directory junction (no privilege needed on Windows), a symlink elsewhere.
    fs.symlinkSync(elsewhere, path.join(repo, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const owner = confined(path.resolve(home));
    const segs = ['decision-surfaces', 'seat-1'];
    owner.dir(segs);
    const r = copyIntoSeatDir({ repoRoot: path.resolve(repo), owner, segs,
      paths: ['ok.md', 'linked/secret.md', '../' + path.basename(elsewhere) + '/secret.md', path.join(elsewhere, 'secret.md')],
      refused: [{ path: 'C:/staged/run/evidence/e.txt', why: 'outside the repository' }] });
    const dest = path.join(home, ...segs);
    assert.deepEqual(treeOf(dest), ['ok.md'], 'a refused path reached the seat\'s directory');
    assert.deepEqual(r.copied, ['ok.md']);
    const refused = r.refused.map((x) => x.path);
    for (const p of ['linked/secret.md', '../' + path.basename(elsewhere) + '/secret.md', path.join(elsewhere, 'secret.md'), 'C:/staged/run/evidence/e.txt']) {
      assert.ok(refused.includes(p), `${p} was not refused: ${JSON.stringify(r.refused)}`);
    }
    assert.match(r.refused.find((x) => x.path === 'linked/secret.md').why, /link/);
  } finally {
    fs.rmSync(path.join(repo, 'linked'), { force: true, recursive: false });
    for (const d of [repo, elsewhere, home]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('DP-D4: the seat is sent the repository-relative paths, never an absolute spelling or a file\'s contents', () => {
  const text = workContextText({ request: '.claude/requests/x.plan.md', files: ['scripts/a.mjs'], evidence: ['.claude/requests/y.design.md'] });
  assert.match(text, /`\.claude\/requests\/y\.design\.md`/);
  assert.match(text, /`\.claude\/requests\/x\.plan\.md`/);
  assert.doesNotMatch(text, /repository root/i);
});

test('DP-D4: decide.mjs copies into the runtime seat\'s and the revote author\'s directories, not the moderator\'s', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'decide.mjs'), 'utf8');
  assert.ok(/subagent\(`seat-\$\{seat\}`, prompt, round, \{ copy: true \}\)/.test(src), 'the runtime seat\'s directory gets no copies');
  assert.ok(/subagent\('revote-author', [^\n]*, null, \{ copy: true \}\)/.test(src), 'the revote author\'s directory gets no copies');
  assert.ok(/subagent\('moderator', prompt, null\)/.test(src), 'the moderator, given no work context, is spawned differently');
  assert.ok(/copyIntoSeatDir\(\{[^\n]*owner: homeOwner/.test(src), 'the copies are not written through the engine home\'s owner');
  assert.ok(/seatCopyPaths\(\{[^\n]*evidence: questionEntries/.test(src), 'the evidence to copy is not the intake\'s normalized entries');
  assert.ok(!/root: repoRoot\s*[,}][^\n]*workContextText|workContextText\(\{[^\n]*root:/.test(src), 'a seat\'s context is still built with an absolute root');
});
