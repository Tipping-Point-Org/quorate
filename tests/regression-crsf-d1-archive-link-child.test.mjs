// G-3 of 20261105-163851-crsf-d1-review: archive-run's citation search listed each run root through its owner and then
// kept only entries whose Dirent is a directory, so a junction or symlink CHILD run below a real root was dropped with
// nothing recorded, and the refusal said "cited by no review" right before evidence might be deleted. A link child is now
// named unread, and no all-clear is given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';
import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';

const write = (dir, rec) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(rec));
};

test('G-3: a junction child run below a real reviews root is named unread, never skipped', (t) => {
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'q-crsfd1-cite-'));
  t.after(() => fs.rmSync(b, { recursive: true, force: true }));
  const repo = path.join(b, 'repo');
  const home = path.join(b, 'home');
  const reviews = path.join(repo, '.claude', 'reviews');
  fs.mkdirSync(reviews, { recursive: true });
  const dead = '20260920-065201-dead';
  const target = path.join(repo, 'elsewhere', 'citer');
  write(target, { run_id: '20260920-070634-citer', checks_reused_from: dead });
  fs.symlinkSync(target, path.join(reviews, '20260920-070634-citer'), process.platform === 'win32' ? 'junction' : 'dir');
  const staging = defaultReviewsRoot({ project: null, repoRoot: fs.realpathSync.native(repo), home });
  write(path.join(staging, dead), { run_id: dead, repo_root: repo, archive_to: reviews });
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', path.join(staging, dead)], { env: { QUORATE_HOME: home } });
  assert.equal(r.status, 1, r.output);
  assert.doesNotMatch(r.output, /cited by no review/, `a linked child run was skipped unseen: ${r.output}`);
  assert.match(r.output, /could not read .*20260920-070634-citer/, r.output);
});
