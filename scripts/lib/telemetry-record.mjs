// telemetry-record.mjs — ONE RECORD PER FINISHED RUN, built from the run's own files (telemetry-records.plan.md stage 2).
// Pure: every input arrives parsed, so the same record comes from the same files, and the writers (stage 3) and the
// backfill share this one builder. What a record may carry is decided here and nowhere else: counts, ids, model and
// effort names, times, the runtime's usage projected to counts and vendor labels, statuses and verdicts — never model text (no claim,
// rationale, prompt or output). The set of tasks is the stage 1 inventory's, read from the artifacts it names, never a
// list kept here: every status passed in becomes a task.

import { statusOfOutcome } from './capture-header.mjs';
import { familyOfCall } from './reviewers.mjs';
import { redactionPatterns } from './secret-shapes.mjs';
import { errorLine } from './command-log.mjs';

export const RECORD_SCHEMA_VERSION = 1;

// The string fields a record may hold outside the runtime's own usage objects, which carry vendor labels (service tier,
// region), not model text. A test walks a built record against this set (stage 3: "no string field outside a fixed set").
export const RECORD_STRING_FIELDS = Object.freeze([
  'kind', 'run_id', 'version', 'commit', 'started_at', 'ended_at', 'id', 'task_kind', 'family', 'model', 'effort', 'state',
  'stop_reason', 'subtype', 'terminal_reason', 'outcome', 'signal', 'verdict', 'gate', 'stamps', 'cost_basis', 'reviewer',
  'api_error_status', 'error_kind', 'error',
  // A claim check's step journal (runtime-call-telemetry.plan.md stage 4): each step's name and the checker it is charged to.
  'step', 'task',
  // Where a run record's start was taken from (telemetry-run-time.plan.md stage 2): `run` or `mint`.
  'started_from',
  // A suite record's test file, repository-relative (stage 3).
  'file',
  // A decision record's agreement and the operator's sample mark (autonomous-run.plan.md stage 8; G-16 of
  // 20261105-021654-ar-d1-c-remediation-2-review: built from a decision's folder, and undeclared here).
  'agreement', 'sample',
]);

// The vendor labels the runtime's usage objects may carry as strings (seen in its envelopes: the service tier, region,
// the model a cost was priced as). Everything else kept from them is a number, a boolean or an object of those: an
// allowed-field projection, so a field a vendor adds tomorrow cannot carry text into a tracked record (G-9 of
// 20261025-203513-tel-delivery, which copied the objects whole).
export const USAGE_STRING_FIELDS = Object.freeze(['service_tier', 'inference_geo', 'type', 'speed', 'provider', 'canonicalModel', 'costBasis']);
// A label is a short token, not a sentence (G-12 of 20261025-211318-tel-remediation-review: a generic key such as `type`
// or `provider` let any string through), and the projection stops at a depth no runtime's usage reaches, so a nested
// object cannot exhaust the stack.
const USAGE_LABEL = /^[A-Za-z0-9_.:/-]{1,64}$/;
const USAGE_MAX_DEPTH = 8;
// A LABEL IS NEVER A SECRET SHAPE (G-10, G-12 of 20261025-232315-tel-remediation-4-review): a token such as a GitHub one
// is a short label too, so a value is tested against lib/secret-shapes.mjs's shapes as a key is. EVERY shape, the credential
// name-and-value ones included, with its own flags but the global one (G-15 of 20261025-235636-tel-remediation-5-review: a
// label may hold `:`, and keeping only the token shapes let a credential name with its value through).
const SECRET_PATTERNS = redactionPatterns().map(([re]) => new RegExp(re.source, re.flags.replace('g', '')));
const secretShaped = (s) => SECRET_PATTERNS.some((re) => re.test(s));
const isLabel = (v) => typeof v === 'string' && USAGE_LABEL.test(v) && !secretShaped(v);
function usageValue(k, x, depth) {
  // The depth limit holds for every value, a number or label included (G-10: a primitive returned before it).
  if (depth >= USAGE_MAX_DEPTH) return undefined;
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined;
  if (typeof x === 'boolean' || x === null) return x;
  if (typeof x === 'string') return USAGE_STRING_FIELDS.includes(k) && isLabel(x) ? x : undefined;
  // An array (the runtime's per-iteration usage) keeps its objects and numbers under the same rule, at its own key.
  if (Array.isArray(x)) return x.map((e) => usageValue(k, e, depth + 1)).filter((e) => e !== undefined);
  if (x && typeof x === 'object') return usageOf(x, depth + 1);
  return undefined;
}
// A KEY IS FILTERED AS A VALUE IS (G-14 of 20261025-222928-tel-remediation-3-review): the keys are the runtime's too, and
// copying them as given let text or a credential into a tracked record. A key is kept when it is a short label (a model
// name such as `name[1m]` included) and no secret shape lib/secret-shapes.mjs defines.
const USAGE_KEY = /^[A-Za-z0-9_.:/[\]-]{1,64}$/;
const usageKey = (k) => USAGE_KEY.test(k) && !secretShaped(k);
function usageOf(v, depth = 0) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (!usageKey(k)) continue;
    const y = usageValue(k, x, depth); if (y !== undefined) out[k] = y;
  }
  return out;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' && v ? v : null);
