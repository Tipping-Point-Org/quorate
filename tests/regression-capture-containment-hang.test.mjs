// Part 2 of 2 of regression-capture-containment.test.mjs: a capture that never returns is killed at its bound. Split by
// split-slow-test-files.md, because this one test waits out a one-minute bound; the fixture is capture-containment-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, REPO_ROOT, repoRunDir, detectorFixture } from './helpers.mjs';
import { forbiddenTailToken } from '../scripts/lib/forbidden-tail.mjs';
import { spawnSync } from 'node:child_process';
import { inRun } from './capture-containment-fixture.mjs';

// A capture is BOUNDED (G-9). Every other declared command inspects and returns, but `run` is by
// definition the one that STARTS the product and keeps running. Granting it (G-36) without a
// ceiling meant a server-style command blocked capture's blocking spawnSync until the orchestrator
// tree-killed the whole node — printing no evidence path and leaving the lens DEGRADED, which is
// the exact structural inability to report that the grant existed to remove. The fix that enabled
// the lens would have re-broken it by another route.
test('regression: a command that never returns is killed and still yields evidence', () => {
  // The contract must DECLARE the never-returning command as commands.run, because that is the
  // only way capture will execute it — and feature-verify is the only node granted it (G-36).
  // No spaces inside the argument: declared commands are matched by exact argv.
  const HANG = 'setInterval(()=>{},1000)';
  inRun((dir) => {
    const rj = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    rj.contract = { commands: { run: `node -e ${HANG}`, shell: '' } };
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(rj));
    const r = runScript('capture.mjs', [
      '--run-dir', dir, '--node', 'feature-verify', '--name', 'hang',
      // '1', not the '0.05' this said: capture always raised a value under a minute to 1, so this test already waited a
      // minute (G-2 of 20261004-165507-m1-6b-check-timeout), and a fraction is now refused by the one owner of what a
      // timeout may be (G-1 of 20261004-172841-m1-6b-check-timeout-2).
      '--timeout-minutes', '1',
      '--', 'node', '-e', HANG,
    ]);
    // 124 is the timeout exit capture already reserved for `status === null`.
    assert.match(r.stdout, /evidence\/feature-verify\/hang\.log/,
      'a timed-out capture must still print its evidence path — a lens that gets nothing back cannot report');
    assert.match(r.output, /124/, 'the timeout must be recorded as a timeout, not as a success');
  });
});
