// G-39: a node's stdout and stderr were opened as unrestricted files and the child was piped
// straight into them with no cap and no backpressure, so a process that would not stop writing
// could fill the disk before its timeout ever fired. That is the unbounded_resource_growth
// invariant, on the path every single node takes.
//
// The reachability is the part that makes it MEDIUM rather than theoretical: the node timeout is
// 15 minutes by default and 30 for the two long lenses, and a child writing at disk speed for that
// long is not a subtle failure — it takes the machine down, along with the run that would have
// reported it. The operator hit a related wall from the other direction during this project
// ("1.2 GB free of 64 GB???"), which is what a full disk on this box actually looks like.
//
// THE FIX IS A WATCHDOG, NOT A PIPE, and this test is written against that choice. Routing output
// through Node to count bytes would put a JS event loop in the data path of the one stream that is
// deliberately unbuffered — and stdout carries the verdict envelope, which must reach disk even if
// the parent dies. So the two files are SAMPLED and the tree is killed when they exceed the cap.
//
// The consequence of sampling is bounded overshoot rather than an exact ceiling, and the test says
// so instead of pinning a number the implementation cannot honour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runScript, REPO_ROOT, repoRunDir } from './helpers.mjs';

// A REAL CHILD, NAMED EXPLICITLY — the real spawn path, the real watchdog, a real process to kill.
//
// Passed with --runtime-bin rather than placed first on PATH, and the difference is not cosmetic.
// The PATH version of this fixture SILENTLY RAN THE OPERATOR'S REAL CLAUDE CODE: on Windows,
// CreateProcess appends only `.exe` when spawning without a shell, so a `claude.cmd` shim is never
// found and the search falls through to the installed CLI. This test then spawned a live billed
// session, reported ~3 KB of that session's envelope as the flood's output, and failed for a reason
// that looked exactly like the cap not working. A test that can reach a real vendor when its fake
// is missed is not a slow test, it is a wrong one.
function fakeClaude(dir, body) {
  const js = path.join(dir, 'fake-claude.mjs');
  fs.writeFileSync(js, body);
  return js;
}

// Writes until something stops it. It never exits on its own, so a watchdog that does not fire is
// reported as the node timing out rather than as a pass.
//
// THROTTLED ON PURPOSE, and the throttle is a safety property of the test, not a detail. The first
// version wrote 1 MiB every 5 ms — about 200 MB/s — and when the watchdog was disabled to prove the
// test could go red, it filled 12 GB of .sandbox before the run was killed, on a machine that has
// already run out of disk once during this project. A regression test for unbounded growth must not
// be an unbounded-growth incident when it fails. 256 KiB every 25 ms is ~10 MB/s: still far faster
// than any real node, still trivially over a 1 MiB cap, and bounded by the short node timeout below
// to a couple of hundred megabytes in the worst case where nothing works at all.
//
// SELF-LIMITED, so the disk bound no longer rests on the node timeout (ledger node-output-cap:100). The
// timeout was 12 s for that reason, and under full-suite load a child can take that long just to START:
// the node ended on its clock before the 1 MiB cap fired, and the test read that as the watchdog
// failing. The child now stops writing at 64 MiB and stays alive, so a watchdog that never fires is
// still bounded to 64 MiB and still ends on the clock (timed_out) — and the clock can be generous.
const FLOOD = [
  `const chunk = 'x'.repeat(256 * 1024);`,
  `let written = 0;`,
  `setInterval(() => { if (written >= 64 * 1024 * 1024) return; try { process.stdout.write(chunk); written += chunk.length; } catch {} }, 25);`,
  ``,
].join('\n');
// Minutes. Generous because it is headroom for LOAD, not a bound on disk (the child bounds that): a
// working watchdog ends the node within a poll of the cap, so this is only ever reached when it fails.
const FLOOD_TIMEOUT_MIN = '2';

const QUIET = [
  `process.stdout.write(JSON.stringify({`,
  `  type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, num_turns: 1,`,
  `  result: JSON.stringify({ verdict: 'PASS', findings: [], not_checked: [] }),`,
  `}));`,
  ``,
].join('\n');