const bool = (v) => (typeof v === 'boolean' ? v : null);
// The runtime's result labels (stop reason, subtype, terminal reason, API error status) are the runtime's own text: kept
// only as a short label, as a usage label is, so an error message cannot reach a tracked record (G-13 of
// 20261025-215217-tel-remediation-2-review).
const label = (v) => (isLabel(v) ? v : null);
// A TASK'S ERROR, as its kind and its first line, redacted and cut, as the command log's after line keeps one
// (telemetry-records.plan.md; G-15 of 20261025-222928-tel-remediation-3-review, where a task had no field for either). The
// error is the status file's first validator error; its kind is the line's lead before any `:`, as a short label, cut
// from the REDACTED line (G-12 of 20261025-232315-tel-remediation-4-review). A validator error quotes the node's own
// envelope values (`got "..."`), which are model text, so every quoted value is dropped (G-17 of the same review).
const QUOTED = /"(?:[^"\\]|\\.)*"?/g;
function errorOf(validatorErrors) {
  const first = Array.isArray(validatorErrors) ? validatorErrors.find((e) => typeof e === 'string' && e.trim()) : null;
  return errorFields(first ? first.replace(QUOTED, '""') : null);
}
function errorFields(text, kindOf = null) {
  const line = errorLine(text);
  if (!line) return { error_kind: label(kindOf), error: null };
  const lead = line.split(':')[0].trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return { error_kind: label(kindOf ?? lead), error: line };
}
// A duration the record can compute from two times when the task gave none: measured, but by the engine's clock pair.
const spanMs = (a, b) => { const s = Date.parse(a), e = Date.parse(b); return Number.isFinite(s) && Number.isFinite(e) && e >= s ? e - s : null; };
const endOf = (start, ms) => { const s = Date.parse(start); return Number.isFinite(s) && ms !== null && ms >= 0 ? new Date(s + ms).toISOString() : null; };

// The family of a task nothing names: a node the roster does not know, or a runtime the caller could not give (I-6).
export const UNKNOWN_FAMILY = 'unknown';

/**
 * The family a task or finding belongs to, by THE ONE FAMILY RULE (runtime-call-telemetry.plan.md stage 1): its model's,
 * declared on the adapter that served it (familyOfCall, lib/reviewers.mjs), asked with the merged adapter table. The
 * reviewer is an arm's or judge's (by id), else a `source` the table knows (a lens finding's `source` is its model name,
 * not an adapter), else the node runtime for a node the engine runs (one the roster names, or one of its own kinds). The
 * runtime is the caller's, never a vendor name kept here (A-9). Anything unresolved is 'unknown', never guessed.
 */
export function familyOf({ id, source, model } = {}, roster = {}, defaultRuntime = null, table = {}) {
  const runtime = typeof defaultRuntime === 'string' && defaultRuntime ? defaultRuntime : null;
  const entries = [...(roster.panel_arms ?? []), ...(roster.adjudicators ?? [])];
  const byId = entries.find((x) => x.id === id);
  let reviewer = null; let m = model ?? null;
  if (byId) { reviewer = byId.reviewer ?? null; m = m ?? byId.model ?? null; }
  else if (source && table?.[source]) reviewer = source;
  else if ([...(roster.lenses ?? []), ...(roster.barrier_nodes ?? [])].some((x) => x.id === id)
    || (typeof id === 'string' && id && taskKindOf(id, roster) !== 'other')) reviewer = runtime;
  return (reviewer && familyOfCall({ reviewer, model: m }, table)) || UNKNOWN_FAMILY;
}

