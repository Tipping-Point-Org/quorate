// THE REFERENCE PYTHON EXTRACTOR EMITS THE FACTS THE GOLDEN TABLE EXPECTS (code-index.plan.md stage 4).
//
// It runs extractors/python/extract.py over tests/fixtures/code-index/python, and checks:
// - the response passes stage 1's validator;
// - for every golden sweep, each expected row is a fact in the table that shape reads, at that path and line, with
//   those field values.
// Outcomes are the query layer's, and stage 7 tests them. Here, only the broken fixture's file is checked: it must be
// reported not processed, with the parser's reason.
//
// With no Python on PATH the test is skipped, and the skip says why. With QUORATE_REQUIRE_PYTHON=1 (CI, and the
// before-delivery run the plan records) a missing Python fails instead: a skipped conformance test proves nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';
import { responseErrors } from '../scripts/lib/code-index-schema.mjs';

const EXTRACTOR = path.join(REPO_ROOT, 'extractors', 'python', 'extract.py');
const FIX = path.join(REPO_ROOT, 'tests', 'fixtures', 'code-index');
const golden = JSON.parse(fs.readFileSync(path.join(FIX, 'golden.json'), 'utf8'));
const TABLE_OF = { symbol: 'definitions', calls: 'calls', constructions: 'constructions', literals: 'literals',
  comparisons: 'comparisons', callees: 'calls', handlers: 'handlers' };

// The interpreter a consumer's PATH would give it, probed under the names it is installed as.
const python = ['python3', 'python'].find((p) => {
  const r = spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'], { encoding: 'utf8' });
  return r.status === 0;
});
const skip = python ? false : 'no Python >= 3.10 on PATH (python3, python); set QUORATE_REQUIRE_PYTHON=1 to make this a failure';

test('a missing Python is a failure where the conformance run is required', { skip: process.env.QUORATE_REQUIRE_PYTHON !== '1' }, () => {
  assert.ok(python, 'QUORATE_REQUIRE_PYTHON=1 and no Python >= 3.10 on PATH: the extractor conformance test cannot run');
});

const pyFiles = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? pyFiles(p, base) : e.name.endsWith('.py') ? [path.relative(base, p).split(path.sep).join('/')] : [];
}).sort();

function extract(root, tmp) {
  const request = { code_index_request: 1, language: 'python', root, files: pyFiles(root), options: {} };
  const file = path.join(tmp, `request-${path.basename(root)}.json`);
  fs.writeFileSync(file, JSON.stringify(request));
  const r = spawnSync(python, ['-I', EXTRACTOR, '--language', 'python', '--request', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { request, response: JSON.parse(r.stdout) };
}

// Every expected field equals the fact's, compared inside nested objects too: the golden rows list only what they check.
const covers = (fact, expected) => Object.entries(expected).every(([k, v]) => {
  if (k === 'line') return fact.span?.start?.line === v;
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return fact[k] && covers(fact[k], v);
  return JSON.stringify(fact[k] ?? null) === JSON.stringify(v);
});

test('the extractor emits every fact the golden table expects, in a response the schema accepts', { skip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-code-index-py-'));
  try {
    const { request, response } = extract(path.join(FIX, 'python'), tmp);
    assert.deepEqual(responseErrors(response, request), []);
    for (const s of golden.sweeps.filter((x) => x.language === 'python')) {
      const facts = response.facts[TABLE_OF[s.shape]];
      for (const row of s.expected) {
        assert.ok(facts.some((f) => f.path === row.path && covers(f, row)),
          `${s.name}: no ${TABLE_OF[s.shape]} fact matches ${JSON.stringify(row)}`);
      }
    }
    // G-14 of 20261020-094311-ciss-delivery: a constant reached a fact whatever its type, so a None dict key failed the
    // schema, a bytes or complex default made json.dumps raise, and 1e999 printed Infinity, which JSON refuses. One such
    // literal discarded the whole language's facts. Only a string, a finite number or a boolean is a literal.
    const odd = path.join(tmp, 'odd');
    fs.mkdirSync(path.join(odd, 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(odd, 'pkg', '__init__.py'), '');
    fs.writeFileSync(path.join(odd, 'pkg', 'odd.py'), ['class C:', '    a: bytes = b"x"', '    b: complex = 1j',
      '    c: int = ...', '    d: float = 1e999', '    e: object = None', 'X = 1e999', 'def f(v):',
      '    C({None: 1, b"k": 2, 1j: 3, "s": 4})', '    return v == 1e999 or v == X', ''].join('\n'));
    const o = extract(odd, tmp);
    assert.deepEqual(responseErrors(o.response, o.request), []);
    assert.deepEqual(o.response.facts.constructions.map((c) => c.dict_keys), [['s']]);
    const defaults = Object.fromEntries(o.response.facts.definitions.filter((d) => d.kind === 'field').map((d) => [d.name, 'default' in d ? d.default : d.default_text]));
    // A default JSON cannot carry is its source text, as ast.unparse spells it, in default_text since G-3 of
    // 20261022-211328-ciss-d1-2-remediation-b-review; None stays null in default, the field being nullable.
    assert.deepEqual(defaults, { a: "b'x'", b: '1j', c: '...', d: '1e309', e: null });
    assert.ok(o.response.facts.definitions.filter((d) => d.kind === 'field' && d.name !== 'e').every((d) => !('default' in d)),
      'a default that is not a literal must not be carried in `default`');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a file the parser refuses is reported not processed, with the line, and nothing is invented for it', { skip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-code-index-py-'));
  try {
    const { request, response } = extract(path.join(FIX, 'python-broken'), tmp);
    assert.deepEqual(responseErrors(response, request), []);
    const broken = response.files.find((f) => f.path === 'pkg/broken.py');
    assert.equal(broken.status, 'not_processed');
    assert.equal(broken.outcome, 'parse_error');
    assert.match(broken.reason, /SyntaxError at line 1/);
    assert.ok(Object.values(response.facts).flat().every((f) => f.path !== 'pkg/broken.py'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('--identity names the runtime and hashes the extractor\'s own module, without reading source', { skip }, () => {
  const r = spawnSync(python, ['-I', EXTRACTOR, '--identity', '--root', path.join(FIX, 'python')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const id = JSON.parse(r.stdout);
  assert.equal(id.name, 'quorate-python');
  assert.match(id.runtime, /^python 3\.\d+\.\d+$/);
  assert.match(id.modules['extract.py'], /^[0-9a-f]{64}$/);
});
