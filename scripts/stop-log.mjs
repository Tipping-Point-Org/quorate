#!/usr/bin/env node
// What the stop record adds up to (autonomous-run-pauses.plan.md stage 2): counts and summed gaps by kind of turn end,
// beside the baseline the request was built on. The baseline is quoted as autonomous-run.md recorded it; the
// instrument it names (waits.mjs) is not in this repository, so it is not re-run here.
//
//   node scripts/stop-log.mjs --summary [--repo-root <dir>]

import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { summary } from './lib/stop-record.mjs';
import { readStopEvents, STOP_LOG_MAX_BYTES } from './io/stop-log.mjs';
import { callerRepoRoot } from './io/reviews-root.mjs';

const BASELINE = '898 turn-end stops (157 h), 305 answered only by "continue" (36 h), 2026-09-07 to 2026-10-21 '
  + '(autonomous-run.md, Why; recorded there, not re-run)';

let v;
try { v = parseArgv(process.argv.slice(2), ARGV_SPECS['stop-log']).values; } catch (e) {
  if (e instanceof ArgvError) { console.error(`stop-log: ${e.message}`); process.exit(2); }
  throw e;
}
if (!v.summary) { console.error('stop-log: say --summary'); process.exit(2); }
const repoRoot = callerRepoRoot(v['repo-root']);
if (!repoRoot) { console.error('stop-log: not inside a git repository; pass --repo-root'); process.exit(2); }

const { file, events, unreadable, unreadableFolders, dropped, maxEvents, sessionsLeftOut, maxSessions } = readStopEvents(repoRoot);
const s = summary(events);
for (const u of unreadableFolders) console.error(`stop-log: session folder ${u.folder} could not be read (${u.code}); its events are not counted`);
const hours = (ms) => (ms / 3600000).toFixed(1);
console.log(`stop record: ${file}`);
// The record is bounded, so the summary says which span it adds up (G-14 of 20261024-224631-arp-remediation-review).
const first = events.map((e) => e.at).find((at) => Number.isFinite(at));
console.log(`kept: ${events.length} events${first != null ? ` since ${new Date(first).toISOString().slice(0, 10)}` : ''}; `
  + `the record keeps two files of up to ${STOP_LOG_MAX_BYTES / 1024 / 1024} MiB, and older events are dropped`);
// The read is capped (G-5 of 20261105-154708-crsf-remediation-5-review): past it the summary covers only the newest.
if (dropped) console.log(`covers only the newest ${maxEvents} events; ${dropped} older event(s) were read past and not counted`);
// And at most the newest sessions are read (stop-record-bounds-and-kill-log.plan.md stage 2, BI-D1 A).
if (sessionsLeftOut) console.log(`reads only the newest ${maxSessions} sessions; ${sessionsLeftOut} older session(s) were not read`);
console.log(`turn ends: ${s.turnEnds}; involuntary: ${s.involuntary}; blocked attempts: ${s.blocked}; open turns: ${s.open}${unreadable ? `; unreadable lines: ${unreadable}` : ''}`);
for (const [kind, row] of Object.entries(s.byKind).sort()) console.log(`  ${kind.padEnd(28)} ${String(row.count).padStart(5)}  ${hours(row.gapMs)} h stopped or waiting`);
// Flag on beside flag off (autonomous-run.plan.md stage 8): turn ends by the decision panel's state when each was recorded.
for (const [state, row] of Object.entries(s.byPanel).sort()) console.log(`  decision panel ${state.padEnd(13)} ${String(row.turnEnds).padStart(5)} turn end(s)  ${String(row.involuntary ?? 0).padStart(5)} involuntary  ${hours(row.gapMs)} h stopped or waiting`);
console.log(`baseline: ${BASELINE}`);
