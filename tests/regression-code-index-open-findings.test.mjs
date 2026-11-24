// THE OPEN CODE-INDEX FINDINGS, EACH WITH ITS RED (code-index-schema-and-scope.plan.md stages 4 and 5).
//
// The set is the ledger's, not a list written here: `node tests/tools/code-index-open-findings.mjs` prints every open
// entry at MEDIUM or above that a code-index review raised. Each test below names the finding it answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, REPO_ROOT, makeLink } from './helpers.mjs';
import { answer, sweepMatches } from '../scripts/lib/code-index-query.mjs';
import { headMatchesPin } from '../scripts/lib/code-index-cache.mjs';
import { TABLES } from '../scripts/lib/code-index-spec.mjs';
import { SCOPE_TABLES } from '../scripts/lib/scope-constructs.mjs';

const CLI = path.join(SCRIPTS_DIR, 'code-index.mjs');

// A fake extractor whose identity and response are steered by FAKE_MODE (declared in `env`).
const FAKE = String.raw`
import fs from 'node:fs';
const argv = process.argv.slice(2);
const opt = (k) => argv[argv.indexOf(k) + 1];
const mode = process.env.FAKE_MODE ?? '';
const reads = mode === 'no-reads' ? undefined : mode === 'bad-reads' ? ['../outside/**'] : ['cfg/*.json'];
if (argv.includes('--identity')) {
  process.stdout.write(JSON.stringify({ name: 'fake', version: '1', runtime: 'node', parser: 'none', modules: { 'fake.mjs': 'a'.repeat(64) }, ...(reads ? { reads } : {}),
    scope_constructs: ${JSON.stringify(SCOPE_TABLES.python)} }));
  process.exit(0);
}
const req = JSON.parse(fs.readFileSync(opt('--request'), 'utf8'));
const tables = ['definitions', 'calls', 'constructions', 'literals', 'comparisons', 'imports', 'handlers'];
const facts = Object.fromEntries(tables.map((t) => [t, []]));
const files = mode === 'null-file' ? [null, ...req.files.map((p) => ({ path: p, status: 'processed' }))] : req.files.map((p) => ({ path: p, status: 'processed' }));
const extractor = mode === 'lying' ? { name: 'other', version: '9' } : { name: 'fake', version: '1' };
process.stdout.write(JSON.stringify({ code_index_schema: 1, extractor, files, facts }));
`;

