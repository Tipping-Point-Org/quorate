// G-7 and G-6 of 20261104-072059-epo-remediation-review, both in lib/evidence-path.mjs's reading of a root.
// G-7: reviewRoots left the repository root out by a case-sensitive string comparison, while every containment after it
// folds, so on a case-insensitive host a reviews_dir spelling the repository root in other case survived, and an ordinary
// repository file below <x>/evidence/ was graded a captured artifact outside the repository.
// G-6: absoluteSegments dropped the empty segments of a UNC spelling, so \\server\share\... came back as /server/share/...,
// a different place, and a confined lookup targeted the wrong root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rootEvidencePath, reviewRoots, runEvidencePath } from '../scripts/lib/evidence-path.mjs';
import { isCapturedArtifact } from '../scripts/lib/decision-panel.mjs';

const REPO = 'F:/work/repo';

test('G-7: reviewRoots leaves out the repository root in any letter case the platform folds', () => {
  assert.deepEqual(reviewRoots({ repoRoot: REPO, reviewsDir: 'f:/WORK/Repo', caseInsensitive: true }), []);
  // Case-sensitive, the other spelling is another directory, and stays a root.
  assert.deepEqual(reviewRoots({ repoRoot: '/srv/repo', reviewsDir: '/srv/Repo', caseInsensitive: false }), ['/srv/Repo']);
  assert.throws(() => reviewRoots({ repoRoot: REPO, reviewsDir: 'F:/elsewhere' }), /caseInsensitive/);
});

// isCapturedArtifact makes its root absolute by the HOST's rule (lib/paths.mjs absolute), and `F:/work/repo` is not
// absolute on POSIX, so this case spells the repository in the host's absolute form. The letter-case rule under test is
// the caseInsensitive parameter, not the filesystem, so it holds on every host (CI, ubuntu: "an absolute path is required").
const HOST_REPO = process.platform === 'win32' ? REPO : '/work/repo';
test('G-7: a repository file is not graded an outside capture through a reviews_dir naming the repository in other case', () => {
  const cited = `${HOST_REPO}/notes/evidence/a.txt`;
  const other = HOST_REPO.toUpperCase();
  const r = rootEvidencePath(cited, { repoRoot: HOST_REPO, reviewsDir: other, caseInsensitive: true });
  assert.equal(r.inRepo, true, JSON.stringify(r));
  assert.equal(r.canonical, 'notes/evidence/a.txt');
  assert.equal(isCapturedArtifact(r, { repoRoot: HOST_REPO, reviewsDir: other, caseInsensitive: true }), false);
});

// G-4 of the same review: isCapturedArtifact folded and tested `<run>/evidence/` containment itself after calling the
// owner, a second owner of the boundary rule. The rule is the owner's (isRunEvidence); the panel asks it.
test('G-4: the run-evidence containment rule has one owner, and the panel delegates to it', async () => {
  const owner = await import('../scripts/lib/evidence-path.mjs');
  assert.equal(typeof owner.isRunEvidence, 'function', 'lib/evidence-path.mjs owns no run-evidence rule');
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../scripts/lib/decision-panel.mjs', import.meta.url), 'utf8');
  const start = src.indexOf('export function isCapturedArtifact(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.doesNotMatch(body, /startsWith|\\\/evidence\\\/|reviewRoots\(/, 'isCapturedArtifact restates the containment rule');
  assert.match(body, /isRunEvidence\(/);
  const o = { repoRoot: REPO, caseInsensitive: true };
  const at = (p) => owner.isRunEvidence(rootEvidencePath(p, o), o);
  assert.equal(at('.claude/reviews/20261101-000000-r/evidence/x.txt'), true);
  assert.equal(at('.CLAUDE/Reviews/20261101-000000-r/EVIDENCE/x.txt'), true);
  assert.equal(at('.claude/reviews/20261101-000000-r/evidence'), false, 'the evidence folder itself is not a capture');
  assert.equal(at('.claude/reviews/20261101-000000-r/nodes/x.txt'), false);
  assert.equal(at('notes/evidence/x.txt'), false);
  assert.equal(owner.isRunEvidence(rootEvidencePath('.claude/reviews/r/EVIDENCE/x.txt', { ...o, caseInsensitive: false }), { ...o, caseInsensitive: false }), false);
});

test('G-6: a UNC root keeps its leading // through normalization', () => {
  const repo = '\\\\server\\share\\repo';
  const staging = '\\\\server\\share\\home\\.quorate\\reviews\\repo-1';
  assert.deepEqual(reviewRoots({ repoRoot: repo, stagingRoot: staging, caseInsensitive: true }),
    ['//server/share/repo/.claude/reviews', '//server/share/home/.quorate/reviews/repo-1']);
  const out = rootEvidencePath(`${staging}\\r\\evidence\\a.txt`, { repoRoot: repo, stagingRoot: staging, caseInsensitive: true });
  assert.equal(out.root, '//server/share/home/.quorate/reviews/repo-1', JSON.stringify(out));
  assert.equal(out.abs, '//server/share/home/.quorate/reviews/repo-1/r/evidence/a.txt');
  const inside = rootEvidencePath('docs/a.txt', { repoRoot: repo, caseInsensitive: true });
  assert.equal(inside.abs, '//server/share/repo/docs/a.txt');
  assert.equal(inside.root, '//server/share/repo');
  // A POSIX /server/share/... is another place than the UNC share.
  assert.ok(rootEvidencePath('/server/share/repo/docs/a.txt', { repoRoot: repo, caseInsensitive: true }).refused);
  // And a capture cited by a UNC run directory is found below it.
  const run = '\\\\server\\share\\home\\.quorate\\reviews\\repo-1\\20261104-000000-r';
  assert.equal(runEvidencePath(`${run}\\evidence\\remediation\\g.txt`, { runDir: run, caseInsensitive: true }).path, 'evidence/remediation/g.txt');
  assert.ok(runEvidencePath(`/server/share/home/.quorate/reviews/repo-1/20261104-000000-r/evidence/remediation/g.txt`, { runDir: run, caseInsensitive: true }).refused);
});
