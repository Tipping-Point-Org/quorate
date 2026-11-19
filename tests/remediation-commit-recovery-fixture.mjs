// remediation-commit-recovery-fixture.mjs — the fixture and helpers regression-remediation-commit-recovery.test.mjs and
// its siblings share, moved out unchanged when the file was split (split-slow-test-files.md). Every top-level name is
// exported.


import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';
import { admitGroups } from '../scripts/lib/remediation-chain.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

// The fake node: fixes src/a.js with a test, one cluster, and logs each spawn.
async function fakeNode() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (process.argv.includes('--version')) { process.stdout.write('0.0.0 (fake)'); return; }
  const runDir = process.env.FAKE_RUN_DIR;
  const repo = process.env.FAKE_REPO;
  fs.appendFileSync(process.env.FAKE_LOG, 'spawned\n');
  if (process.env.FAKE_SPY) fs.appendFileSync(process.env.FAKE_SPY, 'marker node\n');
  const ev = path.join(runDir, 'evidence', 'remediation');
  fs.mkdirSync(ev, { recursive: true });
  // CAPTURES, as capture.mjs writes them (remediation-verification stage 5): a test_one red, then a later passing green.
  const capture = (file, exit, at) => [`$ node --test ${file}`, `# admitted: test_one ${file}`, `# cwd: ${repo}`, `# exit: ${exit}`,
    '# timeout: 15 minute(s)', `# captured: ${at}`, '-'.repeat(72), ''].join('\n');
  fs.writeFileSync(path.join(ev, 'red.txt'), capture('tests/a.test.js', 1, '2026-10-13T10:00:00.000Z'));
  fs.writeFileSync(path.join(ev, 'green.txt'), capture('tests/a.test.js', 0, '2026-10-13T10:05:00.000Z'));
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'fixed\n');
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 'red then green\n');
  const payload = { schema_version: 1, run_id: path.basename(runDir), summary: 'fixed', groups: [{ group_id: 'G-1',
    disposition: 'fixed', reason: 'the guard was missing', red_evidence: 'evidence/remediation/red.txt',
    green_evidence: 'evidence/remediation/green.txt', cluster: 'c1', files: ['src/a.js', 'tests/a.test.js'],
    search_command: 'git grep -n guard', deferred: [] }] };
  // FAKE_MODE no-red: G-1 declares no possible red (no_red), its red empty. test-only: G-1 changes only its test file.
  if (process.env.FAKE_MODE === 'no-red') Object.assign(payload.groups[0], { red_evidence: '', no_red: 'a read no test can observe' });
  if (process.env.FAKE_MODE === 'test-only') {
    fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
    payload.groups[0].files = ['tests/a.test.js'];
  }
  // FAKE_TWO: a second group, G-2, in its own cluster with its own files.
  if (process.env.FAKE_TWO) {
    fs.writeFileSync(path.join(repo, 'src', 'b.js'), 'fixed\n');
    fs.writeFileSync(path.join(repo, 'tests', 'b.test.js'), 'red then green\n');
    fs.writeFileSync(path.join(ev, 'red-b.txt'), capture('tests/b.test.js', 1, '2026-10-13T10:10:00.000Z'));
    fs.writeFileSync(path.join(ev, 'green-b.txt'), capture('tests/b.test.js', 0, '2026-10-13T10:15:00.000Z'));
    payload.groups.push({ ...payload.groups[0], group_id: 'G-2', cluster: 'c2', files: ['src/b.js', 'tests/b.test.js'],
      red_evidence: 'evidence/remediation/red-b.txt', green_evidence: 'evidence/remediation/green-b.txt' });
  }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.01,
    usage: { input_tokens: 1, output_tokens: 1 }, result: JSON.stringify(payload) }));
}

