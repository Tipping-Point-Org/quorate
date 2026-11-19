#!/usr/bin/env node
// spawn-subagent — run a skill's Claude subagent at the contract's model AND effort.
//
// claim-check-cross-family.plan.md stage 0a (operator, 2026-10-18: "One spawn script for all three (Recommended)").
// Item 1 (.claude/requests/skill-subagent-pins.md) told claim-check, plan-review and candidate-pool to pin their Claude
// subagent to `review.models.judgment` and `review.effort.judgment`, and a session's subagent tool takes a model but no
// effort, so the pin could not be met. The node runtime's CLI can, and this runs it:
//
//   - the pins from the contract through judgmentPins, the graph's own fallback, so a skill and a lens agree;
//   - the argv rendered by nodeArgv from the runtime's declared flags, sandboxed, with the read-only tool denials (a
//     lens's, plus the shell): the subagent reads and searches, and writes nothing;
//   - the environment spawn-node gives a subscription node: scrubChildEnv, then runtimeSessionEnv, which strips an
//     ANTHROPIC_API_KEY that would take precedence over the subscription (its first manual use failed 401 on one);
//   - the whole `--output-format json` envelope kept at --out, every usage field with it.
//
// Usage: spawn-subagent.mjs --prompt-file <brief> --out <envelope.json> [--result <file>] [--repo-root <dir>] [--cwd <dir>] [--runtime-bin <path>]
// `--runtime-bin` replaces the runtime's binary (its alias for one release, io/runtime-bin.mjs, warns); a `.mjs`/`.js` value runs under this node, as spawn-node's does, which is
// what lets a test use a fake without reaching the operator's real CLI. `--runtime-bin` is the same, named for the runtime
// rather than a vendor; a generic seam passes that one (G-4 of 20261104-171128-epo-remediation-3-review; A-9).
// Exit: the child's status (0 ran) · 1 the child failed or printed no envelope · 2 usage or refusal · 3 depth.
import fs from 'node:fs';
import { nodeDepth } from './lib/node-depth.mjs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS, runtimeLaunch } from './lib/argv-specs.mjs';
import { runtimeBinArg, runtimeBinArgv } from './io/runtime-bin.mjs';
import { egressReadFile } from './io/egress-read.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnCapture } from './io/spawn-capture.mjs';
import { writeSubagentRecord } from './io/telemetry-record.mjs';
import { callEntry, runtimeAnswered, runtimeError } from './lib/call-entry.mjs';
import { judgmentPins, runtimeSessionEnv, scrubChildEnv, nodeArgv, denyToolsFor } from './lib/decisions.mjs';
import { selectAdapters, overrideLine } from './io/reviewers.mjs';
import { readContract } from './io/contract-reader.mjs';
import { writeTextAtomic } from './io/atomic.mjs';
import { contractMinutes } from './lib/check-timeout.mjs';

// THE RECURSION GUARD, FIRST: the same fail-closed block every spawning script carries (check-intent-grant.mjs, for
// one). A subagent is a model with tools, so a graph node may not start one.
const { raw: RAW_DEPTH, depth: PARSED_DEPTH } = nodeDepth(process.env);
const DEPTH = PARSED_DEPTH ?? NaN;
if (!Number.isInteger(DEPTH) || DEPTH < 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} is not a non-negative integer — refusing to guess whether this is nested (§8).`);
  process.exit(3);
}
if (DEPTH > 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${DEPTH} — a graph node may not spawn a subagent (§8).`);
  process.exit(3);
}

const die = (msg, code = 2) => { console.error(`spawn-subagent: ${msg}`); process.exit(code); };

const FLAGS = { '--prompt-file': 'promptFile', '--out': 'out', '--result': 'result', '--repo-root': 'repoRoot',
  '--effort': 'effort', '--cwd': 'cwd' };
const args = {};
// ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
try {
  const { values } = parseArgv(process.argv.slice(2), ARGV_SPECS['spawn-subagent']);
  for (const [flag, key] of Object.entries(FLAGS)) if (values[flag.slice(2)] !== undefined) args[key] = values[flag.slice(2)];
  try { args.runtimeBin = runtimeBinArg(values); } catch (e) { die(e.message); }
} catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
for (const flag of ['--prompt-file', '--out']) if (!args[FLAGS[flag]]) die(`${flag} is required`);

let prompt;
// THROUGH THE EGRESS OWNER (hardlink-egress.plan.md stage 2): the prompt goes to the runtime's vendor, so a link or a file
// with a second name is refused, exit 2, before anything is spawned.
try { prompt = egressReadFile(args.promptFile, 'utf8', { repoRoot: args.repoRoot ? path.resolve(args.repoRoot) : process.cwd() }); } catch (e) { die(`cannot read ${args.promptFile}: ${e.message}`); }
if (!prompt.trim()) die(`${args.promptFile} is empty`);

