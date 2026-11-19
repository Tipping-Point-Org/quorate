// regression-ciss-s7-compare-contract-first.test.mjs — G-6 of 20261030-124823-ciss-stage7.
//
// `code-index compare` read and checked the answer file, HEAD and the working tree before contractOrDie, so a contract
// whose code_index globs are outside the grammar was reported only after an answer-file or pin error, and an operator
// fixed the answer file to be told the contract was wrong. The contract is checked first now, as build and query do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR } from './helpers.mjs';

const CLI = path.join(SCRIPTS_DIR, 'code-index.mjs');

test('compare refuses a bad code_index glob before it reads the answer file', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-compare-order-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.py'), 'def a():\n    return 1\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: ci-fixture',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none',
    'code_index:', '  python:', '    extractor: "node x.mjs"', '    globs: ["src/?.py"]',
    'review:', '  models: { judgment: opus }', '  effort: { judgment: low }', '```', ''].join('\n'));
  const answers = path.join(dir, 'answers.json');
  fs.writeFileSync(answers, JSON.stringify({ sweeps: 'not a list' }));
  const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home') };
  delete env.GRAPH_NODE_DEPTH;
  const r = spawnSync(process.execPath, [CLI, 'compare', '--answers', answers, '--repo-root', dir], { cwd: dir, encoding: 'utf8', env });
  assert.notEqual(r.status, 0, 'a contract with a bad glob was accepted');
  assert.match(r.stderr, /glob grammar/, `the contract's glob error was not the refusal: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /answer file is refused/, `the answer file was checked before the contract: ${r.stderr}`);
});
