#!/usr/bin/env node
// spawn-node.mjs — run exactly one graph node and always leave a status file behind.
//
// This script is the load-bearing piece of the verification graph. It runs one `claude -p`
// subprocess, captures its output to disk, validates the structured verdict, and renders the
// markdown report itself. The node never writes a file; if it dies, the status file still
// records how. See shared/disk-first-protocol.md §7 — under the consumer mount that is
// .claude/skills/quorate/shared/, never `.claude/skills/shared/`, which exists in no layout (G-2).
//
// Exit codes: 0 node ran and reached a terminal state (OK/DEGRADED/BLOCKED — read the status file)
//             1 node BLOCKED before launch or its criteria refused (a required input), or the last-resort flush (status file written)
//             2 usage or configuration error (nothing spawned)
//             3 recursion guard tripped

import fs from 'node:fs';
import { nodeDepth } from './lib/node-depth.mjs';
import { minutes, timerMs } from './lib/check-timeout.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  SEVERITY_RUNGS, VERDICTS, clampSeverity, capVerdict, capVerdictKeepingInvariants, classifyResult, resolveAllowedBasis, scrubChildEnv,
  verdictFloorFromFindings, raiseVerdict, NODE_ID_RE, GROUP_ID_RE, denyToolsFor, nodeArgv, AUTH_MODES, timeoutForensics,
  describeNodeExit, nodeExitMapping, gateSettingsErrors, runtimeSessionEnv } from './lib/decisions.mjs';
import { resolveFrameworkDirs, nodeInstructions } from './io/locate.mjs';
import { coverPrefix, coversBelowPrefix } from './lib/contract-glob.mjs';
import { selectAdapters, entrypoint, overrideLine } from './io/reviewers.mjs';
import { renderTemplate } from './lib/template.mjs';
import { schemaField } from './io/review-prompts.mjs';
import { readTemplate } from './io/template.mjs';
import { egressReadFile, egressRunReader, refusalCause } from './io/egress-read.mjs';
import { admitRun, callerRepoRoot } from './io/reviews-root.mjs';
import { confined } from './io/confined-path.mjs';
import {
  roleGaps, unbackedCapabilities, validateAssignment, CONSERVATIVE_BASIS,
} from './lib/capabilities.mjs';
import { findingScopeErrors, findingOutOfScope, declaredSurface, isWithin, withinThroughLinks, firstLinkInto, firstLinkOnto, evidenceOwnershipError, canonicalSpelling, rootSpelling } from './io/finding-scope.mjs';
import { hostPlatform } from './platform/index.mjs';
import { runChild, recordRunOutcome, stopPhrase } from './io/run-child.mjs';
import { callEntry, runtimeAnswered, runtimeError, runtimeSubtype } from './lib/call-entry.mjs';
import { NESTED_ESCALATE_AFTER_MS, NESTED_SIGNAL_DEADLINE_MS, TEST_SEAM_GRACE_MS } from './io/stop-child.mjs';
import { redactClaim, redactTree } from './lib/redact.mjs';
import { RECONCILE_MAX_GROUPS } from './lib/reconcile-batches.mjs';
import { CENSUS_FIELDS, CENSUS_ITEMS } from './lib/census.mjs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS, runtimeLaunch } from './lib/argv-specs.mjs';
import { runtimeBinArg, runtimeBinArgv } from './io/runtime-bin.mjs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------- §8 recursion guard
// Fails CLOSED on a value it cannot read. The old guard was `isFinite(d) && d > 0`, so a
// GRAPH_NODE_DEPTH of "1x", "" or anything non-numeric produced NaN, failed the isFinite test,
// and fell through to "not nested" — the one input a corrupted or hostile environment is most
// likely to carry. An unreadable depth is not evidence of being top-level; it is evidence that
// the guard cannot do its job, and the only safe reading of that is to stop.
const { raw: RAW_DEPTH, depth: PARSED_DEPTH } = nodeDepth(process.env);
// Same rule as the other six copies of this guard (G-6): present-but-empty is UNREADABLE, not
// zero. `Number('')` is 0, so a value that says nothing read as top level through a check whose
// whole purpose is to refuse a value it cannot read.
const INHERITED_DEPTH = PARSED_DEPTH ?? NaN;
if (!Number.isInteger(INHERITED_DEPTH) || INHERITED_DEPTH < 0) {
  console.error(
    `ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} is not a non-negative integer — ` +
      `refusing to guess whether this is a nested node (disk-first-protocol.md §8).`,
  );
  process.exit(3);
}
if (INHERITED_DEPTH > 0) {
  console.error(
    `ABORT: GRAPH_NODE_DEPTH=${INHERITED_DEPTH} — a graph node may not spawn graph nodes ` +
      `(disk-first-protocol.md §8).`,
  );
  process.exit(3);
}

