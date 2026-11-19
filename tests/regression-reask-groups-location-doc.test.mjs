// G-13 of 20261024-032927-rrs-remediation-review: the run layout said the re-ask's finding-groups.reask-N.json is
// "kept under evidence/reconcile-reask/", but reaskGroupsFile names it run-relative and run-graph writes it at the
// run directory's root, beside finding-groups.batch-N.json. A reader following the layout looked in the wrong place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reaskGroupsFile } from '../scripts/lib/reconcile-batches.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('G-13: the layout puts finding-groups.reask-N.json where reaskGroupsFile puts it', () => {
  assert.equal(path.posix.dirname(reaskGroupsFile(1)), '.', 'the re-ask groups file is run-relative, at the root');
  const doc = fs.readFileSync(path.join(root, 'shared', 'disk-first-protocol.md'), 'utf8');
  const lines = doc.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*finding-groups\.reask-N\.json\s/.test(l));
  assert.ok(at >= 0, 'the run layout lists finding-groups.reask-N.json');
  // The entry runs until the next layout line that names a file.
  let end = at + 1;
  while (end < lines.length && /^\s{20,}\S/.test(lines[end])) end++;
  const entry = lines.slice(at, end).join(' ');
  assert.doesNotMatch(entry, /;\s*kept under evidence\/reconcile-reask\/\)/,
    'the groups file is not under evidence/reconcile-reask/; only the batches\' statuses and payloads are');
  assert.match(entry, /written here, beside the batch files/, 'the layout says the groups file is at the run root');
});
