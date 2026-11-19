// A fallback that reversed a deliberate degradation.
//
// Found by: arch-review, 20260804-202327-sweep2 (G-10). spawn-node carried a DEFAULT_BASIS table
// duplicating lens-roster.json. The roster strips `architecture_doc` from arch-review when
// doc_roles.architecture is undeclared — precisely so the lens cannot cite a document that does not
// exist — and the fallback handed it straight back. Two files claimed authority over one decision
// and disagreed about the only case that mattered.
//
// The trailing `['invariant','convention']` default was worse: `invariant` is the one basis that
// can raise a non-waivable finding, and it would have been granted to any node whose configuration
// failed to arrive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAllowedBasis } from '../scripts/lib/decisions.mjs';
import { repoRunDir, runScript, SCRIPTS_DIR } from './helpers.mjs';

test('regression: a lens with no declared basis is a fatal configuration error, not a default', () => {
  assert.throws(() => resolveAllowedBasis('arch-review', null), /required for lens node/);
  assert.throws(() => resolveAllowedBasis('arch-review', []), /required for lens node/);
  assert.throws(() => resolveAllowedBasis('arch-review', ''), /no fallback table/);
});

test('regression: no fallback grants `invariant` to a misconfigured node', () => {
  // The old trailing default was ['invariant','convention']. Nothing may hand out the basis that
  // raises non-waivable findings on the strength of a missing argument.
  for (const missing of [null, undefined, '', []]) {
    assert.throws(() => resolveAllowedBasis('any-lens', missing));
  }
});

test('a declared basis is honoured, from a list or a comma string', () => {
  assert.deepEqual(resolveAllowedBasis('x', ['convention', 'invariant']), ['convention', 'invariant']);
  assert.deepEqual(resolveAllowedBasis('x', 'convention, invariant'), ['convention', 'invariant']);
});

// The source of truth is the roster. This asserts the duplicate is really gone rather than moved.
test('regression: no per-lens basis table survives outside lens-roster.json', () => {
  const src = fs.readFileSync(path.join(SCRIPTS_DIR, 'spawn-node.mjs'), 'utf8');
  const live = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(live, /DEFAULT_BASIS\s*=/, 'the duplicated authority must not come back');
  assert.doesNotMatch(live, /\[\s*'invariant',\s*'convention'\s*\]/, 'nor the trailing default');
});

// Enforced at the process boundary too.
test('regression: spawn-node refuses a lens node with no --allowed-basis', () => {
  // One of this repository's runs, so the refusal is the basis one and not admission's: run-dir-trust.plan.md stage 3
  // (ARCHITECTURE A-28). --print-cmd stops before any child is spawned, should the basis check ever stop refusing.
  const r = runScript('spawn-node.mjs', [
    '--print-cmd', '--run-dir', repoRunDir({ prefix: 'quorate-basis-lens-' }).dir, '--node-id', 'arch-review', '--mode', 'lens',
    '--schema-variant', 'code', '--skill-command', '/arch-review',
  ]);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /--allowed-basis is required/);
});

// A prose node has no schema and no basis. Making the lens path fatal must not make this one fatal
// — that near-miss would have killed second-opinion outright.
test('regression: a prose node needs no basis and must not be refused', () => {
  // An admitted run (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28): a refusal at admission would pass the assertion
  // below without ever reaching basis resolution. --print-cmd exits 0 once the child's argv is built, before any spawn.
  const { dir } = repoRunDir({ prefix: 'quorate-basis-prose-' });
  fs.writeFileSync(path.join(dir, 'node-settings.json'), '{}');   // no node runs without a policy file
  const r = runScript('spawn-node.mjs', [
    '--print-cmd', '--run-dir', dir, '--node-id', 'second-opinion', '--mode', 'panel',
    '--schema-variant', 'none', '--skill-command', '/second-opinion',
  ]);
  assert.doesNotMatch(r.output, /--allowed-basis is required/,
    'schemaVariant `none` must return before any basis resolution');
  assert.equal(r.status, 0, `the prose node must get as far as its child's argv; got ${r.status}\n${r.output.slice(-400)}`);
});
