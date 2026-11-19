// G-14: a claimed fix could be confirmed by the silence of a lens that never looks for that defect.
//
// `mergeRun` promotes `fixed_claimed` to `fixed` when a LATER run covered the file and stayed
// silent. Two guards were already in place — the file must be in the run's surface, and the run
// must actually have been a review rather than a BLOCKED one (G-22, G-30). The third was missing:
// `reviewed` was one boolean for the whole run, true as soon as ANY non-intent node returned OK.
//
// So `--only doc-consistency-review` over `scripts/**` confirmed a security-audit claim about a
// credential leak, on the silence of a lens that does not look for credential leaks and was never
// asked to. The entry then left the open set entirely, which is the one outcome the cross-run
// ledger exists to prevent — and the path to it is the most ordinary workflow there is: fix a
// thing, re-run the one lens you care about.
//
// The entries already record which nodes raised them, so confirmation can be specific.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { mergeRun } from '../scripts/lib/ledger.mjs';

const claim = (nodes) => ({
  schema_version: 1,
  entries: {
    'scripts/new-run.mjs:660': {
      key: 'scripts/new-run.mjs:660',
      file: 'scripts/new-run.mjs',
      line: 662,
      severity: 'MEDIUM',
      status: 'fixed_claimed',
      first_seen: 'run-a',
      last_seen: 'run-a',
      times_seen: 1,
      claim: 'an unscoped Grep lets a lens read credentials outside the repository',
      nodes,
      claimed_in: 'run-b',
    },
  },
});

const confirmWith = (ledgerIn, okNodes) => mergeRun(ledgerIn, {
  run_id: 'run-c',
  at: '2026-09-08T00:00:00.000Z',
  findings: [],                       // silent about it
  surface: ['scripts'],               // and it looked at the file
  reviewed: true,                     // and it was a real review
  okNodes,
}).ledger.entries['scripts/new-run.mjs:660'];

test('regression: the lens that raised the claim confirms it by staying silent', () => {
  const e = confirmWith(claim(['security-audit']), new Set(['security-audit', 'code-audit']));
  assert.equal(e.status, 'fixed', 'the raising lens looked again and found nothing — that is the evidence');
  assert.equal(e.verified_in, 'run-c');
  assert.equal(e.fixed_in, 'run-b', 'the fix belongs to the run that claimed it, not to the one that confirmed it');
});

test('regression: an unrelated lens cannot confirm a claim by silence', () => {
  // THE DEFECT. Every other condition is satisfied — covered, reviewed, silent — and the entry must
  // still stand, because the only lens that reported does not look for this class of defect.
  const e = confirmWith(claim(['security-audit']), new Set(['doc-consistency-review']));
  assert.equal(e.status, 'fixed_claimed',
    'silence from a lens that never looks for the defect is not evidence that the defect is gone');
});

test('regression: either of two raising lenses is enough', () => {
  // An OR, not an AND. Requiring both would make a claim raised by a panel arm unconfirmable
  // whenever the external panel is off, which would quietly convert the ledger into a backlog.
  const e = confirmWith(claim(['code-audit', 'panel-codex-code']), new Set(['code-audit']));
  assert.equal(e.status, 'fixed', 'one of the lenses that raised it looked again and stayed silent');
});

test('regression: an entry naming no lens is never confirmed', () => {
  // Conservative on purpose: with no raiser recorded there is no lens whose silence means anything,
  // and the alternative is confirming it on anyone's.
  for (const nodes of [[], undefined]) {
    const e = confirmWith(claim(nodes), new Set(['code-audit', 'security-audit']));
    assert.equal(e.status, 'fixed_claimed', `an entry with nodes=${JSON.stringify(nodes)} must stay a claim`);
  }
});

test('regression: the earlier guards still hold on their own', () => {
  const base = claim(['security-audit']);
  const okNodes = new Set(['security-audit']);

  const unreviewed = mergeRun(base, {
    run_id: 'run-c', at: 'x', findings: [], surface: ['scripts'], reviewed: false, okNodes,
  }).ledger.entries['scripts/new-run.mjs:660'];
  assert.equal(unreviewed.status, 'fixed_claimed', 'a BLOCKED run confirms nothing (G-22)');

  const uncovered = mergeRun(base, {
    run_id: 'run-c', at: 'x', findings: [], surface: ['skills'], reviewed: true, okNodes,
  }).ledger.entries['scripts/new-run.mjs:660'];
  assert.equal(uncovered.status, 'fixed_claimed', 'a run that never looked at the file confirms nothing');

  const selfConfirm = mergeRun(base, {
    run_id: 'run-b', at: 'x', findings: [], surface: ['scripts'], reviewed: true, okNodes,
  }).ledger.entries['scripts/new-run.mjs:660'];
  assert.equal(selfConfirm.status, 'fixed_claimed', 'the claiming run cannot confirm itself');
});

test('regression: omitting okNodes confirms nothing rather than everything', () => {
  // The parameter is new, and an older caller that does not pass it must fail CLOSED. A default
  // that confirmed on absence would reintroduce the defect through the one path nobody tests.
  const e = mergeRun(claim(['security-audit']), {
    run_id: 'run-c', at: 'x', findings: [], surface: ['scripts'], reviewed: true,
  }).ledger.entries['scripts/new-run.mjs:660'];
  assert.equal(e.status, 'fixed_claimed', 'a caller that cannot say which lenses reported confirms nothing');
});

