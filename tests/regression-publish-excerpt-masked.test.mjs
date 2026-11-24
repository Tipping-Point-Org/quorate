// G-5 of 20261123-011514-m3s7-b4-remediation-2-review (I-1 of m3-stage7-fixes.md): scanText's excerpt held the matched
// machine-local path or identity in clear, so the publish report repeated what the scan exists to keep out. The excerpt
// masks the matched span, through the end of the path it starts, and every other hit on the same line; the hit is still
// reported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../scripts/lib/publish.mjs';

// Built, not written out, so this file does not carry the shapes the release scan refuses.
const drivePath = `${'C'}:${['', 'Users', 'someone', 'proj'].join('/')}`;
const drive = { name: 'windows-drive-path', regex: '(^|[^A-Za-z0-9])[A-Za-z]:[\\\\/][A-Za-z0-9_.~-]' };
const identity = { name: 'identity', regex: 'Jane Q\\. Roe' };

test('a machine-local path hit reports its excerpt with the path masked', () => {
  const hits = scanText('a.md', `the tree at ${drivePath} is read\n`, { patterns: [drive] });
  assert.equal(hits.length, 1);
  assert.ok(!/Users|someone|proj/.test(hits[0].excerpt), `excerpt repeats the path: ${hits[0].excerpt}`);
  assert.ok(hits[0].excerpt.includes('[masked]'), hits[0].excerpt);
});

test('an identity hit reports its excerpt with the identity masked', () => {
  const hits = scanText('a.md', 'written by Jane Q. Roe in 2026\n', { patterns: [identity] });
  assert.equal(hits.length, 1);
  assert.ok(!hits[0].excerpt.includes('Roe'), `excerpt repeats the identity: ${hits[0].excerpt}`);
  assert.ok(hits[0].excerpt.includes('[masked]'), hits[0].excerpt);
});

test('each hit on a line masks the others in its context too', () => {
  const hits = scanText('a.md', `Jane Q. Roe ${drivePath}\n`, { patterns: [drive, identity] });
  assert.equal(hits.length, 2);
  for (const h of hits) {
    assert.ok(!/Roe|Users|someone/.test(h.excerpt), `${h.name} excerpt repeats another hit: ${h.excerpt}`);
  }
});