/** The kind of task a node id names, from the id's own convention (the roster names lenses and arms). */
export function taskKindOf(id, roster = {}) {
  if (/^check:/.test(id)) return 'check';
  if ((roster.panel_arms ?? []).some((a) => a.id === id)) return 'arm';
  if ((roster.lenses ?? []).some((l) => l.id === id)) return 'lens';
  if (/^adjudicate-/.test(id)) return 'adjudicator';
  if (/^reconcile-reask/.test(id)) return 'reask';
  if (/^(reconcile|intent-capture|second-opinion|remediation|request-capture|subagent)$/.test(id)) return id;
  if (/^claim-checker/.test(id)) return 'claim-checker';
  return 'other';
}

/**
 * One task's entry from its status file and, for a Claude node, the runtime's stdout envelope beside it. A field the
 * task did not give is null, never zero (absent is not free and not instant).
 */
export function taskEntry(id, status = {}, stdout = null, { roster = {}, defaultRuntime = null, table = {} } = {}) {
  const out = stdout ?? {};
  // THE CALL'S ENTRY FIRST (runtime-call-telemetry.plan.md stage 5): a task's process facts — times, duration, exit code,
  // signal, timeout and its limit, usage, family, outcome — are the entry its call site built (lib/call-entry.mjs); a status
  // from before the entries existed keeps giving them, read as stage 2 of telemetry-records read them.
  const c = status.call && typeof status.call === 'object' ? status.call : {};
  const has = (k) => c[k] !== undefined && c[k] !== null;
  const pick = (k, fallback) => (has(k) ? c[k] : fallback);
  const model = str(pick('model', status.model));
  return {
    id, task_kind: taskKindOf(id, roster),
    family: str(c.family) ?? familyOf({ id, source: status.source ?? null, model: status.model ?? null }, roster, defaultRuntime, table),
    model, effort: str(status.effort), state: str(status.state),
    started_at: str(pick('started_at', status.started_at)), ended_at: str(pick('ended_at', status.ended_at)),
    duration_ms: num(pick('duration_ms', status.duration_ms)) ?? spanMs(status.started_at, status.ended_at),
    duration_api_ms: num(out.duration_api_ms), ttft_ms: num(out.ttft_ms),
    usage: usageOf(pick('usage', status.usage ?? out.usage)),
    model_usage: usageOf(status.model_usage ?? out.modelUsage),
    cost_usd: num(status.total_cost_usd ?? out.total_cost_usd),
    exit_code: num(pick('exit_code', status.exit_code)), signal: str(pick('signal', status.signal)),
    timed_out: bool(pick('timed_out', status.timed_out)),
    killed_tree: bool(status.killed_tree), timeout_minutes: num(pick('timeout_minutes', status.timeout_minutes)),
    num_turns: num(status.num_turns ?? out.num_turns), stop_reason: label(status.stop_reason ?? out.stop_reason),
    subtype: label(status.subtype ?? out.subtype), terminal_reason: label(out.terminal_reason), is_error: bool(out.is_error),
    api_error_status: label(typeof out.api_error_status === 'number' ? String(out.api_error_status) : out.api_error_status),
    permission_denials: num(status.permission_denials_count) ?? (Array.isArray(out.permission_denials) ? out.permission_denials.length : null),
    reviewer_answered: bool(status.reviewer_answered),
    findings: num(status.findings_count), rejected_findings: num(status.rejected_findings_count),
    verdict: str(status.verdict),
    ...errorOf(status.validator_errors),
    // The call's outcome as its call site observed it (answered, no-answer, no-output, timeout, stopped); a check's outcome
    // (checkEntry); null where neither exists, so the shape below is every task's (G-16).
    outcome: label(c.outcome) ?? null,
    // How long the task waited for a pool slot (telemetry-run-time.plan.md stage 2): buildRunRecord sets it from the run's
    // queue.json; null for a task no pool held.
    queued_ms: null,
  };
}

// EVERY TASK HAS ONE SHAPE (G-10 of 20261025-203513-tel-delivery): a field a kind of task cannot give is null, never
// left out, so a reader cannot tell a missing property from an unknown value. The shape is taskEntry's.
const TASK_FIELDS = Object.freeze(Object.keys(taskEntry('', {})));
const wholeTask = (t) => ({ ...Object.fromEntries(TASK_FIELDS.map((k) => [k, null])), ...t });

