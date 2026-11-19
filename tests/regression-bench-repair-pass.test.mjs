// THE REPAIR-PASS BENCH (remediation-repair-pass.plan.md stage 4): a refused remediation rebuilt in a worktree at the head
// its full check recorded, the refusal reproduced, then the working tree's repair pass run on it, committing nothing.
// RP-D2 and RP-D3 wait on its figures (operator, 2026-11-01: "lets measure before deciding"), so it is held here to a
// fixture refusal made by the real runner: rebuilt, reproduced, repaired, reported, and nothing left behind.
// Split into 2 files by split-slow-test-files.md; the others are regression-bench-repair-pass-*.test.mjs, and the
// fixture they share is bench-repair-pass-fixture.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runScript, mintedRunDir } from './helpers.mjs';
import { repairBenchSummary } from '../scripts/lib/repair-bench.mjs';
import { git, fakeNode, SUITE, refusedCase, replayOf, freshRemediation } from './bench-repair-pass-fixture.mjs';

test('stage 4: a refused case is rebuilt, reproduced, repaired and reported, committing nothing and leaving no worktree', (t) => {
  const f = refusedCase(t);
  const before = f.head();
  const r = f.bench();
  assert.equal(r.status, 0, r.output);
  const c = f.caseResult();
  assert.equal(c.status, 'measured', JSON.stringify(c));
  assert.deepEqual(c.reproduce.failing, [{ name: 'the ratchet holds', file: 'tests/a.test.js' }]);
  assert.equal(c.green_after, 1);
  assert.equal(c.passes.length, 1);
  assert.equal(c.passes[0].cost_usd, 0.25, 'the repair node\'s own cost is not read from its output');
  // Each file against what it was before the repair: src/a.js the candidate's, scripts/tool.mjs the head's (it is not in
  // the candidate); the first real run compared such a file with an empty one and counted all of it.
  assert.deepEqual(c.diff.per_file.map((f) => [f.path, f.before_from, f.added, f.removed]).sort(),
    [['scripts/tool.mjs', 'head', 1, 0], ['src/a.js', 'candidate', 1, 0]]);
  assert.equal(c.diff.added, 2);
  // The first node was replayed by the runner, not run: only the repair pass reached the runtime.
  assert.deepEqual(f.spawns(), ['remediation-repair-1']);
  assert.equal(f.head(), before, 'the bench committed in the repository');
  assert.equal(git(f.repo, 'worktree', 'list', '--porcelain').stdout.match(/^worktree /gm).length, 1, 'the worktree was left behind');
  assert.equal(git(f.repo, 'status', '--porcelain').stdout, '', 'the bench changed the repository\'s working tree');
  const md = fs.readFileSync(f.results, 'utf8');
  assert.match(md, new RegExp(`\\| ${path.basename(f.rem)} \\| measured`));
  assert.match(md, /green after pass 1: 1 of 1/);
});

test('stage 4: a case whose full check no longer fails the same way is reported not reproduced, and no pass runs', (t) => {
  const f = refusedCase(t);
  fs.writeFileSync(f.green, '');
  const r = f.bench();
  assert.equal(r.status, 0, r.output);
  const c = f.caseResult();
  assert.equal(c.status, 'not-reproduced', JSON.stringify(c));
  assert.deepEqual(f.spawns(), []);
  assert.match(fs.readFileSync(f.results, 'utf8'), /not-reproduced/);
});

