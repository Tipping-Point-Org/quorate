// contract-glob-grammar.plan.md, stage 1: ONE owner for the contract's glob grammar (design 1A, 2A; operator,
// 2026-09-30). Every round of 2026-09-29/30 fixed the glob case a review named and the next review found the next one,
// each where two interpreters read one glob differently. This table is the grammar's scope: a form not in it is decided
// by adding a row with its expected answers, not by a private rule in a caller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cg from '../scripts/lib/contract-glob.mjs';

// The forms in use (CLAUDE.template.md:41-44, this repository's contract, the story-pipeline fixture): all accepted.
const IN_USE = [
  'src/**', 'test/**', '**/*.test.*', 'docs/**', 'README.md', 'CLAUDE.md', '.claude/reviews/**', 'node_modules/**',
  'dist/**', 'scripts/**', 'shared/**', 'skills/**', 'prompts/**', '.claude/hooks/**', 'tests/**', '**/*.test.mjs',
  'QUORATE.md', 'ARCHITECTURE.md', 'ROADMAP.md', 'CLAUDE.template.md',
];

test('every glob form in use is accepted', () => {
  assert.equal(typeof cg.validateGlob, 'function', 'there is no one owner of the glob grammar');
  for (const g of IN_USE) assert.equal(cg.validateGlob(g), null, `${g} was refused`);
});

// Design 1A: everything else is refused, with a reason that names what to write instead.
const REFUSED = {
  'docs/?.md': /\?/, 'docs/[ab].md': /\[/, 'docs/[!_]*.md': /\[/, 'docs/*.{md,rst}': /brace|\{/, 'docs/{a,b}.md': /brace|\{/,
  '../other/**': /\.\./, 'docs/*/../../x/*.md': /\.\./, 'docs/./x.md': /\./, '/etc/**': /absolute/, 'C:/elsewhere/**': /absolute/,
  'C:\\outside\\*.md': /absolute/, '\\\\host\\share\\*.md': /absolute/, '': /empty/, '   ': /empty/,
  'docs/a**b': /\*\*/, 'docs/**x/y': /\*\*/, '!docs/**': /negat/,
};

test('every form outside the grammar is refused, with its reason', () => {
  for (const [g, why] of Object.entries(REFUSED)) {
    const r = cg.validateGlob(g);
    assert.ok(typeof r === 'string' && r.length, `${JSON.stringify(g)} was accepted`);
    assert.match(r, why, `${JSON.stringify(g)} refused for the wrong reason: ${r}`);
  }
});

test('a refused glob is never silently interpreted', () => {
  for (const g of Object.keys(REFUSED)) {
    assert.throws(() => cg.matchesGlob(g, 'docs/a.md'), undefined, `matchesGlob read ${JSON.stringify(g)}`);
    assert.throws(() => cg.walkRoot(g), undefined, `walkRoot read ${JSON.stringify(g)}`);
  }
});

// Spellings: a leading `./`, backslashes and a trailing `/` are the same glob.
test('a leading ./, backslashes and a trailing / are the plain form', () => {
  for (const [a, b] of [['./docs/**', 'docs/**'], ['docs\\**', 'docs/**'], ['docs/', 'docs'], ['.\\docs\\*.md', 'docs/*.md']]) {
    assert.equal(cg.validateGlob(a), null, a);
    for (const f of ['docs/a.md', 'docs/sub/b.md', 'other/c.md']) {
      assert.equal(cg.matchesGlob(a, f), cg.matchesGlob(b, f), `${a} and ${b} disagree on ${f}`);
    }
  }
});

// matchesGlob: exact. The rows the rounds tripped on are here by name.
const MATCH = [
  // [glob, file, expected]
  ['docs/*.md', 'docs/a.md', true], ['docs/*.md', 'docs/sub/b.md', false],          // `*` stays in its segment (r3 G-21)
  ['docs/**/*.md', 'docs/a.md', true], ['docs/**/*.md', 'docs/s/t/b.md', true],     // `**/` also matches none
  ['docs/**', 'docs/a.md', true], ['docs/**', 'docs/s/b.md', true], ['docs/**', 'docsx/a.md', false],
  ['**/*.test.*', 'lib/a.test.js', true], ['**/*.test.*', 'src/deep/b.test.mjs', true], ['**/*.test.*', 'a.test.js', true],
  ['**/*.test.*', 'lib/a.js', false],                                                // the template's test glob (design)
  ['**/*.test.mjs', 'tests/x.test.mjs', true], ['**/*.test.mjs', 'tests/x.test.js', false],
  ['docs/README*', 'docs/README.md', true], ['docs/README*', 'docs/sub/README.md', false],
  ['docs/**/README.md', 'docs/README.md', true], ['docs/**/README.md', 'docs/a/README.md', true],
  ['docs/**/README.md', 'docs/a/other.md', false],                                   // says more than its prefix (2A)
  ['docs', 'docs/a.md', true], ['docs', 'docs/s/b.md', true], ['docs', 'docsx/a.md', false],  // a literal directory (r4 G-7)
  ['README.md', 'README.md', true], ['README.md', 'docs/README.md', false],
  ['a.b', 'axb', false],                                                             // `.` is literal, not a regex dot
  ['src/**', 'src/a.ts', true], ['src/**', 'src', true], ['src/**', 'srcx', false],   // x/** covers x itself (G-18)
];

test('matchesGlob is exact, and a literal names a file or everything below a directory', () => {
  for (const [g, f, want] of MATCH) assert.equal(cg.matchesGlob(g, f), want, `matchesGlob(${g}, ${f})`);
  assert.equal(cg.matchesGlob('docs/*.md', 'docs\\a.md'), true, 'a backslash path is the same path');
});

// walkRoot: the directory a walk starts in ('' is the repository root). coverPrefix: the text a glob covers before its
// first wildcard, a partial segment kept — the question the source-root overlap test asks (lib/walk-rules.mjs:18-21
// recorded the two as deliberately different; they stay two answers of one parse).
const ROOTS = [
  // [glob, walkRoot, coverPrefix]
  ['docs/**', 'docs', 'docs'], ['docs/*.md', 'docs', 'docs'], ['docs/README*', 'docs', 'docs/README'],
  ['**/*.md', '', ''], ['*.md', '', ''], ['shared/sub/**/x.md', 'shared/sub', 'shared/sub'],
  ['README.md', 'README.md', 'README.md'], ['docs', 'docs', 'docs'], ['.\\docs\\**', 'docs', 'docs'],
];

test('walkRoot and coverPrefix answer their two questions from one parse', () => {
  for (const [g, root, prefix] of ROOTS) {
    assert.deepEqual(cg.walkRoot(g), { base: root, wildcard: /\*/.test(g) }, `walkRoot(${g})`);
    assert.equal(cg.coverPrefix(g), prefix, `coverPrefix(${g})`);
  }
});

test('isLiteralGlob says whether a glob has a wildcard', () => {
  assert.equal(cg.isLiteralGlob('docs/a.md'), true);
  assert.equal(cg.isLiteralGlob('docs/*.md'), false);
  assert.equal(cg.isLiteralGlob('docs'), true);
});
