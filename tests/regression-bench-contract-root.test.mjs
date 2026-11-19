// bench-contract-root.plan.md: a bench answers to ONE contract, its framework root's, read once (design D1-D3), and a
// live run refuses one that is not committed (D1's amendment). Every case runs in a framework fixture of its own
// (tests/tools/bench-fixture.mjs), launched from a separate project whose contract says something else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { benchFixture, runBench, contractText } from './tools/bench-fixture.mjs';

// Stage 1: the precondition every later case stands on — both benches' no-spend listings run in the fixture.
test('stage 1: both bare listings run in a framework fixture of their own', (t) => {
  const started = Date.now();
  const fx = benchFixture(t, { contract: contractText() });
  const lenses = runBench(fx, 'bench-lenses.mjs');
  assert.equal(lenses.status, 0, lenses.output.slice(-800));
  assert.match(lenses.stdout, /seed\(s\) in the corpus/);
  const so = runBench(fx, 'bench-second-opinion.mjs');
  assert.equal(so.status, 0, so.output.slice(-800));
  assert.match(so.stdout, /seed\(s\) from /);
  // The plan's open question: what the copy costs. Recorded, not asserted.
  t.diagnostic(`fixture + two listings: ${Date.now() - started} ms`);
});

// Stage 2 (D3; ARCHITECTURE §2): one pure decision takes the reader's OUTCOME, not the reader, and the declared adapters
// come from their one owner in lib/reviewers.
test('stage 2: benchContract decides each reader outcome; reviewers come from their one owner', async () => {
  const { benchContract } = await import('../scripts/lib/bench-settings.mjs');
  const { reviewersFromOutcome } = await import('../scripts/lib/reviewers.mjs');
  const reviewers = { z: { cmd: 'z' } };
  const review = { runtime: 'z', models: { judgment: 'opus' } };
  assert.deepEqual(reviewersFromOutcome({ contract: { reviewers } }), reviewers);
  assert.deepEqual(reviewersFromOutcome({ absent: 'no contract' }), {});
  assert.throws(() => reviewersFromOutcome({ error: 'exit 1' }), /contract could not be read: exit 1/);
  assert.deepEqual(benchContract({ contract: { reviewers, review } }), { reviewers, review });
  assert.deepEqual(benchContract({ contract: {} }), { reviewers: {}, review: null }, 'a contract declaring neither');
  assert.deepEqual(benchContract({ absent: 'no contract' }), { reviewers: {}, review: null }, 'no contract');
  assert.throws(() => benchContract({ error: 'exit 1' }), /contract could not be read: exit 1/, 'unreadable: refused');
});

// benchRuntime is folded into the one owner, selectAdapters (contract-runtime-and-session-files.plan.md stage 1): the
// bench chooses exactly as new-run does because both call it.
test('stage 2: the bench\'s runtime is chosen as new-run\'s, and a review.runtime the table lacks is refused', async () => {
  const { selectAdapters } = await import('../scripts/lib/reviewers.mjs');
  const builtins = { a: { cmd: 'a', roles: ['node'] }, b: { cmd: 'b', roles: ['node'] } };
  const pick = (review) => selectAdapters({ builtins, raw: { default_node_runtime: 'a' }, contract: { review } }).runtime;
  assert.equal(pick({ runtime: 'b' }), 'b', 'the declared runtime wins');
  assert.equal(pick(null), 'a', 'else the table default');
  assert.throws(() => pick({ runtime: 'zz' }), /review\.runtime 'zz' is not in the adapter table/);
});

