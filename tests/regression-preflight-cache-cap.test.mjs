// G-10 of run 20260925-015614-platform-review (panel-codex-security): every distinct pre-flight input
// set kept a full copy of its captured output with no bound, so the machine-local cache grew with every
// edit, forever. Settled with the operator on 2026-09-25: bound it by SIZE, not by entry count (the
// harm is disk, and an entry can be 100 KB or 50 MB), evict least-recently-USED, count a reuse as a
// use, always keep the newest entry, default 256 MB, configurable as review.preflight_cache_max_mb.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { preflightEvictions, preflightCacheMaxBytes } from '../scripts/lib/preflight-cache.mjs';
import { writePreflightCache, touchPreflightCache, preflightCachePath } from '../scripts/io/preflight-cache.mjs';
import { confined } from '../scripts/io/confined-path.mjs';

const MB = 1024 * 1024;

test('G-10: the cap comes from the contract — absent is 256 MB, "" is uncapped, a number is that cap', () => {
  assert.equal(preflightCacheMaxBytes({}), 256 * MB);
  assert.equal(preflightCacheMaxBytes({ review: { preflight_cache_max_mb: '' } }), null, 'uncapped, by declaration');
  assert.equal(preflightCacheMaxBytes({ review: { preflight_cache_max_mb: 10 } }), 10 * MB);
  assert.throws(() => preflightCacheMaxBytes({ review: { preflight_cache_max_mb: -1 } }), /preflight_cache_max_mb/);
});

// G-5 of 20261030-153323-ciss-s7-remediation-2-review: an explicit null (a key written `preflight_cache_max_mb:` with no
// value) was read as uncapped, though only "" declares that. It is refused, as panel_snapshot_max_mb refuses it.
test('G-5: an explicit null is refused, not read as uncapped', () => {
  assert.throws(() => preflightCacheMaxBytes({ review: { preflight_cache_max_mb: null } }), /preflight_cache_max_mb/);
});

test('G-10: eviction is least-recently-used by total size, and the newest entry is always kept', () => {
  const entries = [
    { hash: 'a', bytes: 40, lastUsed: 1 },
    { hash: 'b', bytes: 40, lastUsed: 3 },
    { hash: 'c', bytes: 40, lastUsed: 2 },
  ];
  assert.deepEqual(preflightEvictions(entries, { maxBytes: 90, keep: 'c' }).evict, ['a'],
    'the least recently used goes first, until the rest fits');
  const big = preflightEvictions([{ hash: 'x', bytes: 500, lastUsed: 9 }, { hash: 'y', bytes: 10, lastUsed: 1 }], { maxBytes: 100, keep: 'x' });
  assert.deepEqual(big.evict, ['y']);
  assert.equal(big.overCap, true, 'the newest alone exceeds the cap: kept, and reported');
  assert.deepEqual(preflightEvictions(entries, { maxBytes: null, keep: 'c' }).evict, [], 'uncapped evicts nothing');
});

test('G-10: writing an entry evicts the least recently used, and a reuse refreshes recency', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-pfcap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ev = path.join(dir, 'ev');
  fs.mkdirSync(ev);
  fs.writeFileSync(path.join(ev, 'test.log'), 'x'.repeat(2000));
  const put = (hash, when) => {
    writePreflightCache(dir, hash, { run_id: hash, results: [] }, { evidenceFrom: { owner: confined(dir), segs: ['ev'] }, maxBytes: 5000 });
    const t0 = new Date(when);
    fs.utimesSync(preflightCachePath(dir, hash), t0, t0);
  };
  put('h1', 1_000_000);
  put('h2', 2_000_000);
  touchPreflightCache(dir, 'h1');                  // h1 reused: it is now the most recently used
  put('h3', Date.now() + 1000);                    // over 5000 bytes: something must go
  assert.ok(fs.existsSync(preflightCachePath(dir, 'h1')), 'the reused entry survives');
  assert.ok(!fs.existsSync(preflightCachePath(dir, 'h2')), 'the least recently used is evicted');
  assert.ok(fs.existsSync(preflightCachePath(dir, 'h3')), 'the newest is kept');
});

test('G-10: the key is wired end to end — run-checks passes the cap, run-graph refreshes on reuse', () => {
  const root = path.join(import.meta.dirname, '..', 'scripts');
  assert.match(fs.readFileSync(path.join(root, 'run-checks.mjs'), 'utf8'), /maxBytes:\s*preflightCacheMaxBytes\(/);
  assert.match(fs.readFileSync(path.join(root, 'run-graph.mjs'), 'utf8'), /touchPreflightCache\(/);
});

// G-28 of run 20260925-200721-platform-remediated (panel-codex-docs): "least-recently-used" was
// false. The loop kept anything that still fit, newest first, so a smaller OLDER entry survived while
// a newer one that did not fit was evicted. The reviewer's own case: cap 100, the protected entry 60
// bytes, a newer 50 and an older 40 — the 40 was kept. Once one entry does not fit, it and everything
// older than it go.
test('G-28: eviction is least-recently-used — nothing older survives a newer entry that was evicted', () => {
  const entries = [
    { hash: 'keep', bytes: 60, lastUsed: 30 },
    { hash: 'newer', bytes: 50, lastUsed: 20 },
    { hash: 'older', bytes: 40, lastUsed: 10 },
  ];
  assert.deepEqual(preflightEvictions(entries, { maxBytes: 100, keep: 'keep' }).evict.sort(), ['newer', 'older']);
});
