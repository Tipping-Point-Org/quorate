// code-index-spec.mjs — the one definition of every code-index record's fields (code-index-schema-and-scope.plan.md
// stage 1; design D1, operator 2026-10-20: "One data spec (Recommended)").
//
// Data only. code-index-schema.mjs interprets it, so a field is required in exactly one place, and a test renders the
// field lists of shared/code-index.md from it, so the page cannot name a field the checks do not. shared/code-index.md
// owns what each field MEANS; this file owns which fields exist and their types (ARCHITECTURE A-1).
//
// A field is { type, nullable?, optional?, when?, enum?, of?, fields? }:
//   type      string (any text), name (non-empty text), bool, int, literal (a string, number or boolean), any (present),
//             list (of: a field), object (fields: a record), map (of: a field, string keys), span, sha256, glob;
//   nullable  null is allowed;
//   optional  absent is allowed;
//   when      { field: [values] }: required only when that sibling field has one of those values, else may be absent;
//   enum      the value is one of these.
// Rules that span records are not fields. They are named in RULES and run by name in the interpreter, each with its own
// test, because a per-field check cannot see them.

// The scope table's column names, from their one owner (G-12 of 20261022-183032-pb-delivery).
import { SCOPE_COLUMNS } from './scope-constructs.mjs';

export const CODE_INDEX_SCHEMA = 1;
export const CODE_INDEX_REQUEST = 1;
export const CODE_INDEX_ANSWER = 1;

export const TABLES = Object.freeze(['definitions', 'calls', 'constructions', 'literals', 'comparisons', 'imports', 'handlers']);
export const SHAPES = Object.freeze(['symbol', 'calls', 'constructions', 'literals', 'comparisons', 'callees', 'handlers']);
export const OUTCOMES = Object.freeze(['complete', 'partial', 'unresolved', 'parse_error', 'unsupported', 'extractor_failed', 'not_configured']);
export const EXTRACTOR_FAILURES = Object.freeze(['failed', 'timed-out', 'could-not-start', 'incomplete', 'invalid-response']);
export const DEFINITION_KINDS = Object.freeze(['function', 'class', 'field']);
export const ARGUMENT_KINDS = Object.freeze(['name', 'attribute', 'call', 'literal', 'other']);

// An argument, or one side of a comparison.
const DESCRIBED = Object.freeze({
  text: { type: 'string' },
  kind: { type: 'name', enum: ARGUMENT_KINDS },
  path: { type: 'string', nullable: true, optional: true },
});
const ARGUMENT = Object.freeze({ ...DESCRIBED, keyword: { type: 'string', nullable: true } });

/** Every row of every table carries these. */
export const ROW = Object.freeze({
  path: { type: 'name' },
  span: { type: 'span' },
  enclosing: { type: 'name' },
});

/** Each table's own fields, beyond ROW. */
export const TABLE_FIELDS = Object.freeze({
  definitions: {
    name: { type: 'name', nullable: true },
    qualified: { type: 'name' },
    kind: { type: 'name', enum: DEFINITION_KINDS },
    signature: { type: 'string', when: { kind: ['function', 'class'] } },
    annotation: { type: 'string', nullable: true, when: { kind: ['field'] } },
    default: { type: 'any', nullable: true, optional: true },
    // A default that is not a literal, as source text: never in `default`, so a literal "f()" and f() differ (G-3).
    default_text: { type: 'string', optional: true },
  },
  calls: {
    callee: { type: 'name', nullable: true },
    resolved: { type: 'bool' },
    callee_text: { type: 'string' },
    args: { type: 'list', of: { type: 'object', fields: ARGUMENT } },
    in_manifest: { type: 'bool', optional: true },
  },
  constructions: {
    type: { type: 'name', nullable: true },
    resolved: { type: 'bool' },
    callee_text: { type: 'string' },
    keywords: { type: 'list', of: { type: 'name' } },
    dict_keys: { type: 'list', of: { type: 'literal' } },
    args: { type: 'list', of: { type: 'object', fields: ARGUMENT } },
  },
  literals: {
    value: { type: 'literal' },
    type: { type: 'name' },
  },
  comparisons: {
    op: { type: 'name' },
    left: { type: 'object', fields: DESCRIBED },
    right: { type: 'object', fields: DESCRIBED },
    literal: { type: 'literal', nullable: true },
    via: { type: 'name', nullable: true },
    operands: { type: 'list', of: { type: 'name' }, optional: true },
  },
  imports: {
    module: { type: 'name', nullable: true },
    name: { type: 'name', nullable: true },
    alias: { type: 'name', nullable: true },
    qualified: { type: 'name', nullable: true },
  },
  handlers: {
    caught: { type: 'string', nullable: true },
  },
});

/** Each shape's arguments (shared/code-index.md, "Shapes"). `required` is the default; `optional` marks the rest. */
export const SHAPE_ARGS = Object.freeze({
  symbol: { name: { type: 'name' }, kind: { type: 'name', enum: DEFINITION_KINDS, optional: true }, annotation: { type: 'string', optional: true }, annotation_contains: { type: 'name', optional: true } },
  calls: { callee: { type: 'name' }, arg_path: { type: 'name', optional: true } },
  constructions: { type: { type: 'name' } },
  literals: { value: { type: 'literal' }, within: { type: 'name', optional: true } },
  comparisons: { literal: { type: 'literal', optional: true }, operand: { type: 'name', optional: true }, within: { type: 'name', optional: true } },
  callees: { of: { type: 'name' } },
  handlers: { calls_any: { type: 'list', of: { type: 'name' }, nonEmpty: true }, caught: { type: 'string', optional: true } },
});
/** Arguments of which exactly one must be given. */
export const SHAPE_ONE_OF = Object.freeze({ comparisons: ['literal', 'operand'] });

