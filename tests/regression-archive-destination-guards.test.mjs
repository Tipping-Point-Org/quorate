// G-28 AND G-37: MOVING RUNS OUT OF THE TREE LEFT TWO GUARDS POINTING AT THE WRONG DIRECTORY.
//
// Both were written when a run was BORN and DIED in `<repo>/.claude/reviews`. graph_contract 2
// split that into two places -- staged under the engine's per-user home, archived back into the
// repository -- and each guard silently kept naming the half that no longer mattered:
//
//   G-28  new-run writes a `*/evidence/` .gitignore into the REVIEWS ROOT. Staged, that root is
//         outside the repository, so the rule governs a directory git cannot see -- while the
//         finished run is copied WHOLE into `<repo>/.claude/reviews`, evidence and all, where git
//         keeps it forever. disk-first-protocol §3 accepts capture.mjs inheriting the operator's
//         entire environment on the stated ground that its output "is never committed"; that
//         sentence was being kept true only by a root .gitignore private to this repository, which
//         no consuming project receives.
//
//   G-37  the panel mirror excluded `path.dirname(runDir)` under a comment claiming it "covers this
//         run and every archived one". Staged, that path is outside the repository and matches
//         nothing `git ls-files --others` can list, so the exclusion went INERT while the archive
//         destination was excluded by nothing. The chain is self-triggering: run A archives and is
//         untracked -> the next mint records `dirty: true` -> run B mirrors the working tree into
//         the disposable checkout the third-party arms read, carrying run A's briefs, arm prompts,
//         reports and gate to the vendor. That is G-21 reintroduced by RELOCATING the run rather
//         than by deleting the guard, which is exactly why it still looked present.
//
// Same shape as the four staged-run reachability defects: a guarantee expressed as "prove it
// relative to the repository", which out-of-tree satisfies more strongly while failing the test
// written for it. The exclusion list is tested as a VALUE because the defect was a computed value
// that stopped naming anything -- a decision that can go inert is a decision worth a test.
//
// THE ARCHIVE HALF RUNS IN A TEMPORARY CONSUMER REPOSITORY, NOT IN THIS ONE. quorate's own
// `.claude/reviews/.gitignore` is tracked and predates the staging move, so archiving here would
// find the rule already present and the test would pass without the code that writes it -- the
// same accident that hid the defect from every lens until a sweep read the call site. A-15: a
// probe must not differ from production in any dimension that can fail, and "does the destination
// already carry the rule" is the only dimension this one is about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runScript, mintedRunDir } from './helpers.mjs';
import { panelMirrorExclusions, REVIEWS_IGNORE_TEXT } from '../scripts/lib/reviews-root.mjs';
import { isWithin } from '../scripts/lib/finding-scope.mjs';

const STAGED = {
  // An absolute path OUTSIDE the repository, on every OS: `path.join('C:', ...)` was absolute only on
  // Windows, and these three tests failed on POSIX for it (found in WSL, arms-read-surface Stage 7).
  runDir: path.join(path.parse(REPO_ROOT).root, 'home-of-someone', '.quorate', 'reviews', 'proj-abc12345', '20260918-1-x'),
  archiveTo: path.join(REPO_ROOT, '.claude', 'reviews'),
  repoRoot: REPO_ROOT,
};

test('the panel mirror excludes a directory git can actually name', () => {
  const ex = panelMirrorExclusions(STAGED);
  // THE WHOLE DEFECT IN ONE ASSERTION. `git ls-files --others` lists paths inside the repository;
  // an exclusion outside it can never match one, so a list with no in-repo entry excludes nothing.
  assert.ok(ex.some((d) => isWithin(REPO_ROOT, d)),
    `every exclusion is outside the repository, so none of them can match anything git lists. `
    + `That is the inert guard G-37 was: ${JSON.stringify(ex)}`);
  assert.ok(ex.includes(STAGED.archiveTo),
    'and the one it must name is where archived runs actually land');
});

test('and still excludes the staging root, for a project that declared reviews_dir', () => {
  // A project declaring `reviews_dir` writes its runs straight into the tree and never archives, so
  // the staging root IS the in-repo directory. Dropping it in favour of the archive destination
  // would fix this configuration by breaking that one.
  const ex = panelMirrorExclusions(STAGED);
  assert.ok(ex.includes(path.dirname(STAGED.runDir)), "the run's own parent must survive");

  const declared = path.join(REPO_ROOT, 'custom-reviews');
  const inTree = panelMirrorExclusions({
    runDir: path.join(declared, '20260918-1-x'), archiveTo: null, repoRoot: REPO_ROOT,
  });
  assert.ok(inTree.includes(declared), 'a declared in-tree reviews root is excluded as itself');
});

