// THE CODE INDEX CLI, END TO END (code-index.plan.md stages 6 and 7).
//
// Each test builds a throwaway git repository with a contract and drives scripts/code-index.mjs, with QUORATE_HOME
// pointed at a temporary directory, so the cache it writes is inspectable and nothing reaches the operator's home.
//
// A fake extractor stands in for the real ones, because what is under test here is the engine: how it runs an
// extractor and what it trusts. The real extractors have their own conformance tests. The fake's behaviour is steered by
// FAKE_MODE, which reaches it only because the contract declares it in `env`, the one way a variable gets through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR, REPO_ROOT } from './helpers.mjs';
import { SCOPE_TABLES } from '../scripts/lib/scope-constructs.mjs';

const CLI = path.join(SCRIPTS_DIR, 'code-index.mjs');

const FAKE = String.raw`
import fs from 'node:fs';
import path from 'node:path';
const argv = process.argv.slice(2);
const opt = (k) => argv[argv.indexOf(k) + 1];
const mode = process.env.FAKE_MODE ?? '';
if (process.env.FAKE_ENV_OUT) fs.writeFileSync(process.env.FAKE_ENV_OUT, JSON.stringify(Object.keys(process.env)));
const parserFile = path.join(path.dirname(process.argv[1]), 'parser.txt');
const extractedFlag = path.join(path.dirname(process.argv[1]), 'extracted.flag');
if (argv.includes('--identity') && mode === 'fail-identity-after' && fs.existsSync(extractedFlag)) process.exit(3);
if (argv.includes('--identity')) {
  const parser = fs.existsSync(parserFile) ? fs.readFileSync(parserFile, 'utf8') : process.env.FAKE_PARSER ?? 'none';
  process.stdout.write(JSON.stringify({ name: 'fake', version: '1', runtime: 'node', parser, modules: { 'fake.mjs': '0'.repeat(64) },
    scope_constructs: ${JSON.stringify(SCOPE_TABLES.python)} }));
  process.exit(0);
}
if (mode === 'mutate-named') fs.appendFileSync(process.argv[1], '\n// moved\n');
if (mode === 'mutate-identity') fs.writeFileSync(parserFile, 'upgraded');
if (mode === 'exit3') process.exit(3);
if (mode === 'garbage') { process.stdout.write('not json'); process.exit(0); }
if (mode === 'sleep') { setTimeout(() => {}, 60000); }
else {
  const req = JSON.parse(fs.readFileSync(opt('--request'), 'utf8'));
  if (mode === 'mutate') fs.appendFileSync(path.join(req.root, req.files[0]), '\n# moved\n');
  if (mode === 'fail-identity-after') fs.writeFileSync(extractedFlag, '');
  if (process.env.FAKE_COUNT_OUT) fs.writeFileSync(process.env.FAKE_COUNT_OUT, String(req.files.length));
  const span = { start: { line: 1, col: 0 }, end: { line: 1, col: 1 } };
  process.stdout.write(JSON.stringify({ code_index_schema: 1, extractor: { name: 'fake', version: '1' },
    files: req.files.map((p) => ({ path: p, status: 'processed' })),
    facts: { definitions: req.files.map((p) => ({ path: p, span, enclosing: 'm', name: 'f', qualified: 'm.' + path.basename(p, '.py'), kind: 'function', signature: '()' })),
      calls: [], constructions: [], literals: [], comparisons: [], imports: [], handlers: [] } }));
}
`;

