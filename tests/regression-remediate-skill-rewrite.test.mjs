// THE REMEDIATE SKILL, REWRITTEN (remediate-rebuild.plan.md stage 5; design decisions 4, 7 and 8). One assertion group
// per ledger entry the rewrite answers, keyed as the ledger keys them:
//   skills/remediate/SKILL.md:0, :10   — a remediation run and a remediate node the skill described and nothing built
//   :30                                  — "only confirmed groups" contradicted the search for other instances
//   :60                                  — no round cap or design-review stop
//   :90                                  — a bare ROADMAP.md (the consumer's own file) decided the scope
//   :110                                 — nothing required the test and the fix to be committed together
//   :120, :200, shared/ledger-transitions.md:0 — the skill restated the ledger's transition table
//   :130                                 — a wrong §6 citation
//   :140, :170, :180                     — no follow-up review of the remediation's diff named
//   skills/full-review/SKILL.md:90 (remediate half) — the claim-check mechanism restated
// plus the plan's own checks: every framework path the skill names exists, and none is a bare repo-root path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { ARGV_SPECS } from '../scripts/lib/argv-specs.mjs';

const raw = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const read = (rel) => raw(rel).replace(/\s+/g, ' ');
const SKILL = read('skills/remediate/SKILL.md');
const NODE = read('prompts/remediation/PROMPT.md');

test(':0, :10 — the skill mints a remediation run and runs the node, and both exist', () => {
  assert.match(SKILL, /new-run\.mjs --slug <slug> --remediates <reviewed run dir>/);
  assert.match(SKILL, /remediate\.mjs --run-dir <remediation run dir>/);
  assert.equal(ARGV_SPECS['new-run'].options.remediates, 'string');
  assert.match(raw('scripts/new-run.mjs'), /remediates: 'remediates'/);
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'scripts', 'remediate.mjs')));
});

test(':30 — only confirmed groups are fixed, and other instances are found and deferred, not silently fixed', () => {
  assert.match(NODE, /Only `confirmed` groups/);
  assert.match(NODE, /every other one goes in `deferred`/);
});

test(':60 — the runner stops at the round cap and the skill says so', () => {
  assert.match(SKILL, /stops at the round cap/);
  assert.match(raw('scripts/remediate.mjs'), /ROUND-CAP/);
});

test(':90 — no bare ROADMAP.md; the rule is shared/remediation.md', () => {
  assert.doesNotMatch(SKILL, /\(ROADMAP\.md|ROADMAP\.md's D1/);
  assert.match(SKILL, /`<framework-root>\/shared\/remediation\.md` owns that rule/);
});

test(':110 — each cluster commits its test and fix together, and the runner checks it', () => {
  // remediation-paths stages 3+4: the RUNNER commits, so the node is told the runner commits each cluster whole.
  assert.match(NODE, /commits each cluster — its test and its fix together/);
  assert.match(raw('scripts/lib/remediation-chain.mjs'), /hasSource && (hasTest || notExpressible)/, 'no test, no commit');
  assert.match(raw('scripts/remediate.mjs'), /COMMIT-CHECK/);
});

test(':120, :200, ledger-transitions.md:0 — the transition table is pointed at, not restated', () => {
  assert.doesNotMatch(raw('skills/remediate/SKILL.md'), /^\s*\| `declined` \|/m, 'no disposition table');
  assert.match(SKILL, /`<framework-root>\/shared\/ledger-transitions\.md`, the one owner/);
});

test(':130 — no §6 citation for "declined deliberately"', () => {
  assert.doesNotMatch(SKILL, /§6: "declined deliberately/);
});

test(':140, :170, :180 — the follow-up review of the remediation diff is minted and named', () => {
  assert.match(SKILL, /mints the follow-up review of its own diff without running it/);
  assert.match(SKILL, /Then run the follow-up review the runner minted/);
});

test('full-review:90 (remediate half) — claim-check is invoked, not re-described', () => {
  assert.match(SKILL, /Run `quorate:claim-check` on the node's report/);
  assert.doesNotMatch(SKILL, /recomputes the grades/, 'how claim-check works is that skill\'s');
});

test('every framework path the skill names exists, and each is spelled under <framework-root>', () => {
  const named = [...raw('skills/remediate/SKILL.md').matchAll(/<framework-root>\/([\w./-]+\.(?:mjs|md))/g)].map((m) => m[1]);
  assert.ok(named.length >= 6, `found ${named.length}`);
  for (const rel of named) assert.ok(fs.existsSync(path.join(REPO_ROOT, rel)), `${rel} does not exist`);
  assert.doesNotMatch(raw('skills/remediate/SKILL.md'), /(^|\s)node scripts\//m, 'a repo-root path is wrong under a consumer mount');
});