function spawnWithFake(childSource, extraArgs, timeoutMinutes = '0.2') {
  const { base, dir: runDir } = repoRunDir({ runId: '20260101-000000-outputcap' });
  // No node runs without a policy file — spawn-node refuses rather than defaulting, which is the
  // right call and means the fixture has to supply one.
  fs.writeFileSync(path.join(runDir, 'node-settings.json'),
    JSON.stringify({ permissions: { defaultMode: 'manual', allow: [], deny: [] } }));
  const fakeJs = fakeClaude(base, childSource);
  try {
    const r = runScript('spawn-node.mjs', [
      '--run-dir', runDir, '--repo-root', REPO_ROOT,
      '--node-id', 'code-audit', '--mode', 'lens', '--prompt', 'x',
      // Required for a lens: run-graph resolves it from lens-roster.json and there is deliberately
      // no fallback table in spawn-node, so a direct call must supply it.
      '--allowed-basis', 'convention',
      // Short by default; the flooding fixtures pass a longer one, since FLOOD bounds its own output.
      '--timeout-minutes', timeoutMinutes,
      // The fixture script itself: spawn-node runs a .mjs value under its own node, so the child
      // is a real process with a real process group and nothing is resolved by name.
      '--runtime-bin', fakeJs,
      ...extraArgs,
    ]);
    const statusPath = path.join(runDir, 'nodes', 'code-audit.status.json');
    const status = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : null;
    return { r, status, runDir };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test('regression: a node that floods its output is killed instead of filling the disk', () => {
  // A 1 MiB cap against a child writing ~10 MB/s: the kill must land, and land soon.
  const { status } = spawnWithFake(FLOOD, ['--output-cap-mb', '1'], FLOOD_TIMEOUT_MIN);
  assert.ok(status, `the node must still write a status file after being killed`);
  assert.equal(status.state, 'BLOCKED',
    'a process killed mid-sentence has no verdict — a severed envelope is not a degraded one');
  assert.equal(status.output_capped, true, 'the status must record WHY it was killed');
  assert.ok(status.validator_errors.some((e) => /output exceeded the \d+-byte cap/.test(e)),
    `the reason must be stated, not inferred; got ${JSON.stringify(status.validator_errors)}`);
  assert.equal(status.killed_tree, true, 'the whole process group must go, not just the parent');
});

test('regression: the cap, not the clock, is what ends a flooding node', () => {
  const { status } = spawnWithFake(FLOOD, ['--output-cap-mb', '1'], FLOOD_TIMEOUT_MIN);
  const written = status.stdout_bytes + status.stderr_bytes;
  assert.ok(written > 1024 * 1024,
    'the cap fires on exceeding, so the file is expected to be at or past it');

  // THE DURATION IS THE LOAD-INDEPENDENT PROPERTY, and the byte count is not.
  //
  // This asserted `written < 16 MiB` and it was FLAKY: it passed alone and failed inside the full
  // suite, where dozens of test files run at once, the watchdog's 100 ms poll slips, and the child
  // writes more between samples. That is the second absolute bound in a parallel suite I have had
  // to remove today — the overshoot is (write rate x sampling interval), and both terms depend on
  // what else the machine is doing, so no byte ceiling can be both meaningful and stable.
  //
  // What the watchdog actually guarantees is that the node ends on its CAP rather than on its
  // timeout. The child never exits by itself, so without the cap this node ends at exactly
  // timeoutMs; ending well before that is the property, and it holds under any load.
  // THE RECORDED REASON IS THE LOAD-INDEPENDENT PROPERTY, and a duration fraction is not. This is
  // the THIRD absolute bound removed from this test for one root cause — a byte ceiling went first,
  // then a 16 MiB one, and `duration_ms < timeoutMs * 0.5` was the survivor. It failed at 7310ms of
  // a 12000ms timeout inside a suite that had grown to 939 tests: the watchdog polls every 100ms,
  // the poll slips under load, and any fraction of the timeout is a bet on how busy the machine is.
  //
  // spawn-node writes WHICH mechanism ended the node — `output_capped` when the watchdog fired,
  // `timed_out` when the clock did — so the question this test asks has an exact answer on disk and
  // does not need to be inferred from a stopwatch. The two fields together are stronger than the
  // bound they replace: `duration_ms < timeoutMs * 0.5` would pass a node the CLOCK killed early.
  const timeoutMs = Number(FLOOD_TIMEOUT_MIN) * 60_000;
  assert.equal(status.output_capped, true,
    'the cap must be what ended the node, and the status is where that is recorded');
  assert.notEqual(status.timed_out, true,
    `the clock must NOT be what ended it: ${status.duration_ms}ms of a ${timeoutMs}ms timeout`);
  // THE LAST TWO BOUNDS ARE GONE, for the same root cause as the three before them (G-13 of
  // 20260926-060936-m0-close-r3, and the ledger's node-output-cap:140). `duration_ms < timeoutMs`
  // failed at 15209ms and `written < 60 MiB` at 69992448 bytes, both inside a loaded suite, both
  // with output_capped true and timed_out false — the watchdog fired and the CLOCK slipped. A whole
  // timeout of headroom was still a bet on load, because under load the timeout timer slips too.
  // Neither bound added coverage: a watchdog that never fires leaves output_capped unset and the
  // clock ends the node with timed_out set — both asserted above. Shown by mutation: this test run
  // with --output-cap-mb 1000, a cap the fixture cannot reach, fails on those two assertions.
});

test('regression: a node under the cap is untouched by the watchdog', () => {
  // The half that matters for every real run: a normal node writes kilobytes, and must not be
  // killed, marked, or slowed by a bound it never approaches.
  // The timeout is headroom for LOAD, as FLOOD_TIMEOUT_MIN is: QUIET writes one line and exits by itself, so the clock is
  // only ever reached when the machine is slow. The 12 s default timed it out inside a loaded suite (2026-10-03, the
  // pre-flight of 20261003-230257-arms-dir-home-confirm-5): "timed out after 12000 ms", a quiet node BLOCKED by the clock.
  const { status } = spawnWithFake(QUIET, ['--output-cap-mb', '1'], FLOOD_TIMEOUT_MIN);
  assert.ok(status, 'a quiet node must produce a status file');
  assert.notEqual(status.state, 'BLOCKED', `a quiet node must not be blocked; got ${JSON.stringify(status.validator_errors)}`);
  assert.ok(!status.output_capped, 'nothing was capped, so nothing may claim it was');
  assert.equal(status.killed_tree, false, 'a node that finished on its own was not killed');
  // The call's entry in the node's status (runtime-call-telemetry.plan.md stage 3): the runtime's family, the process facts.
  assert.ok(status.call, 'the node status carries no call entry');
  assert.equal(status.call.family, 'anthropic');
  assert.equal(status.call.exit_code, status.exit_code);
  assert.ok(Number.isInteger(status.call.duration_ms), `no duration: ${JSON.stringify(status.call)}`);
  assert.equal(status.call.timed_out, false);
});

test('regression: the cap is a flag, not a hardcoded constant', () => {
  const { base, dir: runDir } = repoRunDir({ runId: '20260101-000000-outputcapargs' });
  try {
    const r = runScript('spawn-node.mjs', [
      '--run-dir', runDir, '--repo-root', REPO_ROOT,
      '--node-id', 'code-audit', '--mode', 'lens', '--prompt', 'x',
      '--allowed-basis', 'convention',
      '--output-cap-mb', '0',
    ]);
    assert.equal(r.status, 2, 'a non-positive cap is a configuration error, not a silent disable');
    assert.match(r.output, /--output-cap-mb must be a positive number/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// THE SPAWNER IS RUNTIME-AGNOSTIC AND ITS NAMES SAID OTHERWISE.
//
// Raised as: "entry-points quorate calls should already exist everywhere calling adapter entrypoints
// to support diverse CLIs." An audit of every process launch in the engine says the MECHANISM is
// already that — node runtimes resolve through `RUNTIME.cmd` from the adapter table, reviewers through
// `reviewerArgv`, the bench through `entrypoint`; the only non-adapter launches are `git`, `taskkill`
// (platform-guarded), the engine re-invoking itself, and the contract's own declared commands.
//
// What was not runtime-agnostic was the NAMING: `claudeBin`, `claudePrefix`, `claudeCmd` for values
// that come from whichever runtime the roster declares. This repository already removed the same
// residue on the reviewer side, where the string 'agy' sat in five places while the vendor was
// supposedly a parameter — "the vendor is a parameter, never a literal" (G-41, G-55). A name is the
// cheapest kind of literal, and the next editor reads it as a constraint.
test('regression: the node spawner names its command after the RUNTIME, not a vendor', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'spawn-node.mjs'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  // Through the one owner of the launch, lib/argv-specs.mjs runtimeLaunch (G-6 of 20261111-192009-runtime-bin-remediation-review).
  assert.match(code, /const \{ cmd: runtimeCmd, prefix: runtimePrefix \} = runtimeLaunch\(args\.runtimeBin, RUNTIME\.cmd, process\.execPath\);/,
    'the command comes from the adapter, and the local says so');
  // The spawn itself moved to scripts/io/run-child.mjs (20261001-205530-m0-pending-claims-review); spawn-node hands it
  // the runtime command — through the platform's boundedLaunch since stopping-a-child stage 5, which wraps it in the
  // file-size ceiling where one applies. The claim is unchanged: the command is the runtime's.
  assert.match(code, /boundedLaunch\(runtimeCmd, \[\.\.\.runtimePrefix, \.\.\.argv\]\)/);
  for (const dead of ['claudeCmd', 'claudePrefix', ['claude', 'Bin'].join('')]) {
    // `\\b`, not `\b`: inside a template literal `\b` is a BACKSPACE, and this check could never fail (G-18 of
    // 20261001-205530-m0-pending-claims-review).
    assert.ok(!new RegExp(`\\b${dead}\\b`).test(code),
      `${dead} presents a generic runtime as Claude-specific to every future reader`);
  }
  // THE FLAG TOO (operator, 2026-11-11: "A. Rename, keep an alias (Recommended)"): the earlier reasoning, that the old
  // spelling stayed because fixtures passed it, is superseded. spawn-node reads --runtime-bin through the pair's one
  // owner (lib/argv-specs.mjs, io/runtime-bin.mjs), and its value is still `runtimeBin`.
  assert.match(code, /out\.runtimeBin = runtimeBinArg\(v\)/, 'the flag is not read through its one owner');
});