/** The request file an extractor is given (shared/code-index.md, "The request"). */
export const REQUEST = Object.freeze({
  code_index_request: { type: 'int', enum: [CODE_INDEX_REQUEST] },
  language: { type: 'name' },
  root: { type: 'name' },
  files: { type: 'list', of: { type: 'name' } },
  options: { type: 'object', fields: {} },
});

/** The identity call's object (shared/code-index.md, "The identity call"). */
export const IDENTITY = Object.freeze({
  name: { type: 'name' },
  version: { type: 'name' },
  runtime: { type: 'name' },
  parser: { type: 'name', nullable: true },
  modules: { type: 'map', of: { type: 'sha256' }, nonEmpty: true },
  reads: { type: 'list', of: { type: 'glob' }, optional: true },
  // The constructs the extractor models, in the table's three columns (code-index-d1-part-b.plan.md stage 5): required,
  // and compared with shared/code-index.md's table for its language, since the table is part of the extractor contract.
  // Required, not non-empty: a language with no table may truthfully model nothing, and a tabled one reporting {} is
  // refused by the comparison, row by row (G-13 of 20261022-191112-pb-remediation-review).
  scope_constructs: {
    type: 'map',
    of: { type: 'object', fields: Object.fromEntries(SCOPE_COLUMNS.map(([field]) => [field, { type: 'bool' }])) },
  },
});

/** One file's entry in a response. */
export const RESPONSE_FILE = Object.freeze({
  path: { type: 'name' },
  status: { type: 'name', enum: ['processed', 'not_processed'] },
  outcome: { type: 'name', enum: OUTCOMES, when: { status: ['not_processed'] } },
  reason: { type: 'string', optional: true },
});

/** The response's own fields. `facts` is checked table by table. */
export const RESPONSE = Object.freeze({
  code_index_schema: { type: 'int', enum: [CODE_INDEX_SCHEMA] },
  extractor: { type: 'object', fields: { name: { type: 'name' }, version: { type: 'name' } } },
  files: { type: 'list', of: { type: 'object', fields: RESPONSE_FILE } },
  facts: { type: 'object', fields: {} },
});

/** The answer envelope. */
export const ENVELOPE = Object.freeze({
  code_index_answer: { type: 'int', enum: [CODE_INDEX_ANSWER] },
  shape: { type: 'name', enum: SHAPES },
  language: { type: 'name', nullable: true, optional: true },
  outcome: { type: 'name', enum: OUTCOMES },
  detail: { type: 'name', enum: EXTRACTOR_FAILURES, when: { outcome: ['extractor_failed'] } },
  why: { type: 'string', optional: true },
  rows: { type: 'list', of: { type: 'any' } },
  input_hash: { type: 'name', nullable: true },
  extractors: {
    type: 'list',
    of: { type: 'object', fields: { name: { type: 'name' }, version: { type: 'name', nullable: true }, runtime: { type: 'name', nullable: true }, parser: { type: 'name', nullable: true } } },
  },
  framework: { type: 'object', fields: { commit: { type: 'string' }, dirty: { type: 'bool', nullable: true } } },
  not_checked: { type: 'list', of: { type: 'string' } },
});

/** A consumer's answer file (shared/code-index.md, "The answer file"). */
export const ANSWER_FILE = Object.freeze({
  pinned_commit: { type: 'name' },
  sweeps: {
    type: 'list', nonEmpty: true,
    of: {
      type: 'object',
      fields: {
        name: { type: 'name' },
        language: { type: 'name', optional: true },
        shape: { type: 'name', enum: SHAPES },
        // Required: every shape asks with arguments, and the interpreter checks them against SHAPE_ARGS (G-20).
        args: { type: 'object', fields: {} },
        outcome: { type: 'name', enum: OUTCOMES, optional: true },
        expected: { type: 'list', of: { type: 'object', fields: { path: { type: 'name' }, line: { type: 'int', optional: true } }, open: true } },
        method: { type: 'name' },
      },
    },
  },
});

/** The rules that span records, by name; each is run by the interpreter and has its own test. */
export const RULES = Object.freeze({
  'files-accounted-once': 'every requested file appears in the response exactly once, and no other file does',
  'rows-in-processed-files': 'every row names a file the response processed',
  'all-tables-present': 'the facts carry every table, empty or not',
  'unresolved-names-no-target': 'an unresolved call or construction names no callee or type',
  'resolved-names-its-target': 'a resolved call or construction names its callee or type',
  'response-matches-identity': 'the response names the extractor and version the identity call gave',
  'extractors-unless-not-configured': 'every answer but not_configured names at least one extractor',
  'hash-unless-no-facts': 'an answer computed from facts names the key they were read under',
  'one-of-arguments': 'a shape with a one-of set is given exactly one of it',
  'pinned-commit-is-hex': 'an answer file pins a commit by its hex id',
});
