// With review.reviews_dir undeclared, a capture from a LIVE run, staged under the engine's home (defaultReviewsRoot), grounds
// a seat as an archived one does (G-6 of 20261103-040939-rbr-remediation-9-review; ARCHITECTURE.md A-22): the fallback
// knew only .claude/reviews, so a panel decision citing evidence from the run in progress was demoted to convention and
// sent to the operator although the capture existed.
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

test('G-6: undeclared, a capture under the staging root grounds; declared, only the declared directory does', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-grounds-'));
  const root = path.join(base, 'repo');
  const staging = path.join(base, 'home', 'reviews', 'proj-1234');
  try {
    fs.mkdirSync(root, { recursive: true });
    const ev = path.join(staging, '20261103-000000-r', 'evidence');
    fs.mkdirSync(ev, { recursive: true });
    fs.writeFileSync(path.join(ev, 'bench.txt'), 'measured: 12 ms\n');
    const cite = [path.join(ev, 'bench.txt')];
    const r = seatBasis(cite, { evidence: cite, repoRoot: root, io: IO, stagingRoot: staging });
    assert.equal(r.basis, 'measurement', `a live default run's capture was refused: ${JSON.stringify(r.refused)}`);
    const o = { repoRoot: root, stagingRoot: staging, caseInsensitive: IO.caseInsensitiveFs };
    assert.equal(isCapturedArtifact(rootEvidencePath(cite[0], o), o), true);
    assert.equal(seatBasis(cite, { evidence: cite, repoRoot: root, io: IO, reviewsDir: 'reviews', stagingRoot: staging }).basis, 'convention',
      'a declared reviews_dir is the one place; the staging root must not widen it');
    assert.equal(seatBasis(cite, { evidence: cite, repoRoot: root, io: IO }).basis, 'convention', 'with no staging root given, nothing outside the repository grounds');
    assert.equal(seatBasis([path.join(staging, 'bench.txt')], { evidence: [path.join(staging, 'bench.txt')], repoRoot: root, io: IO, stagingRoot: staging }).basis, 'convention',
      'a file under the staging root but in no run\'s evidence/ grounds a seat');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('G-6: decide.mjs passes the default staging root when reviews_dir is undeclared', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'decide.mjs'), 'utf8');
  assert.match(src, /defaultReviewsRoot\(/, 'decide.mjs never computes where a live default run is staged');
  assert.match(src, /seatBasis\(citations,\s*\{[^}]*stagingRoot/, 'decide.mjs does not hand seatBasis the staging root');
});