test('an absent archive_to still yields the default destination, not nothing', () => {
  // `archive_to` is null for a project that declared reviews_dir, and the default has to be derived
  // rather than skipped: returning only the staging root is precisely the inert list above.
  const ex = panelMirrorExclusions({ runDir: STAGED.runDir, archiveTo: null, repoRoot: REPO_ROOT });
  assert.ok(ex.includes(path.join(REPO_ROOT, '.claude', 'reviews')));
});

/** A throwaway git repository with a minimal contract — a consumer, not this framework. */
function consumerRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-g28-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  // `ui.surface: none` IS LOad-BEARING, not decoration. ui-audit's condition is `ui.surface !=
  // none`, and an UNDECLARED key is not equal to "none" — so a contract omitting the block SELECTS
  // the lens, and `--only ui-audit` then spawns a real model. Written without it, this test billed
  // $0.46 and took 80 seconds, which is G-52 -- the defect two lenses had just caught in the
  // staged-run test -- reintroduced in the test written to fix it. Declared, nothing spawns and the
  // same archive path is exercised for the price of a process.
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
    '# t\n\n```yaml\ngraph_contract_version: 3\nproject: t\ncommands:\n  build: ""\n  test: ""\n'
    + 'ui:\n  surface: none\n```\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return dir;
}

test('a mint leaves the reviewed tree untouched — the ignore rule is NOT written at mint', () => {
  // The first attempt at G-28 wrote the archive destination's .gitignore during the mint, which
  // created `.claude/` in a tree that never asked for one. An existing test caught it. Held here
  // too, beside the archive assertion, so the two constraints are visible as a pair rather than
  // rediscovered in opposition by whoever changes this next.
  const dir = consumerRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-g28home-'));
  try {
    const r = runScript('new-run.mjs',
      ['--slug', 'g28', '--no-verify-sandbox', '--no-request', '--full-sweep', '.'],
      { cwd: dir, env: { QUORATE_HOME: home } });
    assert.equal(r.status, 0, r.output.slice(-300));
    assert.ok(!fs.existsSync(path.join(dir, '.claude', 'reviews')),
      'a mint must create no reviews directory in the tree under review');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('an archived run arrives with the ignore rule that makes §3 true', () => {
  const dir = consumerRepo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-g28arch-'));
  try {
    const mint = runScript('new-run.mjs',
      ['--slug', 'g28archive', '--no-verify-sandbox', '--no-request', '--full-sweep', '.'],
      { cwd: dir, env: { QUORATE_HOME: home } });
    assert.equal(mint.status, 0, mint.output.slice(-300));
    const runDir = mintedRunDir(mint.output);
    assert.ok(!isWithin(dir, runDir), 'this test only means something on a STAGED run');

    // `--only ui-audit` selects a lens whose condition is unmet here, so nothing spawns and no model
    // is billed, while run-graph still gates and archives. The archive is the whole point.
    const graph = runScript('run-graph.mjs',
      ['--run-dir', runDir, '--skip-panel', '--only', 'ui-audit'], { cwd: dir, env: { QUORATE_HOME: home } });
    assert.notEqual(graph.status, 2, graph.output.slice(-400));
    // AND NOTHING WAS BILLED. Asserted rather than assumed: the condition that keeps ui-audit
    // deselected lives in the fixture's contract above, one edit away from silently turning this
    // into a paid test that nobody would notice until a bill or a timeout.
    assert.match(graph.output, /cost:\s+\$0\.0+\b/,
      `this test must spawn no model; it selects a lens whose condition is unmet. Output:\n`
      + graph.output.slice(-600));

    const dest = path.join(dir, '.claude', 'reviews');
    assert.ok(fs.existsSync(path.join(dest, path.basename(runDir))),
      `the run must have archived into the consumer tree:\n${graph.output.slice(-400)}`);
    const ignorePath = path.join(dest, '.gitignore');
    assert.ok(fs.existsSync(ignorePath),
      'the archive destination must carry the rule keeping captured output out of git — §3 accepts '
      + 'capture.mjs inheriting the whole environment ONLY because that output is never committed, '
      + 'and no consuming project receives this framework\'s private root ignore rules');
    assert.equal(fs.readFileSync(ignorePath, 'utf8'), REVIEWS_IGNORE_TEXT,
      'and it must be the one owner\'s text, not a second copy free to drift');

    // THE PROPERTY, asked of git rather than of a rule.
    const check = spawnSync('git', ['check-ignore', '-q',
      path.join(dest, path.basename(runDir), 'evidence')], { cwd: dir });
    assert.equal(check.status, 0, 'git itself must agree that archived evidence is ignored');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
