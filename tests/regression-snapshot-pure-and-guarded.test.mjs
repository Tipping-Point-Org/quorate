// Three MEDIUMs of run 20260924-172034-post-med4, each left behind by the remediation of the run
// before it (G-10/G-11/G-12 of post-g9) or by the line it touched without closing.
//
// G-4 (arch-review, contract-audit, panel-codex-arch, panel-codex-contract — the best-supported group
// of the run): moving classifySnapshotEntry into lib/ put fs.realpathSync and fs.statSync into the
// PURE layer, which ARCHITECTURE §2 defines as "No I/O ... Inputs arrive as parameters". The move
// was made to get the decision under test; it bought that by breaking the layer's one rule. The
// decision now takes the resolved target as parameters and run-graph does the resolving.
//
// G-8 (panel-codex-code, panel-codex-security): snapCopy recorded a replaced document by comparing
// snapshot names case-SENSITIVELY, while the default filesystems of win32 and darwin are not. Two
// names differing only in case land on one file there, and the replacement went unrecorded — the
// exact silence snapCopy exists to end.
//
// G-10 (panel-codex-security; the ledger has it five times since 2026-09-02): a doc_paths entry that
// is a single FILE went straight to the snapshot with only a leaves-the-repository check. An
// in-repository link `docs/requirements.md -> scripts/secret.mjs` passes that, and implementation
// bytes reach the intent sandbox — the boundary Rule 2 exists to hold. The walk has had a
// target-aware guard since G-14; the single-file branch never did.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// A filesystem root that is absolute on THIS platform. Fixtures written as 'F:/repo' are not absolute on POSIX,
// so every Linux CI run failed them (diagnosed 2026-10-06, run 37552051536).
const FS_ROOT = path.parse(process.cwd()).root;
import * as scope from '../scripts/lib/finding-scope.mjs';

const LIB = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'lib', 'finding-scope.mjs'), 'utf8');
const RUN_GRAPH = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');
// The snapshot walk and its copier moved here in contract-glob-grammar stage 4.
const DOC_SNAPSHOT = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'io', 'doc-snapshot.mjs'), 'utf8');

function fnBody(src, header) {
  const start = src.indexOf(header);
  assert.ok(start > -1, `${header} exists`);
  const next = src.indexOf('\nexport function ', start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

test('G-4: the snapshot classifier does no I/O — the resolved target arrives as a parameter', () => {
  const body = fnBody(LIB, 'export function classifySnapshotEntry');
  assert.doesNotMatch(body, /\bfs\./, 'lib/ is the pure layer: no filesystem calls (ARCHITECTURE §2)');
});

test('G-4: the classifier decides from parameters alone', () => {
  const REPO = path.join(FS_ROOT, 'repo');
  const DOCS = path.join(REPO, 'shared');
  const at = (name, over = {}) => scope.classifySnapshotEntry({
    name, isFile: true, isDirectory: false, resolved: path.join(DOCS, name), targetIsDir: false,
    docRoot: DOCS, repoRoot: REPO, ...over,
  });
  assert.equal(at('a.md').action, 'copy');
  assert.equal(at('NOTES.MD').action, 'copy', 'G-10 of post-g9 stays fixed: one document rule, case-insensitive');
  assert.equal(at('data.json').action, 'skip');
  assert.equal(at('nested', { isFile: false, isDirectory: true, targetIsDir: true }).action, 'walk');
  // G-11 of post-g9 stays fixed: a link (neither file nor directory by its Dirent) to a directory.
  const alias = at('alias.md', { isFile: false, isDirectory: false, resolved: path.join(DOCS, 'real.md'), targetIsDir: true });
  assert.equal(alias.action, 'refuse');
  assert.equal(at('gone.md', { isFile: false, resolved: null }).action, 'refuse', 'a broken link is refused, not copied');
  assert.equal(at('leak.md', { isFile: false, resolved: path.join(REPO, 'scripts', 'x.mjs') }).action, 'refuse');
});

test('G-8: a snapshot name is keyed the way the destination filesystem compares names', () => {
  assert.equal(typeof scope.snapshotNameKey, 'function', 'the key rule has an owner in the pure layer');
  assert.equal(scope.snapshotNameKey('Guide.md', { caseInsensitive: true }), scope.snapshotNameKey('guide.md', { caseInsensitive: true }),
    'on win32 and darwin Guide.md and guide.md are ONE file, so they are one key');
  assert.notEqual(scope.snapshotNameKey('Guide.md', { caseInsensitive: false }), scope.snapshotNameKey('guide.md', { caseInsensitive: false }),
    'and on a case-sensitive filesystem they are two, so recording a "replacement" would be false');
});

test('G-8: snapCopy keys its record through that rule, with the platform decided by the caller', () => {
  const start = DOC_SNAPSHOT.indexOf('export function createSnapshot(');
  assert.ok(start > -1, 'the recording copier exists');
  const body = DOC_SNAPSHOT.slice(start, DOC_SNAPSHOT.indexOf('\n}', start));
  assert.match(body, /snapshotNameKey\(/, 'the collision record must compare names as the filesystem does');
  // The platform is the caller's decision: run-graph hands it in.
  assert.match(RUN_GRAPH, /createSnapshot\(snapDir, \{ caseInsensitive/, 'run-graph does not decide the platform for the copier');
});

test('G-10: a declared single-file document is admitted only if it IS what it is declared as', () => {
  assert.equal(typeof scope.declaredFileAdmits, 'function', 'the rule has an owner in the pure layer');
  const REPO = path.join(FS_ROOT, 'repo');
  const ok = (rel, resolved, caseInsensitive = false) => scope.declaredFileAdmits({ realRepoRoot: REPO, rel, resolved, caseInsensitive });

  assert.equal(ok('CLAUDE.md', path.join(REPO, 'CLAUDE.md')).ok, true, 'a real file at its declared path');
  assert.equal(ok(path.join('docs', 'spec.txt'), path.join(REPO, 'docs', 'spec.txt')).ok, true,
    'a declared document need not be Markdown — the contract names it, and that is the declaration');

  const leak = ok(path.join('docs', 'requirements.md'), path.join(REPO, 'scripts', 'secret.mjs'));
  assert.equal(leak.ok, false, 'an in-repository link to source is the threat');
  assert.ok(leak.why.length > 10, 'and the refusal is reportable (I-9)');
  assert.equal(ok(path.join('docs', 'a.md'), path.join(REPO, 'docs', 'b.md')).ok, false,
    'a link to another document is still not the declared file — declare the target instead');
  assert.equal(ok('x.md', null).ok, false, 'a broken link is refused');

  assert.equal(ok('claude.md', path.join(REPO, 'CLAUDE.md'), true).ok, true,
    'on a case-insensitive filesystem a declared name in another case is the same file');
  assert.equal(ok('claude.md', path.join(REPO, 'CLAUDE.md'), false).ok, false);
});

test('G-10: the single-file branch applies that guard before copying', () => {
  // In io/doc-snapshot.mjs since contract-glob-grammar stage 4; the claim is unchanged.
  const fn = DOC_SNAPSHOT.slice(DOC_SNAPSHOT.indexOf('export function snapshotDocGlobs('));
  const copyAt = fn.indexOf('snap.copy(abs, ');
  assert.ok(copyAt > -1, 'the single-file copy is where it is expected to be');
  const guardAt = fn.lastIndexOf('declaredFileAdmits(', copyAt);
  assert.ok(guardAt > -1, 'a single-file document must pass the guard before it is copied');
  assert.ok(fn.slice(guardAt, copyAt).includes('skipped('), 'and a refusal is recorded, not silent');
});
