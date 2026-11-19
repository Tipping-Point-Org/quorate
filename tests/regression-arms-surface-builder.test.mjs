// arms-read-surface, Stage 2 (.claude/requests/arms-read-surface.md; plan Stage 2): the builder of the
// directory an external reviewer reads. Each test names the request criterion it holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildArmsSurface, git as snapGit } from '../scripts/io/snapshot.mjs';

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 30 });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
const CAP = 1n << 30n;

/** A fresh sandbox: `outside/` and a repository `repo/` with a base commit and a head commit. */
function sandbox(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-arms-')));
  t.after(() => {
    // links first, never deleted through
    const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name); if (e.isSymbolicLink()) fs.rmSync(q, { recursive: false, force: true }); else if (e.isDirectory()) walk(q); } };
    try { walk(d); } catch { /* best effort */ }
    fs.rmSync(d, { recursive: true, force: true });
  });
  const outside = path.join(d, 'outside');
  fs.mkdirSync(path.join(outside, 'dir'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'dir', 'creds.txt'), 'OUTSIDE');
  fs.writeFileSync(path.join(outside, 'hard.txt'), 'OUTSIDE-HARD');
  const repo = path.join(d, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\nforced.txt\n');
  for (const f of ['keep.txt', 'modified.txt', 'deleted.txt', 'forced.txt']) fs.writeFileSync(path.join(repo, f), f);
  git(repo, 'add', '-A'); git(repo, 'add', '-f', 'forced.txt'); git(repo, 'commit', '-qm', 'base');
  const base = git(repo, 'rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(repo, 'later.txt'), 'later'); git(repo, 'add', 'later.txt'); git(repo, 'commit', '-qm', 'head');
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  return { d, outside, repo, base, head };
}
const digest = (root) => {
  const out = {};
  const walk = (p, rel) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const q = path.join(p, e.name); const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) out[r] = `LINK:${fs.readlinkSync(q)}`;
    else if (e.isDirectory()) walk(q, r);
    else out[r] = crypto.createHash('sha256').update(fs.readFileSync(q)).digest('hex');
  } };
  walk(root, '');
  return out;
};

/** Every file's bytes under `dir` as one string, for an absence check: outside content must not be in it. */
const shownText = (root) => {
  let all = '';
  const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name === '.git') continue; const q = path.join(p, e.name);
    if (e.isDirectory()) walk(q); else if (e.isFile()) all += fs.readFileSync(q, 'latin1'); } };
  walk(root);
  // and every object in its repository (G-11): content can reach the arm as a git object alone
  all += spawnSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: root, encoding: 'latin1', maxBuffer: 1 << 30 }).stdout;
  return all;
};

// G-11 of review 20260927-052117-ars-r3: the absence check must see the arms' object store too.
test('the absence check reads the object store of the arms repository, not only its files', (t) => {
  const s = sandbox(t);
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.base, dir: path.join(s.d, 'arms'), maxBytes: CAP,
    beforeAssert: (dir) => { spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: 'PLANTED-OBJECT' }); } });
  assert.equal(r.ok, true, r.why);
  assert.match(shownText(r.dir), /PLANTED-OBJECT/, 'a secret planted as a git object went unseen');
});

test('criterion 7: the arms see the same files as the lens — tracked with changes, plus untracked not ignored', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.join(s.repo, 'modified.txt'), 'MODIFIED');
  fs.rmSync(path.join(s.repo, 'deleted.txt'));
  fs.writeFileSync(path.join(s.repo, 'untracked.txt'), 'untracked');
  fs.writeFileSync(path.join(s.repo, 'ignored.txt'), 'ignored');
  const dir = path.join(s.d, 'arms');
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.base, dir, maxBytes: CAP });
  assert.equal(r.ok, true, r.why);
  const files = Object.keys(digest(dir)).sort();
  assert.deepEqual(files, ['.gitignore', 'forced.txt', 'keep.txt', 'later.txt', 'modified.txt', 'untracked.txt']);
  assert.equal(fs.readFileSync(path.join(dir, 'modified.txt'), 'utf8'), 'MODIFIED');
});

