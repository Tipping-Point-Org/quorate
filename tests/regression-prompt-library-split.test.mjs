// The prompt library, split out of `skills/` on 2026-09-09.
//
// WHY IT MOVED. Twelve of the twenty-two directories under `skills/` were not skills. Each is a
// contract the ORCHESTRATOR spawns: it reads a brief, refuses to run outside a run directory, and
// emits a schema-validated envelope. A person who types `/code-audit` in a session gets a refusal.
// Shipping them as skills put twelve names a consumer could type — and be refused by — into that
// project's own `.claude/skills` namespace, on top of the ten that are real. Six of the twenty-two
// collided outright with a real project's own skills the first time quorate was mounted, which is
// why the SKILLS-SHADOWED stamp exists; the split more than halves that surface.
//
// The rename to PROMPT.md is part of it: calling a non-skill `SKILL.md` is the same false name one
// level down, and this repository has spent a lot of effort on names that describe what a thing is.
//
// WHAT THIS TEST PROTECTS. The move is only safe because `--inline-skill` READS the file from the
// framework's own location and refuses to fall back to slash-command resolution. Three properties
// hold that together, and each fails quietly if it breaks:
//
//   1. every node the roster declares resolves to instructions somewhere;
//   2. a node the orchestrator spawns is NOT in the skills namespace, and vice versa;
//   3. the prompts are declared source, or the graph reviews its own lens contracts as
//      out-of-scope and demotes every finding against them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { resolveFrameworkDirs, nodeInstructions } from '../scripts/io/locate.mjs';

const FRAMEWORK = resolveFrameworkDirs(path.join(REPO_ROOT, 'scripts'));
const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
const idOf = (e) => String(e.skill_command ?? '').replace(/^\//, '') || e.id;
const spawned = [...new Set([...(roster.lenses ?? []), ...(roster.barrier_nodes ?? [])].map(idOf))];

test('regression: every node the roster declares resolves to instructions', () => {
  // The failure this prevents is not a crash. `skillInstalled` decides whether a node is present,
  // and an absent one is rendered SKIPPED with a skip_reason — so a resolver that looked in the
  // wrong directory would produce a run that reviewed nothing and reported cleanly.
  const missing = spawned.filter((id) => !nodeInstructions(FRAMEWORK, id));
  assert.deepEqual(missing, [], 'a declared node with no instructions is a run that reviews nothing');
});

test('regression: a node the orchestrator spawns lives in prompts/, not skills/', () => {
  for (const id of spawned) {
    const found = nodeInstructions(FRAMEWORK, id);
    assert.equal(found.home, 'prompts',
      `${id} is spawned by run-graph, so it belongs to the prompt library — a person cannot invoke `
      + 'it, and putting it in skills/ spends a name in the consumer\'s namespace on a refusal');
  }
  assert.equal(spawned.length, 13, 'thirteen node contracts (remediation joined in remediate-rebuild stage 4); update this and the counted facts together');
});

test('regression: a skill a person invokes stays in skills/', () => {
  // The other half. Moving one of these to prompts/ would remove it from Claude Code's discovery,
  // and the symptom is a slash command that silently does not exist.
  for (const id of ['request', 'remediate', 'plan-review', 'full-review', 'unit-test-writer']) {
    const found = nodeInstructions(FRAMEWORK, id);
    assert.ok(found, `${id} must exist`);
    assert.equal(found.home, 'skills', `${id} is invoked by a person and must stay discoverable`);
  }
});

test('regression: nothing is left in both libraries', () => {
  // A leftover copy is worse than a bad move: `nodeInstructions` prefers prompts/, so an edit to the
  // stale skills/ copy would change nothing while looking like it had.
  const dirs = (name) => {
    const d = path.join(REPO_ROOT, name);
    return fs.existsSync(d)
      ? fs.readdirSync(d, { withFileTypes: true })
        .filter((x) => x.isDirectory() && !x.name.startsWith('_'))
        .map((x) => x.name)
      : [];
  };
  const both = dirs('prompts').filter((n) => dirs('skills').includes(n));
  assert.deepEqual(both, [], 'one home each — a shadowed copy is edited and silently ignored');
});

test('regression: no prompt directory still holds a SKILL.md', () => {
  for (const d of fs.readdirSync(path.join(REPO_ROOT, 'prompts'), { withFileTypes: true })) {
    // `_`-prefixed directories hold assembled TEMPLATE fragments, not node contracts.
    if (!d.isDirectory() || d.name.startsWith('_')) continue;
    const stale = path.join(REPO_ROOT, 'prompts', d.name, 'SKILL.md');
    assert.ok(!fs.existsSync(stale), `${d.name} kept a SKILL.md beside its PROMPT.md`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'prompts', d.name, 'PROMPT.md')),
      `${d.name} has no PROMPT.md`);
  }
});

test('regression: the prompt library is declared source in the contract', () => {
  // Not cosmetic. Files matching no declared glob are invisible to scope derivation AND
  // undemotable-from (§8.5), so leaving prompts/ undeclared would mean the graph reviews its own
  // lens contracts as out-of-scope and reports findings against them without counting them.
  const claude = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  const globs = /source_globs:\s*\[([^\]]*)\]/.exec(claude);
  assert.ok(globs, 'the contract must declare source_globs');
  assert.match(globs[1], /"prompts\/\*\*"/,
    'prompts/** must be declared source, or every finding against a lens contract is demoted');
});
