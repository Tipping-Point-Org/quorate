// The findings ledger's transitions (.claude/requests/ledger-transitions.plan.md, plan-review PASS on round 7;
// operator, 2026-09-28: "approved, start stage 1"). One test per transition whose behaviour changes, named
// by its row in the plan's table (T1–T17, T8b), plus the refusals, the migration, and G-2/G-8 of review
// 20260927-224505-ledger-review-r3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  mergeRun, markFixed, isOpen, addObservation, migrateTransitions, operatorDecisionsSince, staleEntries,
} from '../scripts/lib/ledger.mjs';

const K = 'scripts/a.mjs:40';
const entry = (extra = {}) => ({
  key: K, file: 'scripts/a.mjs', line: 42, severity: 'MEDIUM', status: 'open',
  first_seen: '20260901-120000-r', last_seen: '20260901-120000-r', times_seen: 1, claim: 'x',
  nodes: ['code-audit'], ...extra,
});
const L = (...es) => ({ schema_version: 1, runs_folded: [], entries: Object.fromEntries(es.map((e) => [e.key, e])) });
const E = (ledger) => ledger.entries[K];
const Q = 'the operator said so';
const sighting = (run_id, severity = 'MEDIUM') => ({ run_id, at: '2026-09-28T10:00:00Z',
  findings: [{ file: 'scripts/a.mjs', line: 42, severity, claim: 'back', node: 'code-audit' }] });
const silent = (run_id) => ({ run_id, at: '2026-09-28T11:00:00Z', findings: [], surface: ['scripts'], reviewed: true, okNodes: new Set(['code-audit']) });
const mark = (ledger, disposition, extra = {}) => markFixed(ledger, [K], '(manual)', { disposition, reason: 'why', at: '2026-09-28T09:00:00Z', ...extra });

// ------------------------------------------------------------------------------------------ isOpen
test('isOpen is the one definition: an agent decline and a decline whose severity rose are open', () => {
  for (const s of ['open', 'reopened', 'fixed_claimed', 'partial']) assert.equal(isOpen(entry({ status: s })), true, s);
  assert.equal(isOpen(entry({ status: 'declined', decided_by: 'agent' })), true, 'an agent decline awaits the operator (G-17)');
  assert.equal(isOpen(entry({ status: 'declined' })), true, 'a decline with no decided_by is an agent one');
  assert.equal(isOpen(entry({ status: 'declined', decided_by: 'operator' })), false);
  assert.equal(isOpen(entry({ status: 'declined', decided_by: 'operator', severity_rose: true })), true, 'open until re-confirmed');
  for (const s of ['fixed', 'closed']) assert.equal(isOpen(entry({ status: s })), false, s);
});

// ---------------------------------------------------------------------------------------- the fold
test('T2: a partial fix raised again is reopened and loses its claim', () => {
  const e = E(mergeRun(L(entry({ status: 'partial', claimed_in: 'r0', claim_evidence: 'e' })), sighting('20260928-100000-r')).ledger);
  assert.equal(e.status, 'reopened');
  assert.equal(e.claimed_in, undefined);
});

test('T2: an agent decline raised again is reopened, its decision fields cleared', () => {
  const e = E(mergeRun(L(entry({ status: 'declined', decided_by: 'agent', reason: 'r', prior_status: 'open' })), sighting('20260928-100000-r')).ledger);
  assert.equal(e.status, 'reopened');
  assert.equal(e.decided_by, undefined);
});

test('T3: a closed entry raised again is reopened; the close and decision fields go, decisions[] stays', () => {
  const closed = entry({ status: 'closed', closed_by: 'operator', closed_in: 'op', operator_quote: Q, decided_at: 'T',
    decisions: [{ transition: 'T16', at: 'T', run: 'op', quote: Q, reason: 'gone' }] });
  const e = E(mergeRun(L(closed), sighting('20260928-100000-r')).ledger);
  assert.equal(e.status, 'reopened');
  for (const f of ['closed_by', 'closed_in', 'operator_quote', 'decided_at']) assert.equal(e[f], undefined, f);
  assert.equal(e.decisions.length, 1, 'the history of the operator decision is never cleared');
});

