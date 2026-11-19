// runtime-call-telemetry.plan.md stage 1 (design CR-D3 A; operator, 2026-10-26: "A A"): a model's family is declared on its
// adapter, per model where one CLI serves several, and one function answers for everyone who decides a family. Three rules
// did it before (run-graph's stake check, capabilities' judge check, telemetry's familyOf), and they disagreed: the codex
// judge declared `openai` while telemetry called every codex call `codex`, by whichever roster entry came first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { familyOfCall, adapterErrors } from '../scripts/lib/reviewers.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';
import { validateRoster } from '../scripts/lib/capabilities.mjs';

const TABLE = builtinReviewers();
const ROSTER = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

test('stage 1: each built-in adapter declares its models\' family, per model where the CLI serves several', () => {
  assert.equal(familyOfCall({ reviewer: 'codex', model: 'gpt-5.6-sol' }, TABLE), 'openai');
  assert.equal(familyOfCall({ reviewer: 'codex-review', model: 'gpt-5.6-sol' }, TABLE), 'openai');
  assert.equal(familyOfCall({ reviewer: 'agy', model: 'Gemini 3.8 Flash (High)' }, TABLE), 'gemini');
  assert.equal(familyOfCall({ reviewer: 'agy', model: 'Claude Opus 4.6' }, TABLE), 'anthropic');
  assert.equal(familyOfCall({ reviewer: 'claude', model: 'opus' }, TABLE), 'anthropic');
  for (const name of Object.keys(TABLE)) assert.ok(TABLE[name].family, `adapter ${name} declares no family`);
});

test('stage 1: an adapter with no family keeps its name; an unknown reviewer is null, never guessed', () => {
  assert.equal(familyOfCall({ reviewer: 'mycli', model: 'x' }, { mycli: { cmd: 'mycli' } }), 'mycli');
  assert.equal(familyOfCall({ reviewer: 'nope', model: 'x' }, TABLE), null);
  assert.equal(familyOfCall({ reviewer: 'agy', model: 'Llama 9' }, TABLE), null, 'a model no entry matches is not given a family');
});

test('stage 1: adapterErrors refuses a malformed family, naming the adapter', () => {
  const base = { ...TABLE.codex };
  assert.deepEqual(adapterErrors('ok', { ...base, family: 'openai' }).filter((e) => /family/.test(e)), []);
  assert.deepEqual(adapterErrors('ok', { ...base, family: [{ model: 'G', family: 'gemini' }, { model: '', family: 'x' }] }).filter((e) => /family/.test(e)), []);
  for (const bad of [7, '', [], [{ model: 'G' }], [{ family: 'x' }], [{ model: 3, family: 'x' }]]) {
    const errs = adapterErrors('bad-one', { ...base, family: bad }).filter((e) => /family/.test(e));
    assert.ok(errs.length && errs.every((e) => e.includes('bad-one')), `not refused: ${JSON.stringify(bad)}`);
  }
});

test('stage 1: every roster role that names a reviewer resolves, in each of the roster\'s four shapes', () => {
  const resolve = (r) => TABLE[r];
  for (const a of ROSTER.panel_arms) assert.ok(familyOfCall({ reviewer: a.reviewer, model: a.model }, TABLE), a.id);
  for (const j of ROSTER.adjudicators) assert.ok(familyOfCall({ reviewer: j.reviewer, model: j.model }, TABLE), j.id);
  assert.ok(familyOfCall({ reviewer: ROSTER.claim_checker.reviewer, model: ROSTER.claim_checker.model }, TABLE), 'claim_checker');
  for (const [reviewer, p] of Object.entries(ROSTER.proposers)) if (resolve(reviewer)) assert.ok(familyOfCall({ reviewer, model: p.model }, TABLE), `proposer ${reviewer}`);
  const judge = ROSTER.adjudicators.find((j) => j.id === ROSTER.default_judge);
  assert.ok(judge && familyOfCall({ reviewer: judge.reviewer, model: judge.model }, TABLE), 'default_judge');
});

test('stage 1: a roster role whose declared family contradicts its adapter is refused', () => {
  const resolve = (r) => TABLE[r];
  const bad = structuredClone(ROSTER);
  bad.adjudicators = [{ id: 'adj-x', reviewer: 'codex', model: 'gpt-5.6-sol', family: 'gemini' }, ROSTER.adjudicators.find((j) => j.reviewer === 'agy')];
  const { errors } = validateRoster(bad, resolve, { defaultRuntime: 'claude' });
  assert.ok(errors.some((e) => /adj-x/.test(e) && /family/.test(e) && /openai/.test(e)), errors.join('\n'));
  assert.deepEqual(validateRoster(ROSTER, resolve, { defaultRuntime: 'claude' }).errors.filter((e) => /family/.test(e)), [],
    'the shipped roster agrees with its adapters');
});

test('G-10: every roster role with a reviewer, not only the judges, is refused when its family contradicts its adapter', () => {
  // validateRoster compared a declared `family` against familyOfCall for roster.adjudicators alone, while
  // shared/adapter-contract.md promises it for any roster role: a panel arm, a proposer or the claim checker could
  // declare a family its adapter denies and pass mint (G-10 and its doc-side symptom G-16 of 20261026-080302-rct-delivery).
  const resolve = (r) => TABLE[r];
  const cases = [
    ['arm', (r) => { r.panel_arms[0] = { ...r.panel_arms[0], family: 'gemini' }; }, ROSTER.panel_arms[0].id],
    ['claim_checker', (r) => { r.claim_checker = { ...r.claim_checker, family: 'gemini' }; }, 'claim_checker'],
    ['proposer', (r) => { r.proposers.codex = { ...r.proposers.codex, family: 'gemini' }; }, 'proposer codex'],
  ];
  for (const [what, mutate, name] of cases) {
    const bad = structuredClone(ROSTER);
    mutate(bad);
    const { errors } = validateRoster(bad, resolve, { defaultRuntime: 'claude' });
    assert.ok(errors.some((e) => e.includes(name) && /declares family 'gemini'/.test(e) && /openai/.test(e)),
      `${what}: ${errors.join('\n') || 'no error'}`);
  }
});

test('stage 1: no family rule is left outside familyOfCall', () => {
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.mjs') && !p.endsWith(path.join('lib', 'reviewers.mjs'))) {
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          // A family computed from a declaration-or-name fallback is a family rule.
          if (/\.family\s*\?\?\s*\w*\.?reviewer|family\s*\?\?\s*name\b/.test(line)) offenders.push(`${path.relative(REPO_ROOT, p)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
  };
  walk(path.join(REPO_ROOT, 'scripts'));
  assert.deepEqual(offenders, [], 'a family decided outside familyOfCall');
});
