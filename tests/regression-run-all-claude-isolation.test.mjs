// run-all gives the orchestration suite a throwaway Claude config folder and blank credentials, and fails when anything
// lands in that folder (2026-10-27; operator: "That's unacceptable"). Five tests had started the real Claude CLI by
// accident: it spent on opus and wrote the operator's ~/.claude.json, a backup and a session key. The offline guard in
// helpers.mjs closes the route runScript offers; this closes every route, and turns the next leak into a red suite.
// Driven on a copy of run-all.mjs beside a 21-test suite (its floor is 20), with the contract read and the counted-facts
// check stubbed, as regression-remediation-verification's run-all fixture does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

function runAllCopy(t, testBody) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-isolation-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q', '.'], { cwd: repo });
  for (const d of ['tests', 'scripts']) fs.mkdirSync(path.join(repo, d));
  fs.copyFileSync(path.join(REPO_ROOT, 'tests', 'run-all.mjs'), path.join(repo, 'tests', 'run-all.mjs'));
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.mjs'),
    "import { test } from 'node:test';\nimport fs from 'node:fs';\nimport path from 'node:path';\n"
    + `for (let i = 0; i < 20; i++) test(\`t\${i}\`, () => {});\n${testBody}\n`);
  fs.writeFileSync(path.join(repo, 'scripts', 'new-run.mjs'), "console.log(JSON.stringify({ commands: { test_product: '' } }));\n");
  fs.writeFileSync(path.join(repo, 'scripts', 'check-counted-facts.mjs'), 'process.exit(0);\n');
  // Without the parent's NODE_TEST_CONTEXT, which makes a nested `node --test` skip its files.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, [path.join(repo, 'tests', 'run-all.mjs')], { cwd: repo, encoding: 'utf8', env });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test('every test process sees a throwaway Claude config folder and blank credentials', (t) => {
  const r = runAllCopy(t, `test('isolated', () => {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? '';
  if (!/quorate-suite-claude-/.test(dir)) throw new Error('no throwaway config folder: ' + dir);
  for (const k of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) if (process.env[k]) throw new Error(k + ' is set');
});`);
  assert.equal(r.status, 0, r.out.slice(-800));
  assert.doesNotMatch(r.out, /a test started the real Claude CLI/);
});

test('a test that leaves anything in that folder (as a real CLI would) fails the suite, naming what it wrote', (t) => {
  const r = runAllCopy(t, "test('leaks', () => { fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'), '{}'); });");
  assert.equal(r.status, 1, r.out.slice(-800));
  assert.match(r.out, /a test started the real Claude CLI: it wrote \.claude\.json/);
});
