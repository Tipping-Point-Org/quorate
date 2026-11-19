// Cross-family review is the operator's standard for ANY review, not a code-review special case:
// every JUDGMENT lens is shadowed by an independent second family, and a third family breaks an
// explicit contradiction. A measurement is exempt — it reproduces or it does not, so a second
// opinion adds nothing.
//
// G-19: the roster asserted "Every judgment lens now has an arm" in a NOTE while ui-audit — a
// judgment lens (convention, invariant) — had none, and nothing anywhere emitted a gap for an
// unshadowed lens. So in a consuming project with a UI surface, ui-audit ran against one model and
// the gate recorded it exactly as it records a shadowed one: absence reading as agreement, which is
// the single failure the panel exists to prevent. A claim in prose outran the roster; it is now
// checked in code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isJudgmentLens, unshadowedJudgmentLenses } from '../scripts/lib/decisions.mjs';
import { REPO_ROOT } from './helpers.mjs';

const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

test('regression: EVERY judgment lens in the shipped roster has a second-family arm', () => {
  const gaps = unshadowedJudgmentLenses({ lenses: roster.lenses ?? [], panelArms: roster.panel_arms ?? [] });
  assert.deepEqual(gaps, [],
    `these judgment lenses would run single-family: ${gaps.join(', ')}`);
});

test('a measurement-only lens is exempt — a second opinion adds nothing to a reproduction', () => {
  const fv = (roster.lenses ?? []).find((l) => l.id === 'feature-verify');
  assert.ok(fv, 'feature-verify should exist in the roster');
  assert.equal(isJudgmentLens(fv), false, 'measurement-only must not demand an arm');
  assert.equal(isJudgmentLens({ allowed_basis: ['measurement'] }), false);
});

test('every judgment basis demands a second family', () => {
  for (const basis of ['intent', 'invariant', 'architecture_doc', 'convention']) {
    assert.equal(isJudgmentLens({ allowed_basis: [basis] }), true, `${basis} is an opinion`);
  }
  // A lens mixing measurement with judgment is still judgment.
  assert.equal(isJudgmentLens({ allowed_basis: ['measurement', 'convention'] }), true);
});

test('regression: an unshadowed judgment lens is DETECTED, not assumed away', () => {
  const gaps = unshadowedJudgmentLenses({
    lenses: [
      { id: 'ui-audit', allowed_basis: ['convention', 'invariant'] },
      { id: 'code-audit', allowed_basis: ['invariant'] },
      { id: 'feature-verify', allowed_basis: ['measurement'] },
    ],
    panelArms: [{ shadows: 'code-audit', reviewer: 'codex' }],
  });
  assert.deepEqual(gaps, ['ui-audit'],
    'the judgment lens with no arm must be named; the measurement lens must not');
});

test('a lens that is not running this pass is not reported as a coverage gap', () => {
  const gaps = unshadowedJudgmentLenses({
    lenses: [{ id: 'ui-audit', allowed_basis: ['convention'] }],
    panelArms: [],
    isPresent: () => false, // ui.surface: none — the lens is SKIPPED, so nothing went unshadowed
  });
  assert.deepEqual(gaps, []);
});

test('the roster no longer ASSERTS coverage it does not check', () => {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8');
  assert.doesNotMatch(raw, /Every judgment lens now has an arm\./,
    'a bare assertion in a note is what outran the roster last time');
});
