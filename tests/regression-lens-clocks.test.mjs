// A lens whose cost scales with something OTHER than diff size needs its own clock.
//
// The default node ceiling (review.node_timeout_minutes, 15) is sized for a lens reading a diff.
// Two lenses do not: feature-verify's cost is product startup plus exercise time, and
// contract-audit's is the request and intent documents it must read in full. Both were killed at
// the 15-minute cap mid-verdict — feature-verify after 14 real evidence captures on the first
// consumer run that exercised it, contract-audit on the 2026-09-06 bench, which recorded the seed
// as NOT RUN and reported nothing about the lens that was actually working.
//
// contract-audit had been visible for days before it fired: 6,8,8,6,7,8,12,3,9,14,10,13 minutes
// across twelve archived self-review runs, against a cap of 15. A ceiling a node routinely runs at
// 90% of is not a safety margin, it is a scheduled failure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

const roster = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

// Named explicitly rather than derived: adding a lens should not silently inherit an exemption,
// and removing one of these clocks should fail here with the reason it existed.
const DOC_OR_RUNTIME_BOUND = {
  'contract-audit': 'reads the request and intent documents in full; cost scales with them, not the diff',
  'feature-verify': 'cost is product startup plus exercise time, not review scope',
  // Killed at the 15-minute cap on the 2026-09-07 sweep after climbing there over two weeks:
  // 7.2, 7.9, 5.3, 6.0, 8.3, 6.9, 9.9, 10.9, 10.4, 14.1, 10.2, 10.3, 9.4, then 15.0 and dead. Its
  // cost scales with the SOURCE SURFACE it audits against the threat model, and that surface grows
  // with the tree — so it drifts into its ceiling rather than sitting under it.
  'security-audit': 'audits the whole source surface against the threat model; cost grows with the tree',
};

test('lenses bounded by something other than diff size declare their own clock', () => {
  const byId = Object.fromEntries(roster.lenses.map((l) => [l.id, l]));
  for (const [id, why] of Object.entries(DOC_OR_RUNTIME_BOUND)) {
    const lens = byId[id];
    assert.ok(lens, `${id} is missing from the roster`);
    assert.ok(Number.isInteger(lens.timeout_minutes) && lens.timeout_minutes > 15,
      `${id} must declare a timeout_minutes above the 15-minute default — ${why}. Without it the ` +
      `node is killed mid-verdict and its seed or run reports NOT RUN, which reads as a failure of ` +
      `the lens rather than of its clock.`);
    assert.match(String(lens.note ?? ''), /cost scales|scales with/i,
      `${id}'s note must say WHAT its cost scales with, or the next person tightening timeouts ` +
      `has no reason not to remove the exemption`);
  }
});

test('the per-lens clock is threaded to the spawner, not merely recorded', () => {
  // A roster key nothing reads is an inert feature — the class this framework exists to catch.
  const runGraph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(runGraph, /timeout_minutes: lens\.timeout_minutes/,
    'the roster value must be carried onto the node entry');
  assert.match(runGraph, /timeoutMinutes: e\.timeout_minutes/,
    'and passed to the spawner, or the declared clock changes nothing');
});

// A node that SURVIVED could not say what ceiling it survived: the timeout appeared only inside the
// validator_errors string of a node that was killed. Confirming contract-audit's new 30-minute clock
// had actually been applied therefore meant inferring it from "ran 16.4 minutes and was not killed",
// when the artifact should simply have said so. Same rule as contract_source and worktree_sha.
test('every node records the clock that governed it, not only the one that killed it', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');

  assert.match(src, /timeout_minutes: timeoutMs \/ 60_000/,
    'the status skeleton must carry the EFFECTIVE timeout, derived from the value actually used ' +
    'rather than re-read from argv — a second read is how the recorded clock and the real one drift');

  // It must be in the skeleton (written for every node), not only on the timeout path.
  const skeleton = src.slice(src.indexOf('let status = {'), src.indexOf('let status = {') + 3000);
  assert.match(skeleton, /timeout_minutes:/,
    'recording it only when the timeout fires leaves every surviving node unable to state its ceiling');
});

// A SCHEMA CAP IS A BOUND, NOT A STYLE GUIDE.
//
// The reconcile schema capped `summary` at 3000 characters. A 59-group run — the largest so far —
// produced 3382, failed structured output five times, and the barrier returned BLOCKED after 29.5
// minutes with no reconciled.md: every lens's adjudicated output discarded over 382 characters, on
// a review that had already cost $47.66.
//
// The summary describes the whole reconciliation, so its length scales with group count. The cap
// did not. Enforcing concision with a hard schema limit means the penalty for verbose prose is the
// loss of the entire barrier, which is never the right trade.
test('the reconcile summary cap scales past a large reconciliation', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  const m = /summary: \{ type: 'string', minLength: 20, maxLength: (\d+) \}/.exec(src);
  assert.ok(m, 'the reconcile summary schema must still be findable');

  const cap = Number(m[1]);
  // 59 groups needed 3382. A cap that merely clears the incident would bind again on the next
  // larger review, and each binding costs a whole barrier.
  assert.ok(cap >= 10000,
    `the reconcile summary cap is ${cap}: too tight for a large reconciliation. It blocked a ` +
    `59-group barrier at 3000, and a cap that only just clears the last failure will bind on the ` +
    `next bigger run — at the price of the entire review each time.`);
  // Still bounded: removing the limit entirely would let a runaway generation fill the artifact.
  assert.ok(Number.isFinite(cap), 'the cap must still exist — a bound, just a generous one');
});

