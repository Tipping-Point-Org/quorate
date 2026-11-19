#!/usr/bin/env node
// The stop guard (autonomous-run-pauses.plan.md stage 3): Claude Code's Stop hook, and with --turn-start its
// UserPromptSubmit hook. It reads the hook's input on stdin, records the event (io/stop-log.mjs), and for a turn end
// decides with lib/stop-record.mjs whether to let the session stop: an unnamed stop, an undeclared wait, or a stop for
// the operator with no options is blocked once, with the reason the session then acts on.
//
//   Stop:              node <framework-root>/scripts/stop-guard.mjs
//   UserPromptSubmit:  node <framework-root>/scripts/stop-guard.mjs --turn-start
//   StopFailure:       node <framework-root>/scripts/stop-guard.mjs --stop-failure   (records the API error; prints nothing)
//
// It never fails the session: an error is reported on stderr and the stop is allowed, because a guard that breaks the
// harness costs more than one unguarded stop.

import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { guardDecision, hasOpenTurn, holdsTurnEvent, turnStartEvents, stopFailureEvent } from './lib/stop-record.mjs';
import { appendStopEvent, readSessionTail } from './io/stop-log.mjs';
import { gitSync } from './io/git.mjs';
import { readHookInput } from './io/hook-input.mjs';
import { sessionContract } from './io/session-contract.mjs';
import { retentionDays, RETENTION_DEFAULT_DAYS, lineContext } from './lib/session-record.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
import { panelUsable } from './lib/autonomous-keys.mjs';

// Whether questions with options go to the decision panel here (autonomous-run.plan.md stage 6): the flag on AND the
// external panel it needs. FAILS SOFT, like every contract read in this hook: a contract it cannot read, or a value the
// reader refuses, is `off`, so the stop is judged as it was before the panel existed.
/**
 * What a turn start prints while a long run is active (autonomous-run.plan.md stage 7): the run's state and the CLIs
 * due an update, from the cache only. The first turn start in the run's session binds its id. Imported here, not at the
 * top, so a fault in those modules can cost this print and never the guard itself.
 */
async function turnStartRunLinesOf(repoRoot, session, at) {
  const { readRunState, bindRunState } = await import('./io/run-state.mjs');
  const { bindSession, runStateText } = await import('./lib/run-state.mjs');
  const { noticeText } = await import('./io/template.mjs');
  // Only the READ is said as an unreadable state (G-10 of 20261106-022028-stoplog-g8-remediation-2-review: the caller's
  // catch named every later fault so); the sentence is the prompt library's, and its render never throws.
  let state;
  try { state = readRunState(repoRoot); } catch (e) { return noticeText('run-state-unreadable.md', { message: e.message }); }
  if (!state) return '';
  // Bound under the state's lock, re-read inside it (G-5 of 20261105-013235-ar-d1-c-remediation-review).
  if (bindSession(state, session)) state = bindRunState(repoRoot, session) ?? state;
  const { checkFreshness, refreshFreshnessDetached } = await import('./io/cli-freshness.mjs');
  // The table this repository runs, read once and handed to both (G-6 of 20261105-021654-ar-d1-c-remediation-2-review): the
  // cache-only read prints a notice only from a cache computed for it. No table read is no notice.
  // With its review block, so the cache key names the contract's runtime (contract-runtime-and-session-files stage 1).
  const { reviewersFromOutcome } = await import('./io/reviewers.mjs');
  const { readContract } = await import('./io/contract-reader.mjs');
  let declared = null; let contract = null;
  try { const outcome = readContract({ cwd: repoRoot }); declared = reviewersFromOutcome(outcome, 'stop-guard'); contract = outcome?.contract ?? null; } catch { /* no notice; the refresh says nothing either */ }
  let fresh = [];
  if (declared) { try { fresh = checkFreshness({ cacheOnly: true, now: new Date(at), declared, contract }); } catch { /* an unusable cache: the refresh rebuilds it */ } }
  const lines = [runStateText(state, at), ...fresh];
  // A long session crosses dates with no new SessionStart (G-21 of 20261105-004603-ar-d1-c-review): a stale cache is
  // refreshed here too, detached, so the turn never waits on it and the next turn prints what it found.
  // An override the refresh runs is named in this turn's print (G-3 of 20261105-013235-ar-d1-c-remediation-review).
  if (declared) { try { refreshFreshnessDetached({ repoRoot, now: new Date(at), declared, contract, say: (l) => lines.push(l) }); } catch { /* the print stands without it */ } }
  return lines.join('\n') + '\n';
}

