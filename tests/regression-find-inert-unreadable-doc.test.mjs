// G-6 (and its symptom G-7) of 20261114-174045-m2-pred1-review, I-5 of its intent: find-inert-features read each
// listed document with `try { readFileSync } catch { continue; }`, recorded nothing, and still reported
// `doc_files: docFiles.length`. A tracked document missing from disk (or unreadable) read as scanned, and a clean report
// could rest on a document nobody read. It is named in `not_checked` and left out of the count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript } from './helpers.mjs';

test('G-6: a listed document that cannot be read is named as not checked and is not counted as scanned', (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-inert-unread-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const files = {
    'docs/x.md': 'The `fooBarBazQux` setting is read by the source.\n',
    'docs/gone.md': 'The `quuxCorgeGrault` setting.\n',
    'src/a.js': 'export const fooBarBazQux = 2; const y = fooBarBazQux;\n',
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
  // Still listed by git ls-files (it is in the index), no longer readable on disk.
  fs.rmSync(path.join(d, 'docs', 'gone.md'));
  assert.match(git('ls-files').stdout, /docs\/gone\.md/, 'the fixture keeps the document listed');

  const r = runScript('find-inert-features.mjs', ['--repo-root', d, '--json'], { cwd: d });
  assert.equal(r.status, 0, r.output);
  const report = JSON.parse(r.stdout);
  assert.equal(report.doc_files, 1, 'only the document that was read is counted as scanned');
  assert.deepEqual((report.not_checked ?? []).map((n) => n.file), ['docs/gone.md'],
    'the unreadable document is named, not dropped silently');
  assert.ok(report.not_checked[0].error, 'with the reason it was not read');

  const text = runScript('find-inert-features.mjs', ['--repo-root', d], { cwd: d });
  assert.match(text.stdout, /NOT CHECKED \(1\)[\s\S]*docs\/gone\.md/, 'the human report names it too');
  assert.doesNotMatch(text.stdout, /No candidates\./, 'a sweep with an unread document is not reported clean');
});