// Stage 3 (D1 A, D2 B): bench-lenses reads ONE contract, the framework root's — never the launch directory's.
const FW_LINE = /bench-lenses: codex — cmd set by the contract/;
const LAUNCH_LINE = /agy — cmd set by the contract/;
const twoContracts = (fx) => {
  // Two contract locations carrying blocks that disagree: refused by new-run, both paths named — an unreadable contract.
  fs.mkdirSync(path.join(fx.fw, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(fx.fw, '.claude', 'rules', 'quorate-contract.md'), contractText({ project: 'other' }));
};

test('stage 3: bench-lenses names the FRAMEWORK root\'s overrides, not the launch directory\'s (the G-4 case)', (t) => {
  const fx = benchFixture(t, { contract: contractText({ reviewers: { codex: { cmd: 'fw-codex' } } }) });
  const r = runBench(fx, 'bench-lenses.mjs');
  assert.equal(r.status, 0, r.output.slice(-800));
  assert.match(r.stderr, FW_LINE, `the framework's override is not named:\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, LAUNCH_LINE, 'the launch directory\'s contract was read');
});

test('stage 3: bench-lenses with no framework contract lists on the built-ins', (t) => {
  const fx = benchFixture(t, { contract: null });
  const r = runBench(fx, 'bench-lenses.mjs');
  assert.equal(r.status, 0, r.output.slice(-800));
  assert.doesNotMatch(r.stderr, / — cmd set by the contract/, 'an override named with no contract to declare it');
});

test('stage 3: an unreadable framework contract refuses the listing (D2 B) but not --score-only (D2)', (t) => {
  const fx = benchFixture(t);
  twoContracts(fx);
  const listing = runBench(fx, 'bench-lenses.mjs');
  assert.notEqual(listing.status, 0, `the listing ran on an unreadable contract:\n${listing.output.slice(-600)}`);
  assert.match(listing.stderr, /contract could not be read/);
  // Under the engine's home and named for its run_id: --score-only admits the run as one of no repository
  // (run-dir-trust.plan.md stage 3, ARCHITECTURE A-28), and the launch directory is not a git repository.
  const home = path.join(fx.launch, 'home');
  const run = path.join(home, '20260101-000000-x');
  fs.mkdirSync(path.join(run, 'nodes'), { recursive: true });
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ run_id: '20260101-000000-x' }));
  const r = runBench(fx, 'bench-lenses.mjs', ['--score-only', '--run-dir', run,
    '--manifest', path.join(fx.fw, 'bench', 'corpus', 'clamp-silent-noop', 'manifest.json'), '--defect-line', '1'], { QUORATE_HOME: home });
  assert.equal(r.status, 0, `--score-only read the contract:\n${r.stderr}`);
});

test('stage 3: the runtime a live run records follows review.runtime, and an undeclared one is refused', (t) => {
  // codex declared node-capable: a reviewer-only runtime is refused by the one owner (G-8 of
  // 20261105-061926-crsf-remediation-review), so the declared runtime this test follows must serve the node role.
  const fx = benchFixture(t, { contract: contractText({ reviewers: { codex: { roles: ['node', 'reviewer'] } }, review: { runtime: 'codex' } }) });
  const r = runBench(fx, 'bench-lenses.mjs');
  assert.equal(r.status, 0, r.output.slice(-800));
  assert.match(r.stdout, /node runtime a live run records: codex/, r.stdout.slice(-600));
  const bad = benchFixture(t, { contract: contractText({ review: { runtime: 'nope' } }) });
  const b = runBench(bad, 'bench-lenses.mjs');
  assert.notEqual(b.status, 0);
  assert.match(b.stderr, /review\.runtime 'nope' is not in the adapter table/);
});

test('stage 3: bench-lenses reads the contract once, at its framework root', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'bench-lenses.mjs'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.equal((code.match(/readContract\(/g) ?? []).length, 1, 'one read, not two that can choose different roots');
  assert.match(code, /readContract\(\{ cwd: FRAMEWORK_ROOT \}\)/);
  assert.doesNotMatch(code, /declaredReviewers\(/, 'the second read');
});

// Stage 3b (D1's amendment): a LIVE run refuses a contract that differs from HEAD — the graphs are seeded from HEAD, so an
// uncommitted contract is one they would never run under. `--seed` naming no seed stops every case before anything
// spends; the refusal comes first, so a committed contract reaches that seed's exit instead.
const LIVE = { QUORATE_BENCH: '1' };
const NO_SEED = ['--seed', 'no-such-seed'];
const UNCOMMITTED = /contract .*(not committed|uncommitted)/i;
const rulesCopy = (fx) => {
  fs.mkdirSync(path.join(fx.fw, '.claude', 'rules'), { recursive: true });
  fs.copyFileSync(path.join(fx.fw, 'CLAUDE.md'), path.join(fx.fw, '.claude', 'rules', 'quorate-contract.md'));
};
for (const [tool, seedExit] of [['bench-lenses.mjs', /no corpus entry named 'no-such-seed'/], ['bench-second-opinion.mjs', /--seed names "no-such-seed"/]]) {
  test(`stage 3b: ${tool} refuses a live run on an uncommitted contract, and lets a committed one through`, (t) => {
    const fx = benchFixture(t, { gitRepo: true });
    const clean = runBench(fx, tool, NO_SEED, LIVE);
    assert.doesNotMatch(clean.output, UNCOMMITTED, 'a committed contract was refused');
    assert.match(clean.output, seedExit, `precondition: the committed case reaches the seed's exit\n${clean.output.slice(-600)}`);
    fs.appendFileSync(path.join(fx.fw, 'CLAUDE.md'), '\n<!-- an uncommitted edit -->\n');
    const dirty = runBench(fx, tool, NO_SEED, LIVE);
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.output, UNCOMMITTED, `a live run went ahead on an uncommitted contract:\n${dirty.output.slice(-600)}`);
    assert.match(dirty.output, /CLAUDE\.md/, 'the refusal names the file');
  });

  test(`stage 3b: ${tool} counts an UNTRACKED contract file as uncommitted`, (t) => {
    const fx = benchFixture(t, { gitRepo: true });
    rulesCopy(fx);   // identical to CLAUDE.md, so the contract still reads; only the untracked file can refuse it
    const r = runBench(fx, tool, NO_SEED, LIVE);
    assert.match(r.output, UNCOMMITTED, r.output.slice(-600));
    assert.match(r.output, /quorate-contract\.md/);
  });

  test(`stage 3b: ${tool} refuses a live run when git cannot answer (unknown is not clean)`, (t) => {
    const fx = benchFixture(t, { gitRepo: false });
    const r = runBench(fx, tool, NO_SEED, LIVE);
    assert.notEqual(r.status, 0);
    assert.match(r.output, /git (status )?(failed|could not)/i, `a live run went ahead with no answer from git:\n${r.output.slice(-600)}`);
    assert.doesNotMatch(r.output, seedExit, 'the run got past the check');
  });
}