/** A pre-flight check's entry, from one row of checks.json's results (or a full check's result). */
export function checkEntry(key, row = {}) {
  return wholeTask({
    // A check runs on no model, so no family can be determined: `unknown`, never null (G-16 of
    // 20261025-222928-tel-remediation-3-review; shared/telemetry.md).
    id: `check:${key}`, task_kind: 'check', family: UNKNOWN_FAMILY, model: null, effort: null,
    // A remediation's full checks and formatter baseline record an outcome and no status (G-16 of
    // 20261025-203513-tel-delivery): their state is run-checks.mjs's rule over that outcome, its one owner statusOfOutcome.
    state: str(row.status) ?? (str(row.outcome) ? statusOfOutcome(row.outcome) : null), outcome: str(row.outcome), exit_code: num(row.exit_code), timed_out: bool(row.timed_out),
    started_at: str(row.started_at), duration_ms: num(row.duration_ms),
    // ITS END, FROM ITS START AND DURATION (G-4 of 20261027-071443-trt-delivery): a check row records no end, and a task
    // with no end is untimed, so every pre-flight phase had no span and a full check never reached the run's end.
    ended_at: str(row.ended_at) ?? endOf(str(row.started_at), num(row.duration_ms)),
    // Why a check did not run to completion: its capture error as the kind, its outcome detail as the line (G-14 of
    // 20261025-232315-tel-remediation-4-review, where both were dropped).
    ...errorFields(str(row.outcome_detail), str(row.capture_error)),
  });
}

/**
 * Per family: groups raised (a group holding a finding of that family), confirmed (the reconciler decided `confirmed`),
 * and corroborated by the other family — one rule: a confirmed group that holds a finding of each family. The
 * reconciler's decision is the authority; proximity alone is "not a corroboration claim" (prompts/reconcile/PROMPT.md).
 */
export function groupCounts(groups = [], decisions = [], { roster = {}, defaultRuntime = null, table = {} } = {}) {
  const decided = new Map(decisions.map((d) => [d.group_id, d.decision]));
  const per = {};
  const bump = (fam, k) => { per[fam] ??= { raised: 0, confirmed: 0, corroborated: 0 }; per[fam][k] += 1; };
  for (const g of groups) {
    const fams = new Set((g.findings ?? []).map((f) => familyOf({ id: f.node_id, source: f.source, model: f.model }, roster, defaultRuntime, table)));
    const confirmed = decided.get(g.group_id) === 'confirmed';
    // UNKNOWN IS NO FAMILY (G-15 of 20261025-215217-tel-remediation-2-review): a finding nothing classifies cannot be the
    // other family, so only two known families corroborate, and an unknown finding corroborates nothing.
    const known = [...fams].filter((f) => f !== UNKNOWN_FAMILY).length;
    for (const fam of fams) {
      bump(fam, 'raised');
      if (confirmed) bump(fam, 'confirmed');
      if (confirmed && fam !== UNKNOWN_FAMILY && known > 1) bump(fam, 'corroborated');
    }
  }
  return { per_family: per, groups: groups.length, decided: decisions.length };
}

/** Whether a task ran: a SKIPPED one did not (shared/telemetry.md). The one rule, the record's end and the report's figures
 *  both read it (G-2 of 20261027-083759-trt-remediation-review: each defined its own). */
export const taskRan = (t) => t?.state !== 'SKIPPED';

/**
 * A write that exists only for telemetry, done best-effort: telemetry is a note, never a failed run (shared/telemetry.md).
 * Runs `write`; a throw is handed to `note` as its code (or message) and never rethrown. Returns whether the write was done.
 * The one guard every such write in run-graph and remediate goes through (G-6, G-9 of
 * 20261027-094343-trt-remediation-2-review: each had its own try/catch, and queue.json had none).
 */
export function bestEffort(write, note) {
  try {
    write();
    return true;
  } catch (e) {
    note(e?.code ?? e?.message ?? String(e));
    return false;
  }
}

/**
 * The record of a review or remediation run. `statuses` maps a node id to its status file, `stdouts` a node id to its
 * runtime envelope; `selfReview` is whether the engine reviewed its own repository (its self-location), which labels the
 * data as the tool's development data (criterion 9).
 */
