// THE CAPTURE LOG'S HEADER, ONE OWNER (G-2 of 20261013-220031-rv-delivery). capture.mjs writes a header of `$ ` and
// `# field: value` lines closed by a rule of 72 dashes; everything after the rule is the command's own output. The
// evidence gate (io/capture-facts.mjs) and the timeout reader (io/declared-checks.mjs) each parsed it on their own and
// already disagreed — one fell back to the first 512 bytes when no rule closed a header, letting output claim a
// timeout. Both read it here now, and capture writes it from here.
//
// Pure (ARCHITECTURE §2).

export const HEADER_RULE = '-'.repeat(72);

/**
 * A value as it may appear on a header line: every control character, and the Unicode line and paragraph separators,
 * written as a `\uXXXX` escape. The header is line-oriented, so a raw line break in a value a node chose (an argument, a
 * file name) would start a line of its own and could forge `# exit:` ahead of the real one (G-1's mechanism).
 */
export function headerValue(v) {
  return String(v).replace(HEADER_UNSAFE_ALL, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Whether a value carries a character headerValue must escape: test-one.mjs refuses such a file name (G-9 of
 *  20261013-233901-rv-delivery-remediation-review — it held its own copy of this class). */
export function hasHeaderUnsafe(v) {
  return HEADER_UNSAFE.test(String(v));
}
const HEADER_UNSAFE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const HEADER_UNSAFE_ALL = new RegExp(HEADER_UNSAFE.source, 'gu');

/**
 * The header of a capture log (the text before its rule), or null when no rule closes one: then it is not a capture.
 * The rule is a LINE of its own (G-5 of 20261013-233901-rv-delivery-remediation-review): headerValue does not escape
 * dashes, so 72 of them inside an argument or a cwd ended the header inside the `$ ` line and lost every fact after it.
 */
export function captureHeaderOf(text) {
  const m = new RegExp(`^${HEADER_RULE}\\r?$`, 'm').exec(String(text));
  return m === null ? null : String(text).slice(0, m.index);
}

/**
 * `{ admitted, file, exit, timed_out, error, captured }` from a capture log's header, or null when it is not a capture.
 * `error`, present only when the command did not run to completion for a reason other than capture's own deadline: its
 * code (ENOENT, ENOBUFS).
 */
/**
 * THE NODE'S ELAPSED TIME, for a capture's header (remediation-consumer-findings.plan.md stage 3, AC3): from the start and
 * cap spawn-node gives every node (QUORATE_NODE_STARTED_AT, QUORATE_NODE_TIMEOUT_MINUTES), to one decimal. A capture run
 * outside a node says so, so the line is in every header.
 */
export function elapsedLine(env = {}, nowMs) {
  const start = Date.parse(env.QUORATE_NODE_STARTED_AT ?? '');
  const cap = Number(env.QUORATE_NODE_TIMEOUT_MINUTES);
  if (!Number.isFinite(start) || !Number.isFinite(cap) || cap <= 0) return '# elapsed: unknown (not inside a node)';
  const minutes = Math.max(0, Math.round((nowMs - start) / 6000) / 10);
  return `# elapsed: ${minutes} of ${cap} minute(s)`;
}

export function parseCaptureHeader(text) {
  const header = captureHeaderOf(text);
  if (header === null) return null;
  const admitted = /^# admitted: (\S+)(?: (.+))?$/m.exec(header);
  const exit = /^# exit: (-?\d+)(?: \(signal (\S+)\))?/m.exec(header);
  const error = /^# error: (.+)$/m.exec(header);
  const captured = /^# captured: (\S+)$/m.exec(header);
  const elapsed = /^# elapsed: (\d+(?:\.\d+)?) of (\d+(?:\.\d+)?) minute\(s\)\r?$/m.exec(header);
  return {
    admitted: admitted ? admitted[1] : null,
    file: admitted && admitted[1] === 'test_one' ? admitted[2] ?? null : null,
    exit: exit ? Number(exit[1]) : null,
    timed_out: /^# timed-out:/m.test(header),
    ...(error ? { error: error[1].replace(/\r$/, '') } : {}),
    // Written on the exit line since 7ce8f773 (check-outcomes.plan.md stage 1): a command a signal stopped.
    ...(exit?.[2] ? { signal: exit[2] } : {}),
    captured: captured ? captured[1] : null,
    // Since remediation-consumer-findings stage 3, and only when the header carries it: an older header, or one written
    // outside a node, has no `elapsed`, as it has no `error` or `signal`.
    ...(elapsed ? { elapsed: { minutes: Number(elapsed[1]), cap: Number(elapsed[2]) } } : {}),
  };
}

/**
 * WHAT A CAPTURED CHECK'S RESULT MEANS, DECIDED ONCE (check-outcomes.design.md D1, amended; plan stage 1). capture.mjs
 * writes exit 124 for every way a command ends without an exit of its own, and each reader worked out on its own whether
 * the 124 was real; three remediation rounds each taught one reader one more case. `header` is parseCaptureHeader's
 * result (null when the text is no capture). Returns { outcome, detail }, outcome exactly one of:
 *   passed          exit 0;
 *   failed          the command's own non-zero exit — a bare 124 included: since ded43cb0 capture writes `# timed-out:`,
 *                   `# error:` or the signal for every null status (a log from an older capture.mjs, with no `# error:`
 *                   line, reads a spawn error as failed: the stated limit);
 *   timed-out       capture's own deadline, which outranks the signal capture itself sent;
 *   incomplete      it started and did not finish: a signal, or an output overflow (ENOBUFS), so its output may count;
 *   could-not-start any other spawn error, no exit, or no capture header at all.
 */
export function checkOutcome(header) {
  if (!header) return { outcome: 'could-not-start', detail: 'no capture header: capture wrote no log, or not one of its own' };
  if (header.timed_out) return { outcome: 'timed-out', detail: 'killed by capture at its deadline' };
  if (header.error === 'ENOBUFS') return { outcome: 'incomplete', detail: 'ENOBUFS: the output overflowed the spawn buffer' };
  if (header.error) return { outcome: 'could-not-start', detail: header.error };
  if (header.signal) return { outcome: 'incomplete', detail: `stopped by ${header.signal}` };
  if (!Number.isInteger(header.exit)) return { outcome: 'could-not-start', detail: 'no exit recorded' };
  return header.exit === 0 ? { outcome: 'passed', detail: 'exit 0' } : { outcome: 'failed', detail: `exit ${header.exit}` };
}

/**
 * A RESULT RECORD'S OUTCOME (plan stage 1; plan-review round 6): `r.outcome` when it carries one, else derived from the
 * fields older records and hand-built results carry — `timed_out`, `capture_error`, `exit_code` — by the same rules. Such
 * a record carries no signal, so a signal-killed one reads as failed: read the log through checkOutcome where it exists.
 */
export function outcomeOfRecord(r) {
  if (r?.outcome) return r.outcome;
  if (r?.timed_out) return 'timed-out';
  if (r?.capture_error) return r.capture_error === 'ENOBUFS' ? 'incomplete' : 'could-not-start';
  if (!Number.isInteger(r?.exit_code)) return 'could-not-start';
  return r.exit_code === 0 ? 'passed' : 'failed';
}

/**
 * A CHECK'S STATUS FROM ITS OUTCOME, one rule for run-checks and the telemetry record (G-14 of
 * 20261025-215217-tel-remediation-2-review): passed is PASS, every other outcome FAIL.
 */
export const statusOfOutcome = (outcome) => (outcome === 'passed' ? 'PASS' : 'FAIL');

/** The outcomes that mean the command ran to its own end. */
export const DONE_OUTCOMES = Object.freeze(['passed', 'failed']);
