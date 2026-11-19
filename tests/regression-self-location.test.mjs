// The engine must find its own files without reference to the repository under review.
//
// Written as part of step 1 of docs/plans/framework-extraction.md. Not a bug found in the field —
// a capability that did not exist:
//
//   const scriptsDir = path.join(repoRoot, '.claude/skills/scripts');
//
// `repoRoot` is the tree being reviewed; the engine's location is a different thing. While the
// framework lived inside its only consumer they were the same value, so nothing forced the
// distinction. Three capabilities depend on it, and the second is the one that matters most:
//
//   1. the framework reviewing itself from its own repository;
//   2. a KNOWN-GOOD orchestrator reviewing a BROKEN one — `--repo-root <other>` used to load that
//      other tree's scripts, which are exactly the broken ones under review;
//   3. installation at a path the consumer chooses, as a plugin layout requires.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
// A filesystem root that is absolute on THIS platform. Fixtures written as 'F:/repo' are not absolute on POSIX,
// so every Linux CI run failed them (diagnosed 2026-10-06, run 37552051536).
const FS_ROOT = path.parse(process.cwd()).root;
import fs from 'node:fs';
import { resolveFrameworkDirs, skillFile, nodeInstructions } from '../scripts/io/locate.mjs';
import { coverPrefix } from '../scripts/lib/contract-glob.mjs';
import { SCRIPTS_DIR, REPO_ROOT } from './helpers.mjs';

// A fake filesystem: only the listed paths exist. Lets both layouts be tested without building
// either one on disk, and without the result depending on which layout this repo happens to use.
const only = (...paths) => {
  const set = new Set(paths.map((p) => path.resolve(p)));
  return (p) => set.has(path.resolve(p));
};

test('regression: plugin layout — skills are a sibling of scripts', () => {
  const r = resolveFrameworkDirs(path.join(FS_ROOT, 'repos/quorate/scripts'), {
    exists: only(path.join(FS_ROOT, 'repos/quorate/skills')),
  });
  assert.equal(r.layout, 'plugin');
  assert.equal(path.resolve(r.skillsDir), path.resolve(path.join(FS_ROOT, 'repos/quorate/skills')));
  assert.equal(
    path.resolve(skillFile(r.skillsDir, 'contract-audit')),
    path.resolve(path.join(FS_ROOT, 'repos/quorate/skills/contract-audit/SKILL.md')),
  );
});

test('regression: the same code resolves a consumer install', () => {
  const root = path.join(FS_ROOT, 'proj/.claude/skills/quorate');
  const r = resolveFrameworkDirs(`${root}/scripts`, { exists: only(`${root}/skills`) });
  assert.equal(r.layout, 'plugin');
  assert.equal(
    path.resolve(skillFile(r.skillsDir, 'contract-audit')),
    path.resolve(`${root}/skills/contract-audit/SKILL.md`),
  );
});

test('regression: legacy layout still resolves, so this lands before the repo moves', () => {
  // No `skills/` sibling — the arrangement in this repository today.
  const r = resolveFrameworkDirs(path.join(FS_ROOT, 'proj/.claude/skills/scripts'), {
    exists: only(path.join(FS_ROOT, 'proj/.claude/skills')),
  });
  assert.equal(r.layout, 'legacy');
  assert.equal(path.resolve(r.skillsDir), path.resolve(path.join(FS_ROOT, 'proj/.claude/skills')));
});

// THE CAPABILITY. Two different trees, and the engine's location must not follow the tree under
// review. If this ever regresses, a working orchestrator can no longer review a broken one.
test('regression: the engine location is independent of the repo under review', () => {
  const engine = path.join(FS_ROOT, 'known-good/quorate/scripts');
  const r = resolveFrameworkDirs(engine, { exists: only(path.join(FS_ROOT, 'known-good/quorate/skills')) });

  for (const repoUnderReview of [path.join(FS_ROOT, 'some/other/project'), path.join(FS_ROOT, 'broken/quorate')]) {
    assert.ok(
      !path.resolve(r.skillsDir).startsWith(path.resolve(repoUnderReview)),
      `skillsDir must not be derived from the tree under review (${repoUnderReview})`,
    );
  }
});

test('regression: an unlocatable skills directory is fatal, not a silent wrong answer', () => {
  assert.throws(
    () => resolveFrameworkDirs(path.join(FS_ROOT, 'nowhere/scripts'), { exists: () => false }),
    /cannot locate the skills directory/,
    'a wrong location must not be mistakable for an incomplete install',
  );
  assert.throws(() => resolveFrameworkDirs(''), /required/);
});

