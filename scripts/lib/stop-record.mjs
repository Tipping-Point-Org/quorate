// What a turn end is, and what a log of turn ends adds up to (autonomous-run-pauses.plan.md stages 2 and 3).
//
// Pure: no I/O, no clock. The hook input is passed in, and so are the events already recorded. The session names a
// voluntary stop with a marker on the LAST line of its final message, `Stop: <reason>`, optionally followed by
// ` — <detail>`; a marker anywhere else is text, not a marker, so quoting one in prose never names a stop. The rules
// these markers serve are owned by shared/session-rules.md.

import { RESERVED_CATEGORIES } from './decision-panel.mjs';
import { resetTextOf } from './quota.mjs';
import { redactClaim } from './redact.mjs';

// The five reasons a session may stop for (autonomous-run-pauses.md criterion 1, and `limit`, added by
// autonomous-run.plan.md stage 7 part 2; operator, 2026-10-31: "1 a"), and `wait`, which is not a stop: the session's
// statement that a background task is running and no other approved task can start (criterion 2).
export const STOP_REASONS = Object.freeze(['done', 'question', 'reserved', 'error', 'limit']);
export const WAIT = 'wait';

// Exactly the forms shared/session-rules.md defines: one space after the colon, and ` — ` (an em dash between spaces)
// before a detail (G-7 of 20261024-224631-arp-remediation-review).
const MARKER = /^Stop: ([a-z]+)(?: — (.+))?$/;

