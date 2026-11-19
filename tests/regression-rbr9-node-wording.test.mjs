// A node is the node runtime's, not one vendor's (G-15 of 20261103-022403-rbr-remediation-8-review; ARCHITECTURE.md A-9):
// the G-3 cleanup of the round before left "Claude node" and "Claude child" in spawn-node.mjs, lib/decisions.mjs and
// external-review.mjs, the scoped files of that review, where the runtime that spawns a node is configurable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G-15: the scoped files call a node the node runtime\'s, not Claude\'s', () => {
  for (const rel of ['scripts/spawn-node.mjs', 'scripts/lib/decisions.mjs', 'scripts/external-review.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
    const hits = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /Claude (node|child|nodes|children)\b/.test(l));
    assert.deepEqual(hits.map(([n]) => `${rel}:${n}`), [], `${rel} names one vendor for the node runtime`);
  }
});
