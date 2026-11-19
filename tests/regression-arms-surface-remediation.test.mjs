// Remediation of review 20260927-012913-arms-read-surface (the snapshot builder's first review).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildArmsSurface } from '../scripts/io/snapshot.mjs';

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
function sandbox(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-arsfix-')));
  t.after(() => {
    const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name); if (e.isSymbolicLink()) fs.rmSync(q, { force: true }); else if (e.isDirectory()) walk(q); } };
    try { walk(d); } catch { /* best effort */ }
    spawnSync('git', ['worktree', 'prune'], { cwd: path.join(d, 'repo') });
    fs.rmSync(d, { recursive: true, force: true });
  });
  const repo = path.join(d, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  return { d, repo, head: git(repo, 'rev-parse', 'HEAD') };
}
const files = (dir) => { const out = []; const walk = (p, r) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
  if (e.name === '.git') continue; const q = path.join(p, e.name); const rr = r ? `${r}/${e.name}` : e.name;
  if (e.isDirectory()) walk(q, rr); else out.push(rr); } }; walk(dir, ''); return out.sort(); };

// G-4 (code-audit + panel-codex-code): the alternate object store was hard-coded as <repo>/.git/objects.
// In a linked worktree `.git` is a FILE, the snapshot could not find HEAD, and the run lost its panel.
test('G-4: a linked worktree (a .git FILE) can be snapshotted', (t) => {
  const s = sandbox(t);
  const wt = path.join(s.d, 'wt');
  git(s.repo, 'worktree', 'add', '-q', '--detach', wt, 'HEAD');
  assert.ok(fs.statSync(path.join(wt, '.git')).isFile(), 'the fixture is the layout the finding names');
  const r = buildArmsSurface({ repoRoot: wt, headCommit: s.head, baseCommit: s.head, dir: path.join(s.d, 'arms'), maxBytes: null });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(files(path.join(s.d, 'arms')), ['a.txt']);
});

// G-14b (panel-codex-security): an in-repository link whose real location is INSIDE an excluded root —
// a run's evidence — was admitted, because the check only asked whether it stayed in the repository.
test('G-14b: a link into an excluded root is left out, not admitted', (t) => {
  const s = sandbox(t);
  const evidence = path.join(s.repo, '.claude', 'reviews', 'run1', 'evidence');
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'captured.log'), 'CAPTURED-OUTPUT');
  link(evidence, path.join(s.repo, 'leak'));
  const dir = path.join(s.d, 'arms');
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.head, dir,
    exclude: [path.join(s.repo, '.claude', 'reviews')], maxBytes: null });
  assert.equal(r.ok, true, r.why);
  assert.equal(files(dir).some((f) => f.startsWith('leak')), false, JSON.stringify(files(dir)));
});

// G-5 (panel-codex-code): exclusions applied only to `git add`, so TRACKED files under an excluded root
// stayed in the snapshot (in this repository, every tracked past run under .claude/reviews/).
test('G-5: tracked files under an excluded root are not in the arms\' directory', (t) => {
  const s = sandbox(t);
  fs.mkdirSync(path.join(s.repo, '.claude', 'reviews', 'old'), { recursive: true });
  fs.writeFileSync(path.join(s.repo, '.claude', 'reviews', 'old', 'run.json'), '{}');
  git(s.repo, 'add', '-A'); git(s.repo, 'commit', '-qm', 'a tracked run');
  const head = git(s.repo, 'rev-parse', 'HEAD');
  const dir = path.join(s.d, 'arms');
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: head, baseCommit: head, dir,
    exclude: [path.join(s.repo, '.claude', 'reviews')], maxBytes: null });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(files(dir), ['a.txt']);
});

// G-16 (panel-codex-code; G-19, panel-codex-docs, is its symptom): when the framework did not need
// copying it was marked ready without checking the required files.
test('G-16: a framework that needs no copy is still checked for the files the arms require', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
  const hook = src.slice(src.indexOf('beforeAssert: (d) => {'), src.indexOf('const rel = frameworkRel.split(path.sep)'));
  assert.doesNotMatch(hook, /if \(!needsPopulating\) \{ panelFrameworkReady = true;/,
    'readiness is not assumed on the path that copies nothing');
  assert.match(hook, /frameworkCopyReady\(/, 'it is decided by the same check the copy path uses');
});

// G-7 (perf-audit + panel-codex-perf): the pack of the snapshot's objects was held whole in memory
// between two git processes. Not observable from a test, so the before-state is the code itself.
test('G-7: the snapshot\'s objects travel through a file, not through memory', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'io', 'snapshot.mjs'), 'utf8');
  assert.doesNotMatch(src, /'pack-objects', '--stdout'/);
});

// ---- review 20260927-021924-ars-r1 ----

