// A FLAG WITH NO VALUE WAS READ AS AN ABSENT FLAG, IN run-graph TOO (G-7 of 20261020-122714-ciss-remediation-4b-review).
//
// new-run gained a value guard (G-8 of 20261020-113229-ciss-remediation-3-review); run-graph kept reading `a[++i]`
// unchecked. A trailing `--only` became [], which the unknown-id guard had nothing to refuse, and every lens was
// deselected: a gate reachable by PASS that spawned nothing. A trailing `--repo-root` reviewed the cwd instead, and a
// trailing `--preflight` fell back to auto (G-8, its symptom). Both scripts now take a value through one helper.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runScript, withTempDir } from './helpers.mjs';
import { parseArgv } from '../scripts/lib/argv.mjs';
import { ARGV_SPECS } from '../scripts/lib/argv-specs.mjs';

const VALUE_FLAGS = ['--run-dir', '--repo-root', '--only', '--preflight', '--runtime-bin'];

test('regression: a run-graph value-taking flag with no value is refused, not dropped', () => {
  withTempDir((dir) => {
    // A run directory the orchestrator refuses, so nothing can be spawned whichever way the parse goes.
    const bogus = path.join(dir, 'not-a-run');
    for (const flag of VALUE_FLAGS) {
      const trailing = runScript('run-graph.mjs', ['--skip-panel', ...(flag === '--run-dir' ? [] : ['--run-dir', bogus]), flag],
        { cwd: dir, mayFanOut: true });
      assert.equal(trailing.status, 2, `${flag} trailing:\n${trailing.output}`);
      assert.match(trailing.stderr, new RegExp(`${flag} needs a value`), `${flag} trailing:\n${trailing.output}`);

      const swallowing = runScript('run-graph.mjs', [flag, '--skip-panel', ...(flag === '--run-dir' ? [] : ['--run-dir', bogus])],
        { cwd: dir, mayFanOut: true });
      assert.equal(swallowing.status, 2, `${flag} before another flag:\n${swallowing.output}`);
      assert.match(swallowing.stderr, new RegExp(`${flag} needs a value`),
        `${flag} must not take the next flag as its value:\n${swallowing.output}`);
    }
  });
});

test('regression: --only naming no lens at all is refused, not read as "deselect every lens"', () => {
  withTempDir((dir) => {
    const res = runScript('run-graph.mjs', ['--only', ' , ', '--run-dir', path.join(dir, 'not-a-run')],
      { cwd: dir, mayFanOut: true });
    assert.equal(res.status, 2, res.output);
    assert.match(res.stderr, /--only names no lens/, res.output);
  });
});

// flagValue, the helper both scripts shared, is gone: they parse through parseArgv (entrypoint-argv.plan.md stage 3).
test('the shared parser refuses a missing value and another flag alike', () => {
  const spec = ARGV_SPECS['run-graph'];
  assert.throws(() => parseArgv(['--only'], spec), /--only needs a value/);
  assert.throws(() => parseArgv(['--only', '--resume'], spec), /--only needs a value/);
  assert.equal(parseArgv(['--only', 'v'], spec).values.only, 'v');
});
