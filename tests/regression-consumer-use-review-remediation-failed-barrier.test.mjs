// Part 2 of 3 of regression-consumer-use-review-remediation.test.mjs: a failed batched barrier, and project-owned
// hooks. Split by split-slow-test-files.md; the fixture is consumer-use-review-remediation-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, REPO_ROOT } from './helpers.mjs';
import { read, fakeMain, batchedRun, remainingGrantProblems } from './consumer-use-review-remediation-fixture.mjs';

// ---------------------------------------------------------------------------------------------------- G-17
// When the barrier failed, the gate said "<all> group(s) left unadjudicated" even when earlier batches had judged
// most of them. The count must be the groups no surviving adjudication covers.
test('G-17: a failed batched barrier counts only the groups left without an adjudication', (t) => {
  // Batch 2 sleeps far past the 30 s barrier (test-suite-cost.md): this test needs a batch that does NOT finish, and a
  // 25 s sleep against the 30 s ceiling finished in time under the suite's load, failing the fixture's precondition. The
  // barrier kills it at its ceiling either way, so the test takes no longer.
  const { runDir, status } = batchedRun(t, { reviewYaml: ['  barrier_timeout_minutes: 0.5'], env: { FAKE_RECONCILE_MS: '9000', FAKE_RECONCILE_MS_2: '600000' } });
  assert.equal(status.batches[0].state, 'OK', 'the fixture needs the first batch judged');
  const total = JSON.parse(fs.readFileSync(path.join(runDir, 'finding-groups.json'), 'utf8')).groups.length;
  const unjudged = total - status.batches[0].groups;
  const gate = fs.readFileSync(path.join(runDir, 'gate.json'), 'utf8');
  assert.match(gate, new RegExp(`${unjudged} of ${total} group\\(s\\) left unadjudicated`),
    `the gate must count the ${unjudged} unjudged groups, not all ${total}`);
});

// ----------------------------------------------------------------------------------------------------- G-4
// A project-owned hook that calls nothing of quorate's is reported in a note, but the summary line read "install is
// current … project-owned hook(s) not compared", which a reader stops at. The summary must carry the gap too.
test('G-4: the summary names project-owned hooks that call nothing of quorate\'s', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-cur-g4-'));
  try {
    spawnSync('git', ['init', '--quiet'], { cwd: dir });
    fs.copyFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), path.join(dir, 'CLAUDE.md'));
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-push'), '#!/bin/sh\n# the project\'s own, calling nothing of quorate\'s\nexit 0\n');
    const out = runScript('check-install.mjs', ['--repo-root', dir]).output;
    const summary = out.split('\n').find((l) => /^install is current/.test(l)) ?? '';
    assert.match(summary, /call nothing of quorate's/, `the summary must carry the gap: ${summary}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
