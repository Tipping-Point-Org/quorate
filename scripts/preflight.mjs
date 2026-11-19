#!/usr/bin/env node
// preflight.mjs — the pre-flight, as a thing the OPERATOR runs.
//
// WHY THIS IS A SCRIPT AND NOT AN INTERNAL. The operator's rule for where the barrier belongs:
//
//   "this should happen at the instalation/configuration phase, during normal use you can do basic
//    check to be sure no new pre-flightt is needed but thats all. running pre-flight frequently is
//    a bad choice"
//
// The half that moved to install time is "are these declared commands runnable at all, and what do
// they say" — and a check nobody can reach is not a check. Asked which files an operator should have
// to know about, the operator drew the line that decides this: "files that you need to run or edit
// are obviously needed to be known by the user... they live in the interface with the user". So this
// is a command, named in QUORATE.md beside check-install.mjs, and lib/preflight-cache.mjs is not.
//
// IT SHARES ITS DECISION WITH run-graph, it does not re-implement it. Both call preflightInputHash
// and preflightDecision; `--run` spawns the same run-checks.mjs a review spawns. An install path
// and a run path that agreed only by care would drift, and the first symptom would be an operator
// seeding a cache the next review does not consult.
//
//   node scripts/preflight.mjs              report: fresh, stale (with the reason), or absent
//   node scripts/preflight.mjs --run        execute the declared checks and seed the cache
//   node scripts/preflight.mjs --repo-root <dir>
//
// Exit codes: 0 fresh, or (with --run) the barrier passed
//             1 a barrier check failed
//             2 configuration error
//             3 stale or absent, WITHOUT --run — so a script can ask "does this need seeding?"

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CONTRACT_CANDIDATES, chooseContractSource } from './lib/contract-source.mjs';
import { parseContractYaml } from './lib/contract-yaml.mjs';
import { contractGlobErrors } from './lib/contract-glob.mjs';
import { codeIndexContractErrors } from './lib/code-index-contract.mjs';
import { candidateEnvErrors } from './lib/decisions.mjs';
import { defaultReviewsRoot, quorateHome, reviewsRootAllowed, ensureReviewsIgnore, reviewsIgnoreWarning } from './io/reviews-root.mjs';
import { isWithin } from './io/finding-scope.mjs';
import {
  preflightInputHash, readPreflightCache, preflightDecision, PREFLIGHT_COMMAND_KEYS,
} from './io/preflight-cache.mjs';
import { confined } from './io/confined-path.mjs';
import { hostPlatform } from './platform/index.mjs';
import { gitSync } from './io/git.mjs';

const die = (m) => { console.error(`preflight: ${m}`); process.exit(2); };

// THE OPERATING SYSTEM IS CHECKED FIRST (os-platform-adapters, criterion 11): an unsupported one is
// learned here, at pre-flight, rather than mid-review when the first node has to be killed.
let PLATFORM;
// hostPlatform(), not loadPlatform(): this check IS the process's one instantiation (criterion 7),
// and everything later in this process reuses it rather than testing the OS again.
try { PLATFORM = hostPlatform(); } catch (e) { die(e.message); }

const args = {};
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS.preflight)); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  if (v.run) args.run = true;
  if (v['repo-root'] !== undefined) args.repoRoot = v['repo-root'];
}

// THE RECURSION GUARD (§8; G-19 of 20260925-015614-platform-review). `--run` starts the pre-flight
// barrier, which executes every declared command — graph work — and this script handed its child
// GRAPH_NODE_DEPTH '0' unconditionally, laundering the nesting depth rather than failing closed. The
// same block every guarded entry point carries: an unreadable value aborts whatever was asked, and a
// depth above zero aborts only `--run`. The read-only FRESH/STALE check starts nothing, and the guard
// covers starting graph work, not running at all.
const { raw: RAW_DEPTH, depth: PARSED_DEPTH } = nodeDepth(process.env);
const DEPTH = PARSED_DEPTH ?? NaN;
if (!Number.isInteger(DEPTH) || DEPTH < 0) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} is not a non-negative integer — `
    + 'refusing to guess whether this is nested (§8).');
  process.exit(3);
}
if (DEPTH > 0 && args.run) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${DEPTH} — a graph node may not start the pre-flight barrier (§8).`);
  process.exit(3);
}

