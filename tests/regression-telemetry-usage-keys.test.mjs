// G-14 of 20261025-222928-tel-remediation-3-review: the usage projection filtered every VALUE and copied every KEY as the
// runtime gave it, so text or a credential placed in a key name reached the tracked telemetry.json. A key is kept only when
// it is a short label and no secret shape; the token is BUILT here, never written out, as lib/secret-shapes.mjs builds its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskEntry } from '../scripts/lib/telemetry-record.mjs';

const TOKEN = ['sk', 'A'.repeat(12) + 'b'.repeat(12)].join('-');

test('a usage key that is a sentence or a secret shape is dropped; a label key is kept', () => {
  const usage = { input_tokens: 5, 'You asked for X and it was done': 1, [TOKEN]: 2,
    server_tool_use: { web_search_requests: 0, 'the model wrote this here': 3 } };
  const modelUsage = { 'claude-opus-5-5[1m]': { inputTokens: 1 }, [TOKEN]: { inputTokens: 2 } };
  const t = taskEntry('security-audit', { usage, model_usage: modelUsage });
  assert.deepEqual(t.usage, { input_tokens: 5, server_tool_use: { web_search_requests: 0 } });
  assert.deepEqual(Object.keys(t.model_usage), ['claude-opus-5-5[1m]'], 'a model name key was dropped or a token key kept');
  assert.equal(JSON.stringify(t).includes(TOKEN), false, 'a secret-shaped key reached the record');
});
