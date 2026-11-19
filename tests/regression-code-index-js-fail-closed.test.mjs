// regression-code-index-js-fail-closed.test.mjs — code-index-d1-part-b.plan.md stage 4 (design note B-D1, B-D2;
// Verification 3; B-D4 point 3).
//
// The JavaScript extractor reads its generated SCOPE_CONSTRUCTS table as the Python one does. Each column must govern
// behaviour, so each test runs a copy of the extractor whose table has one row's column changed, and shows the call that
// row governs change its answer. The copy is written beside a temporary corpus; the repository's extractor is not edited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'extractors', 'javascript', 'extract.mjs'), 'utf8');
const acornHome = process.env.QUORATE_ACORN_DIR;
const acornAt = acornHome && fs.existsSync(path.join(acornHome, 'node_modules', 'acorn', 'package.json'))
  ? path.join(acornHome, 'node_modules', 'acorn') : null;
const skip = acornAt ? false : 'no acorn: set QUORATE_ACORN_DIR to a directory whose node_modules holds acorn';

/** The extractor with `construct`'s row changed (`change` null removes it), run over `files`: callee by line:text. */
function calls(t, files, construct, change, pick = (c) => c.callee) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-js-fail-closed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  fs.cpSync(acornAt, path.join(dir, 'node_modules', 'acorn'), { recursive: true });
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
  let src = SOURCE;
  if (construct) {
    const row = new RegExp(`^  ${construct}: Object\\.freeze\\(\\{ (.*) \\}\\),$`, 'm');
    assert.match(src, row, `the table has no ${construct} row`);
    src = src.replace(row, (_, cols) => (change === null ? '' : `  ${construct}: Object.freeze({ ${cols.split(', ')
      .map((c) => { const [k] = c.split(': '); return k in change ? `${k}: ${change[k]}` : c; }).join(', ')} }),`));
  }
  fs.writeFileSync(path.join(dir, 'extract.mjs'), src);
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify({ code_index_request: 1, language: 'javascript', root: dir,
    files: Object.keys(files), options: {} }));
  const r = spawnSync(process.execPath, [path.join(dir, 'extract.mjs'), '--language', 'javascript', '--request', path.join(dir, 'request.json')],
    { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return Object.fromEntries(JSON.parse(r.stdout).facts.calls.map((c) => [`${c.span.start.line}:${c.callee_text}`, pick(c)]));
}

// G-1 of 20261022-183032-pb-delivery: every failure to locate, read or load acorn was caught as "acorn is absent", so a
// corrupt package.json answered not_configured for every file and hid the real failure. Only an absent acorn is that.
test('an acorn that is present but cannot be loaded fails the extractor; an absent one is not_configured', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-js-acorn-broken-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const id = (root) => spawnSync(process.execPath, [path.join(REPO_ROOT, 'extractors', 'javascript', 'extract.mjs'), '--identity', '--root', root],
    { encoding: 'utf8' });
  const absent = id(dir);
  assert.equal(absent.status, 0, absent.stderr);
  assert.equal(JSON.parse(absent.stdout).parser, null, 'no acorn: the identity names no parser');
  fs.mkdirSync(path.join(dir, 'node_modules', 'acorn'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'acorn', 'package.json'), '{ "name": "acorn", ');
  fs.writeFileSync(path.join(dir, 'node_modules', 'acorn', 'index.js'), 'module.exports = {};\n');
  const broken = id(dir);
  assert.notEqual(broken.status, 0, `a corrupt acorn package.json was read as no acorn: ${broken.stdout}`);
  assert.match(broken.stderr, /acorn/);
});

// G-1 of 20261022-191112-pb-remediation-review: node raises MODULE_NOT_FOUND both for no acorn and for an installed acorn
// whose declared entry file is missing, and every MODULE_NOT_FOUND was read as absent, so that broken install was still
// not_configured.
test('an installed acorn whose entry file is missing fails the extractor, not read as absent', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-js-acorn-no-entry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  fs.mkdirSync(path.join(dir, 'node_modules', 'acorn'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'acorn', 'package.json'), JSON.stringify({ name: 'acorn', version: '8.0.0', main: 'dist/acorn.js' }));
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'extractors', 'javascript', 'extract.mjs'), '--identity', '--root', dir],
    { encoding: 'utf8' });
  assert.notEqual(r.status, 0, `an acorn with no entry file was read as no acorn: ${r.stdout}`);
  assert.match(r.stderr, /acorn is present but could not be loaded/);
});

// G-3 of 20261022-183032-pb-delivery: a tagged template calls its tag with the strings and then each substitution, and
// its row carried `args: []`, so a query filtering on an argument found no call. The completion pass, which answers the
// calls inside an unmodelled scope, read `node.arguments`, which a tagged template does not have.
test('a tagged template\'s row carries its strings and each substitution as arguments, in both passes', { skip }, (t) => {
  const files = { 'm.mjs': 'function tag() {}\nconst o = { p: 1 };\ntag`a${o.p}b${o}`;\nexport const f = () => tag`x${o.p}`;\n' };
  const paths = (c) => c.args.map((a) => a.path ?? a.kind);
  const walked = calls(t, files, null, undefined, paths);
  assert.deepEqual(walked['3:tag'], ['other', 'o.p', 'name'], 'the walk drops the substitutions');
  assert.deepEqual(walked['4:tag'], ['other', 'o.p']);
  const completed = calls(t, files, 'ArrowFunctionExpression', null, paths);
  assert.deepEqual(completed['4:tag'], ['other', 'o.p'], 'the completion pass drops the substitutions');
});

test('opens a scope: an arrow the table models resolves through it; unmodelled or removed, its calls fail closed', { skip }, (t) => {
  const files = { 'm.mjs': 'function g() {}\nexport const f = () => g();\n' };
  assert.equal(calls(t, files)['2:g'], 'm.g');
  assert.equal(calls(t, files, 'ArrowFunctionExpression', { opens_scope: false })['2:g'], null);
  assert.equal(calls(t, files, 'ArrowFunctionExpression', null)['2:g'], null, 'an absent row is an unmodelled scope (Verification 3)');
});

test('visible to nested scopes: an enclosing function\'s binding answers unresolved (S10); made invisible, it is skipped', { skip }, (t) => {
  const files = { 'm.mjs': 'function g() {}\nfunction outer() {\n  function g() {}\n  function inner() { return g(); }\n}\n' };
  assert.equal(calls(t, files)['4:g'], null);
  assert.equal(calls(t, files, 'FunctionDeclaration', { visible_to_nested: false })['4:g'], 'm.g');
});

test('binds in enclosing scope: an import the table models resolves; marked not binding, the call fails closed', { skip }, (t) => {
  const files = { 'm.mjs': 'import { a } from \'./x.mjs\';\na();\n', 'x.mjs': 'export function a() {}\n' };
  assert.equal(calls(t, files)['2:a'], 'x.a');
  assert.equal(calls(t, files, 'ImportDeclaration', { binds_in_parent: false })['2:a'], null);
});

test('a class expression, a static block and with are opaque; a block\'s own names fail closed and the rest resolve', { skip }, (t) => {
  const c = calls(t, { 'm.mjs': 'function g() {}\nfunction h() {}\nexport const K = class { m() { return g(); } };\n'
    + '{\n  let h = 1;\n  h();\n  g();\n}\n' });
  assert.equal(c['3:g'], null, 'a class expression is not modelled');
  assert.equal(c['6:h'], null, 'a name the block declares');
  assert.equal(c['7:g'], 'm.g', 'a name the block does not declare still resolves');
});
