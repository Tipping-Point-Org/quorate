// A READ-ONLY GIT INSPECTION GETS GIT'S SCRUBBED ENVIRONMENT (G-3 of 20261115-220919-ci-delivery). capture.mjs ran the
// admitted read-only git commands with commandEnvFor, which keeps every secret-shaped name, while every other git the
// engine starts runs with gitEnvFor (io/git.mjs). A helper git starts for an inspection (here an external diff driver,
// named the way a user's environment can name one) inherited the operator's credentials.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, TEST_HOME } from './helpers.mjs';
import { inRun } from './capture-containment-fixture.mjs';
// git's empty tree, in this repository's object format (sha1 or sha256).
const EMPTY_TREE = spawnSync('git', ['hash-object', '-t', 'tree', '--stdin'], { cwd: REPO_ROOT, input: '', encoding: 'utf8' }).stdout.trim();
const FAKE_TOKEN = ['probe', 'secret', 'value'].join('-');

test('a helper started by a read-only git diff does not inherit a secret-shaped variable', () => {
  inRun((dir, base) => {
    const fwd = (p) => p.split(path.sep).join('/');
    const seen = path.join(base, 'seen.json');
    const helper = path.join(base, 'helper.cjs');
    fs.writeFileSync(helper, `require('fs').writeFileSync(${JSON.stringify(fwd(seen))}, JSON.stringify(process.env));\n`);
    // GIT_EXTERNAL_DIFF names the driver, and a diff of one shipped file from git's empty tree to HEAD always has one to
    // hand it, in a published snapshot's single commit too (`HEAD~1` does not exist there: the stage 9c dry run of
    // 7573fd44). One file, because the driver runs once per changed file.
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'capture.mjs'),
      '--run-dir', dir, '--node', 'feature-verify', '--name', 'gitenv', '--', 'git', 'diff', EMPTY_TREE, 'HEAD', '--', 'LICENSE'],
    { cwd: REPO_ROOT, encoding: 'utf8',
      env: { ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, QUORATE_HOME: TEST_HOME,
        GIT_EXTERNAL_DIFF: `node ${fwd(helper)}`, QUORATE_PROBE_API_TOKEN: FAKE_TOKEN } }); // a made-up value, built at runtime (.gitleaksignore's convention)
    assert.equal(r.status, 0, r.stderr.slice(-600));
    assert.ok(fs.existsSync(seen), `the fixture's diff driver never ran, so the test observed nothing: ${r.stderr.slice(-400)}`);
    const env = JSON.parse(fs.readFileSync(seen, 'utf8'));
    assert.equal(env.QUORATE_PROBE_API_TOKEN, undefined, 'a secret-shaped variable reached the helper git started');
    // THE INTERACTIVE FRONT END'S READ-ONLY GIT TOO (G-16 of 20261117-013640-m2-9a-final; A-29): it ran an admitted
    // read-only git with commandEnvFor alone, so the same helper inherited the secret there.
    const ev = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-rogit-')));
    try {
      fs.rmSync(seen, { force: true });
      const ri = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'capture.mjs'), '--interactive',
        '--mode', 'read-only', '--evidence-dir', ev, '--name', 'gitenv', '--quiet', '--', `git diff ${EMPTY_TREE} HEAD -- LICENSE`],
      { cwd: REPO_ROOT, encoding: 'utf8',
        env: { ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_RUN_ID: undefined, QUORATE_HOME: TEST_HOME,
          GIT_EXTERNAL_DIFF: `node ${fwd(helper)}`, QUORATE_PROBE_API_TOKEN: FAKE_TOKEN } });
      assert.equal(ri.status, 0, `${ri.stdout.slice(-400)}${ri.stderr.slice(-400)}`);
      assert.ok(fs.existsSync(seen), `the interactive diff driver never ran, so the test observed nothing: ${ri.stderr.slice(-400)}`);
      const ienv = JSON.parse(fs.readFileSync(seen, 'utf8'));
      assert.equal(ienv.QUORATE_PROBE_API_TOKEN, undefined, 'a secret-shaped variable reached the helper an interactive read-only git started');
    } finally { fs.rmSync(ev, { recursive: true, force: true }); }
  });
});
