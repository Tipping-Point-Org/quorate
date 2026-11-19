// FOUR DEFECTS FELL THROUGH ONE GAP: NOTHING EVER DROVE A COMPONENT AGAINST A STAGED RUN.
//
// `graph_contract_version: 2` moved run directories OUT of the repository under review. That broke
// four separate reachability assumptions, and 871 green tests saw none of them. Every one was found
// by a real sweep, one per sweep, at roughly $25 each:
//
//   1. external-review confined --run-dir to git's WORKTREE ROOTS. A staged run is inside none, so
//      all six arms died at exit 2 before any vendor call — the cross-family half of the review
//      simply absent. (This was G-43 recurring for a new reason; the same six-arm shape.)
//   2. A lens had no Read GRANT for the run directory, so it could not reach intent.md.
//   3. Worse, and the one I first misdiagnosed as (2): every node is spawned with `cwd: repoRoot`,
//      and the runtime refuses a path outside its cwd WHATEVER the permission rules say. A node
//      could not read its own brief — Read, then `cat`, then Get-Content, all denied. The lenses
//      that did report came back FAIL with ZERO findings, having been handed no instructions.
//   4. external-review asks `git check-ignore` whether its output directory is tracked. Git cannot
//      answer for a path outside the repository, so it exits non-zero and that read as "tracked".
//
// THE SHAPE IS THE SAME FOUR TIMES, and it is why a unit test could not catch any of them: each was
// a guarantee implemented as "prove it RELATIVE TO THE REPOSITORY". Out of tree satisfies all four
// guarantees MORE strongly — a directory git cannot see cannot be committed at all — while failing
// the test written for each.
//
// This repository already states the rule these violated. A-15: "a probe must not differ from
// production in any dimension that can fail." And, of a probe that missed a live defect: it "covered
// the prompt, the argv, the transport and the envelope, and differed from production in the one
// dimension that was broken." The suite differed from production in exactly the dimension that
// changed — WHERE THE RUN DIRECTORY LIVES — so it could not fail.
//
// So this mints a genuinely staged run and drives the real components at it. No model is spawned,
// which is what makes it cheap enough to run every time: an uninstalled vendor still exercises every
// gate in external-review before reporting its absence, and capture is the whole evidence path.
// Split into 2 files by split-slow-test-files.md; the others are regression-staged-run-is-reachable-*.test.mjs, and the
// fixture they share is staged-run-is-reachable-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runScript, mintedRunDir, TEST_HOME } from './helpers.mjs';
import { isWithin } from '../scripts/lib/finding-scope.mjs';
import { SLUG, pathWithoutReviewerClis, childEnv, withStagedRun } from './staged-run-is-reachable-fixture.mjs';

test('a mint with no declared reviews_dir stages the run outside the repository', () => {
  withStagedRun((runDir) => {
    assert.ok(fs.existsSync(path.join(runDir, 'run.json')), 'the run must actually be there');
    assert.ok(!isWithin(REPO_ROOT, runDir));
  });
});

// DEFECT 2 — the Read grant. It admits the TOOL.
test('a staged run directory is granted to the nodes that must read it', () => {
  withStagedRun((runDir) => {
    const s = JSON.parse(fs.readFileSync(path.join(runDir, 'node-settings.json'), 'utf8'));
    const reads = (s.permissions?.allow ?? []).filter((r) => /^Read\(/.test(r));
    assert.ok(reads.some((r) => r.includes(runDir)),
      `no Read rule covers the staged run directory. A lens with intent: required is told by its own `
      + `brief to read intent.md and cite an I-n criterion from it. Rules: ${JSON.stringify(reads)}`);
    assert.ok(reads.some((r) => r.includes(REPO_ROOT)), 'and the repository grant must survive');
    // NOT the staging ROOT, which holds every other run of every other project on this machine.
    assert.ok(!reads.some((r) => r.endsWith(`${path.dirname(runDir)}/**)`)),
      'the grant must name the run, not the directory every run shares');
  });
});

// DEFECT 4 — capture is the whole evidence path, and it has its own containment check.
test('capture writes evidence into a staged run', () => {
  withStagedRun((runDir, home) => {
    const r = spawnSync('node',
      [path.join(REPO_ROOT, 'scripts', 'capture.mjs'), '--run-dir', runDir, '--node', 'probe',
        '--name', 'syn', '--', 'node', 'scripts/check-syntax.mjs'],
      { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, QUORATE_HOME: home, GRAPH_NODE_DEPTH: undefined } });
    assert.equal(r.status, 0, `capture refused a staged run:\n${r.stderr?.slice(-300)}`);
    assert.match(`${r.stdout}`, /evidence[\\/]probe[\\/]syn\.log/,
      'capture must print the canonical evidence path — a lens that cannot cite one has no findings');
    assert.ok(fs.existsSync(path.join(runDir, 'evidence', 'probe', 'syn.log')), 'and the bytes must land');
  });
});

// DEFECTS 1 AND 4 — the arm's two gates, exercised without a vendor call.
test('external-review reaches a staged run rather than refusing it', () => {
  withStagedRun((runDir, home) => {
    const prompt = path.join(runDir, 'probe-prompt.md');
    fs.writeFileSync(prompt, 'probe\n');
    const r = spawnSync('node',
      [path.join(REPO_ROOT, 'scripts', 'external-review.mjs'), '--reviewer', 'codex', '--mode', 'review',
        '--run-dir', runDir, '--node-id', 'panel-codex-arch', '--prompt-file', prompt,
        '--model', 'gpt-5.6-sol'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000, env: childEnv(home) });
    // external-review prints one envelope for a missing vendor — reported in not_checked[], never as a
    // crash. Since the reviewer preflight (reviewer-preflight stage 2) that missing vendor is refused
    // by the preflight with exit 5, still AFTER both path gates; exit 2 is a refusal BEFORE them, which
    // is exactly how six arms died twice: the containment gate and the check-ignore gate both live there.
    assert.ok(r.status === 0 || r.status === 5,
      `external-review refused a staged run (exit ${r.status}). Both gates it could refuse at are `
      + `about paths relative to the repository:\n${r.stderr?.slice(-400)}`);
    const env = JSON.parse(r.stdout);
    assert.equal(env.node_id, 'panel-codex-arch');
    assert.ok(Array.isArray(env.not_checked), 'the envelope must carry its gaps rather than throwing');
    // AND NO VENDOR WAS CALLED. Asserted, not hoped for: reaching the vendor is exactly what made
    // this test bill money and inherit third-party latency. An arm that never ran says so in
    // not_checked[], so the absence is visible in the artifact rather than only in the clock.
    assert.ok(env.not_checked.some((n) => /external reviewer 'codex'/.test(n.item ?? '')),
      `the reviewer must be reported UNAVAILABLE -- if it answered instead, this test made a real `
      + `billed call inside the declared test command. not_checked: ${JSON.stringify(env.not_checked)}`);
    assert.deepEqual(env.findings ?? [], [],
      'an arm that never reached a vendor cannot have findings');
  });
});
