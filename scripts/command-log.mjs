#!/usr/bin/env node
// The command log (autonomous-run-pauses; operator, 2026-10-25: "logging every command (redact secrets) and logging
// before executing"). As Claude Code's PreToolUse hook on the Bash and PowerShell tools it reads the hook's input on
// stdin and appends one redacted line (lib/command-log.mjs) before the command runs. It decides nothing about the
// command: the deny rules in .claude/settings.json refuse what they can name, and everything else is logged.
//
// If the line cannot be written, the command is refused (exit 2, the reason on stderr), because a command that runs
// unlogged is the gap the log exists to close. Stop the refusals by fixing the log, not by removing the hook.
//
//   PreToolUse (Bash|PowerShell):  node <framework-root>/scripts/command-log.mjs
//   summary:                       node <framework-root>/scripts/command-log.mjs --summary [--last <n>] [--repo-root <dir>]

import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { commandEvent, commandSummary, afterEvent, commandPairs } from './lib/command-log.mjs';
import { appendStopEvent, readStopEvents } from './io/stop-log.mjs';
import { callerRepoRoot } from './io/reviews-root.mjs';
import { gitSync } from './io/git.mjs';
import { readHookInput } from './io/hook-input.mjs';
import { sessionContract } from './io/session-contract.mjs';
import { retentionDays, RETENTION_DEFAULT_DAYS, lineContext } from './lib/session-record.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
// The retention age from the contract, asked for only on a session's first write. A value the key refuses (a negative
// or fractional number) falls back to the default here, said on stderr: the contract's own checks report it, and a
// hook must not stop logging over it.
// The context every line carries (lib/session-record.mjs lineContext; S-D4).
const contextFor = (input, record, repoRoot) => lineContext({
  now: Date.now(), record, session: input.session_id, pid: process.pid,
  startedMs: Date.now() - Math.round(process.uptime() * 1000), hookEvent: input.hook_event_name, depth: nodeDepth(process.env).depth ?? 0,
  run: process.env.QUORATE_RUN_ID, node: process.env.QUORATE_NODE_ID, request: sessionContract(repoRoot).request,
});

const retentionOf = (repoRoot) => () => {
  try { return retentionDays(sessionContract(repoRoot).review); } catch (e) {
    console.error(`${e.message}; the default of ${RETENTION_DEFAULT_DAYS} days applies`);
    return RETENTION_DEFAULT_DAYS;
  }
};

import path from 'node:path';

const LOG = { log: 'commands' };

let v;
try { v = parseArgv(process.argv.slice(2), ARGV_SPECS['command-log']).values; } catch (e) {
  if (e instanceof ArgvError) { console.error(`command-log: ${e.message}`); process.exit(2); }
  throw e;
}

if (v.summary) {
  const repoRoot = callerRepoRoot(v['repo-root']);
  if (!repoRoot) { console.error('command-log: not inside a git repository; pass --repo-root'); process.exit(2); }
  const { file, events, unreadable, unreadableFolders, dropped, maxEvents } = readStopEvents(repoRoot, LOG);
  const s = commandSummary(events);
  // The read is capped (G-5 of 20261105-154708-crsf-remediation-5-review): past it the summary covers only the newest.
  if (dropped) console.log(`covers only the newest ${maxEvents} events; ${dropped} older event(s) were read past and not counted`);
  for (const u of unreadableFolders) console.error(`command-log: session folder ${u.folder} could not be read (${u.code}); its commands are not counted`);
  const last = Math.max(0, Number(v.last ?? 20) || 0);
  console.log(`command log: ${file}`);
  console.log(`commands: ${s.total}${unreadable ? `; unreadable lines: ${unreadable}` : ''}; by tool: ${JSON.stringify(s.byTool)}; marked: ${JSON.stringify(s.byMark)}`);
  const p = commandPairs(events);
  const show = (label, list, extra) => {
    if (!list.length) return;
    console.log(`${label}: ${list.length}`);
    for (const { start, end } of list.slice(-last)) console.log(`  ${new Date(start.at).toISOString()} ${extra(end)} ${String(start.command).slice(0, 160)}`);
  };
  show('failed', p.failed, (e) => `[failed ${e.durationMs ?? '?'} ms${e.error ? `: ${e.error}` : ''}]`);
  show('slowest', p.slowest, (e) => `[${e.durationMs} ms]`);
  show('no after line (running, or its session ended)', p.unfinished, () => '[?]');
  for (const e of events.filter((x) => x?.event === 'command' && (x.marks ?? []).length).slice(-last)) {
    console.log(`  ${new Date(e.at).toISOString()} [${e.marks.join(',')}] ${e.command.slice(0, 200)}`);
  }
  process.exit(0);
}

// Read to a cap (io/hook-input.mjs; G-3 of 20261025-021243-arp-remediation-3c-review): past it the command is refused,
// since it cannot be logged whole.
const readStdin = () => readHookInput();

function repoRootOf(input) {
  if (v['repo-root']) return path.resolve(v['repo-root']);
  const cwd = input.cwd || process.cwd();
  const r = gitSync(['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', windowsHide: true });
  return r.status === 0 && r.stdout.trim() ? path.resolve(r.stdout.trim()) : path.resolve(cwd);
}

// The after line (--after, the PostToolUse and PostToolUseFailure hook): the command has already run, so this fails open,
// a missing after line being a gap in the log, not a reason to refuse anything.
if (v.after) {
  try {
    const input = JSON.parse(await readStdin());
    const event = afterEvent(input, Date.now());
    if (event) { const root = repoRootOf(input); appendStopEvent(root, { ...contextFor(input, 'commands', root), ...event }, { ...LOG, retentionDays: retentionOf(root) }); }
  } catch (e) {
    console.error(`command-log --after: the after line was not written (${e?.message ?? e})`);
  }
  process.exit(0);
}

try {
  const input = JSON.parse(await readStdin());
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('the hook input is not a JSON object');
  // DEPTH READ, NOT A GUARD: the depth tells a graph node from the working session; this hook never aborts on it.
  const event = commandEvent(input, Date.now(), { nodeDepth: nodeDepth(process.env).depth ?? 0, run: process.env.QUORATE_RUN_ID });
  if (event) { const root = repoRootOf(input); appendStopEvent(root, { ...contextFor(input, 'commands', root), ...event }, { ...LOG, retentionDays: retentionOf(root) }); }
  process.exit(0);
} catch (e) {
  console.error(`command-log: the command was not run, because it could not be logged first (${e?.message ?? e}). `
    + 'Fix the log (scripts/command-log.mjs, shared/session-rules.md) rather than removing the hook.');
  process.exit(2);
}
