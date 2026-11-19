// The re-ask's groups files are named from ONE constant, RECONCILE_REASK_GROUPS (G-1 of 20261024-024945-rrs-delivery;
// the plan's intent names it). G-2 was its symptom: RECONCILE_ARTIFACTS spelled the pattern again beside
// reaskGroupsFile, two naming authorities for one artifact family, so a rename could leave the cleanup clearing a
// different set from the one run-graph writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rb from '../scripts/lib/reconcile-batches.mjs';

test('G-1: RECONCILE_REASK_GROUPS names the re-ask groups files, and reaskGroupsFile is built from it', () => {
  assert.equal(typeof rb.RECONCILE_REASK_GROUPS, 'string', 'RECONCILE_REASK_GROUPS must exist');
  assert.equal(rb.RECONCILE_REASK_GROUPS.split('*').length, 2, 'one `*` for the batch number');
  for (const n of [1, 2, 7]) assert.equal(rb.reaskGroupsFile(n), rb.RECONCILE_REASK_GROUPS.replace('*', String(n)));
});

test('G-2: RECONCILE_ARTIFACTS clears that same constant, not a second spelling of it', () => {
  assert.ok(rb.RECONCILE_ARTIFACTS.includes(rb.RECONCILE_REASK_GROUPS));
  assert.equal(rb.RECONCILE_ARTIFACTS.filter((p) => /reask-\*/.test(p)).length, 1);
});
