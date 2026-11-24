// Group 1 of run 20260907-192446-verify-claims: four paths that decided what gets read, hashed, or
// executed, and did not check where they pointed. Each is asserted for the behaviour, not by
// grepping the source — the same sweep found a "fix" that was a dead function nothing called.
//
// Symlink creation needs a privilege this machine may not have, so link cases attempt and skip; the
// non-link half of every test is always asserted, so none of these can pass vacuously.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, makeLink as makeLinkOwned } from './helpers.mjs';
import { findingOutOfScope } from '../scripts/lib/finding-scope.mjs';
import { worktreeSha } from '../scripts/io/worktree.mjs';

const REPO_ROOT = path.join(import.meta.dirname, '..');

// SCRATCH INSIDE THE REPOSITORY, BUT IGNORED (20261001-205530-m0-pending-claims-review). These tests need a directory inside
// the repository and made it at the root as `.tmp-*`, untracked and NOT ignored — so the arms-snapshot builder's
// `git add -A`, run by another test at the same time, saw files appear and vanish and failed with "unable to index
// file" (exit 128), twice. `.sandbox/` is the gitignored scratch area CLAUDE.md names.
const SCRATCH = (() => { const d = path.join(REPO_ROOT, '.sandbox'); fs.mkdirSync(d, { recursive: true }); return d; })();
/**
 * A link this platform will actually let us create, or null.
 *
 * G-51 REPORTED THIS TEST AS UNCHECKABLE; running it proved it was UNCHECKED — on the machine this
 * framework is developed on. A file symlink needs Developer Mode or an elevated shell on Windows,
 * so `fs.symlinkSync(..., 'file')` returns EPERM here and the old fallback quietly asserted that
 * "an ordinary tree still hashes" and passed. The dereference regression had never once been
 * exercised on the primary development platform.
 *
 * A DIRECTORY JUNCTION needs no privilege, and it reaches the same code: `lstat().isSymbolicLink()`
 * is true for a junction, and `worktree.mjs` then hashes `symlink:${readlink(f)}` rather than the
 * target's bytes — which is the exact branch G-27 fixed. So the check runs unprivileged instead of
 * being skipped, and the skip is kept only for a platform that offers neither.
 */
function makeLink(t, targetFile, targetDir, at) {
  // Given the test context, so a failure is answered by the one owner (tests/helpers.mjs makeLink; silent-platform-skips.md):
  // a junction named as the fallback, or a skip naming why, in which case the dereference regression is UNCHECKED here
  // rather than passing. A `return false` from a helper was the silent shape the census refuses.
  return makeLinkOwned(t, { target: targetFile, at, type: 'file', fallback: { dir: targetDir } });
}

// A GENERATED-GLOB MATCH IS A PATH MATCH, not a character-prefix match. `.claude/reviews/**` also
// matched `.claude/reviews-old/source.mjs`, so a real finding in a neighbouring directory was
// demoted to an uncounted note — a silent downgrade, the worst direction for this to fail in (G-18).
test('a generated glob does not swallow a neighbouring directory that merely shares a prefix', () => {
  // Both files sit inside the declared surface, so the only question this test asks is whether the
  // GENERATED clause claims the neighbour — not whether anything else demotes it.
  const opts = { generatedGlobs: ['.claude/reviews/**'], declaredGlobs: ['.claude/**'] };
  const inside = findingOutOfScope({ file: '.claude/reviews/run/x.mjs', line: 1 }, opts);
  assert.match(String(inside), /generated/, 'the declared tree is still demoted');

  const neighbour = findingOutOfScope({ file: '.claude/reviews-old/source.mjs', line: 1 }, opts);
  assert.equal(neighbour, null,
    'reviews-old is a different directory; demoting it hides a finding nobody declared generated');

  // The boundary is a path separator, so the directory itself still matches its own glob.
  assert.match(String(findingOutOfScope({ file: '.claude/reviews', line: 1 }, opts)), /generated/);
});