// ---------------------------------------------------------------------------- argv
function parseArgs(argv) {
  const out = { addDir: [] };
  const flags = {
    '--run-dir': 'runDir',
    '--repo-root': 'repoRoot',
    '--node-id': 'nodeId',
    '--skill-command': 'skillCommand',
    '--prompt': 'prompt',
    '--mode': 'mode',
    '--model': 'model',
    '--timeout-minutes': 'timeoutMinutes',
    '--output-cap-mb': 'outputCapMb',
    '--runtime': 'runtime',
    '--budget-usd': 'budgetUsd',
    '--schema-variant': 'schemaVariant',
    '--allowed-basis': 'allowedBasis',
    '--settings': 'settings',
    '--auth': 'auth',
    '--effort': 'effort',
    '--severity-ceiling': 'severityCeiling',
    '--severity-floor': 'severityFloor',
    '--verdict-ceiling': 'verdictCeiling',
    // TEST-ONLY, like --runtime-bin and --print-cmd: `refused` or `unconfirmed` replaces the kill inside the owner, because
    // no operating system refuses a kill, or accepts one and leaves the child running, on request — and those are the two
    // outcomes whose recording a test must see reach the status file (stopping-a-child stage 3; ledger
    // tests/regression-confirm3-remediation.test.mjs:60). A run that passes it is stamped `test_stop` in its status.
    '--test-stop': 'testStop',
  };
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md): a missing
  // value and an unknown flag are refused, naming the flag.
  let v;
  try { ({ values: v } = parseArgv(argv, ARGV_SPECS['spawn-node'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  for (const [flag, key] of Object.entries(flags)) if (v[flag.slice(2)] !== undefined) out[key] = v[flag.slice(2)];
  try { out.runtimeBin = runtimeBinArg(v); } catch (e) { die(e.message); }
  // consumes until the next flag, mirroring `--add-dir <directories...>`
  if (v['add-dir']) out.addDir = v['add-dir'];
  if (v.unsandboxed) out.unsandboxed = true;
  if (v['inline-skill']) out.inlineSkill = true;
  // THE ONE DECLARED EXCEPTION to "instructions come from the framework, never from the tree
  // being reviewed" (see the inline-skill block below). A project-authored lens is instructed by
  // a file in the CONSUMER's repository, and the orchestrator — which has the repository root,
  // the contract that declared the lens, and the containment helpers — resolves and proves that
  // path before passing it here. Crossed at one explicit argument rather than by widening
  // name-based resolution, so the default stays shut and the exception is visible in the argv
  // this spawner prints.
  if (v.instructions !== undefined) out.instructions = v.instructions;
  // Build the child argv, print it, and exit before spawning claude. A test seam (and a
  // debugging aid) so the exact flags handed to the child — the budget ceiling above all —
  // can be asserted without a live model call.
  if (v['print-cmd']) out.printCmd = true;
  return out;
}

function die(msg) {
  console.error(`spawn-node: ${msg}`);
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));

const MODES = ['lens', 'intent', 'reconcile', 'remediate', 'panel', 'gate'];
if (!args.runDir) die('--run-dir is required');
if (!args.nodeId) die('--node-id is required');
if (!NODE_ID_RE.test(args.nodeId)) die(`--node-id must match ${NODE_ID_RE}, got ${JSON.stringify(args.nodeId)}`);
if (!MODES.includes(args.mode)) die(`--mode must be one of ${MODES.join('|')}`);

const givenRunDir = path.resolve(args.runDir);
// GIT'S TOPLEVEL of where this runs when --repo-root is absent (G-17 of 20261023-014400-rdt-delivery): the literal working
// directory scoped a direct call from a subdirectory to that subdirectory. Outside any repository the working directory stays.
const repoRoot = callerRepoRoot(args.repoRoot) ?? path.resolve(process.cwd());
const nodeId = args.nodeId;
const mode = args.mode;
// FROM CONFIG, NEVER A LITERAL (G-50, panel-codex-contract). `args.model ?? 'opus'` put a model name
// in the spawner. In the graph this is always passed explicitly; the fallback exists for a direct
// call, and it reads the run's own frozen contract first and lens-roster.json's `default_models`
// second — resolved below, once runJson is available, because the run directory is where a node's
// configuration lives. Nothing here invents one.
let model = args.model ?? null;
// Through the owner of minutes values (code-index-d1-part-a.plan.md stage 2): absent was 15 here, 30 in spawn-subagent.
let timeoutMs;
try {
  timeoutMs = timerMs(minutes('flag --timeout-minutes', args.timeoutMinutes, minutes('review.node_timeout_minutes', undefined)));
} catch (e) { die(e.message); }
// A RESOURCE BOUND, so it takes a flag like the other two (G-39). Hardcoding it would have put a
// third un-configurable limit next to a timeout and a budget that are both read from the contract,
// and would have left the kill path untestable without a 64 MiB fixture.
const outputCapBytes = Math.round(Number(args.outputCapMb ?? 64) * 1024 * 1024);
// The lens binary, resolved on PATH by default. It is a flag for one reason that is not
// configurability: WITHOUT IT THE OUTPUT-CAP TEST CANNOT EXIST SAFELY. On Windows, CreateProcess
// appends only `.exe` when spawning without a shell, so a `claude.cmd` shim placed first on PATH is
// never found and the search falls through to the operator's REAL Claude Code — a test for the
// watchdog would then spawn a live billed session on every run, and be reported as testing a fake.
// It did exactly that once here before this flag existed. An explicit path cannot fall through.
//
// A `.mjs`/`.js` value is run under THIS process's node rather than executed directly. That is the
// only shape a cross-platform fixture can take: a shell script needs a shell, and a `.cmd` cannot be
// spawned without one either, so the alternative was `shell: true` — which would change the very
// process-group semantics the kill path depends on, and test a spawn mode no real node uses.
// 'none'/'' is the explicit uncapped sentinel run-graph passes when a budget tier is "" in the
// contract: no --max-budget-usd reaches the child, so claude -p runs without a dollar ceiling. An
// ABSENT flag still falls back to the $1.50 standalone safety, so a direct spawn-node call stays
// bounded — only an explicit sentinel lifts the cap.
const budgetUncapped = args.budgetUsd === 'none' || args.budgetUsd === '';
const budgetUsd = String(args.budgetUsd ?? '1.50');
const schemaVariant = args.schemaVariant ?? (mode === 'lens' ? 'code' : mode);

// ADMITTED BY THE ONE OWNER (ARCHITECTURE A-28; run-dir-trust.plan.md stage 3): the run's contract configures this node —
// the intent sandbox's forbidden roots, its model — and its run_id becomes QUORATE_RUN_ID, the pin capture holds every
// evidence write to. A missing run.json was read as {}, which failed open; a directory that is not this repository's run
// configured a node for it (G-14 of 20261022-215413-ciss-d1-3-remediation-review).
if (!fs.existsSync(givenRunDir)) die(`run dir does not exist: ${givenRunDir} (create it with new-run.mjs)`);
const admitted = admitRun({ runDir: givenRunDir, repoRoot });
if (!admitted.ok) die(`--run-dir ${admitted.why}`);
// EVERYTHING AFTER IS DONE TO THE DIRECTORY ADMITTED, its real path (G-18 of 20261023-014400-rdt-delivery).
const runDir = admitted.dir;
// THE NAMES BELOW THE RUN for a path, or null when it is not below it (run-dir-reads.plan.md stage 4). A path below the
// run is read through its owner, a link at any level refused; one outside it (a repository root, a --settings file the
// caller named) is not the run's, and is read as the caller named it.
function belowRun(p) {
  const rel = path.relative(runDir, path.resolve(p));
  return rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) ? rel.split(path.sep) : null;
}
// Is the policy file there: below the run through its owner, a refusal fatal, as owner.resolve makes it below.
function policyPresent() {
  const segs = belowRun(settingsPath);
  if (!segs) return fs.existsSync(settingsPath);
  try { return confined(runDir).exists(segs); } catch (e) { die(`policy file ${e.message}`); }
}
if (!Number.isFinite(outputCapBytes) || outputCapBytes <= 0) die('--output-cap-mb must be a positive number');

// --------------------------------------------------------------- --add-dir must be directories
// The CLI only WARNS when handed a file path and then continues with a narrower sandbox than
// intended. A typo must not silently shrink a sandbox, so validate here and hard-fail.
for (const d of args.addDir) {
  let st;
  try {
    st = fs.statSync(d);
  } catch {
    die(`--add-dir path does not exist: ${d}`);
  }
  if (!st.isDirectory()) {
    die(
      `--add-dir requires a directory, got a file: ${d}\n` +
        `  Do NOT "add the parent directory" as the CLI suggests — for an intent node that ` +
        `exposes the source tree and destroys the Rule 2 sandbox (§5).\n` +
        `  Snapshot the file into the run dir instead (new-run.mjs does this for CLAUDE.md).`,
    );
  }
}

// --------------------------------------------------------------- Rule 2 sandbox assertion (§5)
// Enforced by the spawner, not by the skill's prose.
//
// The forbidden roots are DERIVED from the contract's source_globs, never hardcoded — a
// hardcoded list of directory names would make this script silently wrong in any repo but the
// one it was written for, which is exactly the portability claim this set is making.
if (mode === 'intent') {
  const earlyRunJson = admitted.record;
  // Whether each root's globs reach below it (G-9 of 20261114-195905-m2-pred1-remediation-2-review): a root whose every
  // glob matches only its own folder's files (`*.mjs`) does not hold source in its subdirectories, so a directory inside
  // it is not refused for being inside it; the root itself, and anything containing it, still is.
  const deepRoot = new Map();
  for (const g of earlyRunJson.contract?.source_globs ?? []) {
    const f = coverPrefix(g);
    deepRoot.set(f, Boolean(deepRoot.get(f)) || coversBelowPrefix(g));
  }
  const forbidden = [
    ...new Set(
      // globDirPrefix, the ONE derivation of this fact (lib/locate.mjs): this copy trimmed only
      // forward slashes while run-graph's trimmed both, and a divergence here is either a
      // sandbox opened onto source or an aborted orchestrator (G-13).
      // THE EMPTY PREFIX IS THE REPOSITORY ROOT, NOT NOTHING (G-25 of 20261114-174045-m2-pred1-review): a glob that
      // starts with a wildcard (`**/*.mjs`) covers the whole repository, and `.filter(Boolean)` dropped its '' with no
      // record, so no source root was checked for such a contract and a link onto source passed. It stays, as the root.
      (earlyRunJson.contract?.source_globs ?? []).map(coverPrefix),
    ),
  ];
  // Each guard below holds for a path and the one it resolves to through links, or a junction whose own path passes them
  // all opens the sandbox onto its target (G-14 of 20261025-092319-srf-review-amended); withinThroughLinks is that rule's
  // one owner (G-12 of 20261025-095239-srf-remediation-2-review).
  for (const d of args.addDir) {
    const abs = path.resolve(d);
    if (withinThroughLinks(abs, repoRoot)) {
      // WAS `abs === repoRoot`, which a parent directory passes: `--add-dir F:\` is not equal to the
      // repo root, it CONTAINS it, and the sandbox is just as open either way (G-37).
      die(`intent node may not be given a directory containing the repo root as --add-dir (§5): ${abs}`);
    }
    // NOR THE RUN DIRECTORY ITSELF (G-31). Every root above is derived from the REPOSITORY, so a
    // run staged outside it satisfies all of them while carrying the one thing Rule 2 forbids:
    // evidence/pre-flight/build.log and test.log name the implementation's own symbols. The sandbox
    // floor is `<runDir>/sandbox/<node-id>`, which is INSIDE the run directory -- so this refuses
    // the run directory and anything containing it, and still admits the floor beneath it.
    //
    // run-graph no longer passes it, and that is not the guarantee: the widening that did pass it
    // was added centrally for every node, by a caller with no reason to think about this sandbox.
    // The guard belongs where the sandbox is enforced, exactly as the source-root check above says.
    // isWithin(parent, child) is true when the two are EQUAL, so this one test covers both the run
    // directory itself and any ancestor of it.
    if (withinThroughLinks(abs, runDir)) {   // the admitted run, not the caller's spelling (run-dir-descendants stage 4)
      die(`intent node may not be given the run directory as --add-dir (§5): ${abs} contains the `
        + `pre-flight build and test logs, which name the implementation intent must precede`);
    }
    // Nor a link beneath it into the rest of the run directory: the floor is inside it, so a link there onto
    // evidence/pre-flight passed the test above (G-13 of 20261025-095239-srf-remediation-2-review).
    // Below the run, through its owner (run-dir-reads.plan.md stage 4): a link at any level is refused, not followed into
    // a directory test. A floor outside the run is the caller's directory.
    // A refusal waits for the source-tree checks below, so a link onto the source tree is named for what it exposes.
    const absBelow = belowRun(abs);
    let isDir = false;
    let refusedBelowRun = null;
    if (absBelow) {
      try { isDir = confined(runDir).stat(absBelow).isDirectory(); } catch (e) { if (e.code !== 'ENOENT') refusedBelowRun = e.message; }
    } else isDir = fs.existsSync(abs) && fs.statSync(abs).isDirectory();
    const intoRun = isDir ? firstLinkInto(abs, runDir) : null;
    if (intoRun) {
      die(`intent node --add-dir ${abs} holds a link into the run directory (${intoRun}), whose pre-flight logs name the `
        + `implementation intent must precede (§5)`);
    }
    for (const f of forbidden) {
      const target = path.join(repoRoot, f);
      // BOTH directions. The original caught a doc dir that CONTAINS a source root and missed a
      // doc dir sitting INSIDE one — source_globs ["src/**"] with a declared doc dir src/docs
      // was accepted, handing the intent node path-scoped Read over source (G-14). The sandbox
      // held only because run-graph's docReadDirs happened to be stricter than this guard, and
      // authority for a sandbox invariant belongs at the enforcement point, not in a caller's
      // good manners.
      // Through the ONE containment owner (G-37). The hand-written `startsWith(x + path.sep)` form
      // breaks at a root: path.resolve already returns a trailing separator for `F:\` or `/`, so the
      // composed prefix became `F:\` or `//` and nothing started with it — an --add-dir of a drive
      // root, which contains the entire source tree, walked straight through a guard written to
      // refuse exactly that.
      // For the repository root of a leading-wildcard glob, a floor below the run directory is not source: a run written
      // in-tree (`review.reviews_dir`) puts it inside the repository, and the link scan below still covers what it holds.
      const ownFloor = f === '' && withinThroughLinks(runDir, abs);
      if (withinThroughLinks(abs, target) || (withinThroughLinks(target, abs) && !ownFloor && deepRoot.get(f) !== false)) {
        die(`intent node --add-dir ${abs} would expose the source tree at ${target} (§5)`);
      }
      // Nor a link beneath it onto that root or above it: the scan above looked only for links into the run directory,
      // so `src -> <repo>/scripts` inside the floor passed (G-17 of 20261025-104155-srf-remediation-3-review).
      const ontoSource = isDir ? firstLinkOnto(abs, target) : null;
      if (ontoSource) {
        die(`intent node --add-dir ${abs} holds a link (${ontoSource}) that would expose the source tree at ${target} (§5)`);
      }
    }
    if (refusedBelowRun) die(`intent node --add-dir ${abs}: ${refusedBelowRun}`);
  }
}

// ---------------------------------------------------------------------------- paths
// THROUGH THE ONE OWNER (run-dir-descendants.plan.md stage 2): nodes/ and evidence/<node> were made recursively with no
// check, so a link planted at either sent the status, the report and the node's output wherever it led. Every write
// below the run in this script goes through `owner`, which walks each level and refuses a link at any of them.
const owner = confined(runDir);
let nodesDir, evidenceDir;
try { nodesDir = owner.dir(['nodes']); evidenceDir = owner.dir(['evidence', nodeId]); } catch (e) { die(`${nodeId}: ${e.message}`); }
const evidenceWrite = (name, text) => owner.replace(['evidence', nodeId, name], text);

const statusPath = path.join(nodesDir, `${nodeId}.status.json`);
const briefPath = path.join(nodesDir, `${nodeId}-brief.md`);
const reportPath = path.join(nodesDir, `${nodeId}-report.md`);
const stdoutPath = path.join(evidenceDir, 'stdout.json');
const stderrPath = path.join(evidenceDir, 'stderr.log');

// Where this engine lives — see lib/locate.mjs. Distinct from `repoRoot`, which is the tree under
// review and may be an entirely different checkout.
//
// DEFINED BEFORE ITS FIRST READER, which is not a stylistic point in this file: `const` in a module
// is in its temporal dead zone until the line that declares it runs, and check-syntax cannot see
// the difference — four of those have already shipped here. The model resolution below reads
// lens-roster.json through this, so it must come first.
const FRAMEWORK = resolveFrameworkDirs(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The declared basis ladder — what each KIND of evidence is worth (G-52).
 *
 * Read from lens-roster.json beside the models, the efforts and the vendors, because "how much
 * weight does an unverifiable claim carry" is a judgement and a judgement nobody can change without
 * editing the engine is indistinguishable from a law. §4 owns the reasoning; the roster owns the
 * number; this only applies it.
 *
 * Falls back to the conservative table when the roster cannot be read, for the same reason
 * lib/capabilities.mjs does: absent configuration must not read as permission.
 */
let _roster = null;
function basisLadderRoster() {
  if (_roster) return _roster;
  try {
    _roster = JSON.parse(fs.readFileSync(path.join(FRAMEWORK.scriptsDir, 'lens-roster.json'), 'utf8'));
  } catch {
    _roster = {};
  }
  return _roster;
}
function basisLadder() {
  return basisLadderRoster().basis_ceilings ?? CONSERVATIVE_BASIS;
}

const runJson = admitted.record;

// ...and resolved HERE, where the run's frozen contract is readable (G-50). A mechanical node takes
// the mechanical model, everything else the judgment model, matching how run-graph assigns them.
if (!model) {
  const models = runJson.contract?.review?.models ?? {};
  const tier = mode === 'mechanical' ? 'mechanical' : 'judgment';
  model = models[tier] || basisLadderRoster().default_models?.[tier] || null;
  if (!model) {
    die(`no model for --mode ${mode}: --model was not given, run.json declares no `
      + `review.models.${tier}, and lens-roster.json declares no default_models.${tier}. `
      + 'A model name is configuration; this script will not invent one.');
  }
}

// Model routing (disk-first-protocol.md §2 — judgment nodes are Opus). CHECKED AFTER RESOLUTION:
// it ran above the fallback while the fallback was a literal, so it happened to test a real name.
// With the model now resolved from configuration, testing it before resolution would have run
// `/haiku/i` against `null` — a guard that passes because it was handed nothing.
if (mode === 'lens' && /haiku/i.test(model)) {
  die('refusing -mode lens with a haiku model: judgment nodes are Opus. See the Cheap Reviewer Paradox.');
}

// THE RUNTIME, LOOKED UP BY NAME FROM THE TABLE — the orchestrator no longer knows a CLI.
//
// `--runtime` selects which entry in scripts/reviewers.json spawns this node; it defaults to the
// one this framework ships with, so nothing changes for an existing caller. What changed is that
// the default is a LOOKUP rather than a literal: a second runtime is a table entry declaring its
// own node_runtime block and its own capabilities, not a second spawner.
//
// Refused when the runtime cannot serve the role, NAMING the missing capability — a specification
// rather than "unsupported". shared/adapter-contract.md says what each capability achieves.
// NO VENDOR NAME IN THE SPAWNER. The default is DECLARED by the table (`default_node_runtime`) and
// read here; `args.runtime ?? 'claude'` put the one thing the adapter table exists to remove back
// into the orchestrator. "Claude is the only runtime that works today" is a fact about the world;
// "the spawner names Claude" was a fact about this file, and only the second was ours to fix.
// Chosen by the one owner (contract-runtime-and-session-files.plan.md stage 1): --runtime, else the frozen contract's
// review.runtime, else the table's default.
const ADAPTERS = selectAdapters({ contract: runJson?.contract ?? null, runtimeArg: args.runtime ?? null });
const RUNTIME_TABLE = ADAPTERS.table;
let runtimeName;
try { runtimeName = ADAPTERS.runtime; } catch (e) { die(e.message); }
// MERGED WITH WHAT THE RUN DECLARES, so a second runtime needs no engine edit — the same rule the
// reviewer side follows, read from the contract this run froze at mint (G-8): which binary and
// which flags spawn a node is part of what a run WAS.
const RUNTIME = RUNTIME_TABLE[runtimeName];
if (!RUNTIME) die(`--runtime ${runtimeName} is not in the adapter table`);
{
  const role = mode === 'intent' ? 'intent' : 'lens';
  // A CLAIM WITH NO MECHANISM IS REFUSED, not honoured. A runtime that declares content_tool_denial
  // and names no content-reading tools would get the role, a policy that denies nothing, and a
  // status file saying it was sandboxed.
  const unbacked = unbackedCapabilities(RUNTIME);
  if (unbacked.length) {
    die(`runtime '${runtimeName}' declares capabilities it gives no mechanism for: `
      + `${unbacked.join('; ')}. See shared/adapter-contract.md.`);
  }
  const gaps = roleGaps(RUNTIME, role);
  if (gaps.length) {
    die(`runtime '${runtimeName}' cannot serve the ${role} role: it does not provide `
      + `${gaps.join(', ')}. See shared/adapter-contract.md for what each requirement achieves.`);
  }
}
// AN OVERRIDE OF THIS RUNTIME IS NAMED HERE, from the table this node runs on (reviewer-credential-routing,
// A-26). That table is the run's FROZEN contract, so no caller may compute the line itself: three plan
// reviews found a caller printing it from a different table than the one that ran. Every caller shows
// this stderr: remediate inherits it, bench-second-opinion logs it, run-graph inherits it.
{
  const own = ADAPTERS.overrides.find((o) => o.name === runtimeName);
  if (own) process.stderr.write(`spawn-node: ${overrideLine(own)}
`);
}
// RUNTIME-NEUTRAL NAMES, because the mechanism already is and the names said otherwise.
//
// The command comes from the ADAPTER (`RUNTIME.cmd`) exactly like a reviewer's does, so this file has
// been able to spawn any declared node runtime for as long as the table has existed. It was spelled
// `claude`-prefixed names (Bin, Prefix, Cmd), which tells every reader — and every future editor —
// that the spawner is Claude-specific. This repository already removed the same residue on the
// reviewer side, where `'agy'` sat in five places while the vendor was supposedly a parameter: "the
// vendor is a parameter, never a literal" (G-41, G-55). A name is the cheapest kind of literal.
//
// THE FLAG TOO, SINCE 2026-11-11 (operator: "A. Rename, keep an alias (Recommended)", panel decision
// 20261111-172326-aaa7f7): `--runtime-bin` overrides the resolved runtime command. The earlier reasoning here, that the
// old spelling stayed because existing fixtures passed it, is superseded: the fixtures moved, and the old spelling is an
// alias for one release that warns (lib/argv-specs.mjs owns the pair). Its value is `runtimeBin` (G-13 of
// 20261105-163851-crsf-d1-review).
// The command and whether it runs under this node are lib/argv-specs.mjs runtimeLaunch's, the one owner (G-6 of
// 20261111-192009-runtime-bin-remediation-review).
const { cmd: runtimeCmd, prefix: runtimePrefix } = runtimeLaunch(args.runtimeBin, RUNTIME.cmd, process.execPath);


// The intent node gets its own narrower policy. --add-dir alone does NOT confine it: an
// unscoped tool rule in the settings file outranks the directory sandbox, so Rule 2 lives or
// dies on this file being the right one.
// FAIL CLOSED. The old form fell back to node-settings.json when intent-settings.json was
// missing — silently handing the intent node the WIDER policy, which grants Read over the whole
// repo. That is precisely the source tree Rule 2 exists to keep it from seeing, so a missing
// file did not disable the sandbox, it inverted it, and the run continued looking normal. A
// control that degrades open is worse than no control: nothing in the artifacts would show that
// the criteria had been captured with the implementation in view.
let settingsPath;
// A settings path with its FOLDER as the filesystem spells it (canonicalSpelling): one file named through an 8.3 short
// spelling of the run directory is the same file. The file's own level is left as named, so a link standing there
// reaches the link check below rather than being respelled or refused as another file.
// The folder on its real path since ci-path-identity.plan.md stage 1c (rootSpelling): it is the run directory, compared
// with the admitted one, which is real; on macOS a --settings under /var was refused against /private/var.
const respelled = (p) => path.join(rootSpelling(path.dirname(path.resolve(p))), path.basename(p));
if (args.settings) {
  // In intent mode the settings file IS the Rule 2 sandbox, so a caller-supplied override must be
  // the generated intent-settings.json — accepting an arbitrary file let a direct spawn-node call
  // hand the intent node bare Read/Grep and defeat the source-before-intent sandbox (G-40). The
  // orchestrator never passes --settings for an intent node, so this only closes a CLI surface.
  //
  // Matched on the RESOLVED PATH, not the basename. `path.basename(...) !== 'intent-settings.json'`
  // accepted any file anywhere with that name — /tmp/mine/intent-settings.json passed a guard whose
  // whole job is to ensure this is the file the ORCHESTRATOR generated for THIS run (G-47). A
  // name is not an identity, and the sandbox this protects is the one keeping intent-capture from
  // reading the implementation it is supposed to precede.
  if (mode === 'intent') {
    const expected = path.join(runDir, 'intent-settings.json');
    if (respelled(args.settings) !== respelled(expected)) {   // one file however spelled (8.3, CI run 43281517496)
      die(`intent mode requires this run's generated ${expected}; refusing --settings ${args.settings} (§5, G-40/G-47)`);
    }
  }
  if (mode === 'remediate') {
    const expected = path.join(runDir, 'remediate-settings.json');
    if (respelled(args.settings) !== respelled(expected)) {   // one file however spelled (8.3, CI run 43281517496)
      die(`remediate mode requires this run's generated ${expected}; refusing --settings ${args.settings}`);
    }
  }
  settingsPath = args.settings;
} else if (mode === 'remediate') {
  // ITS OWN POLICY, FAIL CLOSED (remediate-rebuild stage 3): the edit grants scoped to the contract's globs and the
  // commit script live only in the remediation run's remediate-settings.json. The lens policy denies every edit, so
  // falling back to it would hand a remediator a policy under which it cannot do its job and would look broken rather
  // than unconfigured; there is no fallback.
  settingsPath = path.join(runDir, 'remediate-settings.json');
  if (!policyPresent()) {
    die(`remediate-settings.json not found at ${settingsPath} — a remediate node runs only in a remediation run `
      + '(new-run --remediates), under the policy that run generated');
  }
} else if (mode === 'intent') {
  settingsPath = path.join(runDir, 'intent-settings.json');
  if (!policyPresent()) {
    die(
      `intent-settings.json not found at ${settingsPath} — refusing to run intent-capture under ` +
        `the wider node policy. Rule 2 depends on this file being the right one; falling back ` +
        `would let the node read the implementation it is supposed to precede.`,
    );
  }
} else {
  settingsPath = path.join(runDir, 'node-settings.json');
}
// A POLICY BELOW THE RUN IS CHECKED THROUGH THE OWNER (G-23 of 20261029-050428-rdd-delivery): composed lexically, a link
// standing at intent-settings.json or remediate-settings.json redirected the policy the node runs under.
// THE RUN IS THE SAME DIRECTORY, NOT THE SAME STRING (G-23 of 20261029-055946-rdd-remediation-review): a string compare
// let a differently cased spelling on a case-insensitive filesystem skip the check. The directory's identity decides.
const sameDir = (a, b) => {
  if (a === b) return true;
  try { const x = fs.statSync(a, { bigint: true }); const y = fs.statSync(b, { bigint: true }); return x.dev === y.dev && x.ino === y.ino; } catch { return false; }
};
if (sameDir(path.dirname(path.resolve(settingsPath)), runDir)) {
  try { settingsPath = owner.resolve([path.basename(settingsPath)]); } catch (e) { die(`${nodeId}: policy file ${e.message}`); }
}

function sha256File(p) {
  try {
    // Below the run through its owner (run-dir-reads.plan.md stage 4): the report, and a policy file in the run.
    const segs = belowRun(p);
    return crypto.createHash('sha256').update(segs ? owner.read(segs, null) : fs.readFileSync(p)).digest('hex');
  } catch {
    return null;
  }
}

// The node's report is tracked with the run and quotes what the model wrote: through the one redaction owner (1b).
function writeTrackedReport(p, text) {
  owner.replace(['nodes', path.basename(p)], redactClaim(text));
}

function writeStatusAtomic(obj) {
  // Temporary file + fsync + rename, through the owner's atomic replace. A SIGKILL mid-write must never leave half a
  // JSON file — that would read as a MISSING lens rather than a CRASHED one, which is the exact distinction §7 exists
  // to preserve. REDACTED (ledger-trust-boundaries 1b): the status file is tracked, and its validator_errors and
  // not_checked can carry the vendor's or the model's text.
  owner.replace(['nodes', path.basename(statusPath)], JSON.stringify(redactTree(obj), null, 2) + '\n');
}

// ---------------------------------------------------------------------------- schema variants
// fileURLToPath, not URL.pathname: on Windows the latter yields "/F:/full%20local%20search/..."
// — a leading slash that path.join turns into a doubled drive letter, and percent-encoded
// spaces that never decode. It happens to work on POSIX paths without spaces, which is why it
// survived the first delivery.
const BASE_SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verdict.schema.json');

// DELETED: a per-lens DEFAULT_BASIS table used to live here, duplicating lens-roster.json.
//
// It did not merely go stale — it REVERSED a deliberate degradation. The roster sets arch-review's
// degraded_basis to ['convention','invariant'] when doc_roles.architecture is undeclared, precisely
// so the lens cannot cite an architecture document that does not exist; the fallback handed it
// ['architecture_doc','invariant','convention'] and gave the citation right back. Two files claimed
// authority over the same decision and disagreed about the case that matters.
//
// The roster owns basis. run-graph resolves it (including degradation), writes it into
// expected.json, and passes it as --allowed-basis. A lens node with no basis is a configuration
// error, not an invitation to guess: guessing is what produced the reversal.
// The rule itself lives in lib/decisions.mjs so the regression suite exercises the SAME code this
// script runs, not a copy of it. A test against a duplicate proves the duplicate works.

function requireAllowedBasis(id, override) {
  try {
    return resolveAllowedBasis(id, override);
  } catch (e) {
    die(e.message);
  }
}

function variantFor(variant, id, allowedBasisOverride) {
  // A prose node has no schema. This used to fall through and build a verdict schema that the
  // caller then discarded (line ~742 skips --json-schema for `none`) — harmless waste, until
  // removing the basis fallback turned that fall-through into a fatal `die()` and would have
  // killed second-opinion outright. Stating it here is what the variant actually means.
  if (variant === 'none') return null;

  if (variant === 'ping') {
    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'note'],
      properties: { ok: { type: 'boolean' }, note: { type: 'string', minLength: 1 } },
    };
  }

  // A request document, as structured data. The node emits this; run-graph.mjs renders the
  // markdown. Same split as `intent` and for the same reason (§8.1): a node that writes files
  // writes them whether or not its output validated, so a malformed request would land on disk
  // looking exactly like a good one. Here an invalid payload produces no document at all.
  if (variant === 'request') {
    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['schema_version', 'slug', 'title', 'what', 'why', 'acceptance_criteria',
                 'non_goals', 'expected_surface', 'needs_input', 'not_checked'],
      properties: {
        schema_version: { const: 1 },
        slug: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 60 },
        title: { type: 'string', minLength: 10 },
        milestone: { type: 'string' },
        what: { type: 'string', minLength: 40 },
        why: { type: 'string', minLength: 40 },
        // minItems 1 / maxItems 12: a request with no criterion is not a request, and one with
        // thirty is a specification nobody will check. The lens turns each into an I-n it must
        // judge, so the count is a real cost, not a style preference.
        acceptance_criteria: {
          type: 'array', minItems: 1, maxItems: 12,
          items: { type: 'string', minLength: 20 },
        },
        // Required and non-empty. Non-goals are the boundary that stops a conformance lens
        // reporting the rest of the unbuilt product as violations — the exact failure that made
        // this whole mechanism necessary. A drafter that omits them has not drawn the boundary.
        non_goals: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 10 } },
        expected_surface: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 3 } },
        // Deliberately allowed to be empty, but the skill says an empty one is suspicious on a
        // substantial request. The schema cannot judge that; the reader can, and the field is
        // present either way so its emptiness is visible rather than absent.
        needs_input: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 10 } },
        // Present because the brief instructs the node to record conflicts here, and a schema with
        // additionalProperties:false silently discards a field the prose asked for — the node
        // obeys, the CLI rejects, and the information is gone. The first recovery run reported
        // exactly this: three declared documents it could not reach, with nowhere to put them.
        not_checked: {
          type: 'array', maxItems: 20,
          items: {
            type: 'object', additionalProperties: false,
            required: ['item', 'reason'],
            properties: { item: { type: 'string', minLength: 3 }, reason: { type: 'string', minLength: 10 } },
          },
        },
      },
    };
  }

  if (variant === 'intent') {
    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['schema_version', 'run_id', 'criteria', 'assumed_contract_unverified', 'not_checked'],
      properties: {
        schema_version: { const: 1 },
        run_id: { type: 'string', pattern: '^[0-9]{8}-[0-9]{6}-[a-z0-9-]+$' },
        criteria: {
          type: 'array',
          minItems: 1,
          maxItems: 60,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'behaviour', 'io_contract', 'failure_modes'],
            properties: {
              id: { type: 'string', pattern: '^I-[0-9]{1,3}$' },
              behaviour: { type: 'string', minLength: 20 },
              io_contract: { type: 'string', minLength: 5 },
              failure_modes: { type: 'array', items: { type: 'string', minLength: 5 }, maxItems: 12 },
            },
          },
        },
        assumed_contract_unverified: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['assumption', 'why_unverifiable'],
            properties: {
              assumption: { type: 'string', minLength: 10 },
              why_unverifiable: { type: 'string', minLength: 10 },
            },
          },
        },
        not_checked: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['item', 'reason'],
            properties: { item: { type: 'string' }, reason: { type: 'string' } },
          },
        },
      },
    };
  }

  if (variant === 'gate') {
    // plan-review is a PRE-run gate, not a graph node: it judges a proposed plan against the
    // declared roadmap before a run directory exists. Its shape is deliberately not the verdict
    // envelope — it reports scope decisions, not defects, and has no file/line/evidence to cite.
    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['schema_version', 'verdict', 'settings', 'in_scope', 'scope_creep', 'premature_decision', 'missing', 'defective', 'not_checked'],
      properties: {
        schema_version: { const: 1 },
        verdict: { enum: ['PASS', 'NEEDS_CHANGES', 'BLOCKED'] },
        // The model and effort the round ran at, set by the caller from the values it pinned and checked against them
        // (G-4 of 20261018-195709-pins-review): plan-review records both with each round, and had nowhere to.
        settings: {
          type: 'object',
          additionalProperties: false,
          required: ['model', 'effort'],
          properties: {
            model: { type: 'string', minLength: 1 },
            effort: { type: ['string', 'null'] },
          },
        },
        in_scope: {
          type: 'array',
          maxItems: 60,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['item', 'source'],
            properties: {
              item: { type: 'string', minLength: 5 },
              source: { type: 'string', minLength: 3 },
            },
          },
        },
        scope_creep: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['item', 'defer_to', 'why', 'justified_pull_forward'],
            properties: {
              item: { type: 'string', minLength: 5 },
              defer_to: { type: 'string', minLength: 1 },
              why: { type: 'string', minLength: 15 },
              // Pulling work forward is sometimes right. Saying so explicitly stops this from
              // being a rubber stamp in either direction.
              justified_pull_forward: { type: 'boolean' },
            },
          },
        },
        premature_decision: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['decision', 'trigger', 'why'],
            properties: {
              decision: { type: 'string', minLength: 5 },
              trigger: { type: 'string', minLength: 1 },
              why: { type: 'string', minLength: 15 },
            },
          },
        },
        // The inverted check: gate items the plan fails to cover. Worse than extra items,
        // because they are what blocks the milestone from shipping.
        missing: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['item', 'source'],
            properties: {
              item: { type: 'string', minLength: 5 },
              source: { type: 'string', minLength: 3 },
            },
          },
        },
        // An item that is PRESENT but wrong: a list offered as the set with no authority, or a change its consumer
        // would refuse (.claude/requests/plan-authoring-sets-and-consumers.md). Fixed where it stands, not by adding
        // work, which is why it is not `missing` (G-5 of 20261018-063803-pa-review).
        defective: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['item', 'why', 'source'],
            properties: {
              item: { type: 'string', minLength: 5 },
              why: { type: 'string', minLength: 15 },
              source: { type: 'string', minLength: 3 },
            },
          },
        },
        not_checked: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['item', 'reason'],
            properties: {
              item: { type: 'string', minLength: 1 },
              reason: { type: 'string', minLength: 5 },
            },
          },
        },
      },
    };
  }

  if (variant === 'remediation') {
    // THE REMEDIATION REPORT (remediate-rebuild stage 4). One row per confirmed group the node was given: what it did,
    // both halves of the experiment (the red capture and the green one), the commit that closed it, the search for the
    // same defect elsewhere (its exact command) and every other instance it deferred to the ledger with its reason
    // (shared/remediation.md). The runner, not the node, records the dispositions and mints the follow-up review.
    const str = { type: 'string' };
    // A census entry, and the reason that must say so when no spelling was found, cannot be "" (G-6 of
    // 20261017-031552-ogsc-review): `{ site: "", reason: "" }` validated as a judged site.
    const nonEmpty = { type: 'string', minLength: 1 };
    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['schema_version', 'run_id', 'groups', 'summary'],
      properties: {
        schema_version: { const: 1 },
        run_id: { type: 'string', pattern: '^[0-9]{8}-[0-9]{6}-[a-z0-9-]+$' },
        groups: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            // The census names come from the one definition the follow-up's census counts (G-2).
            required: ['group_id', 'disposition', 'reason', 'red_evidence', 'green_evidence', 'no_red', 'stop_reason', 'limit_kind',
              'stop_cause', 'cluster', 'files', 'search_command', ...CENSUS_FIELDS, 'deferred'],
            properties: {
              group_id: { type: 'string', pattern: GROUP_ID_RE.source },
              disposition: { type: 'string', enum: ['fixed', 'partial', 'not-fixed', 'declined'] },
              reason: nonEmpty,
              red_evidence: { type: 'string', description: schemaField('remediation_red_evidence') },
              green_evidence: { type: 'string', description: schemaField('remediation_green_evidence') },
              // A FIX WITH NO POSSIBLE RED, DECLARED (remediation-evidence-rules.plan.md stage 2, design E-D2 A): the reason,
              // or null. The runner admits a declared group in any cluster and records the reason for the follow-up review.
              no_red: { type: ['string', 'null'], description: schemaField('remediation_no_red') },
              // WHY A GROUP STOPPED SHORT (remediation-consumer-findings.plan.md stage 4): on every group, null where it does
              // not apply (G-16 of 20261021-014056-rcf-delivery); the runner's report check holds a not-fixed or partial
              // group to a stop_reason and a `limit` claim to the node's own record.
              stop_reason: { type: ['string', 'null'], enum: ['not-attempted', 'blocked', 'limit', null], description: schemaField('remediation_stop_reason') },
              limit_kind: { type: ['string', 'null'], enum: ['session-time', 'turns', 'budget', null], description: schemaField('remediation_limit_kind') },
              stop_cause: { type: ['string', 'null'], description: schemaField('remediation_stop_cause') },
              cluster: { type: 'string', description: schemaField('remediation_cluster') },
              files: { type: 'array', items: { type: 'string' }, description: schemaField('remediation_files') },
              search_command: { type: 'string', description: schemaField('remediation_search_command') },
              // THE CENSUS (observation-guard-and-sibling-census.md, B): what the search matched, what it judged outside
              // the rule, and what its shape could not match. The follow-up review is pointed at it. Built from the one
              // table that also names them in `required` (G-4 of 20261017-040138-ogsc-remediation-review).
              ...Object.fromEntries(CENSUS_FIELDS.map((f) => [f,
                { type: 'array', items: CENSUS_ITEMS[f], description: schemaField(`remediation_${f}`) }])),
              deferred: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['file', 'line', 'severity', 'claim', 'reason'],
                  properties: {
                    file: str, line: { type: 'integer', minimum: 0 },
                    severity: { type: 'string', enum: ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'] }, claim: str, reason: str,
                  },
                },
              },
            },
          },
        },
        summary: str,
      },
    };
  }
  if (variant === 'remediation-repair') {
    // THE REPAIR PASS'S REPORT (remediation-repair-pass.plan.md stage 1): one row per test the runner's full check failed
    // on, answered after a remediation's fixes. Its own variant, so the group report above is not loosened to carry it;
    // the runner reads it with lib's repairReportErrors.
    const nonEmpty = { type: 'string', minLength: 1 };
    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['schema_version', 'run_id', 'pass', 'failures', 'summary'],
      properties: {
        schema_version: { const: 1 },
        run_id: { type: 'string', pattern: '^[0-9]{8}-[0-9]{6}-[a-z0-9-]+$' },
        pass: { type: 'integer', minimum: 1 },
        failures: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['test_name', 'test_file', 'disposition', 'reason', 'cluster', 'files', 'green_evidence'],
            properties: {
              test_name: { ...nonEmpty, description: schemaField('repair_test_name') },
              test_file: { type: ['string', 'null'], description: schemaField('repair_test_file') },
              disposition: { type: 'string', enum: ['fixed', 'not-fixed'] },
              reason: nonEmpty,
              cluster: { ...nonEmpty, description: schemaField('repair_cluster') },
              files: { type: 'array', items: { type: 'string' }, description: schemaField('repair_files') },
              green_evidence: { type: 'string', description: schemaField('repair_green_evidence') },
            },
          },
        },
        summary: { type: 'string' },
      },
    };
  }
  if (variant === 'reconcile') {
    // The reconciler judges pre-grouped findings. It does not regroup them and it does not
    // write reconciled.md — the script renders that from this payload (§8.1).
    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['schema_version', 'run_id', 'intent_intact', 'groups', 'summary'],
      properties: {
        schema_version: { const: 1 },
        run_id: { type: 'string', pattern: '^[0-9]{8}-[0-9]{6}-[a-z0-9-]+$' },
        intent_intact: {
          type: 'boolean',
          description: schemaField('intent_intact'),
        },
        groups: {
          type: 'array',
          // ONE OWNER for the batch size: run-graph splits the barrier into batches of this many groups.
          maxItems: RECONCILE_MAX_GROUPS,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['group_id', 'decision', 'severity', 'rationale'],
            properties: {
              group_id: { type: 'string', pattern: GROUP_ID_RE.source },
              decision: {
                type: 'string',
                enum: ['confirmed', 'coincidence', 'symptom', 'dropped'],
                description: schemaField('decision'),
              },
              severity: { type: 'string', enum: ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'] },
              root_cause_group: { type: 'string', pattern: '^(G-[0-9]{1,3}|)$' },
              // The tie-breaker's input. Only the reconciler can set this, because only a model
              // can tell an explicit contradiction from two nodes happening to land nearby —
              // the distinction a script got wrong when `corroborated` was computed mechanically.
              // Silence is not contradiction: a finding one node raised and another never
              // mentioned is not disputed. second-opinion sends only these groups to `agy`.
              disputed: {
                type: 'boolean',
                description: schemaField('disputed'),
              },
              rationale: { type: 'string', minLength: 20, maxLength: 1000 },
            },
          },
        },
        // The summary describes the WHOLE reconciliation, so its length scales with the number of
        // groups, while the cap was a flat 3000. On a 59-group run the reconciler could not fit,
        // failed structured output five times, and the barrier came back BLOCKED after 29.5 minutes
        // with no reconciled.md at all — discarding a $47 review over 382 characters.
        //
        // A schema cap is a BOUND, not a style guide. Enforcing concision here means the penalty
        // for a verbose summary is the loss of every lens's adjudicated output, which is never a
        // trade worth making; concision is the reconcile skill's instruction to give, and prose
        // that runs long is a quality problem a reader can see. So this is now generous enough that
        // exceeding it means something has genuinely gone wrong rather than merely gone long.
        //
        // `rationale` below stays at 1000 deliberately: it is PER GROUP, so it does not scale with
        // group count and 1000 characters for one group was never the constraint that bound.
        summary: { type: 'string', minLength: 20, maxLength: 20000 },
      },
    };
  }

  // Verdict variants derive from the on-disk base document.
  // Through the egress owner (G-15 of 20261112-063354-hl-remediation-4-review): the schema is passed to the runtime.
  const base = JSON.parse(egressReadFile(BASE_SCHEMA_PATH, 'utf8', { repoRoot: FRAMEWORK.frameworkRoot }));
  const finding = base.properties.findings.items;

  // No fallback. The final `['invariant','convention']` default was as dangerous as the per-lens
  // table above it: it would silently grant `invariant` — the one basis that can raise a
  // non-waivable finding — to any node whose basis failed to arrive.
  const allowed = requireAllowedBasis(
    id,
    allowedBasisOverride ? allowedBasisOverride.split(',').map((s) => s.trim()).filter(Boolean) : null,
  );

  if (variant === 'contract') {
    // Contract lenses MUST cite a criterion.
    if (!finding.required.includes('intent_ref')) finding.required.push('intent_ref');
  } else {
    // Every other lens: delete the property outright. With additionalProperties:false already
    // set, the model cannot emit the key at all — impossible rather than merely forbidden.
    // Deliberately NOT expressed as if/then or `not`: structured-output schema support is a
    // subset of JSON Schema, and a silently-dropped conditional is the exact failure this
    // whole design exists to prevent.
    delete finding.properties.intent_ref;
  }

  finding.properties.basis.enum = allowed;
  if (!allowed.includes('invariant')) delete finding.properties.invariant;

  return base;
}

