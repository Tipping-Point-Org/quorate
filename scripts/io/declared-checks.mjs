// THE ONE CORE THAT RUNS DECLARED CHECKS (remediation-verification.plan.md, stage 4): extracted from run-checks.mjs so
// the pre-flight and the remediation runner's check of the commit candidate run the same code — each check through
// capture.mjs into the run's evidence, the barrier first and alone, the rest serially or pooled under
// review.checks_concurrency — and read each log the same way. What a result MEANS (a stamp, a refusal) stays with each
// caller; this module only runs and reads.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { contractArgv } from '../lib/decisions.mjs';
import { countTests as countTestsIn, countFailures as countFailuresIn } from '../lib/test-count.mjs';
import { runPool, shAsync } from './pool.mjs';
import { failingTestNames, failingTestsWithFiles } from '../lib/full-check.mjs';
import { parseCaptureHeader, checkOutcome } from '../lib/capture-header.mjs';
import { confined } from './confined-path.mjs';
export { CHECK_KEY_CLASS } from '../lib/full-check.mjs';

// capture.mjs sits beside the scripts, not at a fixed offset from the reviewed tree. The literal
// `repoRoot + '.claude/skills/scripts/capture.mjs'` broke the moment the engine moved to plugin
// layout, and it broke as "build FAILED, exit 1" — the barrier reported the project's build as
// broken when what was actually missing was the evidence recorder.
const CAPTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'capture.mjs');

function captureArgv({ runDir, nodeId, key, repoRoot, timeoutMinutes, inner }) {
  return [CAPTURE, '--run-dir', runDir, '--node', nodeId, '--name', key, '--cwd', repoRoot, '--timeout-minutes', String(timeoutMinutes), '--', ...inner];
}

// A POINTER, NOT A COPY (moved from run-checks). A result carried `stderr_tail`, a slice of the DECLARED COMMAND'S OWN
// OUTPUT, into checks.json, which is tracked; `evidence_path` names the full output at a path kept out of the
// repository. Same class as the /request egress rule: content nobody decided to publish, reaching a place from which
// only history rewriting removes it.
function shapeResult(cmdString, status, stdout) {
  return { command: cmdString, exit_code: status, evidence_path: String(stdout ?? '').trim() || null };
}

/**
 * Run every declared check in `keys` order: those in `barrierKeys` first and alone (nothing downstream is meaningful
 * once the build is broken), then the rest, pooled when `concurrency` > 1. `env`, when given, is the environment the
 * capture process (and so the command) runs in. Returns `{ ran: Map<key, result>, barrierBroke }`; a key missing from
 * `ran` was not run.
 */
export async function runDeclaredChecks({
  runDir, repoRoot, commands, nodeId, timeoutMinutes, keys = Object.keys(commands ?? {}), barrierKeys = new Set(),
  concurrency = 1, shell = '', env, envOf, label = nodeId, onProgress = (m) => process.stderr.write(m),
}) {
  const cmdOf = (key) => String(commands?.[key] ?? '').trim();
  // `envOf(key)`, when given, is that check's own environment (the remediation runner names a channel file unique to
  // each check); otherwise `env`, otherwise this process's.
  const optsOf = (key) => { const e = envOf?.(key) ?? env; return e ? { env: e } : {}; };
  // EVERY RESULT CARRIES ITS OUTCOME (check-outcomes.plan.md stage 2), read once here from its log's header, so the
  // barrier below and every caller decide from the same reading instead of each combining exit_code with header fields.
  const withOutcome = (result) => {
    const o = outcomeInLog(runDir, result.evidence_path);
    return { ...result, outcome: o.outcome, outcome_detail: o.detail,
      ...(o.timed_out ? { timed_out: true } : {}), ...(o.capture_error ? { capture_error: o.capture_error } : {}) };
  };
  // EACH CHECK'S OWN TIME (telemetry-records.plan.md stage 1b): checks.json had only the file's ran_at, so a report could
  // not say which check a slow pre-flight spent its minutes on. Measured around the capture process, so it includes
  // capture's own start-up, which is part of what the pre-flight costs.
  const timed = (startedMs, result) => ({ ...result, started_at: new Date(startedMs).toISOString(), duration_ms: Date.now() - startedMs });
  const runOne = (key) => {
    const startedMs = Date.now();
    const res = spawnSync('node', captureArgv({ runDir, nodeId, key, repoRoot, timeoutMinutes, inner: contractArgv(cmdOf(key), shell) }),
      { cwd: repoRoot, encoding: 'utf8', ...optsOf(key) });
    return withOutcome(timed(startedMs, shapeResult(cmdOf(key), res.status, res.stdout)));
  };
  // A pool built on spawnSync is not a pool (G-59): the concurrent path spawns without blocking. `r.stdout`, not
  // `r.out` (G-38): capture reserves stdout for the evidence PATH, and shAsync's merged buffer is not one.
  const runOneAsync = async (key) => {
    const startedMs = Date.now();
    const r = await shAsync('node', captureArgv({ runDir, nodeId, key, repoRoot, timeoutMinutes, inner: contractArgv(cmdOf(key), shell) }),
      { cwd: repoRoot, ...optsOf(key) });
    return withOutcome(timed(startedMs, shapeResult(cmdOf(key), r.status, r.stdout)));
  };

  const ran = new Map();
  const declared = keys.filter((k) => cmdOf(k));
  const barriers = declared.filter((k) => barrierKeys.has(k));
  const evidence = declared.filter((k) => !barrierKeys.has(k));
  let barrierBroke = false;
  for (const key of barriers) {
    onProgress(`${label}: ${key} (barrier) ...\n`);
    const r = runOne(key);
    ran.set(key, r);
    if (r.outcome !== 'passed') { barrierBroke = true; break; }
  }
  if (!barrierBroke) {
    if (concurrency > 1 && evidence.length > 1) {
      onProgress(`${label}: ${evidence.length} evidence check(s), concurrency ${concurrency} (review.checks_concurrency)\n`);
      await runPool(evidence, async (key) => {
        const r = await runOneAsync(key);
        ran.set(key, r);
        // Printed on COMPLETION, naming the check: under concurrency "... started" says nothing about which is slow.
        onProgress(`${label}: ${key} (evidence) done, exit ${r.exit_code}\n`);
      }, concurrency);
    } else {
      for (const key of evidence) {
        onProgress(`${label}: ${key} (evidence) ...\n`);
        ran.set(key, runOne(key));
      }
    }
  }
  return { ran, barrierBroke };
}

