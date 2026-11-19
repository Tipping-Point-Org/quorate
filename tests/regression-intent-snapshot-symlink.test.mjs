// G-26 of run 20260924-021736-post-remediation — MEDIUM, panel-codex-security, verified in source.
//
// When a declared doc directory overlaps a source root, run-graph SNAPSHOTS it rather than
// live-mounting it, so the intent node reads documents without reaching the implementation it is
// supposed to precede (Rule 2). The walk copied every nested `*.md` with `copyFileSync` and no
// containment check.
//
// `readdirSync(..., { withFileTypes: true })` reports a symlink's OWN type, so a symlink is not a
// directory and falls through to the `.md` branch — and `copyFileSync` FOLLOWS it. A tracked
// `docs/leak.md` pointing at a credential file, or at the source the sandbox exists to hide, has
// its bytes copied into the snapshot and sent to the intent model.
//
// It takes a hostile tracked symlink, which is why it is MEDIUM rather than higher. But the intent
// sandbox is the one boundary in this system whose whole purpose is that a node cannot read the
// implementation, and a boundary that copies whatever a link points at is not one.
//
// THIS TEST BUILDS THE SCENARIO rather than asserting the guard's own words: a repo, a doc dir, a
// secret outside the repo, and a symlink to it named like a document.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { escapesAfterRealpath } from '../scripts/io/finding-scope.mjs';

test('a doc-shaped symlink pointing outside the repo is not snapshot material', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-snap-'));
  try {
    const repo = path.join(tmp, 'repo');
    const docs = path.join(repo, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, 'real.md'), '# a genuine document\n');

    // The thing a leak would target: outside the repository entirely.
    const secret = path.join(tmp, 'credentials.env');
    fs.writeFileSync(secret, 'ANTHROPIC_API_KEY=sk-do-not-copy-me\n');

    const link = path.join(docs, 'leak.md');
    try {
      fs.symlinkSync(secret, link, 'file');
    } catch {
      return t.skip('this platform/user cannot create symlinks');
    }

    // The walk's own test: `withFileTypes` reports the LINK's type, so it is not a directory and
    // reaches the `.md` branch exactly like `real.md` does.
    const entries = fs.readdirSync(docs, { withFileTypes: true });
    const linkEntry = entries.find((e) => e.name === 'leak.md');
    assert.equal(linkEntry.isDirectory(), false, 'a symlink is not reported as a directory');
    assert.ok(linkEntry.name.endsWith('.md'), 'so it reaches the copy branch on name alone');

    // And copyFileSync would follow it — this is the defect, demonstrated rather than asserted.
    const followed = path.join(tmp, 'followed.md');
    fs.copyFileSync(link, followed);
    assert.match(fs.readFileSync(followed, 'utf8'), /sk-do-not-copy-me/,
      'copyFileSync copies the TARGET bytes, which is how a credential reaches the sandbox');

    // THE GUARD that must stand between them.
    assert.equal(escapesAfterRealpath(repo, link), true,
      'the link resolves outside the repository, so it is not repository content');
    assert.equal(escapesAfterRealpath(repo, path.join(docs, 'real.md')), false,
      'a genuine document must still be snapshotted — a guard that refuses everything is not a guard');

    // A symlink pointing INSIDE the repo is still repository content and must be admitted.
    const inside = path.join(docs, 'alias.md');
    fs.symlinkSync(path.join(docs, 'real.md'), inside, 'file');
    assert.equal(escapesAfterRealpath(repo, inside), false,
      'an internal alias is content the node may already read; containment is the rule, not link-phobia');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('run-graph applies that guard in the snapshot walk', () => {
  // The walk moved into io/doc-snapshot.mjs in contract-glob-grammar stage 4; the claim is unchanged.
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'io', 'doc-snapshot.mjs'), 'utf8');
  const walk = src.slice(src.indexOf('const walk = (dir) =>'), src.indexOf('walk(abs);'));
  // `snapshotAdmits` SUBSUMES the containment check this test originally asserted, and is stricter:
  // containment alone admitted `docs/x.md -> scripts/foo.mjs`, which is the threat the walk's own
  // comment named and G-16 caught. Asserting the stronger guard is not weakening this test.
  //
  // MOVED, NOT DROPPED (run 20260924-163756-post-g9, G-10/G-11): the per-entry decision now lives in
  // lib/finding-scope.mjs's classifySnapshotEntry, which is exercised against real directory links
  // in regression-snapshot-entry-target.test.mjs. What stays here is that the walk delegates to it,
  // and that the classifier still resolves the entry and still applies the full guard.
  assert.ok(walk.includes('classifySnapshotEntry('),
    'the snapshot walk must judge an entry through the one classifier, not an inline copy of it');
  const lib = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'lib', 'finding-scope.mjs'), 'utf8');
  const classifier = lib.slice(lib.indexOf('export function classifySnapshotEntry'));
  assert.ok(classifier.includes('snapshotAdmits('),
    'the classifier must judge an entry by where it RESOLVES, against every rule and not only containment');
  // The RESOLVING is the caller's since G-4 of post-med4 — lib/ does no I/O — so it is asserted on
  // the walk, and the classifier is asserted to ask for it rather than decide without it.
  // Through the walk's `realpath` parameter since 20261001-155615-cgg-review-r3 (defaulting to fs.realpathSync), so a test
  // can simulate a link where the host cannot make one; the claim is unchanged.
  assert.ok(/realpath\(full\)/.test(walk),
    'and the walk must resolve the entry first, or the rules are applied to the link rather than its target');
  assert.ok(classifier.includes("action: 'resolve'"),
    'which the classifier must ask for before judging anything that is not a plain file');
  // The module records through its caller's onSkip (run-graph's recordSkip pushes docSnapshotSkips).
  assert.ok(walk.includes('skipped('),
    'a refusal must be recorded — I-9 names a guard that refuses an input silently as a failure mode');
});
