// scope-constructs.mjs — the engine's copy of what each reference extractor models (code-index-d1-part-b.plan.md stage 5;
// design B-D4). shared/code-index.md's tables are the one hand-kept copy; the constants below are generated from them by
// `node scripts/gen-rule-text.mjs`, as each extractor's own constant is, so the engine compares an extractor's
// `--identity` against the contract without parsing Markdown at run time. Pure (ARCHITECTURE §2).

// rule:scope-constructs language="python" syntax="javascript" name="PYTHON"
const PYTHON = Object.freeze({
  Module: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: false }),
  FunctionDef: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: true }),
  AsyncFunctionDef: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: true }),
  Lambda: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: false }),
  ClassDef: Object.freeze({ opens_scope: true, visible_to_nested: false, binds_in_parent: true }),
  Import: Object.freeze({ opens_scope: false, visible_to_nested: false, binds_in_parent: true }),
  ImportFrom: Object.freeze({ opens_scope: false, visible_to_nested: false, binds_in_parent: true }),
});
// /rule:scope-constructs

// rule:scope-constructs language="javascript" syntax="javascript" name="JAVASCRIPT"
const JAVASCRIPT = Object.freeze({
  Program: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: false }),
  FunctionDeclaration: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: true }),
  FunctionExpression: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: false }),
  ArrowFunctionExpression: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: false }),
  MethodDefinition: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: false }),
  ClassDeclaration: Object.freeze({ opens_scope: true, visible_to_nested: true, binds_in_parent: true }),
  ImportDeclaration: Object.freeze({ opens_scope: false, visible_to_nested: false, binds_in_parent: true }),
  VariableDeclarator: Object.freeze({ opens_scope: false, visible_to_nested: false, binds_in_parent: true }),
});
// /rule:scope-constructs

/** The contract's table for each language that has one. A language absent here has no table: its model is unchecked. */
export const SCOPE_TABLES = Object.freeze({ python: PYTHON, javascript: JAVASCRIPT });

/**
 * The three columns an extractor reads: each field's name and its heading in shared/code-index.md's tables. Their one
 * owner: the generator (rule-text.mjs) and the identity schema (code-index-spec.mjs) read them here, so a column changed
 * cannot leave the three enforcing different contracts (G-12 of 20261022-183032-pb-delivery; ARCHITECTURE §2).
 */
export const SCOPE_COLUMNS = Object.freeze([['opens_scope', 'Opens a scope'], ['visible_to_nested', 'Visible to nested scopes'],
  ['binds_in_parent', 'Binds in enclosing scope']]);

const COLUMNS = SCOPE_COLUMNS.map(([field]) => field);

/**
 * How an extractor's reported `scope_constructs` differs from its language's table: [] when they match, one sentence per
 * difference otherwise (a row added, a row missing, a column changed). null when the language has no table, so there is
 * nothing to compare against (the extractor runs, and its answers name the model as unchecked).
 */
export function scopeConstructsDifferences(language, reported) {
  // Own keys only, never `in` or a bare index: both find Object.prototype's names, so a row or a language called
  // `constructor` would pass as one the table lists (G-13 of 20261022-183032-pb-delivery).
  if (!Object.hasOwn(SCOPE_TABLES, language)) return null;
  const table = SCOPE_TABLES[language];
  const out = [];
  const got = reported ?? {};
  for (const k of Object.keys(got)) if (!Object.hasOwn(table, k)) out.push(`reports ${k}, which the ${language} table does not list`);
  for (const [k, row] of Object.entries(table)) {
    if (!Object.hasOwn(got, k)) { out.push(`does not report ${k}, which the ${language} table lists`); continue; }
    for (const c of COLUMNS) {
      if (got[k]?.[c] !== row[c]) out.push(`reports ${k}.${c} as ${JSON.stringify(got[k]?.[c])}; the ${language} table says ${row[c]}`);
    }
  }
  return out;
}
