// G-7 of 20261105-154708-crsf-remediation-5-review (and its symptom G-9): repoRunRoots left out a `.claude/reviews`
// whose real path leaves the repository, which is right, but recorded nothing, so telemetry backfill and archive-run's
// citation search reported zero unreadable roots while every archived run behind the link went unseen. The dropped
// root is now reported to the caller, and both callers name it unread.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, withTempDir } from './helpers.mjs';
import { repoRunRoots } from '../scripts/io/reviews-root.mjs';

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
const junction = (target, at) => {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
};

test('G-7: repoRunRoots reports a .claude/reviews it drops because its real path leaves the repository', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(outside);
    junction(outside, path.join(repo, '.claude', 'reviews'));
    const dropped = [];
    const roots = repoRunRoots({ repoRoot: repo, home: path.join(dir, 'home'), project: 'p', dropped });
    assert.ok(!roots.includes(path.join(repo, '.claude', 'reviews')), 'the escaped root is still left out');
    assert.equal(dropped.length, 1, `the dropped root was not reported: ${JSON.stringify(dropped)}`);
    // Named as the filesystem spells the repository (long where TEMP is an 8.3 short path, CI run 43281517496).
    assert.equal(dropped[0].root, path.join(fs.realpathSync.native(repo), '.claude', 'reviews'));
    assert.match(dropped[0].reason, /outside/);
  });
});

test('G-7: a root that stays inside is not reported as dropped', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    const dropped = [];
    repoRunRoots({ repoRoot: repo, home: path.join(dir, 'home'), project: 'p', dropped });
    assert.deepEqual(dropped, []);
  });
});

test('G-7: telemetry backfill names an escaped .claude/reviews unread and exits 1', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(path.join(outside, '20260101-000000-x'), { recursive: true });
    junction(outside, path.join(repo, '.claude', 'reviews'));
    const env = { ...process.env, QUORATE_HOME: path.join(dir, 'home') };
    delete env.GRAPH_NODE_DEPTH;
    const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'telemetry.mjs'), 'backfill', '--repo-root', repo], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(r.status, 1, `an escaped reviews root passed as nothing to read:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /UNREAD .*reviews/, r.stdout + r.stderr);
  });
});
