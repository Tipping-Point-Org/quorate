// Whether a node runtime answered is read through the adapter's declared mapping (G-7 of
// 20261103-022403-rbr-remediation-8-review; ARCHITECTURE.md A-9): runtimeAnswered read `is_error` and `subtype`, one
// vendor's envelope fields, at the shared boundary, so another runtime had to imitate that envelope or change the code.
// The fields are now the adapter's node_runtime.answer, as its usage is the adapter's `usage`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeAnswered } from '../scripts/lib/call-entry.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'reviewers.json'), 'utf8'));
const DEFAULT = builtinReviewers()[TABLE.default_node_runtime];

test('G-7: lib/call-entry.mjs names no envelope field of its own', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'call-entry.mjs'), 'utf8');
  assert.doesNotMatch(src, /\.is_error\b|\.subtype\b|'success'/, 'runtimeAnswered reads one vendor\'s envelope fields');
});

test('G-7: another runtime\'s declared mapping decides, and the default one keeps its behaviour', () => {
  const other = { node_runtime: { answer: { error_field: 'failed', subtype_field: 'kind', success_subtypes: ['done'] } } };
  assert.equal(runtimeAnswered('{"failed":false,"kind":"done"}', other), true);
  assert.equal(runtimeAnswered('{"failed":true,"kind":"done"}', other), false);
  assert.equal(runtimeAnswered('{"failed":false,"kind":"aborted"}', other), false);
  assert.equal(runtimeAnswered('{"is_error":true}', other), true, 'the default runtime\'s field decided for another runtime');
  assert.equal(runtimeAnswered('{"is_error":false,"subtype":"success"}', DEFAULT), true);
  assert.equal(runtimeAnswered('{"is_error":true,"subtype":"error_max_turns"}', DEFAULT), false);
  assert.equal(runtimeAnswered('{"is_error":false,"subtype":"error_during_execution"}', DEFAULT), false);
  assert.equal(runtimeAnswered('{"is_error":false}', DEFAULT), true, 'an envelope naming no subtype is judged by its error field');
  assert.equal(runtimeAnswered('not json', DEFAULT), false);
  assert.equal(runtimeAnswered('{"x":1}', { node_runtime: {} }), true, 'a runtime declaring no mapping: a parsed object is an answer');
  assert.throws(() => runtimeAnswered('{}'), /runtime/, 'no runtime given is refused, not judged by one vendor\'s fields');
});
