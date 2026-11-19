#!/usr/bin/env node
// capture.mjs — run a command, tee its output to the run's evidence dir, and print back the
// canonical path the caller must cite.
//
// This is the ONLY sanctioned way to produce evidence (disk-first-protocol.md §3). A lens that
// cites a path it did not see printed here is fabricating, and spawn-node.mjs rejects the
// finding that carries it.
//
// Contract:
//   stdout  the canonical run-relative evidence path, alone, nothing else
//   stderr  the command's combined output (capped preview) plus a status line
//   exit    the child's exit code, verbatim — a failing check must still look like a failure
//
// Usage:
//   node capture.mjs --run-dir <abs> --node <node-id> --name <slug> -- <command> [args...]

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import path from 'node:path';
import { admitCommand, readOnlyPrefixes } from './lib/capture-admit.mjs';
import { fileURLToPath } from 'node:url';
import { nodeDepth } from './lib/node-depth.mjs';
// The one async core (capture-interactive.plan.md stage 3): the command runs through spawnCapture, and a deadline stops
// its whole tree through the one stop owner. spawnSync's timeout ended the direct child only.
import { spawnCapture } from './io/spawn-capture.mjs';
import { hostPlatform } from './platform/index.mjs';

import { contractArgv, EXECUTABLE_COMMAND_KEYS, commandEnvFor, gitEnvFor } from './lib/decisions.mjs';
import { redactClaim } from './lib/redact.mjs';
import { selectAdapters } from './io/reviewers.mjs';
import { testOneTemplate, matchTestOne, testOneFileRefusal } from './lib/test-one.mjs';
import { testOneFacts } from './io/test-one.mjs';
import { logWindow, headTailKeeper, keptStreamView } from './lib/log-window.mjs';
import { HEADER_RULE, headerValue, elapsedLine } from './lib/capture-header.mjs';
import { checkTimeoutMinutes } from './lib/check-timeout.mjs';
// The one owner of "a write must not land on an existing artifact" — the same function
// external-review uses, rather than a second answer to the same question.
import { freeEvidenceName } from './io/atomic.mjs';
import { confined } from './io/confined-path.mjs';
// The one owner of "is this path inside that one" — see its docstring for the root case (G-7).
import { admitRun, callerRepoRoot } from './io/reviews-root.mjs';
// isWithin, the one owner (G-7): the composed-prefix form it replaces breaks at a filesystem root.
import { isWithin } from './io/finding-scope.mjs';

// The detector is a sibling of this file. Its path in the allow-list below used to be the literal
// `.claude/skills/scripts/find-inert-features.mjs`, which is where the engine sits only when
// vendored in-tree — as a plugin it is at `.claude/skills/quorate/scripts/`, and the allow-list
// would have refused the one command doc-consistency-review is REQUIRED to run.
const DETECTOR_ABS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'find-inert-features.mjs');
// DELETED: a DETECTOR_REL relative to process.cwd(). It was admitted to the allow-list and resolved
// by node against the SPAWN's cwd instead, which is the G-6 hole. A dangerous value left computed
// but unused is one edit away from being used again.
// eslint-disable-next-line no-unused-vars -- intentionally absent; see above

const MAX_LOG_BYTES = 1024 * 1024; // 1 MiB on disk
const PREVIEW_LINES = 120; // tail echoed back to the caller

function die(msg) {
  process.stderr.write(`capture: ${msg}\n`);
  process.exit(2);
}

const argv = process.argv.slice(2);

// ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md): the flags
// before `--`, a missing value or an unknown flag refused naming the flag, and everything after it the command, untouched.
const opts = {};
let cmd;
let values;
try {
  const parsed = parseArgv(argv, ARGV_SPECS.capture);
  values = parsed.values;
  const take = { 'run-dir': 'runDir', node: 'node', 'timeout-minutes': 'timeoutMinutes', name: 'name', cwd: 'cwd' };
  for (const [flag, key] of Object.entries(take)) if (values[flag] !== undefined) opts[key] = values[flag];
  cmd = parsed.rest;
} catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }

