// Every installed skill must be accounted for in the roster — as a lens, a barrier node, a panel
// arm, or explicitly as NOT a graph node.
//
// FOUND WHILE WRITING THE README, and it had already happened once before. `request`,
// `unit-test-writer` and `integration-test-writer` appeared in no roster list at all. The roster's
// own entry for `request-capture` records the identical defect and how it was caught: "it was in
// neither list until a doc-consistency run said so" — a model noticed, a human fixed it by hand,
// and nothing was put in place to stop the third occurrence. This is that.
//
// WHY IT MATTERS FOR A LIST NOTHING READS. `not_graph_nodes` is consumed by no code: it exists so a
// reader can tell "this skill is deliberately not a node" from "this skill was forgotten". That
// distinction is the file's entire value, and it is exactly what silently rots — an unlisted skill
// looks identical to an oversight, so the next person either wires it in or leaves a real gap. A
// registry that is 86% complete answers no question at all.
//
// The check is cheap, mechanical, and runs with the suite, which is what the two earlier manual
// corrections were missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));
// BOTH LIBRARIES. The twelve node contracts moved to prompts/ on 2026-09-09 because no person can
// invoke one; the ten a person does invoke stayed in skills/. The roster spans both, so a check
// that read one directory would report every moved node as a roster entry with no skill behind it.
const dirsIn = (name) => {
  const dir = path.join(REPO_ROOT, name);
  if (!fs.existsSync(dir)) return [];
  // A leading underscore marks a TEMPLATE directory — fragments the engine assembles (the run
  // brief, the external-arm constraints), not contracts handed to a node. They are deliberately not
  // roster entries, and the underscore is what keeps them out of a node enumeration.
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name);
};
const skills = [...dirsIn('skills'), ...dirsIn('prompts')].sort();

const LISTS = ['lenses', 'barrier_nodes', 'panel_arms', 'not_graph_nodes'];
const idsIn = (key) => (roster[key] ?? []).map((e) => e.id).filter(Boolean);

test('regression: every installed skill appears in the roster', () => {
  const listed = new Set(LISTS.flatMap(idsIn));
  const unlisted = skills.filter((s) => !listed.has(s));
  assert.deepEqual(unlisted, [],
    'a skill in no list is indistinguishable from one that was forgotten — add it to not_graph_nodes '
    + 'with a `why`, or wire it in as a node');
});

// EVERY NODE ID run-graph SPAWNS BY NAME IS REGISTERED (G-6 of 20261024-064941-rrr-delivery): `reconcile-reask` was
// spawned, wrote a status and spent budget, and sat in no roster list, the defect reconcile-b's entry records.
test('regression: every node id run-graph spawns by name is in the roster', () => {
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  const ids = [...new Set([...graph.matchAll(/nodeId: '([a-z][a-z-]*)'/g)].map((m) => m[1]))];
  assert.ok(ids.includes('reconcile') && ids.includes('second-opinion'), `the scan found too few spawned ids: ${ids.join(', ')}`);
  const listed = new Set(LISTS.flatMap(idsIn));
  assert.deepEqual(ids.filter((id) => !listed.has(id)), [], 'a spawned node absent from the roster is invisible to every reader of it');
});

test('regression: the roster names no skill that does not exist', () => {
  // The other direction, and the one that decays as skills are renamed or removed. A roster entry
  // for a skill that is gone is a promise the tree cannot keep: `status: installed` on a directory
  // nobody can open. Panel arms are excluded — an arm is a REVIEWER shadowing a lens, not a skill,
  // so its id (panel-codex-code) is deliberately not a directory name.
  const have = new Set(skills);
  for (const key of ['lenses', 'barrier_nodes', 'not_graph_nodes']) {
    for (const id of idsIn(key)) {
      // reconcile-b is the calibration re-run of the `reconcile` skill under --reconcile-twice: a
      // second NODE running one skill, which is the one legitimate id-without-a-directory here.
      // reconcile-reask is the same: the re-ask of the groups a reply left out, as its own node.
      const skill = id === 'reconcile-b' || id === 'reconcile-reask' ? 'reconcile' : id;
      assert.ok(have.has(skill),
        `${key} names '${id}', but neither skills/${skill}/ nor prompts/${skill}/ exists — a roster `
        + 'entry for a missing skill reads as installed capability that cannot run');
    }
  }
});

test('regression: no skill is claimed by two lists at once', () => {
  // A skill that is both a lens and "not a graph node" is a contradiction a reader resolves by
  // guessing, and the two answers lead opposite ways.
  const seen = new Map();
  for (const key of LISTS) {
    for (const id of idsIn(key)) {
      const prior = seen.get(id);
      assert.ok(!prior, `'${id}' is in both ${prior} and ${key} — it can only be one`);
      seen.set(id, key);
    }
  }
});

test('regression: every not-a-node entry says WHY it is not one', () => {
  // The list's only job is to record a DECISION. An entry with no reason is a name on a list, which
  // is the state the three missing skills were effectively in.
  for (const e of roster.not_graph_nodes ?? []) {
    assert.ok(String(e.why ?? '').trim().length > 20,
      `not_graph_nodes entry '${e.id}' must state why it is not a node, in enough words to be a reason`);
  }
});
