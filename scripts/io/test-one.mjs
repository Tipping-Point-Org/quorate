// What only I/O can tell lib/test-one.mjs about a file a node asks to run (remediation-verification.plan.md, stage 1):
// git's file list for the repository (tracked, plus untracked files that are not ignored, so an ignored tree such as
// .sandbox/ is never a target), the contract's classification, and whether the path leads out through a link.
import path from 'node:path';
import { gitSync } from './git.mjs';
import { classifyPath } from '../lib/finding-scope.mjs';
import { escapesAfterRealpath } from './finding-scope.mjs';

export function testOneFacts(repoRoot, contract) {
  const r = gitSync(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30,
  });
  const listed = new Set(r.status === 0 ? String(r.stdout).split('\0').filter(Boolean) : []);
  return {
    // Exact, stated (classifyPath requires the flag): the target must also be in `listed`, git's own spelling.
    classify: (p) => classifyPath(p, contract ?? {}, { caseInsensitive: false }),
    listed,
    linksOut: (p) => escapesAfterRealpath(repoRoot, path.join(repoRoot, p)),
  };
}
