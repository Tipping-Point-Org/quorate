#!/usr/bin/env node
// A long run on one approved plan (autonomous-run.plan.md stage 7; design AR-D6, AR-D7): its state is kept under the
// engine's home, outside the repository, so a crashed or rebooted session's next start can be told where it was.
//
//   node <framework-root>/scripts/run-session.mjs start --plan <path> [--until <stage>]
//   node <framework-root>/scripts/run-session.mjs status
//   node <framework-root>/scripts/run-session.mjs stop
//   node <framework-root>/scripts/run-session.mjs freshness        once a day: which CLIs are due an update (never updates)
//   node <framework-root>/scripts/run-session.mjs --session-start  Claude Code's SessionStart hook
//
// The session's id is not known to a `start` typed at the command line: the first hook that runs in the session binds
// it (this SessionStart hook, or the stop guard's turn start). The time limit is `review.run_time_limit_hours`
// (lib/autonomous-keys.mjs). What happens AT the limit, and whether a far usage-limit reset stops the run, are the
// plan's open questions 1 and 2: `limitState` reports the limit, and the stop is left to the session's rules.
//
// The hook never fails the session: any error, inside a graph node included, prints nothing and exits 0. The commands
// refuse inside a graph node (§8): a node does not start, stop or steer the run it is part of.

import path from 'node:path';
import { nodeDepth } from './lib/node-depth.mjs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { newRunState, runStateText, bindSession } from './lib/run-state.mjs';
import { runTimeLimitHoursOf } from './lib/autonomous-keys.mjs';
import { requestIsApproved } from './lib/project-paths.mjs';
import { readRunState, writeRunState, clearRunState, runStatePath, bindRunState } from './io/run-state.mjs';
import { readHookInput } from './io/hook-input.mjs';
import { sessionContract } from './io/session-contract.mjs';
import { gitSync } from './io/git.mjs';
import { checkFreshness, refreshFreshnessDetached } from './io/cli-freshness.mjs';
import { reviewersFromOutcome } from './io/reviewers.mjs';
import { readContract } from './io/contract-reader.mjs';
import { confined } from './io/confined-path.mjs';
import { relativeBelow } from './io/finding-scope.mjs';
import { noticeText } from './io/template.mjs';

let v; let positionals;
try { ({ values: v, positionals } = parseArgv(process.argv.slice(2), ARGV_SPECS['run-session'])); } catch (e) {
  if (!(e instanceof ArgvError)) throw e;
  if (process.argv.includes('--session-start')) process.exit(0);
  console.error(`run-session: ${e.message}`);
  process.exit(2);
}

function repoRootOf(cwd) {
  if (v['repo-root']) return path.resolve(v['repo-root']);
  const r = gitSync(['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error(`not inside a git repository (${cwd})`);
  return path.resolve(r.stdout.trim());
}

// ---------------------------------------------------------------------------- the hook: print, never fail
if (v['session-start']) {
  try {
    const depth = nodeDepth(process.env).depth;
    if (depth !== 0) process.exit(0);
    const input = JSON.parse(await readHookInput());
    const repoRoot = repoRootOf(input.cwd || process.cwd());
    // A state that cannot be read or written is said, never taken for no run (G-26 of 20261104-223634-ar-d1-review: this
    // was inside the bare catch below, so a corrupt state left a resumed session with neither its plan nor its limit).
    // Only the READ is named (G-12 of 20261105-004603-ar-d1-c-review): a failed bind or freshness step is not an
    // unreadable state, and the amended stage 7 has the hook print nothing for it.
    let state = null;
    // The sentence is the prompt library's, the one stop-guard's turn start prints (G-8 of
    // 20261106-022028-stoplog-g8-remediation-2-review: written here inline, a second owner).
    try { state = readRunState(repoRoot); } catch (e) { process.stdout.write(noticeText('run-state-unreadable.md', { message: e.message })); }
    if (state) {
      try {
        // Bound under the state's lock, re-read inside it (G-16 of 20261105-013235-ar-d1-c-remediation-review).
        if (bindSession(state, input.session_id)) state = bindRunState(repoRoot, input.session_id) ?? state;
      } catch { /* the session stays unbound; the next hook binds it */ }
      process.stdout.write(`${runStateText(state, Date.now())}\n`);
      // The daily check from its cache only; a stale cache is refreshed by a detached process, never waited on here.
      // The table this repository runs, read once and handed to both (G-6 of 20261105-021654-ar-d1-c-remediation-2-review):
      // the cache-only read prints a notice only from a cache computed for it.
      // With its review block, so the runtime the cache is keyed by is the contract's (contract-runtime-and-session-files
      // stage 1).
      let declared = null; let contract = null;
      try { const outcome = readContract({ cwd: repoRoot }); declared = reviewersFromOutcome(outcome, 'run-session'); contract = outcome?.contract ?? null; } catch { /* no table, no notice */ }
      if (declared) {
        try { for (const d of checkFreshness({ cacheOnly: true, declared, contract })) process.stdout.write(`${d}\n`); } catch { /* an unusable cache: the refresh rebuilds it */ }
        // An override the refresh runs is named here, its own output being ignored (G-3 of 20261105-013235-ar-d1-c-remediation-review).
        try { refreshFreshnessDetached({ repoRoot, declared, contract, say: (l) => process.stdout.write(`${l}\n`) }); } catch { /* nothing for any error but an unreadable state */ }
      }
    }
  } catch { /* the hook never fails the session: bad input, inside a node, or no repository */ }
  process.exit(0);
}

// ---------------------------------------------------------------------------- the commands
const { raw: RAW_DEPTH, depth: DEPTH } = nodeDepth(process.env);
if (DEPTH === null) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} is not a non-negative integer — refusing to guess whether this is nested (§8).`);
  process.exit(3);
}
if (DEPTH > 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${DEPTH} — a graph node may not start, stop or steer a run (§8).`);
  process.exit(3);
}

