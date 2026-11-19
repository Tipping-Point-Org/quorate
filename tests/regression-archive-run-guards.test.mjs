// THE REMEDIATION OF 20261015-230146-archive-fold-remediation-review, archive-run.mjs's half: G-1 (a --run-dir taken on
// trust, so a crafted run outside every run root was moved and its source removed) and G-2 (the "already in place" exit
// ran before the end-of-run checks, so a live or unfinished run exited 0).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';
// Every invocation names the fixture repository with --repo-root: a run is admitted only for the repository the command
// runs for, never the one its record names (ARCHITECTURE A-28; run-dir-trust.plan.md stage 2).
import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';

function base(t) {
  // As the filesystem spells it: the refusals name the roots they searched in the engine's spelling, which is long where
  // a Windows runner's TEMP is an 8.3 short path (CI run 43281517496).
  const b = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-archive-guard-')));
  t.after(() => fs.rmSync(b, { recursive: true, force: true }));
  return b;
}
const write = (dir, rec, files = {}) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(rec));
  for (const [n, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), body);
};

// G-1: a run in a folder that is none of its repository's run roots is refused, and nothing of it is removed.
test('G-1: a run outside every run root of the repository its record names is refused and left whole', (t) => {
  const b = base(t);
  const repo = path.join(b, 'repo');
  const reviews = path.join(repo, '.claude', 'reviews');
  fs.mkdirSync(reviews, { recursive: true });
  const runId = '20261015-000000-crafted';
  const dir = path.join(b, 'elsewhere', runId);
  write(dir, { run_id: runId, repo_root: repo, archive_to: reviews }, { 'gate.json': '{"gate":"RISK"}' });
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', dir], { env: { QUORATE_HOME: path.join(b, 'home') } });
  assert.equal(r.status, 1, r.output);
  // Outside the repository it is run for and the engine's home: refused by containment (ARCHITECTURE A-28).
  assert.match(r.output, /neither inside the repository under review/);
  assert.ok(fs.existsSync(path.join(dir, 'run.json')), 'the source is untouched');
  assert.equal(fs.existsSync(path.join(reviews, runId)), false, 'nothing was moved in');
});

// G-1: a directory whose name is not the run id its record carries is not that run.
test('G-1: a run whose directory name is not its run_id is refused', (t) => {
  const b = base(t);
  const repo = path.join(b, 'repo');
  const dir = path.join(repo, '.claude', 'reviews', '20261015-000000-other');
  write(dir, { run_id: '20261015-000000-named', repo_root: repo }, { 'gate.json': '{"gate":"RISK"}' });
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', dir]);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /run_id/);
});

// G-1 of 20261016-204040-sp-bugs-remediation-review: the run was validated on its real path, but everything after —
// "already in place", the lock and gate checks, the move — used the --run-dir alias. A link inside archive_to pointing at
// a staged run was answered "already in place", exit 0, and the run was never moved.
test('G-1 (r2): a link in archive_to to a staged run is judged by the run it reaches, not reported in place', (t) => {
  const b = base(t);
  const repo = path.join(b, 'repo');
  const home = path.join(b, 'home');
  const reviews = path.join(repo, '.claude', 'reviews');
  fs.mkdirSync(reviews, { recursive: true });
  const runId = '20261016-000000-aliased';
  const staging = defaultReviewsRoot({ project: null, repoRoot: fs.realpathSync.native(repo), home });
  const staged = path.join(staging, runId);
  write(staged, { run_id: runId, repo_root: repo, archive_to: reviews }, { 'gate.json': '{"gate":"RISK"}' });
  const alias = path.join(reviews, runId);
  fs.symlinkSync(staged, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', alias], { env: { QUORATE_HOME: home } });
  assert.doesNotMatch(r.output, /already in place/, `the alias is not the run: ${r.output}`);
  assert.ok(fs.existsSync(path.join(staged, 'run.json')), 'the staged run is untouched');
});

// G-2 of 20261016-214749-sp-bugs-remediation-2-review: the r2 fix made runDir the real path, but inArchive compared its
// parent with archive_to as recorded, never resolved. A repository reached through a link recorded archive_to through
// it, so an archived run was no longer "in place" and was sent to be moved onto itself.
test('G-2 (r3): an ended run in archive_to, recorded through a link to the repository, is already in place', (t) => {
  const b = base(t);
  const real = path.join(b, 'real-repo');
  const link = path.join(b, 'link-repo');
  fs.mkdirSync(path.join(real, '.claude', 'reviews'), { recursive: true });
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  const runId = '20261016-000001-linked';
  const reviews = path.join(link, '.claude', 'reviews');
  write(path.join(reviews, runId), { run_id: runId, repo_root: link, archive_to: reviews }, { 'gate.json': '{"gate":"RISK"}' });
  const r = runScript('archive-run.mjs', ['--repo-root', link, '--run-dir', path.join(reviews, runId)], { env: { QUORATE_HOME: path.join(b, 'home') } });
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /already in place/);
  assert.ok(fs.existsSync(path.join(real, '.claude', 'reviews', runId, 'run.json')), 'the run is where it was');
});


// G-2: "already in place" was answered before "has it ended", so an unfinished run exited 0.
test('G-2: an unfinished review already in place is refused, not reported in place', (t) => {
  const b = base(t);
  const repo = path.join(b, 'repo');
  const reviews = path.join(repo, '.claude', 'reviews');
  for (const [runId, rec] of [['20261015-000001-no-archive', {}], ['20261015-000002-in-archive', { archive_to: reviews }]]) {
    const dir = path.join(reviews, runId);
    write(dir, { run_id: runId, repo_root: repo, ...rec });
    const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', dir]);
    assert.equal(r.status, 1, `${runId}: ${r.output}`);
    assert.match(r.output, /has not ended/);
  }
});