// ---------------------------------------------------------------------------- status skeleton

/**
 * Copy the envelope's token accounting onto the status, verbatim and whole.
 *
 * Verbatim because the provider owns this shape and adds to it — `output_tokens_details`,
 * `cache_creation`, `service_tier` and `iterations` all appeared without notice. Picking four
 * fields to keep would silently drop the fifth the day it starts mattering, and a harvest that
 * needs editing whenever the source grows is a harvest that will be out of date.
 *
 * It never overwrites a value it already has with a null: this runs twice — once early, so a node
 * that spends money and THEN fails still records what it spent, and again if the envelope parses.
 * The early figure is real, and the second pass must not erase it on a partial envelope.
 */
function harvestUsage(src, status) {
  if (src && typeof src.usage === 'object' && src.usage !== null) status.usage = src.usage;
  if (src && typeof src.modelUsage === 'object' && src.modelUsage !== null) status.model_usage = src.modelUsage;
}

const sessionId = crypto.randomUUID();
const depth = INHERITED_DEPTH + 1;

let status = {
  schema_version: 1,
  run_id: runJson.run_id ?? path.basename(runDir),
  node_id: nodeId,
  state: 'RUNNING',
  mode,
  skill_command: args.skillCommand ?? null,
  model,
  session_id: sessionId,
  cmd: null,
  cwd: null,
  add_dirs: args.addDir.map((d) => path.resolve(d)),
  settings_path: path.relative(runDir, settingsPath),
  settings_sha256: sha256File(settingsPath),
  graph_node_depth: depth,
  started_at: new Date().toISOString(),
  ended_at: null,
  duration_ms: null,
  exit_code: null,
  signal: null,
  timed_out: false,
  killed_tree: false,
  stdout_bytes: 0,
  stderr_bytes: 0,
  stdout_path: path.relative(runDir, stdoutPath),
  stderr_path: path.relative(runDir, stderrPath),
  envelope_parsed: false,
  verdict_json_valid: false,
  validator_errors: [],
  verdict: null,
  findings_count: 0,
  rejected_findings_count: 0,
  permission_denials_count: 0,
  total_cost_usd: null,
  // TOKENS, not just dollars. The envelope has always carried a full `usage` block — input,
  // output, both cache tiers, thinking tokens — and this file harvested only the price. That made
  // every artifact unable to answer the one question an operator on a token-window quota actually
  // has ("how much of the window did that run cost?"), while the answer sat in stdout.json and was
  // deleted with the worktree. Dollars are a derived figure; tokens are the thing being spent.
  usage: null,
  model_usage: null,
  // THE CLOCK THAT GOVERNED THIS NODE. Recorded always, not only when it fires — the timeout used
  // to appear solely inside the validator_errors string of a node that was killed, so a node that
  // SURVIVED could not say what ceiling it survived. Verifying that contract-audit's new 30-minute
  // clock was actually applied meant inferring it from "ran 16.4 minutes and was not killed",
  // when the artifact should simply have said. Same rule as contract_source and worktree_sha: a
  // run that cannot state what governed it is not reproducible.
  timeout_minutes: timeoutMs / 60_000,
  num_turns: null,
  stop_reason: null,
  subtype: null,
  report_path: null,
  report_sha256: null,
  skip_reason: null,
};

