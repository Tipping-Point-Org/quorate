// The contract may live in .claude/rules/quorate-contract.md or in the project's CLAUDE.md.
// Two supported locations is a correctness problem before it is a convenience: a run must be able
// to say which file it read, and two files that disagree must never be silently ranked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_CANDIDATES, contractBlocks, chooseContractSource,
} from '../scripts/lib/contract-source.mjs';

const block = (body) => `# heading\n\ntext\n\n\`\`\`yaml\n${body}\n\`\`\`\n`;
const CONTRACT = 'graph_contract: 1\nproject: p';

test('the rules file is preferred over CLAUDE.md', () => {
  const r = chooseContractSource([
    { path: '.claude/rules/quorate-contract.md', text: block(CONTRACT) },
    { path: 'CLAUDE.md', text: block(CONTRACT) },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.path, '.claude/rules/quorate-contract.md');
});

test('CLAUDE.md still works alone — this is not a deprecation', () => {
  const r = chooseContractSource([
    { path: '.claude/rules/quorate-contract.md', text: null },
    { path: 'CLAUDE.md', text: block(CONTRACT) },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.path, 'CLAUDE.md');
  assert.equal(r.yaml, CONTRACT);
});

// The migration this whole change exists to enable: copy the block to the new file, verify, delete
// the old one. Refusing while both are present and IDENTICAL would block it at the middle step.
test('two identical contracts are not ambiguous — they are a migration in progress', () => {
  const r = chooseContractSource([
    { path: '.claude/rules/quorate-contract.md', text: block(CONTRACT) },
    { path: 'CLAUDE.md', text: `different prose\n${block(CONTRACT)}` },
  ]);
  assert.equal(r.ok, true, 'identical contract bodies must not be treated as a conflict');
  assert.deepEqual(r.duplicates, ['CLAUDE.md'], 'the redundant copy is reported, not ignored');
});

// AMBIGUITY IS REFUSED, NOT RANKED. Preferring the rules file here would run the project against a
// contract it may have stopped maintaining, while the other file looks equally authoritative — the
// silent-wrong-answer this repo refuses everywhere else (see the two-approved-requests rule).
test('two contracts that DISAGREE are refused, and both paths are named', () => {
  const r = chooseContractSource([
    { path: '.claude/rules/quorate-contract.md', text: block(CONTRACT) },
    { path: 'CLAUDE.md', text: block('graph_contract: 1\nproject: OTHER') },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.why, /disagree/);
  assert.match(r.why, /\.claude\/rules\/quorate-contract\.md/);
  assert.match(r.why, /CLAUDE\.md/);
});

// A CLAUDE.md with no yaml block is not a contract source, so it must not shadow a rules file that
// has one. The first cut treated "file exists" as "file carries the contract" and would have made
// every project with a plain CLAUDE.md unable to adopt the new location.
test('a file with no fenced block is skipped, not treated as an empty contract', () => {
  const r = chooseContractSource([
    { path: '.claude/rules/quorate-contract.md', text: block(CONTRACT) },
    { path: 'CLAUDE.md', text: '# just prose, no fenced yaml\n' },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.path, '.claude/rules/quorate-contract.md');
  assert.deepEqual(r.duplicates, []);
});

test('no contract anywhere names every path it looked in', () => {
  const r = chooseContractSource([
    { path: '.claude/rules/quorate-contract.md', text: null },
    { path: 'CLAUDE.md', text: '# no block\n' },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.why, /\.claude\/rules\/quorate-contract\.md/);
  assert.match(r.why, /CLAUDE\.md/);
});

test('line-ending and whitespace differences are not a disagreement', () => {
  const r = chooseContractSource([
    { path: '.claude/rules/quorate-contract.md', text: block(CONTRACT) },
    { path: 'CLAUDE.md', text: block(CONTRACT).replace(/\n/g, '\r\n') },
  ]);
  assert.equal(r.ok, true, 'a CRLF checkout of the same contract must not read as a conflict');
});

test('preference order is declared once, and the rules file comes first', () => {
  assert.deepEqual(CONTRACT_CANDIDATES, ['.claude/rules/quorate-contract.md', 'CLAUDE.md']);
});

// THE CONTRACT IS FOUND BY ITS KEY, NOT BY ITS POSITION.
//
// The original parser took the FIRST ```yaml fence in the file and assumed it was the contract. A
// project with any other yaml block above it — a CI snippet, a config example — silently handed the
// parser the wrong text, and the failure is quiet because the wrong block usually parses fine and
// simply describes nothing the engine wanted. This was nearly written up as a REASON TO PREFER the
// new file location, which would have left every existing CLAUDE.md install exposed to it.
test('a yaml block ABOVE the contract does not shadow it', () => {
  const doc = '# proj\n\n```yaml\nname: ci\non: [push]\n```\n\nprose\n\n```yaml\n' + CONTRACT + '\n```\n';
  assert.deepEqual(contractBlocks(doc), [CONTRACT],
    'the block declaring graph_contract must be selected regardless of what precedes it');

  const r = chooseContractSource([{ path: 'CLAUDE.md', text: doc }]);
  assert.equal(r.ok, true);
  assert.equal(r.yaml, CONTRACT);
});

test('a yaml block carrying no graph_contract is not a contract at all', () => {
  assert.deepEqual(contractBlocks('```yaml\nname: ci\n```'), []);
  assert.deepEqual(contractBlocks('no block here'), []);
});

test('graph_contract must be a TOP-LEVEL key, not a nested value', () => {
  assert.deepEqual(contractBlocks('```yaml\nexample:\n  graph_contract: 1\n```'), [],
    'an indented occurrence is a value inside another structure, not a declaration');
});

test('the yml spelling is accepted', () => {
  assert.deepEqual(contractBlocks('```yml\n' + CONTRACT + '\n```'), [CONTRACT]);
});

// Two contracts in ONE file is the same ambiguity as two files, one level down. Taking the first
// would be exactly the positional guess this change removed.
test('two graph_contract blocks in one file are refused, not ranked', () => {
  const doc = '```yaml\n' + CONTRACT + '\n```\n\n```yaml\ngraph_contract: 1\nproject: other\n```\n';
  assert.equal(contractBlocks(doc).length, 2);
  const r = chooseContractSource([{ path: 'CLAUDE.md', text: doc }]);
  assert.equal(r.ok, false);
  assert.match(r.why, /2 graph_contract blocks/);
});

// COMMENT-ONLY DIFFERENCES ARE NOT A DISAGREEMENT. The comparison normalised raw bytes, so an
// operator copying the block to .claude/rules/ and annotating the copy — the most natural thing to
// do while moving it — got every run refused with "two graph_contract blocks disagree". The refusal
// blocked the migration this module exists to enable (G-21).
test('two contracts differing only in comments and blank lines are the same contract', () => {
  const plain = block(CONTRACT);
  const annotated = '```yaml\n# copied here while migrating\ngraph_contract: 1\n\nproject: p   # unchanged\n```\n';

  const r = chooseContractSource([
    { path: '.claude/rules/quorate-contract.md', text: plain },
    { path: 'CLAUDE.md', text: annotated },
  ]);
  assert.equal(r.ok, true, r.ok ? '' : r.why);
  assert.deepEqual(r.duplicates, ['CLAUDE.md']);
});

test('a real disagreement is still refused, and a # inside a value is not a comment', () => {
  // Fails closed: only comments and blank lines are reconciled, never differing declarations.
  const differing = chooseContractSource([
    { path: 'x', text: block(CONTRACT) },
    { path: 'y', text: block('graph_contract: 1\nproject: OTHER') },
  ]);
  assert.equal(differing.ok, false);
  assert.match(differing.why, /disagree/);

  // A quoted command containing '#' must survive normalisation intact — stripping it would make two
  // identical contracts compare equal for the wrong reason, and could hide a genuine difference
  // AFTER the '#'.
  const withHash = block('graph_contract: 1\nproject: p\ncommands:\n  test: "node t.mjs --tag #1"');
  const other = block('graph_contract: 1\nproject: p\ncommands:\n  test: "node t.mjs --tag #2"');
  assert.equal(chooseContractSource([{ path: 'x', text: withHash }, { path: 'y', text: other }]).ok, false,
    'a difference after a # is a real difference; the strip must not swallow it');
});