// THE INTERACTIVE FRONT END (capture-interactive.plan.md stage 4): a session's own command, given as one string in the
// POSIX subset, with no run directory. io/capture-interactive.mjs runs it; this entry only routes, and refuses each
// mode's flags in the other, so a lens capture cannot pick up an interactive option or the reverse.
const INTERACTIVE_ONLY = ['mode', 'evidence-dir', 'preview-lines', 'quiet', 'stdin-file', 'fetch', 'strict'];
const LENS_ONLY = ['run-dir', 'node'];
if (values.interactive) {
  // A session's front end, not a node's (G-2 of 20261116-001508-ci-review-2): every node holds a capture.mjs grant, and
  // --mode run would let one run any command, past the depth rule (§8). A node's captures take --run-dir.
  // Through the one owner of the depth's grammar (lib/node-depth.mjs): any depth but 0, and one that cannot be read, refuses.
  const depthRead = nodeDepth(process.env);
  if (depthRead.depth !== 0) {
    // Exit 3, the code §8 gives every depth guard (die() exits 2, a refusal of the call's own arguments).
    process.stderr.write(`capture: --interactive is refused inside a graph node (GRAPH_NODE_DEPTH=${depthRead.raw}); a node captures with --run-dir and --node\n`);
    process.exit(3);
  }
  const stray = LENS_ONLY.find((f) => values[f] !== undefined);
  if (stray) die(`--${stray} is the lens front end's; --interactive needs no run directory`);
  const ia = await import('./io/capture-interactive.mjs');
  if (!values['evidence-dir']) die('--evidence-dir is required with --interactive (an absolute directory git does not track)');
  if (!values.name) die('--name is required with --interactive (the label the output is saved and fetched under)');
  if (!/^[A-Za-z0-9._-]+$/.test(values.name)) die('--name must match ^[A-Za-z0-9._-]+$');
  const out = values.fetch !== undefined
    ? ia.fetchSaved({ evidenceDir: values['evidence-dir'], name: values.name, stream: values.fetch, mode: values.mode })
    : await (async () => {
      if (cmd.length !== 1) die('--interactive takes the command as ONE string after `--` (quote it), parsed in the POSIX subset');
      const lines = values['preview-lines'];
      if (lines !== undefined && !/^\d+$/.test(lines)) die(`--preview-lines must be a whole number, got ${JSON.stringify(lines)}`);
      return ia.runInteractive({ source: cmd[0], mode: values.mode, evidenceDir: values['evidence-dir'], name: values.name,
        cwd: values.cwd ? path.resolve(values.cwd) : process.cwd(), previewLines: lines === undefined ? null : Number(lines),
        quiet: Boolean(values.quiet), strict: Boolean(values.strict), stdinFile: values['stdin-file'] ?? null, timeoutMinutes: values['timeout-minutes'] ?? null });
    })();
  // A fetch prints the saved bytes as they are; and the exit waits for stdout to drain, since process.exit right after a
  // large write can cut a pipe short (G-14 of 20261116-221234-m2-9a-high-2).
  process.stdout.write(out.bytes ?? `${out.report}\n`, () => process.exit(out.code));
  await new Promise(() => {});
}
{
  const stray = INTERACTIVE_ONLY.find((f) => values[f] !== undefined);
  if (stray) die(`--${stray} belongs to --interactive; a lens capture takes --run-dir, --node and --name`);
}
const sep = argv.indexOf('--');
if (sep === -1) die('missing `--` separator before the command');

if (!cmd.length) die('no command given after `--`');
if (!opts.runDir) die('--run-dir is required');
if (!opts.node) die('--node is required');
if (!opts.name) die('--name is required');
if (!/^[a-z0-9-]+$/.test(opts.node)) die('--node must match ^[a-z0-9-]+$');
if (!/^[A-Za-z0-9._-]+$/.test(opts.name)) die('--name must match ^[A-Za-z0-9._-]+$');

const givenRunDir = path.resolve(opts.runDir);
if (!fs.existsSync(givenRunDir)) die(`run dir does not exist: ${givenRunDir}`);

// --run-dir picks WHICH run.json defines the allow-list, where the read-only git set reads from,
// and where the log lands — three security decisions on one caller-supplied path (G-3, G-16).
// The run's OWN run.json is the authority, and reading it FAILS CLOSED (G-4, G-5). The first
// version keyed the active-run check on the sibling latest.txt — a derived pointer new-run
// overwrites at every run's creation — so minting or resuming any run that was not the newest
// made every capture from the earlier run refuse (breaking the documented `run-graph --resume`),
// and it wrapped the whole check in a try/catch that SWALLOWED a bad run.json, silently disabling
// both the run pin and the --cwd confinement instead of refusing. run.json carries the canonical
// run_id and host.cwd; a run directory without a readable, matching run.json is not a run this
// node may write to, full stop.
// ADMITTED BY THE ONE OWNER (ARCHITECTURE A-28; run-dir-trust.plan.md stage 2): containment in the repository this process
// runs in (git, asked here — the authority for "which repository is this" cannot come from the file under test, G-6) or
// the engine's home, lexically and through links; a readable run.json (G-5); a run_id that is the directory's real name
// (G-3, G-4); and the run one of this repository's runs, naming it. Every check fails closed: the directory's own
// `contract.commands` is the allow-list deciding what this already-authorised surface will execute.
const admitted = admitRun({ runDir: givenRunDir, repoRoot: callerRepoRoot() });
if (!admitted.ok) die(`--run-dir ${admitted.why}`);
const rj = admitted.record;
// EVERYTHING AFTER IS DONE TO THE DIRECTORY ADMITTED, AND WITH THE RECORD ADMITTED (G-5 of 20261023-014400-rdt-delivery):
// the allow-list came from a second read of run.json through the path the caller spelled, which admitRun never checked.
const runDir = admitted.dir;
// AND IT MUST BE THE RUN THIS NODE BELONGS TO (G-5, security-audit). Containment plus self-naming
// still admits any OTHER legitimate run directory in the tree — and run.json is a tracked artifact,
// so a project mounting this submodule inherits committed run directories whose frozen contracts
// become allow-lists for its own lenses.
//
// spawn-node sets QUORATE_RUN_ID in the node's environment, outside the model's reach, exactly like
// the depth guard. Absent means a caller outside the graph — /request, a probe, a person — and that
// keeps working: this pins a NODE to its own run, and it is a node that has an allow-list to abuse.
if (process.env.QUORATE_RUN_ID && rj.run_id !== process.env.QUORATE_RUN_ID) {
  die(`--run-dir ${runDir} belongs to run ${rj.run_id}, but this node is running under `
    + `${process.env.QUORATE_RUN_ID}. Another run's frozen contract is not this node's allow-list.`);
}
// --cwd is confined to the ADMITTED repository, not to the host.cwd the run.json under test names (A-28).
const repoRootForCwd = admitted.repoRoot;

