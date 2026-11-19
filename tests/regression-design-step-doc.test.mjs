// THE DESIGN STEP IS WRITTEN DOWN WHERE A CONSUMER CAN FIND IT (operator, 2026-10-08: "The design-step procedure: write
// it up in shared/"). D1's round cap said WHEN to stop patching and nothing said HOW to run the design review that
// replaces the fourth patch; story-pipeline had to ask by message. The procedure lives in shared/design-step.md, and the
// two places a reader reaches the round cap from point at it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\s+/g, ' ');

test('shared/design-step.md names the four artifacts and that the contract points at the approved plan', () => {
  const d = read('shared/design-step.md');
  for (const want of [/\.design\.md/, /quorate:plan-authoring/, /quorate:plan-review/, /status: approved/, /doc_roles\.request/]) {
    assert.match(d, want);
  }
  assert.match(d, /to the PLAN, not the design note/);
});

test('the round cap and the consumer onboarding both point at the design-step procedure', () => {
  // The round cap moved to shared/remediation.md (remediate-rebuild stage 1); it is where the pointer now lives.
  assert.match(read('shared/remediation.md'), /stop patching and review the design \(`shared\/design-step\.md` says how\)/);
  assert.match(read('QUORATE.md'), /shared\/design-step\.md/);
});
