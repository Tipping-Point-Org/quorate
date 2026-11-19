// A FLAG WITH NO VALUE WAS READ AS AN ABSENT FLAG (G-8 of 20261020-113229-ciss-remediation-3-review).
//
// Every value-taking flag in new-run read `a[++i]` unchecked, so a trailing `--base` left args.base undefined and the
// mint fell back to the default base: a different diff than the operator asked for, with no error. `--base --dry-run`
// was worse, taking the next flag as the value and dropping it. A missing value is refused, naming the flag.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript, withTempDir } from './helpers.mjs';

const VALUE_FLAGS = [
  '--base', '--repo-root', '--slug', '--request', '--validate-settings', '--test-preflight-stall-ms', '--runtime-bin',
  '--now', '--remediates', '--groups', '--operator-quote', '--follows-remediation',
];

test('regression: a value-taking flag with no value is refused, not dropped', () => {
  withTempDir((dir) => {
    for (const flag of VALUE_FLAGS) {
      const trailing = runScript('new-run.mjs', ['--dry-run', '--no-verify-reviewers', flag], { cwd: dir });
      assert.equal(trailing.status, 2, `${flag} trailing:\n${trailing.output}`);
      assert.match(trailing.stderr, new RegExp(`${flag} needs a value`), `${flag} trailing:\n${trailing.output}`);

      const swallowing = runScript('new-run.mjs', [flag, '--dry-run', '--no-verify-reviewers'], { cwd: dir });
      assert.equal(swallowing.status, 2, `${flag} before another flag:\n${swallowing.output}`);
      assert.match(swallowing.stderr, new RegExp(`${flag} needs a value`),
        `${flag} must not take the next flag as its value:\n${swallowing.output}`);
    }
  });
});

// G-4 of 20261020-122714-ciss-remediation-4b-review: `--full-sweep` with no paths pushed nothing, scope selection read the
// empty list as "no sweep", and the run silently took a diff-derived scope instead of the sweep the operator asked for.
test('regression: --full-sweep with no paths is refused, not read as a diff-scoped run', () => {
  withTempDir((dir) => {
    for (const argv of [['--dry-run', '--no-verify-reviewers', '--full-sweep'], ['--full-sweep', '--dry-run', '--no-verify-reviewers']]) {
      const res = runScript('new-run.mjs', argv, { cwd: dir });
      assert.equal(res.status, 2, `${argv.join(' ')}:\n${res.output}`);
      // The shared parser's refusal (entrypoint-argv.plan.md stage 3), naming the flag.
      assert.match(res.stderr, /--full-sweep needs at least one value/, `${argv.join(' ')}:\n${res.output}`);
    }
  });
});
