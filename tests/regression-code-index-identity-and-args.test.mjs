// THE CODE INDEX REFUSES WHAT IS INCOMPLETE, RATHER THAN READING IT AS EMPTY (G-14, G-18, G-33 of
// 20261020-061457-code-index-full-sweep, with G-14's symptoms G-32 and G-34).
//
// - G-14: an --identity naming only itself was accepted and keyed the cache, so a change to the runtime, parser or modules
//   it left out could not invalidate cached facts. G-32 and G-34 are the same gap in the response and the envelope.
// - G-18: --args was checked only for being an object, so `symbol` with {} answered `unresolved` to a question that was
//   never asked.
// - G-33: a response that omitted a fact table passed, and a question over that table answered a false `complete`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityErrors, argsErrors, responseErrors, envelopeErrors, TABLES, SHAPES } from '../scripts/lib/code-index-schema.mjs';

const HASH = 'a'.repeat(64);
// scope_constructs is required since code-index-d1-part-b.plan.md stage 5; its comparison with the contract's table is the
// engine's, not the schema's, so any well-formed map serves here.
const full = { name: 'x', version: '1', runtime: 'node 24', parser: null, modules: { 'x.mjs': HASH }, scope_constructs: { Module: { opens_scope: true, visible_to_nested: true, binds_in_parent: false } } };

test('G-14: an identity is refused unless it gives name, version, runtime, parser and module hashes', () => {
  assert.deepEqual(identityErrors(full), []);
  assert.deepEqual(identityErrors({ ...full, parser: 'acorn 8.1.0' }), []);
  for (const k of ['version', 'runtime', 'modules']) {
    const { [k]: _, ...less } = full;
    assert.ok(identityErrors(less).length, `an identity with no ${k} was accepted`);
  }
  assert.ok(identityErrors({ name: 'x' }).length, 'a name alone was accepted');
  assert.ok(identityErrors({ ...full, modules: {} }).length, 'an identity hashing no module was accepted');
  assert.ok(identityErrors({ ...full, modules: { 'x.mjs': 'nothex' } }).length);
});

const request = { files: ['a.py'] };
const response = (over = {}) => ({ code_index_schema: 1, extractor: { name: 'x', version: '1' }, files: [{ path: 'a.py', status: 'processed' }],
  facts: Object.fromEntries(TABLES.map((t) => [t, []])), ...over });

test('G-33: a response that omits a fact table is refused; G-32: so is one that names no extractor version', () => {
  assert.deepEqual(responseErrors(response(), request), []);
  const { calls: _, ...noCalls } = response().facts;
  assert.ok(responseErrors(response({ facts: noCalls }), request).some((e) => /calls/.test(e)), 'an omitted calls table passed');
  assert.ok(responseErrors(response({ extractor: { name: 'x' } }), request).some((e) => /version/.test(e)));
});

const envelope = (over = {}) => ({ code_index_answer: 1, shape: 'calls', outcome: 'complete', rows: [], input_hash: 'k',
  extractors: [{ name: 'x', version: '1', runtime: 'node 24', parser: null }], framework: { commit: 'c', dirty: false },
  not_checked: [], ...over });

test('G-34: an envelope whose extractor is a name alone, or whose computed answer names no input_hash, is refused', () => {
  assert.deepEqual(envelopeErrors(envelope()), []);
  assert.ok(envelopeErrors(envelope({ extractors: [{ name: 'x' }] })).length, 'an extractor named by its name alone passed');
  assert.ok(envelopeErrors(envelope({ input_hash: null })).length, 'a complete answer with no input_hash passed');
  assert.deepEqual(envelopeErrors(envelope({ outcome: 'not_configured', input_hash: null, extractors: [] })), []);
  assert.deepEqual(envelopeErrors(envelope({ outcome: 'extractor_failed', detail: 'failed', input_hash: null,
    extractors: [{ name: 'unidentified: x', version: null, runtime: null, parser: null }] })), []);
});

test('G-18: each shape refuses arguments missing its required filter, or naming one it does not take', () => {
  assert.ok(argsErrors('symbol', {}).some((e) => /name is required/.test(e)), 'symbol with {} was accepted');
  assert.ok(argsErrors('calls', { calle: 'a.b' }).length, 'a misspelt filter was accepted');
  assert.ok(argsErrors('comparisons', {}).length, 'comparisons with neither literal nor operand was accepted');
  assert.ok(argsErrors('handlers', { calls_any: [] }).length);
  const ok = { symbol: { name: 'a.' }, calls: { callee: 'a.f', arg_path: 'x.y' }, constructions: { type: 'a.T' },
    literals: { value: 'v', within: 'a' }, comparisons: { literal: 'auto' }, callees: { of: 'a' }, handlers: { calls_any: ['a.f'] } };
  for (const s of SHAPES) assert.deepEqual(argsErrors(s, ok[s]), [], s);
});
