// G-10 and G-11 of 20261105-074139-crsf-remediation-3-review: containment spelled as a character-prefix test,
// `rel.startsWith('..')`, read an in-repository name beginning with `..` (`..framework`, `..surface`) as outside.
// editDenyPaths then wrote no deny rule for it, and runtimeCall admitted a panel surface inside the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { editDenyPaths } from '../scripts/lib/capabilities.mjs';
import { runtimeCall } from '../scripts/lib/decision-panel.mjs';

test('G-10: an in-repository framework or reviews path named ..x still gets its deny rule', () => {
  const out = editDenyPaths({ frameworkRel: '..framework', reviewsRel: '..reviews/runs', generatedGlobs: ['..gen/**'] });
  assert.ok(out.includes('..framework/**'), `no deny rule for ..framework: ${out.join(', ')}`);
  assert.ok(out.includes('..reviews/runs/**'), `no deny rule for ..reviews/runs: ${out.join(', ')}`);
  assert.ok(out.includes('..gen/**'), `no deny rule for ..gen/**: ${out.join(', ')}`);
});

test('G-10: a path that really leaves the repository still gets none', () => {
  const out = editDenyPaths({ frameworkRel: '../framework', reviewsRel: '..', generatedGlobs: ['..\\gen'] });
  assert.ok(!out.some((r) => r.startsWith('..')), `an outside path got a rule: ${out.join(', ')}`);
});

test('G-11: a panel surface inside the repository named ..surface is refused', () => {
  const repo = path.join(os.tmpdir(), 'crsf4b-repo');
  const args = { scripts: '/s', promptFile: 'p', out: 'o', result: 'r', repoRoot: repo };
  assert.throws(() => runtimeCall({ ...args, surface: path.join(repo, '..surface') }), /inside the repository/);
  assert.doesNotThrow(() => runtimeCall({ ...args, surface: path.join(os.tmpdir(), 'crsf4b-outside') }));
});
