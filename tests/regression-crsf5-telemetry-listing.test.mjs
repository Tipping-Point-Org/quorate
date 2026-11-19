// G-10 of 20261105-151040-crsf-remediation-4b-review: `telemetry.mjs backfill` listed its record roots (the run roots,
// .claude/claim-checks, bench/results) with a raw fs.readdirSync, so a junction at a record root was followed while its
// entries were enumerated. When the linked target held nothing that qualified, no owner was ever asked, and the backfill
// exited 0 reporting zero unreadable folders. The listing goes through the owner: a link at the root is refused and named.
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
const junction = (target, at) => {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
};

// The reviews folder's link leads inside the repository: repoRunRoots drops a root whose real path leaves it, before
// telemetry lists anything, so only a link that stays inside reaches this listing.
for (const [name, rel, inside] of [['claim-checks', ['.claude', 'claim-checks'], false], ['bench/results', ['bench', 'results'], false],
  ['the reviews folder', ['.claude', 'reviews'], true]]) {
  test(`G-10: a junction at ${name} to an empty folder is named unreadable, never listed as empty`, () => {
    withTempDir((dir) => {
      const repo = contractRepo(dir);
      const outside = inside ? path.join(repo, 'elsewhere') : path.join(dir, 'outside');
      fs.mkdirSync(outside);
      // A file that qualifies nowhere, so no per-entry owner is asked: only the listing can refuse.
      fs.writeFileSync(path.join(outside, 'note.txt'), 'x');
      junction(outside, path.join(repo, ...rel));
      const r = backfill(dir, repo);
      assert.equal(r.status, 1, `a linked record root passed as empty:\n${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /[1-9]\d* folder\(s\) unreadable/, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`UNREAD .*${rel.at(-1)}`), r.stdout + r.stderr);
    });
  });
}

test('G-10: a record root that is absent is nothing to list, and the backfill passes', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    const r = backfill(dir, repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 folder\(s\) unreadable/, r.stdout);
  });
});
