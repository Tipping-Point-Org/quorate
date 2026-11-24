#!/usr/bin/env node
// check-counted-facts.mjs — fail when a number CLAUDE.md states no longer matches the tree.
//
// Runs from the pre-push hook (.claude/hooks/checks.mjs) and on demand. The decision lives in
// lib/counted-facts.mjs; this file only gathers the actual counts:
//
//   skills  by listing skills/ — cheap, always done.
//   tests   from --tests-count when the caller already ran the suite, otherwise by running
//           `node --test` here (~seconds). Static counting of test( calls would be wrong: several
//           suites generate tests in loops, so the only honest count is the runner's own.
//
// NO GRAPH_NODE_DEPTH GUARD: this starts no graph work — it counts and compares, same class as
// new-run --print-contract (disk-first-protocol §8).
//
// Exit codes: 0 every stated fact matches · 1 drift found · 2 could not check.

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { statedFacts, countedFactDrift, statedGuardedScripts, carriesDepthGuard, guardListDrift } from './lib/counted-facts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = path.resolve(HERE, '..');

const args = {};
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['check-counted-facts'])); } catch (e) {
    if (!(e instanceof ArgvError)) throw e;
    console.error(`check-counted-facts: ${e.message}`);
    process.exit(2);
  }
  if (v['tests-count'] !== undefined) args.testsCount = v['tests-count'];
  if (v.doc !== undefined) args.doc = v.doc;
}

// QUORATE.md is scanned alongside CLAUDE.md: the moment a second document states a countable
// fact, it is a second drift channel, and checking only the first would verify the copy nobody
// reads next. --doc narrows to one file, for tests.
const docPaths = args.doc
  ? [path.resolve(args.doc)]
  // README.md joins the set for the reason this comment already gives: it states the test count in
  // its own words, so it is a third drift channel the moment it exists. Checking only the documents
  // that stated a number first would verify the copies nobody reads and skip the front page.
  // publish/CLAUDE.public.md, the CLAUDE.md the public mirror ships, states the test count and cites this script as
  // what verifies it, so it is one more drift channel (G-1 of 20261124-140633-gsw-remediation-review-b). Absent in the
  // mirror itself, where the existence filter skips it.
  : ['CLAUDE.md', 'QUORATE.md', 'README.md', path.join('publish', 'CLAUDE.public.md')]
    .map((f) => path.join(FRAMEWORK_ROOT, f)).filter((f) => fs.existsSync(f));
if (!docPaths.length) {
  console.error('check-counted-facts: no document found');
  process.exit(2);
}
const docPath = docPaths[0]; // used only when the whole doc set states nothing
// The facts this repository is KNOWN to state. A reworded count used to vanish silently — a fact
// the parser no longer matches is indistinguishable from a claim never made, so rewording
// '125 regression tests' to '125 tests' retired the check while the gate stayed green (G-14).
// Only enforced for the default doc set; --doc is the test harness's narrow view.
const REQUIRED_FACTS = args.doc ? [] : ['tests', 'skills', 'prompts'];
const stated = {};
const statedIn = {};
for (const doc of docPaths) {
  for (const [fact, value] of Object.entries(statedFacts(fs.readFileSync(doc, 'utf8')))) {
    if (stated[fact] !== undefined && stated[fact] !== value) {
      console.error(
        `check-counted-facts: ${path.basename(statedIn[fact])} says ${stated[fact]} ${fact}, ` +
          `${path.basename(doc)} says ${value} — the documents disagree with each other`,
      );
      process.exit(1);
    }
    stated[fact] = value;
    statedIn[fact] = doc;
  }
}
for (const fact of REQUIRED_FACTS) {
  if (stated[fact] === undefined) {
    console.error(
      `check-counted-facts: no document states the '${fact}' count any more. Either the phrasing ` +
        `was changed away from what statedFacts() recognises — reword it back, or teach the ` +
        `parser the new phrasing — or the claim was removed, in which case remove '${fact}' from ` +
        `REQUIRED_FACTS deliberately. A silently retired check is not a passing one.`,
    );
    process.exit(1);
  }
}
if (!Object.keys(stated).length) {
  console.log(`check-counted-facts: ${path.basename(docPath)} states no countable facts — nothing to verify`);
  process.exit(0);
}

function countDirs(name) {
  const dir = path.join(FRAMEWORK_ROOT, name);
  if (!fs.existsSync(dir)) return null;
  // A leading underscore marks a TEMPLATE directory — fragments the engine assembles (the run
  // brief, the external-arm constraints), not contracts handed to a node. The stated fact is "12
  // node prompts", and counting `_templates` as one made that sentence false the moment the
  // prompts moved out of the scripts.
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_')).length;
}
const countSkills = () => countDirs('skills');
const countPrompts = () => countDirs('prompts');

