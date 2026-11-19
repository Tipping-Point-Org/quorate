// contract-glob-grammar.plan.md, stage 7: the documents say what the engine now does. Written after the documents were
// changed, so these did not run red; the before-state is each document's previous text (r5 G-18 and its symptoms G-1,
// G-19; the comments the design listed as asserting one matcher while there were several; r5 G-16, the snapshot caveat).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

test('the contract doc states the grammar: what is accepted, what is refused, and where it is checked', () => {
  const s = read('shared', 'claude-md-contract.md');
  assert.match(s, /The grammar of a contract glob[\s\S]{0,200}contract-glob\.mjs/);
  for (const form of ['`?`', '`{`', '`..`', 'leading `!`', 'absolute path']) {
    assert.ok(s.includes(form), `the refused form ${form} is not named`);
  }
  assert.match(s, /--print-contract[^\n]*\*\*not\*\* refuse/, 'the --print-contract exception is not stated');
  assert.match(s, /Matching is exact, everywhere/);
});

test('the contract doc says the intent node reads a sandbox of copies, and drops the reverted-filter caveat (r5 G-16)', () => {
  const s = read('shared', 'claude-md-contract.md');
  assert.match(s, /What the intent node reads: a sandbox of copies/);
  assert.doesNotMatch(s, /An exact filter was tried and reverted/, 'the caveat about the reverted filter is still there');
  assert.doesNotMatch(s, /granted to the intent node as written/, 'the doc still describes the old grant');
});

test('every document that says a run returns to .claude/reviews says its evidence may stay staged (r5 G-18, G-1, G-19)', () => {
  assert.match(read('shared', 'claude-md-contract.md'), /Its `evidence\/` moves only if git would\s+ignore it there/);
  assert.match(read('CLAUDE.md'), /except its evidence\/, which moves only when git would ignore it there/);
  assert.match(read('shared', 'disk-first-protocol.md'), /In an ARCHIVED run this directory is present only if git would ignore/);
});

test('no comment claims a single matcher by an old name', () => {
  for (const f of [['scripts', 'io', 'glob-walk.mjs'], ['scripts', 'check-install.mjs'], ['scripts', 'lib', 'excerpt.mjs']]) {
    const s = read(...f);
    assert.doesNotMatch(s, /The matcher is `coveredByGlobs`/, `${f.join('/')} still names the old matcher as the one`);
    assert.doesNotMatch(s, /through the SAME matcher the finding-scope layer uses/, `${f.join('/')} still claims the old single matcher`);
  }
});
