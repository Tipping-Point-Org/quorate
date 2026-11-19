// G-12 of 20261111-042301-dps-a5-review (panel-codex-code, MEDIUM). The refusal of an empty not_checked[] ran only for a
// lens that had done work, so a lens answering PASS with findings, checked_clean and not_checked all empty was accepted:
// the case with the least work escaped the guard built for the case with more, and read at the gate as a clean review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRunDir, runScript, REPO_ROOT } from './helpers.mjs';

function lensAnswering(t, over) {
  const runId = '20261111-000000-emptylens';
  const { base, dir } = repoRunDir({ runId, prefix: 'quorate-empty-lens-' });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'node-settings.json'), JSON.stringify({ permissions: { defaultMode: 'manual', allow: [], deny: [] } }));
  const payload = {
    schema_version: 1, run_id: runId, node_id: 'code-audit', intent_sha: '', verdict: 'PASS',
    checked_clean: [], findings: [], not_checked: [], out_of_scope_observations: [], ...over,
  };
  const fake = path.join(base, 'fake-runtime.mjs');
  fs.writeFileSync(fake, `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, num_turns: 1, result: ${JSON.stringify(JSON.stringify(payload))} }));\n`);
  runScript('spawn-node.mjs', ['--run-dir', dir, '--repo-root', REPO_ROOT, '--node-id', 'code-audit', '--mode', 'lens',
    '--prompt', 'x', '--allowed-basis', 'convention', '--timeout-minutes', '1', '--runtime-bin', fake]);
  return JSON.parse(fs.readFileSync(path.join(dir, 'nodes', 'code-audit.status.json'), 'utf8'));
}

test('G-12: a lens answering PASS with every array empty has reported nothing, and is not OK', (t) => {
  const status = lensAnswering(t, {});
  assert.equal(status.state, 'DEGRADED', JSON.stringify(status.validator_errors));
  assert.notEqual(status.verdict, 'PASS', 'an unperformed review reached the gate as a PASS');
  assert.ok(status.validator_errors.some((e) => /empty not_checked\[\]/.test(e)), JSON.stringify(status.validator_errors));
});

test('G-12: a lens that names what it could not check is still accepted with nothing to report', (t) => {
  const status = lensAnswering(t, { not_checked: [{ item: 'x', reason: 'a fixture' }] });
  assert.equal(status.state, 'OK', JSON.stringify(status.validator_errors));
  assert.equal(status.verdict, 'PASS');
});
