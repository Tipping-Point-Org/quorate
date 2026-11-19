// THE PYTHON EXTRACTOR'S FACTS ARE RIGHT ABOUT SCOPE, NOT ONLY PRESENT (G-8, G-10 of
// 20261020-061457-code-index-full-sweep).
//
// - G-8: the import table was built with ast.walk over the whole file, so an import inside one function was a
//   module-wide binding, and a call in another function that would raise NameError was reported resolved.
// - G-10: a constant assignment was tracked and never forgotten on a non-constant reassignment, so a later comparison
//   reported a literal the name no longer held.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const EXTRACTOR = path.join(REPO_ROOT, 'extractors', 'python', 'extract.py');
const python = ['python3', 'python'].find((p) => {
  const r = spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'], { encoding: 'utf8' });
  return r.status === 0;
});
const skip = python ? false : 'no Python >= 3.10 on PATH (python3, python)';

function run(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-code-index-py-scope-'));
  try {
    fs.writeFileSync(path.join(dir, 'm.py'), source);
    const request = { code_index_request: 1, language: 'python', root: dir, files: ['m.py'], options: {} };
    fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request));
    const r = spawnSync(python, ['-I', EXTRACTOR, '--language', 'python', '--request', path.join(dir, 'request.json')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('G-8: a function-local import resolves inside that function only', { skip }, () => {
  const r = run('import os\n\ndef a():\n    import json\n    json.dumps(1)\n\ndef b():\n    json.dumps(2)\n    os.getcwd()\n');
  const at = Object.fromEntries(r.facts.calls.map((c) => [c.span.start.line, [c.callee, c.resolved]]));
  assert.deepEqual(at[5], ['json.dumps', true], 'the import inside a() resolves inside a()');
  assert.deepEqual(at[8], [null, false], 'the import inside a() is not a binding inside b()');
  assert.deepEqual(at[9], ['os.getcwd', true], 'a module-level import still resolves everywhere');
});

test('G-10: a name rebound to a non-constant is no longer its old literal in a later comparison', { skip }, () => {
  const r = run('mode = "fast"\nif mode == x:\n    pass\nmode = compute()\nif mode == y:\n    pass\nn = 1\nn += 2\nif n > z:\n    pass\nk = 1\nk, j = f()\nif k == w:\n    pass\n');
  const cmp = r.facts.comparisons.map((c) => [c.span.start.line, c.literal, c.via]);
  // Changed deliberately with design D3 of code-index-schema-and-scope (operator, 2026-10-20: "Single assignment only
  // (Recommended)"): `mode` is bound twice in this scope, so it is not tracked anywhere, line 2 included. The old
  // flow-sensitive answer kept 'fast' at line 2; rebinding forms were found one at a time (G-10, G-5, G-4).
  assert.deepEqual(cmp, [[2, null, null], [5, null, null], [9, null, null], [13, null, null]]);
});
