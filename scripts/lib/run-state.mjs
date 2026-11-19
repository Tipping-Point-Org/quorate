// A long run's state (autonomous-run.plan.md stage 7; design AR-D6, AR-D7): the one approved plan a run works on, the
// stage it may stop at, when it started, how long it may last, and the session it runs in. The file lives under the
// engine's home, outside every repository (scripts/io/run-state.mjs), so a crash or a reboot leaves it where the next
// session's hook can read it. What a stop at the limit is called is the plan's open question 1, so nothing here stops
// anything: `limitState` says whether the limit is reached, and the caller that stops on it is the seam.
//
// Pure: no I/O, no clock (ARCHITECTURE §2): the time arrives as an argument.

export const RUN_STATE_VERSION = 1;

const text = (v) => typeof v === 'string' && v.trim().length > 0;

/** A new run's state. `limitHours` is `runTimeLimitHoursOf`'s answer: a positive number, or null for unlimited. */
export function newRunState({ plan, until = null, startedAt, limitHours, session = null }) {
  return {
    version: RUN_STATE_VERSION,
    plan,
    until: text(until) ? until.trim() : null,
    started_at: new Date(startedAt).toISOString(),
    limit_hours: limitHours,
    session: text(session) ? session : null,
  };
}

/** What is wrong with a state read back from disk; empty when it can be used. */
export function runStateErrors(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['the run state is not an object'];
  const errs = [];
  if (s.version !== RUN_STATE_VERSION) errs.push(`run state version ${JSON.stringify(s.version)}, expected ${RUN_STATE_VERSION}`);
  if (!text(s.plan)) errs.push('the run state names no plan');
  if (s.until !== null && !text(s.until)) errs.push('until must be a stage name or null');
  if (!text(s.started_at) || Number.isNaN(Date.parse(s.started_at))) errs.push('started_at is not a time');
  if (s.limit_hours !== null && !(typeof s.limit_hours === 'number' && Number.isFinite(s.limit_hours) && s.limit_hours > 0)) {
    errs.push('limit_hours must be a positive number or null');
  }
  if (s.session !== null && !text(s.session)) errs.push('session must be an id or null');
  return errs;
}

/** Whether the run's time limit is reached at `nowMs`, and when it ends; a null limit never ends. */
export function limitState(s, nowMs) {
  if (s.limit_hours === null) return { reached: false, ends_at: null };
  const ends = Date.parse(s.started_at) + s.limit_hours * 3600_000;
  return { reached: nowMs >= ends, ends_at: new Date(ends).toISOString() };
}

/**
 * The session the run is in, bound by the first hook that sees one (a `start` from the command line does not know its
 * session's id). Returns the new state, or null when there is nothing to write: already bound, or no id.
 */
export function bindSession(s, session) {
  if (s.session || !text(session)) return null;
  return { ...s, session };
}

/** The lines printed into a session at its start or a turn's start, so a resumed or compacted session knows its run. */
export function runStateText(s, nowMs) {
  const l = limitState(s, nowMs);
  const limit = s.limit_hours === null ? 'no time limit'
    : l.reached ? `time limit reached at ${l.ends_at}: end the run with a last line \`Stop: limit — time limit\`` : `runs until ${l.ends_at}`;
  return [
    `quorate run in progress: plan ${s.plan}${s.until ? `, until ${s.until}` : ''}; started ${s.started_at}; ${limit}.`,
    'Continue at the first stage of that plan not yet done; stop only for a reason shared/session-rules.md names.',
  ].join('\n');
}

/**
 * HOW A PERSON REOPENS THE RUN'S SESSION: the runtime adapter's `cmd` and `node_runtime.resume_argv`, `{{session}}`
 * filled in. An adapter that declares no resume_argv is refused, never given an invented command (A-9; the reader in
 * spawn-node.mjs's resumeHint takes the same view).
 */
export function resumeLine(adapter, session) {
  const argv = adapter?.node_runtime?.resume_argv;
  if (!Array.isArray(argv) || !argv.length) return { ok: false, reason: 'the runtime adapter declares no resume_argv: this runtime cannot reopen a session' };
  if (!text(session)) return { ok: false, reason: 'the run has no session recorded yet: no hook has run in it since it started' };
  return { ok: true, cmd: adapter.cmd, argv: argv.map((a) => String(a).split('{{session}}').join(session)) };
}
