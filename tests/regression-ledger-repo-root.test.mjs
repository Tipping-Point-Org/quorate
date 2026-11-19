// G-4 of run 20260925-015614-platform-review (panel-codex-security): findings-ledger resolved WHICH
// ledger to write from the `repo_root` of a caller-chosen run.json, unverified. A run directory whose
// run.json named another tree made the fold create or replace that tree's .claude/reviews/ledger.json.
//
// A run belongs to a repository when it lives where that repository's runs live: its
// .claude/reviews/ (archived), its declared reviews_dir, or the engine's staging root for it. Anything
// else is refused, naming both, and nothing is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runBelongsToRepo } from '../scripts/lib/reviews-root.mjs';

const LEDGER = path.join(import.meta.dirname, '..', 'scripts', 'findings-ledger.mjs');

test('G-4: a run whose run.json names ANOTHER tree does not write that tree\'s ledger', (t) => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ledger-root-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const victim = path.join(tmp, 'victim');
  fs.mkdirSync(victim);
  // The repository is the CALLER's (--repo-root), never the record's (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28):
  // the forged run sits where the caller's runs live, so containment and location admit it, and only its repo_root,
  // naming the other tree, is left to refuse it.
  const caller = path.join(tmp, 'caller');
  const run = path.join(caller, '.claude', 'reviews', '20260101-000000-forged');
  fs.mkdirSync(path.join(run, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: '20260101-000000-forged', repo_root: victim }));
  const r = spawnSync(process.execPath, [LEDGER, '--run-dir', run, '--repo-root', caller], { encoding: 'utf8', timeout: 60_000, cwd: tmp });
  assert.ok(!fs.existsSync(path.join(victim, '.claude', 'reviews', 'ledger.json')), 'the other tree\'s ledger is untouched');
  assert.ok(!fs.existsSync(path.join(caller, '.claude', 'reviews', 'ledger.json')), 'and so is the caller\'s');
  assert.notEqual(r.status, 0, `the fold is refused — stderr: ${r.stderr}`);
  assert.match(r.stderr, /names repo_root .*, not .*, the repository this command runs for/);
});

test('G-4: where a repository\'s runs live', () => {
  const repo = path.resolve('/w/repo');
  const home = path.resolve('/h/.quorate');
  const ok = (runDir, extra = {}) => runBelongsToRepo({ runDir, repoRoot: repo, project: 'repo', home, ...extra }).ok;
  assert.equal(ok(path.join(repo, '.claude', 'reviews', 'r1')), true, 'archived in the repository');
  assert.equal(ok(path.join(home, 'reviews', 'repo-deadbeef', 'r1'), { stagingRoot: path.join(home, 'reviews', 'repo-deadbeef') }), true, 'staged for it');
  assert.equal(ok(path.join(repo, 'custom', 'r1'), { declaredReviewsDir: 'custom' }), true, 'its declared reviews_dir');
  assert.equal(ok(path.resolve('/elsewhere/r1')), false, 'anywhere else is refused');
});

// G-17 of run 20260925-200721-platform-remediated (panel-codex-code, panel-codex-security): the fix
// above still read `reviews_dir` from the SAME run.json it was verifying. A forged run declaring its
// own parent as the reviews directory passed, and wrote the named tree's ledger. Where a repository's
// runs live is that repository's own contract's to say.
test('G-17: a run cannot vouch for itself by declaring its own parent as reviews_dir', (t) => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-ledger-root-')));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const victim = path.join(tmp, 'victim');
  fs.mkdirSync(victim);
  // Inside the CALLER's repository (--repo-root) but outside its run roots, so containment admits it and only the
  // run's self-declared reviews_dir could vouch for it (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
  const caller = path.join(tmp, 'caller');
  const parent = path.join(caller, 'elsewhere');
  const run = path.join(parent, '20260101-000000-forged');
  fs.mkdirSync(path.join(run, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({
    run_id: '20260101-000000-forged', repo_root: victim, contract: { review: { reviews_dir: parent } },
  }));
  const r = spawnSync(process.execPath, [LEDGER, '--run-dir', run, '--repo-root', caller], { encoding: 'utf8', timeout: 60_000, cwd: tmp });
  assert.ok(!fs.existsSync(path.join(victim, '.claude', 'reviews', 'ledger.json')), 'the other tree\'s ledger is untouched');
  assert.ok(!fs.existsSync(path.join(caller, '.claude', 'reviews', 'ledger.json')), 'and so is the caller\'s');
  assert.notEqual(r.status, 0, `the fold is refused — stderr: ${r.stderr}`);
  assert.match(r.stderr, /is not one of .*'s runs: it is in none of/);
});
