// G-8 of 20261015-230146-archive-fold-remediation-review: findings-ledger --summary printed the positive DRAINED signal
// before it looked for runs present but never folded, and the warning that followed did not retract it — so a ledger that
// had not heard of a run was still reported drained. Silence is not a verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';

const CLI = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
const tmp = (t, prefix) => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

function summary(t, { unfolded }) {
  const repo = tmp(t, 'q-drained-repo-');
  const home = tmp(t, 'q-drained-home-');
  const ledgerPath = path.join(repo, '.claude', 'reviews', 'ledger.json');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify({ schema_version: 1, runs_folded: [], entries: {} }));
  const staged = defaultReviewsRoot({ project: null, repoRoot: repo, home });
  fs.mkdirSync(staged, { recursive: true });
  if (unfolded) {
    const runId = '20261015-090000-unfolded';
    const dir = path.join(staged, runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: runId, scope: { paths: ['scripts'] } }));
    fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
    fs.writeFileSync(path.join(dir, 'finding-groups.json'), JSON.stringify({ run_id: runId, groups: [] }));
  }
  return spawnSync(process.execPath, [CLI, '--summary', '--ledger', ledgerPath], {
    encoding: 'utf8', cwd: repo, env: { ...process.env, QUORATE_HOME: home },
  });
}

test('G-8: an empty ledger with an unfolded run present is not reported DRAINED', (t) => {
  const r = summary(t, { unfolded: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /WARNING: 1 run\(s\)/, 'the unfolded run was not found, so this test proves nothing');
  assert.doesNotMatch(r.stdout, /is DRAINED/, `DRAINED was printed over a run the ledger never heard of:\n${r.stdout}`);
  assert.match(r.stdout, /NOT DRAINED/);
});

test('G-8: with every present run folded, an empty ledger is still DRAINED', (t) => {
  const r = summary(t, { unfolded: false });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /this cycle is DRAINED/);
});