// walk() records a symlink without traversing it, on the stated basis that it "is recorded as the
// file it is" — and then the hash loop called readFileSync, which DEREFERENCES it and hashed the
// target's bytes (G-27). For a link pointing out of the tree that folds a foreign file into the
// hash, so an unrelated file edited elsewhere raises TREE-MOVED and caps the gate at RISK over
// something no finding could ever cite.
//
// SKIPPED, NOT SILENTLY PASSED, where symlinks cannot be created (G-51). This used to fall back to
// asserting that an ordinary tree "still hashes" and return — which cannot fail for the dereference
// regression it exists to constrain, and was counted in the pass tally exactly like a real run. A
// suite that reports 438 passing must mean it: an environment without the privilege has NOT checked
// this, and the summary now says so instead of quietly inflating the number. Windows needs
// Developer Mode or an elevated shell; CI containers usually have it and unprivileged Windows
// runners usually do not — precisely the split that would have hidden the regression.
test('the worktree hash records a link by where it points, never by what it points at', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-link-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'source\n');
    // Both shapes of target, so whichever link this platform permits points somewhere real. The
    // FILE inside outsideDir is what gets edited either way: for a junction it is a file the link
    // reaches through, which is exactly the traversal that must not happen.
    const outsideDir = path.join(root, 'outside');
    fs.mkdirSync(outsideDir);
    const outside = path.join(outsideDir, 'outside.txt');
    fs.writeFileSync(outside, 'first\n');

    const at = path.join(root, 'src', 'link.txt');
    const link = makeLink(t, outside, outsideDir, at);
    if (!link) { t.skip('no link can be made here (makeLink said why)'); return; }
    t.diagnostic(`link kind exercised: ${link.kind}`);

    const before = worktreeSha({ repoRoot: root, paths: ['src'] });
    fs.writeFileSync(outside, 'edited by something unrelated to this review\n');
    assert.equal(worktreeSha({ repoRoot: root, paths: ['src'] }), before,
      'editing a file OUTSIDE the reviewed tree must not read as the reviewed tree moving');

    // ...and re-pointing the link IS a change to the tree, because the link itself is what is in it.
    if (link.kind === 'directory junction') fs.rmSync(at, { recursive: true, force: true });
    else fs.unlinkSync(at);
    const elsewhereDir = path.join(root, 'elsewhere');
    fs.mkdirSync(elsewhereDir);
    fs.writeFileSync(path.join(elsewhereDir, 'x.txt'), 'x\n');
    assert.ok(makeLink(t, path.join(elsewhereDir, 'x.txt'), elsewhereDir, at), 're-linking must succeed');
    assert.notEqual(worktreeSha({ repoRoot: root, paths: ['src'] }), before,
      'the link itself is part of the tree, so re-pointing it IS the tree moving');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Every check capture makes reads the run.json that the caller's own --run-dir chose, which cannot