test('T3: a legacy close raised again is reopened and loses the legacy label', () => {
  const e = E(mergeRun(L(entry({ status: 'fixed', closed_by: 'silence', legacy: true })), sighting('20260928-100000-r')).ledger);
  assert.equal(e.status, 'reopened');
  assert.equal(e.legacy, undefined);
});

test('T4: an operator decline raised again stays declined; flagged only when the severity rises', () => {
  const declined = entry({ status: 'declined', decided_by: 'operator', operator_quote: Q, declined_severity: 'MEDIUM' });
  const same = E(mergeRun(L(declined), sighting('20260928-100000-r', 'MEDIUM')).ledger);
  assert.equal(same.status, 'declined');
  assert.notEqual(same.severity_rose, true);
  const worse = E(mergeRun(L(declined), sighting('20260928-100000-r', 'HIGH')).ledger);
  assert.equal(worse.status, 'declined');
  assert.equal(worse.severity_rose, true);
  assert.equal(isOpen(worse), true);
});

test('T5: a silent review is recorded on an agent decline too', () => {
  const e = E(mergeRun(L(entry({ status: 'declined', decided_by: 'agent' })), silent('20260928-110000-r')).ledger);
  assert.deepEqual(e.silent_in, ['20260928-110000-r']);
});

test('T6: a partial claim never closes on silence ("never")', () => {
  const e = E(mergeRun(L(entry({ status: 'partial', claimed_in: 'r0', claim_evidence: 'e' })), silent('20260928-110000-r')).ledger);
  assert.equal(e.status, 'partial');
});

test('T6: a claim made on an entry already silent does not close on the next silence', () => {
  const was = L(entry({ silent_in: ['20260920-000000-a'] }));
  const claimed = mark(was, 'fixed_claimed').ledger;
  assert.equal(E(claimed).needs_operator, true, 'T9 flags it for the operator');
  assert.equal(E(mergeRun(claimed, silent('20260928-110000-r')).ledger).status, 'fixed_claimed');
});

test('T6: an observation\'s author is never the lens whose silence confirms a claim', () => {
  const e = entry({ nodes: [], observations: [{ found_by: 'code-audit', observed_at: 'T' }] });
  const claimed = mark(L(e), 'fixed_claimed').ledger;
  assert.equal(E(claimed).needs_operator, true, 'no raising lens: exit 1 is closed, so it goes to the operator');
  assert.equal(E(mergeRun(claimed, silent('20260928-110000-r')).ledger).status, 'fixed_claimed');
});

test('T6: a confirmed claim records closed_in and fixed_in', () => {
  const claimed = mark(L(entry({})), 'fixed_claimed').ledger;
  const e = E(mergeRun(claimed, silent('20260928-110000-r')).ledger);
  assert.equal(e.status, 'fixed');
  assert.equal(e.closed_in, '20260928-110000-r');
  assert.equal(e.fixed_in, '(manual)');
});

test('only a review fold writes last_fold_at and runs_folded', () => {
  const folded = mergeRun(L(entry({})), silent('20260928-110000-r')).ledger;
  assert.equal(folded.last_fold_at, '2026-09-28T11:00:00Z');
  const marked = mark(folded, 'fixed_claimed').ledger;
  assert.equal(marked.last_fold_at, '2026-09-28T11:00:00Z', '--mark-fixed does not move the window');
  assert.deepEqual(marked.runs_folded, folded.runs_folded);
});

// ------------------------------------------------------------------------------------ observations
test('T8: an observation clears no silence, restarts no clock, and adds no raising lens', () => {
  const before = L(entry({ silent_in: ['20260920-000000-a'], last_seen_at: '2026-09-01T00:00:00Z', kept_at: '2026-09-02T00:00:00Z' }));
  before.last_fold_at = '2026-09-20T00:00:00Z';
  const after = addObservation(before, { file: 'scripts/a.mjs', line: 42, severity: 'MEDIUM', claim: 'seen', found_by: 'observed', at: '2026-09-28T12:00:00Z' });
  const e = E(after);
  assert.deepEqual(e.silent_in, ['20260920-000000-a']);
  assert.equal(e.last_seen_at, '2026-09-01T00:00:00Z');
  assert.equal(e.kept_at, '2026-09-02T00:00:00Z');
  assert.deepEqual(e.nodes, ['code-audit']);
  assert.equal(e.observations.length, 1);
  assert.equal(after.last_fold_at, '2026-09-20T00:00:00Z');
  assert.deepEqual(after.runs_folded, []);
});

