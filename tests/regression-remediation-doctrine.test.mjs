// THE FIX-OR-LEDGER RULE LIVES IN shared/, WHERE A CONSUMER HAS IT (remediate-rebuild.plan.md stage 1; design decision 3,
// operator 2026-10-08: "Move into shared/ (Recommended)"). D1's table, *related*, the pre-existence test, the
// single-family LOW rule and the round cap lived in quorate's own ROADMAP.md, and skills/remediate pointed a consumer's
// remediator at a bare `ROADMAP.md` — its own project's roadmap (G-2 of 20261008-155128-remediate-siblings-r3). The
// round-cap chain follows the remediation links (operator: "B: follow the links (Recommended)"), and the residual of a
// remediator running tests it wrote is accepted on the record (operator: "Accept and record (Recommended)").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\s+/g, ' ');

test('shared/remediation.md owns the fix-or-ledger rule, the single-family LOW rule and the round cap', () => {
  const r = read('shared/remediation.md');
  assert.match(r, /Introduced by the task/);
  assert.match(r, /\*Related\* means/);
  assert.match(r, /"Pre-existing" is shown, not judged: the finding's failing test fails on the base commit too/);
  assert.match(r, /Single-family LOWs/);
  assert.match(r, /Round cap/);
  assert.match(r, /feature resets it/, "D1's reset, in the operator's words");
});

test('the round-cap chain follows the remediation links, and a broken chain is stamped', () => {
  const r = read('shared/remediation.md');
  assert.match(r, /follows_remediation/);
  assert.match(r, /CHAIN-BROKEN/);
  assert.match(r, /B: follow the links \(Recommended\)/);
  assert.match(r, /a proxy/, 'git blame is a proxy, said where it is used');
});

test('the accepted residual is recorded with the operator\'s words', () => {
  const r = read('shared/remediation.md');
  assert.match(r, /executes code it wrote/);
  assert.match(r, /Accept and record \(Recommended\)/);
});

test('ROADMAP D1 keeps the release gate and points at shared/remediation.md instead of restating the rule', () => {
  const d = read('ROADMAP.md');
  assert.match(d, /D1 — when a review has converged/);
  assert.match(d, /shared\/remediation\.md/);
  assert.doesNotMatch(d, /\| \*\*Introduced by the task\*\*/, 'the table is stated once, in shared/');
  assert.doesNotMatch(d, /Single-family LOWs\.\*\* A LOW raised/, 'the rule is stated once, in shared/');
});

test('the remediate skill cites shared/remediation.md and names no bare ROADMAP.md', () => {
  const s = read('skills/remediate/SKILL.md');
  assert.match(s, /shared\/remediation\.md/);
  assert.doesNotMatch(s, /\(ROADMAP\.md,/);
});
