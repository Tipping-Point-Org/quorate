#!/usr/bin/env node
// branch-guard.mjs — refuse a commit made directly on the default branch.
//
// WHY THIS IS A HOOK AND NOT A RULE. The instruction "branch before committing" was stated, agreed,
// and then broken about twenty times in one day — not once through disagreement, but because each
// individual commit looked too small to be the one that needed a branch. That is the failure mode
// this project already wrote down: a rule that must be remembered gets forgotten; a check that
// fires does not. A reminder would have produced twenty receipts.
//
// It is NOT a quality gate, and deliberately separate from the ones that are. pre-push runs the
// contract's declared commands and answers "is this code broken"; this answers "is this the branch
// you meant", which is a question about intent that no test can ask. Keeping them in one file would
// mean a project that wants one has to take the other.
//
// BLOCKS, because the non-blocking alternative is exactly what was measured to fail. `--no-verify`
// remains the escape hatch — one that has to be typed, which is the whole difference between a
// decision and a habit.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const git = (...args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

const root = git('rev-parse', '--show-toplevel');
if (!root) process.exit(0);   // not a repository: nothing to guard

// DETACHED HEAD IS NOT THE DEFAULT BRANCH. A rebase, a bisect, or a worktree checked out at a
// commit all report no branch, and refusing there would block work that is by definition not on
// master.
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (!branch || branch === 'HEAD') process.exit(0);

/**
 * The branch this repository treats as its trunk.
 *
 * Asked of the REMOTE first, because that is the answer that does not depend on local convention:
 * `origin/HEAD` is what the host says the default is. Falling back to the common names only when
 * there is no remote to ask — a guard that guesses wrong in the permissive direction protects
 * nothing, and one that guesses wrong in the strict direction blocks a feature branch someone
 * happened to call `main`.
 */
function defaultBranch() {
  const head = git('symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD');
  if (head) return head.replace(/^refs\/remotes\/origin\//, '');
  for (const name of ['master', 'main']) {
    if (git('rev-parse', '--verify', '--quiet', `refs/heads/${name}`)) return name;
  }
  return null;
}

const trunk = defaultBranch();
if (!trunk || branch !== trunk) process.exit(0);

// An opt-out that lives in the repository, for a project that genuinely commits to its trunk. It is
// a file rather than an env var so the decision is visible to everyone who clones it.
if (fs.existsSync(path.join(root, '.claude', 'hooks', 'allow-trunk-commits'))) process.exit(0);

process.stderr.write(
  `\nbranch-guard: refusing a commit directly on '${branch}', this repository's default branch.\n\n`
  + `    git switch -c <a-branch-name>    # then commit; the staged changes come with you\n\n`
  + '  This is a question about intent, not about whether the code works — the checks that answer\n'
  + '  that run on push. It blocks because the reminder version of it was measured to fail: the\n'
  + '  instruction was stated, agreed, and then broken about twenty times in one day, each commit\n'
  + '  looking too small to be the one that needed a branch.\n\n'
  + '  Deliberate trunk commit: `git commit --no-verify`, or create\n'
  + '  .claude/hooks/allow-trunk-commits to turn this off for the repository.\n',
);
process.exit(1);
