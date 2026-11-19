// G-2 of 20261022-211328-ciss-d1-2-remediation-b-review: the Python extractor bound a method's first parameter as the
// receiver unless a decorator's text was exactly `staticmethod`, so `@builtins.staticmethod`, an alias of it, or any
// wrapper resolved `x.m()` to the enclosing class: a guessed target. Decorator text cannot establish what the first
// parameter is, so a decorated method has no receiver and its calls through that parameter fail closed (B-D1).
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

test('G-2: a decorated method binds no receiver, whatever its decorator says; an undecorated one still does', { skip: python ? false : 'no Python >= 3.10' }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-decorated-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  fs.writeFileSync(path.join(dir, 'm.py'), [
    'import builtins', 'sm = staticmethod', 'def wrap(f): return f',
    'class C:',
    '    @builtins.staticmethod', '    def a(x):', '        x.m()',
    '    @sm', '    def b(x):', '        x.m()',
    '    @wrap', '    def c(x):', '        x.m()',
    '    def m(self):', '        self.m()', ''].join('\n'));
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify({ code_index_request: 1, language: 'python', root: dir, files: ['m.py'], options: {} }));
  const r = spawnSync(python[0], [...python[1], '-I', path.join(REPO_ROOT, 'extractors', 'python', 'extract.py'),
    '--language', 'python', '--request', path.join(dir, 'request.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const at = Object.fromEntries(JSON.parse(r.stdout).facts.calls.map((c) => [`${c.span.start.line}:${c.callee_text}`, c]));
  for (const line of [7, 10, 13]) {
    assert.equal(at[`${line}:x.m`]?.resolved, false, `line ${line}: a decorated method's first parameter was read as self: ${JSON.stringify(at[`${line}:x.m`])}`);
    assert.equal(at[`${line}:x.m`]?.callee, null);
  }
  assert.equal(at['15:self.m']?.callee, 'm.C.m', 'S08 still holds for an undecorated method');
});
