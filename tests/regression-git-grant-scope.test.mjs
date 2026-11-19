// G-27: node-settings.json granted `Bash(git diff:*)` and `Bash(git log:*)`. Permission rules are
// PREFIX matches with an open tail, so those two rules handed every lens the entire flag surface of
// the commands — including the three families capture.mjs refuses BY NAME:
//
//   --no-index                 reads any path the operator can read. Demonstrated live: it teed
//                              files from C:\Windows into a run's evidence directory (G-4).
//   --output=<path>            writes any path, defeating the Edit/Write denies on the same list.
//   --ext-diff/--textconv/-O   launch an arbitrary program.
//
// So a lens could read ~/.ssh/id_rsa or ~/.aws/credentials into its own context and out through its
// rendered report — four lines below the comment stating that a lens has no business reading a
// developer's home directory. capture.mjs guarded only its own channel.
//
// A deny rule cannot close it, because deny rules are prefix matches too: `Bash(git diff
// --no-index:*)` is escaped by `git diff HEAD --no-index ...`. Only a check that scans EVERY token
// catches a flag in an arbitrary position, and that is what capture.mjs does. So the two commands
// carrying that surface go through capture.mjs, and the direct grant is gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, TEST_HOME } from './helpers.mjs';
import { inRun } from './capture-containment-fixture.mjs';

const newRun = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
const buildBlock = newRun.slice(newRun.indexOf('function buildNodeSettings'), newRun.indexOf('function buildIntentSettings'));

test('regression: no direct Bash grant for the git commands carrying the dangerous flag surface', () => {
  // Still a source assertion, and it must stay one: the point is that these two commands are absent
  // from the list the policy is built from, whatever the rule shape renders them as.
  for (const rule of ['git diff', 'git log']) {
    assert.ok(!new RegExp(`'${rule}'`).test(buildBlock),
      `${rule} is an open-tailed prefix grant: it admits --no-index, --output= and --ext-diff`);
  }
});

test('the git commands with no dangerous flag surface are still granted directly', async () => {
  // RENDERED FROM THE RUNTIME, so the assertion is on the COMMAND rather than on one vendor's
  // spelling of a rule (G-36). These were `Bash(...)` literals in the orchestrator until the
  // adapter table took over the rule shapes; a test pinned to the literal would have forced the
  // vendor name back into the file it was just removed from.
  const { grantRules } = await import('../scripts/lib/capabilities.mjs');
  const { builtinReviewers } = await import('../scripts/io/reviewers.mjs');
  const rendered = grantRules(builtinReviewers().claude, ['git status', 'git rev-parse', 'git ls-files'], 'win32');
  for (const rule of ['Bash(git status:*)', 'Bash(git rev-parse:*)', 'Bash(git ls-files:*)']) {
    assert.ok(rendered.includes(rule), `${rule} should remain — it carries no such surface`);
  }
});

test('capture.mjs remains the sanctioned route, and it still allows diff and log', async () => {
  // The list is lib/capture-admit.mjs's since capture-interactive.plan.md stage 4 (one owner for both front ends), so the
  // owner is asked, and capture is held to using it.
  const { readOnlyPrefixes, admitCommand } = await import('../scripts/lib/capture-admit.mjs');
  const list = readOnlyPrefixes('/x/find-inert-features.mjs');
  assert.ok(list.some((p) => p.join(' ') === 'git diff'), 'capture must still permit the command it now solely owns');
  assert.ok(list.some((p) => p.join(' ') === 'git log'));
  assert.equal(admitCommand(['git', 'log', '-1'], { readOnly: list, repoRoot: '/r' }).ok, true);
  const capture = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'capture.mjs'), 'utf8');
  assert.match(capture, /readOnlyPrefixes\(DETECTOR_ABS\)/, 'capture must take its read-only set from the owner');
  assert.ok(buildBlock.includes('capture.mjs'), 'the capture route must stay allow-listed');
});

// The property that makes capture safe where a permission rule is not: it inspects EVERY trailing
// token, so the flag cannot escape by moving position.
test('regression: capture refuses a dangerous flag in ANY position, not just the first', async () => {
  // Asserted through the GUARD ITSELF rather than by matching capture.mjs's source. The previous
  // version of this test pinned the implementation (`tail.find(... FORBIDDEN_TAIL.some ...)`) and
  // broke the moment the guard was extracted to fix a real bypass — a test that fails on a correct
  // refactor is testing the wrong thing.
  const { forbiddenTailToken } = await import('../scripts/lib/forbidden-tail.mjs');
  for (const fam of ['--no-index', '--output=/tmp/x', '--ext-diff', '--textconv', '--contents=/etc/passwd']) {
    assert.ok(forbiddenTailToken(fam), `${fam} must be refused`);
  }
  // And capture must actually consult it. This was a match of capture.mjs's source for `forbiddenTailToken`, which
  // appears there only in comments (G-20 of 20261115-220919-ci-delivery): deleting the real admitCommand call left it
  // green. So capture is RUN with the flag in more than one position, and must refuse before anything runs.
  inRun((dir, base) => {
    for (const tail of [['--output=OUT'], ['HEAD', '--output=OUT'], ['HEAD', '--stat', '--output=OUT']]) {
      const out = path.join(base, 'OUT');
      const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'capture.mjs'),
        '--run-dir', dir, '--node', 'feature-verify', '--name', 'tail', '--', 'git', 'diff',
        ...tail.map((t) => t.replace('OUT', out.split(path.sep).join('/')))],
      { cwd: REPO_ROOT, encoding: 'utf8',
        env: { ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, QUORATE_HOME: TEST_HOME } });
      assert.notEqual(r.status, 0, `capture ran git diff ${tail.join(' ')}: ${r.stderr.slice(-400)}`);
      assert.match(r.stderr, /refusing .*--output/, `the refusal must name the flag (git diff ${tail.join(' ')})`);
      assert.equal(fs.existsSync(out), false, `git diff ${tail.join(' ')} wrote its output file`);
    }
  });
});