// Against the real tree, so the abstraction is not merely self-consistent.
test('resolves this repository correctly from the real scripts directory', () => {
  const r = resolveFrameworkDirs(SCRIPTS_DIR);
  // contract-audit is a NODE PROMPT, and since 2026-09-09 it lives in prompts/ rather than skills/.
  // Resolved through nodeInstructions, which is what every caller uses — asserting on skillFile
  // alone would pin the pre-split home and pass only while nothing had moved.
  const found = nodeInstructions(r, 'contract-audit');
  assert.ok(found, `contract-audit not found via ${r.promptsDir} or ${r.skillsDir} (layout: ${r.layout})`);
  assert.equal(found.home, 'prompts', 'a node the orchestrator spawns belongs to the prompt library');
  assert.ok(fs.existsSync(skillFile(r.skillsDir, 'plan-review')),
    'and a skill a PERSON invokes is still resolved out of skills/');
  for (const dir of [r.skillsDir, r.promptsDir]) {
    assert.ok(path.resolve(dir).startsWith(path.resolve(REPO_ROOT)),
      'sanity: this repo currently hosts the framework in-tree');
  }
});

test('regression: every lens is spawned with its skill INLINED, never left to slash resolution', () => {
  // Falsified twice, a day apart: the bench worktrees (foreign tree) and then the framework's OWN
  // repository both resolved a lens's slash command to nothing — 0 turns, $0.001, DEGRADED, a
  // failure indistinguishable at a glance from a broken lens. The aux nodes (intent, request,
  // reconcile, second-opinion) never failed this way because they always inline. This pins the
  // lens spawn to the same rule; a conditional that guesses where discovery works has been wrong
  // in both directions it guessed.
  //
  // Anchored on the fan-out CALL rather than on the loop's internals: the hand-rolled worker array
  // this used to slice between (`const e = queue.shift()` ... `await Promise.all(workers)`) moved
  // into lib/pool.mjs as runBudgetedPool (G-23, G-47), and a test pinned to a loop's local variables
  // goes green-then-vacuous the moment that loop is refactored.
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const at = graph.indexOf('runBudgetedPool(toRun');
  assert.notEqual(at, -1, 'the lens fan-out must still be recognisable here, or this test pins nothing');
  const lensSpawn = graph.slice(at, graph.indexOf('}, CONCURRENCY,', at));
  assert.match(lensSpawn, /mode: 'lens'/, 'the slice must actually be the lens spawn');
  assert.match(lensSpawn, /inlineSkill: true/);
  assert.doesNotMatch(graph, /skillsReachableFrom/, 'the falsified heuristic must not survive as dead code');
});

test('regression: the glob-to-prefix fact has exactly one owner, and leading stars yield no root', () => {
  // Three modules derived this independently and two already disagreed on which separators they
  // trimmed (verification run G-13) — and the derivation feeds the Rule 2 sandbox from both
  // sides, so the copies disagreeing is either a sandbox opened onto source or an aborted
  // orchestrator. Its one home is now lib/contract-glob.mjs's coverPrefix (contract-glob-grammar stage 3).
  assert.equal(coverPrefix('scripts/**'), 'scripts');
  assert.equal(coverPrefix('src/docs/'), 'src/docs');
  assert.equal(coverPrefix('**/*.ts'), '', 'a leading star has NO directory prefix — never the repo root (G-20)');
  // The backslash is CONSTRUCTED, never written as a literal: the first version's 'shared\**'
  // collapsed to 'shared**' (\* is not a JS escape), so the assertion labelled "both spellings
  // trim" exercised no backslash and certified a guarantee the implementation did not provide —
  // while the ownership grep below looked for a spelling no surviving copy used. That test was
  // the guard that let G-9 and G-11 ship (round-3 G-23); a green test is not a test until it can
  // go red.
  const BS = String.fromCharCode(92);
  assert.equal(coverPrefix('shared' + BS + '**'), 'shared', 'both separator spellings trim');
  assert.equal(coverPrefix('shared' + BS + BS + '**'), 'shared', 'doubled backslashes trim too');
  // spawn-node still derives the source roots it forbids the intent node; run-graph and new-run no longer derive a
  // prefix at all since the intent sandbox copies by exact match (contract-glob-grammar stage 4), so for them the
  // claim is only the negative one below — and regression-contract-glob-owner holds it for every file.
  for (const f of ['run-graph.mjs', 'spawn-node.mjs', 'new-run.mjs']) {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8');
    if (f === 'spawn-node.mjs') assert.ok(src.includes('coverPrefix'), `${f} must use the shared derivation`);
    // Every spelling a private copy of the derivation has ever worn, not just the one the last
    // grep happened to remember: the star-truncation idiom in either form is a second owner.
    assert.equal(/\.slice\(0,\s*star\)|split\('\*'\)\[0\]|indexOf\('\*'\)/.test(src), false,
      `${f} must not carry its own copy of the glob-prefix derivation`);
  }
});
