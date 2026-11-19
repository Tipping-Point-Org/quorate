// G-13 of 20261111-042301-dps-a5-review (doc-consistency-review, MEDIUM lowered to LOW; G-1's third claim from the other
// family). The section named as owner of an arm's ceiling stated neither what fixes it nor the mint refusal, while
// adapter-contract.md stated both for "an arm" alone, so a reader there would conclude a judge's ceiling is unconstrained.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (name) => fs.readFileSync(path.join(REPO_ROOT, 'shared', name), 'utf8');

test('G-13: the owning section states what fixes the verdict ceiling and the mint refusal, for an arm and a judge', () => {
  const doc = read('external-reviewers.md');
  const at = doc.indexOf('## The ceiling on an external arm');
  assert.ok(at > 0, 'the owning section was not found');
  const section = doc.slice(at, doc.indexOf('\n## ', at + 1));
  assert.match(section, /CONSERVATIVE_BASIS/, 'the owner does not say what fixes the ceiling');
  assert.match(section, /an arm or a judge/, 'the owner does not reach a judge');
  assert.match(section, /mint refuses any other value/, 'the owner does not state the refusal');
});

test('G-13: adapter-contract.md points at the owner and does not restate the rule', () => {
  const doc = read('adapter-contract.md');
  assert.match(doc, /verdict ceiling is not derived:\s+`shared\/external-reviewers\.md`, "The ceiling on an external arm"/);
  assert.doesNotMatch(doc, /mint refuses any other value/, 'the rule is restated beside its owner');
});
