// RUNS WROTE INSIDE THE REPOSITORY THEY WERE REVIEWING.
//
// `.claude/reviews/` sits in the tree under review, so four separate places had to remember to
// EXCLUDE the run directory from something: the tree hash at mint, the tree hash at the gate, the
// working-tree mirror into the arms' checkout, and the intent sandbox. Two defects came from exactly
// that class — `mirrorWorkingTree` copied the LIVE run directory into the tree the external
// reviewers read, and `worktreeSha` reported every run's own tree as moved. Every exclusion is a
// place to forget, and the class only disappears when the writes leave the tree.
//
// THE BOUND MOVES, IT DOES NOT VANISH, and that is the part worth testing. `review.reviews_dir` is
// read from the CLAUDE.md of whatever tree the engine is pointed at. Confining it to the repository
// root had already been defeated three times — an absolute value, a `..`, and a junction that made a
// nonexistent directory resolve out of the tree (G-16, G-34, G-32). Unbounded it could name any
// directory on the machine, which is the path traversal the threat model puts in scope. So the
// allowed set is exactly two: inside the repository, or inside quorate's own per-user home.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  quorateHome, repoKey, defaultReviewsRoot, reviewsRootAllowed, archivePlan,
} from '../scripts/lib/reviews-root.mjs';
import { isWithin } from '../scripts/lib/finding-scope.mjs';

const HOME = path.resolve('/home/u/.quorate');
const REPO = path.resolve('/work/proj');
const allow = (candidate) => reviewsRootAllowed({ repoRoot: REPO, home: HOME, candidate, isWithin });

test('the default reviews root is outside the repository under review', () => {
  const root = defaultReviewsRoot({ project: 'quorate', repoRoot: REPO, home: HOME });
  assert.ok(!isWithin(REPO, root), 'a run must not write into the tree it is reviewing');
  assert.ok(isWithin(HOME, root), 'and it must land somewhere the operator owns');
});

test('two checkouts of one project do not share a reviews root', () => {
  // A worktree, a sandbox clone and a consumer fork all declare the same `project`. Sharing a root
  // would interleave their runs, and `latest.txt` would point at whichever finished last.
  const a = defaultReviewsRoot({ project: 'quorate', repoRoot: '/work/a', home: HOME });
  const b = defaultReviewsRoot({ project: 'quorate', repoRoot: '/work/b', home: HOME });
  assert.notEqual(a, b);
  assert.match(path.basename(a), /^quorate-[0-9a-f]{8}$/,
    'the readable half stays first so an operator can still find it by eye');
});

test('the same checkout always resolves to the same root', () => {
  const once = defaultReviewsRoot({ project: 'q', repoRoot: REPO, home: HOME });
  const twice = defaultReviewsRoot({ project: 'q', repoRoot: REPO, home: HOME });
  assert.equal(once, twice, 'a root that moved between runs would orphan every earlier run');
});

test('QUORATE_HOME overrides, so nothing has to write to a real home directory', () => {
  assert.equal(quorateHome({ QUORATE_HOME: '/tmp/qh' }, '/home/u'), path.resolve('/tmp/qh'));
  assert.equal(quorateHome({}, '/home/u'), path.join('/home/u', '.quorate'));
});

// ---------------------------------------------------------------- the bound
test('a directory inside the repository is still allowed', () => {
  // Not a deprecation. A consumer who wants the evidence trail committed keeps it, deliberately.
  assert.equal(allow(path.join(REPO, '.claude', 'reviews')).ok, true);
});

test('a directory inside quorate home is allowed', () => {
  assert.equal(allow(path.join(HOME, 'reviews', 'x')).ok, true);
});

test('anywhere else is refused, and the refusal says why it is bounded at all', () => {
  const r = allow(path.resolve('/etc/quorate'));
  assert.equal(r.ok, false);
  assert.match(r.why, /neither inside the repository/);
  assert.match(r.why, /path traversal/,
    'the reason must name the threat, or the next person to widen this will not know what it cost');
});

test('the repository root itself is refused', () => {
  const r = allow(REPO);
  assert.equal(r.ok, false, 'every run would write over the tree it is reviewing');
  assert.match(r.why, /repository root itself/);
});

test('quorate home itself is refused', () => {
  const r = allow(HOME);
  assert.equal(r.ok, false, 'runs of every project would pile into one directory');
  assert.match(r.why, /use a subdirectory/);
});

