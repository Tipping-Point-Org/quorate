// G-5 of 20261112-063354-hl-remediation-4-review: snapshotDocGlobs walked once per declared document glob and copied every
// file each glob matched, so a document under two overlapping globs (`shared/**` and `shared/*.md`) was read and written
// into the intent sandbox once per glob. Each document is now copied once, however many globs declare it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshotDocGlobs } from '../scripts/io/doc-snapshot.mjs';

test('a document matched by two overlapping globs is copied once', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-snapshot-once-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.writeFileSync(path.join(repo, 'docs', 'a.md'), '# a\n');
  fs.writeFileSync(path.join(repo, 'docs', 'b.md'), '# b\n');
  const copies = [];
  snapshotDocGlobs({ repoRoot: repo, docPaths: ['docs/**', 'docs/*.md', 'docs/a.md'], snap: { copy: (src, name) => copies.push(name) } });
  assert.equal(copies.length, 2, `copied ${copies.length} times for 2 documents: ${copies.join(', ')}`);
  assert.equal(new Set(copies).size, 2);
});
