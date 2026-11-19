// G-1 — ARCHITECTURE.md NAMED A BASIS RUNG THAT EXISTS NOWHERE (doc-consistency-review).
//
// A-6 stated the ladder as `executed` > `measurement` > `architecture_doc` > `invariant` >
// `convention`. Three problems, and the third is why it mattered:
//
//  1. `executed` is in no enum. verdict.schema.json's basis enum is
//     [intent, architecture_doc, invariant, measurement, convention]; disk-first-protocol.md §4, which
//     OWNS basis, has no such row; lens-roster.json's basis_ceilings has no such rung. A finding
//     claiming it is rejected by the validator, so the rule was prose with nothing behind it.
//  2. The ladder omitted `intent`, which the enum has and the roster marks role_granted.
//  3. ARCHITECTURE.md is now doc_roles.architecture, so arch-review cites it as `architecture_doc`
//     with NO ceiling — it can raise a FAIL. A sentence there is enforceable, so an invented rung is a
//     false invariant a lens can cite. And A-22's floor ("falling back to `executed`") rested on it,
//     which made the operative floor for this repository a rung no finding could ever state.
//
// The cure is not to correct the list. It is to STOP KEEPING A SECOND COPY OF IT (A-1): §4 owns the
// basis values, this document cites them, and a list you do not duplicate cannot drift. That is why
// this test forbids restating the table rather than checking the restatement is accurate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const arch = () => fs.readFileSync(path.join(REPO_ROOT, 'ARCHITECTURE.md'), 'utf8');

/** The one authority on what a basis may be: the envelope schema the validator enforces. */
function schemaEnum() {
  const s = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'verdict.schema.json'), 'utf8'));
  return s.properties.findings.items.properties.basis.enum;
}

test('ARCHITECTURE.md names no basis value the validator would reject', () => {
  const allowed = new Set(schemaEnum());
  const text = arch();

  // Every backticked identifier in the document that LOOKS like a basis rung.
  const CANDIDATES = ['executed', 'measurement', 'architecture_doc', 'invariant', 'convention', 'intent'];
  const named = CANDIDATES.filter((c) => new RegExp('`' + c + '`').test(text));
  const bogus = named.filter((n) => !allowed.has(n));

  assert.deepEqual(bogus, [],
    `ARCHITECTURE.md cites basis value(s) absent from verdict.schema.json's enum [${[...allowed].join(', ')}]. `
    + 'This document grants architecture_doc authority with no verdict ceiling, so a rung that exists '
    + 'nowhere is a false invariant a lens can cite to justify a FAIL.');
});

test('the basis values are CITED here, not restated — §4 owns them', () => {
  const text = arch();
  // The defect was a second copy that drifted. A full enumeration in ladder form is that copy.
  const ladder = /`\w+`\s*>\s*`\w+`\s*>\s*`\w+`/.test(text);
  assert.ok(!ladder,
    'A-6 restated the whole ladder, and the copy drifted from its owner — it invented `executed` and '
    + 'dropped `intent`. shared/disk-first-protocol.md §4 owns the basis table (A-1); cite it.');

  assert.match(text, /disk-first-protocol\.md/,
    'if the values are not restated, the document must say where they live');
});

test('A-22 floor names a rung that exists', () => {
  const text = arch();
  const a22 = text.slice(text.indexOf('### A-22'), text.indexOf('### A-23'));
  assert.ok(a22.length > 0, 'A-22 must exist for this to be checking anything');

  const allowed = schemaEnum();
  const cited = [...a22.matchAll(/`([a-z_]+)`/g)].map((m) => m[1])
    .filter((w) => ['executed', 'measurement', 'architecture_doc', 'invariant', 'convention', 'intent'].includes(w));
  const bogus = [...new Set(cited)].filter((c) => !allowed.includes(c));

  assert.deepEqual(bogus, [],
    'A-22 declares the grounding floor. A floor naming a rung no finding can state is unreachable by '
    + 'construction, and on an UNBENCHED repository it was the OPERATIVE floor.');
});

// The owner and the schema must agree, or citing the owner just moves the drift.
test('the owner and the validator name the same basis values', () => {
  const doctrine = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8');
  const section = doctrine.slice(doctrine.indexOf('## §4'));
  for (const value of schemaEnum()) {
    assert.ok(new RegExp('`' + value + '`').test(section),
      `${value} is in the validator's enum but §4 — the owner — never names it`);
  }
  assert.ok(!/`executed`/.test(doctrine),
    'the owner must not acquire the invented rung either');
});
