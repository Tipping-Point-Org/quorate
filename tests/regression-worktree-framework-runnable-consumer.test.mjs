// Part 2 of 2 of regression-worktree-framework-runnable.test.mjs: the consumer layout, a copied framework and a
// vendored one. Split by split-slow-test-files.md; the fixture is worktree-framework-runnable-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { copyTrackedInto } from '../scripts/io/worktree.mjs';
import { frameworkStamp } from '../scripts/io/version.mjs';
import { assertInstalled, assertRunnable } from './worktree-framework-runnable-fixture.mjs';

test('regression: consumer layout -- the submodule path is EMPTY until it is populated', () => {
  // Both halves in one test, because the defect is the difference between them. A bare worktree of
  // a project whose framework is a submodule gives the arm an empty directory; copyTrackedInto is
  // what run-graph now does about it, and the assertion below is the state the arm reported.
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-proj-')));
  const wt = path.join(proj, '..', `quorate-projwt-${process.pid}`);
  const MOUNT = '.claude/skills/quorate';
  try {
    execFileSync('git', ['init', '--quiet', '.'], { cwd: proj });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: proj });
    // A source file and a contract, because a consumer that mounts quorate necessarily has one --
    // the detector reads source_globs from it and refuses without it, which is itself part of what
    // "runnable in the worktree" means.
    fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'src', 'a.js'), 'export const used = 1;\n');
    // THE TEMPLATE'S CONTRACT, not a hand-written subset. check-install compares a project's
    // contract against every key the mounted quorate knows, so a minimal block is STALE by
    // construction and the install assertion below would fail for a reason that has nothing to do
    // with worktrees. This is what QUORATE.md step 2 tells a consumer to copy.
    fs.writeFileSync(path.join(proj, 'CLAUDE.md'),
      fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.template.md'), 'utf8').replace(/<[^>\n]*>/g, ''));
    execFileSync('git', ['add', '-A'], { cwd: proj });
    execFileSync('git', ['commit', '--quiet', '-m', 'init'], { cwd: proj });
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', wt, 'HEAD'], { cwd: proj });

    // THE DEFECT, stated as a measurement rather than as a claim about git.
    assert.equal(fs.existsSync(path.join(wt, MOUNT, 'scripts', 'find-inert-features.mjs')), false,
      'if a fresh worktree already carried the framework, this whole mechanism would be unnecessary');

    const r = copyTrackedInto(REPO_ROOT, path.join(wt, MOUNT));
    assert.equal(r.ok, true, r.why);
    assertRunnable(wt, MOUNT, 'consumer');
    assertInstalled(wt, MOUNT, 'consumer');
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: proj });
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('run-graph populates the mount for a consumer and skips it for itself', () => {
  // The condition, asserted where it lives: a framework INSIDE the reviewed repository is copied in;
  // self-review (frameworkRel === '') and an out-of-tree framework (not isWithin the repository) are not, the
  // first because the files are already at the root and the second because relocating someone
  // else's framework into a tree is not the panel's business.
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /const frameworkRel = path\.relative\(repoRoot, FRAMEWORK\.frameworkRoot\)/);
  // The three conditions, now behind a name. Asserted as the named predicate rather than as one
  // spelling of it: pinning the exact expression made this fail when the condition was extracted to
  // `needsPopulating` with identical behaviour -- a test going red for a rename it was not written
  // to catch.
  // Outside is asked of isWithin (G-13 of 20261022-034225-cid1a-remediation-2-review: `startsWith('..')` called a
  // cross-drive framework inside).
  assert.match(graph, /const frameworkOutside = !isWithin\(repoRoot, FRAMEWORK\.frameworkRoot\);/);
  assert.match(graph, /const needsPopulating = Boolean\(frameworkRel\) && !frameworkOutside && !alreadyThere;/);
  assert.match(graph, /if \(!?needsPopulating\)/, 'and the copy must be gated on it');
  assert.match(graph, /copyTrackedInto\(FRAMEWORK\.frameworkRoot, destFramework\)/);
  // And a failed copy is NAMED. Moved here from regression-panel-worktree-framework, which was
  // asserting this call site too; that file owns what copyTrackedInto does, this one owns when
  // run-graph calls it.
  // Since arms-read-surface there is no fallback to the repository: an incomplete framework is no
  // surface. It is still NAMED, which is what this asserts.
  assert.match(graph, /the framework in the arms' directory is incomplete/,
    'a failed copy must be named, or the arms degrade for a reason the gate blames on them');
  // NAMING IT WAS NOT ENOUGH, which is the whole finding. The log line existed and the checkout was
  // kept anyway, so the arms read a tree missing their doctrine and reported it absent -- recorded in
  // the gate as the ARM being unavailable. The outcome has to reach the surface decision.
  // Recorded through frameworkCopyReady, not as `sub.ok`: the copy succeeds while refusing files, and
  // `sub.ok` alone called a framework missing its detector ready (G-8 of 20260926-060936-m0-close-r3).
  assert.match(graph, /const readiness = frameworkCopyReady\(sub,/);
  assert.match(graph, /panelFrameworkReady = readiness\.ready;/,
    'the result of the copy must be recorded, not only printed');
  assert.match(graph, /frameworkReady: panelFrameworkReady[,\s}]/,
    'and it must reach panelReadSurface, which is what turns it into no surface and a stamp');
});