// G-5 (code-audit): the hard-link check ignored the entry's mode, and a submodule entry (160000) is a
// DIRECTORY whose link count on POSIX is 2 or more — so every submodule was left out as a "hard link",
// and the arm's `git diff <base>` showed each one deleted. Pure, so it is shown on any OS.
test('ars-r1 G-5: a submodule entry is not a hard link, whatever its directory link count', async () => {
  const { judgeSnapshotEntries } = await import('../scripts/lib/snapshot-surface.mjs');
  const root = path.resolve('/virtual/repo');
  const r = judgeSnapshotEntries({ realRepoRoot: root, entries: [
    { path: 'sub', mode: '160000', real: path.join(root, 'sub'), dev: '1', ino: '77', nlink: '3' },
  ] });
  assert.deepEqual(r.admitted, ['sub']);
  assert.deepEqual(r.withheld, []);
});

// G-4 (panel-codex-security): the arms' repository fetched the base commit WHOLE, so what the exclusions
// keep out of view — tracked past runs under .claude/reviews — was readable with `git show <base>:<path>`.
// Filtered without giving up "option 1": the arm still diffs against the base's own id.
test('ars-r1 G-4: an excluded root is not in the base the arms can reach, and `git diff <base>` still works', (t) => {
  const s = sandbox(t);
  fs.mkdirSync(path.join(s.repo, '.claude', 'reviews', 'old'), { recursive: true });
  fs.writeFileSync(path.join(s.repo, '.claude', 'reviews', 'old', 'run.json'), '{"past":"run"}');
  git(s.repo, 'add', '-A'); git(s.repo, 'commit', '-qm', 'a tracked past run');
  const base = git(s.repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(s.repo, 'a.txt'), 'changed');
  const dir = path.join(s.d, 'arms');
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: base, baseCommit: base, dir,
    exclude: [path.join(s.repo, '.claude', 'reviews')], maxBytes: null });
  assert.equal(r.ok, true, r.why);
  const show = spawnSync('git', ['show', `${base}:.claude/reviews/old/run.json`], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(show.status, 0, 'the past run is not reachable through the base commit');
  assert.equal(git(dir, 'diff', '--name-only', base), 'a.txt', 'the arm diffs against the base id it was told, and sees only the change');
});

// Found by claim-checking the ars-r1 remediation report: an entry LEFT OUT of the snapshot (a link, a
// file behind a junction, an outside hard link) was still in the stand-in base, so the arm's
// `git diff <base>` showed it as deleted — the class G-5 fixed for submodules. The base leaves out what
// the snapshot leaves out.
test('ars-r1 follow-up: an entry left out of the snapshot is left out of the base too, not shown deleted', (t) => {
  const s = sandbox(t);
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: s.repo, input: '/somewhere/else', encoding: 'utf8' }).stdout.trim();
  git(s.repo, 'update-index', '--add', '--cacheinfo', `120000,${blob},leak.md`);
  git(s.repo, 'commit', '-qm', 'a committed link');
  git(s.repo, 'checkout', '--', 'leak.md');
  const base = git(s.repo, 'rev-parse', 'HEAD');
  const dir = path.join(s.d, 'arms');
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: base, baseCommit: base, dir, maxBytes: null });
  assert.equal(r.ok, true, r.why);
  assert.ok(r.withheld.some((w) => w.path === 'leak.md'), 'the fixture leaves the link out');
  assert.equal(git(dir, 'diff', '--name-only', base), '', 'nothing changed, so the arm sees no change');
});

// Found by review 20260927-033113-ars-r2, whose panel it cost: `git rm --cached` keeps its own safety
// check even on a throwaway index, and refused a tracked file under an excluded root whose content at the
// base differed from both HEAD and the working tree (.claude/reviews/ledger.json, the most-edited tracked
// file here). The build failed, closed — no arm ran. The throwaway index has nothing to lose: removal is
// forced.
test('ars-r2: an excluded tracked file that differs at base, HEAD and on disk does not stop the build', (t) => {
  const s = sandbox(t);
  const ledger = path.join(s.repo, '.claude', 'reviews', 'ledger.json');
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(ledger, '{"v":1}');
  git(s.repo, 'add', '-A'); git(s.repo, 'commit', '-qm', 'base');
  const base = git(s.repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(ledger, '{"v":2}');
  git(s.repo, 'add', '-A'); git(s.repo, 'commit', '-qm', 'head');
  const head = git(s.repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(ledger, '{"v":3}');   // and modified on disk: three different versions
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: head, baseCommit: base, dir: path.join(s.d, 'arms'),
    exclude: [path.join(s.repo, '.claude', 'reviews')], maxBytes: null });
  assert.equal(r.ok, true, r.why);
});