// --cwd is confined to the repository under review, as admitted above. Unconfined, an allowed
// read-only git command run from outside the tree tees a FOREIGN repository into this run's
// evidence — the read-outside family, reached by working directory instead of by flag (G-3).
if (opts.cwd) {
  const wanted = path.resolve(opts.cwd);
  if (!isWithin(repoRootForCwd, wanted)) {
    die(`--cwd ${wanted} is outside the repository under review (${repoRootForCwd}); refusing (G-3)`);
  }
  // THE SECOND STEP. The test above is lexical, and path.resolve collapses `..` and nothing else —
  // so a symlink or junction inside the reviewed tree pointing outside it was accepted, the allowed
  // read-only git set then ran in a foreign tree, and its output was teed into this run's evidence:
  // the read-outside family reached by working directory, which the comment above claims to close
  // (G-7). The same two-step this project applies to reviews_dir and to every cited finding path.
  let realRoot, realWanted;
  try { realRoot = fs.realpathSync(repoRootForCwd); realWanted = fs.realpathSync(wanted); } catch {
    die(`--cwd ${wanted} could not be resolved through links; an unresolvable path is not evidence of containment (G-7)`);
  }
  if (!isWithin(realRoot, realWanted)) {
    die(`--cwd ${wanted} leaves the repository under review through a link; refusing (G-7)`);
  }
}

// THROUGH THE ONE OWNER (run-dir-descendants.plan.md stage 2; G-4 of 20261023-014400-rdt-delivery): evidence/<node> was
// created recursively and checked after, so a junction planted at either level sent this log wherever it pointed. The
// owner walks each level, refuses a link at any of them, and creates what is missing one level at a time.
const owner = confined(runDir);
let evidenceDir;
try { evidenceDir = owner.dir(['evidence', opts.node]); } catch (e) { die(`evidence/${opts.node}: ${e.message}; refusing to write evidence there`); }

// A NAME THAT IS FREE, not the name asked for (G-6, panel-codex-arch). This wrote the caller's
// chosen path directly, so a repeated `--name` overwrote an accepted capture IN PLACE — and the
// finding that cited the destroyed log still cites its path, which now holds something else. The
// run's other evidence writer has used freeEvidenceName since the panel-check clobber taught it;
// capture, the writer nodes actually reach for, did not. Retries are the NORMAL case here: a lens
// that captures, reads the output and captures again with the same name is following its brief.
const wantedName = opts.name.endsWith('.log') ? opts.name : `${opts.name}.log`;
const logAbs = freeEvidenceName({ owner, segments: ['evidence', opts.node] }, wantedName.slice(0, -4), '.log');
const logName = path.basename(logAbs);
// THE CITED PATH IS THE FILE WRITTEN (run-dir-descendants.plan.md stage 5; G-5 of 20261024-122231-rdt-remediation-3-review):
// relative to the run, from the directory the owner made, not rebuilt from the node id the caller passed.
const logRel = path.relative(runDir, path.join(evidenceDir, logName)).split(path.sep).join('/');