// hook: true refuses every message without a Doc-Impact trailer; 'g2' refuses only G-2's.
// mode: FAKE_MODE above. gatedBuild: commands.build passes only while <base>/ok exists, so the runner's check of the
// candidate can be made to refuse a first run and pass its retry.
// spy: src/*.js passes through a clean filter that logs SPY_API_TOKEN as it sees it, to <base>/spy.log.
function fixture(t, { hook = true, two = false, mode = '', gatedBuild = false, spy = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-remretry-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const okFile = path.join(base, 'ok');
  if (gatedBuild) {
    fs.writeFileSync(path.join(base, 'check.mjs'), "import fs from 'node:fs'; process.exit(fs.existsSync(process.argv[2]) ? 0 : 1);\n");
    fs.writeFileSync(okFile, '');
  }
  const fwd = (p) => p.split(path.sep).join('/');
  const repo = path.join(base, 'repo');
  for (const d of ['src', 'tests']) fs.mkdirSync(path.join(repo, d), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 't\n');
  fs.writeFileSync(path.join(repo, 'src', 'b.js'), 'b\n');
  fs.writeFileSync(path.join(repo, 'tests', 'b.test.js'), 't\n');
  const build = gatedBuild ? `"node ${fwd(path.join(base, 'check.mjs'))} ${fwd(okFile)}"` : '""';
  const yaml = ['graph_contract_version: 6', 'project: remretry-fixture', 'commands:', `  build: ${build}`, '  test: ""',
    'source_globs: ["src/**"]', 'test_globs: ["tests/**"]', 'doc_paths: []', 'ui:', '  surface: none',
    '  static_bundle: ""', 'review:', '  external_panel: false'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', yaml, '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/reviews/\n');
  git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 'x@x'); git(repo, 'config', 'user.name', 'x');
  const spyLog = path.join(base, 'spy.log');
  if (spy) {
    fs.writeFileSync(path.join(base, 'spy.mjs'), "import fs from 'node:fs'; const [log, kind] = process.argv.slice(2); fs.appendFileSync(log, kind + ' ' + (process.env.SPY_API_TOKEN ?? 'none') + ' sock=' + (process.env.SSH_AUTH_SOCK ?? 'none') + ' depth=' + (process.env.GRAPH_NODE_DEPTH ?? 'none') + '\\n'); if (kind === 'fsm') process.exit(1); process.stdout.write(fs.readFileSync(0));\n");
    fs.writeFileSync(path.join(repo, '.gitattributes'), 'src/*.js filter=spy\n');
    git(repo, 'config', 'filter.spy.clean', `node ${fwd(path.join(base, 'spy.mjs'))} ${fwd(spyLog)} filter`);
    // engine-git-env stage 2: an fsmonitor hook runs on EVERY index refresh, whatever the files' state, so it observes
    // each status and diff the follow-up mint makes; a clean filter runs only for a file git must hash. Exiting 1 makes
    // git fall back to its own scan.
    git(repo, 'config', 'core.fsmonitor', `node ${fwd(path.join(base, 'spy.mjs'))} ${fwd(spyLog)} fsm`);
  }
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');
  // G-18 of 20261023-205906-ger-delivery: phase markers in the spy log, so a socket seen outside the commit is caught. The
  // fake node marks where the runner hands over to it; post-commit marks the end of each `git commit`'s own work.
  if (spy) {
    const pc = path.join(repo, '.git', 'hooks', 'post-commit');
    fs.writeFileSync(pc, ['#!/bin/sh', `echo "marker post-commit" >> "${fwd(spyLog)}"`, ''].join('\n'));
    fs.chmodSync(pc, 0o755);
  }
  // The consumer's hook: a commit message without a Doc-Impact trailer is refused, as story-pipeline's contract-doc is.
  if (hook) {
    const h = path.join(repo, '.git', 'hooks', 'commit-msg');
    fs.writeFileSync(h, ['#!/bin/sh', ...(hook === 'g2' ? ['grep -q "G-2" "$1" || exit 0'] : []), 'grep -q "^Doc-Impact: " "$1" || { echo "[contract-doc] BLOCKED - add a Doc-Impact trailer" >&2; exit 1; }', ''].join('\n'));
    fs.chmodSync(h, 0o755);
  }
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, `(${fakeNode.toString()})();`);
  const log = path.join(base, 'spawns.log');
  fs.writeFileSync(log, '');
  const env = { QUORATE_HOME: path.join(base, 'home'), FAKE_REPO: repo, FAKE_LOG: log,
    CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' };
  const mint = (extra) => runScript('new-run.mjs', ['--repo-root', repo, '--no-request', '--no-verify-sandbox',
    '--runtime-bin', bin, ...extra], { cwd: repo, env });
  const reviewed = mintedRunDir(mint(['--slug', 'rev', '--full-sweep', 'src']).output);
  fs.writeFileSync(path.join(reviewed, 'reconciled.md'), '# Reconciled\n\n## Confirmed (1)\n');
  fs.writeFileSync(path.join(reviewed, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  fs.mkdirSync(path.join(reviewed, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(reviewed, 'evidence', 'reconcile', 'payload.json'),
    JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' },
      ...(two ? [{ group_id: 'G-2', decision: 'confirmed', severity: 'MEDIUM' }] : [])] }));
  // The file each group was reported against, which a test-only cluster's admission reads (design E-D1).
  if (mode === 'test-only') fs.writeFileSync(path.join(reviewed, 'finding-groups.json'), JSON.stringify({ groups: [{ group_id: 'G-1', file: 'tests/a.test.js' }] }));
  const r = mint(['--slug', 'fix', '--remediates', reviewed]);
  assert.equal(r.status, 0, r.output);
  const rem = mintedRunDir(r.output);
  // Where the run is now: staged until it ends, then archived into the repository by remediate.mjs.
  const at = () => (fs.existsSync(path.join(rem, 'run.json')) ? rem : path.join(repo, '.claude', 'reviews', path.basename(rem)));
  const runRem = (extra = []) => runScript('remediate.mjs', ['--run-dir', at(), '--runtime-bin', bin, '--no-verify-sandbox', ...extra],
    { cwd: repo, env: { ...env, FAKE_RUN_DIR: at(), ...(two ? { FAKE_TWO: '1' } : {}), ...(mode ? { FAKE_MODE: mode } : {}),
      ...(spy ? { FAKE_SPY: spyLog } : {}) } });
  const readRem = () => JSON.parse(fs.readFileSync(path.join(at(), 'run.json'), 'utf8'));
  const spawns = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length;
  const head = () => git(repo, 'rev-parse', 'HEAD').stdout.trim();
  const setBuild = (passes) => (passes ? fs.writeFileSync(okFile, '') : fs.rmSync(okFile, { force: true }));
  const spied = () => (fs.existsSync(spyLog) ? fs.readFileSync(spyLog, 'utf8').split('\n').filter(Boolean) : []);
  return { repo, rem, at, runRem, readRem, spawns, head, setBuild, spied, spyLog: fwd(spyLog) };
}

// G-5 of 20261023-044746-rer-delivery: the candidate's `git hash-object --stdin-paths` ran with the operator's whole
// environment, so a repository's clean filter saw every secret the commit's own environment strips. Each of these three
// runs inside an existing test below, so the suite's count, which CLAUDE.md states, is unchanged.
function noSecretReachesACleanFilter(t) {
  const f = fixture(t, { hook: false, spy: true });
  const before = f.head();
  process.env['SPY_API_' + 'TOKEN'] = 'spy-secret-value';
  // G-3 of 20261023-062611-rer-remediation-review-2: the SSH agent socket crossed into every git call, so the clean filters
  // that status and hash-object run could use the operator's agent. Only the commit, which may sign, needs it.
  const sock = process.env.SSH_AUTH_SOCK;
  process.env.SSH_AUTH_SOCK = 'spy-agent-socket';
  const trace = process.env.GIT_TRACE;
  t.after(() => { delete process.env.SPY_API_TOKEN; if (sock === undefined) delete process.env.SSH_AUTH_SOCK; else process.env.SSH_AUTH_SOCK = sock;
    if (trace === undefined) delete process.env.GIT_TRACE; else process.env.GIT_TRACE = trace; });
  const setup = f.spied().length;   // the fixture's own git calls, before the runner
  // G-15 of 20261023-214545-ger-remediation-review: git traces each command it runs into the spy's own log, so every spy
  // line is attributed to the git subcommand that ran it, wherever in the run it falls.
  process.env.GIT_TRACE = f.spyLog;
  // Run THROUGH the follow-up mint (engine-git-env stage 2, G-15 of 20261023-081135-rer-remediation-3-review): new-run is
  // spawned with the operator's environment, for its canary and reviewer probes, and its git calls are scoped where they
  // run. Stopping before the mint left exactly those calls unobserved.
  const r = f.runRem([]);
  delete process.env.GIT_TRACE;
  assert.notEqual(f.head(), before, `not committed: ${r.output}`);
  const all = f.spied().slice(setup);
  const marked = all.filter((l) => /^(fsm|filter|marker) /.test(l));
  const ran = marked.filter((l) => !l.startsWith('marker '));
  assert.ok(ran.some((l) => l.startsWith('fsm ')), 'no git index refresh was observed, so nothing was checked');
  // G-17 of 20261023-205906-ger-delivery: fsmonitor alone satisfied the check above, so clean filtering could stop running
  // and the test still pass. The filter is what sees the file contents a commit hashes.
  assert.ok(ran.some((l) => l.startsWith('filter ')), `no clean filter was observed, so nothing was checked: ${ran.join(', ')}`);
  const leaked = ran.filter((l) => !/^\w+ none /.test(l));
  assert.deepEqual(leaked, [], `a git process the remediation started saw the secret: ${ran.join(', ')}`);
  const shallow = ran.filter((l) => /depth=(none|0)$/.test(l));
  assert.deepEqual(shallow, [], `a git process the remediation started ran below depth 1: ${ran.join(', ')}`);
  // `git commit` runs its hooks, filter and fsmonitor in the commit's environment, socket included; how often depends on
  // git's index timestamps. Every other call runs without it.
  assert.ok(ran.some((l) => l.includes(' sock=none ')), `every git process the runner started saw the SSH agent socket: ${ran.join(', ')}`);
  // G-18 of 20261023-205906-ger-delivery: one socket-free line satisfied the check above. Outside a commit, none may carry
  // it: before the runner hands over to the node, and after the last commit's post-commit hook (the follow-up mint).
  const node = marked.indexOf('marker node');
  const lastCommit = marked.lastIndexOf('marker post-commit');
  assert.ok(node >= 0 && lastCommit > node, `the phase markers were not observed: ${marked.join(', ')}`);
  const outside = [...marked.slice(0, node), ...marked.slice(lastCommit + 1)].filter((l) => !l.startsWith('marker ') && !l.includes(' sock=none '));
  assert.deepEqual(outside, [], `a git process outside the commit saw the SSH agent socket: ${marked.join(', ')}`);
  // G-15 of 20261023-214545-ger-remediation-review: the check above never looked between the node and the last commit,
  // where the runner's own status, add and hash-object run. Every spy line is now judged by the git subcommand that ran
  // it: only `git commit` may carry the socket.
  let sub = null; let middle = false; let ended = false; let checkedInMiddle = 0;
  const notCommit = [];
  const lastPost = all.lastIndexOf('marker post-commit');
  all.forEach((l, i) => {
    const b = l.match(/trace: built-in: git (?:--literal-pathspecs )?(\S+)/);
    if (b) { sub = b[1]; return; }
    if (l === 'marker node') middle = true;
    if (i >= lastPost) ended = true;
    if (!/^(fsm|filter) /.test(l)) return;
    if (sub !== 'commit' && !l.includes(' sock=none ')) notCommit.push(`git ${sub}: ${l}`);
    if (middle && !ended && sub !== 'commit') checkedInMiddle += 1;
  });
  assert.ok(all.some((l) => /trace: built-in: git commit/.test(l)), `git's trace was not observed, so nothing was attributed: ${all.slice(0, 5).join(' | ')}`);
  assert.ok(checkedInMiddle > 0, `no git process of the runner's own was observed between the node and the commit: ${all.join(' | ')}`);
  assert.deepEqual(notCommit, [], 'a git process other than `git commit` saw the SSH agent socket');
}

// G-5 of 20261023-062611-rer-remediation-review-2: declared-no-red and committed-without-test are facts about a COMMITTED
// cluster, but both the first run and a retry recorded them before the commit, and a hook's refusal left them standing.
function refusedCommitRecordsNoDeclaration(t) {
  const f = fixture(t, { mode: 'no-red' });
  const before = f.head();
  const declared = () => f.readRem().commit_check.filter((c) => c.kind === 'declared-no-red');
  f.runRem();
  assert.equal(f.head(), before, 'the hook did not refuse the first run');
  assert.deepEqual(declared(), [], `a refused first commit left a declaration: ${JSON.stringify(f.readRem().commit_check)}`);
  f.runRem(['--retry-commits']);
  assert.equal(f.head(), before, 'the hook did not refuse the retry');
  assert.deepEqual(declared(), [], `a refused retry left a declaration: ${JSON.stringify(f.readRem().commit_check)}`);
  const r = f.runRem(['--retry-commits', '--commit-trailer', TRAILER]);
  assert.notEqual(f.head(), before, `not committed on retry: ${r.output}`);
  assert.deepEqual(declared().map((c) => c.group), ['G-1']);
}

// G-8 of 20261023-044746-rer-delivery: declared-no-red was recorded only on a first run's commit, so a cluster the
// candidate check refused first and a retry committed left no declaration for the follow-up review to judge.
function retryRecordsDeclaredNoRed(t) {
  const f = fixture(t, { hook: false, mode: 'no-red', gatedBuild: true });
  const before = f.head();
  f.setBuild(false);
  f.runRem();
  assert.equal(f.head(), before, 'the candidate check did not refuse the first run');
  assert.ok(f.readRem().commit_check.some((c) => c.kind === 'full-run-red'), JSON.stringify(f.readRem().commit_check));
  f.setBuild(true);
  const r = f.runRem(['--retry-commits']);
  assert.notEqual(f.head(), before, `not committed on retry: ${r.output}`);
  const declared = f.readRem().commit_check.filter((c) => c.kind === 'declared-no-red');
  assert.equal(declared.length, 1, JSON.stringify(f.readRem().commit_check));
  assert.equal(declared[0].group, 'G-1');
  // G-4 of 20261023-062611-rer-remediation-review-2: the reason travelled only inside the message.
  assert.equal(declared[0].reason, 'a read no test can observe', JSON.stringify(declared[0]));
}

// G-17 of 20261023-044746-rer-delivery: only the pure planner was driven for a test-only cluster; the retry's re-plan,
// which must read the reviewed files as the first run's does, was not.
function retryCommitsATestOnlyFix(t) {
  const f = fixture(t, { mode: 'test-only' });
  const before = f.head();
  f.runRem();
  assert.equal(f.head(), before, 'the hook refused the first attempt');
  assert.ok(f.readRem().commit_check.some((c) => c.kind === 'hook-rejected'), JSON.stringify(f.readRem().commit_check));
  const r = f.runRem(['--retry-commits', '--commit-trailer', TRAILER]);
  assert.notEqual(f.head(), before, `the retry did not commit the test-only fix: ${r.output}`);
  assert.deepEqual(git(f.repo, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n'), ['tests/a.test.js']);
}

// G-8 of 20261023-073416-rer-remediation-2b-review: a recovery that finds an attempted commit never landed withdrew the
// cluster's evidence exceptions in memory only; the save omitted commit_check, and the reread restored them.
function recoveryWithdrawsUnlandedDeclaration(t) {
  const f = fixture(t, { hook: false, mode: 'no-red' });
  const before = f.head();
  f.runRem(['--test-die-after-commit', 'c1']);
  const exceptions = () => f.readRem().commit_check.filter((c) => c.kind === 'declared-no-red' || c.kind === 'committed-without-test');
  assert.ok(exceptions().length > 0, `the attempt recorded no exception: ${JSON.stringify(f.readRem().commit_check)}`);
  git(f.repo, 'reset', '-q', '--soft', before);   // the commit never landed
  f.runRem();
  assert.equal(f.readRem().clusters[0].attempting, undefined, JSON.stringify(f.readRem().clusters));
  assert.deepEqual(exceptions(), [], `an uncommitted cluster kept its exceptions: ${JSON.stringify(f.readRem().commit_check)}`);
}

const TRAILER = 'Doc-Impact: none - internal fix, no documented behaviour changed';










// ------------------------------------------------- 20261011-003134-commit-recovery-review (the delivery review)
import { COMMIT_CHECK_KINDS } from '../scripts/lib/remediation-chain.mjs';







// ------------------------------------------------- 20261011-005705-commit-recovery-r2
import { trailerError, isPending } from '../scripts/lib/remediation-chain.mjs';




// G-8: the retry re-planned from the node's saved report; the request asks for the cluster's RECORDED accepted files.
// A plan that no longer matches them is refused, never committed.
// AN EDITED REPORT IS REFUSED FIRST since the evidence record (grounding-and-retry-evidence.plan.md stage 2; design GR-D2 A):
// these two tests edit the report to reach the guard behind it, so they re-record its hash as a first run would have.
function rerecordReport(f) {
  const runJson = path.join(f.at(), 'run.json');
  const run = JSON.parse(fs.readFileSync(runJson, 'utf8'));
  run.evidence_record.payload = createHash('sha256').update(fs.readFileSync(path.join(f.at(), 'evidence', 'remediation', 'payload.json'), 'utf8')).digest('hex');
  fs.writeFileSync(runJson, JSON.stringify(run, null, 2));
}

























export { git, fakeNode, fixture, noSecretReachesACleanFilter, refusedCommitRecordsNoDeclaration, retryRecordsDeclaredNoRed, retryCommitsATestOnlyFix, recoveryWithdrawsUnlandedDeclaration, TRAILER, rerecordReport };
