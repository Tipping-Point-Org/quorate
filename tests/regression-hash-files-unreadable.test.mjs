// G-4 of 20261122-014737-m3s7-b2-review-2. hashFiles turned ANY read failure into null, which digestInputs leaves out,
// so an input that stands but cannot be read hashed exactly as if it were absent: a pre-flight or intent result could be
// reused for an input set whose unreadable member had changed. Only a file that is gone (ENOENT) is absent; an input that
// cannot be read cannot be shown unchanged, so it must never produce a digest a stored result matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashFiles } from '../scripts/io/glob-walk.mjs';

const digest = (root, files) => {
  const h = crypto.createHash('sha256');
  hashFiles(h, root, files);
  return h.digest('hex');
};

test('an input that stands but cannot be read never hashes as absent, nor as itself twice', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-files-unreadable-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, 'a.txt');
  fs.writeFileSync(a, 'a\n');
  // A directory in the file list stands and answers EISDIR to a read: an unreadable input no host has to fake.
  const unreadable = path.join(root, 'b.txt');
  fs.mkdirSync(unreadable);
  const withIt = digest(root, [a, unreadable]);
  assert.notEqual(withIt, digest(root, [a]), 'an unreadable input hashed as if it were absent');
  assert.notEqual(withIt, digest(root, [a, unreadable]), 'an unreadable input gave a digest a stored result can match');
});

test('a file that is gone is still left out, as before', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-files-gone-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, 'a.txt');
  fs.writeFileSync(a, 'a\n');
  assert.equal(digest(root, [a, path.join(root, 'gone.txt')]), digest(root, [a]));
});
