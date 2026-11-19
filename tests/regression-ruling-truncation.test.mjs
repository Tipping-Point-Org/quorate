// G-36: a tie-break ruling was bounded by a bare `ruling.slice(0, 1200)` — no mark where the text
// was removed, and the head kept in preference to the tail.
//
// That combination is what made it a defect rather than a style point. A ruling is assembled as
// `supports <node> · confidence <c>. <rationale> [not checked: <items>]`, so the adjudicator's own
// declared gaps are concatenated LAST. A rationale of ordinary length therefore pushed the
// not_checked list off the end, and reconciled.md — which is what second-opinion audits and what
// the gate summarises — showed a ruling stopping mid-sentence, indistinguishable from one that
// ended there. A reader could not tell an adjudicator who checked everything from one who said
// they had not, on the artifact that resolves a cross-family dispute.
//
// This codebase already had one owner for bounding output visibly: lib/log-window.mjs, which
// writes what it dropped in place of the drop, and keeps a tail as well as a head for exactly this
// reason (capture.mjs:383 — the diagnosis of a failing build is at the end of the log).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { logWindow } from '../scripts/lib/log-window.mjs';
import { REPO_ROOT } from './helpers.mjs';

const RULING_MAX_BYTES = 1200;

const bound = (text) => Buffer.concat(logWindow(
  [Buffer.from(text, 'utf8')], RULING_MAX_BYTES,
  ({ total, headBytes, tailBytes, dropped }) => Buffer.from(
    `\n\n[TRUNCATED — ruling was ${total} bytes; first ${headBytes} and last ${tailBytes} kept, `
    + `${dropped} dropped from the middle — read the tie-breaker's raw envelope under evidence/]\n\n`),
)).toString('utf8');

// The shape run-graph actually builds, with the gaps last.
const ruling = (rationaleBytes) =>
  'supports **panel-codex-code** · confidence high. '
  + 'R'.repeat(rationaleBytes)
  + ' [not checked: the runtime behaviour of the timeout path, the Windows shell quoting]';

test('regression: an over-long ruling still carries the adjudicator\'s not_checked items', () => {
  const out = bound(ruling(4000));
  assert.ok(out.includes('[not checked: the runtime behaviour of the timeout path'),
    'the declared gaps are concatenated last, so a head-only bound drops exactly what matters most');
});

test('regression: a truncated ruling says it was truncated', () => {
  const out = bound(ruling(4000));
  assert.match(out, /\[TRUNCATED — ruling was \d+ bytes/,
    'a ruling that stops without a mark is indistinguishable from one that ended there');
  assert.ok(out.includes('supports **panel-codex-code**'),
    'the adjudicated position is at the front and must survive');
});

test('regression: a ruling within the bound is passed through untouched', () => {
  const short = ruling(50);
  assert.equal(bound(short), short, 'bounding must not alter output that fits');
  assert.ok(!bound(short).includes('TRUNCATED'), 'no notice may appear when nothing was dropped');
});

test('regression: the bound is enforced, not merely announced', () => {
  const out = bound(ruling(40_000));
  // The notice itself sits outside the kept-bytes budget by design (log-window.mjs), so the check
  // is that the payload is bounded — not that the whole string is under the number.
  assert.ok(out.length < RULING_MAX_BYTES + 400,
    `a bounded ruling must stay bounded; got ${out.length} bytes`);
});

test('regression: run-graph bounds the ruling through the owner, not with a bare slice', () => {
  // The one source assertion here, and it is pinned to the DEFECT rather than to a spelling: a bare
  // slice on the ruling is the thing that must not come back. Adding it anywhere in the file fails.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  // COMMENTS STRIPPED FIRST. The first version of this assertion went red on the comment ABOVE the
  // fix, which names the old expression to record what it was — so the test forbade documenting the
  // defect it exists to prevent. A source assertion must read code, not prose about code.
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/ruling\.slice\(/.test(code),
    'the ruling must be bounded through lib/log-window.mjs so the cut is visible in reconciled.md');
  assert.ok(code.includes('logWindow'), 'run-graph must use the module that owns visible bounding');
});
