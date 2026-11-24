// G-19 and G-20 of 20261122-002915-m3s7-b2-remediation-review. I-16 (A-9): no generic prompt template is named for a
// vendor. Only the transcript template was renamed (claim-check-arm-transcript.md); the same-family claim checker's brief
// still read claim-check-claude.md and claim-check-claude-scope.md. And that brief's transcript line, model-facing prose,
// was still built in JavaScript rather than read from the prompt library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as REPO } from './helpers.mjs';

const VENDOR = /claude|codex|agy|gemini|openai|anthropic/i;

// The renamed templates exist, so the readers below have something to read. (The two old files themselves are removed by
// hand: the remediation node that renamed them had no grant to delete a file.)
test('the same-family claim-check templates exist under role names', () => {
  const names = readdirSync(join(REPO, 'prompts', '_templates'));
  for (const f of ['claim-check-same-family.md', 'claim-check-same-family-scope.md', 'claim-check-same-family-transcript.md']) {
    assert.ok(names.includes(f), `${f} is missing`);
  }
});

test('review-prompts reads no vendor-named template', () => {
  const src = readFileSync(join(REPO, 'scripts', 'lib', 'review-prompts.mjs'), 'utf8');
  const reads = [...src.matchAll(/readTemplate\('([^']+)'/g)].map((m) => m[1]).filter((f) => VENDOR.test(f));
  assert.deepEqual(reads, [], 'a read of a vendor-named template');
});

test("the same-family brief's transcript line is prose from the prompt library, not from code", () => {
  const src = readFileSync(join(REPO, 'scripts', 'lib', 'review-prompts.mjs'), 'utf8');
  assert.doesNotMatch(src, /`- The session transcript/, 'the transcript sentence is built in JavaScript');
});
