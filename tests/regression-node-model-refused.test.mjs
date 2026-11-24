// G-7 and G-11 of 20261123-020742-m3s7-b4-remediation-3-review: the never-a-cheap-reviewer guard failed open and was
// narrower than its policy. spawn-node read lens_models_refused from a roster whose read or parse error became {}, so a
// missing or corrupt lens-roster.json, or one without the key, refused nothing (G-7); and it checked only --mode lens,
// while shared/external-reviewers.md promises that no verification node runs a refused model, reconcile and the
// second opinion included (G-11). The decision is one pure function, refusedNodeModel, and spawn-node applies it to
// every mode it spawns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import * as decisions from '../scripts/lib/decisions.mjs';

const { refusedNodeModel } = decisions;
const roster = { lens_models_refused: ['haiku'] };

test('a roster that could not be read, or declares no list, refuses rather than permits', () => {
  assert.equal(typeof refusedNodeModel, 'function', 'lib/decisions.mjs has no refusedNodeModel');
  assert.match(refusedNodeModel({ model: 'opus', roster: null, rosterError: 'ENOENT' }).error ?? '', /lens-roster\.json/);
  assert.match(refusedNodeModel({ model: 'opus', roster: {} }).error ?? '', /lens_models_refused/);
  assert.match(refusedNodeModel({ model: 'opus', roster: { lens_models_refused: 'haiku' } }).error ?? '', /lens_models_refused/);
  assert.match(refusedNodeModel({ model: 'opus', roster: { lens_models_refused: [''] } }).error ?? '', /lens_models_refused/);
});

test('a refused model is refused for every mode, a permitted one for none', () => {
  for (const mode of ['lens', 'reconcile', 'panel', 'intent', 'remediate', 'gate']) {
    assert.equal(refusedNodeModel({ mode, model: 'claude-haiku-4', roster }).refused, 'haiku', `--mode ${mode} ran a refused model`);
    const ok = refusedNodeModel({ mode, model: 'opus', roster });
    assert.equal(ok.refused, undefined);
    assert.equal(ok.error, undefined);
  }
});

test('spawn-node applies the decision with no mode condition and no swallowed roster error', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  assert.match(src, /refusedNodeModel\(/, 'spawn-node does not apply refusedNodeModel');
  assert.doesNotMatch(src, /mode === 'lens'\s*\?\s*\(basisLadderRoster\(\)\.lens_models_refused/, 'the guard is still lens-only');
});
