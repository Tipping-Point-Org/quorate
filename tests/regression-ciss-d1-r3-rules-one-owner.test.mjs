// regression-ciss-d1-r3-rules-one-owner.test.mjs — G-4 of review 20261021-190234-ciss-d1-remediations-review.
//
// code-index-schema.mjs restated the spec's RULES as a second literal list, IMPLEMENTED_RULES, and checked only that the
// two lists agreed: a rule could be listed as implemented with no code applying it, and the vocabulary had two owners.
// RULES is now the one list, and what is checked is what the finding said was not: every rule it names is applied,
// through rule(), somewhere in the interpreter.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../scripts/lib/code-index-schema.mjs';
import { RULES } from '../scripts/lib/code-index-spec.mjs';

const src = fs.readFileSync(new URL('../scripts/lib/code-index-schema.mjs', import.meta.url), 'utf8');

test('G-4: RULES is the one list of rules, and every rule it names has a call site in the interpreter', () => {
  assert.equal(S.IMPLEMENTED_RULES, undefined, 'a second list of the rules is a second owner');
  assert.doesNotMatch(src, /IMPLEMENTED_RULES\s*=/);
  const applied = new Set([...src.matchAll(/rule\('([a-z-]+)'/g)].map((m) => m[1]));
  for (const name of Object.keys(RULES)) assert.ok(applied.has(name), `the spec names rule ${name} and nothing applies it`);
  for (const name of applied) assert.ok(name in RULES, `the interpreter applies ${name}, which the spec does not name`);
});
