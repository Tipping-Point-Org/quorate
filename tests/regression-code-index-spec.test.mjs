// EVERY FIELD THE SPEC NAMES IS ENFORCED, AND THE PAGE NAMES WHAT THE SPEC DOES (code-index-schema-and-scope.plan.md
// stage 1; design D1).
//
// Four review rounds each found a field the page named and the checks missed (G-26, G-18, G-22, G-33, G-14, G-15, G-17
// of the code-index reviews). So these tests are generated from scripts/lib/code-index-spec.mjs, not written per field.
// For every field of every record, a record missing it or holding the wrong type must be refused, naming the field. A
// field added to the spec is tested the moment it is added. The page's field lists are compared with the spec, and every
// JSON example on the page and in extractors/README.md must pass the checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { ROW, REQUEST, RESPONSE, TABLE_FIELDS, SHAPE_ARGS, IDENTITY, ENVELOPE, ANSWER_FILE, RULES, TABLES, SHAPES } from '../scripts/lib/code-index-spec.mjs';
import { responseErrors, envelopeErrors, identityErrors, argsErrors, requestErrors } from '../scripts/lib/code-index-schema.mjs';
import { answersFileErrors } from '../scripts/lib/code-index-query.mjs';

const span = { start: { line: 1, col: 0 }, end: { line: 1, col: 5 } };
const arg = { keyword: null, text: 'x', kind: 'name' };
const side = { text: 'x', kind: 'name' };
// One valid row per table, every field filled.
const ROWS = {
  definitions: { name: 'f', qualified: 'm.f', kind: 'function', signature: '()' },
  calls: { callee: 'm.g', resolved: true, callee_text: 'g', args: [arg], in_manifest: true },
  constructions: { type: 'm.C', resolved: true, callee_text: 'C', keywords: ['k'], dict_keys: ['a'], args: [arg] },
  literals: { value: 'auto', type: 'str' },
  comparisons: { op: '==', left: side, right: { text: '"a"', kind: 'literal' }, literal: 'a', via: null, operands: ['m.g'] },
  imports: { module: 'a', name: 'b', alias: 'c', qualified: 'a.b' },
  handlers: { caught: 'Exception' },
};
const FIELD_ROW = { name: 'p', qualified: 'm.C.p', kind: 'field', annotation: 'str', default: 'x', default_text: 'f()' };
const wrapRow = (table, row) => ({ path: 'a.py', span, enclosing: 'm', ...row });
const response = (table, row) => ({
  code_index_schema: 1, extractor: { name: 'fake', version: '1' }, files: [{ path: 'a.py', status: 'processed' }],
  facts: Object.fromEntries(TABLES.map((t) => [t, t === table ? [wrapRow(table, row)] : []])),
});
const request = { code_index_request: 1, language: 'python', root: '/r', files: ['a.py'], options: {} };
// A value of the wrong type for a field's declared type.
const WRONG = { string: 7, name: 7, bool: 'yes', int: 'one', literal: { x: 1 }, list: 'x', object: 'x', map: 'x', span: 'x', sha256: 'x', glob: 7, any: undefined };

test('the baseline rows and records are valid, so a refusal below is the field\'s', () => {
  for (const t of TABLES) assert.deepEqual(responseErrors(response(t, ROWS[t]), request), [], t);
  assert.deepEqual(responseErrors(response('definitions', FIELD_ROW), request), []);
});

test('every table field the spec requires is refused when missing or of the wrong type, naming it', () => {
  for (const t of TABLES) {
    for (const [field, spec] of Object.entries(TABLE_FIELDS[t])) {
      const base = spec.when?.kind?.includes('field') || (t === 'definitions' && !(field in ROWS[t])) ? FIELD_ROW : ROWS[t];
      // NO FIELD IS SKIPPED (G-20 of 20261030-124823-ciss-stage7): a field missing from the baseline was passed over,
      // so its wrong-type refusal could be removed with this test green. The baseline holds every field the spec names.
      assert.ok(field in base, `the baseline ${t} row lacks ${field}, so the spec's check of it is untested`);
      if (!spec.optional) {
        const row = { ...base };
        delete row[field];
        const errors = responseErrors(response(t, row), request);
        assert.ok(errors.some((e) => e.includes(field)), `${t}.${field} missing was accepted: ${JSON.stringify(errors)}`);
      }
      if (spec.type !== 'any') {
        const errors = responseErrors(response(t, { ...base, [field]: WRONG[spec.type] }), request);
        assert.ok(errors.some((e) => e.includes(field)), `${t}.${field} of the wrong type was accepted: ${JSON.stringify(errors)}`);
      }
      if (spec.enum) {
        const errors = responseErrors(response(t, { ...base, [field]: 'not-a-member' }), request);
        assert.ok(errors.some((e) => e.includes(field) || e.includes('"not-a-member"')), `${t}.${field} outside its enum was accepted`);
      }
    }
  }
});

