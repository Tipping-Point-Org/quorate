// G-12 and G-13 of 20261022-215413-ciss-d1-3-remediation-review: remediate.mjs and run-checks.mjs took --run-dir anywhere
// and trusted its run.json — for repo_root and the contract, and for the commands run-checks executes — while capture.mjs
// and run-graph.mjs held the same argument to runDirAllowed. A directory outside both the repository and the engine's
// home is now refused by both, before its run.json is read. G-14, spawn-node.mjs taking it the same way, is refused too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, repoRunDir, REPO_ROOT } from './helpers.mjs';

function forged(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-forged-run-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const dir = path.join(base, '20260101-000000-forged');
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: '20260101-000000-forged', remediates: 'x',
    repo_root: base, contract: { commands: { build: 'node -e "process.exit(0)"' } }, host: { cwd: base } }));
  return dir;
}

const CASES = {
  'remediate.mjs': (dir) => ['--run-dir', dir],
  'run-checks.mjs': (dir) => ['--run-dir', dir, '--repo-root', REPO_ROOT],
  // G-14: spawn-node.mjs is confined too, through admitRun (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28); the tests
  // that placed its run directory in os.tmpdir() moved with it. --print-cmd: nothing is spawned should it ever admit one.
  'spawn-node.mjs': (dir) => ['--run-dir', dir, '--repo-root', REPO_ROOT, '--node-id', 'x', '--mode', 'lens', '--print-cmd'],
};

for (const [script, argv] of Object.entries(CASES)) {
  test(`${script} refuses a --run-dir outside the repository and the engine's home`, (t) => {
    const dir = forged(t);
    const r = runScript(script, argv(dir));
    assert.notEqual(r.status, 0, `${script} accepted a forged run directory`);
    assert.match(r.stderr, /neither inside the repository under review/, `${script} did not refuse it by containment: ${r.stderr}`);
    assert.ok(!fs.existsSync(path.join(dir, 'remediate.lock')), `${script} wrote into the forged run directory`);
  });
}

test('run-checks.mjs still accepts a run directory inside the repository', () => {
  const { dir } = repoRunDir({ runId: '20260101-000000-inside', json: { contract: { commands: {} }, stamps: [] } });
  const r = runScript('run-checks.mjs', ['--run-dir', dir, '--repo-root', REPO_ROOT]);
  assert.doesNotMatch(r.stderr, /neither inside/, `a run inside the repository was refused: ${r.stderr}`);
});
