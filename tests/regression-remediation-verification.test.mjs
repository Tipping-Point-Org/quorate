// How a remediation node verifies its work, and what the runner commits (.claude/requests/remediation-verification.plan.md,
// approved 2026-10-13: "Approve, start (Recommended)"). The defect: a node could capture only the whole suite, so its red
// and green checks were long waits it backgrounded, and the runner committed what the node itself called unverified
// (remediations 20261013-034806, -044619, -120232 of the ledger-identity rounds; dec1158a).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, repoRunDir, REPO_ROOT, TEST_HOME } from './helpers.mjs';
import { testOneTemplate, matchTestOne, testOneFileRefusal } from '../scripts/lib/test-one.mjs';
import { classifyPath } from '../scripts/lib/finding-scope.mjs';

// ---------------------------------------------------------------------------------------------- stage 1: the grammar

const C = (test_one, extra = {}) => ({ commands: { test_one, shell: '', ...extra }, test_globs: ['tests/**'], source_globs: ['scripts/**'] });

test('stage 1: an empty test_one is no template, and admits nothing', () => {
  assert.deepEqual(testOneTemplate(C('')), { ok: true, argv: null });
  assert.deepEqual(testOneTemplate({}), { ok: true, argv: null });
});

test('stage 1: a template is its argv with exactly one whole {file} token', () => {
  assert.deepEqual(testOneTemplate(C('node --test {file}')), { ok: true, argv: ['node', '--test', '{file}'], index: 2 });
  for (const [t, why] of [
    ['node --test', /no \{file\}/],
    ['node --test {file} {file}', /more than one/],
    ['node --test=x{file}', /inside another token/],
    ['node --test {file}x', /inside another token/],
  ]) {
    const r = testOneTemplate(C(t));
    assert.equal(r.ok, false, t);
    assert.match(r.why, why, t);
  }
});

test('stage 1: a declared commands.shell refuses test_one — filling a placeholder in a shell string is interpolation', () => {
  const r = testOneTemplate(C('node --test {file}', { shell: 'bash -lc' }));
  assert.equal(r.ok, false);
  assert.match(r.why, /commands\.shell/);
});

test('stage 1: an argv matches the template only with every other token equal and nothing extra', () => {
  const t = testOneTemplate(C('node --test {file}'));
  assert.deepEqual(matchTestOne(['node', '--test', 'tests/a.test.mjs'], t), { file: 'tests/a.test.mjs' });
  assert.equal(matchTestOne(['node', '--test', 'tests/a.test.mjs', 'extra'], t), null);
  assert.equal(matchTestOne(['node', '--check', 'tests/a.test.mjs'], t), null);
  assert.equal(matchTestOne(['node', '--test'], t), null);
  assert.equal(matchTestOne(['node', '--test', 'x'], testOneTemplate(C(''))), null);
});

// ---------------------------------------------------------------------------------------------- stage 1: the file

const facts = (over = {}) => ({
  classify: (p) => classifyPath(p, C('node --test {file}'), { caseInsensitive: false }),
  listed: new Set(['tests/a.test.mjs', 'scripts/x.mjs']),
  linksOut: () => false,
  ...over,
});

test('stage 1: a listed, repository-relative test file is admissible', () => {
  assert.equal(testOneFileRefusal('tests/a.test.mjs', facts()), null);
});

