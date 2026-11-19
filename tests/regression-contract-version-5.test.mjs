// contract-glob-grammar.plan.md, stage 7b (operator, 2026-10-01: "Yes, bump to 5 (Recommended)"). The glob grammar
// changed what an unchanged glob means — `docs/**/README.md` stopped covering all of `docs/` — and made `?`, `[`, braces
// and `..` refused. CLAUDE.md records why a meaning change with no signal is the harm (`budget_usd_per_node: ""`), so a
// contract that says 4 must be told, by key, what moved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONTRACT_VERSION, CONTRACT_CHANGES, contractVersionGap, contractVersionMessage } from '../scripts/lib/contract-version.mjs';
import { REPO_ROOT } from './helpers.mjs';

test('the engine implements contract version 5, and a version-4 contract is told what moved, by key', () => {
  // AT LEAST 5: the engine has moved past it (6, reviewer-preflight), and what this guards is that version 5 exists and
  // says what it changed, not that it is still the newest.
  assert.ok(CONTRACT_VERSION >= 5, 'the glob grammar shipped without a contract version');
  const entry = CONTRACT_CHANGES[5];
  for (const k of ['source_globs', 'test_globs', 'doc_paths', 'generated_globs', 'review.preflight_inputs', 'doc_roles']) {
    assert.ok(entry.keys.includes(k), `version 5 does not name ${k}`);
  }
  assert.match(entry.what, /refused/);
  assert.match(entry.what, /exact/);
  const msg = contractVersionMessage(contractVersionGap(4, CONTRACT_VERSION, 'graph_contract_version'));
  assert.match(msg, /doc_paths/, 'a version-4 contract is not told which keys moved');
});

test('the contract doc\'s version table names versions 4 and 5', () => {
  const s = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'claude-md-contract.md'), 'utf8');
  assert.match(s, /^\| `5` \|/m, 'the version table has no row for 5');
  assert.match(s, /^\| `4` \|/m, 'the version table has no row for 4');
});
