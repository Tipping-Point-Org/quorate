// ONE DOCUMENT OWNS THE BATCHING RULE, AND THE CHARGE IS NAMED (.claude/requests/reconcile-batches.plan.md stage 4;
// design §4 and §6; G-12 and G-13 of 20261007-050929-consumer-use-r4).
//
// ARCHITECTURE.md and the disk-first protocol each restated the batching rule, and drifted (G-13); the contract doc
// presented a batched barrier's total_cost_usd as spend when it is a charge, an upper bound when a cost is unknown
// (G-12). Seen red on stage 3's commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\s+/g, ' ');

test('the disk-first protocol owns the batching rule: validation, links, clear-up, money', () => {
  const p = read('shared/disk-first-protocol.md');
  const i = p.indexOf('**Batched reconcile.**');
  assert.ok(i !== -1, 'the protocol must carry the "Batched reconcile" paragraph');
  // To the next heading, not a fixed 2500 characters (reconcile-reask-shape.plan.md stage 4): the paragraph grew with the
  // re-ask, and the cut dropped its last rule, which refused remediation 20261024-003108-rmg-remediation-3b.
  const next = p.indexOf(' ### ', i);
  const para = p.slice(i, next === -1 ? undefined : next);
  assert.match(para, /checked against its own groups/, 'each reply is validated against its batch');
  assert.match(para, /a root-cause link must name a group the same reply judged/, 'the link rule');
  assert.match(para, /RECONCILE_ARTIFACTS/, 'the clear-up names its list');
  assert.match(para, /one barrier budget and time/, 'the batches share one ceiling');
  assert.match(para, /run budget admits the barrier/, 'and the run budget admits the barrier before it launches');
});

test('ARCHITECTURE.md points at the protocol for the batching rule instead of restating it', () => {
  const a = read('ARCHITECTURE.md');
  assert.match(a, /The reconcile step is ONE node.{0,200}The rules are shared\/disk-first-protocol\.md's \("Batched reconcile"\)/);
  assert.doesNotMatch(a, /A symptom can name its root cause only inside its batch/, 'a restated rule drifts from its owner');
});

test("the contract doc says a batched barrier's total_cost_usd is a charge, an upper bound when a cost is unknown", () => {
  const c = read('shared/claude-md-contract.md');
  assert.match(c, /On a batched barrier, reconcile's `total_cost_usd` is a charge, not a measured spend/);
  assert.match(c, /an upper bound/);
  assert.match(c, /`total_cost_usd_known`/, 'and where the measured part is');
});

// G-7, G-11 and G-12 of 20261008-021115-batch-share-review: the protocol omitted the floor and the zero charge for a batch
// that never launched, and the contract doc restated the charge rule (omitting the same exception) instead of pointing.
// THE PARAGRAPH TO ITS NEXT HEADING, not a fixed 3000 characters (G-14 of 20261024-024945-rrs-delivery): the paragraph
// had grown past the window, so text it states could fall outside the slice, or text after it fall inside.
function batchedParagraph(p) {
  const i = p.indexOf('**Batched reconcile.**');
  const next = p.indexOf(' ### ', i);
  return p.slice(i, next === -1 ? undefined : next);
}

// G-11 of 20261024-024945-rrs-delivery: the run layout called finding-groups.json "the reconciler's only input", above
// the batch files that are also its input, and left out the re-ask's groups files.
test('G-11: the run layout lists every groups file the reconciler reads, and calls none the only input', () => {
  const p = read('shared/disk-first-protocol.md');
  assert.doesNotMatch(p, /finding-groups\.json findings grouped by location — the reconciler's only input/);
  assert.match(p, /finding-groups\.reask-N\.json/, 'the re-ask groups files are in the layout');
});

test('G-14: the paragraph is cut at its heading, whatever its length', () => {
  const filler = 'x '.repeat(2000);
  const doc = `## A **Batched reconcile.** ${filler} never less than a floor ### Next nothing when it never launched`;
  const para = batchedParagraph(doc);
  assert.match(para, /never less than a floor/, 'text past 3000 characters is still in the paragraph');
  assert.doesNotMatch(para, /nothing when it never launched/, 'text under the next heading is not');
});

test('the protocol states the floor and the zero charge for an unlaunched batch; the contract doc points instead of restating', () => {
  const p = read('shared/disk-first-protocol.md');
  const para = batchedParagraph(p);
  assert.match(para, /never less than a floor/, 'the floor is stated');
  assert.match(para, /nothing when it never launched/, 'the unlaunched exception is stated');
  const c = read('shared/claude-md-contract.md');
  assert.doesNotMatch(c, /its whole grant when its cost is unknown/, 'the charge rule is owned by the protocol, not restated');
});
