// Three MEDIUMs of run 20260924-163756-post-g9, all in the overlapping-doc-dir snapshot walk, and
// two of them introduced by the G-9 fix one commit earlier.
//
// G-10 (arch-review): the G-9 fix put a SECOND copy of "what counts as a document" into the
// orchestrator — `e.name.endsWith('.md')`, case-sensitive — while snapshotAdmits owns it as
// `/\.md$/i`. Two owners that already disagreed: `NOTES.MD` passes the predicate and was passed
// over by the walk before the predicate ever saw it.
//
// G-11 (panel-codex-code, panel-codex-security): the walk classified each entry by its DIRENT,
// and a Dirent reports a link's own type. A link to a directory is therefore never a directory:
// named `alias.md` it was judged as a document, admitted (its target's name ends `.md` too), and
// handed to copyFileSync, which throws on a directory — EISDIR on POSIX, EPERM on Windows — with no
// try around it, aborting the orchestrator. Named anything else, it was dropped with no record.
//
// G-12 (panel-codex-code, panel-codex-security): the snapshot name flattened every separator to
// `__`, which is not injective — `docs/a/b.md` and `docs/a__b.md` became one file, and
// copyFileSync let the second silently replace the first.
//
// THE DECISION WAS EXTRACTED FIRST, UNCHANGED, so these tests run against real directories rather
// than against the walk's source text. A directory JUNCTION needs no privilege on Windows where a
// file symlink does, which is what made the link cases untestable on this machine until now.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifySnapshotEntry, snapshotAdmits, snapshotName } from '../scripts/lib/finding-scope.mjs';
import { makeLink } from './helpers.mjs';

function fixture(t) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-snapent-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repo = path.join(tmp, 'repo');
  const docs = path.join(repo, 'shared');
  fs.mkdirSync(docs, { recursive: true });
  return { repo, docs };
}

// The classifier is PURE since G-4 of post-med4: it takes the entry's own type and, when it asks,
// the resolved target. This does the resolving the way run-graph's walk does, so the link cases
// still run against a real filesystem.
function classify({ repo, docs }, name) {
  const entry = fs.readdirSync(docs, { withFileTypes: true }).find((e) => e.name === name);
  assert.ok(entry, `fixture entry ${name} exists`);
  const facts = { name, isFile: entry.isFile(), isDirectory: entry.isDirectory(), docRoot: docs, repoRoot: repo };
  const first = classifySnapshotEntry(facts);
  if (first.action !== 'resolve') return first;
  const full = path.join(docs, name);
  const resolved = (() => { try { return fs.realpathSync(full); } catch { return null; } })();
  const targetIsDir = resolved !== null && fs.statSync(resolved).isDirectory();
  return classifySnapshotEntry({ ...facts, resolved, targetIsDir });
}

function junction(t, target, link) {
  return makeLink(t, { target, at: link, type: 'junction' }) !== null;
}

test('G-10: one rule for what a document is — an upper-case .MD is copied, not passed over', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.docs, 'NOTES.MD'), '# notes\n');
  assert.equal(snapshotAdmits({ docRoot: f.docs, repoRoot: f.repo, resolved: path.join(f.docs, 'NOTES.MD') }).ok, true,
    'the predicate admits it');
  assert.equal(classify(f, 'NOTES.MD').action, 'copy',
    'and the walk must agree with the predicate rather than skip it on a case-sensitive name test');
});

test('G-10: the walk carries no private copy of the document rule', () => {
  // The walk moved into io/doc-snapshot.mjs in contract-glob-grammar stage 4; the claim is unchanged.
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'io', 'doc-snapshot.mjs'), 'utf8');
  const walk = src.slice(src.indexOf('const walk = (dir) =>'), src.indexOf('walk(abs);'));
  assert.ok(walk.length > 0, 'the walk is where it is expected to be');
  assert.doesNotMatch(walk, /endsWith\(\s*'\.md'\s*\)/, 'a second owner of the rule is how the two came to disagree');
  const lib = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'lib', 'finding-scope.mjs'), 'utf8');
  const body = lib.slice(lib.indexOf('export function classifySnapshotEntry'));
  assert.doesNotMatch(body, /endsWith\(\s*'\.md'\s*\)/, 'nor does the extracted classifier');
});

test('G-11: a link to a directory named like a document is never copied', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.docs, 'real.md'));
  fs.writeFileSync(path.join(f.docs, 'real.md', 'inner.md'), '# inner\n');
  if (!junction(t, path.join(f.docs, 'real.md'), path.join(f.docs, 'alias.md'))) return;
  const c = classify(f, 'alias.md');
  assert.notEqual(c.action, 'copy', 'copyFileSync on a directory throws and aborts the orchestrator');
  // Proof that the copy branch is fatal, not merely wrong.
  assert.throws(() => fs.copyFileSync(path.join(f.docs, 'alias.md'), path.join(f.repo, 'out.md')));
});

