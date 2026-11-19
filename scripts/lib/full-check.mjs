// THE RUNNER'S FULL CHECK, DECIDED (remediation-verification.plan.md, stage 4). Pure: the remediation runner runs every
// declared check on the commit candidate through the one core (io/declared-checks.mjs) and this module says what the
// results mean for the commit. The class of each key lives here, and io/declared-checks.mjs re-exports it.

import { candidateEnvFor } from './decisions.mjs';
import { outcomeOfRecord, DONE_OUTCOMES } from './capture-header.mjs';

/**
 * Which failures refuse the commit (operator, 2026-10-13: "Build, test, lint, typecheck (Recommended)"). `audit`, `deny`
 * and `fmt_check` stamp, as they do in a review: an overnight advisory or a formatter difference does not block a fix.
 * Except a formatter the candidate turned red: `fmt_check` refuses when the runner's baseline, taken before the node ran,
 * passed (remediation-fmt-check-baseline.md, in fullCheckVerdict below).
 */
export const CHECK_KEY_CLASS = Object.freeze({
  build: 'refuses', test: 'refuses', lint: 'refuses', typecheck: 'refuses',
  audit: 'stamps', deny: 'stamps', fmt_check: 'stamps',
});

/**
 * What a fmt_check refusal's reason ends with when the formatter ran and failed after passing on the baseline, for the
 * operator reading it. Code reads the refusal's `turned_red` field instead (G-3 of 20261017-212703-fmt-remediation-2-review).
 */
export const FMT_TURNED_RED = 'it passed before the node ran';

/**
 * How many of a check's failing names a full check's record in run.json keeps (scripts/remediate.mjs writes it,
 * lib/repair-bench.mjs reads it): one owner, so writer and reader cannot drift (G-9 of 20261102-161123-rbr-delivery).
 */
export const RUN_JSON_FAILING_NAMES = 20;

/** How a not-done outcome reads to the operator in a reason. */
const OUTCOME_LABEL = Object.freeze({ 'timed-out': 'timed out', incomplete: 'stopped before it finished', 'could-not-start': 'could not start' });

/**
 * `declared`: the keys with a command, in order. `ran`: { key: { exit_code, outcome?, outcome_detail?, timed_out?,
 * capture_error?, tests, failing, failing_names, evidence_path } }; a declared key missing from it was not run (the build
 * barrier broke). A result's outcome is outcomeOfRecord's (lib/capture-header.mjs, check-outcomes.plan.md stage 1), so
 * a result built without `outcome` keeps today's meaning. `baseline`: the run's `fmt_baseline`, undefined when none was
 * recorded. `channels`, for `test`: the count file's number and the facts file's record, each null when the suite wrote
 * none, and `stale`, a sentence, when a channel file was already there before the check — then neither can be trusted.
 *
 * Returns { commit, refusals: [{key, why, turned_red?}], stamps: [{key, why}], unfinished: [{key, outcome, why}],
 * countUpdate: {tests, message} | null }. `unfinished` holds an fmt_check that did not run to its own end and does not
 * refuse: it is recorded, and stamps nothing, so FMT-DIRTY keeps one meaning — the formatter ran and failed (plan stage 2).
 * A non-zero test exit with no failing test commits only as a counted-facts drift ALONE (D4, "Gate on failing tests"):
 * the facts file says drifted with no other failed suite, and the count file shows at least the suite's floor.
 */
