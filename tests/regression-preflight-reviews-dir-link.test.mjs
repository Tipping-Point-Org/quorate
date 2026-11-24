// PREFLIGHT HOLDS reviews_dir TO NEW-RUN'S LINK CHECK (G-16 of 20261121-193516-m3s7-b1-review). preflight resolves the
// reviews root "the SAME" way new-run does, but took only reviewsRootAllowed's lexical containment and skipped new-run's
// escapesBeforeCreate, so a reviews_dir inside the repository by spelling and routed through a link (a symlink, or a
// junction on Windows) out of it was accepted, and `--run` seeded the cache and its run outside the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

test('a reviews_dir reached through a link out of the repository is refused', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-preflight-link-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(repo); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(repo, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const yaml = ['graph_contract_version: 6', 'project: pflink', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'review:', '  reviews_dir: "link/reviews"',
    '  external_panel: false'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', yaml, '```', ''].join('\n'));
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'preflight.mjs'), '--repo-root', repo],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, QUORATE_HOME: path.join(base, 'home') } });
  const out = `${r.stdout}${r.stderr}`;
  assert.notEqual(r.status, 0, `preflight accepted a reviews_dir that escapes through a link:\n${out}`);
  assert.match(out, /a link in its path escapes that boundary/, out);
});
