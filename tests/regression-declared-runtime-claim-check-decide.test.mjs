// claim-check and decide choose the node runtime through selectAdapters, and no test ran either with a declared
// review.runtime (G-2, G-3 of 20261105-074139-crsf-remediation-3-review). Each is run here with a declared runtime that
// is not in the adapter table: the refusal naming it shows the declared key, not the table's default, reached the choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, runScript } from './helpers.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const contract = (reviewLines) => ['# t', '', '```yaml', 'graph_contract_version: 6', 'project: t', 'commands:', '  build: ""',
  '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:', '  models: { judgment: opus }',
  '  effort: { judgment: low }', ...reviewLines, '```', ''].join('\n');
function repo(text) {
  const dir = tmp('declared-runtime-');
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/decisions/\n.claude/claim-checks/\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text);
  git('add', '-A'); git('commit', '-qm', 'init');
  return dir;
}

test('G-2: claim-check --check reads review.runtime: an undeclared adapter there is refused by name', () => {
  const dir = repo(contract(['  external_panel: false', '  runtime: not-an-adapter']));
  const home = tmp('declared-runtime-home-');
  try {
    const check = path.join(dir, '.claude', 'claim-checks', 'c1');
    fs.mkdirSync(check, { recursive: true });
    fs.writeFileSync(path.join(check, 'draft.md'), 'The build passes.\n');
    const env = { ...process.env, QUORATE_HOME: home };
    delete env.GRAPH_NODE_DEPTH;
    const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'claim-check.mjs'), check, '--check'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr + r.stdout, /review\.runtime 'not-an-adapter' is not in the adapter table/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('G-3: decide reads review.runtime: an undeclared adapter there is refused by name before any seat runs', () => {
  const dir = repo(contract(['  external_panel: true', '  decision_panel: on', '  runtime: not-an-adapter']));
  try {
    const qf = path.join(dir, 'q.json');
    fs.writeFileSync(qf, JSON.stringify({ question: 'Which bound?', options: [{ label: 'Size cap' }, { label: 'Age cap' }], category: 'delegable' }));
    const r = runScript('decide.mjs', ['--question', qf, '--repo-root', dir]);
    assert.notEqual(r.status, 0, r.output);
    assert.match(r.output, /review\.runtime 'not-an-adapter' is not in the adapter table/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