const repoRoot = path.resolve(args.repoRoot ?? process.cwd());
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- the contract
const entries = CONTRACT_CANDIDATES.map((rel) => {
  const abs = path.join(repoRoot, rel);
  return { path: rel, abs, text: fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null };
});
const chosen = chooseContractSource(entries);
if (!chosen.ok) die(`${chosen.why}\n  Declare a graph_contract block before seeding a pre-flight result.`);

let contract;
try {
  contract = parseContractYaml(chosen.yaml);
} catch (e) {
  die(`could not parse the graph_contract block in ${chosen.path}: ${e.message}`);
}
// A CONTRACT GLOB IS IN THE GRAMMAR (contract-glob-grammar.plan.md, stage 2): refused here as at new-run, through the
// same validator, since seeding a cache over an input set that silently lost an entry is the stale result this refuses.
{
  const errors = contractGlobErrors(contract);
  if (errors.length) die(`the contract declares globs outside the contract's glob grammar:\n  - ${errors.join('\n  - ')}`);
}
// review.candidate_env in its grammar too (candidate-check-boundaries.plan.md stage 2), refused as at new-run.
{
  const errs = candidateEnvErrors(contract.review?.candidate_env);
  if (errs.length) die(`${errs.join('; ')} (shared/claude-md-contract.md, review.candidate_env)`);
}
// THE code_index BLOCK IN ITS GRAMMAR, OR THE RUN IS REFUSED (code-index.plan.md stage 3), as at the other entry point.
{
  const errs = codeIndexContractErrors(contract);
  if (errs.length) die(`${errs.join("; ")} (shared/claude-md-contract.md, code_index)`);
}
const commands = contract.commands ?? {};

// ---------------------------------------------------------------- where the cache lives
// The SAME resolution new-run performs, so the entry this seeds is the entry a review reads. A
// declared reviews_dir writes runs into the tree; an empty one stages them under the engine's home,
// which is also where the cache becomes machine-local by construction.
const declaredReviews = String(contract.review?.reviews_dir ?? '').trim();
const reviewsRoot = (() => {
  if (!declaredReviews) return defaultReviewsRoot({ project: contract.project, repoRoot });
  const allowed = reviewsRootAllowed({
    repoRoot, home: quorateHome(), candidate: path.resolve(repoRoot, declaredReviews), isWithin,
  });
  if (!allowed.ok) die(allowed.why);
  return allowed.dir;
})();

// ---------------------------------------------------------------- is the last result still good?
const declared = PREFLIGHT_COMMAND_KEYS.filter((k) => String(commands[k] ?? '').trim());
if (!declared.length) {
  console.log('preflight: this contract declares no build, test, lint, fmt_check, typecheck, audit or deny command.');
  console.log('           Nothing to run. Every empty key is named verbatim in each run\'s not_checked[].');
  process.exit(0);
}

