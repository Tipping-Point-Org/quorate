// WHAT CAPTURE MAY RUN, IN ONE OWNER (capture-interactive.plan.md stage 4; decision 7-8 of its stage 2: "Read-only applies
// the lens's allow-list unchanged"). The decision lived inline in capture.mjs, the lens front end. The interactive front
// end's `--mode read-only` applies the same list, so it moved here rather than being copied: two copies of a containment
// boundary drift, and the one that drifts is the one nobody is reviewing.
//
// The list: a DECLARED contract command, admitted by exact argv (its whole argv is the declaration, G-5); and a fixed set
// of READ-ONLY inspections, admitted by prefix with their tail checked (lib/forbidden-tail.mjs; `git diff`'s paths kept
// inside the repository, G-4 of 20261030-124823-ciss-stage7; the inert-feature detector exact, taking no tail, G-6). Why
// each rule exists is recorded where it was decided, in capture.mjs's history and the ledger entries it cites.
//
// Pure: `path` arithmetic only, no filesystem. `repoRoot` is the admitted repository; `detectorAbs` is the detector's path
// as capture derives it from its own location (a literal a consumer can create is not a path to our file).
import path from 'node:path';
import { forbiddenTail } from './forbidden-tail.mjs';
import { resolveFrom } from './paths.mjs';

/** The read-only inspections, by argv prefix: the git set, and the inert-feature detector by its derived absolute path. */
export function readOnlyPrefixes(detectorAbs) {
  return [
    ['git', 'diff'], ['git', 'log'], ['git', 'status'], ['git', 'rev-parse'],
    ['git', 'ls-files'], ['git', 'grep'], ['git', 'show'], ['git', 'blame'],
    ['node', detectorAbs],
    ['node', String(detectorAbs).split(path.sep).join('/')],
  ];
}

/**
 * Is `cmd` (an argv) admitted? `declared` is `[{ key, argv }]` from the contract.
 * @returns {{ ok: true, declaredHit: object|null, readOnlyMatch: string[]|null }
 *   | { ok: false, why: string, kind: 'refused-tail' | 'not-listed' }}
 *   `not-listed` is a command that matches nothing, which a caller may still admit by a rule of its own (the lens's
 *   `test_one`); `refused-tail` matched a read-only prefix and is refused outright.
 */
export function admitCommand(cmd, { declared = [], readOnly, repoRoot }) {
  const isPrefix = (allowed) => allowed.every((tok, i) => cmd[i] === tok);
  const exactMatch = (allowed) => allowed.length === cmd.length && allowed.every((t, i) => cmd[i] === t);
  const declaredHit = declared.find((d) => exactMatch(d.argv)) ?? null;
  const readOnlyMatch = readOnly.find(isPrefix) ?? null;
  // An exact declared command is the contract's, admitted as written: the inspection-tail rules are for an undeclared
  // read-only prefix (G-15 of 20261116-001508-ci-review-2).
  if (readOnlyMatch && !declaredHit) {
    const tail = cmd.slice(readOnlyMatch.length);
    if (readOnlyMatch[0] === 'node' && tail.length) {
      return { ok: false, kind: 'refused-tail', why:
        `refusing \`${cmd.join(' ')}\`: the inert-feature sweep is admitted as an exact command and ` +
        `takes no arguments here; '${tail[0]}' would be passed through unchecked by a guard written ` +
        `for git's flags, not node's.` };
    }
    const bad = forbiddenTail(readOnlyMatch[1], tail);
    if (bad) {
      return { ok: false, kind: 'refused-tail', why:
        `refusing \`${cmd.join(' ')}\`: '${bad}' lets a read-only inspection write files, read outside the repository, or ` +
        `launch a program, which is the boundary this allow-list exists to hold (threat model: ` +
        `arbitrary command execution through capture.mjs).` };
    }
    if (readOnlyMatch[0] === 'git' && readOnlyMatch[1] === 'diff') {
      let paths = false; // after `--` every argument is a path, one that starts with `-` included
      const outside = tail.find((t) => {
        const s = String(t ?? '');
        if (!paths && s === '--') { paths = true; return false; }
        if (!s || (!paths && s.startsWith('-'))) return false;
        const rel = path.relative(repoRoot, resolveFrom(repoRoot, 'admitCommand: repoRoot', s));
        return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
      });
      if (outside !== undefined) {
        return { ok: false, kind: 'refused-tail', why:
          `refusing \`${cmd.join(' ')}\`: '${outside}' lies outside the repository, and git diff given such a path reads it ` +
          `in no-index mode, which is the boundary this allow-list exists to hold.` };
      }
    }
  }
  if (!declaredHit && !readOnlyMatch) {
    const permitted = [...declared.map((d) => d.argv), ...readOnly];
    return { ok: false, kind: 'not-listed', why:
      `capture: refusing to execute \`${cmd.join(' ')}\`.\n` +
      `capture.mjs runs only commands declared in the graph_contract, plus read-only git\n` +
      `inspection. It is not a general shell: the permission rule that admits this script is a\n` +
      `prefix match, so anything accepted here bypasses the node deny-list entirely.\n` +
      `Permitted starts: ${permitted.map((p) => p.join(' ')).join(' | ')}` };
  }
  return { ok: true, declaredHit, readOnlyMatch };
}
