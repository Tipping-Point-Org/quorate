// G-8 OF 20261026-190950-rct-remediation-2-review: shared/external-reviewers.md says the full invocation of every external
// role, a judge's included, is owned by shared/claude-md-contract.md, and that page's `scripts/external-review.mjs` row
// documented review, propose and claim-check only. A judge needs `--mode tie-break`, `--participants` and `--surface`
// (run-graph.mjs, the adjudicator spawn), so the pointer led to a page with no runnable judge invocation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('G-8: the owner of external-review.mjs\'s invocation documents the tie-break mode a judge is called in', () => {
  assert.match(read('shared/external-reviewers.md'), /full invocation is owned by `shared\/claude-md-contract\.md`/,
    'the pointer this test holds the target to');
  const row = read('shared/claude-md-contract.md').split(/\r?\n/).find((l) => l.startsWith('| `scripts/external-review.mjs` |'));
  assert.ok(row, 'claude-md-contract.md has the external-review.mjs row');
  for (const flag of ['--mode tie-break', '--participants', '--surface']) {
    assert.ok(row.includes(flag), `the row documents ${flag}`);
  }
  // The flags the row names are the flags the one caller passes.
  const spawn = read('scripts/run-graph.mjs');
  for (const flag of ["'--mode', 'tie-break'", "'--participants'", "'--surface'"]) {
    assert.ok(spawn.includes(flag), `run-graph.mjs still passes ${flag}`);
  }
});
