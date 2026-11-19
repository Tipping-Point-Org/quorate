// remediate-runner-fixture.mjs — the fixture and helpers regression-remediate-runner.test.mjs and its siblings share,
// moved out unchanged when the file was split (split-slow-test-files.md). Every top-level name is exported.


import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir, SCRIPTS_DIR } from './helpers.mjs';
import { hostPlatform } from '../scripts/platform/index.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

// The fake node: fixes src/a.js, adds a test, and reports its cluster and files; the runner commits.
async function fakeNode() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const runDir = process.env.FAKE_RUN_DIR;
  const repo = process.env.FAKE_REPO;
  // The prompt arrives on stdin since decision-panel-seats.plan.md stage 2 (the argv carries the bare -p); reading fd 0
  // returns '' for an ignored stdin, so a call with none never blocks.
  let stdinText = '';
  try { stdinText = fs.readFileSync(0, 'utf8'); } catch { /* an ignored stdin */ }
  const prompt = `${process.argv.slice(2).join(' ')} ${stdinText}`;
  // new-run probes the runtime with --version when it mints a run; that is not a node.
  if (process.argv.includes('--version')) { process.stdout.write('0.0.0 (fake)'); return; }
  if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, prompt.includes('remediation/PROMPT.md') || prompt.includes('# remediation') ? 'contract\n' : 'other\n');
  // FAKE_MODE: '' a proper fix; 'empty' reports nothing; 'notest' fixes source only with no red; 'badevidence' cites
  // evidence it never wrote.
  const mode = process.env.FAKE_MODE ?? '';
  const ev = path.join(runDir, 'evidence', 'remediation');
  fs.mkdirSync(ev, { recursive: true });
  let payload;
  // 'wait' signals that it started (FAKE_STARTED) and blocks until the test writes FAKE_RELEASE — so the test can kill
  // the runner while the node is still running (remediation-run-ownership stage 3).
  if (mode === 'wait') {
    fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'edited while the runner was killed\n');
    // Its pid, so a test can wait for this process itself to be gone (G-13 of 20261107-072037-split-delivery-3).
    fs.writeFileSync(process.env.FAKE_STARTED, String(process.pid));
    const until = Date.now() + 60000;
    while (!fs.existsSync(process.env.FAKE_RELEASE) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    fs.writeFileSync(process.env.FAKE_RELEASE + '.done', 'done');
    process.exit(1);
  }
  // 'crash' edits the files and dies before reporting, as an interrupted node does.
  if (mode === 'crash') {
    fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'half a fix\n');
    fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 'half a test\n');
    process.exit(1);
  }
  // 'e2e' (remediation-verification stage 7): a real experiment through the real capture.mjs and commands.test_one — a
  // test that fails on the unfixed source, captured red; the fix (FAKE_E2E_FIX, default 'fixed'); the same test captured
  // green, unless FAKE_E2E_SKIP_GREEN.
  if (mode === 'e2e') {
    const cap = (name) => spawnSync(process.execPath, [process.env.FAKE_CAPTURE, '--run-dir', runDir, '--node', 'remediation', '--name', name,
      '--', 'node', '--test', 'tests/a.test.js'], { cwd: repo, encoding: 'utf8' });
    fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), [
      "const { test } = require('node:test');", "const assert = require('node:assert');", "const fs = require('node:fs');",
      "test('a is fixed', () => assert.match(fs.readFileSync('src/a.js', 'utf8'), /fixed/));", ''].join('\n'));
    const red = cap('red');
    fs.writeFileSync(path.join(repo, 'src', 'a.js'), process.env.FAKE_E2E_FIX ?? 'fixed\n');
    const green = process.env.FAKE_E2E_SKIP_GREEN ? null : cap('green');
    payload = { schema_version: 1, run_id: path.basename(runDir), summary: 'fixed G-1', groups: [{ group_id: 'G-1', disposition: 'fixed',
      reason: 'the guard was missing', red_evidence: red.stdout.trim(), green_evidence: green ? green.stdout.trim() : '', cluster: 'c1',
      files: ['src/a.js', 'tests/a.test.js'], search_command: 'git grep -n guard', deferred: [] }] };
  } else if (mode === 'empty') {
    payload = { schema_version: 1, run_id: path.basename(runDir), summary: 'did nothing', groups: [] };
  } else {
    const paths = [];
    if (!mode.endsWith('testonly')) { fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'fixed\n'); paths.push('src/a.js'); }
    if (!mode.startsWith('notest')) { fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 'red then green\n'); paths.push('tests/a.test.js'); }
    // CAPTURES, as capture.mjs writes them (remediation-verification stage 5: the runner reads the header): a test_one red
    // that failed, then a test_one green of the same file that passed, later.
    const capture = (file, exit, at) => [`$ node --test ${file}`, `# admitted: test_one ${file}`, `# cwd: ${repo}`, `# exit: ${exit}`,
      '# timeout: 15 minute(s)', `# captured: ${at}`, '-'.repeat(72), ''].join('\n');
    if (mode !== 'badevidence') {
      fs.writeFileSync(path.join(ev, 'red.txt'), capture('tests/a.test.js', 1, '2026-10-13T10:00:00.000Z'));
      fs.writeFileSync(path.join(ev, 'green.txt'), capture('tests/a.test.js', 0, '2026-10-13T10:05:00.000Z'));
    }
    // 'multigreen': the fix changed a second test file too, and its green is listed beside the first.
    if (mode === 'multigreen') {
      fs.writeFileSync(path.join(repo, 'tests', 'b.test.js'), 'adjusted\n'); paths.push('tests/b.test.js');
      fs.writeFileSync(path.join(ev, 'green-b.txt'), capture('tests/b.test.js', 0, '2026-10-13T10:06:00.000Z'));
    }
    // FAKE_WRITE (JSON {path: content}) writes extra files; FAKE_FILES (JSON [paths]) replaces the reported list. The node
    // does not commit: the runner does, after it exits (remediation-paths stages 3+4).
    // FAKE_RM (JSON [paths]) removes paths first — e.g. a nested repository's .git, turning it into plain files.
    for (const p of JSON.parse(process.env.FAKE_RM || '[]')) fs.rmSync(path.join(repo, p), { recursive: true, force: true });
    // FAKE_GIT_INIT (JSON [dirs]) makes each a nested repository: another repository the node's run created.
    for (const d of JSON.parse(process.env.FAKE_GIT_INIT || '[]')) {
      fs.mkdirSync(path.join(repo, d), { recursive: true });
      spawnSync('git', ['init', '-q'], { cwd: path.join(repo, d) });
    }
    for (const [p, body] of Object.entries(JSON.parse(process.env.FAKE_WRITE || '{}'))) {
      fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true });
      fs.writeFileSync(path.join(repo, p), body);
    }
    // FAKE_JUNCTION (JSON {path: absolute target directory}): a directory link at each path, a junction on Windows (which needs
    // no privilege), so a link at a parent level of a reported file can be seen (set-aside-identity.plan.md stage 1).
    for (const [p, target] of Object.entries(JSON.parse(process.env.FAKE_JUNCTION || '{}'))) {
      fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true });
      fs.symlinkSync(target, path.join(repo, p), process.platform === 'win32' ? 'junction' : 'dir');
    }
    // FAKE_HARDLINK (JSON {path: absolute other name}): a second hard link to each written path, so a set-aside file with
    // more than one link can be seen (G-9 of 20261108-021347-si-remediation-2-review). NTFS needs no privilege for one.
    for (const [p, other] of Object.entries(JSON.parse(process.env.FAKE_HARDLINK || '{}'))) fs.linkSync(path.join(repo, p), other);
    const files = process.env.FAKE_FILES ? JSON.parse(process.env.FAKE_FILES) : paths;
    payload = { schema_version: 1, run_id: process.env.FAKE_RUN_ID || path.basename(runDir), summary: 'fixed G-1',
      groups: [{ group_id: process.env.FAKE_GROUP_ID || 'G-1', disposition: mode === 'partialtestonly' ? 'partial' : 'fixed', reason: mode.startsWith('notest') ? 'not expressible as a test: a comment' : 'the guard was missing',
        red_evidence: process.env.FAKE_RED_EVIDENCE ?? (mode.startsWith('notest') ? '' : 'evidence/remediation/red.txt'),
        // notest-nogreen: a claim not expressible as a test, so neither red nor green (G-11 of 20261014-000825-...-2-review).
        green_evidence: mode === 'nogreen' || mode === 'notest-nogreen' ? '' : mode === 'multigreen'
          ? 'evidence/remediation/green.txt; evidence/remediation/green-b.txt' : 'evidence/remediation/green.txt', cluster: process.env.FAKE_CLUSTER || 'c1', files,
        // A notest fix declares why it has no red (G-1 of 20261023-062611-rer-remediation-review-2): undeclared, it is refused.
        ...(mode.startsWith('notest') ? { no_red: 'a comment, which no test can observe' } : {}),
        search_command: 'git grep -n guard', deferred: [] }] };
    // FAKE_GROUP_EXTRA (JSON): fields merged into the first group, such as a stop reason (remediation-consumer-findings stage 4).
    if (process.env.FAKE_GROUP_EXTRA) Object.assign(payload.groups[0], JSON.parse(process.env.FAKE_GROUP_EXTRA));
    // FAKE_SECOND: a second group, in its own cluster, naming the same files — so the runner must merge them.
    if (process.env.FAKE_SECOND) payload.groups.push({ ...payload.groups[0], group_id: 'G-2', cluster: 'c2' });
    // FAKE_SECOND_FILES (JSON [paths]): a second group in its own cluster with files of its own, so two commits are made.
    if (process.env.FAKE_SECOND_FILES) {
      const files2 = JSON.parse(process.env.FAKE_SECOND_FILES);
      const t2 = files2.find((p) => p.startsWith('tests/'));
      fs.writeFileSync(path.join(ev, 'red2.txt'), capture(t2, 1, '2026-10-13T10:10:00.000Z'));
      fs.writeFileSync(path.join(ev, 'green2.txt'), capture(t2, 0, '2026-10-13T10:15:00.000Z'));
      payload.groups.push({ ...payload.groups[0], group_id: 'G-2', cluster: 'c2', files: files2,
        red_evidence: 'evidence/remediation/red2.txt', green_evidence: 'evidence/remediation/green2.txt' });
    }
  }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.01,
    ...(process.env.FAKE_TERMINAL_REASON ? { terminal_reason: process.env.FAKE_TERMINAL_REASON } : {}),
    usage: { input_tokens: 1, output_tokens: 1 }, result: JSON.stringify(payload) }));
}

