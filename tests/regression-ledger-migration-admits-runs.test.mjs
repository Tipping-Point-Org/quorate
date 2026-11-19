// G-9 of 20261030-010649-rdr-remediation-5-review (panel-codex-contract; MEDIUM). --migrate-identity read each folded
// run's reconcile artifacts from the directory locateRunDirs chose, by name, without admitting it: a link or junction
// bearing a recorded run id, leading out of every place this repository keeps runs, supplied another tree's
// reconciliation to the recheck. Each located run is now admitted (admitRun, ARCHITECTURE A-28) and read from the
// directory admission returns; one refused is listed as not rechecked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultReviewsRoot } from '../scripts/lib/reviews-root.mjs';

const CLI = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
const F = 'scripts/io/snapshot.mjs';
const KEY = `${F}:90`;
const RUN = '20261012-054024-test-cost-review';

const tmp = (t, prefix) => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
function runFixture(root, runId) {
  const dir = path.join(root, runId);
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: runId, scope: { paths: ['scripts'] } }));
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  fs.writeFileSync(path.join(dir, 'finding-groups.json'), JSON.stringify({ run_id: runId, groups: [
    { group_id: 'G-1', file: F, line: 102, findings: [{ node_id: 'panel-codex-code', severity: 'MEDIUM', claim: 'outside' }] }] }));
  fs.mkdirSync(path.join(dir, 'evidence', 'reconcile'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'reconcile', 'payload.json'),
    JSON.stringify({ run_id: runId, groups: [{ group_id: 'G-1', decision: 'confirmed', severity: 'HIGH' }] }));
  return dir;
}
const ledger = () => ({ schema_version: 1, runs_folded: ['20261003-000000-decl', RUN], entries: { [KEY]: {
  key: KEY, file: F, line: 94, severity: 'MEDIUM', status: 'declined', decided_by: 'operator', declined_severity: 'MEDIUM',
  decided_at: '2026-10-03T12:00:00Z', operator_quote: 'keep it', first_seen: '20261001-000000-a', last_seen: '20261003-000000-decl',
  times_seen: 3, claim: 'the declined defect', nodes: ['code-audit'] } } });

test('G-9: --migrate-identity does not read a folded run reached through a link out of where the runs live', (t) => {
  const repo = tmp(t, 'q-g9-repo-');
  const home = tmp(t, 'q-g9-home-');
  const outside = tmp(t, 'q-g9-out-');
  const ledgerPath = path.join(repo, '.claude', 'reviews', 'ledger.json');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger()));
  const staged = defaultReviewsRoot({ project: null, repoRoot: repo, home });
  fs.mkdirSync(staged, { recursive: true });
  // The recorded run id, standing in the staging root as a junction to a tree outside the repository and the home.
  fs.symlinkSync(runFixture(outside, RUN), path.join(staged, RUN), 'junction');
  const r = spawnSync(process.execPath, [CLI, '--migrate-identity', '--ledger', ledgerPath],
    { encoding: 'utf8', cwd: repo, env: { ...process.env, QUORATE_HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(path.join(repo, '.claude', 'requests', 'ledger-identity.migration-report.md'), 'utf8');
  assert.doesNotMatch(md, /RISE MEDIUM -> HIGH/, 'the linked tree\'s reconciliation was read into the recheck');
  assert.match(md, new RegExp(`- ${RUN} \\(not admitted: `), 'the linked run is not listed as refused admission');
});

test('G-9: a ledger outside a repository does not read a run beside it that is a link, and still reads a real one', (t) => {
  for (const linked of [true, false]) {
    const d = tmp(t, 'q-g9-beside-');
    const outside = tmp(t, 'q-g9-out-');
    const ledgerPath = path.join(d, 'ledger.json');
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger()));
    if (linked) fs.symlinkSync(runFixture(outside, RUN), path.join(d, RUN), 'junction');
    else runFixture(d, RUN);
    const report = path.join(d, 'report.md');
    const r = spawnSync(process.execPath, [CLI, '--migrate-identity', '--ledger', ledgerPath, '--report', report], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const md = fs.readFileSync(report, 'utf8');
    if (linked) {
      assert.doesNotMatch(md, /RISE MEDIUM -> HIGH/, 'the linked tree\'s reconciliation was read into the recheck');
      assert.match(md, new RegExp(`- ${RUN} \\(not admitted: `));
    } else {
      assert.match(md, /RISE MEDIUM -> HIGH — 20261012-054024-test-cost-review G-1/, 'a real run beside the ledger is no longer read');
    }
  }
});

// G-7 of 20261030-024618-rdr-remediation-6-review (arch-review, panel-codex-arch; MEDIUM). A ledger outside a repository
// admitted its runs through admitBesideLedger, a second admission routine with its own subset of admitRun's checks: no
// record-is-an-object check, no identity against the real name. It is admitted by the one owner now, with the ledger's
// folder as the only place its runs may be (noRepository), so a run.json that is not an object is refused by name.
test('G-7: a run beside a ledger outside a repository is admitted by admitRun, and a run.json of null is refused, not thrown on', (t) => {
  const d = tmp(t, 'q-g7-beside-');
  const ledgerPath = path.join(d, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger()));
  fs.writeFileSync(path.join(runFixture(d, RUN), 'run.json'), 'null');
  const report = path.join(d, 'report.md');
  const r = spawnSync(process.execPath, [CLI, '--migrate-identity', '--ledger', ledgerPath, '--report', report], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(report, 'utf8'), new RegExp(`- ${RUN} \\(not admitted: .*not an object`), 'the run was not refused by admitRun\'s record check');
  const src = fs.readFileSync(CLI, 'utf8');
  assert.doesNotMatch(src, /function admitBesideLedger/, 'a second admission routine still sits beside admitRun');
});

// G-7 of 20261030-033642-rdr-remediation-7-review (code-audit, panel-codex-security; MEDIUM). The ledger's own folder was
// passed to admitRun as the repository, but the io re-export fills `home` in, and admitRun's containment accepts the
// engine's home as well: a junction beside a ledger kept under that home, named for a folded run, led to another
// project's run there and supplied its reconciliation. The ledger's folder is now the only container.
test('G-7: a ledger kept under the engine\'s home does not read a run beside it that is a junction into the home', (t) => {
  const home = tmp(t, 'q-g7-home-');
  const d = path.join(home, 'ledgers');
  fs.mkdirSync(d, { recursive: true });
  const ledgerPath = path.join(d, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger()));
  const other = path.join(home, 'reviews', 'other-project');
  fs.mkdirSync(other, { recursive: true });
  fs.symlinkSync(runFixture(other, RUN), path.join(d, RUN), 'junction');
  const report = path.join(d, 'report.md');
  const r = spawnSync(process.execPath, [CLI, '--migrate-identity', '--ledger', ledgerPath, '--report', report],
    { encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(report, 'utf8');
  assert.doesNotMatch(md, /RISE MEDIUM -> HIGH/, 'another project\'s reconciliation under the home was read into the recheck');
  assert.match(md, new RegExp(`- ${RUN} \\(not admitted: `));
});
