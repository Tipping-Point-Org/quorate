// version.mjs — which build of the framework produced a run.
//
// `run.json` records the contract, the base commit, the host and the auth mode, and until now said
// nothing about the orchestrator itself. With one repository that was implicit: the framework was
// the repository. Once it is a submodule shared by several projects, a finding stops being
// reproducible without it — "did this reproduce on the old orchestrator?" has no answer, and two
// projects reporting different verdicts for the same code has no explanation.
//
// Read from the FRAMEWORK's tree, never the reviewed one. Today they are the same checkout and
// every value would match either way; after extraction they diverge, and a stamp that silently
// reported the reviewed project's commit would be worse than no stamp — confidently wrong rather
// than absent.

import path from 'node:path';
import { SOURCE_STAMP } from './framework-source.mjs';
import { requireIo } from './io-param.mjs';

// NO node:fs OR node:child_process HERE (os-platform-adapters stage 3c): the file reads go through the platform
// implementation passed as `io`, and the git queries through its `git`, the engine's one git owner (scripts/io/git.mjs,
// engine-git-env.plan.md stage 1). scripts/io/version.mjs binds both.

const UNKNOWN = 'unknown';

function git(frameworkRoot, args, io) {
  const r = io.git(['-C', frameworkRoot, ...args], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout ?? '').trim() : null;
}

/**
 * Identify the framework build at `frameworkRoot`.
 *
 * Every field degrades to a recorded value rather than throwing: a run must not fail because the
 * framework was installed from a tarball with no git metadata. What must never happen is a field
 * that is confidently wrong, so anything unresolvable is `"unknown"` and visible in the record.
 */
export function frameworkStamp(frameworkRoot, { name = 'quorate', layout = null, io } = {}) {
  requireIo(io, 'frameworkStamp');
  const versionFile = path.join(frameworkRoot, 'VERSION');
  let version = UNKNOWN;
  try {
    const raw = io.fs.readFileSync(versionFile, 'utf8').trim();
    if (raw) version = raw;
  } catch {
    /* left unknown, and recorded as such */
  }

  // A COPIED FRAMEWORK CARRIES ITS SOURCE, because git would answer for somebody else.
  //
  // run-graph populates the framework path inside the panel worktree by COPYING tracked files (a
  // submodule cannot be re-cloned there without a transport). The copy has no `.git`, so
  // `git -C <copy> rev-parse HEAD` walks up and returns the ENCLOSING worktree's commit — the
  // reviewed project's. Measured: check-install inside a populated consumer worktree reported the
  // story-pipeline fixture's commit as quorate's version. This function's entire promise is that a
  // field is never confidently wrong, so the copier writes down what it copied and this reads it.
  //
  // Checked BEFORE asking git, and not as a fallback: git has an answer here, it is just the wrong
  // repository's. A fallback would never fire.
  const marker = (() => {
    try { return JSON.parse(io.fs.readFileSync(path.join(frameworkRoot, SOURCE_STAMP), 'utf8')); }
    catch { return null; }
  })();
  if (marker && typeof marker.commit === 'string') {
    return {
      name,
      version,
      commit: marker.commit || UNKNOWN,
      // The SOURCE's cleanliness at copy time. The copy itself is never edited, so asking git about
      // the copy would answer about the project's worktree again.
      dirty: typeof marker.dirty === 'boolean' ? marker.dirty : null,
      layout,
      // Named, so a reader can tell a mounted framework from one staged into a worktree for the
      // arms. Everything above describes the source; this says the tree is a copy of it.
      copied_from_source: true,
    };
  }

  const commit = git(frameworkRoot, ['rev-parse', 'HEAD'], io) ?? UNKNOWN;

  // Scoped to the framework's own path. A dirty NovaFind working tree says nothing about whether
  // the ORCHESTRATOR that ran was the one at `commit` — and while the two share a checkout, an
  // unscoped check would mark every run dirty for edits to files the framework does not own.
  const porcelain = git(frameworkRoot, ['status', '--porcelain', '--', '.'], io);
  const dirty = porcelain === null ? null : porcelain.length > 0;

  return {
    name,
    version,
    commit,
    // `null` means "could not be determined", which is not the same as `false`. A reader must be
    // able to tell "the framework was clean" from "nobody could check".
    dirty,
    // 'legacy' (vendored in-tree) or 'plugin' (installed alongside). Recorded because it answers,
    // months later, what `commit` even refers to — the consuming project's HEAD, or the framework
    // submodule's. The LABEL and not the absolute path: a machine-specific directory in every run
    // record is noise that also differs between two machines running the identical framework.
    layout,
  };
}

/**
 * True when the stamp is good enough to attribute a finding to a rebuildable state: a real commit,
 * and a tree that was not modified underneath it.
 */
export function stampIsAttributable(stamp) {
  return Boolean(stamp) && stamp.commit !== UNKNOWN && stamp.dirty === false;
}
