// G-41 AND ITS SIBLING — THE JUDGE STATUS WRITER KEEPS ONLY WHAT SOMEBODY REMEMBERED TO LIST.
//
// G-41 (panel-codex-contract, 2026-09-14, times_seen 3, never fixed): external-review names an unpinned
// model or effort in its envelope's `not_checked`, and run-graph keeps that only in
// `evidence/<node>/ruling.json` and the rendered ruling line. It never reaches the gate, because "the
// status file carries supports and confidence only".
//
// The sibling, found 2026-09-15 by asking whether a run can be capped on tokens: the same writer drops
// `usage`. The judge's envelope carries it —
//
//   "usage":{"input_tokens":17197,"output_tokens":5078,"thinking_tokens":4810,
//            "cache_read_tokens":0,"total_tokens":22275}
//
// — external-review computes it for EVERY mode including tie-break, and the ARM writer copies it
// through. So the four adjudication nodes are invisible to any token accounting for want of one field,
// which is what stopped a token ceiling covering a whole run rather than 96% of it.
//
// Two symptoms, one cause: this writer enumerates the fields it keeps, so anything the envelope gains
// is silently discarded until someone adds a line. That is why this test checks the WRITER's
// completeness against what the envelope provides, rather than checking for `usage` alone — fixing one
// field and leaving the class is the mistake that produced the sibling.
//
// Recorded because it is the honest part: the author of this test edited this same pool on 2026-09-14 to
// fix G-14's ruling key, twenty lines away, while G-41 sat open on the ledger with three sightings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

/**
 * Read with line endings NORMALISED. This file is CRLF on Windows, so an anchor written with a bare
 * newline matches nothing — which is how the first version of this test failed for its own reason
 * rather than for the defect's, twice in a row.
 */
function source() {
  return fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8').split('\r\n').join('\n');
}

/** The judge pool's status writer, as source, comments stripped so prose cannot satisfy an assertion. */
function judgeStatusWriter() {
  const src = source();
  // The FINAL writer, not the RUNNING stub that precedes it: take the LAST adjudication status.
  const start = src.lastIndexOf('kind: NODE_KIND.adjudication, source: judge.reviewer,');
  assert.ok(start > 0, 'the judge status writer moved — this test must be re-anchored, not deleted');
  const block = src.slice(start, src.indexOf('exit_code: r.status,', start) + 40);
  return block.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

test('a judge status records its token usage', () => {
  assert.match(judgeStatusWriter(), /usage:/,
    'the envelope carries usage for every mode including tie-break, and the ARM writer copies it. '
    + 'Without it the adjudication nodes are invisible to token accounting — the missing 4% of a run.');
});

test("a judge status routes the envelope's not_checked to the gate", () => {
  assert.match(judgeStatusWriter(), /not_checked/,
    'G-41: external-review names an unpinned model or effort in not_checked, and it reached only '
    + 'evidence/ruling.json and the rendered ruling line. I-10 and I-42 want it named at the gate.');
});

// THE CLASS, NOT THE TWO INSTANCES. The writer enumerates what it keeps, so the next field the envelope
// gains is dropped in silence too. This is the assertion that would have caught the sibling.
test('every field the arm writer carries from an envelope, the judge writer carries too', () => {
  const src = source();
  const strip = (s) => s.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  // The arm's status writer, located the same way.
  // Anchored on env_passed alone: the auth_mode beside it became a derived call when the BLOCKER was
  // fixed, and an anchor that includes a value under active repair breaks for the wrong reason.
  const armStart = src.indexOf('env_passed: armEnvPassed,');
  assert.ok(armStart > 0, 'the arm status writer moved — re-anchor rather than delete');
  const arm = strip(src.slice(Math.max(0, armStart - 2600), armStart + 200));
  const judge = judgeStatusWriter();

  // Fields that describe WHAT THE VENDOR REPORTED, as opposed to what this node is.
  for (const field of ['usage', 'not_checked']) {
    if (!new RegExp(`${field}:`).test(arm)) continue;   // only hold the judge to what the arm actually does
    assert.match(judge, new RegExp(`${field}:`),
      `the arm writer records ${field} and the judge writer does not. Both read an envelope from the `
      + 'same script; a field one keeps and the other drops is an accounting hole nobody declared.');
  }
});

// The evidence file is the other half of G-41: the detail belongs there AND the machine-readable
// accounting belongs in the tracked status. One is not a substitute for the other.
test('the ruling evidence keeps the detail, and is not the only place it lives', () => {
  const src = source();
  const ruling = src.slice(src.indexOf("writeJson(path.join(dir, 'ruling.json')"));
  const block = ruling.slice(0, 600);
  assert.match(block, /not_checked/, 'the vendor detail still goes to evidence, which is gitignored');
  // And the rationale must NOT be in the tracked status — third-party prose quotes repository content.
  assert.ok(!/rationale:/.test(judgeStatusWriter()),
    "a vendor's rationale is free text that quotes the disputed excerpt back, and the status is tracked");
});
