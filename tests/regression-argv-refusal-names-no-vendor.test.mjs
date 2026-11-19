// regression-argv-refusal-names-no-vendor.test.mjs — G-7 of 20261023-014400-rdt-delivery.
//
// external-review's argv-size refusal is selected by the adapter (ADAPTER.prompt.via === 'argv'), yet its message named
// agy and told the operator to use --reviewer codex. Another argv adapter would have been told the wrong vendor, and the
// generic orchestrator had to be edited to add one (A-9: vendor names stay in the adapters). The refusal names the
// reviewer it was given, the budget it applied, and the remedy by mechanism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

test('the argv-size refusal names the reviewer it was given and no vendor of its own', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), 'utf8');
  // Read through the accessor since decision-panel-seats.plan.md stage 2 (no module reads prompt.via itself).
  const at = src.indexOf("reviewerPromptVia(ADAPTER) === 'argv' && !fitsInlineArgv(");
  assert.ok(at > 0, 'the argv-size refusal is not where this test looks for it');
  const block = src.slice(at, src.indexOf('\n}\n', at));
  assert.ok(!/\bagy\b|--reviewer codex|\bcodex\b/.test(block), `the refusal names a vendor:\n${block}`);
  assert.ok(/args\.reviewer/.test(block), 'the refusal does not name the reviewer it was given');
});