// The marker of a final message, or null. Only the last non-empty line counts.
export function stopMarker(message) {
  const lines = String(message ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const m = lines.length ? MARKER.exec(lines[lines.length - 1]) : null;
  if (!m) return null;
  const reason = m[1];
  if (reason !== WAIT && !STOP_REASONS.includes(reason)) return null;
  const detail = m[2]?.trim() || null;
  // `error`, `limit` and `wait` name their <what> (criteria 1 and 2); without it the line names nothing (G-7 of
  // 20261024-220920-arp-delivery).
  if (!detail && NEEDS_DETAIL.includes(reason)) return null;
  return { reason, detail };
}
const NEEDS_DETAIL = Object.freeze(['error', 'limit', WAIT]);

// How many lines of a message are shaped as a marker of a known reason. More than one is ambiguous, and the guard
// blocks it once so the session picks one (operator, 2026-10-25, on G-8 of 20261024-220920-arp-delivery: "B"; G-12 of
// 20261025-021243-arp-remediation-3c-review: a confident kind from the last of two markers).
export function markerLineCount(message) {
  return String(message ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => {
    const m = MARKER.exec(l);
    return m && (m[1] === WAIT || STOP_REASONS.includes(m[1]));
  }).length;
}

// A stop that waits for the operator asks a concrete question with its options (criterion 3): a question mark, and at
// least two option lines (`A.`, `- **B.**`, `1)`, or a plain `- ` bullet, since nothing requires a label: G-9 of
// 20261024-224631-arp-remediation-review). The shape only; whether the options are good is not checkable. Only lines
// after the first question count (G-12 of 20261024-235344-arp-remediation-2-review): two status bullets above a bare
// question had passed as its options.
const OPTION_LINE = /^\s*(?:[-*]\s+\S|(?:\*\*)?(?:[A-Z]|\d{1,2})[.)](?:\*\*)?\s+\S)/;
export function asksWithOptions(message) {
  const lines = String(message ?? '').split(/\r?\n/);
  // The question is the first line that ENDS in a question mark, markdown emphasis and closing quotes aside
  // (session-record-files.plan.md stage 5): a quoted "?" earlier in the message is not the question.
  const asked = lines.findIndex((l) => /\?[*_`"')\]]*\s*$/.test(l));
  if (asked < 0) return false;
  return lines.slice(asked + 1).filter((l) => OPTION_LINE.test(l)).length >= 2;
}

const running = (tasks) => (Array.isArray(tasks) ? tasks.filter((t) => t && t.status === 'running') : []);

// What a turn start records (G-12 of 20261024-224631-arp-remediation-review): every line carries the plan's kind, named
// reason and background task count, a start's reason null since a start names none.
// Both lines carry the decision panel's state when the caller knows it, so an ending found by this start is filed under
// it (G-12 of 20261105-013235-ar-d1-c-remediation-review).
export function turnStartEvents(input, { at, open, panel = null }) {
  const session = input?.session_id ?? null;
  const count = running(input?.background_tasks).length;
  const p = panel === 'on' || panel === 'off' ? { panel } : {};
  const start = { at, event: 'start', kind: 'start', reason: null, running: count, source: turnStartSource(input?.prompt), session, ...p };
  return open ? [{ at, event: 'involuntary', kind: 'involuntary', reason: null, running: count, cause: INVOLUNTARY_CAUSE, session, ...p }, start] : [start];
}

// What a turn end is, from the Stop hook's input.
//   named            a stop with one of the five reasons
//   declared-wait    `Stop: wait` with a background task running
//   undeclared-wait  no marker, a background task running
//   unnamed          no marker and nothing running, or `Stop: wait` with nothing to wait on
export function classifyTurnEnd(input) {
  const marker = stopMarker(input?.last_assistant_message);
  const tasks = running(input?.background_tasks);
  if (markerLineCount(input?.last_assistant_message) > 1) return { kind: 'two-markers', reason: null, detail: null, running: tasks.length };
  if (marker && marker.reason !== WAIT) return { kind: 'named', reason: marker.reason, detail: marker.detail, running: tasks.length };
  if (marker && tasks.length) return { kind: 'declared-wait', reason: WAIT, detail: marker.detail, running: tasks.length };
  if (tasks.length) return { kind: 'undeclared-wait', reason: null, detail: null, running: tasks.length };
  return { kind: 'unnamed', reason: null, detail: marker ? 'wait declared with nothing running' : null, running: 0 };
}

// What the guard does with a turn end. It blocks at most once per stop: with `stop_hook_active` true it allows the stop
// and records the miss as `<kind>-after-block`, so no loop forms and the miss is counted rather than hidden.
// A graph node (GRAPH_NODE_DEPTH of 1 or more: spawn-node.mjs, spawn-subagent.mjs) is not a working session: it ends when
// its contract says, with its envelope, not a stop marker. The project's hooks reach it too, and the guard had blocked
// every node's final stop once (2026-10-25: about twenty node sessions in this repository's record, one block each), so a
// node's stop is recorded as one and never blocked.
export function guardDecision(input, { rulesPath = 'shared/session-rules.md', nodeDepth = 0, decisionPanel = 'off' } = {}) {
  if (Number(nodeDepth) >= 1) return { block: false, record: { kind: 'node', reason: null, detail: null, running: running(input?.background_tasks).length, depth: Number(nodeDepth) } };
  const c = classifyTurnEnd(input);
  const again = input?.stop_hook_active === true;
  let why = null;
  let toPanel = false;
  if (c.kind === 'undeclared-wait') {
    why = `A background task is running and the turn is ending unnamed. Start another task inside approved work if one can start; otherwise end with a last line \`Stop: wait — <what you wait on>\` (${rulesPath}).`;
  } else if (c.kind === 'unnamed') {
    why = `This turn is ending without a named reason. Continue the work, or end with a last line \`Stop: <done|question|reserved>\`, \`Stop: error — <what>\` or \`Stop: limit — <what>\` (${rulesPath}).`;
  } else if (c.kind === 'two-markers') {
    why = `This message has more than one stop marker. Keep exactly one, on its last line (${rulesPath}).`;
  } else if (c.kind === 'named' && (c.reason === 'question' || c.reason === 'reserved') && !asksWithOptions(input?.last_assistant_message)) {
    why = `A stop that waits for the operator asks a concrete question with its options and a suggestion (${rulesPath}). Rewrite the question that way, keeping the last line \`Stop: ${c.reason}\`.`;
  } else if (decisionPanel === 'on' && c.kind === 'named' && c.reason === 'question' && !forOperatorAnyway(input?.last_assistant_message)) {
    // autonomous-run.plan.md stage 6: with the panel on, a question with options is the panel's, not the operator's.
    why = `review.decision_panel is on: a question with options goes to the decision panel, not the operator. Write it to a question file and run \`node <framework-root>/scripts/decide.mjs --question <file>\`, then go on with its answer; stop for the operator only for a reserved category (named) or a decision the panel postponed (its id on the line) (${rulesPath}).`;
    toPanel = true;
  }
  const kindOf = (suffix) => (toPanel ? `to-panel-${suffix}` : c.kind === 'named' ? `no-options-${suffix}` : `${c.kind}-${suffix}`);
  // The detail is the session's own text and is recorded, so it is redacted by the one owner first, as a StopFailure
  // event's text is (G-6 of 20261106-013812-stoplog-g8-remediation-review: recorded verbatim). Best-effort (A-10).
  const rec = { ...c, detail: c.detail == null ? c.detail : redactClaim(c.detail) };
  if (!why) return { block: false, record: rec };
  if (again) return { block: false, record: { ...rec, kind: kindOf('after-block') } };
  return { block: true, reason: why, record: { ...rec, kind: kindOf('blocked') } };
}

// A decision record's id, as scripts/decide.mjs mints it (YYYYMMDD-HHMMSS-xxxxxx), standing alone in the text.
const DECISION_ID = /(?<![\w-])\d{8}-\d{6}-[0-9a-f]{6}(?![\w-])/;
const RESERVED_NAMED = new RegExp(`\`(?:${RESERVED_CATEGORIES.map((c) => c.replace(/[-]/g, '\\-')).join('|')})\``);

/**
 * WHETHER A QUESTION WITH OPTIONS MAY STILL GO TO THE OPERATOR with the panel on (stage 6): it names a decision the panel
 * postponed (its record id), or the reserved category that keeps it the operator's (in backticks, as the
 * reserved-decisions region writes it). Anything else is the panel's.
 */
export function forOperatorAnyway(message) {
  const m = String(message ?? '');
  return DECISION_ID.test(m) || RESERVED_NAMED.test(m);
}

// Who started a turn: the operator, or a background task's notification waking the session (stage 1's probe: a
// notification starts a turn and fires UserPromptSubmit like the operator's prompt does).
export function turnStartSource(prompt) {
  return /<task-notification>/.test(String(prompt ?? '')) ? 'notification' : 'operator';
}

// The cause recorded for an involuntary stop found at the next turn start: the turn ended without a Stop.
export const INVOLUNTARY_CAUSE = 'ended without a Stop';
// The cause a StopFailure hook records: the turn ended on an API error (autonomous-run.plan.md stage 7 part 2).
export const API_ERROR_CAUSE = 'api-error';

/**
 * A StopFailure hook's input as a stop-record event (operator, 2026-10-31: "2 a": Claude Code's own usage-limit wait is
 * kept, and each limit is RECORDED). The hook "runs instead of Stop when the turn ends due to an API error", with
 * `error`, `error_details` and `last_assistant_message` (stage 1's delivery notes, quoting the docs). It is an involuntary
 * turn end, so it closes the open turn and the next start does not count it again. The reset text is what the message
 * says, as written, or null: none is invented.
 */
export function stopFailureEvent(input, { at, panel = null }) {
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  // Redacted by the one owner before it is recorded (G-9 of 20261105-004603-ar-d1-c-review): an API error can quote a
  // credential. Best-effort, as that owner says (A-10). The reset time is read from the raw message first.
  const safe = (v) => (v === null ? null : redactClaim(v));
  const message = text(input?.last_assistant_message);
  return {
    at, event: 'involuntary', kind: 'involuntary', cause: API_ERROR_CAUSE,
    error: safe(text(input?.error)), error_details: safe(text(input?.error_details)),
    // Found in the raw message, then redacted like the rest (G-11 of 20261105-013235-ar-d1-c-remediation-review).
    reset_text: safe(resetTextOf(message)),
    message: safe(message), session: input?.session_id ?? null,
    // The decision panel's state, as every turn end carries it (G-20 of 20261105-004603-ar-d1-c-review).
    ...(panel === 'on' || panel === 'off' ? { panel } : {}),
  };
}

// Events are { at: ms, event: 'start'|'end'|'involuntary', session, ... }, in the order recorded. The record is per
// repository, so sessions running side by side interleave in it: every pairing is within one session (G-9 of
// 20261024-220920-arp-delivery). A start that follows a start of the same session with no end between them closes the
// earlier turn as involuntary (criterion 1: "recorded with its cause"); the guard writes that as an `involuntary` line
// when the start arrives, and a record without one is read the same way. `next` is the session's next turn start.
export function turns(events) {
  const out = [];
  const open = new Map();
  const ended = new Map();
  const involuntary = (t, at, cause, panel = null) => out.push({ ...t, end: null, kind: 'involuntary', cause: cause ?? INVOLUNTARY_CAUSE, at: at ?? null, panel });
  for (const e of events ?? []) {
    const s = e.session ?? null;
    if (e.event === 'involuntary') {
      // An orphan, its start not held, is a start-null turn, as an orphan end is (G-21 of 20261104-223634-ar-d1-review).
      involuntary(open.get(s) ?? { start: null, source: null, session: s }, e.at, e.cause, e.panel ?? null);
      open.delete(s);
    } else if (e.event === 'start') {
      if (open.has(s)) involuntary(open.get(s), e.at, undefined, e.panel ?? null);
      if (ended.has(s)) { ended.get(s).next = e.at; ended.delete(s); }
      open.set(s, { start: e.at, source: e.source ?? 'operator', session: s });
    } else if (e.event === 'end') {
      const t = { ...(open.get(s) ?? { start: null, source: null, session: s }), end: e.at, kind: e.kind, reason: e.reason ?? null, panel: e.panel ?? null, next: null };
      out.push(t);
      ended.set(s, t);
      open.delete(s);
    }
  }
  for (const t of open.values()) out.push({ ...t, end: null, kind: 'open' });
  return out;
}

// Whether a run of a session's newest events holds a turn event (a start, an end, an involuntary): the newest one decides
// whether a turn is open, so a read for hasOpenTurn may stop there (G-16 of 20261025-080709-srf-delivery).
export const holdsTurnEvent = (events) => (events ?? []).some((e) => e.event === 'start' || e.event === 'end' || e.event === 'involuntary');

// Whether a session has a turn open: a start with no end, which its next start records as involuntary.
export function hasOpenTurn(events, session) {
  const s = session ?? null;
  return turns(events).some((t) => t.kind === 'open' && t.session === s);
}

// Counts by kind and reason, and the summed gap from each turn end to the same session's next turn start: the time the
// session sat stopped or waiting. Every turn end counts, waits included; a wait is reported as a wait, never as a stop
// avoided.
export function summary(events) {
  const ts = turns(events);
  // Rows are kept in Maps and returned as own properties (G-5 of 20261106-043201-stoplog-g8-remediation-4-review): the
  // keys come from the record, and a plain object indexed with '__proto__' selected and mutated Object.prototype.
  const kinds = new Map();
  const rowOf = (m, key, make) => { if (!m.has(key)) m.set(key, make()); return m.get(key); };
  // A blocked attempt is counted by its kind, a gap of none since the turn goes on; an open turn is no kind of ending and
  // is counted apart (G-4 of 20261106-013812-stoplog-g8-remediation-review: turns() reads no 'blocked' event, so every
  // refused stop was missing from the summary, and still-open turns were a row of byKind).
  let blocked = 0;
  for (const e of events ?? []) {
    if (e?.event !== 'blocked') continue;
    blocked += 1;
    const key = e.reason ? `${e.kind}:${e.reason}` : (e.kind ?? 'blocked');
    rowOf(kinds, key, () => ({ count: 0, gapMs: 0 })).count += 1;
  }
  const open = ts.filter((t) => t.kind === 'open').length;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t.kind === 'open') continue;
    // An api-error ending is a row of its own, apart from a turn that ended without a Stop: both carry no reason, and
    // the cause stage 7 records was lost in the summary (G-6 of 20261106-035103-stoplog-g8-remediation-3-review).
    const key = t.reason ? `${t.kind}:${t.reason}`
      : (t.kind === 'involuntary' && t.cause === API_ERROR_CAUSE ? `${t.kind}:${API_ERROR_CAUSE}` : t.kind);
    const gap = t.end != null && t.next != null ? Math.max(0, t.next - t.end) : 0;
    const row = rowOf(kinds, key, () => ({ count: 0, gapMs: 0 }));
    row.count += 1;
    row.gapMs += gap;
  }
  const ends = ts.filter((t) => t.end != null).length;
  // FLAG ON AND FLAG OFF SIDE BY SIDE (autonomous-run.plan.md stage 8): each turn end is filed under the decision panel's
  // state when it was recorded; an end from before the guard recorded it is 'not recorded', never guessed.
  // Both states always have a row, a zero one when unseen (G-10 of 20261105-004603-ar-d1-c-review), and an involuntary
  // ending (a StopFailure, or a start with no end before it) is counted under its state beside the turn ends (G-20).
  const blank = () => ({ turnEnds: 0, involuntary: 0, gapMs: 0 });
  // The third partition is seeded too (G-13 of 20261105-013235-ar-d1-c-remediation-review).
  const panels = new Map([['on', blank()], ['off', blank()], ['not recorded', blank()]]);
  for (const t of ts) {
    if (t.end == null && t.kind !== 'involuntary') continue;
    const row = rowOf(panels, t.panel ?? 'not recorded', blank);
    if (t.end == null) { row.involuntary += 1; continue; }
    row.turnEnds += 1;
    row.gapMs += t.next != null ? Math.max(0, t.next - t.end) : 0;
  }
  return { turnEnds: ends, involuntary: ts.filter((t) => t.kind === 'involuntary').length, blocked, open,
    byKind: Object.fromEntries(kinds), byPanel: Object.fromEntries(panels) };
}

