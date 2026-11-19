// A RENAME MOVED EVERY WRITER AND NO READER (G-9, code-audit).
//
// `kind: 'tiebreak'` became `kind: 'adjudication'` at all four write sites in run-graph when the
// adjudication panel replaced the single tie-breaker. Two readers kept the old string:
//
//   findings-ledger.mjs:312  .filter((st) => ... st?.kind !== 'tiebreak')
//   lib/decisions.mjs:177    isFanOutNode = (e) => e?.present && e?.kind !== 'panel-arm'
//
// The first is the one that cost something. `okLenses` answers "did anything actually examine this
// code", and `okNodes` is what lets a remediation claim be closed by the silence of the lens that
// RAISED it. With the filter matching nothing, a judge that ruled on one disputed line counted as a
// lens that had reviewed the tree — so a claim could be confirmed by the silence of a node that
// never looks for defects at all.
//
// Both were blacklists, which is the shape that fails on an ADDED kind rather than a renamed one:
// every blacklist admits a new kind by default. The lists live in one module now, and this file
// holds the writers to them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import {
  NODE_KIND, NON_FAN_OUT_KINDS, NON_REVIEW_KINDS, kindsAreClassified, isFanOutNode, statusIsReview,
} from '../scripts/lib/decisions.mjs';

const GRAPH = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');

test('regression: every kind run-graph WRITES comes from the owner, not a literal', () => {
  // Stronger than checking that the literals happen to be declared values: with no literals left,
  // a rename cannot desync the writers from the readers, because there is one spelling.
  const written = [...GRAPH.matchAll(/\bkind: (NODE_KIND\.\w+|'[a-z-]+')/g)].map((m) => m[1]);
  assert.ok(written.length >= 7, `expected every node row and status to set a kind; found ${written.length}`);
  const literals = written.filter((k) => k.startsWith("'"));
  assert.deepEqual(literals, [],
    `run-graph writes ${literals.join(', ')} as a literal — a rename then moves the writer and `
    + 'leaves every reader classifying the new kind as an ordinary lens, which is exactly how a judge '
    + 'came to count as evidence that the code was reviewed');
  for (const k of new Set(written)) {
    assert.ok(k.replace('NODE_KIND.', '') in NODE_KIND, `${k} is not a declared kind`);
  }
  // ...and the retired string is gone from both ends, not merely unused at one. Checked against CODE
  // only: a comment quoting the defect is how every fix in this repository records itself, and a
  // guard that forbids naming the old value forbids explaining it.
  const code = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const ledger = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'findings-ledger.mjs'), 'utf8');
  assert.ok(!/'tiebreak'/.test(code(GRAPH)), 'the renamed kind must not linger in the writer');
  assert.ok(!/'tiebreak'/.test(code(ledger)), 'nor in the reader that outlived it');
  assert.match(ledger, /statusIsReview\(st\)/, 'the ledger asks the owner');
});

test('every declared kind is classified by both readers, as a member or deliberately not', () => {
  const c = kindsAreClassified();
  assert.deepEqual(c.unknown, [],
    `these kinds are classified but not declared: ${c.unknown.join(', ')}`);
  // The classifications as they stand, stated so a change to either is visible in a diff.
  assert.deepEqual(c.fan_out, [NODE_KIND.lens], 'only lenses are spawned by the lens fan-out');
  assert.deepEqual(c.reviews, [NODE_KIND.lens, NODE_KIND.arm],
    'an arm examines the code and counts; a judge rules on one dispute and does not');
  assert.ok(NON_FAN_OUT_KINDS.includes(NODE_KIND.adjudication));
  assert.ok(NON_REVIEW_KINDS.includes(NODE_KIND.adjudication));
});

test('regression: an adjudication row is neither spawned by the fan-out nor counted as a review', () => {
  // The two failures the desync produced, as behaviour.
  const judge = { node_id: 'adjudicate-G-5-agy', present: true, skill: null, kind: NODE_KIND.adjudication };
  assert.equal(isFanOutNode(judge), false,
    'spawn-node dies instantly on a row with skill: null — wasted spawns racing the real one');
  assert.equal(statusIsReview({ state: 'OK', kind: NODE_KIND.adjudication }), false,
    'a judge ruling on one line is not evidence that the tree was examined');

  // And the rows that MUST still pass, including the shape a real status file has: a lens status
  // carries no `kind` field at all, so an absent kind is an ordinary reviewing node.
  assert.equal(isFanOutNode({ node_id: 'code-audit', present: true, skill: '/code-audit', kind: NODE_KIND.lens }), true);
  assert.equal(statusIsReview({ state: 'OK', node_id: 'code-audit' }), true,
    'a lens status has no kind field — treating absent as non-reviewing would empty the ledger');
  assert.equal(statusIsReview({ state: 'OK', kind: NODE_KIND.arm }), true);
  assert.equal(statusIsReview({ state: 'OK', mode: 'intent' }), false,
    'intent capture precedes the implementation and reviews nothing');
});