function repo(dir, { codeIndex, review = [] }) {
  const r = path.join(dir, 'repo');
  fs.mkdirSync(path.join(r, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fake.mjs'), FAKE);
  fs.writeFileSync(path.join(r, 'src', 'a.py'), 'def a():\n    return 1\n');
  fs.writeFileSync(path.join(r, 'src', 'b.py'), 'def b():\n    return 2\n');
  fs.writeFileSync(path.join(r, 'CLAUDE.md'), ['# fixture', '', '```yaml', 'graph_contract_version: 6', 'project: ci-fixture',
    'commands:', '  build: ""', '  test: ""', 'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none',
    ...codeIndex, 'review:', '  models: { judgment: opus }', '  effort: { judgment: low }', ...review, '```', ''].join('\n'));
  const git = (...a) => spawnSync('git', a, { cwd: r, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'x@example.invalid'); git('config', 'user.name', 'x');
  git('add', '-A'); git('commit', '-qm', 'fixture');
  return r;
}

const fakeBlock = (dir, env = '["FAKE_MODE", "FAKE_ENV_OUT", "FAKE_COUNT_OUT", "FAKE_PARSER"]') => ['code_index:', '  python:',
  `    extractor: "node ${path.join(dir, 'fake.mjs').split(path.sep).join('/')}"`, '    globs: ["src/**/*.py"]', `    env: ${env}`];

function cli(r, home, args, env = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args, '--repo-root', r], {
    cwd: r, encoding: 'utf8', env: (() => { const e = { ...process.env, QUORATE_HOME: home, ...env }; delete e.GRAPH_NODE_DEPTH; return e; })(),
  });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { /* a refusal prints to stderr */ }
  return { ...res, json };
}

const withDir = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-code-index-cli-'));
  try { return fn(dir, path.join(dir, 'home')); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('absent code_index refuses; {} and an empty extractor answer not_configured', () => withDir((dir, home) => {
  const off = repo(path.join(dir, 'off'), { codeIndex: [] });
  const r1 = cli(off, home, ['symbol', '--args', '{"name":"m.a"}']);
  assert.equal(r1.status, 2);
  assert.match(r1.stderr, /code_index is not declared/);
  fs.mkdirSync(path.join(dir, 'none'));
  const none = repo(path.join(dir, 'none'), { codeIndex: ['code_index: {}'] });
  const r2 = cli(none, home, ['symbol', '--args', '{"name":"m.a"}']);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(r2.json.outcome, 'not_configured');
  fs.mkdirSync(path.join(dir, 'empty'));
  const empty = repo(path.join(dir, 'empty'), { codeIndex: ['code_index:', '  python:', '    extractor: ""', '    globs: ["src/**/*.py"]'] });
  const r3 = cli(empty, home, ['symbol', '--args', '{"name":"m.a"}']);
  assert.equal(r3.json.outcome, 'not_configured');
}));

test('an answer carries its identity and stamp; the cache is under the home, and nothing is written in the repository', () => withDir((dir, home) => {
  const r = repo(dir, { codeIndex: fakeBlock(dir) });
  const a = cli(r, home, ['symbol', '--args', '{"name":"m.a"}']);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.json.outcome, 'complete');
  assert.equal(a.json.rows.length, 1);
  assert.equal(a.json.extractors[0].name, 'fake');
  assert.match(a.json.framework.commit, /\S/);
  assert.match(a.json.input_hash, /^[0-9a-f]{64}$/);
  assert.ok(a.json.not_checked.some((n) => /network/.test(n)), 'the unconstrained network access is not named');
  const entries = fs.readdirSync(path.join(home, 'code-index')).flatMap((d) => fs.readdirSync(path.join(home, 'code-index', d)));
  assert.ok(entries.some((n) => n === `${a.json.input_hash}.json`), 'no cache entry under the home');
  const status = spawnSync('git', ['status', '--porcelain', '--ignored'], { cwd: r, encoding: 'utf8' }).stdout.trim();
  assert.equal(status, '', `the CLI wrote into the repository:\n${status}`);
  const again = cli(r, home, ['build']);
  assert.equal(again.json.languages[0].cached, true, 'an unchanged tree was extracted again');
}));

test('a changed file, or a changed parser identity, is a new key: the old facts are not read', () => withDir((dir, home) => {
  const r = repo(dir, { codeIndex: fakeBlock(dir) });
  const first = cli(r, home, ['build']).json.languages[0];
  fs.appendFileSync(path.join(r, 'src', 'b.py'), '# edited\n');
  const second = cli(r, home, ['build']).json.languages[0];
  assert.equal(second.cached, false);
  assert.notEqual(second.input_hash, first.input_hash);
  const third = cli(r, home, ['build'], { FAKE_PARSER: 'v2' }).json.languages[0];
  assert.notEqual(third.input_hash, second.input_hash, 'a parser upgrade kept the old key');
}));

test('a failing, garbled or hung extractor answers extractor_failed with its process outcome', () => withDir((dir, home) => {
  const r = repo(dir, { codeIndex: fakeBlock(dir), review: ['  code_index_timeout_minutes: 0.03'] });
  for (const [mode, detail] of [['exit3', 'failed'], ['garbage', 'invalid-response'], ['sleep', 'timed-out']]) {
    const a = cli(r, home, ['symbol', '--args', '{"name":"m.a"}'], { FAKE_MODE: mode });
    assert.equal(a.status, 0, a.stderr);
    assert.equal(a.json.outcome, 'extractor_failed', mode);
    assert.equal(a.json.detail, detail, mode);
  }
  // G-13 of 20261020-043006-code-index-delivery: a failed extraction left its requests/<key>.json behind, outside the
  // cache cap, so repeated failures grew the home without bound.
  const requests = fs.readdirSync(path.join(home, 'code-index')).flatMap((d) => {
    const q = path.join(home, 'code-index', d, 'requests');
    return fs.existsSync(q) ? fs.readdirSync(q) : [];
  });
  assert.deepEqual(requests, [], 'a failed extraction left its request file behind');
}));

test('an extractor sees only the process basics and its declared env: no credential, git identity or QUORATE_HOME', () => withDir((dir, home) => {
  const r = repo(dir, { codeIndex: fakeBlock(dir) });
  const out = path.join(dir, 'env.json');
  cli(r, home, ['build'], { FAKE_ENV_OUT: out, ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't', GIT_AUTHOR_EMAIL: 'e@example.invalid', SOME_OTHER: 'x' });
  const keys = JSON.parse(fs.readFileSync(out, 'utf8'));
  for (const k of keys) assert.ok(!/^(ANTHROPIC_|CLAUDE_CODE_|GIT_AUTHOR|QUORATE_HOME$|SOME_OTHER$)/i.test(k), `${k} reached the extractor`);
  assert.ok(keys.includes('FAKE_ENV_OUT'), 'a declared env name did not reach the extractor');
}));

test('an input that moves while the answer is computed is refused, not answered', () => withDir((dir, home) => {
  const r = repo(dir, { codeIndex: fakeBlock(dir) });
  const a = cli(r, home, ['symbol', '--args', '{"name":"m.a"}'], { FAKE_MODE: 'mutate' });
  assert.equal(a.status, 4, a.stdout + a.stderr);
  assert.match(a.stderr, /inputs changed/);
}));

// G-8 of 20261020-051530-code-index-remediation-review: the re-hash after reading covered the manifest alone, so a file
// the command names, or the extractor's identity, could move during extraction and the answer was still printed.
test('a named file or an extractor identity that moves while the answer is computed is refused, not answered', () => withDir((dir, home) => {
  const r = repo(dir, { codeIndex: fakeBlock(dir) });
  for (const mode of ['mutate-named', 'mutate-identity']) {
    const a = cli(r, home, ['symbol', '--args', '{"name":"m.a"}'], { FAKE_MODE: mode });
    assert.equal(a.status, 4, `${mode}: ${a.stdout}${a.stderr}`);
    assert.match(a.stderr, /inputs changed/, mode);
  }
}));

// scripts/code-index.mjs:340 on the ledger (G-6 of 20261022-230755-ciss-d1-4-remediation-review): the re-hash after
// reading compared now.key without looking at now.failure, so an extractor whose second --identity call failed was
// reported as moved inputs (exit 4, "ask again") instead of as the extractor failure it was.
test('an extractor that fails the re-check after answering is reported as failed, not as moved inputs', () => withDir((dir, home) => {
  const r = repo(dir, { codeIndex: fakeBlock(dir) });
  const a = cli(r, home, ['symbol', '--args', '{"name":"m.a"}'], { FAKE_MODE: 'fail-identity-after' });
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.doesNotMatch(a.stderr, /inputs changed/);
  assert.equal(a.json.outcome, 'extractor_failed');
  assert.equal(a.json.detail, 'failed');
}));

// G-3 of 20261020-051530-code-index-remediation-review: a cache hit returned the stored response without the validation a
// fresh one passes, so an entry written before the validator was strengthened was trusted and crashed the answer.
test('a cached entry the validator now refuses is extracted again, not answered from', () => withDir((dir, home) => {
  const r = repo(dir, { codeIndex: fakeBlock(dir) });
  const first = cli(r, home, ['build']).json.languages[0];
  const idx = path.join(home, 'code-index', fs.readdirSync(path.join(home, 'code-index'))[0]);
  const entryFile = path.join(idx, `${first.input_hash}.json`);
  const entry = JSON.parse(fs.readFileSync(entryFile, 'utf8'));
  delete entry.response.files;
  fs.writeFileSync(entryFile, JSON.stringify(entry));
  const again = cli(r, home, ['build']);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.json.languages[0].cached, false, 'a malformed cached entry was trusted');
  const a = cli(r, home, ['symbol', '--args', '{"name":"m.a"}']);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.json.outcome, 'complete');
}));

