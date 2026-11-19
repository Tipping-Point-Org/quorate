// CI run 43281517496 (windows, Node 26): 396 failures from one cause. The runner's TEMP is an 8.3 short path
// (C:\Users\RUNNER~1\AppData\Local\Temp), the tests' QUORATE_HOME sits under it, and every run directory admitRun had
// realpath'd came back long (C:\Users\runneradmin\...). The staging root derived from the short home was then compared
// lexically with the long run directory, and new-run refused a run of the repository as "in none of" its roots.
// canonicalSpelling (lib/finding-scope.mjs) is the one rule that respells a root; quorateHome, repoRunRoots,
// runBelongsToRepo and admitRun apply it where the root is resolved. These drive it with a disk that has a short alias,
// so the case is held on every host, including one whose temp folder has no short form (this machine's C:\work\temp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { canonicalSpelling } from '../scripts/lib/finding-scope.mjs';
import { repoRunRoots, runBelongsToRepo, defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';

const ROOT = path.parse(process.cwd()).root;
const LONG = path.join(ROOT, 'Users', 'runneradmin');
const SHORT = path.join(ROOT, 'Users', 'RUNNER~1');

// A disk where SHORT is another name for LONG, as NTFS gives a long folder name an 8.3 alias. `links` are levels that
// are links; `elsewhere` maps a path to a real path on another root (a mapped or subst drive).
function disk({ exists = [], links = [], elsewhere = {} } = {}) {
  const long = (p) => (p === SHORT || p.startsWith(SHORT + path.sep) ? LONG + p.slice(SHORT.length) : p);
  const has = (p) => p === ROOT || [LONG, ...exists].some((e) => e === long(p) || e.startsWith(long(p) + path.sep));
  const real = (p) => {
    if (!has(p)) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; }
    return elsewhere[p] ?? long(p);
  };
  real.native = real;
  return {
    caseInsensitiveFs: false,
    fs: {
      readFileSync: () => { throw new Error('not read here'); },
      existsSync: has,
      realpathSync: real,
      lstatSync: (p) => { real(p); return { isSymbolicLink: () => links.includes(p) }; },
    },
  };
}

test('a short spelling of an existing folder, and of a path not made yet below it, is respelled long', () => {
  const io = disk();
  assert.equal(canonicalSpelling(SHORT, io), LONG);
  assert.equal(canonicalSpelling(path.join(SHORT, 'home', 'reviews'), io), path.join(LONG, 'home', 'reviews'));
  assert.equal(canonicalSpelling(path.join(LONG, 'x'), io), path.join(LONG, 'x'), 'a long spelling stays as it is');
});

test('a link at any level keeps the spelling given: following a link is the link checks\' question, not a respelling', () => {
  const io = disk({ links: [SHORT] });
  assert.equal(canonicalSpelling(path.join(SHORT, 'home'), io), path.join(SHORT, 'home'));
});

test('a real path on another root, or at another depth, is not a respelling and is not taken', () => {
  const other = path.join(path.parse(process.cwd()).root, 'srv', 'share', 'Users', 'runneradmin');
  assert.equal(canonicalSpelling(SHORT, disk({ elsewhere: { [SHORT]: other } })), SHORT);
});

test('the staging root derived from a home spelled short is spelled long, and a long run directory belongs to it', () => {
  const io = disk({ exists: [path.join(LONG, 'qhome')] });
  const repo = path.join(ROOT, 'work', 'repo');
  const shortHome = path.join(SHORT, 'qhome');
  const staging = defaultReviewsRoot({ project: 'p', repoRoot: repo, home: path.join(LONG, 'qhome') });
  assert.ok(repoRunRoots({ repoRoot: repo, project: 'p', home: shortHome, io }).includes(staging),
    'the staging root kept the short spelling of the home');
  const run = path.join(staging, '20261112-000000-rev');
  assert.deepEqual(runBelongsToRepo({ runDir: run, repoRoot: repo, project: 'p', home: shortHome, io }), { ok: true });
  // And the other way round: a run directory spelled short belongs to a home spelled long.
  const shortRun = path.join(SHORT, path.relative(LONG, run));
  assert.deepEqual(runBelongsToRepo({ runDir: shortRun, repoRoot: repo, project: 'p', home: path.join(LONG, 'qhome'), io }), { ok: true });
});

// The same run's link guard (firstLinkInto) took the JS realpath, which keeps a short name the native one expands: a
// junction from the intent node's floor onto the run's pre-flight logs, its target stored short, was judged outside the
// run directory admitRun had resolved long, and was not refused. The guard now takes the native realpath.
test('the link guard resolves a link by the native realpath, so a short-spelled target inside the run is found', async () => {
  const { firstLinkInto } = await import('../scripts/lib/finding-scope.mjs');
  const run = path.join(LONG, 'run');
  const floor = path.join(run, 'sandbox');
  const link = path.join(floor, 'preflight-link');
  const shortTarget = path.join(SHORT, 'run', 'evidence', 'pre-flight');
  const io = disk({ exists: [floor, path.join(run, 'evidence', 'pre-flight')], links: [link] });
  const native = io.fs.realpathSync;
  // The JS realpath keeps the link's stored short target; the native one expands it.
  const js = (p) => (p === link ? shortTarget : native(p));
  js.native = (p) => (p === link ? native(shortTarget) : native(p));
  io.fs.realpathSync = js;
  io.fs.readdirSync = (d) => (d === floor ? ['preflight-link'] : []);
  io.fs.lstatSync = (p) => ({ isSymbolicLink: () => p === link, isDirectory: () => p !== link });
  assert.equal(firstLinkInto(floor, run, io), 'preflight-link');
});
