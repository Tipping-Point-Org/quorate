// G-8 of 20261013-220031-rv-delivery: with no declared review.preflight_inputs, the runner's tree guard refused every
// TRACKED change outside the candidate but let every untracked non-source, non-test file through, so an untracked
// dependency manifest (a new package.json, uv.lock or pyproject.toml) could change what the candidate checks certify
// without entering the commit. The input set is then INFERRED, and its one owner (lib/preflight-cache.mjs) puts the
// root-level manifests in it; the guard now refuses those whether git tracks them or not. Tracked changes outside the
// candidate still refuse, as the plan states ("Where preflight_inputs is inferred, every changed tracked file outside
// the candidate is refused").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeGuardRefusals } from '../scripts/lib/remediation-chain.mjs';

const C = { source_globs: ['src/**'], test_globs: ['tests/**'] };

test('with no declared inputs, an untracked root dependency manifest outside the candidate refuses', () => {
  for (const m of ['package.json', 'uv.lock', 'pyproject.toml', 'Cargo.lock']) {
    const r = treeGuardRefusals({ caseInsensitive: true,  files: [m, 'notes.txt'], untracked: [m, 'notes.txt'], candidate: new Set(), contract: C, contractSource: 'CLAUDE.md' });
    assert.deepEqual(r.map((x) => x.path), [m], m);
    assert.match(r[0].why, /inferred/);
  }
});

test('a manifest is not an inferred input below the root, and a declared input set decides on its own', () => {
  const nested = treeGuardRefusals({ caseInsensitive: true,  files: ['docs/package.json'], untracked: ['docs/package.json'], candidate: new Set(), contract: C });
  assert.deepEqual(nested, []);
  const declared = { ...C, review: { preflight_inputs: ['src/**'] } };
  assert.deepEqual(treeGuardRefusals({ caseInsensitive: true,  files: ['package.json'], untracked: ['package.json'], candidate: new Set(), contract: declared }), []);
});