export function buildRunRecord({
  kind, run = {}, checks = null, statuses = {}, stdouts = {}, groups = [], decisions = [], gate = null, roster = {},
  fullChecks = [], fmtBaseline = null, selfReview = false, defaultRuntime = null, table = {}, queue = {},
} = {}) {
  const opts = { roster, defaultRuntime, table };
  const tasks = Object.entries(statuses).map(([id, s]) => {
    const t = taskEntry(id, s, stdouts[id] ?? null, opts);
    // QUEUE WAIT (stage 2): from the moment run-graph's pool held the node ready to its own start.
    return { ...t, queued_ms: spanMs(queue?.[id], t.started_at) };
  });
  for (const row of checks?.results ?? []) if (row.check) tasks.push(checkEntry(row.check, row));
  // A remediation's formatter baseline, run before the node (run.json fmt_baseline; G-12 of 20261025-203513-tel-delivery).
  for (const [key, row] of Object.entries(fmtBaseline ?? {})) if (row) tasks.push({ ...checkEntry(key, row), id: `fmt-baseline:${key}` });
  // A remediation runner's checks of its candidate, one set per attempt (run.json full_checks[]).
  fullChecks.forEach((fc, i) => {
    for (const [key, row] of Object.entries(fc?.results ?? {})) tasks.push({ ...checkEntry(key, row), id: `full-check-${i + 1}:${key}` });
  });
  // A SKIPPED task is not a run (shared/telemetry.md): its stub's times never set the run's end (G-15 of
  // 20261027-071443-trt-delivery).
  const ends = tasks.filter(taskRan).map((t) => t.ended_at).filter(Boolean).sort();
  // THE RUN'S OWN START, NOT ITS MINT (stage 2): a run minted and run later counted the idle wait between the two commands
  // (166 of 349 reviews over five minutes, the worst 1,896 of 1,910). run-graph records `graph_started_at`; a run from
  // before it falls back to the mint's `created_at`, and says so.
  const graphStart = str(run.graph_started_at);
  const mintStart = str(run.mint_started_at);
  const mintEnd = str(run.mint_ended_at);
  return {
    schema_version: RECORD_SCHEMA_VERSION, kind, run_id: str(run.run_id),
    framework: { version: str(run.framework?.version), commit: str(run.framework?.commit), dirty: bool(run.framework?.dirty) },
    development_data: selfReview === true,
    // ITS END, AS ITS WRITER RECORDED IT (G-5 of 20261027-071443-trt-delivery): the gate, the commits and the archive come
    // after the last task, so the last task's end understated every run. A run from before `graph_ended_at` keeps it.
    started_at: graphStart ?? str(run.created_at), ended_at: [ends.at(-1), str(run.graph_ended_at)].filter(Boolean).sort().at(-1) ?? null,
    started_from: graphStart ? 'run' : (run.created_at ? 'mint' : null),
    // The mint is its own command, so its own figure, never part of the run's window.
    mint: mintStart || mintEnd ? { started_at: mintStart, ended_at: mintEnd, duration_ms: spanMs(mintStart, mintEnd) } : null,
    tasks,
    findings: groupCounts(groups, decisions, opts),
    gate: gate ? { gate: str(gate.gate), stamps: Array.isArray(gate.stamps) ? gate.stamps.filter((s) => typeof s === 'string') : [] } : null,
  };
}

/**
 * The record of a claim check: its checker as a task (the other family's, from check.json's `arm` entry and arm.json; or
 * the same family's, from its spawn-subagent envelope), and the claims counted by what the rules step made of them.
 * `check.failed_task` names the task of a check that failed after a checker ran (G-2 of
 * 20261025-232315-tel-remediation-4-review): that task, and only it, is FAILED, so a same-family failure never blames the
 * arm that answered (G-16 of 20261025-235636-tel-remediation-5-review), and a same-family checker that failed is a task
 * whether or not it left an envelope (G-7). Null with a failed check is a step after both checkers answered.
 */
