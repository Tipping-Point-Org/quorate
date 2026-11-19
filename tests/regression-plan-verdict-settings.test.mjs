// G-4 of 20261018-195709-pins-review: plan-review said to record the reviewer's model and effort with each round, and the
// `plan-verdict` schema had nowhere to put them, rejecting additional properties. The operator's decision (2026-10-18: "A
// settings field the caller sets (Recommended)"): the verdict carries a required `settings { model, effort }`, set by the
// caller that spawned the reviewer from the values it pinned, and checked against them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import * as decisions from '../scripts/lib/decisions.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

test('plan-verdict schema (spawn-node gate variant): `settings {model, effort}` is required', () => {
  const g = read('scripts/spawn-node.mjs').match(/if \(variant === 'gate'\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.match(g.match(/required: \[('schema_version'[^\]]*)\]/)[1], /'settings'/, 'the round\'s settings are required');
  const s = g.match(/\n        settings: \{([\s\S]*?)\n        \},/);
  assert.ok(s, 'the schema declares a `settings` property');
  assert.match(s[1], /required: \['model', 'effort'\]/);
  assert.match(s[1], /additionalProperties: false/);
});

test('gateSettingsErrors: a round whose settings match what was pinned passes; any other is named', () => {
  const { gateSettingsErrors } = decisions;
  assert.equal(typeof gateSettingsErrors, 'function', 'lib/decisions.mjs has no gateSettingsErrors');
  const pinned = { model: 'opus', effort: 'low' };
  assert.deepEqual(gateSettingsErrors({ model: 'opus', effort: 'low' }, pinned), []);
  assert.deepEqual(gateSettingsErrors({ model: 'opus', effort: null }, { model: 'opus', effort: null }), []);
  assert.match(gateSettingsErrors({ model: 'sonnet', effort: 'low' }, pinned).join(' '), /model.*sonnet.*opus/);
  assert.match(gateSettingsErrors({ model: 'opus', effort: 'high' }, pinned).join(' '), /effort.*high.*low/);
  assert.equal(gateSettingsErrors(undefined, pinned).length, 1, 'a verdict with no settings is refused');
});

test('spawn-node checks a gate verdict\'s settings against the model and effort it pinned', () => {
  const src = read('scripts/spawn-node.mjs');
  const branch = src.match(/\} else if \(schemaVariant === 'gate'\) \{([\s\S]*?)\} else if/)[1];
  assert.match(branch, /gateSettingsErrors\(payload\.settings, \{ model, effort: args\.effort \?\? null \}\)/);
  assert.match(branch, /DEGRADED/, 'a mismatch is not reported OK');
});

test('plan-review: the caller sets the round\'s settings from what it pinned, and the Output contract carries them', () => {
  const src = read('skills/plan-review/SKILL.md');
  assert.match(flat(src), /`settings`/, 'the skill does not name where the round\'s settings are recorded');
  const out = src.match(/\n## Output contract\n([\s\S]*?)(?=\n## )/)[1];
  const json = JSON.parse(out.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.deepEqual(Object.keys(json.settings ?? {}).sort(), ['effort', 'model']);
});

test('the contract doc states the plan-verdict shape with `settings`', () => {
  assert.match(flat(read('shared/claude-md-contract.md')), /settings\{model, effort\}/);
});
