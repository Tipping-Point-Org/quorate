// regression-caller-repo-spelling-kept.test.mjs — G-5 of 20261118-112631-cpi-review.
//
// callerRepoRoot returns the repository on its real path (ci-path-identity.plan.md stage 1c), so repoRunRoots, handed
// only that, never derived the key of the links-kept spelling. A run staged before stage 1c under a --repo-root spelled
// through a link above the repository (macOS's /var) was orphaned: admitRun refused it as none of this repository's
// runs, the failure I-8 of the plan names. The spelling the caller gave is now asked too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callerRepoRoot, admitRun, repoRunRoots, runBelongsToRepo } from '../scripts/io/reviews-root.mjs';
import { defaultReviewsRoot as pureDefaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';

const LINK = process.platform === 'win32' ? 'junction' : 'dir';

test('a run staged under the key of a link-spelled --repo-root is still admitted for that repository (G-5)', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-caller-spelling-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'real', 'repo'), { recursive: true });
  fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'), LINK);
  const home = path.join(base, 'home');
  const given = path.join(base, 'link', 'repo');
  // Where a mint before stage 1c staged it: keyed by the repository as given, links kept.
  const staging = pureDefaultReviewsRoot({ project: 'p', repoRoot: given, home });
  const runId = '20261118-000000-old';
  const run = path.join(staging, runId);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: runId }));
  const repoRoot = callerRepoRoot(given);
  const r = admitRun({ runDir: run, repoRoot, project: 'p', declaredReviewsDir: null, home });
  assert.equal(r.ok, true, `${r.check}: ${r.why}`);
});

// G-3 (G-4 its symptom) of 20261118-131040-cpi-remediation-review: the spelling was threaded through admitRun alone, so
// the owner of the run-root list, repoRunRoots, which telemetry, citation and archival enumeration call directly, never
// listed the old key's staging root, and those runs went unseen by everything but admission.
test('repoRunRoots lists the staging root of the link-spelled --repo-root the caller gave (G-3)', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-caller-roots-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'real', 'repo'), { recursive: true });
  fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'), LINK);
  const home = path.join(base, 'home');
  const given = path.join(base, 'link', 'repo');
  const staging = pureDefaultReviewsRoot({ project: 'p', repoRoot: given, home });
  fs.mkdirSync(staging, { recursive: true });
  const repoRoot = callerRepoRoot(given);
  const roots = repoRunRoots({ repoRoot, project: 'p', home });
  const fold = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  assert.ok(roots.map(fold).includes(fold(staging)), `${staging} is in none of ${roots.join(', ')}`);
  // And a spelling of ANOTHER repository adds nothing (only this repository's spellings count).
  fs.mkdirSync(path.join(base, 'real', 'other'), { recursive: true });
  const otherKey = pureDefaultReviewsRoot({ project: 'p', repoRoot: path.join(base, 'link', 'other'), home });
  const withOther = repoRunRoots({ repoRoot, project: 'p', home, repoSpellings: [path.join(base, 'link', 'other')] });
  assert.equal(withOther.map(fold).includes(fold(otherKey)), false);
});

test('runBelongsToRepo answers from the same list: a run under the link-spelled key belongs (G-3)', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-caller-belongs-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'real', 'repo'), { recursive: true });
  fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'), LINK);
  const home = path.join(base, 'home');
  const given = path.join(base, 'link', 'repo');
  const run = path.join(pureDefaultReviewsRoot({ project: 'p', repoRoot: given, home }), '20261118-000000-old');
  fs.mkdirSync(run, { recursive: true });
  const r = runBelongsToRepo({ runDir: run, repoRoot: callerRepoRoot(given), project: 'p', home });
  assert.equal(r.ok, true, r.why);
});
