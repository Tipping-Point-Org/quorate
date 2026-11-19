#!/usr/bin/env node
// Reopen the session a long run was in, after a crash or a reboot (autonomous-run.plan.md stage 7; autonomous-run.md
// criterion 13: "if a formal command helps, that's acceptable"). The line is the runtime adapter's `cmd` and
// `node_runtime.resume_argv` from scripts/reviewers.json with the run's recorded session filled in — never a CLI
// literal here (A-9). An adapter that declares no resume_argv is refused.
//
//   node <framework-root>/scripts/resume-run.mjs          print the line
//   node <framework-root>/scripts/resume-run.mjs --exec   start it, attached to this terminal
//
// Stage 1 measured what a resume restores: the conversation, with a killed background command reported as stopped,
// not re-run. Starting it at logon is a per-user task the operator installs; this script installs nothing.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nodeDepth } from './lib/node-depth.mjs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { resumeLine } from './lib/run-state.mjs';
import { readRunState } from './io/run-state.mjs';
import { selectAdapters, overrideLine, needsShell } from './io/reviewers.mjs';
import { readContract } from './io/contract-reader.mjs';
import { gitSync } from './io/git.mjs';
import { hostPlatform } from './platform/index.mjs';

const { raw: RAW_DEPTH, depth: DEPTH } = nodeDepth(process.env);
if (DEPTH === null) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} is not a non-negative integer — refusing to guess whether this is nested (§8).`);
  process.exit(3);
}
if (DEPTH > 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${DEPTH} — a graph node may not reopen a session (§8).`);
  process.exit(3);
}

const die = (msg, code = 2) => { console.error(`resume-run: ${msg}`); process.exit(code); };
let v;
try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['resume-run'])); } catch (e) {
  if (!(e instanceof ArgvError)) throw e;
  die(e.message);
}
let repoRoot = v['repo-root'] ? path.resolve(v['repo-root']) : null;
if (!repoRoot) {
  const top = gitSync(['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0) die('not inside a git repository');
  repoRoot = path.resolve(top.stdout.trim());
}

// A state that cannot be read is said, as `run-session status` says it (G-9 of 20261105-031048-ar-d1-c-remediation-3-review:
// the read had no error path, so a corrupt or linked state crashed with a stack trace).
let state;
try { state = readRunState(repoRoot); } catch (e) { die(`the run state could not be read: ${e.message}`); }
if (!state) die('no active run in this repository (`run-session.mjs start` begins one)', 1);
// The table the engine runs, the contract's declarations merged (G-15 of 20261105-013235-ar-d1-c-remediation-review): a
// contract overriding the node runtime is resumed with the command it runs, and the override is named (A-26).
// Chosen by the one owner, as new-run's is (G-17 of 20261105-021654-ar-d1-c-remediation-2-review;
// contract-runtime-and-session-files.plan.md stage 1): the contract's review.runtime, else the table's default, so a run on
// a non-default adapter is resumed with that adapter's command.
let ADAPTERS; let runtime;
try {
  const read = readContract({ cwd: repoRoot });
  if (read.error) throw new Error(`could not read the contract: ${read.error}`);
  ADAPTERS = selectAdapters({ contract: read.contract ?? null });
  runtime = ADAPTERS.runtime;
} catch (e) { die(e.message); }
const table = ADAPTERS.table;
for (const o of ADAPTERS.overrides) console.error(`resume-run: ${overrideLine(o)}`);
const line = resumeLine(table[runtime], state.session);
if (!line.ok) die(line.reason, 1);
console.log(`resume-run: ${[line.cmd, ...line.argv].join(' ')}   (run on ${state.plan})`);
if (v.exec) {
  const r = spawnSync(line.cmd, line.argv, { cwd: repoRoot, stdio: 'inherit', shell: needsShell(table[runtime], hostPlatform()) });
  process.exit(r.status ?? 1);
}
