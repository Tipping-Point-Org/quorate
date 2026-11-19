// claim-check-cross-family.plan.md stage 0. `review.claim_check_transcript` decides whether the session's transcript
// reaches the cross-family claim checker (`cross-family`) or attributions stay with a Claude checker (`claude`)
// (operator, 2026-10-18: "2 wiht config to fallback to 1"; "Absent = claude (Recommended)"). Absent is `claude`, so a
// consumer sends no transcript to a second vendor unless it decides to; a value outside the two is refused, not guessed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import * as claimCheck from '../scripts/lib/claim-check.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// G-8 of 20261019-014448-ccf-delivery: the vocabulary named a vendor (`claude`), which A-9 forbids; it names a role.
test('claimCheckTranscriptOf: absent is same-family; the two values are themselves; anything else is refused', () => {
  const { claimCheckTranscriptOf } = claimCheck;
  assert.equal(typeof claimCheckTranscriptOf, 'function', 'lib/claim-check.mjs has no claimCheckTranscriptOf');
  assert.equal(claimCheckTranscriptOf({}), 'same-family');
  assert.equal(claimCheckTranscriptOf(undefined), 'same-family');
  assert.equal(claimCheckTranscriptOf({ claim_check_transcript: 'cross-family' }), 'cross-family');
  assert.equal(claimCheckTranscriptOf({ claim_check_transcript: 'same-family' }), 'same-family');
  for (const bad of ['', 'codex', 'claude', 'Claude', true, 1]) {
    assert.throws(() => claimCheckTranscriptOf({ claim_check_transcript: bad }), /claim_check_transcript/,
      `${JSON.stringify(bad)} was accepted`);
  }
});

test('new-run refuses a malformed claim_check_transcript at mint, through the same reader', () => {
  assert.match(read('scripts/new-run.mjs'), /claimCheckTranscriptOf\(review\)/);
});

// The template's line is asserted again (the remediation removed it, the template being outside its source_globs): the
// rename landed in fe16eaec (operator, 2026-10-19: "Node fixes code; I edit the template after (Recommended)").
test('this repository declares cross-family; the template declares same-family; the contract doc says what each sends', () => {
  assert.match(read('CLAUDE.md'), /\n  claim_check_transcript: cross-family\b/);
  assert.match(read('CLAUDE.template.md'), /\n  claim_check_transcript: same-family\b/);
  const doc = read('shared/claude-md-contract.md').replace(/\s+/g, ' ');
  assert.match(doc, /`claim_check_transcript`/);
  assert.match(doc, /absent (is|means) `same-family`/i);
  assert.match(doc, /transcript/);
});
