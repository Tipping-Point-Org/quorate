// G-11 of 20261030-142430-ciss-s7-remediation-review: the grammar of a numeric contract value (a number, or a string of
// plain decimal digits) was pasted into code-index-cache, decisions and preflight-cache beside its owner in check-timeout,
// four definitions of one rule where ARCHITECTURE.md A-1 allows one. The next change to it would land at one site only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as checkTimeout from '../scripts/lib/check-timeout.mjs';
import { budgetOf } from '../scripts/lib/decisions.mjs';
import { cacheCapBytes } from '../scripts/lib/code-index-cache.mjs';
import { preflightCacheMaxBytes } from '../scripts/lib/preflight-cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// THE RULE, NOT ONE SPELLING OF IT (G-11 of 20261030-153323-ciss-s7-remediation-2-review): the literal text
// '[0-9]+(?:\.[0-9]+)?$' passed while snapshot-surface spelled the same anchored grammar /^\d+(\.\d+)?$/. Any whole-value
// pattern of digits with an optional decimal fraction counts: \d or [0-9], + or *, a capturing or non-capturing group.
const GRAMMAR = /\^(\\d|\[0-9\])[+*]\((\?:)?\\\.(\\d|\[0-9\])[+*]\)\?\$/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('the numeric contract-value grammar is spelled in one file, check-timeout.mjs', () => {
  const sites = walk(path.join(root, 'scripts'))
    .filter((f) => GRAMMAR.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(root, f).split(path.sep).join('/'));
  assert.deepEqual(sites, ['scripts/lib/check-timeout.mjs']);
});

test('the one-owner search sees each spelling of the grammar', () => {
  for (const s of ['/^[0-9]+(?:\\.[0-9]+)?$/', '/^\\d+(\\.\\d+)?$/', '/^\\d+(?:\\.\\d*)?$/']) assert.ok(GRAMMAR.test(s), s);
  assert.ok(!GRAMMAR.test('/^# elapsed: (\\d+(?:\\.\\d+)?) of/'), 'a number inside a longer pattern is not a contract value');
});

test('contractNumber reads a number or a digit string and nothing else', () => {
  const { contractNumber } = checkTimeout;
  assert.equal(typeof contractNumber, 'function');
  assert.equal(contractNumber(10), 10);
  assert.equal(contractNumber('2.5'), 2.5);
  for (const v of [true, [10], '  ', '-1', '1e3', ' 4', null, undefined, {}]) assert.ok(Number.isNaN(contractNumber(v)), String(v));
});

test('every caller refuses what contractNumber refuses', () => {
  for (const v of [true, [10], '  ', '1e3']) {
    assert.throws(() => budgetOf(v, 4), /budget must be/);
    assert.equal(cacheCapBytes(v).ok, false);
    assert.throws(() => preflightCacheMaxBytes({ review: { preflight_cache_max_mb: v } }), /preflight_cache_max_mb/);
  }
  assert.equal(budgetOf('4.5', 1), 4.5);
  assert.equal(cacheCapBytes('1').maxBytes, 1024 * 1024);
  assert.equal(preflightCacheMaxBytes({ review: { preflight_cache_max_mb: '1' } }), 1024 * 1024);
});