// THE COMMON ROW FIELDS AND THE REQUEST (G-20 of 20261030-124823-ciss-stage7): ROW and REQUEST were never iterated, so a
// row's path, span or enclosing, or a request field, could lose its check with the field test green.
test('every common row field and every request field is refused when missing or of the wrong type, naming it', () => {
  for (const [field, spec] of Object.entries(ROW)) {
    for (const t of TABLES) {
      const row = wrapRow(t, ROWS[t]);
      const r = response(t, {});
      r.facts[t] = [Object.fromEntries(Object.entries(row).filter(([k]) => k !== field))];
      assert.ok(responseErrors(r, request).some((e) => e.includes(field)), `${t} row without ${field} was accepted`);
      r.facts[t] = [{ ...row, [field]: WRONG[spec.type] }];
      assert.ok(responseErrors(r, request).some((e) => e.includes(field)), `${t} row with a wrong ${field} was accepted`);
    }
  }
  assert.deepEqual(requestErrors(request), []);
  for (const [field, spec] of Object.entries(REQUEST)) {
    if (!spec.optional) {
      const q = { ...request };
      delete q[field];
      assert.ok(requestErrors(q).some((e) => e.includes(field)), `a request without ${field} was accepted`);
    }
    if (spec.type !== 'any' && WRONG[spec.type] !== undefined) {
      assert.ok(requestErrors({ ...request, [field]: WRONG[spec.type] }).some((e) => e.includes(field)), `a request with a wrong ${field} was accepted`);
    }
  }
});

const IDENTITY_OK = { name: 'x', version: '1', runtime: 'node 24', parser: 'acorn 8.14.0', modules: { 'x.mjs': 'a'.repeat(64) }, reads: ['**/package.json'],
  scope_constructs: { Module: { opens_scope: true, visible_to_nested: true, binds_in_parent: false } } };

test('every identity field is enforced, and a reads glob outside the grammar is refused', () => {
  assert.deepEqual(identityErrors(IDENTITY_OK), []);
  assert.deepEqual(identityErrors({ ...IDENTITY_OK, reads: undefined }), [], 'reads is optional to the engine');
  for (const [field, spec] of Object.entries(IDENTITY)) {
    if (!spec.optional) {
      const id = { ...IDENTITY_OK };
      delete id[field];
      assert.ok(identityErrors(id).some((e) => e.includes(field)), `identity without ${field} was accepted`);
    }
    const id = { ...IDENTITY_OK, [field]: WRONG[spec.type] };
    assert.ok(identityErrors(id).some((e) => e.includes(field)), `identity with a wrong ${field} was accepted`);
  }
  assert.ok(identityErrors({ ...IDENTITY_OK, reads: ['../x/**'] }).some((e) => /reads/.test(e)), 'a reads glob climbing out was accepted');
});

const ARGS_OK = {
  symbol: { name: 'm.', kind: 'field', annotation: 'str', annotation_contains: 'str' }, calls: { callee: 'm.f', arg_path: 'a.b' },
  constructions: { type: 'm.C' }, literals: { value: 'auto', within: 'm' }, comparisons: { literal: 'a', within: 'm' },
  callees: { of: 'm.f' }, handlers: { calls_any: ['m.f'], caught: 'Exception' },
};

test('every shape argument is enforced: required, typed, and no argument a shape does not take', () => {
  for (const s of SHAPES) {
    assert.deepEqual(argsErrors(s, ARGS_OK[s]), [], s);
    for (const [k, spec] of Object.entries(SHAPE_ARGS[s])) {
      if (!spec.optional) {
        const a = { ...ARGS_OK[s] };
        delete a[k];
        assert.ok(argsErrors(s, a).some((e) => e.includes(k)), `${s} without ${k} was accepted`);
      }
      if (k in ARGS_OK[s]) assert.ok(argsErrors(s, { ...ARGS_OK[s], [k]: WRONG[spec.type] }).some((e) => e.includes(k)), `${s}.${k} of the wrong type was accepted`);
    }
    assert.ok(argsErrors(s, { ...ARGS_OK[s], nonsense: 1 }).some((e) => e.includes('nonsense')), `${s} took an unknown argument`);
  }
  assert.ok(argsErrors('comparisons', { literal: 'a', operand: 'm.f' }).length, 'both one-of arguments were accepted');
  assert.ok(argsErrors('comparisons', {}).length, 'neither one-of argument was refused');
});