test('stage 4: the results table prints every figure beside its n', () => {
  const s = repairBenchSummary([
    { case: 'a', started_at: '1', status: 'measured', green_after: 1, wall_ms: 60000, recorded_failing: ['x'],
      reproduce: { check_ms: 60000 }, passes: [{ node_ms: 60000, check_ms: 60000, cost_usd: 1.5, usage: { input_tokens: 1, output_tokens: 2 } }],
      diff: { files: 1, added: 2, removed: 1 } },
    { case: 'b', started_at: '2', status: 'not-reproduced', why: 'no', wall_ms: 1000 },
  ]);
  assert.match(s.outcomes, /green after pass 1: 1 of 1/);
  assert.match(s.totals, /cases attempted: 2; measured: 1; not measured: 1/);
  assert.match(s.totals, /\$1\.50 over 1 pass/);
  assert.match(s.not_measured, /b: not-reproduced/);
  // A rebuilt diff replaces the bench's own, marked, with its source in the totals; a refused pass is named with why.
  const r = repairBenchSummary([{ case: 'c', started_at: '3', status: 'measured', green_after: 'never', wall_ms: 1, recorded_failing: ['x'],
    passes: [{ pass: 1, outcome: 'refused', why: 'reported, but not among the failing tests' }],
    diff: { files: 1, added: 189, removed: 1 }, diff_rebuilt: { files: 1, added: 3, removed: 1, source: 'the transcript' } }]);
  assert.match(r.rows, /1 file\(s\), \+3 -1 \(rebuilt\)/);
  assert.doesNotMatch(r.rows, /\+189/);
  assert.match(r.totals, /rebuilt after the run: the transcript/);
  assert.match(r.outcomes, /c, pass 1 not admitted: reported, but not among the failing tests/);
  // A case measured again: the earlier result is listed as superseded and counted nowhere else.
  const s2 = repairBenchSummary([
    { case: 'd', started_at: '1', status: 'measured', green_after: 'never', wall_ms: 60000, superseded_by: 'd-2', superseded_why: 'fixed', passes: [{ cost_usd: 9 }] },
    { case: 'd', started_at: '2', status: 'measured', green_after: 1, wall_ms: 60000, passes: [{ cost_usd: 1 }] },
  ]);
  assert.match(s2.totals, /cases attempted: 1; measured: 1/);
  assert.match(s2.totals, /\$1\.00 over 1 pass/);
  assert.match(s2.superseded, /d, measured 1: measured, green after never; superseded by d-2: fixed/);
  assert.equal(s2.rows.split('\n').length, 1);
});

// G-10 of 20261102-024315-rrp-delivery: --cap takes any whole number, but the outcomes counted passes 1-3 only, so a case
// green on pass 4 sat in no bucket. G-9: a missing figure was summed as 0, so an unknown cost read as $0.00.
test('G-10: every measured case is in an outcome bucket at any cap', () => {
  const s = repairBenchSummary([
    { case: 'a', started_at: '1', status: 'measured', green_after: 4, wall_ms: 60000, passes: [{ node_ms: 1, check_ms: 1, cost_usd: 1, usage: { input_tokens: 1 } }] },
    { case: 'b', started_at: '2', status: 'measured', green_after: 1, wall_ms: 60000, passes: [{ node_ms: 1, check_ms: 1, cost_usd: 1, usage: { input_tokens: 1 } }] },
  ]);
  assert.match(s.outcomes, /green after pass 4: 1 of 2/);
  const buckets = [...s.outcomes.matchAll(/: (\d+) of 2/g)].reduce((n, m) => n + Number(m[1]), 0);
  assert.equal(buckets, 2, `the outcome buckets do not add up to the measured cases:\n${s.outcomes}`);
});

test('G-9: an unknown figure reads n/a, not 0', () => {
  const u = repairBenchSummary([{ case: 'c', started_at: '1', status: 'measured', green_after: 1, wall_ms: 60000,
    passes: [{ pass: 1, node_ms: undefined, check_ms: 1000, cost_usd: undefined }] }]);
  assert.doesNotMatch(u.rows, /\$0\.00/, `an unread cost was reported as $0.00: ${u.rows}`);
  assert.doesNotMatch(u.totals, /\$0\.00/, `an unread cost was totalled as $0.00: ${u.totals}`);
  assert.match(u.totals, /repair node vendor cost: n\/a/);
  assert.match(u.totals, /repair node time: n\/a/);
});

