// G-33 (arch-review + contract-audit + panel-codex-contract, three routes to the same defect):
// `evidence/<node>/verdict.kept.json` had two writers with two different authorities. spawn-node
// wrote it only after validateVerdict — its comment declares the artifact to BE the validated set,
// so "rejecting a finding has to mean it is gone". run-graph's spawnPanelArm hand-wrote the same
// artifact for every panel arm with rejected_count: 0, asserting a validation that never ran, and
// collectFindings read both indiscriminately into finding-groups.json (the reconciler's only input)
// and thence into reconciled.md — which is remediate's work list, under bypassPermissions.
//
// external-review passes f.file through verbatim, so a codex arm returning '../../.ssh/config' or a
// path under .claude/reviews/** arrived as a counted finding that nothing had checked. I-29 names
// "an arm envelope bypasses the validator on its way to reconcile" as a failure mode.
//
// findingScopeErrors is now the one owner both writers use.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// The host-bound versions: these tests exercise the checks on real temporary trees.
import { findingScopeErrors, findingOutOfScope, declaredSurface, countLines } from '../scripts/io/finding-scope.mjs';
import { REPO_ROOT, repoRunDir, TEST_HOME } from './helpers.mjs';

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-scope-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'real.mjs'), 'a\nb\nc\n');
  return root;
}
const errs = (f, root, globs = []) => findingScopeErrors(f, { repoRoot: root, generatedGlobs: globs });

