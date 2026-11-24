// G-1 of 20261121-043112-ac2-delivery: THE GROUND-TRUTH STATEMENTS WERE PROSE BUILT IN CODE.
//
// applyMisanchor, applyDeflate and applyDrop each built a natural-language `ground_truth.statement` in
// lib/reconcile-mutations.mjs, and bench-second-opinion.mjs hands that statement to the judge, a model. ARCHITECTURE.md's
// Prompt library row says every sentence a model reads lives under prompts/. The words now live in
// prompts/_templates/ground-truth-statements.json; the pure functions take them as `texts`, io/ binds the file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import * as pure from '../scripts/lib/reconcile-mutations.mjs';
import * as bound from '../scripts/io/reconcile-mutations.mjs';
import { renderTemplate } from '../scripts/lib/template.mjs';

const MD = [
  '# Reconciled', '', '## Confirmed (1)', '',
  '### G-3 · BLOCKER · `a.mjs:10`', '', 'Raised by: `x`, `y`', '', 'Verified.', '',
  '- `x` · opus: a claim. (evidence: `evidence/x/a.log`)', '',
].join('\n');
const PAYLOAD = { groups: [{ group_id: 'G-3', severity: 'BLOCKER', decision: 'confirmed', rationale: 'Verified.' }] };
const GROUPS = { groups: [{ group_id: 'G-3', file: 'a.mjs', line: 10 }] };
const TEXTS = {
  misanchor: 'M {{group_id}} at {{to}}, really {{from}}',
  deflate: 'D {{group_id}} at {{to}}, really {{from}}',
  drop: 'X {{group_id}} was {{from}}',
};
const misanchor = (texts, f = pure) => f.applyMisanchor({ reconciledMd: MD, findingGroups: GROUPS, targetId: 'G-3', to: { file: 'b.mjs', line: 90 } }, texts);
const deflate = (texts, f = pure) => f.applyDeflate({ reconciledMd: MD, payload: PAYLOAD, targetId: 'G-3', to: 'LOW' }, texts);
const drop = (texts, f = pure) => f.applyDrop({ reconciledMd: MD, payload: PAYLOAD, targetId: 'G-3' }, texts);

test('each statement is rendered from the texts it is given, not from words in code', () => {
  assert.equal(misanchor(TEXTS).ground_truth.statement, 'M G-3 at b.mjs:90, really a.mjs:10');
  assert.equal(deflate(TEXTS).ground_truth.statement, 'D G-3 at LOW, really BLOCKER');
  assert.equal(drop(TEXTS).ground_truth.statement, 'X G-3 was confirmed');
});

test('a statement with no text throws rather than reaching the judge blank', () => {
  assert.throws(() => deflate({}), /deflate/);
  assert.throws(() => drop(undefined), /drop/);
});

test('io/ binds the prompt library file, and the lib module carries none of the old sentences', () => {
  const file = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'ground-truth-statements.json'), 'utf8'));
  assert.equal(deflate(undefined, bound).ground_truth.statement,
    renderTemplate(file.deflate, { group_id: 'G-3', to: 'LOW', from: 'BLOCKER' }));
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'reconcile-mutations.mjs'), 'utf8');
  for (const old of ['That is the wrong location', 'That is too low', 'That is wrong: the findings']) {
    assert.ok(!src.includes(old), `lib/reconcile-mutations.mjs still builds "${old}" in code`);
  }
});