const read = readContract(args.repoRoot ? { repoRoot: args.repoRoot } : {});
if (!read.contract) die(`no contract to read the pins from: ${read.error ?? read.message ?? 'graph_contract absent'}`);
const review = read.contract.review ?? {};
const roster = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'lens-roster.json'), 'utf8'));
let pins;
try { pins = judgmentPins(review, roster); } catch (e) { die(e.message); }
// AN OPERATOR'S ONE-OFF EFFORT (operator, 2026-10-20: "One more review at higher effort"): the contract's pin stays the
// default; this overrides it for one spawn, and the override is said here and stamped in spawned_with.
let effortFrom = 'contract';
if (args.effort !== undefined) {
  if (!/^[a-z]+$/.test(args.effort)) die(`--effort ${JSON.stringify(args.effort)} is not an effort level`);
  console.error(`spawn-subagent: --effort ${args.effort} overrides the contract's ${pins.effort} for this spawn`);
  pins = { ...pins, effort: args.effort };
  effortFrom = '--effort';
}

// Chosen by the one owner (contract-runtime-and-session-files.plan.md stage 1): the contract's review.runtime, else the
// table's default, so a subagent runs where the review's nodes run (it took the default alone).
const ADAPTERS = selectAdapters({ contract: read.contract });
const table = ADAPTERS.table;
let runtimeName;
try { runtimeName = ADAPTERS.runtime; } catch (e) { die(e.message); }
const runtime = table[runtimeName];
if (!runtime) die('the adapter table names no node runtime');
// AN OVERRIDE OF THIS RUNTIME IS NAMED (G-4 of 20261019-211650-two-mediums-review; ARCHITECTURE.md A-26): the contract
// chose where the session's credentials go, as every other path that runs an override says (spawn-node, new-run,
// external-review, check-reviewers, the bench scripts). From the same declared table the runtime was merged from.
const own = ADAPTERS.overrides.find((o) => o.name === runtimeName);
if (own) console.error(`spawn-subagent: ${overrideLine(own)}`);
// THE PROMPT ON STDIN (decision-panel-seats.plan.md stage 2; DP-D1 A): `input` is what nodeArgv returned for the
// child's stdin; inline in argv a decision seat's 33,827-byte prompt failed with spawn ENAMETOOLONG.
const { argv, input } = nodeArgv(runtime, {
  prompt, model: pins.model, effort: pins.effort, denyTools: denyToolsFor('read-only', runtime), sandboxed: true,
});

const env = runtimeSessionEnv(scrubChildEnv(process.env, { runtime }).env,{ authMode: 'subscription', runtime }).env;
env.GRAPH_NODE_DEPTH = '1';
// WHICH TASK THIS CHILD IS, for the session records' lines (session-record-files.plan.md stage 3): the folder its envelope
// goes to names the check or the plan-review round. Set here, out of the child's reach, like the depth.
env.QUORATE_NODE_ID = `subagent:${path.basename(path.dirname(path.resolve(args.out)))}`;

