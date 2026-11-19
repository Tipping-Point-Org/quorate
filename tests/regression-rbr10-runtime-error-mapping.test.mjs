// Whether a node runtime's envelope reports an ERROR is read through the adapter's declared mapping everywhere the
// engine decides on it (G-8 of 20261103-040939-rbr-remediation-9-review, with its symptoms G-12 and G-13; ARCHITECTURE.md
// A-9): remediation 9 moved runtimeAnswered's fields into node_runtime.answer, but spawn-node's result classification
// still passed `envelope.is_error` and spawn-subagent died on `envelope.is_error`, so a runtime declaring another error
// field was recorded as not answered in telemetry while its error was taken for success by the code that acts on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as callEntry from '../scripts/lib/call-entry.mjs';
import { builtinReviewers } from '../scripts/io/reviewers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'reviewers.json'), 'utf8'));
const DEFAULT = builtinReviewers()[TABLE.default_node_runtime];
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');

test('G-8: the adapter\'s error field decides whether an envelope reports an error', () => {
  const { runtimeError, runtimeSubtype } = callEntry;
  assert.equal(typeof runtimeError, 'function', 'lib/call-entry.mjs exports no reader of the adapter\'s error field');
  const other = { node_runtime: { answer: { error_field: 'failed', subtype_field: 'kind', success_subtypes: ['done'] } } };
  assert.equal(runtimeError({ failed: true }, other), true);
  assert.equal(runtimeError({ failed: false, is_error: true }, other), false, 'the default runtime\'s field decided for another runtime');
  assert.equal(runtimeError({ is_error: true }, DEFAULT), true);
  assert.equal(runtimeError({ is_error: false }, DEFAULT), false);
  assert.equal(runtimeError({ is_error: true }, { node_runtime: {} }), false, 'a runtime declaring no error field reports none');
  assert.equal(runtimeError(null, DEFAULT), false);
  assert.throws(() => runtimeError({}), /runtime/, 'no runtime given is refused, not judged by one vendor\'s fields');
  assert.equal(runtimeSubtype({ kind: 'aborted', subtype: 'x' }, other), 'aborted');
  assert.equal(runtimeSubtype({ subtype: 'error_max_turns' }, DEFAULT), 'error_max_turns');
  assert.equal(runtimeSubtype({ subtype: 'x' }, { node_runtime: {} }), null);
});

test('G-9: describeNodeExit reads the bound spellings from the adapter, not one vendor\'s', async () => {
  const { describeNodeExit } = await import('../scripts/lib/decisions.mjs');
  const other = { node_runtime: { answer: { subtype_field: 'kind' },
    exit: { reason_field: 'why', budget: { subtypes: ['over_spend'], reasons: [] }, turns: { subtypes: [], reasons: ['too_many_steps'] } } } };
  assert.match(describeNodeExit({ exitCode: 1, result: { kind: 'over_spend' }, runtime: other }), /DOLLAR CEILING/);
  assert.match(describeNodeExit({ exitCode: 1, result: { why: 'too_many_steps' }, runtime: other }), /TURN LIMIT/);
  assert.equal(describeNodeExit({ exitCode: 1, result: { subtype: 'error_max_turns' }, runtime: other }), 'exit code 1',
    'the default runtime\'s spelling decided for another runtime');
  assert.match(describeNodeExit({ exitCode: 1, result: { subtype: 'error_max_turns' }, runtime: DEFAULT }), /TURN LIMIT/);
  assert.equal(describeNodeExit({ exitCode: 1, result: { subtype: 'error_max_turns' }, runtime: { node_runtime: {} } }), 'exit code 1');
  assert.throws(() => describeNodeExit({ exitCode: 1, result: {} }), /runtime/);
  assert.doesNotMatch(read('scripts/lib/decisions.mjs'), /'error_max_turns'|'error_max_budget_usd'|'max_turns_exhausted'|'budget_exhausted'/,
    'lib/decisions.mjs names one vendor\'s terminal spellings');
});

test('G-12, G-13: spawn-node and spawn-subagent read the error through the adapter, not one vendor\'s field', () => {
  for (const rel of ['scripts/spawn-node.mjs', 'scripts/spawn-subagent.mjs']) {
    assert.doesNotMatch(read(rel), /envelope\.is_error\b/, `${rel} reads one vendor's error field`);
    assert.match(read(rel), /runtimeError\(/, `${rel} does not ask the adapter whether the envelope reports an error`);
  }
  assert.doesNotMatch(read('scripts/spawn-node.mjs'), /envelope\.subtype\b/, 'spawn-node names one vendor\'s subtype field');
  assert.doesNotMatch(read('scripts/lib/decisions.mjs'), /reports is_error/, 'classifyResult\'s reason names one vendor\'s field');
});
