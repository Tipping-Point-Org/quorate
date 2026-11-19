// The code-index schema findings of 20261021-162807-ciss-d1-review: G-18 (a same-line span whose end column precedes its
// start passed), G-20 (a sweep with no args escaped argument validation), G-19 (RULES was named in a comment and never
// used, so a cross-record error could not say which rule it broke) and G-34 (a request example passed on `files && root`
// being truthy, with no interpreter behind it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../scripts/lib/code-index-schema.mjs';
import { RULES, TABLES } from '../scripts/lib/code-index-spec.mjs';

const span = (sl, sc, el, ec) => ({ start: { line: sl, col: sc }, end: { line: el, col: ec } });
const response = (rowSpan) => ({
  code_index_schema: 1, extractor: { name: 'x', version: '1' }, files: [{ path: 'a.py', status: 'processed' }],
  facts: { ...Object.fromEntries(TABLES.map((t) => [t, []])), literals: [{ path: 'a.py', span: rowSpan, enclosing: 'm', value: 1, type: 'int' }] },
});

test('G-18: a span ending on its start line before its start column is refused', () => {
  const request = { files: ['a.py'] };
  assert.deepEqual(S.responseErrors(response(span(2, 1, 2, 9)), request), [], 'a well-formed span was refused');
  assert.deepEqual(S.responseErrors(response(span(2, 9, 3, 1)), request), [], 'a span ending on a later line, at a lower column, was refused');
  assert.ok(S.responseErrors(response(span(2, 9, 2, 1)), request).some((e) => /span/.test(e)),
    'a span whose end column precedes its start column on the same line passed');
});

test('G-20: a sweep with no args is refused, naming the argument its shape requires', () => {
  const sweep = { name: 's', shape: 'calls', expected: [], method: 'read' };
  const errors = S.answerFileErrors({ pinned_commit: 'abcdef1', sweeps: [sweep] });
  assert.ok(errors.some((e) => /sweeps\[0\].*args/.test(e)), `a sweep with no args passed: ${JSON.stringify(errors)}`);
  assert.ok(S.answerFileErrors({ pinned_commit: 'abcdef1', sweeps: [{ ...sweep, args: {} }] }).some((e) => /callee is required/.test(e)));
  assert.deepEqual(S.answerFileErrors({ pinned_commit: 'abcdef1', sweeps: [{ ...sweep, args: { callee: 'm.f' } }] }), []);
});

test('G-19: the interpreter implements exactly the rules the spec names, and each refusal names its rule', () => {
  // That every rule RULES names is applied is held by regression-ciss-d1-r3-rules-one-owner, at the call sites: the list
  // this line compared against RULES was a second owner that proved only that two lists agreed (G-4 of
  // 20261021-190234-ciss-d1-remediations-review).
  assert.ok(Object.keys(RULES).length, 'the spec names its rules');
  const names = (rule, errors) => assert.ok(errors.some((e) => e.includes(`(rule ${rule})`)), `${rule} was refused without its name: ${JSON.stringify(errors)}`);
  const ok = response(span(1, 0, 1, 1));
  names('files-accounted-once', S.responseErrors(ok, { files: ['a.py', 'b.py'] }));
  names('rows-in-processed-files', S.responseErrors({ ...ok, files: [{ path: 'a.py', status: 'not_processed', outcome: 'parse_error' }] }, { files: ['a.py'] }));
  names('all-tables-present', S.responseErrors({ ...ok, facts: { literals: ok.facts.literals } }, { files: ['a.py'] }));
  names('response-matches-identity', S.responseErrors(ok, { files: ['a.py'] }, { name: 'y', version: '1' }));
  const env = { code_index_answer: 1, shape: 'callees', outcome: 'complete', rows: [], input_hash: 'h', extractors: [], framework: { commit: 'c', dirty: false }, not_checked: [] };
  names('extractors-unless-not-configured', S.envelopeErrors(env));
  names('hash-unless-no-facts', S.envelopeErrors({ ...env, input_hash: null }));
  names('one-of-arguments', S.argsErrors('comparisons', {}));
  names('pinned-commit-is-hex', S.answerFileErrors({ pinned_commit: 'HEAD', sweeps: [{ name: 's', shape: 'calls', args: { callee: 'f' }, expected: [], method: 'read' }] }));
});

test('G-34: a request is checked by the interpreter against the spec\'s field map', () => {
  assert.equal(typeof S.requestErrors, 'function', 'there is no request interpreter; a request example passes on files && root alone');
  const ok = { code_index_request: 1, language: 'python', root: '/r', files: ['a.py'], options: {} };
  assert.deepEqual(S.requestErrors(ok), []);
  for (const [what, bad] of [
    ['the schema', { ...ok, code_index_request: 2 }],
    ['the language', { ...ok, language: 7 }],
    ['the file list', { ...ok, files: 'a.py' }],
    ['a file', { ...ok, files: [''] }],
    ['the options', { ...ok, options: [] }],
    ['the root', { ...ok, root: '' }],
  ]) assert.ok(S.requestErrors(bad).length, `a request with a wrong ${what} passed`);
});