// The tree's own state, asked the way new-run asks it: a probe that FAILS is `null`, never `false`.
// "Could not establish that the tree is clean" and "the tree is clean" must not collapse into one
// value — unproven freshness is staleness, and that rule is only enforceable if the unknown case
// survives to the decision.
const dirtyProbe = gitSync(['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
const dirty = dirtyProbe.status === 0 ? dirtyProbe.stdout.length > 0 : null;

const { hash, inferred, why, file_count: fileCount, listedBy, relFiles } = preflightInputHash({
  repoRoot, contract, contractSource: chosen.path, reviewsDir: reviewsRoot,
});
const entry = readPreflightCache(reviewsRoot, hash);
// A declared set listed by git: the hash alone decides (preflight-reuse-by-hash).
const decision = preflightDecision({ entry, hash, dirty, hashDecides: !inferred && listedBy === 'git' });

console.log(`contract      ${chosen.path}  (graph_contract_version ${contract.graph_contract_version ?? contract.graph_contract ?? '?'})`);
console.log(`commands      ${declared.map((k) => `${k}=${JSON.stringify(String(commands[k]).trim())}`).join('\n              ')}`);
console.log(`input set     ${fileCount} file(s), ${inferred ? 'INFERRED' : 'declared'} — ${why}`);
console.log(`worktree      ${dirty === true ? 'DIRTY' : dirty === false ? 'clean' : 'unknown (git could not be read)'}`);
console.log(`cache         ${path.join(reviewsRoot, '.preflight-cache', `${hash.slice(0, 16)}….json`)}`);

if (decision.state === 'reuse') {
  const passed = decision.entry.results.filter((r) => r.status === 'PASS').length;
  const failed = decision.entry.results.filter((r) => r.status === 'FAIL').length;
  console.log(`\nFRESH — ${passed} passed, ${failed} failed, produced by ${decision.from} at ${decision.entry.ran_at}.`);
  if (decision.entry.barrier_failed) {
    console.log(`The barrier check \`${decision.entry.barrier_failed}\` FAILED on these inputs, and a review will`);
    console.log('be BLOCKED until it is fixed. Re-running would fail identically — nothing has changed.');
  }
  if (inferred) {
    console.log('\nThe input set was INFERRED, so a run reusing this is stamped CHECKS-INPUTS-INFERRED and');
    console.log('capped at RISK. Declare review.preflight_inputs with the globs your checks read to remove it.');
  }
  if (!args.run) process.exit(0);
  console.log('\n--run given anyway: re-running the declared checks.');
} else {
  console.log(`\nSTALE — ${decision.reason}.`);
  if (!args.run) {
    console.log('\nSeed it with:  node scripts/preflight.mjs --run');
    console.log('A review will otherwise run these checks itself, which is correct and is the cost this avoids.');
    process.exit(3);
  }
}

// ---------------------------------------------------------------- --run
//
// A MINIMAL RUN DIRECTORY, not a mint. run-checks.mjs reads run.json for the contract and writes its
// stamps back — it is a run's phase 0, and giving it one is cheaper and more honest than teaching it
// a second mode. The directory is removed afterwards: this produced no review, and a half-run left
// on disk under a reviews root is something `--resume` would try to continue.
//
// The run id is prefixed so nothing mistakes it for a review. It is NOT minted through new-run
// because that resolves lenses, derives scope, requires a diff and can refuse for reasons that have
// nothing to do with whether `npm test` works.
// THE ID SHAPE IS NOT COSMETIC. capture.mjs refuses a run directory whose basename does not match
// its own run.json.run_id (G-4), and every other artifact in this engine is named
// `YYYYMMDD-HHMMSS-<slug>`. Built by slicing an ISO string this first read `20260920023404.` —
// the fractional-second separator, kept because the slice length was counted rather than derived.
const now = new Date();
const two = (n) => String(n).padStart(2, '0');
const runId = `${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}`
  + `-${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}-preflight-seed`;
const runDir = path.join(reviewsRoot, runId);
// The ignore rule before the first byte (G-28): a declared in-repository reviews_dir seeded before its
// first mint otherwise left .preflight-cache/ visible to git.
{
  const ig = ensureReviewsIgnore(reviewsRoot);
  if (ig.missing.length) console.error(`preflight: ${reviewsIgnoreWarning(reviewsRoot, ig.missing)}`);   // G-24
}
// CLAIMED EXCLUSIVELY, THEN WRITTEN THROUGH ITS OWNER (run-dir-descendants.plan.md stage 4 found this seed run made
// recursively and written raw): the folder is created non-recursively, so a name already there refuses the seed, and
// everything below it goes through the one owner, as new-run's mint does.
fs.mkdirSync(path.dirname(runDir), { recursive: true });
try { fs.mkdirSync(runDir); } catch (e) {
  if (e.code === 'EEXIST') { console.error(`preflight: ${runDir} already exists; another seed claimed it first`); process.exit(2); }
  throw e;
}
const seedOwner = confined(runDir);
seedOwner.dir(['evidence']);

// The tree identity is recorded for the AUDIT TRAIL that travels with a reused result — the gate
// says which run produced the evidence, and this is that run.
const head = gitSync(['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
seedOwner.replace(['run.json'], `${JSON.stringify({
  run_id: runId,
  created_at: new Date().toISOString(),
  kind: 'preflight-seed',
  repo_root: repoRoot,
  head_commit: head.status === 0 ? head.stdout.trim() : null,
  worktree_sha: null,
  dirty,
  contract,
  contract_source: chosen.path,
  checks_input_files: relFiles,   // the list the hash above was taken over; run-checks records it (G-10)
  checks_input_files_sha256: hash,   // and that hash, so run-checks pairs the two (G-8 of 20261114-042824-m2-7b-remediation-2-review)
  // capture.mjs CONFINES `--cwd` TO THIS VALUE and refuses outright when run.json does not carry it
  // ("--cwd was given but run.json records no host.cwd to confine it to"). run-checks passes
  // `--cwd repoRoot` for every command, so a seed run.json without it makes every check exit 2 with
  // a null evidence_path — the engine refusing itself, recorded as though the project's build were
  // broken. It did exactly that on the first real seeding of this repository.
  host: { platform: PLATFORM.id, arch: process.arch, node_version: process.version, cwd: repoRoot },
  stamps: [],
}, null, 2)}\n`);

let code = 0;
try {
  // The hash computed above, BEFORE the checks, is the one the entry is keyed by (see run-checks).
  const r = spawnSync('node', [path.join(scriptsDir, 'run-checks.mjs'), '--run-dir', runDir, '--repo-root', repoRoot, '--input-hash', hash, ...(inferred ? ['--inputs-inferred'] : [])], {
    stdio: 'inherit', cwd: repoRoot, env: { ...process.env, GRAPH_NODE_DEPTH: String(DEPTH) },   // the real depth, never a laundered 0 (G-19)
  });
  code = r.status === 1 ? 1 : (r.status === 0 ? 0 : 2);
  if (r.status !== 0 && r.status !== 1) console.error(`preflight: run-checks exited ${r.status}`);
} finally {
  // The EVIDENCE is the one thing worth keeping, and it is exactly the thing that must not be kept
  // here: captured command output may hold a connection string or a token inside an error, and this
  // directory has no gate, no archive step and no ignore rule of its own. The cache entry carries the
  // result; the logs were read by run-checks and are discarded with the directory.
  // A removal that fails is SAID, naming the directory (G-4 of 20261114-051141-m2-7b-remediation-3-review): a silent catch
  // left logs that may hold a credential on disk with nothing telling the operator they were there.
  try { fs.rmSync(runDir, { recursive: true, force: true }); } catch (e) {
    console.error(`preflight: could not remove the seed directory ${runDir} (${e.code ?? e.message}); its captured logs `
      + 'may hold a credential printed by a check, so remove it by hand');
  }
}

// WHETHER THIS SEED WAS CACHED (check-outcomes.plan.md stage 3; plan-review rounds 5, 6): run-checks declines to cache a
// check that did not run to its own end, so the exit code alone cannot say. The entry for this hash must be THIS seed's:
// an older entry for the same hash survives a re-run that was not cached.
const seeded = (code === 0 || code === 1) && readPreflightCache(reviewsRoot, hash)?.run_id === runId;
if ((code === 0 || code === 1) && !seeded) {
  console.error('\nNot cached: a check did not run to completion (timed out, stopped, or could not start), which says');
  console.error('something about this run rather than the tree. A review re-runs the checks; see the output above.');
} else if (code === 1) {
  console.error('\nA barrier check FAILED. The result is cached: a review will be BLOCKED on these inputs');
  console.error('until the tree changes, rather than spending a model call to reach the same conclusion.');
} else if (code === 0) {
  console.log('\nSeeded. Reviews on this input set reuse this result until an input changes. With the set inferred,');
  console.log('or not listed by git, a dirty worktree invalidates it too (preflight-reuse-by-hash).');
}
process.exit(code);