function repo(dir, { globs = '["src/**/*.py"]', review = [] } = {}) {
  const r = path.join(dir, 'repo');
  fs.mkdirSync(path.join(r, 'src'), { recursive: true });
  fs.mkdirSync(path.join(r, 'cfg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fake.mjs'), FAKE);
  fs.writeFileSync(path.join(r, 'src', 'a.py'), 'x = 1\n');
  fs.writeFileSync(path.join(r, 'cfg', 'tool.json'), '{"type": "a"}\n');
  fs.writeFileSync(path.join(r, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: oi-fixture',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none',
    'code_index:', '  python:', `    extractor: "node ${path.join(dir, 'fake.mjs').split(path.sep).join('/')}"`, `    globs: ${globs}`,
    '    env: ["FAKE_MODE"]', 'review:', '  models: { judgment: opus }', '  effort: { judgment: low }', ...review, '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: r, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@example.invalid'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'fixture');
  return r;
}

function cli(r, home, args, env = {}) {
  const e = { ...process.env, QUORATE_HOME: home, ...env };
  delete e.GRAPH_NODE_DEPTH;
  const res = spawnSync(process.execPath, [CLI, ...args, '--repo-root', r], { cwd: r, encoding: 'utf8', env: e });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { /* a refusal prints to stderr */ }
  return { ...res, json };
}

const withDir = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-code-index-oi-'));
  try { return fn(dir, path.join(dir, 'home')); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('G-5 of 070113, second half: a file the identity says it reads is part of the key', () => withDir((dir, home) => {
  const r = repo(dir);
  const first = cli(r, home, ['build']).json.languages[0];
  fs.writeFileSync(path.join(r, 'cfg', 'tool.json'), '{"type": "b"}\n');
  const second = cli(r, home, ['build']).json.languages[0];
  assert.notEqual(second.input_hash, first.input_hash, 'a changed configuration file the extractor reads kept the old key');
}));

test('stage 4: a reads glob outside the contract grammar is refused, answering extractor_failed / invalid-response', () => withDir((dir, home) => {
  const r = repo(dir);
  const a = cli(r, home, ['symbol', '--args', '{"name":"m."}'], { FAKE_MODE: 'bad-reads' });
  assert.equal(a.json.outcome, 'extractor_failed');
  assert.equal(a.json.detail, 'invalid-response');
  assert.match(a.json.why, /reads/);
}));

test('G-9 of 070113: conformance refuses an identity that does not declare what it reads', () => withDir((dir) => {
  const fixtures = path.join(dir, 'fx');
  fs.mkdirSync(path.join(fixtures, 'py'), { recursive: true });
  fs.writeFileSync(path.join(fixtures, 'py', 'a.py'), 'x = 1\n');
  fs.writeFileSync(path.join(fixtures, 'golden.json'), JSON.stringify({ roots: { python: 'py' }, sweeps: [
    { name: 's', language: 'python', shape: 'symbol', args: { name: 'nothere.' }, outcome: 'unresolved', expected: [] }] }));
  // conformance gives an extractor only the process basics, so the mode is baked into a second fake rather than passed.
  fs.writeFileSync(path.join(dir, 'fake.mjs'), FAKE);
  fs.writeFileSync(path.join(dir, 'fake-no-reads.mjs'), FAKE.replace("const mode = process.env.FAKE_MODE ?? '';", "const mode = 'no-reads';"));
  const run = (file) => spawnSync(process.execPath, [CLI, 'conformance', '--language', 'python', '--extractor',
    `node ${path.join(dir, file).split(path.sep).join('/')}`, '--fixtures', fixtures], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(run('fake.mjs').status, 0, run('fake.mjs').stdout);
  const bad = run('fake-no-reads.mjs');
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout + bad.stderr, /reads/);
  // G-17 of 20261020-094311-ciss-delivery: conformance validated the response without the identity, so an extractor whose
  // response names other/9 while its identity names fake/1 was certified, though build refuses it.
  fs.writeFileSync(path.join(dir, 'fake-lying.mjs'), FAKE.replace("const mode = process.env.FAKE_MODE ?? '';", "const mode = 'lying';"));
  const lying = run('fake-lying.mjs');
  assert.equal(lying.status, 1, lying.stdout + lying.stderr);
  assert.match(lying.stdout + lying.stderr, /identity call named/);
}));

test('G-16 of 070113: a null file entry is refused, and its request file is removed', () => withDir((dir, home) => {
  const r = repo(dir);
  const a = cli(r, home, ['symbol', '--args', '{"name":"m."}'], { FAKE_MODE: 'null-file' });
  assert.equal(a.json.outcome, 'extractor_failed');
  const reqDir = fs.readdirSync(path.join(home, 'code-index')).map((d) => path.join(home, 'code-index', d, 'requests'));
  for (const d of reqDir) if (fs.existsSync(d)) assert.deepEqual(fs.readdirSync(d), [], 'the refused request file stayed');
}));

test('G-12 of 070113: an entry over the cap is named in the answer, fresh or from the cache', () => withDir((dir, home) => {
  const r = repo(dir, { review: ['  code_index_cache_max_mb: 0.000001'] });
  for (let i = 0; i < 2; i++) {
    const a = cli(r, home, ['symbol', '--args', '{"name":"m."}']);
    assert.ok(a.json.not_checked.some((n) => /exceeds review\.code_index_cache_max_mb/.test(n)), `run ${i}: the over-cap entry was not named`);
  }
}));

test('G-10 of 070113: a cache hit is counted toward the cap, so an older entry is evicted on a hit', () => withDir((dir, home) => {
  const r = repo(dir, { review: ['  code_index_cache_max_mb: 0.01'] });
  cli(r, home, ['build']);
  const idx = fs.readdirSync(path.join(home, 'code-index')).map((d) => path.join(home, 'code-index', d))[0];
  const entries = () => fs.readdirSync(idx).filter((n) => n.endsWith('.json'));
  const older = entries()[0];
  fs.writeFileSync(path.join(r, 'src', 'a.py'), 'x = 2\n');
  cli(r, home, ['build']);
  assert.equal(entries().length, 2, 'the setup needs two entries under a 10 KB cap');
  // Grow the older entry past the cap, then ask again: the answer is a hit on the newer one, and that hit must
  // enforce the cap, evicting the older entry.
  fs.appendFileSync(path.join(idx, older), ' '.repeat(20000));
  const hit = cli(r, home, ['build']).json.languages[0];
  assert.equal(hit.cached, true, 'the third build was not a cache hit');
  assert.deepEqual(entries().filter((n) => n === older), [], 'a hit left an entry over the cap');
}));

test('G-10 of 043006: the CLI refuses a code_index glob outside the contract grammar', () => withDir((dir, home) => {
  const r = repo(dir, { globs: '["../outside/**"]' });
  const a = cli(r, home, ['build']);
  assert.equal(a.status, 2, a.stdout + a.stderr);
  assert.match(a.stderr, /code_index\.python\.globs/);
}));

test('G-13 of 061457: the CLI registers each extractor child with the stop-on-exit owner', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.match(src, /stopHeldOnExit\(\{/, 'code-index.mjs installs no stop-on-exit owner');
  assert.match(src, /onSpawn: \(child\) =>/, 'runExtractor does not register its child');
});

const span = { start: { line: 1, col: 0 }, end: { line: 1, col: 1 } };
const empty = () => Object.fromEntries(TABLES.map((t) => [t, []]));

test('G-31 of 043006 / G-37 of 061457: an unresolved target with a file that failed to parse answers parse_error, naming it', () => {
  const files = [{ path: 'a.py', status: 'processed' }, { path: 'b.py', status: 'not_processed', outcome: 'parse_error', reason: 'SyntaxError at line 1' }];
  const r = answer('calls', { callee: 'm.nothere' }, { facts: empty(), files });
  assert.equal(r.outcome, 'parse_error');
  assert.ok(r.not_checked.some((n) => /b\.py/.test(n)));
  const resolved = answer('calls', { callee: 'm.nothere' }, { facts: empty(), files: [files[0]] });
  assert.equal(resolved.outcome, 'unresolved', 'with every file parsed, an unresolvable target stays unresolved');
});

test('the HIGH at scripts/code-index.mjs:330 (G-19 of 043006, G-11 of 051530): the pinned-commit decision is pure, and refuses an empty, failed or longer HEAD', () => {
  const head = 'a'.repeat(40);
  assert.equal(headMatchesPin({ status: 0, stdout: `${head}\n` }, head).ok, true);
  assert.equal(headMatchesPin({ status: 0, stdout: `${head}\n` }, head.slice(0, 12)).ok, true, 'an abbreviated pin was refused');
  assert.equal(headMatchesPin({ status: 128, stdout: '' }, head.slice(0, 12)).ok, false, 'a failed git read matched');
  assert.equal(headMatchesPin({ status: 0, stdout: '' }, head.slice(0, 12)).ok, false, 'an empty HEAD matched');
  assert.equal(headMatchesPin({ status: 0, stdout: `${head}\n` }, `${head}ff`).ok, false, 'a pin longer than HEAD matched');
  assert.doesNotMatch(fs.readFileSync(CLI, 'utf8'), /startsWith\(file\.pinned_commit\)/, 'the decision is still in the I/O layer');
});

test('scripts/lib/code-index-query.mjs:90: matching keys rows by path and line, so the cost is not cubic', () => {
  const n = 300;
  let reads = 0;
  const rows = Array.from({ length: n }, (_, i) => {
    const r = { span: { start: { line: n - i, col: 0 }, end: { line: n - i, col: 1 } } };
    Object.defineProperty(r, 'path', { get: () => { reads++; return 'one.py'; }, enumerable: true });
    return r;
  });
  const expected = Array.from({ length: n }, (_, i) => ({ path: 'one.py', line: i + 1 }));
  const m = sweepMatches({ outcome: 'complete', rows }, { outcome: 'complete', expected });
  assert.ok(m.ok, JSON.stringify(m.missing.slice(0, 3)));
  assert.ok(reads <= 4 * n, `one path across ${n} lines read a row's path ${reads} times`);
});

test('shared/code-index.md:10: the page points at A-27 rather than restating it', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'code-index.md'), 'utf8');
  assert.doesNotMatch(doc, /quorate's engine never imports an extractor: it runs one as a command\./, 'the page still restates A-27');
  assert.match(doc, /ARCHITECTURE(\.md)? A-27/);
});

test('G-11 of 043006 / G-12 of 061457: a manifest path whose real path is outside the repository is not handed to the extractor', (t) => withDir((dir, home) => {
  const r = repo(dir);
  const outside = path.join(dir, 'outside.py');
  fs.writeFileSync(outside, 'secret = 1\n');
  const link = makeLink(t, { target: outside, at: path.join(r, 'src', 'link.py'), type: 'file' });
  if (!link) { t.skip('this platform cannot make a symlink here; the red and green run on Linux (plan stage 5)'); return; }
  spawnSync('git', ['add', '-A'], { cwd: r });
  const b = cli(r, home, ['build']).json.languages[0];
  assert.ok(b.not_processed.includes('src/link.py'), `the symlink to ${outside} was handed to the extractor`);
}));

test('G-5 of 070113, first half: a .js file under a malformed package.json is reported, never parsed as CommonJS', { skip: process.env.QUORATE_ACORN_DIR ? false : 'no acorn: set QUORATE_ACORN_DIR' }, () => withDir((dir) => {
  const acorn = path.join(process.env.QUORATE_ACORN_DIR, 'node_modules', 'acorn');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.cpSync(acorn, path.join(dir, 'node_modules', 'acorn'), { recursive: true });
  // In a subdirectory: a malformed package.json at the root also stops Node resolving acorn from there.
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'package.json'), '{ "type": "module", ');
  fs.writeFileSync(path.join(dir, 'sub', 'a.js'), 'export const x = 1;\n');
  const req = path.join(dir, 'request.json');
  fs.writeFileSync(req, JSON.stringify({ code_index_request: 1, language: 'javascript', root: dir, files: ['sub/a.js'], options: {} }));
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'extractors', 'javascript', 'extract.mjs'), '--language', 'javascript', '--request', req], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const f = JSON.parse(r.stdout).files[0];
  assert.equal(f.status, 'not_processed');
  assert.match(f.reason, /package\.json cannot be parsed/);
}));
