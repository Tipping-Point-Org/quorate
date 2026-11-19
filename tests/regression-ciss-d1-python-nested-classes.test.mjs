// regression-ciss-d1-python-nested-classes.test.mjs — G-4 of review 20261021-162807-ciss-d1-review.
//
// The Python extractor built its class set from the module's top-level statements only, so `Inner()` constructing a
// class declared inside a function or another class resolved as a call and was never recorded in constructions: a
// construction query for it answered a false empty. Skipped, saying why, where no Python >= 3.10 is on PATH.
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

test('G-4: a class declared inside a function or a class is recorded where it is constructed', { skip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ciss-g4-'));
  try {
    const root = path.join(tmp, 'src');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'nest.py'), [
      'class Top:',
      '    pass',
      '',
      'class Outer:',
      '    class Inner:',
      '        pass',
      '',
      '    def make(self):',
      '        return Outer.Inner()',
      '',
      'def f():',
      '    class Local:',
      '        pass',
      '    return Local()',
      '',
      'Top()',
      '',
    ].join('\n'));
    const request = { code_index_request: 1, language: 'python', root, files: ['nest.py'], options: {} };
    const file = path.join(tmp, 'request.json');
    fs.writeFileSync(file, JSON.stringify(request));
    const r = spawnSync(python, ['-I', EXTRACTOR, '--language', 'python', '--request', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const types = JSON.parse(r.stdout).facts.constructions.map((c) => c.type).sort();
    assert.deepEqual(types, ['nest.Outer.Inner', 'nest.Top', 'nest.f.Local'], JSON.stringify(types));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
