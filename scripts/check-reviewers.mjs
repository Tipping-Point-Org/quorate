#!/usr/bin/env node
// check-reviewers.mjs — check, on demand, every external reviewer a run can call (reviewer-preflight.plan.md, stage 4).
//
// It REPLACES check-panel.mjs and check-tiebreak.mjs. Those probed the arms and the judges through prompts and records of
// their own (.claude/panel-check.json, .claude/tiebreak-check.json), and a run read the probe file only to say how old
// it was. The check is now the reviewer preflight itself: external-review refuses a reviewer that has not passed a
// probe of the exact combination it is about to use, and new-run refuses a mint whose reviewers do not pass. This
// command runs that same check — `external-review --preflight-only` — for every combination at once, so an operator can
// see the panel's state before a review asks for it, and `--force` re-probes ones whose record still counts.
//
// WHAT IT CHECKS: the roster's panel arms (review mode) and adjudicators (tie-break mode), with the model and effort
// run-graph passes — the set new-run checks at mint, from the same function (rosterCombinations) — plus every reviewer
// the contract declares that the roster does not use, in the first mode it supports (review, else propose, else
// tie-break) with its ambient model, so a project's own adapter
// is probed before a roster names it — whatever its schema. A built-in neither names is not checked. And propose, on both
// routes, for each reviewer, model and effort the roster uses (proposeCombinations): candidate-pool and request's critique
// call it, and until 2026-10-16 nothing probed it.
//
// SERIAL, as check-panel was (G-7, panel-codex-perf): each probe spends at a vendor, and an operator watching can stop
// after the first; a hung transport is attributable to one line. Each child is bounded by its adapter's own limits.
//
// Spends subscription quota, so it needs QUORATE_LIVE=1, and it is deliberately not part of commands.test. A graph node
// may not run it (§8): it starts reviewer processes.
//
//   QUORATE_LIVE=1 node scripts/check-reviewers.mjs [--reviewer <name>] [--force]
//
// Exit codes: 0 every combination passed · 1 at least one did not (each is named; one passing judge does not make the
//             panel sound — G-8 of check-tiebreak, which exited 0 with a judge silent) · 2 usage, or no QUORATE_LIVE ·
//             3 recursion guard tripped

import path from 'node:path';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hostFs as fs } from './platform/index.mjs';
import { selectAdapters, overrideLine, servesRole, supportsMode, rawTable, declaredReviewers } from './io/reviewers.mjs';
import { probeLimits, rosterCombinations, proposeCombinations, claimCheckCombinations, decideCombinations, preflightArgv, combinationLabel, preflightOutcome } from './lib/reviewer-probe.mjs';

const { raw: RAW_DEPTH, depth: PARSED_DEPTH } = nodeDepth(process.env);
const DEPTH = PARSED_DEPTH ?? NaN;
if (!Number.isInteger(DEPTH) || DEPTH < 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} is not a non-negative integer — refusing to guess `
    + 'whether this is nested (§8).');
  process.exit(3);
}
if (DEPTH > 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${DEPTH} — a graph node may not start reviewer probes (§8).`);
  process.exit(3);
}

