// G-1 of 20261105-074139-crsf-remediation-3-review: archive-run's citation search listed each run root raw and confined
// only each child run, so a link or junction standing at the reviews root was followed and the run.json files beyond it
// were read into the decision whether the run may be deleted. The root is now listed through an owner walked from the
// repository (or quorate's home), and a link there is named unread, with no all-clear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';
import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';

const write = (dir, rec, files = {}) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(rec));
  for (const [n, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), body);
};

test('G-1: a junction at the reviews root is not followed into the citation search', (t) => {
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'q-crsf4b-cite-'));
  t.after(() => fs.rmSync(b, { recursive: true, force: true }));
  const repo = path.join(b, 'repo');
  const home = path.join(b, 'home');
  // Inside the repository: a root whose real path leaves it is already dropped by repoRunRoots, so the link that reached
  // the raw listing is one that stays inside, and A-30 refuses a link standing below the root all the same.
  const outside = path.join(repo, 'elsewhere');
  fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
  write(path.join(outside, '20260920-070634-citer'), { run_id: '20260920-070634-citer', checks_reused_from: '20260920-065201-dead' }, { 'gate.json': '{}' });
  const reviews = path.join(repo, '.claude', 'reviews');
  fs.symlinkSync(outside, reviews, process.platform === 'win32' ? 'junction' : 'dir');
  const dead = '20260920-065201-dead';
  const staging = defaultReviewsRoot({ project: null, repoRoot: fs.realpathSync.native(repo), home });
  write(path.join(staging, dead), { run_id: dead, repo_root: repo, archive_to: reviews });
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', path.join(staging, dead)], { env: { QUORATE_HOME: home } });
  assert.equal(r.status, 1, r.output);
  assert.doesNotMatch(r.output, /20260920-070634-citer/, `a run.json beyond the junction was read: ${r.output}`);
  assert.match(r.output, /could not read/, r.output);
  assert.doesNotMatch(r.output, /cited by no review/);
});
