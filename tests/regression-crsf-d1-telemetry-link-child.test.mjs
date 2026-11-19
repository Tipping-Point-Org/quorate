// G-15 of 20261105-163851-crsf-d1-review: `telemetry.mjs backfill` listed each record root through its owner, then kept
// only entries whose Dirent is a directory, so a junction or symlink CHILD below a real run root or claim-checks folder was
// skipped with nothing recorded: the backfill reported zero unreadable folders and exited 0 while omitting that record. A
// link child is now named unreadable, never silently dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, withTempDir } from './helpers.mjs';

function contractRepo(dir) {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: tel-fixture',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:',
    '  models: { judgment: opus }', '  effort: { judgment: low }', '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'fixture');
  return repo;
}
const backfill = (dir, repo) => {
  const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home') };
  delete env.GRAPH_NODE_DEPTH;
  return spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'telemetry.mjs'), 'backfill', '--repo-root', repo], { cwd: repo, env, encoding: 'utf8' });
};

for (const [name, rel] of [['the reviews folder', ['.claude', 'reviews']], ['claim-checks', ['.claude', 'claim-checks']]]) {
  test(`G-15: a junction child below ${name} is named unreadable, never skipped as not a directory`, () => {
    withTempDir((dir) => {
      const repo = contractRepo(dir);
      const root = path.join(repo, ...rel);
      fs.mkdirSync(root, { recursive: true });
      const target = path.join(repo, 'elsewhere');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'run.json'), JSON.stringify({ run_id: '20260920-070634-linked' }));
      fs.symlinkSync(target, path.join(root, '20260920-070634-linked'), process.platform === 'win32' ? 'junction' : 'dir');
      const r = backfill(dir, repo);
      assert.equal(r.status, 1, `a linked child passed unseen:\n${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /UNREAD .*20260920-070634-linked/, r.stdout + r.stderr);
    });
  });
}
