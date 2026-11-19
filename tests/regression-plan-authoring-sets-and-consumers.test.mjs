// .claude/requests/plan-authoring-sets-and-consumers.md (operator, 2026-10-18: "Small skill change"). story-pipeline wrote
// one plan with plan-authoring and three plan-review rounds returned NEEDS_CHANGES; about 21 of 35 findings were one class:
// a list of sites built from a search pattern the author chose, where the authority for the set was committed in the
// repository and cited by the document the plan quoted. And the plan pointed doc_roles.request at itself as a draft, which
// new-run refuses. The procedure was silent on both; these tests hold the two steps and the review's check to their rules.
//
// G-7/G-8/G-9 of 20261018-063803-pa-review: the first version pinned headings and a phrase or two, so most of each rule
// could be deleted with the suite green. Each test now reads ONE step, cut out of its skill's Procedure, and asserts every
// part of the rule the request states. G-5 of the same run: both review findings were routed into `missing`, whose one
// meaning is gate work the plan does not cover; they go to a `defective` bucket (operator, 2026-10-18: "New bucket").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

// The `## Procedure` section of a skill, up to the next level-2 heading: a rule moved out of it is not a step.
function procedure(name) {
  const src = read(`skills/${name}/SKILL.md`);
  const m = src.match(/\n## Procedure\n([\s\S]*?)(?=\n## )/);
  assert.ok(m, `${name} has a Procedure section`);
  return m[1];
}

// One numbered step of a Procedure, from its number to the next step's number (or the section's end).
function step(name, n) {
  const proc = procedure(name);
  const m = proc.match(new RegExp(`(?:^|\\n)${n}\\. ([\\s\\S]*?)(?=\\n${n + 1}\\. |$)`));
  assert.ok(m, `${name} Procedure has a step ${n}`);
  return flat(m[1]);
}

test('plan-authoring: a set is named by its authority, enumerated at test time, and a carried list is dated and indicative', () => {
  const s = step('plan-authoring', 9);
  assert.match(s, /^\*\*A set is named by its authority, not listed\.\*\*/);
  assert.match(s, /names the invariant/, 'the item names the invariant the set is the instances of');
  for (const kind of [/a document/, /a registry/, /a schema/, /the test that will enumerate it/]) {
    assert.match(s, kind, `the authority may be ${kind}: all four kinds stay available`);
  }
  assert.match(s, /enumeration is the implementer's, at test time/);
  assert.match(s, /dated, indicative/);
  assert.match(s, /with the command that produced it/, 'a carried list states its provenance');
  assert.match(s, /never the set under test/);
  assert.match(s, /follow the citations of the governing documents/i);
  assert.match(s, /an authority they name is the one to cite/, "a governing document's named authority is preferred");
});

test('plan-authoring: read the consumer of what you change, state what it will do, and a refused change is a finding', () => {
  const s = step('plan-authoring', 10);
  assert.match(s, /^\*\*Read the consumer of what you change\.\*\*/);
  for (const kind of [/contract key/, /document status/, /interface/, /signature/]) {
    assert.match(s, kind, `the change kinds include ${kind}`);
  }
  assert.match(s, /read the code that consumes it/);
  assert.match(s, /state in the item what that code will do with the new value/);
  assert.match(s, /consumer refuses it is a finding about the plan/);
});

test('plan-review: in its Procedure, a list with no authority and a change its consumer would refuse are findings in `defective`', () => {
  const s = step('plan-review', 7);
  assert.match(s, /plan-authoring-sets-and-consumers\.md/);
  assert.match(s, /are findings, reported under `defective`/, 'both conditions are classified as findings, in their own bucket');
  assert.doesNotMatch(s, /reported under `missing`/, '`missing` keeps its one meaning: gate work the plan does not cover');
  assert.match(s, /carries a list as the set it applies to, with no authority named for the set/);
  assert.match(s, /changes something its consumer would refuse/);
  assert.match(s, /Read the consumer to know/);
});

test('plan-review: the Output contract carries `defective` with item, why and source, and `missing` keeps one meaning', () => {
  const src = read('skills/plan-review/SKILL.md');
  const out = src.match(/\n## Output contract\n([\s\S]*?)(?=\n## )/);
  assert.ok(out, 'plan-review has an Output contract');
  const json = JSON.parse(out[1].match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.ok(Array.isArray(json.defective) && json.defective.length > 0, 'the example shows a `defective` entry');
  assert.deepEqual(Object.keys(json.defective[0]).sort(), ['item', 'source', 'why']);
  assert.deepEqual(Object.keys(json.missing[0]).sort(), ['item', 'source']);
});

test('plan-verdict schema (spawn-node gate variant): `defective` is required, {item, why, source}, and counted as findings', () => {
  const src = read('scripts/spawn-node.mjs');
  const gate = src.match(/if \(variant === 'gate'\) \{([\s\S]*?)\n  \}\n/);
  assert.ok(gate, 'spawn-node has a gate variant');
  const g = gate[1];
  const required = g.match(/required: \[('schema_version'[^\]]*)\]/)[1];
  assert.match(required, /'defective'/, 'the bucket is required, like every other one');
  const def = g.match(/\n        defective: \{([\s\S]*?)\n        \},/);
  assert.ok(def, 'the schema declares a `defective` property');
  assert.match(def[1], /required: \['item', 'why', 'source'\]/);
  assert.match(def[1], /additionalProperties: false/);
  const missing = g.match(/\n        missing: \{([\s\S]*?)\n        \},/);
  assert.match(missing[1], /required: \['item', 'source'\]/, '`missing` is unchanged');
  assert.match(src, /\(payload\.defective\?\.length \?\? 0\)/, "a gate node's findings_count includes `defective`");
});

test('the contract doc states the plan-verdict shape with `defective`', () => {
  const doc = flat(read('shared/claude-md-contract.md'));
  assert.match(doc, /defective\[\]\{item, why, source\}/);
});
