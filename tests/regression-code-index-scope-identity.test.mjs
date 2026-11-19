// regression-code-index-scope-identity.test.mjs — code-index-d1-part-b.plan.md stage 5.
//
// The scope table is part of the extractor contract (operator, 2026-10-21: "What the extractor extracts is part of the
// contract, right?"). Every extractor reports its rows through `--identity`; the engine compares them with
// shared/code-index.md's table for its language and refuses one that differs, each difference named. A language with no
// table runs, and its answers say the scope model is unchecked. The reference extractors report exactly their tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, REPO_ROOT } from './helpers.mjs';
import { SCOPE_TABLES, scopeConstructsDifferences } from '../scripts/lib/scope-constructs.mjs';

const CLI = path.join(SCRIPTS_DIR, 'code-index.mjs');

// A fake extractor whose reported table is FAKE_TABLE (JSON, or "absent" for no field).
const FAKE = `
import fs from 'node:fs';
const argv = process.argv.slice(2);
const opt = (k) => argv[argv.indexOf(k) + 1];
if (argv.includes('--identity')) {
  const t = process.env.FAKE_TABLE;
  if (t === 'refuses') { process.stderr.write('fake: needs Python 3.10 or later; this is 3.9\\n'); process.exit(2); }
  const id = { name: 'fake', version: '1', runtime: 'node', parser: 'none', modules: { 'fake.mjs': '0'.repeat(64) } };
  if (t !== 'absent') id.scope_constructs = JSON.parse(t);
  process.stdout.write(JSON.stringify(id));
  process.exit(0);
}
const req = JSON.parse(fs.readFileSync(opt('--request'), 'utf8'));
const span = { start: { line: 1, col: 0 }, end: { line: 1, col: 1 } };
process.stdout.write(JSON.stringify({ code_index_schema: 1, extractor: { name: 'fake', version: '1' },
  files: req.files.map((p) => ({ path: p, status: 'processed' })),
  facts: { definitions: req.files.map((p) => ({ path: p, span, enclosing: 'm', name: 'a', qualified: 'm.a', kind: 'function', signature: '()' })),
    calls: [], constructions: [], literals: [], comparisons: [], imports: [], handlers: [] } }));
`;

