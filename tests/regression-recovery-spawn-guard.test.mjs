// A RECOVERY NODE IN A SUITE PROCESS NEVER REACHES A REAL CLI (m2-public-release.plan.md stage 2b). The suite run inside a
// release snapshot, which has no .claude/requests/, started the real Claude CLI: tests/regression-intent-drift-reach minted
// a run against the repository's own contract, its declared request was absent, and run-graph fired request-capture
// recovery through the real runtime whatever --only selected. runScript's guard covered the lenses, not recovery. Its red
// was observed rather than re-run here, since re-running it starts the real CLI: the suite's throwaway config folder held
// the CLI's sessions under two `driftprobe...-sandbox-request-capture` folders (the second snapshot suite run's log, 2026-11-13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function repoWithoutRequest(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-recovery-guard-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  const yaml = ['graph_contract_version: 6', 'project: recoveryguard', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:', '  external_panel: false'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', yaml, '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/reviews/\n');
  git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 'x@x'); git(repo, 'config', 'user.name', 'x');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');
  const env = { QUORATE_HOME: path.join(base, 'home') };
  const mint = (extra) => runScript('new-run.mjs', ['--repo-root', repo, '--no-verify-sandbox', '--no-verify-reviewers',
    '--full-sweep', 'src', ...extra], { cwd: repo, env });
  return { repo, mint, env };
}

test('a run with no request and no UNREQUESTED stamp is refused before run-graph can fire recovery', (t) => {
  const f = repoWithoutRequest(t);
  const m = f.mint(['--slug', 'norequest']);
  assert.equal(m.status, 0, m.output);
  const rd = mintedRunDir(m.output);
  const run = JSON.parse(fs.readFileSync(path.join(rd, 'run.json'), 'utf8'));
  assert.equal(run.request, null, 'the fixture was meant to have no request');
  assert.ok(!(run.stamps ?? []).includes('UNREQUESTED'));
  assert.throws(
    () => runScript('run-graph.mjs', ['--run-dir', rd, '--skip-panel', '--only', 'ui-audit', '--no-archive', '--preflight', 'never'],
      { cwd: f.repo, env: f.env }),
    /would fire request-capture recovery through the real runtime/,
  );
});

test('the same run minted with --no-request is not refused by the guard', (t) => {
  const f = repoWithoutRequest(t);
  const m = f.mint(['--slug', 'unrequested', '--no-request']);
  assert.equal(m.status, 0, m.output);
  const rd = mintedRunDir(m.output);
  assert.ok(JSON.parse(fs.readFileSync(path.join(rd, 'run.json'), 'utf8')).stamps.includes('UNREQUESTED'));
  const r = runScript('run-graph.mjs', ['--run-dir', rd, '--skip-panel', '--only', 'ui-audit', '--no-archive', '--preflight', 'never'],
    { cwd: f.repo, env: f.env });
  assert.doesNotMatch(r.output, /== recovery: 'request'/, 'recovery fired on an UNREQUESTED run');
});
