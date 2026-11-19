// G-1 of 20261029-055946-rdd-remediation-review (symptoms G-15, G-17, G-18, G-20, G-21, G-24): ARCHITECTURE.md A-30
// promises that every decision-driving read below an admitted run goes through the confined owner, and raw
// fs.readFileSync calls remained on the files that drive commit admission and the gate: the remediation payload and
// status (remediate.mjs), finding-groups.json, the reconcile payload and node status files (run-graph.mjs), the brief
// (spawn-node.mjs). A link planted at any of them was followed. This holds each script to reading its OWN run's files
// through the owner: a raw read whose path is built from the run directory, its nodes directory or its brief is refused.
//
// A source census, because each site sits deep inside a script's main flow that no fixture reaches in isolation; the
// owner's own refusal of a link is tested in regression-confined-path.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = {
  'scripts/remediate.mjs': /fs\.readFileSync\(\s*path\.(?:join|resolve)\(\s*runDir\b/g,
  'scripts/run-graph.mjs': /fs\.readFileSync\(\s*path\.(?:join|resolve)\(\s*(?:runDir|nodesDir)\b/g,
  'scripts/spawn-node.mjs': /fs\.readFileSync\(\s*(?:briefPath|path\.(?:join|resolve)\(\s*runDir\b)/g,
};

test('G-1: no raw read of a file below the script\'s own admitted run', () => {
  const found = [];
  for (const [rel, re] of Object.entries(RAW)) {
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
    lines.forEach((l, i) => { if (l.match(re)) found.push(`${rel}:${i + 1}: ${l.trim()}`); });
  }
  assert.deepEqual(found, [], `raw reads below the admitted run bypass the confined owner:\n${found.join('\n')}`);
});