// THE CONTRACT, READ ONCE PER HOOK PROCESS (G-15 of 20261105-004603-ar-d1-c-review): the panel's state, each line's
// context and the retention age each read and parsed it again. A hook process is one event, so one read serves it.
const contracts = new Map();
const contractOf = (repoRoot) => { if (!contracts.has(repoRoot)) contracts.set(repoRoot, sessionContract(repoRoot)); return contracts.get(repoRoot); };

function decisionPanelHere(repoRoot) {
  try { return panelUsable(contractOf(repoRoot).review).ok ? 'on' : 'off'; } catch { return 'off'; }
}
// The retention age from the contract, asked for only on a session's first write. A value the key refuses (a negative
// or fractional number) falls back to the default here, said on stderr: the contract's own checks report it, and a
// hook must not stop logging over it.
// The context every line carries (lib/session-record.mjs lineContext; S-D4).
const contextFor = (input, record, repoRoot) => lineContext({
  now: Date.now(), record, session: input.session_id, pid: process.pid,
  startedMs: Date.now() - Math.round(process.uptime() * 1000), hookEvent: input.hook_event_name, depth: nodeDepth(process.env).depth ?? 0,
  run: process.env.QUORATE_RUN_ID, node: process.env.QUORATE_NODE_ID, request: contractOf(repoRoot).request,
});

const retentionOf = (repoRoot) => () => {
  try { return retentionDays(contractOf(repoRoot).review); } catch (e) {
    console.error(`${e.message}; the default of ${RETENTION_DEFAULT_DAYS} days applies`);
    return RETENTION_DEFAULT_DAYS;
  }
};

import { PROFILE_DIR } from './io/project-profile.mjs';
import path from 'node:path';
import { existsSync } from 'node:fs';

let v;
try { v = parseArgv(process.argv.slice(2), ARGV_SPECS['stop-guard']).values; } catch (e) {
  if (e instanceof ArgvError) { console.error(`stop-guard: ${e.message}`); process.exit(2); }
  throw e;
}

// The hook's input is read to a cap by io/hook-input.mjs; past it the handler below allows the stop.
const readStdin = () => readHookInput();

function repoRootOf(input) {
  if (v['repo-root']) return path.resolve(v['repo-root']);
  const cwd = input.cwd || process.cwd();
  const r = gitSync(['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', windowsHide: true });
  return r.status === 0 && r.stdout.trim() ? path.resolve(r.stdout.trim()) : path.resolve(cwd);
}

