// Nothing leaves the ledger's open set without someone deciding it (operator, 2026-09-27: "go with the
// design, 2 reviews or 14 days"). Review 20260927-200901-ars-r5 closed three deferred entries on silence
// alone, over code that had not changed, and nothing told the operator. Silence is now RECORDED on an
// entry, and an entry silent in 2 reviews, or not raised or kept for 14 days, is shown as STALE — for
// the operator to handle, close explicitly (with a reason), or keep (which restarts both clocks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { staleEntries, markFixed, runIdTime, STALE_SILENT_REVIEWS, STALE_DAYS } from '../scripts/lib/ledger.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);   // 2026-09-30T12:00Z
const entry = (extra) => ({
  key: 'scripts/a.mjs:40', file: 'scripts/a.mjs', line: 42, severity: 'MEDIUM', status: 'open',
  first_seen: '20260928-120000-r', last_seen: '20260928-120000-r', times_seen: 1, claim: 'x',
  nodes: ['code-audit'], ...extra,
});
const L = (...es) => ({ schema_version: 1, runs_folded: [], entries: Object.fromEntries(es.map((e) => [e.key, e])) });

test('the thresholds are the operator\'s: 2 silent reviews, 14 days', () => {
  assert.equal(STALE_SILENT_REVIEWS, 2);
  assert.equal(STALE_DAYS, 14);
});

test('a run id carries its time (UTC), and anything else carries none', () => {
  assert.equal(runIdTime('20260928-120000-r'), Date.UTC(2026, 8, 28, 12, 0, 0));
  assert.equal(runIdTime('observed-20260927175627.-0ed4e7'), null);
  assert.equal(runIdTime('(manual)'), null);
});

test('silent in 2 reviews is stale; in 1 it is not', () => {
  const s = staleEntries(L(entry({ silent_in: ['r1', 'r2'] })), { now: NOW });
  assert.equal(s.length, 1);
  assert.match(s[0].stale_because, /silent in 2 reviews/);
  assert.equal(staleEntries(L(entry({ silent_in: ['r1'] })), { now: NOW }).length, 0);
});

test('14 days since it was last raised is stale, whatever the reviews did', () => {
  const s = staleEntries(L(entry({ last_seen: '20260915-120000-r' })), { now: NOW });
  assert.equal(s.length, 1);
  assert.match(s[0].stale_because, /15 days/);
});

// A keep is the OPERATOR's, with their words; without them `open` is an agent's deferral, which restarts
// no clock (G-20 of 20260927-224505-ledger-review-r3; ledger-transitions T11 and T14).
test('keeping an entry restarts both clocks', () => {
  const kept = markFixed(L(entry({ last_seen: '20260901-120000-r', silent_in: ['r1', 'r2'] })),
    ['scripts/a.mjs:40'], 'keep-run', { disposition: 'open', reason: 'kept', operator_quote: 'keep it', at: new Date(NOW - 3 * DAY).toISOString() }).ledger;
  const e = kept.entries['scripts/a.mjs:40'];
  assert.deepEqual(e.silent_in, []);
  assert.equal(e.kept_at, new Date(NOW - 3 * DAY).toISOString());
  assert.equal(staleEntries(kept, { now: NOW }).length, 0, 'kept 3 days ago: not stale');
});

test('an entry with no time at all is stale, so it cannot hide forever', () => {
  const s = staleEntries(L(entry({ last_seen: '(manual)', at: undefined })), { now: NOW });
  assert.equal(s.length, 1);
  assert.match(s[0].stale_because, /no recorded time/);
});

test('a decided entry is never stale: declined, closed and fixed are answers', () => {
  // The operator's decline: an agent's is a proposal and open (ledger-transitions).
  for (const extra of [{ status: 'declined', decided_by: 'operator' }, { status: 'closed' }, { status: 'fixed' }]) {
    assert.equal(staleEntries(L(entry({ ...extra, silent_in: ['r1', 'r2', 'r3'] })), { now: NOW }).length, 0, extra.status);
  }
});

test('an explicit close needs a reason, and leaves the open set', () => {
  assert.throws(() => markFixed(L(entry({})), ['scripts/a.mjs:40'], 'op', { disposition: 'closed' }), /reason/);
  const closed = markFixed(L(entry({})), ['scripts/a.mjs:40'], 'op', { disposition: 'closed', reason: 'gone since the rewrite', operator_quote: 'close it' }).ledger;
  const e = closed.entries['scripts/a.mjs:40'];
  assert.equal(e.status, 'closed');
  assert.equal(e.closed_by, 'operator');
  assert.equal(e.reason, 'gone since the rewrite');
});

test('the CLI lists stale entries with --summary --stale', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-stale-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const ledgerPath = path.join(d, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(L(entry({ silent_in: ['r1', 'r2'] }), { ...entry({}), key: 'scripts/b.mjs:10', file: 'scripts/b.mjs', last_seen: '29990101-000000-future' })));
  const script = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--summary', '--stale', '--ledger', ledgerPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /scripts\/a\.mjs:40/);
  assert.match(r.stdout, /silent in 2 reviews/);
  assert.doesNotMatch(r.stdout, /scripts\/b\.mjs:10/, 'an entry that is not stale is not listed');
});
