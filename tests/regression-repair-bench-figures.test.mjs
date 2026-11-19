// THE REPAIR-PASS BENCH'S FIGURES (review 20261102-033648-rrp-remediation-review). Each figure is either read or n/a, and
// a case is reproduced only on the same failures: run.json's copy of a check's failing names keeps 20 (G-3), a missing
// check time was summed as 0 (G-4), a usage record missing its input or output tokens was totalled as complete (G-8),
// and an unbounded green_after sized the outcome list (G-9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../scripts/lib/repair-bench.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BENCH = fs.readFileSync(path.join(ROOT, 'scripts', 'bench-repair-pass.mjs'), 'utf8');

test('G-4: a check with no duration makes the full-check time unknown, not 0', () => {
  assert.doesNotMatch(BENCH, /duration_ms \?\? 0/, 'bench-repair-pass.mjs still sums a missing duration_ms as 0');
  assert.equal(typeof lib.checkMs, 'function', 'repair-bench.mjs exports no checkMs');
  assert.equal(lib.checkMs({ build: { duration_ms: 5 }, test: { duration_ms: 7 } }), 12);
  assert.equal(lib.checkMs({ build: { duration_ms: 5 }, test: {} }), null);
  assert.equal(lib.checkMs({ test: { duration_ms: null } }), null);
  const u = lib.repairBenchSummary([{ case: 'c', started_at: '1', status: 'measured', green_after: 1, wall_ms: 1,
    reproduce: { check_ms: null }, passes: [{ pass: 1, node_ms: 1, check_ms: 1000, cost_usd: 1 }] }]);
  assert.match(u.totals, /full-check time, reproduction included: n\/a/);
});

test('G-3: reproduction compares every failing name, never run.json\'s 20-name copy', () => {
  assert.doesNotMatch(BENCH, /results\?\.test\?\.failing_names \?\? \[\]\)\.slice\(\)\.sort\(\)/,
    'bench-repair-pass.mjs still compares run.json\'s truncated failing_names');
  assert.equal(typeof lib.failingOf, 'function', 'repair-bench.mjs exports no failingOf');
  const twenty = Array.from({ length: 20 }, (_, i) => `t${i}`);
  // The log, when read, is the whole list.
  const log = `✖ failing tests:\n\n${[...twenty, 't20'].map((n) => `✖ ${n} (1ms)`).join('\n')}\n`;
  assert.equal(lib.failingOf({ failing_names: twenty }, log).length, 21);
  // With no log, a 20-name copy may be truncated: unknown. A shorter one is whole.
  assert.equal(lib.failingOf({ failing_names: twenty }, null), null);
  assert.deepEqual(lib.failingOf({ failing_names: ['b', 'a'] }, null), [{ name: 'a', file: null }, { name: 'b', file: null }]);
  assert.equal(lib.sameFailures([...twenty, 'x'], [...twenty, 'y']), false);
  assert.equal(lib.sameFailures(null, null), false);
  assert.equal(lib.sameFailures([], []), false);
  assert.equal(lib.sameFailures(['a', 'b'], ['b', 'a']), true);
});

// G-9 of 20261102-060316-rrp-remediation-3-review: failingOf kept names only, so a test failing in two files compared
// equal to a replay failing in one of them, and `reproduced` admitted a case that was not the refusal.
test('G-9: a name failing in two files is not the same failure as it failing in one', () => {
  const log = (files) => `ℹ fail ${files.length}\n\n✖ failing tests:\n\n${files.map((f) => `test at ${f}:1:1\n✖ the ratchet holds (1ms)`).join('\n')}\n`;
  const two = lib.failingOf(null, log(['tests\\a.test.js', 'tests\\b.test.js']));
  const one = lib.failingOf(null, log(['tests\\a.test.js']));
  assert.deepEqual(two, [{ name: 'the ratchet holds', file: 'tests/a.test.js' }, { name: 'the ratchet holds', file: 'tests/b.test.js' }]);
  assert.equal(lib.sameFailures(two, one), false, 'two files compared equal to one');
  assert.equal(lib.sameFailures(one, lib.failingOf(null, log(['tests\\a.test.js']))), true);
  // run.json's copy names no file: the names are compared, as before.
  assert.equal(lib.sameFailures(lib.failingOf({ failing_names: ['the ratchet holds'] }, null), two), true);
});

