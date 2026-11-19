// A LENS THE PROJECT DECLARES, AND THE AUTHORITY IT IS DENIED.
//
// The extension axis that was missing. A consumer could already declare a reviewer CLI (`reviewers:`,
// merged into the adapter table) and now project knowledge (`.claude/quorate/*.md`, inlined into a
// brief) — but a check only that project needs had nowhere to live except a same-named skill of its
// own, which is a collision the orchestrator resolves by discarding the project's text.
//
// THE BOUNDARY THIS CROSSES, and why it is one declared point rather than a relaxation. spawn-node
// forbids instructions from the reviewed tree and says why: "A node's instructions come from the
// framework doing the reviewing, never from the tree being reviewed — otherwise pointing --repo-root at
// another project would feed its skills to this run." A lens's instructions are not data like a threat
// model or a profile; they are the node's whole contract, handed to a subprocess running with the
// operator's credentials, whose findings reach a gate the operator relies on.
//
// So: declared in the contract (frozen into run.json), instructed by a path proved to be inside the
// repository, capped exactly as an external ARM is — basis convention, verdict ceiling RISK, never
// required, and structurally unable to raise a §6 invariant because the basis list becomes the
// envelope's schema enum. Coverage, never authority. And stamped, so a gate reader knows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import {
  consumerLenses, mergeLenses, CONSUMER_LENS_BASIS, CONSUMER_LENS_VERDICT_CEILING, CONSUMER_LENS_STAMP,
} from '../scripts/lib/consumer-lenses.mjs';

const GRAPH = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
const SPAWN = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');

test('a declared lens is built with caps the declaration cannot widen', () => {
  const { lenses, errors } = consumerLenses({
    declared: { 'stage-contract-audit': { instructions: '.claude/quorate/lenses/stage.md' } },
    frameworkIds: ['code-audit', 'arch-review'],
  });
  assert.deepEqual(errors, []);
  const l = lenses[0];
  assert.equal(l.id, 'stage-contract-audit');
  assert.deepEqual(l.allowed_basis, [...CONSUMER_LENS_BASIS], 'convention only');
  assert.equal(l.verdict_ceiling, CONSUMER_LENS_VERDICT_CEILING);
  assert.equal(l.required, false, 'a project lens can never block a gate by its absence');
  assert.equal(l.consumer, true);
  assert.ok(!l.allowed_basis.includes('invariant'),
    'invariant is the only basis that can raise a non-waivable finding, and the basis list becomes the '
    + 'envelope schema enum — so this cap is enforced by the validator, not by intention');
});

test('declaring a cap away is refused, and the refusal names the key', () => {
  for (const key of ['allowed_basis', 'verdict_ceiling', 'severity_ceiling', 'required']) {
    const { errors } = consumerLenses({
      declared: { mine: { instructions: 'x.md', [key]: key === 'required' ? true : ['executed'] } },
      frameworkIds: [],
    });
    assert.ok(errors.some((e) => e.includes(`.${key} may not be declared`)),
      `${key} must be refused rather than silently overridden — a project that wrote it has stated an `
      + 'expectation, and a cap applied in silence leaves it believing the lens can cite execution');
  }
});

test('a name that collides with a framework lens is refused outright', () => {
  const { lenses, errors } = consumerLenses({
    declared: { 'code-audit': { instructions: 'x.md' } },
    frameworkIds: ['code-audit'],
  });
  assert.deepEqual(lenses, []);
  assert.match(errors[0], /rewriting the review under a familiar name/,
    'no cap makes it acceptable for the reviewed tree to replace code-audit with its own instructions');
});

test('the instructions path must be relative and inside the tree', () => {
  for (const bad of ['/etc/passwd', '../../outside.md', 'a/../../b.md']) {
    const { errors } = consumerLenses({ declared: { mine: { instructions: bad } }, frameworkIds: [] });
    assert.ok(errors.length, `${bad} must be refused before it reaches a spawn`);
  }
  const { errors: none } = consumerLenses({ declared: { mine: {} }, frameworkIds: [] });
  assert.match(none[0], /instructions is required/,
    'a lens with no instructions would be spawned with nothing to do');
});

