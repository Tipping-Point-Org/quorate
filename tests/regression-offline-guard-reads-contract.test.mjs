// The offline guard reads the run's contract, not only the lens names (2026-10-27). runScript let `--only ui-audit`
// through because ui-audit is on OFFLINE_SAFE_LENSES, on the premise that the fixture's contract switches it off. Five
// call sites (regression-cgg-r2/r3-remediation, regression-telemetry-run-time) froze a contract with no `ui:` block, an
// absent surface is not `none`, and ui-audit ran on opus for real, about $0.21 a call, every suite run; the Claude CLI also
// wrote the operator's own ~/.claude.json. Found by tup in the test-selection exploration, which refused the writes.
// No real run here: a run directory holding only run.json is enough, because the guard throws before anything spawns,
// and without the guard run-graph refuses this directory at admission, so neither side of the test can spend.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from './helpers.mjs';

const runDir = (t, contract) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'q-offline-guard-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  fs.writeFileSync(path.join(d, 'run.json'), JSON.stringify({ run_id: path.basename(d), contract }));
  return d;
};

test('a contract with no ui block leaves ui-audit on, and the guard refuses the run before it spawns', (t) => {
  const d = runDir(t, { commands: { build: 'node -e 0' } });
  assert.throws(() => runScript('run-graph.mjs', ['--run-dir', d, '--only', 'ui-audit']), /SPEND REAL MONEY: --only ui-audit/);
});

test('a contract that declares no run command leaves feature-verify off; one that declares it is refused', (t) => {
  const on = runDir(t, { commands: { run: 'node app.js' }, ui: { surface: 'none' } });
  assert.throws(() => runScript('run-graph.mjs', ['--run-dir', on, '--only', 'feature-verify']), /SPEND REAL MONEY: --only feature-verify/);
});

test('ui-audit with `ui: surface: none` is let through (run-graph then refuses the bare directory itself)', (t) => {
  const d = runDir(t, { ui: { surface: 'none' } });
  const r = runScript('run-graph.mjs', ['--run-dir', d, '--only', 'ui-audit']);
  assert.notEqual(r.status, 0, 'a directory holding only run.json is not an admissible run');
  assert.doesNotMatch(r.output ?? '', /SPEND REAL MONEY/);
});