// ---------------------------------------------------------------------------- payload allow-list
// THIS is the enforcement point for what a node may execute, and it has to be, because the
// permission layer cannot reach it. node-settings.json grants
// `Bash(node .claude/skills/scripts/capture.mjs:*)` — a PREFIX rule — and everything after `--`
// rides in behind that prefix unexamined. Without the check below, `capture.mjs ... -- rm`,
// `-- curl`, `-- claude` (which the recursion guard exists to forbid) and `-- type <any path>`
// all execute, and the last one tees an out-of-repo file into a run artifact. That is not a
// weakened control, it is the whole node containment boundary, and one arm of it is
// credential_exposure (disk-first-protocol §6, non-waivable).
//
// Demonstrated by a security-audit over this very script, which executed `hostname` through the
// proxy and produced every one of its own evidence logs with `git grep` — a command the policy
// does not grant either. new-run.mjs refuses `Bash(cd:*)` on exactly this prefix-matching
// reasoning, two lines above the grant that defeated it.
//
// The list is derived from the contract, not hardcoded: a node may run what the repo declares,
// plus a fixed set of read-only inspection commands that produce evidence and change nothing.
// THE SET AND ITS CHECKS ARE lib/capture-admit.mjs's (capture-interactive.plan.md stage 4): the interactive front end's
// `--mode read-only` applies the same list, so it has one owner. Why each entry is there stays recorded here:
//
// The git set: inspections that produce evidence and change nothing, their tails checked (below).
  // doc-consistency-review is REQUIRED to run this, so it has to be reachable — an instruction
  // the policy forbids is an instruction that cannot be followed. It only reads files and shells
  // out to `git ls-files` / `git grep`, so it grants nothing the entries above do not, and
  // routing it through capture means its output lands in evidence with a citable path.
  //
  // The path comes from DETECTOR_ABS — computed above from THIS file's location — in
  // every separator spelling a caller can reasonably write. The list used to admit only the legacy
  // '.claude/skills/scripts/' literal while the comment on the computed values named this exact
  // failure: in plugin layout the one sanctioned route refused the one mandatory command, and the
  // sweep silently degraded to whatever greps the reviewer thought of (G-29).
  // ABSOLUTE ONLY (G-6, security-audit, demonstrated live through this very channel). The relative
  // spellings were resolved by node against the SPAWN's working directory — `opts.cwd` when the
  // caller passes `--cwd` — not against capture.mjs's own location, which is the whole point of
  // deriving them. A capture with --cwd pointing at scripts/ passed both the allow-list and the
  // tail check, and node then tried to load <cwd>/scripts/find-inert-features.mjs: a path INSIDE
  // the reviewed tree, which the reviewed tree can itself contain. Had that file existed it would
  // have run under the node's permissions with the environment unscrubbed.
  //
  // Same defect the two deleted legacy literals were removed for, reintroduced by a relative
  // spelling of the right value — and the rule stated below says it outright: capture executes a
  // framework script only by a path DERIVED from its own location. A relative path is not one; it
  // is a path relative to wherever the caller happens to stand.
  //
  // Both separator spellings of the ABSOLUTE path are kept, because a model writes either.
  // The two legacy literals that used to sit here — '.claude/skills/scripts/find-inert-features.mjs'
  // and its backslash spelling — are GONE, and must not come back. They resolved against the
  // CONSUMER's repo root, so any project with a file at that path (precisely the layout a
  // quorate-descended project has, and one the consumer-mount fixture actually shipped) would have
  // had ITS file executed through the sanctioned evidence channel, under the node's permissions.
  //
  // They were redundant as well as dangerous: in the legacy vendored layout capture.mjs itself lives
  // at .claude/skills/scripts/, so DETECTOR_ABS already resolves to exactly that
  // path. They added nothing in the layout they existed to serve.
  //
  // The rule: capture executes a framework script only by a path DERIVED from its own location. A
  // literal a consumer can create is not a path to our file, it is a path to whatever they put there.
const READ_ONLY = readOnlyPrefixes(DETECTOR_ABS);

function declaredCommands() {
  // The authority is the RUN'S frozen contract, never a CLAUDE.md found by walking up from a
  // path the CALLER supplied. The old walk started at opts.cwd and stopped at the first
  // CLAUDE.md, so a node could point --cwd into any subtree carrying a second graph_contract —
  // the documented consumer mount ships one (quorate's own) — and select an allow-list the
  // reviewed repository never declared (G-7). run.json was written by the orchestrator before
  // any node existed and carries the parsed contract; a run directory without it grants only
  // the read-only set.
  try {
    const contract = rj.contract;
    // Through contractArgv, with the contract's OWN shell key — the same construction run-checks
    // uses to build the argv it hands this script. The old private split stored commands
    // unwrapped, so a repo declaring commands.shell had run-checks send ['bash','-lc',cmd] while
    // the allow-list held ['node',...]: no prefix matched, capture exited 2, and the barrier
    // reported the project's BUILD broken when what was refused was the evidence recorder (G-3).
    const shell = contract?.commands?.shell ?? '';
    // `run` is the ONE command that starts the product rather than inspecting it, so it is granted
    // to exactly one node: the lens whose entire contract is to exercise the built artifact and
    // cite captured evidence. Every other node sees the same list it always did.
    //
    // The gate is HERE and not in a settings file because a settings file cannot see this command:
    // capture spawns it itself, and the CLI permission layer only ever observes
    // `node capture.mjs ...`, which every lens may already invoke. Putting commands.run into
    // feature-verify's brief therefore changed nothing on its own — a brief is not an enforcement
    // layer — and the lens stayed structurally unable to report OK (G-36).
    //
    // TRUST BASIS, stated rather than implied: `--node` is SELF-DECLARED. This confines a careless
    // lens, not a determined one, and there is nowhere to put a secret that would make it stronger
    // — node policy grants Read on the repository root and briefs live under .claude/reviews/, so
    // every lens can read every other lens's brief. The residual is accepted deliberately: the
    // worst case is a lens launching the operator's OWN declared command, bounded by the per-lens
    // timeout, which is a hang or a state mutation and not a credential loss. The boundary that
    // matters against a THIRD party is the panel's env allow-list, and that one is closed.
    // FROM THE RUN, not from a literal here (G-5). This module and run-graph each held the bare
    // string 'feature-verify' — one enforcing the grant, the other offering it in the brief — while
    // lens-roster.json declared every other per-lens property. run.json carries the roster's answer
    // as `runner_nodes`, and run.json is already this script's only authority.
    //
    // Falls back to the literal when the field is absent: a run minted by an older engine, or the
    // pre-flight run-checks path, must not lose the grant it has always had.
    const runners = Array.isArray(rj.runner_nodes) && rj.runner_nodes.length
      ? rj.runner_nodes
      : ['feature-verify'];
    // The ONE owner of this set (G-7): capture and new-run must agree about which declared
    // commands a node may run, and they used to hold separate copies.
    const inspectKeys = EXECUTABLE_COMMAND_KEYS;
    const keys = runners.includes(opts.node) ? [...inspectKeys, 'run'] : inspectKeys;
    // With its KEY, so the log can name what was admitted (remediation-verification stage 1): `$ ` joins argv with
    // spaces and loses its boundaries, and the runner's evidence gate needs the key, not a reconstruction.
    return Object.entries(contract?.commands ?? {})
      .filter(([k]) => keys.includes(k))
      .map(([k, v]) => ({ key: k, cmd: String(v ?? '').trim() }))
      .filter((d) => d.cmd)
      .map((d) => ({ key: d.key, argv: contractArgv(d.cmd, shell) }));
  } catch {
    return [];
  }
}