test('criterion 1 (junction, outside hard link): left out of the arms\' directory and named', (t) => {
  const s = sandbox(t);
  link(path.join(s.outside, 'dir'), path.join(s.repo, 'linked'));
  fs.linkSync(path.join(s.outside, 'hard.txt'), path.join(s.repo, 'hardlink.txt'));
  fs.writeFileSync(path.join(s.repo, 'inner-a.txt'), 'inner');
  fs.linkSync(path.join(s.repo, 'inner-a.txt'), path.join(s.repo, 'inner-b.txt'));
  const dir = path.join(s.d, 'arms');
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.base, dir, maxBytes: CAP });
  assert.equal(r.ok, true, r.why);
  const shown = digest(dir);
  assert.equal(Object.values(shown).some((h) => h === crypto.createHash('sha256').update('OUTSIDE').digest('hex')), false, 'the file behind the link is not shown');
  assert.doesNotMatch(shownText(dir), /OUTSIDE/, 'no outside content anywhere in the directory, its object store included');
  assert.equal('hardlink.txt' in shown, false, 'the outside hard link is not shown');
  assert.ok('inner-a.txt' in shown && 'inner-b.txt' in shown, 'a hard link that stays inside is kept');
  const named = r.withheld.map((w) => w.path).sort();
  // Per OS, git records this differently (Stage 7, in WSL): on Windows it walks THROUGH the junction and
  // the file behind it is left out (`linked/creds.txt`); on POSIX the symlink is one entry (`linked`).
  assert.ok(named.includes('hardlink.txt') && named.some((p) => p === 'linked' || p.startsWith('linked/')), JSON.stringify(named));
});

test('criterion 3: the operator\'s repository is unchanged, by content — index, objects, files and links', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.join(s.repo, 'modified.txt'), 'MODIFIED');
  fs.writeFileSync(path.join(s.repo, 'untracked.txt'), 'untracked');
  link(path.join(s.outside, 'dir'), path.join(s.repo, 'linked'));
  const snap = () => ({ index: git(s.repo, 'ls-files', '-s'),
    objects: git(s.repo, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)'), files: digest(s.repo) });
  const before = snap();
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.base, dir: path.join(s.d, 'arms'), maxBytes: CAP });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(snap(), before);
  assert.ok(fs.lstatSync(path.join(s.repo, 'linked')).isSymbolicLink(), 'the link is not broken');
});

test('option 1: the arms can `git diff <base>` as the lens does, and nothing in their .git names the source', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.join(s.repo, 'modified.txt'), 'MODIFIED');
  const dir = path.join(s.d, 'arms');
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.base, dir, maxBytes: CAP });
  assert.equal(r.ok, true, r.why);
  const changed = git(dir, 'diff', '--name-only', s.base).trim().split('\n').sort();
  assert.deepEqual(changed, ['later.txt', 'modified.txt']);
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD').trim(), '2');
  assert.equal(fs.existsSync(path.join(dir, '.git', 'objects', 'info', 'alternates')), false, 'no pointer into the source store');
  const needle = path.basename(s.d);
  const leaks = [];
  const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const q = path.join(p, e.name); if (e.isDirectory()) walk(q); else if (fs.readFileSync(q).includes(needle)) leaks.push(q); } };
  walk(path.join(dir, '.git'));
  assert.deepEqual(leaks, [], 'FETCH_HEAD and anything else recording the source path are gone');
});

