// A recall figure with no configuration attached is an anecdote, not a measurement.
//
// Criterion 12 of the approved request requires that the benchmark's "results identify their own
// configuration". They did not: every result file on disk records tolerance, scores and cost, and
// NO MODEL AT ALL. A "recall 1.0 at opus/xhigh" number was then quoted as evidence for a runtime
// decision, which it could not support — nothing in the artifact said which model produced it.
//
// The alias is not sufficient either, and that is the sharper half. `opus` and `sonnet` are
// FLOATING POINTERS: the provider replaces the model behind them, so a result measured against last
// month's alias says nothing certain about this month's, in either direction — the replacement may
// be better at one lens and worse at another. Comparability therefore needs the alias AND the CLI
// that resolved it AND the date.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, makeRunDir } from './helpers.mjs';
import { collectRun } from '../scripts/io/run-artifacts.mjs';

const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-lenses.mjs'), 'utf8');

test('regression: a bench result records WHICH MODEL produced it', () => {
  assert.match(src, /declared_models:/, 'the declared judgment/mechanical models must be recorded');
  assert.match(src, /declared_effort:/, 'reasoning effort changes the result and must be recorded');
});

test('regression: it records what RESOLVED the alias, because aliases float', () => {
  // NAMED BY THE RUNTIME, not by a vendor (G-4). This asserted `claude_version:` — a field naming
  // one provider in the file whose entire purpose is making two measurements comparable, while the
  // node runtime is selectable. A bench configured for another runtime attributed alias resolution
  // to a provider it never used. Same rename run.json.host already took.
  assert.match(src, /runtime_version:/, 'a model alias means whatever THIS runtime resolved it to');
  assert.match(src, /runtime: BENCH_RUNTIME_NAME/, 'and which runtime that was');
  // On the FIELD, not the prose: the comment beside it explains what it replaced.
  assert.ok(!/^\s*claude_version:/m.test(src),
    'a field naming one vendor cannot record a run that used another');
  assert.match(src, /measured_at:/, 'and on what date');
  assert.match(src, /alias_caveat:/, 'the artifact must say plainly that aliases are not stable');
});