test('stage 3b: bench-second-opinion --dry-run spends nothing, so an uncommitted contract does not refuse it', (t) => {
  const fx = benchFixture(t, { gitRepo: true });
  fs.appendFileSync(path.join(fx.fw, 'CLAUDE.md'), '\n<!-- an uncommitted edit -->\n');
  const r = runBench(fx, 'bench-second-opinion.mjs', [...NO_SEED, '--dry-run'], LIVE);
  assert.doesNotMatch(r.output, UNCOMMITTED, r.output.slice(-600));
  assert.match(r.output, /--seed names "no-such-seed"/);
});

// Stage 4 (D1 A): bench-second-opinion answers to the same contract — its forge runtime and the judge's credential
// routing come from the framework root's contract, as its roster already did.
test('stage 4: bench-second-opinion names the FRAMEWORK root\'s overrides and runtime, not the launch directory\'s', (t) => {
  // Declared node-capable, as above (G-8 of 20261105-061926-crsf-remediation-review).
  const fx = benchFixture(t, { contract: contractText({ reviewers: { codex: { cmd: 'fw-codex', roles: ['node', 'reviewer'] } }, review: { runtime: 'codex' } }) });
  const r = runBench(fx, 'bench-second-opinion.mjs');
  assert.equal(r.status, 0, r.output.slice(-800));
  assert.match(r.stderr, /bench-second-opinion: codex — [^\n]*\bcmd\b[^\n]*set by the contract/, r.stderr);
  assert.doesNotMatch(r.stderr, LAUNCH_LINE, 'the launch directory\'s contract was read');
  assert.match(r.stdout, /node runtime a live run records: codex/);
});

test('stage 4: bench-second-opinion refuses an unreadable framework contract in its listing', (t) => {
  const fx = benchFixture(t);
  twoContracts(fx);
  const r = runBench(fx, 'bench-second-opinion.mjs');
  assert.notEqual(r.status, 0, r.output.slice(-600));
  assert.match(r.stderr, /contract could not be read/);
});
