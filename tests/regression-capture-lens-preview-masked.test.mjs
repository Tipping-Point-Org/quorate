// THE LENS FRONT END'S PREVIEW IS MASKED (G-4 of 20261115-220919-ci-delivery). capture.mjs returns the tail of a
// command's output to the node on stderr, which lands in the model's transcript; the interactive front end masked its
// preview (lib/redact.mjs) and this one did not, so a declared command that printed an inherited credential put it there.
// The log keeps the bytes the command printed: masking is of what is shown, never of the evidence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, TEST_HOME } from './helpers.mjs';
import { inRun } from './capture-containment-fixture.mjs';

test('a declared command printing a secret shape: the preview masks it, the log keeps it', () => {
  inRun((dir) => {
    const token = `ghp_${'A1b2C3d4E5'.repeat(4).slice(0, 36)}`;
    // No spaces inside the argument: a declared command is matched by exact argv.
    const SRC = `console.log('${token}')`;
    const rj = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    rj.contract = { commands: { run: `node -e ${SRC}`, shell: '' } };
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(rj));
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'capture.mjs'),
      '--run-dir', dir, '--node', 'feature-verify', '--name', 'masked', '--', 'node', '-e', SRC],
    { cwd: REPO_ROOT, encoding: 'utf8',
      env: { ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, QUORATE_HOME: TEST_HOME } });
    assert.equal(r.status, 0, r.stderr.slice(-600));
    assert.doesNotMatch(r.stderr, new RegExp(token), 'the preview showed the token');
    const log = fs.readFileSync(path.join(dir, r.stdout.trim()), 'utf8');
    assert.match(log, new RegExp(token), 'the log must keep the bytes the command printed');
  });
});
