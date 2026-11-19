// ledger-trust-boundaries, stage 1 (plan: .claude/requests/ledger-trust-boundaries.plan.md, approved 2026-09-28:
// "A, approved, start stage 1"). The design note's decisions: "1b, 2a, 3a+3b, 4a, G-3 fix".
//
// 3a — every disposition appends to decisions[]; a later one never erases an earlier reason.
// 3b — a fix claim on an entry holding a standing decision from a different group goes to the operator.
// 4a — observations are not capped. G-6 — coverage normalises '..'. G-9 — refusals name every way on.
// 1b — the one redaction owner covers the JSON and spaced key-value shapes (r5 G-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeRun, markFixed, addObservation, coveredByRun, operatorDecisionsSince, standingDecisions, redactClaim as ledgerRedact,
} from '../scripts/lib/ledger.mjs';
import { redactClaim } from '../scripts/lib/redact.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const F = { file: 'a.mjs', line: 5, severity: 'MEDIUM', claim: 'the defect', node: 'code-audit' };
const iso = (d) => `2026-09-${String(d).padStart(2, '0')}T00:00:00.000Z`;
const rid = (d, slug) => `202609${String(d).padStart(2, '0')}-000000-${slug}`;

// A review that raises F, and one that covers a.mjs with the raising lens reporting OK and says nothing.
const raise = (l, d, slug = 'review') => mergeRun(l, { run_id: rid(d, slug), at: iso(d), findings: [F], surface: ['a.mjs'], reviewed: true, okNodes: ['code-audit'] }).ledger;
const quiet = (l, d, slug = 'review') => mergeRun(l, { run_id: rid(d, slug), at: iso(d), findings: [], surface: ['a.mjs'], reviewed: true, okNodes: ['code-audit'] }).ledger;
const act = (l, d, slug, opts) => {
  const r = markFixed(l, [KEY], rid(d, slug), { at: iso(d), ...opts });
  assert.deepEqual(r.refused, [], JSON.stringify(r.refused));
  return r.ledger;
};
const KEY = 'a.mjs:0';
const entry = (l) => l.entries[KEY];

// ------------------------------------------------------------------------------------------------ 3a
test('3a: every agent disposition appends to decisions[] with by: agent, and a later one keeps the earlier reason', () => {
  let l = raise(null, 1);
  l = act(l, 2, 'rem1', { disposition: 'open', reason: 'deferred: older code', groups: ['r1:G-1'] });   // T11
  l = act(l, 3, 'rem2', { disposition: 'fixed_claimed', reason: 'fixed the guard', groups: ['r1:G-1'] }); // T9
  const d = entry(l).decisions;
  assert.ok(Array.isArray(d), 'no history was appended for an agent disposition');
  assert.equal(d.length, 2);
  assert.deepEqual(d.map((x) => [x.transition, x.by]), [['T11', 'agent'], ['T9', 'agent']]);
  assert.equal(d[0].reason, 'deferred: older code', 'the deferral\'s reason was erased by the claim');
  assert.deepEqual(d[0].groups, ['r1:G-1']);
  assert.equal(entry(l).reason, 'fixed the guard', 'reason is the latest element');
});

test('3a: a partial claim (T10), an agent decline (T12) and its withdrawal (T13) each append', () => {
  let l = raise(null, 1);
  l = act(l, 2, 'rem1', { disposition: 'partial', reason: 'half of it' });
  l = act(l, 3, 'rem2', { disposition: 'declined', reason: 'not a defect' });
  l = act(l, 4, 'rem3', { disposition: 'withdraw', reason: 'it is one after all' });
  assert.ok(Array.isArray(entry(l).decisions), 'no history was appended for an agent disposition');
  assert.deepEqual(entry(l).decisions.map((x) => [x.transition, x.by]), [['T10', 'agent'], ['T12', 'agent'], ['T13', 'agent']]);
});

