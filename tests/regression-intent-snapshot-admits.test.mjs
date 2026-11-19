// G-16 of run 20260924-123916-verbatim-guards — MEDIUM, raised by `security-audit` (opus) AND
// `contract-audit` (opus), with `panel-codex-perf` on a separate point at the same line.
//
// MY FIX DID NOT ADDRESS THE THREAT MY OWN COMMENT NAMED. The G-26 guard checked that a doc entry
// resolves INSIDE the repository, and the comment above it said the danger is a link pointing "at
// the source this sandbox exists to hide". `docs/x.md -> scripts/foo.mjs` resolves inside the
// repository, so it passed — and copyFileSync put implementation bytes into the intent snapshot,
// which is the one boundary intent-capture exists to hold (Rule 2).
//
// THE SECOND ANSWER WAS WORSE, AND ONLY RUNNING IT SHOWED THAT. Refusing anything that resolves
// under `source_globs` looks right until you read this repository's contract:
//
//   source_globs: ["scripts/**", "shared/**", ...]
//   doc_paths:    ["shared/**", "CLAUDE.md", ...]
//
// `shared/**` is in BOTH, and that overlap is the very condition that triggers snapshotting. The
// guard skipped every doctrine document intent-capture exists to read. A guard that empties the
// thing it protects is not a guard — and the unit tests passed throughout, because they used
// invented globs where docs and source were disjoint. The real contract is the case that matters.
//
// The rule that survives contact: an entry must RESOLVE TO WHERE IT CLAIMS TO BE — inside the doc
// directory being walked. A real file does; a link to source, to reviews, to generated output or
// out of the repository does not. One rule, no glob classification.
//
// The decision is extracted because symlinks cannot be created by an unprivileged user on every
// machine this suite runs on (this one included). A predicate over a resolved path is testable
// everywhere; the filesystem feature is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// A filesystem root that is absolute on THIS platform. Fixtures written as 'F:/repo' are not absolute on POSIX,
// so every Linux CI run failed them (diagnosed 2026-10-06, run 37552051536).
const FS_ROOT = path.parse(process.cwd()).root;
import { snapshotAdmits } from '../scripts/lib/finding-scope.mjs';

const REPO = path.join(FS_ROOT, 'repo');
const DOCS = path.join(REPO, 'shared');
const base = { docRoot: DOCS, repoRoot: REPO };

test('a real document under a doc dir that overlaps source is ADMITTED', () => {
  // THE CASE THE SECOND ATTEMPT BROKE. `shared/**` is declared source AND doc here, which is why
  // the snapshot path runs at all. Every doctrine file must still reach the intent node.
  for (const doc of ['disk-first-protocol.md', 'adapter-contract.md', 'graph-topologies.md']) {
    const r = snapshotAdmits({ ...base, resolved: path.join(DOCS, doc) });
    assert.equal(r.ok, true, `${doc} is a declared document and must be snapshotted`);
  }
  assert.equal(snapshotAdmits({ ...base, resolved: path.join(DOCS, 'nested', 'deep.md') }).ok, true);
});

test('a link out of the doc directory is refused, wherever it points', () => {
  const cases = [
    ['source', path.join(REPO, 'scripts', 'run-graph.mjs')],
    ['the reviews tree', path.join(REPO, '.claude', 'reviews', 'r1', 'gate.md')],
    ['generated output', path.join(REPO, 'node_modules', 'pkg', 'readme.md')],
    ['outside the repository', path.join(FS_ROOT, 'Users', 'x', 'credentials.env')],
  ];
  for (const [what, resolved] of cases) {
    const r = snapshotAdmits({ ...base, resolved });
    assert.equal(r.ok, false, `a link to ${what} must not be snapshotted`);
    assert.ok(r.why.length > 10, 'and the refusal must be reportable — I-9 forbids a silent skip');
  }
});

test('an unresolvable entry is refused rather than assumed', () => {
  // realpathSync throws on a broken or circular link; the caller passes null.
  const r = snapshotAdmits({ ...base, resolved: null });
  assert.equal(r.ok, false);
  assert.match(r.why, /broken or circular|no resolvable/i);
});

// ============ THIRD ITERATION ON THIS GUARD, and the first two were both wrong in ways only a
// reviewer caught. Recorded together because the sequence is the lesson.
//
//   1. G-26: no check at all — a symlink's bytes were copied by name alone.
//   2. G-16: "resolves inside the repository" — which admits `docs/x.md -> scripts/foo.mjs`, the
//      threat the walk's own comment named.
//   3. G-16 again: "not under source_globs" — which refused every doctrine document, because this
//      contract declares `shared` as BOTH source and doc.
//   4. G-14 (here): "resolves inside the doc dir" — which STILL admits
//      `shared/leak.md -> shared/private-source.mjs`, because that doc dir IS a source root. The
//      overlap that makes this code path exist is the same overlap that defeats each rule aimed at
//      the neighbourhood rather than at the file.
//
// The entry's NAME was checked for `.md`; its TARGET never was. That is the whole defect, and the
// rule that follows from it needs no glob and no neighbourhood: a document must resolve to a
// DOCUMENT.
//
// G-17 rides along, from `code-audit`: `resolved` is realpath'd while `docRoot` and `repoRoot` are
// only lexically resolved. The guard this replaced realpath'd BOTH sides deliberately, so on a
// machine whose repository path passes through a symlink — /tmp on macOS, a junction on Windows —
// containment compared a real path against a lexical one and refused valid documents.
test('a document must resolve to a DOCUMENT, not merely into the right directory', () => {
  const REPO = path.join(FS_ROOT, 'repo');
  const DOCS = path.join(REPO, 'shared');
  const b = { docRoot: DOCS, repoRoot: REPO };

  assert.equal(snapshotAdmits({ ...b, resolved: path.join(DOCS, 'disk-first-protocol.md') }).ok, true);

  // THE CASE THAT SURVIVED TWO FIXES: inside docRoot, but not a document.
  const leak = snapshotAdmits({ ...b, resolved: path.join(DOCS, 'private-source.mjs') });
  assert.equal(leak.ok, false, 'a link named .md pointing at source is the threat, and it lives INSIDE the doc dir');
  assert.match(leak.why, /document|\.md/i);

  for (const ext of ['.mjs', '.js', '.json', '.env', '']) {
    assert.equal(snapshotAdmits({ ...b, resolved: path.join(DOCS, `x${ext}`) }).ok, false,
      `a target ending ${JSON.stringify(ext)} is not a document`);
  }
});

