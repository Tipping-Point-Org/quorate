#!/usr/bin/env node
// check-plan-verdict — does a plan-review verdict report the model and effort its caller pinned?
//
// G-8 of 20261018-203604-review-review: this check lived only in `spawn-node --mode gate`, and nothing calls that mode —
// plan-review runs as the session's subagent, before any run directory exists — so it ran in no round. The operator's
// decision (2026-10-18: "Caller-run check (Recommended)"): the caller runs it on the verdict file, with the two values it
// pinned. It compared an echo of the brief, which caught a verdict that misreported its settings but not a round run at
// others; it now checks the `spawned_with` stamp spawn-subagent.mjs writes from what it passed and what the backend
// reported (.claude/requests/two-ledger-mediums.md).
//
// Usage: check-plan-verdict.mjs --verdict <file> --model <pinned model> --effort <pinned effort>
// `--effort ""` states that the runtime's default was passed (null, as gateSettingsErrors compares it). Both pins are
// required: a check that defaulted one would compare the verdict against a value nobody pinned.
// Exit 0 the settings match, 1 they do not, 2 refused or unreadable.
//
// NO GRAPH_NODE_DEPTH GUARD: this starts no graph work — it reads one file and compares two fields.
import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { gateSettingsErrors, backendAttestation } from './lib/decisions.mjs';

const die = (msg) => { console.error(`check-plan-verdict: ${msg}`); process.exit(2); };

const args = {};
// ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
try {
  const { values } = parseArgv(process.argv.slice(2), ARGV_SPECS['check-plan-verdict']);
  for (const key of ['verdict', 'model', 'effort']) if (values[key] !== undefined) args[key] = values[key];
} catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
for (const key of ['verdict', 'model', 'effort']) if (args[key] === undefined) die(`--${key} is required`);
if (!args.model.trim()) die('--model is empty: name the model the reviewer was pinned to');

let verdict;
try { verdict = JSON.parse(fs.readFileSync(args.verdict, 'utf8')); } catch (e) { die(`cannot read ${args.verdict}: ${e.message}`); }
if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) die(`${args.verdict} is not a JSON object`);

// THE SPAWNER'S STAMP, NOT THE REVIEWER'S ECHO (.claude/requests/two-ledger-mediums.md, AC3; story-pipeline's finding):
// `settings` copies the brief, so it proves the brief was read. `spawned_with` is written by spawn-subagent.mjs from what
// it passed and what the backend reported, so it is what the round ran at. Required; the echo alone no longer suffices.
const pin = { model: args.model, effort: args.effort === '' ? null : args.effort };
const stamp = verdict.spawned_with;
// THE BACKEND'S LIST IS THE ONLY ATTESTATION: `spawned_with.model` is the spawner's copy of the pin. At least one reported
// id must contain the pin, case-folded; any other id (a helper model beside the main one) is printed as also reported,
// not refused (G-1 of 20261019-214353-review-review). The rule is backendAttestation's, in lib/decisions.mjs.
const attested = backendAttestation(stamp?.backend_models, args.model);
const errors = !stamp || typeof stamp !== 'object'
  ? ['the verdict carries no spawned_with: it was not written by spawn-subagent.mjs, so nothing attests the settings it ran at']
  : [...gateSettingsErrors(stamp, pin).map((e) => e.replace(/^settings\./, 'spawned_with.')), ...attested.errors];
if (errors.length) {
  for (const e of errors) console.error(`check-plan-verdict: ${e}`);
  console.error('check-plan-verdict: the round is not accepted — nothing attests it ran at the settings it was pinned to');
  process.exit(1);
}
console.log(`check-plan-verdict: spawned at the pin (model ${JSON.stringify(args.model)}, effort ${JSON.stringify(stamp.effort ?? null)}); `
  + `the backend reported ${attested.matched.join(', ')}`
  + (attested.others.length ? `; also reported: ${attested.others.join(', ')}` : ''));
