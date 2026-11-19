// The framework's mount as a check input (remediation-verification.plan.md, stage 4).
//
// The runner checks a commit candidate in the working tree. When the framework running those checks is MOUNTED INSIDE the
// repository as a repository of its own (a consumer's submodule, or quorate's pinned dev worktree), an uncommitted change
// in it is read by the checks and carried by no commit, so it refuses. A framework that IS the repository is covered by
// the tree guard's own classes, and one outside the repository is not part of what the commit is checked against.

import path from 'node:path';
import { gitSync } from './git.mjs';
import { isWithin, rootSpelling } from './finding-scope.mjs';
import { statusEntriesV2 } from '../lib/remediation-chain.mjs';

// Returns `[{ path, why }]`, empty when the mount is clean or the rule does not apply.
export function frameworkMountRefusals(repoRoot, frameworkRoot) {
  // As the filesystem spells them (canonicalSpelling, links kept): git reports its toplevel long, so under an 8.3 short
  // spelling (a Windows runner's TEMP) a changed mount was read as no repository of its own and refused nothing (CI run
  // 43281517496).
  // AND ON REAL PATHS (rootSpelling; ci-path-identity.plan.md stage 1c): git reports its toplevel with the links above it
  // followed, so on macOS (/var to /private/var) a changed mount was read as no repository of its own and refused nothing,
  // failing open (CI runs 44220656481, 44240829385). The repository and the mount are both roots here.
  const repo = rootSpelling(path.resolve(repoRoot));
  const fw = rootSpelling(path.resolve(frameworkRoot));
  if (fw === repo || !isWithin(repo, fw)) return [];
  const git = (args) => gitSync(args, { cwd: fw, encoding: 'utf8' });
  const top = git(['rev-parse', '--show-toplevel']);
  // Not a repository of its own: its files are the enclosing repository's, which the guard already classifies.
  if (top.status !== 0 || rootSpelling(path.resolve(top.stdout.trim())) !== fw) return [];
  const st = git(['status', '--porcelain=v2', '-z', '--untracked-files=all']);
  const rel = path.relative(repo, fw).split(path.sep).join('/');
  if (st.status !== 0) return [{ path: rel, why: `the framework mount's own git status failed: ${String(st.stderr ?? '').trim()}` }];
  const e = statusEntriesV2(st.stdout);
  return [...e.files, ...e.refused.map((r) => r.path)]
    .map((p) => ({ path: `${rel}/${p}`, why: 'the framework mount the checks run is changed, and no commit carries it' }));
}
