// regression-code-index-py-fail-closed.test.mjs — code-index-d1-part-b.plan.md stage 3 (design note B-D1, B-D2, B-D3;
// Verification 3 and 4; B-D4 point 3).
//
// The Python extractor reads its generated SCOPE_CONSTRUCTS table: a scope the language opens and the table does not
// model is opaque, a name bound by anything the table does not model resolves to nothing, and a class body is skipped by
// the scopes nested in it. Each column must govern behaviour, not sit in the file, so each test patches one row's column
// in memory (run_with_table.py) and shows the call it governs change its answer. Below 3.10 the extractor refuses, naming
// the requirement, where it used to print an AttributeError traceback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const EXTRACTOR = path.join(REPO_ROOT, 'extractors', 'python', 'extract.py');
const WITH_TABLE = path.join(REPO_ROOT, 'tests', 'fixtures', 'code-index', 'census', 'run_with_table.py');
const pythonAt = (min) => ['python3', 'python', 'py'].map((p) => [p, p === 'py' ? [`-3.${min}`] : []]).find(([p, pre]) => {
  const r = spawnSync(p, [...pre, '-c', `import sys; sys.exit(0 if sys.version_info >= (3, ${min}) else 1)`], { encoding: 'utf8' });
  return r.status === 0;
});
const python = pythonAt(10);
const skip = python ? false : 'no Python >= 3.10 on PATH (python3, python, py)';

function calls(t, source, patch = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-py-fail-closed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  fs.writeFileSync(path.join(dir, 'm.py'), source);
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify({ code_index_request: 1, language: 'python', root: dir, files: ['m.py'], options: {} }));
  const r = spawnSync(python[0], [...python[1], '-I', WITH_TABLE, EXTRACTOR, JSON.stringify(patch), path.join(dir, 'request.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return Object.fromEntries(JSON.parse(r.stdout).facts.calls.map((c) => [`${c.span.start.line}:${c.callee_text}`, c.callee]));
}

test('opens a scope: a lambda the table models resolves through it; removed from the table, its calls fail closed', { skip }, (t) => {
  const src = 'def g(): pass\nf = lambda: g()\n';
  assert.equal(calls(t, src)['2:g'], 'm.g');
  assert.equal(calls(t, src, { Lambda: { opens_scope: false } })['2:g'], null, 'a scope the table does not model must be opaque');
  assert.equal(calls(t, src, { Lambda: null })['2:g'], null, 'an absent row is an unmodelled scope too (design note, Verification 3)');
});

test('visible to nested scopes: a method skips its class body; made visible, the class attribute shadows the module def', { skip }, (t) => {
  const src = 'def g(): pass\nclass C:\n    g = 1\n    def m(self):\n        return g()\n';
  assert.equal(calls(t, src)['5:g'], 'm.g', 'Python: a class body is not visible to its methods (S09)');
  assert.equal(calls(t, src, { ClassDef: { visible_to_nested: true } })['5:g'], null);
});

test('binds in enclosing scope: an import the table models resolves; marked not binding, the call fails closed', { skip }, (t) => {
  const src = 'import os\nos.getcwd()\n';
  assert.equal(calls(t, src)['2:os.getcwd'], 'os.getcwd');
  assert.equal(calls(t, src, { Import: { binds_in_parent: false } })['2:os.getcwd'], null);
});

test('a name bound by a modelled and an unmodelled binder in one scope resolves to nothing', { skip }, (t) => {
  const c = calls(t, 'def g(): pass\ng = 1\ng()\nclass A:\n    def x(self):\n        return self.x()\n    x = 2\n');
  assert.equal(c['3:g'], null, 'a def rebound by an assignment at module level');
  assert.equal(c['6:self.x'], null, 'a method rebound by a class attribute (the operator\'s example)');
});

test('below Python 3.10 the extractor refuses, naming the requirement', (t) => {
  const src = fs.readFileSync(EXTRACTOR, 'utf8');
  assert.match(src, /if sys\.version_info < \(3, 10\):\n\s+sys\.stderr\.write\("extract\.py: quorate-python needs Python 3\.10 or later/,
    'the floor check is gone or no longer names the requirement');
  // Run it under an interpreter below the floor when one is installed (design note, Verification 4).
  const r = spawnSync('py', ['-3.8', '-c', 'import sys; print(sys.version_info[:2])'], { encoding: 'utf8' });
  if (r.status !== 0) { t.skip('no Python 3.8 (py -3.8) here: the source check above is the evidence'); return; }
  const run = spawnSync('py', ['-3.8', '-I', EXTRACTOR, '--language', 'python', '--request', 'unused.json'], { encoding: 'utf8' });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /needs Python 3\.10 or later; this is 3\.8/);
  assert.doesNotMatch(run.stderr, /Traceback/);
});
