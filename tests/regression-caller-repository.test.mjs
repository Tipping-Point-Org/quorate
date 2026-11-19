// run-dir-descendants.plan.md stage 5 (G-14, G-23 of 20261024-122231-rdt-remediation-3-review; run-dir-trust.design.md
// R-D1 A): the repository a command acts for is the one its caller established, --repo-root or git's toplevel of where
// it runs, never the working directory as a fallback. run-graph used the working directory as the repository a run was
// admitted for, and findings-ledger used it for the ledger and for the contract whose convergence floor it reports.
// Run from a folder outside any repository with no --repo-root, each now refuses and says what to pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';

function outsideAnyRepository(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-norepo-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // GIT_CEILING_DIRECTORIES keeps git from finding a repository above the temporary folder, wherever that folder is.
  return { dir, env: { GIT_CEILING_DIRECTORIES: path.dirname(dir) } };
}

test('G-23: run-graph outside any repository, with no --repo-root, refuses rather than taking the working directory', (t) => {
  const { dir, env } = outsideAnyRepository(t);
  // A run whose frozen contract switches every lens off, so the suite's spend guard admits the spawn; the refusal comes first.
  const run = path.join(dir, '20260101-000000-x');
  fs.mkdirSync(run);
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: '20260101-000000-x',
    contract: { ui: { surface: 'none' }, commands: { run: '' }, review: { external_panel: false } } }));
  const r = runScript('run-graph.mjs', ['--run-dir', run, '--only', 'ui-audit'], { cwd: dir, env });
  assert.equal(r.status, 2, r.output);
  assert.match(r.output, /not running in a repository[^\n]*--repo-root/);
});

test('G-14: findings-ledger outside any repository, with no --repo-root, refuses rather than writing a ledger there', (t) => {
  const { dir, env } = outsideAnyRepository(t);
  const r = runScript('findings-ledger.mjs', ['--summary'], { cwd: dir, env });
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /not running in a repository/);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false, 'nothing was written in the working directory');
});
