// G-5 of 20261031-033859-urr-remediation-2-review: findings-ledger's loadLedger returned the parsed JSON with no check of
// its shape, so a ledger holding `null`, an `entries` that is not an object, or a null entry crashed a fold with a
// TypeError downstream. It is refused by name, as an unparseable one is, and the ledger is left as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS_DIR } from './helpers.mjs';

function runFixture(root, runId) {
  const dir = path.join(root, runId);
  fs.mkdirSync(path.join(dir, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: runId, scope: { paths: ['scripts'] } }));
  fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ gate: 'RISK' }));
  fs.writeFileSync(path.join(dir, 'nodes', 'code-audit.status.json'), JSON.stringify({ schema_version: 1, run_id: runId,
    node_id: 'code-audit', state: 'OK', kind: 'lens', findings_count: 0 }));
  fs.writeFileSync(path.join(dir, 'finding-groups.json'), JSON.stringify({ run_id: runId, groups: [] }));
  return dir;
}

test('G-5: a ledger of the wrong shape is refused by name, never a TypeError, and left as it was', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-ledger-shape-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const bad = ['null', '[]', '{"entries": 7}', '{"schema_version": 1, "entries": {"x": null}}'];
  bad.forEach((text, i) => {
    const ledgerPath = path.join(d, `ledger-${i}.json`);
    fs.writeFileSync(ledgerPath, text);
    const dir = runFixture(d, `20261031-00000${i}-silent`);
    const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'findings-ledger.mjs'), '--run-dir', dir, '--ledger', ledgerPath],
      { encoding: 'utf8', env: { ...process.env, QUORATE_HOME: d } });
    const out = r.stdout + r.stderr;
    assert.doesNotMatch(out, /TypeError/, `${text}: ${out.slice(-600)}`);
    assert.match(out, /is not a ledger/, `${text}: ${out.slice(-600)}`);
    assert.notEqual(r.status, 0, text);
    assert.equal(fs.readFileSync(ledgerPath, 'utf8'), text, `${text}: the ledger was rewritten`);
  });
});