function countTests() {
  if (args.testsCount !== undefined) {
    const n = Number(args.testsCount);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }
  // QUORATE_COUNTING is this script's recursion guard, same class as GRAPH_NODE_DEPTH: the suite
  // being counted contains a test that dogfoods this script, and without the guard the counter
  // counts a suite that spawns the counter, unboundedly. The nested dogfood test still RUNS —
  // so the count is identical either way — it just skips re-spawning the counter.
  // NODE_TEST_CONTEXT is DELETED, not blanked, for the same reason run-graph scrubs CLAUDECODE:
  // the test runner stamps it (child-v8) on everything it spawns, an inner `node --test` that
  // sees it — set to anything, empty included — believes it is a child context and never prints
  // the summary line this parses.
  const env = { ...process.env, QUORATE_COUNTING: '1' };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(
    process.execPath,
    ['--test', path.join(FRAMEWORK_ROOT, 'tests', '**', '*.test.mjs')],
    // 64MB, not the 1MB default: the summary line this parses is the LAST line, and a default
    // buffer overflowing kills the child mid-stream — the count then reads as absent on exactly
    // the suites large enough to be worth counting, intermittently.
    { cwd: FRAMEWORK_ROOT, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 },
  );
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  const m = out.match(/^\s*(?:#|ℹ)\s*tests\s+(\d+)/m);
  return m ? Number(m[1]) : null;
}

const actual = {
  skills: countSkills(),
  prompts: countPrompts(),
  tests: stated.tests !== undefined ? countTests() : null,
};

for (const [fact, value] of Object.entries(actual)) {
  if (stated[fact] !== undefined && (value === null || value === undefined)) {
    console.error(`check-counted-facts: could not count '${fact}' — refusing to guess`);
    process.exit(2);
  }
}

// THE §8 GUARD LIST IS A COUNTABLE FACT WEARING DIFFERENT CLOTHES (G-47). The doctrine enumerates
// the scripts that abort at depth > 0, the enumeration named five while seven carried the guard,
// and nothing checked it — so a reader auditing that boundary saw two scripts spawning children
// the doctrine appeared not to cover, with no way to tell which side was stale.
//
// Names, not a count: a count still passes when one script is added and another dropped, which is
// the edit most likely to be wrong. Skipped silently when the document makes no such claim, and
// only for the default doc set — same rule as the counts above.
let guardDrift = { missing: [], extra: [] };
if (!args.doc) {
  const doctrine = path.join(FRAMEWORK_ROOT, 'shared', 'disk-first-protocol.md');
  if (fs.existsSync(doctrine)) {
    const statedGuards = statedGuardedScripts(fs.readFileSync(doctrine, 'utf8'));
    if (statedGuards) {
      const scriptsDir = path.join(FRAMEWORK_ROOT, 'scripts');
      const actualGuards = fs.readdirSync(scriptsDir)
        .filter((f) => f.endsWith('.mjs'))
        .filter((f) => carriesDepthGuard(fs.readFileSync(path.join(scriptsDir, f), 'utf8')))
        .sort();
      guardDrift = guardListDrift({ stated: statedGuards, actual: actualGuards });
    } else {
      // The anchor stopped matching. Same failure as a reworded count: a claim the parser no
      // longer sees is indistinguishable from a claim never made, and a silently retired check
      // is not a passing one.
      console.error(
        'check-counted-facts: shared/disk-first-protocol.md no longer states which scripts carry '
        + 'the depth guard in a form statedGuardedScripts() recognises. Reword it back, teach the '
        + 'parser the new phrasing, or remove the check deliberately.',
      );
      process.exit(1);
    }
  }
}

const drift = countedFactDrift({ stated, actual });
if (!drift.length && !guardDrift.missing.length && !guardDrift.extra.length) {
  const checked = Object.keys(stated).map((f) => `${f}=${stated[f]}`).join(', ');
  console.log(`check-counted-facts: stated facts match the tree (${checked}, §8 depth-guard list)`);
  process.exit(0);
}

for (const name of guardDrift.missing) {
  console.error(
    `check-counted-facts: scripts/${name} carries the GRAPH_NODE_DEPTH guard but §8 of `
    + 'shared/disk-first-protocol.md does not name it. Add it to the enumeration — a boundary the '
    + 'doctrine does not describe is one nobody can audit.',
  );
}
for (const name of guardDrift.extra) {
  console.error(
    `check-counted-facts: §8 of shared/disk-first-protocol.md names scripts/${name} as carrying the `
    + 'GRAPH_NODE_DEPTH guard, and it does not. Either add the guard or stop claiming it — the '
    + 'second is worse than the first, because it reads as enforcement.',
  );
}

for (const d of drift) {
  console.error(
    // Names the document that actually states the fact (statedIn), not docPaths[0]: for a gate
    // whose whole purpose is pointing at a stale number, sending the operator to a file that
    // never made the claim is the one message that must not be wrong (G-9).
    `check-counted-facts: ${path.basename(statedIn[d.fact] ?? docPath)} states ${d.stated} ${d.fact}; the tree has ${d.actual}. ` +
      `Update the stated number in that document — prose that states a count the tree no longer has is an inert guarantee.`,
  );
}
process.exit(1);
