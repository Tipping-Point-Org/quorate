// G-5 of 20261121-043112-ac2-delivery (with its symptom G-6): THE FORGE'S FILL DEFEATED renderTemplate'S GUARDS.
//
// lib/reconcile-mutations.mjs's `fill` built renderTemplate's vars from the template's own slots, so every slot was always
// a key and the "no value for {{slot}}" guard could never fire. Once the prose moved to the editable
// prompts/_templates/forge-slots.json, a misspelled slot rendered the literal "undefined" into the forge model's prompt, an
// absent field rendered "", and a missing file_rule entry silently dropped the "do not name the old file" rule. Each of
// these must throw, as renderTemplate does for every other prompt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pure from '../scripts/lib/reconcile-mutations.mjs';

const DEFLATE = { mutation: 'deflate', groupId: 'G-3', from: 'HIGH', to: 'LOW', tolerance: 3 };
const ok = { change_instruction: 'judge it {{to}}, not {{from}}', forbidden_rule: 'never say {{from}}', destination_source: 'n/a' };

test('a well-formed text still renders', () => {
  const out = pure.forgeSlots(DEFLATE, { deflate: ok });
  assert.equal(out.change_instruction, 'judge it LOW, not HIGH');
  assert.equal(out.forbidden_rule, 'never say HIGH');
});

test('a misspelled slot throws instead of rendering "undefined" into the forge prompt', () => {
  const texts = { deflate: { ...ok, change_instruction: 'judge it {{too}} now' } };
  assert.throws(() => pure.forgeSlots(DEFLATE, texts), /too/);
});

test('a slot with no value for this mutation throws instead of rendering "undefined"', () => {
  // {{to_line}} is a known slot, but a deflate has no `to.line`.
  const texts = { deflate: { ...ok, forbidden_rule: 'never cite line {{to_line}}' } };
  assert.throws(() => pure.forgeSlots(DEFLATE, texts), /to_line/);
});

test('an absent prose field throws instead of rendering an empty instruction', () => {
  const { forbidden_rule, ...rest } = ok;
  assert.throws(() => pure.forgeSlots(DEFLATE, { deflate: rest }), /forbidden_rule|not a string|no text/);
});

test('a missing file_rule entry throws instead of silently dropping the rule (G-6)', () => {
  const misanchor = { mutation: 'misanchor', from: { file: 'a/x.mjs', line: 4 }, to: { file: 'b/y.mjs', line: 9 } };
  assert.throws(() => pure.forgeFileRule(misanchor, { file_rule: { same_place: 'x', same_file: 'y' } }), /other_file/);
  assert.throws(() => pure.forgeFileRule(misanchor, {}), /other_file/);
  assert.equal(pure.forgeFileRule(misanchor, { file_rule: { other_file: 'discuss {{to_file}}, never {{from_base}}' } }),
    'discuss b/y.mjs, never x.mjs');
});