// CRITERION 2, WITHOUT 12,000 FILES (test-suite-cost.md). The defect was ONE listing spawned without the cap, which
// fails past spawnSync's 1 MiB default. This wrote 12,000 files to cross 1 MiB on every suite run. Two checks reach the
// same defect with a few files: every git call the builder makes goes through git(), the one capped spawn (a quiet
// `check-ignore -q` prints nothing, so it is no listing); and git() honours the cap it is given, so a tiny one fails
// where the default does not.
// Every git spawn in `src`, as the text of its whole call. G-14 of 20261023-214545-ger-remediation-review: this scanned one
// line at a time, so `spawnSync(\n  'git', …)` was absent from the list and the check stayed green for that bypass.
function gitSpawnCalls(src) {
  const calls = [];
  for (const m of src.matchAll(/\bspawnSync\(\s*['"]git['"]|\bgitSync\(/g)) {
    if (/^\s*\/\//.test(src.slice(src.lastIndexOf('\n', m.index - 1) + 1, m.index + 1))) continue;
    let depth = 0;
    let k = src.indexOf('(', m.index);
    for (; k < src.length; k++) {
      const c = src[k];
      if (c === '\'' || c === '"' || c === '`') { const close = src.indexOf(c, k + 1); k = close < 0 ? src.length : close; continue; }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) break;
    }
    calls.push(src.slice(m.index, k + 1));
  }
  return calls;
}

test('criterion 2: every git listing the builder runs is capped, and the cap is honoured', (t) => {
  const s = sandbox(t);
  const src = fs.readFileSync(new URL('../scripts/io/snapshot.mjs', import.meta.url), 'utf8');
  const synthetic = "spawnSync(\n  'git',\n  ['ls-files'],\n);\nconst r = gitSync(\n  ['status'], { maxBuffer: 1 });\n";
  assert.deepEqual(gitSpawnCalls(synthetic).map((c) => /maxBuffer/.test(c)), [false, true], 'a git spawn split across lines was not seen whole');
  // Through the engine's one git owner since engine-git-env stage 3; a direct spawn would still be caught here.
  const direct = gitSpawnCalls(src);
  for (const l of direct) {
    assert.ok(/maxBuffer/.test(l) || /'-q'/.test(l), `a git spawn outside the capped git(): ${l.trim()}`);
  }
  assert.equal(direct.filter((l) => /maxBuffer/.test(l)).length, 1, 'git() is the one capped spawn');
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(s.repo, `f${i}.txt`), '');
  assert.equal(snapGit(s.repo, ['ls-files', '-z', '--others'], { maxBuffer: 16 }).ok, false, 'a 16-byte cap was not honoured');
  assert.equal(snapGit(s.repo, ['ls-files', '-z', '--others']).ok, true, 'the default cap fails a small listing');
  // THE BUILDER ITSELF TAKES THE CAP (G-1 of 20261012-054024-test-cost-review): checking git() alone left the builder's
  // own listings uncappable from outside. Every git call inside it goes through its capped wrapper, and a tiny cap fails
  // the build where the default builds.
  const builder = src.slice(src.indexOf('export function buildArmsSurface('));
  const body = builder.slice(0, builder.search(/\n\}\n/));
  assert.doesNotMatch(body, /\bgit\((repo|dir),/, 'a git call inside the builder bypasses its capped wrapper');
  // EVERY CALL, NOT THE FIRST (G-9 of 20261012-060750-test-cost-r2): a tiny cap fails at the first listing and never
  // reaches the rest, so a later call that dropped its cap stayed green. A distinctive cap large enough to build is
  // recorded on every call through the seam, and the build must succeed with every call carrying it.
  const cap = (1 << 29) + 7;
  const seen = [];
  const recording = (cwd, args, opts = {}) => { seen.push({ args: args.join(' '), maxBuffer: opts.maxBuffer }); return snapGit(cwd, args, opts); };
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.base, dir: path.join(s.d, 'arms'),
    maxBytes: CAP, listingMaxBuffer: cap, runGit: recording });
  assert.equal(r.ok, true, r.why);
  assert.ok(seen.length > 10, `the builder made only ${seen.length} git call(s) through its seam`);
  const uncapped = seen.filter((c) => c.maxBuffer !== cap);
  assert.deepEqual(uncapped, [], 'a git call inside the builder did not carry the listing cap');
  // And a tiny cap fails as an OVERFLOW, not for some other reason.
  const tiny = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.base, dir: path.join(s.d, 'tiny'),
    maxBytes: CAP, listingMaxBuffer: 16 });
  assert.equal(tiny.ok, false, 'the builder ignored a 16-byte listing cap');
  assert.match(tiny.why, /ENOBUFS/, `a 16-byte cap failed for another reason: ${tiny.why}`);
});

// Found by claim-checking the size-cap question (2026-09-27): the cap listed untracked files and files
// modified against the INDEX, so a file already staged was in neither list — and `add -A` still took it.
test('size cap A counts a staged change too', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.join(s.repo, 'staged.bin'), Buffer.alloc(4096));
  git(s.repo, 'add', 'staged.bin');
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.base, dir: path.join(s.d, 'arms'), maxBytes: 1024n });
  assert.equal(r.ok, false, 'a staged 4 KiB file exceeds a 1 KiB cap');
  assert.match(r.why, /exceed the 1024-byte cap/);
});

test('size cap A: over the cap, the build is refused before anything is read', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.join(s.repo, 'untracked.bin'), Buffer.alloc(4096));
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.base, dir: path.join(s.d, 'arms'), maxBytes: 1024n });
  assert.equal(r.ok, false);
  assert.match(r.why, /exceed the 1024-byte cap/);
  assert.equal(fs.existsSync(path.join(s.d, 'arms')), false, 'nothing was built');
});

// THE RUN REMOVES ONLY A DIRECTORY IT CREATED (G-7 of 20261002-225920-stop-child-confirm, HIGH): run-graph named the
// arms' directory for teardown before the build, the build refused it because it already existed, and teardown then
// removed it recursively anyway. And the build's own check-then-`mkdir -p` let a directory created between the two be
// adopted and checked out into. The directory is now created exclusively, and the caller learns it owns it only then.
test('G-7: a directory created after the check is refused, not checked out into', (t) => {
  const { d, repo, base, head } = sandbox(t);
  const dir = path.join(d, 'arms');
  const created = [];
  const r = buildArmsSurface({ repoRoot: repo, headCommit: head, baseCommit: base, dir, maxBytes: CAP,
    afterCapture: () => { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'theirs.txt'), 'RACED'); },
    onCreated: (p) => created.push(p) });
  assert.equal(r.ok, false, 'a directory that appeared mid-build was adopted');
  assert.match(r.why, /already exists/);
  assert.deepEqual(created, []);
  assert.deepEqual(fs.readdirSync(dir), ['theirs.txt'], 'the build wrote into a directory it did not create');
});

