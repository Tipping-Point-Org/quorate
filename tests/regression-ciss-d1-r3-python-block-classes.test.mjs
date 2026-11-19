// regression-ciss-d1-r3-python-block-classes.test.mjs — G-1 of review 20261021-190234-ciss-d1-remediations-review.
//
// The Python extractor's class set descended only through function and class definitions, so a class declared inside an
// `if`, `try`, `for`, `while` or `with` block never entered it, and constructing that class answered a construction
// query with a false empty. Skipped, saying why, where no Python >= 3.10 is on PATH.
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

test('G-1: a class declared inside an if, try, for, while or with block is recorded where it is constructed', { skip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ciss-r3-g1-'));
  try {
    const root = path.join(tmp, 'src');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'blk.py'), [
      'import sys',
      'if sys:',
      '    class InIf:',
      '        pass',
      'else:',
      '    class InElse:',
      '        pass',
      'try:',
      '    class InTry:',
      '        pass',
      'except Exception:',
      '    class InExcept:',
      '        pass',
      'for _ in ():',
      '    class InFor:',
      '        pass',
      'while False:',
      '    class InWhile:',
      '        pass',
      'with open(__file__) as fh:',
      '    class InWith:',
      '        pass',
      '',
      'def f():',
      '    if True:',
      '        class Local:',
      '            pass',
      '    return Local()',
      '',
      'InIf(); InElse(); InTry(); InExcept(); InFor(); InWhile(); InWith()',
      '',
    ].join('\n'));
    const request = { code_index_request: 1, language: 'python', root, files: ['blk.py'], options: {} };
    const file = path.join(tmp, 'request.json');
    fs.writeFileSync(file, JSON.stringify(request));
    const r = spawnSync(python, ['-I', EXTRACTOR, '--language', 'python', '--request', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const types = JSON.parse(r.stdout).facts.constructions.map((c) => c.type).sort();
    assert.deepEqual(types, ['blk.InElse', 'blk.InExcept', 'blk.InFor', 'blk.InIf', 'blk.InTry', 'blk.InWhile', 'blk.InWith',
      'blk.f.Local'], JSON.stringify(types));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