// A check's log, below the run, through the owner (run-dir-reads.plan.md stage 3): a link at any level is refused, and
// each caller's catch reads a refusal as it read an unreadable log.
const readLog = (runDir, logPath) => confined(runDir).read(String(logPath).split(/[\\/]/).filter((s) => s && s !== '.'));

/** Tests the log reports, or null when no known format was recognised or the log cannot be read. */
export function countTestsInLog(runDir, logPath) {
  try { return countTestsIn(readLog(runDir, logPath)); } catch { return null; }
}

/** Failing tests the log reports, or null (stage 4: the runner reads failures, not only the exit code). */
export function countFailuresInLog(runDir, logPath) {
  try { return countFailuresIn(readLog(runDir, logPath)); } catch { return null; }
}

/** The failing tests the log names (lib/full-check.mjs's reader), or [] when it cannot be read. */
export function failingNamesInLog(runDir, logPath) {
  try { return failingTestNames(readLog(runDir, logPath)); } catch { return []; }
}

/**
 * The three readings above from ONE read of the log (G-8 of 20261102-044855-rrp-remediation-2-review: a full check read
 * its test log once per reading, again on every repair pass's check): { tests, failing, failing_names }, each as its
 * reader above returns it when the log cannot be read or the reading fails.
 */
export function logCountsInLog(runDir, logPath) {
  let text;
  try { text = readLog(runDir, logPath); } catch { return { tests: null, failing: null, failing_names: [] }; }
  const or = (f, d) => { try { return f(text); } catch { return d; } };
  return { tests: or(countTestsIn, null), failing: or(countFailuresIn, null), failing_names: or(failingTestNames, []) };
}

/** The failing tests the log names, each with its file or null (lib's failingTestsWithFiles), or [] when it cannot be read. */
export function failingTestsInLog(runDir, logPath) {
  try { return failingTestsWithFiles(readLog(runDir, logPath)); } catch { return []; }
}

/**
 * WHAT THIS CHECK'S RESULT MEANS (check-outcomes.plan.md stage 2): lib/capture-header's checkOutcome over the log's
 * HEADER only — everything after its rule is the command's own output, which must not be able to claim a timeout or a
 * signal by printing the marker itself (G-48; G-2 of 20261013-220031-rv-delivery). Returns { outcome, detail, timed_out,
 * capture_error, signal }, the last three the header's own facts, kept on the records beside the outcome. No log path, or
 * a log that cannot be read or carries no header — capture refused before it spawned anything, and its exit 2 is its own
 * (plan-review round 3) — is `could-not-start`. This replaces the two readers that each returned one header field and left
 * every caller to combine them.
 */
export function outcomeInLog(runDir, logPath) {
  let header = null;
  if (logPath) { try { header = parseCaptureHeader(readLog(runDir, logPath)); } catch { header = null; } }
  const { outcome, detail } = checkOutcome(header);
  return {
    outcome, detail, timed_out: header?.timed_out ?? false, capture_error: header?.error ?? null, signal: header?.signal ?? null,
    ...(logPath && !header ? { detail: `capture wrote no readable log at ${logPath}` } : {}),
    ...(!logPath ? { detail: 'capture wrote no log' } : {}),
  };
}
