// THE RUNNER'S REPAIR PASS (remediation-repair-pass.plan.md stage 2; design RP-D1 A, operator 2026-11-01: "1 a"). Two
// remediations in a row (20261101-072512-dr-remediation, 20261101-075544-dr-remediation-2) were refused by the runner's
// full check on tests the node never ran, and the only ways on were a session fix or abandoning the run. Now the runner
// hands the failing tests back to the node, fresh, and checks the widened candidate again. These tests run the real
// runner over a fixture repository with a fake node and a fake suite that fails until the repair is made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';
import { repairPassCap, repairFileAdmission } from '../scripts/lib/remediation-chain.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

// The fake node. The first pass fixes G-1 in src/a.js with a test; a repair pass (spawn-node's QUORATE_NODE_ID names it)
// answers the suite's one failing test as FAKE_REPAIR says.
async function fakeNode() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (process.argv.includes('--version')) { process.stdout.write('0.0.0 (fake)'); return; }
  const runDir = process.env.FAKE_RUN_DIR;
  const repo = process.env.FAKE_REPO;
  const id = String(process.env.QUORATE_NODE_ID ?? '');
  fs.appendFileSync(process.env.FAKE_LOG, `${id}\n`);
  const ev = path.join(runDir, 'evidence', 'remediation');
  fs.mkdirSync(ev, { recursive: true });
  const capture = (file, exit, at) => [`$ node --test ${file}`, `# admitted: test_one ${file}`, `# cwd: ${repo}`, `# exit: ${exit}`,
    '# timeout: 15 minute(s)', `# captured: ${at}`, '-'.repeat(72), ''].join('\n');
  const emit = (payload) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1,
    total_cost_usd: 0.01, usage: { input_tokens: 1, output_tokens: 1 }, result: JSON.stringify(payload) }));
  if (id.startsWith('remediation-repair-')) {
    const pass = Number(id.slice('remediation-repair-'.length));
    const mode = process.env.FAKE_REPAIR || 'fix';
    const answer = { test_name: 'the ratchet holds', test_file: 'tests/a.test.js', disposition: 'fixed', reason: 'routed through the owner',
      cluster: 'c1', files: ['src/a.js'], green_evidence: `evidence/remediation/repair${pass}-a.txt` };
    if (mode === 'nothing') Object.assign(answer, { disposition: 'not-fixed', reason: 'outside my globs', files: [], green_evidence: '' });
    else {
      fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'fixed repaired\n');
      fs.writeFileSync(path.join(ev, `repair${pass}-a.txt`), capture('tests/a.test.js', 0, '2026-11-01T10:20:00.000Z'));
    }
    if (mode === 'helper') { fs.writeFileSync(path.join(repo, 'src', 'helper.js'), 'h\n'); answer.files.push('src/helper.js'); }
    if (mode === 'outside') { fs.mkdirSync(path.join(repo, 'docs'), { recursive: true }); fs.writeFileSync(path.join(repo, 'docs', 'x.md'), 'x\n'); answer.files.push('docs/x.md'); }
    if (mode === 'unlisted') fs.writeFileSync(path.join(repo, 'src', 'extra.js'), 'e\n');
    emit({ schema_version: 1, run_id: path.basename(runDir), pass, summary: 'repaired', failures: [answer] });
    return;
  }
  fs.writeFileSync(path.join(ev, 'red.txt'), capture('tests/a.test.js', 1, '2026-11-01T10:00:00.000Z'));
  fs.writeFileSync(path.join(ev, 'green.txt'), capture('tests/a.test.js', 0, '2026-11-01T10:05:00.000Z'));
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'fixed\n');
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 'red then green\n');
  emit({ schema_version: 1, run_id: path.basename(runDir), summary: 'fixed', groups: [{ group_id: 'G-1',
    disposition: 'fixed', reason: 'the guard was missing', red_evidence: 'evidence/remediation/red.txt',
    green_evidence: 'evidence/remediation/green.txt', cluster: 'c1', files: ['src/a.js', 'tests/a.test.js'],
    search_command: 'git grep -n guard', deferred: [] }] });
}

// The suite the runner's full check runs: node:test's spec summary, one test, failing until src/a.js holds "repaired".
const SUITE = [
  "import fs from 'node:fs';",
  "const ok = fs.readFileSync('src/a.js', 'utf8').includes('repaired');",
  "process.stdout.write(ok ? 'ℹ pass 1\\nℹ fail 0\\n' : 'ℹ pass 0\\nℹ fail 1\\n\\n✖ failing tests:\\n\\ntest at tests\\\\a.test.js:1:1\\n✖ the ratchet holds (1.2ms)\\n  AssertionError: a raw read\\n');",
  'process.exit(ok ? 0 : 1);', '',
].join('\n');

