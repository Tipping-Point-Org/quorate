// WHAT COUNTS AS A REVIEWED RUN, DECIDED ONCE (usage-report-reviewed-runs.plan.md stage 1; U-D1 A).
//
// G-2 and G-3 of 20261030-221015-usage-report-99-review: lib/usage-coverage.mjs said a run counts when its verdict is
// truthy and not BLOCKED, and findings-ledger.mjs said `gate?.gate !== 'BLOCKED' && okLenses.length > 0`. The two read
// a malformed gate differently: an unknown verdict counted in both, and a gate with no `gate` field counted in the ledger
// and not in the report. A run's gate counts as a review only when its verdict is one of the verdicts a review can reach
// (lib/decisions.mjs VERDICTS); the ledger asks that of the owner and keeps its own lens filter on top.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { reviewed, reachedGate, creditsHead } from '../scripts/lib/reviewed-run.mjs';
import { markFixed } from '../scripts/lib/ledger.mjs';
import { REPO_ROOT, SCRIPTS_DIR } from './helpers.mjs';

test('a gate counts as a review only with a verdict a review can reach', () => {
  for (const verdict of ['PASS', 'RISK', 'FAIL']) assert.equal(reviewed({ verdict }), true, verdict);
  for (const verdict of ['BLOCKED', 'WEIRD', 'pass', '', null, undefined, 3]) assert.equal(reviewed({ verdict }), false, String(verdict));
  assert.equal(reviewed(null), false);
  assert.equal(reachedGate({ verdict: 'BLOCKED' }), true, 'a BLOCKED gate was still reached');
  assert.equal(creditsHead({ verdict: 'WEIRD', dirty: false, head: 'abc' }), false);
  assert.equal(creditsHead({ verdict: 'RISK', dirty: false, head: 'abc' }), true);
});

// The ledger's fold, end to end: a claimed fix closes on the silence of a run only when that run was a review.
function runFixture(root, runId, gate) {
  const dir = path.join(root, runId);
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: runId, scope: { paths: ['scripts'] } }));
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify(gate));
  fs.writeFileSync(path.join(dir, 'nodes', 'code-audit.status.json'), JSON.stringify({ schema_version: 1, run_id: runId,
    node_id: 'code-audit', state: 'OK', kind: 'lens', findings_count: 0 }));
  fs.writeFileSync(path.join(dir, 'finding-groups.json'), JSON.stringify({ run_id: runId, groups: [] }));
  return dir;
}
const claimedLedger = () => markFixed({ schema_version: 1, runs_folded: ['20261030-000001-raise'], entries: {
  'scripts/a.mjs:40': { key: 'scripts/a.mjs:40', file: 'scripts/a.mjs', line: 42, severity: 'MEDIUM', status: 'open',
    first_seen: '20261030-000001-raise', last_seen: '20261030-000001-raise', times_seen: 1, claim: 'the defect',
    nodes: ['code-audit'], at: 'T' } } }, ['scripts/a.mjs:40'], '20261030-000002-fix').ledger;

test('the ledger confirms a claim only on the silence of a run whose gate is a review', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-reviewed-run-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const cases = [[{}, 'fixed_claimed'], [{ gate: 'WEIRD' }, 'fixed_claimed'], [{ gate: 'BLOCKED' }, 'fixed_claimed'], [{ gate: 'RISK' }, 'fixed']];
  cases.forEach(([gate, want], i) => {
    const ledgerPath = path.join(d, `ledger-${i}.json`);
    fs.writeFileSync(ledgerPath, JSON.stringify(claimedLedger()));
    const dir = runFixture(d, `20261030-00001${i}-silent`, gate);
    const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'findings-ledger.mjs'), '--run-dir', dir, '--ledger', ledgerPath],
      { encoding: 'utf8', env: { ...process.env, QUORATE_HOME: d } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).entries['scripts/a.mjs:40'].status, want, JSON.stringify(gate));
  });
});

// The readers, found by the two code shapes the rule took outside its owner: a comparison of a gate's verdict with
// 'BLOCKED', and a filter of runs by their verdict's truthiness. A third shape would pass (the plan says so).
test('no script decides what a reviewed run is outside lib/reviewed-run.mjs', () => {
  const owner = path.join('scripts', 'lib', 'reviewed-run.mjs');
  const shapes = [/\bgate\??\.gate\s*[!=]==?\s*['"]BLOCKED['"]/, /\.filter\(\(\s*(\w+)\s*\)\s*=>\s*\1\.verdict\s*\)/];
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.mjs') && rel !== owner) {
        fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n').forEach((line, n) => {
          if (shapes.some((s) => s.test(line))) hits.push(`${rel.split(path.sep).join('/')}:${n + 1}: ${line.trim()}`);
        });
      }
    }
  };
  walk('scripts');
  assert.deepEqual(hits, []);
});

