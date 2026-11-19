// NO TEST READS THE SET-ASIDE'S SOURCE BUT A CENSUS (runner-test-seam.plan.md stage 4, design RT-D4 A). Every round of the
// set-aside-identity chain confirmed a test that matched the set-aside's text in place of running it, and each fix moved the
// gap (the design's "Why this is a design step"). Those tests now import scripts/io/set-aside.mjs and run it. This census
// keeps it so: a test that names `set-aside.mjs` in a string literal that is not an import's specifier is a test that reads
// the file, and only a census may, a test whose subject is a rule over a set of source files rather than one function's
// behaviour.
//
// Instrument: tests/tools/source-literals.mjs (`node tests/tools/source-literals.mjs set-aside.mjs tests`), lexical, its
// limits stated there.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { filesNaming, literalSites } from './tools/source-literals.mjs';

const NAME = 'set-aside.mjs';
// The allow-list: each a census by the stage's definition, with the rule it holds.
const ALLOW = {
  'regression-evidence-path-census.test.mjs': 'the evidence-path census: every path split and reader call in its FILES',
  'regression-set-aside-identity.test.mjs': 'the marker census (every set-aside function between the markers, no read of the read family there) and the owner-prose census',
  'regression-set-aside-identity-2.test.mjs': 'G-1, the owner-prose census over the readers of confined-path',
  'regression-set-aside-module.test.mjs': 'the declaration census (no moved function in the runner) and the module\'s no-process rule',
  'regression-set-aside-reads.test.mjs': 'stage 3\'s read census: no tree.read or owner.read outside two exemptions',
  'regression-set-aside-write-back.test.mjs': 'G-11 and G-5, rules that neither the runner nor the module restates a stamp or the raw-diff parse',
  'regression-set-aside-source-census.test.mjs': 'this census, which names its subject',
};

test('census: no test outside the allow-list names set-aside.mjs in a string literal that is not an import\'s specifier', () => {
  const found = filesNaming(path.join(REPO_ROOT, 'tests'), NAME);
  const outside = found.filter((f) => !(f.file in ALLOW));
  assert.deepEqual(outside.map((f) => `tests/${f.file}: ${f.sites.map((s) => `${s.line} ${s.literal}`).join('; ')}`), [],
    'a test reads scripts/io/set-aside.mjs\'s source: import the module and run it, or, for a rule over source files, add it to ALLOW with its rule');
  // Not a list of reasons for files that no longer need one.
  const named = new Set(found.map((f) => f.file));
  assert.deepEqual(Object.keys(ALLOW).filter((f) => !named.has(f)), [], 'an allowed file no longer names set-aside.mjs: drop it from ALLOW');
});

test('the census\'s instrument: both spellings are seen, an import\'s specifier and a comment are not', () => {
  const seen = (text) => literalSites(text, NAME).map((s) => s.literal);
  assert.deepEqual(seen("const s = read('scripts/io/set-aside.mjs');"), ["'scripts/io/set-aside.mjs'"]);
  assert.deepEqual(seen("const s = fs.readFileSync(path.join(ROOT, 'scripts', 'io', 'set-aside.mjs'), 'utf8');"), ["'set-aside.mjs'"]);
  assert.deepEqual(seen('const s = read(`scripts/io/set-aside.mjs`);'), ['`scripts/io/set-aside.mjs`']);
  assert.deepEqual(seen("import { pathState } from '../scripts/io/set-aside.mjs';"), [], 'a static import');
  assert.deepEqual(seen("const m = await import('../scripts/io/set-aside.mjs');"), [], 'a dynamic import');
  assert.deepEqual(seen("import '../scripts/io/set-aside.mjs';"), [], 'a bare import');
  assert.deepEqual(seen('// reads scripts/io/set-aside.mjs'), [], 'a comment line');
  assert.deepEqual(seen("const x = 1; // see 'scripts/io/set-aside.mjs'"), [], 'a trailing comment');
});

// G-11 of 20261108-222629-rts-delivery: the instrument searched for the contiguous name, so a source read that split it passed.
test('the census\'s instrument: a split or concatenated name is seen, and an import\'s split specifier and a commented one are not', () => {
  const seen = (text) => literalSites(text, NAME).map((s) => s.line);
  for (const [spelling, text] of [
    ['+', "const s = read('scripts/io/set-' + 'aside.mjs');"],
    ['+ of three', "const s = read('set' + \"-\" + `aside.mjs`);"],
    ['+ across lines', "const s = read('scripts/io/set-'\n  + 'aside.mjs');"],
    ['a template interpolating a literal', "const s = read(`set-${'aside'}.mjs`);"],
    ['concat', "const s = read('set-'.concat('aside.mjs'));"],
    ['an array joined', "const s = read(['set-', 'aside.mjs'].join(''));"],
    ['an array joined by a separator', "const s = read(['set', 'aside.mjs'].join('-'));"],
    ['a name held in pieces', "const a = 'set-';\nconst s = read(a + 'aside.mjs');"],
    ['an escaped dot', "const s = read('set-aside\\.mjs');"],
    ['a regular expression', 'assert.match(x, /set-aside\\.mjs/);'],
  ]) assert.ok(seen(text).length, `not seen: ${spelling}`);
  assert.equal(seen("const a = 1;\nconst s = read('set-'\n  + 'aside.mjs');\nconst b = 2;")[0], 2, 'the line of a joined literal is where it starts');
  assert.deepEqual(seen("const m = await import('../scripts/io/set-' + 'aside.mjs');"), [], 'a dynamic import split, which runs the module');
  assert.deepEqual(seen("// read('set-' + 'aside.mjs')"), [], 'a comment line');
  assert.deepEqual(seen("const x = 'aside'; const y = 'other.mjs';"), [], 'an unrelated literal');
});
