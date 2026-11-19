// THE MASTER-ONLY RULE HAS ONE OWNER IN THE PURE LAYER (G-21 of 20261116-221234-m2-9a-high-2).
// scripts/publish.mjs decided inline that only master's commit may publish, where ARCHITECTURE §2's Orchestration row
// puts a rule the pure layer could hold in scripts/lib/. lib/publish.mjs's publishRefCheck owns it; the entry script
// only acts on its answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import * as pub from '../scripts/lib/publish.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40);

test('publishRefCheck is exported by the pure layer', () => {
  assert.equal(typeof pub.publishRefCheck, 'function');
});

test("master's commit publishes", () => {
  const r = pub.publishRefCheck({ ref: 'master', sourceCommit: A, masterCommit: A, dryRun: false });
  assert.equal(r.refusal, null);
  assert.equal(r.notice, null);
});

test('another commit is refused, naming master', () => {
  const r = pub.publishRefCheck({ ref: 'x', sourceCommit: A, masterCommit: B, dryRun: false });
  assert.match(String(r.refusal), /not master's commit \(master is bbbbbbbb\)/);
});

test('no master branch is refused', () => {
  const r = pub.publishRefCheck({ ref: 'x', sourceCommit: A, masterCommit: null, dryRun: false });
  assert.match(String(r.refusal), /there is no master branch/);
});

test('a dry run of another commit is a notice, not a refusal', () => {
  const r = pub.publishRefCheck({ ref: 'x', sourceCommit: A, masterCommit: B, dryRun: true });
  assert.equal(r.refusal, null);
  assert.match(String(r.notice), /would be refused/);
});

test('the entry script does not compare against master itself', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'publish.mjs'), 'utf8');
  assert.doesNotMatch(src, /sourceCommit\s*!==\s*masterCommit/);
  assert.match(src, /publishRefCheck\(/);
});
