// G-16 and G-17 of 20261020-105833-ciss-remediation-2-review: new-run derived its scope from git listings it never
// checked. `sh()` ignored the exit status, the spawn error and spawnSync's output cap, so a failed or truncated listing
// became a silently partial scope (G-16); and `git ls-files --others` ran without -z, so git C-quoted a non-ASCII path
// (`"src/\303\251.js"`) and isSource never matched it, leaving the untracked file out of review (G-17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript } from './helpers.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-nrscope-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: nrscope',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'ui:', '  surface: none', 'review:',
    '  external_panel: false', '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/reviews/\n');
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'init');
  return { repo, env: { QUORATE_HOME: path.join(base, 'home'), QUORATE_REVIEWER_PROBES: path.join(base, 'probes') } };
}
const mint = (f) => runScript('new-run.mjs', ['--repo-root', f.repo, '--no-request', '--dry-run', '--base', 'HEAD'],
  { cwd: f.repo, env: f.env });

test('G-17: an untracked source file with a non-ASCII name is in the derived scope, spelled as it is on disk', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'src', 'café.js'), 'n\n');
  const d = mint(f);
  assert.equal(d.status, 0, d.output.slice(-800));
  assert.match(d.stdout, /scope {10}derived: [^\n]*src\/café\.js/, d.stdout.slice(-800));
});

test('G-16: a git listing that fails refuses the mint, naming it, rather than deriving a partial scope', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'src', 'b.js'), 'b\n');
  fs.writeFileSync(path.join(f.repo, '.git', 'index'), 'not an index');
  const d = mint(f);
  assert.notEqual(d.status, 0, d.output.slice(-800));
  assert.match(d.output, /could not list the changed files \(git (ls-files|diff)/, d.output.slice(-800));
});
