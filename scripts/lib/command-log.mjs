// Every command a working session runs, logged before it runs (operator, 2026-10-25: "the safer approach is logging every
// command (redact secrets) and logging before executing"). The deny rules in .claude/settings.json refuse the installs
// and destructive commands that have a fixed spelling; what they cannot see (a download piped into a shell, an install
// hidden inside another command) is in this log, since "known to be safe" is itself a gap.
//
// Pure: the hook's input in, one event out. The secret shapes are lib/redact.mjs's, best-effort as it says (A-10).

import { redactClaim } from './redact.mjs';
import { commandSecretNameSource } from './secret-shapes.mjs';

// Marks on a command a reader of the log looks for first. A mark is a hint for reading, never a decision: nothing is
// refused for it, and a command with no mark is logged the same.
const MARKS = [
  ['fetch', /(?:^|[\s;&|(])(?:curl|wget|irm|iwr|Invoke-RestMethod|Invoke-WebRequest)(?=\s|$)/i],
  ['pipe-to-shell', /\|\s*(?:sh|bash|zsh|pwsh|powershell|python3?|node|iex|Invoke-Expression)(?=\s|$)/i],
  ['install', /(?:^|[\s;&|(])(?:npm\s+(?:install|i|ci|add)|pnpm\s+(?:add|install)|yarn\s+(?:add|install)|pip3?\s+install|uv\s+(?:add|sync|pip\s+install)|cargo\s+install|go\s+install|winget\s+install|choco\s+install|scoop\s+install)(?=\s|$)/i],
];

export function commandMarks(command) {
  const text = String(command ?? '');
  return MARKS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

// A command line's own credential shapes, replaced after lib/redact.mjs's (G-8 of 20261025-095239-srf-remediation-2-review:
// those are shared with the push scan and need a value that looks generated, so `DB_PASSWORD=hunter` or curl's
// `-u alice:pass` was logged as typed). Each keeps the name and replaces the value. Still best-effort: a secret in no
// shape here or there is logged as typed, the residual shared/session-rules.md declares.
// The credential names are lib/secret-shapes.mjs's, the one list (G-11 of 20261025-104155-srf-remediation-3-review).
const SECRET_NAME = commandSecretNameSource();
const VALUE = String.raw`(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s;&|]+)`;
const COMMAND_SHAPES = [
  // NAME=value as a shell assignment or export, NAME+=value as an append (G-12 of 20261025-104155-srf-remediation-3-review),
  // and PowerShell's $env:NAME = value.
  [new RegExp(String.raw`((?:^|[\s;&|(])(?:\$env:)?${SECRET_NAME}\s*\+?=\s*)(?!\[redacted)${VALUE}`, 'gi'), 'secret value'],
  // curl and its kin: -u / --user / --proxy-user user:password, the user kept. An unquoted user's password is one shell
  // word, so quoted runs inside it are part of it (`alice:"secret value"`, G-12); a user quoted before it is the next shape.
  [new RegExp(String.raw`((?:^|\s)(?:-u|--user|--proxy-user|-U)\s*=?\s*[^\s:"']+:)(?!\[redacted)(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"';&|]+)+`, 'g'), 'password'],
  [new RegExp(String.raw`((?:^|\s)(?:-u|--user|--proxy-user|-U)\s*=?\s*["']?[^\s:"']+:)(?!\[redacted)(?:[^"'\s]|(?<=["'][^\s:"']+:[^"']*)\s)+`, 'g'), 'password'],
  // A password in a URL's userinfo.
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)(?!\[redacted)[^\s/@]+(?=@)/gi, 'password'],
  // A credential flag's value, after `=` or a space.
  [new RegExp(String.raw`((?:^|\s)--?(?:password|passwd|pass|token|secret|api-?key|access-?token|auth-?token|client-?secret)(?:=|\s+))(?!\[redacted)${VALUE}`, 'gi'), 'secret value'],
];

/** A command as logged: lib/redact.mjs's shapes, then the command line's own. */
export function redactCommand(command) {
  let out = redactClaim(command);
  for (const [re, label] of COMMAND_SHAPES) out = out.replace(re, (_, keep) => `${keep}[redacted: ${label}]`);
  return out;
}

// The tools whose input is a command line (Claude Code's Bash and PowerShell tools).
export const COMMAND_TOOLS = Object.freeze(['Bash', 'PowerShell']);

/** The event for one PreToolUse input, or null when the tool runs no command. */
export function commandEvent(input, at, { nodeDepth = 0, run = null } = {}) {
  const tool = input?.tool_name;
  if (!COMMAND_TOOLS.includes(tool)) return null;
  const command = String(input?.tool_input?.command ?? '');
  return {
    at,
    event: 'command',
    tool,
    command: redactCommand(command),
    background: input?.tool_input?.run_in_background === true,
    // Pairs this line with the line written after the command (S-D4 B): lines of parallel commands interleave.
    toolUseId: input?.tool_use_id ?? null,
    cwd: input?.cwd ?? null,
    session: input?.session_id ?? null,
    marks: commandMarks(command),
    // Who ran it: the working session (depth 0) or a graph node the engine spawned, and the run it belongs to.
    depth: Number(nodeDepth) || 0,
    run: run || null,
  };
}

/** Counts by mark and by tool, for --summary. */
export function commandSummary(events) {
  const byMark = {};
  const byTool = {};
  let total = 0;
  for (const e of events ?? []) {
    if (e?.event !== 'command') continue;
    total += 1;
    byTool[e.tool] = (byTool[e.tool] ?? 0) + 1;
    for (const m of e.marks ?? []) byMark[m] = (byMark[m] ?? 0) + 1;
  }
  return { total, byTool, byMark };
}

// The hooks that fire after a command (stage 4's probe, session-record-files.plan.md notes): PostToolUse when it
// succeeded, with `tool_response` and `duration_ms`; PostToolUseFailure when it failed, with `error`, `is_interrupt` and
// `duration_ms`. Neither carries an exit status beyond which one fired.
export const AFTER_HOOKS = Object.freeze(['PostToolUse', 'PostToolUseFailure']);

/**
 * AN ERROR AS A RECORD KEEPS IT: its first non-blank line, redacted, cut to 200 characters. One owner for the command
 * log's after line and the telemetry builder (G-11 of 20261025-232315-tel-remediation-4-review). Null for no line.
 */
export const ERROR_LINE_MAX = 200;
export function errorLine(text) {
  const first = String(text ?? '').split(/\r?\n/).find((l) => l.trim());
  return first ? redactCommand(first.trim()).slice(0, ERROR_LINE_MAX) : null;
}

/** The line written after a command (S-D4 B): its outcome and duration, never its output. Null for other tools. */
export function afterEvent(input, at) {
  const tool = input?.tool_name;
  if (!COMMAND_TOOLS.includes(tool)) return null;
  const hook = input?.hook_event_name;
  const failed = hook === 'PostToolUseFailure';
  // Only the hook that fired says the outcome; a missing or unknown name is not a success (G-10 of
  // 20261025-092319-srf-review-amended).
  const outcome = failed ? 'failed' : hook === 'PostToolUse' ? 'ok' : 'unknown';
  return {
    at,
    event: 'command-end',
    tool,
    toolUseId: input?.tool_use_id ?? null,
    outcome,
    interrupted: Boolean(input?.tool_response?.interrupted ?? input?.is_interrupt ?? false),
    durationMs: Number.isFinite(input?.duration_ms) ? input.duration_ms : null,
    error: failed ? errorLine(input?.error) ?? '' : null,
  };
}

/** Before and after lines paired by tool-use id: the failed, the slowest, and those with no after line yet. */
export function commandPairs(events, { slowest = 5 } = {}) {
  const starts = new Map();
  const ends = new Map();
  for (const e of events ?? []) {
    if (e?.event === 'command' && e.toolUseId) starts.set(e.toolUseId, e);
    if (e?.event === 'command-end' && e.toolUseId) ends.set(e.toolUseId, e);
  }
  const pairs = [...starts.values()].map((s) => ({ start: s, end: ends.get(s.toolUseId) ?? null }));
  return {
    failed: pairs.filter((p) => p.end?.outcome === 'failed'),
    slowest: pairs.filter((p) => p.end && Number.isFinite(p.end.durationMs)).sort((a, b) => b.end.durationMs - a.end.durationMs).slice(0, slowest),
    unfinished: pairs.filter((p) => !p.end),
  };
}
