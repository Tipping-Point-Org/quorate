// INTENT-DRIFT was unreachable on precisely the path that can emit PASS.
//
// §5 and §7 say criteria that move mid-flight mean the run measured nothing, and the gate has a
// branch for it: `else if (stamps.includes('INTENT-DRIFT')) gate = 'BLOCKED'`. But the rehash that
// SETS that stamp sat inside `if (groupsOut.length && skillInstalled('reconcile'))` and then inside
// `if (fs.existsSync(payload))` — so it ran only when at least one lens produced a finding AND the
// reconciler wrote a payload.
//
// A run where every lens reports clean produces no groups, skips the whole block, and never checks.
// That is the run that emits PASS. So the check was present on every path where it could only
// downgrade a verdict that was already bad, and absent on the one path where it mattered.
//
// Tested as a DEMONSTRATION, not as a unit test of the hash comparison: the defect was never in the
// comparison, it was in where it was called from. Only driving the gate proves it now runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runScript, mintedRunId, mintedRunDir, REPO_ROOT } from './helpers.mjs';

function gateAfterTamperingWithIntent({ tamper }) {
  const slug = `driftprobe${Math.floor(Math.random() * 1e6)}`;
  // --no-request: this test is about intent drift, and a run with no request would fire request-capture recovery through
  // the real runtime wherever the contract's request is absent (a release snapshot has no .claude/requests/).
  const mint = runScript('new-run.mjs', ['--slug', slug, '--no-verify-sandbox', '--no-verify-reviewers', '--no-request', '--full-sweep', 'bench']);
  assert.equal(mint.status, 0, `mint failed:\n${mint.output.slice(-400)}`);
  // From the mint's OWN output, never the shared latest.txt: that pointer is rewritten by every
  // run in the repository, so a concurrent test's mint would hand this one the wrong run directory.
  const runId = mintedRunId(mint.output, slug);
  // FROM THE MINT'S OWN OUTPUT, not rebuilt from a layout. This joined `<repo>/.claude/reviews/`
  // and so pinned WHERE runs live into a test about intent drift — which broke it when runs moved
  // out of the reviewed tree, for a reason it has nothing to do with.
  const runDir = mintedRunDir(mint.output);
  try {
    // Freeze an intent, then move it — the mid-flight edit §5 says voids a run.
    const intentPath = path.join(runDir, 'intent.md');
    fs.writeFileSync(intentPath, '# Intent\n\nI-1 the original criterion\n');
    const runJson = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    runJson.intent_sha256 = 'f'.repeat(64); // a sha the file cannot possibly hash to
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(runJson, null, 2));
    if (tamper) tamper(runDir);

    // WHAT THIS TEST LEFT ON DISK, recorded BEFORE run-graph starts. The probe below could say the
    // two hashes differed and not say which side moved — and "which side moved" is the whole
    // question, because one answer is a defect in the drift check and the other is a second process
    // writing into this run directory.
    const wrote = {
      pid: process.pid,
      run_id: runId,
      at_ms: Date.now(),
      intent_sha256: fs.existsSync(intentPath)
        ? crypto.createHash('sha256').update(fs.readFileSync(intentPath)).digest('hex') : null,
      intent_mtime_ms: fs.existsSync(intentPath) ? fs.statSync(intentPath).mtimeMs : null,
      run_json_sha256: crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(runDir, 'run.json'))).digest('hex'),
      run_json_mtime_ms: fs.statSync(path.join(runDir, 'run.json')).mtimeMs,
      reviews_siblings: fs.readdirSync(path.dirname(runDir)).length,
    };

    // --only ui-audit selects a lens whose condition is unmet here (ui.surface: none), so NOTHING
    // spawns and NO groups are produced. That is exactly the clean-run path the check was missing
    // from, and it makes this test free.
    // --no-archive: this test reads runDir AFTER the graph finishes, and a staged run is moved into
    // the tree when it ends. Without the flag the directory under test is gone by the time the
    // assertions run -- and every probe would litter .claude/reviews with an archived fixture.
    const graph = runScript('run-graph.mjs',
      // --preflight never (test-suite-cost.md): the pre-flight is not what this test measures, and in this repository it ran
      // the whole suite nested inside the suite (node refuses the recursion and records it as FAIL), minutes per call.
      ['--run-dir', runDir, '--skip-panel', '--only', 'ui-audit', '--no-archive', '--preflight', 'never']);
    const gate = JSON.parse(fs.readFileSync(path.join(runDir, 'gate.json'), 'utf8'));

    // THE INPUTS TO THE DRIFT DECISION, CAPTURED BEFORE THE `finally` DELETES THEM.
    //
    // The intact-intent case fails intermittently — roughly one full-suite run in four, never in
    // isolation, and not reproducible by running this file against a concurrent copy of itself. So
    // the cause is something else in the suite, and a bare "stamps were [...]" cannot distinguish
    // the possibilities: run.json rewritten under the test, intent.md rewritten, the field dropped,
    // or the comparison itself wrong. Every one of those is visible in these four values, and the
    // run directory is gone a line later.
    //
    // Not a fix, and deliberately not dressed as one. It is what the canary and the tie-break both
    // needed: the evidence that exists only at the moment of failure.
    gate._probe = (() => {
      try {
        const rj = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
        const exists = fs.existsSync(intentPath);
        return {
          wrote,
          run_json_intent_sha256: rj.intent_sha256 ?? null,
          run_json_stamps: rj.stamps ?? null,
          intent_md_exists: exists,
          intent_md_sha256: exists
            ? crypto.createHash('sha256').update(fs.readFileSync(intentPath)).digest('hex') : null,
          intent_md_bytes: exists ? fs.statSync(intentPath).size : null,
          // WHICH SIDE MOVED, and when relative to this test's own writes. A file whose mtime is
          // later than `wrote.at_ms` was rewritten after this test finished setting up — by
          // run-graph's intent phase (which should not have run at all here) or by something else on
          // the machine. An mtime that has NOT moved, with a hash that has, means the comparison
          // itself is reading something other than these two values.
          intent_md_mtime_ms: exists ? fs.statSync(intentPath).mtimeMs : null,
          run_json_mtime_ms: fs.statSync(path.join(runDir, 'run.json')).mtimeMs,
          intent_rewritten_after_setup: exists && fs.statSync(intentPath).mtimeMs > wrote.at_ms,
          run_json_rewritten_after_setup: fs.statSync(path.join(runDir, 'run.json')).mtimeMs > wrote.at_ms,
          // Did the intent PHASE run? It must not: --only ui-audit leaves no node requiring intent,
          // so `needsIntent` is false and both the pinned-reuse branch (which rewrites intent.md and
          // rehashes it) and intent-capture are skipped. If either line appears, that assumption is
          // wrong and it is the answer.
          intent_phase_lines: (graph.stdout ?? '').split('\n')
            .filter((l) => /intent-capture|PINNED|INTENT/i.test(l)).slice(0, 6),
          graph_stderr_tail: (graph.stderr ?? '').trim().slice(-400) || null,
        };
      } catch (e) { return { unreadable: e.message }; }
    })();
    return gate;
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

