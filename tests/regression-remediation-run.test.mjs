// A REMEDIATION RUN IS MINTED, NOT HAND-WRITTEN (remediate-rebuild.plan.md stage 2; design decisions 1 and 2, operator
// 2026-10-08: "Spawned node (Recommended)", "Findings + run frame (Recommended)"). skills/remediate promised "this node
// opens its own run directory ... records run.json.remediates"; nothing wrote `remediates`, and every remediation run on
// disk was written by hand (ledger skills/remediate/SKILL.md:0, :10). `new-run --remediates <reviewed run>` mints one,
// carrying the reviewed run's frame — base, scope, request, reconciled.md — so the fix-or-ledger rule can be applied.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, mintedRunDir } from './helpers.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-remrun-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), '// a\n');
  const yaml = ['graph_contract_version: 5', 'project: remrun-fixture', 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', '  static_bundle: ""', 'review:',
    '  external_panel: false'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', yaml, '```', ''].join('\n'));
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, "process.stdout.write('0.0.0 (fake)');");
  const home = path.join(base, 'home');
  const env = { QUORATE_HOME: home };
  const mint = (extra) => runScript('new-run.mjs', ['--repo-root', repo, '--no-request', '--no-verify-sandbox',
    '--runtime-bin', bin, ...extra], { cwd: repo, env });
  const reviewed = mintedRunDir(mint(['--slug', 'rev', '--full-sweep', 'src']).output);
  t.after(() => fs.rmSync(reviewed, { recursive: true, force: true }));
  return { repo, env, mint, reviewed };
}

const finish = (dir) => {
  fs.writeFileSync(path.join(dir, 'reconciled.md'), '# Reconciled\n\n## Confirmed (1)\n\n### G-1 · MEDIUM · `src/a.js:1`\n');
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  fs.mkdirSync(path.join(dir, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }] }));
};

test('new-run --remediates mints a run recording remediates and the reviewed run\'s frame', (t) => {
  const { mint, reviewed } = fixture(t);
  finish(reviewed);
  const r = mint(['--slug', 'fix', '--remediates', reviewed]);
  assert.equal(r.status, 0, r.output);
  const dir = mintedRunDir(r.output);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const rev = JSON.parse(fs.readFileSync(path.join(reviewed, 'run.json'), 'utf8'));
  assert.equal(run.remediates, rev.run_id);
  const f = run.remediation_frame;
  assert.equal(f.run_id, rev.run_id);
  assert.equal(f.base_commit, rev.base_commit);
  assert.deepEqual(f.scope.paths, rev.scope.paths);
  assert.equal(f.request, rev.request);
  assert.equal(path.resolve(f.reconciled_md), path.resolve(reviewed, 'reconciled.md'));
  assert.deepEqual(run.scope.paths, rev.scope.paths, 'the remediation is scoped to what was reviewed');
});

// STAGE 3: the remediation run carries its own policy — Edit/Write scoped by relative rules to the contract's globs,
// no commit path at all (remediation-paths stage 3: the runner commits), raw git add/commit still denied — and a review
// run carries none.
test('a remediation run writes remediate-settings.json: scoped edits, the commit script, no raw git', (t) => {
  const { mint, reviewed } = fixture(t);
  finish(reviewed);
  assert.equal(fs.existsSync(path.join(reviewed, 'remediate-settings.json')), false, 'a review run has no remediate policy');
  const r = mint(['--slug', 'fix', '--remediates', reviewed]);
  assert.equal(r.status, 0, r.output);
  const dir = mintedRunDir(r.output);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pol = JSON.parse(fs.readFileSync(path.join(dir, 'remediate-settings.json'), 'utf8')).permissions;
  assert.ok(pol.allow.includes('Edit(src/**)') && pol.allow.includes('Write(src/**)'), JSON.stringify(pol.allow));
  assert.ok(!pol.allow.some((a) => /^Bash\(/.test(a) && /commit|git add/.test(a)), 'no rule grants a commit path: the runner commits');
  assert.ok(!pol.deny.includes('Edit') && !pol.deny.includes('Write'), 'the edit tools are not denied outright');
  assert.ok(pol.deny.some((d) => /git commit/.test(d)) && pol.deny.some((d) => /git add/.test(d)), 'raw git stays denied');
});

test('spawn-node refuses a remediate node whose run has no remediate-settings.json', (t) => {
  const { repo, env, reviewed } = fixture(t);
  // As the fixture repository, under its home, so admission passes and the refusal is the policy file's: spawn-node
  // admits only the repository's own runs (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
  const r = runScript('spawn-node.mjs', ['--run-dir', reviewed, '--repo-root', repo, '--node-id', 'remediate', '--mode', 'remediate',
    '--print-cmd'], { cwd: repo, env });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /remediate-settings\.json/);
});

test('new-run --remediates refuses a run with no reconciled.md or no gate, and a remediation run, writing nothing', (t) => {
  const { mint, reviewed } = fixture(t);
  const count = () => fs.readdirSync(path.dirname(reviewed)).length;
  const before = count();
  const noReconciled = mint(['--slug', 'fix', '--remediates', reviewed]);
  assert.notEqual(noReconciled.status, 0);
  assert.match(noReconciled.output, /reconciled\.md/);
  fs.writeFileSync(path.join(reviewed, 'reconciled.md'), '# Reconciled\n');
  const noGate = mint(['--slug', 'fix', '--remediates', reviewed]);
  assert.notEqual(noGate.status, 0);
  assert.match(noGate.output, /gate/);
  finish(reviewed);
  // G-16 of 20261022-200543-ciss-d1-review-2: a finished run copied outside the repository and the engine's home has
  // the right shape and is still no run of this repository's; its frame would grant that directory to the remediator.
  const outside = path.join(path.dirname(path.dirname(reviewed)), '..', '..', `outside-${Date.now()}`, path.basename(reviewed));
  fs.cpSync(reviewed, outside, { recursive: true });
  t.after(() => fs.rmSync(path.dirname(outside), { recursive: true, force: true }));
  const fromOutside = mint(['--slug', 'fix', '--remediates', outside]);
  assert.notEqual(fromOutside.status, 0, `a run directory outside every run root was remediated: ${fromOutside.output}`);
  assert.match(fromOutside.output, /neither inside/);
  const runJson = path.join(reviewed, 'run.json');
  fs.writeFileSync(runJson, JSON.stringify({ ...JSON.parse(fs.readFileSync(runJson, 'utf8')), remediates: 'x' }));
  const ofRemediation = mint(['--slug', 'fix', '--remediates', reviewed]);
  assert.notEqual(ofRemediation.status, 0);
  assert.match(ofRemediation.output, /itself a remediation run/);
  // The same bound on --follows-remediation, which takes its request from the directory it names.
  fs.cpSync(reviewed, outside, { recursive: true });
  const followsOutside = mint(['--slug', 'fu', '--follows-remediation', outside, '--full-sweep', 'src']);
  assert.notEqual(followsOutside.status, 0, `a remediation run outside every run root was followed: ${followsOutside.output}`);
  assert.match(followsOutside.output, /neither inside/);
  assert.equal(count(), before, 'no run directory was created by a refusal');
});

// G-8 of 20261009-011732-remediation-paths-r1: the runner reads the reviewed run's evidence/reconcile/payload.json for
// the confirmed set and severities, and with it missing it can commit nothing — an undeclared input discovered only at
// the end. new-run refuses the mint instead, naming the file.
test('new-run --remediates refuses a reviewed run whose reconcile payload is missing', (t) => {
  const { mint, reviewed } = fixture(t);
  fs.writeFileSync(path.join(reviewed, 'reconciled.md'), '# Reconciled\n\n## Confirmed (1)\n\n### G-1 · MEDIUM · `src/a.js:1`\n');
  fs.writeFileSync(path.join(reviewed, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  const r = mint(['--slug', 'fix', '--remediates', reviewed]);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /evidence\/reconcile\/payload\.json/);
});

// G-4 of 20261009-014530-remediation-paths-r2: existence was not readability — a malformed payload passed the mint.
test('new-run --remediates refuses a reconcile payload it cannot parse', (t) => {
  const { mint, reviewed } = fixture(t);
  finish(reviewed);
  fs.writeFileSync(path.join(reviewed, 'evidence', 'reconcile', 'payload.json'), '{ not json');
  const r = mint(['--slug', 'fix', '--remediates', reviewed]);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /payload\.json/);
});