test('3a: the operator\'s transitions append by: operator, and only those are listed as operator decisions', () => {
  let l = raise(null, 1);
  l = act(l, 2, 'rem1', { disposition: 'open', reason: 'deferred' });                               // T11, agent
  l = act(l, 3, 'op1', { disposition: 'open', reason: 'keep it', operator_quote: 'keep' });          // T14
  const d = entry(l).decisions;
  assert.deepEqual(d.map((x) => [x.transition, x.by]), [['T11', 'agent'], ['T14', 'operator']]);
  const listed = operatorDecisionsSince(l, iso(1));
  assert.deepEqual(listed.map((x) => x.transition), ['T14'], 'an agent deferral was listed as an operator decision');
});

test('3a: an element written before this change, with no by, still reads as the operator\'s', () => {
  const l = { schema_version: 1, entries: { [KEY]: { key: KEY, file: 'a.mjs', line: 5, status: 'open',
    decisions: [{ transition: 'T14', at: iso(5), run: 'x', quote: 'keep', reason: 'r' }] } } };
  assert.equal(operatorDecisionsSince(l, iso(1)).length, 1);
});

// ------------------------------------------------------------------------------------------------ 3b
test('3b: a claim for another group, on an entry holding a deferral, goes to the operator and is not closed by silence', () => {
  let l = raise(null, 1);
  l = act(l, 2, 'rem1', { disposition: 'open', reason: 'deferred G-1', groups: ['r1:G-1'] });
  l = act(l, 3, 'rem2', { disposition: 'fixed_claimed', reason: 'fixed G-4', groups: ['r2:G-4'] });
  assert.equal(entry(l).needs_operator, true);
  l = quiet(l, 4);
  assert.equal(entry(l).status, 'fixed_claimed', 'the :190 wrong close: an unrelated claim closed a deferral');
});

test('3b: a claim naming the deferral\'s own group closes normally', () => {
  let l = raise(null, 1);
  l = act(l, 2, 'rem1', { disposition: 'open', reason: 'deferred G-1', groups: ['r1:G-1'] });
  l = act(l, 3, 'rem2', { disposition: 'fixed_claimed', reason: 'fixed G-1', groups: ['r1:G-1'] });
  assert.notEqual(entry(l).needs_operator, true);
  l = quiet(l, 4);
  assert.equal(entry(l).status, 'fixed');
});

test('3b: a group-less deferral sends any claim to the operator', () => {
  let l = raise(null, 1);
  l = act(l, 2, 'rem1', { disposition: 'open', reason: 'deferred' });
  l = act(l, 3, 'rem2', { disposition: 'fixed_claimed', reason: 'fixed', groups: ['r1:G-1'] });
  assert.equal(entry(l).needs_operator, true);
});

test('3b: a deferral from an earlier stay (closed by exit 1, then recurring) does not count — the :190 shape', () => {
  let l = raise(null, 1);
  l = act(l, 2, 'rem1', { disposition: 'open', reason: 'deferred G-1', groups: ['r1:G-1'] });
  l = act(l, 3, 'rem2', { disposition: 'fixed_claimed', reason: 'fixed G-1', groups: ['r1:G-1'] });
  l = quiet(l, 4);
  assert.equal(entry(l).status, 'fixed');
  l = raise(l, 5, 'review5');                                                                  // T3
  assert.equal(entry(l).stay_started, iso(5), 'the recurrence did not record where the new stay began');
  l = act(l, 6, 'rem3', { disposition: 'fixed_claimed', reason: 'fixed the new one', groups: ['r5:G-2'] });
  assert.notEqual(entry(l).needs_operator, true, 'a deferral from a closed stay still blocked the claim');
});

test('3b: a legacy deferred_in with no history element counts as a group-less deferral', () => {
  const l = { schema_version: 1, entries: { [KEY]: { key: KEY, file: 'a.mjs', line: 5, status: 'open', nodes: ['code-audit'],
    first_seen: rid(1, 'review'), deferred_in: rid(2, 'rem'), reason: 'old deferral' } } };
  assert.equal(standingDecisions(entry(l)).length, 1);
  const out = act(l, 3, 'rem2', { disposition: 'fixed_claimed', reason: 'fixed', groups: ['r3:G-1'] });
  assert.equal(entry(out).needs_operator, true);
});