test('G-7: the caller is told the moment the build creates the directory, before anything fills it', (t) => {
  const { d, repo, base, head } = sandbox(t);
  const dir = path.join(d, 'arms');
  const seen = [];
  const r = buildArmsSurface({ repoRoot: repo, headCommit: head, baseCommit: base, dir, maxBytes: CAP,
    onCreated: (p) => seen.push([p, fs.readdirSync(p).length]) });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(seen, [[dir, 0]]);
});

test('G-7: run-graph claims the arms\' directory for teardown only from the build\'s onCreated', () => {
  // Source-matched, as this file's run-graph wiring tests are: no test drives run-graph to its panel step.
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
  const assigns = src.match(/panelWorktree = [^;\n]+/g) ?? [];
  assert.deepEqual(assigns.filter((a) => a !== 'panelWorktree = null'), ['panelWorktree = d'],
    `run-graph names the arms' directory for teardown somewhere other than the build's onCreated: ${assigns.join(' | ')}`);
  assert.match(src, /onCreated: \(d\) => \{ panelWorktree = d; \}/);
});

// G-4 of 20261012-063656-test-cost-r3 (pre-existing; operator, 2026-10-12: "Fix now (Recommended)"): an exclude root
// INSIDE the repository whose name starts with two dots (`..private`) failed the filter `!rel.startsWith('..')`, which
// meant to drop roots outside it. The root never reached `:(exclude)`, so `add -A` copied it into the directory the
// external reviewers read.
test('G-4: an excluded root named like ..private stays out of the arms\' directory', (t) => {
  const s = sandbox(t);
  const hidden = path.join(s.repo, '..private');
  fs.mkdirSync(hidden);
  fs.writeFileSync(path.join(hidden, 'secret.txt'), 'must not reach a third party');
  const dir = path.join(s.d, 'arms');
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.base, dir, exclude: [hidden], maxBytes: CAP });
  assert.equal(r.ok, true, r.why);
  assert.equal(fs.existsSync(path.join(dir, '..private', 'secret.txt')), false, 'an excluded ..private root leaked into the snapshot');
  // ONE OWNER (G-3 of 20261012-073027-g4-exclude-review): the fix first re-spelled containment inline. The builder asks
  // isWithin; a hand-written `..` test in its code is a second owner that can drift from the first.
  const code = fs.readFileSync(new URL('../scripts/io/snapshot.mjs', import.meta.url), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /startsWith\(['"]\.\.(\/)?['"]\)/, 'the builder spells containment out instead of asking isWithin');
});

// G-3 of 20261012-181312-g4-exclude-r2: the exclude filter compared paths lexically, case-sensitively. On a
// case-insensitive filesystem an exclude spelled in another case is the same directory, was judged OUTSIDE, was dropped,
// and its contents reached the arms. The filter compares real paths (on-disk case, links resolved).
test('G-3 (r2): an exclude spelled in another case still keeps its root out (case-insensitive filesystems)', (t) => {
  if (process.platform !== 'win32') return t.skip('needs a case-insensitive filesystem');
  const s = sandbox(t);
  fs.mkdirSync(path.join(s.repo, 'hidden'));
  fs.writeFileSync(path.join(s.repo, 'hidden', 'secret.txt'), 'must not reach a third party');
  const dir = path.join(s.d, 'arms');
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.base, dir,
    exclude: [path.join(s.repo.toUpperCase(), 'HIDDEN')], maxBytes: CAP });
  assert.equal(r.ok, true, r.why);
  assert.equal(fs.existsSync(path.join(dir, 'hidden', 'secret.txt')), false, 'an exclude spelled in another case leaked its root');
});

// G-6 of the same review: the source check forbade only the old spelling, so deleting containment altogether stayed
// green. An exclude OUTSIDE the repository must be dropped, not handed to git as `:(exclude)../…`, and the build must
// succeed, which fails if the containment check is gone. And the builder must ask isWithin.
test('G-6 (r2): an exclude outside the repository is dropped by isWithin, and the build still succeeds', (t) => {
  const s = sandbox(t);
  const dir = path.join(s.d, 'arms');
  const r = buildArmsSurface({ repoRoot: s.repo, headCommit: s.head, baseCommit: s.base, dir, exclude: [s.outside], maxBytes: CAP });
  assert.equal(r.ok, true, `an exclude outside the repository broke the build: ${r.why}`);
  const src = fs.readFileSync(new URL('../scripts/io/snapshot.mjs', import.meta.url), 'utf8');
  const builder = src.slice(src.indexOf('export function buildArmsSurface('));
  assert.match(builder.slice(0, builder.search(/\n\}\n/)), /isWithin\(/, 'the builder no longer asks isWithin about containment');
});