function die(msg) {
  console.error(`check-reviewers: ${msg}`);
  process.exit(2);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = { reviewer: null, force: false };
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['check-reviewers'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  // A NAME, or a refusal (G-3 of 20261010-051458-reviewer-preflight-r4): a trailing --reviewer read as undefined and
  // disabled the filter, so a check meant for one reviewer probed every one. An empty name is refused as it was.
  if (v.reviewer !== undefined) {
    if (!v.reviewer) die('--reviewer needs a name');
    args.reviewer = v.reviewer;
  }
  if (v.force) args.force = true;
}

// THE CONSUMER'S DECLARATIONS TOO, merged as external-review merges them (check-tiebreak's lesson: a probe that read only
// the built-ins refused a declared judge the real run accepted).
let DECLARED;
try { DECLARED = declaredReviewers({ live: true }); } catch (e) { die(e.message); }
// The one owner (contract-runtime-and-session-files.plan.md stage 1); this tool uses the table and the overrides only.
const ADAPTERS = selectAdapters({ declared: DECLARED });
const TABLE = ADAPTERS.table;
// EVERY OVERRIDE OF THIS TABLE, NAMED ONCE BEFORE ANYTHING THAT SPENDS (reviewer-credential-routing, A-26): this tool
// builds its table from the LIVE contract, and the contract decided where an overridden built-in's credentials go.
for (const o of ADAPTERS.overrides) console.error(`check-reviewers: ${overrideLine(o)}`);
const roster = JSON.parse(fs.readFileSync(path.join(HERE, 'lens-roster.json'), 'utf8'));
const used = new Set(rosterCombinations(roster).map((c) => c.reviewer));
// THE ROSTER AND THE CONTRACT'S DECLARED REVIEWERS, AND NOTHING ELSE (G-1 of 20261009-232840-reviewer-preflight-r1):
// each declared reviewer the roster does not use, in review mode with its ambient model, WHATEVER its schema — the probe
// holds a schema-less one to the review shape like any other. A built-in neither names is not this command's to check.
const combinations = [
  ...rosterCombinations(roster),
  // AND PROPOSE (story-pipeline, 2026-10-16): candidate-pool and request's critique call it, and no check did.
  ...proposeCombinations(roster, (name) => Boolean(TABLE[name]) && supportsMode(TABLE[name], 'propose')),
  // AND CLAIM-CHECK, at the roster's claim_checker pin (claim-check-cross-family.plan.md stage 6).
  ...claimCheckCombinations(roster, (name) => Boolean(TABLE[name]) && supportsMode(TABLE[name], 'claim-check')),
  // AND DECIDE, at each decision_panel seat's pin (autonomous-run.plan.md stage 4).
  ...decideCombinations(roster, (name) => Boolean(TABLE[name]) && supportsMode(TABLE[name], 'decide')),
  ...Object.keys(DECLARED ?? {})
    // IN THE FIRST MODE IT SUPPORTS (G-4 of 20261010-051458-reviewer-preflight-r4): a proposer-only reviewer was
    // filtered out by asking for review mode, and so never checked.
    .filter((name) => !used.has(name) && TABLE[name] && servesRole(TABLE[name], 'reviewer'))
    .map((name) => ({ reviewer: name, model: '', effort: '', mode: ['review', 'propose', 'tie-break'].find((m) => supportsMode(TABLE[name], m)) }))
    .filter((c) => c.mode),
].filter((c) => !args.reviewer || c.reviewer === args.reviewer);

if (args.reviewer && !TABLE[args.reviewer]) die(`reviewer '${args.reviewer}' is not in the adapter table`);
if (!combinations.length) die(args.reviewer ? `nothing to check for '${args.reviewer}'` : 'no reviewer to check');

if (process.env.QUORATE_LIVE !== '1') {
  die('this calls the real reviewer CLIs, spending subscription quota (not metered API credit); one probe costs far '
    + 'less than one real review. Re-run with QUORATE_LIVE=1. It is deliberately NOT part of commands.test, so it '
    + 'never runs unattended on a commit.');
}

const script = path.join(HERE, 'external-review.mjs');
console.log(`check-reviewers: ${combinations.length} combination(s)${args.force ? ', re-probing every one' : ''}`);
let failed = 0;
for (const c of combinations) {
  const label = combinationLabel(c);
  let boundMs;
  let outcome;
  try {
    boundMs = probeLimits(TABLE[c.reviewer], rawTable().probe_defaults).checkBoundMs;
  } catch (e) {
    outcome = { failed: `its limits could not be read: ${e.message}` };
  }
  const started = Date.now();
  if (!outcome) {
    // THE PROBE'S OWN CONSENT (G-1 of 20261009-222911-reviewer-preflight-review): this command is the deliberate
    // transport probe `transport-probe` exists for, and it already demands QUORATE_LIVE=1. Without it, a panel that is
    // off — the moment an operator checks it before enabling it — was refused at the consent gate on every line.
    const r = spawnSync(process.execPath, preflightArgv(script, c, ['--consent', 'transport-probe', ...(args.force ? ['--reprobe'] : [])]),
      { encoding: 'utf8', timeout: boundMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    outcome = preflightOutcome({
      status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr, error: r.error,
      timedOut: r.error?.code === 'ETIMEDOUT', boundMs,
    });
  }
  const s = ((Date.now() - started) / 1000).toFixed(1);
  if (outcome.failed) failed++;
  console.log(`  ${outcome.failed ? 'FAILED' : 'passed'}  ${label}  ${s}s${outcome.failed ? ` — ${outcome.failed}` : ` (checked ${outcome.record.checked_at})`}`);
}
console.log(failed ? `\n${failed} of ${combinations.length} failed: a run that calls them is refused at mint.` : '\nall passed.');
process.exit(failed ? 1 : 0);
