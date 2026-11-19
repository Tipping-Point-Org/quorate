// A RULE THAT MUST BE REMEMBERED GETS FORGOTTEN; A CHECK THAT FIRES DOES NOT.
//
// "Branch before committing" was stated, agreed, and then broken about twenty times in one day —
// not through disagreement, but because each individual commit looked too small to be the one that
// needed a branch. That is the same shape as every inert guarantee this project hunts: the
// instruction existed and changed nothing.
//
// It BLOCKS. The non-blocking version of this rule is precisely what was measured to fail, and the
// project's own pre-commit already carries the counter-lesson beside it — "a reminder that can block
// becomes a reminder people disable" — which is why the two checks in that hook are deliberately
// different: each is whichever it can afford to be.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const GUARD = path.join(REPO_ROOT, '.claude', 'hooks', 'branch-guard.mjs');

function repo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-branch-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q', '-b', 'master', '.');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
    git('add', '-A');
    git('commit', '-qm', 'init');
    return fn(dir, git);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const runGuard = (dir) => spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8' });

test('a commit on the default branch is refused, with the way out named', () => repo((dir) => {
  const r = runGuard(dir);
  assert.equal(r.status, 1, 'the default branch must be refused');
  assert.match(r.stderr, /refusing a commit directly on 'master'/);
  assert.match(r.stderr, /git switch -c/, 'a refusal that does not say what to do instead is a wall');
  assert.match(r.stderr, /--no-verify/, 'and the escape hatch must be stated, or people delete the hook');
}));

test('any other branch passes', () => repo((dir, git) => {
  git('switch', '-q', '-c', 'some-work');
  assert.equal(runGuard(dir).status, 0);
}));

test('a detached HEAD is not the default branch', () => repo((dir, git) => {
  // A rebase, a bisect, or a worktree checked out at a commit all report no branch. Refusing there
  // would block work that is by definition not on the trunk — and the arms' own worktree is
  // detached, so this is not hypothetical.
  git('checkout', '-q', '--detach', 'HEAD');
  assert.equal(runGuard(dir).status, 0);
}));

test('`main` is the trunk when it is the trunk, and a branch when it is not', () => repo((dir, git) => {
  // A repository whose ONLY trunk candidate is `main`: refused, because it is the default.
  git('branch', '-m', 'master', 'main');
  assert.equal(runGuard(dir).status, 1, 'main is a default-branch name when nothing says otherwise');

  // The same name, in a repository that also has a real master: `main` is now just a feature
  // branch, and blocking it would stop work for having a common name. Guessing wrong in the strict
  // direction is not the safe direction — it is the annoying one, which is how hooks get deleted.
  git('branch', 'master');
  assert.equal(runGuard(dir).status, 0);
}));

test('the remote decides, when there is a remote to ask', () => repo((dir, git) => {
  // `origin/HEAD` is what the HOST says the default is, and that answer does not depend on local
  // convention — so it is asked first. Here it names `main` while `master` also exists locally,
  // which is exactly the case a name-guess gets backwards.
  git('branch', 'main');
  git('remote', 'add', 'origin', dir);
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

  assert.equal(runGuard(dir).status, 0, 'master is not the trunk when the remote says main is');
  git('switch', '-q', 'main');
  assert.equal(runGuard(dir).status, 1, 'and main is');
}));

test('a project that genuinely commits to its trunk can say so, in the repository', () => repo((dir) => {
  const optOut = path.join(dir, '.claude', 'hooks');
  fs.mkdirSync(optOut, { recursive: true });
  fs.writeFileSync(path.join(optOut, 'allow-trunk-commits'), '');
  assert.equal(runGuard(dir).status, 0,
    'a file, not an env var, so the decision is visible to everyone who clones it');
}));

test('the hook is wired in, and the installer says which half blocks', () => {
  const shim = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'hooks', 'pre-commit'), 'utf8');
  assert.match(shim, /branch-guard\.mjs/, 'shipping a guard nobody runs is the shape this closes');
  assert.match(shim, /node "\$p" \|\| exit 1/, 'it has to propagate the refusal to git');
  // Both layouts, like every other hook here: the framework's own repo and a consumer submodule.
  assert.match(shim, /\.claude\/skills\/quorate\/\.claude\/hooks\/branch-guard\.mjs/);

  const installer = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'hooks', 'install.mjs'), 'utf8');
  assert.match(installer, /BLOCKS on the default branch/,
    'an installer that reports a blocking check as a reminder is why one went uninstalled all day');
});
