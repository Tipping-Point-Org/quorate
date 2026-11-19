// A PUBLISH ALLOWANCE COVERS ONE HIT, NAMED BY ITS LINE (G-19 of 20261116-221234-m2-9a-high-2, G-6 of
// 20261116-231613-m2-9a2-remediation-review; the M2 plan's stage 3 as amended 2026-11-16, operator: "Tighten to per-line,
// amend I-3 (Recommended)"; built in the session on the operator's word: "I build it here, on your word (Recommended)").
// An allowance matched on file and pattern alone, so one allowance silenced every hit of its pattern in its file, and a
// leak added later to an allowed file shipped unreported (64 allowances covered 93 hits on 2026-11-16).
//
// The line is named by the SHA-256 of its trimmed text, not the text itself: a gitleaks hit's line holds a secret-shaped
// value, and copying it into the tracked manifest would put that shape in the repository and the snapshot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import * as pub from '../scripts/lib/publish.mjs';

const { validateManifest, applyAllowances, scanText } = pub;

const sha = (s) => crypto.createHash('sha256').update(s.trim()).digest('hex');
const base = { version: 1, patterns: [{ name: 'p', regex: 'X' }] };

test('an allowance without the hash of its line is refused', () => {
  const r = validateManifest({ ...base, allow: [{ path: 'a.txt', pattern: 'p', reason: 'r' }] });
  assert.match(String(r.error), /line_sha256/);
  const ok = validateManifest({ ...base, allow: [{ path: 'a.txt', pattern: 'p', line_sha256: sha('X one'), reason: 'r' }] });
  assert.equal(ok.error, undefined, ok.error);
});

test('a hit carries the hash of its trimmed line', () => {
  const [h] = scanText('a.txt', '  X one  \n', { patterns: base.patterns });
  assert.equal(h.line_sha256, sha('X one'));
  assert.equal(typeof pub.lineSha256, 'function', 'lib/publish.mjs exports no lineSha256');
  assert.equal(pub.lineSha256('  X one  '), sha('X one'));
});

test('one allowance covers one hit: a second line of the same pattern in the same file is reported', () => {
  const hits = scanText('a.txt', 'X one\nX two\n', { patterns: base.patterns });
  const r = applyAllowances(hits, [{ path: 'a.txt', pattern: 'p', line_sha256: sha('X one'), reason: 'r' }]);
  assert.deepEqual(r.allowed.map((h) => h.line), [1]);
  assert.deepEqual(r.kept.map((h) => h.line), [2], 'the allowance silenced a line it does not name');
});

test('two identical lines need two allowances', () => {
  const hits = scanText('a.txt', 'X one\nX one\n', { patterns: base.patterns });
  const one = { path: 'a.txt', pattern: 'p', line_sha256: sha('X one'), reason: 'r' };
  assert.equal(applyAllowances(hits, [one]).kept.length, 1);
  assert.equal(applyAllowances(hits, [one, { ...one }]).kept.length, 0);
});

test('the shipped manifest names every allowance by its line', () => {
  const m = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'publish', 'manifest.json'), 'utf8'));
  assert.equal(validateManifest(m).error, undefined, validateManifest(m).error);
  assert.ok(m.allow.every((a) => /^[0-9a-f]{64}$/.test(a.line_sha256)));
});

// EVERY OCCURRENCE IS A HIT (G-12 of 20261117-031403-m2-9a-d1; operator: "Fix both; every occurrence is a hit
// (Recommended)"): scanText ran each pattern once per line, so a second occurrence on the same line was no hit and the
// one allowance naming that line covered both.
test('two occurrences of a pattern on one line are two hits, and one allowance covers only one', () => {
  const hits = scanText('a.txt', 'X one X two\n', { patterns: base.patterns });
  assert.equal(hits.length, 2, 'the second occurrence on the line was not reported');
  const one = { path: 'a.txt', pattern: 'p', line_sha256: sha('X one X two'), reason: 'r' };
  assert.equal(applyAllowances(hits, [one]).kept.length, 1, 'one allowance covered both occurrences');
  assert.equal(applyAllowances(hits, [one, { ...one }]).kept.length, 0);
});

test('a binary file keeps every occurrence on a line, each once across its views', () => {
  const hits = pub.scanShipped('b.bin', Buffer.from('\0X one X two\n', 'latin1'), { patterns: base.patterns });
  assert.equal(hits.length, 2, 'scanShipped collapsed two occurrences on one line');
});

test('a zero-length match cannot loop: it is one hit at its place', () => {
  const hits = scanText('a.txt', 'abc', { patterns: [{ name: 'z', regex: '^' }] });
  assert.equal(hits.length, 1);
});