test('regression: intent that moved is caught on a run with NO findings', () => {
  const gate = gateAfterTamperingWithIntent({});
  assert.ok(gate.stamps.includes('INTENT-DRIFT'),
    `criteria moved and no lens found anything; stamps were ${JSON.stringify(gate.stamps)}`);
  assert.equal(gate.gate, 'BLOCKED',
    'a run whose criteria moved measured nothing about the code and cannot report a verdict on it');
});

test('an intact intent on the same path does NOT stamp drift', () => {
  // The other half: a check that fires when nothing moved is as useless as one that never fires.
  const gate = gateAfterTamperingWithIntent({
    tamper: (runDir) => {
      const p = path.join(runDir, 'intent.md');
      const sha = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      const rj = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
      rj.intent_sha256 = sha;
      fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(rj, null, 2));
    },
  });
  assert.equal(gate.stamps.includes('INTENT-DRIFT'), false,
    `intent was intact; stamps were ${JSON.stringify(gate.stamps)}\n`
    + `  drift inputs at the moment of the verdict: ${JSON.stringify(gate._probe, null, 2)}\n`
    + '  (the two sha values above are the whole comparison — if they match, the stamp is wrong;\n'
    + '   if they differ, something rewrote one of the two files under this test)');
});

// ---------------------------------------------------------------------------------------------
// THE HELPER THAT MADE THIS SUITE FLAKY.
//
// These two tests mint real runs in the repository, and originally took the run id from
// `.claude/reviews/latest.txt`. That pointer is global and is rewritten by EVERY mint, so two tests
// minting concurrently — the default, since the runner executes files in parallel — race: the
// second overwrites the pointer, the first reads the other's id, then operates on and deletes a run
// directory belonging to a different test. It surfaced once as `ENOENT ... gate.json`, passed on
// re-run, and passed in isolation.
//
// A flaky suite is worse than a failing one: it teaches the reader that red means "run it again",
// which is exactly the habit that lets a real regression through.
test('the run id comes from the mint, so concurrent runs cannot cross wires', () => {
  const src = fs.readFileSync(
    path.join(import.meta.dirname, 'regression-intent-drift-reach.test.mjs'), 'utf8');
  assert.ok(!/latest\.txt'\), 'utf8'\)/.test(src),
    'reading the shared latest.txt reintroduces the race this helper removed');

  // And the helper itself must refuse ambiguity rather than pick one.
  assert.throws(
    () => mintedRunId('20260101-000000-dup\n20260102-000000-dup\n', 'dup'),
    /found 2/,
    'two ids for one slug is a broken assumption, not a choice to make silently',
  );
  assert.throws(() => mintedRunId('no id here', 'dup'), /found 0/);
  assert.equal(mintedRunId('20260101-000000-abc\nrun dir: x\n', 'abc'), '20260101-000000-abc');
});