test('containment is asked of the one owner, never reimplemented here', () => {
  // isWithin is INJECTED. A second copy of "is this path inside that one" would eventually disagree
  // with the one guarding finding paths, and the disagreeing half would be the one deciding where
  // evidence lands (G-24).
  let asked = 0;
  reviewsRootAllowed({
    repoRoot: REPO, home: HOME, candidate: path.join(HOME, 'reviews', 'x'),
    isWithin: (...a) => { asked += 1; return isWithin(...a); },
  });
  assert.ok(asked > 0, 'the caller supplies the comparison');
});

test('the allowed result names WHICH container matched', () => {
  // The caller must still run the symlink-escape check G-32 and G-34 exist for, and that check needs
  // the boundary the path was accepted against. Testing an in-home root for escape from the
  // REPOSITORY would pass everything and protect nothing.
  const inRepo = allow(path.join(REPO, '.claude', 'reviews'));
  assert.equal(inRepo.container, REPO);
  assert.equal(inRepo.where, 'repository');
  const inHome = allow(path.join(HOME, 'reviews', 'x'));
  assert.equal(inHome.container, HOME);
  assert.equal(inHome.where, 'quorate home');
});

// STAGED OUTSIDE, RETURNED AFTER.
//
// Moving runs out of the reviewed tree removed a whole class of exclusion defects, and cost the
// committed evidence trail: an out-of-tree run exists only on the machine that produced it. The two
// goals separate cleanly — stage the run where nothing can see it WHILE it is being written, and move
// it back once it is finished and inert. The exclusions stay anyway, because between archiving and
// committing the run directory is untracked and non-ignored, which is exactly the set
// `mirrorWorkingTree` copies into the arms' checkout.
test('the archive plan renames into place rather than copying into place', () => {
  const p = archivePlan({ runDir: '/home/u/.quorate/reviews/proj/20260101-000000-x', archiveTo: '/repo/.claude/reviews', repoRoot: '/repo', realpath: (x) => x });
  assert.equal(p.ok, true);
  assert.equal(path.basename(p.to), '20260101-000000-x', 'the run keeps its id');
  assert.equal(path.dirname(p.tmp), path.dirname(p.to),
    'the temp must sit BESIDE the destination, or the rename crosses a volume and stops being atomic');
  assert.notEqual(p.tmp, p.to);
  assert.match(path.basename(p.tmp), /^\./, 'and it must not look like a run while it is incomplete');
});

test('it refuses to archive over a run that is already there', () => {
  const p = archivePlan({
    runDir: '/home/u/.quorate/reviews/proj/20260101-000000-x',
    archiveTo: '/repo/.claude/reviews', repoRoot: '/repo', realpath: (x) => x,
    exists: () => true,
  });
  assert.equal(p.ok, false);
  assert.match(p.why, /already exists/,
    'two runs sharing an id is a collision; replacing the older one destroys an artifact a finding '
    + 'may already cite');
});

test('no destination means no archive, and that is not an error state to paper over', () => {
  assert.equal(archivePlan({ runDir: '/x/y', archiveTo: '' }).ok, false);
  assert.equal(archivePlan({ runDir: '', archiveTo: '/r' }).ok, false);
});

// G-16 of run 20260925-200721-platform-remediated (panel-codex-security): archive_to was checked only
// as an absolute path, and the archive then deletes a temp directory and copies the run there. A
// forged run.json.archive_to, or a .claude/reviews that is a link out of the repository, aimed that
// recursive delete and copy anywhere. new-run only ever writes <repo>/.claude/reviews, so that is the
// only destination accepted, and it must still be inside the repository once links are resolved.
test('G-16: an archive destination other than the repository\'s own .claude/reviews is refused', () => {
  const repo = path.resolve('/repo');
  const p = archivePlan({ runDir: '/home/u/.quorate/reviews/proj/r1', archiveTo: path.resolve('/etc'), repoRoot: repo, realpath: (x) => x });
  assert.equal(p.ok, false);
  assert.match(p.why, /\.claude/);
});

test('G-16: a .claude/reviews that resolves out of the repository through a link is refused', () => {
  const repo = path.resolve('/repo');
  const reviews = path.join(repo, '.claude', 'reviews');
  const realpath = (x) => (path.resolve(x) === reviews ? path.resolve('/victim/data') : path.resolve(x));
  const p = archivePlan({ runDir: '/home/u/.quorate/reviews/proj/r1', archiveTo: reviews, repoRoot: repo, realpath });
  assert.equal(p.ok, false);
  assert.match(p.why, /link/);
  // Not created yet is the ordinary first archive: judged by its nearest existing ancestor.
  const fresh = (x) => { if (path.resolve(x) === reviews) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return path.resolve(x); };
  assert.equal(archivePlan({ runDir: '/home/u/.quorate/reviews/proj/r1', archiveTo: reviews, repoRoot: repo, realpath: fresh }).ok, true);
});
