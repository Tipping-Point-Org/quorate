// G-3 of 20261022-211328-ciss-d1-2-remediation-b-review (and the `default` half of G-16): a field's non-literal default
// was stored as its source text in the same `default` field that carries a string literal, so the literal "f()" and the
// expression f() were the same fact. `default` now carries only a literal (or null); anything else is `default_text`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { responseErrors } from '../scripts/lib/code-index-schema.mjs';

const pythonAt = (min) => ['python3', 'python', 'py'].map((p) => [p, p === 'py' ? [`-3.${min}`] : []]).find(([p, pre]) => {
  const r = spawnSync(p, [...pre, '-c', `import sys; sys.exit(0 if sys.version_info >= (3, ${min}) else 1)`], { encoding: 'utf8' });
  return r.status === 0;
});
const python = pythonAt(10);
const acornHome = process.env.QUORATE_ACORN_DIR;
const acornAt = acornHome && fs.existsSync(path.join(acornHome, 'node_modules', 'acorn', 'package.json'))
  ? path.join(acornHome, 'node_modules', 'acorn') : null;

function fields(t, file, source, argv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-default-text-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  if (acornAt && file.endsWith('.mjs')) fs.cpSync(acornAt, path.join(dir, 'node_modules', 'acorn'), { recursive: true });
  fs.writeFileSync(path.join(dir, file), source);
  const request = { code_index_request: 1, language: file.endsWith('.py') ? 'python' : 'javascript', root: dir, files: [file], options: {} };
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request));
  const r = spawnSync(argv[0], [...argv.slice(1), '--language', request.language, '--request', path.join(dir, 'request.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const response = JSON.parse(r.stdout);
  assert.deepEqual(responseErrors(response, request), [], 'the response must still satisfy the schema');
  return Object.fromEntries(response.facts.definitions.filter((d) => d.kind === 'field')
    .map((d) => [d.name, { default: d.default, default_text: d.default_text }]));
}

test('G-3: Python — a string literal is `default`, an expression is `default_text`, never the same field', { skip: python ? false : 'no Python >= 3.10' }, (t) => {
  const got = fields(t, 'm.py', 'def f(): return 1\nclass C:\n    a: str = "f()"\n    b: int = f()\n    c: object = None\n',
    [python[0], ...python[1], '-I', path.join(REPO_ROOT, 'extractors', 'python', 'extract.py')]);
  assert.deepEqual(got.a, { default: 'f()', default_text: undefined });
  assert.deepEqual(got.b, { default: undefined, default_text: 'f()' }, `an expression was carried as a literal: ${JSON.stringify(got.b)}`);
  assert.deepEqual(got.c, { default: null, default_text: undefined });
});

test('G-3: JavaScript — a string literal is `default`, an expression is `default_text`', { skip: acornAt ? false : 'no acorn: set QUORATE_ACORN_DIR' }, (t) => {
  const got = fields(t, 'm.mjs', 'function f() { return 1; }\nexport class C {\n  a = "f()";\n  b = f();\n}\n',
    [process.execPath, path.join(REPO_ROOT, 'extractors', 'javascript', 'extract.mjs')]);
  assert.deepEqual(got.a, { default: 'f()', default_text: undefined });
  assert.deepEqual(got.b, { default: undefined, default_text: 'f()' }, `an expression was carried as a literal: ${JSON.stringify(got.b)}`);
});