test('T8: add, then claim, then a silent review does NOT close (round 4\'s bypass)', () => {
  let l = L(entry({ silent_in: ['20260920-000000-a'] }));
  l = addObservation(l, { file: 'scripts/a.mjs', line: 42, severity: 'MEDIUM', claim: 'seen', found_by: 'observed', at: 'T' });
  l = mark(l, 'fixed_claimed').ledger;
  assert.notEqual(E(mergeRun(l, silent('20260928-110000-r')).ledger).status, 'fixed');
});

test('T8: an observation that finds no entry opens one with no raising lens, its clock starting there', () => {
  const l = addObservation(L(), { file: 'scripts/b.mjs', line: 5, severity: 'LOW', claim: 'new', found_by: 'observed', at: '2026-09-28T12:00:00Z' });
  const e = Object.values(l.entries)[0];
  assert.equal(e.status, 'open');
  assert.deepEqual(e.nodes, []);
  assert.equal(e.last_seen_at, '2026-09-28T12:00:00Z');
});

test('T8b: an observation on a closed entry is a note; the entry stays closed', () => {
  const closed = L(entry({ status: 'closed', closed_by: 'operator', operator_quote: Q }));
  const e = E(addObservation(closed, { file: 'scripts/a.mjs', line: 42, severity: 'HIGH', claim: 'again', found_by: 'observed', at: 'T' }));
  assert.equal(e.status, 'closed');
  assert.equal(e.operator_quote, Q);
  assert.equal(e.observations.length, 1);
});

// ------------------------------------------------------------------------------------ agent moves
test('T11: a failed fix clears the claim and puts back the status the claim replaced', () => {
  const claimed = mark(L(entry({ status: 'reopened' })), 'fixed_claimed').ledger;
  const e = E(mark(claimed, 'open').ledger);
  assert.equal(e.status, 'reopened', 'the reopened label survives a withdrawn claim');
  assert.equal(e.claimed_in, undefined);
});

test('T11: a deferral needs a reason and restarts no clock', () => {
  assert.throws(() => markFixed(L(entry({})), [K], '(manual)', { disposition: 'open' }), /reason/);
  const e = E(mark(L(entry({ silent_in: ['a', 'b'], kept_at: 'K0' })), 'open').ledger);
  assert.deepEqual(e.silent_in, ['a', 'b'], 'only the operator\'s keep restarts the clocks (G-20)');
  assert.equal(e.kept_at, 'K0');
});

test('T12: a proposed decline clears the claim and records the status it replaced', () => {
  const claimed = mark(L(entry({ status: 'reopened' })), 'fixed_claimed').ledger;
  const e = E(mark(claimed, 'declined').ledger);
  assert.equal(e.decided_by, 'agent');
  assert.equal(e.claimed_in, undefined);
  assert.equal(e.prior_status, 'reopened');
});

test('T12 twice is refused, so an operator rejection cannot "restore" the decline', () => {
  const once = mark(L(entry({})), 'declined').ledger;
  const twice = mark(once, 'declined');
  assert.deepEqual(twice.refused.map((r) => r.key), [K]);
  const rejected = E(mark(once, 'withdraw', { operator_quote: Q }).ledger);
  assert.equal(rejected.status, 'open');
});

test('T13: the agent withdraws its own decline; the operator\'s rejection is a recorded decision', () => {
  const proposed = mark(L(entry({ status: 'reopened' })), 'declined').ledger;
  assert.equal(E(mark(proposed, 'withdraw').ledger).status, 'reopened');
  const e = E(mark(proposed, 'withdraw', { operator_quote: Q }).ledger);
  assert.equal(e.status, 'reopened');
  assert.equal(e.decisions.at(-1).transition, 'T13');
  assert.equal(e.decided_at, '2026-09-28T09:00:00Z');
});

