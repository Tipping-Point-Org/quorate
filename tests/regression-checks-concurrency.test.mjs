// G-30: the pre-flight loop ran all seven declared commands one at a time through a blocking
// spawnSync, and six of them are `evidence` class — no data dependency on one another and no
// ability to stop the run — so their wall clock was strictly additive for no structural reason.
//
// THE FIX IS DECLARED, NOT DEFAULT, and that is the part worth pinning. These are commands a
// CONSUMING PROJECT writes and this engine knows nothing about: two of them may bind the same port,
// share a build cache, write the same coverage file, or expect a database to themselves. Turning
// concurrency on for everyone would trade a slow pre-flight for intermittent failures in the one
// phase whose job is producing trustworthy evidence, and a flaky barrier is worse than a slow one.
// So `review.checks_concurrency` defaults to 1 and the operator raises it.
//
// Restructuring the loop also moved two things that had to keep working, and both are asserted
// here because both fail silently:
//   * the barrier still runs FIRST and ALONE, and nothing else runs after it fails;
//   * checks.json still lists results in DECLARED order, not completion order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, REPO_ROOT, repoRunDir } from './helpers.mjs';

// A command that sleeps without a shell, so the same fixture works on every platform — and RECORDS
// WHEN it ran (G-46). The interval each check occupied is the only evidence that
// answers "did these overlap?" without measuring a machine other tests are also using. A declared
// command is a plain string that contractArgv splits on whitespace, so this is a small script
// invoked with ordinary arguments rather than an inline `node -e` full of quotes.
const SPAN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'quorate-spans-'));
const SPAN_JS = path.join(SPAN_DIR, 'span.mjs');
fs.writeFileSync(SPAN_JS, [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  'const [dir, ms] = process.argv.slice(2);',
  'const start = Date.now();',
  'setTimeout(() => {',
  // NAMED BY THE CHILD, not by the caller. A per-call counter in `sleeper` would make
  // `sleeper(600)` return a different string each time, and one of these tests compares the
  // recorded command against a freshly built one — a declared command must be a pure function
  // of its duration.
  "  const name = process.pid + '-' + Math.random().toString(36).slice(2, 8) + '.json';",
  "  fs.writeFileSync(path.join(dir, name), JSON.stringify({ start, end: Date.now() }));",
  '}, Number(ms));',
].join(String.fromCharCode(10)));

const sleeper = (ms) => `node ${SPAN_JS} ${SPAN_DIR} ${ms}`;

// THE FOURTH VERSION: a sleeper that waits for a PEER before its interval starts. The third still
// failed under full-suite load (m0-close's pre-flight; remediate-m0-close s2-green-3) and passed alone
// 3/3: each check is `node capture.mjs -- node span.mjs`, two process startups before the sleep
// begins, and under load those stretched past the 600 ms sleep, so four checks started TOGETHER
// recorded four sleeps that did not overlap. Now each announces itself and waits (up to 15 s) until a
// second sleeper has started, then sleeps. A concurrent pool makes two of them alive at once whatever
// the startup delay, so their intervals overlap; a pool that is really serial leaves the first
// waiting alone until the deadline, and nothing overlaps — the test still fails on the real defect.
const PEER_JS = path.join(SPAN_DIR, 'peer.mjs');
fs.writeFileSync(PEER_JS, [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  'const [dir, ms, waitMs] = process.argv.slice(2);',
  "fs.writeFileSync(path.join(dir, process.pid + '.started'), '');",
  'const deadline = Date.now() + Number(waitMs);',
  'const nap = new Int32Array(new SharedArrayBuffer(4));',
  "while (fs.readdirSync(dir).filter((f) => f.endsWith('.started')).length < 2 && Date.now() < deadline) Atomics.wait(nap, 0, 0, 20);",
  'const start = Date.now();',
  'setTimeout(() => {',
  "  const name = process.pid + '-' + Math.random().toString(36).slice(2, 8) + '.json';",
  "  fs.writeFileSync(path.join(dir, name), JSON.stringify({ start, end: Date.now() }));",
  '}, Number(ms));',
].join(String.fromCharCode(10)));
const peerSleeper = (ms) => `node ${PEER_JS} ${SPAN_DIR} ${ms} 15000`;

