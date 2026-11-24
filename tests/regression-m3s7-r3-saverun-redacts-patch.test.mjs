// saveRun REDACTS WHAT IT WRITES NOW, NOT THE WHOLE RECORD (G-9 of 20261121-214741-m3s7-b1-remediation-2-review): it ran
// redactTree over the merged run.json, so a machine field such as repo_root or archive_to whose path held a
// credential-shaped segment was rewritten on the first save, and admission or a follow-up mint could no longer tie the
// run to its repository. The record new-run wrote is the machine's; only a patch carries prose to redact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../scripts/remediate.mjs', import.meta.url), 'utf8');

test('saveRun redacts the patch and spreads the loaded record unredacted', () => {
  const start = src.indexOf('const saveRun = ');
  assert.ok(start >= 0, 'saveRun not found');
  const def = src.slice(start, src.indexOf('const stamps = new Set', start));
  assert.ok(!/redactTree\(\{\s*\.\.\.loadRun\(/.test(def), `the whole loaded record is redacted: ${def}`);
  // Through patchRunJson since G-11 of 20261124-180917-gsw-remediation-4-review-b: redactTree is the patch's transform,
  // and the owner spreads the record it read in as it was (tests/regression-remediate-saverun-redacted.test.mjs runs it).
  assert.match(def, /patchRunJson\([^,]+,\s*patch,\s*\{\s*transform: \(p\) => redactTree\(/, `the patch is not redacted: ${def}`);
});