export function fullCheckVerdict({ declared = [], ran = {}, channels = {}, baseline = {} } = {}) {
  const refusals = [];
  const stamps = [];
  const unfinished = [];
  let countUpdate = null;
  for (const key of declared) {
    const cls = CHECK_KEY_CLASS[key];
    if (!cls) continue;
    const isFmt = key === 'fmt_check';
    // A FORMATTER THE CANDIDATE TURNED RED REFUSES (remediation-fmt-check-baseline.md; operator, 2026-10-17: "Refuse only
    // if the fix made it red (Recommended)"), read over outcomes (check-outcomes.plan.md stage 2's table): fmt_check refuses
    // when its baseline, taken before the node ran, `passed`; the format advice (`turned_red`) only when the candidate
    // `failed` — a candidate that did not run to its own end refuses without it.
    const base = baseline?.fmt_check;
    const baseOutcome = base ? outcomeOfRecord(base) : null;
    const baselinePassed = isFmt && baseOutcome === 'passed';
    // A baseline that did not pass, or none, stamps a failing candidate (design D3), and the stamp names which.
    const baselineGap = !isFmt || baselinePassed || baseOutcome === 'failed' ? ''
      : !baseline || !('fmt_check' in baseline) ? '; no baseline was recorded before the node ran, so whether the node caused it is unknown'
        : `; the baseline did not run to completion (${!base ? 'not run' : `${OUTCOME_LABEL[baseOutcome] ?? baseOutcome}${base.outcome_detail ? `: ${base.outcome_detail}` : ''}`}), so whether the node caused it is unknown`;
    const fail = (why, turnedRed = false) => (cls === 'refuses' || baselinePassed ? refusals : stamps)
      .push(turnedRed ? { key, why: `${why}; ${FMT_TURNED_RED}`, turned_red: true }
        : { key, why: cls === 'refuses' || baselinePassed ? why : `${why}${baselineGap}` });
    const r = ran[key];
    const where = r?.evidence_path ? ` (${r.evidence_path})` : '';
    if (!r) {
      // Never captured: the build barrier broke. An fmt_check that does not refuse is recorded, not stamped.
      if (isFmt && !baselinePassed) unfinished.push({ key, outcome: 'not-run', why: 'not run: the build barrier failed first' });
      else fail('not run: the build barrier failed first');
      continue;
    }
    const outcome = outcomeOfRecord(r);
    if (!DONE_OUTCOMES.includes(outcome)) {
      const why = `did not run to completion (${OUTCOME_LABEL[outcome]}${r.outcome_detail ? `: ${r.outcome_detail}` : ''})${where}`;
      if (isFmt && !baselinePassed) unfinished.push({ key, outcome, why });
      else fail(why);
      continue;
    }
    if (key !== 'test') {
      if (outcome === 'failed') fail(`exit ${r.exit_code}${where}`, baselinePassed);
      continue;
    }
    if (channels.stale) { fail(channels.stale); continue; }
    const tests = Number.isFinite(channels.count) ? channels.count : r.tests;
    // A suite that PASSED with no count this module can read commits, recorded uncounted, as a review's pre-flight
    // records TESTS-UNCOUNTED (G-5 of 20261013-220031-rv-delivery; operator: "Accept, record uncounted (Recommended)").
    // No readable count refuses only a non-zero exit, whose cause it leaves unknown.
    if (!Number.isFinite(tests)) {
      if (outcome === 'passed' && !(r.failing > 0)) stamps.push({ key, why: `exit 0 with no readable test count: recorded uncounted${where}` });
      else fail(`no readable test count${where}`);
      continue;
    }
    if (r.failing > 0) {
      // The reason names no more of them than run.json keeps, from that one owner (G-8 of
      // 20261102-184751-rbr-remediation-2-review: a second literal 20).
      const names = (r.failing_names ?? []).slice(0, RUN_JSON_FAILING_NAMES);
      fail(`${r.failing} failing test(s)${names.length ? `: ${names.join('; ')}` : ''}${where}`);
      continue;
    }
    if (outcome === 'passed') continue;
    if (r.failing == null) { fail(`exit ${r.exit_code}, and its failing count cannot be read${where}`); continue; }
    const f = channels.facts;
    const driftAlone = f && f.drifted === true && Array.isArray(f.failed_suites) && f.failed_suites.length === 0
      && Number.isFinite(channels.count) && Number.isFinite(f.min_tests) && channels.count >= f.min_tests;
    if (driftAlone) countUpdate = { tests: channels.count, message: String(f.message ?? '') };
    else {
      const cause = f?.failed_suites?.length ? `: ${f.failed_suites.join('; ')} failed` : f?.drifted ? '' : ' (a floor, a failing product suite, or another non-drift cause)';
      fail(`exit ${r.exit_code} with no failing test, and not a counted-facts drift alone${cause}${where}`);
    }
  }
  return { commit: refusals.length === 0, refusals, stamps, unfinished, countUpdate };
}

