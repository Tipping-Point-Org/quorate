// regression-ciss-s7-number-keys.test.mjs — G-7, G-11 and G-9 of 20261030-124823-ciss-stage7.
//
// Three contract numbers were read with a bare Number(): `true` became 1 and `[10]` became 10 for
// review.code_index_cache_max_mb (G-7) and review.preflight_cache_max_mb (G-11), and a whitespace-only budget string
// became a $0 ceiling (G-9). budgetOf already refused a value that is neither a number nor a string; the two cache caps
// did not, and none of the three refused a string with no number in it. Each is refused now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheCapBytes } from '../scripts/lib/code-index-cache.mjs';
import { preflightCacheMaxBytes } from '../scripts/lib/preflight-cache.mjs';
import { budgetOf } from '../scripts/lib/decisions.mjs';

// The three refuse alike: a string is digits with an optional fraction, as lib/check-timeout.mjs's minutes are.
const MALFORMED = [true, false, [10], [], { mb: 10 }, '  ', '\t', '0x10', '1e1', ' 10 '];

test('review.code_index_cache_max_mb refuses a boolean, an array, an object or a blank string (G-7)', () => {
  for (const v of MALFORMED) assert.equal(cacheCapBytes(v).ok, false, `${JSON.stringify(v)} was admitted`);
  assert.deepEqual(cacheCapBytes(10), { ok: true, maxBytes: 10 * 1024 * 1024 });
  assert.deepEqual(cacheCapBytes('10'), { ok: true, maxBytes: 10 * 1024 * 1024 });
});

test('review.preflight_cache_max_mb refuses a boolean, an array, an object or a blank string (G-11)', () => {
  for (const v of MALFORMED) {
    assert.throws(() => preflightCacheMaxBytes({ review: { preflight_cache_max_mb: v } }), /preflight_cache_max_mb/, `${JSON.stringify(v)} was admitted`);
  }
  assert.equal(preflightCacheMaxBytes({ review: { preflight_cache_max_mb: 10 } }), 10 * 1024 * 1024);
  assert.equal(preflightCacheMaxBytes({ review: { preflight_cache_max_mb: '10' } }), 10 * 1024 * 1024);
});

test('a whitespace-only budget is refused, not read as a $0 ceiling (G-9)', () => {
  for (const v of ['  ', '\t', ' \n ', '0x10', '1e1']) assert.throws(() => budgetOf(v, 4), /budget must be/, `${JSON.stringify(v)} was admitted`);
  assert.equal(budgetOf('4', 1), 4);
  assert.equal(budgetOf(0, 1), 0);
});
