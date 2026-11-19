// The measurement loop's own regressions, all offline. The live benchmark spends real quota per
// seed and sits behind QUORATE_BENCH=1; everything decidable without a model — scoring, manifest
// validation, corpus integrity, the spend gate, counted-facts drift — is decided here for free.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { statedFacts, countedFactDrift } from '../scripts/lib/counted-facts.mjs';
import { validateManifest, scoreSeed, summarize, patchHunkRanges, resolveAnchor } from '../scripts/lib/bench-scoring.mjs';
import { REPO_ROOT, instructionFile, writeReconciled } from './helpers.mjs';
import { ARGV_SPECS } from '../scripts/lib/argv-specs.mjs';

// SCRATCH INSIDE THE REPOSITORY, BUT IGNORED (20261001-205530-m0-pending-claims-review). These tests need a directory inside
// the repository and made it at the root as `.tmp-*`, untracked and NOT ignored — so the arms-snapshot builder's
// `git add -A`, run by another test at the same time, saw files appear and vanish and failed with "unable to index
// file" (exit 128), twice. `.sandbox/` is the gitignored scratch area CLAUDE.md names.
const SCRATCH = (() => { const d = path.join(REPO_ROOT, '.sandbox'); fs.mkdirSync(d, { recursive: true }); return d; })();

// ------------------------------------------------------------------------------ counted facts

test('statedFacts reads the counts CLAUDE.md-style prose actually states', () => {
  const facts = statedFacts('| `tests/` | 101 regression tests. | and | `skills/` | The 19 skills. |');
  assert.deepEqual(facts, { tests: 101, skills: 19 });
});

test('a document stating no counts asserts nothing, and nothing is verified against it', () => {
  assert.deepEqual(statedFacts('no numbers of interest here'), {});
  assert.deepEqual(countedFactDrift({ stated: {}, actual: { tests: 5 } }), []);
});

test('regression: a stale stated count is drift, and an uncountable fact is never a lie', () => {
  // The test count needed five manual corrections in one working day (2026-08-31). This is the
  // check that makes the sixth correction mechanical instead of remembered.
  const drift = countedFactDrift({ stated: { tests: 60, skills: 19 }, actual: { tests: 101, skills: 19 } });
  assert.deepEqual(drift, [{ fact: 'tests', stated: 60, actual: 101 }]);
  // null actual = the caller could not count — a caller problem, never "the document lies".
  assert.deepEqual(countedFactDrift({ stated: { tests: 60 }, actual: { tests: null } }), []);
});

// THE DOGFOOD MOVED OUT OF THE SUITE (operator, 2026-10-07: measured first, then "yes"). This test ran
// check-counted-facts with no count, which re-ran the whole suite inside the suite: 135.5 s of a 139 s wall-clock, the
// one test every other test finished in the shadow of. tests/run-all.mjs knows the runner's own count when the suite
// ends, so it runs the check there with --tests-count — every local run and every review pre-flight still checks the
// stated facts, at no second suite run. What is pinned here is that run-all does so, with the count it read.
test('run-all checks the stated counted facts with the count its own run produced', () => {
  const runAll = fs.readFileSync(path.join(REPO_ROOT, 'tests', 'run-all.mjs'), 'utf8');
  assert.match(runAll, /check-counted-facts\.mjs'\), '--tests-count', String\(ran\)/,
    'run-all must hand the counter the count it just read, not make it run the suite again');
  assert.match(runAll, /counted facts drifted/, 'and a drift must fail the run, saying so');
});