function repairFixture(t, { hook = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-repair-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const fwd = (p) => p.split(path.sep).join('/');
  const repo = path.join(base, 'repo');
  for (const d of ['src', 'tests']) fs.mkdirSync(path.join(repo, d), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 't\n');
  fs.writeFileSync(path.join(base, 'suite.mjs'), SUITE);
  const yaml = ['graph_contract_version: 6', 'project: repair-fixture', 'commands:', '  build: ""', `  test: "node ${fwd(path.join(base, 'suite.mjs'))}"`,
    'source_globs: ["src/**"]', 'test_globs: ["tests/**"]', 'doc_paths: []', 'ui:', '  surface: none',
    '  static_bundle: ""', 'review:', '  external_panel: false'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', yaml, '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/reviews/\n');
  git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 'x@x'); git(repo, 'config', 'user.name', 'x');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');
  if (hook) {
    const h = path.join(repo, '.git', 'hooks', 'commit-msg');
    fs.writeFileSync(h, ['#!/bin/sh', 'grep -q "^Doc-Impact: " "$1" || { echo "[contract-doc] BLOCKED - add a Doc-Impact trailer" >&2; exit 1; }', ''].join('\n'));
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
    JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }] }));
  const r = mint(['--slug', 'fix', '--remediates', reviewed]);
  assert.equal(r.status, 0, r.output);
  const rem = mintedRunDir(r.output);
  const at = () => (fs.existsSync(path.join(rem, 'run.json')) ? rem : path.join(repo, '.claude', 'reviews', path.basename(rem)));
  const runRem = (extra = [], repair = 'fix') => runScript('remediate.mjs', ['--run-dir', at(), '--runtime-bin', bin, '--no-verify-sandbox', ...extra],
    { cwd: repo, env: { ...env, FAKE_RUN_DIR: at(), FAKE_REPAIR: repair } });
  const readRem = () => JSON.parse(fs.readFileSync(path.join(at(), 'run.json'), 'utf8'));
  const spawns = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const head = () => git(repo, 'rev-parse', 'HEAD').stdout.trim();
  const committed = (rel) => git(repo, 'show', `HEAD:${rel}`).stdout;
  return { repo, at, runRem, readRem, spawns, head, committed };
}

test('stage 2: red, then green after one repair pass, and committed with the repair', (t) => {
  const f = repairFixture(t);
  const before = f.head();
  const r = f.runRem();
  assert.notEqual(f.head(), before, `not committed: ${r.output}`);
  assert.deepEqual(f.spawns(), ['remediation', 'remediation-repair-1']);
  assert.equal(f.committed('src/a.js'), 'fixed repaired\n');
  const [pass] = f.readRem().repair_passes;
  assert.equal(pass.outcome, 'green', JSON.stringify(pass));
  assert.deepEqual(pass.failing, ['the ratchet holds']);
  assert.equal(f.readRem().full_checks.length, 2, 'the widened candidate was not checked again');
});

test('stage 2: a file the repair adds joins the cluster its answer names, and is committed with it', (t) => {
  const f = repairFixture(t);
  const r = f.runRem([], 'helper');
  assert.equal(f.committed('src/helper.js'), 'h\n', r.output);
  const c1 = f.readRem().clusters.find((c) => c.id === 'c1');
  assert.deepEqual(c1.repair_added, ['src/helper.js']);
  assert.ok(c1.accepted.includes('src/helper.js'));
});

test('stage 2: a pass that fixes nothing leaves the refusal standing, and nothing is committed', (t) => {
  const f = repairFixture(t);
  const before = f.head();
  f.runRem([], 'nothing');
  assert.equal(f.head(), before);
  const [pass] = f.readRem().repair_passes;
  assert.equal(pass.outcome, 'refused', JSON.stringify(pass));
  assert.match(pass.why, /changed nothing|fixed no failing test/);
  assert.ok(f.readRem().clusters.find((c) => c.id === 'c1').pending_retry);
});

test('stage 2: a repair file outside the globs, or one changed and listed nowhere, refuses the pass', (t) => {
  for (const [mode, re] of [['outside', /docs\/x\.md refused/], ['unlisted', /src\/extra\.js changed during the pass and is listed in no answer/]]) {
    const f = repairFixture(t);
    const before = f.head();
    f.runRem([], mode);
    assert.equal(f.head(), before, mode);
    const [pass] = f.readRem().repair_passes;
    assert.equal(pass.outcome, 'refused', `${mode}: ${JSON.stringify(pass)}`);
    assert.match(pass.why, re, mode);
  }
});

