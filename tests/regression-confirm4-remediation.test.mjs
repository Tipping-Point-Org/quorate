// Run 20261002-012918-confirm3-confirm (operator, 2026-10-02: "Design step; fix G-3 now (Recommended)").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';

// G-3: a failed `git ls-files` became an empty file list, and the mandatory inert-feature sweep reported zero files,
// zero candidates, exit 0 — a clean result from an evidence tool that had inspected nothing. The ledger had recorded
// this exact defect fixed before; the glob delivery's rewrite (15f765c) brought it back.
test('G-3: find-inert-features refuses when git cannot list the repository, instead of reporting it clean', (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-inert-nogit-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const yaml = ['graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: ["docs/**"]'].join('\n');
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
  fs.mkdirSync(path.join(d, 'docs'));
  fs.writeFileSync(path.join(d, 'docs', 'a.md'), 'The `zorbQuuxSetting` option.\n');
  // Not a git repository: `git ls-files` exits non-zero.
  const r = runScript('find-inert-features.mjs', ['--repo-root', d, '--json'], { cwd: d });
  assert.notEqual(r.status, 0, `a sweep that listed nothing reported success:\n${r.stdout.slice(0, 300)}`);
  assert.match(r.output, /git ls-files/);
});