// Where the remediation run is now: staged until it ends, then archived into the repository (remediate.mjs archives it).
function remAt(f) {
  return fs.existsSync(path.join(f.rem, 'run.json')) ? f.rem : path.join(f.repo, '.claude', 'reviews', path.basename(f.rem));
}

function fixture(t, { panel = false, beforeRemediates = null } = {}) {
  // As the filesystem spells it, the spelling the runner reports (long where TEMP is an 8.3 short path, CI run 43281517496).
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-remrunner-')));
  // RETRIED (ci-path-identity.plan.md stage 3b): on the Windows runner the removal after a killed runner got EPERM (PR #3,
  // rro stage 3), the tracked fake node already gone. Read as a process of the killed tree, the launcher around the fake
  // node, still holding its working directory there for a moment. Unverified: the log does not name the holder. The orphan
  // check in each test stays the guard against a child left running.
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const repo = path.join(base, 'repo');
  for (const d of ['src', 'tests']) fs.mkdirSync(path.join(repo, d), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 't\n');
  const yaml = ['graph_contract_version: 5', 'project: remrunner-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'test_globs: ["tests/**"]', 'doc_paths: []', 'ui:', '  surface: none',
    '  static_bundle: ""', 'review:', `  external_panel: ${panel}`].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', yaml, '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/reviews/\n');
  git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 'x@x'); git(repo, 'config', 'user.name', 'x');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeNode.toString()})();`);
  const home = path.join(base, 'home');
  const log = path.join(base, 'calls.log');
  const env = { QUORATE_HOME: home, FAKE_REPO: repo, FAKE_LOG: log,
    CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' };
  // WITH THE PANEL ON, reviewers that always fail come first on PATH: whatever this fixture's mints do, none can reach the
  // operator's real codex or agy.
  if (panel) {
    const failing = path.join(base, 'failing-bin');
    fs.mkdirSync(failing);
    for (const n of ['codex', 'agy']) {
      if (process.platform === 'win32') fs.writeFileSync(path.join(failing, `${n}.cmd`), '@exit /b 1\r\n');
      else { fs.writeFileSync(path.join(failing, n), '#!/bin/sh\nexit 1\n'); fs.chmodSync(path.join(failing, n), 0o755); }
    }
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    env[pathKey] = `${failing}${path.delimiter}${process.env[pathKey] ?? ''}`;
  }
  const mint = (extra) => runScript('new-run.mjs', ['--repo-root', repo, '--no-request', '--no-verify-sandbox',
    '--runtime-bin', bin, ...(panel ? ['--no-verify-reviewers'] : []), ...extra], { cwd: repo, env, mayProbe: panel });
  const reviewed = mintedRunDir(mint(['--slug', 'rev', '--full-sweep', 'src']).output);
  fs.writeFileSync(path.join(reviewed, 'reconciled.md'), '# Reconciled\n\n## Confirmed (1)\n\n### G-1 · MEDIUM · `src/a.js:1`\n');
  fs.writeFileSync(path.join(reviewed, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  fs.writeFileSync(path.join(reviewed, 'finding-groups.json'), JSON.stringify({ groups: [{ group_id: 'G-1', file: 'src/a.js', line: 1 }] }));
  fs.mkdirSync(path.join(reviewed, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(reviewed, 'evidence', 'reconcile', 'payload.json'),
    JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }] }));
  // A test that plants something in the reviewed run before the remediation run is minted does it here, and gets the
  // mint's own output back when it refuses (no remediation run then exists).
  if (beforeRemediates) {
    beforeRemediates(reviewed);
    const r = mint(['--slug', 'fix', '--remediates', reviewed]);
    return { repo, bin, env, log, reviewed, rem: null, mint: r };
  }
  const rem = mintedRunDir(mint(['--slug', 'fix', '--remediates', reviewed]).output);
  return { repo, bin, env, log, reviewed, rem };
}











// ------------------------------------------------- the delivery review, 20261008-214527-remediate-rebuild-review
const runRem = (f, extra = [], env = {}) => runScript('remediate.mjs', ['--run-dir', remAt(f), '--runtime-bin', f.bin, '--no-verify-sandbox', ...extra],
  { cwd: f.repo, env: { ...f.env, FAKE_RUN_DIR: remAt(f), ...env } });
const readRem = (f) => JSON.parse(fs.readFileSync(path.join(remAt(f), 'run.json'), 'utf8'));

// run-dir-reads.plan.md stage 4 (R-D3 A; G-17, G-18 of 20261029-065343-rdd-remediation-2-review): the reviewed run's
// reconcile payload was read raw below the admitted directory, so a link at evidence/reconcile/ resolving back inside the
// run was followed. Both ends now read it through the reviewed run's owner: new-run refuses to mint from it, and the
// runner, given a run minted before the link was planted, says the payload could not be read.
const linkReconcileInside = (reviewed) => {
  const real = path.join(reviewed, 'evidence', 'real-reconcile');
  fs.renameSync(path.join(reviewed, 'evidence', 'reconcile'), real);
  fs.symlinkSync(real, path.join(reviewed, 'evidence', 'reconcile'), process.platform === 'win32' ? 'junction' : 'dir');
};
// Edit the remediation run's frozen contract, which is what the runner reads.
const setContract = (f, edit) => {
  const run = readRem(f);
  edit(run.contract);
  fs.writeFileSync(path.join(remAt(f), 'run.json'), JSON.stringify(run));
};































// remediation-run-ownership stage 3 (D2): one runner per run. G-5 of 20261009-014530-remediation-paths-r2: two
// invocations on one run raced, and a runner killed between the spawn and its save left the node's edits with no record
// — a re-run then retook dirty_at_start over them and could never commit them.
const lockOf = (f) => path.join(remAt(f), 'remediate.lock');




// The lock-order source test lives in tests/regression-remediation-run-ownership.test.mjs ("nothing reads run.json
// before the lock, in any spelling"): the one that stood here matched only the literal readRun(runDir) (G-12 of
// 20261009-035141-run-ownership-review).








// ------------------------------------------------- remediation-verification stage 4c: the runner's full check
// The runner checks the commit candidate in place, through every declared pre-flight command, before the first commit
// (operator, 2026-10-13: "The runner, once (Recommended)", "In place, guarded", "Build, test, lint, typecheck", "Gate on
// failing tests"). The node's own red and green are narrow; this is the check of the whole, and dec1158a — committed
// while the node said its work was unverified — is what it prevents.
const CHECK_SCRIPT = [
  "const fs = require('node:fs');",
  "const kind = process.argv[2] || 'test';",
  "if (kind !== 'test') process.exit(Number(process.env[kind.toUpperCase() + '_EXIT'] || 0));",
  "const mode = process.env.CHECK_MODE || 'pass';",
  "if (mode === 'pass') { console.log('# tests 3\\n# pass 3\\n# fail 0'); process.exit(0); }",
  "if (mode === 'fail') { console.log('not ok 1 - the guard holds\\n# tests 3\\n# pass 2\\n# fail 1'); process.exit(1); }",
  "if (mode === 'drift') {",
  "  fs.writeFileSync(process.env.QUORATE_COUNT_FILE, '30');",
  "  fs.writeFileSync(process.env.QUORATE_FACTS_FILE, JSON.stringify({ tests: 30, min_tests: 20, drifted: true, failed_suites: [], message: 'README.md states 29 tests; the tree has 30.' }));",
  "  console.log('# tests 30\\n# pass 30\\n# fail 0'); process.exit(1);",
  "}",
  // 4d: a suite that rewrites a candidate file, or commits, while it runs — the tree after the check is not the one checked.
  "if (mode === 'touch') { fs.writeFileSync('src/a.js', 'rewritten by the suite\\n'); console.log('# tests 3\\n# pass 3\\n# fail 0'); process.exit(0); }",
  "if (mode === 'commit') { require('node:child_process').spawnSync('git', ['-c', 'user.email=x@x', '-c', 'user.name=x', 'commit', '-q', '--allow-empty', '-m', 'made by the suite']); console.log('# tests 3\\n# pass 3\\n# fail 0'); process.exit(0); }",
  "console.log('# tests 3\\n# pass 3\\n# fail 0'); process.exit(1);",   // 'exit1': non-zero, none failing, no facts
].join('\n');
// The check script sits at the root, untracked: neither source nor test, so the guard lets it through.
function checkedFixture(t, commands) {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'check.cjs'), CHECK_SCRIPT);
  // The variables the check script is steered by are DECLARED, as a suite's own needs are under the candidate
  // environment's allow-list (candidate-check-boundaries.plan.md stage 2); undeclared, they never reach it.
  setContract(f, (c) => {
    c.commands = { ...(c.commands ?? {}), ...commands };
    c.review = { ...(c.review ?? {}), candidate_env: ['CHECK_MODE', 'LINT_EXIT', 'AUDIT_EXIT'] };
  });
  return f;
}
const headOf = (f) => git(f.repo, 'rev-parse', 'HEAD').stdout.trim();















// ------------------------------------------------- remediation-verification stage 7: end to end
// The node's red and green go through the real capture.mjs with commands.test_one, and the runner's candidate check runs
// a real declared suite: `node --test` over tests/*.test.js. tests/other.test.js, committed, holds src/a.js to a short
// line, so a fix that lengthens it breaks a test the node never ran.
function e2eFixture(t) {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'tests', 'other.test.js'), [
    "const { test } = require('node:test');", "const assert = require('node:assert');", "const fs = require('node:fs');",
    "test('a stays short', () => assert.ok(fs.readFileSync('src/a.js', 'utf8').length < 12));", ''].join('\n'));
  git(f.repo, 'add', 'tests/other.test.js');
  git(f.repo, 'commit', '-qm', 'another test');
  setContract(f, (c) => { c.commands = { ...(c.commands ?? {}), test: 'node --test tests/*.test.js', test_one: 'node --test {file}' }; });
  return f;
}
// NODE_TEST_CONTEXT unset: inherited from this suite, it makes every nested `node --test` skip its files and exit 0.
const e2eEnv = (extra = {}) => ({ FAKE_MODE: 'e2e', FAKE_CAPTURE: path.join(SCRIPTS_DIR, 'capture.mjs'), NODE_TEST_CONTEXT: undefined, ...extra });








// WHAT A REMEDIATION LEAVES IN THE TREE IS NAMED (.claude/requests/remediation-left-in-tree.md; story-pipeline run
// 20261016-234106-remediate-local-only-r2): a node that lost write access after writing its red test reported nothing
// committable, and the untracked test stayed in the tree, in neither clusters[].files nor commit_check, turning every later
// full check red. Judged on git's answer, whatever made the node stop.
const leftInTree = (run) => (run.commit_check ?? []).filter((e) => e.kind === 'left-in-tree').map((e) => e.file).sort();







// A NEW FILE IS PART OF THE CANDIDATE (remediation 20261020-125626-ciss-remediation-5): the full check ran in place with
// the node's new module still untracked, and the suite's "every module the engine imports is tracked" test failed on it,
// so a fix that adds a module could never commit. The check now sees the candidate's new files as git will commit them.
// A committed suite that fails unless git tracks `file`, so the full check reads a real test count.
function trackedSuite(f, file) {
  fs.writeFileSync(path.join(f.repo, 'tests', 'tracked.test.js'), [
    "const { test } = require('node:test');", "const assert = require('node:assert');",
    "const { spawnSync } = require('node:child_process');",
    `test('tracked', () => assert.equal(spawnSync('git', ['ls-files', '--error-unmatch', ${JSON.stringify(file)}]).status, 0));`, ''].join('\n'));
  git(f.repo, 'add', '-A'); git(f.repo, 'commit', '-qm', 'tracked suite');
  setContract(f, (c) => { c.commands = { ...(c.commands ?? {}), test: 'node --test tests/tracked.test.js' }; });
}







const repoLockOf = async (f) => (await import('../scripts/io/repo-lock.mjs')).repoLockPath(f.repo, { home: f.env.QUORATE_HOME });
const holdRepoLock = async (f, record) => {
  const p = await repoLockOf(f);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ run_id: 'other-remediation', started_at: '2026-10-20T11:43:09.000Z', ...record }));
  return p;
};









// THE BLOCKER IS THE RUNNER'S OWN CLUSTER (remediation-consumer-findings.plan.md stage 5, AC4; operator, 2026-10-20: "Keep
// refusal, better message"). A test-only cluster is refused as not a fix, and its edit then blocked every other cluster
// as a change outside their candidate; the message named the file, not that this run put it there (20261020-164157).
const GUARD_TODAY = 'the working tree holds changes the checks would read and no commit carries: tests/x.test.js (a test file changed '
  + 'outside the candidate); commit, stash or discard them, then --retry-commits — and when the fix needs them, this run cannot '
  + 'commit it: discard its clusters\' edits and mint a new remediation run (plan stage 4)';




export { git, fakeNode, remAt, fixture, runRem, readRem, linkReconcileInside, setContract, lockOf, CHECK_SCRIPT, checkedFixture, headOf, e2eFixture, e2eEnv, leftInTree, trackedSuite, repoLockOf, holdRepoLock, GUARD_TODAY };
