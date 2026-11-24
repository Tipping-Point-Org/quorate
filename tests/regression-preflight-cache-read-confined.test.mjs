// G-10 of 20261122-193909-llo-delivery (panel-codex-security): readPreflightCache read its entry with a raw readFileSync,
// so a link standing at .preflight-cache, or at the entry, put a valid-looking JSON from outside the reviews root in place
// of a cached result and suppressed the declared checks. The entry is read through `confined` rooted at the reviews root;
// a link at any level is refused, and a refused entry is treated as absent, so the checks run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPreflightCache } from '../scripts/io/preflight-cache.mjs';
import { preflightCachePath } from '../scripts/lib/preflight-cache.mjs';
import { makeLink } from './helpers.mjs';

const HASH = 'a'.repeat(64);
const ENTRY = JSON.stringify({ schema_version: 1, input_sha256: HASH, results: [] });

test('G-10: a link at the pre-flight cache folder is not read as a cached entry', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-pfc-read-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const reviews = path.join(base, 'reviews');
  fs.mkdirSync(reviews);
  const p = preflightCachePath(reviews, HASH);
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, path.basename(p)), ENTRY);
  // Through makeLink, so a refused kind skips by name (G-9 of 20261122-204359-llo-remediation-review).
  if (!makeLink(t, { target: outside, at: path.dirname(p), type: 'dir', fallback: { dir: outside } })) return;
  assert.equal(readPreflightCache(reviews, HASH), null, 'an entry from outside the reviews root was accepted as cached');
});

test('an entry in the cache itself is still read', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-pfc-read-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const p = preflightCachePath(base, HASH);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, ENTRY);
  assert.equal(readPreflightCache(base, HASH)?.input_sha256, HASH);
});
