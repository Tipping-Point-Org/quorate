// G-8 of 20261017-000724-sp-bugs-backout-review — THE DOCS PROMISED A GATE ENTRY archive-run DOES NOT WRITE.
//
// The `reviews_dir` paragraph of shared/claude-md-contract.md said, without exception, that evidence withheld at archive
// time is named in the gate's not-checked table. That holds for run-graph, which archives before it writes the gate. It
// stopped holding for scripts/archive-run.mjs when G-3's gate rewrite was backed out (9001e73c): a run archived later
// reports withheld evidence on stderr only. disk-first-protocol.md's evidence/ row repeats the promise (G-9, a symptom).
// Both must name the exception until G-1 is fixed in the code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('archive-run still reports withheld evidence on stderr only (the behaviour the docs must state)', () => {
  const src = read('scripts/archive-run.mjs');
  assert.match(src, /archiveStagedRun\(\{[^)]*log: \(m\) => console\.error/, 'archive-run logs to stderr');
  assert.doesNotMatch(src, /gate\.json['"]?\)?,\s*JSON\.stringify|writeFileSync\([^)]*gate/,
    'archive-run writes the gate; this test and the docs it pins are then stale');
});

test('claude-md-contract.md reviews_dir names archive-run\'s exception to the gate entry', () => {
  const doc = read('shared/claude-md-contract.md');
  const start = doc.indexOf('**`reviews_dir` — where run artifacts land');
  assert.ok(start >= 0, 'the reviews_dir paragraph is found');
  const para = doc.slice(start, doc.indexOf('\n\n', start));
  assert.match(para, /the gate's not-checked table says where/);
  assert.match(para, /archive-run\.mjs[^.]*stderr/, 'the paragraph says archive-run reports withheld evidence on stderr only');
});

// The row POINTS at the owner and restates none of it (G-21 of 20261122-014737-m3s7-b2-review-2, I-8): it once carried
// archive-run's stderr-only exception itself, a second copy of the reviews_dir rule that could drift from it (G-9 had
// made the row's copy agree; one owner removes the need).
test('disk-first-protocol.md evidence/ row points at reviews_dir and restates no exception (G-21)', () => {
  const doc = read('shared/disk-first-protocol.md');
  const start = doc.indexOf('evidence/<node-id>/');
  assert.ok(start >= 0, 'the evidence/ row is found');
  const row = doc.slice(start, doc.indexOf('evidence/remediation-runner/', start));
  assert.match(row, /claude-md-contract\.md[\s\S]*reviews_dir/, 'the row does not point at the reviews_dir owner');
  assert.doesNotMatch(row, /archive-run\.mjs|on stderr|stderr\s+only/,"the row restates archive-run's withheld-evidence exception");
});
