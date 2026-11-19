// Remediation of review 20260928-004954-ledger-transitions-review (operator: "reset, go remediate").
// Each test names the group it pins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeRun, markFixed, migrateTransitions } from '../scripts/lib/ledger.mjs';

const K = 'scripts/a.mjs:40';
const entry = (extra = {}) => ({
  key: K, file: 'scripts/a.mjs', line: 42, severity: 'MEDIUM', status: 'open',
  first_seen: '20260901-120000-r', last_seen: '20260901-120000-r', times_seen: 1, claim: 'x',
  nodes: ['code-audit'], ...extra,
});
const L = (...es) => ({ schema_version: 1, runs_folded: [], entries: Object.fromEntries(es.map((e) => [e.key, e])) });
const Q = 'the operator said so';
const mark = (ledger, disposition, extra = {}, keys = [K]) => markFixed(ledger, keys, '(manual)', { disposition, reason: 'why', at: '2026-09-28T09:00:00Z', ...extra });
const silent = (run_id) => ({ run_id, at: '2026-09-28T11:00:00Z', findings: [], surface: ['scripts'], reviewed: true, okNodes: new Set(['code-audit']) });
const CLI = fileURLToPath(new URL('../scripts/findings-ledger.mjs', import.meta.url));

test('G-17: a decline whose severity rose can be reopened, as the doc and the hint offer', () => {
  const rose = L(entry({ status: 'declined', decided_by: 'operator', severity_rose: true, operator_quote: Q, declined_severity: 'LOW', severity: 'HIGH' }));
  const r = mark(rose, 'reopen', { operator_quote: Q });
  assert.deepEqual(r.refused, [], 'reopen refused a decline that came back worse ("already open")');
  assert.equal(r.ledger.entries[K].status, 'reopened');
});

test('G-13(b): a refusal on a decline whose severity rose names the moves that work there', () => {
  const rose = L(entry({ status: 'declined', decided_by: 'operator', severity_rose: true }));
  const why = mark(rose, 'fixed_claimed').refused[0].why;
  assert.doesNotMatch(why, /withdraw/, 'it pointed at withdraw, which is always refused on an operator decline');
  assert.match(why, /re-confirm|reopen/);
});

test('G-15: the migration flags a claim made on an already-silent entry, as a new claim is flagged', () => {
  const { ledger } = migrateTransitions(L(entry({ status: 'fixed_claimed', claimed_in: 'r0', silent_in: ['r1'] })));
  assert.equal(ledger.entries[K].silent_at_claim, 1);
  assert.equal(ledger.entries[K].needs_operator, true, 'a migrated claim on a silent entry was left unlisted');
});

test('G-10: a claim with no silent_at_claim (never migrated) is not closed over earlier silence', () => {
  const legacyClaim = L(entry({ status: 'fixed_claimed', claimed_in: 'r0', silent_in: ['20260920-000000-a'] }));
  assert.equal(mergeRun(legacyClaim, silent('20260928-110000-r')).ledger.entries[K].status, 'fixed_claimed');
});

test('G-6(a): a multi-key disposition with one refusal changes nothing', () => {
  const two = L(entry({}), { ...entry({ status: 'closed', closed_by: 'operator', operator_quote: Q }), key: 'b.mjs:0' });
  const r = mark(two, 'fixed_claimed', {}, [K, 'b.mjs:0']);
  assert.equal(r.refused.length, 1);
  assert.equal(r.ledger.entries[K].status, 'open', 'the accepted key was applied although the command was refused');
});

test('G-6(b), G-13(a): the operator\'s words on a claim are refused, not silently ignored', () => {
  assert.throws(() => mark(L(entry({})), 'fixed_claimed', { operator_quote: Q }), /claim/);
});

// A fixture for the CLI: a ledger beside a run directory. The run carries a run.json naming itself and the directory is
// the engine's home for the fold, because a run is admitted only with a record and inside the repository or the home
// (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
let foldHome = null;
function foldFixture(t, ledger) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'q-ltrem-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  fs.mkdirSync(path.join(d, 'runs', '20260928-120000-x', 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(d, 'runs', '20260928-120000-x', 'run.json'), JSON.stringify({ run_id: '20260928-120000-x' }));
  foldHome = d;
  // A run that grouped nothing: the fold reads the barrier's grouping (ledger-identity, stage 5).
  fs.writeFileSync(path.join(d, 'runs', '20260928-120000-x', 'finding-groups.json'), JSON.stringify({ groups: [] }));
  fs.writeFileSync(path.join(d, 'runs', 'ledger.json'), JSON.stringify(ledger));
  return { runDir: path.join(d, 'runs', '20260928-120000-x'), ledgerPath: path.join(d, 'runs', 'ledger.json') };
}

test('G-4: a note on a closed entry filed since the previous fold is listed by this fold', (t) => {
  const closed = L(entry({ status: 'closed', closed_by: 'operator', operator_quote: Q,
    // Between the previous fold and now — in the past, so the only thing that can hide it is the window.
    observations: [{ found_by: 'observed', observed_at: '2026-01-02T00:00:00Z', claim: 'seen again', severity: 'LOW' }] }));
  closed.last_fold_at = '2026-01-01T00:00:00Z';
  const { runDir, ledgerPath } = foldFixture(t, closed);
  // --ledger: the operator names the ledger, so the run is not checked as one of a repository's runs.
  const r = spawnSync(process.execPath, [CLI, '--run-dir', runDir, '--ledger', ledgerPath],
    { encoding: 'utf8', env: { ...process.env, QUORATE_HOME: foldHome } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /observed while closed/, 'the note was filtered by the window this very fold had just moved');
});

test('G-1: --summary --stale shows the operator\'s decisions since the last fold', (t) => {
  const decided = L(entry({ decisions: [{ transition: 'T14', at: '2026-09-28T10:00:00Z', run: 'op', quote: Q, reason: 'kept' }] }));
  decided.last_fold_at = '2026-09-28T09:00:00Z';
  const { ledgerPath } = foldFixture(t, decided);
  const r = spawnSync(process.execPath, [CLI, '--summary', '--stale', '--ledger', ledgerPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /decisions since the previous fold/);
  assert.match(r.stdout, /T14/);
});

// Found claim-checking this remediation: the G-6 fix made a refused multi-key command apply nothing, but
// the CLI still printed "recorded" for the keys it had thrown away.
test('G-6: a refused multi-key command prints no "recorded" line for the keys it did not apply', (t) => {
  const two = L(entry({}), { ...entry({ status: 'closed', closed_by: 'operator', operator_quote: Q }), key: 'b.mjs:0' });
  const { ledgerPath } = foldFixture(t, two);
  const r = spawnSync(process.execPath, [CLI, '--ledger', ledgerPath, '--mark-fixed', K, '--mark-fixed', 'b.mjs:0', '--disposition', 'fixed_claimed'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout, /recorded/, 'it said a key was recorded that the all-or-nothing rule had discarded');
  assert.equal(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).entries[K].status, 'open');
});

// G-18 (and G-5) of the same review: shared/ledger-transitions.md promises the summary footer carries the
// quote flag on every operator command; the footer said "close one with --mark-fixed <key>", which records a
// claim, not a close.
test('G-18: the summary footer names the operator\'s close, with their words', (t) => {
  const { ledgerPath } = foldFixture(t, L(entry({})));
  const r = spawnSync(process.execPath, [CLI, '--summary', '--ledger', ledgerPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /close one with --mark-fixed <key>$/m);
  assert.match(r.stdout, /--operator-quote/);
});
