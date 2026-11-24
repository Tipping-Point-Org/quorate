// A SYMPTOM WITH NO ROOT IS NOT LEFT ORPHANED (G-7 of 20261121-204740-m3s7-b1-remediation-review; I-13 of
// .claude/requests/m3-stage7-fixes.md): checkRootLinks returned a symptom row unchanged when its root_cause_group was
// empty, and named only the links it cleared, so a symptom never given a root, or whose root was cleared, was fixed by
// no group, remediated by none and reported nowhere. It is now recorded confirmed and named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkRootLinks } from '../scripts/lib/reconcile-batches.mjs';

test('a symptom with no root, or whose root is cleared, is recorded confirmed and named', () => {
  const { rows, cleared, orphaned } = checkRootLinks([
    { group_id: 'G-1', decision: 'confirmed', root_cause_group: '' },
    { group_id: 'G-2', decision: 'symptom', root_cause_group: 'G-1' },
    { group_id: 'G-3', decision: 'symptom', root_cause_group: '', severity: 'MEDIUM', rationale: 'kept' },
    { group_id: 'G-4', decision: 'symptom', root_cause_group: 'G-9' },
    { group_id: 'G-5', decision: 'symptom' },
    { group_id: 'G-6', decision: 'dropped', root_cause_group: '' },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.group_id, r]));
  assert.equal(by['G-2'].decision, 'symptom', 'a symptom whose root is judged stands');
  assert.equal(by['G-3'].decision, 'confirmed', 'a symptom never given a root is remediable');
  assert.equal(by['G-3'].severity, 'MEDIUM');
  assert.equal(by['G-3'].rationale, 'kept');
  assert.equal(by['G-4'].decision, 'confirmed', 'a symptom whose root was cleared is remediable');
  assert.equal(by['G-5'].decision, 'confirmed', 'an absent root is no root');
  assert.equal(by['G-6'].decision, 'dropped', 'another decision is left alone');
  assert.deepEqual(cleared, [{ from: 'G-4', to: 'G-9' }]);
  assert.deepEqual(orphaned, ['G-3', 'G-4', 'G-5'], 'each one is named');
});

test('run-graph names every symptom checkRootLinks recorded confirmed, on both of its paths', () => {
  const src = fs.readFileSync(new URL('../scripts/run-graph.mjs', import.meta.url), 'utf8');
  const calls = [...src.matchAll(/checkRootLinks\(/g)].length;
  assert.equal(calls, 2, `run-graph calls checkRootLinks ${calls} times; each call site must name what it reclassifies`);
  assert.equal([...src.matchAll(/for \(const id of (?:links\.)?orphaned\)/g)].length, 2, 'both call sites name the orphaned ids');
});
