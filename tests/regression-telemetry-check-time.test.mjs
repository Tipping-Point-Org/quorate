// telemetry-records.plan.md stage 1b: checks.json recorded each check's outcome and exit code and the whole file's
// `ran_at`, but no time per check (the request's amendment: "checks.json carries outcome and exit code, no time"), so a
// report could not say which check a slow pre-flight spent its minutes on. The time is taken in the one core both the
// pre-flight and the remediation runner's full check run through (io/declared-checks.mjs), so both carry it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { repoRunDir, REPO_ROOT, TEST_HOME } from './helpers.mjs';

const SLEEP_MS = 400;

test('stage 1b: each declared check carries started_at and a duration_ms no shorter than the command took', async () => {
  const { runDeclaredChecks } = await import('../scripts/io/declared-checks.mjs');
  const sleeper = `node -e setTimeout(()=>{},${SLEEP_MS})`;
  const commands = { build: 'node --version', test: sleeper };
  const { base, dir } = repoRunDir({ runId: 'check-time', prefix: 'quorate-check-time-', json: { contract: { commands } } });
  try {
    const before = Date.now();
    const { ran } = await runDeclaredChecks({ runDir: dir, repoRoot: REPO_ROOT, commands, nodeId: 'check-time',
      timeoutMinutes: 2, barrierKeys: new Set(['build']), env: { ...process.env, QUORATE_HOME: TEST_HOME } });
    for (const key of ['build', 'test']) {
      const r = ran.get(key);
      assert.ok(r, `${key} did not run`);
      assert.equal(typeof r.started_at, 'string', `${key} has no started_at`);
      const started = Date.parse(r.started_at);
      assert.ok(Number.isFinite(started) && started >= before - 1000, `${key}'s started_at is not a time of this run: ${r.started_at}`);
      assert.ok(Number.isInteger(r.duration_ms) && r.duration_ms >= 0, `${key} has no duration_ms: ${r.duration_ms}`);
    }
    assert.ok(ran.get('test').duration_ms >= SLEEP_MS, `the sleeping check took ${ran.get('test').duration_ms} ms, less than its ${SLEEP_MS} ms sleep`);
    assert.ok(Date.parse(ran.get('test').started_at) >= Date.parse(ran.get('build').started_at),
      'the evidence check started before the barrier');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
