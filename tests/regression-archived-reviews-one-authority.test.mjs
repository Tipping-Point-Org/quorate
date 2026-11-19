// regression-archived-reviews-one-authority.test.mjs — G-10 of 20261023-014400-rdt-delivery.
//
// lib/reviews-root.mjs exports ARCHIVED_REVIEWS and archivedReviewsDir, the one spelling of where a repository keeps its
// archived runs, and then rebuilt `.claude/reviews` as a literal in archivePlan and panelMirrorExclusions, as new-run's
// archive_to and bench-lenses' fallback did. Copies of one authority drift apart: archive validation, the destination
// and the panel's exclusions could disagree. The files this review covered spell it through the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { archivePlan, archivedReviewsDir } from '../scripts/lib/reviews-root.mjs';

test('no copy of the archived-reviews path outside its owner, in the files the review covered', () => {
  const literal = /'\.claude',\s*'reviews'/;
  for (const f of ['lib/reviews-root.mjs', 'new-run.mjs', 'bench-lenses.mjs']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', f), 'utf8');
    const lines = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => literal.test(l)).map(([n, l]) => `${f}:${n}: ${l.trim()}`);
    assert.deepEqual(lines, [], 'the path is rebuilt as a literal rather than taken from archivedReviewsDir');
  }
});

test('archivePlan accepts exactly the owner\'s directory', () => {
  const repo = path.resolve(REPO_ROOT, '..', 'some-repo');
  const plan = archivePlan({ runDir: path.join(repo, 'x', '20260101-000000-r'), archiveTo: archivedReviewsDir(repo), repoRoot: repo,
    realpath: (p) => p });
  assert.equal(plan.ok, true, plan.why);
});
