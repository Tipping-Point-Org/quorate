// THE SCOPE TABLE IS THE SET, AND THE CASE MATRIX COVERS IT (code-index-schema-and-scope.plan.md stage 2; design D2-D4).
//
// shared/code-index.md's "Scope" section lists every case one-hop resolution covers or refuses, and every rebinding form
// that stops a literal being reported, each with an id and the languages that have the construct. Each case was patched
// one at a time across four review rounds, each round finding the next. So the table is the set, and
// tests/fixtures/code-index/scope/golden.json holds one sweep per id per language, its name beginning with the id. This
// test fails when an id lacks a sweep in a language that has it, or a sweep names an id the table does not. The sweeps
// themselves run through `code-index.mjs conformance`, against both extractors, below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, SCRIPTS_DIR } from './helpers.mjs';

const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'code-index.md'), 'utf8').split('\r\n').join('\n');
const SCOPE = path.join(REPO_ROOT, 'tests', 'fixtures', 'code-index', 'scope');
const golden = JSON.parse(fs.readFileSync(path.join(SCOPE, 'golden.json'), 'utf8'));

// The table's rows: | `S01` | … | python, javascript |
function tableRows() {
  const at = doc.indexOf('\n## Scope\n');
  assert.notEqual(at, -1, 'shared/code-index.md has no "## Scope" section');
  const body = doc.slice(at).split(/\n## (?!Scope)/)[0];
  return [...body.matchAll(/^\| `([SR]\d\d)` \|.*\| ([a-z, —-]+) \|$/gm)].map((m) => ({
    id: m[1], languages: m[2].split(',').map((s) => s.trim()).filter((s) => s === 'python' || s === 'javascript'),
  }));
}

test('every case in the scope table has a sweep in each language that has it, and no sweep names an unknown id', () => {
  const rows = tableRows();
  assert.ok(rows.length >= 20, `the Scope table lists only ${rows.length} cases`);
  const swept = new Set(golden.sweeps.map((s) => `${s.name.slice(0, 3)} ${s.language}`));
  for (const r of rows) for (const lang of r.languages) assert.ok(swept.has(`${r.id} ${lang}`), `${r.id} has no ${lang} sweep`);
  const ids = new Set(rows.map((r) => r.id));
  for (const s of golden.sweeps) {
    assert.ok(ids.has(s.name.slice(0, 3)), `the sweep "${s.name}" names an id the table does not`);
    const row = rows.find((r) => r.id === s.name.slice(0, 3));
    assert.ok(row.languages.includes(s.language), `${s.name}: the table says ${s.language} lacks this construct`);
  }
});

// R11 HAS TWO PYTHON SPELLINGS (G-19 of 20261030-124823-ciss-stage7): the matrix swept `nonlocal` only, so a regression
// that tracked a literal rebound through `global` passed it. Each spelling is a sweep whose fixture uses it.
test('R11 is swept in Python through both nonlocal and global', () => {
  const r11 = golden.sweeps.filter((s) => s.name.startsWith('R11') && s.language === 'python');
  const sources = r11.map((s) => {
    const mod = s.args.within.split('.').slice(0, -1);
    return fs.readFileSync(path.join(SCOPE, 'python', ...mod) + '.py', 'utf8');
  });
  for (const kw of ['nonlocal', 'global']) {
    assert.ok(sources.some((src) => new RegExp(`^\\s*${kw}\\s`, 'm').test(src)), `no Python R11 sweep exercises a ${kw} write`);
  }
});

test('one case is pinned by name, because a consumer\'s queries rest on it: a function-local aliased import resolves', () => {
  const s = golden.sweeps.find((x) => x.name.startsWith('S01') && x.language === 'python');
  assert.ok(s, 'no S01 sweep');
  assert.equal(s.expected[0].callee, 'sc.helpers.make');
  assert.equal(s.outcome, 'complete');
});

const python = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);
const acornHome = process.env.QUORATE_ACORN_DIR;
const acornAt = acornHome && fs.existsSync(path.join(acornHome, 'node_modules', 'acorn', 'package.json'))
  ? path.join(acornHome, 'node_modules', 'acorn') : null;