test('3b: a restored element plus a legacy deferred_in counts one deferral, not two', () => {
  const e = { key: KEY, file: 'a.mjs', line: 5, status: 'open', deferred_in: rid(2, 'rem'), reason: 'r',
    decisions: [{ transition: 'restored', by: 'agent', at: iso(2), reason: 'an older reason', restored_from: 'abc1234' }] };
  assert.equal(standingDecisions(e).length, 1);
});

test('3b: a new grouped deferral counts once, with its group', () => {
  let l = raise(null, 1);
  l = act(l, 2, 'rem1', { disposition: 'open', reason: 'deferred', groups: ['r1:G-1'] });
  const s = standingDecisions(entry(l));
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].groups, ['r1:G-1']);
});

test('3b: a later deferral never erases a legacy one — the legacy is kept as an element, by: agent', () => {
  let l = { schema_version: 1, last_fold_at: iso(1), entries: { [KEY]: { key: KEY, file: 'a.mjs', line: 5, status: 'open', nodes: ['code-audit'],
    first_seen: rid(1, 'review'), deferred_in: rid(2, 'rem'), reason: 'old deferral' } } };
  l = act(l, 3, 'rem2', { disposition: 'open', reason: 'deferred G-7', groups: ['r3:G-7'] });
  const s = standingDecisions(entry(l));
  assert.equal(s.length, 2, 'the legacy deferral vanished when deferred_in was overwritten');
  const kept = entry(l).decisions.find((x) => x.run === rid(2, 'rem'));
  assert.equal(kept.by, 'agent');
  assert.equal(kept.at, '2026-09-02T00:00:00.000Z', 'a run id must be converted to the ISO format');
  assert.equal(operatorDecisionsSince(l, iso(0)).length, 0, 'the kept legacy deferral read as an operator decision');
  const out = act(l, 4, 'rem3', { disposition: 'fixed_claimed', reason: 'fixed G-7', groups: ['r3:G-7'] });
  assert.equal(entry(out).needs_operator, true, 'the legacy deferral stopped guarding its entry');
});

test('3b: a legacy deferral whose run precedes stay_started does not count; with no stay_started, every one does', () => {
  const base = { key: KEY, file: 'a.mjs', line: 5, status: 'reopened', deferred_in: rid(2, 'rem'), reason: 'r' };
  assert.equal(standingDecisions({ ...base, stay_started: iso(5) }).length, 0);
  assert.equal(standingDecisions(base).length, 1);
  const withEl = { key: KEY, status: 'open', decisions: [{ transition: 'T11', by: 'agent', at: iso(2), reason: 'r' }] };
  assert.equal(standingDecisions(withEl).length, 1, 'an entry with no stay_started must count every element');
});

test('3b: a (manual) legacy deferral is kept and counted, with no invented date', () => {
  let l = { schema_version: 1, entries: { [KEY]: { key: KEY, file: 'a.mjs', line: 5, status: 'open', nodes: ['code-audit'],
    first_seen: rid(1, 'review'), deferred_in: '(manual)', reason: 'manual deferral' } } };
  assert.equal(standingDecisions(entry(l)).length, 1);
  l = act(l, 3, 'rem2', { disposition: 'open', reason: 'another', groups: ['r3:G-1'] });
  const kept = entry(l).decisions.find((x) => x.run === '(manual)');
  assert.ok(kept, 'the (manual) deferral was not kept');
  assert.equal(kept.at, undefined, 'a date was invented for a deferral that has none');
  assert.equal(kept.at_unknown, true);
  assert.equal(kept.recorded_at, iso(3));
  assert.equal(standingDecisions(entry(l)).length, 2);
});

// ------------------------------------------------------------------------------------------------ 4a
test('4a: observations are not capped — 60 notes keep all 60', () => {
  let l = null;
  for (let i = 0; i < 60; i++) l = addObservation(l, { file: 'b.mjs', line: 1, claim: `note ${i}`, at: `T${String(i).padStart(2, '0')}` });
  const e = Object.values(l.entries)[0];
  assert.equal(e.observations.length, 60);
  assert.equal(e.observations_dropped, undefined);
});