const die = (msg, code = 2) => { console.error(`run-session: ${msg}`); process.exit(code); };
const [cmd, ...extra] = positionals ?? [];
if (!['start', 'status', 'stop', 'freshness'].includes(cmd) || extra.length) die('give one of: start --plan <path> [--until <stage>], status, stop, freshness, --session-start');
let repoRoot;
try { repoRoot = repoRootOf(process.cwd()); } catch (e) { die(e.message); }

if (cmd === 'start') {
  if (!v.plan) die('start needs --plan <path>');
  // Below the repository by containment's one owner (G-2 of 20261105-154708-crsf-remediation-5-review; G-9 of
  // 20261105-151040-crsf-remediation-4b-review: a hand-rolled `startsWith('..')` refused a plan below a folder named `..x`).
  const planSegs = relativeBelow(path.resolve(repoRoot), path.resolve(repoRoot, v.plan));
  if (!planSegs) die(`no plan at ${v.plan} inside ${repoRoot}`);
  const rel = planSegs.join(path.sep);
  // Read through the repository's confined owner (G-13 of 20261105-004603-ar-d1-c-review): a link on the path that
  // leads out of the repository is refused, never followed to an approved file elsewhere.
  let planText;
  try { planText = confined(repoRoot).read(planSegs); } catch { die(`no plan at ${v.plan} inside ${repoRoot}`); }
  if (!requestIsApproved(planText)) die(`${rel} is not approved (its front matter reads no \`status: approved\`): a run works only on approved work`);
  // A state that cannot be read is said, as every other command says it (G-18 of 20261105-052942-crsf-delivery).
  let active;
  try { active = readRunState(repoRoot); } catch (e) { die(`the run state could not be read: ${e.message}`); }
  if (active) die(`a run is already active on ${active.plan}; \`run-session.mjs stop\` it first`, 1);
  let limitHours;
  try { limitHours = runTimeLimitHoursOf(sessionContract(repoRoot).review); } catch (e) { die(e.message); }
  const state = newRunState({ plan: rel.split(path.sep).join('/'), until: v.until ?? null, startedAt: Date.now(), limitHours });
  // Exclusive: the check above is a courtesy message; this create is what refuses a second start (G-13).
  let p;
  try { p = writeRunState(repoRoot, state, { exclusive: true }); } catch (e) { die(e.message, 1); }
  console.log(`run-session: started on ${state.plan}${state.until ? ` until ${state.until}` : ''}, ${limitHours === null ? 'no time limit' : `${limitHours} h limit`}; state ${p}`);
} else if (cmd === 'status') {
  // An unreadable state is said, as the hook says it (G-18 of 20261105-021654-ar-d1-c-remediation-2-review), not a stack.
  let s;
  try { s = readRunState(repoRoot); } catch (e) { die(`the run state could not be read: ${e.message}`); }
  if (!s) { console.log('run-session: no active run'); process.exit(0); }
  console.log(runStateText(s, Date.now()));
  console.log(`session: ${s.session ?? 'not bound yet'}; state ${runStatePath(repoRoot)}`);
} else if (cmd === 'stop') {
  let s = null;
  try { s = readRunState(repoRoot); } catch (e) { console.error(`run-session: the run state could not be read (${e.message}); removing it`); }
  // Under the bind lock (G-11): a bind in progress refuses the stop, which says to retry.
  try { clearRunState(repoRoot); } catch (e) { die(e.message, 1); }
  console.log(s ? `run-session: stopped the run on ${s.plan}` : 'run-session: no active run');
} else {
  let lines;
  try { lines = checkFreshness({ repoRoot, force: true, all: true }); } catch (e) { die(e.message); }
  for (const l of lines) console.log(l);
}