test('it records the framework and corpus it measured', () => {
  assert.match(src, /framework: frameworkStamp\(/, 'which engine produced the number');
  assert.match(src, /corpus_commit:/, 'and which seeds it ran against');
});

test('the contract is read through the single parser, not re-parsed here', () => {
  // A second CLAUDE.md parser is how two components come to disagree about the same file.
  assert.match(src, /--print-contract/);
  assert.doesNotMatch(src, /graph_contract:\s*1/, 'bench must not contain its own contract parser');
});

test('per-node OBSERVED model still travels beside the declared one', () => {
  // Declared is what was asked for; observed is what ran. When they disagree, observed wins, so
  // both must survive into the artifact.
  //
  // ASSERTED BY CALLING THE READER, not by grepping for the line that fills it. This was
  // `assert.match(src, /configByNode\[s\.node_id\] = \{ model: s\.model/)`, and it went red the
  // day `collectRun` moved into lib/run-artifacts.mjs to be shared with the second benchmark —
  // a behaviour that had not changed at all. That is the failure mode this repository already
  // names for grep-shaped tests ("a private helper can only be tested by GREPPING for its name —
  // which still passes when the helper itself becomes blocking"): it fails on a move and passes
  // on a regression. Extracting the function is what made the real check possible, so the check
  // moved with it.
  const { runDir } = makeRunDir(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-attr-')), {
    nodes: {
      // findings_count: a real review node's OK status always carries it, and the strict reader (ledger-trust-
      // boundaries 2a, G-17 of its review) refuses one that does not — this fixture's statuses predated that.
      'code-audit': { state: 'OK', findings_count: 0, model: 'opus', effort: 'medium', total_cost_usd: 1.5, num_turns: 23, duration_ms: 126000 },
      // A node the run spawned with no effort recorded: the field must arrive as null rather than
      // absent, or "unrecorded" and "ran at the default" become the same artifact.
      'panel-codex-code': { state: 'OK', findings_count: 0, model: 'gpt-5.6-sol' },
    },
  });
  try {
    const { configByNode, costsByNode, turnsByNode, durationsByNode } = collectRun(runDir);
    assert.deepEqual(configByNode['code-audit'], { model: 'opus', effort: 'medium' });
    assert.deepEqual(configByNode['panel-codex-code'], { model: 'gpt-5.6-sol', effort: null });
    assert.equal(costsByNode['code-audit'], 1.5);
    assert.equal(turnsByNode['code-audit'], 23);
    assert.equal(durationsByNode['code-audit'], 126000);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
  // The WRITE half stays in bench-lenses.mjs, so it is still checked against that source: reading
  // the configuration and recording it in the result file are two separate ways to lose it.
  assert.match(src, /nodes: configByNode/);
});

// ---------------------------------------------------------------------------------------------
// The bench reviews seeds CONCURRENTLY, and two things about that loop are easy to break silently.
//
// 1. A concurrent loop over a BLOCKING spawn is not concurrent. bench-lenses used spawnSync for
//    every call; the seed pool would have held its slots while executing strictly one at a time,
//    reporting "3 at a time" with unchanged wall clock and no error to show for it. This is the
//    exact pairing that made the panel arms serial for 30 minutes (lib/pool.mjs's own header), so
//    it is asserted rather than trusted: the two calls that take MINUTES must not be spawnSync.
//
// 2. `git worktree add`/`remove` mutate .git/worktrees under a repository lock, so they are the
//    one part of a seed that may not overlap another's. They must stay behind withGitLock.
test('bench: the long spawns are non-blocking and the git worktree ops stay serialised', async () => {
  // MEASURED, NOT GREPPED. This searched bench-lenses.mjs for `await shAsync(` and `withGitLock(`,
  // so it still passed if either helper became blocking or stopped serialising — it could not fail
  // for the behaviour it claimed to protect (G-59). The helpers moved to lib/pool.mjs so this can
  // exercise them.
  const { shAsync, makeLock, runPool } = await import('../scripts/io/pool.mjs');

  // NON-BLOCKING: a timer set before the spawn must fire WHILE the child is still running. A
  // spawnSync here pins the event loop, the seed pool holds its slots while executing one at a
  // time, and the bench reports a concurrency it never had.
  let tickedDuringSpawn = false;
  const timer = setTimeout(() => { tickedDuringSpawn = true; }, 40);
  await shAsync(process.execPath, ['-e', 'const t=Date.now()+400; while(Date.now()<t);']);
  clearTimeout(timer);
  assert.equal(tickedDuringSpawn, true,
    'the event loop must keep turning during a spawn, or "concurrency" is a label with no behaviour');

  // SERIALISED: two holders of one lock must not overlap, however long the first takes.
  const withLock = makeLock();
  const order = [];
  await Promise.all([
    withLock(async () => { order.push('a-in'); await new Promise((r) => setTimeout(r, 60)); order.push('a-out'); }),
    withLock(async () => { order.push('b-in'); order.push('b-out'); }),
  ]);
  assert.deepEqual(order, ['a-in', 'a-out', 'b-in', 'b-out'],
    'git worktree add|remove mutate .git/worktrees under a repository lock and may not interleave');

  // A REJECTING holder must not wedge the lock, or one failed seed stops every later one.
  const after = [];
  await Promise.allSettled([
    withLock(async () => { throw new Error('boom'); }),
    withLock(async () => { after.push('ran'); }),
  ]);
  assert.deepEqual(after, ['ran'], 'a rejection must release the lock, not hold it forever');

  // And the pool still bounds width — the property the two helpers exist to serve.
  let live = 0; let peak = 0;
  await runPool([1, 2, 3, 4, 5], async () => {
    live += 1; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 20));
    live -= 1;
  }, 2);
  assert.equal(peak, 2, 'runPool must hold the declared width');
});

// ---------------------------------------------------------------------------------------------
// TOKENS, not just dollars. The CLI envelope has always carried a full `usage` block; spawn-node
// harvested only total_cost_usd, so no artifact could answer "how much of the token window did
// this run cost?" — while the answer sat in evidence/<node>/stdout.json and was then deleted with
// the seed's worktree. Dollars are derived; tokens are what is actually rationed.
test('spawn-node harvests usage on BOTH paths, and the early figure is never nulled', () => {
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'spawn-node.mjs'), 'utf8');

  assert.match(src, /^\s*usage: null,$/m, 'the status skeleton must declare a usage field');
  assert.match(src, /^\s*model_usage: null,$/m, 'the status skeleton must declare model_usage');

  // Twice: once on the early path (a node that spends money and THEN fails still records it) and
  // once when the envelope parses. One call is the bug this test exists to prevent.
  const calls = (src.match(/harvestUsage\(\w+, status\)/g) ?? [])
    .filter((c) => !c.startsWith('harvestUsage(src'));   // drop the declaration itself
  assert.equal(calls.length, 2,
    'harvestUsage must run on the early path AND the envelope path — the early figure is the one ' +
    'that survives a node which spent real money and then failed');

  // It must GUARD rather than assign: `status.usage = src.usage ?? null` on the second pass would
  // erase a good early value whenever the final envelope is partial.
  const body = src.slice(src.indexOf('function harvestUsage'));
  assert.ok(!/status\.usage = src\.usage \?\? null/.test(body.slice(0, 600)),
    'harvestUsage must not overwrite a harvested value with null');
});

