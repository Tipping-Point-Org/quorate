// THE CONTRACT KEYS 1.x PROMISES (shared/compatibility.md, "The contract"; m3-v1.plan.md stage 3).
//
// Every graph_contract key shared/claude-md-contract.md documents at 1.0 keeps its name through 1.x. Nothing held that:
// the key ratchet (regression-contract-key-ratchet) compares this repository's block with the template's, so a key
// removed from both, or renamed in both, passed it, and a consumer's contract would have lost the key's meaning with no
// signal. The freeze in scripts/compatibility.json is checked against the documents, through freezeHolds, the one rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, releaseTags } from './helpers.mjs';
import { documentedContractKeys, freezeHolds, preRelease } from '../scripts/lib/compatibility.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const compat = JSON.parse(read('scripts/compatibility.json'));
const current = () => documentedContractKeys({ docText: read('shared/claude-md-contract.md'), templateText: read('CLAUDE.template.md') });

test('every frozen contract key is still documented, and before 1.0 every documented key is frozen', () => {
  const now = current();
  assert.ok(now.size >= 60, `read only ${now.size} keys: the reading, not the documents`);
  const { missing, unfrozen } = freezeHolds({ frozen: compat.contract_keys, current: now, preRelease: preRelease(read('VERSION'), releaseTags()) });
  assert.deepEqual(missing, [], 'these keys are frozen for 1.x and no longer documented: a removal or a rename, which waits for 2.0');
  assert.deepEqual(unfrozen, [], 'these keys are documented and not frozen: before 1.0 the freeze must equal the documents (add them to compatibility.json contract_keys)');
});

test('the reading finds what each source declares: a yaml example, the template, a consumer-named map', () => {
  const keys = documentedContractKeys({
    docText: '```yaml\nreview:\n  only_in_doc: 1\nlenses:\n  my-lens:\n    instructions: x\n```\n```yaml\nnot: [a contract\n```\n',
    templateText: '```yaml\ngraph_contract_version: 6\ncommands:\n  build: ""\n```\n',
  });
  for (const k of ['review.only_in_doc', 'lenses.*.instructions', 'commands.build', 'graph_contract_version', 'code_index.*.globs']) {
    assert.ok(keys.has(k), `${k} not read`);
  }
  assert.ok(![...keys].some((k) => k.includes('my-lens')), 'a name the consumer chose is *, not a key');
});

test('freezeHolds: a removal fails in every version, an addition fails only before 1.0', () => {
  assert.deepEqual(freezeHolds({ frozen: ['a', 'b'], current: ['a'], preRelease: false }).missing, ['b']);
  assert.deepEqual(freezeHolds({ frozen: ['a'], current: ['a', 'c'], preRelease: false }).unfrozen, []);
  assert.deepEqual(freezeHolds({ frozen: ['a'], current: ['a', 'c'], preRelease: true }).unfrozen, ['c']);
  assert.equal(preRelease('0.3.1\n', []), true);
  assert.equal(preRelease('1.1.0', []), false, 'past 1.0.0 the subset rule holds whatever tags a clone fetched');
});

// G-16 of 20261123-161216-m3s9-review: the policy ends equality when 1.0 is TAGGED, and the rule ended it at VERSION's
// text, so between the VERSION bump and the tag every "unfrozen" assertion was empty and could not fail.
test('preRelease: VERSION 1.0.0 with no v1.0.0 tag is still before the release, and the tag ends it', () => {
  assert.equal(preRelease('1.0.0\n', []), true, 'untagged 1.0.0 must still demand equality');
  assert.equal(preRelease('1.0.0', ['v0.3.1']), true);
  assert.equal(preRelease('1.0.0', ['v1.0.0']), false, 'the tag ends equality');
});