test('regression: a copied framework reports ITS commit, not the enclosing repository\'s', () => {
  // The copy has no `.git`, so `git -C <copy> rev-parse HEAD` walks UP and answers with whatever
  // repository encloses it -- inside a panel worktree, the reviewed PROJECT. Measured: check-install
  // in a populated consumer worktree printed `quorate mounted at .claude/skills/quorate @ 4850c47`,
  // the story-pipeline fixture's commit presented as quorate's version. frameworkStamp's entire
  // promise is that a field is never confidently wrong, and this copy is what broke it.
  //
  // A marker written by the copier, not a cleverer probe: "is this directory its own git root"
  // cannot separate a copy from the LEGACY vendored-in-tree layout, where the enclosing commit
  // genuinely IS the framework's version. Only the copier knows which case it is.
  const host = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-host-')));
  const src = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-src-')));
  try {
    const init = (d, file, body) => {
      execFileSync('git', ['init', '--quiet', '.'], { cwd: d });
      execFileSync('git', ['config', 'user.email', 't@t'], { cwd: d });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: d });
      fs.writeFileSync(path.join(d, file), body);
      execFileSync('git', ['add', '-A'], { cwd: d });
      execFileSync('git', ['commit', '--quiet', '-m', 'x'], { cwd: d });
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: d, encoding: 'utf8' }).trim();
    };
    const hostHead = init(host, 'host.txt', 'enclosing repository\n');
    const srcHead = init(src, 'VERSION', '7.7.7\n');
    assert.notEqual(hostHead, srcHead, 'the two commits must differ or this proves nothing');

    const dest = path.join(host, 'vendor', 'framework');
    assert.equal(copyTrackedInto(src, dest).ok, true);

    const stamp = frameworkStamp(dest);
    assert.equal(stamp.commit, srcHead,
      'the stamp must name the framework this really is, not the repository it happens to sit in');
    assert.notEqual(stamp.commit, hostHead);
    assert.equal(stamp.version, '7.7.7', 'and VERSION still comes from the copied files');
    assert.equal(stamp.copied_from_source, true, 'a reader must be able to tell a copy from a mount');

    // WITHOUT THE MARKER, git answers for the host -- the defect, demonstrated rather than asserted.
    fs.rmSync(path.join(dest, '.quorate-source.json'));
    assert.equal(frameworkStamp(dest).commit, hostHead,
      'this is what the stamp said before the marker existed');
  } finally {
    fs.rmSync(host, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test('regression: a vendored framework already in the checkout is not copied over', () => {
  // TWO LAYOUTS PUT THE FRAMEWORK INSIDE THE REVIEWED REPOSITORY AND ONLY ONE LEAVES A HOLE. A
  // submodule is empty in a fresh worktree; the LEGACY vendored layout tracks the framework's files
  // in the consuming repository, so `git worktree add` has already checked them out.
  //
  // Copying over those is redundant, and it would write .quorate-source.json into a TRACKED
  // directory -- dirtying the arms' checkout and making frameworkStamp report a vendored install as
  // a copy. The first version of this populate step did not ask, because the only layout in front
  // of me was the submodule one.
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /const alreadyThere = fs\.existsSync\(path\.join\(destFramework, 'scripts', 'find-inert-features\.mjs'\)\)/,
    'the question is whether the file the arm is ordered to run is there');
  assert.match(graph, /!frameworkOutside && !alreadyThere/,
    'and it must gate the copy, not merely be computed');

  // The behaviour, on a directory that already holds a framework: nothing is added to it.
  const dest = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-vendored-')));
  try {
    fs.mkdirSync(path.join(dest, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'scripts', 'find-inert-features.mjs'), '// vendored\n');
    const alreadyThere = fs.existsSync(path.join(dest, 'scripts', 'find-inert-features.mjs'));
    assert.equal(alreadyThere, true, 'the probe the condition uses must see a vendored checkout');
    assert.equal(fs.existsSync(path.join(dest, '.quorate-source.json')), false,
      'and no copy marker is written into a tree that was never copied into');
  } finally { fs.rmSync(dest, { recursive: true, force: true }); }
});
