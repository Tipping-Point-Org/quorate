// G-13, G-12 and G-15 of 20261105-074139-crsf-remediation-3-review, in `telemetry.mjs backfill`:
// - G-13: isStaged tested containment in quorate's home as `rel.startsWith('..')`, so a run root under the home named
//   `..records` read as archived, the not-ended rule was skipped, and a running remediation got a record.
// - G-12: the claim-check probe was a raw statSync, so a junction at .claude/claim-checks was followed and an outside
//   telemetry.json counted as a record already there.
// - G-15: a bench results file was read raw, so a junction at bench/results fed outside JSON to the backfill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, withTempDir } from './helpers.mjs';

const put = (file, obj) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj)); };

function contractRepo(dir, reviewsDir = null) {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: tel-fixture',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:',
    '  models: { judgment: opus }', '  effort: { judgment: low }', ...(reviewsDir ? [`  reviews_dir: "${reviewsDir}"`] : []), '```', ''].join('\n'));
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
const junction = (target, at) => { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(target, at, 'junction'); };

test('G-13: a run root under quorate\'s home named ..records is staged, so a remediation not ended is left alone', () => {
  withTempDir((dir) => {
    const home = path.join(dir, 'home');
    const root = path.join(home, '..records');
    fs.mkdirSync(root, { recursive: true });
    const repo = contractRepo(dir, root.split(path.sep).join('/'));
    const active = path.join(root, '20261105-000001-active-remediation');
    put(path.join(active, 'run.json'), { run_id: '20261105-000001-active-remediation', remediates: '20261105-000000-one' });
    put(path.join(active, 'remediate-settings.json'), {});
    const r = backfill(dir, repo);
    assert.equal(fs.existsSync(path.join(active, 'telemetry.json')), false, `a running remediation got a record:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /skipped .*20261105-000001-active-remediation: not ended/, r.stdout + r.stderr);
  });
});

test('G-12: a junction at .claude/claim-checks is refused, never followed to an outside record', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    const outside = path.join(dir, 'outside-checks');
    put(path.join(outside, 'c1', 'checked.json'), {});
    put(path.join(outside, 'c1', 'telemetry.json'), { kind: 'claim-check' });
    junction(outside, path.join(repo, '.claude', 'claim-checks'));
    const r = backfill(dir, repo);
    assert.doesNotMatch(r.stdout, /1 already there/, `the outside record was counted as present:\n${r.stdout}`);
    // Refused at the listing since G-10 of 20261105-151040-crsf-remediation-4b-review, so the folder is named unreadable.
    assert.match(r.stdout, /UNREAD .*claim-checks: ECONFINED/, r.stdout + r.stderr);
    assert.equal(r.status, 1, r.stdout + r.stderr);
  });
});

test('G-15: a junction at bench/results is refused, never read', () => {
  withTempDir((dir) => {
    const repo = contractRepo(dir);
    const outside = path.join(dir, 'outside-bench');
    put(path.join(outside, '2026-11-05T00-00-00-000Z.json'), { not_a_measurement: 'outside' });
    junction(outside, path.join(repo, 'bench', 'results'));
    const r = backfill(dir, repo);
    assert.doesNotMatch(r.stdout, /not a measurement/, `outside JSON was read:\n${r.stdout}`);
    assert.match(r.stdout, /UNREAD .*results: ECONFINED/, r.stdout + r.stderr);
    assert.equal(r.status, 1, r.stdout + r.stderr);
  });
});
