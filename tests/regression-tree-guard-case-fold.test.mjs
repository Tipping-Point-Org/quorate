// G-7 of 20261013-233901-rv-delivery-remediation-review: the tree guard matched the inferred input set's root manifests
// with a case-sensitive `includes`. On a case-insensitive file system (Windows, macOS by default) an untracked
// `Package.json` is the file npm reads, and the inferred set's owner (io/preflight-cache.mjs) finds it with existsSync,
// yet the guard let it through, so the candidate checks could certify against a file the commit does not contain. The
// contract source compared case-sensitively too. Refusing too much is the safe direction, as admitGroups already says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeGuardRefusals } from '../scripts/lib/remediation-chain.mjs';

const C = { source_globs: ['src/**'], test_globs: ['tests/**'] };

test('with no declared inputs, a root manifest in another letter case still refuses', () => {
  for (const m of ['Package.json', 'PACKAGE.JSON', 'Cargo.Lock']) {
    const r = treeGuardRefusals({ caseInsensitive: true,  files: [m], untracked: [m], candidate: new Set(), contract: C, contractSource: 'CLAUDE.md' });
    assert.deepEqual(r.map((x) => x.path), [m], m);
    assert.match(r[0].why, /inferred/);
  }
});

test('the contract source in another letter case still refuses under a declared input set', () => {
  const declared = { ...C, review: { preflight_inputs: ['src/**'] } };
  const r = treeGuardRefusals({ caseInsensitive: true,  files: ['claude.md'], untracked: [], candidate: new Set(), contract: declared, contractSource: 'CLAUDE.md' });
  assert.deepEqual(r.map((x) => x.path), ['claude.md']);
  assert.match(r[0].why, /contract/);
});

// G-4 of 20261014-000825-rv-delivery-remediation-2-review: the declared review.preflight_inputs were still matched
// case-sensitively, so `config/build.json` reported by git escaped a declared `Config/build.json`.
test('a declared check input in another letter case still refuses', () => {
  const declared = { ...C, review: { preflight_inputs: ['Config/build.json', 'Docs/**'] } };
  for (const p of ['config/build.json', 'CONFIG/BUILD.JSON', 'docs/a.md']) {
    const r = treeGuardRefusals({ caseInsensitive: true,  files: [p], untracked: [p], candidate: new Set(), contract: declared, contractSource: 'CLAUDE.md' });
    assert.deepEqual(r.map((x) => x.path), [p], p);
    assert.match(r[0].why, /preflight_inputs/);
  }
});
