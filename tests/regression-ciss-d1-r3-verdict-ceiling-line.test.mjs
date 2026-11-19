// regression-ciss-d1-r3-verdict-ceiling-line.test.mjs — G-10 of review 20261021-190234-ciss-d1-remediations-review.
//
// The brief's verdict-ceiling line told a degraded lens its verdict "may not exceed" the ceiling and that the cap is
// always enforced, while spawn-node keeps a verdict a §6 invariant drives above it (capVerdictKeepingInvariants). A
// lens following the brief suppressed a verdict the validator would have kept. The line now states the exception, as
// the severity line beside it does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../scripts/run-graph.mjs', import.meta.url), 'utf8');

test('G-10: the verdict-ceiling line names the §6 invariant exception the validator enforces', () => {
  // The sentence lives in its template since G-12 of 20261021-194056-ciss-d1-remediation-3-review.
  assert.match(src, /verdict_ceiling_line: e\.verdict_ceiling\s*\?\s*degradedLine\(readTemplate\('degraded-verdict-ceiling\.md'\)/,
    'verdict_ceiling_line is rendered from e.verdict_ceiling');
  const line = fs.readFileSync(new URL('../prompts/_templates/degraded-verdict-ceiling.md', import.meta.url), 'utf8');
  assert.match(line, /§6 invariant/, 'the line states the invariant exception');
  assert.doesNotMatch(line, /both are enforced/, 'the line no longer claims the cap holds without exception');
  const spawn = fs.readFileSync(new URL('../scripts/spawn-node.mjs', import.meta.url), 'utf8');
  assert.match(spawn, /capVerdictKeepingInvariants/, 'the exception the line states is the one spawn-node enforces');
});