// The tail of a read-only command is constrained, not waved through: isPrefix matched only the
// leading tokens, so `git diff --output=<path>` rode an allowed prefix into an arbitrary-path
// file write, demonstrated live by the verification run (G-8) — and `git grep
// --open-files-in-pager=<cmd>` is the execution form of the same gap. The deny below names the
// flag families of the read-only git set that write files or launch programs. It is a deny-list
// and therefore incomplete BY CONSTRUCTION against future git flags; it exists because the
// legitimate tail (refs, paths, -n, -c counts) is open-ended and cannot be enumerated either.
// Three families are named: flags that WRITE files, flags that LAUNCH programs, and flags that
// READ outside the repository — a future git flag in any of them rides through until added.
// The residual risk is named here rather than implied away. Declared contract commands take no
// constrained tail — their entire argv is the declaration.
// FORBIDDEN_TAIL now lives in lib/forbidden-tail.mjs as forbiddenTailToken(), because a
// deny-list of regexes matching whole tokens could not see a short flag hiding inside a BUNDLE:
// git parse-options treats `-nOcat` as `-n -O cat`, so the pager-launch flag reached git unexamined
// and git runs the pager through a shell. Demonstrated live by this project's own security lens,
// which wrote a file from outside the repository into the run's evidence directory.

const declared = declaredCommands();
// ONE OWNER DECIDES (lib/capture-admit.mjs): a declared command by EXACT argv equality — its whole argv IS the declaration;
// prefix-matching admitted undeclared trailing arguments (`npm test <injected>`, G-5) — and the read-only set by prefix
// with its tail constrained, because its legitimate arguments (refs, paths) are open-ended. Its rules, and why:
//
// THE DETECTOR TAKES NO TAIL. forbiddenTailToken models GIT's flag grammar — short-flag bundles,
  // `-O`, long options and their abbreviations — and it was being applied to the arguments of a
  // `node <find-inert-features.mjs>` command, whose flag vocabulary has nothing in common with
  // git's (G-6). The mismatch is narrower than it looks, because node options must PRECEDE the
  // script and the tail is therefore script argv rather than interpreter flags — but a guard aimed
  // at the wrong grammar is a guard that will be wrong the moment either grammar changes.
  //
  // find-inert-features.mjs accepts `--repo-root` and `--json` and dies on anything else, and the
  // sanctioned invocation passes neither. So the honest rule is the tightest one: this entry admits
  // the command and nothing after it.
  //
  // The subcommand decides some escapes (`grep -f`, `blame -S`, `ls-files -X`), so the whole tail is checked with it (G-17).
  //
  // IMPLICIT NO-INDEX (G-4 of 20261030-124823-ciss-stage7): git diff ENTERS no-index mode by itself when a path it is
  // given lies outside the working tree, so refusing the literal --no-index left `git diff <outside> <outside>` reading
  // any file into the evidence. Every argument that is not an option is taken as a path and must resolve inside the
  // repository; a ref (`HEAD`, `a..b`) resolves inside it too, so only a path that leaves is refused.
const admit = admitCommand(cmd, { declared, readOnly: READ_ONLY, repoRoot: repoRootForCwd });
if (!admit.ok && admit.kind === 'refused-tail') die(admit.why);
const declaredHit = admit.ok ? admit.declaredHit : null;
const declaredMatch = Boolean(declaredHit);
const readOnlyMatch = admit.ok ? admit.readOnlyMatch : null;
// THE NARROW CHECK (remediation-verification.plan.md, stage 1): `commands.test_one`, a declared template with one
// `{file}` placeholder, filled with one admissible test file. Granted to the remediation node of a remediation run only,
// the way `run` is granted to its one node: a lens never runs it, since §3's trust basis ("the operator's own declared
// command") is weaker for a template that takes a file. From the repository root only, so the file checked is the file
// run. lib/test-one.mjs decides; io/test-one.mjs supplies git's file list and the link check.
let testOne = null;
if (!declaredMatch && !readOnlyMatch) {
  const template = testOneTemplate(rj.contract ?? {});
  const hit = template.ok ? matchTestOne(cmd, template) : null;
  if (hit) {
    if (!rj.remediates || opts.node !== 'remediation') {
      die(`refusing \`${cmd.join(' ')}\`: commands.test_one is run only by the remediation node of a remediation run, `
        + `not by --node ${opts.node}`);
    }
    if (opts.cwd !== undefined) die(`refusing \`${cmd.join(' ')}\`: commands.test_one runs from the repository root; --cwd is not admitted with it`);
    const why = testOneFileRefusal(hit.file, testOneFacts(repoRootForCwd ?? process.cwd(), rj.contract ?? {}));
    if (why) die(`refusing \`${cmd.join(' ')}\`: ${why}`);
    testOne = hit;
  }
}
if (!declaredMatch && !readOnlyMatch && !testOne) {
  console.error(admit.why);
  process.exit(2);
}

