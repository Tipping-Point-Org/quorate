// THE ONE PLACE lib/ MAKES A PATH ABSOLUTE — and it refuses to guess (G-15 of
// 20260925-015614-platform-review).
//
// `path.resolve()` of a relative path reads the process working directory. That is an ambient read,
// the same one `process.cwd()` makes, spelled so it passes for a string operation: quorateHome
// resolved a relative QUORATE_HOME that way, and several decisions defaulted a missing root to `'.'`
// and let the working directory fill it in. ARCHITECTURE §2 says the pure layer's inputs arrive as
// parameters; a path the caller did not make absolute is a missing parameter, so this throws, naming
// what was missing, instead of resolving it.
//
// The lock test (tests/regression-lib-takes-io.test.mjs) refuses `path.resolve(` anywhere else in
// lib/, so this file is the only one that may call it, and it only ever calls it on an absolute path.
//
// One residual, stated: on Windows a ROOT-relative path such as `\\work\\x` is `path.isAbsolute`, and
// resolving it takes the drive letter from the working directory. Real callers pass drive-qualified
// paths; the tests' fixture paths are the only root-relative ones.
import path from 'node:path';

/** `p`, normalised, if it is absolute; otherwise an error naming `what`. */
export function absolute(p, what) {
  const s = typeof p === 'string' ? p.trim() : '';
  if (!s || !path.isAbsolute(s)) {
    throw new Error(`${what}: an absolute path is required, got ${JSON.stringify(p)} — lib/ does not `
      + 'resolve a relative path against the working directory (make it absolute where it is read)');
  }
  return path.resolve(s);
}

/** `parts` resolved from the absolute `base` — path.resolve's semantics, without the working directory. */
export function resolveFrom(base, what, ...parts) {
  return path.resolve(absolute(base, what), ...parts.map((x) => String(x ?? '')));
}
