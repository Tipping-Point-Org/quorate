// G-17: the intent-input hash covered every file beneath a glob's base directory, matching or not.
//
// `expandDocPattern` derived the directory before the first wildcard and then walked it whole, so a
// declared `doc_paths: ["**/*.md"]` resolved to a base of `.` and hashed the ENTIRE repository —
// every script, every test, every bench artifact.
//
// Reported as a performance finding, and it is one, but the cost that matters is correctness. The
// hash exists to pin an intent so the bar a run is judged against stays stable, and its own
// docstring promises it covers "exactly the inputs intent-capture reads". Covering the whole tree
// meant any source edit invalidated the pinned intent — so the cache that keeps the bar STABLE was
// being reset by changes to the very code being judged against it. The symptom is nothing at all:
// a fresh derivation, twelve minutes, no message, and a bar that quietly moved.
//
// The matcher is `coveredByGlobs`, the one scope derivation already uses. A second matcher would be
// a second vocabulary for what a contract glob means, and the two would drift.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { intentInputHash } from '../scripts/io/intent-cache.mjs';
import { REPO_ROOT } from './helpers.mjs';

function fixture() {
  const sandbox = path.join(REPO_ROOT, '.sandbox');
  fs.mkdirSync(sandbox, { recursive: true });
  const dir = fs.mkdtempSync(path.join(sandbox, 'intent-glob-'));
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'intent.md'), '# the criteria\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# readme\n');
  fs.writeFileSync(path.join(dir, 'src', 'impl.mjs'), 'export const v = 1;\n');
  return dir;
}

test('regression: editing a non-matching file does not move the hash', () => {
  // THE DEFECT, stated as the property it broke. `**/*.md` declares documents; a change to a .mjs
  // is not a change to the declared inputs, and must not invalidate a pinned intent.
  const dir = fixture();
  try {
    const before = intentInputHash({ repoRoot: dir, docPaths: ['**/*.md'] });
    fs.writeFileSync(path.join(dir, 'src', 'impl.mjs'), 'export const v = 2;\n');
    const after = intentInputHash({ repoRoot: dir, docPaths: ['**/*.md'] });
    assert.equal(after, before, 'a source edit must not invalidate an intent pinned to documents');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('regression: editing a matching file DOES move the hash', () => {
  // The other half, and the one that makes the test above meaningful rather than a hash that
  // ignores everything: narrowing the input set must not narrow it to nothing.
  const dir = fixture();
  try {
    const before = intentInputHash({ repoRoot: dir, docPaths: ['**/*.md'] });
    fs.writeFileSync(path.join(dir, 'docs', 'intent.md'), '# the criteria, revised\n');
    const after = intentInputHash({ repoRoot: dir, docPaths: ['**/*.md'] });
    assert.notEqual(after, before, 'a declared document changing is exactly what must re-derive the intent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('regression: a directory pattern still contributes its whole subtree', () => {
  // `shared/**` declares a TREE, and everything in it was declared by naming it. The narrowing
  // applies to a glob's own suffix, not to directory declarations — tightening this would silently
  // drop doc files with no extension in the pattern.
  const dir = fixture();
  try {
    const before = intentInputHash({ repoRoot: dir, docPaths: ['src/**'] });
    fs.writeFileSync(path.join(dir, 'src', 'impl.mjs'), 'export const v = 3;\n');
    const after = intentInputHash({ repoRoot: dir, docPaths: ['src/**'] });
    assert.notEqual(after, before, 'a declared subtree covers what it contains, whatever the extension');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('regression: a literal path is unaffected by the narrowing', () => {
  const dir = fixture();
  try {
    const before = intentInputHash({ repoRoot: dir, docPaths: ['README.md'] });
    fs.writeFileSync(path.join(dir, 'README.md'), '# readme, edited\n');
    const after = intentInputHash({ repoRoot: dir, docPaths: ['README.md'] });
    assert.notEqual(after, before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// THE WALK DESCENDED INTO THE TREE IT WAS ABOUT TO DISCARD (G-25, perf-audit).
//
// A doc_paths entry whose first wildcard sits at or above a generated tree — `**/*.md` resolves its
// base to the repository root — lstat'd every file under `.claude/reviews/**`, which accumulates a
// directory per run holding per-node output capped at 64 MiB. The reviews directory was then removed
// from the FINISHED list, so the cost was paid and the benefit discarded: the walk's own comment
// claimed "a run directory is generated output, never an input to the criteria" while naming only
// node_modules and .git.
test('the doc walk prunes the reviews directory instead of walking and discarding it', async () => {
  const { intentInputHash } = await import('../scripts/io/intent-cache.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-prune-'));
  try {
    fs.writeFileSync(path.join(root, 'README.md'), '# doc\n');
    const reviews = path.join(root, '.claude', 'reviews', '20260101-000000-x', 'evidence', 'lens');
    fs.mkdirSync(reviews, { recursive: true });
    fs.writeFileSync(path.join(reviews, 'build.log'), 'noise\n');
    fs.writeFileSync(path.join(root, '.claude', 'reviews', '20260101-000000-x', 'notes.md'), '# not an input\n');

    const args = { repoRoot: root, docPaths: ['**/*.md'], reviewsDir: path.join(root, '.claude', 'reviews') };
    const before = intentInputHash(args);

    // Adding a run artifact — even a .md one, which the glob matches — must not move the hash.
    // Pinning exists so the criteria hold still; a hash that moves every run defeats it entirely.
    fs.writeFileSync(path.join(reviews, 'extra.log'), 'more noise\n');
    fs.writeFileSync(path.join(root, '.claude', 'reviews', '20260101-000000-x', 'also.md'), '# nor this\n');
    assert.equal(intentInputHash(args), before, 'run artifacts are output, never an input');

    // ...and a real declared document still moves it, or the prune is doing too much.
    fs.writeFileSync(path.join(root, 'README.md'), '# doc, edited\n');
    assert.notEqual(intentInputHash(args), before);

    // The prune happens IN the walk, so the generated tree is never read. The difference between
    // pruning and filtering is COST ONLY — both produce this same hash — so there is no behaviour to
    // assert here and a source check is the honest instrument rather than a stand-in for one (the
    // distinction A-16 and G-85 are about). What it now pins is stronger than the line it checks:
    // the walk has ONE owner, and that owner prunes.
    const walker = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'glob-walk.mjs'), 'utf8');
    assert.match(walker, /if \(prune\(child\)\) continue;/,
      'filtering a finished list pays the cost and discards the benefit');
    const cache = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'intent-cache.mjs'), 'utf8');
    assert.doesNotMatch(cache, /readdirSync/,
      'the walk moved to glob-walk.mjs when the pre-flight cache needed it; a second copy here would '
      + 'drift from the one the pre-flight cache uses, and they must agree on what a contract glob means');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