// A capture is BOUNDED. Every other command here inspects and returns, but `run` is by definition
// the one that STARTS the product and keeps running — granting it (G-36) without a ceiling meant a
// server-style command would block this blocking spawnSync until the orchestrator tree-killed the
// node, printing no evidence path and leaving the lens DEGRADED: the same structural inability to
// report that grant was meant to remove (G-9).
//
// --timeout-minutes lets the caller size it; the default is generous for an inspection and finite
// for a launch. On timeout spawnSync returns status null, which the existing `=== null ? 124` line
// already records as a timeout exit rather than a success.
// ONE OWNER (G-1 of 20261004-172841-m1-6b-check-timeout-2): what a timeout may be — whole minutes, 1 to the most
// spawnSync can hold, 10 when absent — is lib/check-timeout.mjs's, and this flag is judged by it rather than by rules of
// its own (it once rounded fractions and fell back to its own 10 while the owner refused them). A value the owner
// refuses is refused here, before anything launches.
// WITH NO --timeout-minutes, THE CONTRACT'S CEILING (remediation-verification.plan.md, stage 2): the default was a fixed
// 10 minutes, which a remediation node's own capture of the full suite could not fit, and the contract's
// `review.check_timeout_minutes` bounded only the pre-flight. It now bounds every capture whose caller passes no limit
// (lenses and feature-verify's `run` launch included), and a malformed value refuses the capture, as it refuses the
// pre-flight. Absent, the owner's default (CHECK_TIMEOUT_DEFAULT_MINUTES) still applies.
let timeoutMinutes;
try {
  timeoutMinutes = opts.timeoutMinutes === undefined
    ? checkTimeoutMinutes(rj.contract ?? {})
    : checkTimeoutMinutes({ review: { check_timeout_minutes: opts.timeoutMinutes } });
} catch (e) {
  const what = opts.timeoutMinutes === undefined ? 'the contract\'s review.check_timeout_minutes' : `--timeout-minutes ${JSON.stringify(opts.timeoutMinutes)}`;
  console.error(`capture: ${what} refused: ${e.message}`);
  process.exit(2);
}
const timeoutMs = timeoutMinutes * 60_000;

// No shell: the command is argv, so quoting and injection are non-issues.
//
// ENVIRONMENT INHERITED, DELIBERATELY. The child here is a command the PROJECT DECLARED in its own
// graph_contract — its build, its tests, its linter — run on the operator's machine at the
// operator's request. That is the same trust level as typing the command, and real test suites
// legitimately need credentials (a DATABASE_URL, a registry token) that a scrub would remove,
// turning a working project's barrier red for a reason it could not diagnose.
//
// This is NOT the same decision as spawn-node's, and the difference is the point: that child is an
// agentic model process which can reach further than the command it was given, so it is scrubbed.
// A declared command cannot. Named here rather than left implicit, because "spawned without an
// explicit environment" reads as an oversight when it is a judgement (G-7).
//
// REPORTED FOUR TIMES NOW (G-7, then G-9 and G-4 from panel-codex-security), and DECLINED each time with
// the same reasoning, which is recorded in ARCHITECTURE.md A-26 rather than only here (this comment cited
// disk-first-protocol.md §3, which does not state it). The condition that would flip it is A-26's too, and is
// worth restating: this holds while the
// commands are the OPERATOR'S OWN, declared in their own contract. A quorate that ever runs a
// command from an untrusted source — a fetched config, a PR's own contract — needs the scrub, and
// the argument above stops applying the moment that is true.
// THE RUN PIN DOES NOT CROSS INTO THE DECLARED COMMAND (G-5/G-34, code-audit + contract-audit).
//
// QUORATE_RUN_ID authorises THIS process to use THIS run's allow-list. A child inherits the
// environment — §3 says so explicitly for GRAPH_NODE_DEPTH — so a lens producing evidence the
// sanctioned way, by capturing the declared `test` command, ran the whole suite with the run id
// pinned; and every test that drives capture.mjs against its own fixture run directory was then
// refused with "belongs to run X, but this node is running under Y". Twenty-one regression tests,
// and the ones affected pin the containment boundary itself.
//
// Deleted rather than narrowed: the pin is a fact about who may read WHICH CONTRACT, and the command
// being captured is not reading a contract at all. It has no more business seeing this than it has
// seeing the depth guard — which tests/helpers.mjs already clears for the same reason.
// AND IN A REMEDIATION RUN, NOT THE RUNTIME'S AUTH (G-23 of 20261008-214527-remediate-rebuild-review): the command may run
// code the remediator wrote. The rule is lib/decisions.mjs's commandEnvFor.
// The run's runtime is chosen by the one owner from its frozen contract, as remediate.mjs chooses it for the node, and its
// adapter's keep_auth names the auth removed (G-4 of 20261114-032609-m2-7b-remediation-review): the fixed set alone let
// another runtime's key cross. A runtime that cannot be chosen refuses the capture rather than guess.
const runtimeAdapter = (() => {
  if (!rj.remediates) return undefined;
  try {
    const adapters = selectAdapters({ contract: rj.contract ?? null });
    const adapter = adapters.table[adapters.runtime];
    if (!adapter) throw new Error(`runtime ${adapters.runtime} is not in the adapter table`);
    return adapter;
  } catch (e) { return die(`the run's runtime could not be chosen (${e.message}); refusing to run a command with its auth unknown`); }
})();
// A READ-ONLY GIT INSPECTION runs with git's own scrubbed environment, as every git the engine starts does (io/git.mjs):
// a helper it may start (a diff driver, fsmonitor, a pager) inherits no secret (G-3 of 20261115-220919-ci-delivery).
// A declared command keeps the command environment its declaration was written for.
const commandEnv = !declaredHit && readOnlyMatch?.[0] === 'git'
  ? gitEnvFor(commandEnvFor(process.env, { remediation: Boolean(rj.remediates), runtime: runtimeAdapter }))
  : commandEnvFor(process.env, { remediation: Boolean(rj.remediates), runtime: runtimeAdapter });

