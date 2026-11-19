// G-7 of 20261015-230146-archive-fold-remediation-review: find-inert-features took every non-zero `git grep` exit as "no
// match in this chunk", though only exit 1 means that. A git error, a spawn failure or an overflowed buffer was swallowed,
// and the sweep exited 0 reporting live identifiers inert without having searched them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript } from './helpers.mjs';

test('G-7: a git grep that fails refuses the sweep instead of reporting its identifiers inert', (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-inert-grep-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const files = {
    'docs/x.md': 'The `fooBarBazQux` setting is read by the source.\n',
    'src/a.js': 'export const fooBarBazQux = 2;\n',
  };
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), body);
  }
  const yaml = ['graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: ["docs/**"]'].join('\n');
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
  const git = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' });
  git('init', '-q', '.'); git('add', '-A');
  // A value git grep refuses (fatal, exit 128) and git ls-files never reads: the listing succeeds, every grep fails.
  git('config', 'grep.patternType', 'not-a-pattern-type');
  assert.notEqual(git('grep', '-c', '-w', '--', 'fooBarBazQux').status, 1, 'the fixture does not make git grep fail');
  const r = runScript('find-inert-features.mjs', ['--repo-root', d, '--json'], { cwd: d });
  assert.equal(r.status, 2, `a failed grep was read as "no match": ${r.output}`);
  assert.match(r.output, /git grep failed/);
});
