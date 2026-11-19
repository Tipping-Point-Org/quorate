// call-entry.mjs — ONE CALL'S ENTRY, built where the runtime is called (runtime-call-telemetry.plan.md stage 2; design CR-D4
// A: the caller puts it in the record it already writes). Pure: the call site passes what it observed, and the entry is the
// same shape for every runtime, so latency, tokens and success are measured once, at the adapter boundary.
import { usageFrom, familyOfCall, sumUsage } from './reviewers.mjs';

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * What a call's process came to, from what was observed, never from the exit code alone: a call stopped at its limit is
 * `timeout`; one ended by a signal, `stopped`; one whose answer the call site parsed, `answered`; one that answered nothing
 * usable, `no-answer`; one that printed nothing, `no-output`.
 */
export function callOutcome({ timedOut = false, signal = null, answered = null, stdout = '' } = {}) {
  if (timedOut) return 'timeout';
  if (signal) return 'stopped';
  if (answered === true) return 'answered';
  if (!String(stdout ?? '').trim()) return 'no-output';
  return 'no-answer';
}

/**
 * Whether the node runtime's envelope is an answer: it parses as an object and, by the adapter's `node_runtime.answer`
 * mapping, its error field is not true and its subtype field, when present, is one of `success_subtypes` (an error subtype
 * such as a turn limit is no answer; an envelope naming none is judged by its error field alone). WHICH FIELDS is the
 * adapter's (G-7 of 20261103-022403-rbr-remediation-8-review; ARCHITECTURE A-9), as its usage is; a runtime declaring no
 * mapping is judged by the parse alone, and one not given is refused rather than judged by one vendor's envelope.
 */
export function runtimeAnswered(stdout, runtime) {
  if (!runtime || typeof runtime !== 'object') throw new Error('runtimeAnswered: the runtime adapter is required; its node_runtime.answer names the envelope fields');
  const m = runtime.node_runtime?.answer ?? {};
  const field = (v) => (typeof v === 'string' && v ? v : null);
  const errorField = field(m.error_field);
  const subtypeField = field(m.subtype_field);
  const ok = Array.isArray(m.success_subtypes) ? m.success_subtypes : [];
  let e;
  try { e = JSON.parse(String(stdout ?? '')); } catch { return false; }
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  if (errorField && e[errorField] === true) return false;
  if (subtypeField && e[subtypeField] !== undefined && !ok.includes(e[subtypeField])) return false;
  return true;
}

const answerMap = (runtime, who) => {
  if (!runtime || typeof runtime !== 'object') throw new Error(`${who}: the runtime adapter is required; its node_runtime.answer names the envelope fields`);
  const m = runtime.node_runtime?.answer ?? {};
  const field = (v) => (typeof v === 'string' && v ? v : null);
  return { errorField: field(m.error_field), subtypeField: field(m.subtype_field) };
};

/**
 * Whether a parsed envelope REPORTS AN ERROR, by the adapter's `node_runtime.answer.error_field` (G-8 of
 * 20261103-040939-rbr-remediation-9-review): the code that acts on an envelope asks this, so it and runtimeAnswered read
 * one owner's field. A runtime declaring no error field reports none; one not given is refused.
 */
export function runtimeError(envelope, runtime) {
  const { errorField } = answerMap(runtime, 'runtimeError');
  if (!envelope || typeof envelope !== 'object' || !errorField) return false;
  return envelope[errorField] === true;
}

/** The envelope's subtype, by the adapter's `subtype_field`; null where the runtime declares none or the envelope has none. */
export function runtimeSubtype(envelope, runtime) {
  const { subtypeField } = answerMap(runtime, 'runtimeSubtype');
  if (!envelope || typeof envelope !== 'object' || !subtypeField) return null;
  return envelope[subtypeField] ?? null;
}

/**
 * The entry: start, end and duration as the call site measured them; the process's exit code and signal; whether it was
 * stopped at its limit, and the limit; the runtime's usage read through the adapter's declared mapping; the outcome; the
 * model and its family by the one rule (familyOfCall). A field the call did not give is null, never zero.
 */
export function callEntry({ reviewer, model = null, table = {}, startedMs, endedMs, exitCode = null, signal = null,
  timedOut = false, timeoutMinutes = null, stdout = '', answered = null } = {}) {
  const adapter = reviewer ? table?.[reviewer] : null;
  return {
    reviewer: reviewer ?? null, model: model ?? null,
    family: familyOfCall({ reviewer, model }, table),
    started_at: iso(startedMs), ended_at: iso(endedMs),
    duration_ms: Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs >= startedMs ? endedMs - startedMs : null,
    exit_code: num(exitCode), signal: signal ?? null, timed_out: timedOut === true, timeout_minutes: num(timeoutMinutes),
    usage: adapter ? usageFrom(adapter, stdout) : null,
    outcome: callOutcome({ timedOut, signal, answered, stdout }),
  };
}

/**
 * ONE ENTRY FOR A CALL MADE TWICE (G-7 of 20261110-230425-dps-remediation-6-review-b): its span runs from the first
 * attempt's start to the second's end, its usage is both attempts' sum, since telemetry reads the entry's usage first, its
 * limit is the whole call's, which the first attempt ran under (each attempt's own is in its entry), its other process facts
 * and outcome are the second's, and `attempts` keeps each attempt's own entry.
 */
export function retriedEntry(first, second) {
  const started = Date.parse(first?.started_at ?? '');
  const ended = Date.parse(second?.ended_at ?? '');
  return {
    ...second, started_at: first?.started_at ?? null, timeout_minutes: first?.timeout_minutes ?? null,
    duration_ms: Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? ended - started : null,
    usage: sumUsage(first?.usage, second?.usage), attempts: [first, second],
  };
}

/**
 * The entry with the caller's verdict on whether the call answered, where only the caller can tell (an external reviewer's
 * envelope is classified by the caller, from the wrapper's output). A call that timed out or was stopped stays so. Of a
 * retried call's attempts the verdict is about the last.
 */
export function markAnswered(call, answered) {
  if (!call || typeof call !== 'object') return null;
  if (call.outcome === 'timeout' || call.outcome === 'stopped') return call;
  const marked = { ...call, outcome: answered === true ? 'answered' : (call.outcome === 'answered' ? 'no-answer' : call.outcome) };
  if (Array.isArray(call.attempts) && call.attempts.length) marked.attempts = [...call.attempts.slice(0, -1), markAnswered(call.attempts.at(-1), answered)];
  return marked;
}
