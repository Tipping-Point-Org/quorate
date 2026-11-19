// THE PROBE RE-IMPLEMENTED THE THING IT WAS STANDING IN FOR (G-6/G-7, arch-review + contract-audit).
//
// `check-tiebreak.mjs` exists because nothing else in the offline suite ever spawns an adjudication:
// its whole value is that what it sends is what run-graph sends. It composed that payload itself —
// the participant list, the mechanical-facts block, the node-id format — and the copy had already
// drifted from the orchestrator's:
//
//   * production states a `- <node> claims severity X on basis Y` line per finding; the probe's
//     facts block had three lines and no severities at all
//   * production COMPUTES whether the cited line falls inside the excerpt; the probe asserted it,
//     so the one fact a judge most needs was true in the probe by construction
//   * the node-id format lived in a template literal in each file, which is how every real
//     adjudication came to be refused at argument-parse time while the probe reported the path
//     as exercised
//
// One owner now: `adjudicationBrief()`. These tests hold both call sites to it, and hold the brief
// itself to stating the fields that went missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { adjudicationBrief } from '../scripts/lib/adjudication.mjs';

const GRAPH = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
// THE PROBE IS external-review's tie-break probe since reviewer-preflight stage 4, which retired check-tiebreak.mjs; it
// renders lib/reviewer-probe.mjs's synthetic dispute through the same brief.
const ER_SRC = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
// From probeInput, which builds the probe's input for runProbe and for a --probe-run child's check (G-2 of
// 20261020-172345-argv-remediation-review), through the end of runProbe.
const PROBE = ER_SRC.slice(ER_SRC.indexOf('function probeInput('), ER_SRC.indexOf('\n}\n', ER_SRC.indexOf('function runProbe(')));

const GROUP = {
  group_id: 'G-9',
  file: 'scripts/lib/example.mjs',
  line: 12,
  findings: [
    { node_id: 'code-audit', severity: 'HIGH', basis: 'executed' },
    { node_id: 'panel-codex-code', severity: 'MEDIUM', basis: 'convention' },
  ],
};
const EXCERPT = { ok: true, from: 10, to: 14, of: 40 };

test('the brief states every fact a judge would otherwise compute for itself', () => {
  const { participants, mechanicalFacts } = adjudicationBrief({ group: GROUP, excerpt: EXCERPT });
  assert.deepEqual(participants, ['code-audit', 'panel-codex-code']);
  assert.match(mechanicalFacts, /- positions in this dispute: 2/);
  assert.match(mechanicalFacts, /covers lines 10-14 of 40/);
  assert.match(mechanicalFacts, /the cited line IS inside the excerpt/);
  // THE TWO LINES THE PROBE'S COPY HAD LOST. A judge asked to weigh two positions without being
  // told what each one CLAIMS — how bad, on what evidence — is being asked to guess the input.
  assert.match(mechanicalFacts, /- code-audit claims severity HIGH on basis executed/);
  assert.match(mechanicalFacts, /- panel-codex-code claims severity MEDIUM on basis convention/);
});

test('the cited line is COMPUTED, so a fact that is false comes out false', () => {
  // The probe hard-coded "the cited line IS inside the excerpt". Outside it, or with no excerpt at
  // all, the brief has to say so: an adjudicator that believes it can see the line it is ruling on,
  // and cannot, rules on the wrong thing and reports high confidence in it.
  const outside = adjudicationBrief({ group: { ...GROUP, line: 99 }, excerpt: EXCERPT });
  assert.match(outside.mechanicalFacts, /the cited line is NOT inside the excerpt/);

  const failed = adjudicationBrief({ group: GROUP, excerpt: { ok: false, reason: 'file is binary' } });
  assert.match(failed.mechanicalFacts, /the excerpt is NOT available/);
  assert.match(failed.mechanicalFacts, /the cited line is NOT inside the excerpt/,
    'no excerpt means the line is not in it — claiming otherwise is the same false fact');
});

test('regression: neither the orchestrator nor the probe composes a facts block of its own', () => {
  // The guard against the defect RECURRING. Both files hand `mechanicalFacts` straight from the
  // brief; a hand-built line reappearing in either is the start of the next divergence.
  for (const [name, src] of [['run-graph', GRAPH], ['external-review probe', PROBE]]) {
    assert.match(src, /mechanicalFacts/,
      `${name} must pass the brief's facts into the tie-break prompt`);
    assert.ok(!/positions in this dispute/.test(src),
      `${name} composes its own mechanical fact — that text belongs to lib/adjudication.mjs alone`);
    // THE PER-JUDGE ID SPECIFICALLY — `adjudicate-<group>-<judge>`, the one that was refused at
    // argument-parse time. Narrowed deliberately: the group-level artifacts (`evidence/adjudicate-G-9/`,
    // the one prompt every judge on that group reads) carry no judge and are not this format, and a
    // guard that forbade the whole prefix would have demanded they be routed through a helper that
    // does not describe them.
    assert.ok(!/adjudicate-\$\{[^}]*\}-\$\{/.test(src),
      `${name} composes its own per-judge adjudication node id; that format has one owner`);
  }
});

test('regression: the probe and the orchestrator build the brief from the same group shape', () => {
  // `group_id` vs `groupId` is why this needs an assertion rather than a reading. The probe spelled
  // it the prompt builder's way, the brief read nothing, and the default it fell through to happened
  // to match — so the two agreed by coincidence inside the helper written to make them agree.
  assert.match(GRAPH, /adjudicationBrief\(\{ group: \{ \.\.\.g, \.\.\.src \}/,
    'run-graph builds the brief from the finding-group it is adjudicating');
  assert.match(PROBE, /adjudicationBrief\(\{ group, excerpt: group\.excerpt \}\)/,
    'the probe builds it from its synthetic group, by the same call');

  // And a group that cannot name itself gets no name invented for it.
  assert.throws(() => adjudicationBrief({ group: {} }).nodeId('agy'), /group_id is required/);
});
