// A reviewed run that cannot prove a clean review is counted and said, never dropped in silence
// (usage-report-reviewed-runs.plan.md stage 2; U-D2 A).
//
// G-6 and G-14 of 20261030-221015-usage-report-99-review: a run recorded dirty, or recording no dirty flag, credits no
// commit (lib/reviewed-run.mjs creditsHead), and the report dropped both without counting them, then printed "reviewed
// AT that commit" bare. The figure counts only commits a clean run proves, so while such runs exist it is unverified, and
// the report says how many there are and labels the figure.
//
// The script locates the repository from its own path, so it runs here from a copy of scripts/ inside a fixture repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

function fixture(runs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-report-unproven-'));
  fs.cpSync(path.join(REPO_ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a],
    { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'one');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const reviews = path.join(dir, '.claude', 'reviews');
  for (const [id, extra] of Object.entries(runs)) {
    fs.mkdirSync(path.join(reviews, id), { recursive: true });
    fs.writeFileSync(path.join(reviews, id, 'run.json'), JSON.stringify({ run_id: id, head_commit: head, scope: { paths: ['a.txt'] }, ...extra }));
    fs.writeFileSync(path.join(reviews, id, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  }
  return dir;
}

const run = (dir, json) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'usage-report.mjs'), ...(json ? ['--json'] : []),
  '--since', '2000-01-01'], { cwd: dir, encoding: 'utf8' });

test('dirty and unflagged reviewed runs are counted, and the reviewed-at figure is labelled unverified', () => {
  const dir = fixture({ clean: { dirty: false }, dirty: { dirty: true }, unflagged: {} });
  try {
    const r = run(dir, true);
    assert.equal(r.status, 0, r.stderr);
    const rep = JSON.parse(r.stdout);
    assert.equal(rep.commits.reviewed_at_that_commit, 1, 'the clean run proves its commit');
    assert.deepEqual(rep.coverage, { dirty_runs: 1, dirty_unknown_runs: 1, reviewed_at_that_commit: 'unverified' });
    const text = run(dir, false);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /reviewed AT that commit .*unverified/);
    assert.match(text.stdout, /dirty when reviewed +1/);
    assert.match(text.stdout, /no dirty flag recorded +1/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('with only clean reviewed runs, the figure is proven and no label is printed', () => {
  const dir = fixture({ clean: { dirty: false } });
  try {
    const rep = JSON.parse(run(dir, true).stdout);
    assert.deepEqual(rep.coverage, { dirty_runs: 0, dirty_unknown_runs: 0, reviewed_at_that_commit: 'proven' });
    assert.doesNotMatch(run(dir, false).stdout, /unverified/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
