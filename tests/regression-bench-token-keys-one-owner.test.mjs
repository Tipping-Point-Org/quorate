// G-1, G-2 and G-3 of 20261114-195905-m2-pred1-remediation-2-review: which of a usage record's `*_tokens` keys are
// counted had two owners in lib/bench-settings.mjs (usageTokensOnce and sumLensUsage each walked the record against the
// module's RESTATED_TOKEN_KEYS, G-2), and two readers beside them named Claude's four keys and dropped agy's
// `cache_read_tokens`: bench-lenses' console line printed only `cache_read_input_tokens` (G-1), and the repair-pass
// bench's token total summed four fixed keys (G-3). agy's shape is the one pinned in
// tests/regression-bench-thinking-once.test.mjs, cut from its real stream.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bs from '../scripts/lib/bench-settings.mjs';
import * as rb from '../scripts/lib/repair-bench.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGY = { input_tokens: 8110, output_tokens: 211, thinking_tokens: 192, cache_read_tokens: 7, total_tokens: 8321 };
const CLAUDE = { input_tokens: 1, output_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens_details: { thinking_tokens: 4 } };

test('one owner names the counted keys, and both the summer and the reader go through it (G-2)', () => {
  assert.equal(typeof bs.countedTokenEntries, 'function', 'the rule for which keys count has one exported owner');
  assert.deepEqual(bs.countedTokenEntries(AGY), [['input_tokens', 8110], ['output_tokens', 211], ['cache_read_tokens', 7]]);
  assert.equal(bs.usageTokensOnce(AGY), 8110 + 211 + 7);
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'bench-settings.mjs'), 'utf8');
  const uses = (src.match(/RESTATED_TOKEN_KEYS\.has\(/g) ?? []).length;
  assert.equal(uses, 1, 'RESTATED_TOKEN_KEYS is consulted in one place, the owner');
});

test('the cache-read figure counts both vendors\' spellings (G-1)', () => {
  assert.equal(typeof bs.cacheReadTokens, 'function');
  const t = bs.sumLensUsage([{ usage: { arm: AGY, lens: CLAUDE } }]);
  assert.equal(bs.cacheReadTokens(t), 7 + 1000);
  assert.equal(bs.cacheReadTokens({}), 0);
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'bench-lenses.mjs'), 'utf8');
  assert.match(src, /cacheReadTokens\(usageTotal\)/, 'the console line prints the cache reads through the owner');
  assert.doesNotMatch(src, /k\(usageTotal\.cache_read_input_tokens\)/, 'not Claude\'s key alone');
});

test('the repair-pass bench counts an agy-shaped pass\'s tokens once each (G-3)', () => {
  assert.equal(typeof rb.passTokens, 'function');
  assert.equal(rb.passTokens(AGY), 8110 + 211 + 7, 'agy\'s cache reads counted, its thinking and aggregate not');
  assert.equal(rb.passTokens(CLAUDE), 1 + 10 + 100 + 1000);
  assert.ok(Number.isNaN(rb.passTokens({ output_tokens: 3 })), 'input missing is an unread figure');
  assert.ok(Number.isNaN(rb.passTokens(null)));
});