// §6: "Any lens may raise these regardless of scope, regardless of intent, and no intent.md can
// waive them." perf-audit could not: allowed_basis was ["measurement","convention"], so the
// validator would drop any finding it raised with basis: invariant. With commands.bench empty it is
// static-risk-only, leaving `convention` — waivable and capped — as its only usable basis, in the
// lens best placed to notice unbounded_resource_growth. Found by contract-audit on the 2026-09-06
// sweep and kept at HIGH after the reconciler re-based it off doctrine directly.
test('every source-reading lens can raise a non-waivable invariant', () => {
  const roster = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lens-roster.json'), 'utf8'));

  for (const lens of roster.lenses) {
    const basis = lens.allowed_basis ?? [];
    // feature-verify is the one deliberate exception and is named, not inferred: it never reads
    // source, and a crash on legal input is something it MEASURED — reportable as `measurement`
    // without citing an invariant. Naming it here means removing `invariant` from any OTHER lens
    // fails this test instead of silently re-creating the gap.
    if (lens.id === 'feature-verify') {
      assert.deepEqual(basis, ['measurement'],
        'feature-verify stays measurement-only; if that changes, revisit whether it now needs invariant');
      continue;
    }
    assert.ok(basis.includes('invariant'),
      `${lens.id} cannot cite basis: invariant, so the validator drops any §6 finding it raises — ` +
      `but §6 says ANY lens may raise them regardless of scope`);
  }
});

// §8.5 rule 5: "Findings outside your declared scope are reported, never counted. They go in
// out_of_scope_observations[], which the gate prints and does not tally." Neither half existed.
//
// The validator pushed the generated-glob case into the REJECTION list, whose own message read
// "report it in out_of_scope_observations, not findings" — naming the right destination and then
// not delivering it there. Rejected findings are dropped, so the observation the doctrine promised
// to print never existed; and the gate printed no such section at all. Found by contract-audit on
// the 2026-09-06 sweep, all three sub-claims verified.
test('an out-of-scope finding is demoted to an observation, not rejected', async () => {
  const { findingOutOfScope, findingScopeErrors } = await import('../scripts/io/finding-scope.mjs');

  const f = { file: '.claude/reviews/x/gate.json', line: 1, claim: 'noise' };
  assert.match(findingOutOfScope(f, { generatedGlobs: ['.claude/reviews/**'] }) ?? '',
    /reported, not counted/, 'a generated path is out of scope, not invalid');
  assert.equal(findingOutOfScope({ file: 'scripts/x.mjs' }, { generatedGlobs: ['.claude/reviews/**'] }), null);

  // The separation is the point: defects in the FINDING stay hard rejections. Containment is
  // load-bearing — remediate reads reconciled.md with bypassPermissions, so a path escaping the
  // repository is a route out of it, never an observation.
  const escaped = findingScopeErrors({ file: '../../.ssh/config', line: 1 }, { repoRoot: REPO_ROOT });
  assert.ok(escaped.some((w) => /outside the repository/.test(w)),
    'a path escaping the repository must remain a rejection');
  assert.equal(findingOutOfScope({ file: '../../.ssh/config' }, { generatedGlobs: [] }), null,
    'and must never be reclassified as merely out of scope');
});

test('the gate prints out-of-scope observations and the spawner persists them', () => {
  const spawn = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  assert.match(spawn, /out_of_scope_observations: payload\.out_of_scope_observations/,
    'the VALIDATED artifact must carry them — rendering them only into prose is why the gate had ' +
    'nothing machine-readable to print');

  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /## Out of scope, observed \(not counted\)/,
    'the gate must print the list §8.5 says it prints');
  assert.match(graph, /verdict\.kept\.json/,
    'read from the validated artifact, not recomputed — a second scope decision could disagree with the validator');
});

// CONTRACT COVERAGE. The demotion rule makes gate strictness a function of contract hygiene: a file
// matching no declared glob is invisible to scope derivation AND undemotable-from, so a missing
// glob silently weakens the gate in the unsafe direction. Nothing checked for it — check-install
// compares contract KEYS against the template and never asks whether the globs cover the tree.
test('uncoveredFiles names what the contract declares nothing about', async () => {
  const { uncoveredFiles } = await import('../scripts/lib/finding-scope.mjs');
  const contract = {
    source_globs: ['scripts/**'], test_globs: ['tests/**', '**/*.test.mjs'],
    doc_paths: ['CLAUDE.md'], generated_globs: ['.claude/reviews/**'],
  };
  const files = ['scripts/a.mjs', 'tests/b.test.mjs', 'x/c.test.mjs', 'CLAUDE.md',
    '.claude/reviews/r/gate.json', '.gitignore', 'VERSION'];
  assert.deepEqual(uncoveredFiles(files, contract), ['.gitignore', 'VERSION']);

  // A contract declaring NOTHING cannot distinguish covered from uncovered, and must not report
  // every file as a gap — that is the ceiling-that-fires-on-a-non-problem this project warns about.
  assert.deepEqual(uncoveredFiles(files, {}), []);
});

test('a run with uncovered files is STAMPED, not blocked', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), 'utf8');
  assert.match(src, /stamps\.push\('CONTRACT-PARTIAL'\)/,
    'the gap is named on the run like every other declared gap');
  // 38 of this repository's own 858 tracked files were uncovered when this was written. A guard
  // that fires 38 times on a first run is one people route around, so it must not die().
  const block = src.slice(src.indexOf('CONTRACT COVERAGE'), src.indexOf('CONTRACT-PARTIAL') + 400);
  assert.doesNotMatch(block, /\bdie\(/,
    'reported, not blocking — the operator decides what to declare');
});