test('G-11: a link to a directory is recorded, not dropped in silence', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.docs, 'guides'));
  fs.mkdirSync(path.join(f.repo, 'scripts'));
  if (!junction(t, path.join(f.docs, 'guides'), path.join(f.docs, 'linked'))) return;
  if (!junction(t, path.join(f.repo, 'scripts'), path.join(f.docs, 'outward'))) return;
  for (const name of ['linked', 'outward']) {
    const c = classify(f, name);
    assert.equal(c.action, 'refuse', `${name}: a linked directory must reach not_checked[], not vanish`);
    assert.ok(c.why && c.why.length > 10, `${name}: with a reason a reader can act on`);
  }
});

test('the ordinary cases are unchanged', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.docs, 'a.md'), '# a\n');
  fs.writeFileSync(path.join(f.docs, 'data.json'), '{}');
  fs.mkdirSync(path.join(f.docs, 'nested'));
  assert.equal(classify(f, 'a.md').action, 'copy');
  assert.equal(classify(f, 'data.json').action, 'skip', 'a non-document file is passed over, not logged as refused');
  assert.equal(classify(f, 'nested').action, 'walk');
});

test('G-12: two different documents never share a snapshot name', () => {
  const pairs = [
    ['docs/a/b.md', 'docs/a__b.md'],
    ['docs/a/b.md', 'docs__a/b.md'],
    [path.join('docs', 'a', 'b.md'), 'docs/a__b.md'],
  ];
  for (const [x, y] of pairs) {
    assert.notEqual(snapshotName(x), snapshotName(y), `${x} and ${y} must not overwrite each other`);
  }
  assert.equal(snapshotName('docs/a/b.md'), snapshotName(path.join('docs', 'a', 'b.md')),
    'the same document names the same file on either separator');
  assert.equal(snapshotName('shared/disk-first-protocol.md'), 'shared__disk-first-protocol.md',
    'and the common case keeps the name the briefs describe');
});

test('G-12: every write into the snapshot goes through the one recording copier', () => {
  // snapshotName makes PATH-derived names injective, but the doctrine and request copies write
  // fixed-prefix names into the same directory, and a consumer's `shared/x.md` meets the mounted
  // doctrine's `x.md` on one name by construction. A raw copyFileSync there overwrites in silence.
  // The copier moved into io/doc-snapshot.mjs's createSnapshot in contract-glob-grammar stage 4. The claim is unchanged:
  // into the SNAPSHOT DIRECTORY there is one raw copy, the recording copier's. docReadDirs keeps one raw copy of its own,
  // the contract snapshot into the sandbox ROOT — a different directory, so no snapshot name can collide with it.
  const mod = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'io', 'doc-snapshot.mjs'), 'utf8');
  // The copier writes the content it read from the checked descriptor (G-5 of 20261112-050334-hl-review-b), so its one raw
  // write is a writeFileSync into the snapshot directory, no longer a copyFileSync of the path; either spelling counts.
  const rawMod = mod.split('\n').filter((l) => /(copyFileSync|writeFileSync)\(/.test(l) && !/^\s*\/\//.test(l));
  assert.equal(rawMod.length, 1, `exactly one raw copy in the module — the copier — and it was: ${JSON.stringify(rawMod)}`);
  assert.match(rawMod[0], /path\.join\(snapDir, name\)/, 'and that one is the copier itself');
  assert.match(mod, /onSkip\(\{ item: `doc snapshot \$\{name\}`/,
    'a document replaced by a different one on the same name is recorded, not silently gone');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
  const start = src.indexOf('function docReadDirs(');
  const fn = src.slice(start, src.indexOf('\nfunction ', start + 1));
  // REWRITTEN for run-dir-descendants.plan.md stage 2: docReadDirs keeps no raw copy now. The contract snapshot goes into
  // the sandbox ROOT through the run owner, and every snapshot copy through the recording copier, whose write the run
  // owner makes, so the collision record still sees every copy into the snapshot directory.
  const raw = fn.split('\n').filter((l) => /copyFileSync\(/.test(l) && !/^\s*\/\//.test(l));
  assert.deepEqual(raw, [], `docReadDirs copies nothing raw: ${JSON.stringify(raw)}`);
  assert.match(fn, /runOwner\.replace\(\['sandbox', nodeId, 'contract\.snapshot\.md'\]/, 'the contract snapshot goes into the sandbox root, not the snapshot directory');
  // The writer is given the content the copier read and checked (G-5 of 20261112-050334-hl-review-b), not the path.
  assert.match(fn, /createSnapshot\(snapDir, \{[^}]*write: \(name, content\) => runOwner\.replace\(\['sandbox', nodeId, 'declared-docs', name\], content\)/,
    'every snapshot copy goes through the recording copier, written by the run owner');
});