test('the contract form is a MAP, because the parser supports no block sequences', () => {
  // Found by running it: `lenses:\n  - id: x` produced "line 23: block sequences are not supported;
  // use flow form". `reviewers:` — the other consumer extension point — is a map for the same reason,
  // and a key cannot be declared twice, so duplicate ids are impossible by construction.
  const { errors } = consumerLenses({ declared: [{ id: 'mine', instructions: 'x.md' }], frameworkIds: [] });
  assert.match(errors[0], /must be a map of id -> declaration, like `reviewers:`/);
  assert.match(errors[0], /no block sequences/, 'and say why, or the next author writes the list again');
});

test('regression: the orchestrator merges, stamps, and proves containment itself', () => {
  assert.match(GRAPH, /const LENSES = mergeLenses\(roster\.lenses \?\? \[\], CONSUMER\);/,
    'ONE merged list, so the seven readers of the lens set cannot disagree about which lenses exist');
  assert.ok(!/for \(const lens of roster\.lenses\)/.test(GRAPH), 'the lens loop reads the merged list');
  assert.match(GRAPH, /escapesAfterRealpath\(repoRoot, abs\)/,
    'containment is proved where the repository root is known, not in the pure layer');
  assert.match(GRAPH, /CONSUMER_LENS_STAMP/, 'and the run records that a project lens took part');
  assert.deepEqual(mergeLenses(['a'], ['b']), ['a', 'b'],
    'framework first, so expected.json reads engine nodes before project ones');
});

test('regression: the verdict cap reaches the expected ROW, not just the declaration', () => {
  // MEASURED IN THE FIXTURE, and it was wrong: the row went out with `verdict_ceiling: null` because it
  // was built from the degradation rules alone, so the spawner passed no --verdict-ceiling and the cap
  // the engine advertises existed only in a constant and a log line. The lens answered RISK by its own
  // choice, which is exactly how a cap that does nothing looks like a cap that works.
  assert.match(GRAPH, /let verdictCeiling = lens\.verdict_ceiling \?\? \(degraded \?/,
    'the declared ceiling is consulted first; degradation may lower it further but never raise it');
});

test('regression: the reviewed tree instructs a node at ONE explicit, vouched argument', () => {
  // The default stays shut: name-based resolution is still framework-only, and the exception is visible
  // in the argv the spawner records rather than hidden in a widened lookup.
  assert.match(SPAWN, /const found = args\.instructions/, 'an explicit path wins only when passed');
  assert.match(SPAWN, /nodeInstructions\(FRAMEWORK, skillName\)/,
    'and name-based resolution is unchanged: still the framework, never the reviewed tree');
  assert.match(SPAWN, /--instructions \$\{args\.instructions\} does not exist/,
    'a missing file must not fall back to anything: the node would run a different contract than the '
    + 'one the contract declared');
  assert.match(GRAPH, /if \(instructions\) argv\.push\('--instructions', instructions\);/);
});

test('regression: the new stamp explains itself to the node that carries it', () => {
  // stampConsequence THROWS for a stamp the table does not explain, and it threw here — taking the
  // whole run down on the first brief. That guard is correct: "a stamp nothing explains was the defect".
  const table = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'prompts', '_templates', 'stamp-consequences.json'), 'utf8'));
  assert.ok(table[CONSUMER_LENS_STAMP], `${CONSUMER_LENS_STAMP} must be in the consequences table`);
  assert.match(table[CONSUMER_LENS_STAMP], /coverage, not authority/);
  assert.match(table[CONSUMER_LENS_STAMP], /cannot raise a §6 invariant/);
  assert.match(table[CONSUMER_LENS_STAMP], /this brief wins/,
    'a lens instructed by the project must be told which authority wins on a disagreement');
});

test('regression: a project lens counts as installed by ITS OWN instructions', () => {
  // `skillInstalled` asks the FRAMEWORK, and is structurally unable to see a lens whose instructions
  // live in the consumer tree. Without this the lens was derived, capped, stamped — and then silently
  // `present: false`: the run printed "project lenses: …" and spawned none of them, a declared node
  // vanishing with no row explaining why.
  assert.match(GRAPH, /lens\.consumer \? Boolean\(lens\.instructions_abs\) : skillInstalled\(lens\.id\)/);
});