const conformance = (language, extractor, fixtures) => spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'code-index.mjs'),
  'conformance', '--language', language, '--extractor', extractor, '--fixtures', fixtures], { cwd: REPO_ROOT, encoding: 'utf8' });

test('the Python extractor answers every Python case of the matrix', { skip: python ? false : 'no Python on PATH (QUORATE_REQUIRE_PYTHON=1 makes the conformance test fail instead)' }, () => {
  const r = conformance('python', `${python} ${path.join(REPO_ROOT, 'extractors', 'python', 'extract.py').split(path.sep).join('/')}`, SCOPE);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the JavaScript extractor answers every JavaScript case of the matrix', { skip: acornAt ? false : 'no acorn: set QUORATE_ACORN_DIR' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-scope-js-'));
  try {
    fs.cpSync(SCOPE, dir, { recursive: true });
    fs.cpSync(acornAt, path.join(dir, 'javascript', 'node_modules', 'acorn'), { recursive: true });
    const r = conformance('javascript', `node ${path.join(REPO_ROOT, 'extractors', 'javascript', 'extract.mjs').split(path.sep).join('/')}`, dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// THE BINDING COLLECTORS COVER EVERY FORM THE GRAMMAR HAS (plan stage 2, "The test that keeps the list whole").
test('Python: every ast class with a binding-name field is handled by the collector or named as non-binding', { skip: python ? false : 'no Python on PATH' }, () => {
  const dir = path.join(REPO_ROOT, 'extractors', 'python');
  const r = spawnSync(python, ['-I', '-c', [
    'import ast, sys',
    `sys.path.insert(0, ${JSON.stringify(dir)})`,
    'import extract',
    'missing = []',
    'for n in dir(ast):',
    '    c = getattr(ast, n)',
    '    if isinstance(c, type) and issubclass(c, ast.AST) and any(f in ("name", "names", "asname", "arg", "rest") for f in getattr(c, "_fields", ())):',
    '        if n not in extract.BINDING_FIELDS and n not in extract.NON_BINDING:',
    '            missing.append(n)',
    'print(",".join(missing))',
  ].join('\n')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '', `ast classes the collector neither handles nor names: ${r.stdout.trim()}`);
});

test('JavaScript: every ESTree pattern position is counted as a binding', { skip: acornAt ? false : 'no acorn: set QUORATE_ACORN_DIR' }, async () => {
  const { createRequire } = await import('node:module');
  const acorn = createRequire(path.join(acornAt, 'package.json'))('./dist/acorn.js');
  const { bindingCounts } = await import(new URL(`file:///${path.join(REPO_ROOT, 'extractors', 'javascript', 'extract.mjs').split(path.sep).join('/')}`).href);
  // One name per position, each bound exactly once, so each must count 1.
  const src = [
    'import d0, { e0 as e1 } from "m"; import * as n0 from "m";',
    'function f(p0, [p1], { p2, k: p3 }, p4 = 1, ...p5) {',
    '  const v0 = 1; let [v1] = []; let { v2 } = {};',
    '  a0 = 1; [a1] = []; ({ a2 } = {}); u0++;',
    '  try {} catch (c0) {}',
    '  for (i0 in {}) {} for (o0 of []) {}',
    '  function g0() {} class k0 {} const fe = function h0() {};',
    '}',
  ].join('\n');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const counts = bindingCounts(ast);
  for (const n of ['d0', 'e1', 'n0', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'v0', 'v1', 'v2', 'a0', 'a1', 'a2', 'u0', 'c0', 'i0', 'o0', 'g0', 'k0', 'h0', 'fe', 'f']) {
    assert.equal(counts.get(n), 1, `${n} is counted ${counts.get(n) ?? 0} times`);
  }
});