// The command and whether it runs under this node: lib/argv-specs.mjs runtimeLaunch, the one owner (G-6 of
// 20261111-192009-runtime-bin-remediation-review).
const { cmd: launchCmd, prefix, command: bin } = runtimeLaunch(args.runtimeBin, runtime.cmd, process.execPath);
// THE BOUND IS REQUIRED, AND IT STOPS THE TREE (G-16 of 20261019-014448-ccf-delivery): a malformed
// node_timeout_minutes was read as no timeout at all, and spawnSync's timeout killed the CLI and left its children
// running. A value that is not a positive number is refused; the child is run through spawnCapture, which stops the
// whole process tree when the bound fires.
// Read through the helper run-graph uses, so the two refuse alike: Number() here took `true` as 1 (G-11 of
// 20261021-194056-ciss-d1-remediation-3-review).
let minutes;
try { minutes = contractMinutes(review, 'node_timeout_minutes'); } catch (e) { die(e.message); }
const startedMs = Date.now();
const startedAt = new Date(startedMs).toISOString();
// THE MODEL'S OWN WORKING DIRECTORY (decision-records.plan.md stage 5): --cwd puts it apart from --repo-root, whose
// contract the SPAWNER reads for the pins. The decision panel runs its subagents in an empty directory outside the
// repository, so the model does not start beside the decision record it is part of (discovery, not reads: a path it is
// given or guesses stays readable; G-2 of 20261104-171128-epo-remediation-3-review); every other caller keeps the repository.
let childCwd = args.repoRoot ? path.resolve(args.repoRoot) : process.cwd();
if (args.cwd !== undefined) {
  childCwd = path.resolve(args.cwd);
  let st = null;
  try { st = fs.statSync(childCwd); } catch { /* reported below */ }
  if (!st?.isDirectory()) die(`--cwd ${childCwd} is not a directory`);
}
const r = await spawnCapture(launchCmd, [...prefix, ...argv], {
  cwd: childCwd, env,
}, { timeoutMs: minutes * 60_000, maxBytes: 64 * 1024 * 1024, input });
// THE SPAWN'S TELEMETRY RECORD (telemetry-records.plan.md stage 3), for every caller and before any exit below, so a spawn
// that timed out or printed nothing is recorded too: beside --out, named after it. A note, never a failed spawn.
{
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* recorded as no envelope */ }
  // THE CALL'S ENTRY (runtime-call-telemetry.plan.md stage 3): the same shape every runtime call has, kept in this record.
  const call = callEntry({ reviewer: runtimeName, model: pins.model ?? null, table, startedMs, endedMs: Date.now(),
    exitCode: r.status ?? null, signal: r.signal ?? null, timedOut: r.timedOut === true, timeoutMinutes: minutes,
    stdout: r.stdout ?? '', answered: runtimeAnswered(r.stdout ?? '', runtime) });
  const tel = writeSubagentRecord(args.out, { envelope: parsed, pins, call, runtime: runtimeName, contract: read.contract,
    repoRoot: args.repoRoot ? path.resolve(args.repoRoot) : process.cwd(),
    proc: { started_at: startedAt, ended_at: new Date().toISOString(), exit_code: r.status ?? null, signal: r.signal ?? null,
      timed_out: r.timedOut === true, timeout_minutes: minutes } });
  if (!tel.ok) console.error(`spawn-subagent: ${tel.note}`);
}
if (r.timedOut) die(`the subagent was stopped at the ${minutes}-minute bound${r.survivor ? `; a process survived: ${JSON.stringify(r.survivor)}` : ''}`, 1);
if (r.error) die(`could not run ${bin}: ${r.error.message ?? r.error}`, 1);
writeTextAtomic(args.out, r.stdout ?? '');
let envelope = null;
try { envelope = JSON.parse(r.stdout); } catch { /* reported below */ }
console.error(`spawn-subagent: model ${pins.model}, effort ${pins.effort}${pins.substituted.length ? ` (${pins.substituted.join('; ')})` : ''}; envelope ${args.out}`);
// Its stderr is the one place the reason is when it fails before the envelope (found 2026-10-20: exit 1, empty stdout).
// The head, where a CLI prints its error, and the tail; a CLI that echoes its argv puts the prompt between them.
const errText = String(r.stderr ?? '').trim();
const errShown = errText.length <= 2000 ? errText : `${errText.slice(0, 1000)}\n[... ${errText.length - 2000} characters ...]\n${errText.slice(-1000)}`;
if (!envelope) die(`the subagent printed no JSON envelope (exit ${r.status}); its output is at ${args.out}${errShown ? `; its stderr:\n${errShown}` : '; its stderr was empty'}`, 1);
if (runtimeError(envelope, runtime)) die(`the subagent reported an error: ${String(envelope.result ?? '').slice(0, 300)}`, 1);
// THE ANSWER'S JSON, WRITTEN FOR IT: the subagent is denied every write tool, so a skill whose subagent returns a
// result file (claim-check's result.json, plan-review's verdict) asks for it here. The whole answer when it parses,
// else the span from its first `{` to its last `}`; neither parsing to an object writes nothing and fails.
if (args.result) {
  const text = String(envelope.result ?? '');
  const parse = (s) => { try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };
  const obj = parse(text) ?? (text.includes('{') ? parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) : null);
  if (!obj) die(`the subagent's answer carries no JSON object; the envelope is at ${args.out}`, 1);
  // WHAT THE SPAWNER ACTUALLY USED, stamped by the spawner (.claude/requests/two-ledger-mediums.md, AC2): the model and
  // effort it passed, and the models the backend reports in modelUsage. A reviewer's own `settings` only echo its brief.
  obj.spawned_with = { model: pins.model, effort: pins.effort, effort_from: effortFrom,
    backend_models: Object.keys(envelope.modelUsage ?? {}) };
  writeTextAtomic(args.result, `${JSON.stringify(obj, null, 2)}\n`);
  console.error(`spawn-subagent: result ${args.result}`);
}
process.exit(r.status ?? 1);
