// G-47: §8 of the doctrine enumerated the scripts that abort at GRAPH_NODE_DEPTH > 0 and named
// five, while seven carried the guard. `check-panel.mjs` and `bench-lenses.mjs` were written with
// it and the sentence was never updated.
//
// A LIST IS A COUNTABLE FACT WEARING DIFFERENT CLOTHES. It drifts exactly the way the test count
// drifted five times in one day, except nothing was watching this one — and the cost is higher than
// a stale number: someone auditing the recursion boundary sees two scripts that spawn children and
// that the doctrine appears not to cover, and cannot tell whether the code or the document is wrong.
// Both readings are actionable and one of them is destructive.
//
// Names rather than a count, deliberately: a count still passes when one script is added and
// another dropped, which is the edit most likely to be a mistake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { statedGuardedScripts, carriesDepthGuard, guardListDrift } from '../scripts/lib/counted-facts.mjs';
import { REPO_ROOT } from './helpers.mjs';

const bullet = (names) =>
  `## §8 Recursion guard\n\n\`GRAPH_NODE_DEPTH\` carries nesting depth.\n\n`
  + `- ${names.map((n) => `\`${n}\``).join(', ')}\n`
  + `  abort with exit code \`3\` if they start with \`GRAPH_NODE_DEPTH > 0\`, **or** if unreadable.\n`
  + `- **The guard covers starting graph work, not running at all.** Two scripts deliberately carry\n`
  + `  no guard: \`capture.mjs\` and \`find-inert-features.mjs\`.\n`;

test('regression: the enumeration is read from the abort clause, not the exemption below it', () => {
  // THE TRAP THIS CHECKER FELL INTO FIRST. A looser anchor matched the SECOND bullet — the two
  // scripts that deliberately carry NO guard — and reported them as the stated list. That does not
  // fail, it lies: it would have compared the exempt scripts against the guarded ones and produced
  // a confident, entirely wrong drift report on every run.
  const stated = statedGuardedScripts(bullet(['new-run.mjs', 'run-graph.mjs']));
  assert.deepEqual(stated, ['new-run.mjs', 'run-graph.mjs']);
  assert.ok(!stated.includes('capture.mjs'), 'the exemption bullet must not be read as the claim');
  assert.ok(!stated.includes('find-inert-features.mjs'));
});

test('regression: a guarded script missing from the enumeration is drift', () => {
  const d = guardListDrift({ stated: ['new-run.mjs'], actual: ['new-run.mjs', 'bench-lenses.mjs'] });
  assert.deepEqual(d.missing, ['bench-lenses.mjs'], 'a boundary the doctrine does not describe cannot be audited');
  assert.deepEqual(d.extra, []);
});

test('regression: an enumerated script that does NOT carry the guard is drift too', () => {
  // The worse direction of the two: prose that reads as enforcement when there is none.
  const d = guardListDrift({ stated: ['new-run.mjs', 'ghost.mjs'], actual: ['new-run.mjs'] });
  assert.deepEqual(d.extra, ['ghost.mjs']);
  assert.deepEqual(d.missing, []);
});

test('regression: the guard is detected by reading the variable, not by mentioning it', () => {
  // Every unguarded script in this tree names GRAPH_NODE_DEPTH in a comment saying why it has no
  // guard ("NO GRAPH_NODE_DEPTH GUARD: this starts no graph work"). A substring match on the name
  // would count all of them as guarded and report the doctrine as understating the list — a green
  // checker producing a false correction.
  assert.equal(carriesDepthGuard('const RAW = process.env.GRAPH_NODE_DEPTH;'), true);
  assert.equal(carriesDepthGuard('// NO GRAPH_NODE_DEPTH GUARD: this starts no graph work.'), false);
  assert.equal(carriesDepthGuard(''), false);
});

test('regression: a document that states no such list is not drift', () => {
  assert.equal(statedGuardedScripts('# a document with no §8 claim at all'), null);
  assert.deepEqual(guardListDrift({ stated: null, actual: ['new-run.mjs'] }), { missing: [], extra: [] });
});

test('regression: the doctrine in this tree matches the tree', () => {
  // The live assertion. It is what would have caught G-47 the day the guard was added, and it is
  // why the enumeration cannot go stale a third time.
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'disk-first-protocol.md'), 'utf8');
  const stated = statedGuardedScripts(doc);
  assert.ok(stated, 'the doctrine must keep stating which scripts carry the guard');
  const dir = path.join(REPO_ROOT, 'scripts');
  const actual = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.mjs'))
    .filter((f) => carriesDepthGuard(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort();
  assert.deepEqual(guardListDrift({ stated, actual }), { missing: [], extra: [] });
});

// The session hooks read the depth to tell a graph node from the working session and never abort on it. They declare
// it, and the detector does not count them as guards (the doctrine lists them apart, §8).
test('regression: a script that declares DEPTH READ, NOT A GUARD is not counted as a guard', async () => {
  const { carriesDepthGuard, DEPTH_READ_NOT_GUARD } = await import('../scripts/lib/counted-facts.mjs');
  assert.equal(carriesDepthGuard(`// ${DEPTH_READ_NOT_GUARD}: tells a node from the session.\nnodeDepth(process.env)`), false);
  assert.equal(carriesDepthGuard('nodeDepth(process.env)'), true);
});
