// The rule that keeps "every bug gets a test" from becoming a non-terminating loop.
//
// Once every bug produces a regression test, and a test is itself code under source_globs,
// reviewing tests the way production code is reviewed makes the loop endless: finding -> test ->
// finding -> test. Capping the depth arbitrarily is the wrong compromise, because the bugs left
// uncovered are real ones.
//
// The loop terminates because a test's correctness is settled by an EXPERIMENT (red before the
// fix, green after) rather than by a further review. That is a decision procedure: it runs in
// milliseconds, needs no model, and catches the whole class of defects a test can plausibly have.
//
// This file exists because the rule lives in two places that are easy to edit apart, and because
// this project has repeatedly shipped instructions that quietly vanished or that the machinery
// forbade. A rule nothing checks is a rule that lasts until the next refactor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SCRIPTS_DIR, REPO_ROOT } from './helpers.mjs';
import { resolveFrameworkDirs } from '../scripts/io/locate.mjs';

// THE TEMPLATE, not the script that renders it. This read run-graph.mjs because the brief lived
// there as a 100-line template literal; it is prompts/_templates/run-brief.md now. Reading the
// template is the stronger assertion — it checks the text a node actually receives rather than a
// string that happens to appear in a source file.
const brief = fs.readFileSync(path.join(REPO_ROOT, 'prompts', '_templates', 'run-brief.md'), 'utf8');

// Located via the framework root, not by the literal `.claude/skills/shared`. That literal was one
// more copy of the assumption step 1 removed from the engine, and it survived in a test — where it
// did worse damage than in the engine, because the read is at module scope: in plugin layout the
// file threw before any test ran, node reported one file-level failure instead of six tests, and
// the suite total silently dropped from 60 to 55.
const doctrine = fs.readFileSync(
  path.join(resolveFrameworkDirs(SCRIPTS_DIR).frameworkRoot, 'shared', 'disk-first-protocol.md'),
  'utf8',
);

test('regression: every lens brief states that test_globs wins over source_globs', () => {
  assert.match(
    brief,
    /test_globs WINS over source_globs/i,
    'without precedence a test file matches both globs and is reviewed as production code',
  );
});

test('regression: the brief names the admissible findings on a test file', () => {
  for (const term of ['vacuously', 'asserts nothing', 'flaky']) {
    assert.ok(brief.includes(term), `brief must name "${term}" as the kind of test defect to report`);
  }
  assert.match(brief, /Do not report style, structure, duplication, naming/,
    'the brief must say what is NOT admissible, or the rule is only half stated');
});

test('regression: the brief explains WHY the rule exists, not just what it is', () => {
  // A rule with no rationale is the first thing deleted by someone tidying a template.
  assert.match(brief, /TERMINATION rule/i);
});

test('regression: the shared doctrine carries the same rule as the brief', () => {
  assert.match(doctrine, /test_globs.*wins|`test_globs` wins/i);
  assert.match(doctrine, /red-before-green|red before the fix/i,
    'the doctrine must state the experiment that replaces the review');
});

test('regression: the doctrine admits what the rule does NOT solve', () => {
  // Bugs predating the discipline, and bugs too expensive to reproduce, are bounded backlogs —
  // not recursions. Claiming otherwise would make the rule read as full coverage.
  assert.match(doctrine, /bounded backlog|backlogs rather than recursions/i);
});

// The contract must actually classify this suite as tests, or the precedence rule has nothing to
// act on: `.claude/skills/**` is source_globs, and these files live inside it.
test('regression: the orchestration suite is declared in test_globs', () => {
  const claudeMd = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  const testGlobs = /^test_globs:\s*(\[.*\])/m.exec(claudeMd)?.[1] ?? '';
  assert.ok(
    testGlobs.includes('*.test.mjs') || testGlobs.includes('.claude/skills/tests'),
    `test_globs must cover this suite; got ${testGlobs}`,
  );
});