const ENVELOPE_OK = {
  code_index_answer: 1, shape: 'callees', language: 'python', outcome: 'complete', rows: [], input_hash: 'h',
  extractors: [{ name: 'x', version: '1', runtime: 'python 3.12', parser: 'ast' }], framework: { commit: 'c', dirty: false }, not_checked: [],
};

test('every envelope field is enforced', () => {
  assert.deepEqual(envelopeErrors(ENVELOPE_OK), []);
  for (const [field, spec] of Object.entries(ENVELOPE)) {
    if (!spec.optional && !spec.when) {
      const e = { ...ENVELOPE_OK };
      delete e[field];
      assert.ok(envelopeErrors(e).some((x) => x.includes(field)), `an envelope without ${field} was accepted`);
    }
  }
});

test('every answer-file field is enforced', () => {
  const ok = { pinned_commit: 'a'.repeat(40), sweeps: [{ name: 's', shape: 'calls', args: { callee: 'm.f' }, expected: [{ path: 'a.py', line: 1 }], method: 'read' }] };
  assert.deepEqual(answersFileErrors(ok), []);
  for (const field of Object.keys(ANSWER_FILE.sweeps.of.fields)) {
    const spec = ANSWER_FILE.sweeps.of.fields[field];
    if (spec.optional) continue;
    const s = { ...ok.sweeps[0] };
    delete s[field];
    assert.ok(answersFileErrors({ ...ok, sweeps: [s] }).some((e) => e.includes(field)), `a sweep without ${field} was accepted`);
  }
});

// The rules that span records, each by name. A per-field test cannot see them (plan stage 1).
test('each cross-record rule is enforced, and every rule the spec names is tested here', () => {
  const tested = new Set();
  const refused = (rule, errors) => { tested.add(rule); assert.ok(errors.length, `${rule}: nothing was refused`); };
  const ok = response('calls', ROWS.calls);
  refused('files-accounted-once', responseErrors({ ...ok, files: [] }, request));
  refused('rows-in-processed-files', responseErrors({ ...ok, files: [{ path: 'a.py', status: 'not_processed', outcome: 'parse_error' }] }, request));
  refused('all-tables-present', responseErrors({ ...ok, facts: { calls: ok.facts.calls } }, request));
  refused('unresolved-names-no-target', responseErrors(response('calls', { ...ROWS.calls, resolved: false }), request));
  refused('resolved-names-its-target', responseErrors(response('constructions', { ...ROWS.constructions, type: null }), request));
  refused('response-matches-identity', responseErrors(ok, request, { ...IDENTITY_OK, name: 'fake', version: '2' }));
  assert.deepEqual(responseErrors(ok, request, { ...IDENTITY_OK, name: 'fake', version: '1' }), [], 'a matching identity was refused');
  refused('extractors-unless-not-configured', envelopeErrors({ ...ENVELOPE_OK, extractors: [] }));
  refused('hash-unless-no-facts', envelopeErrors({ ...ENVELOPE_OK, input_hash: null }));
  refused('one-of-arguments', argsErrors('comparisons', {}));
  refused('pinned-commit-is-hex', answersFileErrors({ pinned_commit: 'HEAD', sweeps: [{ name: 's', shape: 'calls', args: { callee: 'm.f' }, expected: [], method: 'read' }] }));
  assert.deepEqual([...tested].sort(), Object.keys(RULES).sort(), 'a rule the spec names has no test here');
});

// --------------------------------------------------------------------------------------------- the page and the spec
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\r\n').join('\n');
const doc = read('shared/code-index.md');
const section = (heading) => {
  const at = doc.indexOf(`\n## ${heading}\n`);
  assert.notEqual(at, -1, `shared/code-index.md has no "## ${heading}"`);
  return doc.slice(at + heading.length + 5).split(/\n## /)[0];
};

test('each table\'s bullet on the page names exactly the fields the spec gives it', () => {
  const body = section('Tables');
  for (const t of TABLES) {
    const bullet = body.split('\n- ').find((b) => b.startsWith(`\`${t}\``));
    assert.ok(bullet, `the Tables section has no bullet for ${t}`);
    const named = new Set([...bullet.slice(t.length + 2).matchAll(/`([a-z_]+)`/g)].map((m) => m[1]));
    // Enum values may be named too, nested ones included (an argument's kinds).
    const enumsOf = (fields) => Object.values(fields).flatMap((f) => [...(f.enum ?? []), ...(f.of?.fields ? enumsOf(f.of.fields) : []), ...(f.fields ? enumsOf(f.fields) : [])]);
    const enums = new Set(enumsOf(TABLE_FIELDS[t]));
    for (const f of Object.keys(TABLE_FIELDS[t])) assert.ok(named.has(f), `the page's ${t} bullet does not name ${f}`);
    for (const n of named) {
      // A bullet may also name the common row fields, the described-side fields, and null.
      assert.ok(n in TABLE_FIELDS[t] || n in ROW || enums.has(n) || ['text', 'kind', 'path', 'keyword', 'null'].includes(n),
        `the page's ${t} bullet names ${n}, which the spec does not give ${t}`);
    }
  }
});

test('the page\'s argument table gives each shape exactly the spec\'s arguments', () => {
  const body = section('Shapes');
  for (const s of SHAPES) {
    const line = body.split('\n').find((l) => l.startsWith(`| \`${s}\` |`));
    assert.ok(line, `the Shapes argument table has no row for ${s}`);
    const named = new Set([...line.split('|')[2].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]));
    assert.deepEqual([...named].sort(), Object.keys(SHAPE_ARGS[s]).sort(), `${s}'s arguments on the page differ from the spec`);
  }
});

