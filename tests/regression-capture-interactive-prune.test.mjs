// G-9 (and its symptom G-8) of 20261116-200635-m2-9a-high: pruneOwnLabels read and parsed every label's status.json
// before asking whether the label was old enough to prune, though the stat it had already taken holds the time. Every
// interactive capture paid one read per kept label, O(L^2) across the retention window. A label inside the window is
// now never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneOwnLabels, WRITER } from '../scripts/io/capture-interactive.mjs';

const DAY = 24 * 60 * 60 * 1000;
function owner(labels) {
  const reads = [];
  const removed = [];
  return {
    reads, removed,
    list: () => labels.map((l) => ({ name: l.name, isDirectory: () => true })),
    stat: ([name]) => ({ size: 100, mtimeMs: labels.find((l) => l.name === name).mtimeMs }),
    read: ([name]) => { reads.push(name); return JSON.stringify(labels.find((l) => l.name === name).status); },
    remove: ([name]) => { removed.push(name); },
  };
}

test('a label inside the retention window is not read; an expired one is read, checked and pruned', () => {
  const now = Date.UTC(2026, 10, 16);
  const o = owner([
    { name: 'fresh', mtimeMs: now - DAY, status: {} },
    { name: 'old', mtimeMs: now - 40 * DAY, status: { writer: 'x', schema_version: 1, label: 'old' } },
  ]);
  pruneOwnLabels(o, 30, now);
  assert.deepEqual(o.reads, ['old'], 'a label inside the retention window was read');
  // G-13 of 20261117-013640-m2-9a-final: a failed removal of an expired label of ours was swallowed with every other
  // error, so retention of byte-exact, possibly credential-bearing captures could fail with no notice. It is reported.
  const ours = owner([{ name: 'old', mtimeMs: now - 40 * DAY, status: { writer: WRITER, schema_version: 1, label: 'old' } }]);
  ours.remove = () => { throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }); };
  const failures = [];
  pruneOwnLabels(ours, 30, now, { onFailure: (label, e) => failures.push(`${label}: ${e.message}`) });
  assert.deepEqual(failures, ['old: EBUSY: resource busy'], 'a failed removal of an expired label was swallowed');
});

