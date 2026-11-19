// regression-ciss-d1-r4-python-lambda-defaults.test.mjs — G-1 and G-2 of review 20261021-194056-ciss-d1-remediation-3-review.
//
// The Python extractor opened no scope for a lambda, so `lambda len: len()` resolved its parameter in the surrounding
// scope, as builtins.len (G-1); and it entered a function's scope before visiting its defaults, which Python evaluates
// where the def is, so a default resolved against the function's own locals (G-2). Both corrupt the calls index.
// Skipped, saying why, where no Python >= 3.10 is on PATH.
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

function calls(source) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ciss-r4-g1g2-'));
  try {
    const root = path.join(tmp, 'src');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'm.py'), source.join('\n'));
    const file = path.join(tmp, 'request.json');
    fs.writeFileSync(file, JSON.stringify({ code_index_request: 1, language: 'python', root, files: ['m.py'], options: {} }));
    const r = spawnSync(python, ['-I', EXTRACTOR, '--language', 'python', '--request', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).facts.calls.map((c) => [c.callee_text, c.callee]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('G-1: a lambda parameter shadows the builtin and the module import it names', { skip }, () => {
  const got = calls([
    'import os',
    'f = lambda len: len()',
    'g = lambda os, *a, **k: os.path()',
    'h = lambda: len()',
    '',
  ]);
  assert.deepEqual(got.sort(), [['len', 'builtins.len'], ['len', null], ['os.path', null]].sort(), JSON.stringify(got));
});

test('G-2: a default resolves in the scope that holds the def, not in the function it defaults', { skip }, () => {
  const got = calls([
    'class Thing:',
    '    pass',
    'def f(x=Thing(), *, y=Thing()):',
    '    if x:',
    '        class Thing:',
    '            pass',
    '    return x',
    'def outer():',
    '    import json',
    '    def inner(x=json.dumps()):',
    '        return x',
    '    return inner',
    '',
  ]);
  assert.deepEqual(got, [['Thing', 'm.Thing'], ['Thing', 'm.Thing'], ['json.dumps', 'json.dumps']], JSON.stringify(got));
});
