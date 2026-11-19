// THE BLOCKER: THE DISCRIMINATOR THE BUDGET LAYER TRUSTS IS TYPED BY HAND, SEVEN TIMES.
//
// `nodeSpend` (lib/decisions.mjs) charges an unknown-cost launched node the FULL node cap, unless the
// status says `auth_mode: 'external-vendor'` — the declared signal that a node is billed to the
// vendor's own account. That string is written at SEVEN separate call sites in run-graph plus one in
// spawn-node, none of them derived from anything. Miss one on the next arm or judge type and that node
// is charged the cap for money this account never spends.
//
// Latent in THIS repository and in the one consumer, because both declare `budget_usd_per_*: ""` and an
// Infinity cap charges 0 regardless. Armed for any project that keeps CLAUDE.template.md's numbers
// (4.00 / 7.00 / 32.00): six arms and two judges at the node cap is $32 of phantom spend against a $32
// run ceiling, so the run-budget guard would stop launching REAL lenses to protect money nobody spent.
// Reported three times (times_seen: 3, status reopened) and never fixed — which is what a fact with
// seven owners does.
//
// The cure is the one this file already uses for node kinds, after the identical defect (G-9): declare
// the classification once, derive every site from it, and refuse a kind that no list mentions — so
// adding a kind is a decision rather than a default.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import {
  NODE_KIND, AUTH_MODES, authModeFor, authModesAreClassified, nodeSpend,
} from '../scripts/lib/decisions.mjs';

test('every node kind resolves to a declared auth mode', () => {
  for (const kind of Object.values(NODE_KIND)) {
    const mode = authModeFor(kind);
    assert.ok(AUTH_MODES.includes(mode), `${kind} resolved to ${mode}, which is not a declared mode`);
  }
});

test('arms and judges are externally billed; a lens is not', () => {
  assert.equal(authModeFor(NODE_KIND.arm), 'external-vendor');
  assert.equal(authModeFor(NODE_KIND.adjudication), 'external-vendor');
  assert.equal(authModeFor(NODE_KIND.lens), 'subscription');
  // An absent kind is an ordinary node, because a lens status carries no `kind` field at all.
  assert.equal(authModeFor(undefined), 'subscription');
});

// THE POINT OF THE EXERCISE: adding a kind must not silently inherit a billing answer.
test('a kind no list classifies is refused, not defaulted', () => {
  const report = authModesAreClassified();
  assert.deepEqual(report.unknown, [],
    'a kind named in the billing lists that NODE_KIND does not declare is a typo with a budget effect');
  const covered = [...report.externally_billed, ...report.locally_billed].sort();
  assert.deepEqual(covered, Object.values(NODE_KIND).sort(),
    'every declared kind must appear in exactly one billing list — silence here is what produced the '
    + 'seven hand-typed call sites');
});

// The consequence the discriminator exists to produce, checked rather than assumed.
test('the discriminator still exempts a vendor-billed node from the cap', () => {
  const capped = { budgetNode: 4, budgetBarrier: 7 };
  assert.equal(nodeSpend({ auth_mode: 'external-vendor', launched: true, total_cost_usd: null }, capped), 0,
    'a vendor-billed node costs this account nothing; charging it the cap is phantom spend');
  assert.equal(nodeSpend({ auth_mode: 'subscription', launched: true, total_cost_usd: null }, capped), 4,
    'an unknown-cost LOCAL node is still charged the cap — that conservatism is the point');
});

test('no call site types the discriminator by hand', () => {
  const strip = (s) => s.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const file of ['run-graph.mjs', 'spawn-node.mjs']) {
    const src = strip(fs.readFileSync(path.join(REPO_ROOT, 'scripts', file), 'utf8'));
    const literals = (src.match(/auth_mode:\s*'external-vendor'/g) ?? []).length;
    assert.equal(literals, 0,
      `${file} still writes the literal ${literals} time(s). Every site must derive it from the node's `
      + 'kind, or the next arm type added without the string is charged the full cap in silence.');
  }
});

// A declared vocabulary that omits a value the field actually carries is not a vocabulary.
test('the declared modes include every mode the engine writes', () => {
  assert.ok(AUTH_MODES.includes('external-vendor'),
    "AUTH_MODES was ['subscription','inherit'] while every arm and judge status recorded "
    + "'external-vendor', written directly by run-graph and validated against nothing");
  for (const m of ['subscription', 'inherit']) assert.ok(AUTH_MODES.includes(m), `${m} must survive`);
});