test('refused: agent moves on a decided entry, and T13 on the operator\'s decline', () => {
  for (const d of [{ status: 'fixed', closed_by: 'claim+silence' }, { status: 'closed', closed_by: 'operator' }, { status: 'declined', decided_by: 'operator' }]) {
    for (const disp of ['fixed_claimed', 'partial', 'open', 'declined']) {
      assert.deepEqual(mark(L(entry(d)), disp).refused.map((r) => r.key), [K], `${disp} on ${d.status}`);
    }
  }
  assert.deepEqual(mark(L(entry({ status: 'declined', decided_by: 'operator' })), 'withdraw').refused.map((r) => r.key), [K]);
});

test('refused: agent moves and a keep on a decline whose severity rose', () => {
  const rose = L(entry({ status: 'declined', decided_by: 'operator', severity_rose: true, operator_quote: Q }));
  for (const disp of ['fixed_claimed', 'partial', 'open', 'declined']) assert.equal(mark(rose, disp).refused.length, 1, disp);
  assert.equal(mark(rose, 'open', { operator_quote: 'keep it' }).refused.length, 1, 'a keep would overwrite the decline');
});

test('refused: a deferral or a keep on an agent\'s proposed decline, which would change nothing', () => {
  const proposed = mark(L(entry({})), 'declined').ledger;
  assert.equal(mark(proposed, 'open').refused.length, 1);
  assert.equal(mark(proposed, 'open', { operator_quote: Q }).refused.length, 1);
});

// --------------------------------------------------------------------------------- operator moves
test('T14: a keep needs the operator\'s words and restarts both clocks; without them it is a deferral', () => {
  const kept = E(mark(L(entry({ silent_in: ['a', 'b'] })), 'open', { operator_quote: Q }).ledger);
  assert.deepEqual(kept.silent_in, []);
  assert.equal(kept.kept_at, '2026-09-28T09:00:00Z');
  assert.equal(kept.decisions.at(-1).transition, 'T14');
});

test('T15: re-confirming a decline whose severity rose clears the flag and moves the baseline', () => {
  const e = E(mark(L(entry({ status: 'declined', decided_by: 'operator', severity_rose: true, severity: 'HIGH', declined_severity: 'MEDIUM' })),
    'declined', { operator_quote: Q }).ledger);
  assert.equal(e.severity_rose, undefined);
  assert.equal(e.declined_severity, 'HIGH');
  assert.equal(isOpen(e), false);
});

test('T16: a close clears the claim and records the decision in decisions[]', () => {
  const claimed = mark(L(entry({})), 'fixed_claimed').ledger;
  const e = E(mark(claimed, 'closed', { operator_quote: Q }).ledger);
  assert.equal(e.status, 'closed');
  assert.equal(e.claimed_in, undefined);
  assert.equal(e.decisions.at(-1).transition, 'T16');
});

test('T17: reopen clears the claim and the close, keeps decisions[], and is the only way into a decided entry', () => {
  const fixed = L(entry({ status: 'fixed', closed_by: 'claim+silence', claimed_in: 'r0', closed_in: 'r1', verified_in: 'r1', fixed_in: 'r0' }));
  const e = E(mark(fixed, 'reopen', { operator_quote: Q }).ledger);
  assert.equal(e.status, 'reopened');
  for (const f of ['claimed_in', 'closed_by', 'closed_in', 'verified_in', 'fixed_in']) assert.equal(e[f], undefined, f);
  assert.equal(e.decisions.at(-1).transition, 'T17');
  assert.equal(E(mergeRun(mark(fixed, 'reopen', { operator_quote: Q }).ledger, silent('20260928-110000-r')).ledger).status, 'reopened',
    'no silent review closes it again on the old claim');
  assert.equal(mark(fixed, 'reopen').refused.length, 1, 'reopen is the operator\'s');
  assert.equal(mark(fixed, 'closed', { operator_quote: Q }).refused.length, 1, 'a decided entry is reopened first');
});

test('each operator decision is listed after the fold that follows it', () => {
  let l = mergeRun(L(entry({})), silent('20260928-110000-r')).ledger;
  l = mark(l, 'open', { operator_quote: Q, at: '2026-09-28T12:00:00Z' }).ledger;
  const listed = operatorDecisionsSince(l);
  assert.deepEqual(listed.map((d) => [d.key, d.transition]), [[K, 'T14']]);
  l = mergeRun(l, { ...silent('20260928-130000-r'), at: '2026-09-28T13:00:00Z' }).ledger;
  assert.deepEqual(operatorDecisionsSince(l), [], 'the next fold moves the window past it');
});