// Last-resort flush: an unexpected throw must still leave a terminal status behind.
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (err) => {
    try {
      status.state = 'BLOCKED';
      status.validator_errors = [`${ev}: ${(err && err.stack) || String(err)}`];
      status.ended_at = new Date().toISOString();
      writeStatusAtomic(status);
    } catch {
      /* nothing left to do */
    }
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------- build argv
function buildPrompt() {
  if (args.prompt) return args.prompt;
  if (!args.skillCommand) die('one of --prompt or --skill-command is required');

  const relBrief = path.relative(cwd, effectiveBriefPath);
  // FROM THE PROMPT LIBRARY. This was the fourth place model-facing prose lived in the engine,
  // after the run brief, the external-arm prompts and the schema descriptions. It is short, which
  // is exactly why it stayed: every sentence here reaches every node in every run, and a rule that
  // small hides in a spawner while governing the whole graph.
  let head = renderTemplate(readTemplate('node-head-slash.md'), {
    skill_command: args.skillCommand,
    brief_path: relBrief,
  }, 'node-head-slash.md');

  if (args.inlineSkill) {
    // Fallback for nodes whose cwd is the run dir, where slash-command discovery may not reach
    // the repo's .claude/skills. The brief still governs.
    const skillName = args.skillCommand.replace(/^\//, '');
    // From THIS engine's location, not from the repo under review. A node's instructions come from
    // the framework doing the reviewing, never from the tree being reviewed — otherwise pointing
    // --repo-root at another project would feed its skills to this run.
    // `prompts/` first, then `skills/`. The twelve node contracts moved out of the skills namespace
    // because no person can invoke one — each refuses to run outside a run directory — while the ten
    // a person does invoke stayed. Both remain reachable here, so a node is found wherever its
    // instructions actually live.
    // An explicit path wins, and ONLY because the orchestrator vouched for it: it is inside the
    // repository under review, resolved through links, and named by a contract frozen into run.json.
    // Name-based resolution below is unchanged and still framework-only.
    const found = args.instructions
      ? { file: path.resolve(args.instructions), home: 'declared' }
      : nodeInstructions(FRAMEWORK, skillName);
    if (args.instructions && !fs.existsSync(found.file)) {
      die(`--instructions ${args.instructions} does not exist. A project-authored lens whose `
        + 'instructions are missing must not fall back to anything: the node would be spawned with a '
        + 'different contract than the one the contract declared.');
    }
    // FATAL when absent. This used to fall through to the un-inlined prompt, silently reinstating
    // the dependency on the child resolving a slash command — the exact thing inlining removes.
    // Same failure shape as the dead severity clamp: a guarantee that quietly becomes a no-op.
    if (!found) {
      die(`--inline-skill was requested but no instructions exist for '${skillName}': looked in `
        + `${FRAMEWORK.promptsDir} and ${FRAMEWORK.skillsDir}. Refusing to fall back to `
        + 'slash-command resolution, which would silently change how this node is instructed.');
    }
    const file = found.file;
    head = renderTemplate(readTemplate('node-head-inline.md'), {
      // Through the egress owner (G-15 of 20261112-063354-hl-remediation-4-review): this goes into the node's prompt.
      instructions: egressReadFile(file, 'utf8', { repoRoot: FRAMEWORK.frameworkRoot }),
      brief_path: relBrief,
    }, 'node-head-inline.md');
  }

  // Kept short and stable across nodes so prompt caching survives the fan-out — measured cost
  // is dominated by cache-creation tokens.
  //
  // The output instruction follows the variant. "Emit only the JSON object" was appended
  // unconditionally, including to the one node spawned with `none` — which suppresses
  // --json-schema and routes to a handler whose own comment says a prose node "has no structured
  // output BY DEFINITION". second-opinion was therefore told to produce the exact opposite of what
  // its handler and its skill's Output section expect, and it complied: the report it returned on
  // the last sweep opens "Verification complete. Emitting the verdict object." followed by a JSON
  // block, which the prose branch then wrote out verbatim as if it were prose.
  const outputRule = readTemplate(
    schemaVariant === 'none' ? 'node-output-prose.md' : 'node-output-json.md',
  );
  const tail = renderTemplate(readTemplate('node-tail.md'), { depth }, 'node-tail.md');
  // Joined with single spaces, which is what the assembled literal produced. The join is code
  // because it is structure; every sentence it joins is now editable without touching this file.
  return `${head} ${outputRule} ${tail}`;
}

// ---------------------------------------------------------------------------- child environment
// A node inherits the parent environment, which on a developer machine carries two things that
// break it. Both are stripped here rather than left to the caller: an orchestrator that fans out
// eight nodes cannot rely on whoever invoked it having remembered to unset a variable, and a
// failure from either cause costs real tokens before it surfaces.
//
//   1. Nested-invocation guard. CLAUDECODE / CLAUDE_CODE_ENTRYPOINT are set inside a Claude Code
//      session. A `claude -p` child that inherits them can refuse to launch or hang, since it
//      looks like Claude Code starting inside Claude Code. Always stripped; there is no case
//      where a graph node wants to be seen as a nested session.
//
//   2. Auth precedence. ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN outrank subscription
//      credentials. Subscription auth is per-user (keychain, or ~/.claude/.credentials.json), so
//      a child running as the same user with the same HOME inherits it with no plumbing — but
//      only if no key variable shadows it. A stale or empty-balance key produces a 400 after the
//      node has already burned its turns, which is the worst possible failure shape.
//
// --auth subscription (default): strip the key variables, let per-user credentials apply.
// --auth inherit: keep the VENDOR auth that subscription mode strips. Correct for CI and
//      containers, where the API key or an explicit CLAUDE_CODE_OAUTH_TOKEN is the intended and
//      only credential.
//
//      It does NOT pass the parent environment through, and the earlier wording saying so was
//      wrong in the dangerous direction: scrubChildEnv runs first and removes foreign secrets
//      (GITHUB_TOKEN, AWS_*, DATABASE_URL) in BOTH modes. Implementing the prose literally would
//      have disabled the credential scrub this same file justifies two paragraphs down — an
//      agentic child that can run declared commands has no business holding an unrelated cloud
//      key. The two modes differ only in whether ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN
//      survive (G-48: the intent was derived from the overstatement, not from the code).
// FROM THE ONE OWNER (the BLOCKER). This was a local ['subscription','inherit'] while every arm and
// judge status recorded 'external-vendor', written directly by run-graph and validated against
// nothing — a vocabulary that omitted a value the field actually carried.
const authMode = args.auth ?? 'subscription';
if (!AUTH_MODES.includes(authMode)) die(`--auth must be one of ${AUTH_MODES.join('|')}`);

// Secrets are scrubbed by PATTERN, not by a fixed deny-list (G-42): a node is an agentic
// child that can invoke declared commands through capture.mjs, so an unrelated GITHUB_TOKEN,
// AWS_* or DATABASE_URL crossing into it is a real exposure. scrubChildEnv keeps the vendor's own
// auth and the toolchain env — a node-runtime child cannot allow-list without breaking its own login —
// and removes anything secret-shaped by name. Residual named at its definition.
const { env: scrubbedBase, scrubbed: strippedEnv } = scrubChildEnv(process.env, { runtime: RUNTIME });
// THE RUN THIS NODE BELONGS TO, carried to capture.mjs (G-5, security-audit). capture confines
// --run-dir to the repository and then reads THAT directory's run.json for its command allow-list —
// so ANY valid run directory in the tree decides what the node may execute, not this run's. That is
// not a stray-directory problem: run.json is a TRACKED artifact, so every project mounting this
// submodule inherits committed run directories whose frozen contracts become allow-lists for its own
// lenses. Demonstrated live from a lens, which reached a second project's declared commands
// (`python -m pytest`, `ruff check`) while this repository declares lint and typecheck empty on
// purpose. G-6 closed the COUNTERFEIT run.json case; a legitimate one belonging to a different
// contract passed that check unchanged.
//
// The node cannot forge this: it is set by the spawner, outside the model's reach, exactly like the
// depth guard beside it.
const childEnv = {
  ...scrubbedBase,
  GRAPH_NODE_DEPTH: String(depth),
  QUORATE_RUN_ID: String(runJson.run_id ?? ''),
  // Which node this is, for the session records' lines (session-record-files.plan.md stage 3), beside the run id.
  QUORATE_NODE_ID: String(args.nodeId),
  // THE NODE'S CLOCK (remediation-consumer-findings.plan.md stage 3): when it started and how long it may run, so every
  // capture it makes can say how much has passed (lib/capture-header.mjs's elapsedLine). Not secret-shaped, unlike a
  // QUORATE_SESSION_* name, which the scrub would strip.
  QUORATE_NODE_STARTED_AT: new Date().toISOString(),
  QUORATE_NODE_TIMEOUT_MINUTES: String(timeoutMs / 60_000),
};
// The session markers always, and under subscription the API key and auth token: one owner, shared with
// spawn-subagent.mjs (runtimeSessionEnv), whose names are this runtime adapter's node_runtime.session_env.
{
  const session = runtimeSessionEnv(childEnv, { authMode, runtime: RUNTIME });
  for (const k of Object.keys(childEnv)) if (!(k in session.env)) delete childEnv[k];
  Object.assign(childEnv, session.env);
  strippedEnv.push(...session.stripped);
}
status.auth_mode = authMode;
status.env_stripped = strippedEnv;

// A SEVERITY is how bad one finding is; a VERDICT is what the node concludes overall. They were
// one parameter, and the roster's `degraded_ceiling: "RISK"` — a verdict — was passed to
// --severity-ceiling, where the clamp quietly skipped anything it did not recognise. Every
// degraded lens therefore ran with no severity cap at all while expected.json, the brief and the
// documentation all said it had one.
//
// Validated here, and FATALLY. A cap that silently does nothing when misconfigured is worse than
// no cap: it produces the paperwork of a guarantee without the guarantee, and nothing downstream
// can tell the difference.
if (args.severityCeiling && !SEVERITY_RUNGS.includes(args.severityCeiling)) {
  die(`--severity-ceiling must be one of ${SEVERITY_RUNGS.join('|')}, got ${JSON.stringify(args.severityCeiling)}` +
      ` (a verdict like RISK belongs in --verdict-ceiling)`);
}
if (args.severityFloor && !SEVERITY_RUNGS.includes(args.severityFloor)) {
  die(`--severity-floor must be one of ${SEVERITY_RUNGS.join('|')}, got ${JSON.stringify(args.severityFloor)}`);
}
if (args.verdictCeiling && !VERDICTS.includes(args.verdictCeiling)) {
  die(`--verdict-ceiling must be one of ${VERDICTS.join('|')}, got ${JSON.stringify(args.verdictCeiling)}`);
}
// HERE AS WELL AS AT MINT (G-9 of 20261111-024650-dps-remediation-11-review): run-graph reads the live roster, so one edited
// after mint arrives unchecked, and a verdict ceiling lowers a verdict: PASS would record a failing lens as passing.
if (args.verdictCeiling === 'PASS') {
  die('--verdict-ceiling PASS would turn every verdict into PASS; the node is not run');
}
status.severity_ceiling = args.severityCeiling ?? null;
status.severity_floor = args.severityFloor ?? null;
status.verdict_ceiling = args.verdictCeiling ?? null;

const schema = variantFor(schemaVariant, nodeId, args.allowedBasis);
const isSandboxedCwd = mode === 'intent' || mode === 'reconcile';

// An intent node's cwd is a dedicated EMPTY directory, not the run directory.
//
// The run directory is not a safe sandbox floor: by the time an intent node runs, it holds
// evidence/pre-flight/build.log and test.log, which are full of the implementation's own symbol
// and test names. A cwd is implicitly readable regardless of --add-dir, so pointing an intent node
// at the run directory quietly handed it the thing it is forbidden to see — and the guarantee that
// its output is not archaeology of the diff rested on the node choosing not to look. A recovery
// node found this and declined to open them; the next one might not, and nothing downstream could
// tell the difference.
//
// reconcile keeps the run directory, and must: enumerating status files IS its job, and it runs
// after the lenses have already read the source, so there is nothing left to protect it from.
// A REQUIRED INPUT REFUSED BEFORE LAUNCH (G-12 of 20261115-013659-pbr-1b-delivery; ARCHITECTURE.md §4, A-30): die() exited before
// the pre-spawn status write, so the node left no status naming the cause. It is recorded BLOCKED, not launched, and the
// exit is 1, as the last-resort flush above exits after its BLOCKED write: a refusal is not a success, and run-graph reads
// the status file, not the exit code.
// The status is tracked, so the cause is said relative to the run, in the owner's words; the error's own message names
// this host's run directory and goes to stderr only.
// The cause is the owner's sentence (lib/egress-read.mjs refusalCause; G-28 of 20261116-221234-m2-9a-high-2): an absence
// was said here as "refused (ENOENT)", in words run-graph never used.
function blockBeforeLaunch(msg, e = null) {
  console.error(`spawn-node: ${msg}${e?.message ? ` (${e.message})` : ''}`);
  status.state = 'BLOCKED';
  status.launched = false;
  status.validator_errors = [msg];
  status.ended_at = new Date().toISOString();
  writeStatusAtomic(status);
  process.exit(1);
}
let cwd;
if (mode === 'intent') {
  // THROUGH THE ONE OWNER (G-18 of 20261023-014400-rdt-delivery; run-dir-descendants stage 2): a junction planted at
  // sandbox/<node-id> pointing at the implementation passed every lexical check and gave intent-capture the source. The
  // owner refuses a link at sandbox/ or sandbox/<node-id>, wherever it leads.
  try { cwd = owner.dir(['sandbox', nodeId]); } catch (e) { blockBeforeLaunch(`sandbox/${nodeId}: ${refusalCause(e)}; refusing to start an intent node there`, e); }
} else {
  cwd = isSandboxedCwd ? runDir : repoRoot;
}

// The brief travels into the sandbox with the node, because nodes/ is now outside its floor.
const effectiveBriefPath = mode === 'intent' ? path.join(cwd, 'brief.md') : briefPath;
if (mode === 'intent' && !owner.isFree(['nodes', path.basename(briefPath)])) {
  // Through the egress owner (G-10 of 20261114-184441-m2-pred1-remediation-b-review): the brief enters the intent sandbox,
  // so a file with a second name, a hard link the confined owner's lstat cannot see, is refused, as A-30 holds every
  // other read bound for the sandbox.
  let briefBytes;
  try { briefBytes = egressRunReader(runDir).read(['nodes', path.basename(briefPath)], null); } catch (e) { blockBeforeLaunch(`nodes/${path.basename(briefPath)}: ${refusalCause(e)}; refusing to copy it into the intent sandbox`, e); }
  owner.replace(['sandbox', nodeId, 'brief.md'], briefBytes);
}
status.sandbox_cwd = path.relative(runDir, cwd).replace(/\\/g, '/');

// THE VALUES, not the flags. Everything below decides WHAT this node gets; the runtime's
// node_runtime block decides how that is spelled, and lib/decisions.mjs renders it. Until now the
// eleven flags were written out here, which is why the orchestrator had to know a CLI's name.
const nodePrompt = buildPrompt();

// Effort is the depth dial: it moves how much the node thinks and how many tool calls it makes,
// independently of which model runs. Omitted means the CLI default, so an unset --effort leaves
// behaviour exactly as it was before this flag existed. Recorded on the status file next to the
// model, because a finding is only reproducible if you know both.
// FROM THE RUNTIME. This was a hardcoded ['low','medium','high','xhigh','max'] — one CLI's effort
// vocabulary, applied to every node whatever ran it — so a runtime with a different set would have
// had valid values refused and invalid ones passed straight through to a spawn.
if (args.effort) {
  const { errors } = validateAssignment(RUNTIME, {
    model, effort: args.effort, label: `node ${nodeId}`, name: runtimeName,
  });
  if (errors.length) die(errors.join('; '));
}
status.effort = args.effort ?? null;

const schemaJson = schemaVariant !== 'none' ? JSON.stringify(schema) : '';

if (!policyPresent()) {
  // Fatal for EVERY mode, not just lenses. The old form let reconcile, panel and remediate run
  // with no --settings at all after merely noting it in validator_errors — a node with no
  // policy file has no allow-list, which is the widest possible configuration reached by the
  // narrowest possible signal. Nothing downstream reads validator_errors as a reason to
  // distrust a verdict, so the run looked ordinary.
  die(`policy file not found at ${settingsPath} — no node runs without one (mode: ${mode})`);
}

// FAIL CLOSED for intent. Defaulting to [repoRoot] handed an intent node the whole repository
// when no --add-dir was passed — the exact source tree Rule 2 exists to hide from it, reached by
// omitting an argument rather than by setting one. Every other mode is legitimately repo-scoped.
if (mode === 'intent' && !args.addDir.length) {
  die(
    'intent mode requires an explicit --add-dir: defaulting to the repo root would hand the ' +
      'intent node the implementation it is supposed to be written before.',
  );
}
const addDirs = (args.addDir.length ? args.addDir : [repoRoot]).map((d) => path.resolve(d));

// Denials ride on the FLAG, not the settings file. A settings file that fails validation is
// SILENTLY IGNORED in -p mode; a flag cannot be silently dropped. If the file is ignored the
// node is over-restricted and fails loudly, rather than quietly running unsandboxed.
// The set is owned by lib/decisions.mjs and rendered here. It used to be a second hand-maintained
// copy of new-run's list, which is how PowerShell stayed missing from both for months.
const unsandboxed = mode === 'remediate' && args.unsandboxed;
const denied = unsandboxed ? [] : denyToolsFor(mode, RUNTIME);
// RECORDED ON THE NODE TOO (G-24 of 20261008-214527-remediate-rebuild-review): the lift is the operator's choice, and a
// status that cannot say whether its node ran sandboxed hides the one fact a reviewer of its diff needs first.
status.sandboxed = !unsandboxed;

// acceptEdits would auto-approve exactly the tool class being denied. `auto` delegates approval
// to a classifier, which is the opposite of a deterministic sandbox. bypassPermissions appears
// in exactly one place in this system and this is it.
// RENDERED FROM THE RUNTIME. One call replaces eleven inline pushes, and the sequence lives in
// lib/decisions.mjs beside the reviewer renderer it mirrors — so a second runtime is a table entry
// rather than a second spawner.
const rendered = nodeArgv(RUNTIME, {
  prompt: nodePrompt,
  model,
  effort: args.effort ?? '',
  schemaJson,
  settingsPath,
  addDirs,
  denyTools: denied,
  sandboxed: !unsandboxed,
  budgetUsd: budgetUncapped ? '' : budgetUsd,
  sessionId,
});
const argv = rendered.argv;

// THE POLICY MUST HAVE REACHED THE ARGV, not merely existed on disk (G-19). The only settings check
// was that the FILE exists; a runtime whose node_runtime declares no `settings` slot renders an argv
// without it, and the node then runs with the policy sitting unread in the run directory — reported
// as sandboxed, sandboxed by nothing. unbackedCapabilities refuses such a runtime at resolution
// time; this is the second layer, checking the rendered result rather than the declaration.
if (!argv.includes(settingsPath)) {
  die(`the policy file was never passed to the runtime: '${runtimeName}' rendered an argv with no `
    + `reference to ${settingsPath}. A node whose policy is not handed to the process is not `
    + 'sandboxed, whatever its capabilities declare.');
}

// --no-session-persistence is deliberately NOT passed: the recorded session_id is what makes
// the runtime's own resume entrypoint able to interrogate the node that produced a bad finding.

status.cmd = [rendered.cmd, ...argv];
status.cwd = cwd;
if (args.printCmd) {
  process.stdout.write(JSON.stringify(status.cmd));
  process.exit(0);
}
writeStatusAtomic(status); // (1) PRE-SPAWN

// ---------------------------------------------------------------------------- run the child
// HOW a child is stopped is io/stop-child.mjs's (stopping-a-child stage 2): SIGTERM, escalated to SIGKILL after five
// seconds on posix, taskkill /T on win32, and the exit SEEN before the child counts as stopped. runChild uses it.

// THE CHILD ITSELF — spawned, watched for its timeout and output cap, killed, reported — is scripts/io/run-child.mjs
// (moved there for 20261001-205530-m0-pending-claims-review G-8, G-9, G-13, with the kill passed in so the refused-kill
// path is tested with a real child). Its reasoning (G-39's watchdog, G-43's refused kill) moved with it.

// ---------------------------------------------------------------------------- validation
function statSizeOr0(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

// A trailing newline is a terminator, not a line. `split('\n')` on "a\nb\n" yields
// ["a","b",""] — three elements for a two-line file — so the bound check `f.line > n` accepted a
// citation one line past the end of every POSIX-conventional file. That is exactly the kind of
// off-by-one that makes an evidence path look verifiable and point at nothing.

function validateVerdict(payload) {
  const errors = [];
  const rejected = [];

  // Envelope-level: a mismatch here means the node is not talking about this run.
  if (payload.run_id !== status.run_id) {
    errors.push(`run_id mismatch: got "${payload.run_id}", expected "${status.run_id}"`);
  }
  if (payload.node_id !== nodeId) {
    errors.push(`node_id mismatch: got "${payload.node_id}", expected "${nodeId}"`);
  }

  // THROUGH THE OWNER (G-24 of 20261029-055946-rdd-remediation-review): a link at the brief is refused, not followed, and a
  // refused brief is read as forbidding intent, the stricter answer.
  let briefText = null;
  let briefRefused = false;
  try { briefText = owner.read(['nodes', path.basename(briefPath)]); } catch (e) { if (e.code === 'ECONFINED') briefRefused = true; else if (e.code !== 'ENOENT') throw e; }
  if (briefRefused) errors.push(`brief refused: ${path.basename(briefPath)} is not a plain file below the run`);
  const briefForbidsIntent = briefRefused || (briefText !== null
    ? /you may not read intent\.md/i.test(briefText)
    : schemaVariant !== 'contract');
  const expectedSha = briefForbidsIntent ? '' : (runJson.intent_sha256 ?? '');
  if ((payload.intent_sha ?? '') !== expectedSha) {
    errors.push(
      briefForbidsIntent
        ? `intent_sha must be "" for a node forbidden to read intent.md, got "${payload.intent_sha}" ` +
          `(a node that echoed the real sha read a file it was told not to)`
        : `intent_sha mismatch: got "${payload.intent_sha}", expected "${expectedSha}"`,
    );
  }

  // Per-finding: rejection drops the finding, it does not fail the node — unless most of them go.
  // HEADINGS, not mentions (G-39). This scanned every `I-n` token anywhere in intent.md, so a
  // criterion's prose referring to another one — or to an id that does not exist — populated the set
  // that decides whether a finding's intent_ref resolves. I-14 says a ref that does not resolve is
  // DROPPED, and a validator whose vocabulary is "any number written down anywhere" drops nothing.
  //
  // Latent rather than active on the intent.md that found it: 60 headings, 60 distinct tokens, no
  // difference. That is luck about how one document happened to read, not a property of the format.
  //
  // The loose scan stays as a FALLBACK for an intent.md whose criteria are not headings. An empty
  // set would drop every contract-audit finding in the run at once — a worse failure than the one
  // being fixed, and a silent one.
  const criteria = new Set();
  // THROUGH THE OWNER (run-dir-reads.plan.md stage 4; G-23 of 20261029-065343-rdd-remediation-2-review, G-12 of
  // 20261029-134336-rdd-remediation-3-review): intent.md was read raw, so a link standing at it put another file's
  // criteria in front of contract-audit. A link is refused, and the node stops rather than judge against it.
  // A REFUSAL IS RETURNED, NOT die()d (G-12 of 20261115-022835-pbr-1b-remediation-review): die()'s process.exit skipped
  // the terminal status write, so the node stayed RUNNING and the cause was lost. The caller records it BLOCKED.
  let intentText = null;
  try { intentText = owner.read(['intent.md']); } catch (e) {
    if (e.code !== 'ENOENT') return { errors, kept: [], rejected: [], outOfScope: [], intentRefused: `intent.md ${e.message}` };
  }
  if (intentText !== null) {
    const text = intentText;
    for (const m of text.matchAll(/^#{1,6}\s*(I-\d{1,3})\b/gm)) criteria.add(m[1]);
    if (!criteria.size) {
      for (const m of text.matchAll(/\bI-(\d{1,3})\b/g)) criteria.add(`I-${m[1]}`);
    }
  }

  const kept = [];
  // Observations the lens filed as findings but which sit outside the reviewed surface. They are
  // MERGED into whatever the node already declared in out_of_scope_observations[] rather than
  // replacing it, so a lens that reported both keeps both.
  const outOfScope = [];
  for (const f of payload.findings ?? []) {
    const why = [];

    if (schemaVariant === 'contract') {
      if (!f.intent_ref) why.push('contract lens finding carries no intent_ref');
      else if (criteria.size && !criteria.has(f.intent_ref)) {
        why.push(`intent_ref ${f.intent_ref} does not resolve to a criterion in intent.md`);
      }
    } else if (f.intent_ref) {
      why.push('non-contract lens may not cite intent (§4)');
    }

    const evAbs = path.resolve(runDir, f.evidence_path ?? '');
    // Containment through links, by the owner (G-19 of 20261025-104155-srf-remediation-3-review): an inline lexical
    // startsWith here let a link beneath evidence/<node>/ to a file outside the run pass as this node's evidence.
    const ownership = evidenceOwnershipError(path.resolve(runDir), nodeId, f.evidence_path);
    if (ownership) why.push(ownership);
    // AND THIS NODE MUST HAVE PRODUCED IT (G-51, panel-codex-contract). Ownership plus existence
    // let any pre-existing file under the node's own evidence directory satisfy the check — and one
    // gets there without this node seeing it printed: `--resume` re-enters a run whose earlier
    // attempt already captured under this very node id. §4's `measurement` basis rests on "cite
    // exactly the path capture.mjs printed"; a log from an attempt this node did not make is a
    // citation of somebody else's work, which is the same failure as citing another node's
    // evidence, one directory down.
    //
    // The node's own start time is the boundary, with a second of slack for clock granularity. This
    // cannot prove the node SAW the path — nothing here can — but it does prove the file was
    // written during this node's life, which is the part a file system can answer.
    else {
      let mtime = null;
      // A stat that fails refuses the finding (G-13 of 20261105-181450-crsf-d1-remediation-2-review): existence was checked
      // above, but evidence gone or unreadable since then has no freshness to establish, and was accepted unchecked.
      try { mtime = owner.stat(belowRun(evAbs)).mtimeMs; } catch (e) { why.push(`evidence_path could not be examined for freshness: ${f.evidence_path} (${e?.code ?? e?.message})`); }
      const startedMs = Date.parse(status.started_at ?? '');
      if (mtime !== null && Number.isFinite(startedMs) && mtime < startedMs - 1000) {
        why.push(`evidence_path predates this node: ${f.evidence_path} was written before the node `
          + 'started, so this run did not produce it (a resumed attempt leaves the earlier one behind)');
      }
    }

    // CONTAINMENT and location bounds now come from lib/finding-scope.mjs, the ONE owner shared
    // with run-graph's panel arms — the arms wrote verdict.kept.json asserting a validation that
    // had never run (G-33). Containment is load-bearing: remediate runs with bypassPermissions and
    // reads reconciled.md as its work list, so a `../../.ssh/config` is a route out of the repo.
    why.push(...findingScopeErrors(f, { repoRoot }));

    const allowed = schema?.properties?.findings?.items?.properties?.basis?.enum ?? [];
    if (allowed.length && !allowed.includes(f.basis)) {
      why.push(`basis "${f.basis}" not permitted for this lens (allowed: ${allowed.join(', ')})`);
    }
    if (f.basis === 'invariant' && !f.invariant) why.push('basis invariant without naming an invariant (§6)');
    // §4's ceiling is NOT enforced here any more — see the clamp below (G-52, arch-review).
    // It was a rejection, from the literal ['BLOCKER','HIGH'], while the identical rule was applied
    // to an arm by CLAMPING from lens-roster.json's `basis_ceilings`. So the same `convention`
    // finding at HIGH was kept-and-recorded-at-MEDIUM from a codex arm and DROPPED from a Claude
    // lens — and §7 marks a node DEGRADED past half its findings rejected, so a lens that
    // misjudged severity lost its whole verdict instead of having it weighed down. This file's own
    // clamp comment states the disposition: "Clamped, not rejected... Dropping it would lose
    // information." Two owners of one rule, disagreeing about both the mechanism and the number.

    // OUT OF SCOPE IS REPORTED, NOT REJECTED (§8.5 rule 5). Checked before the rejection branch so
    // a finding that is merely outside the reviewed surface becomes an observation the gate prints,
    // instead of being dropped with the other invalid ones. Only findings that are otherwise WELL
    // FORMED are moved: a citation that does not resolve is a mistake, not an observation, and a
    // path escaping the repository is a containment failure that must stay a hard rejection.
    const oos = findingOutOfScope(f, {
      generatedGlobs: runJson.contract?.generated_globs ?? [],
      declaredGlobs: declaredSurface(runJson.contract),
    });
    if (oos && !why.length) {
      outOfScope.push({ file: f.file, note: `${oos} — ${String(f.claim ?? '').slice(0, 300)}` });
    } else if (why.length) rejected.push({ ...f, rejected_because: why });
    // G-43: stamp the Claude-family attribution on every kept LENS finding, mirroring how an arm
    // finding carries its reviewer as source. Without this the 'opus'/'sonnet' half of the source
    // enum was never produced, so reconcile could not tell a Claude lens from an external arm by
    // the finding alone. The model the node actually ran under is the honest source; a finding that
    // already declares its own source keeps it.
    else kept.push({ ...f, source: f.source ?? model, model: f.model ?? model });
  }

  // G-46: an empty not_checked[] on a non-trivial scope claims omniscience and is itself a defect
  // — I-28 says node conduct is enforced by construction, not instruction, and this was enforced
  // only by the brief injecting standing entries. The validator now holds it: a lens node that
  // names nothing it could not check is DEGRADED, whether or not it returned findings or
  // checked_clean items. A lens with all three empty reported nothing, and its PASS would read as a
  // clean review (G-12 of 20261111-042301-dps-a5-review).
  const scopeIsTrivial = mode !== 'lens';
  const didWork = (payload.findings ?? []).length > 0 || (payload.checked_clean ?? []).length > 0;
  if (!scopeIsTrivial && (payload.not_checked ?? []).length === 0) {
    errors.push('empty not_checked[] on a non-trivial scope — a lens must name what it could not check (§8.4, G-46)');
  }

  // G-36: a MEASUREMENT-ONLY lens that measured nothing may not report a verdict at all.
  //
  // feature-verify's whole contract is to exercise a built artifact and cite captured evidence —
  // its only permitted basis is `measurement`, which by §4 requires an evidence_path containing
  // that measurement. Its SKILL.md ordered steps that were impossible under the policy it actually
  // ran with (the brief filtered out commands.run, Edit/Write were denied, capture filtered the
  // same key), so it could return an EMPTY PASS: zero findings, zero checked_clean, and a verdict
  // that reads at the gate exactly like a feature that was verified and worked.
  //
  // A lens that verified nothing reporting PASS is the worst outcome this system can produce, so
  // the refusal is enforced HERE, in code, rather than asked for in the skill's prose — a node
  // cannot be trusted to disqualify its own output. Silence is not a verdict; neither is an empty
  // measurement.
  // The schema's basis enum is the RESOLVED, enforced set — the same list the per-finding basis
  // check above validates against — so it cannot drift from what this node is actually allowed.
  const enforcedBasis = schema?.properties?.findings?.items?.properties?.basis?.enum ?? [];
  const basisIsMeasurementOnly = enforcedBasis.length > 0
    && enforcedBasis.every((b) => b === 'measurement');
  if (mode === 'lens' && basisIsMeasurementOnly && !didWork) {
    errors.push(
      'measurement-only lens produced no findings and no checked_clean entries — it measured ' +
      'nothing, so it may not report a verdict. If the artifact could not be exercised (no run ' +
      'command, no write area, capture denied), that is the finding: say so in not_checked[] ' +
      'rather than returning an empty PASS (§4 measurement, G-36).',
    );
  }

  const total = (payload.findings ?? []).length;
  // A lens fabricating most of its evidence has not performed the review.
  if (total > 0 && rejected.length / total > 0.5) {
    errors.push(`${rejected.length}/${total} findings rejected (>50%) — the review was not performed`);
  }

  return { errors, kept, rejected, outOfScope };
}

// ---------------------------------------------------------------------------- report rendering

/**
 * How a person reopens the session this node ran in — rendered from the runtime's own entrypoint.
 *
 * Optional by design: an adapter that cannot reopen a session declares no `resume_argv`, and the
 * report then states that the session id is recorded with no resume path. Saying so is the honest
 * outcome; printing a command that does not exist is the one this replaced.
 */
function resumeHint(session) {
  const argv = entrypoint(RUNTIME, 'resume_argv', { required: false });
  if (!Array.isArray(argv) || !argv.length) {
    return ' — recorded for provenance; this runtime declares no way to reopen a session';
  }
  const rendered = argv.map((a) => String(a).split('{{session}}').join(session)).join(' ');
  return ` — \`${RUNTIME.cmd} ${rendered}\` to interrogate`;
}
function renderReport(payload, kept, rejected) {
  const scope = runJson.scope?.full_sweep
    ? `human-asserted: \`${(runJson.scope.paths ?? []).join('`, `')}\``
    : `derived from diff vs \`${runJson.base_commit ?? 'unknown'}\``;
  const host = runJson.host ?? {};

  const L = [];
  L.push(`# ${nodeId} — ${payload.verdict}`, '');
  L.push('| | |', '|---|---|');
  L.push(`| Run | \`${status.run_id}\` |`);
  L.push(`| Node | \`${nodeId}\` (\`${mode}\`, model \`${model}\`) |`);
  L.push(`| State | \`${status.state}\` |`);
  L.push(`| Scope | ${scope} |`);
  L.push(`| Intent | ${payload.intent_sha ? `\`${payload.intent_sha}\`` : 'not provided to this node'} |`);
  // NEITHER LINE NAMES A CLI, AND THE HOST LINE READS THE FIELD THAT EXISTS (G-53).
  //
  // Two defects in two lines of a DURABLE artifact. The resume hint was the literal
  // `claude --resume <id>` — shared/adapter-contract.md forbids the orchestrator naming a CLI, while
  // disk-first-protocol.md's Appendix A prescribed that exact string, so the two documents said
  // opposite things and nothing recorded the conflict; a node spawned on any other runtime printed
  // a command naming a binary it never used. And the host line read the pre-seam version field, which
  // new-run stopped writing when the field became `runtime_version` — so EVERY node report in the
  // run that found this printed a bare `unknown` while run.json recorded 2.1.265. That 'unknown' is
  // indistinguishable from a version that genuinely could not be probed, which is why a stale read
  // is worse here than a crash.
  L.push(`| Session | \`${sessionId}\`${resumeHint(sessionId)} |`);
  L.push(`| Host | ${host.platform ?? hostPlatform().id}/${host.arch ?? process.arch}, `
    + `${host.runtime ?? runtimeName} \`${host.runtime_version ?? 'unknown'}\` |`);
  const cost = typeof status.total_cost_usd === 'number' ? status.total_cost_usd.toFixed(4) : '?';
  L.push(`| Cost | $${cost} over ${status.num_turns ?? '?'} turns, ${status.duration_ms ?? '?'} ms |`);
  L.push('');

  L.push(`## Findings (${kept.length})`, '');
  for (const f of kept) {
    L.push(`### ${f.severity} · ${f.basis} · \`${f.file}:${f.line}\``, '');
    L.push(f.claim, '');
    L.push(`Evidence: \`${f.evidence_path}\``);
    if (f.intent_ref) L.push(`Criterion: \`${f.intent_ref}\``);
    if (f.invariant) L.push(`Invariant: \`${f.invariant}\``);
    L.push('');
  }
  if (!kept.length) L.push('_None._', '');

  L.push(`## Checked clean (${(payload.checked_clean ?? []).length})`, '');
  for (const c of payload.checked_clean ?? []) L.push(`- ${c}`);
  if (!(payload.checked_clean ?? []).length) L.push('_Nothing reported._');
  L.push('');

  L.push(`## Not checked (${(payload.not_checked ?? []).length})`, '');
  for (const n of payload.not_checked ?? []) L.push(`- **${n.item}** — ${n.reason}`);
  if (!(payload.not_checked ?? []).length) {
    L.push('_Nothing reported. An empty bucket on a non-trivial scope is itself a defect (§8.4)._');
  }
  L.push('');

  L.push(`## Out of scope, observed (${(payload.out_of_scope_observations ?? []).length})`, '');
  for (const o of payload.out_of_scope_observations ?? []) L.push(`- \`${o.file}\` — ${o.note}`);
  if (!(payload.out_of_scope_observations ?? []).length) L.push('_None._');
  L.push('');

  if (rejected.length) {
    L.push(`## Rejected findings (${rejected.length})`, '');
    for (const r of rejected) {
      L.push(`- ${r.severity} \`${r.file}:${r.line}\` — rejected: ${r.rejected_because.join('; ')}`);
    }
    L.push('');
  }

  writeTrackedReport(reportPath, L.join('\n'));

  // The VALIDATED set, as machine-readable artifact. The barrier used to re-read raw stdout.json
  // and take every finding in it, so the kept/rejected split computed here reached nothing: a
  // finding rejected for an impermissible basis, an over-severity, or a fabricated evidence path
  // still arrived at reconcile, could be grouped as corroboration, and could reach remediate —
  // which edits source. Rejecting a finding has to mean it is gone, not merely absent from the
  // rendered report a human reads.
  evidenceWrite(
    'verdict.kept.json',
    JSON.stringify(
      {
        schema_version: 1,
        run_id: status.run_id,
        node_id: nodeId,
        verdict: payload.verdict,
        kept_count: kept.length,
        rejected_count: rejected.length,
        findings: kept,
        // Carried on the VALIDATED artifact, because that is what downstream reads. Rendering them
        // only into the prose report left the gate with nothing machine-readable to print, which is
        // half of why §8.5 rule 5 was inert.
        out_of_scope_observations: payload.out_of_scope_observations ?? [],
      },
      null,
      2,
    ) + '\n',
  );

  return sha256File(reportPath);
}

// ---------------------------------------------------------------------------- main
// THE SIGNAL PASSED ON (stopping-a-child stage 3, design §5). On posix this process and its child are two process groups,
// so the orchestrator's group kill reaches this process and NOT the model child: before this, a SIGTERM ended spawn-node
// and left the child running, uncapped, with nothing recording it. The child is stopped through the one owner instead,
// inside the orchestrator's escalation (NESTED_*), and the outcome — seen exit, refusal or unconfirmed — is recorded like
// any other stop. On win32 taskkill /T reaches the child through the tree and no handler runs; this costs nothing there.
//
// Installed here, after the pre-spawn status, because before it there is no child to stop and the orchestrator's stub is
// the record. A signal between this line and the spawn is held and applied the moment the child exists.
let interruptChild = null;
let interruptedBy = null;
const NESTED_TIMING = { escalateAfterMs: NESTED_ESCALATE_AFTER_MS, deathGraceMs: NESTED_SIGNAL_DEADLINE_MS };
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (interruptedBy) return;
    interruptedBy = sig;
    interruptChild?.(sig, NESTED_TIMING);
  });
}
// The test seam's two outcomes, as whole process interfaces: the stop owner's one seam is `proc` (stop-owner-seam.plan.md
// stage 1, SS-D1 A), so a refused kill and an accepted one that never ends the child are the host's interface with both
// kills answering so.
const seamProc = (answer) => ({ ...hostPlatform().proc, killTree: () => Promise.resolve(answer), killTreeNow: () => answer });
const TEST_STOP = { refused: seamProc(false), unconfirmed: seamProc(true) };
// AFTER THE PRE-SPAWN STATUS WRITE, A REFUSAL IS RECORDED, NEVER die()d (G-11, G-12 of 20261115-031845-pbr-1b-remediation-2-review):
// die()'s process.exit skipped the finally that resolves RUNNING, so the node stayed RUNNING with no cause.
if (args.testStop != null && !TEST_STOP[args.testStop]) blockBeforeLaunch(`--test-stop must be one of ${Object.keys(TEST_STOP).join(', ')}`);
if (args.testStop) status.test_stop = args.testStop;
// UNDER THE PLATFORM'S FILE-SIZE CEILING (stopping-a-child stage 5, design 4B): what still bounds the child's output on
// disk when the cap's kill was refused or never seen to take effect. The platform decides whether one applies (posix: 4 GiB
// through `ulimit -f`; win32: none, the job ends the child with this process) and the status says which.
const launch = hostPlatform().proc.boundedLaunch(runtimeCmd, [...runtimePrefix, ...argv]);
status.file_size_ceiling_bytes = launch.ceilingBytes;
// The child's two output files are opened by runChild; their names are checked through the owner first, so a link planted
// at either is refused rather than written through (run-dir-descendants stage 2). Between this check and the open is the
// owner's stated residual (D-D1 A).
try { owner.resolve(['evidence', nodeId, 'stdout.json']); owner.resolve(['evidence', nodeId, 'stderr.log']); } catch (e) { blockBeforeLaunch(`evidence/${nodeId}/stdout.json or stderr.log: ${refusalCause(e)}; refusing to launch the node's runtime`, e); }
const res = await runChild({
  cmd: launch.cmd, args: launch.args, cwd, env: childEnv, stdoutPath, stderrPath, timeoutMs, outputCapBytes,
  // The prompt on stdin, as nodeArgv rendered it (decision-panel-seats.plan.md stage 2; DP-D1 A); null keeps 'ignore'.
  input: rendered.input,
  spawnOptions: hostPlatform().proc.killableSpawnOptions(),
  onSpawn: ({ interrupt }) => {
    interruptChild = interrupt;
    if (interruptedBy) interrupt(interruptedBy, NESTED_TIMING);
  },
  ...(args.testStop ? { proc: TEST_STOP[args.testStop], deathGraceMs: TEST_SEAM_GRACE_MS } : {}),
});
if (res.interrupted) process.exitCode = 130;

try {
  // Stamped here, not only in the finally, because renderReport prints the duration.
  status.ended_at = new Date().toISOString();
  status.duration_ms = Date.parse(status.ended_at) - Date.parse(status.started_at);
  // The outcome's fields, and a refused or unconfirmed kill said as itself (G-9, G-13 of 20261001-205530; G-7, G-18 of
  // 20261002-004527): recorded by the one owner, which a test drives.
  recordRunOutcome(status, res);
  status.stdout_bytes = statSizeOr0(stdoutPath);
  status.stderr_bytes = statSizeOr0(stderrPath);

  // Record what it COST before deciding whether it SUCCEEDED. Billing used to be captured only on
  // the exit-0 path, so a node that spent real money and then failed recorded total_cost_usd:
  // null — and the run budget, unable to distinguish "free" from "unmeasured", either counted the
  // most expensive failures as free or charged them a blanket cap. Both are wrong when the true
  // figure is sitting in the envelope: a budget-exhausted reconcile exits 1 with a valid envelope
  // reporting $2.81. The cost of a failed node is exactly as real as the cost of a successful one.
  // Read and parsed ONCE, for billing here, the failure's reason and the envelope below: each read it again (G-20 of
  // 20261025-104155-srf-remediation-3-review).
  let stdoutParsed = null;
  let stdoutParseError = null;
  let stdoutText = '';
  // Through the owner (run-dir-reads.plan.md stage 4): a link standing at stdout.json is not this node's output.
  // A REFUSAL IS NAMED (G-18 of 20261029-235315-rdr-remediation-4-review): a missing file is no output, but a link
  // standing at stdout.json is a refused read, recorded in the status rather than passed off as a node that wrote nothing.
  let stdoutRefused = null;
  try { stdoutText = owner.read(['evidence', nodeId, 'stdout.json']); } catch (e) { if (e.code !== 'ENOENT') stdoutRefused = e; }
  try { stdoutParsed = JSON.parse(stdoutText); } catch (e) { stdoutParseError = e; }
  if (stdoutRefused) {
    status.validator_errors.push(stdoutRefused.code === 'ECONFINED'
      ? `stdout refused: evidence/${nodeId}/stdout.json is not a plain file below the run`
      : `stdout unreadable: evidence/${nodeId}/stdout.json (${stdoutRefused.code ?? 'error'})`);
  }
  // THE CALL'S ENTRY (runtime-call-telemetry.plan.md stage 3; design CR-D4 A): the runtime call's process facts, usage and
  // outcome in the one shape every call has, kept in this node's status, the record this call site already writes.
  status.call = callEntry({
    reviewer: runtimeName, model: status.model ?? null, table: RUNTIME_TABLE,
    startedMs: Date.parse(status.started_at), endedMs: Date.parse(status.ended_at),
    exitCode: status.exit_code ?? null, signal: status.signal ?? null, timedOut: status.timed_out === true,
    timeoutMinutes: status.timeout_minutes ?? null, stdout: stdoutText, answered: runtimeAnswered(stdoutText, RUNTIME),
  });
  try {
    const early = stdoutParsed;
    if (typeof early.total_cost_usd === 'number') status.total_cost_usd = early.total_cost_usd;
    if (typeof early.num_turns === 'number') status.num_turns = early.num_turns;
    harvestUsage(early, status);
    if (Array.isArray(early.permission_denials)) {
      status.permission_denials_count = early.permission_denials.length;
    }
  } catch {
    /* unparseable stdout is handled by the state machine below; nothing to bill from */
  }
  status.launched = true;

  if (res.spawnError) {
    status.state = 'BLOCKED';
    status.validator_errors.push(`spawn failed: ${res.spawnError.message}`);
  } else if (res.interrupted) {
    // Said by recordRunOutcome above, with the stop's outcome; a child stopped mid-run has no verdict.
    status.state = 'BLOCKED';
  } else if (res.overflowed) {
    // BLOCKED, not DEGRADED: the process was killed mid-sentence, so whatever sits in stdout is a
    // truncated envelope at best. Silence is not a verdict, and neither is a severed one. The size
    // reached is reported rather than the cap, because the overshoot past the sampling interval is
    // part of what a reader needs to judge what happened.
    status.state = 'BLOCKED';
    status.output_capped = true;
    status.validator_errors.push(
      `output exceeded the ${outputCapBytes}-byte cap (reached `
      + `${status.stdout_bytes + status.stderr_bytes} bytes across stdout and stderr); ${stopPhrase(res)}`,
    );
  } else if (res.timedOut) {
    status.state = 'BLOCKED';
    // WHAT THE NODE HAD DONE BY THE TIME IT DIED. `timed out after N ms` is the same sentence for a
    // lens that was still writing evidence a minute before the kill and one that hung at minute one,
    // and those need opposite responses: raise the cap, or debug the hang. Observed on run
    // 20260913-222312 -- arch-review wrote 17 capture files between 22:40 and 22:54 and was killed at
    // 22:55 with stdout_bytes: 0. The cap was then raised 15 -> 30 on the strength of a hand-read of
    // file timestamps in a run directory, which is not something a consumer will ever do.
    //
    // The VERDICT is not recoverable and nothing here pretends it is: a process killed before it
    // emitted its envelope has none, and building one out of partial captures is the fabrication this
    // system refuses. Only the shape of the interrupted work is reported.
    let captured = [];
    try {
      const children = fs.readdirSync(evidenceDir, { withFileTypes: true });
      // A link child is named, never followed and never dropped (G-14 of 20261105-173030-crsf-d1-remediation-review): a
      // symlink Dirent is not a file, so it was filtered out and a node killed with only a link read as one that wrote nothing.
      const links = children.filter((e) => e.isSymbolicLink()).map((e) => e.name);
      if (links.length) {
        status.validator_errors.push(`the evidence directory ${evidenceDir} holds a link (${links.join(', ')}), not followed; `
          + 'the timeout forensics below do not cover it');
      }
      captured = children
        .filter((e) => e.isFile() && e.name !== 'stdout.json' && e.name !== 'stderr.log')
        .map((e) => ({ name: e.name, mtimeMs: fs.statSync(path.join(evidenceDir, e.name)).mtimeMs }));
    } catch (e) {
      // Absent is ENOENT only (G-14 of 20261105-163851-crsf-d1-review): an evidence directory that cannot be listed was
      // reported as no evidence, hiding the unreadable tree exactly when the timeout is being diagnosed. It is named.
      if (e?.code !== 'ENOENT') {
        status.validator_errors.push(`the evidence directory ${evidenceDir} could not be read (${e?.code ?? e?.message}); `
          + 'the timeout forensics below do not cover its files');
      }
    }
    const forensics = timeoutForensics({ files: captured, killedAtMs: Date.parse(status.ended_at) });
    status.timeout_forensics = forensics;
    status.validator_errors.push(
      `timed out after ${timeoutMs} ms; ${stopPhrase(res)}. ${forensics.why}`,
    );
  } else if (res.signal) {
    status.state = 'BLOCKED';
    status.validator_errors.push(`killed by signal ${res.signal}`);
  } else if (res.exitCode !== 0) {
    status.state = 'BLOCKED';
    // THE RUNTIME ALREADY SAID WHY, and this used to throw it away. A node stopped at the operator's
    // own dollar ceiling and a node whose prompt was malformed both exited 1, and the status said
    // `exit code 1` for each — while the answer sat in stdout.json in the evidence directory beside
    // it. Same argument the timeout branch above makes at length: a bound reached and a fault found
    // need opposite responses from the reader.
    //
    // Measured on the first real /invoke run: arch-review spent seven minutes and $4.10 on
    // story-pipeline, captured three pieces of evidence, and was stopped by
    // `budget_usd_per_node: 4.00`. Nothing in the artifacts said so.
    const result = stdoutParsed;   // null when the failure wrote none
    // The reason's field is the adapter's (G-9 of 20261103-040939-rbr-remediation-9-review).
    const reasonField = nodeExitMapping(RUNTIME).reasonField;
    const terminal = reasonField ? result?.[reasonField] : undefined;
    if (typeof terminal === 'string' && /^[a-z][a-z0-9_]{0,47}$/.test(terminal)) {
      // Machine-readable beside the sentence, so a reader does not have to parse prose to branch.
      status.terminal_reason = terminal;
    }
    status.validator_errors.push(describeNodeExit({
      exitCode: res.exitCode,
      result,
      budgetUsd: budgetUncapped ? null : budgetUsd,
      runtime: RUNTIME,
    }));
  } else if (status.stdout_bytes === 0) {
    status.state = 'BLOCKED';
    status.validator_errors.push('exit 0 with empty stdout');
  } else {
    // Exit 0 — from here on, any failure is DEGRADED: the node claimed it finished.
    let envelope = null;
    if (stdoutParseError) {
      status.state = 'DEGRADED';
      status.validator_errors.push(`stdout is not a parseable result envelope: ${stdoutParseError.message}`);
    } else {
      envelope = stdoutParsed;
      status.envelope_parsed = true;
    }

    if (envelope) {
      status.total_cost_usd = envelope.total_cost_usd ?? null;
      harvestUsage(envelope, status);
      status.num_turns = envelope.num_turns ?? null;
      status.stop_reason = envelope.stop_reason ?? null;
      status.subtype = runtimeSubtype(envelope, RUNTIME);
      status.permission_denials_count = (envelope.permission_denials ?? []).length;

      if (envelope.permission_denials?.length) {
        evidenceWrite(
          'denials.json',
          JSON.stringify(envelope.permission_denials, null, 2) + '\n',
        );
      }

      let payload = envelope.structured_output ?? null;
      if (!payload && typeof envelope.result === 'string') {
        try {
          payload = JSON.parse(envelope.result);
        } catch {
          /* leave null */
        }
      }

      // Which branch this result takes is decided in lib/decisions.mjs, where the ORDER is the
      // contract and a test pins it: prose is decided before "no payload", because a prose node
      // has no structured output by definition. Deciding it the other way round marked every
      // prose node DEGRADED before it reached its own handler, and second-opinion — the graph's
      // only prose node — had therefore never once reported OK.
      const classified = classifyResult({
        schemaVariant,
        isError: runtimeError(envelope, RUNTIME),
        hasPayload: Boolean(payload),
        resultText: typeof envelope.result === 'string' ? envelope.result : '',
      });

      if (classified.branch === 'error') {
        status.state = 'DEGRADED';
        status.validator_errors.push(`envelope reports an error (subtype: ${runtimeSubtype(envelope, RUNTIME)})`);
      } else if (schemaVariant === 'none') {
        // There is no verdict to validate, so the accountability a schema would provide comes from
        // the transcript instead: the session id is recorded and the text is written verbatim,
        // unedited by this script.
        const text = typeof envelope.result === 'string' ? envelope.result : '';
        if (!text.trim()) {
          status.state = 'DEGRADED';
          status.validator_errors.push('prose node returned an empty result');
        } else {
          writeTrackedReport(reportPath, `# ${nodeId}\n\n_Session \`${sessionId}\` — verbatim._\n\n${text}\n`);
          status.report_path = path.relative(runDir, reportPath);
          status.report_sha256 = sha256File(reportPath);
          status.state = 'OK';
          status.verdict_json_valid = true;
        }
      } else if (!payload) {
        // Every variant BELOW this line is schema-bearing, so a missing payload is a real failure.
        // It sits after the prose branch, not before it, for the reason stated there.
        status.state = 'DEGRADED';
        status.validator_errors.push('no structured_output in the envelope and result was not JSON');
      } else if (schemaVariant === 'gate') {
        // The pre-run gate. Its verdict decides whether a run happens at all, so it is surfaced
        // on the status file the caller reads rather than buried in the payload. A round whose settings are not the
        // ones this script pinned is not reported OK: it would record settings the round did not run at (G-4).
        const settingsErrors = gateSettingsErrors(payload.settings, { model, effort: args.effort ?? null });
        status.state = settingsErrors.length ? 'DEGRADED' : 'OK';
        status.validator_errors.push(...settingsErrors);
        status.verdict_json_valid = true;
        status.verdict = payload.verdict;
        status.findings_count =
          (payload.scope_creep?.length ?? 0) +
          (payload.premature_decision?.length ?? 0) +
          (payload.missing?.length ?? 0) +
          (payload.defective?.length ?? 0);
        evidenceWrite('payload.json', JSON.stringify(payload, null, 2) + '\n');
      } else if (schemaVariant === 'ping' || schemaVariant === 'intent' ||
                 schemaVariant === 'reconcile' || schemaVariant === 'request' || schemaVariant === 'remediation' ||
                 schemaVariant === 'remediation-repair') {
        // Probe, intent, and barrier nodes have their own shapes; the CLI already validated
        // them against the variant. The orchestrator renders their markdown, not the node.
        status.state = 'OK';
        status.verdict_json_valid = true;
        evidenceWrite('payload.json', JSON.stringify(payload, null, 2) + '\n');
      } else {
        const { errors, kept, rejected, outOfScope, intentRefused } = validateVerdict(payload);
        if (intentRefused) {
          status.state = 'BLOCKED';
          status.validator_errors.push(...errors, `criteria refused: ${intentRefused}`);
          console.error(`spawn-node: ${nodeId}: ${intentRefused}`);
          // A REFUSAL IS NOT A SUCCESS (run-dir-reads stage 4): returned rather than die()d, it exited 0, so a caller that
          // reads the exit code took a node that judged nothing for one that finished. Exit 1, as blockBeforeLaunch does.
          process.exitCode = 1;
        } else {

        // ENFORCE the degraded caps. They were computed in run-graph, written into expected.json,
        // and stated in the brief as prose — "no finding may exceed RISK", "every finding is
        // recorded at LOW" — and then checked by nothing. A degraded lens was asked to limit
        // itself and trusted to comply, which is the one thing this system refuses to do
        // anywhere else. perf-audit without a bench command is documented as unable to produce a
        // FAIL; until now it could.
        //
        // Clamped, not rejected: the finding is real, the lens simply had no basis to weigh it
        // that heavily. Dropping it would lose information; capping records it at the honest
        // weight. Same reasoning as the external-arm cap in external-review.mjs.
        // clampSeverity and capVerdict live in lib/decisions.mjs — the regression suite exercises
        // this exact code, not a copy. Both THROW on a value that is not a rung/verdict, which is
        // the whole point: the previous inline version guarded with `RUNGS.includes(...)` and fell
        // through when it failed, so being handed a verdict ('RISK') in the severity slot silently
        // disabled the cap on every degraded lens while every artifact reported it as active.
        // WHAT THE BASIS ITSELF ALLOWS, from the declared ladder (G-52). This runs for EVERY node,
        // capped or not: a non-degraded lens is given no severity ceiling at all, so the roster key
        // that owns "what a kind of evidence is worth" reached the arm path and never the lens
        // path — inert in both directions, since lowering it still admitted MEDIUM lens findings
        // and raising it still rejected HIGH ones.
        //
        // §6 stays exempt by construction rather than by exception: the ladder gives `invariant` a
        // null ceiling, because non-waivable means non-cappable.
        {
          const ladder = basisLadder();
          status.basis_clamped = 0;
          for (const f of kept) {
            const rung = ladder[f.basis];
            if (!rung?.severity_ceiling) continue;
            const before = f.severity;
            f.severity = clampSeverity(f.severity, { floor: null, ceiling: rung.severity_ceiling });
            if (f.severity !== before) status.basis_clamped += 1;
          }
        }
        if (args.severityCeiling || args.severityFloor) {
          // Counter initialised to 0, not left undefined. A node that ran with a cap and clamped
          // nothing is a meaningful record ("the cap was live and nothing hit it"); an absent
          // field is indistinguishable from a cap that never ran, which is how the broken clamp
          // stayed invisible across every degraded lens in every prior sweep.
          status.severity_clamped = 0;
          for (const f of kept) {
            // §6 IS NOT CAPPABLE. The six non-waivable invariants may be raised by any lens
            // regardless of its scope or its degradation — that is what "non-waivable" means — so a
            // degradation ceiling must not quietly turn a credential_exposure into a LOW. The same
            // exemption findingOutOfScope already makes for demotion, at the other control.
            //
            // It matters the moment a degraded lens is GIVEN the invariant basis: perf-audit with no
            // bench command is exactly that case, and capping there would have handed it a basis it
            // could not use at the weight the basis is for.
            if (f.basis === 'invariant') continue;
            const before = f.severity;
            f.severity = clampSeverity(f.severity, {
              floor: args.severityFloor ?? null,
              ceiling: args.severityCeiling ?? null,
            });
            if (f.severity !== before) status.severity_clamped += 1;
          }
        }
        // VERDICT FLOOR (§2), enforced here because nothing enforced it anywhere. A lens holding a
        // BLOCKER could declare PASS and writeGate — which reads verdicts, not severities —
        // propagated it to the gate unchallenged. The system's stated principle is that a node
        // cannot be trusted to disqualify its own output; this is the one place that principle is
        // most load-bearing, and it was the one place the code did not apply it.
        //
        // Computed AFTER the severity clamp, so it reflects what the lens is actually prepared to
        // defend rather than what it first claimed, and BEFORE the ceiling, so a capped node (an
        // external arm, a degraded lens) still ends at its cap. Raising only: a lens may always
        // judge worse than its findings suggest; under-reporting is the direction that yields a
        // false PASS.
        {
          const floor = verdictFloorFromFindings(kept);
          const raised = raiseVerdict(payload.verdict, floor);
          if (raised !== payload.verdict) {
            // Recorded, never silent. A cap that quietly does nothing is worse than no cap, and the
            // same is true of a floor that quietly does something.
            status.verdict_before_floor = payload.verdict;
            status.verdict_raised_by_floor = floor;
            payload.verdict = raised;
          }
        }
        // Verdict cap, driven by its OWN parameter rather than inferred from the severity one.
        if (args.verdictCeiling) {
          const capped = capVerdict(payload.verdict, args.verdictCeiling);
          // §6 is not cappable here either (G-29): the floor the invariant findings alone set survives the ceiling.
          // The line above is left as it is: bench/corpus/verdict-floor-absent's patch takes it as context.
          const held = capVerdictKeepingInvariants(payload.verdict, args.verdictCeiling, kept);
          if (held !== capped) status.verdict_held_by_invariant = held;
          if (held !== payload.verdict) {
            status.verdict_before_cap = payload.verdict;
            payload.verdict = held;
            status.verdict_capped_by_ceiling = args.verdictCeiling;
          }
        }

        status.findings_count = kept.length;
        status.rejected_findings_count = rejected.length;
        if (errors.length) {
          status.state = 'DEGRADED';
          status.validator_errors.push(...errors);
        } else {
          status.state = 'OK';
          status.verdict_json_valid = true;
          status.verdict = payload.verdict;
          // MERGED, not replaced: a lens that filed its own out_of_scope_observations keeps them,
          // and the validator's demotions join them. This is the line that makes §8.5 rule 5 real —
          // before it, an out-of-scope finding was rejected and the list the gate promises to print
          // was always whatever the model happened to write, never what the validator determined.
          payload.out_of_scope_observations = [
            ...(payload.out_of_scope_observations ?? []),
            ...outOfScope,
          ];
          status.out_of_scope_count = payload.out_of_scope_observations.length;
          status.report_sha256 = renderReport(payload, kept, rejected);
          status.report_path = path.relative(runDir, reportPath);
        }
        }
      }
    }
  }
} finally {
  status.ended_at = new Date().toISOString();
  status.duration_ms = Date.parse(status.ended_at) - Date.parse(status.started_at);
  // Nothing set it, so it died on a path nobody anticipated.
  if (status.state === 'RUNNING') status.state = 'BLOCKED';
  writeStatusAtomic(status); // (2) TERMINAL, unconditional
}

console.log(`${nodeId}: ${status.state}${status.verdict ? ` / ${status.verdict}` : ''}`);
