// intent-capture is a model call, so it is not deterministic. Three consecutive runs over the SAME
// documents produced 56, then 49, then 38 criteria, each with a different sha — a 32% swing in the
// bar the code is judged against. That makes two runs of identical code incomparable: a
// contract-audit FAIL can move to PASS because the criteria changed, not because the code did, and
// a verification run cannot then distinguish "the fix landed" from "the yardstick moved".
//
// Pinning keys the derived intent on a hash of exactly its inputs. Same inputs => reuse the same
// criteria. Change a declared document, the request, or the intent-capture skill => the hash moves
// and the criteria are derived again. These tests pin that the hash reacts to what it must and
// ignores what it must ignore — above all the run artifacts, which change on EVERY run and would
// defeat the pinning entirely if they counted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { intentInputHash, readIntentCache, writeIntentCache } from '../scripts/io/intent-cache.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-intent-'));
  fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'requests'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(root, 'shared', 'doctrine.md'), 'the rules');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'the contract');
  fs.writeFileSync(path.join(root, '.claude', 'requests', 'req.md'), 'the ask');
  return root;
}
const hashOf = (root, over = {}) => intentInputHash({
  repoRoot: root,
  docPaths: ['shared/**', 'CLAUDE.md'],
  requestPath: '.claude/requests/req.md',
  reviewsDir: path.join(root, '.claude', 'reviews'),
  ...over,
});

test('identical inputs hash identically — this is what makes two runs comparable', () => {
  const root = fixture();
  try {
    assert.equal(hashOf(root), hashOf(root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('changing a declared document moves the hash, so criteria are re-derived', () => {
  const root = fixture();
  try {
    const before = hashOf(root);
    fs.writeFileSync(path.join(root, 'shared', 'doctrine.md'), 'the rules, amended');
    assert.notEqual(hashOf(root), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('changing the request moves the hash', () => {
  const root = fixture();
  try {
    const before = hashOf(root);
    fs.writeFileSync(path.join(root, '.claude', 'requests', 'req.md'), 'a different ask');
    assert.notEqual(hashOf(root), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('adding a new declared document moves the hash', () => {
  const root = fixture();
  try {
    const before = hashOf(root);
    fs.writeFileSync(path.join(root, 'shared', 'extra.md'), 'more doctrine');
    assert.notEqual(hashOf(root), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('renaming a document moves the hash even when the bytes are identical', () => {
  const root = fixture();
  try {
    const before = hashOf(root);
    fs.renameSync(path.join(root, 'shared', 'doctrine.md'), path.join(root, 'shared', 'renamed.md'));
    assert.notEqual(hashOf(root), before, 'path is part of the input, not just content');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// THE ONE THAT MATTERS MOST. Run artifacts land under reviews_dir on every single run. If they
// counted as inputs the hash would move every time and nothing would ever be reused — the pinning
// would silently degrade to the drifting behaviour it exists to remove.
test('regression: run artifacts under reviews_dir never affect the hash', () => {
  const root = fixture();
  try {
    const before = hashOf(root);
    fs.mkdirSync(path.join(root, '.claude', 'reviews', '20260101-000000-x'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'reviews', '20260101-000000-x', 'gate.json'), '{}');
    fs.writeFileSync(path.join(root, '.claude', 'reviews', 'latest.txt'), '20260101-000000-x');
    assert.equal(hashOf(root), before, 'a run must not invalidate its own pinned criteria');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the intent-capture skill is an input: changing how criteria are derived re-derives them', () => {
  const root = fixture();
  try {
    const skill = path.join(root, 'SKILL.md');
    fs.writeFileSync(skill, 'derive criteria like so');
    const before = hashOf(root, { skillPath: skill });
    fs.writeFileSync(skill, 'derive criteria differently');
    assert.notEqual(hashOf(root, { skillPath: skill }), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cache round-trips, and a malformed or missing entry reads as absent rather than valid', () => {
  const root = fixture();
  const reviews = path.join(root, '.claude', 'reviews');
  try {
    assert.equal(readIntentCache(reviews, 'deadbeef'), null, 'missing is absent');
    writeIntentCache(reviews, 'deadbeef', {
      intent_md: '# Intent\n\nI-1 something', criteria_count: 1, derived_by_run: '20260101-000000-x',
    });
    const got = readIntentCache(reviews, 'deadbeef');
    assert.match(got.intent_md, /I-1 something/);
    assert.equal(got.derived_by_run, '20260101-000000-x');
    assert.equal(got.input_sha256, 'deadbeef', 'the entry records which inputs produced it');

    // An entry with no usable intent must NOT be treated as a hit — reusing an empty intent would
    // hand every lens an empty criteria set and read as "nothing to check".
    writeIntentCache(reviews, 'empty', { intent_md: '   ', criteria_count: 0 });
    assert.equal(readIntentCache(reviews, 'empty'), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
