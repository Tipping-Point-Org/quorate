// The graph's only prose node could never succeed.
//
// Found by: code-audit, 20260804-184124-fullsweep. spawn-node tested `!payload` BEFORE the
// `schemaVariant === 'none'` branch, so a prose node — which has no structured output BY
// DEFINITION — was marked DEGRADED before reaching the branch written to handle it.
// second-opinion had therefore never once reported OK across every run in the project's history,
// and read as a flaky node rather than a broken contract. One sweep produced 18,405 characters of
// correct analysis, billed $2.14, and discarded all of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyResult } from '../scripts/lib/decisions.mjs';

// THE BUG, pinned. If anyone reorders these branches again, this fails.
test('regression: a prose node with no structured_output is OK, not DEGRADED', () => {
  const r = classifyResult({
    schemaVariant: 'none',
    hasPayload: false,                      // exactly the condition that used to fail it
    resultText: '## Lead finding\n\nThe adjudication understates G-3.',
  });
  assert.equal(r.branch, 'prose');
  assert.equal(r.state, 'OK', 'prose is the expected shape for `none`, not a failure');
});

test('regression: prose is decided BEFORE the missing-payload check', () => {
  // Same inputs, differing only in variant. If ordering regresses, the `none` case starts
  // reporting 'no-payload' and this test names the exact reason.
  const prose = classifyResult({ schemaVariant: 'none', hasPayload: false, resultText: 'text' });
  const schema = classifyResult({ schemaVariant: 'code', hasPayload: false, resultText: 'text' });
  assert.equal(prose.branch, 'prose');
  assert.equal(schema.branch, 'no-payload', 'a schema-bearing node without a payload is still a failure');
});

test('an empty prose result is still DEGRADED — the node claimed to finish and said nothing', () => {
  const r = classifyResult({ schemaVariant: 'none', hasPayload: false, resultText: '   \n  ' });
  assert.equal(r.state, 'DEGRADED');
  assert.match(r.reason, /empty/);
});

test('is_error outranks every other branch, prose included', () => {
  const r = classifyResult({ schemaVariant: 'none', isError: true, resultText: 'plenty of text' });
  assert.equal(r.branch, 'error');
  assert.equal(r.state, 'DEGRADED');
});

test('a schema-bearing node with a payload is OK', () => {
  assert.equal(classifyResult({ schemaVariant: 'code', hasPayload: true }).state, 'OK');
});