// The intervals written by whichever sleepers ran, newest set only: each runChecks call clears the
// directory first, so what is left describes that call alone.
const readSpans = () => fs.readdirSync(SPAN_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(SPAN_DIR, f), 'utf8')));
const clearSpans = () => {
  for (const f of fs.readdirSync(SPAN_DIR).filter((x) => x.endsWith('.json') || x.endsWith('.started'))) {
    fs.rmSync(path.join(SPAN_DIR, f), { force: true });
  }
};

const failing = 'node -e process.exit(1)';

function runChecks({ commands, checksConcurrency }) {
  clearSpans();   // so the spans read afterwards describe THIS call alone
  const { base, dir } = repoRunDir({
    runId: '20260101-000000-checkspool',
    json: {
      contract: {
        commands,
        review: checksConcurrency === undefined ? {} : { checks_concurrency: checksConcurrency },
      },
      stamps: [],
    },
  });
  try {
    const started = Date.now();
    const r = runScript('run-checks.mjs', ['--run-dir', dir, '--repo-root', REPO_ROOT]);
    const ms = Date.now() - started;
    const checks = JSON.parse(fs.readFileSync(path.join(dir, 'checks.json'), 'utf8'));
    return { r, ms, checks, spans: readSpans() };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

const FOUR_SLEEPERS = {
  build: 'node -e 0',
  test: sleeper(600),
  lint: sleeper(600),
  fmt_check: sleeper(600),
  typecheck: sleeper(600),
};
// The pooled run waits for a peer (see peer.mjs above); the serial run must not, or each of its
// sleepers would wait out the deadline alone.
const FOUR_PEER_SLEEPERS = {
  build: 'node -e 0',
  test: peerSleeper(600),
  lint: peerSleeper(600),
  fmt_check: peerSleeper(600),
  typecheck: peerSleeper(600),
};

// NOT A TIMING TEST AT ALL, in the end — and it took three attempts to get there.
//
// First: absolute bounds (serial over 2000 ms, concurrent under 2000 ms), which passed alone and
// failed inside the full suite where dozens of files run in parallel. Then a RELATIVE bound, both
// timings taken under the same load — which still measured the machine: four `node` process
// startups dominate four 600 ms sleeps, and two consecutive runs of the declared test command on an
// unchanged tree gave 0.745 and then a pass (G-46). A flaky test is worse than no test, and this
// suite IS `commands.test`, so the flake failed the pre-flight barrier and the pre-push hook
// non-deterministically — training the re-run-until-green habit the rule exists to prevent.
//
// The third version asks what "concurrent" MEANS rather than what it costs: two checks in flight at
// the same moment. Each sleeper records its own interval and the intervals answer directly. No
// threshold, so nothing to be load-sensitive about.
test('regression: checks_concurrency actually overlaps, and 1 is the default', () => {
  const serial = runChecks({ commands: FOUR_SLEEPERS });
  const pooled = runChecks({ commands: FOUR_PEER_SLEEPERS, checksConcurrency: 4 });

  assert.equal(serial.checks.barrier_failed, null);
  assert.equal(pooled.checks.barrier_failed, null);
  for (const key of ['test', 'lint', 'fmt_check', 'typecheck']) {
    assert.equal(pooled.checks.results.find((x) => x.check === key).status, 'PASS',
      `${key} must still pass under concurrency`);
    assert.equal(serial.checks.results.find((x) => x.check === key).status, 'PASS');
  }

  // Under concurrency at least two intervals overlap; under the default none do. The header above
  // records why this is not a ratio.
  const overlaps = (spans) => spans.some((a, i) => spans.some((b, j) =>
    i !== j && a.start < b.end && b.start < a.end));

  assert.equal(overlaps(pooled.spans), true,
    `concurrency must put two checks in flight at once: ${JSON.stringify(pooled.spans)}`);
  assert.equal(overlaps(serial.spans), false,
    `the default must run them one at a time: ${JSON.stringify(serial.spans)}`);
});

test('regression: results stay in declared order, not completion order', () => {
  // Under concurrency the fast check finishes first. checks.json is read by the gate and by a
  // person, and a file whose row order changes run to run for no interpretable reason is a worse
  // artifact than a slow one.
  const { checks } = runChecks({
    commands: { build: 'node -e 0', test: sleeper(700), lint: 'node -e 0', fmt_check: sleeper(300) },
    checksConcurrency: 4,
  });
  const order = checks.results.map((r) => r.check);
  assert.deepEqual(order.slice(0, 4), ['build', 'test', 'lint', 'fmt_check'],
    'the contract declares the order; completion does not');
});

test('regression: a failed barrier stops everything else from running', () => {
  const { checks } = runChecks({
    commands: { build: failing, test: sleeper(600), lint: sleeper(600) },
    checksConcurrency: 4,
  });
  assert.equal(checks.barrier_failed, 'build');
  assert.equal(checks.results.find((r) => r.check === 'build').status, 'FAIL');
  for (const key of ['test', 'lint']) {
    const row = checks.results.find((r) => r.check === key);
    // NOT RUN, AND SAID SO. A declared command that never ran must not read as a command the
    // project does not declare — the two are different facts about the contract, and the row that
    // conflates them is the one an operator would act on.
    assert.equal(row.status, 'SKIPPED', `${key} must not run after a failed barrier`);
    assert.match(row.reason, /barrier check failed first/);
    assert.equal(row.command, sleeper(600), 'the declared command is still recorded');
    assert.ok(!row.evidence_path, 'a check that never ran produced no evidence');
  }
});

test('regression: an undeclared command still reads as undeclared', () => {
  const { checks } = runChecks({ commands: { build: 'node -e 0', test: '' } });
  const row = checks.results.find((r) => r.check === 'test');
  assert.equal(row.status, 'SKIPPED');
  assert.match(row.reason, /empty in graph_contract/);
  assert.ok(checks.stamps.includes('UNTESTED'), 'an empty test command still stamps UNTESTED');
});

// THE CONCURRENT PATH RECORDED THE WRONG STREAM AS THE EVIDENCE PATH (G-38, panel-codex-code).
//
// capture.mjs reserves stdout for the evidence PATH — "stdout: the canonical path, alone. Cite
// exactly this" — and writes its preview and diagnostics to stderr. shAsync merges both, which is
// right for a log and wrong here: the concurrent path passed the merged buffer to shapeResult while
// its synchronous twin four lines above passed `res.stdout`. So `evidence_path` became a multi-line
// blob, countTests could not open it, and every concurrent run was stamped TESTS-UNCOUNTED — a
// declaration that the suite's weight is unknown, produced by reading the wrong variable.
test('shAsync keeps stdout separable from the merged log', async () => {
  const { shAsync } = await import('../scripts/io/pool.mjs');
  const r = await shAsync(process.execPath, ['-e',
    "process.stdout.write('evidence/lens/build.log'); process.stderr.write('noise on stderr')"]);

  assert.equal(r.stdout.trim(), 'evidence/lens/build.log', 'stdout alone is the child\'s answer');
  assert.ok(r.out.includes('noise on stderr'), 'and the merged buffer still carries both, for logs');
  assert.ok(r.out.includes('evidence/lens/build.log'));

  // The runner moved to the shared core (io/declared-checks.mjs, remediation-verification stage 4), which run-checks and
  // the remediation runner both call; the rule is the same there.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'io', 'declared-checks.mjs'), 'utf8');
  assert.match(src, /shapeResult\(cmdOf\(key\), r\.status, r\.stdout\)/,
    'the concurrent path must shape the same field its synchronous twin does');
  assert.match(fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-checks.mjs'), 'utf8'), /runDeclaredChecks\(/,
    'run-checks no longer runs its checks through the shared core');
});
