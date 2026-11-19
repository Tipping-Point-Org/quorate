// A review.reviews_dir outside the repository grounds a seat (G-9, with its symptoms G-10 and G-2, of
// 20261103-022403-rbr-remediation-8-review): the contract allows reviews_dir under the engine's home
// (lib/reviews-root.mjs reviewsRootAllowed), but isCapturedArtifact matched nothing outside the repository and seatBasis
// sent every citation through the repository-confined resolveCitation, so a capture there never reached `measurement`
// and a grounded panel decision fell below the floor (ARCHITECTURE.md A-22).
// And the default reviews directory has one owner (G-8): decision-panel.mjs spelled '.claude/reviews' itself beside
// lib/reviews-root.mjs's ARCHIVED_REVIEWS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { seatBasis, isCapturedArtifact } from '../scripts/lib/decision-panel.mjs';
import { rootEvidencePath } from '../scripts/lib/evidence-path.mjs';

const IO = hostPlatform();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function layout() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-dir-outside-'));
  const repo = path.join(base, 'repo');
  const home = path.join(base, 'home', 'reviews', 'proj-1');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.mjs'), 'export {};\n');
  const ev = path.join(home, '20261101-000000-r', 'evidence');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'bench.txt'), 'measured: 12 ms\n');
  return { base, repo, home, file: path.join(ev, 'bench.txt') };
}

test('G-9: a capture under a reviews_dir outside the repository grounds a seat', () => {
  const { base, repo, home, file } = layout();
  try {
    const r = seatBasis([file], { evidence: [file], repoRoot: repo, io: IO, reviewsDir: home });
    assert.equal(r.basis, 'measurement', `a capture under the declared out-of-repo reviews_dir was refused: ${JSON.stringify(r.refused)}`);
    const o = { repoRoot: repo, reviewsDir: home, caseInsensitive: IO.caseInsensitiveFs };
    assert.equal(isCapturedArtifact(rootEvidencePath(file, o), o), true, 'isCapturedArtifact matches nothing outside the repository');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('G-9 (guard): outside the repository only a real file in a run\'s evidence/ under the declared directory grounds', () => {
  const { base, repo, home, file } = layout();
  try {
    // Not under evidence/.
    const loose = path.join(home, '20261101-000000-r', 'notes.txt');
    fs.writeFileSync(loose, 'x\n');
    assert.equal(seatBasis([loose], { evidence: [loose], repoRoot: repo, io: IO, reviewsDir: home }).basis, 'convention');
    // Missing.
    assert.equal(seatBasis([path.join(path.dirname(file), 'gone.txt')], { evidence: [path.join(path.dirname(file), 'gone.txt')], repoRoot: repo, io: IO, reviewsDir: home }).basis, 'convention');
    // With no reviews_dir declared, a file outside the repository grounds nothing.
    assert.equal(seatBasis([file], { evidence: [file], repoRoot: repo, io: IO }).basis, 'convention');
    // Reached through a link: refused.
    const lnk = path.join(home, '20261101-000000-r', 'evidence', 'lnk');
    fs.symlinkSync(path.join(repo, 'src'), lnk, 'junction');
    assert.equal(seatBasis([path.join(lnk, 'a.mjs')], { evidence: [path.join(lnk, 'a.mjs')], repoRoot: repo, io: IO, reviewsDir: home }).basis, 'convention',
      'a link under evidence/ to source is not a captured artifact');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('G-8: decision-panel.mjs takes the default reviews directory from its one owner', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'decision-panel.mjs'), 'utf8');
  assert.doesNotMatch(src, /['"`]\.claude\/reviews['"`]/, 'decision-panel.mjs spells .claude/reviews beside ARCHIVED_REVIEWS');
  assert.match(src, /ARCHIVED_REVIEWS/, 'decision-panel.mjs does not read ARCHIVED_REVIEWS from lib/reviews-root.mjs');
});
