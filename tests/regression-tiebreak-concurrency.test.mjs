// G-35: the disputed-group loop awaited each external tie-break before starting the next, so wall
// time was the SUM of reviewer latency across every dispute — each one a live third-party call
// bounded only by NODE_TIMEOUT. The panel arms sitting beside it have run as a bounded pool since
// they were written; the tie-breaks are the same work against the same kind of endpoint.
//
// WHY THIS TEST IS STRUCTURAL. The tie-break path only executes when reconcile declares a dispute
// AND a tie_breaker is configured AND a real vendor answers — there is no way to exercise it in an
// offline suite without spawning a billed session, which a regression suite must never do. So what
// is pinned here is the ORDER OF THE MACHINERY, which is exactly where the two hazards of this
// change live. Both would be silent in production:
//
//   1. expected.json must be written before ANY spawn. That pre-commitment is what makes a node
//      that never reports detectable rather than merely absent — write it after the pool starts and
//      an interrupt leaves work that ran, spent tokens, and appears in no record.
//   2. reconciled.md must not be ordered by reviewer latency. Appending as rulings arrive would
//      reorder the file run to run for no reason a reader could interpret, on the artifact
//      second-opinion audits.
//
// A source assertion is the weaker instrument and it is chosen deliberately, not by default.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
// Comments stripped: they quote the old shapes on purpose, to record what was wrong.
const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const at = (needle) => {
  const i = code.indexOf(needle);
  assert.notEqual(i, -1, `the tie-break section no longer contains ${JSON.stringify(needle)} — ` +
    'this test pins an ordering, so a rewrite must re-establish it rather than delete the anchor');
  return i;
};

test('regression: tie-breaks run as a bounded pool, not one after another', () => {
  const poolAt = at('await runPool(prepared');
  // Searched forward rather than within a fixed window: the worker body is ~100 lines, and a
  // window guess is a test that fails when the body grows rather than when the property breaks.
  const closer = code.indexOf('}, CONCURRENCY, () => aborted)', poolAt);
  assert.notEqual(closer, -1,
    'the pool takes the contract width and stops taking new work on abort — a tie-break is a billed '
    + 'vendor call, and an interrupt that keeps launching them costs quota after the operator said stop');
});

test('regression: every expected.json row is committed before any tie-break spawns', () => {
  // ANCHORED ON THE CALL, NOT ITS PAYLOAD. This pinned the full destructured field list, so it went
  // red when `judgeId` was added to the payload — a fix for a ReferenceError that had made every
  // adjudication throw. The ordering this test defends is unaffected by which values travel with each
  // prepared row, and an anchor that breaks on an unrelated field teaches the reader to re-anchor it
  // without checking whether the ordering still holds.
  const rowsAt = at('prepared.push({');
  const writeAt = code.indexOf("writeJson(path.join(nodesDir, 'expected.json')", rowsAt);
  const poolAt = at('await runPool(prepared');
  assert.notEqual(writeAt, -1, 'the tie-break rows must still be written to expected.json');
  assert.ok(rowsAt < writeAt, 'rows are collected before the file is written');
  assert.ok(writeAt < poolAt,
    'expected.json must be written BEFORE the pool starts: a spawn that precedes its own '
    + 'pre-commitment is work the run never promised existed, which is the one shape '
    + '"silence is not a verdict" cannot catch');
});

test('regression: reconciled.md is ordered by the disputes, not by who answered first', () => {
  const poolAt = at('await runPool(prepared');
  const poolEnd = at('}, CONCURRENCY, () => aborted)');
  const body = code.slice(poolAt, poolEnd);
  // KEYED PER GROUP AND PER JUDGE. One key per group would leave whichever judge finished last,
  // which is the single-judge shape rebuilt out of concurrency.
  // AMENDED for G-14: the key was `judge.reviewer`, the TRANSPORT. That satisfied "per group and per
  // judge" only while every judge had its own adapter — two judges reached through one agy (which
  // capabilities.mjs permits, since agy serves Gemini and Claude models) shared a key, and the second
  // ruling overwrote the first. This test asserted the transport form, so it pinned the defect in
  // place: the very shape it exists to prevent, rebuilt one level down.
  assert.match(body, /ruled\.set\(`\$\{g\.group_id\}::\$\{judgeId\}`/,
    'a worker records its vote under the group AND the DECLARED judge, not its adapter');
  assert.ok(!/rulings\.push\(/.test(body),
    'nothing may append to the rendered list from inside the pool — that is completion order');
  const assembleAt = code.indexOf('rulings.push(', poolEnd);
  assert.notEqual(assembleAt, -1, 'the rulings must still be assembled after the pool');
  assert.match(code.slice(poolEnd, assembleAt + 900), /for \(const g of toAdjudicate\)/,
    'assembly walks the DISPUTES in declared order — `prepared` is now one entry per (group, judge), '
    + 'so walking it would render a group once per judge');
});

test('regression: a group the pool never reached is named, not silently dropped', () => {
  // An abort mid-pool leaves entries with no ruling. Omitting them would make a dispute disappear
  // from reconciled.md, which is indistinguishable from a dispute that was resolved — the same
  // silence-as-a-verdict this whole system refuses.
  // TWO LAYERS NOW. A group the pool never reached has no merge at all, and a judge that never
  // answered has no line within a group that was reached. Both are named rather than omitted —
  // a missing judge quietly rendering as a smaller panel is the same silence-as-a-verdict.
  assert.match(code, /not adjudicated — the run was interrupted/,
    'an unadjudicated dispute must say so in the artifact');
  assert.match(code, /no record — interrupted/,
    'and a judge that never reported must be visible as itself, not as a narrower panel');
});