// G-5 of 20261020-051530-code-index-remediation-review: eviction summed the entries alone, while each kept entry's
// requests/<key>.json stays beside it, so the cache could sit above code_index_cache_max_mb with nothing evicted.
test('the cache cap counts each entry\'s request file, evicting the oldest entry with it', () => withDir((dir, home) => {
  const r = repo(dir, { codeIndex: fakeBlock(dir), review: ['  code_index_cache_max_mb: ""'] });
  const keys = [];
  keys.push(cli(r, home, ['build']).json.languages[0].input_hash);
  fs.appendFileSync(path.join(r, 'src', 'b.py'), '# 1\n');
  keys.push(cli(r, home, ['build']).json.languages[0].input_hash);
  const idx = path.join(home, 'code-index', fs.readdirSync(path.join(home, 'code-index'))[0]);
  const size = (...p) => fs.statSync(path.join(idx, ...p)).size;
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(idx, `${keys[0]}.json`), old, old);
  // A third entry is the size of the second. The cap holds all three entries, and not all three with their requests.
  const entries = size(`${keys[0]}.json`) + 2 * size(`${keys[1]}.json`);
  const requests = size('requests', `${keys[0]}.json`) + 2 * size('requests', `${keys[1]}.json`);
  const capMb = ((entries + requests / 2) / (1024 * 1024)).toFixed(12);
  const claude = path.join(r, 'CLAUDE.md');
  fs.writeFileSync(claude, fs.readFileSync(claude, 'utf8').replace('code_index_cache_max_mb: ""', `code_index_cache_max_mb: ${capMb}`));
  fs.appendFileSync(path.join(r, 'src', 'b.py'), '# 2\n');
  const third = cli(r, home, ['build']);
  assert.equal(third.status, 0, third.stderr);
  assert.ok(!fs.existsSync(path.join(idx, `${keys[0]}.json`)), 'the cache is over its cap and the oldest entry was kept');
  assert.ok(!fs.existsSync(path.join(idx, 'requests', `${keys[0]}.json`)), 'the evicted entry left its request behind');
  assert.ok(fs.existsSync(path.join(idx, `${keys[1]}.json`)), 'a newer entry that fits was evicted');
}));

