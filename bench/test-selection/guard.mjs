// guard.mjs — the measurement scripts mutate and run files in the directory they are given, so they refuse any
// directory isolated.mjs did not make. On 2026-10-27 a `cd` into the sandbox failed silently and ground-truth.mjs ran
// with --repo naming the operator's own checkout: it mutated eight committed files there one at a time and restored them
// from git. Nothing was lost, and nothing may depend on a command line being typed right again.
import fs from 'node:fs';
import path from 'node:path';

export function requireIsolated(repo) {
  if (!fs.existsSync(path.join(repo, '.ts-isolated'))) {
    throw new Error(`${repo} is not a clone made by bench/test-selection/isolated.mjs (no .ts-isolated marker); `
      + 'refusing to mutate or run anything there. Run through isolated.mjs.');
  }
}