test('G-2: a remediation holding its lock, already in place, is refused', (t) => {
  const b = base(t);
  const repo = path.join(b, 'repo');
  const runId = '20261015-000003-locked';
  const dir = path.join(repo, '.claude', 'reviews', runId);
  write(dir, { run_id: runId, repo_root: repo, remediates: '20261015-000000-v' }, { 'remediate.lock': '{}' });
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', dir]);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /remediate\.lock/);
});

// A REFUSAL THAT INVITES DELETION (story-pipeline, 2026-10-16; operator: "Treat it as a bug"): a review with no gate.json
// was refused "for --resume" only. Another review may cite it as the source of its reused pre-flight
// (checks_reused_from) or intent (intent_reused_from), and a reader of the refusal deleted evidence a tracked gate
// depends on. The refusal now names every review that cites it, and where it looked.
test('the refusal of a run with no gate.json names the reviews that cite it, and where it searched', (t) => {
  const b = base(t);
  const repo = path.join(b, 'repo');
  const reviews = path.join(repo, '.claude', 'reviews');
  const dead = '20260920-065201-dead';
  write(path.join(reviews, dead), { run_id: dead, repo_root: repo, archive_to: reviews });
  write(path.join(reviews, '20260920-070634-citer'), { run_id: '20260920-070634-citer', checks_reused_from: dead }, { 'gate.json': '{}' });
  write(path.join(reviews, '20260921-000000-intent'), { run_id: '20260921-000000-intent', intent_reused_from: dead }, { 'gate.json': '{}' });
  write(path.join(reviews, '20260922-000000-other'), { run_id: '20260922-000000-other', checks_reused_from: 'x' }, { 'gate.json': '{}' });
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', path.join(reviews, dead)]);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /20260920-070634-citer \(checks_reused_from\)/);
  assert.match(r.output, /20260921-000000-intent \(intent_reused_from\)/);
  assert.doesNotMatch(r.output, /20260922-000000-other/);
  assert.match(r.output, /searched/);
  assert.ok(r.output.includes(reviews), `names the root it searched: ${r.output}`);
});

// G-2 of 20261016-193355-sp-bugs-review: citations() listed the run roots without quorate's home, so the staging root —
// where every unarchived run lives — was never searched, and a staged review citing this run was reported as none.
test('G-2: a staged review that cites the run is found in the staging root, and that root is named as searched', (t) => {
  const b = base(t);
  const repo = path.join(b, 'repo');
  const home = path.join(b, 'home');
  const reviews = path.join(repo, '.claude', 'reviews');
  const dead = '20260920-065201-dead';
  write(path.join(reviews, dead), { run_id: dead, repo_root: repo, archive_to: reviews });
  const staging = defaultReviewsRoot({ project: null, repoRoot: fs.realpathSync.native(repo), home });
  write(path.join(staging, '20260920-070634-staged'), { run_id: '20260920-070634-staged', checks_reused_from: dead });
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', path.join(reviews, dead)], { env: { QUORATE_HOME: home } });
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /20260920-070634-staged \(checks_reused_from\)/);
  assert.ok(r.output.includes(staging), `names the staging root as searched: ${r.output}`);
});

// G-3 of 20261016-193355-sp-bugs-review: a root it could not list, or a run.json it could not parse, was skipped in
// silence, and the refusal still said "cited by no review" and named that root as searched.
test('G-3: a root it cannot list is named as unread, and no all-clear is given', (t) => {
  const b = base(t);
  const repo = path.join(b, 'repo');
  const home = path.join(b, 'home');
  const reviews = path.join(repo, '.claude', 'reviews');
  const dead = '20260920-065201-dead';
  write(path.join(reviews, dead), { run_id: dead, repo_root: repo, archive_to: reviews });
  const staging = defaultReviewsRoot({ project: null, repoRoot: fs.realpathSync.native(repo), home });
  fs.mkdirSync(path.dirname(staging), { recursive: true });
  fs.writeFileSync(staging, 'not a directory');
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', path.join(reviews, dead)], { env: { QUORATE_HOME: home } });
  assert.equal(r.status, 1, r.output);
  assert.doesNotMatch(r.output, /cited by no review/);
  assert.match(r.output, /could not read/);
  assert.ok(r.output.includes(staging), `names the root it could not read: ${r.output}`);
});

test('G-3: a run.json it cannot parse is named as unread, and no all-clear is given', (t) => {
  const b = base(t);
  const repo = path.join(b, 'repo');
  const reviews = path.join(repo, '.claude', 'reviews');
  const dead = '20260920-065201-dead';
  write(path.join(reviews, dead), { run_id: dead, repo_root: repo, archive_to: reviews });
  const torn = path.join(reviews, '20260920-070634-torn');
  fs.mkdirSync(torn, { recursive: true });
  fs.writeFileSync(path.join(torn, 'run.json'), '{"run_id": "20260920-070634-torn", "checks_reused_fr');
  fs.mkdirSync(path.join(reviews, 'not-a-run'), { recursive: true });
  const r = runScript('archive-run.mjs', ['--repo-root', repo, '--run-dir', path.join(reviews, dead)]);
  assert.equal(r.status, 1, r.output);
  assert.doesNotMatch(r.output, /cited by no review/);
  assert.match(r.output, /could not read/);
  assert.ok(r.output.includes(path.join(torn, 'run.json')) || r.output.includes(torn), `names the record: ${r.output}`);
  assert.doesNotMatch(r.output, /not-a-run/, 'a folder with no run.json is not a run, and is not unread');
});