test('a claim on an entry with no raising lens is flagged for the operator, so it is not left to the 14-day clock', () => {
  const e = E(mark(L(entry({ nodes: [] })), 'fixed_claimed').ledger);
  assert.equal(e.needs_operator, true);
  assert.equal(staleEntries(L(e), { now: Date.UTC(2026, 8, 2) }).length, 0, 'not stale yet — and still listed, by needs_operator');
});

// --------------------------------------------------------------------------------------- migration
test('migration: disproved claims, stale decision fields, observation authors, legacy labels', () => {
  const before = L(
    { ...entry({ status: 'reopened', claimed_in: 'r0', claim_evidence: 'e', closed_by: 'silence' }), key: 'a:0' },
    { ...entry({ status: 'open', closed_by: 'silence', verified_in: 'r1' }), key: 'b:0' },
    { ...entry({ status: 'declined', decided_by: 'operator', closed_by: 'claim+silence' }), key: 'c:0' },
    { ...entry({ status: 'fixed_claimed', claimed_in: 'r0' }), key: 'd:0' },
    { ...entry({ status: 'fixed_claimed', claimed_in: 'r0', nodes: ['observed'] }), key: 'e:0' },
    { ...entry({ status: 'fixed', closed_by: 'silence' }), key: 'f:0' },
    { ...entry({ status: 'fixed', claimed_in: 'r0', verified_in: 'r1' }), key: 'g:0' },
    { ...entry({ status: 'closed', closed_by: 'operator' }), key: 'h:0' },
  );
  const { ledger: m, report } = migrateTransitions(before);
  assert.equal(m.entries['a:0'].claimed_in, undefined);
  assert.equal(m.entries['a:0'].closed_by, undefined);
  assert.equal(m.entries['b:0'].closed_by, undefined);
  assert.equal(m.entries['b:0'].verified_in, undefined);
  assert.equal(m.entries['c:0'].closed_by, undefined);
  assert.equal(m.entries['c:0'].declined_severity, 'MEDIUM');
  assert.equal(m.entries['d:0'].silent_at_claim, 0);
  assert.deepEqual(m.entries['e:0'].nodes, []);
  assert.deepEqual(m.entries['e:0'].found_by, ['observed']);
  assert.equal(m.entries['e:0'].needs_operator, true);
  assert.equal(m.entries['f:0'].legacy, true);
  assert.equal(m.entries['g:0'].closed_by, 'claim+silence');
  assert.equal(m.entries['g:0'].pre_transitions, true);
  assert.equal(m.entries['h:0'].legacy, true, 'a close without the operator\'s words is legacy');
  assert.equal(report.legacy, 2);
  assert.equal(report.relabelled, 1);
  assert.equal(migrateTransitions(m).report.changed, 0, 'a second run changes nothing');
});

// --------------------------------------------------------------------------------------- the CLI
const CLI = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));

test('G-2: the CLI header names the constants, not the literals', () => {
  const head = fs.readFileSync(CLI, 'utf8').split(/\r?\n/).slice(0, 40).join('\n');
  assert.doesNotMatch(head, /\b2 reviews\b|\b14 days\b/);
});

test('G-8: an unreadable node status file stops the fold', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-g8-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const runDir = path.join(d, 'runs', '20260928-000000-g8');
  fs.mkdirSync(path.join(runDir, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'nodes', 'code-audit.status.json'), '{ not json');
  // A record naming the run, and `d` as the engine's home, so the fold is admitted and reaches the status file
  // (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28). --ledger: the run is not checked as a repository's.
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ run_id: '20260928-000000-g8' }));
  const r = spawnSync(process.execPath, [CLI, '--run-dir', runDir, '--ledger', path.join(d, 'runs', 'ledger.json')],
    { encoding: 'utf8', env: { ...process.env, QUORATE_HOME: d } });
  assert.notEqual(r.status, 0, 'an unreadable status file counted as zero expected findings');
  assert.match(r.stderr, /status/);
});