// ONE VALUE, RUN AND RECORDED (G-6 of 20261023-014400-rdt-delivery): the header wrote process.cwd() when --cwd was absent
// while the child ran at the admitted repository.
const childCwd = opts.cwd ? path.resolve(opts.cwd) : (repoRootForCwd ?? process.cwd());
// THROUGH THE ONE ASYNC CORE (capture-interactive.plan.md stage 3). spawnSync's `timeout` with SIGKILL ended the direct
// child only, so a grandchild holding the same pipes outlived the deadline (measured on Linux, 2026-11-15:
// tests/regression-capture-tree-deadline.test.mjs). spawnCapture stops the whole tree through the stop owner, and the
// platform's killable options put the child in a group the owner can reach. Each stream is kept as its head and tail,
// MAX_LOG_BYTES each, so memory is bounded whatever the command prints and the log window below is cut from what was kept;
// the 64 MiB spawn buffer, and its overflow, are gone.
const res = await spawnCapture(cmd[0], cmd.slice(1), {
  cwd: childCwd,
  env: commandEnv,
  windowsHide: true,
  ...hostPlatform().proc.killableSpawnOptions(),
}, { timeoutMs, collector: headTailKeeper(MAX_LOG_BYTES) });

const stdout = keptStreamView(res.streams.stdout);
const stderr = keptStreamView(res.streams.stderr);
// 124 FOR A DEADLINE, WHATEVER THE CHILD EXITED WITH: spawnSync gave status null for a child it killed, while a child the
// stop owner ends exits with a code of its own (1 on Windows, where taskkill /F ends it), which read as the command's.
const exitCode = res.status === null || res.timedOut ? 124 : res.status;

// THE ONE FACT ONLY THIS PROCESS HAS (G-48). Exit 124 is not it: `status === null` also covers a
// spawn failure, so the exit code cannot tell a reader which happened. The core says when IT enforced
// the deadline, and that is the engine reporting its own action rather than interpreting a runner's.
// run-checks reads this line back — it already opens the log to count tests — and a killed test suite
// is then diagnosed as "size your timeout" rather than as "your package is not installed", which is
// what it used to say.
const timedOut = res.timedOut;

// Every value a caller chose passes through headerValue (G-2 of 20261013-220031-rv-delivery): the header is
// line-oriented, and a line break in an argument would write a forged `# exit:` ahead of the real one.
const header =
  `$ ${headerValue(cmd.join(' '))}\n` +
  // WHAT WAS ADMITTED, structured (remediation-verification stage 1): the declared key, or `test_one` and its file. The
  // runner's evidence gate reads this line, not the `$ ` line above, which loses argument boundaries.
  (declaredHit ? `# admitted: ${headerValue(declaredHit.key)}\n` : testOne ? `# admitted: test_one ${headerValue(testOne.file)}\n` : '') +
  `# cwd: ${headerValue(childCwd)}\n` +
  `# exit: ${exitCode}${res.signal ? ` (signal ${res.signal})` : ''}\n` +
  // The ceiling the command ran under, always: a reader of a log that was NOT killed still needs to know how long it
  // was allowed (M1 stage 5: a suite was killed at a default nobody could see or change).
  `# timeout: ${timeoutMs / 60_000} minute(s)\n` +
  // How much of its own session the node has used (remediation-consumer-findings.plan.md stage 3): the one clock it can read.
  `${elapsedLine(process.env, Date.now())}\n` +
  // A stop the owner could not confirm is said in its words (A-25): the tree may still run, and "killed" would be false.
  (timedOut ? `# timed-out: killed by capture after ${timeoutMs / 60_000} minute(s)`
    + `${res.survivor && res.stopSentence ? `; ${headerValue(res.stopSentence)}` : ''}\n` : '') +
  // The other half of status null (G-1 of 20261017-215958-fmt-remediation-3-review): a command that could not start did
  // not run to completion, and its 124 is not the command's own exit.
  (res.error && !timedOut ? `# error: ${headerValue(res.error.code ?? res.error.message)}\n` : '') +
  `# captured: ${new Date().toISOString()}\n` +
  `${HEADER_RULE}\n`;