try {
  const raw = await readStdin();
  // A parse error goes to the handler below, which allows the stop (G-11 of 20261024-220920-arp-delivery): an empty
  // object here would be classified unnamed and blocked.
  let input;
  try { input = JSON.parse(raw); } catch (e) { throw new Error(`the hook input is not JSON (${e.message})`); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('the hook input is not a JSON object');
  const repoRoot = repoRootOf(input);
  const at = Date.now();
  const session = input.session_id ?? null;
  if (v['stop-failure']) {
    // THE StopFailure HOOK (autonomous-run.plan.md stage 7 part 2; operator, 2026-10-31: "2 a"): the turn ended on an API
    // error, a usage limit among them. Claude Code's own wait is kept; this records the event, with its reset text, so
    // the gap it leaves is explained. The hook has no decision control, so nothing is printed.
    appendStopEvent(repoRoot, { ...contextFor(input, 'stops', repoRoot), ...stopFailureEvent(input, { at, panel: decisionPanelHere(repoRoot) }) }, { retentionDays: retentionOf(repoRoot) });
  } else if (v['turn-start']) {
    // The session's open turn ended without a Stop: recorded as involuntary, with its cause, when this start finds it
    // (criterion 1; G-12 of 20261024-220920-arp-delivery). Only this session's events are read (G-12 of
    // 20261024-224631-arp-remediation-review).
    // Read newest first, up to the newest turn event, which alone decides it (G-16 of 20261025-080709-srf-delivery).
    const tail = readSessionTail(repoRoot, session, holdsTurnEvent);
    // A line that did not parse is said, never skipped in silence (G-8 of 20261106-005647-stoplog-g8-review): a torn newest
    // record can leave an older start looking current.
    // The sentence is the prompt library's (G-5 of 20261106-013812-stoplog-g8-remediation-review: written here, inline).
    const open = hasOpenTurn(tail, session);
    for (const e of turnStartEvents(input, { at, open, panel: decisionPanelHere(repoRoot) })) appendStopEvent(repoRoot, { ...contextFor(input, 'stops', repoRoot), ...e }, { retentionDays: retentionOf(repoRoot) });
    // After the append, and by a render that never throws (G-9 of 20261106-022028-stoplog-g8-remediation-2-review: a
    // template fault before it lost the turn-start events exactly when the record was torn).
    if (tail.unreadable) {
      try {
        const { noticeText } = await import('./io/template.mjs');
        process.stdout.write(noticeText('stop-record-unreadable.md', { count: tail.unreadable }));
      } catch (e) { console.error(`stop-guard: ${e?.message ?? e}`); }
    }
    // THE ACTIVE RUN, AT EVERY TURN START (autonomous-run.plan.md stage 7): a compaction under -p fires no SessionStart
    // (stage 1), so a compacted session learns its run here. Printed only while a run is active, with the CLIs due an
    // update read from the cache alone; its own try, so a fault here never costs the record above.
    // A fault is said, never taken for no run (G-26 of 20261104-223634-ar-d1-review: a bare catch printed nothing).
    // The fault's sentence is the prompt library's too (G-5 of 20261106-013812-stoplog-g8-remediation-review).
    // A fault after the read is not an unreadable state: stderr only, as the amended stage 7 has it (G-10).
    try { process.stdout.write(await turnStartRunLinesOf(repoRoot, session, at)); } catch (e) {
      console.error(`stop-guard: the active run could not be printed (${e?.message ?? e})`);
    }
  } else {
    // A project's own session rules replace quorate's for its sessions; the refusal points at the file they follow
    // (G-13 of 20261024-220920-arp-delivery). The markers the guard reads are shared/session-rules.md's either way. The
    // path is PROFILE_DIR's, the one owner check-install reads it through (G-13 of 20261024-224631-arp-remediation-review).
    const rulesPath = `${PROFILE_DIR}/session-rules.md`;
    // DEPTH READ, NOT A GUARD: the depth tells a graph node from the working session; this hook never aborts on it.
    const depthNow = nodeDepth(process.env).depth ?? 0;
    const panel = decisionPanelHere(repoRoot);
    const d = guardDecision(input, { ...(existsSync(path.join(repoRoot, rulesPath)) ? { rulesPath } : {}), nodeDepth: depthNow, decisionPanel: panel });
    // The panel's state rides on every turn end, so the summary can set flag-on stops beside flag-off ones (stage 8).
    appendStopEvent(repoRoot, { ...contextFor(input, 'stops', repoRoot), at, event: d.block ? 'blocked' : 'end', ...d.record, panel, session, ...(process.env.QUORATE_RUN_ID ? { run: process.env.QUORATE_RUN_ID } : {}) }, { retentionDays: retentionOf(repoRoot) });
    if (d.block) process.stdout.write(JSON.stringify({ decision: 'block', reason: d.reason }));
  }
} catch (e) {
  console.error(`stop-guard: ${e?.message ?? e}; the stop is allowed`);
}
process.exit(0);
