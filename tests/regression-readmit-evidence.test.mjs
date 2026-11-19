// GROUPS THE EVIDENCE GATE REFUSED, RE-ADMITTED (operator, 2026-11-03: "b"). Remediation 20261103-163145-dr-remediation-3
// fixed seven groups and committed none: the evidence gate refused two whose cited greens ran a test file they did not
// commit, and the five sharing files with them fell too. The rule was loosened (856f50ea), but --retry-commits retries
// only clusters a commit refused, and an evidence refusal is made before any cluster is planned, so nothing could pick
// the groups up without a second node run. --retry-commits --readmit-evidence judges them again by the gate as it stands
// and plans those it now admits as the first run would have. These run the real runner over a fixture with a fake node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScript, mintedRunDir } from './helpers.mjs';
import { readmissionDecision } from '../scripts/lib/remediation-chain.mjs';

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

// The fake node fixes G-1 with a red and a green, but writes the red capture only: the green it cites is missing, which
// the evidence gate refuses. The test then writes the green, standing in for a gate that admits now what it refused then.
async function fakeNode() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (process.argv.includes('--version')) { process.stdout.write('0.0.0 (fake)'); return; }
  const runDir = process.env.FAKE_RUN_DIR;
  const repo = process.env.FAKE_REPO;
  fs.appendFileSync(process.env.FAKE_LOG, `${process.env.QUORATE_NODE_ID ?? ''}\n`);
  const ev = path.join(runDir, 'evidence', 'remediation');
  fs.mkdirSync(ev, { recursive: true });
  fs.writeFileSync(path.join(ev, 'red.txt'), [`$ node --test tests/a.test.js`, '# admitted: test_one tests/a.test.js', `# cwd: ${repo}`,
    '# exit: 1', '# timeout: 15 minute(s)', '# captured: 2026-11-03T10:00:00.000Z', '-'.repeat(72), ''].join('\n'));
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'fixed\n');
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 'red then green\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.01,
    usage: { input_tokens: 1, output_tokens: 1 }, result: JSON.stringify({ schema_version: 1, run_id: path.basename(runDir), summary: 'fixed',
      groups: [{ group_id: 'G-1', disposition: 'fixed', reason: 'the guard was missing', red_evidence: process.env.FAKE_SPELLING === 'backslash' ? 'evidence\\remediation\\red.txt'
          : process.env.FAKE_SPELLING === 'absolute' ? path.join(runDir, 'evidence', 'remediation', 'red.txt')
          : process.env.FAKE_SPELLING === 'escape' ? 'evidence/remediation/../../run.json' : 'evidence/remediation/red.txt',
        green_evidence: 'evidence/remediation/green.txt', cluster: 'c1', files: ['src/a.js', 'tests/a.test.js'],
        search_command: 'git grep -n guard', deferred: [] }] }) }));
}

function fixture(t, { spelling = '' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-readmit-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const fwd = (p) => p.split(path.sep).join('/');
  const repo = path.join(base, 'repo');
  for (const d of ['src', 'tests']) fs.mkdirSync(path.join(repo, d), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 't\n');
  fs.writeFileSync(path.join(base, 'suite.mjs'), "process.stdout.write('ℹ pass 1\\nℹ fail 0\\n');\n");
  const yaml = ['graph_contract_version: 6', 'project: readmit-fixture', 'commands:', '  build: ""', `  test: "node ${fwd(path.join(base, 'suite.mjs'))}"`,
    'source_globs: ["src/**"]', 'test_globs: ["tests/**"]', 'doc_paths: []', 'ui:', '  surface: none',
    '  static_bundle: ""', 'review:', '  external_panel: false'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', yaml, '```', ''].join('\n'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/reviews/\n');
  git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 'x@x'); git(repo, 'config', 'user.name', 'x');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init');
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
  const runRem = (extra = []) => runScript('remediate.mjs', ['--run-dir', at(), '--runtime-bin', bin, '--no-verify-sandbox', ...extra],
    { cwd: repo, env: { ...env, FAKE_RUN_DIR: at(), FAKE_SPELLING: spelling } });
  const readRem = () => JSON.parse(fs.readFileSync(path.join(at(), 'run.json'), 'utf8'));
  const writeGreen = () => fs.writeFileSync(path.join(at(), 'evidence', 'remediation', 'green.txt'), [`$ node --test tests/a.test.js`,
    '# admitted: test_one tests/a.test.js', `# cwd: ${repo}`, '# exit: 0', '# timeout: 15 minute(s)', '# captured: 2026-11-03T10:05:00.000Z',
    '-'.repeat(72), ''].join('\n'));
  const head = () => git(repo, 'rev-parse', 'HEAD').stdout.trim();
  const spawns = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const rerecordGreen = () => {
    const runJson = path.join(at(), 'run.json');
    const run = JSON.parse(fs.readFileSync(runJson, 'utf8'));
    run.evidence_record.captures['evidence/remediation/green.txt'] = createHash('sha256')
      .update(fs.readFileSync(path.join(at(), 'evidence', 'remediation', 'green.txt'), 'utf8')).digest('hex');
    fs.writeFileSync(runJson, JSON.stringify(run, null, 2));
  };
  const runJson = () => path.join(at(), 'run.json');
  return { repo, runRem, readRem, writeGreen, rerecordGreen, runJson, head, spawns };
}

