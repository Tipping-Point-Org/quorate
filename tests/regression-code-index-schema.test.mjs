// THE CODE INDEX'S SCHEMA HAS ONE OWNER, AND THE VALIDATOR AGREES WITH IT (code-index.plan.md stage 1).
//
// shared/code-index.md owns the tables, shapes, outcomes and extractor-failure details. The validator exports the same
// lists as constants, and these tests read the document's lists rather than restating them: a table added to one and
// forgotten in the other fails here, which is the "two owners of one fact" defect this repository keeps paying for.
// Each refusal below is one the plan names; an extractor whose response breaks one is reported, never trusted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import {
  CODE_INDEX_SCHEMA, TABLES, SHAPES, OUTCOMES, EXTRACTOR_FAILURES, responseErrors, envelopeErrors,
} from '../scripts/lib/code-index-schema.mjs';

const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'code-index.md'), 'utf8').split('\r\n').join('\n');
// The backticked first word of each bullet under one `## <heading>`, up to the next heading.
const listUnder = (heading) => {
  const at = doc.indexOf(`\n## ${heading}\n`);
  assert.ok(at !== -1, `shared/code-index.md has no "## ${heading}" section`);
  const body = doc.slice(at + heading.length + 5).split(/\n## /)[0];
  return [...body.matchAll(/^- `([a-z_-]+)`/gm)].map((m) => m[1]);
};

test('the tables, shapes, outcomes and failure details in shared/code-index.md are the validator\'s constants', () => {
  assert.deepEqual(listUnder('Tables'), [...TABLES]);
  assert.deepEqual(listUnder('Shapes'), [...SHAPES]);
  assert.deepEqual(listUnder('Outcomes'), [...OUTCOMES]);
  assert.deepEqual(listUnder('Extractor failures'), [...EXTRACTOR_FAILURES]);
});

const span = { start: { line: 1, col: 1 }, end: { line: 1, col: 9 } };
const request = { code_index_request: 1, language: 'python', root: '/r', files: ['a.py', 'b.py'], options: {} };
const good = () => ({
  code_index_schema: CODE_INDEX_SCHEMA,
  extractor: { name: 'fake', version: '1' },
  files: [{ path: 'a.py', status: 'processed' }, { path: 'b.py', status: 'not_processed', outcome: 'parse_error', reason: 'SyntaxError at line 2' }],
  facts: {
    definitions: [{ path: 'a.py', span, enclosing: 'a', name: 'f', qualified: 'a.f', kind: 'function', signature: '()' }],
    calls: [{ path: 'a.py', span, enclosing: 'a.f', callee: 'b.g', resolved: true, callee_text: 'g',
      args: [{ keyword: null, text: 'self.settings.llm', kind: 'attribute', path: 'self.settings.llm' }] }],
    constructions: [], literals: [], comparisons: [], imports: [], handlers: [],
  },
});

test('a well-formed response is accepted', () => {
  assert.deepEqual(responseErrors(good(), request), []);
});

const refuses = (mutate, pattern, why) => {
  const r = good();
  mutate(r);
  const errors = responseErrors(r, request);
  assert.ok(errors.some((e) => pattern.test(e)), `${why}: got ${JSON.stringify(errors)}`);
};

test('a response is refused for each rule the schema names', () => {
  refuses((r) => { r.code_index_schema = 2; }, /schema/, 'another schema version');
  refuses((r) => { r.facts.symbols = []; }, /unknown table "symbols"/, 'an unknown table');
  refuses((r) => { delete r.facts.calls[0].span; }, /no span/, 'a row without a span');
  refuses((r) => { r.facts.calls[0].span = { start: { line: 0, col: 1 }, end: { line: 1, col: 1 } }; }, /span/, 'a span with line 0');
  refuses((r) => { delete r.facts.definitions[0].enclosing; }, /enclosing/, 'a row with no enclosing');
  refuses((r) => { r.files.pop(); }, /b\.py.*not accounted for/, 'a requested file the response does not mention');
  refuses((r) => { r.files.push({ path: 'a.py', status: 'processed' }); }, /a\.py.*more than once/, 'a file listed twice');
  refuses((r) => { r.files.push({ path: 'c.py', status: 'processed' }); }, /c\.py.*not in the request/, 'a file nobody asked for');
  refuses((r) => { r.facts.calls[0].path = 'b.py'; }, /b\.py.*not a processed file/, 'a row in a file that was not processed');
  refuses((r) => { r.files[1].outcome = 'oops'; }, /outcome/, 'a not-processed file with an unknown outcome');
  refuses((r) => { r.facts.definitions[0].kind = 'method'; }, /kind "method"/, 'a definition kind outside function, class, field');
  refuses((r) => { r.facts.calls[0].args[0].kind = 'subscript'; }, /kind "subscript"/, 'an argument kind outside the five');
  refuses((r) => { r.facts.calls[0].resolved = false; }, /callee/, 'an unresolved call that still names a callee');
  refuses((r) => { delete r.extractor; }, /extractor/, 'a response that does not say which extractor produced it');
  // A row missing a field its table requires. G-26 of 20261020-043006-code-index-delivery: rowErrors checked only a
  // definition's kind, so such a row was cached as valid, and knownNames crashed on `undefined.split()` (G-27). Folded
  // into this test rather than a new one, because the suite's test count is a stated fact (check-counted-facts).
  refuses((r) => { delete r.facts.definitions[0].qualified; }, /definitions\[0\].*qualified/, 'a definition with no qualified name');
  refuses((r) => { delete r.facts.definitions[0].name; }, /definitions\[0\].*name/, 'a definition with no name');
  refuses((r) => { delete r.facts.definitions[0].signature; }, /definitions\[0\].*signature/, 'a function with no signature');
  refuses((r) => { delete r.facts.calls[0].resolved; }, /calls\[0\].*resolved/, 'a call with no resolved flag');
  refuses((r) => { delete r.facts.calls[0].callee; }, /calls\[0\].*callee/, 'a resolved call with no callee');
  refuses((r) => { delete r.facts.calls[0].callee_text; }, /calls\[0\].*callee_text/, 'a call with no callee text');
  refuses((r) => { delete r.facts.calls[0].args; }, /calls\[0\].*args/, 'a call with no args list');
  const row = (extra) => ({ path: 'a.py', span, enclosing: 'a', ...extra });
  refuses((r) => { r.facts.constructions = [row({ resolved: true, callee_text: 'C', keywords: [], args: [] })]; },
    /constructions\[0\].*type/, 'a construction with no type');
  refuses((r) => { r.facts.literals = [row({ value: 'x' })]; }, /literals\[0\].*type/, 'a literal with no type');
  refuses((r) => { r.facts.literals = [row({ type: 'str' })]; }, /literals\[0\].*value/, 'a literal with no value');
  refuses((r) => { r.facts.comparisons = [row({ left: {}, right: {}, literal: null })]; }, /comparisons\[0\].*op/, 'a comparison with no op');
  refuses((r) => { r.facts.comparisons = [row({ op: '==', left: {}, right: {}, literal: null, operands: 'x' })]; },
    /comparisons\[0\].*operands/, 'operands that are not a list');
  refuses((r) => { r.facts.imports = [row({ module: 'm', name: 'n', alias: null })]; }, /imports\[0\].*qualified/, 'an import with no qualified target');
  refuses((r) => { r.facts.handlers = [row({})]; }, /handlers\[0\].*caught/, 'a handler with no caught');
  // G-18, G-19 and G-22 of 20261020-051530-code-index-remediation-review: the fields the Tables section names that the
  // validator still did not require, an unresolved construction naming a type, and a response with no files list.
  refuses((r) => { r.facts.definitions = [row({ name: 'x', qualified: 'a.x', kind: 'field' })]; },
    /definitions\[0\].*annotation/, 'a field with no annotation');
  refuses((r) => { r.facts.constructions = [row({ type: 'a.C', resolved: true, callee_text: 'C', keywords: [], args: [] })]; },
    /constructions\[0\].*dict_keys/, 'a construction with no dict_keys');
  refuses((r) => { r.facts.constructions = [row({ type: 'a.C', resolved: false, callee_text: 'C', keywords: [], dict_keys: [], args: [] })]; },
    /constructions\[0\].*unresolved/, 'an unresolved construction that still names a type');
  refuses((r) => { r.facts.comparisons = [row({ op: '==', left: { text: 'x', kind: 'name' }, right: { text: '1', kind: 'literal' }, literal: 1 })]; },
    /comparisons\[0\].*via/, 'a comparison with no via');
  refuses((r) => { r.facts.comparisons = [row({ op: '==', left: {}, right: { text: '1', kind: 'literal' }, literal: 1, via: null })]; },
    /comparisons\[0\], left.*kind/, 'a comparison side with no kind or text');
  refuses((r) => { delete r.facts.calls[0].args[0].text; }, /calls\[0\], argument 0.*text/, 'an argument with no text');
  refuses((r) => { delete r.facts.calls[0].args[0].keyword; }, /calls\[0\], argument 0.*keyword/, 'an argument with no keyword');
  refuses((r) => { r.facts.imports = [row({ name: 'n', alias: null, qualified: null })]; }, /imports\[0\].*module/, 'an import with no module');
  refuses((r) => { r.facts.imports = [row({ module: 'm', alias: null, qualified: null })]; }, /imports\[0\].*name/, 'an import with no name');
  refuses((r) => { r.facts.imports = [row({ module: 'm', name: 'n', qualified: null })]; }, /imports\[0\].*alias/, 'an import with no alias');
  const noFiles = good();
  delete noFiles.files;
  noFiles.facts = {};
  assert.ok(responseErrors(noFiles, { ...request, files: [] }).some((e) => /files list/.test(e)),
    'a response with no files list over an empty request was accepted');
  // What the reference extractors emit stays accepted: an anonymous class has a null name, an unresolved import a null
  // target, a bare except a null caught, and a field has no signature.
  const r = good();
  r.facts.definitions.push({ path: 'a.py', span, enclosing: 'a', name: null, qualified: 'a.<anonymous>', kind: 'class', signature: '()' },
    { path: 'a.py', span, enclosing: 'a.C', name: 'x', qualified: 'a.C.x', kind: 'field', annotation: 'int' });
  r.facts.calls.push({ path: 'a.py', span, enclosing: 'a.f', callee: null, resolved: false, callee_text: 'h', args: [] });
  r.facts.constructions = [row({ type: 'a.C', resolved: true, callee_text: 'C', keywords: [], dict_keys: [], args: [] })];
  r.facts.literals = [row({ value: 3, type: 'int' })];
  r.facts.comparisons = [row({ op: '==', left: { text: 'x', kind: 'name' }, right: { text: '1', kind: 'literal' }, literal: 1, via: null })];
  r.facts.imports = [row({ module: null, name: 'n', alias: null, qualified: null })];
  r.facts.handlers = [row({ caught: null })];
  assert.deepEqual(responseErrors(r, request), []);
});

const envelope = () => ({
  code_index_answer: 1, shape: 'callees', outcome: 'complete', rows: [], input_hash: 'h',
  extractors: [{ name: 'fake', version: '1', runtime: 'python 3.12.4', parser: 'ast (stdlib)' }], framework: { commit: 'c', dirty: false }, not_checked: [],
});

test('an answer envelope is refused without its extractor identity or framework stamp, or with an unknown outcome', () => {
  assert.deepEqual(envelopeErrors(envelope()), []);
  const bad = (mutate, pattern, why) => {
    const e = envelope();
    mutate(e);
    const errors = envelopeErrors(e);
    assert.ok(errors.some((x) => pattern.test(x)), `${why}: got ${JSON.stringify(errors)}`);
  };
  bad((e) => { e.extractors = []; }, /extractor/, 'no extractor identity (D7)');
  bad((e) => { delete e.extractors; e.outcome = 'not_configured'; }, /extractor/, 'not_configured with no extractors list at all');
  const notConfigured = envelope();
  notConfigured.outcome = 'not_configured';
  notConfigured.extractors = [];
  assert.deepEqual(envelopeErrors(notConfigured), [], 'not_configured is the one answer no extractor produced');
  const unknownDirty = envelope();
  unknownDirty.framework.dirty = null;
  assert.deepEqual(envelopeErrors(unknownDirty), [], 'a dirty flag git could not determine is recorded as null');
  bad((e) => { delete e.framework; }, /framework/, 'no framework stamp');
  bad((e) => { e.outcome = 'empty'; }, /outcome "empty"/, 'an outcome outside the seven');
  bad((e) => { e.shape = 'grep'; }, /shape "grep"/, 'a shape outside the seven');
  bad((e) => { e.outcome = 'extractor_failed'; }, /detail/, 'extractor_failed with no detail');
  bad((e) => { e.outcome = 'extractor_failed'; e.detail = 'crashed'; }, /detail "crashed"/, 'a detail outside the five');
});