// WHAT A RESUME MUST NOT RE-SPEND, AND WHAT IT MUST NOT RE-DECIDE.
//
// Found by resuming the consumer-mount run to reproduce an adjudication crash. `expected.json` holds
// the lenses and the arms, and `alreadyOk` is built from it — so the resume kept 15 nodes and then
// re-ran the three most expensive nodes that are NOT in that file: intent-capture, reconcile (21.1
// minutes of opus, measured) and second-opinion (12.5). run-graph's own source records this defect
// being fixed for the panel arms — "a resume re-ran all six arms and re-billed them" — and the
// barrier kept it.
//
// The intent half is worse than the cost. Re-deriving produced 27 criteria where the first attempt
// had 15, and rewrote run.json.intent_sha256 to match: the resumed half of the run judged against a
// bar the first half never saw, with nothing in the artifacts marking the change. That is precisely
// what the pinning exists to prevent.
test('regression: a resume reuses the intent it is resuming, gated on the hash', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(src, /const resumeIntent = Boolean\(args\.resume\) && haveIntent && intentIsIntact\(\);/,
    'a resume must reuse the frozen criteria without --skip-intent being passed by hand');
  assert.match(src, /if \(\(args\.skipIntent \|\| resumeIntent\) && haveIntent\)/);
  // GATED ON THE HASH, not on the file existing: an intent.md edited between attempts must fall
  // through to re-derivation rather than being silently adopted as this run's bar.
  assert.ok(src.indexOf('function intentIsIntact') < src.indexOf('const resumeIntent'),
    'the hash check must be the same one the gate uses');
});

test('regression: a resume that re-ran nothing does not re-judge the same groups', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  // THE RULE MOVED to lib/reconcile-batches.mjs (reconcileReusable; reconcile-batches.plan.md stage 2). run-graph
  // gathers its inputs, and both halves are pinned: the inputs here, the rule's demands below.
  assert.match(src, /const reconcileReusable = reconcileReusableRule\(\{\s*resume: args\.resume,/);
  // NARROW ON PURPOSE. A resumed lens or arm changes the finding set, and a reconciliation of the old
  // set would be judgment about a different run — so anything re-running forces a re-reconcile.
  assert.match(src, /nothingReRun: toRun\.length === 0 && panelArms\.length === 0/,
    'reuse is only sound when nothing re-ran');
  assert.match(src, /statusState: [^\n]*readStatus\('reconcile'\)\.state/, 'and the previous barrier reported');
  // Asked of the run's owner since run-dir-reads.plan.md stage 4 (runHas): a link at either is refused, not "present".
  assert.match(src, /artifactsPresent: reconcileArtifacts\.every\(\(p\) => runHas\(p\)\)/,
    'both the payload and reconciled.md must be on disk, since everything downstream reads them');
  const lib = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'lib', 'reconcile-batches.mjs'), 'utf8');
  assert.match(lib, /Boolean\(resume\) && nothingReRun === true && statusState === 'OK' && artifactsPresent === true/,
    'the rule demands every input, not any');

  // THE TRAP THIS FIX WALKED INTO. `reconcileState` defaults to 'SKIPPED' and is assigned from the
  // status file after the spawn, so skipping the spawn without restoring it makes reconcileSilent
  // report a barrier that never reported — turning a sound reuse into BLOCKED.
  const reuse = src.slice(src.indexOf('reconcile REUSED'), src.indexOf('} else if (groupsOut.length && skillInstalled'));
  assert.match(reuse, /reconcileState = readStatus\('reconcile'\)\.state;/,
    'the reuse branch must set the state the spawn would have set, or the gate blocks on it');
});

test('regression: a reused reconciliation carries its audit with it', () => {
  // second-opinion audits reconciled.md. If a resume re-ran no lens and no arm, that file was reused
  // unchanged, so the audit of it still holds — and re-running costs 12.5 minutes of judgment-model
  // time (measured on the consumer-mount run) to re-read a file that did not move.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(src, /const secondOpinionReusable = reconcileReusable/,
    'the condition must BE reconcileReusable, not a second copy of its clauses: two spellings of '
    + '"nothing re-ran" would eventually disagree, and the audit would then be of a reconciliation '
    + 'it never read');
  assert.match(src, /readStatus\('second-opinion'\)\.state === 'OK'/,
    'and the previous audit must have actually reported');

  // NOTHING TO RESTORE, unlike the reconcile skip. The gate reads second-opinion's state from the
  // status file (`soState`), which the reuse leaves in place — whereas `reconcileState` is an
  // in-memory variable that defaults to SKIPPED, which is the trap the sibling fix had to handle.
  // Through the run's owner since run-dir-reads.plan.md stage 3 (statusPresent), still the status file.
  assert.match(src, /const soState = statusPresent\('second-opinion'\)/,
    'if this ever stops reading the artifact, the reuse branch must set the state like reconcile does');

  // The SKIPPED stub branch must survive the new leading condition: a node that is promised and
  // produces no artifact at all is the silence this engine refuses.
  assert.match(src, /\} else if \(skillInstalled\('second-opinion'\)\) \{\s*\n\s*writeStatusStub\('second-opinion', 'SKIPPED'/);
});