test('a run whose every group the evidence gate refused commits them on --retry-commits --readmit-evidence once the gate admits them', (t) => {
  const f = fixture(t);
  const before = f.head();
  f.runRem();
  assert.equal(f.head(), before, 'the first run committed past an evidence refusal');
  assert.ok(f.readRem().commit_check.some((c) => c.kind === 'evidence-refused' && c.group === 'G-1'), 'the first run did not record the refusal');
  assert.deepEqual(f.readRem().clusters, []);
  // Without the flag the retry has nothing to pick up: the case this mode exists for.
  assert.match(f.runRem(['--retry-commits']).output, /no cluster to retry/);
  // Still refused now: refused, nothing planned.
  const still = f.runRem(['--retry-commits', '--readmit-evidence']);
  assert.notEqual(still.status, 0);
  assert.match(still.output, /still refuses G-1/);
  assert.deepEqual(f.readRem().clusters, []);
  f.writeGreen();
  // A capture added after the first run is refused (grounding-and-retry-evidence.plan.md stage 2; design GR-D2 A).
  assert.match(f.runRem(['--retry-commits', '--readmit-evidence']).output, /green\.txt changed since the first run read it \(it was missing then\)/);
  assert.equal(f.head(), before);
  // Re-recorded, it stands for a first run that read this green and was refused by a rule since loosened.
  f.rerecordGreen();
  const r = f.runRem(['--retry-commits', '--readmit-evidence']);
  assert.notEqual(f.head(), before, `not committed: ${r.output}`);
  assert.equal(git(f.repo, 'show', 'HEAD:src/a.js').stdout, 'fixed\n');
  const run = f.readRem();
  assert.ok(run.commit_check.some((c) => c.kind === 'readmitted' && c.groups.includes('G-1')), 'the re-admission is not recorded');
  assert.equal(run.clusters[0].readmitted, true);
  assert.deepEqual(f.spawns(), ['remediation'], 'the node was spawned again');
  // Done once: the run has committed, so a second re-admission is refused.
  assert.match(f.runRem(['--retry-commits', '--readmit-evidence']).output, /cannot be re-admitted|no cluster to retry|has ended|follow-up/);
});

test('a run with no evidence record is refused by both retry paths (grounding-and-retry-evidence.plan.md stage 2)', (t) => {
  const f = fixture(t);
  f.runRem();
  f.writeGreen();
  f.rerecordGreen();
  const runJson = f.runJson();
  const run = JSON.parse(fs.readFileSync(runJson, 'utf8'));
  delete run.evidence_record;
  fs.writeFileSync(runJson, JSON.stringify(run, null, 2));
  const before = f.head();
  // The ordinary path too (G-15, G-21 of 20261103-234542-gre-delivery): it refused as "no cluster to retry" before the
  // evidence record was compared, so a missing record was never named.
  const plain = f.runRem(['--retry-commits']);
  assert.notEqual(plain.status, 0);
  assert.match(plain.output, /no evidence record from its first run/);
  const r = f.runRem(['--retry-commits', '--readmit-evidence']);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /no evidence record from its first run/);
  assert.equal(f.head(), before, 'committed without a record');
});

// G-8 of 20261104-004602-gre-remediation-review: I-11 holds both retry paths to all three causes, and only "a capture
// added" was driven end to end. An edited report, and an edited capture the first run read, are refused by each path.
test('G-8: both retry paths refuse an edited report and an edited capture, each named', (t) => {
  const f = fixture(t);
  f.runRem();
  f.writeGreen();
  f.rerecordGreen();
  const before = f.head();
  const green = path.join(path.dirname(f.runJson()), 'evidence', 'remediation', 'green.txt');
  const payload = path.join(path.dirname(f.runJson()), 'evidence', 'remediation', 'payload.json');
  const original = fs.readFileSync(green, 'utf8');
  fs.appendFileSync(green, 'edited after the first run\n');
  for (const flags of [['--retry-commits'], ['--retry-commits', '--readmit-evidence']]) {
    const r = f.runRem(flags);
    assert.notEqual(r.status, 0, flags.join(' '));
    assert.match(r.output, /green\.txt changed since the first run read it \(its content differs\)/, `${flags.join(' ')}: ${r.output}`);
  }
  fs.writeFileSync(green, original);
  const report = JSON.parse(fs.readFileSync(payload, 'utf8'));
  fs.writeFileSync(payload, JSON.stringify({ ...report, summary: `${report.summary ?? ''} edited` }));
  for (const flags of [['--retry-commits'], ['--retry-commits', '--readmit-evidence']]) {
    const r = f.runRem(flags);
    assert.notEqual(r.status, 0, flags.join(' '));
    assert.match(r.output, /the report of the node \(evidence\/remediation\/payload\.json\) changed since the first run read it/, `${flags.join(' ')}: ${r.output}`);
  }
  assert.equal(f.head(), before, 'committed past an evidence change');
});