test('check-counted-facts fails on a doctored document, naming the drifted fact', () => {
  const doc = path.join(fs.mkdtempSync(path.join(SCRATCH, '.tmp-counts-')), 'CLAUDE.md');
  try {
    fs.writeFileSync(doc, 'The 3 skills live here.');
    const r = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'check-counted-facts.mjs'), '--doc', doc, '--tests-count', '0'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /states 3 skills; the tree has \d+/);
  } finally {
    fs.rmSync(path.dirname(doc), { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------ bench scoring

test('a finding within the tolerance window on the seeded file is a catch; outside it is not', () => {
  const manifest = {
    id: 's', title: 't', source: 'mutation', removes_tests: false, scope: ['scripts'],
    defect: { file: 'scripts/lib/decisions.mjs', anchor: 'x', lenses: ['code-audit'] },
  };
  const near = scoreSeed({
    manifest, defectLine: 100,
    findingsByNode: { 'code-audit': [{ file: 'scripts\\lib\\decisions.mjs', line: 110 }] },
  });
  assert.equal(near.caught, true);
  assert.deepEqual(near.expected_hit, ['code-audit']);

  const far = scoreSeed({
    manifest, defectLine: 100,
    findingsByNode: { 'code-audit': [{ file: 'scripts/lib/decisions.mjs', line: 300 }] },
  });
  assert.equal(far.caught, false);
  assert.deepEqual(far.expected_missed, ['code-audit']);
  assert.equal(far.fp_candidates['code-audit'], 1);
});

test('an unexpected lens catching the seed counts as caught, without inflating its recall', () => {
  const manifest = {
    id: 's', title: 't', source: 'mutation', removes_tests: false, scope: ['scripts'],
    defect: { file: 'a.mjs', anchor: 'x', lenses: ['code-audit'] },
  };
  const s = scoreSeed({
    manifest, defectLine: 10,
    findingsByNode: { 'doc-consistency-review': [{ file: 'a.mjs', line: 12 }], 'code-audit': [] },
  });
  assert.equal(s.caught, true);
  assert.deepEqual(s.caught_by, ['doc-consistency-review']);
  assert.deepEqual(s.expected_missed, ['code-audit']);

  // Recall blames only the lenses that were EXPECTED to catch a seed — otherwise every number
  // means nothing (blaming feature-verify for a logic bug in a pure function).
  const sum = summarize([s]);
  assert.equal(sum.lenses['code-audit'].recall, 0);
  assert.equal('doc-consistency-review' in sum.lenses, false);
  assert.equal(sum.overall_recall, 1);
});

test('validateManifest rejects the half-parsed shapes that would score garbage silently', () => {
  assert.ok(validateManifest(null).length);
  const errs = validateManifest({ id: 'BAD ID', source: 'guess', defect: { file: '', line: 0, lenses: [] } });
  assert.ok(errs.some((e) => /defect\.line is no longer used/.test(e)),
    'an absolute line beside an anchor is a second source of truth for the same fact');
  assert.ok(errs.some((e) => /defect\.anchor is required/.test(e)));
  assert.ok(errs.some((e) => /slug/.test(e)));
  assert.ok(errs.some((e) => /historical.*mutation/.test(e)));
  assert.ok(errs.some((e) => /lenses/.test(e)));
  assert.ok(errs.some((e) => /removes_tests/.test(e)));
});

// ----------------------------------------------------------------------------- corpus integrity

/**
 * The line ranges a seed patch touches WHERE IT ACTUALLY LANDS.
 *
 * Not from the patch's own `@@` headers: those record the position when the seed was authored and
 * go stale exactly as `defect.line` does, so checking one against the other compares two stale
 * numbers and passes. `git apply` reported this patch landing at 266 with "offset 96 lines" while
 * its header still said 170.
 *
 * So the patch is applied in a THROWAWAY WORKTREE and git is asked what changed. `-U0` gives the
 * changed lines with no context, in the seeded file's real coordinates — git's own arithmetic, in a
 * structured format, rather than parsing the prose of `git apply -v`. The worktree matters for a
 * second reason: applying to the real tree would make the suite mutate the repository it tests,
 * which is the defect the sibling litter test exists to prevent.
 *
 * COROLLARY, because it is easy to get wrong: `defect.line` is a property of (patch + tree AT THAT
 * MOMENT), so it is only meaningful against a run of the same tree. Correcting a manifest does not
 * retroactively rescore an archived run — re-scoring one with a corrected manifest compares two
 * different trees and produces a confident wrong answer. An archived result stands as what was
 * measured; corrections are annotated beside it, never written over it.
 */
function seededFileText(patchPath, file) {
  const patch = fs.readFileSync(patchPath, 'utf8');
  // The files this patch touches, from its own headers — so only those are staged and the check
  // does not depend on the rest of the tree.
  const targets = [...patch.matchAll(/^\+\+\+ (?:b\/)?(.+?)\s*$/gm)].map((m) => m[1]);
  assert.ok(targets.length, `${patchPath} names no target files`);

  // ONE TREE, AND IT IS THE WORKING TREE.
  //
  // This used to `git apply --check` in REPO_ROOT (dirty) and then apply for real in a worktree at
  // HEAD (clean) — two different trees answering one question. A seed regenerated alongside
  // uncommitted code passed the check and failed the apply, so it could not be verified until after
  // it was committed, and the only way through was to commit on a red suite and re-run.
  //
  // The working tree is the right one: during development it is what the seed must match, and at
  // commit time it is what becomes HEAD, so the two agree exactly when it matters. Copies are used
  // rather than a worktree because applying to the real tree would make the suite mutate the
  // repository it tests — and because a temp copy is faster than a worktree per seed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-seedcheck-'));
  try {
    for (const t of targets) {
      const src = path.join(REPO_ROOT, t);
      if (!fs.existsSync(src)) continue; // a patch that creates a file: nothing to copy
      fs.mkdirSync(path.join(dir, path.dirname(t)), { recursive: true });
      fs.copyFileSync(src, path.join(dir, t));
    }
    // A throwaway repo around the copies, so git computes the applied coordinates. The patch's OWN
    // `@@` headers cannot be used: they record where the hunk sat when the seed was authored and go
    // stale exactly as defect.line did — checking the anchor against them compares a fresh number
    // to a stale one and fails on a correct seed. (It did: 277 vs a header still saying 170.)
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    git('add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'before');

    const ap = git('apply', '-p1', patchPath);
    assert.equal(ap.status, 0,
      `defect.patch does not apply to the working tree — the tree moved; regenerate the seed.\n${ap.stderr}`);

    const target = path.join(dir, file);
    assert.ok(fs.existsSync(target), `defect.file is not in the seeded tree: ${file}`);
    const d = git('diff', '-U0', '--', file);
    return { text: fs.readFileSync(target, 'utf8'), ranges: patchHunkRanges(d.stdout, file) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('every corpus seed validates, applies cleanly, and names a file that exists', () => {
  // A patch that stops applying after a refactor must fail VISIBLY here, telling the developer to
  // regenerate the seed — a corpus that rots silently is an inert feature, the exact defect class
  // this framework hunts. To regenerate: apply the intended edits, `git diff -- <files>` into
  // defect.patch, restore, and re-measure defect.line in the seeded state.
  const corpusDir = path.join(REPO_ROOT, 'bench', 'corpus');
  const seeds = fs.readdirSync(corpusDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  assert.ok(seeds.length >= 3, 'the founding corpus has three historical seeds');

  for (const seed of seeds) {
    const dir = path.join(corpusDir, seed.name);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.deepEqual(validateManifest(manifest), [], `${seed.name}: manifest invalid`);
    assert.equal(manifest.id, seed.name, `${seed.name}: manifest id must match its directory`);
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, manifest.defect.file)),
      `${seed.name}: defect.file does not exist in the tree`,
    );
    const r = spawnSync('git', ['apply', '--check', path.join(dir, 'defect.patch')], {
      cwd: REPO_ROOT, encoding: 'utf8',
    });
    assert.equal(
      r.status, 0,
      `${seed.name}: defect.patch no longer applies — the tree moved; regenerate the seed.\n${r.stderr}`,
    );

    // AND the anchor must resolve, uniquely, inside what the patch actually touched.
    //
    // The seed's location is now CONTENT, not a number: defect.anchor is a literal fragment of the
    // seeded file and the line is computed at score time, so nothing above the defect can move it.
    // This check is what keeps the anchor honest — it must still exist (or the seed no longer
    // describes the tree), must be unique (or "the line" is a guess), and must sit in the region the
    // patch changed (or it anchors something unrelated and scores the wrong place).
    const seeded = seededFileText(path.join(dir, 'defect.patch'), manifest.defect.file);
    const anchored = resolveAnchor(seeded.text, manifest.defect.anchor);
    assert.ok(anchored.ok, `${seed.name}: ${anchored.why}`);

    const tol0 = manifest.tolerance ?? 15;
    const inPatch = seeded.ranges.some(
      (g) => anchored.line >= g.start - tol0 && anchored.line <= g.end + tol0);
    assert.ok(inPatch,
      `${seed.name}: defect.anchor resolves to line ${anchored.line}, which is not within tolerance ` +
      `${tol0} of anything the patch changed (${seeded.ranges.map((g) => `${g.start}-${g.end}`).join(', ')}). ` +
      `The anchor is pointing at something the seed did not seed.`);


  }
});

// -------------------------------------------------------------------------------- the runner

function runBench(argv, env = {}) {
  return spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts', 'bench-lenses.mjs'), ...argv],
    // Inherit, then scrub, then apply overrides — the same rule helpers.runScript states: a
    // developer's (or a LENS's) ambient GRAPH_NODE_DEPTH must not decide whether a test passes.
    // Every lens runs the declared test command at depth 1, and without this scrub the suite was
    // red for a lens and green for an operator (G-5): two spawns here aborted on the inherited
    // guard, so a lens citing the declared test run cited a failure the tree does not have.
    { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, GRAPH_NODE_DEPTH: undefined, QUORATE_BENCH: '', ...env } },
  );
}

test('regression: the benchmark refuses to spend without the explicit opt-in, and lists instead', () => {
  const r = runBench([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /QUORATE_BENCH=1/);
  assert.match(r.stdout, /probe-substring-match/);
  assert.doesNotMatch(r.stdout, /worktree/i, 'listing must not touch a worktree');

  // AND THE OUTPUT MUST BE WELL FORMED. Every assertion above is an EXISTENCE check: it proves the
  // listing ran and mentioned a seed. None constrains what it actually printed, so when defect.line
  // was replaced by defect.anchor this test passed happily while every seed rendered as
  // `scripts/lib/decisions.mjs:undefined`. The path was exercised on every suite run; the
  // assertions simply did not look at it. That is the failure the contract's own test rule names —
  // "does this test actually constrain the behaviour it claims to?"
  // A RENDERED FIELD, not any occurrence of the word (G-21 of 20261001-234443-pending-claims-confirm-2). This regex held
  // raw backspace bytes where `\b` was meant, so it could never match; made to work, its bare word form flagged a
  // correct listing, whose anchor quotes code containing `null`. What it exists to catch is a value rendered after a
  // separator — `decisions.mjs:undefined`, `anchored on: null` — or an object printed as text.
  assert.doesNotMatch(r.stdout, /(:|: )(undefined|null|NaN)\b|\[object Object\]/,
    'a rendered field with no value means the listing is reading a key the manifest no longer has');

  // Each seed renders its id, its file, and the anchor that locates the defect. Checked per seed
  // rather than "somewhere in the output", so a single well-formed entry cannot cover for six
  // broken ones.
  const corpusDir = path.join(REPO_ROOT, 'bench', 'corpus');
  for (const d of fs.readdirSync(corpusDir, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    const m = JSON.parse(fs.readFileSync(path.join(corpusDir, d.name, 'manifest.json'), 'utf8'));
    assert.ok(r.stdout.includes(d.name), `listing omits seed ${d.name}`);
    assert.ok(r.stdout.includes(m.defect.file), `listing omits ${d.name}'s defect.file`);
    assert.ok(r.stdout.includes(m.defect.anchor.slice(0, 40)),
      `listing omits ${d.name}'s anchor — the anchor is what locates the defect now, so a listing ` +
      `without it cannot tell the reader what the seed is looking for`);
  }
});

test('score-only reads a real run layout offline: kept findings in, recall out', () => {
  const dir = fs.mkdtempSync(path.join(SCRATCH, '.tmp-bench-'));
  try {
    // The exact artifact shape the engine writes: evidence/<node>/verdict.kept.json.
    const ev = path.join(dir, '20260101-000000-bench', 'evidence', 'code-audit');
    fs.mkdirSync(ev, { recursive: true });
    // The finding's line is derived from the manifest, not written as a literal. A literal here
    // silently became "2 lines from the seed" -> "96 lines from the seed" when defect.line was
    // corrected, so this test asserted the tolerance window against a number it no longer knew.
    // The defect line is now RESOLVED per run, not stored in the manifest, so the fixture picks one
    // and passes the same value to --defect-line. Nothing here can go stale against the tree.
    const seedManifest = JSON.parse(fs.readFileSync(
      path.join(REPO_ROOT, 'bench', 'corpus', 'probe-substring-match', 'manifest.json'), 'utf8'));
    const DEFECT_LINE = 270;
    fs.writeFileSync(path.join(ev, 'verdict.kept.json'), JSON.stringify({
      findings: [{ file: seedManifest.defect.file, line: DEFECT_LINE + 2, severity: 'HIGH' }],
    }));
    const nodes = path.join(dir, '20260101-000000-bench', 'nodes');
    fs.mkdirSync(nodes, { recursive: true });
    // The status and the run record a real run carries: the benchmark reader scores a node only when it reported
    // OK, and a directory with no run.json not at all (G-17, G-18 of 20260928-232013-ltb-review-r2).
    fs.writeFileSync(path.join(nodes, 'code-audit.status.json'), JSON.stringify({
      node_id: 'code-audit', state: 'OK', findings_count: 1, total_cost_usd: 2.5,
    }));
    // The directory is named for its run_id: an admitted run is the run its run.json names (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
    fs.writeFileSync(path.join(dir, '20260101-000000-bench', 'run.json'), JSON.stringify({ run_id: '20260101-000000-bench' }));

    const r = runBench([
      '--score-only', '--run-dir', path.join(dir, '20260101-000000-bench'),
      '--manifest', path.join(REPO_ROOT, 'bench', 'corpus', 'probe-substring-match', 'manifest.json'),
      '--defect-line', String(DEFECT_LINE),
    ]);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.score.caught, true, 'a finding 2 lines from the seed is a catch');
    assert.deepEqual(out.score.caught_by, ['code-audit']);
    assert.equal(out.summary.lenses['code-audit'].recall, 1);
    assert.equal(out.summary.lenses['code-audit'].cost_usd, 2.5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('regression: a graph node may not start a benchmark', () => {
  const r = runBench([], { GRAPH_NODE_DEPTH: '1' });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /may not start a benchmark/);
});

// ------------------------------------------------------------------------------ findings ledger

test('the ledger keys a finding by location, so reworded claims stay one defect', async () => {
  const { findingKey, mergeRun } = await import('../scripts/lib/ledger.mjs');
  // A Windows-separator path and a POSIX one are the same location, so they must be the same key.
  assert.equal(findingKey({ file: 'a' + '\\' + 'b.mjs', line: 42 }), 'a/b.mjs:40');
  const run1 = mergeRun(null, {
    run_id: 'r1', at: 't1',
    findings: [{ file: 'a/b.mjs', line: 42, severity: 'MEDIUM', claim: 'first wording', node: 'code-audit' }],
  });
  const run2 = mergeRun(run1.ledger, {
    run_id: 'r2', at: 't2',
    findings: [{ file: 'a/b.mjs', line: 44, severity: 'HIGH', claim: 'second wording', node: 'arch-review' }],
  });
  assert.deepEqual(run2.delta.recurring, ['a/b.mjs:40']);
  const e = run2.ledger.entries['a/b.mjs:40'];
  assert.equal(e.times_seen, 2);
  assert.equal(e.severity, 'HIGH', 'severity ratchets to the worst reported');
  assert.deepEqual(e.nodes.sort(), ['arch-review', 'code-audit']);

  // The bucket-BOUNDARY case (G-16): 39 keys to :30, 41 keys to :40 — one inserted line above an
  // unchanged defect used to split it into a fresh entry plus a silent one. The adjacency probe
  // resolves it back to the existing entry.
  const b1 = mergeRun(null, { run_id: 'r1', at: 't1', findings: [{ file: 'x.mjs', line: 39, severity: 'LOW', claim: 'c' }] });
  const b2 = mergeRun(b1.ledger, { run_id: 'r2', at: 't2', findings: [{ file: 'x.mjs', line: 41, severity: 'LOW', claim: 'c' }] });
  assert.deepEqual(b2.delta.new, [], 'a one-line shift across the boundary is not a new defect');
  // The entry MIGRATES with the defect (round-3 G-8): key and line move together, so the
  // reported key always names where the defect currently is, and its history rides along.
  assert.deepEqual(b2.delta.recurring, ['x.mjs:40']);
  assert.equal(b2.ledger.entries['x.mjs:40'].times_seen, 2, 'the history migrates with the key');
  assert.equal('x.mjs:30' in b2.ledger.entries, false, 'the stale key must not linger to claim unrelated defects');
  assert.deepEqual(b2.delta.silent_this_run, []);

  // Intra-run duplicates carry the WORST of what was reported (G-17), never first-lens-wins.
  const w = mergeRun(null, { run_id: 'r1', at: 't1', findings: [
    { file: 'y.mjs', line: 5, severity: 'LOW', claim: 'mild wording', node: 'code-audit' },
    { file: 'y.mjs', line: 7, severity: 'BLOCKER', claim: 'the real story', node: 'security-audit' },
  ] });
  const we = w.ledger.entries['y.mjs:0'];
  assert.equal(we.severity, 'BLOCKER', 'the entry must carry the worst severity reported this run');
  assert.deepEqual(we.nodes.sort(), ['code-audit', 'security-audit']);
  assert.equal(we.times_seen, 1, 'two lenses in one run are one sighting');
});

test('regression: absence from a run never closes an entry — only remediation does', async () => {
  // A lens that did not look is indistinguishable from a defect that is gone; auto-closing on
  // silence would be the ledger-shaped version of silence as a verdict.
  const { mergeRun, markFixed, openEntries } = await import('../scripts/lib/ledger.mjs');
  const r1 = mergeRun(null, {
    run_id: 'r1', at: 't1', findings: [{ file: 'x.mjs', line: 5, severity: 'HIGH', claim: 'c' }],
  });
  const r2 = mergeRun(r1.ledger, { run_id: 'r2', at: 't2', findings: [] });
  assert.deepEqual(r2.delta.silent_this_run, ['x.mjs:0']);
  assert.equal(r2.ledger.entries['x.mjs:0'].status, 'open', 'silence must not close it');

  // A REMEDIATION CLAIM IS NOT A CLOSURE. markFixed can only record what the remediator says; it
  // reads no tree and re-runs no check, so writing `fixed` from a supplied key alone let a fix that
  // was never written, or never landed, drop out of the cross-run memory with nothing having
  // confirmed it (G-30). The entry stays open, carrying the claim.
  const { ledger } = markFixed(r2.ledger, ['x.mjs:0'], 'remediation-run');
  assert.equal(ledger.entries['x.mjs:0'].status, 'fixed_claimed');
  assert.equal(ledger.entries['x.mjs:0'].claimed_in, 'remediation-run');
  assert.deepEqual(openEntries(ledger).map((e) => e.key), ['x.mjs:0'],
    'a claimed fix is still open work until a run confirms it');

  // ...and a fixed defect that reappears is REOPENED, loudly, never counted as new.
  const r3 = mergeRun(ledger, {
    run_id: 'r3', at: 't3', findings: [{ file: 'x.mjs', line: 6, severity: 'HIGH', claim: 'back' }],
  });
  assert.equal(r3.ledger.entries['x.mjs:0'].status, 'reopened');
  assert.deepEqual(r3.delta.new, []);
});

// CONFIRMATION IS THE ONLY THING THAT CLOSES AN ENTRY (G-30). Absence still never closes an OPEN
// entry — that is the rule above — but absence PLUS a remediation claim PLUS proof the run actually
// reviewed that file is the evidence the doctrine asks for, and nothing was reading it.
test('regression: a claimed fix closes only when a run that covered the file stays silent', async () => {
  const { mergeRun, markFixed, openEntries } = await import('../scripts/lib/ledger.mjs');
  const seed = () => {
    const a = mergeRun(null, {
      run_id: 'r1', at: 't1',
      findings: [{ file: 'scripts/a.mjs', line: 12, severity: 'HIGH', claim: 'c', node: 'code-audit' }],
    }).ledger;
    return markFixed(a, ['scripts/a.mjs:10'], 'r2').ledger;
  };
  // The lens that RAISED it must be among those that reported OK (G-14): confirmation is specific
  // to the lens, not to the run. This test is about the other three conditions, so it supplies the
  // fourth throughout and lets regression-ledger-confirming-lens.test.mjs vary it.
  const okNodes = new Set(['code-audit']);

  // A run that did not look at scripts/ cannot confirm anything about it.
  const elsewhere = mergeRun(seed(), { run_id: 'r3', at: 't3', findings: [], surface: ['skills'], reviewed: true, okNodes });
  assert.equal(elsewhere.ledger.entries['scripts/a.mjs:10'].status, 'fixed_claimed',
    'a run that never reviewed the file confirms nothing');

  // A run with NO recorded surface confirms nothing either — the safe direction.
  const blind = mergeRun(seed(), { run_id: 'r3', at: 't3', findings: [], reviewed: true, okNodes });
  assert.equal(blind.ledger.entries['scripts/a.mjs:10'].status, 'fixed_claimed');

  // The claiming run may not confirm itself.
  const selfish = mergeRun(seed(), { run_id: 'r2', at: 't2', findings: [], surface: ['scripts'], reviewed: true, okNodes });
  assert.equal(selfish.ledger.entries['scripts/a.mjs:10'].status, 'fixed_claimed');

  // A later run that DID review scripts/ and did not report it: confirmed.
  const confirmed = mergeRun(seed(), { run_id: 'r3', at: 't3', findings: [], surface: ['scripts'], reviewed: true, okNodes });
  const e = confirmed.ledger.entries['scripts/a.mjs:10'];
  assert.equal(e.status, 'fixed');
  assert.equal(e.verified_in, 'r3');
  assert.equal(e.fixed_in, 'r2', 'the fix belongs to the run that made it, not the one that saw it gone');
  assert.deepEqual(openEntries(confirmed.ledger), []);
  assert.deepEqual(confirmed.delta.silent_this_run, [],
    'a claimed fix going unmentioned is the confirmation, not an unanswered open entry');

  // A RUN THAT REVIEWED NOTHING CONFIRMS NOTHING. Scope says the file was in front of a lens;
  // `reviewed` says a lens was there to look. A BLOCKED run, or one whose lenses crashed, covers its
  // files on paper — closing a remediation claim on that silence is silence-as-a-verdict (G-22).
  const unreviewed = mergeRun(seed(), { run_id: 'r3', at: 't3', findings: [], surface: ['scripts'] });
  assert.equal(unreviewed.ledger.entries['scripts/a.mjs:10'].status, 'fixed_claimed',
    'a run whose lenses never reported has confirmed nothing, whatever its scope said');

  // And a claim that was simply WRONG reopens, exactly like a confirmed fix that regressed.
  const back = mergeRun(seed(), {
    run_id: 'r3', at: 't3', surface: ['scripts'], reviewed: true,
    findings: [{ file: 'scripts/a.mjs', line: 12, severity: 'HIGH', claim: 'still here' }],
  });
  assert.equal(back.ledger.entries['scripts/a.mjs:10'].status, 'reopened');
});

// `declined` is a decision, `not-fixed` is a failed attempt, and the vocabulary could express only
// the second — so every deliberate decision not to act was recorded as a failure to act, losing the
// reason nobody will re-derive (G-58). The doctrine has always distinguished them
// (disk-first-protocol §6, "declined deliberately rather than missed").
test('regression: a finding may be DECLINED, and a decline must carry its reason', async () => {
  const { mergeRun, markFixed, openEntries, convergence } = await import('../scripts/lib/ledger.mjs');
  const base = mergeRun(null, {
    run_id: 'r1', at: 't1', findings: [{ file: 'x.mjs', line: 1, severity: 'HIGH', claim: 'c' }],
  }).ledger;

  assert.throws(() => markFixed(base, ['x.mjs:0'], 'r2', { disposition: 'declined' }), /reason/,
    'a decline with no reason is indistinguishable from an entry nobody looked at');
  assert.throws(() => markFixed(base, ['x.mjs:0'], 'r2', { disposition: 'wontfix' }), /disposition/);

  // SINCE ledger-transitions: a decline an agent records is a PROPOSAL — open work until the operator
  // confirms it (G-17 of 20260927-224505-ledger-review-r3). The decision is the operator's decline.
  const proposed = markFixed(base, ['x.mjs:0'], 'r2', {
    disposition: 'declined', reason: 'intended behaviour; the caller validates first',
  }).ledger;
  assert.equal(proposed.entries['x.mjs:0'].status, 'declined');
  assert.equal(openEntries(proposed).length, 1, 'an agent\'s decline awaits the operator');
  const { ledger } = markFixed(base, ['x.mjs:0'], 'r2', {
    disposition: 'declined', reason: 'intended behaviour; the caller validates first', operator_quote: 'decline it',
  });
  assert.equal(ledger.entries['x.mjs:0'].status, 'declined');
  assert.match(ledger.entries['x.mjs:0'].reason, /intended behaviour/);
  assert.deepEqual(openEntries(ledger), [], 'the operator\'s decline is an answer, not open work');
  assert.equal(convergence(ledger).open_above_floor, 0);
});

// WHICH RUN IS NEWEST is a fact about the ledger, not about the open set. Reading it from the
// largest first_seen among OPEN entries meant that the moment a cycle found nothing new — the exact
// outcome the convergence signal exists to detect — newest_run silently fell back to an older run
// and its introductions were counted as this cycle's (G-31).
test('regression: convergence names the newest run even when that run introduced nothing', async () => {
  const { mergeRun, convergence } = await import('../scripts/lib/ledger.mjs');
  const finding = { file: 'x.mjs', line: 1, severity: 'HIGH', claim: 'c' };
  let l = mergeRun(null, { run_id: '20260101-a', at: 't1', findings: [finding] }).ledger;
  l = mergeRun(l, { run_id: '20260909-z', at: 't2', findings: [finding] }).ledger;

  const c = convergence(l);
  assert.equal(c.newest_run, '20260909-z', 'the newest run is the newest run, open finding or not');
  assert.equal(c.new_above_floor_this_run, 0,
    'the newest cycle introduced nothing; counting the OLD run as this one is the defect');
  assert.equal(c.open_above_floor, 1, 'the recurring HIGH is still open — it is just not new');
});

test('the ledger CLI ingests a real run layout and refuses a corrupt ledger', () => {
  const dir = fs.mkdtempSync(path.join(SCRATCH, '.tmp-ledger-'));
  try {
    const run = path.join(dir, '20260901-000000-x');
    const ev = path.join(run, 'evidence', 'code-audit');
    fs.mkdirSync(ev, { recursive: true });
    fs.writeFileSync(path.join(ev, 'verdict.kept.json'), JSON.stringify({
      findings: [{ file: 'scripts/a.mjs', line: 10, severity: 'HIGH', claim: 'real defect' }],
    }));
    // A real run has the node's status beside its verdict, and the fold takes findings only from an OK node,
    // as the barrier does (G-5 of 20260928-221454-ltb-review). This fixture had none.
    const okStatus = (runDir) => {
      fs.mkdirSync(path.join(runDir, 'nodes'), { recursive: true });
      fs.writeFileSync(path.join(runDir, 'nodes', 'code-audit.status.json'), JSON.stringify({ node_id: 'code-audit', state: 'OK', findings_count: 1 }));
    };
    okStatus(run);
    // A run record named for the directory: the fold admits only a run its run.json names (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
    const record = (runDir) => fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ run_id: path.basename(runDir) }));
    record(run);
    // And what the barrier decided: the fold reads reconciled groups (ledger-identity, stage 5).
    writeReconciled(run, [{ file: 'scripts/a.mjs', line: 10, severity: 'HIGH', claim: 'real defect' }]);
    const cli = path.join(REPO_ROOT, 'scripts', 'findings-ledger.mjs');
    let r = spawnSync(process.execPath, [cli, '--run-dir', run, '--ledger', path.join(dir, 'ledger.json')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 new, 0 recurring/);
    assert.ok(fs.existsSync(path.join(dir, 'ledger.json')), 'ledger lands beside the runs');

    // Re-folding the SAME run is idempotent bookkeeping, never a second sighting (G-18): the
    // innocent-looking repeat used to inflate times_seen and promote a single sighting up the
    // most-seen ordering as though two independent runs had confirmed it.
    r = spawnSync(process.execPath, [cli, '--run-dir', run, '--ledger', path.join(dir, 'ledger.json')], { encoding: 'utf8' });
    assert.match(r.stdout, /0 new, 0 recurring/);
    let stored = JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'));
    assert.equal(Object.values(stored.entries)[0].times_seen, 1, 'a refold must not count as a sighting');

    // A DIFFERENT run reporting the same location is the real recurrence.
    const run2 = path.join(dir, '20260902-000000-y');
    fs.mkdirSync(path.join(run2, 'evidence', 'code-audit'), { recursive: true });
    fs.writeFileSync(path.join(run2, 'evidence', 'code-audit', 'verdict.kept.json'), JSON.stringify({
      findings: [{ file: 'scripts/a.mjs', line: 11, severity: 'HIGH', claim: 'still there' }],
    }));
    okStatus(run2);
    record(run2);
    writeReconciled(run2, [{ file: 'scripts/a.mjs', line: 11, severity: 'HIGH', claim: 'still there' }]);
    r = spawnSync(process.execPath, [cli, '--run-dir', run2, '--ledger', path.join(dir, 'ledger.json')], { encoding: 'utf8' });
    assert.match(r.stdout, /0 new, 1 recurring/);

    // A corrupt ledger is refused, never silently replaced — zeroing the cross-run memory
    // would erase every open defect without a trace.
    fs.writeFileSync(path.join(dir, 'ledger.json'), '{corrupt');
    r = spawnSync(process.execPath, [cli, '--run-dir', run, '--ledger', path.join(dir, 'ledger.json')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to overwrite/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------- reconcile diffing

test('the reconcile differ separates decision flips from severity drift, kept-vs-erased first', async () => {
  const { diffAdjudications } = await import('../scripts/lib/reconcile-diff.mjs');
  const a = { intent_intact: true, groups: [
    { group_id: 'g1', decision: 'confirmed', severity: 'HIGH' },
    { group_id: 'g2', decision: 'confirmed', severity: 'HIGH' },
    { group_id: 'g3', decision: 'symptom', severity: 'MEDIUM' },
    { group_id: 'g4', decision: 'dropped', severity: 'LOW' },
  ] };
  const b = { intent_intact: true, groups: [
    { group_id: 'g1', decision: 'confirmed', severity: 'HIGH' },
    { group_id: 'g2', decision: 'dropped', severity: 'HIGH' },
    { group_id: 'g3', decision: 'symptom', severity: 'LOW' },
    { group_id: 'g5', decision: 'confirmed', severity: 'HIGH' },
  ] };
  const d = diffAdjudications(a, b);
  assert.equal(d.groups_judged_by_both, 3);
  assert.deepEqual(d.agreed, ['g1']);
  // g2 is the costly kind — one adjudicator kept what the other erased — and sorts first.
  assert.equal(d.diverged[0].group_id, 'g2');
  assert.equal(d.diverged[0].kept_vs_erased, true);
  assert.equal(d.diverged[1].group_id, 'g3');
  assert.equal(d.diverged[1].decision_flip, false);
  assert.deepEqual(d.only_in_a, ['g4']);
  assert.deepEqual(d.only_in_b, ['g5']);
  assert.equal(d.disagreement_rate, 0.667);
});

test('regression: an empty adjudication is not calm — the differ refuses to bless it', async () => {
  const { diffAdjudications, payloadJudgedSomething } = await import('../scripts/lib/reconcile-diff.mjs');
  assert.equal(payloadJudgedSomething({ groups: [] }), false);
  assert.equal(payloadJudgedSomething(null), false);
  assert.equal(payloadJudgedSomething({ groups: [{ group_id: 'g1', decision: 'confirmed' }] }), true);
  // Two empty payloads "agree" on nothing; the rate must be null, never 0 (perfect agreement).
  assert.equal(diffAdjudications({ groups: [] }, { groups: [] }).disagreement_rate, null);
});

test('run-graph wires --reconcile-twice as measurement, never adjudication', () => {
  // The engine path cannot run offline, so the wiring is pinned at source level: the flag exists,
  // the second node is reconcile-b, the diff is written, and — the property that matters — the
  // gate never reads reconcile-b's state. A calibration experiment that could flip the verdict
  // would put the experiment in charge of the judgment it exists to measure.
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  // The flag is in run-graph's spec, which is what its parser accepts (entrypoint-argv.plan.md stage 3).
  assert.equal(ARGV_SPECS['run-graph'].options['reconcile-twice'], 'boolean');
  assert.match(graph, /nodeId: 'reconcile-b'/);
  assert.match(graph, /reconcile-divergence\.json/);
  assert.match(graph, /divergence unmeasured, which is not agreement/);
  // reconcileState (which the gate consumes) takes a node's state exactly once — from the FIRST
  // reconcile. The `let ... = 'SKIPPED'` initializer is not a node assignment and is excluded.
  assert.equal(graph.match(/reconcileState = st\b/g).length, 1, 'the calibration run must not touch the gate');
});

// -------------------------------------------------------------------------- consumer onboarding

test('every path QUORATE.md tells a consumer to run exists in this tree', () => {
  // QUORATE.md is the promise "reference this and everything works". A named script or doctrine
  // file that has moved turns that promise into an inert guarantee at the exact moment a NEW
  // consumer follows it — the reader least equipped to debug the miss. Paths are checked with the
  // consumer mount prefix stripped, because that prefix maps to this repository's root.
  const text = fs.readFileSync(path.join(REPO_ROOT, 'QUORATE.md'), 'utf8');
  const refs = [...new Set(
    [...text.matchAll(/(?:\.claude\/skills\/quorate\/)?((?:scripts|shared|\.claude\/hooks)\/[A-Za-z0-9._/-]+\.(?:mjs|md))/g)]
      .map((m) => m[1]),
  )];
  assert.ok(refs.length >= 6, `expected QUORATE.md to name several runnable paths, found ${refs.length}`);
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, ref)), `QUORATE.md names ${ref}, which does not exist`);
  }
  // The skills it advertises must exist too — a renamed skill would strand the reader mid-setup.
  //
  // BUILT-IN COMMANDS ARE NOT SKILLS, and this guard could not tell the difference: QUORATE.md now
  // tells a consumer to run `/reload-plugins` after mounting (it is what makes a newly mounted quorate
  // appear in an open session), and the check reported it as an advertised skill that does not exist.
  // Listed explicitly rather than pattern-matched away, so adding a second built-in is a decision
  // someone makes rather than a hole that widens.
  const BUILT_IN = new Set(['reload-plugins']);
  for (const skill of [...text.matchAll(/`\/([a-z-]+)`/g)].map((m) => m[1]).filter((s2) => !BUILT_IN.has(s2))) {
    assert.ok(
      // Either library: QUORATE.md may name a skill a person invokes or a node prompt, and after the
      // 2026-09-09 split those live in different directories.
      fs.existsSync(path.join(REPO_ROOT, 'skills', skill, 'SKILL.md'))
        || fs.existsSync(path.join(REPO_ROOT, 'prompts', skill, 'PROMPT.md')),
      `QUORATE.md advertises /${skill}, which is not an installed skill`,
    );
  }
  // The setup step it leads with must point at a real file.
  assert.match(text, /CLAUDE\.template\.md/);
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'CLAUDE.template.md')));
});

test('the consumer template parses as a contract once its placeholders are filled', () => {
  // The template is the promise "copy, fill, done" — so the offline suite fills it mechanically
  // and hands it to the REAL contract parser. A template that new-run rejects after a good-faith
  // fill strands a new consumer at step 2, and nothing but this test would notice before they do.
  const dir = fs.mkdtempSync(path.join(SCRATCH, '.tmp-template-'));
  try {
    const filled = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.template.md'), 'utf8')
      .replace('<project-slug>', 'sample-project')
      .replace('<e.g. npm run build>', 'echo build')
      .replace('<e.g. npm test>', 'echo test')
      .replace(/<Two or three sentences:[^>]*>/s, 'A sample threat model for the template test.')
      .replace(/^# <your-project-name>$/m, '# sample');
    assert.doesNotMatch(filled, /"<|<e\.g\./, 'every yaml placeholder must be covered by the fill above');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), filled);
    // --print-contract parses and prints; it starts nothing, so it is safe offline (§8).
    const r = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'new-run.mjs'), '--print-contract', '--repo-root', dir],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, `the filled template did not parse:
${r.stdout}${r.stderr}`);
    const contract = JSON.parse(r.stdout);
    assert.equal(contract.project, 'sample-project');
    assert.equal(contract.commands.build, 'echo build');
    assert.equal(contract.review.external_panel, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the plugin manifest exists and QUORATE.md and CLAUDE.md agree it is the discovery mechanism', () => {
  // CLAUDE.md has claimed plugin.json discovery since the plugin-layout migration; the file
  // itself only landed with QUORATE.md. Version parity with VERSION is guarded by the
  // framework-stamp suite; this pins existence and shape.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'),
  );
  assert.equal(manifest.name, 'quorate');
  assert.ok(manifest.description.includes('Silence' ) || manifest.description.includes('silence'),
    'the description carries the central rule');
});

test('regression: two lenses straddling a bucket boundary on FIRST sighting are one entry (G-14)', async () => {
  const { mergeRun } = await import('../scripts/lib/ledger.mjs');
  // 39 keys to :30, 41 keys to :40 — same run, same defect, first time either is seen. The
  // adjacency index was built once from the prior (empty) ledger, so both used to open entries.
  const r = mergeRun(null, { run_id: 'r1', at: 't1', findings: [
    { file: 'x.mjs', line: 39, severity: 'LOW', claim: 'a', node: 'code-audit' },
    { file: 'x.mjs', line: 41, severity: 'HIGH', claim: 'b', node: 'security-audit' },
  ] });
  assert.equal(Object.keys(r.ledger.entries).length, 1, 'one defect, one entry');
  const e = Object.values(r.ledger.entries)[0];
  assert.equal(e.severity, 'HIGH', 'the worst severity survives');
  assert.deepEqual(e.nodes.sort(), ['code-audit', 'security-audit'], 'both lenses on one entry');
});

test('the loop convergence signal reads the ledger, not "is it empty" (a loop is never empty)', async () => {
  const { convergence } = await import('../scripts/lib/ledger.mjs');
  // Drained: nothing open at/above the floor, even though LOWs remain.
  const drained = convergence({ entries: {
    'a:0': { key: 'a:0', severity: 'LOW', status: 'open', first_seen: 'r3' },
  } }, { floor: 'HIGH' });
  assert.equal(drained.drained, true, 'LOWs remaining is still drained at a HIGH floor');
  assert.equal(drained.by_severity.LOW, 1);

  // Not drained: the newest run introduced a fresh HIGH.
  const active = convergence({ entries: {
    'a:0': { key: 'a:0', severity: 'HIGH', status: 'open', first_seen: 'r5' },
    'b:0': { key: 'b:0', severity: 'MEDIUM', status: 'open', first_seen: 'r2' },
  } }, { floor: 'HIGH' });
  assert.equal(active.drained, false);
  assert.equal(active.new_above_floor_this_run, 1);
  assert.equal(active.newest_run, 'r5');

  // A fixed HIGH does not count as open.
  const closed = convergence({ entries: {
    'a:0': { key: 'a:0', severity: 'HIGH', status: 'fixed', first_seen: 'r5' },
  } }, { floor: 'HIGH' });
  assert.equal(closed.drained, true);
});

// ------------------------------------------------------------------------------ anchor resolution
//
// defect.line was an absolute number recorded when a seed was authored, and it rotted whenever
// anything above the defect grew. THREE seeds rotted in a single day of ordinary edits. Every rot
// scored a correct finding as a MISS, and it fails pessimistically — the direction nobody
// investigates. The line is now computed from content at score time, so there is nothing to rot.

test('an anchor resolves to the line containing it, wherever the file has grown', () => {
  const file = 'a\nb\nTHE DEFECT HERE\nc\n';
  assert.deepEqual(resolveAnchor(file, 'THE DEFECT HERE'), { ok: true, line: 3 });

  // 200 lines inserted above: the same anchor, a different line, no manifest edit.
  const grown = 'x\n'.repeat(200) + file;
  assert.deepEqual(resolveAnchor(grown, 'THE DEFECT HERE'), { ok: true, line: 203 });
});

test('a missing anchor is a refusal, never a fallback to a remembered line', () => {
  const r = resolveAnchor('nothing relevant\n', 'THE DEFECT');
  assert.equal(r.ok, false);
  assert.match(r.why, /not in the seeded file/,
    'the seed no longer describes the tree and must be regenerated; guessing here would restore ' +
    'exactly the silent rot anchors were introduced to remove');
});

test('an ambiguous anchor is refused rather than resolved to the first match', () => {
  const r = resolveAnchor('dup\nother\ndup\n', 'dup');
  assert.equal(r.ok, false);
  assert.match(r.why, /matches 2 lines \(1, 3\)/);
  assert.match(r.why, /lengthen it/,
    'taking the first of several is the positional guess the contract parser was fixed for');
});

test('scoreSeed refuses to score without a resolved line', () => {
  const manifest = {
    id: 's', title: 't', source: 'mutation', removes_tests: false, scope: ['x'],
    defect: { file: 'a.mjs', anchor: 'x', lenses: ['code-audit'] },
  };
  assert.throws(() => scoreSeed({ manifest, findingsByNode: {} }), /needs a resolved defectLine/,
    'defaulting to some remembered number is how a benchmark scores against the wrong place');
});

test('CRLF and a trailing newline do not shift the resolved line', () => {
  assert.deepEqual(resolveAnchor('a\r\nb\r\nTARGET\r\n', 'TARGET'), { ok: true, line: 3 });
});

// A CHECKER THAT READS ONE SPELLING VERIFIES ONE SENTENCE, NOT A FACT. statedFacts matched only
// /[Tt]he (\d+) skills/, so QUORATE.md's "colliding with quorate's 21?" — three lines below "the 22
// skills need no other install step" — was invisible. Two counts in one file, three lines apart,
// disagreeing, and the checker that exists to catch exactly that could see only one of them
// (G-2/G-22).
test('every stated skill count is read, and disagreeing counts are a defect', () => {
  const both = statedFacts("the 22 skills need no install\ncolliding with quorate's 21?");
  assert.equal(both.skills, 21,
    'the LOWEST is reported so the drift check fails against the tree, rather than picking one ' +
    'phrasing and calling the document agreed with itself');

  assert.equal(statedFacts('the 22 skills').skills, 22);
  assert.equal(statedFacts("quorate's 22 skills").skills, 22);
  assert.equal('skills' in statedFacts('no counts at all here'), false);
});

// The regex was written through a heredoc that turned `\b` into a literal BACKSPACE byte, so the
// second alternative could never match anything and the fix looked applied while changing nothing.
// A control character in a pattern is invisible in every normal view of the file.
test('the counted-facts patterns contain no control characters', () => {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'lib', 'counted-facts.mjs'), 'utf8');
  // eslint-disable-next-line no-control-regex
  const ctrl = src.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g);
  assert.equal(ctrl, null,
    `counted-facts.mjs contains ${ctrl?.length} control character(s) — a pattern that silently ` +
    `matches nothing reads as a working check`);
});