// detect a COUNTERFEIT one: a directory carrying a self-consistent run.json passed all of them, and
// its contract.commands then decide what this already-authorised surface executes (G-6). The
// authority for "which repository is this" has to come from git, not from the file under test.
test('capture refuses a run directory outside the repository it is running in', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-cap-'));
  try {
    const runDir = path.join(tmp, 'run');
    fs.mkdirSync(runDir, { recursive: true });
    // Self-consistent and entirely fake: matching basename, its own host.cwd, its own commands.
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
      run_id: 'run', host: { cwd: tmp }, contract: { commands: { test: 'whatever' } },
    }));

    // runScript, not a bare spawn: it clears GRAPH_NODE_DEPTH, so an ambient depth cannot decide
    // whether this passes. capture has no depth guard today — it is bookkeeping (§8) — but a suite
    // where one spawner differs from the other six is where the next G-50 comes from.
    const r = runScript('capture.mjs', [
      '--run-dir', runDir, '--node', 'n1', '--name', 'probe', '--', 'git', 'status',
    ]);

    assert.equal(r.status, 2, 'a foreign run directory is a usage refusal, not a captured command');
    // The bound is TWO containers since graph_contract 2 (the repository, or the engine's own home
    // where runs now default). A temp directory is inside neither, so it is refused exactly as
    // before -- what changed is the sentence, not the control.
    assert.match(r.stderr, /neither inside the repository under review .* nor inside the engine's home/);
    assert.match(r.stderr, /not authority for where it may be/,
      'the reason a run directory cannot vouch for itself must survive the re-basing');
    assert.ok(!fs.existsSync(path.join(runDir, 'evidence')),
      'nothing may be written into a run directory this process refused');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// A DECLARED GLOB'S SUFFIX IS PART OF THE DECLARATION (G-16). Matching only the directory prefix
// meant `src/**/*.ts` also covered `src/output.bin`, so a file the contract never declared read as
// declared: uncoveredFiles stopped reporting it (CONTRACT-PARTIAL suppressed) and an out-of-scope
// finding against it counted toward the gate.
test('a glob\'s trailing *.ext must match, while a bare directory glob still covers everything', async () => {
  // Through the grammar's one owner since contract-glob-grammar stage 3; the expectations are unchanged.
  const { matchesAnyGlob } = await import('../scripts/lib/contract-glob.mjs');
  const coveredByGlobs = (f, globs) => matchesAnyGlob(globs, f);

  assert.equal(coveredByGlobs('src/main.ts', ['src/**/*.ts']), true);
  assert.equal(coveredByGlobs('src/data.json', ['src/**/*.ts']), false,
    'a .json file is not declared by a pattern that names .ts');

  // The bare directory form declares everything beneath it, and must keep doing so — this repo's own
  // contract is written that way.
  assert.equal(coveredByGlobs('scripts/output.bin', ['scripts/**']), true);
  assert.equal(coveredByGlobs('scripts/lib/x.mjs', ['scripts/**']), true);

  // The forms already in use elsewhere keep working.
  assert.equal(coveredByGlobs('deep/dir/a.test.mjs', ['**/*.test.mjs']), true);
  assert.equal(coveredByGlobs('CLAUDE.md', ['CLAUDE.md']), true);
  assert.equal(coveredByGlobs('elsewhere/x.ts', ['src/**/*.ts']), false);
});

// THE ROOT CASE (G-37). `child.startsWith(parent + path.sep)` breaks when the parent IS a root:
// path.resolve already returns a trailing separator, so the composed prefix becomes `F:\` or `//`
// and nothing starts with it. The Rule 2 sandbox guard used that form, so an --add-dir of a drive
// root — which contains the entire source tree — passed a check written to refuse exactly that.
test('containment holds at a filesystem root, where the naive prefix test fails', async () => {
  const { isWithin } = await import('../scripts/lib/finding-scope.mjs');
  const root = path.parse(process.cwd()).root;
  const inside = path.join(root, 'anything', 'deeper');

  assert.equal(isWithin(root, inside), true, 'a root contains everything under it');
  assert.equal(inside.startsWith(path.resolve(root) + path.sep), false,
    'the naive form this replaced says the opposite — that is the defect');

  assert.equal(isWithin(REPO_ROOT, REPO_ROOT), true, 'a path contains itself');
  assert.equal(isWithin(REPO_ROOT, path.join(REPO_ROOT, 'scripts')), true);
  assert.equal(isWithin(path.join(REPO_ROOT, 'scripts'), REPO_ROOT), false, 'and not the other way round');
  assert.equal(isWithin(REPO_ROOT, `${REPO_ROOT}-other`), false, 'a sibling sharing a prefix is not inside');
});

// INSIDE THE REPOSITORY IS NOT THE SAME AS PUBLISHABLE (G-15). readExcerpt chooses what to hand a
// third-party cloud, from coordinates a MODEL supplied, and its only filters were repository
// containment and the link check — so `.claude/reviews/*/evidence/*.log` (captured command output,
// gitignored precisely because it is content) and an untracked `.env` both qualified as fine to send.
test('an excerpt may only be taken from declared, non-generated source', async () => {
  const { readExcerpt } = await import('../scripts/io/excerpt.mjs');
  const opts = {
    repoRoot: REPO_ROOT,
    generatedGlobs: ['.claude/reviews/**'],
    declaredGlobs: ['scripts/**', 'shared/**', 'CLAUDE.md'],
  };

  assert.equal(readExcerpt({ ...opts, file: 'scripts/lib/excerpt.mjs', line: 5, radius: 1 }).ok, true,
    'reviewed source is exactly what a tie-break needs to see');
  assert.equal(readExcerpt({ ...opts, file: 'CLAUDE.md', line: 3, radius: 1 }).ok, true,
    'a declared document too — a doc finding is disputed the same way');

  const generated = readExcerpt({ ...opts, file: '.claude/reviews/ledger.json', line: 2, radius: 1 });
  assert.equal(generated.ok, false);
  assert.match(generated.why, /generated/, 'captured output is not source, and not ours to send');

  const undeclared = readExcerpt({ ...opts, file: '.env', line: 1, radius: 1 });
  assert.equal(undeclared.ok, false);
  assert.match(undeclared.why, /declared review surface/,
    'a file nobody declared is not reviewed source, whatever it is');

  // Refusal is a legitimate outcome: the tie-break prompt says so, and a ruling of "the evidence
  // here does not decide it" is worth more than an excerpt of something nobody meant to send.
  assert.equal(readExcerpt({ ...opts, file: 'scripts/lib/excerpt.mjs', line: 5, radius: 1 }).ok, true);
});

// CONTAINMENT WAS CHECKED ONLY FOR PATHS THAT ALREADY EXIST (G-32, panel-codex-security).
//
// `escapesAfterRealpath` treats an unresolvable path as containment FAILING — right for a path
// being READ, wrong for one about to be CREATED, since a run directory legitimately does not exist
// yet. So every creating caller wrote `fs.existsSync(p) && escapes(p)`, which skips the check in
// exactly the case that matters: a nonexistent directory BENEATH an in-repository junction pointing
// out of the tree. `reviews_dir` passed validation and mkdirSync then wrote every artifact of every
// run outside the repository under review.
test('a path that does not exist yet is contained through its nearest existing ancestor', async (t) => {
  const { escapesBeforeCreate } = await import('../scripts/io/finding-scope.mjs');
  const root = fs.mkdtempSync(path.join(SCRATCH, '.tmp-precreate-'));
  try {
    const outside = fs.mkdtempSync(path.join(SCRATCH, '.tmp-outside-'));
    try {
      // The ordinary case: a directory that does not exist, under a real root, is fine.
      assert.equal(escapesBeforeCreate(root, path.join(root, 'reviews', 'run-1')), false);

      const link = path.join(root, 'escape');
      // A junction (a directory symlink where junctions do not exist); where neither can be made, makeLink skips: the
      // escape through a link is unchecked.
      const linked = makeLinkOwned(t, { target: outside, at: link, type: 'junction' });
      if (linked) {
        // The defect: neither the link nor anything under it needs to exist for mkdirSync to
        // follow it. The old guard saw a nonexistent path and skipped the check entirely.
        assert.equal(escapesBeforeCreate(root, path.join(link, 'reviews', 'run-1')), true,
          'a path whose ancestor leaves the tree escapes, whether or not it exists yet');
      }
      // A path with no existing ancestor at all resolves through nothing, and an unresolvable path
      // is not evidence of safety.
      assert.equal(escapesBeforeCreate(path.join(root, 'no-such-root'), path.join(root, 'x', 'y')), true);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// A CALLER-SUPPLIED REQUEST PATH WAS READ WITH NO CONTAINMENT AT ALL (G-33, panel-codex-code).
//
// `--request` resolved and read whatever it was given, so an absolute path or one carrying `..`
// selected any file on the machine containing `status: approved` — and run-graph COPIES the request
// into the intent sandbox, where a model reads it in full. Of every path in new-run, this is the
// one whose contents are handed to a model verbatim.
test('a request outside the repository is refused before it is read', () => {
  // --full-sweep so the mint REACHES request resolution. Without it, new-run refuses earlier when
  // the diff happens to contain no source files — which is ambient state: it depends on what the
  // last commit touched, so this test passed or failed according to unrelated work.
  const r = runScript('new-run.mjs',
    ['--dry-run', '--full-sweep', 'scripts', '--request', '../../../etc/passwd']);
  assert.match(r.output, /resolves outside the repository under review/);

  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  // From the resolution of the caller's path onward. The discovery scan above it also reads files,
  // but those come from a listing of .claude/requests/ and are contained by construction; anchoring on
  // `function resolveRequest(` picked up that read instead and compared the wrong two positions.
  const fn = src.slice(src.indexOf('const abs = path.resolve(repoRoot, candidate);'));
  const guard = fn.indexOf('isWithin(repoRoot, abs)');
  const read = fn.indexOf('const text = fs.readFileSync(abs');
  assert.ok(guard !== -1 && read !== -1 && guard < read,
    'the containment check must precede the read, not explain it afterwards');
  // Found, not merely earlier: a missing anchor is -1, which is less than any read (G-42 of 20261122-232627-m3s7-b4-review).
  const linkCheck = fn.indexOf('escapesAfterRealpath(repoRoot, abs)');
  assert.ok(linkCheck !== -1 && linkCheck < read,
    'and the link check too — a lexical test passes for a link that points out of the tree');
});

// "THE ONE PLACE THIS COMPARISON IS SPELLED" WAS FIVE PLACES (G-7, arch-review + panel-codex-code).
//
// finding-scope.mjs says it of isWithin, new-run.mjs calls it "the one owner of this comparison",
// and external-review.mjs and capture.mjs each carried a private `p === root || p.startsWith(root +
// path.sep)` — the exact composed-prefix form isWithin was added to replace, which BREAKS AT A
// FILESYSTEM ROOT: path.resolve already returns a trailing separator for `F:\` or `/`, so the
// doubled form starts nothing and the check passes everything.
//
// These two are the places that decide where a run's bytes land and what directory a third-party
// reviewer is pointed at, which makes them the last two that should hold a copy.
test('the containment comparison has one owner, and the egress paths use it', async () => {
  const { isWithin } = await import('../scripts/lib/finding-scope.mjs');

  // The root case the composed form gets wrong, asserted on the owner so the property is pinned
  // rather than the spelling.
  const root = path.parse(process.cwd()).root;
  assert.equal(isWithin(root, path.join(root, 'anything')), true,
    'everything is inside a filesystem root — the form this replaced answered false');
  assert.equal(isWithin(root, root), true);

  for (const f of ['external-review.mjs', 'capture.mjs']) {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', f), 'utf8');
    // From the owner, or from scripts/io/, which re-exports that same owner bound to the host
    // (os-platform-adapters stage 3) — either way there is one definition.
    assert.match(src, /import \{[^}]*isWithin[^}]*\} from '\.\/(lib|io)\/finding-scope\.mjs'/,
      `${f} must import the owner rather than respell it`);
    assert.ok(!/p === root \|\| p\.startsWith\(root \+ path\.sep\)/.test(src),
      `${f} still carries a private copy of the comparison`);
  }
});

// THE SECOND CONTAINMENT ROOT WAS A GIT DIRECTORY WEARING A WORKTREE'S NAME (G-8, security-audit).
//
// Yesterday's worktree fix derived the main repository root as `dirname(--git-common-dir)`. That
// equals a worktree root only when the git directory is literally `<root>/.git` — and it is NOT, in
// the deployment this project is built for: mounted as a submodule, `.git` is a gitfile resolving to
// `<super>/.git/modules/<path>`, so the parent is `<super>/.git/modules`, not a repository at all.
// It would then have been accepted as "inside this repository" for both --run-dir and
// --evidence-dir, which is where every artifact external-review writes lands. A --separate-git-dir
// checkout breaks it the same way.
//
// `git worktree list --porcelain` reports worktree ROOTS. Still git speaking, in-process, which is
// the property the rule is about; what changed is that it is asked the question whose answer the
// code needs rather than one whose answer resembles it.
test('the containment roots come from git worktree list, not from a git directory', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  const block = src.slice(src.indexOf('if (outDir) {'), src.indexOf('let runId ='));

  // The block takes its roots from gitWorktreeRoots, their one owner (G-17 of 20261122-035227-m3s7-b3-review), and the
  // owner is what asks `git worktree list`.
  assert.match(block, /const roots = gitWorktreeRoots\(\);/);
  const owner = src.slice(src.indexOf('function gitWorktreeRoots()'), src.indexOf('const earlyAdmission'));
  assert.match(owner, /'worktree', 'list', '--porcelain'/);
  assert.ok(!/\['rev-parse', '--git-common-dir'\]/.test(owner), 'the owner takes a git directory for a root');
  // On the CALL, not the prose: the comment above it explains what it replaced, and an earlier
  // version of this assertion failed on that explanation.
  assert.ok(!/\['rev-parse', '--git-common-dir'\]/.test(block),
    'dirname of a git directory is a worktree root only in the default layout');
  assert.ok(!/path\.dirname\(path\.resolve\(process\.cwd\(\)/.test(block),
    'string surgery on a git-internal path is what produced the wrong root');

  // What git actually reports here: the first entry is the main worktree, and it is a real
  // directory containing this repository's own source.
  const out = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(out.status, 0);
  const first = (out.stdout || '').split('\n').find((l) => l.startsWith('worktree '));
  assert.ok(first, 'git must report at least the main worktree');
  const root = path.resolve(first.slice('worktree '.length).trim());
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'external-review.mjs')),
    'the reported root is a worktree, not a git directory');
});
