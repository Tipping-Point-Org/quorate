// The test-selection bench's harness (bench/test-selection) refuses what it cannot do and reports what node:test reports.
//
// G-1 of 20261107-061412-split-delivery-2: full-run.mjs read `git ls-files`'s stdout with no check of its status, so a
// failed enumeration became an empty file list and a "successful" zero-test baseline.
// G-8 (and its symptom G-10): run-named.mjs failed the run on every `test:fail`, and test-names-reporter.mjs recorded
// every failure as `fail`, even for a test declared `todo`, which node:test counts as no failure.
// G-4 and G-7: measure-names.mjs and run-named.mjs parsed their own command lines, so a missing value or an unknown flag
// passed, or failed on something other than the flag; both now go through scripts/lib/argv.mjs's parseArgv.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './helpers.mjs';

const BENCH = path.join(REPO_ROOT, 'bench', 'test-selection');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-ts-harness-'));
const { NODE_TEST_CONTEXT, ...childEnv } = process.env;
const node = (args, cwd) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: childEnv, timeout: 120_000 });

test('G-1: full-run.mjs refuses a test list git could not enumerate, rather than running zero tests', async () => {
  const dir = tmp();
  try {
    const { fullRunner } = await import(pathToFileURL(path.join(BENCH, 'full-run.mjs')).href);
    // Not a git repository: `git ls-files` exits non-zero with nothing on stdout.
    assert.throws(() => fullRunner(dir, process.execPath), /git ls-files/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-8 and G-10: a failing todo test fails neither run-named.mjs nor its name record; a real failure still does', () => {
  const dir = tmp();
  try {
    const todo = path.join(dir, 'todo.test.mjs');
    fs.writeFileSync(todo, "import { test } from 'node:test';\ntest('later', { todo: true }, () => { throw new Error('not yet'); });\n");
    const list = path.join(dir, 'files.txt');
    fs.writeFileSync(list, `${todo}\n`);
    const names = path.join(dir, 'names.txt');
    const reporter = pathToFileURL(path.join(BENCH, 'test-names-reporter.mjs')).href;
    const r = node([path.join(BENCH, 'run-named.mjs'), '--files-from', list,
      '--reporter', reporter, '--reporter-destination', names], dir);
    assert.equal(r.status, 0, `a failing todo test failed the run: ${r.stderr}`);
    assert.equal(fs.readFileSync(names, 'utf8'), 'later\ttodo\n');

    const bad = path.join(dir, 'bad.test.mjs');
    fs.writeFileSync(bad, "import { test } from 'node:test';\ntest('broken', () => { throw new Error('no'); });\n");
    fs.writeFileSync(list, `${bad}\n`);
    const f = node([path.join(BENCH, 'run-named.mjs'), '--files-from', list], dir);
    assert.equal(f.status, 1, 'a real failure did not fail the run');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-7: run-named.mjs refuses a missing value, an unknown flag and an unpaired reporter, naming the flag', () => {
  const dir = tmp();
  try {
    const run = (...args) => node([path.join(BENCH, 'run-named.mjs'), ...args], dir);
    const missing = run('--files-from');
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /--files-from/);
    const list = path.join(dir, 'files.txt');
    fs.writeFileSync(list, '');
    const unknown = run('--files-from', list, '--bogus', 'x');
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /--bogus/);
    const unpaired = run('--files-from', list, '--reporter', 'dot');
    assert.notEqual(unpaired.status, 0);
    assert.match(unpaired.stderr, /--reporter-destination/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A throwaway isolated clone of the harness's shape: the files runTests runs from the repository it is given, a git index
// naming `tests`, and the marker guard.mjs requires. 20261107-072037-split-delivery-3: G-6, G-7, G-2, G-3, G-1, G-8.
function fixtureRepo(tests) {
  const dir = tmp();
  for (const rel of ['bench/test-selection/run-named.mjs', 'bench/test-selection/test-names-reporter.mjs',
    'bench/test-selection/test-outcome.mjs',
    'tests/tools/suite-file-reporter.mjs', 'scripts/lib/argv.mjs']) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), path.join(dir, rel));
  }
  for (const [name, body] of Object.entries(tests)) fs.writeFileSync(path.join(dir, 'tests', name), body);
  fs.writeFileSync(path.join(dir, '.ts-isolated'), '');
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  return dir;
}
const strays = (dir) => fs.readdirSync(dir).filter((f) => /^\.ts-(full|files|records|names)-/.test(f));

test('G-6: measure-names.mjs writes no names snapshot from a run with a failing file, and exits non-zero', () => {
  const dir = fixtureRepo({ 'bad.test.mjs': "import { test } from 'node:test';\ntest('broken', () => { throw new Error('no'); });\n" });
  try {
    const out = path.join(dir, 'names.json');
    const r = node([path.join(BENCH, 'measure-names.mjs'), '--repo', dir, '--out', out], dir);
    assert.notEqual(r.status, 0, `a failing run was recorded as a complete name set: ${r.stdout}${r.stderr}`);
    assert.equal(fs.existsSync(out), false, 'a names snapshot was written from a failing run');
    assert.match(r.stderr, /fail/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-7: run-named.mjs refuses an empty or blank list file rather than passing a run of zero tests', () => {
  const dir = tmp();
  try {
    const list = path.join(dir, 'files.txt');
    for (const body of ['', '\n\n  \n']) {
      fs.writeFileSync(list, body);
      const r = node([path.join(BENCH, 'run-named.mjs'), '--files-from', list], dir);
      assert.notEqual(r.status, 0, `an empty list passed as a run of zero tests (${JSON.stringify(body)})`);
      assert.match(r.stderr, /no test files/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G-2: full-run.mjs refuses a git enumeration that lists no test files, and runTests refuses an empty list', async () => {
  const { fullRunner } = await import(pathToFileURL(path.join(BENCH, 'full-run.mjs')).href);
  const empty = fixtureRepo({});
  const one = fixtureRepo({ 'ok.test.mjs': "import { test } from 'node:test';\ntest('fine', () => {});\n" });
  try {
    assert.throws(() => fullRunner(empty, process.execPath), /no test files/);
    const { runTests } = fullRunner(one, process.execPath);
    assert.throws(() => runTests([]), /no test files/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true }); fs.rmSync(one, { recursive: true, force: true });
  }
});

test('G-3 and its symptom G-5: runTests removes its temporary files when it throws', async () => {
  const { fullRunner } = await import(pathToFileURL(path.join(BENCH, 'full-run.mjs')).href);
  // A test that writes into CLAUDE_CONFIG_DIR is the leak runTests stops on, by throwing.
  const dir = fixtureRepo({ 'leak.test.mjs': "import { test } from 'node:test';\nimport fs from 'node:fs';\nimport path from 'node:path';\n"
    + "test('leak', () => { fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'x.json'), '{}'); });\n" });
  try {
    const { runTests } = fullRunner(dir, process.execPath);
    assert.throws(() => runTests(null), /real Claude CLI/);
    assert.deepEqual(strays(dir), [], 'runTests left its temporary files behind after throwing');
    const src = fs.readFileSync(path.join(BENCH, 'full-run.mjs'), 'utf8');
    const recorded = src.slice(src.indexOf('function recordedRun'));
    assert.match(recorded, /finally\s*\{[^}]*rmSync\(dir/, 'recordedRun does not remove its records directory in a finally');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The other bench/test-selection scripts that spawn git directly predate this change and are ledgered, not held here.
test('G-1: full-run.mjs starts git only through scripts/io/git.mjs', () => {
  const src = fs.readFileSync(path.join(BENCH, 'full-run.mjs'), 'utf8');
  assert.doesNotMatch(src, /spawn(Sync)?\(\s*['"]git['"]/, 'full-run.mjs spawns git directly');
  assert.match(src, /import \{ gitSync \} from '\.\.\/\.\.\/scripts\/io\/git\.mjs'/);
});

test('G-8: the todo-before-fail rule has one owner, which run-named.mjs and the names reporter both use', () => {
  const runNamed = fs.readFileSync(path.join(BENCH, 'run-named.mjs'), 'utf8');
  const reporter = fs.readFileSync(path.join(BENCH, 'test-names-reporter.mjs'), 'utf8');
  for (const [f, src] of [['run-named.mjs', runNamed], ['test-names-reporter.mjs', reporter]]) {
    assert.doesNotMatch(src, /todo\s*[!=]==\s*undefined/, `${f} carries its own todo rule`);
    assert.match(src, /import \{[^}]*\b(isFailure|outcomeOf)\b[^}]*\} from '\.\/test-outcome\.mjs'/, `${f} does not use the shared rule`);
  }
});

test('G-4: measure-names.mjs refuses a --compare without two files and an unknown flag, naming the flag', () => {
  const dir = tmp();
  try {
    const run = (...args) => node([path.join(BENCH, 'measure-names.mjs'), ...args], dir);
    const a = path.join(dir, 'a.json');
    fs.writeFileSync(a, '{"names":[]}\n');
    const one = run('--compare', a);
    assert.notEqual(one.status, 0);
    assert.match(one.stderr, /--compare/);
    const unknown = run('--repo', dir, '--bogus', 'x');
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /--bogus/);
    // The documented compare still works: identical files exit 0.
    const same = run('--compare', a, a);
    assert.equal(same.status, 0, same.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
