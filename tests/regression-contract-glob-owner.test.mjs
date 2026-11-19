// contract-glob-grammar.plan.md, stage 3: every interpreter of a contract glob calls lib/contract-glob.mjs; none keeps a
// private rule. The design's inventory found fourteen; each private compiler is deleted, not wrapped, and this test is
// the claim that they stay deleted — by the shapes the inventory found them in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { findingOutOfScope, uncoveredFiles } from '../scripts/lib/finding-scope.mjs';
import { expandGlob } from '../scripts/io/glob-walk.mjs';

const OWNER = path.join('scripts', 'lib', 'contract-glob.mjs');

function sources() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(REPO_ROOT, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.m?js$/.test(e.name)) out.push(rel);
    }
  };
  walk('scripts');
  walk(path.join('.claude', 'hooks'));
  return out.filter((f) => f !== OWNER);
}

// Code only: a comment may name an old function, as history.
const code = (text) => text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('no file but lib/contract-glob.mjs defines a glob interpreter', () => {
  const PRIVATE = /\bfunction (globToRe|matchGlob|globDirPrefix|globWalkRoot|coveredByGlobs|globLeavesRepo|contractGlobsLeavingRepo)\b/;
  for (const f of sources()) {
    const m = PRIVATE.exec(code(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')));
    assert.equal(m, null, `${f} defines its own glob interpreter: ${m?.[0]}`);
  }
});

test('no file but lib/contract-glob.mjs cuts a glob at a wildcard', () => {
  // The cutting idioms the inventory found: a slice at the star, a split on it, a search for the first wildcard.
  const CUT = /\.slice\(0,\s*star\)|split\(['"]\*['"]\)|indexOf\(['"]\*['"]\)|search\(\/\[\*\?\[\]\/\)/;
  for (const f of sources()) {
    const m = CUT.exec(code(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')));
    assert.equal(m, null, `${f} cuts a glob itself: ${m?.[0]}`);
  }
});

// Through the callers' public entry points: the rows the design named as divergences.
test('the template\'s **/*.test.* puts a test file anywhere inside the declared surface', () => {
  const contract = { source_globs: ['src/**'], test_globs: ['test/**', '**/*.test.*'], doc_paths: ['docs/**'], generated_globs: [] };
  assert.deepEqual(uncoveredFiles(['lib/a.test.js', 'src/b.ts', 'lib/c.js'], contract), ['lib/c.js'],
    'a test file outside test/ and src/ was outside the declared surface');
});

test('a **/*.min.js generated glob demotes a file under it (K, the inline prefix test, had no ** form)', () => {
  const why = findingOutOfScope({ file: 'web/app.min.js', basis: 'convention' }, { generatedGlobs: ['**/*.min.js'], declaredGlobs: ['web/**'] });
  assert.match(String(why ?? ''), /generated/, 'a generated **/ glob did not demote');
});

test('expandGlob reads a glob exactly: `*` stays in its segment', (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-cgo-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  for (const f of ['docs/a.md', 'docs/sub/b.md', 'docs/README.md']) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), 'x');
  }
  const rel = (list) => list.map((f) => path.relative(d, f).split(path.sep).join('/')).sort();
  assert.deepEqual(rel(expandGlob(d, 'docs/*.md')), ['docs/README.md', 'docs/a.md']);
  assert.deepEqual(rel(expandGlob(d, 'docs/**/*.md')), ['docs/README.md', 'docs/a.md', 'docs/sub/b.md']);
  assert.deepEqual(rel(expandGlob(d, 'docs')), ['docs/README.md', 'docs/a.md', 'docs/sub/b.md']);
});
