// G-5 of 20261022-211328-ciss-d1-2-remediation-b-review: the Python extractor built the manifest `in_manifest` is read
// against from the modules it PARSED, while the JavaScript extractor builds it from every requested file. The manifest is
// git's list under the globs (shared/code-index.md, "What a query covers"), so a call into a requested module that could
// not be read is still a call into the manifest, and the field meant different things in the two extractors.
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

test('G-5: a call into a requested module that could not be read is in_manifest, as in the JavaScript extractor', { skip: python ? false : 'no Python >= 3.10' }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-in-manifest-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  fs.writeFileSync(path.join(dir, 'a.py'), 'from b import f\nf()\nimport os\nos.getcwd()\n');
  fs.mkdirSync(path.join(dir, 'b.py'));
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify({ code_index_request: 1, language: 'python', root: dir, files: ['a.py', 'b.py'], options: {} }));
  const r = spawnSync(python[0], [...python[1], '-I', path.join(REPO_ROOT, 'extractors', 'python', 'extract.py'),
    '--language', 'python', '--request', path.join(dir, 'request.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.files.find((f) => f.path === 'b.py').status, 'not_processed', 'the fixture needs b.py unread');
  const byCallee = Object.fromEntries(out.facts.calls.map((c) => [c.callee, c]));
  assert.equal(byCallee['b.f']?.in_manifest, true, `b.py was requested, so b.f is in the manifest: ${JSON.stringify(byCallee['b.f'])}`);
  assert.equal(byCallee['os.getcwd']?.in_manifest, false, 'a module nobody requested is still outside it');
});