test('containment compares like with like, so a symlinked repo path still works', () => {
  // G-17, code-audit. escapesAfterRealpath realpath'd BOTH sides; snapshotAdmits realpath'd one.
  // The function takes both already-resolved, and the CALLER is what must resolve them — asserted
  // at the call site rather than here, because this predicate cannot see the filesystem.
  // The walk moved into io/doc-snapshot.mjs in contract-glob-grammar stage 4; the claim is unchanged.
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'io', 'doc-snapshot.mjs'), 'utf8');
  const walk = src.slice(src.indexOf('const walk = (dir) =>'), src.indexOf('walk(abs);'));
  assert.ok(/docRoot:\s*realDocRoot/.test(walk),
    'the doc root handed to the guard must be realpath resolved, or a symlinked checkout refuses everything');
  assert.ok(/repoRoot:\s*realRepoRoot/.test(walk),
    'and so must the repository root');
});

// G-9 of run 20260924-154621-post-med3 — HIGH, `panel-codex-code`, verified in source by the
// reconciler. A REGRESSION introduced by the G-14 fix one commit earlier.
//
// snapshotAdmits was called on EVERY walk entry before `e.isDirectory()` was consulted, and G-14
// taught it to refuse any target not ending `.md`. A directory never ends `.md`, so every
// subdirectory under an overlapping doc root was refused and nested doctrine never reached the
// intent snapshot. HIGH because intent is the criterion every other node is judged against.
//
// THE LIVE CHECK COULD NOT SEE IT. Each fix to this guard was verified by running the walk and
// counting "doc snapshot skipped" — zero every time — but this repository's `shared/` has no
// subdirectories, so the one layout that exposes the bug does not exist here. A verification run
// on a tree that cannot express the failure is not a verification. This test carries the nested
// case the repository cannot.
//
// Second consequence of the same ordering: every non-`.md` FILE was also run through the guard and
// logged into the gate's Not-checked table as a skipped document. Invisible here for the same
// reason — `shared/` is all Markdown — and pure noise on any consumer whose doc dir is not.
test('a SUBDIRECTORY of the doc root is admitted for traversal, not refused for lacking .md', () => {
  const REPO = path.join(FS_ROOT, 'repo');
  const DOCS = path.join(REPO, 'shared');
  const b = { docRoot: DOCS, repoRoot: REPO };

  const nested = snapshotAdmits({ ...b, resolved: path.join(DOCS, 'guides'), kind: 'directory' });
  assert.equal(nested.ok, true, 'a subdirectory is a container to walk, not a document to copy');

  // Containment still applies to directories — a linked directory pointing out of the doc tree
  // must not be walked into.
  assert.equal(snapshotAdmits({ ...b, resolved: path.join(REPO, 'scripts'), kind: 'directory' }).ok, false);
  assert.equal(snapshotAdmits({ ...b, resolved: path.join(FS_ROOT, 'elsewhere'), kind: 'directory' }).ok, false);

  // And a DOCUMENT still has to be one — the G-14 rule is kept, only scoped to what it is about.
  assert.equal(snapshotAdmits({ ...b, resolved: path.join(DOCS, 'x.mjs'), kind: 'document' }).ok, false);
  assert.equal(snapshotAdmits({ ...b, resolved: path.join(DOCS, 'guides', 'y.md'), kind: 'document' }).ok, true);
});

test('the walk guards only what it acts on, so an ordinary non-doc file is not a "skipped document"', () => {
  // MOVED, NOT DROPPED (run 20260924-163756-post-g9, G-10/G-11). This asserted the ORDER of an
  // inline pre-filter and guard in the walk's source. The decision now lives in
  // classifySnapshotEntry, and regression-snapshot-entry-target.test.mjs holds it to the behaviour
  // on a real tree: a non-document file is `skip`, never `refuse`, and a directory is judged as a
  // directory. Its kind now comes from the RESOLVED target — the Dirent-based kind asserted here was
  // G-11's defect, a link to a directory classed as a document and handed to copyFileSync.
  const lib = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'lib', 'finding-scope.mjs'), 'utf8');
  const classifier = lib.slice(lib.indexOf('export function classifySnapshotEntry'));
  // Pure since G-4 of post-med4: the entry's own type and name arrive as parameters.
  const filterAt = classifier.indexOf('isFile && !isDocumentName(name)');
  const guardAt = classifier.indexOf('snapshotAdmits(');
  assert.ok(filterAt > -1, 'entries the walk neither traverses nor copies must be passed over first');
  assert.ok(filterAt < guardAt, 'and BEFORE the guard, or they are logged into not_checked[] as refusals');
  const call = classifier.slice(guardAt, classifier.indexOf(');', guardAt));
  assert.match(call, /kind:\s*dir\s*\?\s*'directory'\s*:\s*'document'/,
    'the guard must be told which kind of entry it is judging, from what the entry resolves to');
});