// G-3 of 20261102-060316-rrp-remediation-3-review: a pass's recorded null change set (git state unknown) became [], and
// the diff totals understated the repair without saying so.
test('G-3: a pass whose change set is unknown makes the diff unknown, printed n/a', () => {
  assert.equal(typeof lib.changedFiles, 'function', 'repair-bench.mjs exports no changedFiles');
  assert.deepEqual(lib.changedFiles([{ changed: ['a', 'b'] }, { changed: ['b'] }]), ['a', 'b']);
  assert.equal(lib.changedFiles([{ changed: ['a'] }, { changed: null }]), null);
  assert.doesNotMatch(BENCH, /changed: p\.changed \?\? \[\]/, 'the bench still reads an unknown change set as none');
  const s = lib.repairBenchSummary([{ case: 'c', status: 'measured', started_at: 'x', cap: 1, green_after: 1, passes: [{ pass: 1, changed: null }], diff: null }]);
  assert.match(s.rows, /\| n\/a \|/);
});

// G-4 of 20261102-060316-rrp-remediation-3-review: a worktree the bench could not remove was logged and recorded, but the
// case kept its status and the bench its exit code.
test('G-4: a worktree left behind makes the case an error', () => {
  assert.equal(typeof lib.afterCleanup, 'function', 'repair-bench.mjs exports no afterCleanup');
  assert.deepEqual(lib.afterCleanup({ status: 'measured' }, { removed: true, worktree: 'w' }), {});
  const left = lib.afterCleanup({ status: 'measured', why: null }, { removed: false, worktree: 'w' });
  assert.equal(left.status, 'error');
  assert.equal(left.status_before_cleanup, 'measured');
  assert.equal(left.worktree_left, 'w');
  assert.match(BENCH, /process\.exitCode = 1/, 'the bench does not fail on a worktree left behind');
});

test('G-8: a usage record missing input or output tokens totals n/a', () => {
  const row = (usage) => lib.repairBenchSummary([{ case: 'c', started_at: '1', status: 'measured', green_after: 1, wall_ms: 1,
    passes: [{ pass: 1, node_ms: 1, check_ms: 1, cost_usd: 1, usage }] }]).rows;
  assert.match(row({ output_tokens: 5 }), /\| n\/a \| \$1\.00 \|/, 'a usage record with no input_tokens was totalled');
  assert.match(row({ input_tokens: 5 }), /\| n\/a \| \$1\.00 \|/, 'a usage record with no output_tokens was totalled');
  assert.match(row({ input_tokens: 5, output_tokens: 2 }), /\| 7 \| \$1\.00 \|/, 'absent cache fields are zeros');
});

// G-6: remediate.mjs --measure-only exits 0 whenever it reaches its end (endMeasureOnly), so any other exit is a run that
// did not finish, and a case was counted measured, a crash read as "never green", whenever one pass was recorded.
test('G-6: a case whose repair run did not reach its --measure-only end is not counted measured', () => {
  const at = BENCH.indexOf("status: 'measured'");
  assert.ok(at > 0, 'no measured result in bench-repair-pass.mjs');
  // Decided by repairRunOutcome since G-4 of 20261102-044855-rrp-remediation-2-review, which the test above holds.
  const before = BENCH.slice(BENCH.lastIndexOf('repairRunOutcome({ exit: second.status', at), at);
  assert.match(before, /outcome === 'error'/, 'the measured result is written without checking the repair run\'s exit');
});