// The common path does NOT concatenate the whole output (G-8): its length is the sum, and header,
// stdout and stderr are written as three appends below. Only the oversized path builds a single
// buffer — and only the ~1 MiB it keeps. This is the one script whose input class is a project's
// build and test output, so a spared whole-output copy is a spared multiple of peak memory.
// THE HEADER IS PART OF THE BUDGET (G-5, panel-codex-contract). I-30 bounds the log ON DISK at
// 1 MiB, and logWindow was given the whole budget for command output alone — then capture wrote a
// header and, on the truncated path, a truncation notice into the same file, so the artifact came
// out over the stated limit by exactly the bytes the framework itself added. A limit a writer
// exceeds by its own bookkeeping is not a limit.
const OUTPUT_BUDGET = Math.max(1024, MAX_LOG_BYTES - Buffer.byteLength(header));
const totalLen = stdout.length + stderr.length;
let body = null; // built only when truncating
let truncated = false;
if (totalLen > OUTPUT_BUDGET) {
  // SLICED FROM THE TWO BUFFERS, never joined first. This built `Buffer.concat([stdout, stderr])`
  // — a full copy of everything the command produced, up to the 64 MiB spawn buffer — only to keep
  // about a megabyte of it, doubling peak memory at the one moment that output is already enormous
  // (G-8). lib/log-window.mjs reads the window out of the pair, and holds the reasoning for keeping
  // a tail as well as a head (G-9).
  body = Buffer.concat(logWindow([stdout, stderr], OUTPUT_BUDGET, ({ total, headBytes, tailBytes, dropped }) =>
    Buffer.from(`\n\n[TRUNCATED — ${total} bytes produced; first ${headBytes} and last ${tailBytes} kept, ${dropped} dropped from the middle]\n\n`)));
  truncated = true;
}

// Header then output, written in pieces (G-5, G-8): on the common path stdout and stderr go straight to disk with no
// intermediate whole-output buffer; on the truncated path `body` is the kept slice. ONE EXCLUSIVE CREATE through the
// owner (run-dir-descendants stage 2): a name another writer took, or a link planted at it, is refused, not overwritten.
try {
  owner.create(['evidence', opts.node, logName], body !== null ? [header, body] : [header, stdout, stderr]);
} catch (e) { die(`${logRel}: ${e.message}`); }

// A failure to start, said as one. A timed-out command did start: its error is the stop's, already in the header. No
// overflow branch any longer: output is streamed and windowed, never held in a spawn buffer that can overflow.
if (res.error && !timedOut) process.stderr.write(`capture: command failed to start: ${res.error.message}\n`);

// Preview on stderr so stdout stays exactly one path.
// Preview decoded from the TAIL of the buffer only — 64 KiB comfortably bounds the last 120
// lines — instead of materialising the whole body as a string plus a per-line array (G-5).
// Preview from the tail: the truncated buffer if we built one, else the tail of stderr (where a
// build/test failure's diagnosis lands) falling back to stdout — never a whole-output copy (G-8).
const previewSrc = body ?? (stderr.length ? stderr : stdout);
const text = previewSrc.subarray(Math.max(0, previewSrc.length - 64 * 1024)).toString('utf8');
const lines = text.split('\n');
const preview = lines.length > PREVIEW_LINES ? lines.slice(-PREVIEW_LINES) : lines;
if (lines.length > PREVIEW_LINES) {
  process.stderr.write(`[showing last ${PREVIEW_LINES} of ${lines.length} lines; full output in ${logRel}]\n`);
}
// Masked (G-4 of 20261115-220919-ci-delivery): the preview reaches the node's transcript; the log keeps the bytes.
process.stderr.write(preview.map((l) => redactClaim(l)).join('\n'));
if (!text.endsWith('\n')) process.stderr.write('\n');
process.stderr.write(
  `${HEADER_RULE}\ncapture: exit ${exitCode}${truncated ? ' (log truncated)' : ''} -> ${logRel}\n`,
);

// stdout: the canonical path, alone. Cite exactly this.
process.stdout.write(`${logRel}\n`);
// AN END THE PROCESS REACHES BY ITSELF, NOT process.exit (2026-11-16; operator: "Capture + suite timeout now, rest drafted
// (Recommended)"). process.exit joins V8's worker threads, and one parked in a Maglev compile job waits for a garbage
// collection the exiting main thread never runs: a Node bug (nodejs/node#64274) this script met about 1 run in 3 after
// large output, its log written and the process idle for hours. Nothing is left running here (the child has closed, the
// stop timer is cleared), so the event loop ends at once and the code below is the exit code.
// tests/regression-exit-deadlock-guards.test.mjs; the engine's other process.exit calls are
// .claude/requests/exit-deadlock.followup.md.
process.exitCode = exitCode;