test('regression: a recurrence still reopens regardless of which lens saw it', () => {
  // Confirmation got narrower; RECURRENCE must not. A defect reported again by any lens is present,
  // and tightening the wrong half here would hide live findings instead of unproven claims.
  const { ledger } = mergeRun(claim(['security-audit']), {
    run_id: 'run-c',
    at: 'x',
    findings: [{ file: 'scripts/new-run.mjs', line: 662, severity: 'MEDIUM', claim: 'still there', node: 'arch-review' }],
    surface: ['scripts'],
    reviewed: true,
    okNodes: new Set(['arch-review']),
  });
  const e = ledger.entries['scripts/new-run.mjs:660'];
  assert.notEqual(e.status, 'fixed', 'a defect reported again is not fixed, whoever reported it');
});

// A DEFECT FOUND BY USING THE ENGINE HAD NOWHERE TO GO.
//
// The operator's rule: "for any bug you find on the running quorate, validate it on the branch and
// handle it as any other bug you find, add it to the backlog." The ledger folded findings from a RUN
// DIRECTORY and nothing else — so a defect found by running quorate lived in a chat message and in
// nobody's queue. Two intermittent suite failures had been sighted and described in prose for a week.
//
// `--add` puts them in the SAME store, keyed by the same bucketing, recurring and closing by the same
// rules. A second backlog would drift from the first, which is the defect this project spends its time
// deleting.
test('an observed defect enters the ledger, and each sighting is its own fold', () => {

  // THE DATA-LOSS BUG THIS PATH SHIPPED WITH, pinned as behaviour. mergeRun treats
  // `prior.last_seen === run_id` as re-folding the same run: idempotent bookkeeping that deliberately
  // neither increments times_seen nor reports a delta (G-18). The first --add used a DATE-based run id,
  // so the second observation of one defect on one day hit that branch and vanished — no sighting, no
  // updated claim, and a printed "(unchanged)" to someone who had just filed a bug.
  const finding = { file: 'a.mjs', line: 10, severity: 'MEDIUM', claim: 'first telling', node: 'observed' };
  const one = mergeRun({ schema_version: 1, entries: {} },
    { run_id: 'observed-20260913-120000-aaaaaa', at: '2026-09-13T12:00:00Z', findings: [finding], surface: [] });
  assert.equal(one.delta.new.length, 1, 'a new observation opens an entry');

  const sameId = mergeRun(one.ledger,
    { run_id: 'observed-20260913-120000-aaaaaa', at: '2026-09-13T13:00:00Z', findings: [finding], surface: [] });
  assert.equal(sameId.delta.new.length + sameId.delta.recurring.length, 0,
    'the same run id is absorbed silently — which is correct for a re-fold and fatal for a second sighting');
  assert.equal(Object.values(sameId.ledger.entries)[0].times_seen, 1);

  const freshId = mergeRun(one.ledger,
    { run_id: 'observed-20260913-130000-bbbbbb', at: '2026-09-13T13:00:00Z', findings: [finding], surface: [] });
  assert.equal(freshId.delta.recurring.length, 1, 'a distinct id is a second sighting');
  assert.equal(Object.values(freshId.ledger.entries)[0].times_seen, 2);

  // And the CLI composes an id that cannot collide: timestamp to the second plus a digest of the claim.
  const cli = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'findings-ledger.mjs'), 'utf8');
  assert.match(cli, /const runId = `observed-\$\{stamp\}-\$\{digest\}`;/);
  assert.match(cli, /createHash\('sha256'\)\.update\(`\$\{args\.file\}\|\$\{args\.claim\}`\)/,
    'two different defects observed in the same second must be two folds');
});

// SINCE ledger-transitions: `--add` no longer goes through mergeRun at all. It calls addObservation, which
// never runs confirmation, so an observation cannot close anyone else's finding by construction — the
// property this test used to check as `surface: []` in the CLI's source. Checked by behaviour now.
test('an observed defect claims no coverage, so it cannot close anyone else\'s finding', async () => {
  const cli = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'findings-ledger.mjs'), 'utf8');
  const block = cli.slice(cli.indexOf('if (args.add)'), cli.indexOf('process.exit(0);', cli.indexOf('if (args.add)')));
  assert.match(block, /addObservation\(/, '--add records an observation, not a fold');
  assert.doesNotMatch(block, /mergeRun\(/, 'a fold would treat the note as a review and confirm claims on its silence');
  const { addObservation } = await import('../scripts/lib/ledger.mjs');
  const other = { key: 'b.mjs:10', file: 'b.mjs', line: 12, severity: 'HIGH', status: 'fixed_claimed', claimed_in: 'r0',
    first_seen: 'r0', last_seen: 'r0', times_seen: 1, claim: 'c', nodes: ['code-audit'] };
  const after = addObservation({ schema_version: 1, runs_folded: [], entries: { [other.key]: other } },
    { file: 'a.mjs', line: 1, severity: 'LOW', claim: 'noticed', found_by: 'observed', at: '2026-09-28T00:00:00Z' });
  assert.equal(after.entries[other.key].status, 'fixed_claimed', 'a hand-added note closed a real finding');
  const note = Object.values(after.entries).find((e) => e.file === 'a.mjs');
  assert.deepEqual(note.nodes, [], 'provenance is recorded apart: someone noticing is not a lens looking');
  assert.equal(note.observations[0].found_by, 'observed');
});