export function buildClaimCheckRecord({ checkId = null, check = {}, arm = null, sameFamily = null, checked = {}, roster = {},
  selfReview = false, defaultRuntime = null, table = {}, journal = [], sameFamilyCall = null, journalUnparsed = null } = {}) {
  const tasks = [];
  // THE STEP JOURNAL (runtime-call-telemetry.plan.md stage 4): a checker is FAILED when a step charged to it failed, and only
  // then. A check with no journal (written before it) falls back to check.json's failed_task.
  const steps = (Array.isArray(journal) ? journal : []).filter((e) => e && typeof e.step === 'string' && e.step !== 'start' && e.step !== 'end');
  const failedTasks = new Set(steps.filter((e) => e.outcome === 'failed' && typeof e.task === 'string').map((e) => e.task));
  const failedState = (id) => ((steps.length ? failedTasks.has(id) : check.failed_task === id) ? 'FAILED' : null);
  const journalArm = steps.find((e) => e.step === 'arm-call' && e.arm && typeof e.arm === 'object')?.arm ?? null;
  const armFacts = check.arm ?? journalArm;
  if (armFacts) {
    const a = armFacts;
    // The vendor call's entry first (runtime-call-telemetry.plan.md stage 5): measured at the vendor process, so its exit
    // code is the vendor's; the wrapper's facts for a check from before the entries existed.
    const c = a.call && typeof a.call === 'object' ? a.call : {};
    tasks.push(wholeTask({
      id: 'claim-checker', task_kind: 'claim-checker',
      family: str(c.family) ?? familyOf({ source: a.reviewer, model: a.model }, roster, defaultRuntime, table),
      model: str(a.model), effort: str(a.effort), state: failedState('claim-checker'),
      started_at: str(c.started_at ?? a.started_at), ended_at: str(c.ended_at ?? a.ended_at),
      duration_ms: num(c.duration_ms) ?? num(arm?.duration_ms) ?? spanMs(a.started_at, a.ended_at),
      usage: usageOf(c.usage ?? arm?.usage), cost_usd: null, exit_code: num(c.exit_code ?? a.exit_code),
      signal: str(c.signal ?? a.signal), timed_out: bool(c.timed_out), timeout_minutes: num(c.timeout_minutes),
      outcome: label(c.outcome) ?? null,
    }));
  }
  const sameId = 'claim-checker-same-family';
  const sameRan = steps.some((e) => e.task === sameId);
  if (sameFamily || sameRan || check.failed_task === sameId) {
    // Its process facts from the entry its call wrote (design CR-D2 A), the runtime's envelope for the rest.
    tasks.push(taskEntry(sameId, { state: failedState(sameId), call: sameFamilyCall ?? null }, sameFamily, { roster, defaultRuntime, table }));
  }
  const s = checked.summary ?? {};
  const claims = Array.isArray(checked.claims) ? checked.claims : [];
  const byKind = {};
  for (const c of claims) if (typeof c.kind === 'string') byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  // THE CHECK'S OWN START AND END (telemetry-run-time.plan.md stage 2), from its journal's start and end entries.
  const entries = Array.isArray(journal) ? journal : [];
  return {
    schema_version: RECORD_SCHEMA_VERSION, kind: 'claim-check', run_id: str(checkId), development_data: selfReview === true,
    started_at: str(entries.find((e) => e?.step === 'start')?.at), ended_at: str(entries.find((e) => e?.step === 'end')?.at),
    family: str(check.family), tasks,
    // Every step that ran, in order, with its outcome; a failed one names its error as one redacted line.
    steps: steps.map((e) => ({ step: e.step, task: str(e.task), outcome: str(e.outcome), started_at: str(e.started_at),
      ended_at: str(e.ended_at), duration_ms: num(e.duration_ms), ...(e.error ? { error: str(e.error) } : {}) })),
    exit_code: num((Array.isArray(journal) ? journal : []).find((e) => e?.step === 'end')?.exit_code),
    claims: { total: claims.length, stands: num(s.stands), dissolved: num(s.dissolved), downgraded: num(s.downgrade),
      questions: num(s['ask-operator']), inferred: num(s.inferred), by_kind: byKind },
    // The journal lines that did not parse, so a torn journal is visible; null when not counted. Shaped here, the
    // record's one owner, not by the writer (G-6 of 20261105-013235-ar-d1-c-remediation-review).
    journal_unparsed_lines: num(journalUnparsed),
  };
}

/**
 * The record of one subagent spawn, on the node runtime the caller names (spawn-subagent.mjs: a plan-review round, the same-family claim checker). Its
 * process facts are the spawner's (`proc`: start, end, exit code, signal, timed out, the limit), the rest the runtime's
 * envelope; `label` is the --out directory's name, which names the round or the check.
 */
export function buildSubagentRecord({ envelope = null, proc = {}, pins = {}, call = null, label = null, roster = {}, selfReview = false,
  defaultRuntime = null, table = {} } = {}) {
  const status = { model: pins.model ?? null, effort: pins.effort ?? null, state: envelope ? (envelope.is_error ? 'ERROR' : 'OK') : 'NO-ENVELOPE',
    started_at: proc.started_at, ended_at: proc.ended_at, exit_code: proc.exit_code, signal: proc.signal,
    timed_out: proc.timed_out, timeout_minutes: proc.timeout_minutes, call };
  const task = taskEntry('subagent', status, envelope, { roster, defaultRuntime, table });
  // Without a call entry (a record from before stage 3): the runtime's own duration when it gave one.
  if (!call) task.duration_ms = num(envelope?.duration_ms) ?? task.duration_ms;
  // Its start and end are its one task's (stage 2), so the report can time it as a run.
  return { schema_version: RECORD_SCHEMA_VERSION, kind: 'subagent', run_id: str(label), development_data: selfReview === true,
    started_at: task.started_at, ended_at: task.ended_at, tasks: [task] };
}

