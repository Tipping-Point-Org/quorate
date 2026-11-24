// G-7 (and its symptom G-8) of 20261124-140633-gsw-remediation-review-b: what the gate's writer does with a gate that
// fails its schema was told twice, in shared/compatibility.md (which owns gate.json's shape) and again in the GATE-SCHEMA
// row of shared/disk-first-protocol.md §7 (which owns what a stamp does to the gate), with the error limit restated
// beside the constant in run-graph.mjs. Two tellings drift. The row states the stamp's effect and points at the owner
// of the fitting; the fitting is told once, in compatibility.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('G-7: the GATE-SCHEMA stamp row states the effect and defers the fitting to compatibility.md', () => {
  const row = read('shared/disk-first-protocol.md').split(/\r?\n/).find((l) => l.startsWith('| `GATE-SCHEMA` |'));
  assert.ok(row, 'the GATE-SCHEMA row is missing from shared/disk-first-protocol.md');
  assert.match(row, /BLOCKED/, 'the row no longer states the stamp\'s effect');
  assert.match(row, /shared\/compatibility\.md/, 'the row does not name the owner of the fitting');
  for (const restated of [/least value/i, /fitToSchema/, /undeclared fields/i, /\beight\b/i]) {
    assert.doesNotMatch(row, restated, `the row restates the writer's mechanics (${restated})`);
  }
});

test('G-7: compatibility.md tells the fitting once, and states no error limit the writer owns', () => {
  const doc = read('shared/compatibility.md');
  assert.match(doc, /fitted to the schema/, 'the owner no longer tells the fitting');
  assert.doesNotMatch(doc, /first eight/i);
});