test('stage 1: a flag, a glob, an absolute or climbing path, a non-test, an unlisted file or a link out is refused', () => {
  for (const [file, f, why] of [
    ['--test-reporter=x', facts(), /flag/],
    ['tests/*.test.mjs', facts(), /glob/],
    ['tests/a?.test.mjs', facts(), /glob/],
    ['tests/[a].test.mjs', facts(), /glob/],
    ['/etc/passwd', facts(), /repository-relative/],
    ['C:/x/tests/a.test.mjs', facts(), /repository-relative/],
    ['tests\\a.test.mjs', facts(), /repository-relative/],
    ['tests/../scripts/x.mjs', facts(), /repository-relative/],
    ['./tests/a.test.mjs', facts(), /repository-relative/],
    ['scripts/x.mjs', facts(), /not a test file/],
    ['tests/b.test.mjs', facts(), /git's file list/],
    ['tests/a.test.mjs', facts({ linksOut: () => true }), /link out/],
    ['', facts(), /no file/],
  ]) {
    const why2 = testOneFileRefusal(file, f);
    assert.ok(why2, `${file} was admitted`);
    assert.match(why2, why, file);
  }
});

// ---------------------------------------------------------------------------------------------- stage 1: capture

// A remediation run whose contract declares a harmless template: `node --check {file}` parses the file and runs nothing.
function remediationRun(extra = {}) {
  return repoRunDir({
    runId: 'test-one', prefix: 'quorate-testone-',
    json: {
      remediates: '20260101-000000-reviewed',
      contract: { commands: { test: 'node tests/run-all.mjs', test_one: 'node --check {file}', shell: '' }, test_globs: ['tests/**'], source_globs: ['scripts/**'] },
      ...extra,
    },
  });
}
const cap = (dir, node, args, extra = []) => runScript('capture.mjs', ['--run-dir', dir, '--node', node, '--name', 'one', ...extra, '--', ...args]);
const logOf = (dir, node) => {
  const d = path.join(dir, 'evidence', node);
  const f = fs.readdirSync(d).find((x) => x.endsWith('.log'));
  return fs.readFileSync(path.join(d, f), 'utf8');
};

test('stage 1: capture runs test_one for the remediation node, and its log names the key and the file', () => {
  const { base, dir } = remediationRun();
  try {
    const r = cap(dir, 'remediation', ['node', '--check', 'tests/helpers.mjs']);
    assert.equal(r.status, 0, r.output);
    assert.match(logOf(dir, 'remediation'), /^# admitted: test_one tests\/helpers\.mjs$/m);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('stage 1: a declared command\'s log names its key', () => {
  const { base, dir } = remediationRun({ contract: { commands: { build: 'node --version', test_one: 'node --check {file}', shell: '' }, test_globs: ['tests/**'] } });
  try {
    const r = cap(dir, 'remediation', ['node', '--version']);
    assert.equal(r.status, 0, r.output);
    assert.match(logOf(dir, 'remediation'), /^# admitted: build$/m);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('stage 1: capture refuses test_one for a lens, with --cwd, and for an inadmissible file', () => {
  const { base, dir } = remediationRun();
  try {
    let r = cap(dir, 'code-audit', ['node', '--check', 'tests/helpers.mjs']);
    assert.notEqual(r.status, 0, 'a lens ran test_one');
    assert.match(r.output, /remediation node/);
    r = cap(dir, 'remediation', ['node', '--check', 'tests/helpers.mjs'], ['--cwd', '.']);
    assert.notEqual(r.status, 0, 'test_one ran with --cwd');
    assert.match(r.output, /--cwd/);
    r = cap(dir, 'remediation', ['node', '--check', 'scripts/capture.mjs']);
    assert.notEqual(r.status, 0, 'a source file was run as a test');
    assert.match(r.output, /not a test file/);
    r = cap(dir, 'remediation', ['node', '--check', 'tests/*.mjs']);
    assert.notEqual(r.status, 0, 'a glob was admitted');
    assert.match(r.output, /glob/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('stage 1: a run is refused at mint for a test_one outside its grammar, or beside a declared shell', (t) => {
  for (const [lines, why] of [
    [['  test_one: "node --test"'], /no \{file\} placeholder/],
    [['  test_one: "node --test {file}"', '  shell: "bash -lc"'], /commands\.shell/],
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-testone-mint-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const yaml = ['graph_contract: 1', 'project: t', 'commands:', '  build: ""', '  test: ""', ...lines].join('\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# t\n\n```yaml\n' + yaml + '\n```\n');
    const r = runScript('new-run.mjs', ['--slug', 'tom', '--repo-root', dir, '--no-request', '--no-verify-sandbox', '--full-sweep', 'src'], { cwd: dir });
    assert.notEqual(r.status, 0, `${lines.join(' ')} was minted`);
    assert.match(r.output, why);
  }
});

test('stage 1: a run that is not a remediation never admits test_one', () => {
  const { base, dir } = remediationRun({ remediates: undefined });
  try {
    const r = cap(dir, 'remediation', ['node', '--check', 'tests/helpers.mjs']);
    assert.notEqual(r.status, 0);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------- stage 3: the brief

test('stage 3: the brief template carries the narrow command and both limits, and remediate.mjs fills them', () => {
  const tpl = fs.readFileSync(new URL('../prompts/_templates/remediate-brief.md', import.meta.url), 'utf8');
  assert.match(tpl, /\{\{test_one\}\}/);
  assert.match(tpl, /\{\{limits\}\}/);
  const src = fs.readFileSync(new URL('../scripts/remediate.mjs', import.meta.url), 'utf8');
  assert.match(src, /test_one: /, 'remediate.mjs does not fill the test_one slot');
  assert.match(src, /limits: /, 'remediate.mjs does not fill the limits slot');
  assert.match(src, /none declared/, 'an empty test_one must say so, not leave the slot blank');
});

test('stage 3: the prompt says captures run in the foreground, red and green narrow, and the whole is the runner\'s', () => {
  const p = fs.readFileSync(new URL('../prompts/remediation/PROMPT.md', import.meta.url), 'utf8');
  assert.match(p, /foreground/i);
  assert.match(p, /never\s+in\s+the\s+background/i);
  assert.match(p, /test_one/);
  assert.match(p, /the\s+runner\s+(checks|runs)\s+the\s+whole/i);
});

// ---------------------------------------------------------------------------------------------- stage 4a: one core

test('stage 4a: countFailures reads the failing count in the formats countTests knows, and null otherwise', async () => {
  const { countFailures } = await import('../scripts/lib/test-count.mjs');
  assert.equal(countFailures('# pass 40\n# fail 2\n'), 2);
  assert.equal(countFailures('ℹ tests 41\nℹ pass 41\nℹ fail 0\n'), 0);
  assert.equal(countFailures('3 failed, 2097 passed, 4 skipped in 417.99s (0:06:57)'), 3);
  assert.equal(countFailures('12 passed in 0.5s'), 0);
  assert.equal(countFailures('test result: FAILED. 6 passed; 2 failed; 0 ignored'), 2);
  assert.equal(countFailures('Tests: 3 failed, 9 total'), null, 'an unknown runner is unknown, not zero');
  assert.equal(countFailures('  a test named "fail 3" printed this\n'), null);
});

test('stage 4a: run-checks and the runner run declared checks through one core', () => {
  const rc = fs.readFileSync(new URL('../scripts/run-checks.mjs', import.meta.url), 'utf8');
  assert.match(rc, /from '\.\/io\/declared-checks\.mjs'/, 'run-checks does not use the shared core');
  assert.doesNotMatch(rc, /function runOneAsync\(/, 'run-checks still carries its own copy of the runner');
});

test('stage 4a: the core runs the barrier first and alone, records each check\'s log, and stops after a broken barrier', async () => {
  const { runDeclaredChecks } = await import('../scripts/io/declared-checks.mjs');
  const { base, dir } = repoRunDir({ runId: 'core', prefix: 'quorate-core-', json: {
    contract: { commands: { build: 'node -e process.exit(3)', test: 'node --version', shell: '' } } } });
  try {
    const out = await runDeclaredChecks({ runDir: dir, repoRoot: REPO_ROOT,
      commands: { build: 'node -e process.exit(3)', test: 'node --version' }, nodeId: 'core-probe', timeoutMinutes: 2, barrierKeys: new Set(['build']),
      // The suite's home, where repoRunDir stages the run (run-dir-trust stage 2): capture admits it only there.
      env: { ...process.env, QUORATE_HOME: TEST_HOME } });
    assert.equal(out.barrierBroke, true);
    assert.equal(out.ran.get('build').exit_code, 3);
    assert.ok(out.ran.get('build').evidence_path, 'the barrier check has no log');
    assert.equal(out.ran.has('test'), false, 'a check ran after a broken barrier');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------- stage 4b: the guard

const GC = { source_globs: ['scripts/**'], test_globs: ['tests/**'], review: { preflight_inputs: ['scripts/**', 'tests/**', 'CLAUDE.md'] } };

test('stage 4b: outside the candidate, a source, test or check-input file refuses; anything else does not', async () => {
  const { treeGuardRefusals } = await import('../scripts/lib/remediation-chain.mjs');
  const r = treeGuardRefusals({ caseInsensitive: true, 
    files: ['scripts/a.mjs', 'tests/a.test.mjs', 'CLAUDE.md', 'continue.bat', '.claude/requests/x.md', 'scripts/fixed.mjs'],
    candidate: new Set(['scripts/fixed.mjs']), contract: GC, contractSource: 'CLAUDE.md',
  });
  assert.deepEqual(r.map((x) => x.path).sort(), ['CLAUDE.md', 'scripts/a.mjs', 'tests/a.test.mjs']);
  for (const x of r) assert.ok(x.why, x.path);
});

test('stage 4b: the contract source refuses even outside the declared inputs, and a rename\'s old path counts', async () => {
  const { treeGuardRefusals } = await import('../scripts/lib/remediation-chain.mjs');
  const c = { ...GC, review: { preflight_inputs: ['scripts/**'] } };
  const r = treeGuardRefusals({ caseInsensitive: true,  files: ['.claude/rules/quorate-contract.md', 'tests/old.test.mjs'], candidate: new Set(),
    contract: c, contractSource: '.claude/rules/quorate-contract.md' });
  assert.deepEqual(r.map((x) => x.path).sort(), ['.claude/rules/quorate-contract.md', 'tests/old.test.mjs']);
});

test('stage 4b: with no declared preflight_inputs every TRACKED change outside the candidate refuses; untracked notes do not', async () => {
  const { treeGuardRefusals } = await import('../scripts/lib/remediation-chain.mjs');
  const c = { source_globs: ['src/**'], test_globs: ['tests/**'] };
  const r = treeGuardRefusals({ caseInsensitive: true,  files: ['README.md', 'notes.txt', 'src/a.js'], untracked: ['notes.txt'], candidate: new Set(['src/a.js']),
    contract: c, contractSource: 'CLAUDE.md' });
  assert.deepEqual(r.map((x) => x.path), ['README.md']);
});

test('stage 4b: the run\'s own directory is excluded by name', async () => {
  const { treeGuardRefusals } = await import('../scripts/lib/remediation-chain.mjs');
  const r = treeGuardRefusals({ caseInsensitive: true,  files: ['.claude/reviews/20261013-x/run.json', 'scripts/a.mjs'], candidate: new Set(),
    contract: { ...GC, source_globs: ['scripts/**', '.claude/**'] }, contractSource: 'CLAUDE.md', excludedDirs: ['.claude/reviews/20261013-x'] });
  assert.deepEqual(r.map((x) => x.path), ['scripts/a.mjs']);
});

test('stage 4b: statusEntriesV2 names the untracked files', async () => {
  const { statusEntriesV2 } = await import('../scripts/lib/remediation-chain.mjs');
  const out = statusEntriesV2('1 .M N... 100644 100644 100644 abc abc src/a.js\0? notes.txt\0');
  assert.deepEqual(out.untracked, ['notes.txt']);
  assert.deepEqual(out.files.sort(), ['notes.txt', 'src/a.js']);
});

// The framework mount, in each layout (plan stage 4: "A red-first fixture in each layout settles it").
function gitFixture(dir) {
  const g = (cwd, ...a) => {
    const r = spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  };
  fs.mkdirSync(dir, { recursive: true });
  g(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  g(dir, 'add', 'a.txt');
  g(dir, 'commit', '-q', '-m', 'a');
  return g;
}

test('stage 4b: a framework mounted inside the repository as its own repository refuses when it is changed', async () => {
  const { frameworkMountRefusals } = await import('../scripts/io/framework-mount.mjs');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-fwmount-'));
  try {
    const repo = path.join(base, 'repo');
    gitFixture(repo);
    const fw = path.join(repo, '.claude', 'skills', 'quorate');
    gitFixture(fw);
    assert.deepEqual(frameworkMountRefusals(repo, fw), [], 'a clean mount refuses nothing');
    fs.writeFileSync(path.join(fw, 'a.txt'), 'changed\n');
    fs.writeFileSync(path.join(fw, 'new.txt'), 'new\n');
    const r = frameworkMountRefusals(repo, fw);
    assert.deepEqual(r.map((x) => x.path).sort(), ['.claude/skills/quorate/a.txt', '.claude/skills/quorate/new.txt']);
    assert.match(r[0].why, /framework mount/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('stage 4b: a framework that is the repository, or lies outside it, adds nothing to the guard', async () => {
  const { frameworkMountRefusals } = await import('../scripts/io/framework-mount.mjs');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-fwmount-'));
  try {
    const repo = path.join(base, 'repo');
    gitFixture(repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
    assert.deepEqual(frameworkMountRefusals(repo, repo), [], 'the repository itself is the guard\'s own business');
    const outside = path.join(base, 'fw');
    gitFixture(outside);
    fs.writeFileSync(path.join(outside, 'a.txt'), 'changed\n');
    assert.deepEqual(frameworkMountRefusals(repo, outside), [], 'a framework outside the repository is not what the commit is checked against');
    // A plain directory inside the repository is the enclosing repository's files, which the guard classifies itself.
    const copy = path.join(repo, 'vendor', 'quorate');
    fs.mkdirSync(copy, { recursive: true });
    fs.writeFileSync(path.join(copy, 'x.txt'), 'x\n');
    assert.deepEqual(frameworkMountRefusals(repo, copy), []);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------- stage 4c: the full check

// run-all.mjs in a fixture: its own copy beside a 21-test suite (minTests is 20), with the contract read and the counted-
// facts check stubbed, so the channel files can be read without running this repository's suite.
function runAllFixture({ drift = false, productFails = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-runall-'));
  const repo = path.join(base, 'r');
  gitFixture(repo);
  fs.mkdirSync(path.join(repo, 'tests'));
  fs.mkdirSync(path.join(repo, 'scripts'));
  fs.copyFileSync(path.join(REPO_ROOT, 'tests', 'run-all.mjs'), path.join(repo, 'tests', 'run-all.mjs'));
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.mjs'),
    "import { test } from 'node:test';\nfor (let i = 0; i < 21; i++) test(`t${i}`, () => {});\n");
  const product = productFails ? 'node fail.mjs' : '';
  fs.writeFileSync(path.join(repo, 'fail.mjs'), 'process.exit(1);\n');
  fs.writeFileSync(path.join(repo, 'scripts', 'new-run.mjs'), `console.log(JSON.stringify({ commands: { test_product: ${JSON.stringify(product)} } }));\n`);
  fs.writeFileSync(path.join(repo, 'scripts', 'check-counted-facts.mjs'), drift
    ? "console.log('check-counted-facts: README.md states 20 tests; the tree has ' + process.argv[3] + '.'); process.exit(1);\n"
    : 'process.exit(0);\n');
  const count = path.join(base, 'count.txt');
  const facts = path.join(base, 'facts.json');
  // Without the parent's NODE_TEST_CONTEXT, which makes a nested `node --test` skip its files.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, [path.join(repo, 'tests', 'run-all.mjs')],
    { cwd: repo, encoding: 'utf8', env: { ...env, QUORATE_COUNT_FILE: count, QUORATE_FACTS_FILE: facts } });
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  return { base, status: r.status, out: `${r.stdout}${r.stderr}`, count: read(count), facts: read(facts) };
}

test('stage 4c: run-all writes QUORATE_FACTS_FILE — a drift alone is drifted, with no other failed suite', () => {
  const f = runAllFixture({ drift: true });
  try {
    assert.equal(f.status, 1, f.out);
    assert.equal(f.count, '21');
    const facts = JSON.parse(f.facts);
    assert.equal(facts.drifted, true);
    assert.deepEqual(facts.failed_suites, []);
    assert.equal(facts.tests, 21);
    assert.equal(facts.min_tests, 20);
    assert.match(facts.message, /README\.md states 20 tests/);
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
});

test('stage 4c: run-all\'s facts file names a failing product suite, so a drift beside it is not "drift alone"', () => {
  const f = runAllFixture({ drift: true, productFails: true });
  try {
    assert.equal(f.status, 1, f.out);
    const facts = JSON.parse(f.facts);
    assert.equal(facts.drifted, true);
    assert.equal(facts.failed_suites.length, 1, f.facts);
    assert.match(facts.failed_suites[0], /product tests/);
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
});

test('stage 4c: a clean run-all writes facts that say not drifted', () => {
  const f = runAllFixture();
  try {
    assert.equal(f.status, 0, f.out);
    const facts = JSON.parse(f.facts);
    assert.equal(facts.drifted, false);
    assert.deepEqual(facts.failed_suites, []);
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
});

const RAN = (o) => ({ exit_code: 0, timed_out: false, tests: 30, failing: 0, failing_names: [], evidence_path: 'evidence/remediation-runner/x.txt', ...o });

test('stage 4c: build, test, lint and typecheck refuse; audit, deny and fmt_check stamp (operator: "Build, test, lint, typecheck")', async () => {
  const { fullCheckVerdict, CHECK_KEY_CLASS } = await import('../scripts/lib/full-check.mjs');
  assert.deepEqual(Object.entries(CHECK_KEY_CLASS).filter(([, c]) => c === 'refuses').map(([k]) => k).sort(), ['build', 'lint', 'test', 'typecheck']);
  assert.deepEqual(Object.entries(CHECK_KEY_CLASS).filter(([, c]) => c === 'stamps').map(([k]) => k).sort(), ['audit', 'deny', 'fmt_check']);
  for (const key of ['build', 'lint', 'typecheck']) {
    const v = fullCheckVerdict({ declared: [key], ran: { [key]: RAN({ exit_code: 2 }) } });
    assert.equal(v.commit, false, key);
    assert.equal(v.refusals[0].key, key);
  }
  for (const key of ['audit', 'deny', 'fmt_check']) {
    const v = fullCheckVerdict({ declared: [key], ran: { [key]: RAN({ exit_code: 1 }) } });
    assert.equal(v.commit, true, key);
    assert.equal(v.stamps[0].key, key);
  }
  const t = fullCheckVerdict({ declared: ['lint'], ran: { lint: RAN({ timed_out: true, exit_code: 124 }) } });
  assert.equal(t.commit, false);
  assert.match(t.refusals[0].why, /timed out/);
  const notRun = fullCheckVerdict({ declared: ['build', 'test'], ran: { build: RAN({ exit_code: 1 }) } });
  assert.deepEqual(notRun.refusals.map((r) => r.key), ['build', 'test']);
  assert.match(notRun.refusals[1].why, /not run/);
});

test('stage 4c: test refuses on failing tests (named), an unreadable count with a non-zero exit, or a non-zero exit with none failing', async () => {
  const { fullCheckVerdict } = await import('../scripts/lib/full-check.mjs');
  const failing = fullCheckVerdict({ declared: ['test'], ran: { test: RAN({ exit_code: 1, failing: 2, failing_names: ['a works', 'b works'] }) } });
  assert.equal(failing.commit, false);
  assert.match(failing.refusals[0].why, /2 failing test\(s\): a works; b works/);
  // A PASSING suite with no readable count commits, recorded uncounted (plan amended 2026-10-13, G-5 of
  // 20261013-220031-rv-delivery): tests/regression-full-check-uncounted.test.mjs.
  const unread = fullCheckVerdict({ declared: ['test'], ran: { test: RAN({ exit_code: 1, failing: null, tests: null }) } });
  assert.equal(unread.commit, false);
  assert.match(unread.refusals[0].why, /no readable test count/);
  const noFail = fullCheckVerdict({ declared: ['test'], ran: { test: RAN({ exit_code: 1 }) } });
  assert.equal(noFail.commit, false, 'a floor, a failing test_product or a pytest exit 5 is not a drift');
  const passing = fullCheckVerdict({ declared: ['test'], ran: { test: RAN() } });
  assert.equal(passing.commit, true);
  assert.equal(passing.countUpdate, null);
});

test('stage 4c: a counted-facts drift alone commits and names the update; only from fresh channels, and only at the floor', async () => {
  const { fullCheckVerdict } = await import('../scripts/lib/full-check.mjs');
  const facts = { drifted: true, failed_suites: [], tests: 30, min_tests: 20, message: 'README.md states 29 tests; the tree has 30.' };
  const ok = fullCheckVerdict({ declared: ['test'], ran: { test: RAN({ exit_code: 1 }) }, channels: { count: 30, facts } });
  assert.equal(ok.commit, true, JSON.stringify(ok));
  assert.match(ok.countUpdate.message, /states 29 tests/);
  for (const [why, channels] of [
    ['another suite failed', { count: 30, facts: { ...facts, failed_suites: ['product tests (cargo)'] } }],
    ['below the floor', { count: 10, facts: { ...facts, min_tests: 20 } }],
    ['no count file', { count: null, facts }],
    ['no facts file', { count: 30, facts: null }],
    ['a stale channel', { count: 30, facts, stale: 'evidence/remediation-runner/test.facts.json was there before the check' }],
  ]) {
    const v = fullCheckVerdict({ declared: ['test'], ran: { test: RAN({ exit_code: 1 }) }, channels });
    assert.equal(v.commit, false, why);
  }
});

test('stage 4c: failingTestNames reads node\'s spec and TAP, and pytest\'s summary', async () => {
  const { failingTestNames } = await import('../scripts/lib/full-check.mjs');
  const spec = '✔ fine (1ms)\n✖ failing tests:\n\ntest at tests/a.test.mjs:3:1\n✖ a works (2.1ms)\n  AssertionError\n';
  assert.deepEqual(failingTestNames(spec), ['a works']);
  assert.deepEqual(failingTestNames('ok 1 - fine\nnot ok 2 - b works\n  ---\n'), ['b works']);
  assert.deepEqual(failingTestNames('FAILED tests/test_x.py::test_y - assert 0\n'), ['tests/test_x.py::test_y']);
});

// ---------------------------------------------------------------------------------------------- stage 5: the evidence gate

// Facts as the runner reads them from capture's header (io/capture-facts.mjs): admitted key and file, exit, timed out, when.
const RED = { admitted: 'test_one', file: 'tests/a.test.mjs', exit: 1, timed_out: false, captured: '2026-10-13T10:00:00.000Z' };
const GREEN = { admitted: 'test_one', file: 'tests/a.test.mjs', exit: 0, timed_out: false, captured: '2026-10-13T10:05:00.000Z' };
const G = (o = {}) => ({ group_id: 'G-1', disposition: 'fixed', files: ['scripts/a.mjs', 'tests/a.test.mjs'],
  red_evidence: 'evidence/remediation/red.txt', green_evidence: 'evidence/remediation/green.txt', ...o });
const EV = (red, green) => ({ 'evidence/remediation/red.txt': red, 'evidence/remediation/green.txt': green });

test('stage 5: a group with a test_one red then a later test_one green of a test file it commits is admitted', async () => {
  const { evidenceRefusal, commitRefusal } = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(evidenceRefusal(G(), EV(RED, GREEN), GC, { caseInsensitive: false }), null);
  assert.equal(commitRefusal(G(), { evidence: EV(RED, GREEN), contract: GC, caseInsensitive: false }), null);
  // Not expressible as a test (no red): admitted as today, and the planner names it.
  assert.equal(evidenceRefusal(G({ red_evidence: '', green_evidence: 'evidence/remediation/green.txt' }), EV(null, GREEN), GC, { caseInsensitive: false }), null);
});

test('stage 5: refused — no green, a failed green, a green older than its red, a timed-out red, a red that passed', async () => {
  const { evidenceRefusal } = await import('../scripts/lib/remediation-chain.mjs');
  for (const [why, g, ev, re] of [
    ['no green', G({ green_evidence: '' }), EV(RED, null), /no green/],
    ['green unreadable', G(), EV(RED, null), /green .* is not a capture/],
    ['failed green', G(), EV(RED, { ...GREEN, exit: 1 }), /green .* exited 1/],
    ['green older than red', G(), EV(RED, { ...GREEN, captured: '2026-10-13T09:00:00.000Z' }), /not captured after the red/],
    ['timed-out red', G(), EV({ ...RED, timed_out: true }, GREEN), /red .* timed out/],
    ['red exited 0', G(), EV({ ...RED, exit: 0 }, GREEN), /red .* exited 0/],
  ]) {
    const r = evidenceRefusal(g, ev, GC, { caseInsensitive: false });
    assert.ok(r, why);
    assert.match(r, re, why);
  }
});

test('stage 5: refused — a green of another file, a file the group does not commit, a full-suite red, a partial with no green', async () => {
  const { evidenceRefusal, commitRefusal } = await import('../scripts/lib/remediation-chain.mjs');
  assert.match(evidenceRefusal(G(), EV(RED, { ...GREEN, file: 'tests/b.test.mjs' }), GC, { caseInsensitive: false }), /not the same file/);
  const other = { file: 'tests/z.test.mjs' };
  assert.match(evidenceRefusal(G(), EV({ ...RED, ...other }, { ...GREEN, ...other }), GC, { caseInsensitive: false }), /not a test file this group commits/);
  assert.match(evidenceRefusal(G(), EV({ ...RED, admitted: 'test', file: null }, GREEN), GC, { caseInsensitive: false }), /not a test_one capture/);
  const r = commitRefusal(G({ disposition: 'partial', green_evidence: '' }), { evidence: EV(RED, null), contract: GC, caseInsensitive: false });
  assert.equal(r.kind, 'evidence-refused');
  assert.match(r.why, /no green/);
});

// SEVERAL GREENS (20261014-190935-lf-remediation-2): a fix that changed four test files captured each green and listed
// them, `; `-separated, in green_evidence; the gate read the whole string as one path and refused the group, and the
// refusal spread to its sibling. One green must re-run the red's file; every green listed must pass, after the red; the
// red's file must be a test file the group commits.
const GREEN_B = { ...GREEN, file: 'tests/b.test.mjs', captured: '2026-10-13T10:06:00.000Z' };
const GB = (o = {}) => G({ files: ['scripts/a.mjs', 'tests/a.test.mjs', 'tests/b.test.mjs'],
  green_evidence: 'evidence/remediation/green.txt; evidence/remediation/green-b.txt', ...o });
const EVB = (green, greenB) => ({ ...EV(RED, green), 'evidence/remediation/green-b.txt': greenB });

test('several greens: admitted when one re-runs the red\'s file and every one passed after the red', async () => {
  const { evidenceRefusal, evidencePaths } = await import('../scripts/lib/remediation-chain.mjs');
  assert.deepEqual(evidencePaths(' a.txt ;b.txt; '), ['a.txt', 'b.txt']);
  assert.deepEqual(evidencePaths(''), []);
  assert.equal(evidenceRefusal(GB(), EVB(GREEN, GREEN_B), GC, { caseInsensitive: false }), null);
  // Order does not matter: the red's file may be any of them.
  assert.equal(evidenceRefusal(GB({ green_evidence: 'evidence/remediation/green-b.txt;evidence/remediation/green.txt' }), EVB(GREEN, GREEN_B), GC, { caseInsensitive: false }), null);
});

// A GREEN THAT ANSWERS NO RED (operator, 2026-11-03: "B", on 20261103-163145-dr-remediation-3): a passing run of a test
// file the group does not change, cited beside the red's own green, refused the group and every group sharing a file with
// it. Such a green is still held to passing after the red; only the red's file must be committed.
test('several greens: a further green of a test the group does not commit is admitted; the red\'s file still must be', async () => {
  const { evidenceRefusal } = await import('../scripts/lib/remediation-chain.mjs');
  const onlyA = GB({ files: ['scripts/a.mjs', 'tests/a.test.mjs'] });
  assert.equal(evidenceRefusal(onlyA, EVB(GREEN, GREEN_B), GC, { caseInsensitive: false }), null);
  assert.match(evidenceRefusal(onlyA, EVB(GREEN, { ...GREEN_B, exit: 1 }), GC, { caseInsensitive: false }), /green-b\.txt exited 1/);
  assert.match(evidenceRefusal(GB({ files: ['scripts/a.mjs', 'tests/b.test.mjs'] }), EVB(GREEN, GREEN_B), GC, { caseInsensitive: false }), /tests\/a\.test\.mjs is not a test file this group commits/);
});

test('several greens: refused when any listed green is missing, failed, older than the red, or answers nothing', async () => {
  const { evidenceRefusal } = await import('../scripts/lib/remediation-chain.mjs');
  for (const [why, g, ev, re] of [
    ['second missing', GB(), EVB(GREEN, null), /green evidence\/remediation\/green-b\.txt is not a capture/],
    ['second failed', GB(), EVB(GREEN, { ...GREEN_B, exit: 1 }), /green evidence\/remediation\/green-b\.txt exited 1/],
    ['second older than red', GB(), EVB(GREEN, { ...GREEN_B, captured: '2026-10-13T09:00:00.000Z' }), /green-b\.txt was not captured after the red/],
    ['none re-runs the red', GB({ green_evidence: 'evidence/remediation/green-b.txt' }), EVB(GREEN, GREEN_B), /not the same file as the red/],
  ]) {
    const r = evidenceRefusal(g, ev, GC, { caseInsensitive: false });
    assert.ok(r, why);
    assert.match(r, re, why);
  }
});

// SEVERAL REDS (20261020-102242-ciss-remediation): a fix pinned in two test files has one red per file, since test_one
// runs one file, and the node listed both, `; `-separated, as it may for greens. The gate read the whole string as one
// path and refused both fixed groups, so nothing committed. Every red listed must be a failing test_one capture of a test
// file the group commits, every green must follow every red, and each red's file must have a green.
const RED_B = { ...RED, file: 'tests/b.test.mjs', captured: '2026-10-13T10:01:00.000Z' };
const GR = (o = {}) => GB({ red_evidence: 'evidence/remediation/red.txt; evidence/remediation/red-b.txt', ...o });
const EVR = (redB, greenB = GREEN_B) => ({ ...EVB(GREEN, greenB), 'evidence/remediation/red-b.txt': redB });

test('several reds: admitted when every red failed and each red\'s file has a later green', async () => {
  const { evidenceRefusal } = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(evidenceRefusal(GR(), EVR(RED_B), GC, { caseInsensitive: false }), null);
});

// RED-GREEN PAIRS IN ONE FILE (20261020-174439-argv-remediation-2): a fix found a second defect after its first green,
// wrote its red, then its green. Requiring every green after the LAST red refused that order; each red needs a green of
// its file captured after it.
test('several reds: two red-then-green pairs on one test file are admitted', async () => {
  const { evidenceRefusal } = await import('../scripts/lib/remediation-chain.mjs');
  const g = G({ red_evidence: 'evidence/remediation/red.txt; evidence/remediation/red-2.txt',
    green_evidence: 'evidence/remediation/green.txt; evidence/remediation/green-2.txt' });
  const ev = { ...EV(RED, GREEN), 'evidence/remediation/red-2.txt': { ...RED, captured: '2026-10-13T10:07:00.000Z' },
    'evidence/remediation/green-2.txt': { ...GREEN, captured: '2026-10-13T10:09:00.000Z' } };
  assert.equal(evidenceRefusal(g, ev, GC, { caseInsensitive: false }), null);
  // A red whose file never passed after it is still refused.
  const late = { ...ev, 'evidence/remediation/red-2.txt': { ...RED, captured: '2026-10-13T10:10:00.000Z' } };
  assert.match(evidenceRefusal(g, late, GC, { caseInsensitive: false }), /no green re-ran tests\/a\.test\.mjs after/);
});

test('several reds: refused when any listed red is missing, passed, not test_one, or its file has no green', async () => {
  const { evidenceRefusal } = await import('../scripts/lib/remediation-chain.mjs');
  for (const [why, g, ev, re] of [
    ['second missing', GR(), EVR(null), /red evidence\/remediation\/red-b\.txt is not a capture/],
    ['second passed', GR(), EVR({ ...RED_B, exit: 0 }), /red evidence\/remediation\/red-b\.txt exited 0/],
    ['second full-suite', GR(), EVR({ ...RED_B, admitted: 'test', file: null }), /red-b\.txt is not a test_one capture/],
    ['second file has no green', GR({ green_evidence: 'evidence/remediation/green.txt' }), EVR(RED_B), /no green re-ran tests\/b\.test\.mjs/],
    // Still refused: b's only green came before b's red. The message names the file whose red went unanswered.
    ['green before the second red', GR(), EVR({ ...RED_B, captured: '2026-10-13T10:07:00.000Z' }), /no green re-ran tests\/b\.test\.mjs after its red/],
  ]) {
    const r = evidenceRefusal(g, ev, GC, { caseInsensitive: false });
    assert.ok(r, why);
    assert.match(r, re, why);
  }
});

// THE DOCS FOLLOW THE GATE (G-3 of 20261014-193710-lf-remediation-review; operator: "Docs follow the code
// (Recommended)"). The gate checks every green LISTED; it does not derive the group's test files and demand a green for
// each. The contract and the skill said "one for each test file the fix changed", promising a completeness check no code
// makes. Pinned from both sides: the behaviour, and every document that describes it.
test('several greens: a changed test file with no green is not refused, and each description of the gate says so', async () => {
  const { evidenceRefusal } = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(evidenceRefusal(GB({ green_evidence: 'evidence/remediation/green.txt' }), EVB(GREEN, GREEN_B), GC, { caseInsensitive: false }), null);
  const said = /that each changed test file has a green is not checked/;
  for (const rel of ['shared/claude-md-contract.md', 'skills/remediate/SKILL.md', 'scripts/lib/remediation-chain.mjs']) {
    const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.ok(said.test(text), `${rel} does not state the gate's limit`);
    assert.ok(!/one for each test file the fix changed|lists a green for each/.test(text), `${rel} promises a check the gate does not make`);
  }
});

test('stage 5: admitGroups refuses at admission and spreads it; the planner applies the same rule on a retry\'s re-plan', async () => {
  const { admitGroups, planClusterCommits } = await import('../scripts/lib/remediation-chain.mjs');
  const bad = G({ green_evidence: '' });
  const sibling = G({ group_id: 'G-2', files: ['scripts/a.mjs'], red_evidence: '' });
  const a = admitGroups({ caseInsensitive: true,  groups: [bad, sibling], confirmed: ['G-1', 'G-2'], evidence: EV(RED, null), contract: GC });
  assert.deepEqual(a.plannable, []);
  assert.deepEqual(a.checks.map((c) => c.kind).sort(), ['evidence-refused', 'shared-with-refused']);
  const status = { files: ['scripts/a.mjs', 'tests/a.test.mjs'], refused: [] };
  assert.deepEqual(planClusterCommits({ caseInsensitive: false,  groups: [bad], status, contract: GC, evidence: EV(RED, null) }), [], 'not planned without its evidence');
  assert.equal(planClusterCommits({ caseInsensitive: false,  groups: [G()], status, contract: GC, evidence: EV(RED, GREEN) })[0].committable, true);
});

test('stage 5: captureFacts reads the header, not the output, and only regular files under evidence/remediation', async () => {
  const { captureFacts } = await import('../scripts/io/capture-facts.mjs');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-facts-'));
  try {
    const ev = path.join(base, 'evidence', 'remediation');
    fs.mkdirSync(ev, { recursive: true });
    const rule = '-'.repeat(72);
    fs.writeFileSync(path.join(ev, 'red.txt'), ['$ node --test tests/a.test.mjs', '# admitted: test_one tests/a.test.mjs', '# cwd: x', '# exit: 1',
      '# timeout: 15 minute(s)', '# captured: 2026-10-13T10:00:00.000Z', rule, '# admitted: test_one tests/forged.test.mjs', '# exit: 0', '# timed-out: forged', ''].join('\n'));
    fs.writeFileSync(path.join(base, 'outside.txt'), 'x');
    const f = captureFacts(base, ['evidence/remediation/red.txt', '../outside.txt', 'evidence/remediation', 'evidence/remediation/none.txt']);
    // `outcome` added by check-outcomes stage 4: the header's own, so the forged lines after the rule decide nothing.
    assert.deepEqual(f['evidence/remediation/red.txt'], { admitted: 'test_one', file: 'tests/a.test.mjs', exit: 1, timed_out: false, captured: '2026-10-13T10:00:00.000Z', outcome: 'failed' });
    assert.equal(f['../outside.txt'], null);
    assert.equal(f['evidence/remediation'], null);
    assert.equal(f['evidence/remediation/none.txt'], null);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------- stage 6: the documents

const docText = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const remediateRow = () => docText('shared/claude-md-contract.md').split('\n').find((l) => l.startsWith('| `scripts/remediate.mjs`')) ?? '';

test('stage 6: the remediate row states the refusal before the node, the candidate check, and which checks refuse', () => {
  const row = remediateRow();
  assert.match(row, /commit or stash/, 'dirty_at_start\'s new meaning: dirty source, test and input work refuses before the node');
  assert.match(row, /`full_checks`/, 'the recorded checked state');
  assert.match(row, /`build`, `test`, `lint` and `typecheck` refuse/);
  assert.match(row, /lint and typecheck refuse here while they only stamp a review/i);
  assert.match(row, /`evidence\/remediation-runner\/`/);
  assert.doesNotMatch(row, /what had changed before it began; a refusal is/, 'the old meaning, tolerated and left to the operator, is gone');
});

test('stage 6: check_timeout_minutes says it also bounds each check the runner runs on its candidate', () => {
  assert.match(docText('shared/claude-md-contract.md'), /each check the remediation runner runs on its commit candidate/);
});

test('stage 6: the §7 rows name the full check\'s kinds and the evidence gate', () => {
  const doc = docText('shared/disk-first-protocol.md');
  const commitRow = doc.split('\n').find((l) => l.startsWith('| `COMMIT-CHECK`')) ?? '';
  for (const k of ['full-run-red', 'tree-not-candidate', 'evidence-refused', 'committed-differs']) assert.ok(commitRow.includes(`\`${k}\``), `${k} in the COMMIT-CHECK row`);
  const reportRow = doc.split('\n').find((l) => l.startsWith('| `REPORT-CHECK`')) ?? '';
  assert.match(reportRow, /refuses the group at admission/);
  assert.match(doc, /\*\*The runner checks what it commits\.\*\*/, '§3 states the narrow captures are the node\'s and the whole is the runner\'s');
});

test('stage 6: shared/remediation.md states the residuals the candidate check accepts', () => {
  const doc = docText('shared/remediation.md');
  assert.match(doc, /## The candidate check is the check of the whole/);
  assert.match(doc, /could write the channel files/);
  assert.match(doc, /share one test home/);
  assert.match(doc, /intermediate commit/);
});

test('stage 6: skills/remediate states the narrow check, the refusal before the node, the candidate check, the gate and the count', () => {
  const skill = docText('skills/remediate/SKILL.md');
  assert.match(skill, /commands\.test_one/);
  assert.match(skill, /commit or stash/i);
  assert.match(skill, /full-run-red/);
  assert.match(skill, /evidence-refused/);
  assert.match(skill, /counted-facts drift/);
  assert.doesNotMatch(skill, /only files git shows changed since the run began and the contract's globs admit, with a test unless/,
    'the commit description predates the candidate check');
});

// ---------------------------------------------------------------------------------------------- stage 2: the limits

test('stage 2: capture with no --timeout-minutes runs under the contract\'s check_timeout_minutes', () => {
  const { base, dir } = remediationRun({ contract: { commands: { build: 'node --version', shell: '' }, review: { check_timeout_minutes: 7 } } });
  try {
    const r = cap(dir, 'remediation', ['node', '--version']);
    assert.equal(r.status, 0, r.output);
    assert.match(logOf(dir, 'remediation'), /^# timeout: 7 minute\(s\)$/m);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('stage 2: a malformed check_timeout_minutes refuses the capture, naming the key', () => {
  const { base, dir } = remediationRun({ contract: { commands: { build: 'node --version', shell: '' }, review: { check_timeout_minutes: 'soon' } } });
  try {
    const r = cap(dir, 'remediation', ['node', '--version']);
    assert.equal(r.status, 2, r.output);
    assert.match(r.output, /check_timeout_minutes/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('stage 2: the remediation node\'s limit is the roster entry\'s own, else the contract\'s node limit, else its default, 30', async () => {
  const { remediationTimeoutMinutes } = await import('../scripts/lib/remediation-chain.mjs');
  assert.equal(remediationTimeoutMinutes({ timeout_minutes: 45 }, { node_timeout_minutes: 60 }), 45);
  assert.equal(remediationTimeoutMinutes({}, { node_timeout_minutes: 60 }), 60);
  assert.equal(remediationTimeoutMinutes(undefined, {}), 30);
  assert.throws(() => remediationTimeoutMinutes({ timeout_minutes: 0 }, {}), /timeout_minutes/);
  assert.throws(() => remediationTimeoutMinutes({ timeout_minutes: 'x' }, {}), /timeout_minutes/);
});

test('stage 2: remediate.mjs spawns the node under that one decision, reading the roster entry', () => {
  const src = fs.readFileSync(new URL('../scripts/remediate.mjs', import.meta.url), 'utf8');
  assert.match(src, /remediationTimeoutMinutes\(/);
  // The remediation entry lives under barrier_nodes, not lenses: a lookup in lenses alone found nothing and fell back
  // to the contract silently (caught while writing this stage).
  assert.match(src, /roster\.barrier_nodes/, 'the roster lookup does not search barrier_nodes, where the remediation entry is');
  const roster = JSON.parse(fs.readFileSync(new URL('../scripts/lens-roster.json', import.meta.url), 'utf8'));
  assert.ok((roster.barrier_nodes ?? []).some((n) => n.id === 'remediation'), 'the remediation entry moved; follow it');
  assert.doesNotMatch(src, /String\(Number\(review\.node_timeout_minutes \?\? 15\)\)/, 'the inline fallback is still there');
});
