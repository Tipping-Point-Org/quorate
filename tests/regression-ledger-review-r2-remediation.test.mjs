// Remediation of review 20260927-220507-ledger-review-r2. Each test names the group it pins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeRun, markFixed, unconfirmedDecisions } from '../scripts/lib/ledger.mjs';

const entry = (extra) => ({
  key: 'scripts/a.mjs:40', file: 'scripts/a.mjs', line: 42, severity: 'MEDIUM', status: 'open',
  first_seen: 'run-1', last_seen: 'run-1', times_seen: 1, claim: 'x', nodes: ['code-audit'], ...extra,
});
const L = (...es) => ({ schema_version: 1, runs_folded: [], entries: Object.fromEntries(es.map((e) => [e.key, e])) });
const silentReview = (run_id) => ({ run_id, at: 'T', findings: [], surface: ['scripts'], reviewed: true, okNodes: new Set(['code-audit']) });
const recurrence = (run_id) => ({ run_id, at: 'T', findings: [{ file: 'scripts/a.mjs', line: 42, severity: 'MEDIUM', claim: 'back', node: 'code-audit' }] });

test('G-8: a recurrence voids the fix claim, so the next silence cannot close on it', () => {
  const claimed = markFixed(L(entry({})), ['scripts/a.mjs:40'], 'fix-run').ledger;
  const back = mergeRun(claimed, recurrence('run-2')).ledger;
  assert.equal(back.entries['scripts/a.mjs:40'].claimed_in, undefined, 'the claim the recurrence disproved survived');
  const after = mergeRun(back, silentReview('run-3')).ledger.entries['scripts/a.mjs:40'];
  assert.notEqual(after.status, 'fixed', 'closed as claim+silence on a claim the recurrence had disproved');
  assert.deepEqual(after.silent_in, ['run-3']);
});

test('G-10: a claim+silence close records which run closed it', () => {
  const claimed = markFixed(L(entry({})), ['scripts/a.mjs:40'], 'fix-run').ledger;
  const e = mergeRun(claimed, silentReview('run-2')).ledger.entries['scripts/a.mjs:40'];
  assert.equal(e.status, 'fixed');
  assert.equal(e.closed_in, 'run-2', 'only the operator close wrote closed_in');
});

test('G-12: a decline without the operator\'s words stays listed until the operator confirms it', () => {
  const agent = markFixed(L(entry({})), ['scripts/a.mjs:40'], 'rem', { disposition: 'declined', reason: 'misreads the guard' }).ledger;
  assert.equal(agent.entries['scripts/a.mjs:40'].decided_by, 'agent');
  assert.deepEqual(unconfirmedDecisions(agent).map((e) => e.key), ['scripts/a.mjs:40']);
  const confirmed = markFixed(agent, ['scripts/a.mjs:40'], 'op', { disposition: 'declined', reason: 'misreads the guard', operator_quote: 'yes, decline it' }).ledger;
  const e = confirmed.entries['scripts/a.mjs:40'];
  assert.equal(e.decided_by, 'operator');
  assert.equal(e.operator_quote, 'yes, decline it');
  assert.deepEqual(unconfirmedDecisions(confirmed), []);
});

test('G-12: an explicit close needs the operator\'s words, since it records closed_by operator', () => {
  assert.throws(() => markFixed(L(entry({})), ['scripts/a.mjs:40'], 'op', { disposition: 'closed', reason: 'gone' }), /operator/);
  const e = markFixed(L(entry({})), ['scripts/a.mjs:40'], 'op', { disposition: 'closed', reason: 'gone', operator_quote: 'close it' }).ledger.entries['scripts/a.mjs:40'];
  assert.equal(e.status, 'closed');
  assert.equal(e.operator_quote, 'close it');
});

test('G-1: a run whose run.json does not parse is refused, not folded into a ledger the caller chose', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-badrun-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const runDir = path.join(d, 'runs', '20260101-000000-bad');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run.json'), '{ not json');
  const script = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--run-dir', runDir], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'a corrupt run.json was folded anyway');
  assert.match(r.stderr, /run\.json/);
  assert.equal(fs.existsSync(path.join(d, 'runs', 'ledger.json')), false, 'a ledger was written beside the corrupt run');
});
