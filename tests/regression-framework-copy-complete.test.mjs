// AN UNTRACKED MODULE IS A BROKEN PANEL WORKTREE, and the error blamed the consumer.
//
// `copyTrackedInto` builds the arms' checkout from `git ls-files` — tracked files only, deliberately,
// so a run directory or a stray artifact cannot ride into a worktree the arms read. The consequence
// is that a NEW lib module is invisible to it until the moment it is staged: the copy lands a
// `new-run.mjs` that cannot resolve its own import, and every script in that checkout dies at load.
//
// It happened while splitting lib/project-paths.mjs out of lib/locate.mjs, and what the arm would
// have read was `find-inert-features: could not read the graph_contract block from CLAUDE.md` — a
// true statement about a failed subprocess, attributing it to the project's documentation. The
// consumer-mount test caught it only because that test copies the framework for real.
//
// Two guards, both cheap: every module the engine imports is in the index, and the detector's
// failure names what actually failed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

/** The index, as one call. `ls-files` covers staged-but-uncommitted, which is what copyTrackedInto sees. */
function trackedSet() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
  return new Set(out.split('\0').filter(Boolean).map((p) => p.replace(/\\/g, '/')));
}

test('regression: every module the engine imports is tracked, or the copied framework cannot start', () => {
  const tracked = trackedSet();
  const roots = [path.join(REPO_ROOT, 'scripts'), path.join(REPO_ROOT, 'scripts', 'lib')];
  const files = roots.flatMap((d) => fs.readdirSync(d)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => path.join(d, f)));
  assert.ok(files.length > 20, 'could not enumerate the engine');

  const missing = [];
  let seen = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    // Static imports only: a dynamic one is not resolvable without running the code, and the engine
    // has none. Bare specifiers are node builtins here — this project has zero dependencies.
    for (const m of src.matchAll(/(?:^|\n)\s*import[^'"\n]*['"](\.[^'"]+)['"]/g)) {
      const resolved = path.resolve(path.dirname(file), m[1]);
      const rel = path.relative(REPO_ROOT, resolved).split(path.sep).join('/');
      seen++;
      if (!tracked.has(rel)) missing.push(`${path.relative(REPO_ROOT, file)} imports ${rel}`);
    }
  }
  // A REGEX THAT MATCHES NOTHING PASSES THIS TEST. The engine's scripts import lib modules by the
  // dozen, so a floor here is what keeps the guard from going quietly vacuous if the import syntax
  // or this pattern ever drifts apart.
  assert.ok(seen > 40, `only ${seen} relative imports found across the engine — the pattern stopped matching`);
  assert.deepEqual(missing, [],
    `these imports are not in the git index, so copyTrackedInto builds a panel worktree without them `
    + `and every script in that checkout fails at load:\n  ${missing.join('\n  ')}`);
});

test('regression: the detector says WHAT failed when it cannot read a contract', () => {
  // Run against a directory with no CLAUDE.md: the child exits non-zero for the legitimate reason,
  // and the message must still carry the child's own words and name both possible owners. The old
  // message named one file and one owner, and was wrong about both when the framework copy was the
  // broken thing.
  const dir = fs.mkdtempSync(path.join(REPO_ROOT, '.claude', 'reviews', 'g3-detector-'));
  try {
    const r = spawnSync(process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'find-inert-features.mjs'), '--repo-root', dir],
      { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'a directory with no contract must not report a clean sweep');
    const err = r.stderr ?? '';
    // Named, and since ledger-findings stage 4 the reader's own outcome: "found no contract" by new-run's exit code.
    assert.match(err, /`new-run\.mjs --print-contract` (found no contract|failed)/, 'the child that failed must be named');
    assert.match(err, /this framework copy at /,
      'an incomplete framework copy is the other explanation, and it was the real one once');
    assert.ok(err.includes(dir), 'and the CLAUDE.md it looked for must be identified by path');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// NO SOURCE FILE MAY BE BINARY TO A SEARCH TOOL.
//
// A `git ls-files -z` split was written with a RAW NUL byte in the source instead of the `\0` escape.
// It worked — a raw NUL in a JS string literal is legal — and `grep -rn` then reported
// "Binary file scripts/check-install.mjs matches" and printed nothing, while ripgrep skips such files
// SILENTLY by default. Caught by an unrelated audit whose output had one line reading "Binary file …
// matches" where a match should have been.
//
// The cost is not cosmetic and not hypothetical: this engine's own guards search its source for
// strings — every anchor in the test suite, find-inert-features' documented-identifier sweep,
// check-counted-facts. A file invisible to search is a file whose guards all pass vacuously.
test('regression: no engine source file is binary to a search tool', () => {
  const roots = [path.join(REPO_ROOT, 'scripts'), path.join(REPO_ROOT, 'scripts', 'lib'),
    path.join(REPO_ROOT, 'tests')];
  const files = roots.flatMap((d) => fs.readdirSync(d)
    .filter((f) => f.endsWith('.mjs')).map((f) => path.join(d, f)));
  assert.ok(files.length > 50, `expected the engine and its suite; found ${files.length}`);

  const offenders = [];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    // What makes a file "binary" to grep and ripgrep: a NUL byte anywhere in the scanned prefix.
    if (buf.includes(0)) offenders.push(path.relative(REPO_ROOT, f));
  }
  assert.deepEqual(offenders, [],
    `these files contain a raw NUL and are silently skipped by ripgrep, so every source-searching `
    + `guard over them passes vacuously: ${offenders.join(', ')}. Write \0 as an escape.`);
});
