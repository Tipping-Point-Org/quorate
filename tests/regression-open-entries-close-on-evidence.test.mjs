// THE CONFIRMATION GATE WAS A CLAIM, AND A CLAIM IS NOT EVIDENCE.
//
// `mergeRun`'s promotion loop turns a finding into `fixed` when three things hold: the run's surface
// covered the file, the run was really a review, and the LENS THAT RAISED THE ENTRY reported OK. That
// is the evidence I-55 asks for. But the loop opened with
//
//     if (e.status !== 'fixed_claimed' && e.status !== 'partial') continue;
//
// so an entry nobody had filed a remediation claim against never reached the test. A plain `open`
// finding could be looked at by run after run, by the very lens that raised it, and stay open
// forever — because a human had not typed `markFixed`. Whether someone typed a claim is a fact about
// bookkeeping, not about the code.
//
// MEASURED before the change, on .claude/reviews/ledger.json against run 20260914-193203-branch-verify
// (surface: 11 paths; 19 nodes OK):
//
//     open                : 302   {open: 253, reopened: 35, fixed_claimed: 14}
//     open & covered      : 88
//     clearing the full bar: 86    <-- unclosable by construction
//
// 28% of the backlog, closable on evidence already on disk. The cost was not a wrong number: it was
// that the open set could not be used to decide what to work on next, which is the ledger's whole job.
//
// The tests below pin the RULE, not the two statuses: the bar is unchanged, and a promotion that was
// wrong is caught loudly because a recurrence from `fixed` becomes `reopened` rather than a new entry.
//
// SUPERSEDED IN PART (operator, 2026-09-27: "go with the design, 2 reviews or 14 days"). Silence alone
// closed three DEFERRED entries in review 20260927-200901-ars-r5 whose code had not changed, and nothing
// told the operator. An unclaimed entry no longer closes on silence: the silent review is RECORDED on it
// (`silent_in`), and after 2 such reviews or 14 days it is shown to the operator as stale, to handle, close
// explicitly, or keep. Only a claimed fix plus a later silence closes automatically. The 28% problem is
// answered by surfacing, not by closing: nothing leaves the open set without someone deciding it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRun, markFixed } from '../scripts/lib/ledger.mjs';

/** A ledger holding one entry, raised by `code-audit`, in whatever status the caller wants. */
function ledgerWith(status, extra = {}) {
  return {
    schema_version: 1,
    runs_folded: ['run-1'],
    entries: {
      'scripts/a.mjs:40': {
        key: 'scripts/a.mjs:40', file: 'scripts/a.mjs', line: 42,
        severity: 'HIGH', status, first_seen: 'run-1', last_seen: 'run-1',
        times_seen: 1, claim: 'the defect', nodes: ['code-audit'], at: 'T', ...extra,
      },
    },
  };
}

/** A fold that supplies every piece of evidence the promotion requires. */
const fullEvidence = {
  run_id: 'run-2', at: 'T2', findings: [],
  surface: ['scripts'], reviewed: true, okNodes: new Set(['code-audit']),
};

test('an OPEN entry is not closed by silence: the silent review is recorded on it instead', () => {
  const { ledger } = mergeRun(ledgerWith('open'), fullEvidence);
  const e = ledger.entries['scripts/a.mjs:40'];
  assert.equal(e.status, 'open', 'nobody claimed a fix, so silence is evidence for the operator, not a close');
  assert.deepEqual(e.silent_in, ['run-2'], 'the review that looked and stayed silent is recorded');
  assert.equal(e.closed_by, undefined);
});

test('a REOPENED entry is recorded the same way, and a re-fold does not count the review twice', () => {
  const once = mergeRun(ledgerWith('reopened'), fullEvidence).ledger;
  const twice = mergeRun(once, fullEvidence).ledger;
  const e = twice.entries['scripts/a.mjs:40'];
  assert.equal(e.status, 'reopened');
  assert.deepEqual(e.silent_in, ['run-2']);
});

test('a recurrence clears the silence record: the defect is back, so the silence meant nothing', () => {
  const silent = mergeRun(ledgerWith('open'), fullEvidence).ledger;
  const { ledger } = mergeRun(silent, { ...fullEvidence, run_id: 'run-3',
    findings: [{ file: 'scripts/a.mjs', line: 42, severity: 'HIGH', claim: 'still', node: 'code-audit' }] });
  assert.deepEqual(ledger.entries['scripts/a.mjs:40'].silent_in, []);
});

test('a claimed fix still records that a claim was part of the evidence', () => {
  const claimed = markFixed(ledgerWith('open'), ['scripts/a.mjs:40'], 'run-1a').ledger;
  const { ledger } = mergeRun(claimed, fullEvidence);
  const e = ledger.entries['scripts/a.mjs:40'];
  assert.equal(e.status, 'fixed');
  assert.equal(e.closed_by, 'claim+silence');
  assert.equal(e.fixed_in, 'run-1a', 'the claiming run is what fixed it; run-2 only verified');
});

// ---------------------------------------------------------------- the bar itself, unchanged
// Each of these WOULD have closed the entry if the gate were mere absence. None may.