// Whether a Claude Code settings object declares the stop guard (stage 5): a `Stop` hook running stop-guard.mjs, and a
// `UserPromptSubmit` hook running it with --turn-start. check-install reports each, since without the second the record
// cannot tell when a turn began, and without the first nothing guards a stop.
export function stopGuardDeclared(settings) {
  const commands = (event) => {
    const groups = settings?.hooks && typeof settings.hooks === 'object' ? settings.hooks[event] : null;
    if (!Array.isArray(groups)) return [];
    return groups.flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : [])).map((h) => String(h?.command ?? ''));
  };
  // The command runs node on stop-guard.mjs: node first, the script its first argument, quoted or not. A command that
  // only mentions the name (`echo stop-guard.mjs`, another script given it as an argument) does not run the guard (G-10
  // of 20261024-220920-arp-delivery).
  const guard = (c) => /^\s*(?:"[^"]*[\\/])?node(?:\.exe)?"?\s+(?:"[^"]*[\\/]stop-guard\.mjs"|(?:\S*[\\/])?stop-guard\.mjs)(?:\s|$)/.test(c);
  // The flag is a whole argument: `--turn-started` is a command the guard refuses (G-11 of
  // 20261024-224631-arp-remediation-review), quoted or not (G-14 of 20261024-235344-arp-remediation-2-review).
  const turnStartFlag = (c) => /(?:^|\s)(["']?)--turn-start\1(?:\s|$)/.test(c);
  return {
    stop: commands('Stop').some((c) => guard(c) && !turnStartFlag(c)),
    turnStart: commands('UserPromptSubmit').some((c) => guard(c) && turnStartFlag(c)),
    // The StopFailure hook (autonomous-run.plan.md stage 7 part 2): the guard run with --stop-failure, so a turn that
    // ends on an API error, a usage limit among them, is recorded rather than found later as an unexplained gap.
    stopFailure: commands('StopFailure').some((c) => guard(c) && /(?:^|\s)(["']?)--stop-failure\1(?:\s|$)/.test(c)),
  };
}
