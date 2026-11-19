// Remediation of review 20260928-024309-ltr-review-r2 (operator: "1 yes, 2 fix G-3, ledger G-4 and G-5, go").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isOpen, mergeRun } from '../scripts/lib/ledger.mjs';

const K = 'scripts/a.mjs:40';
const entry = (extra = {}) => ({
  key: K, file: 'scripts/a.mjs', line: 42, severity: 'MEDIUM', status: 'open',
  first_seen: '20260901-120000-r', last_seen: '20260901-120000-r', times_seen: 1, claim: 'x', nodes: ['code-audit'], ...extra,
});
const L = (...es) => ({ schema_version: 1, runs_folded: [], entries: Object.fromEntries(es.map((e) => [e.key, e])) });

test('G-9: a status isOpen does not know counts as OPEN — nothing leaves the open set undecided', () => {
  assert.equal(isOpen({ status: 'wontfix' }), true, 'an unknown status was read as closed');
  assert.equal(isOpen({ status: undefined }), true);
  for (const e of [{ status: 'fixed' }, { status: 'closed' }, { status: 'declined', decided_by: 'operator' }]) {
    assert.equal(isOpen(e), false, e.status);
  }
});

test('G-11: a declined finding reported worse by a SECOND lens in the same run is flagged', () => {
  const declined = L(entry({ status: 'declined', decided_by: 'operator', declined_severity: 'MEDIUM' }));
  const { ledger } = mergeRun(declined, { run_id: '20260928-100000-r', at: 'T', findings: [
    { file: 'scripts/a.mjs', line: 42, severity: 'MEDIUM', claim: 'same', node: 'code-audit' },
    { file: 'scripts/a.mjs', line: 42, severity: 'HIGH', claim: 'worse', node: 'security-audit' },
  ] });
  assert.equal(ledger.entries[K].severity, 'HIGH');
  assert.equal(ledger.entries[K].severity_rose, true, 'the severity rose past the decline and nobody was told');
});

test('G-3: a run directory with no run.json is refused, with or without --ledger; with its record, --ledger names the ledger', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-g3-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const runDir = path.join(d, 'anywhere', '20260928-000000-x');
  fs.mkdirSync(path.join(runDir, 'nodes'), { recursive: true });
  // A run that grouped nothing: the fold reads the barrier's grouping (ledger-identity, stage 5).
  fs.writeFileSync(path.join(runDir, 'finding-groups.json'), JSON.stringify({ groups: [] }));
  const cli = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cli, '--run-dir', runDir], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'the ledger was written beside a run nobody said belongs to this repository');
  assert.match(r.stderr, /run\.json/);
  assert.equal(fs.existsSync(path.join(d, 'anywhere', 'ledger.json')), false);
  // UNDER --ledger TOO, since run-dir-trust (plan stage 3, ARCHITECTURE A-28): --ledger names the ledger and so skips only
  // the repository checks; a directory with no run record is still not a run. With its record, it folds into the named
  // ledger. The temporary directory is the engine's home, so containment admits it.
  const env = { ...process.env, QUORATE_HOME: d };
  const named = path.join(d, 'ledger.json');
  const bare = spawnSync(process.execPath, [cli, '--run-dir', runDir, '--ledger', named], { encoding: 'utf8', env });
  assert.notEqual(bare.status, 0, 'a directory with no run record folded under --ledger');
  assert.match(bare.stderr, /no readable run\.json/);
  assert.equal(fs.existsSync(named), false);
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ run_id: '20260928-000000-x' }));
  const ok = spawnSync(process.execPath, [cli, '--run-dir', runDir, '--ledger', named], { encoding: 'utf8', env });
  assert.equal(ok.status, 0, ok.stderr);
});