test('a request naming more files than a Windows command line could carry is processed whole', () => withDir((dir, home) => {
  const r = repo(dir, { codeIndex: fakeBlock(dir) });
  const long = 'x'.repeat(90);
  for (let i = 0; i < 400; i++) fs.writeFileSync(path.join(r, 'src', `${long}_${i}.py`), '\n');
  const count = path.join(dir, 'count.txt');
  const b = cli(r, home, ['build'], { FAKE_COUNT_OUT: count });
  assert.equal(b.status, 0, b.stderr);
  assert.equal(Number(fs.readFileSync(count, 'utf8')), 402, 'the extractor was not given every file');
}));

test('ask records an unaskable question, unsupported counts them, and the log keeps its newest 1,000', () => withDir((dir, home) => {
  const r = repo(dir, { codeIndex: fakeBlock(dir) });
  const a = cli(r, home, ['ask', '--needs', 'decorators', 'which handlers are decorated?']);
  assert.equal(a.json.outcome, 'unsupported');
  const log = a.json.recorded_in;
  // The home as the filesystem spells it, as the engine reports it (long where TEMP is an 8.3 short path, CI run 43281517496).
  assert.ok(path.resolve(log).startsWith(fs.realpathSync.native(home)), 'the log is not under the home');
  fs.writeFileSync(log, `${Array.from({ length: 1000 }, () => JSON.stringify({ needs: 'old' })).join('\n')}\n`);
  cli(r, home, ['ask', '--needs', 'decorators', 'again']);
  const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 1000);
  const u = cli(r, home, ['unsupported']).json;
  assert.equal(u.by_needs.decorators, 1);
  assert.equal(u.by_needs.old, 999);
  assert.equal(cli(r, home, ['grep']).status, 2, 'an unknown command must be refused, not recorded');
}));