/**
 * Whether a bench results file is marked `not_a_measurement` by the bench that wrote it, read by its marker and never by
 * its name (G-17/G-10 of 20261025-215217-tel-remediation-2-review). Such a file has no record, and one beside it is not read.
 * A pure decision, so it lives here (G-10 of 20261025-222928-tel-remediation-3-review); the I/O module re-exports it.
 */
export const notAMeasurement = (results) => results != null && typeof results === 'object' && results.not_a_measurement != null
  && results.not_a_measurement !== false;

/**
 * How many suite records are kept, the newest (G-8 of 20261105-013235-ar-d1-c-remediation-review): each suite run writes
 * one, and the report reads them all, so they are bounded by count (§6). Stated in shared/telemetry.md.
 */
export const SUITE_RECORDS_KEEP = 100;

/** The suite record names past the newest `keep`, oldest first: their names sort by start time. */
export const suiteRecordsPast = (names, keep = SUITE_RECORDS_KEEP) => {
  const sorted = names.filter((n) => /^suite-.*\.json$/i.test(n)).sort();
  return sorted.slice(0, Math.max(0, sorted.length - keep));
};

/**
 * The record of one run of the orchestration suite (telemetry-run-time.plan.md stage 3), from the entries
 * tests/tools/suite-file-reporter.mjs wrote: per test file its duration and counts. `file` arrives repository-relative,
 * or null for a file outside the repository, which is left out: no absolute path, no test name, no output.
 */
export function buildSuiteRecord({ entries = [], startedAt = null, endedAt = null, exitCode = null, unparsedLines = null } = {}) {
  const files = new Map();
  for (const e of entries) {
    if (!e || typeof e.file !== 'string' || !e.file) continue;
    const f = files.get(e.file) ?? { file: e.file, duration_ms: null, tests: null, failed: null, skipped: null };
    if (e.event === 'file') f.duration_ms = num(e.duration_ms);
    if (e.event === 'summary') { f.tests = num(e.counts?.tests); f.failed = num(e.counts?.failed); f.skipped = num(e.counts?.skipped); }
    files.set(e.file, f);
  }
  const list = [...files.values()].sort((a, b) => (b.duration_ms ?? -1) - (a.duration_ms ?? -1));
  const total = (k) => (list.some((f) => f[k] !== null) ? list.reduce((n, f) => n + (f[k] ?? 0), 0) : null);
  const start = str(startedAt);
  return {
    schema_version: RECORD_SCHEMA_VERSION, kind: 'suite', run_id: start ? `suite-${start.replace(/[-:.]/g, '')}` : null,
    // Written only in the engine's own checkout (tests/run-all.mjs), so always the tool's development data.
    development_data: true,
    started_at: start, ended_at: str(endedAt), exit_code: num(exitCode),
    tests: total('tests'), failed: total('failed'), files: list, tasks: [],
    // The reporter lines that did not parse; null when not counted (G-6 of 20261105-013235-ar-d1-c-remediation-review).
    unparsed_lines: num(unparsedLines),
  };
}

/**
 * The record of a bench run, from its results file: per seed and node a task with the node's usage, cost, turns and
 * duration as the bench recorded them; the summary's recall per lens kept as numbers.
 */
