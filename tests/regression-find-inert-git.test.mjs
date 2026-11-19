// contract-glob-grammar.plan.md, stage 5 (design 3A; operator, 2026-09-30: "A: filter, then literal paths
// (Recommended)"): find-inert-features handed contract globs to `git ls-files` and `git grep` as pathspecs, so git's
// own glob rules — a grammar beside the module's — decided which files were source. Without `:(glob)` magic git's `*`
// crosses `/`, so `src/*.js` reached `src/sub/b.js`, which the contract's grammar says it does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, REPO_ROOT } from './helpers.mjs';
import { PLATFORM_FACTS } from '../scripts/platform/interface.mjs';

const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8');

test('every platform declares the argument budget a command line may use', () => {
  assert.equal(PLATFORM_FACTS.maxArgBytes, 'number', 'the platform interface has no argument budget');
  for (const p of ['win32', 'linux', 'macos']) {
    const m = /maxArgBytes:\s*([\d_]+)/.exec(read('scripts', 'platform', p, 'index.mjs'));
    assert.ok(m && Number(m[1].replace(/_/g, '')) > 4096, `${p} declares no usable maxArgBytes`);
  }
});

test('a source glob reaches what the grammar says, not what git\'s pathspec rules say', (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-inert-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const files = {
    'docs/x.md': 'The `fooBarBazQux` setting controls nothing here.\n',
    'src/a.js': 'export const a = 1;\n',
    'src/sub/b.js': 'export const fooBarBazQux = 2;\n',
  };
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), body);
  }
  const yaml = ['graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/*.js"]', 'doc_paths: ["docs/**"]'].join('\n');
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
  const git = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' });
  git('init', '-q', '.'); git('add', '-A');
  const r = runScript('find-inert-features.mjs', ['--repo-root', d, '--json'], { cwd: d });
  assert.equal(r.status, 0, r.output);
  const report = JSON.parse(r.stdout);
  assert.equal(report.source_files, 1, 'src/sub/b.js was counted as source for src/*.js');
  assert.ok(report.inert.some((i) => (i.identifier ?? i.id ?? JSON.stringify(i)).includes('fooBarBazQux')),
    `a reader outside the source glob was counted: ${JSON.stringify(report.inert)}`);
});

test('no contract glob reaches git as a pathspec; git grep reads a literal file list', () => {
  const s = read('scripts', 'find-inert-features.mjs');
  assert.doesNotMatch(s, /'ls-files', '--', \.\.\.globs/, 'a glob still reaches git ls-files as a pathspec');
  assert.doesNotMatch(s, /'--', \.\.\.sourceGlobs/, 'a source glob still reaches git grep as a pathspec');
  assert.match(s, /GIT_LITERAL_PATHSPECS: '1'/, 'git grep does not read its file list literally');
  assert.match(s, /maxArgBytes/, 'the file list is not chunked to the platform\'s argument budget');
});