// ------------------------------------------------------------------------------------------------ G-6
test('G-6: coverage does not treat scripts/../x as inside scripts', () => {
  assert.equal(coveredByRun('scripts/../outside.mjs', ['scripts']), false);
  assert.equal(coveredByRun('scripts/./a.mjs', ['scripts']), true);
  assert.equal(coveredByRun('scripts/lib/a.mjs', ['scripts/lib/../lib']), true);
});

// ------------------------------------------------------------------------------------------------ G-9
test('G-9: a refusal names every transition that can proceed', () => {
  let l = raise(null, 1);
  l = act(l, 2, 'rem1', { disposition: 'declined', reason: 'not a defect' });
  const twice = markFixed(l, [KEY], rid(3, 'rem2'), { disposition: 'declined', reason: 'again', at: iso(3) });
  assert.equal(twice.refused.length, 1);
  assert.match(twice.refused[0].why, /withdraw/);
  assert.match(twice.refused[0].why, /declined|confirm/);
  // A decline whose severity rose: re-confirm OR reopen.
  let r = raise(null, 1);
  r = act(r, 2, 'op1', { disposition: 'declined', reason: 'accepted risk', operator_quote: 'decline it' });
  r = mergeRun(r, { run_id: rid(3, 'review'), at: iso(3), findings: [{ ...F, severity: 'HIGH' }], surface: ['a.mjs'], reviewed: true, okNodes: ['code-audit'] }).ledger;
  const agentDecline = markFixed(r, [KEY], rid(4, 'rem'), { disposition: 'declined', reason: 'still no', at: iso(4) });
  assert.equal(agentDecline.refused.length, 1);
  assert.match(agentDecline.refused[0].why, /reopen/);
  assert.match(agentDecline.refused[0].why, /re-confirm|declined/);
});

// ------------------------------------------------------------------------------------------------ 1b
test('1b: the one redaction owner catches the JSON, spaced and key=value shapes (r5 G-11)', () => {
  // Credential NAMES built at runtime (operator, 2026-09-28: "build at runtime"): written literally, each line
  // below is exactly what the shipped gitleaks rule blocks on push — a fixture that trips the check it tests.
  const PW = 'pass' + 'word';
  const cases = [
    [`{"${PW}": "Tr0ub4dor&3xq9Zk"}`, 'Tr0ub4dor&3xq9Zk'],
    [`db_${PW}: "s3cr3t value with spaces"`, 's3cr3t value with spaces'],
    [`${'api' + '_key'} = 'abcd efgh ijkl'`, 'abcd efgh ijkl'],
    [`"${'tok' + 'en'}":"zq8Pw2LmX9vR4tN7"`, 'zq8Pw2LmX9vR4tN7'],
  ];
  for (const [text, secret] of cases) {
    const out = redactClaim(text);
    assert.ok(!out.includes(secret), `${text} -> ${out}`);
    assert.match(out, /\[redacted/);
  }
  assert.equal(redactClaim('the password field at line 12 is checked'), 'the password field at line 12 is checked');
  // Measured in tracked intent.md and the intent cache (claim-checking the stage-1..6 report): an UNQUOTED
  // word after a credential name is prose far more often than a secret. It must look like one — a digit, or
  // long enough to be a generated value — before it is redacted.
  assert.equal(redactClaim('every token: short-flag clusters'), 'every token: short-flag clusters');
  assert.equal(redactClaim('the api_key: required for this node'), 'the api_key: required for this node');
  assert.match(redactClaim(`${PW}=hunter2secret`), /\[redacted/);
  assert.match(redactClaim(`${'tok' + 'en'}=AbCdEfGhIjKlMnOpQrSt`), /\[redacted/);
});

test('1b: redaction has ONE owner — ledger.mjs re-exports it, and no other module defines the shapes', () => {
  assert.equal(ledgerRedact, redactClaim, 'ledger.mjs carries its own redaction instead of the owner\'s');
  const owners = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.mjs') && /SECRET_SHAPES\s*=/.test(fs.readFileSync(p, 'utf8'))) owners.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'scripts'));
  assert.deepEqual(owners.map((p) => p.replace(/\\/g, '/')), ['scripts/lib/redact.mjs']);
});
