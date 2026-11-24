// THE LENS BRIEF'S COMMAND HEADS GO THROUGH briefHead, AS THE REMEDIATION BRIEF'S DOES (G-11, G-12 of
// 20261121-214741-m3s7-b1-remediation-2-review): run-graph.mjs built `capture_rel` and `detector_abs` as bare paths while
// remediate.mjs sent its capture head through briefHead, two owners for one rule. A framework installed under a path with
// a space or a shell-active character handed every lens a capture command, and the mandatory detector sweep, that the
// shell splits or expands. briefHead does not quote (the allow-lists prefix-match the head); it refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../scripts/run-graph.mjs', import.meta.url), 'utf8');

test('run-graph names both command heads in the lens brief through briefHead', () => {
  for (const head of ['capture_rel', 'detector_abs']) {
    const line = src.split('\n').find((l) => l.trimStart().startsWith(`${head}:`)) ?? '';
    assert.match(line, new RegExp(`^\\s*${head}: briefHead\\(`), `${head} is interpolated unchecked: ${line.trim()}`);
  }
  assert.match(src, /import \{[^}]*\bbriefHead\b[^}]*\} from '\.\/lib\/decisions\.mjs'/s, 'briefHead is not imported');
});