test('compare refuses an answer file with no method or the wrong commit, and matches one that holds', () => withDir((dir, home) => {
  const r = repo(dir, { codeIndex: fakeBlock(dir) });
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: r, encoding: 'utf8' }).stdout.trim();
  const write = (obj) => { const f = path.join(dir, `answers-${Math.random()}.json`); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
  const sweep = { name: 'a exists', shape: 'symbol', args: { name: 'm.a' }, expected: [{ path: 'src/a.py', line: 1 }], method: 'hand-read of src/a.py' };
  const noMethod = cli(r, home, ['compare', '--answers', write({ pinned_commit: head, sweeps: [{ ...sweep, method: '' }] })]);
  assert.equal(noMethod.status, 2);
  assert.match(noMethod.stderr, /no method/);
  const wrong = cli(r, home, ['compare', '--answers', write({ pinned_commit: 'a'.repeat(40), sweeps: [sweep] })]);
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /pinned_commit/);
  const ok = cli(r, home, ['compare', '--answers', write({ pinned_commit: head, sweeps: [sweep] })]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const differs = cli(r, home, ['compare', '--answers', write({ pinned_commit: head, sweeps: [{ ...sweep, expected: [] }] })]);
  assert.equal(differs.status, 1);
  assert.match(differs.stdout, /DIFFERS/);
  const abbreviated = cli(r, home, ['compare', '--answers', write({ pinned_commit: head.slice(0, 12), sweeps: [sweep] })]);
  assert.equal(abbreviated.status, 0, `an abbreviated HEAD is the same commit: ${abbreviated.stderr}`);
  // G-19 of 20261020-043006-code-index-delivery: the guard accepted either string as a prefix of the other, so HEAD plus
  // extra hex passed, and a failed `git rev-parse` left HEAD '' (a prefix of everything), so compare ran against a
  // commit nobody confirmed (I-16). In this test rather than a new one: the suite's test count is a stated fact.
  const longer = cli(r, home, ['compare', '--answers', write({ pinned_commit: `${head}abc`, sweeps: [sweep] })]);
  assert.equal(longer.status, 2, `HEAD plus extra hex was accepted: ${longer.stdout}`);
  assert.match(longer.stderr, /pinned_commit/);
  // G-10 of 20261022-200543-ciss-d1-review-2: HEAD equal to the pin says nothing about the bytes the build reads, which
  // are the working tree's. An edited tracked file, or an untracked one, is not the pinned commit, so compare refuses.
  fs.writeFileSync(path.join(r, 'src', 'a.py'), 'x = 2\n');
  const edited = cli(r, home, ['compare', '--answers', write({ pinned_commit: head, sweeps: [sweep] })]);
  assert.equal(edited.status, 2, `an edited working tree was compared as the pinned commit: ${edited.stdout}`);
  assert.match(edited.stderr, /working tree/);
  spawnSync('git', ['checkout', '--', 'src/a.py'], { cwd: r, encoding: 'utf8' });
  fs.writeFileSync(path.join(r, 'src', 'new.py'), 'y = 1\n');
  const untracked = cli(r, home, ['compare', '--answers', write({ pinned_commit: head, sweeps: [sweep] })]);
  assert.equal(untracked.status, 2, `an untracked file was compared as the pinned commit: ${untracked.stdout}`);
  assert.match(untracked.stderr, /src\/new\.py/);
  fs.rmSync(path.join(r, 'src', 'new.py'));
  fs.rmSync(path.join(r, '.git'), { recursive: true, force: true });
  const noGit = cli(r, home, ['compare', '--answers', write({ pinned_commit: head, sweeps: [sweep] })], { GIT_CEILING_DIRECTORIES: dir });
  assert.equal(noGit.status, 2, `a HEAD git could not read was accepted: ${noGit.stdout}`);
  assert.match(noGit.stderr, /HEAD is unknown/);
}));

test('conformance passes the reference Python extractor and fails one that drops a shape', { skip: !['python3', 'python'].some((p) => spawnSync(p, ['--version']).status === 0) && 'no Python on PATH' }, () => withDir((dir) => {
  const py = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);
  const fixtures = path.join(REPO_ROOT, 'tests', 'fixtures', 'code-index');
  const run = (extractor) => spawnSync(process.execPath, [CLI, 'conformance', '--language', 'python', '--extractor', extractor,
    '--fixtures', fixtures], { cwd: REPO_ROOT, encoding: 'utf8' });
  const good = run(`${py} ${path.join(REPO_ROOT, 'extractors', 'python', 'extract.py').split(path.sep).join('/')}`);
  assert.equal(good.status, 0, good.stdout + good.stderr);
  const dropper = path.join(dir, 'drop.py');
  fs.writeFileSync(dropper, [
    'import json, runpy, sys, io, contextlib',
    `real = ${JSON.stringify(path.join(REPO_ROOT, 'extractors', 'python', 'extract.py'))}`,
    'buf = io.StringIO()',
    'sys.argv = [real] + sys.argv[1:]',
    'with contextlib.redirect_stdout(buf):',
    '    try:',
    '        runpy.run_path(real, run_name="__main__")',
    '    except SystemExit:',
    '        pass',
    'out = json.loads(buf.getvalue())',
    'if "facts" in out: out["facts"]["handlers"] = []',
    'print(json.dumps(out))',
  ].join('\n'));
  const bad = run(`${py} ${dropper.split(path.sep).join('/')}`);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /FAIL a bare `except Exception`/, 'dropping the handlers table did not fail the handler sweep');
}));
