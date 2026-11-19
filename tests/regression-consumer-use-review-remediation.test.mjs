// Remediation of run 20261007-031302-consumer-use-review: the review of the CI fixes and the Consumer-use fixes
// (reconcile batching among them). Each test reproduces one confirmed group and was seen red before its fix.
// Split into 3 files by split-slow-test-files.md; the others are regression-consumer-use-review-remediation-*.test.mjs, and the
// fixture they share is consumer-use-review-remediation-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, REPO_ROOT } from './helpers.mjs';
import { read, fakeMain, batchedRun, remainingGrantProblems } from './consumer-use-review-remediation-fixture.mjs';

// ----------------------------------------------------------------------------------------------------- G-15
// A batched reconcile gave EVERY batch the barrier's full timeout and budget, so a barrier of N batches could run N
// times its declared ceiling. Operator, 2026-10-07: "Share one ceiling". Here the barrier allows 30 s, batch 1 takes
// 9 s and batch 2 takes 25 s: with per-batch ceilings both finish; with one shared ceiling the second gets only what
// the first left (~21 s) and cannot. (Since G-15 of the reconcile-batches review each batch is granted an even share of
// the time left, so batch 1 has 15 s, and the fixture was widened from 15 s to keep batch 1 inside its share.)
test('G-15: the batches of one barrier share its timeout — the second gets what the first left', (t) => {
  const { status, graph } = batchedRun(t, { reviewYaml: ['  barrier_timeout_minutes: 0.5'], env: { FAKE_RECONCILE_MS: '9000', FAKE_RECONCILE_MS_2: '25000' } });
  assert.ok(Array.isArray(status.batches) && status.batches.length >= 1, `the barrier did not batch:\n${graph.output.slice(-800)}`);
  assert.equal(status.batches[0].state, 'OK', 'the first batch fits inside the barrier ceiling');
  assert.notEqual(status.state, 'OK',
    'two 9-second batches cannot both finish inside one 15-second barrier; with per-batch ceilings they did');
});

test('G-15: each batch is launched with the barrier\'s REMAINING budget and time, not the full ceiling', () => {
  const g = read('scripts/run-graph.mjs');
  // The loop lives in reconcileBatchLoop since reconcile-reask-shape.plan.md stage 1, shared by the barrier and the re-ask.
  assert.deepEqual(remainingGrantProblems(g), [], 'a batch must be given the time and money the barrier has left');
  const fullCeilings = g.replace('timeoutMinutes: batchShare(minutesLeft, fraction), budgetUsd: grant,',
    'timeoutMinutes: BARRIER_TIMEOUT, budgetUsd: BUDGET_BARRIER,');
  assert.notEqual(fullCeilings, g, 'the mutation must apply');
  assert.notDeepEqual(remainingGrantProblems(fullCeilings), [], 'full per-batch ceilings must be refused');
});

// --------------------------------------------------------------------------------------------- G-21 and G-2
// The "Presenting a decision" rule cited ARCHITECTURE.md A-22 — which says a choice below `measurement` gets options
// only, never a recommendation — as the authority for always ending with a suggestion. A-22 sits in §7, the decision
// layer marked deferred and not built; the rule's actual authority is A-20, "quorate recommends; the operator decides"
// (operator, 2026-10-07: "Fix the citation", A-22 left untouched). G-2 is its symptom: QUORATE.md's pointer restated
// the rule's condition instead of pointing at it.
test('G-21: the decision rule cites A-20 as its authority, and names A-22 only as the deferred section it is', () => {
  const skill = read('skills/claim-check/SKILL.md');
  const section = skill.split(/^## /m).find((s) => s.startsWith('Presenting a decision')) ?? '';
  assert.match(section, /A-20/, 'the rule must cite A-20, the ruling it rests on');
  assert.doesNotMatch(section.replace(/\s+/g, ' '), /A-22 lets only a measured option/,
    'A-22 is not the authority for presenting an unmeasured suggestion');
});

test('G-2: QUORATE.md points at the decision rule rather than restating its condition', () => {
  const q = read('QUORATE.md').replace(/\s+/g, ' ');
  const bullet = q.slice(q.indexOf('**A decision comes with'), q.indexOf('Doctrine lives in'));
  assert.ok(bullet.length > 0, 'the pointer must still exist');
  assert.doesNotMatch(bullet, /unless measured/, 'the pointer must not carry a second copy of the rule\'s condition');
});

// ----------------------------------------------------------------------------------------------------- G-8
// check-install said nothing when the reviews .gitignore was missing entirely. That is safe — new-run, the pre-flight
// and the archive each write the full file when it is absent, so nothing is committable before it exists — but the
// absence was invisible to someone reading check-install (operator, 2026-10-07: "Add a note", not staleness).
test('G-8: check-install notes a reviews .gitignore that is not written yet, without calling the install stale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-cur-g8-'));
  try {
    spawnSync('git', ['init', '--quiet'], { cwd: dir });
    fs.copyFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), path.join(dir, 'CLAUDE.md'));
    const out = runScript('check-install.mjs', ['--repo-root', dir]).output;
    assert.match(out, /note: .*\.gitignore.* not written yet/, 'the absence must be visible');
    assert.doesNotMatch(out, /STALE: .*\.gitignore/, 'and it is not a stale install');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------- G-13
// Resume reuses a reconcile when its status is OK and reconciled.md and payload.json exist. A batched barrier writes
// an OK status after EACH batch and merges only at the end, so a run killed mid-batch over the reconciled.md of an
// earlier complete run would be reused as if whole. Pinned at source — reproducing it needs a kill between batches:
// the previous render and payload are removed before any reconcile spawns, so an interrupted barrier is never reusable.
test('G-13: a fresh reconcile removes the previous render and payload before it spawns anything', () => {
  const g = read('scripts/run-graph.mjs');
  const branch = g.slice(g.indexOf("} else if (groupsOut.length && skillInstalled('reconcile')) {"));
  // Since reconcile-batches.plan.md stage 2 the clean-up is the whole RECONCILE_ARTIFACTS list, and it must come
  // before either path spawns: the unbatched spawn, or the call into runBatchedReconcile.
  const spawns = [branch.indexOf('spawnNode('), branch.indexOf('runBatchedReconcile(')].filter((i) => i !== -1);
  const firstSpawn = Math.min(...spawns);
  const clear = branch.search(/for \(const rel of RECONCILE_ARTIFACTS\)/);
  assert.ok(clear !== -1 && clear < firstSpawn, 'the previous attempt must be cleared before the first reconcile spawn');
  const lib = read('scripts/lib/reconcile-batches.mjs');
  assert.match(lib, /'reconciled\.md',/, 'and the list holds reconciled.md');
  assert.match(lib, /'evidence\/reconcile\/payload\.json',/, 'and the previous payload');
});
