// THE CANDIDATE POOL KEEPS WHAT ITS PROPOSERS SAID (ledger skills/candidate-pool/SKILL.md:0 and
// scripts/external-review.mjs:1050; operator, 2026-10-08: "The candidate-pool gaps: fix them now").
//
// story-pipeline's cloud-egress-confinement pool, 2026-10-08: codex ran 514 s and reported 'incomplete' after a constraint
// worded "must be verifiable by an automated test" led it to try running tests; nothing kept its raw reply, so whether it
// had proposed anything could not be known; and two launches into one output file interleaved. The skill now says how
// to keep the raw reply, how to reserve the output file, that a proposer proposes and executes nothing, and how to merge
// an incomplete proposer's partial candidates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\s+/g, ' ');

test('candidate-pool: the raw reply is kept and the output file is reserved, one per launch', () => {
  const s = read('skills/candidate-pool/SKILL.md');
  assert.match(s, /--evidence-dir/, 'without it a proposer reporting incomplete leaves nothing to inspect');
  assert.match(s, /--out <[^>]+>/, 'one output file per launch, created exclusively');
});

test('candidate-pool: every brief tells the proposer it proposes and executes nothing', () => {
  const s = read('skills/candidate-pool/SKILL.md');
  assert.match(s, /you are proposing, not verifying/i);
  assert.match(s, /describe how [^.]*would be tested, do not test it/i);
});

test('candidate-pool: an incomplete proposer\'s partial candidates are merged, labelled, not counted as the pool', () => {
  const s = read('skills/candidate-pool/SKILL.md');
  assert.match(s, /incomplete_candidates/);
  const d = read('shared/external-reviewers.md');
  assert.match(d, /incomplete_candidates/, 'the adapter doc names the field');
});

// G-9 of 20261008-175234-cpool-and-design-step: the owning command contract kept the old proposal shape.
test('the command contract names incomplete_candidates and --out', () => {
  const c = read('shared/claude-md-contract.md');
  assert.match(c, /incomplete_candidates/);
  assert.match(c, /`--out <file>`/);
});

// G-14 of 20261008-181148-cpool-r2: the adapter doc restated --out as standalone after the code began requiring an
// evidence sink. The rule is stated once, in the command contract.
test('the adapter doc points at the command contract for --out instead of restating it', () => {
  const d = read('shared/external-reviewers.md');
  assert.doesNotMatch(d, /`--out <file>` writes the response/);
  // G-14 of 20261009-055155-ero-review: the pointer must name the ids the row owns, or it points at nothing checkable.
  assert.match(d, /`--out` flag and its rules are stated once, in `shared\/claude-md-contract\.md`[\s\S]{0,80}as `OUT-1` … `OUT-8`/);
});