/**
 * The environment every check of the commit candidate runs in: the runner's own through the candidate checks' own policy
 * (candidateEnvFor, which owns what is dropped; G-1 of 20261014-000825-rv-delivery-remediation-2-review), plus `extra`
 * (the test check's channel files), at GRAPH_NODE_DEPTH 1 last, so nothing lowers it. The candidate holds code the
 * remediator wrote, and at depth 0 that code could start a graph run (G-13 of 20261013-220031-rv-delivery). The depth is
 * an environment variable that code can reset, so it is a stated residual, not a boundary. A suite that needs a dropped
 * name fails the candidate check visibly, until review.candidate_env declares it. `ctx` is the platform's process basics
 * and environment case rule plus the contract's declared names ({ basics, declared, caseInsensitiveEnv }), required.
 */
export function candidateCheckEnv(sourceEnv, extra = {}, ctx = {}) {
  return { ...candidateEnvFor(sourceEnv, ctx), ...extra, GRAPH_NODE_DEPTH: '1' };
}

/**
 * The failing tests a log names, every one: node:test's spec summary after `✖ failing tests:`, TAP `not ok N - name`,
 * and pytest's `FAILED path::name`. Empty when none is recognised: the count still refuses. Not cut here: the repair
 * brief lists every one (G-12 of 20261102-033648-rrp-remediation-review); the refusal and run.json cut their own copies.
 */
export function failingTestNames(logText) {
  const txt = String(logText ?? '').replace(/\x1b\[[0-9;]*m/g, '');
  const names = [];
  const at = txt.indexOf('✖ failing tests:');
  if (at !== -1) {
    for (const m of txt.slice(at + 1).matchAll(/^✖ (.+?)(?: \([\d.]+m?s\))?$/gm)) names.push(m[1]);
  }
  for (const m of txt.matchAll(/^not ok \d+ - (.+)$/gm)) names.push(m[1].replace(/\s+#.*$/, ''));
  for (const m of txt.matchAll(/^FAILED (\S+)/gm)) names.push(m[1]);
  return [...new Set(names)];
}

/**
 * The failing tests a log names, each with its file where the log says it (remediation-repair-pass.plan.md stage 1): the
 * names are failingTestNames's, so the refusal and the repair brief cannot disagree about which tests failed; node:test's
 * spec summary puts `test at <file>:<line>:<col>` on the line before each, and pytest's `FAILED path::name` carries it.
 * Every other name keeps `file: null`. Files in forward slashes, as git lists them.
 */
export function failingTestsWithFiles(logText) {
  const txt = String(logText ?? '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n');
  // One entry per name AND file (G-5 of 20261102-044855-rrp-remediation-2-review): two failing tests of one name in two
  // files are two tests the brief must hand back, where a dedup by name alone kept the first file's only.
  const filesOf = new Map();
  const at = txt.indexOf('✖ failing tests:');
  if (at !== -1) {
    for (const m of txt.slice(at).matchAll(/^test at (.+?):\d+:\d+\n✖ (.+?)(?: \([\d.]+m?s\))?$/gm)) {
      const file = m[1].split('\\').join('/');
      const fs = filesOf.get(m[2]) ?? [];
      if (!fs.includes(file)) fs.push(file);
      filesOf.set(m[2], fs);
    }
  }
  return failingTestNames(txt).flatMap((name) => {
    const files = filesOf.get(name);
    if (files) return files.map((file) => ({ name, file }));
    const py = /^([^:\s]+)::/.exec(name);
    return [{ name, file: py ? py[1].split('\\').join('/') : null }];
  });
}
