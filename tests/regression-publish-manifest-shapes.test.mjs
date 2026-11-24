// G-15 and G-14 of 20261122-232627-m3s7-b4-review (I-13 of m3-stage7-fixes.md): the shipped manifest's windows-drive-path
// needed a backslash and a first component of two characters, so a drive path with forward slashes, or one whose first
// folder is one character, passed the release scan,
// and blog/sessions, raw conversation digests, was kept out of the public mirror by .gitignore alone. Held against the
// manifest that ships, through the scan that reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { applyAllowances, planSnapshot, scanShipped, scanText, validateLocalPatterns, validateManifest } from '../scripts/lib/publish.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'publish', 'manifest.json'), 'utf8'));
const drive = manifest.patterns.filter((p) => p.name === 'windows-drive-path');

test('the shipped windows-drive-path catches forward slashes and a one-character first component', () => {
  assert.equal(drive.length, 1);
  // Built, not written out, so this file does not carry the shapes the scan it tests refuses.
  const d = (letter, rest) => `${letter}:${rest}`;
  for (const line of [`see ${d('C', ['', 'Users', 'someone', 'x'].join('/'))}`, `at ${d('C', '\\x\\y')}`, `a ${d('D', '/w')}`, `"${d('E', '\\q')}"`]) {
    assert.equal(scanText('a.md', `${line}\n`, { patterns: drive }).length, 1, `${line} passed the scan`);
  }
  for (const line of ['https://example.com/a', 'file:///tmp/x', 'a: b']) {
    assert.equal(scanText('a.md', `${line}\n`, { patterns: drive }).length, 0, `${line} was taken for a drive path`);
  }
});

// G-13 of 20261123-003125-m3s7-b4-remediation-review-b: the broadened pattern matched shipped lines of tests/helpers.mjs and
// of this file with no allowance, so the release scan refused the tree. Each file the widening reached passes the scan
// with the manifest's own allowances.
test('the files the broadened windows-drive-path reached pass the shipped scan', () => {
  for (const rel of ['tests/helpers.mjs', 'tests/regression-publish-manifest-shapes.test.mjs', 'scripts/spawn-node.mjs']) {
    const hits = scanText(rel, fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'), { patterns: manifest.patterns, markers: manifest.markers });
    const { kept } = applyAllowances(hits, manifest.allow);
    assert.deepEqual(kept.map((h) => `${h.path}:${h.line} ${h.excerpt ?? h.marker}`), [], `${rel} would refuse the publish`);
  }
});

// G-3 of 20261123-020742-m3s7-b4-remediation-3-review: the three files above were not the whole reach. The broadened
// pattern also matched shared/claude-md-contract.md's illustrative glob, with no allowance, so the release scan refused
// the tree, and in tests/ it matched some two hundred made-up paths. The pattern now skips tests/ (operator: "Pattern
// skips tests/ only (Recommended)"), and every shipped file is held to the scan here, with no allowance left stale.
test('every shipped file passes the scan with the manifest\'s allowances, none stale', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
  const { ship } = planSnapshot(tracked, { exclude: manifest.exclude, replace: manifest.replace });
  const hits = [];
  for (const { path: rel, from } of ship) {
    let buf;
    try { buf = fs.readFileSync(path.join(REPO_ROOT, from)); } catch { continue; }
    hits.push(...scanShipped(rel, buf, { patterns: manifest.patterns, markers: [] }));
  }
  const { kept, unused } = applyAllowances(hits, manifest.allow);
  assert.deepEqual(kept.map((h) => `${h.path}:${h.line} ${h.name} ${h.line_sha256} ${h.excerpt}`), [], 'the release scan would refuse these');
  assert.deepEqual(unused.map((a) => `${a.path} ${a.pattern} ${a.line_sha256}`), [], 'these allowances are stale');
});

test('a manifest pattern skips the paths its skip names, and only a manifest pattern may skip', () => {
  const p = [{ name: 'windows-drive-path', regex: drive[0].regex, skip: ['tests/**'] }];
  const line = `see ${'C'}:\\x\\y\n`;
  assert.equal(scanText('tests/a.mjs', line, { patterns: p }).length, 0);
  assert.equal(scanText('scripts/a.mjs', line, { patterns: p }).length, 1);
  assert.deepEqual(drive[0].skip, ['tests/**'], 'the shipped drive-path pattern skips tests/ only');
  assert.ok(manifest.patterns.filter((q) => q.name !== 'windows-drive-path').every((q) => q.skip === undefined));
  assert.ok(!validateManifest({ version: 1, patterns: [{ name: 'x', regex: 'x', skip: ['/abs'] }] }).manifest, 'an absolute skip glob is refused');
  assert.ok(validateManifest({ version: 1, patterns: p }).manifest);
  assert.match(validateLocalPatterns({ patterns: [{ name: 'private-repo-owner', regex: 'x', skip: ['tests/**'] }] }).error ?? '', /skip/);
});

test('the shipped manifest excludes blog/sessions itself', () => {
  assert.ok(manifest.exclude.includes('blog/sessions'), 'blog/sessions is kept out of the mirror only by .gitignore');
});
