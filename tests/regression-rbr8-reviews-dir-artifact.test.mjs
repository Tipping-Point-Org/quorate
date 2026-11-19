// A captured artifact is a file in a run's evidence/ under the reviews directory the contract declares, not only under
// .claude/reviews (G-11 of 20261103-005954-rbr-remediation-7-review): CAPTURED_ARTIFACT was fixed to .claude/reviews, so a
// project declaring review.reviews_dir had every real capture under it graded `convention`, and a grounded panel decision
// could never meet the floor (ARCHITECTURE.md A-22).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostPlatform } from '../scripts/platform/index.mjs';
import { seatBasis } from '../scripts/lib/decision-panel.mjs';

const IO = hostPlatform();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-dir-artifact-'));
  for (const dir of [['reviews', '20261101-000000-r', 'evidence'], ['.claude', 'reviews', '20261101-000000-r', 'evidence']]) {
    fs.mkdirSync(path.join(root, ...dir), { recursive: true });
    fs.writeFileSync(path.join(root, ...dir, 'bench.txt'), 'measured: 12 ms\n');
  }
  return root;
}

test('G-11: a capture under a declared reviews_dir grounds a seat', () => {
  const root = repo();
  try {
    const r = seatBasis(['reviews/20261101-000000-r/evidence/bench.txt'], { evidence: ['reviews/20261101-000000-r/evidence/bench.txt'], repoRoot: root, io: IO, reviewsDir: 'reviews' });
    assert.equal(r.basis, 'measurement', `a capture under the declared reviews_dir was refused: ${JSON.stringify(r.refused)}`);
    const abs = seatBasis(['reviews/20261101-000000-r/evidence/bench.txt'], { evidence: ['reviews/20261101-000000-r/evidence/bench.txt'], repoRoot: root, io: IO, reviewsDir: path.join(root, 'reviews') });
    assert.equal(abs.basis, 'measurement', 'an absolute reviews_dir inside the repository is not read as that directory');
    assert.equal(seatBasis(['.claude/reviews/20261101-000000-r/evidence/bench.txt'], { evidence: ['.claude/reviews/20261101-000000-r/evidence/bench.txt'], repoRoot: root, io: IO }).basis, 'measurement',
      'with no reviews_dir the default .claude/reviews still grounds');
    assert.equal(seatBasis(['reviews/20261101-000000-r/evidence/bench.txt'], { evidence: ['reviews/20261101-000000-r/evidence/bench.txt'], repoRoot: root, io: IO }).basis, 'convention',
      'with no reviews_dir a directory merely named reviews grounds a seat');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('G-11: decide.mjs hands seatBasis the contract\'s reviews_dir', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'decide.mjs'), 'utf8');
  assert.match(src, /seatBasis\(citations,\s*\{[^}]*reviewsDir:\s*review\.reviews_dir/, 'decide.mjs grades seats against .claude/reviews whatever the contract declares');
});
