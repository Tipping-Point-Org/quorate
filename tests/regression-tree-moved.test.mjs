// TREE-MOVED was declared in shared/disk-first-protocol.md §7 from the beginning and implemented in
// no script at all. Worse, the one field that would have enabled it lied: new-run wrote
// `worktree_sha: headSha` — the HEAD COMMIT, under a name promising working-tree state — so editing
// a tracked file could not have moved it even if something had re-read it. Nothing did. The stamp
// was inert twice over (G-44, raised across three runs before it was fixed).
//
// It matters because a fan-out runs for tens of minutes and every finding cites a file and a line.
// If the reviewed files change underneath that, those citations may name lines that no longer
// exist, and the gate had no way to say so.
//
// Verified end to end when this landed: an identical run gated PASS with no stamp; the same run
// with one scoped file appended to gated RISK with TREE-MOVED and the gap named in not_checked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { worktreeSha } from '../scripts/io/worktree.mjs';

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-tm-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'line1\nline2\n');
  return root;
}
const sha = (root, over = {}) => worktreeSha({
  repoRoot: root, paths: ['src'], excludeDir: path.join(root, '.claude', 'reviews'), ...over,
});

test('the same tree hashes the same twice — no spurious TREE-MOVED', () => {
  const root = tree();
  try { assert.equal(sha(root), sha(root)); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('regression: editing a reviewed file moves the hash', () => {
  const root = tree();
  try {
    const before = sha(root);
    fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'line1\nCHANGED\n');
    assert.notEqual(sha(root), before);
    // and restoring the exact bytes makes it identical again — content, not mtime
    fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'line1\nline2\n');
    assert.equal(sha(root), before, 'the hash must track CONTENT, not timestamps');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('adding or deleting a reviewed file moves the hash', () => {
  const root = tree();
  try {
    const before = sha(root);
    fs.writeFileSync(path.join(root, 'src', 'b.mjs'), 'new\n');
    assert.notEqual(sha(root), before, 'a new file in scope is a moved tree');
    fs.unlinkSync(path.join(root, 'src', 'b.mjs'));
    assert.equal(sha(root), before);
    fs.unlinkSync(path.join(root, 'src', 'a.mjs'));
    assert.notEqual(sha(root), before, 'a deleted file in scope is a moved tree');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// THE TRAP. A run writes into its own run directory continuously. If those artifacts counted,
// EVERY run would report its own tree as moved and the stamp would mean nothing — the same trap
// the intent-input hash has to avoid, for the same reason.
test('regression: the run directory never counts as the tree moving', () => {
  const root = tree();
  try {
    const before = worktreeSha({ repoRoot: root, paths: ['src', '.claude'], excludeDir: path.join(root, '.claude', 'reviews') });
    fs.mkdirSync(path.join(root, '.claude', 'reviews', '20260101-000000-x'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'reviews', '20260101-000000-x', 'gate.json'), '{}');
    const after = worktreeSha({ repoRoot: root, paths: ['src', '.claude'], excludeDir: path.join(root, '.claude', 'reviews') });
    assert.equal(after, before, 'a run must not report its own artifacts as a moved tree');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an empty scope reads as "cannot tell" (null), never as a hash that would match', () => {
  const root = tree();
  try {
    assert.equal(worktreeSha({ repoRoot: root, paths: [] }), null);
    assert.equal(worktreeSha({ repoRoot: root, paths: ['does-not-exist'] }), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('regression: worktree_sha is no longer the HEAD commit wearing a working-tree name', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'scripts', 'new-run.mjs'), 'utf8');
  assert.doesNotMatch(src, /worktree_sha:\s*headSha/,
    'the field must describe the working tree, not the commit — that is what made the stamp inert');
  assert.match(src, /worktree_sha:\s*worktreeSha\(/);
});

// SKIP_DIRS hardcoded node_modules and .git while the contract's own `generated_globs` sat unread,
// so a scope path covering a generated tree was read and sha256'd in full, twice per run, for a hash
// whose only job is to notice edits to reviewed SOURCE (G-32). The cost was the smaller half: a
// generator rewriting its output mid-run raised TREE-MOVED over files no finding could cite.
test('generated trees are excluded from the worktree hash, by contract not by hardcoded name', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-gen-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'build'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'source\n');
    fs.writeFileSync(path.join(root, 'src', 'build', 'out.js'), 'generated once\n');

    const gen = ['src/build/**'];
    const before = worktreeSha({ repoRoot: root, paths: ['src'], generatedGlobs: gen });

    // The generator runs. Nothing a lens reviews has changed.
    fs.writeFileSync(path.join(root, 'src', 'build', 'out.js'), 'generated again, differently\n');
    assert.equal(worktreeSha({ repoRoot: root, paths: ['src'], generatedGlobs: gen }), before,
      'a rewritten build output must not read as the reviewed tree moving');

    // Without the declaration it is ordinary source, and a change to it IS a moved tree — the
    // exclusion must come from the contract, never from guessing at directory names.
    assert.notEqual(worktreeSha({ repoRoot: root, paths: ['src'] }), before);

    // And real source still moves the hash, or the exclusion has eaten the whole signal.
    fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'source, edited\n');
    assert.notEqual(worktreeSha({ repoRoot: root, paths: ['src'], generatedGlobs: gen }), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// AN ARITY MISMATCH IS INVISIBLE IN THIS LANGUAGE. `walk` was declared with three parameters and
// called with four: the `skip` predicate was passed, JavaScript discarded it, and the comment above
// the call claimed a pruning that never happened. The measurement quoted in its commit message came
// from the surviving list filter instead — a real improvement, attributed to the wrong mechanism
// (G-22, found by code-audit and panel-codex-perf independently).
//
// Two assertions, because either alone is weak: the shape (does the parameter exist and get
// forwarded through the recursion?) and the behaviour (is an excluded tree actually not walked?).
test('an excluded tree is PRUNED, not walked and then filtered', () => {
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'io', 'worktree.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function walk('), src.indexOf('\n}\n', src.indexOf('function walk(')));
  assert.match(fn, /^function walk\(abs, out, visited, skip/,
    'the predicate must be a declared parameter — passing an argument a function does not declare is silent');
  // `io` rides along since G-9 of 20261001-155615-cgg-review-r3 (the unreadable list); the claim is the forwarding.
  assert.match(fn, /walk\(path\.join\(abs, e\), out, visited, skip(, io)?\)/,
    'and forwarded through the recursion, or pruning stops at the first level');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-prune-'));
  try {
    fs.mkdirSync(path.join(root, 'src', 'build'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'source\n');
    for (let i = 0; i < 4000; i++) fs.writeFileSync(path.join(root, 'src', 'build', `f${i}.js`), 'y');

    let t = Date.now();
    const pruned = worktreeSha({ repoRoot: root, paths: ['src'], generatedGlobs: ['src/build/**'] });
    const prunedMs = Date.now() - t;

    t = Date.now();
    const walked = worktreeSha({ repoRoot: root, paths: ['src'] });
    const walkedMs = Date.now() - t;

    // Correctness first: pruning must not change what the hash covers.
    assert.notEqual(pruned, walked, 'the generated tree is excluded from one and not the other');
    assert.equal(pruned, worktreeSha({ repoRoot: root, paths: ['src', 'src/build'], generatedGlobs: ['src/build/**'] }),
      'naming the excluded path explicitly must not smuggle it back in');

    // Then the mechanism. A wide margin, because wall-clock in a test suite is noisy: the pruned
    // walk touches ONE directory entry and the other touches four thousand files, which was 1ms
    // against 505ms when measured. Half is a bar only a real prune can clear.
    if (walkedMs > 40) {
      assert.ok(prunedMs < walkedMs / 2,
        `pruned ${prunedMs}ms vs walked ${walkedMs}ms — the exclusion is being applied after the walk`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
