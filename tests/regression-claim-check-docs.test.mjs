// claim-check-cross-family.plan.md stage 7. The documents a reader follows say what the code now does: the skill runs
// its checker with `claim-check.mjs --check`, naming the key and the roster entry that decide who checks; and
// shared/external-reviewers.md names the claim-check mode and what it sends, which is wider than any other mode's egress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\s+/g, ' ');

test('the skill runs the checker with --check and names the key and the roster entry', () => {
  const s = read('skills/claim-check/SKILL.md');
  assert.match(s, /scripts\/claim-check\.mjs <dir> --check/);
  assert.match(s, /review\.claim_check_transcript/);
  assert.match(s, /claim_checker/);
  assert.match(s, /same-family/);
});

test('external-reviewers.md names the mode and what it sends, transcript included', () => {
  const s = read('shared/external-reviewers.md');
  assert.match(s, /--mode claim-check/);
  assert.match(s, /claim_check_transcript: cross-family/);
  assert.match(s, /transcript/);
  assert.doesNotMatch(s, /Two uses of the panel/, 'the heading still counts two uses');
});