test('regression: a finding naming a path OUTSIDE the repository is refused', () => {
  const root = repo();
  try {
    // The load-bearing one: remediate runs with bypassPermissions and takes reconciled.md as its
    // work list, so this is a route to an authorised edit outside the repository.
    const why = errs({ file: '../../.ssh/config', line: 1 }, root);
    assert.ok(why.some((w) => /outside the repository/.test(w)), why.join('; '));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// A generated path is OUT OF SCOPE, not INVALID, and §8.5 rule 5 says out-of-scope findings are
// "reported, never counted". It used to be pushed into the rejection list — whose own message read
// "report it in out_of_scope_observations, not findings", naming the destination and not delivering
// it there, so the observation the doctrine promises to print never existed (G-52).
test('regression: a finding under a generated glob is DEMOTED, not refused', () => {
  const root = repo();
  try {
    const f = { file: '.claude/reviews/x/gate.json', line: 1 };
    // No longer a validation error...
    assert.deepEqual(errs(f, root, ['.claude/reviews/**']).filter((w) => /generated glob/.test(w)), [],
      'a generated path is not a defect in the finding');
    // ...but it is still out of scope, and says so.
    assert.match(findingOutOfScope(f, { generatedGlobs: ['.claude/reviews/**'] }) ?? '',
      /generated glob .* reported, not counted/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a finding on a file that does not exist is refused', () => {
  const root = repo();
  try {
    assert.ok(errs({ file: 'scripts/nope.mjs', line: 1 }, root).some((w) => /does not exist/.test(w)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a finding past the end of the file is refused', () => {
  const root = repo();
  try {
    assert.ok(errs({ file: 'scripts/real.mjs', line: 999 }, root).some((w) => /exceeds/.test(w)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a finding with no file at all is refused', () => {
  const root = repo();
  try {
    assert.ok(errs({ line: 1 }, root).some((w) => /no file/.test(w)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a legitimate in-repo finding passes cleanly', () => {
  const root = repo();
  try {
    assert.deepEqual(errs({ file: 'scripts/real.mjs', line: 2 }, root, ['.claude/reviews/**']), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('countLines is exact, and unreadable means null (cannot bound), never zero', () => {
  const root = repo();
  try {
    assert.equal(countLines(path.join(root, 'scripts', 'real.mjs')), 3);
    assert.equal(countLines(path.join(root, 'scripts', 'missing.mjs')), null,
      'null means "cannot bound the line number", which must not be read as a 0-line file');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// §6 IS NOT DEMOTABLE — the clause that makes the scope rule safe to enable at all.
//
// "Any lens may raise these regardless of scope... These are the only findings that may be raised
// entirely outside a lens's declared scope." §8.5 and §6 compose rather than conflict, and this is
// the seam. Shipped WITHOUT it for half a day, which made the most dangerous case the most likely
// one: a credential_exposure BLOCKER against `.claude/reviews/**` — a committed run artifact,
// which is exactly what G-40 turned out to be — was demoted to a printed note.
test('a §6 invariant finding is never demoted, wherever its file sits', () => {
  const f = {
    file: '.claude/reviews/x/checks.json', line: 1, severity: 'BLOCKER',
    basis: 'invariant', invariant: 'credential_exposure', claim: 'a token is committed here',
  };
  assert.equal(findingOutOfScope(f, { generatedGlobs: ['.claude/reviews/**'] }), null,
    'a generated path must not demote an invariant');
  assert.equal(findingOutOfScope({ ...f, file: 'nowhere/declared.txt' },
    { declaredGlobs: ['scripts/**'] }), null,
    'an undeclared path must not demote an invariant either');

  // The same finding on a non-invariant basis IS demotable — otherwise the exemption is doing
  // nothing and the test would pass on a broken implementation.
  assert.match(findingOutOfScope({ ...f, basis: 'convention' },
    { generatedGlobs: ['.claude/reviews/**'] }) ?? '', /generated glob/);
});

test('a file matching no declared glob is demoted, and an unknown surface demotes nothing', () => {
  const f = { file: 'CLAUDE.template.md', line: 1, basis: 'convention' };
  assert.match(findingOutOfScope(f, { declaredGlobs: ['scripts/**', 'tests/**'] }) ?? '',
    /matches no declared glob/);
  assert.equal(findingOutOfScope({ file: 'scripts/x.mjs', basis: 'convention' },
    { declaredGlobs: ['scripts/**'] }), null);

  // FAILS SAFE. No declared surface means the caller could not say what is in scope, and then
  // nothing is demoted — failing open would let a contract that did not load quietly stop gating
  // the entire repository.
  assert.equal(findingOutOfScope(f, { declaredGlobs: null }), null);
  assert.equal(findingOutOfScope(f, { declaredGlobs: [] }), null);
});

// The finding that started this said "outside source_globs and doc_paths", omitting test_globs.
// Applied literally that demotes EVERY finding about test code — measured: 3 of 65 groups on the
// 2026-09-06 sweep, all of them tests/ — silencing the review that catches a test asserting nothing.
test('the declared surface includes test_globs, or test findings stop being gated', () => {
  const surface = declaredSurface({
    source_globs: ['scripts/**'], test_globs: ['tests/**'], doc_paths: ['CLAUDE.md'],
    generated_globs: ['.claude/reviews/**'],
  });
  assert.ok(surface.includes('tests/**'), 'test code is reviewed, so it is part of the declared surface');
  assert.equal(surface.includes('.claude/reviews/**'), false,
    'generated paths have their own branch and their own message: "generated" and "undeclared" are different facts');
});

// readExcerpt is what makes the doctrine's promise real. It is a WINDOW, never the file: the egress
// rule sanctions "the specific excerpt under dispute, never the whole repository", and a reviewer
// that must be sent something should be sent the least that answers the question.
test('readExcerpt returns a numbered window, marks the line, and refuses to escape the repo', async () => {
  const { readExcerpt } = await import('../scripts/io/excerpt.mjs');
  const root = repo();
  try {
    fs.writeFileSync(path.join(root, 'scripts', 'real.mjs'),
      Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n'));

    const e = readExcerpt({ repoRoot: root, file: 'scripts/real.mjs', line: 30, radius: 3 });
    assert.equal(e.ok, true);
    assert.deepEqual([e.from, e.to, e.of], [27, 33, 60]);
    assert.match(e.body, /30 > line 30/, 'the cited line must be marked so a ruling can point at it');
    assert.equal(e.body.includes('line 26'), false, 'a window, not the file');

    // Containment: the coordinates come from model output, so they may not leave the repository.
    const out = readExcerpt({ repoRoot: root, file: '../../.ssh/config', line: 1 });
    assert.equal(out.ok, false);
    assert.match(out.why, /outside the repository/);

    // An unreadable file is a NAMED gap — the prompt says so, so the tie-breaker can decline.
    const gone = readExcerpt({ repoRoot: root, file: 'scripts/nope.mjs', line: 1 });
    assert.equal(gone.ok, false);
    assert.match(gone.why, /could not read/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CONTAINMENT WAS LEXICAL. `path.resolve` collapses `..` and consults nothing, so an
// in-repository symlink (or Windows junction) pointing outside passed validation, entered
// reconciled.md, and could direct a later bypassPermissions edit at a file outside the tree under
// review. Found independently by security-audit and panel-codex-security (G-25/G-26) against the
// control this module's own header calls load-bearing.
test('containment follows links, and an unresolvable path fails closed', () => {
  const root = repo();
  try {
    const outside = path.join(path.dirname(root), 'outside-secret.txt');
    fs.writeFileSync(outside, 'SECRET\n');
    let linked = false;
    try {
      fs.symlinkSync(outside, path.join(root, 'scripts', 'link.txt'));
      linked = true;
    } catch { /* symlinks need privilege on Windows; the ordinary paths are still asserted below */ }

    if (linked) {
      const why = errs({ file: 'scripts/link.txt', line: 1 }, root);
      assert.ok(why.some((w) => /through a link/.test(w)),
        'a link out of the repository must be refused, not admitted because its spelling looks inside');
    }

    // Always asserted: an ordinary in-repo file still passes, so the new check cannot be satisfied
    // by refusing everything.
    assert.deepEqual(errs({ file: 'scripts/real.mjs', line: 1 }, root), []);
    fs.rmSync(outside, { force: true });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the excerpt reader applies the same link check, because it egresses what it reads', () => {
  // It lives in its own module now (G-27) — finding-scope owns the checks every finding must pass,
  // not prompt assembly — but it must still IMPORT the one containment owner rather than grow a
  // second copy of the rule.
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'lib', 'excerpt.mjs'), 'utf8');
  assert.match(src, /import \{[^}]*escapesAfterRealpath[^}]*\} from '\.\/finding-scope\.mjs'/,
    'one owner of "may this path be read", imported, never re-implemented');
  const fn = src.slice(src.indexOf('export function readExcerpt'));
  assert.match(fn, /escapesAfterRealpath/,
    'readExcerpt sends what it reads to a third-party cloud, so a link out of the tree is an egress');
});

// THE EXCERPT READER RE-DERIVED GLOB MATCHING, AND THE COPY FAILED OPEN (G-23).
//
// `underGlob` split a glob on its first `*` and prefix-compared the directory part. A `**/*.ext`
// glob has no directory part, so the derived base was empty and the match was false in both
// directions at once: a generated file matched only by `**/*.min.js` was NOT refused and went to a
// third-party cloud, while a test file declared by `**/*.test.mjs` WAS refused as outside the review
// surface. coveredByGlobs — the matcher the rest of the framework already uses for exactly this
// vocabulary — gets both right, including the G-16 rule that a trailing `*.ext` in a prefix glob is
// part of the declaration.
test('the excerpt reader refuses a generated file matched only by a suffix glob', async () => {
  const { readExcerpt } = await import('../scripts/io/excerpt.mjs');
  const root = repo();
  try {
    const body = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    fs.writeFileSync(path.join(root, 'scripts', 'bundle.min.js'), body);
    fs.writeFileSync(path.join(root, 'scripts', 'thing.test.mjs'), body);

    // FAIL-OPEN HALF: generated, and the only glob naming it has no directory part.
    const gen = readExcerpt({
      repoRoot: root, file: 'scripts/bundle.min.js', line: 5, generatedGlobs: ['**/*.min.js'],
    });
    assert.equal(gen.ok, false, 'a generated file is not ours to send, however the glob is spelled');
    assert.match(gen.why, /generated glob/);

    // FAIL-CLOSED HALF: declared by the same shape of glob, and refused as undeclared. Harmless
    // next to the egress, and it silently blinds the tie-breaker on every test-file dispute.
    const dec = readExcerpt({
      repoRoot: root, file: 'scripts/thing.test.mjs', line: 5, declaredGlobs: ['**/*.test.mjs'],
    });
    assert.equal(dec.ok, true, 'a declared file must be excerptable, or the tie-break cannot see it');

    // The declared-surface refusal still works for a file nothing declares — the fix must not be
    // "match everything", which would pass both assertions above.
    const off = readExcerpt({
      repoRoot: root, file: 'scripts/thing.test.mjs', line: 5, declaredGlobs: ['docs/**'],
    });
    assert.equal(off.ok, false);
    assert.match(off.why, /outside the declared review surface/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the excerpt reader imports the glob matcher rather than carrying a second one', () => {
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'lib', 'excerpt.mjs'), 'utf8');
  // The matcher's owner moved to lib/contract-glob.mjs (contract-glob-grammar stage 3); the claim is unchanged.
  assert.match(src, /import \{[^}]*matchesAnyGlob[^}]*\} from '\.\/contract-glob\.mjs'/);
  assert.doesNotMatch(src, /split\('\*'\)/,
    'splitting a glob on its first star inline is the defect, not the spelling of it');
});

// THE SAME LEXICAL-CONTAINMENT DEFECT, IN THREE MORE PLACES. Fixing it for findings left it in
// every other path that decides where the framework reads or writes (G-33, G-34, G-35).
test('containment has ONE owner, and the paths that write or walk use it', () => {
  const scope = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'lib', 'finding-scope.mjs'), 'utf8');
  assert.match(scope, /export function escapesAfterRealpath/,
    'the check must be exported, or the next caller writes a fourth lexical copy');

  // reviews_dir decides where every artifact of every run LANDS. A symlinked one passed the string
  // test and would have put the whole run outside the repository under review.
  const newRun = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'new-run.mjs'), 'utf8');
  // `escapesBeforeCreate` since G-32: the realpath check was guarded by `fs.existsSync(reviewsDir)`,
  // which skipped it in exactly the case that matters — a nonexistent directory beneath an
  // in-repository junction, which mkdirSync then follows straight out of the tree. Still the one
  // owner, still imported, and now reached whether or not the path exists yet.
  //
  // BOUND TO WHICHEVER CONTAINER ACCEPTED THE PATH, not to repoRoot. Run directories now default out
  // of the reviewed tree into quorate's own home, so `reviews_dir` is allowed inside either one --
  // and checking an in-home path for escape from the REPOSITORY would pass everything and protect
  // nothing. The container that accepted it is what it must not escape from.
  assert.match(newRun, /escapesBeforeCreate\(reviewsAllowed\.container, reviewsDir\)/);
  assert.ok(!/escapesBeforeCreate\(repoRoot, reviewsDir\)/.test(newRun),
    'binding the check to repoRoot is now the defect: it is not the boundary an out-of-tree reviews '
    + 'root was accepted against');
  assert.ok(!/fs\.existsSync\(reviewsDir\) && escapesAfterRealpath/.test(newRun),
    'guarding the link check on existence is the defect, not the spelling of it');
  // AND THE CONTAINER MUST EXIST FIRST. escapesBeforeCreate resolves the nearest EXISTING ancestor,
  // so a container that does not exist yet puts that ancestor ABOVE it and every path 'escapes'.
  // Always true of repoRoot; false of quorate's home on first use, where it refused every run for a
  // link that was not there.
  assert.match(newRun, /mkdirSync\(reviewsAllowed\.container/,
    'the boundary has to exist before a path can be tested for escaping it');
});

// statSync FOLLOWS symlinks, so the worktree walker treated a directory link as a directory: one
// pointing at a parent recurses until the stack dies, and one pointing outside folded foreign files
// into the hash that decides whether the reviewed tree moved (G-33).
test('the worktree walker does not follow directory links and never revisits a real path', async () => {
  const { worktreeSha } = await import('../scripts/io/worktree.mjs');
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'io', 'worktree.mjs'), 'utf8');

  assert.match(src, /fs\.lstatSync/, 'lstat, or a directory link is walked as a directory');
  assert.match(src, /if \(visited\.has\(real\)\) return;/, 'a cycle must terminate');

  // ONE set across all scope entries: two entries can name overlapping directories, and hashing a
  // file twice would make the sha depend on how the scope was SPELLED rather than on the tree.
  const root = path.join(import.meta.dirname, '..');
  assert.equal(
    worktreeSha({ repoRoot: root, paths: ['scripts', 'scripts/lib'], excludeDir: null }),
    worktreeSha({ repoRoot: root, paths: ['scripts'], excludeDir: null }),
    'an overlapping scope must hash identically to the scope that contains it');
});

// THE G-43 WORKTREE FIX KILLED EVERY PANEL ARM, AND ONLY A SWEEP COULD SHOW IT.
//
// Moving the arms into a detached worktree stopped them reading the run's own evidence tree — and
// external-review's containment check asks `git rev-parse --show-toplevel`, which answers "the tree
// I am standing in". From the worktree that is `<quorateHome>/arms/<repo key>/<run-id>/<random>`, while the run directory
// lives in the main checkout, so the check read the run's own directory as foreign: six arms
// DEGRADED in 105 ms each, exit 2, before any vendor call, and the cross-family half of the review
// simply absent. The offline suite could not see it — it stops before every spawn — and the fix and
// the check were committed in the same pass.
//
// A linked worktree IS the same repository, and `--git-common-dir` is where git says so.
//
// Since arms-read-surface the arms' directory is a repository OF ITS OWN (a snapshot), so an arm
// spawned there would have its run directory refused as outside "this repository" — the G-43 failure
// again. external-review therefore stays in the operator's repository and starts the reviewer in
// --surface. This test holds that arrangement: containment passes from the repository with a
// standalone --surface, and a foreign run directory is still refused.
test('containment passes with a standalone --surface and still refuses a foreign tree', () => {
  // BEHAVIOURAL, NOT A SOURCE GREP (G-44, G-45). The first version of this test asserted that
  // certain substrings appeared in a slice of external-review.mjs — so an implementation that kept
  // every asserted spelling and derived the root wrongly stayed green while every panel arm died at
  // exit 2 again. The commit's premise, that a grep was "what the suite CAN reach", was false: the
  // containment check runs and die()s BEFORE any vendor call, so the whole behaviour is reachable
  // offline for the price of one process spawn.
  const runDir = repoRunDir({ runId: 'containment-wt', prefix: 'quorate-wtc-' });
  const wt = path.join(os.tmpdir(), `quorate-wt-test-${process.pid}`);
  fs.writeFileSync(path.join(runDir.dir, 'run.json'),
    JSON.stringify({ run_id: path.basename(runDir.dir) }));

  fs.mkdirSync(wt, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: wt });   // a repository of its own, like the snapshot
  try {

    // FROM THE REPOSITORY, with the reviewer pointed at a STANDALONE --surface: an arm spawned from
    // inside that surface is the exact shape that killed all six arms (G-43) — the run dir is not
    // under its `git rev-parse --show-toplevel`.
    // SCRUBBED ENVIRONMENT, like every other spawn in this suite (G-35, contract-audit + code-audit).
    // A bare spawnSync inherits GRAPH_NODE_DEPTH from whatever launched the suite, and at depth 1
    // external-review aborts at its §8 guard hundreds of lines before the containment check — so
    // this test, written precisely because its predecessor was a source grep that could not go red,
    // could not go red either. It had replaced one unexercised check with another. The cwd is the
    // repository, which is the whole point, so only the environment is borrowed.
    // QUORATE_HOME is the suite's (run-dir-descendants.plan.md stage 3): external-review now admits its --run-dir before
    // anything else, and the run sits under the suite's home, so with the operator's home it was refused there. It used
    // to pass only because the prompt check came first and the run was never admitted at all.
    const scrubbed = { ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, QUORATE_HOME: TEST_HOME };
    const fromWorktree = spawnSync(process.execPath, [
      path.join(REPO_ROOT, 'scripts', 'external-review.mjs'),
      '--run-dir', runDir.dir, '--node-id', 'wtprobe', '--reviewer', 'codex',
      '--surface', wt,
    ], { cwd: REPO_ROOT, encoding: 'utf8', env: scrubbed });
    assert.ok(!/is outside this repository/.test(fromWorktree.stderr ?? ''),
      `an arm reading a standalone surface had its own run refused: ${(fromWorktree.stderr || '').slice(0, 300)}`);
    // It still exits non-zero — no --prompt-file — which is the point: it got PAST containment to a
    // different, honest complaint.
    assert.match(fromWorktree.stderr ?? '', /--prompt-file is required/);

    // And a genuinely foreign directory is still refused, from that same cwd.
    const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-foreign-'));
    try {
      fs.writeFileSync(path.join(foreign, 'run.json'), JSON.stringify({ run_id: path.basename(foreign) }));
      // A prompt file, because `--prompt-file is required` is checked BEFORE containment — without
      // one this dies for a reason that has nothing to do with what is under test. It still never
      // reaches a vendor: containment die()s several hundred lines above the spawn.
      const promptFile = path.join(foreign, 'p.md');
      fs.writeFileSync(promptFile, 'review this');
      const out = spawnSync(process.execPath, [
        path.join(REPO_ROOT, 'scripts', 'external-review.mjs'),
        '--run-dir', foreign, '--node-id', 'wtprobe', '--reviewer', 'codex',
        '--prompt-file', promptFile, '--surface', wt,
      ], { cwd: REPO_ROOT, encoding: 'utf8', env: scrubbed });
      assert.equal(out.status, 2);
      // Refused by admission now, which runs first (stage 3), or by the containment check after it: either names it.
      assert.match(out.stderr ?? '', /is outside this repository|neither inside the repository under review/);
    } finally { fs.rmSync(foreign, { recursive: true, force: true }); }
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(runDir.base, { recursive: true, force: true });
  }
});

// ONE ROOT MUST DECIDE BOTH CHECKS (G-45, contract-audit).
//
// The lexical test ran against ANY root and the link test against ANY root, independently — so a
// path could pass the first because root A contains its spelling and the second because root B
// contains its realpath, with no root ever containing both. The comment claimed "the link check
// applies to whichever root contained it", which is the right rule and was not the code.
test('the link check applies to the root that lexically contained the path', () => {
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'external-review.mjs'), 'utf8');
  const block = src.slice(src.indexOf('const lexicalRoot ='), src.indexOf('let runId ='));
  // `.native` since CI run 43281517496: the JS realpath kept an 8.3 short target, so a link inside the home looked outside it.
  assert.match(block, /realRoot = fs\.realpathSync(?:\.native)?\(lexicalRoot\)/,
    'the root resolved through links must be the one that passed the lexical test');
  assert.ok(!/realRoots\.some\(/.test(src),
    'testing each half against any root lets two different roots satisfy one path');
});

// THE ARMS' WORKTREE OUTLIVED THE RUN THAT MADE IT (G-32, code-audit).
//
// Teardown sat at exactly one top-level call site, reached only when the fan-out AND the panel both
// settled normally. The SIGINT/SIGTERM handler calls process.exit(130), and runBudgetedPool/runPool
// RETHROW a failed worker — both leave before that line. A leaked worktree stays registered in
// .git/worktrees and the next `git worktree add` inherits the mess.
//
// Not hypothetical: stopping a sweep by hand left exactly this behind, and it needed
// `git worktree remove --force` before the next run could start.
test('the panel worktree is torn down on every path out of the orchestrator', () => {
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'run-graph.mjs'), 'utf8');

  assert.match(src, /function tearDownPanelWorktree\(\)/, 'one owner, callable from each path');
  // THE PATHS OUT ARE io/stop-on-exit.mjs's since stopping-a-child stage 3, and its teardown — on a signal, on an uncaught
  // failure (the rethrown-worker path no explicit call reaches), and on any other exit, each BEFORE the exit — is driven
  // in regression-stop-on-exit with a real process. What stays here is the one wiring line: run-graph hands it this
  // teardown.
  assert.match(src, /stopHeldOnExit\(\{[\s\S]{0,200}?teardown: tearDownPanelWorktree/,
    'the arms\' checkout is not what the orchestrator tears down on the way out');

  // BOTH external reviewers get the contained surface, not just the arms. The tie-break spawn stood
  // in the repository root — the same defect as the arms, in the sibling call site — while
  // capabilities.mjs declares panelReadSurface the owner of "what directory a third-party reviewer
  // is pointed at". Consulting it for one of two external spawns is how the two came apart.
  assert.equal((src.match(/'--surface', armSurface\.cwd/g) ?? []).length, 2,
    'the arms and the tie-breaker are both third-party readers and both take the same surface');
  // external-review itself runs in the repository (its containment needs that); the JUDGE is started
  // in --surface, so what it reads is the arms' directory, never the tree holding the run.
  const tb = src.slice(src.indexOf("'--mode', 'tie-break'"), src.indexOf("'--mode', 'tie-break'") + 2500);
  assert.match(tb, /'--surface', armSurface\.cwd/,
    'the adjudicator must not read a tree holding the run it is adjudicating');

  // And the checkout outlives the barrier, because the tie-break runs inside it.
  assert.ok(src.indexOf('NOT TORN DOWN HERE ANY MORE') < src.indexOf("console.log('tie-break rulings appended"),
    'freeing it before the barrier leaves the adjudicator nowhere contained to stand');

  // Idempotence is what makes three call sites safe: the guard clears the handle before removing,
  // so a throw inside the removal cannot leave a retry loop behind.
  const fn = src.slice(src.indexOf('function tearDownPanelWorktree()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /if \(!panelWorktree\) return;/);
  assert.ok(body.indexOf('panelWorktree = null') < body.indexOf('fs.rmSync('),
    'clear the handle before the removal, or a throw re-enters with the same path');
});