// PARTIAL EVIDENCE LOSS WAS ACCEPTED AS A COMPLETE COLLECTION (G-17, panel-codex-code).
//
// The guard compared the recovered count against ZERO, so a run whose status files record 40 kept
// findings and whose evidence/ yields 3 folded cleanly — and the 37 that did not survive become
// SILENCE, which is precisely the ledger's signal for "a later run looked here and found nothing".
// Silence is what promotes `fixed_claimed` to `fixed`, so pruned evidence could confirm a fix that
// was never rechecked. Whatever prunes evidence does not do it one file at a time.
test('the ledger refuses a partial evidence collection, not only an empty one', () => {
  const dir = fs.mkdtempSync(path.join(SCRATCH, '.tmp-ledger-partial-'));
  try {
    const run = path.join(dir, '20260901-000000-p');
    const ev = path.join(run, 'evidence', 'code-audit');
    const nodes = path.join(run, 'nodes');
    fs.mkdirSync(ev, { recursive: true });
    fs.mkdirSync(nodes, { recursive: true });
    // The DURABLE record: this lens kept three findings.
    fs.writeFileSync(path.join(nodes, 'code-audit.status.json'), JSON.stringify({
      state: 'OK', findings_count: 3,
    }));
    // MOVED TO THE RECONCILE ARTIFACTS (ledger-identity, stage 5): the fold reads the barrier's groups, not the kept
    // verdicts, so partial loss is now a payload that judged fewer groups than were formed — a batched barrier that
    // failed part-way. The two it did not judge would otherwise read as silence, exactly as pruned verdicts did.
    const three = [
      { file: 'scripts/a.mjs', line: 10, severity: 'HIGH', claim: 'one' },
      { file: 'scripts/b.mjs', line: 20, severity: 'MEDIUM', claim: 'two' },
      { file: 'scripts/c.mjs', line: 30, severity: 'LOW', claim: 'three' },
    ];
    // A run record named for the directory: the fold admits only a run its run.json names (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28).
    fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: path.basename(run) }));
    writeReconciled(run, three, { judge: 1 });

    // SINCE reconcile-missing-groups.plan.md stage 2 (operator, 2026-10-23: "C") the partial collection folds, and the two
    // groups nobody judged are sightings marked unjudged: their entries are seen, not silent, so loss still cannot
    // confirm a fix. It refused the whole fold before, which left every judged group off the ledger too.
    const cli = path.join(REPO_ROOT, 'scripts', 'findings-ledger.mjs');
    const r = spawnSync(process.execPath, [cli, '--run-dir', run, '--ledger', path.join(dir, 'ledger.json')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const partial = Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8')).entries);
    assert.equal(partial.length, 3, 'every group is on the ledger, judged or not');
    assert.deepEqual(partial.filter((e) => e.unjudged).map((e) => e.claim).sort(), ['three', 'two'],
      'the groups nobody judged are sighted as unjudged, never read as silence');

    // The complete case folds with no unjudged entry.
    writeReconciled(run, three);
    const ok = spawnSync(process.execPath, [cli, '--run-dir', run, '--ledger', path.join(dir, 'ledger-complete.json')], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /3 new/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A CYCLE THAT FOUND NOTHING LEFT NOTHING TO INFER FROM (G-19, panel-codex-contract).
//
// `convergence` derived the newest run from entry timestamps, so a cycle producing ZERO findings —
// the outcome the whole convergence signal exists to detect — left no trace, and `newest_run` fell
// back to an earlier run whose HIGH findings were then counted as introduced by the latest cycle.
// The reading was worst exactly where it mattered: a clean cycle could report new work above the
// stopping floor and keep a self-review loop running.
//
// A fold is a fact about the LEDGER. It does not become one by producing findings.
test('a clean cycle is the newest run, and introduces nothing', async () => {
  const { mergeRun, convergence } = await import('../scripts/lib/ledger.mjs');
  const finding = { file: 'x.mjs', line: 1, severity: 'HIGH', claim: 'c' };

  let l = mergeRun(null, { run_id: '20260101-a', at: 't1', findings: [finding] }).ledger;
  assert.equal(convergence(l).newest_run, '20260101-a');
  assert.equal(convergence(l).new_above_floor_this_run, 1, 'the run that raised it introduced it');

  // The cycle that matters: newer, and found nothing.
  l = mergeRun(l, { run_id: '20260909-z', at: 't2', findings: [] }).ledger;
  const c = convergence(l);
  assert.equal(c.newest_run, '20260909-z', 'a fold is recorded whether or not it found anything');
  assert.equal(c.new_above_floor_this_run, 0,
    'the older run introduced that HIGH; counting it here is how a clean cycle reports new work');
  assert.equal(c.open_above_floor, 1, 'it is still open — just not new');

  // Idempotent, like the rest of mergeRun: re-folding must not grow the record.
  const again = mergeRun(l, { run_id: '20260909-z', at: 't3', findings: [] }).ledger;
  assert.deepEqual(again.runs_folded, ['20260101-a', '20260909-z']);

  // An explicit newest_run still wins — a caller that knows what it folded beats any inference.
  assert.equal(convergence(l, { newest_run: '20261231-q' }).newest_run, '20261231-q');

  // A ledger written before runs_folded existed still works: the entry scan remains the fallback.
  const legacy = { schema_version: 1, entries: l.entries };
  assert.equal(convergence(legacy).newest_run, '20260101-a');
});

// A REMEDIATOR COULD SKIP A GROUP AND STILL LOOK SUCCESSFUL (G-43, panel-codex-contract).
//
// I-8 asks for a disposition per confirmed group precisely so an OMISSION is distinguishable from a
// completed one. The skill asked for prose — "for each finding: the group id, what you changed" —
// and nothing compared the group ids a report mentions against the ones it was given, so a silently
// skipped group produced a normal-looking successful report.
//
// The machinery already existed: the ledger takes a disposition per key, and a group nobody
// dispositioned stays `open` while its siblings move. That is checkable, and it is also what a LATER
// run reads — `fixed_claimed` becomes `fixed` only when a run covering that file stays silent.
test('remediation records a ledger disposition, not only prose', async () => {
  const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'remediate', 'SKILL.md'), 'utf8');
  assert.match(skill, /findings-ledger\.mjs --disposition/,
    'a disposition nobody can diff against the input is not a disposition');
  assert.match(skill, /fixed_claimed`, `partial` or `declined`/,
    'the three answers must be named, or a remediator invents one');

  // The statuses the skill names must be ones the ledger actually accepts, or the instruction sends
  // a remediator at a command that fails.
  // isOpen, not OPEN_STATUSES: openness depends on decided_by too since ledger-transitions, so a status
  // list no longer describes the open set.
  const { isOpen, markFixed } = await import('../scripts/lib/ledger.mjs');
  assert.ok(isOpen({ status: 'fixed_claimed' }), 'a claim is still open work until confirmed');
  assert.ok(isOpen({ status: 'partial' }));

  // And the property that makes an omission visible: a group nobody marked stays open.
  const base = {
    schema_version: 1,
    entries: {
      'a.mjs:10': { key: 'a.mjs:10', file: 'a.mjs', line: 10, severity: 'HIGH', status: 'open', nodes: [] },
      'b.mjs:20': { key: 'b.mjs:20', file: 'b.mjs', line: 20, severity: 'HIGH', status: 'open', nodes: [] },
    },
  };
  const { ledger } = markFixed(base, ['a.mjs:10'], '20260101-x', { disposition: 'fixed_claimed' });
  assert.equal(ledger.entries['a.mjs:10'].status, 'fixed_claimed');
  assert.equal(ledger.entries['b.mjs:20'].status, 'open',
    'the group nobody dispositioned is the one still standing — which is how the omission shows');
});

// THE LEDGER TOOL COULD NOT SHOW A DECISION, A DECLARED FLOOR, OR ITS OWN COVERAGE (G-12/13/14).
//
// Three gaps in the one artifact an operator reads to decide whether to stop reviewing.
test('the ledger summary shows declines, a declared floor, and what it does not cover', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'findings-ledger.mjs'), 'utf8');

  // G-12: `declined` carries a mandatory reason so a decision is not conflated with a failed
  // attempt — and openEntries deliberately excludes it, so no invocation ever showed either.
  assert.match(src, /status === 'declined'/, 'a decision nobody can read is stored, not recorded');
  assert.match(src, /decisions, not omissions/);

  // G-13: I-10 names "the severity floor hardcoded rather than declared" as its failure mode.
  assert.match(src, /function declaredFloor\(\)/);
  assert.match(src, /convergence_floor/, 'the contract must be able to name the floor');
  assert.ok(!/convergence\(loadLedger\(\), \{ floor: 'HIGH' \}\)/.test(src),
    'a literal floor is the failure mode the criterion names');

  // G-14: nothing folds a run automatically, so DRAINED can describe a store that never heard of
  // most of the cycles — cross-run silence read as a verdict, which this store exists to refuse.
  // The listing moved to scripts/io/run-dirs.mjs (ledger-findings stage 5); --summary still lists what is present.
  assert.match(src, /runDirsPresent\(runRoots\(\), \{ skip: folded \}\)/);
  assert.match(src, /never been folded into this ledger/);
  assert.match(src, /absence from this store/);
});

test('the declared floor defaults to HIGH only when nothing is declared, and refuses what it cannot read', async () => {
  // The default keeps a project that says nothing unaffected. An unreadable contract USED to fall back to HIGH
  // too, silently — G-3 of 20260928-171758-ltr-review-r5 (operator: "G-3 fix"): a project that declared MEDIUM
  // could be told DRAINED with MEDIUMs open. Behaviour is pinned in regression-ledger-trust-boundaries-cli.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'findings-ledger.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function declaredFloor()'), src.indexOf("// The run directories present where this ledger's runs live"));
  assert.match(fn, /SEV\.includes\(declared\)/, 'a typo must not become a floor');
  assert.match(fn, /return 'HIGH';/);
  // THE CLASSIFICATION MOVED to contractOf, the one reader of --print-contract (dec1158a, G-1 of
  // 20261013-042240-ledger-identity-remediation-4-review; operator, 2026-10-13: "Point the test at contractOf
  // (Recommended)"). The floor takes HIGH only when contractOf returns null, and contractOf returns null only for
  // "no graph_contract found"; any other failure dies.
  assert.match(fn, /contractOf\(/, 'the floor reads the contract through the one reader');
  assert.match(fn, /if \(contract === null\) return 'HIGH';/, 'only an absent contract takes the default');
  const reader = src.slice(src.indexOf('function contractOf('), src.indexOf('function declaredFloor()'));
  // Since ledger-findings stage 4: "absent" is new-run's own exit code, read by the one io reader, not its message.
  assert.match(reader, /if \(read\.absent\) return null;/, 'only an absent contract reads as absent');
  assert.match(reader, /die\(`the contract of \$\{repoRoot\} cannot be read/, 'every other failure is refused');
  assert.doesNotMatch(fn, /catch \{ \/\* an unreadable contract/, 'an unreadable contract must not become HIGH silently');

  // And convergence still honours whatever floor it is handed.
  const { convergence } = await import('../scripts/lib/ledger.mjs');
  const l = {
    schema_version: 1,
    entries: { 'a:0': { key: 'a:0', severity: 'MEDIUM', status: 'open', first_seen: 'r1' } },
    runs_folded: ['r1'],
  };
  assert.equal(convergence(l, { floor: 'HIGH' }).drained, true, 'a MEDIUM does not hold a HIGH floor');
  assert.equal(convergence(l, { floor: 'MEDIUM' }).drained, false, 'it does hold a MEDIUM one');
});