function run(t, language, table) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-scope-identity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const r = path.join(dir, 'repo');
  fs.mkdirSync(path.join(r, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fake.mjs'), FAKE);
  fs.writeFileSync(path.join(r, 'src', 'a.x'), 'a\n');
  fs.writeFileSync(path.join(r, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: f', 'commands:',
    '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'code_index:', `  ${language}:`,
    `    extractor: "node ${path.join(dir, 'fake.mjs').split(path.sep).join('/')}"`, '    globs: ["src/**"]', '    env: ["FAKE_TABLE"]',
    'review:', '  models: { judgment: opus }', '  effort: { judgment: low }', '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: r, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@example.invalid'); git('config', 'user.name', 'x'); git('add', '-A'); git('commit', '-qm', 'f');
  const res = spawnSync(process.execPath, [CLI, 'symbol', '--args', '{"name":"m.a"}', '--repo-root', r], {
    cwd: r, encoding: 'utf8',
    env: (() => { const e = { ...process.env, QUORATE_HOME: path.join(dir, 'home'), FAKE_TABLE: table }; delete e.GRAPH_NODE_DEPTH; return e; })(),
  });
  return JSON.parse(res.stdout);
}

test('an extractor reporting the contract\'s table runs, and its answers carry no unchecked-model note', (t) => {
  const a = run(t, 'python', JSON.stringify(SCOPE_TABLES.python));
  assert.equal(a.outcome, 'complete', JSON.stringify(a));
  assert.ok(!a.not_checked.some((n) => /scope table/.test(n)), a.not_checked.join(' | '));
});

test('a row added, a row missing, a column changed or no field: refused, each difference named', (t) => {
  const added = run(t, 'python', JSON.stringify({ ...SCOPE_TABLES.python, ListComp: { opens_scope: true, visible_to_nested: false, binds_in_parent: false } }));
  assert.equal(added.outcome, 'extractor_failed');
  assert.match(added.why, /models a different scope table than shared\/code-index\.md's for python: reports ListComp/);
  const { Lambda, ...less } = SCOPE_TABLES.python;
  assert.match(run(t, 'python', JSON.stringify(less)).why, /does not report Lambda/);
  const changed = run(t, 'python', JSON.stringify({ ...SCOPE_TABLES.python, ClassDef: { ...SCOPE_TABLES.python.ClassDef, visible_to_nested: true } }));
  assert.match(changed.why, /reports ClassDef\.visible_to_nested as true; the python table says false/);
  const none = run(t, 'python', 'absent');
  assert.equal(none.outcome, 'extractor_failed');
  assert.match(none.why, /scope_constructs is missing/);
});

// G-10 of 20261022-183032-pb-delivery: an extractor that refuses names its reason on stderr (the Python floor's "needs
// Python 3.10"), and the answer kept only `exit 2`, so the reason was captured and never shown.
test('an extractor that exits non-zero has the reason it wrote on stderr in the answer', (t) => {
  const a = run(t, 'python', 'refuses');
  assert.equal(a.outcome, 'extractor_failed', JSON.stringify(a));
  assert.equal(a.detail, 'failed');
  assert.match(a.why, /exit 2/);
  assert.match(a.why, /needs Python 3\.10 or later; this is 3\.9/);
});

// G-13 of 20261022-183032-pb-delivery: the row and language checks used `in` and plain indexing, which find keys
// inherited from Object.prototype, so an extra row named `constructor` passed the row-for-row comparison.
test('a row or a language named like an inherited property is not mistaken for one the table lists', () => {
  const extra = { ...SCOPE_TABLES.python, constructor: { opens_scope: false, visible_to_nested: false, binds_in_parent: false } };
  assert.deepEqual(scopeConstructsDifferences('python', extra), ['reports constructor, which the python table does not list']);
  const proto = JSON.parse(`{"__proto__": {}, ${JSON.stringify(SCOPE_TABLES.javascript).slice(1)}`);
  assert.deepEqual(scopeConstructsDifferences('javascript', proto), ['reports __proto__, which the javascript table does not list']);
  assert.equal(scopeConstructsDifferences('toString', {}), null);
  assert.equal(scopeConstructsDifferences('constructor', { constructor: {} }), null);
});

test('a language with no table runs, and every answer names its scope model as unchecked', (t) => {
  assert.equal(scopeConstructsDifferences('go', {}), null);
  const a = run(t, 'go', JSON.stringify({ File: { opens_scope: true, visible_to_nested: true, binds_in_parent: false } }));
  assert.equal(a.outcome, 'complete', JSON.stringify(a));
  assert.ok(a.not_checked.some((n) => /go: shared\/code-index\.md has no scope table/.test(n)), a.not_checked.join(' | '));
});

// G-13 of 20261022-191112-pb-remediation-review: scope_constructs was required non-empty for every language, so a
// contributed language that truthfully models no construct was refused before the table comparison could say its model
// is unchecked. Required is not non-empty; a tabled language reporting {} is still refused, row by row.
test('an untabled language reporting no constructs runs unchecked; a tabled one reporting none is refused by its table', (t) => {
  const go = run(t, 'go', '{}');
  assert.equal(go.outcome, 'complete', JSON.stringify(go));
  assert.ok(go.not_checked.some((n) => /go: shared\/code-index\.md has no scope table/.test(n)), go.not_checked.join(' | '));
  const py = run(t, 'python', '{}');
  assert.equal(py.outcome, 'extractor_failed');
  assert.match(py.why, /does not report Module/);
});

test('the reference extractors report exactly their tables', (t) => {
  const py = ['python3', 'python', 'py'].find((p) => spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)']).status === 0);
  if (py) {
    const r = spawnSync(py, ['-I', path.join(REPO_ROOT, 'extractors', 'python', 'extract.py'), '--identity', '--root', REPO_ROOT], { encoding: 'utf8' });
    assert.deepEqual(scopeConstructsDifferences('python', JSON.parse(r.stdout).scope_constructs), []);
  } else t.diagnostic('no Python >= 3.10: the Python extractor was not run');
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'extractors', 'javascript', 'extract.mjs'), '--identity', '--root', REPO_ROOT], { encoding: 'utf8' });
  assert.deepEqual(scopeConstructsDifferences('javascript', JSON.parse(r.stdout).scope_constructs), []);
});
