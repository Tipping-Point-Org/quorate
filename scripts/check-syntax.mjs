#!/usr/bin/env node
// check-syntax.mjs — the build step for a project that has no build step.
//
// `commands.build` in the contract is a BARRIER check: a failing build aborts the run, because
// every later finding would reason about code the compiler already rejected. An interpreted project
// has no compiler, and the temptation is to leave the key empty — but empty means UNBUILT, which
// caps every gate at RISK forever, and a verification system that can never report PASS on itself
// cannot tell "clean" from "broken".
//
// Parsing is the honest equivalent. `node --check` runs the same parser the runtime does and
// catches exactly the class the barrier exists to catch: source that cannot execute at all. It does
// not type-check, and it does not resolve imports — both are named in the contract rather than
// implied by this passing.
//
// NO GRAPH_NODE_DEPTH GUARD: this starts no graph work. See shared/disk-first-protocol.md §8.
//
// Exit codes: 0 every file parses · 1 at least one did not · 2 nothing was found to check.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// `.sandbox` holds a CLONED CONSUMER PROJECT (see CLAUDE.md), gitignored and not this repository's
// source. Parsing another project's JavaScript in this repository's build makes their syntax errors
// abort our runs, and it is the build's own contract that it parses "every .mjs and .js file" of the
// tree under review — the fixture is not that tree.
const SKIP = new Set(['node_modules', '.git', '.claude', '.sandbox']);

// Directories this walk could not read. NAMED, never silent: an unreadable directory means the
// build's claim shrank, and a claim that shrank without saying so is the failure this project is
// about. They are reported at the end and do not fail the run.
const unreadable = [];

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    // A BARRIER MUST NOT DIE OF A PERMISSION (G-10). This threw, and I-50 makes a failing build a
    // barrier that ABORTS THE RUN AND SPAWNS NOTHING — so one unreadable directory anywhere under
    // the repository root killed every review before it started. Observed: EPERM on
    // `.sandbox/story-pipeline/.pytest_cache`, a cache directory in a gitignored test fixture that
    // has nothing to do with whether this repository's source parses.
    unreadable.push(`${path.relative(ROOT, dir) || '.'} (${e.code ?? e.message})`);
    return out;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.mjs') || e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// `.claude/hooks` is skipped by the walk above (the whole `.claude` tree is), so it is added back
// explicitly — those files are declared source and a syntax error in a git hook fails a commit.
const files = walk(ROOT);
const hooks = path.join(ROOT, '.claude', 'hooks');
if (fs.existsSync(hooks)) files.push(...walk(hooks));

// Zero files is a failure, not a pass. A glob or a walk that matches nothing reports success in
// every tool that does not check — the same way `node --test` exits 0 for a glob matching no files,
// which let this repository claim a passing suite having run no tests at all.
if (!files.length) {
  console.error('check-syntax: no .mjs or .js files found — the walk is broken, not the code');
  process.exit(2);
}

// ONE PROCESS PER FILE, MEASURED AND DECLINED (G-10). `node --check` is the parser the runtime
// actually uses, which is the whole claim this check makes; parsing in-process with a different
// parser would weaken it, and batching files into fewer child processes trades that guarantee for
// time this does not spend — the full walk of this repository costs 3.9 seconds, inside a review
// measured in tens of minutes. Revisit for a tree where the number is minutes, not seconds.
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad++;
    console.error(`FAIL ${path.relative(ROOT, f)}`);
    console.error((r.stderr ?? '').trim().split('\n').slice(0, 3).map((l) => `     ${l}`).join('\n'));
  }
}

// Said out loud, in the build's own output, so a shrunken claim is visible where the claim is made.
for (const d of unreadable) console.error(`check-syntax: could not read ${d} — not parsed`);
console.log(`check-syntax: ${files.length - bad}/${files.length} file(s) parse` +
  (unreadable.length ? ` (${unreadable.length} director${unreadable.length === 1 ? 'y' : 'ies'} unreadable, named above)` : ''));
process.exit(bad ? 1 : 0);
