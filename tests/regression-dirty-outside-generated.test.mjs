// new-run records which dirty paths lie outside generated_globs (operator, 2026-11-23: "Fix the rule, post this run
// (Recommended)"). pr-comments refused every review of this repository as dirty, because its finished runs sit untracked
// under .claude/reviews/, a generated glob; run.json now says whether anything else was dirty, and pr-comments posts a
// run whose only changes were generated (tests/regression-pr-comments.test.mjs holds that half).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';

const put = (root, rel, body = `${rel}\n`) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

function fixtureRepo(t) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-dirty-gen-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  put(repo, 'src/app.js', 'export const app = 1;\n');
  put(repo, 'docs/guide.md', 'declared\n');
  put(repo, '.claude/requests/ask.md', ['---', 'request: ask', 'status: approved', '---', '', '# The ask', '', '## Acceptance criteria', '1. It works.', ''].join('\n'));
  const yaml = ['graph_contract_version: 5', 'project: dirty-gen-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: ["docs/*.md"]', 'generated_globs: ["out/**"]', 'ui:', '  surface: none', 'review:',
    '  external_panel: false', '  models: { judgment: opus, mechanical: sonnet }'].join('\n');
  put(repo, 'CLAUDE.md', `# fixture\n\nThe contract of this fixture, a line long enough to be read rather than guessed.\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
  const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  g('init', '-q', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'fixture');
  return repo;
}

function mint(t, repo) {
  const r = runScript('new-run.mjs', ['--slug', `dgen${Math.floor(Math.random() * 1e6)}`, '--repo-root', repo, '--full-sweep', 'src',
    '--no-verify-sandbox'], { cwd: repo });
  assert.equal(r.status, 0, r.output.slice(-400));
  const dir = mintedRunDir(r.output);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
}

test('a tree dirty only under generated_globs records dirty_outside_generated: []', (t) => {
  const repo = fixtureRepo(t);
  put(repo, 'out/run-1/gate.md', 'a finished run\n');
  const rj = mint(t, repo);
  assert.equal(rj.dirty, true);
  assert.deepEqual(rj.dirty_outside_generated, []);
});

test('a modified tracked file and an untracked file outside generated_globs are both named', (t) => {
  const repo = fixtureRepo(t);
  put(repo, 'out/run-1/gate.md', 'a finished run\n');
  fs.writeFileSync(path.join(repo, 'src/app.js'), 'export const app = 2;\n');   // ' M src/app.js': the leading space kept
  put(repo, 'notes.txt', 'loose\n');
  const rj = mint(t, repo);
  assert.equal(rj.dirty, true);
  assert.deepEqual([...rj.dirty_outside_generated].sort(), ['notes.txt', 'src/app.js']);
});

test('a clean tree records dirty: false and dirty_outside_generated: []', (t) => {
  const repo = fixtureRepo(t);
  const rj = mint(t, repo);
  assert.equal(rj.dirty, false);
  assert.deepEqual(rj.dirty_outside_generated, []);
});
