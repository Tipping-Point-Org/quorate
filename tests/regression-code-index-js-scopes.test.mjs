// THE JAVASCRIPT EXTRACTOR'S FACTS ARE RIGHT ABOUT SCOPE, NOT ONLY PRESENT (G-2, G-4, G-5, G-6 of
// 20261020-061457-code-index-full-sweep).
//
// Four ways its facts looked complete and were wrong:
// - G-2: the definitions pass read ast.body and never unwrapped `export`, so a call to an exported function or class of
//   the same file came back unresolved, and constructing an exported class was no construction at all.
// - G-4: an anonymous FunctionExpression kept its enclosing name, so a class method's facts were the class's, and the
//   method itself was never a definition.
// - G-5: a literal initializer was tracked and never cleared on reassignment, so a comparison reported a value the
//   variable no longer held.
// - G-6: a .js file was always parsed as a script, so an ES module .js (package "type": "module") was a parse error.
//
// acorn comes from QUORATE_ACORN_DIR, as in regression-code-index-javascript; without it this file is skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './helpers.mjs';

const EXTRACTOR = path.join(REPO_ROOT, 'extractors', 'javascript', 'extract.mjs');
const acornHome = process.env.QUORATE_ACORN_DIR;
const acornAt = acornHome && fs.existsSync(path.join(acornHome, 'node_modules', 'acorn', 'package.json'))
  ? path.join(acornHome, 'node_modules', 'acorn') : null;
const skip = acornAt ? false : 'no acorn: set QUORATE_ACORN_DIR to a directory whose node_modules holds acorn';

function run(files, pkg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-code-index-js-scope-'));
  try {
    fs.cpSync(acornAt, path.join(dir, 'node_modules', 'acorn'), { recursive: true });
    if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
    const request = { code_index_request: 1, language: 'javascript', root: dir, files: Object.keys(files), options: {} };
    fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request));
    const r = spawnSync(process.execPath, [EXTRACTOR, '--language', 'javascript', '--request', path.join(dir, 'request.json')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('G-2: an exported function and class of the same file resolve, and constructing the class is a construction', { skip }, () => {
  const r = run({ 'a.mjs': 'export function helper() {}\nexport class Box {}\nexport default function main() {}\nhelper();\nnew Box({ k: 1 });\nmain();\n' });
  const calls = Object.fromEntries(r.facts.calls.map((c) => [c.callee_text, c]));
  assert.equal(calls.helper.callee, 'a.helper');
  assert.equal(calls.Box.callee, 'a.Box');
  assert.equal(calls.main.callee, 'a.main');
  assert.deepEqual(r.facts.constructions.map((c) => [c.type, c.dict_keys]), [['a.Box', ['k']]]);
});

test('G-4: a class method is a definition, and its facts are attributed to it, not to the class', { skip }, () => {
  const r = run({ 'c.mjs': 'class K {\n  run() { console.log(1); }\n  static make() { return 2; }\n}\n' });
  const defs = r.facts.definitions.map((d) => [d.qualified, d.kind]);
  assert.ok(defs.some(([q, k]) => q === 'c.K.run' && k === 'function'), JSON.stringify(defs));
  assert.ok(defs.some(([q, k]) => q === 'c.K.make' && k === 'function'), JSON.stringify(defs));
  assert.equal(r.facts.calls.find((c) => c.callee_text === 'console.log').enclosing, 'c.K.run');
});

test('G-5: a reassigned variable is no longer its initial literal in a later comparison', { skip }, () => {
  const r = run({ 'v.mjs': 'let mode = "fast";\nif (mode === x) {}\nmode = compute();\nif (mode === y) {}\nlet n = 1;\nn += 2;\nif (n > z) {}\n' });
  const cmp = r.facts.comparisons.map((c) => [c.span.start.line, c.literal, c.via]);
  // Changed deliberately with design D3 of code-index-schema-and-scope (operator, 2026-10-20: "Single assignment only
  // (Recommended)"): `mode` is bound twice, so it is not tracked anywhere, line 2 included.
  assert.deepEqual(cmp, [[2, null, null], [4, null, null], [7, null, null]]);
});

test('G-6: a .js file under a "type": "module" package is parsed as a module, and a .cjs one stays a script', { skip }, () => {
  const r = run({ 'm.js': 'import fs from "node:fs";\nexport const x = 1;\nfs.readFileSync("a");\n', 's.cjs': 'const fs = require("fs");\n' }, { type: 'module' });
  assert.deepEqual(r.files.map((f) => [f.path, f.status]), [['m.js', 'processed'], ['s.cjs', 'processed']]);
  assert.equal(r.facts.calls.find((c) => c.callee_text === 'fs.readFileSync').callee, 'node:fs.readFileSync');
  const plain = run({ 'p.js': 'var a = 1;\n' });
  assert.equal(plain.files[0].status, 'processed', 'a .js file with no type:module package is still a script');
});
