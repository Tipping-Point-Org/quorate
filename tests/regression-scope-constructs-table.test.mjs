// regression-scope-constructs-table.test.mjs — code-index-d1-part-b.plan.md stage 2 (design note B-D4).
//
// The constructs each reference extractor models are listed once, in shared/code-index.md, and each extractor's
// SCOPE_CONSTRUCTS constant is generated from its language's table by gen-rule-text (operator, 2026-10-21: "B, try to
// mitigate the cons. two copies usually drift"). These tests hold the two copies to one: the extractors' regions are
// current, an edit to the table makes them stale, and every row names a fixture that exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { regenerate, sourceTable } from '../scripts/lib/rule-text.mjs';

const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
const DOC = 'shared/code-index.md';
const EXTRACTORS = { python: 'extractors/python/extract.py', javascript: 'extractors/javascript/extract.mjs' };

test('each extractor carries its language\'s table, generated and current', () => {
  for (const [language, file] of Object.entries(EXTRACTORS)) {
    const r = regenerate(read(file), file, { [DOC]: read(DOC) });
    assert.deepEqual(r.stale, [], `${file}: its scope-constructs region differs from ${DOC}; run node scripts/gen-rule-text.mjs`);
    for (const row of sourceTable(read(DOC), 'scope-constructs', language)) {
      assert.match(read(file), new RegExp(`["]?${row.Construct}["]?: `), `${file} does not carry ${row.Construct}`);
    }
  }
});

test('an edit to the document\'s table makes both extractors stale', () => {
  const doc = read(DOC);
  // Flip one cell in each table: the ClassDef row's "visible to nested scopes", and ClassDeclaration's.
  const edited = doc.replace('| `ClassDef` | yes | no | yes |', '| `ClassDef` | yes | yes | yes |')
    .replace('| `ClassDeclaration` | yes | yes | yes |', '| `ClassDeclaration` | yes | no | yes |');
  assert.notEqual(edited, doc, 'the rows this test flips are no longer in the table');
  for (const file of Object.values(EXTRACTORS)) {
    assert.equal(regenerate(read(file), file, { [DOC]: edited }).stale.length, 1, `${file} did not go stale`);
  }
});

test('every row names a fixture that exists, and the table has the three columns the extractors read', () => {
  for (const language of Object.keys(EXTRACTORS)) {
    const rows = sourceTable(read(DOC), 'scope-constructs', language);
    assert.ok(rows.length >= 5, `${language}: ${rows.length} rows`);
    for (const row of rows) {
      for (const col of ['Opens a scope', 'Visible to nested scopes', 'Binds in enclosing scope']) {
        assert.equal(typeof row[col], 'boolean', `${language} ${row.Construct}: "${col}" is not yes or no`);
      }
      assert.ok(fs.existsSync(path.join(REPO_ROOT, row['Shown by'])), `${language} ${row.Construct}: ${row['Shown by']} does not exist`);
    }
  }
});

test('a rule rendered from a table that is absent fails, naming the document', () => {
  assert.throws(() => sourceTable('no table here', 'scope-constructs', 'python', DOC), /shared\/code-index\.md has no table:scope-constructs/);
  assert.throws(() => regenerate(read(EXTRACTORS.python), EXTRACTORS.python, {}), /has no table:scope-constructs/);
});

// G-12 of 20261022-183032-pb-delivery: the three column names were hand-written in scope-constructs.mjs (the comparison),
// rule-text.mjs (the generator) and code-index-spec.mjs (the identity schema), so a column changed in one left the other
// two enforcing a different contract (ARCHITECTURE §2, one owner). scope-constructs.mjs owns them; the others read it.
test('the scope table\'s column names are written once, outside the generated regions', () => {
  const LIB = ['scripts/lib/scope-constructs.mjs', 'scripts/lib/rule-text.mjs', 'scripts/lib/code-index-spec.mjs', 'scripts/code-index.mjs'];
  const handWritten = (f) => read(f).replace(/\/\/ rule:scope-constructs[\s\S]*?\/\/ \/rule:scope-constructs/g, '');
  for (const column of ['opens_scope', 'visible_to_nested', 'binds_in_parent']) {
    const at = LIB.filter((f) => new RegExp(`\\b${column}\\b`).test(handWritten(f)));
    assert.deepEqual(at, ['scripts/lib/scope-constructs.mjs'], `${column} is written by hand in ${at.join(', ')}`);
  }
});