export function buildBenchRecord({ results = {}, label = null, selfReview = false } = {}) {
  const tasks = [];
  // The results file names no family for a node, so a bench task's is `unknown`, never null (G-18 of
  // 20261025-222928-tel-remediation-3-review, as checkEntry).
  const bench = (t) => wholeTask({ task_kind: 'bench-node', family: UNKNOWN_FAMILY, ...t });
  // A seed whose run was paid for and not scored (bench-lenses' unscored_spend) is a task too, marked so a reader does not
  // take it for a measurement (G-18 of 20261025-211318-tel-remediation-review, which dropped it).
  const runs = [...(results.runs ?? []).map((r) => [r, null]), ...(results.unscored_spend ?? []).map((r) => [r, 'UNSCORED'])];
  for (const [r, state] of runs) {
    // A node the bench recorded ANYWHERE is a task: one with no usage entry still ran and may have been paid for (G-13 of
    // 20261025-203513-tel-delivery, which read the usage map's keys alone).
    const nodes = new Set([r.usage, r.nodes, r.costs, r.duration_ms, r.turns].flatMap((m) => (m && typeof m === 'object' ? Object.keys(m) : [])));
    for (const node of nodes) {
      const pin = r.nodes?.[node] ?? {};
      tasks.push(bench({ id: `${r.seed}:${node}`, model: str(pin.model), effort: str(pin.effort), state,
        duration_ms: num(r.duration_ms?.[node]), num_turns: num(r.turns?.[node]), usage: usageOf(r.usage?.[node]), cost_usd: num(r.costs?.[node]) }));
    }
  }
  // bench-second-opinion's shape: one spend per seed, under seeds[].spent (what this pass spent, never what it inherited).
  for (const s of results.seeds ?? []) {
    const sp = s.spent ?? {};
    tasks.push(bench({ id: `${s.seed}:${str(sp.node) ?? 'second-opinion'}`,
      model: str(s.setting?.model), effort: str(s.setting?.effort), duration_ms: num(sp.duration_ms), num_turns: null,
      usage: usageOf(sp.usage), cost_usd: num(sp.second_opinion_usd) }));
    // The forge the pass ran for the seed, priced on its own (G-14 of 20261025-203513-tel-delivery). Only a priced forge is
    // a task: forge_usd is null both for a forge that was not run (reused with --forged) and for one the vendor did not price,
    // and the two cannot be told apart here.
    // A forge with a call entry (runtime-call-telemetry.plan.md stage 3) is a task by its entry, priced or not: the entry
    // says it ran. One without, from before the entries, is a task only when priced, as above.
    const fc = s.forge?.call && typeof s.forge.call === 'object' ? s.forge.call : null;
    if (fc) tasks.push({ ...bench(taskEntry(`${s.seed}:forge`, { call: fc }, null, {})), id: `${s.seed}:forge`, task_kind: 'bench-node',
      cost_usd: num(sp.forge_usd) ?? num(s.forge?.cost_usd) });
    else if (num(sp.forge_usd) !== null) tasks.push(bench({ id: `${s.seed}:forge`, cost_usd: num(sp.forge_usd) }));
    // The judge's two calls, by their entries.
    for (const which of ['mutated', 'control']) {
      const jc = s.judge_calls?.[which];
      if (jc && typeof jc === 'object') tasks.push({ ...bench(taskEntry(`${s.seed}:judge-${which}`, { call: jc }, null, {})), id: `${s.seed}:judge-${which}`, task_kind: 'bench-node' });
    }
  }
  const lenses = {};
  for (const [id, l] of Object.entries(results.summary?.lenses ?? {})) lenses[id] = { expected: num(l.expected), caught: num(l.caught), recall: num(l.recall) };
  return {
    schema_version: RECORD_SCHEMA_VERSION, kind: 'bench', run_id: str(label), development_data: selfReview === true,
    started_at: str(results.started_at), ended_at: str(results.finished_at), tasks,
    recall: { seeds: num(results.summary?.seeds), caught: num(results.summary?.caught),
      overall: num(results.summary?.overall_recall ?? results.summary?.recall), lenses },
    cost_usd: num(results.total_cost_usd),
  };
}

/**
 * THE RECORD OF ONE DECISION (autonomous-run.plan.md stage 8), built when the report reads `.claude/decisions/<id>/`
 * rather than written beside it, because two of its inputs arrive later: the operator's overrule and sample mark.
 * `first` is the talk's outcome.json and `revote` the revote's, as io/decision-run.mjs writes them; the revote, when one
 * ran, decides the outcome and the agreement, and its rounds add to the talk's. The id dates the record.
 */
export function buildDecisionRecord(id, { first, revote = null, overrule = null, sample = null, selfReview = false } = {}) {
  if (!first || typeof first !== 'object' || typeof first.outcome !== 'string') throw new Error(`decision ${id}: no outcome to build a record from`);
  const final = revote && typeof revote.outcome === 'string' ? revote : first;
  // An absent count is null, never a measured 0 (G-14 of 20261105-013235-ar-d1-c-remediation-review); a sum with an
  // absent part is unknown.
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const sum = (a, b) => (a === null || b === null ? null : a + b);
  return {
    schema_version: RECORD_SCHEMA_VERSION, kind: 'decision', run_id: str(id), development_data: selfReview === true,
    outcome: final.outcome, agreement: typeof final.agreement === 'string' ? final.agreement : 'none',
    rounds: sum(n(first.rounds), final === revote ? n(revote.rounds) : 0),
    moderator_rounds: sum(n(first.moderator_rounds), final === revote ? n(revote.moderator_rounds) : 0),
    revoted: final === revote, overruled: !!overrule, sample: typeof sample?.mark === 'string' ? sample.mark : null,
    tasks: [],
  };
}