test('bare silence closes nothing — every condition is still required', () => {
  const cases = [
    ['the file was outside the run surface', { ...fullEvidence, surface: ['other'] }],
    ['the run was not a review', { ...fullEvidence, reviewed: false }],
    ['a lens reported OK, but not the one that raised it', { ...fullEvidence, okNodes: new Set(['perf-audit']) }],
    ['no node reported OK at all', { ...fullEvidence, okNodes: new Set() }],
  ];
  for (const [why, fold] of cases) {
    const { ledger } = mergeRun(ledgerWith('open'), fold);
    assert.equal((ledger.entries['scripts/a.mjs:40'].silent_in ?? []).length, 0,
      `a silence was recorded when ${why}: only a review whose raising lens looked counts`);
    assert.equal(ledger.entries['scripts/a.mjs:40'].status, 'open',
      `closed on silence alone when ${why}. Relaxing WHICH statuses may be confirmed must not relax `
      + 'WHAT confirms them — that is the silence-is-not-a-verdict rule this whole system is for.');
  }
});

test('an entry naming no lens can never be confirmed by anyone', () => {
  const { ledger } = mergeRun(ledgerWith('open', { nodes: [] }), fullEvidence);
  assert.equal(ledger.entries['scripts/a.mjs:40'].status, 'open',
    'with no raiser recorded there is no lens whose silence means anything, so the entry stands');
});

test('a run still cannot confirm a finding it raised itself', () => {
  const { ledger } = mergeRun(ledgerWith('open'), {
    ...fullEvidence,
    findings: [{ file: 'scripts/a.mjs', line: 42, severity: 'HIGH', claim: 'still here', node: 'code-audit' }],
  });
  assert.equal(ledger.entries['scripts/a.mjs:40'].status, 'open',
    'the defect was reported in this very fold; promotion must lose to the recurrence path');
});

// ---------------------------------------------------------------- the delta must not contradict itself
test('an entry promoted by this fold is not also reported as silent', () => {
  const claimed = markFixed(ledgerWith('open'), ['scripts/a.mjs:40'], 'run-1a').ledger;
  const { delta } = mergeRun(claimed, fullEvidence);
  assert.ok(!delta.silent_this_run.includes('scripts/a.mjs:40'),
    'silent_this_run is computed from the PRIOR ledger, so a just-promoted entry would be listed as '
    + 'unanswered open work in the same delta that closed it — telling the operator to act on the '
    + 'one thing that went right');
});

// ---------------------------------------------------------------- the safety net
test('a wrongly promoted entry comes back LOUD, not as a new finding', () => {
  const claimed = markFixed(ledgerWith('open'), ['scripts/a.mjs:40'], 'run-1a').ledger;
  const closed = mergeRun(claimed, fullEvidence).ledger;
  const { ledger, delta } = mergeRun(closed, {
    run_id: 'run-3', at: 'T3',
    findings: [{ file: 'scripts/a.mjs', line: 42, severity: 'HIGH', claim: 'back', node: 'code-audit' }],
    surface: ['scripts'], reviewed: true, okNodes: new Set(),
  });
  assert.equal(ledger.entries['scripts/a.mjs:40'].status, 'reopened',
    'this is what makes the relaxation safe: a promotion that was wrong is self-correcting and '
    + 'visible, rather than losing the defect');
  assert.ok(delta.recurring.includes('scripts/a.mjs:40'),
    'and it is reported as recurring rather than new, so its history survives');
});

// A DEFERRAL IS NOT A CLAIM (found folding 20260926-002850-m0-close). Recording `--disposition open`
// with a reason stamped `claimed_in` like a fix claim, so when silence later closed the entry the
// ledger wrote `fixed_in: <the run that deferred it>` and `closed_by: claim+silence` — eight entries
// credited as fixed by a remediation whose own reason said "not fixed". A deferral records who
// deferred it and why, and leaves no claim behind — including one an earlier fix attempt left.
test('a deferred entry is never closed by silence, and never credited to the run that deferred it', () => {
  const earlierClaim = ledgerWith('fixed_claimed', { claimed_in: 'run-0', claim_evidence: 'e.log' });
  const { ledger: deferred } = markFixed(earlierClaim, ['scripts/a.mjs:40'], 'run-1b', {
    disposition: 'open', reason: 'D1: deferred as tracked work',
  });
  const d = deferred.entries['scripts/a.mjs:40'];
  assert.equal(d.status, 'open');
  assert.equal(d.claimed_in, undefined, 'no claim survives a deferral');
  assert.equal(d.claim_evidence, undefined);
  assert.equal(d.deferred_in, 'run-1b');
  assert.equal(d.reason, 'D1: deferred as tracked work');

  const e = mergeRun(deferred, fullEvidence).ledger.entries['scripts/a.mjs:40'];
  assert.equal(e.status, 'open', 'the three entries ars-r5 closed this way had unchanged code');
  assert.equal(e.fixed_in, undefined);
  assert.deepEqual(e.silent_in, ['run-2']);
});
