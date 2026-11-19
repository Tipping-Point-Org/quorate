// reviewer-preflight.plan.md, stage 6 (operator, 2026-10-08: "no fallback. preflight test for what is needed and fails
// if something is missing"). `review.external_panel: true` used to mean "call the reviewers, and report one that is
// missing or broken in not_checked[]"; it now means "every reviewer is probed before it is used, and one that fails is
// refused — at the call, and at mint". Same spelling, different consequence, which is what the contract version exists
// to make visible (shared/claude-md-contract.md, `graph_contract_version`). And a new key says how old a passing probe
// may be before it is repeated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONTRACT_VERSION, CONTRACT_CHANGES, contractVersionGap, contractVersionMessage } from '../scripts/lib/contract-version.mjs';
import { REPO_ROOT } from './helpers.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

test('the engine implements contract version 6, and a version-5 contract is told what moved, by key', () => {
  assert.equal(CONTRACT_VERSION, 6, 'the reviewer preflight changed what external_panel means without a contract version');
  const entry = CONTRACT_CHANGES[6];
  assert.ok(entry, 'no CONTRACT_CHANGES row for 6');
  for (const k of ['review.external_panel', 'review.reviewer_probe_max_age_hours']) {
    assert.ok(entry.keys.includes(k), `version 6 does not name ${k}`);
  }
  assert.match(entry.what, /refus/, 'the row must say a failing reviewer is now refused');
  const msg = contractVersionMessage(contractVersionGap(5, CONTRACT_VERSION, 'graph_contract_version'));
  assert.match(msg, /review\.external_panel/, 'a version-5 contract is not told that external_panel moved');
});

test('the key is documented by its owner, carried by the template, and declared here', () => {
  const owner = read('shared', 'claude-md-contract.md');
  assert.match(owner, /^\| `6` \|/m, 'the version table has no row for 6');
  assert.match(owner, /Schema version — currently `6`/);
  assert.match(owner, /\*\*`reviewer_probe_max_age_hours`/, 'the owner does not document the key');
  assert.match(owner, /reviewer_probe_max_age_hours[\s\S]{0,1200}Absent means\s+24/, 'nor what absent means');
  const template = read('CLAUDE.template.md');
  assert.match(template, /^graph_contract_version: 6$/m);
  assert.match(template, /^ {2}reviewer_probe_max_age_hours:/m, 'the template does not carry the key');
  const own = read('CLAUDE.md');
  assert.match(own, /^graph_contract_version: 6$/m, "this repository's own contract still declares 5");
  assert.match(own, /^ {2}reviewer_probe_max_age_hours:/m);
});

test('the panel guide states the refusal as the rule, and the old rule only as what it replaced', () => {
  const doc = read('shared', 'external-reviewers.md');
  assert.ok(!/`external-review\.mjs` still exits 0 and still prints an envelope/.test(doc),
    'the guide still says a missing reviewer exits 0 and the run continues');
  assert.match(doc, /reviewer preflight failed for <adapter>\/<model>\/<effort>\/<mode>\/<route>/);
  assert.match(doc, /What this replaced/, 'the old rule is named as history, not deleted silently');
  // G-12 of 20261009-232840-reviewer-preflight-r1: the contract document's own "Enabling the external panel" paragraph
  // still promised that a missing reviewer "never blocks the run".
  const owner = read('shared', 'claude-md-contract.md');
  assert.ok(!/never blocks the run/.test(owner), 'the contract document still says a missing reviewer never blocks the run');
});

// G-13 of 20261010-063310-reviewer-preflight-r6 (panel-codex-docs, MEDIUM): the owner said ANY CLI-version change forces
// a re-probe, but a declared reviewer without version_argv keys as 'undeclared', so its update is noticed only by age.
test('the key\'s documentation says a reviewer without version_argv is re-probed only by age', () => {
  const owner = read('shared', 'claude-md-contract.md');
  assert.match(owner, /without it keys as `undeclared`/);
  assert.match(owner, /declare `version_argv` for any reviewer you add/);
});
