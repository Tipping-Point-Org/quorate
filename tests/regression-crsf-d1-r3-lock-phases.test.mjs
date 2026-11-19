// G-14 of 20261105-181450-crsf-d1-remediation-2-review: shared/claude-md-contract.md lists the phases remediate.lock
// records, and archive-run.mjs writes `archiving`, which the list left out. Every phase any script writes into the lock
// must be named in that list, so an operator reading a kept lock finds its phase documented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('G-14: every phase written to remediate.lock is in the contract\'s phase list', () => {
  const written = new Set();
  for (const f of ['scripts/remediate.mjs', 'scripts/archive-run.mjs']) {
    const src = read(f);
    for (const m of src.matchAll(/setLockPhase\('([a-z-]+)'\)/g)) written.add(m[1]);
    for (const m of src.matchAll(/remediate\.lock'\], JSON\.stringify\(\{[^}]*phase: '([a-z-]+)'/g)) written.add(m[1]);
  }
  assert.ok(written.has('started') && written.has('archiving'), `found ${[...written]}`);
  const doc = read('shared/claude-md-contract.md');
  const m = doc.match(/`remediate\.lock`, created exclusively[^(]*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/);
  assert.ok(m, 'the contract states remediate.lock\'s phases');
  const listed = new Set([...m[1].matchAll(/`([a-z-]+)`/g)].map((x) => x[1]));
  for (const p of written) assert.ok(listed.has(p), `phase '${p}' is written to remediate.lock but not in the contract's list`);
});
