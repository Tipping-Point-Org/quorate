// G-1 and G-4 of 20261022-211328-ciss-d1-2-remediation-b-review: both reference extractors recorded a file they could
// not READ as `parse_error`, though no parse was attempted. shared/code-index.md promises an unread file answers
// `partial` (the target may be defined in it), and code-index-query reads a not_processed file's `outcome` to choose
// between the two, so the label decided the answer. A requested path that is a directory is unreadable on every platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const pythonAt = (min) => ['python3', 'python', 'py'].map((p) => [p, p === 'py' ? [`-3.${min}`] : []]).find(([p, pre]) => {
  const r = spawnSync(p, [...pre, '-c', `import sys; sys.exit(0 if sys.version_info >= (3, ${min}) else 1)`], { encoding: 'utf8' });
  return r.status === 0;
});
const python = pythonAt(10);
const acornHome = process.env.QUORATE_ACORN_DIR;
const acornAt = acornHome && fs.existsSync(path.join(acornHome, 'node_modules', 'acorn', 'package.json'))
  ? path.join(acornHome, 'node_modules', 'acorn') : null;

function corpus(t, ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-unreadable-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  fs.writeFileSync(path.join(dir, `ok.${ext}`), ext === 'py' ? 'x = 1\n' : 'export const x = 1;\n');
  fs.mkdirSync(path.join(dir, `gone.${ext}`));
  return dir;
}

function unreadRow(stdout, name) {
  const row = JSON.parse(stdout).files.find((f) => f.path === name);
  assert.ok(row, `${name} is missing from files`);
  assert.equal(row.status, 'not_processed');
  return row;
}

test('G-4: the Python extractor labels an unreadable file partial, not parse_error', { skip: python ? false : 'no Python >= 3.10' }, (t) => {
  const dir = corpus(t, 'py');
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify({ code_index_request: 1, language: 'python', root: dir, files: ['ok.py', 'gone.py'], options: {} }));
  const r = spawnSync(python[0], [...python[1], '-I', path.join(REPO_ROOT, 'extractors', 'python', 'extract.py'),
    '--language', 'python', '--request', path.join(dir, 'request.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const row = unreadRow(r.stdout, 'gone.py');
  assert.equal(row.outcome, 'partial', `an unread file is not a parse failure: ${JSON.stringify(row)}`);
  assert.match(row.reason, /unreadable/);
});

test('G-1: the JavaScript extractor labels an unreadable file partial, not parse_error', { skip: acornAt ? false : 'no acorn: set QUORATE_ACORN_DIR' }, (t) => {
  const dir = corpus(t, 'mjs');
  fs.cpSync(acornAt, path.join(dir, 'node_modules', 'acorn'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify({ code_index_request: 1, language: 'javascript', root: dir, files: ['ok.mjs', 'gone.mjs'], options: {} }));
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'extractors', 'javascript', 'extract.mjs'),
    '--language', 'javascript', '--request', path.join(dir, 'request.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const row = unreadRow(r.stdout, 'gone.mjs');
  assert.equal(row.outcome, 'partial', `an unread file is not a parse failure: ${JSON.stringify(row)}`);
  assert.match(row.reason, /unreadable/);
});
