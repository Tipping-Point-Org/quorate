// G-2 of 20261105-154708-crsf-remediation-5-review: containment still had several owners after a remediation meant to
// give it one. pruneUnder (scripts/io/doc-snapshot.mjs) hand-rolled its own case fold, separator and prefix test, and
// run-artifacts.mjs, run-graph.mjs and run-session.mjs each hand-rolled a `..` segment test over path.relative, so the
// next platform correction had to be made at every copy. Each now asks isWithin, through relativeBelow where it needs the
// segments below the parent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as scope from '../scripts/lib/finding-scope.mjs';
import { pruneUnder } from '../scripts/io/doc-snapshot.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SITES = ['scripts/io/doc-snapshot.mjs', 'scripts/io/run-artifacts.mjs', 'scripts/run-graph.mjs', 'scripts/run-session.mjs'];
// The two hand-rolled spellings: a `..` segment test over path.relative, and a separator-prefix test.
const HAND_ROLLED = [/startsWith\(`\.\.\$\{path\.sep\}`\)/, /\+ ?path\.sep\b/];

test('G-2: the in-scope sites hand-roll no containment test', () => {
  for (const rel of SITES) {
    // Code only: a comment recording the old spelling is history, not a test.
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const re of HAND_ROLLED) assert.ok(!re.test(src), `${rel} still hand-rolls containment (${re})`);
  }
});

test('G-2: relativeBelow returns the segments strictly below, or null, by isWithin', () => {
  const { relativeBelow } = scope;
  assert.equal(typeof relativeBelow, 'function', 'relativeBelow is not exported by lib/finding-scope.mjs');
  const p = path.resolve('/a/run');
  assert.deepEqual(relativeBelow(p, path.join(p, 'nodes', 'x.json')), ['nodes', 'x.json']);
  assert.deepEqual(relativeBelow(p, path.join(p, '..x')), ['..x'], 'a name starting with .. is below');
  assert.equal(relativeBelow(p, p), null, 'the parent itself is not below it');
  assert.equal(relativeBelow(p, path.resolve('/a/other')), null);
  assert.equal(relativeBelow(p, path.resolve('/a/run-x')), null, 'a sibling sharing the prefix is not below');
  const root = path.parse(p).root;
  assert.deepEqual(relativeBelow(root, path.join(root, 'docs')), ['docs'], 'below a filesystem root');
  assert.deepEqual(relativeBelow(path.resolve('/A/Run'), path.join(p, 'x'), { caseInsensitive: true }), ['x']);
  assert.equal(relativeBelow(path.resolve('/A/Run'), path.join(p, 'x'), { caseInsensitive: false }), null);
});

test('G-2: pruneUnder agrees with isWithin, at a filesystem root and for a ..-named child', () => {
  const p = path.resolve('/a/run');
  const root = path.parse(p).root;
  for (const [roots, full, ci] of [[[p], path.join(p, 'x'), false], [[p], p, false], [[p], path.resolve('/a/run-x'), false],
    [[root], path.join(root, 'docs'), false], [[path.resolve('/A/RUN')], path.join(p, 'x'), true], [[path.resolve('/A/RUN')], path.join(p, 'x'), false]]) {
    const want = roots.some((r) => scope.isWithin(r, full, { caseInsensitive: ci }));
    assert.equal(pruneUnder(roots, { caseInsensitive: ci })(full), want, `${roots} / ${full} / ci=${ci}`);
  }
});