// G-9 of 20261104-004602-gre-remediation-review: the G-15 comparison ran only when payload.json parsed with a groups list;
// a missing or corrupt report was swallowed, and the operator got the generic "no cluster to retry", the evidence unnamed.
test('G-9: a plain retry with nothing pending names an unreadable report rather than "no cluster to retry"', (t) => {
  const f = fixture(t);
  f.runRem();
  const payload = path.join(path.dirname(f.runJson()), 'evidence', 'remediation', 'payload.json');
  assert.ok(fs.existsSync(payload), 'the first run left no report');
  for (const damage of [() => fs.writeFileSync(payload, '{ not json'), () => fs.writeFileSync(payload, '{}'), () => fs.rmSync(payload)]) {
    damage();
    const r = f.runRem(['--retry-commits']);
    assert.notEqual(r.status, 0);
    assert.match(r.output, /payload\.json\) cannot be read/, r.output);
    assert.doesNotMatch(r.output, /no cluster to retry/);
  }
});

// THE OWNER NORMALIZES AT THE READ (evidence-path-owner.plan.md stage 2; G-5 of 20261104-030455-gre-remediation-3-review):
// a capture cited with backslashes or by its absolute path was hashed as unreadable before and after an edit, so the
// retry check could not see the change. It is now recorded under its normal form, and an edit is refused on both paths.
for (const spelling of ['backslash', 'absolute']) {
  test(`a capture cited ${spelling === 'backslash' ? 'with backslashes' : 'by its absolute path'} is recorded under its normal form, and an edit to it is refused on both retry paths`, (t) => {
    const f = fixture(t, { spelling });
    f.runRem();
    const record = f.readRem().evidence_record;
    assert.ok(record?.captures?.['evidence/remediation/red.txt'], JSON.stringify(record));
    assert.match(record.captures['evidence/remediation/red.txt'], /^[0-9a-f]{64}$/, 'the red was not read when it was recorded');
    fs.appendFileSync(path.join(f.runJson(), '..', 'evidence', 'remediation', 'red.txt'), 'edited\n');
    for (const extra of [['--retry-commits'], ['--retry-commits', '--readmit-evidence']]) {
      const r = f.runRem(extra);
      assert.notEqual(r.status, 0, extra.join(' '));
      assert.match(r.output, /evidence\/remediation\/red\.txt changed since the first run read it \(its content differs\)/, extra.join(' '));
    }
  });
}

test('a cited path that escapes evidence/remediation refuses its group, naming the path', (t) => {
  const f = fixture(t, { spelling: 'escape' });
  const before = f.head();
  f.runRem();
  assert.equal(f.head(), before);
  const refusal = f.readRem().commit_check.find((c) => c.kind === 'evidence-refused' && c.group === 'G-1');
  assert.match(refusal?.message ?? '', /a cited evidence path is refused \(red_evidence: .*steps up with '\.\.'\)/, JSON.stringify(f.readRem().commit_check));
});

test('--readmit-evidence runs only with --retry-commits', (t) => {
  const f = fixture(t);
  const r = f.runRem(['--readmit-evidence']);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /--readmit-evidence runs only with --retry-commits/);
  assert.deepEqual(f.spawns(), [], 'the node was spawned');
});

test('readmissionDecision: only a run that committed nothing, planned nothing, and whose refused groups the gate now admits', () => {
  const refused = (g) => ({ kind: 'evidence-refused', group: g });
  const run = { remediation_commits: [], clusters: [], commit_check: [refused('G-1'), refused('G-2'), { kind: 'not-committable', group: 'G-3' }] };
  assert.deepEqual(readmissionDecision({ run, nowChecks: [refused('G-2')] }), { readmitted: ['G-1'] });
  assert.deepEqual(readmissionDecision({ run, nowChecks: [] }), { readmitted: ['G-1', 'G-2'] });
  assert.match(readmissionDecision({ run, nowChecks: [refused('G-1'), refused('G-2')] }).why, /still refuses G-1, G-2/);
  assert.match(readmissionDecision({ run: { ...run, remediation_commits: ['abc'] }, nowChecks: [] }).why, /committed a cluster already/);
  assert.match(readmissionDecision({ run: { ...run, clusters: [{ id: 'c1' }] }, nowChecks: [] }).why, /planned clusters/);
  assert.match(readmissionDecision({ run: { ...run, commit_check: [] }, nowChecks: [] }).why, /no group refused by the evidence gate/);
});