// THE RECORDS' FIELD LISTS TOO (G-21 of 20261030-124823-ciss-stage7): only the table bullets and the shape arguments were
// compared with the spec, so a field added to the identity, envelope, request, response or answer file without the page
// naming it passed. Each one must be named on the page or in extractors/README.md, in backticks or as a JSON key.
test('every field of the identity, envelope, request, response and answer file is named where a reader looks', () => {
  const pages = doc + read('extractors/README.md');
  const named = (f) => pages.includes(`\`${f}\``) || pages.includes(`"${f}":`);
  // Nested records too: a response's files, an answer file's sweeps and their expected rows.
  const missing = [];
  const walk = (where, fields) => {
    for (const [f, spec] of Object.entries(fields)) {
      if (!named(f)) missing.push(`${where}.${f}`);
      const inner = spec.fields ?? spec.of?.fields;
      if (inner) walk(`${where}.${f}`, inner);
    }
  };
  for (const [record, fields] of Object.entries({ IDENTITY, ENVELOPE, REQUEST, RESPONSE, ANSWER_FILE })) walk(record, fields);
  assert.deepEqual(missing, [], `in the spec but named on neither page: ${missing.join(', ')}`);
});

// Placeholders stay readable on the page; the test fills a declared set before checking.
const PLACEHOLDERS = { '<sha256>': 'a'.repeat(64), '<sha>': 'b'.repeat(40), '<commit>': 'c'.repeat(40) };
const fill = (text) => text.replace(/"<[^">]*>"/g, (m) => {
  const v = PLACEHOLDERS[m.slice(1, -1)];
  assert.ok(v !== undefined, `the placeholder ${m} is not one this test knows how to fill`);
  return JSON.stringify(v);
});

test('every JSON example on the page and in extractors/README.md passes the checks it illustrates', () => {
  const blocks = (text) => [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(fill(m[1])));
  const all = [...blocks(doc), ...blocks(read('extractors/README.md'))];
  assert.ok(all.length >= 5, `only ${all.length} JSON examples were found`);
  for (const ex of all) {
    let errors;
    if ('code_index_request' in ex) errors = requestErrors(ex);
    else if ('runtime' in ex && 'modules' in ex) errors = identityErrors(ex);
    else if ('code_index_schema' in ex) errors = responseErrors(ex, { files: ex.files.map((f) => f.path) });
    else if ('code_index_answer' in ex) errors = envelopeErrors(ex);
    else if ('pinned_commit' in ex) errors = answersFileErrors(ex);
    else assert.fail(`an example of no known record: ${JSON.stringify(ex).slice(0, 80)}`);
    assert.deepEqual(errors, [], `example ${JSON.stringify(ex).slice(0, 80)}`);
  }
});

// annotation_contains (operator, 2026-10-20: "Add annotation_contains (Recommended)"): consumer zero measured that the
// exact `annotation` finds 146 of its 212 string-bearing fields and is silent about the 66 `str | None` and `list[str]`.
test('symbol\'s annotation_contains finds every field whose annotation contains the text; annotation stays exact', async () => {
  const { answer } = await import('../scripts/lib/code-index-query.mjs');
  const def = (n, a) => ({ path: 'm.py', span, enclosing: 'm.C', name: n, qualified: `m.C.${n}`, kind: 'field', annotation: a });
  const facts = Object.fromEntries(TABLES.map((t) => [t, []]));
  facts.definitions = [def('a', 'str'), def('b', 'str | None'), def('c', 'list[str]'), def('d', 'int')];
  const files = [{ path: 'm.py', status: 'processed' }];
  const names = (args) => answer('symbol', args, { facts, files }).rows.map((r) => r.name).sort();
  assert.deepEqual(names({ name: 'm.C.', kind: 'field', annotation_contains: 'str' }), ['a', 'b', 'c']);
  assert.deepEqual(names({ name: 'm.C.', kind: 'field', annotation: 'str' }), ['a'], 'annotation is no longer an exact match');
});
