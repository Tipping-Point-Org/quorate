// G-7 of 20261022-215413-ciss-d1-3-remediation-review: contractOrDie exited on code_index's semantic errors before
// contractGlobErrors ran, so a contract with both kinds reported only the semantic one, and the operator fixed one error
// to be shown the next. Both are now reported in one refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR } from './helpers.mjs';

const CLI = path.join(SCRIPTS_DIR, 'code-index.mjs');

test('G-7: a contract with a semantic and a glob-grammar error in code_index reports both', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-contract-errors-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.py'), 'def a():\n    return 1\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: ci-fixture',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none',
    'code_index:', '  python:', '    extractor: "node x.mjs"', '    globs: ["src/?.py"]', '    bogus: 1',
    'review:', '  models: { judgment: opus }', '  effort: { judgment: low }', '```', ''].join('\n'));
  const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home') };
  delete env.GRAPH_NODE_DEPTH;
  const r = spawnSync(process.execPath, [CLI, 'build', '--repo-root', dir],
    { cwd: dir, encoding: 'utf8', env });
  assert.notEqual(r.status, 0, 'a contract with errors was accepted');
  assert.match(r.stderr, /bogus/, `the semantic error was not reported: ${r.stderr}`);
  assert.match(r.stderr, /glob grammar/, `the glob-grammar error was not reported alongside it: ${r.stderr}`);
});