// G-1 (HIGH) of 20261102-060316-rrp-remediation-3-review: the bench stood in as the node runtime, and that role ran before
// its depth guard, contained only under a home the caller's environment chose. A caller at GRAPH_NODE_DEPTH 1 setting
// every variable the role ever read, its replay directory under that home, made it start the command its record named.
// The role is gone (repair-bench-replay.plan.md, BR-D1 A): the guard is the first thing the script does.
test('BR-D1: at GRAPH_NODE_DEPTH 1 the bench starts nothing, whatever the environment names', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'q-rbench-depth-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const replay = path.join(home, 'bench-repair', 'case', 'replay');
  fs.mkdirSync(path.join(replay, 'evidence'), { recursive: true });
  const marker = path.join(base, 'ran');
  const fwd = path.join(base, 'fwd.mjs');
  fs.writeFileSync(fwd, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, 'x');\n`);
  fs.writeFileSync(path.join(replay, 'replay.json'), JSON.stringify({ run_dir: base, worktree: base, candidate: {}, forward: fwd }));
  fs.writeFileSync(path.join(replay, 'payload.json'), '{}');
  for (const id of ['remediation-repair-1', 'remediation']) {
    const r = runScript('bench-repair-pass.mjs', ['--version'], { cwd: base, env: { QUORATE_HOME: home, QUORATE_BENCH_REPLAY_DIR: replay,
      QUORATE_BENCH_FORWARD: fwd, QUORATE_NODE_ID: id, GRAPH_NODE_DEPTH: '1' } });
    assert.equal(r.status, 3, `${id}: ${r.output}`);
    assert.match(r.output, /a graph node may not start a benchmark/, id);
    assert.equal(fs.existsSync(marker), false, `${id}: the bench started a command at depth 1: ${r.output}`);
  }
});

// The same class at its source (BR-D1 A): no script reads a replay variable, so no role can be entered through one.
test('BR-D1: no script names the bench\'s replay variables', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.m?js$/.test(e.name) && /QUORATE_BENCH_(REPLAY_DIR|FORWARD)/.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
  } };
  walk(root);
  assert.deepEqual(hits, []);
});

// BR-D2 A: the replay is refused before the lock, with nothing changed, unless it is a measured first run of this run in
// this repository.
test('BR-D2: --replay-node is refused without --measure-only, with --retry-commits, or for another run or repository', (t) => {
  const f = refusedCase(t);
  const rem2 = freshRemediation(f, 'fix2');
  const good = replayOf(f, rem2);
  const other = replayOf(f, f.rem, path.join(f.base, 'replay-other'));
  const elsewhere = path.join(f.base, 'replay-elsewhere');
  replayOf(f, rem2, elsewhere);
  const rec = JSON.parse(fs.readFileSync(path.join(elsewhere, 'replay.json'), 'utf8'));
  fs.writeFileSync(path.join(elsewhere, 'replay.json'), JSON.stringify({ ...rec, worktree: f.base }));
  const cases = [
    [['--replay-node', good], /--replay-node runs only with --measure-only/],
    [['--replay-node', good, '--measure-only', '--retry-commits'], /--retry-commits spawns no first node/],
    [['--replay-node', other, '--measure-only'], /names the run/],
    [['--replay-node', elsewhere, '--measure-only'], /names the repository/],
  ];
  for (const [extra, why] of cases) {
    const r = runScript('remediate.mjs', ['--run-dir', rem2, '--runtime-bin', f.bin, '--no-verify-sandbox', ...extra], { cwd: f.repo, env: f.env });
    assert.notEqual(r.status, 0, `${extra.join(' ')}: ${r.output}`);
    assert.match(r.output, why, extra.join(' '));
    assert.equal(fs.existsSync(path.join(rem2, 'remediate.lock')), false, `${extra.join(' ')}: the lock was taken`);
    assert.equal(git(f.repo, 'status', '--porcelain').stdout, '', `${extra.join(' ')}: the tree changed`);
  }
  assert.deepEqual(f.spawns(), [], 'a refused replay reached the runtime');
});

// G-8 of 20261102-173413-rbr-remediation-review: the replay directory went to confined unchecked, and confined does not
// re-check its root, so a --replay-node that is a link or junction was followed instead of refused.
test('G-8: a --replay-node that is a link or junction is refused, with nothing changed', (t) => {
  const f = refusedCase(t);
  const rem2 = freshRemediation(f, 'fix-link');
  const good = replayOf(f, rem2);
  const link = path.join(f.base, 'replay-link');
  fs.symlinkSync(good, link, process.platform === 'win32' ? 'junction' : 'dir');
  const r = runScript('remediate.mjs', ['--run-dir', rem2, '--runtime-bin', f.bin, '--no-verify-sandbox', '--replay-node', link,
    '--measure-only', '--test-repair-passes', '0'], { cwd: f.repo, env: f.env });
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /--replay-node .*link or junction/);
  assert.equal(fs.existsSync(path.join(rem2, 'remediate.lock')), false, 'the lock was taken');
  assert.equal(git(f.repo, 'status', '--porcelain').stdout, '', 'the tree changed');
});

// BR-D1 A: the runner installs the recorded node and spawns none; the full check runs on it, and a repair pass still
// spawns the runtime.
test('BR-D1: --replay-node installs the recorded node instead of spawning it, and a repair pass still spawns', (t) => {
  const f = refusedCase(t);
  const rem2 = freshRemediation(f, 'fix3');
  const replay = replayOf(f, rem2);
  const r = runScript('remediate.mjs', ['--run-dir', rem2, '--runtime-bin', f.bin, '--no-verify-sandbox', '--replay-node', replay,
    '--measure-only', '--test-repair-passes', '1'], { cwd: f.repo, env: f.env });
  assert.equal(r.status, 0, r.output);
  // The line names the flag that replayed it (G-14 of 20261102-161123-rbr-delivery).
  assert.match(r.output, /REPLAYED by --replay-node from .*, not spawned/);
  assert.deepEqual(f.spawns(), ['remediation-repair-1'], 'the first node was spawned, or the repair pass was not');
  const ev = path.join(rem2, 'evidence', 'remediation');
  assert.ok(fs.existsSync(path.join(ev, 'red.txt')) && fs.existsSync(path.join(ev, 'green.txt')), 'the captures were not installed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(ev, 'payload.json'), 'utf8')).run_id, path.basename(rem2));
  assert.equal(JSON.parse(fs.readFileSync(path.join(rem2, 'nodes', 'remediation.status.json'), 'utf8')).run_id, path.basename(rem2));
  const run = JSON.parse(fs.readFileSync(path.join(rem2, 'run.json'), 'utf8'));
  assert.ok((run.full_checks ?? []).length >= 2, `the full check did not run on the replayed candidate and the repair: ${JSON.stringify(run.full_checks)}`);
  assert.deepEqual(run.full_checks[0].refusals.map((x) => x.key), ['test']);
  assert.match(fs.readFileSync(path.join(f.repo, 'src', 'a.js'), 'utf8'), /repaired/, 'the repair pass did not run on the candidate');
});

// 20261024-003108-rmg-remediation-3b: the retry's own check of the candidate timed out, so no repair pass was offered,
// and the bench recorded the case as measured and never green, which read as a repair pass that failed.
test('stage 4: a case whose retry check refuses on something other than failing tests is recorded no-pass, not measured', (t) => {
  const f = refusedCase(t);
  // Check 1 was the original run's, check 2 the reproduction; check 3, the retry's, breaks.
  fs.writeFileSync(`${f.green}.break-at`, '3');
  const r = f.bench();
  assert.equal(r.status, 0, r.output);
  const c = f.caseResult();
  assert.equal(c.status, 'no-pass', JSON.stringify(c));
  assert.match(c.why, /no repair pass was offered/);
  assert.deepEqual(f.spawns(), []);
  assert.match(fs.readFileSync(f.results, 'utf8'), /no-pass/);
});

// G-1 of 20261108-021347-si-remediation-2-review: the diff step ran rev-parse, hash-object and diff for each changed file,
// 3F git processes. The head's blobs come from one ls-tree and the repaired files' blobs from one hash-object --stdin-paths;
// only the per-file numstat is left in the loop. The behaviour is the stage-4 test above (per_file before_from and counts).
test('G-1: the repair diff reads the head\'s and the repaired blobs in one batch each, not two git processes per file', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../scripts/bench-repair-pass.mjs', import.meta.url)), 'utf8');
  const a = src.indexOf('const changed = changedFiles(passes);');
  const step = src.slice(a, src.indexOf('const outcome = repairRunOutcome(', a));
  assert.match(step, /git\(wtPath, 'ls-tree', '-z', check\.head, '--', \.\.\.list\.map\(\(p\) => `:\(literal\)\$\{p\}`\)\)/, 'the head\'s blobs are not read in one ls-tree');
  assert.match(step, /\['hash-object', '-w', '--stdin-paths'\]/, 'the repaired blobs are not hashed in one batch');
  const loop = step.slice(step.indexOf('for (const p of list)'));
  assert.ok(step.includes('for (const p of list)'), 'the per-file loop is gone');
  assert.doesNotMatch(loop, /'rev-parse'|'hash-object'/, 'a per-file rev-parse or hash-object is still in the loop');
});