// Review 20261102-044855-rrp-remediation-2-review. G-3: a reproduction was accepted on matching names whatever its run's
// exit, and whatever refusals the original check had beside the test one. G-4: a repair run that crashed before any pass
// was recorded no-pass, the zero-pass branch returning before the exit was read. G-7: the outcome list was a dense range
// up to the largest accepted green_after, sized by nothing when a result had no cap, and a green_after past its cap was
// in no bucket, so the buckets summed to less than the measured cases.
test('G-3 (rrp-remediation-2-review): a reproduction counts only from a run that reached its end, on the same refusals', () => {
  assert.equal(typeof lib.reproduced, 'function', 'repair-bench.mjs exports no reproduced');
  const check = { refusals: [{ key: 'test' }] };
  const ok = { exit: 0, check, failing: ['a'], recorded: ['a'], recordedRefusals: ['test'] };
  assert.equal(lib.reproduced(ok), true);
  assert.equal(lib.reproduced({ ...ok, exit: 1 }), false, 'a killed reproduction that wrote a matching check was accepted');
  assert.equal(lib.reproduced({ ...ok, exit: null }), false, 'a reproduction stopped by a signal was accepted');
  assert.equal(lib.reproduced({ ...ok, recordedRefusals: ['test', 'build'] }), false, 'a replay that lost an original refusal was accepted');
  assert.equal(lib.reproduced({ ...ok, check: { refusals: [{ key: 'test' }, { key: 'lint' }] } }), false);
  assert.equal(lib.reproduced({ ...ok, check: null }), false);
  assert.equal(lib.reproduced({ ...ok, failing: ['b'] }), false);
  assert.match(BENCH, /reproduced\(\{ exit: first\.status/, 'bench-repair-pass.mjs does not decide reproduction from the run\'s exit');
});

test('G-4 (rrp-remediation-2-review): a repair run that did not reach its end is an error, passes or none', () => {
  assert.equal(typeof lib.repairRunOutcome, 'function', 'repair-bench.mjs exports no repairRunOutcome');
  assert.equal(lib.repairRunOutcome({ exit: 1, passes: 0 }), 'error', 'a crashed repair run with no pass read as no-pass');
  assert.equal(lib.repairRunOutcome({ exit: null, passes: 0 }), 'error');
  assert.equal(lib.repairRunOutcome({ exit: 1, passes: 2 }), 'error');
  assert.equal(lib.repairRunOutcome({ exit: 0, passes: 0 }), 'no-pass');
  assert.equal(lib.repairRunOutcome({ exit: 0, passes: 2 }), 'measured');
  assert.match(BENCH, /repairRunOutcome\(\{ exit: second\.status/, 'bench-repair-pass.mjs does not decide the case from the repair run\'s exit');
});

test('G-7 (rrp-remediation-2-review): the outcome list is sized by the cases, and its buckets add up to the measured cases', () => {
  const m = (g, cap) => ({ case: `c${g}`, started_at: String(g), status: 'measured', cap, green_after: g, wall_ms: 1, passes: [] });
  // No cap recorded: a large green_after allocated a list that long, and threw past 2**32.
  const big = lib.repairBenchSummary([m(4294967296), m(1, 3)]);
  assert.ok(big.outcomes.split('\n').length < 10, 'a green_after with no cap sized the outcome list');
  const sumOf = (s, n) => [...s.outcomes.matchAll(new RegExp(`: (\\d+) of ${n}$`, 'gm'))].reduce((k, x) => k + Number(x[1]), 0);
  assert.equal(sumOf(big, 2), 2, `the buckets do not add up to the measured cases:\n${big.outcomes}`);
  // Past its own cap: no pass the bench ran, and still counted.
  const past = lib.repairBenchSummary([m(4, 3), m(2, 3), { ...m('never', 3), case: 'n' }]);
  assert.equal(sumOf(past, 3), 3, `a green_after past its cap is in no bucket:\n${past.outcomes}`);
  // A pass past 3, within its cap, keeps its own bucket.
  assert.match(lib.repairBenchSummary([m(5, 6)]).outcomes, /green after pass 5: 1 of 1/);
});

test('G-9: a green_after beyond its case\'s cap does not size the outcome list', () => {
  const u = lib.repairBenchSummary([{ case: 'c', started_at: '1', status: 'measured', cap: 3, green_after: 4294967296, wall_ms: 1, passes: [] }]);
  assert.equal(u.outcomes.split('\n').filter((l) => l.startsWith('- green after pass')).length, 3);
});

// G-9 of 20261102-161123-rbr-delivery: the reader's 20 and remediate.mjs's cut of run.json's failing names were two
// literals that could drift apart. One owner, lib/full-check.mjs, and both sides read it.
test('G-9: run.json\'s cut of failing names and the bench\'s reading of it come from one constant', async () => {
  const fc = await import('../scripts/lib/full-check.mjs');
  assert.equal(typeof fc.RUN_JSON_FAILING_NAMES, 'number', 'lib/full-check.mjs does not own the cut');
  assert.equal(lib.RUN_JSON_FAILING_NAMES, fc.RUN_JSON_FAILING_NAMES);
  const rem = fs.readFileSync(path.join(ROOT, 'scripts', 'remediate.mjs'), 'utf8');
  assert.doesNotMatch(rem, /failing_names\.slice\(0,\s*\d+\)/, 'remediate.mjs cuts failing_names with a literal');
  assert.match(rem, /failing_names\.slice\(0,\s*RUN_JSON_FAILING_NAMES\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'repair-bench.mjs'), 'utf8'), /RUN_JSON_FAILING_NAMES\s*=\s*\d/,
    'repair-bench.mjs defines its own copy');
});
