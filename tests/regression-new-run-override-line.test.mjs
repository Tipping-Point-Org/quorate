// reviewer-credential-routing.plan.md stage 3 (D1 = A, A-26): new-run names every built-in the contract
// overrides, on stderr, UNCONDITIONALLY and before it spawns anything. It runs the node runtime itself
// (version probe, sandbox canary, intent probes) with the panel off too, so the line cannot wait for the
// reviewer check (plan-review round 10). And a mint that is REFUSED leaves no run.json and no gate, so
// both refusals name the override: a failed reviewer combination beside its label, and the canary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript } from './helpers.mjs';

function fixture(t, contractExtra) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-nrovr-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: nrovr',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'ui:', '  surface: none', contractExtra, '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/reviews/\n');
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@x'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'init');
  return { base, repo, env: { QUORATE_HOME: path.join(base, 'home'), QUORATE_REVIEWER_PROBES: path.join(base, 'probes') } };
}

test('panel off: the mint names an override before anything else, even on --dry-run', (t) => {
  const f = fixture(t, 'reviewers:\n  codex:\n    cmd: "other-codex"\nreview:\n  external_panel: false');
  const r = runScript('new-run.mjs', ['--repo-root', f.repo, '--no-request', '--dry-run', '--full-sweep', 'src'],
    { cwd: f.repo, env: f.env });
  assert.match(r.stderr, /new-run: codex — cmd set by the contract; CODEX_\*, OPENAI_\* go to it/, r.output.slice(-800));
  // G-27 of 20261020-094311-ciss-delivery, folded here because this is the fixture that mints on --dry-run: a derived scope
  // read `git diff --name-only` alone, which never lists an untracked file, so a new source file was left out of review.
  fs.writeFileSync(path.join(f.repo, 'src', 'new.js'), 'n\n');
  const d = runScript('new-run.mjs', ['--repo-root', f.repo, '--no-request', '--dry-run', '--base', 'HEAD'], { cwd: f.repo, env: f.env });
  assert.equal(d.status, 0, d.output.slice(-800));
  assert.match(d.stdout, /scope {10}derived: [^\n]*src\/new\.js/, 'an untracked source file is in the derived scope');
});

test('panel off: a canary refusal under an overridden node runtime names the override', (t) => {
  const f = fixture(t, 'reviewers:\n  claude:\n    cmd: "quorate-no-such-cli"\nreview:\n  external_panel: false');
  const r = runScript('new-run.mjs', ['--repo-root', f.repo, '--no-request', '--full-sweep', 'src'],
    { cwd: f.repo, env: f.env });
  assert.notEqual(r.status, 0, 'the canary cannot pass on a runtime that does not exist');
  assert.match(r.output, /SANDBOX CANARY FAILED/, r.output.slice(-800));
  assert.match(r.output, /The node runtime is overridden by the contract: \[override: claude \(node runtime\) — cmd set by the contract/);
});

test('panel on: a failed overridden reviewer combination is refused with the override beside its label', (t) => {
  const f = fixture(t, 'reviewers:\n  codex:\n    base_argv: ["exec"]\nreview:\n  external_panel: true');
  // Reviewers that always fail come first on PATH, so no mint can reach the operator's real codex or agy.
  const failing = path.join(f.base, 'failing-bin');
  fs.mkdirSync(failing);
  for (const n of ['codex', 'agy']) {
    if (process.platform === 'win32') fs.writeFileSync(path.join(failing, `${n}.cmd`), '@exit /b 1\r\n');
    else { fs.writeFileSync(path.join(failing, n), '#!/bin/sh\nexit 1\n'); fs.chmodSync(path.join(failing, n), 0o755); }
  }
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const r = runScript('new-run.mjs', ['--repo-root', f.repo, '--no-request', '--no-verify-sandbox', '--full-sweep', 'src'],
    { cwd: f.repo, env: { ...f.env, [pathKey]: `${failing}${path.delimiter}${process.env[pathKey] ?? ''}` }, mayProbe: true });
  assert.notEqual(r.status, 0, r.output.slice(-800));
  assert.match(r.output, /reviewer preflight refused this run/, r.output.slice(-800));
  assert.match(r.output, /preflight check of [^\n]*codex[^\n]*\[override: codex — base_argv set by the contract/);
});