test('stage 2: at a cap of 0 no repair pass runs, and the refusal stands as before', (t) => {
  const f = repairFixture(t);
  const before = f.head();
  f.runRem(['--test-repair-passes', '0']);
  assert.equal(f.head(), before);
  assert.deepEqual(f.spawns(), ['remediation']);
  assert.deepEqual(f.readRem().repair_passes ?? [], []);
});

test('stage 2: the cap is read from the roster\'s remediation entry, absent 3, 0 none, anything else refused', () => {
  assert.equal(repairPassCap(undefined), 3);
  assert.equal(repairPassCap({}), 3);
  assert.equal(repairPassCap({ repair_passes: 0 }), 0);
  assert.equal(repairPassCap({ repair_passes: 3 }), 3);
  for (const bad of [-1, 1.5, '1', null]) assert.throws(() => repairPassCap({ repair_passes: bad }), /whole number/);
  const roster = JSON.parse(fs.readFileSync(new URL('../scripts/lens-roster.json', import.meta.url), 'utf8'));
  const entry = [...(roster.barrier_nodes ?? []), ...(roster.lenses ?? [])].find((l) => l?.id === 'remediation');
  assert.equal(entry.repair_passes, 3, 'the roster does not declare the shipped cap');
});

test('stage 2: a repair file stays in the cluster that holds it; a new one joins the named cluster by the planner\'s rule', () => {
  const ctx = { status: { files: ['src/a.js', 'src/new.js', 'README.md'], refused: [] }, dirtyAtStart: ['src/dirty.js'], refusedAtStart: [],
    contract: { source_globs: ['src/**'], test_globs: ['tests/**'] }, caseInsensitive: false };
  const clusters = [{ id: 'c1', accepted: ['src/a.js'] }, { id: 'c2', accepted: ['src/b.js'] }];
  const got = repairFileAdmission({ ...ctx, clusters, changed: ['src/a.js', 'src/new.js'],
    failures: [{ cluster: 'c2', files: ['src/a.js', 'src/new.js'] }] });
  assert.deepEqual(got, { additions: { c2: ['src/new.js'] }, refused: [], unlisted: [] });
  const bad = repairFileAdmission({ ...ctx, clusters, changed: ['README.md', 'src/gone.js'],
    failures: [{ cluster: 'c1', files: ['README.md', 'src/dirty.js'] }] });
  assert.deepEqual(bad.refused.map((r) => r.path), ['README.md', 'src/dirty.js']);
  assert.deepEqual(bad.unlisted, ['src/gone.js']);
});

// STAGE 3 (remediation-repair-pass.plan.md): `--retry-commits --repair` runs the pass on a run already refused by its full
// check, which is how 20261101-075544-dr-remediation-2, minted before the pass existed, could go through it (RP-D3).
test('stage 3: --retry-commits --repair runs the repair pass on a run its full check refused, and commits', (t) => {
  const f = repairFixture(t);
  const before = f.head();
  f.runRem(['--test-repair-passes', '0']);
  assert.equal(f.head(), before, 'the first run was not refused');
  assert.ok(f.readRem().clusters.find((c) => c.id === 'c1').pending_retry);
  const r = f.runRem(['--retry-commits', '--repair']);
  assert.notEqual(f.head(), before, `not committed on the repair retry: ${r.output}`);
  assert.deepEqual(f.spawns(), ['remediation', 'remediation-repair-1']);
  assert.equal(f.committed('src/a.js'), 'fixed repaired\n');
  assert.equal(f.readRem().repair_passes.at(-1).outcome, 'green');
});

test('stage 3: --retry-commits without --repair spawns nothing, and the refusal stands', (t) => {
  const f = repairFixture(t);
  const before = f.head();
  f.runRem(['--test-repair-passes', '0']);
  f.runRem(['--retry-commits']);
  assert.equal(f.head(), before);
  assert.deepEqual(f.spawns(), ['remediation']);
});

test('stage 3: --repair is refused without --retry-commits, before anything runs', (t) => {
  const f = repairFixture(t);
  const r = f.runRem(['--repair']);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /--repair .*--retry-commits/);
  assert.deepEqual(f.spawns(), []);
});

test('stage 3: a retry keeps the files a repair pass added, so a hook\'s refusal after a green pass can be retried', (t) => {
  const f = repairFixture(t, { hook: true });
  const before = f.head();
  f.runRem([], 'helper');
  assert.equal(f.head(), before, 'the hook did not refuse');
  assert.equal(f.readRem().repair_passes.at(-1).outcome, 'green');
  const r = f.runRem(['--retry-commits', '--commit-trailer', 'Doc-Impact: none - fixture']);
  assert.notEqual(f.head(), before, `not committed on retry: ${r.output}`);
  assert.equal(f.committed('src/helper.js'), 'h\n');
});
