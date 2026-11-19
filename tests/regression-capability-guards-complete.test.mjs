// TWO GUARDS IN capabilities.mjs THAT ACCEPTED LESS THAN THEY CLAIMED (20261026-174311-rct-remediation-review).
//
// G-1: unbackedCapabilities took any non-empty `deny_intent` as proof of content_tool_denial, without comparing it with the
// tools contentToolsOf says read content. An adapter that omits one of its own declared content-reading tools passed, was
// granted the intent role, and kept a tool that reads straight past the intent sandbox.
//
// G-3: when a judge's adapter resolved no family for its model (familyOfCall null), the duplicate-family check fell back
// to the judge's declared `family` label, so an unresolved pair was accepted on a label rather than refused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { unbackedCapabilities, validateRoster, rosterFamilyErrors } from '../scripts/lib/capabilities.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';

const ROSTER = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
const resolve = (name) => builtinReviewers()[name];

test('G-1: a deny_intent that omits a declared content-reading tool does not back content_tool_denial', () => {
  const shipped = structuredClone(builtinReviewers().claude);
  assert.deepEqual(unbackedCapabilities(shipped).filter((m) => m.startsWith('content_tool_denial')), [],
    'the shipped adapter denies every content tool it declares');
  for (const omit of ['PowerShell', 'Grep', 'Bash']) {
    const a = structuredClone(shipped);
    a.node_runtime.tools.deny_intent = a.node_runtime.tools.deny_intent.filter((t) => t !== omit);
    const missing = unbackedCapabilities(a).filter((m) => m.startsWith('content_tool_denial'));
    assert.ok(missing.some((m) => m.includes(omit)), `omitting ${omit} must be refused: ${JSON.stringify(missing)}`);
  }
});

test('G-3: a judge whose adapter resolves no family for its model is refused, not accepted on its label', () => {
  const r = structuredClone(ROSTER);
  r.adjudicators = [
    { id: 'adj-a', reviewer: 'agy', model: 'Unlisted Model 1', family: 'gemini' },
    { id: 'adj-b', reviewer: 'codex', model: 'gpt-5.6-sol' },
  ];
  const { errors } = validateRoster(r, resolve, { defaultRuntime: 'claude' });
  assert.ok(errors.some((e) => /adjudicator 'adj-a'.*no family for model 'Unlisted Model 1'/.test(e)), JSON.stringify(errors));
});

test('G-3: the shipped roster resolves every family', () => {
  const { errors } = validateRoster(ROSTER, resolve, { defaultRuntime: 'claude' });
  assert.deepEqual(errors.filter((e) => /family/.test(e)), []);
});

// G-4 and G-6 of 20261026-190950-rct-remediation-2-review: the tool lists were never required to be arrays, so a string
// passed `.length` and `.includes` (a substring match) while denyToolsFor, which ignores a non-array, denied nothing. And
// deny_always was never compared with the adapter's own edit_tools, so an adapter omitting a writing tool passed no_write.
test('G-4: a deny_intent that is not an array does not back content_tool_denial', () => {
  const a = structuredClone(builtinReviewers().claude);
  a.node_runtime.tools.deny_intent = a.node_runtime.tools.deny_intent.join(',');
  const missing = unbackedCapabilities(a).filter((m) => m.startsWith('content_tool_denial'));
  assert.ok(missing.some((m) => /deny_intent/.test(m)), JSON.stringify(missing));
});

test('G-6: a deny_always that is not an array does not back no_write', () => {
  const a = structuredClone(builtinReviewers().claude);
  a.node_runtime.tools.deny_always = a.node_runtime.tools.deny_always.join(',');
  const missing = unbackedCapabilities(a).filter((m) => m.startsWith('no_write'));
  assert.ok(missing.some((m) => /deny_always/.test(m)), JSON.stringify(missing));
});

test('G-6: a deny_always that omits one of the adapter\'s edit_tools does not back no_write', () => {
  const shipped = structuredClone(builtinReviewers().claude);
  assert.deepEqual(unbackedCapabilities(shipped).filter((m) => m.startsWith('no_write')), [],
    'the shipped adapter denies every edit tool it declares');
  for (const omit of shipped.node_runtime.tools.edit_tools) {
    const a = structuredClone(shipped);
    a.node_runtime.tools.deny_always = a.node_runtime.tools.deny_always.filter((t) => t !== omit);
    const missing = unbackedCapabilities(a).filter((m) => m.startsWith('no_write'));
    assert.ok(missing.some((m) => m.includes(omit)), `omitting ${omit} must be refused: ${JSON.stringify(missing)}`);
  }
});

// G-1 of 20261026-190950-rct-remediation-2-review: the duplicate-family check lived only in validateRoster, so
// external-review, which runs rosterFamilyErrors before each direct call, accepted a same-family judge pair mint refused.
// G-7: its message told the operator to declare `family` per judge, which cannot fix it now that only the adapter counts.
test('G-1: rosterFamilyErrors refuses two judges of one family, as validateRoster does', () => {
  const r = structuredClone(ROSTER);
  r.adjudicators = [
    { id: 'adj-a', reviewer: 'codex', model: 'gpt-5.6-sol' },
    { id: 'adj-b', reviewer: 'codex', model: 'gpt-5.6-sol' },
  ];
  const errs = rosterFamilyErrors(r, resolve);
  assert.ok(errs.some((e) => /two adjudicators are family/.test(e)), JSON.stringify(errs));
  const { errors } = validateRoster(r, resolve, { defaultRuntime: 'claude' });
  assert.equal(errors.filter((e) => /two adjudicators are family/.test(e)).length, 1, 'reported once at mint');
});

test('G-7: the duplicate-family refusal does not advise declaring `family` per judge', () => {
  const r = structuredClone(ROSTER);
  r.adjudicators = [
    { id: 'adj-a', reviewer: 'codex', model: 'gpt-5.6-sol' },
    { id: 'adj-b', reviewer: 'codex', model: 'gpt-5.6-sol' },
  ];
  const { errors } = validateRoster(r, resolve, { defaultRuntime: 'claude' });
  const dup = errors.filter((e) => /two adjudicators are family/.test(e));
  assert.ok(dup.length, JSON.stringify(errors));
  assert.ok(dup.every((e) => !/Declare `family`/.test(e)), dup.join('; '));
});
