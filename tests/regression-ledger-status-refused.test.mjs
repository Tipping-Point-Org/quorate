// G-6 of 20261029-235315-rdr-remediation-4-review (panel-codex-contract, LOW). The fold read each node status, and the
// gate, through the run's owner inside catches that returned null or nothing, so an ECONFINED refusal (a link standing at
// the file) was indistinguishable from a status that was absent or unparseable. The fold still confirms nothing on it,
// the safe direction; the refusal is now said. findings-ledger is an entry script that folds on import, so its shape is
// read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'findings-ledger.mjs'), 'utf8');

test('G-6: a refused node status or gate is named, not dropped as absent', () => {
  const start = src.indexOf('let reviewed = false;');
  const block = src.slice(start, src.indexOf('lockLedger();', start));
  assert.ok(block.length > 0, 'the review-coverage block was not found');
  assert.doesNotMatch(block, /catch\s*\{\s*return null;\s*\}/, 'a status read swallows every error, a refusal included');
  assert.doesNotMatch(block, /\}\s*catch\s*\{\s*\/\*/, 'the gate read swallows every error, a refusal included');
  assert.ok((block.match(/ECONFINED/g) ?? []).length >= 1, 'a refused gate is not told apart');
  // The statuses are no longer read a second time here (G-9 below): the first read, which stops the fold on a refused
  // or unreadable status with its reason, is the one the coverage uses.
  assert.ok(/readNodeStatus\(foldOwner/.test(src), 'the statuses are not read through the strict reader');
});

// G-8 of 20261102-231209-rbr-remediation-6-review: the admitted-directory guard of the ingest stood twice, unchanged, two
// copies of one admission rule that could drift apart (ARCHITECTURE A-1).
test('G-8: the ingest\'s admission guard stands once', () => {
  assert.equal((src.match(/if \(!admittedDir\) die\(/g) ?? []).length, 1, 'the admitted-directory guard is repeated');
});

// G-9 of 20261102-231209-rbr-remediation-6-review: the fold listed nodes/ and read every status to validate it, then
// listed and read them all again to find the OK lenses; the validated statuses are kept and used.
test('G-9: the fold lists nodes/ and reads each status once', () => {
  assert.equal((src.match(/foldOwner\.list\(\['nodes'\]\)/g) ?? []).length, 1, 'nodes/ is listed twice in the fold');
  const start = src.indexOf('let reviewed = false;');
  const block = src.slice(start, src.indexOf('lockLedger();', start));
  assert.doesNotMatch(block, /foldOwner\.read\(\['nodes'/, 'the coverage block reads each status again');
});
