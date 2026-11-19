// regression-code-index-own-language-keys.test.mjs — G-10, G-11 and G-12 of 20261022-191112-pb-remediation-review.
//
// conformance and compare take a language name from the operator (--language, an answer file's sweep). Two of their
// lookups indexed a plain object with it, so a name like `constructor` found Object.prototype's: conformance crashed
// handing a function to filesUnder as its pattern (G-10), and compare built an undeclared language as one with an empty
// extractor, answering a passing not_configured (G-12). And conformance's identity run was parsed without childFailure,
// so an extractor's controlled refusal lost the reason it wrote on stderr and read as invalid-response (G-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR } from './helpers.mjs';

const CLI = path.join(SCRIPTS_DIR, 'code-index.mjs');

// A fake extractor: FAKE_REFUSE in its own source (conformance passes no env through) makes the identity call refuse.
const fake = (refuse) => `
import fs from 'node:fs';
const argv = process.argv.slice(2);
const opt = (k) => argv[argv.indexOf(k) + 1];
if (argv.includes('--identity')) {
  if (${refuse}) { process.stderr.write('fake: needs Python 3.10 or later; this is 3.9\\n'); process.exit(2); }
  process.stdout.write(JSON.stringify({ name: 'fake', version: '1', runtime: 'node', parser: 'none', reads: [],
    modules: { 'fake.mjs': '0'.repeat(64) }, scope_constructs: { File: { opens_scope: true, visible_to_nested: true, binds_in_parent: false } } }));
  process.exit(0);
}
const req = JSON.parse(fs.readFileSync(opt('--request'), 'utf8'));
const span = { start: { line: 1, col: 0 }, end: { line: 1, col: 1 } };
process.stdout.write(JSON.stringify({ code_index_schema: 1, extractor: { name: 'fake', version: '1' },
  files: req.files.map((p) => ({ path: p, status: 'processed' })),
  facts: { definitions: req.files.map((p) => ({ path: p, span, enclosing: 'm', name: 'a', qualified: 'm.a', kind: 'function', signature: '()' })),
    calls: [], constructions: [], literals: [], comparisons: [], imports: [], handlers: [] } }));
`;

function fixtures(t, language, refuse = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-own-language-keys-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  fs.writeFileSync(path.join(dir, 'fake.mjs'), fake(refuse));
  fs.mkdirSync(path.join(dir, 'fx', 'r'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fx', 'r', 'a.x'), 'a\n');
  fs.writeFileSync(path.join(dir, 'fx', 'golden.json'), JSON.stringify({ roots: { [language]: 'r' },
    sweeps: [{ name: 'a exists', language, shape: 'symbol', args: { name: 'm.a' }, outcome: 'complete', expected: [{ path: 'a.x', line: 1 }] }] }));
  return dir;
}

const conformance = (dir, language) => spawnSync(process.execPath, [CLI, 'conformance', '--language', language,
  '--extractor', `node ${path.join(dir, 'fake.mjs').split(path.sep).join('/')}`, '--fixtures', path.join(dir, 'fx')],
{ cwd: dir, encoding: 'utf8', env: (() => { const e = { ...process.env, QUORATE_HOME: path.join(dir, 'home') }; delete e.GRAPH_NODE_DEPTH; return e; })() });

test('G-10: conformance for a language named like an inherited property runs as any untabled language does', (t) => {
  for (const language of ['constructor', 'go']) {
    const r = conformance(fixtures(t, language), language);
    assert.doesNotMatch(r.stderr, /TypeError/, `${language}: ${r.stderr}`);
    assert.equal(r.status, 0, `${language}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /ok {3}a exists: complete, 1 row/, language);
  }
  // The same lookup on golden.json's roots: a sweep for `constructor` with no root of its own is refused, not crashed on.
  const dir = fixtures(t, 'constructor');
  const golden = path.join(dir, 'fx', 'golden.json');
  fs.writeFileSync(golden, JSON.stringify({ ...JSON.parse(fs.readFileSync(golden, 'utf8')), roots: {} }));
  const noRoot = conformance(dir, 'constructor');
  assert.doesNotMatch(noRoot.stderr, /TypeError/, noRoot.stderr);
  assert.equal(noRoot.status, 2, noRoot.stdout + noRoot.stderr);
  assert.match(noRoot.stderr, /no root for constructor/);
});

// scripts/code-index.mjs:380 on the ledger (G-6 of 20261022-194402-pb-remediation-2-review): the sweep filter read
// s.language on every element, so a golden.json whose sweeps held null or a sweep with no string language threw a
// TypeError, and the crash's exit 1 read as a conformance mismatch instead of a malformed fixture.
test('a golden.json sweep that is not an object with a string language is refused, not crashed on', (t) => {
  for (const bad of [null, 7, { name: 'no language', shape: 'symbol' }, { language: 3 }]) {
    const dir = fixtures(t, 'python');
    const golden = path.join(dir, 'fx', 'golden.json');
    const parsed = JSON.parse(fs.readFileSync(golden, 'utf8'));
    fs.writeFileSync(golden, JSON.stringify({ ...parsed, sweeps: [bad, ...parsed.sweeps] }));
    const r = conformance(dir, 'python');
    assert.doesNotMatch(r.stderr, /TypeError/, `${JSON.stringify(bad)}: ${r.stderr}`);
    assert.equal(r.status, 2, `${JSON.stringify(bad)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /sweep 1 .*language/, JSON.stringify(bad));
  }
});

test('G-11: conformance keeps the reason an extractor that refuses its identity call wrote on stderr', (t) => {
  const r = conformance(fixtures(t, 'python', true), 'python');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /extractor_failed/);
  assert.match(r.stdout, /needs Python 3\.10 or later; this is 3\.9/, 'the refusal\'s own reason was lost');
  assert.doesNotMatch(r.stdout, /invalid-response/, 'a refusal was reported as an invalid identity');
});

test('G-12: compare refuses a sweep whose language is not one code_index declares, an inherited name included', (t) => {
  const dir = fixtures(t, 'python');
  const r = path.join(dir, 'repo');
  fs.mkdirSync(path.join(r, 'src'), { recursive: true });
  fs.writeFileSync(path.join(r, 'src', 'a.py'), 'a\n');
  fs.writeFileSync(path.join(r, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: f', 'commands:',
    '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', 'code_index:', '  python:',
    `    extractor: "node ${path.join(dir, 'fake.mjs').split(path.sep).join('/')}"`, '    globs: ["src/**"]',
    'review:', '  models: { judgment: opus }', '  effort: { judgment: low }', '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: r, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@example.invalid'); git('config', 'user.name', 'x'); git('add', '-A'); git('commit', '-qm', 'f');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  for (const language of ['constructor', 'rust']) {
    const answers = path.join(dir, `answers-${language}.json`);
    fs.writeFileSync(answers, JSON.stringify({ pinned_commit: head, sweeps: [{ name: 'n', language, shape: 'symbol', args: { name: 'm.a' },
      outcome: 'not_configured', expected: [], method: 'hand-read' }] }));
    const c = spawnSync(process.execPath, [CLI, 'compare', '--answers', answers, '--repo-root', r], { cwd: r, encoding: 'utf8',
      env: (() => { const e = { ...process.env, QUORATE_HOME: path.join(dir, 'home') }; delete e.GRAPH_NODE_DEPTH; return e; })() });
    assert.equal(c.status, 2, `${language}: an undeclared language was compared: ${c.stdout}${c.stderr}`);
    assert.match(c.stderr, new RegExp(`${language} is not declared in code_index`), language);
  }
});