// A seed that spends money and then fails contributed $0 to the bench total: the cost push sat
// after the silent-lens throw. Same defect spawn-node had already fixed one layer down.
test('bench: a seed that produced no score still has its spend recorded, and separately', () => {
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'bench-lenses.mjs'), 'utf8');

  assert.match(src, /if \(!spendRecorded && runDir/,
    'the finally block must record spend for a seed that never reached the scoring push');
  assert.match(src, /unscoredSpend\.push\(/, 'unscored spend must be collected');
  assert.match(src, /unscored_cost_usd:/,
    'the result file must break out unscored spend — a total that silently omits failed seeds ' +
    'under-reports, and always in the same direction');
  assert.match(src, /total_usage: usageTotal/, 'the result file must total tokens, not just dollars');

  // Every run directory is preserved now, not only the failures: on success it is the only copy of
  // the envelopes carrying the token accounting.
  const finallyBlock = src.slice(src.indexOf('  } finally {'));
  assert.ok(!/if \(preserve && runDir/.test(finallyBlock),
    'preservation must no longer be conditional on failure — the envelopes are the token record');
  assert.match(finallyBlock, /if \(runDir && fs\.existsSync\(runDir\)\)/,
    'every run directory is copied out before the worktree is removed');
});

// A FAILED ARCHIVE MUST NOT BE FOLLOWED BY A DELETE.
//
// The finally block copies each run out of its worktree before the worktree is removed. The catch
// around that copy only LOGGED, and the removal ran unconditionally — so on the one path where
// preservation matters, preservation failing, the run directory it had just failed to save was
// destroyed anyway. Found by panel-codex-code on the 2026-09-06 sweep, in the block added that same
// morning to stop exactly this: the cleanup was unconditional while its justification was not.
test('bench: a run whose archive failed keeps its worktree instead of being deleted', () => {
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'bench-lenses.mjs'), 'utf8');

  // The removal must be guarded by whether the copy succeeded. Anchored on the BLOCK rather than on
  // one spelling of the call: the previous regex required `if (archived) {` to be followed
  // immediately by `await withGitLock(...)`, and went red the moment that call's result was captured
  // so a failed removal could be reported (G-4) — a test failing for a change that preserved the
  // property it guards.
  const guard = src.indexOf('if (archived) {');
  assert.notEqual(guard, -1, 'the archive guard must still exist');
  const block = src.slice(guard, src.indexOf('\n  }', guard));
  assert.match(block, /'worktree', 'remove'/,
    'the worktree removal must be conditional on the archive having succeeded — a leaked worktree ' +
    'is visible in `git worktree list` and recoverable; a deleted run directory is neither');
  assert.equal(src.split("'worktree', 'remove'").length - 1, 1,
    'exactly one removal call, or the guard covers only one of them');

  // And the failure path must set that flag, not merely print.
  const cat = src.slice(src.indexOf('COULD NOT PRESERVE THE RUN'));
  assert.ok(src.includes('archived = false'),
    'the catch must record the failure, not only log it — logging then deleting is what the ' +
    'original defect did');
  assert.match(cat, /git worktree remove --force/,
    'the operator is told how to clean up the worktree deliberately kept behind');
});

// G-3 of run 20260924-145430-post-med2 — three codex arms, and the reconciler flagged their premise
// as "plausible rather than fully verified" because it could not locate splitSpend from the file
// under review. Verified here: run-artifacts.mjs:122 read
//
//     total_usd: Number(((own ?? 0) + (extraUsd ?? 0)).toFixed(4))
//
// `own` and `extraUsd` are each kept as `null` when the vendor reported nothing — the function
// already follows the rule — and then the last line coerces both to 0 and always emits a number.
//
// THAT DEFEATED THE G-7 FIX ONE LAYER DOWN. `sumSpend` was taught to report absence instead of
// imputing zero, and it reads `total_usd`, which by then is a zero-filled number. An unpriced pass
// still reported $0.00 — the same wrong answer, arrived at through the fix that was supposed to
// prevent it.
test('total_usd is null when nothing was priced, not a zero-filled sum', async () => {
  const { splitSpend } = await import('../scripts/io/run-artifacts.mjs');
  const spent = (args) => splitSpend({ nodeId: 'second-opinion', ...args }).spent;

  // NOTHING MEASURED. "$0.00" and "the vendor returned nothing" are different claims.
  assert.equal(spent({ costsByNode: {}, extraUsd: null }).total_usd, null);

  // A REAL ZERO IS A MEASUREMENT and must survive, exactly as it does in measuredUsd.
  assert.equal(spent({ costsByNode: { 'second-opinion': 0 }, extraUsd: null }).total_usd, 0);

  // PARTIAL: one side priced, the other absent — the total is what was actually reported.
  assert.equal(spent({ costsByNode: { 'second-opinion': 1.25 }, extraUsd: null }).total_usd, 1.25);
  assert.equal(spent({ costsByNode: {}, extraUsd: 0.5 }).total_usd, 0.5);
  assert.equal(spent({ costsByNode: { 'second-opinion': 1.25 }, extraUsd: 0.5 }).total_usd, 1.75);

  // And the components keep reporting absence as they already did.
  assert.equal(spent({ costsByNode: {}, extraUsd: null }).second_opinion_usd, null);
});
