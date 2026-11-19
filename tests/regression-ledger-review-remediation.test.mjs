// Remediation of review 20260927-211023-ledger-review: the stale-ledger change (cfffafc) and two older
// defects in the same code. Each test names the group it pins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeRun, markFixed, openEntries, staleEntries, convergence } from '../scripts/lib/ledger.mjs';

const DAY = 24 * 60 * 60 * 1000;
const entry = (extra) => ({
  key: 'scripts/a.mjs:40', file: 'scripts/a.mjs', line: 42, severity: 'MEDIUM', status: 'open',
  first_seen: '20260901-120000-r', last_seen: '20260901-120000-r', times_seen: 1, claim: 'x',
  nodes: ['code-audit'], ...extra,
});
const L = (...es) => ({ schema_version: 1, runs_folded: [], entries: Object.fromEntries(es.map((e) => [e.key, e])) });
const finding = { file: 'scripts/a.mjs', line: 42, severity: 'MEDIUM', claim: 'back', node: 'code-audit' };

test('G-15: an entry the operator CLOSED that comes back is reopened, and is open work again', () => {
  const closed = markFixed(L(entry({})), ['scripts/a.mjs:40'], 'op', { disposition: 'closed', reason: 'gone', operator_quote: 'close it' }).ledger;
  const { ledger, delta } = mergeRun(closed, { run_id: '20260902-120000-r', at: '2026-09-02T12:00:00Z', findings: [finding] });
  assert.equal(ledger.entries['scripts/a.mjs:40'].status, 'reopened', 'a closed entry that recurs stayed closed — shown to nobody');
  assert.ok(openEntries(ledger).some((e) => e.key === 'scripts/a.mjs:40'));
  assert.ok(delta.recurring.includes('scripts/a.mjs:40'));
});

test('G-18: an entry sighted again by hand ages from the LAST sighting, not the first', () => {
  const now = Date.UTC(2026, 8, 30, 12);
  const first = new Date(now - 20 * DAY).toISOString();
  const again = new Date(now - 3 * DAY).toISOString();
  const a = mergeRun(L(), { run_id: 'observed-20260910120000-aaaaaa', at: first, findings: [finding] }).ledger;
  const b = mergeRun(a, { run_id: 'observed-20260927120000-bbbbbb', at: again, findings: [finding] }).ledger;
  assert.equal(staleEntries(b, { now }).length, 0, 'seen 3 days ago, yet stale by its first sighting 20 days ago');
});

test('G-19: an observation is not a review cycle, so it is never the newest run', () => {
  const ledger = { ...L(entry({ first_seen: '20260927-100000-a', last_seen: '20260927-100000-a' })),
    runs_folded: ['20260927-100000-a', 'observed-20260927175627.-0ed4e7'] };
  assert.equal(convergence(ledger).newest_run, '20260927-100000-a',
    '"observed-…" sorts after every date id as text, so one hand-added note became the newest cycle');
});

test('G-4 and G-5: with nothing open, the summary still shows every decision — declined AND closed', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-ledsum-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const ledgerPath = path.join(d, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(L(
    entry({ status: 'declined', reason: 'DECLINED-REASON' }),
    { ...entry({ status: 'closed', closed_by: 'operator', reason: 'CLOSED-REASON' }), key: 'scripts/b.mjs:10', file: 'scripts/b.mjs' },
  )));
  const script = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--summary', '--ledger', ledgerPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DECLINED-REASON/, 'the summary exited before listing declined entries (G-4)');
  assert.match(r.stdout, /CLOSED-REASON/, 'closed entries and their reasons are never shown (G-5)');
});
