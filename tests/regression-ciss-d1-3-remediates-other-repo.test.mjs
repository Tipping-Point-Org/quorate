// G-9 (and its symptom G-10) of 20261022-211328-ciss-d1-2-remediation-b-review: new-run held --remediates and
// --follows-remediation to runDirAllowed alone, which admits anything under the repository OR the engine's shared home.
// Every repository's staged runs live under that home, so another repository's finished run passed, and its scope,
// request and reconciled.md became the frame of a write-capable remediation of THIS repository. runBelongsToRepo, the
// owner of "is this run one of this repository's" (archive-run and findings-ledger use it), now decides too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, mintedRunDir } from './helpers.mjs';

function project(base, name, home) {
  const repo = path.join(base, name);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), '// a\n');
  const yaml = ['graph_contract_version: 5', `project: ${name}`, 'commands:', '  build: ""', '  test: ""',
    'source_globs: ["src/**"]', 'doc_paths: []', 'ui:', '  surface: none', '  static_bundle: ""', 'review:',
    '  external_panel: false'].join('\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), ['# fixture', '', '```yaml', yaml, '```', ''].join('\n'));
  const bin = path.join(base, 'fake.mjs');
  fs.writeFileSync(bin, "process.stdout.write('0.0.0 (fake)');");
  return (extra) => runScript('new-run.mjs', ['--repo-root', repo, '--no-request', '--no-verify-sandbox',
    '--runtime-bin', bin, ...extra], { cwd: repo, env: { QUORATE_HOME: home } });
}

const finish = (dir) => {
  fs.writeFileSync(path.join(dir, 'reconciled.md'), '# Reconciled\n\n## Confirmed (1)\n\n### G-1 · MEDIUM · `src/a.js:1`\n');
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  fs.mkdirSync(path.join(dir, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'reconcile', 'payload.json'), JSON.stringify({ groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'MEDIUM' }] }));
};

test('G-9: new-run refuses another repository\'s run under the shared home, for --remediates and --follows-remediation', (t) => {
  // As the filesystem spells it, as new-run prints the run it minted (long where TEMP is an 8.3 short path).
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'q-other-repo-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const mintA = project(base, 'repo-a', home);
  const mintB = project(base, 'repo-b', home);
  const foreign = mintedRunDir(mintB(['--slug', 'rev', '--full-sweep', 'src']).output);
  finish(foreign);
  const own = mintedRunDir(mintA(['--slug', 'rev', '--full-sweep', 'src']).output);
  finish(own);
  assert.ok(foreign.startsWith(path.resolve(home)), `the fixture needs the foreign run under the shared home: ${foreign}`);

  const remediates = mintA(['--slug', 'fix', '--remediates', foreign]);
  assert.notEqual(remediates.status, 0, `another repository's run was remediated here: ${remediates.output}`);
  assert.match(remediates.output, /is not one of .*'s runs/);

  const runJson = path.join(foreign, 'run.json');
  fs.writeFileSync(runJson, JSON.stringify({ ...JSON.parse(fs.readFileSync(runJson, 'utf8')), remediates: 'x', remediation_frame: {} }));
  const follows = mintA(['--slug', 'fu', '--follows-remediation', foreign, '--full-sweep', 'src']);
  assert.notEqual(follows.status, 0, `another repository's remediation was followed here: ${follows.output}`);
  assert.match(follows.output, /is not one of .*'s runs/);

  // This repository's own run still mints.
  const ok = mintA(['--slug', 'fix', '--remediates', own]);
  assert.equal(ok.status, 0, ok.output);
});
