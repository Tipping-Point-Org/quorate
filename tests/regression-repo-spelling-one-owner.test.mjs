// regression-repo-spelling-one-owner.test.mjs — G-6 and G-3 of 20261118-142344-cpi-remediation-2-review.
//
// G-6: repoRunRoots decided whether a caller's other spelling names this repository by rootSpelling, which keeps a link
// at the final component, while admitRun decided it on the whole real path. A spelling whose last name is itself a link
// to the repository was admitted by admitRun and dropped by repoRunRoots, so telemetry, citation and archival
// enumeration missed runs admission accepted. One owner (sameRepoSpellings) now decides it for both.
//
// G-3: callerRepoRoot remembered the spelling it was given in a case-sensitive Map, keyed with the caller's casing of the
// last name, so on a case-insensitive filesystem the same repository asked with another casing missed it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callerRepoRoot, admitRun, repoRunRoots } from '../scripts/io/reviews-root.mjs';
import { defaultReviewsRoot as pureDefaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';

const LINK = process.platform === 'win32' ? 'junction' : 'dir';
const fold = (s) => (process.platform === 'win32' || process.platform === 'darwin' ? s.toLowerCase() : s);

test('a spelling whose last name is a link to the repository is enumerated wherever admitRun admits it (G-6)', (t) => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-spelling-owner-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'real', 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const alias = path.join(base, 'alias');
  fs.symlinkSync(repo, alias, LINK);
  const home = path.join(base, 'home');
  const staging = pureDefaultReviewsRoot({ project: 'p', repoRoot: alias, home });
  const runId = '20261118-000000-alias';
  const run = path.join(staging, runId);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: runId }));
  const admitted = admitRun({ runDir: run, repoRoot: repo, project: 'p', declaredReviewsDir: null, home, repoSpellings: [alias] });
  assert.equal(admitted.ok, true, `${admitted.check}: ${admitted.why}`);
  const roots = repoRunRoots({ repoRoot: repo, project: 'p', home, repoSpellings: [alias] });
  assert.ok(roots.map(fold).includes(fold(staging)), `admitRun admits a run under ${staging}, which is in none of ${roots.join(', ')}`);
});

test('the remembered spelling is found whatever the casing of the repository\'s last name, where case is ignored (G-3)', (t) => {
  if (process.platform !== 'win32') { t.skip('needs a case-insensitive filesystem'); return; }
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-spelling-case-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'real', 'repo'), { recursive: true });
  fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'), LINK);
  const home = path.join(base, 'home');
  const given = path.join(base, 'link', 'Repo');
  const staging = pureDefaultReviewsRoot({ project: 'p', repoRoot: given, home });
  fs.mkdirSync(staging, { recursive: true });
  callerRepoRoot(given);
  const roots = repoRunRoots({ repoRoot: path.join(base, 'real', 'repo'), project: 'p', home });
  assert.ok(roots.map(fold).includes(fold(staging)), `${staging} is in none of ${roots.join(', ')}`);
});

test('admitRun asks the remembered spelling by the same rule, whatever the casing (G-3)', (t) => {
  if (process.platform !== 'win32') { t.skip('needs a case-insensitive filesystem'); return; }
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-spelling-admit-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'real', 'repo'), { recursive: true });
  fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'), LINK);
  const home = path.join(base, 'home');
  const given = path.join(base, 'link', 'Repo');
  const runId = '20261118-000000-cased';
  const run = path.join(pureDefaultReviewsRoot({ project: 'p', repoRoot: given, home }), runId);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: runId }));
  callerRepoRoot(given);
  const r = admitRun({ runDir: run, repoRoot: path.join(base, 'real', 'repo'), project: 'p', declaredReviewsDir: null, home });
  assert.equal(r.ok, true, `${r.check}: ${r.why}`);
});
