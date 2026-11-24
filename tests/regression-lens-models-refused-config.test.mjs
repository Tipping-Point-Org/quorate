// G-6 of 20261123-011514-m3s7-b4-remediation-2-review (ARCHITECTURE.md §4): spawn-node, the generic node orchestrator,
// held the refused cheap-reviewer model as a provider-specific literal (`/haiku/i`), so a runtime with another model
// vocabulary could not be held to the rule without editing orchestration code. The refused names are configuration, in
// lens-roster.json beside default_models, and spawn-node applies them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
const roster = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

test('the models refused for a lens are declared in lens-roster.json, not in spawn-node', () => {
  assert.ok(Array.isArray(roster.lens_models_refused) && roster.lens_models_refused.length > 0,
    'lens-roster.json declares no lens_models_refused');
  assert.ok(roster.lens_models_refused.every((m) => typeof m === 'string' && m.trim()), 'an entry is not a model name');
  assert.ok(typeof roster.$lens_models_refused === 'string', 'the key carries no $ comment saying why');
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /\/haiku\/i/, 'spawn-node still holds the model name as a literal');
  assert.match(src, /lens_models_refused/, 'spawn-node does not read the configured list');
});
