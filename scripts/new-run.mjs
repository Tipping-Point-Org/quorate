#!/usr/bin/env node
// new-run.mjs — create a run directory, resolve the contract, and validate the sandbox policy
// BEFORE any model is spawned.
//
// This is the only component that parses CLAUDE.md. Everything downstream reads the already
// parsed contract out of run.json, so there is exactly one parser and it cannot drift.
//
// Exit codes: 0 run created (or --dry-run succeeded)
//             2 contract or settings error — nothing was created
//             3 recursion guard tripped

import fs from 'node:fs';
import { confirmedGroupIds } from './io/run-artifacts.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { spawnSyncFrom } from './io/stdin-file.mjs';
import { gitSync } from './io/git.mjs';
import { writeAllSync } from './io/write-all.mjs';
import { fileURLToPath } from 'node:url';
import { resolveFrameworkDirs, skillFile } from './io/locate.mjs';
import { REQUESTS_DIR, resolvedRequestsDir, requestStatus, requestIsApproved, shadowedSkills } from './io/project-paths.mjs';
import { writeTextAtomic } from './io/atomic.mjs';
import { confined } from './io/confined-path.mjs';
import { egressReadFile, egressRunReader, refusedOrAbsent, refusalCause } from './io/egress-read.mjs';
import { bestEffort } from './lib/telemetry-record.mjs';
import { parseContractYaml } from './lib/contract-yaml.mjs';
import { contractGlobErrors, validateGlob, matchesAnyGlob, walkRoot } from './lib/contract-glob.mjs';
import { codeIndexContractErrors } from './lib/code-index-contract.mjs';
import { testOneTemplate } from './lib/test-one.mjs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { runtimeBinArg, runtimeBinArgv } from './io/runtime-bin.mjs';
import { createSnapshot, snapshotIntentDocs } from './io/doc-snapshot.mjs';
import { defaultReviewsRoot, quorateHome, reviewsRootAllowed, admitRun, callerRepoRoot, archivedReviewsDir, ensureReviewsIgnore, reviewsIgnoreWarning } from './io/reviews-root.mjs';
import { contractVersionGap, contractVersionMessage, declaredContractVersion } from './lib/contract-version.mjs';
import { frameworkStamp } from './io/version.mjs';
import {
  budgetOf, isUncappedBudget, subscriptionProbeEnv, denyToolsFor, nodeArgv, withRuntimeOverride, EXECUTABLE_COMMAND_KEYS,
  sandboxCanaryFailures, candidateEnvErrors, briefArg,
} from './lib/decisions.mjs';
import { adapterErrors, selectAdapters, overrideLine, rawTable, entrypoint, declaredEnvErrors, probeDefaultsErrors, probeLimitErrors } from './io/reviewers.mjs';
import { callEntry, runtimeAnswered } from './lib/call-entry.mjs';
import { shellToolsOf, grantRules, contentToolsOf, validateRoster, pathRules, editDenyPaths } from './lib/capabilities.mjs';
import { toolList } from './lib/tool-lists.mjs';
import { hostPlatform } from './platform/index.mjs';
import { renderTemplate, readTemplate } from './io/template.mjs';
import { worktreeSha } from './io/worktree.mjs';
import { uncoveredFiles, contractCoverage, escapesAfterRealpath, escapesBeforeCreate, isWithin, matchesSourceGlobs, isGeneratedPath, isTestPath } from './io/finding-scope.mjs';
import { CONTRACT_CANDIDATES, chooseContractSource, NO_CONTRACT_EXIT } from './lib/contract-source.mjs';
import { probeLimits, rosterCombinations, preflightArgv, combinationLabel, preflightOutcome, maxAgeHoursOf } from './lib/reviewer-probe.mjs';
import { claimCheckTranscriptOf } from './io/claim-check.mjs';
import { spawnCapture } from './io/spawn-capture.mjs';
import { runPool } from './io/pool.mjs';
import { inheritedRequest, inheritedRequestChanged } from './lib/request-inheritance.mjs';
import { minutes, MINUTES } from './lib/check-timeout.mjs';
import { consumerLenses } from './lib/consumer-lenses.mjs';

// Where this engine lives, derived from this file. Kept separate from `repoRoot` — the tree under
// review — because they stop being the same directory the moment the framework is installed rather
// than vendored. See lib/locate.mjs.
const FRAMEWORK = resolveFrameworkDirs(path.dirname(fileURLToPath(import.meta.url)));

// The roster, for the values an ABSENT contract key falls back to. Read once, here, so the model
// names stay in configuration rather than in three scripts (G-50).
const ROSTER_FOR_DEFAULTS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(FRAMEWORK.scriptsDir, 'lens-roster.json'), 'utf8'));
  } catch (e) {
    // NOT {} (G-6 of 20261121-214741-m3s7-b1-remediation-2-review): every roster default vanished and the mint went on.
    throw new Error(`new-run: the lens roster ${path.join(FRAMEWORK.scriptsDir, 'lens-roster.json')} cannot be read: ${e.message}`);
  }
})();

// Fails CLOSED on a value it cannot read — identical to the guards in run-graph.mjs and
// spawn-node.mjs. `isFinite` admitted any non-numeric GRAPH_NODE_DEPTH as "not nested".
const { raw: RAW_DEPTH, depth: PARSED_DEPTH } = nodeDepth(process.env);
// PRESENT-BUT-EMPTY IS UNREADABLE, NOT ZERO (G-6, contract-audit against I-16). `Number('')` and
// `Number(' ')` are both 0, so a value that is present and says nothing passed
// `Number.isInteger(0) && 0 >= 0` and was treated as TOP LEVEL — the guard's own header claims
// it "fails CLOSED on a value it cannot read", and the empty string is named elsewhere in this
// engine as exactly the value the previous guard mishandled. The replacement mishandled it
// identically, in all seven scripts that carry this block, and the one test for the case used
// 'yes' — which coerces to NaN and takes the other branch. Nothing in the engine emits an empty
// value, so this failed open only to a corrupted or externally supplied environment: the case
// the guard exists for.
const DEPTH = PARSED_DEPTH ?? NaN;
if (!Number.isInteger(DEPTH) || DEPTH < 0) {
  console.error(
    `ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} is not a non-negative integer — ` +
      `refusing to guess whether this is a nested run (§8).`,
  );
  process.exit(3);
}
// The DEPTH > 0 refusal lives below argument parsing — see the note there. An unreadable value is
// still rejected here, before anything at all: that one is not a policy question.

function die(msg) {
  console.error(`new-run: ${msg}`);
  process.exit(2);
}

// THE MINT'S OWN START (telemetry-run-time.plan.md stage 2), taken before anything it spends time on — the reviewer probes,
// the canaries — and always the real clock: `--now` sets the run's id and created_at, not how long the mint took.
const MINT_STARTED_AT = new Date().toISOString();

// ---------------------------------------------------------------------------- argv
const args = { fullSweep: [] };
{
  const a = process.argv.slice(2);
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md): a flag's
  // value or a refusal naming the flag (G-8 of 20261020-113229-ciss-remediation-3-review: a trailing `--base` read as
  // undefined and fell back to the default base, and `--base --dry-run` took the next flag as its value), and an unknown
  // flag refused. `--full-sweep` with zero paths is refused (G-4 of 20261020-122714-ciss-remediation-4b-review): an empty
  // list read as "no sweep" and the run silently took a diff-derived scope instead.
  let v;
  try { ({ values: v } = parseArgv(a, ARGV_SPECS['new-run'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  const take = { 'repo-root': 'repoRoot', slug: 'slug', base: 'base', request: 'request', 'validate-settings': 'validateSettings',
    // THE REVIEWER PREFLIGHT AT MINT (reviewer-preflight stage 3): skipped only visibly — REVIEWERS-UNVERIFIED, a
    // capping stamp. The two test seams are forwarded to every check child (external-review's --test-stall-ms and
    // --test-crash), because a real child can neither overrun its bound nor crash on request.
    'test-preflight-stall-ms': 'testPreflightStallMs',
    // The runtime command override spawn-node takes, passed to every canary spawn: a fixture's fake runtime, so a test
    // can observe what gate 4 hands the probes (G-22 of 20261001-155615-cgg-review-r3).
    now: 'now',
    // A REMEDIATION RUN OF A FINISHED REVIEW (remediate-rebuild stage 2; design decisions 1 and 2): minted here rather
    // than written by hand, carrying the reviewed run's frame so the fix-or-ledger rule (shared/remediation.md) can be
    // applied to it.
    remediates: 'remediates',
    // THE OPERATOR'S CHOICE OF GROUPS (remediation-group-scope.md): a remediation fixes these confirmed groups and leaves
    // the others, deferred, alone. Scoping is the operator's decision, so it needs their words.
    groups: 'groups', 'operator-quote': 'operatorQuote',
    // THE FOLLOW-UP REVIEW A REMEDIATION MINTS (stage 4): recorded on it so the round cap can follow the links
    // (shared/remediation.md, Round cap). remediate.mjs passes it; nothing else should.
    'follows-remediation': 'followsRemediation' };
  for (const [flag, key] of Object.entries(take)) if (v[flag] !== undefined) args[key] = v[flag];
  // --runtime-bin, or its alias for one release, through the pair's one owner (io/runtime-bin.mjs).
  try { args.runtimeBin = runtimeBinArg(v); } catch (e) { die(e.message); }
  if (v['full-sweep']) args.fullSweep = v['full-sweep'];
  if (v['dry-run']) args.dryRun = true;
  if (v['print-contract']) args.printContract = true;
  if (v['no-request']) args.noRequest = true;
  if (v['no-verify-reviewers']) args.verifyReviewers = false;
  if (v['test-preflight-crash']) args.testPreflightCrash = true;
  // --verify-sandbox and --no-verify-sandbox set one value, true or false, and the later of the two wins.
  const last = (name) => a.findLastIndex((t) => t === `--${name}`);
  if (v['verify-sandbox'] || v['no-verify-sandbox']) args.verifySandbox = last('verify-sandbox') > last('no-verify-sandbox');
}

// The recursion guard forbids a node from STARTING A RUN. `--print-contract` starts nothing: it
// parses CLAUDE.md, prints JSON, and exits before a run directory exists.
//
// Blocking it blocked find-inert-features.mjs, which reads the contract this way and which
// doc-consistency-review is REQUIRED to run — so the guard reached past what it protects and
// killed the mandatory inert-feature sweep at one remove. The alternative was for that script to
// strip GRAPH_NODE_DEPTH from the child it spawns, which is a node laundering its own containment;
// naming exactly what the guard covers is the honest version.
//
// Keyed on the PARSED flag, so it cannot be widened by a lookalike argument, and placed after
// parsing so an unknown argument is still rejected first.
if (DEPTH > 0 && !args.printContract) {
  console.error(`ABORT: GRAPH_NODE_DEPTH=${DEPTH} — a graph node may not start a graph run (§8).`);
  process.exit(3);
}

// GIT'S TOPLEVEL of where this runs when --repo-root is absent (G-12 of 20261023-014400-rdt-delivery): the literal working
// directory minted from a subdirectory as though it were the repository, and refused that repository's own linked runs.
// Outside any repository the working directory stays, as before.
const repoRoot = callerRepoRoot(args.repoRoot) ?? path.resolve(process.cwd());
// THE REVIEWED RUN, read and refused before anything is written (stage 2). A remediation works from a FINISHED review's
// reconciled.md and its gate; a remediation run is never itself remediated, because its follow-up REVIEW is what the
// next remediation reads (shared/remediation.md, Round cap).
let followsRemediation = null;
// The run this one takes its request from (lib/request-inheritance.mjs): the remediation for --follows-remediation, the
// reviewed run for --remediates. Null for a review minted on its own.
let inheritFrom = null;
// A RUN THIS REPOSITORY MADE (G-16 of 20261022-200543-ciss-d1-review-2; G-9 of
// 20261022-211328-ciss-d1-2-remediation-b-review): --remediates and --follows-remediation each read a frame from the
// directory they name, and a remediation's frame grants that directory to a write-capable node. A directory carrying its
// own run.json is not authority for where it may be, so it is admitted by the one owner (ARCHITECTURE A-28) for this
// repository, before any field of it is read and before anything is written.
const runDirOrDie = (flag, value, need = {}) => {
  const admitted = admitRun({ runDir: path.resolve(value), repoRoot, need });
  if (!admitted.ok) die(`${flag} ${value}: ${admitted.why}`);
  // The directory admitted, its real path, not the one the caller spelled (G-13 of 20261023-014400-rdt-delivery).
  return { dir: admitted.dir, record: admitted.record };
};
if (args.followsRemediation) {
  if (args.remediates) die('--follows-remediation marks a REVIEW of a remediation; it cannot be a remediation run itself');
  const { dir: remDir, record: rem } = runDirOrDie('--follows-remediation', args.followsRemediation, { remediation: true });
  followsRemediation = { run_id: rem.run_id, run_dir: remDir };
  inheritFrom = rem;
}
let remediationFrame = null;
if (args.groups !== undefined && !args.remediates) die('--groups scopes a remediation run; pass it with --remediates');
if (args.groups !== undefined && !String(args.operatorQuote ?? '').trim()) {
  die('--groups needs --operator-quote "<the operator\'s words>": which groups a remediation fixes is the operator\'s decision');
}
if (args.operatorQuote !== undefined && args.groups === undefined) {
  die('--operator-quote here records the operator\'s choice of groups; pass it with --groups');
}
if (args.remediates) {
  // NOT FROM THE TREE BEING FIXED (G-4 of 20261008-214527-remediate-rebuild-review, HIGH). The remediator may edit the
  // source globs; when the framework IS this repository those include capture.mjs, remediate.mjs and everything
  // they import — the code that confines it. No edit rule can carve that out, so the run is minted by a DIFFERENT
  // checkout of the framework (the pinned install: .claude/skills/quorate/scripts/new-run.mjs), whose scripts the
  // remediator cannot reach.
  if (path.resolve(FRAMEWORK.frameworkRoot) === repoRoot) {
    die('--remediates: this framework is the repository being remediated, so a remediator could edit the code that '
      + 'confines it. Mint the remediation run with a different checkout of the framework (the pinned install, '
      + `.claude/skills/quorate/scripts/new-run.mjs --repo-root ${repoRoot} ...).`);
  }
  const { dir: reviewedDir, record: reviewed } = runDirOrDie('--remediates', args.remediates);
  if (reviewed.remediates) {
    die(`--remediates ${args.remediates}: ${reviewed.run_id} is itself a remediation run; remediate the review it minted`);
  }
  // THROUGH THE REVIEWED RUN'S OWNER (run-dir-reads.plan.md stage 4): its reconciled.md, gate.json and reconcile payload
  // decide whether a remediation may be minted from it, and were read raw below the admitted directory. A link at any
  // level is refused, and the mint with it.
  const reviewedOwner = confined(reviewedDir);
  const reviewedHas = (...segs) => {
    try { return reviewedOwner.exists(segs); } catch (e) { die(`--remediates ${args.remediates}: ${segs.join('/')}: ${e.message}`); }
  };
  const reconciledMd = path.join(reviewedDir, 'reconciled.md');
  if (!reviewedHas('reconciled.md')) die(`--remediates ${args.remediates}: no reconciled.md — the review has not finished`);
  if (!reviewedHas('gate.json')) {
    die(`--remediates ${args.remediates}: no gate.json — the review has no gate, so it did not finish`);
  }
  // A DECLARED INPUT (G-8 of 20261009-011732-remediation-paths-r1): the runner reads the confirmed set and severities
  // from the reconciler's payload, and without it can commit nothing — so its absence refuses here, not at the end.
  // Readable, not merely present (G-4 of 20261009-014530-remediation-paths-r2).
  let reconcilePayload = null;
  let payloadRefused = '';
  try { reconcilePayload = JSON.parse(reviewedOwner.read(['evidence', 'reconcile', 'payload.json'])); } catch (e) {
    if (e.code === 'ECONFINED') payloadRefused = ` (${e.message})`;   // a link below the run is said, not read as missing
  }
  if (!Array.isArray(reconcilePayload?.groups)) {
    die(`--remediates ${args.remediates}: no readable evidence/reconcile/payload.json with a groups list${payloadRefused} — the confirmed groups cannot be read, so nothing could be committed`);
  }
  const paths = reviewed.scope?.paths ?? [];
  if (!paths.length) die(`--remediates ${args.remediates}: the reviewed run records no scope paths`);
  if (args.fullSweep.length) die('--remediates takes its scope from the reviewed run; do not pass --full-sweep with it');
  inheritFrom = reviewed;
  remediationFrame = {
    run_id: reviewed.run_id, run_dir: reviewedDir, base: reviewed.base ?? null, base_commit: reviewed.base_commit ?? null,
    head_commit: reviewed.head_commit ?? null, scope: reviewed.scope, request: reviewed.request ?? null,
    reconciled_md: reconciledMd,
  };
  args.fullSweep = [...paths];
  if (args.groups !== undefined) {
    const confirmed = confirmedGroupIds(reconcilePayload);
    const chosen = args.groups.split(',').map((s) => s.trim()).filter(Boolean);
    if (!chosen.length) die('--groups names no group: list the confirmed groups to fix, comma-separated');
    const seen = new Set();
    for (const id of chosen) {
      if (seen.has(id)) die(`--groups names ${id} more than once`);
      seen.add(id);
      if (!confirmed.includes(id)) die(`--groups: ${id} is not a confirmed group of ${reviewed.run_id} (confirmed: ${confirmed.join(', ') || 'none'})`);
    }
    remediationFrame.groups = chosen;
    remediationFrame.deferred = confirmed.filter((id) => !seen.has(id));
    remediationFrame.scope_quote = args.operatorQuote.trim();
  }
}
// REFUSED, NOT REWRITTEN (G-29). This lowercased the slug and replaced every unsupported character
// with a dash, so `--slug "Verify Claims"` and `--slug verify-claims` silently produced the same run
// id — and the operator who asked for the first one is later looking for a directory named after the
// second. I-1 fixes the identifier's shape ([a-z0-9-]+); a shape a tool quietly edits its input to
// satisfy is a convention, not a rule, and run ids are how every artifact in this system is found.
const rawSlug = String(args.slug ?? 'review');
if (!/^[a-z0-9-]+$/.test(rawSlug)) {
  const suggestion = rawSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  die(`--slug ${JSON.stringify(rawSlug)} must match [a-z0-9-]+ (I-1)` +
    (suggestion ? `; did you mean --slug ${suggestion}?` : ''));
}
// Every hyphen at each end (G-7 of 20261121-193516-m3s7-b1-review): one at each end left `--a--` as `-a-`.
const slug = rawSlug.replace(/^-+|-+$/g, '');
if (!slug) die('--slug reduced to an empty string');

// capture.mjs as a node will invoke it: relative to the repo it runs in, forward slashes, because a
// permission rule is matched against the command STRING and `Bash(node scripts/capture.mjs:*)` does
// not match a backslash spelling of the same path.
//
// Derived rather than written as a literal. The literal `.claude/skills/scripts/capture.mjs` is
// correct only while the engine is vendored in-tree; as a plugin it lives at
// `.claude/skills/quorate/scripts/capture.mjs`, and an allow-list naming the wrong file denies
// every node's evidence capture. The live canary catches that — it is what caught it here — but
// the canary reports it as "node-settings.json was probably not loaded", which sends you looking
// at the wrong thing entirely.
const CAPTURE_REL = path
  .relative(repoRoot, path.join(FRAMEWORK.scriptsDir, 'capture.mjs'))
  .split(path.sep)
  .join('/');

// ------------------------------------------------------------------ settings validation gates
// Four gates guard node-settings.json. The CLI SILENTLY IGNORES a settings file that fails
// validation in -p mode, so a structurally wrong file would hand every node a policy nobody
// chose. Gates 1-3 catch that statically; gate 4 (the live canary, further down) is the only
// thing that proves the CLI actually ACCEPTED the file.
//
// These live above every git and contract operation so that --validate-settings works on a
// hand-edited file in any repo state — a policy file is exactly what someone edits by hand.
const TOP_KEYS = new Set(['permissions', 'env', 'model', 'includeCoAuthoredBy', 'cleanupPeriodDays']);
const PERM_KEYS = new Set(['allow', 'deny', 'ask', 'defaultMode', 'additionalDirectories']);
const RULE_RE = /^[A-Z][A-Za-z]*(\(.+\))?$/;

function validateNodeSettings(text) {
  let parsed;
  try {
    parsed = JSON.parse(text); // gate 1
  } catch (e) {
    die(`node-settings.json is not valid JSON: ${e.message}`);
  }
  // An object, or no gate below sees anything (G-10 of 20261022-034225-cid1a-remediation-2-review): `[]` has no keys
  // and passed all three.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    die(`node-settings.json must be a JSON object, got ${Array.isArray(parsed) ? 'an array' : JSON.stringify(parsed)}`);
  }
  for (const k of Object.keys(parsed)) {
    // gate 2 — an unknown key is precisely what makes CLI validation fail, and silently.
    if (!TOP_KEYS.has(k)) die(`unknown settings key '${k}' — the CLI would silently ignore this whole file`);
  }
  // Shapes before contents (G-7 of 20261122-154951-m3s7-b3-remediation-4-review): a number bucket threw a TypeError and a
  // string one was walked a character at a time.
  const perms = parsed.permissions;
  if (perms !== undefined && (!perms || typeof perms !== 'object' || Array.isArray(perms))) {
    die(`node-settings.json: permissions must be a JSON object, got ${JSON.stringify(perms)}`);
  }
  for (const k of Object.keys(perms ?? {})) {
    if (!PERM_KEYS.has(k)) die(`unknown permissions key '${k}' — the CLI would silently ignore this whole file`);
  }
  for (const bucket of ['allow', 'deny', 'ask']) {
    if (perms?.[bucket] !== undefined && !Array.isArray(perms[bucket])) {
      die(`node-settings.json: permissions.${bucket} must be an array of rules, got ${JSON.stringify(perms[bucket])}`);
    }
    for (const rule of perms?.[bucket] ?? []) {
      // gate 3 — catches bash(...), smart quotes, stray spaces, CRLF mangling.
      if (typeof rule !== 'string' || !RULE_RE.test(rule)) {
        die(`malformed permission rule in ${bucket}: ${JSON.stringify(rule)}`);
      }
    }
  }
  return parsed;
}

if (args.validateSettings) {
  const p = path.resolve(args.validateSettings);
  if (!fs.existsSync(p)) die(`no such file: ${p}`);
  validateNodeSettings(fs.readFileSync(p, 'utf8'));
  console.log(`${path.relative(repoRoot, p)}: gates 1-3 pass`);
  process.exit(0);
}


// ---------------------------------------------------------------------------- read contract
// The contract may live in `.claude/rules/quorate-contract.md` (preferred: a file quorate can own,
// diff against the template, and update) or in the project's own CLAUDE.md (the original location,
// still supported). Which one was used is recorded in run.json — a run that cannot say where its
// own criteria came from is not reproducible.
const contractEntries = CONTRACT_CANDIDATES.map((rel) => {
  const abs = path.join(repoRoot, rel);
  // Through the egress owner (G-12 of 20261112-063354-hl-remediation-4-review): the chosen contract is written as
  // contract.snapshot.md and copied into the intent sandbox.
  return { path: rel, abs, text: fs.existsSync(abs) ? egressReadFile(abs, 'utf8', { repoRoot }) : null };
});
const chosen = chooseContractSource(contractEntries);
// NO CONTRACT, SAID BY THE EXIT CODE (ledger-findings.plan.md stage 4): a reader tells it from an unreadable contract
// without matching this message, through lib/contract-source.mjs's classifier.
if (!chosen.ok && chosen.absent && args.printContract) {
  console.error(`new-run: ${chosen.why}`);
  process.exit(NO_CONTRACT_EXIT);
}
if (!chosen.ok) {
  die(
    `${chosen.why}\n` +
      `  The graph_contract block is a prerequisite, not an afterthought (§7).\n` +
      `  Run /full-review to have it print a pre-filled block for this repo.`,
  );
}
const contractPath = chosen.path;
const claudeMdPath = contractEntries.find((e) => e.path === chosen.path).abs;
const claudeMd = chosen.text;
if (chosen.duplicates.length) {
  console.error(
    `new-run: contract read from ${contractPath}; an identical copy also sits in ` +
      `${chosen.duplicates.join(', ')} — delete the stale one before they drift apart.`,
  );
}

let contract;
try {
  contract = parseContractYaml(chosen.yaml);
} catch (e) {
  die(`could not parse the graph_contract block: ${e.message}`);
}
// THE VERSION IS A SIGNAL, NOT AN EQUALITY. This was `!== 1 -> die`, which cannot say "you are
// behind and here is what moved" — the only message that helps a consumer whose keys are spelled
// correctly and now mean something else. `invalid` and `ahead` stay fatal: a contract written for a
// newer engine may rely on meanings this one does not have, and guessing is how `budget_usd_per_node:
// ""` went from a $0 cap to uncapped with nothing to notice it.
const declaredVersion = declaredContractVersion(contract);
const versionGap = contractVersionGap(declaredVersion.value, undefined, declaredVersion.key);
// NAMED, NOT SILENT, and not fatal: the old spelling still works and will keep working. A
// deprecation nobody is told about is a rename nobody performs.
if (declaredVersion.deprecated) {
  console.error(`new-run: ${declaredVersion.key} is the old spelling of graph_contract_version; `
    + 'both are accepted, so rename it when convenient rather than urgently');
}
if (versionGap.state === 'invalid' || versionGap.state === 'ahead') {
  die(contractVersionMessage(versionGap));
}
// `behind` is stamped rather than refused: breaking every consumer on a bump punishes them for the
// upgrade they were told to perform, and silence is the defect being fixed. The stamp is PUSHED
// where the others are built, ~130 lines below — the first draft of this called `stamps.add()` here,
// against an array that does not exist yet and is not a Set. That is the `tbStartedAt` and `judgeId`
// defect this repository has already paid for twice: a value read above its own declaration, which
// throws only on the path that reaches it.
if (versionGap.state === 'behind') console.error(`new-run: ${contractVersionMessage(versionGap)}`);

// Emits the resolved contract as JSON and mints nothing. The git hooks consume this so there is
// exactly one YAML parser and one definition of "the declared commands" in the repository — a
// hook that reimplemented either would drift from the graph the first time the contract changed.
// Deliberately BEFORE scope resolution: a hook needs the commands even when the diff contains no
// source files, which is the normal case for a docs-only commit.
if (args.printContract) {
  // Every byte before the exit (G-11 of 20261112-054852-hl-remediation-3-review): a queued write could be cut short.
  writeAllSync(1, JSON.stringify(contract, null, 2) + '\n', { retry: ['EAGAIN'] });
  process.exit(0);
}

// A CONTRACT GLOB IS IN THE GRAMMAR, OR THE RUN IS REFUSED (contract-glob-grammar.plan.md, stage 2). This refused only
// globs outside the repository (G-22 of 20260929-225147-m0-gate-review); every other form outside the grammar was read
// differently by different interpreters. One validator, every key, every entry named with its reason.
//
// AFTER --print-contract, deliberately (the plan's disposition of r4's G-2): the hooks read the commands through it, and a
// glob refusal there would block a push over a key the push does not use. Every path that MINTS refuses here, and
// preflight refuses through the same validator before it seeds anything.
{
  const errors = contractGlobErrors(contract);
  if (errors.length) {
    die(`the contract declares globs outside the contract's glob grammar:\n  - ${errors.join('\n  - ')}\n`
      + '  The grammar is `*`, `**` and literal characters, relative to the repository (shared/claude-md-contract.md).');
  }
}
// EVERY MINUTES VALUE THROUGH ITS OWNER, AT MINT (code-index-d1-part-a.plan.md stage 2; design note A-D3: "refused at
// mint"). A value read only when a run reached it surfaced hours in, or never: an arm's non-numeric limit set no timer at
// all, and above 35,791 minutes a timer fires after about 1 ms. The roster ships with the engine, but a working tree or a
// dirty engine can carry an edited one. reviewers.json's probe limits are checked with the other reviewer settings below.
{
  const errs = [];
  const check = (key, value) => { try { minutes(key, value, 1); } catch (e) { errs.push(e.message); } };
  for (const key of Object.keys(MINUTES).filter((k) => k.startsWith('review.'))) check(key, contract.review?.[key.slice('review.'.length)]);
  for (const l of ROSTER_FOR_DEFAULTS.lenses ?? []) check('roster.lens.timeout_minutes', l?.timeout_minutes);
  for (const a of ROSTER_FOR_DEFAULTS.panel_arms ?? []) check('roster.arm.timeout_minutes', a?.timeout_minutes);
  for (const n of ROSTER_FOR_DEFAULTS.barrier_nodes ?? []) {
    check(n?.id === 'remediation' ? 'roster.remediation.timeout_minutes' : 'roster.lens.timeout_minutes', n?.timeout_minutes);
  }
  // A consumer lens through the loader run-graph uses, so the two cannot disagree; only its limit is refused here.
  errs.push(...consumerLenses({ declared: contract.lenses ?? {} }).errors.filter((e) => /\.timeout_minutes: /.test(e)));
  if (errs.length) die(`a limit in minutes cannot be used:\n  - ${errs.join('\n  - ')}`);
}
// A TEST_ONE TEMPLATE IN ITS GRAMMAR, OR THE RUN IS REFUSED (remediation-verification.plan.md, stage 1): one whole `{file}`
// token, and no declared commands.shell, whose string the placeholder would be interpolated into. Refused here, at mint,
// rather than at the remediation node's first capture.
{
  const t = testOneTemplate(contract);
  if (!t.ok) die(`${t.why} (shared/claude-md-contract.md, commands.test_one)`);
}
// REVIEW.CANDIDATE_ENV IN ITS GRAMMAR, OR THE RUN IS REFUSED (candidate-check-boundaries.plan.md stage 2): names or NAME_*
// prefixes, none admitting a name the runner always removes. Refused at mint, not at the remediation's first check.
{
  const errs = candidateEnvErrors(contract.review?.candidate_env);
  if (errs.length) die(`${errs.join('; ')} (shared/claude-md-contract.md, review.candidate_env)`);
}
// THE code_index BLOCK IN ITS GRAMMAR, OR THE RUN IS REFUSED (code-index.plan.md stage 3), as at the other entry point.
{
  const errs = codeIndexContractErrors(contract);
  if (errs.length) die(`${errs.join("; ")} (shared/claude-md-contract.md, code_index)`);
}
// A doc glob with no directory before its first wildcard (`**/*.md`) still counts for scope and the doc lenses, but is
// not given to the intent node — its base would be the whole repository. Named here, at mint, before the run spends
// anything (G-21 of 20260930-212919-m0-gate-review-r3); run-graph records it in the run's not-checked list.
for (const g of contract.doc_paths ?? []) {
  if (!walkRoot(g).base) {
    console.error(`new-run: doc_paths entry ${g} has no directory before its first wildcard, so it is not granted to the `
      + 'intent node (its base would be the whole repository); name a directory, e.g. docs/**/*.md');
  }
}
// --full-sweep paths are operator-typed, not contract globs, but they name repository paths the same way and are walked
// and hashed: the same grammar, the same refusal — with one addition a contract glob does not get: `.` (or `./`), the
// repository root, is the whole-repository sweep an operator asserts on purpose. As a doc_paths entry it would hand the
// intent node the whole tree, which is why the grammar itself does not accept it.
{
  const isRoot = (p) => /^\.[\\/]*$/.test(String(p).trim());
  const errors = args.fullSweep.filter((p) => !isRoot(p)).map((p) => [p, validateGlob(p)]).filter(([, why]) => why);
  if (errors.length) die(`--full-sweep paths outside the grammar:\n${errors.map(([p, why]) => `  - --full-sweep ${p} — ${why}`).join('\n')}`);
}

const commands = contract.commands ?? {};
const review = contract.review ?? {};

// THE RUNTIME THIS RUN'S NODES WILL SPAWN ON. new-run writes the policy file those nodes run
// under, so it needs the runtime's grant vocabulary — which tools can execute a command, which read
// file content, and how an allow rule is spelled. Merged with anything the contract declares, like
// every other adapter lookup.
// Chosen by the one owner (contract-runtime-and-session-files.plan.md stage 1): review.runtime, else the table's default.
const ADAPTERS = selectAdapters({ contract });
const RUNTIME_TABLE = ADAPTERS.table;
let runtimeName;
try { runtimeName = ADAPTERS.runtime; } catch (e) { die(e.message); }
const NODE_RUNTIME = RUNTIME_TABLE[runtimeName];
// Every spawn of the node runtime goes through this, so --runtime-bin cannot be missed by one of them.
const launch = (spec) => withRuntimeOverride(spec, args.runtimeBin, process.execPath);
// EVERY BUILT-IN THIS CONTRACT OVERRIDES, NAMED BEFORE ANYTHING IS SPAWNED (reviewer-credential-routing, A-26). Not tied to
// the reviewer check: new-run runs the node runtime itself (version probe, canary, intent probes), with the panel off too,
// and a mint refused by the canary leaves no run.json and no gate to name it. stderr, so stdout stays the run id.
const MINT_OVERRIDES = ADAPTERS.overrides;
for (const o of MINT_OVERRIDES) console.error(`new-run: ${overrideLine(o)}`);
const overrideNote = (name) => { const o = MINT_OVERRIDES.find((x) => x.name === name); return o ? ` [override: ${overrideLine(o)}]` : ''; };


// DECLARED ADAPTERS, VALIDATED AT MINT. lib/reviewers.mjs says adapterErrors is "checked at MINT,
// before anything spawns, so a contract that adds a vendor fails with a named reason rather than at
// the moment an arm would have transmitted something" — and it was checked only inside
// external-review, at the moment an arm was about to transmit. The promise and the code disagreed
// about which side of the boundary the check sat on, which is the whole difference between a
// pre-flight failure and a half-run one.
//
// Fatal, not a stamp: an unusable adapter is a configuration error the operator can fix in one
// line, and continuing would spawn a run whose panel silently degrades to fewer arms than declared.
{
  const declared = contract.reviewers ?? {};
  // Plus the credential rule (G-12): a contract names exact variables, never prefixes.
  // AS MERGED, which is what external-review validates and runs: a declaration overriding one field of a built-in
  // (its probe limits, say) was refused here for lacking the fields the merge supplies.
  // EVERY ADAPTER, built-ins included (G-9 of 20261022-025041-cid1a-remediation-review): a built-in's malformed probe limit
  // in an edited reviewers.json was refused only at the reviewer's call.
  const errs = [...Object.entries(RUNTIME_TABLE).flatMap(([name, a]) => adapterErrors(name, a)), ...declaredEnvErrors(declared)];
  // THE PROBE AGE LIMIT, refused here rather than at a reviewer's call (G-8 of 20261009-232840-reviewer-preflight-r1):
  // a malformed value used to surface only as a probe that could not run.
  try { maxAgeHoursOf(review.reviewer_probe_max_age_hours); } catch (e) { errs.push(e.message); }
  // Which claim checker may read the session's transcript (claim-check-cross-family.plan.md stage 0): refused here, at
  // mint, rather than first at a claim check.
  try { claimCheckTranscriptOf(review); } catch (e) { errs.push(e.message); }
  // And the fallback limits every adapter inherits (G-10 of 20261010-063310-reviewer-preflight-r6).
  const probeDefaults = rawTable().probe_defaults;
  const defaultsErrs = probeDefaultsErrors(rawTable().probe_defaults);
  errs.push(...defaultsErrs);
  // THE PROBE LIMITS' SUM, refused here rather than at a reviewer's preflight (probe-limit-sum.design.md): each limit is
  // bounded alone by its owner, and probeLimits, the one owner of their sum, checks that every adapter's set fits one
  // timer together, built-ins and declared alike. Skipped only for a set whose own values were refused above: an
  // unrelated error hid every sum's refusal until a second mint (G-1 of 20261022-141455-pls-delivery), and so did any
  // other error of the same adapter (G-1 of 20261022-151016-pls-remediation-b-review).
  if (!defaultsErrs.length) {
    for (const [name, a] of [['probe_defaults', {}], ...Object.entries(RUNTIME_TABLE)]) {
      if (name !== 'probe_defaults' && probeLimitErrors(name, a).length) continue;
      try { probeLimits(a, probeDefaults); } catch (e) { errs.push(`${name}: ${e.message}`); }
    }
  }
  if (errs.length) {
    die(`the contract declares reviewer adapters or settings that cannot be used:\n  - ${errs.join('\n  - ')}`);
  }
}
// WHERE THIS RUN'S ARTIFACTS LAND. Default is OUT OF THE TREE (lib/reviews-root.mjs explains why):
// writing inside the repository under review forced four separate places to remember to exclude the
// run directory, and two defects came from that class rather than from any one of the exclusions.
// An explicit `review.reviews_dir` still wins, and may still point inside the repository — a project
// that wants its evidence trail committed keeps it deliberately.
const declaredReviews = String(review.reviews_dir ?? '').trim();
const reviewsDir = declaredReviews
  ? path.resolve(repoRoot, declaredReviews)
  : defaultReviewsRoot({ project: contract.project, repoRoot });
const reviewsHome = quorateHome();
// THE BOUND MOVED, IT DID NOT VANISH. This key is read from the CLAUDE.md of whatever tree the engine
// is pointed at, so it was confined to the repository root and three defects had already exploited
// the gap (G-16 absolute/`..`, G-34 symlink, G-32 junction before creation). Unbounded it could name
// any directory on this machine, which is the path traversal the threat model puts in scope. Two
// containers are allowed and nothing else.
const reviewsAllowed = reviewsRootAllowed({
  repoRoot, home: reviewsHome, candidate: reviewsDir, isWithin,   // the one owner of containment (G-24)
});
if (!reviewsAllowed.ok) die(reviewsAllowed.why);
// ...and the symlink check runs against WHICHEVER container accepted it, whether or not the
// directory exists yet: a nonexistent directory beneath a junction pointing out of its container
// passed validation once, and mkdirSync then wrote every artifact somewhere nobody expected (G-32).
// THE CONTAINER MUST EXIST BEFORE IT CAN BE ESCAPED FROM. escapesBeforeCreate walks up to the
// nearest EXISTING ancestor and asks whether that resolves inside the root — so a root which does not
// exist yet puts the nearest ancestor ABOVE it and every path "escapes". Always true for repoRoot;
// false for quorate's home on first use, where it refused every run with a link that was not there.
// Caught by two existing tests that mint runs into temporary projects, which is the suite doing its
// job on a change that had just passed its own new tests.
if (reviewsAllowed.where === 'quorate home') fs.mkdirSync(reviewsAllowed.container, { recursive: true });
if (escapesBeforeCreate(reviewsAllowed.container, reviewsDir)) {
  die(`review.reviews_dir (${reviewsDir}) resolves outside the ${reviewsAllowed.where} it was `
    + `accepted against (${reviewsAllowed.container}) — a link in its path escapes that boundary`);
}

// ---------------------------------------------------------------------------- scope
function git(cmdArgs) {
  const r = gitSync(cmdArgs, { cwd: repoRoot, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/**
 * Ask the node runtime for its version, without handing it the operator's secrets (G-23).
 *
 * Scrubbed through the canary's own environment surgery — the one owner of "what an agentic child of
 * this script may inherit" — because this is the first time the run executes the contract-selected
 * binary, and a version string is not worth a credential. Bounded, because a probe that never
 * returns would block a mint that is otherwise valid.
 */
function runtimeProbe() {
  const { env } = canaryEnv();
  const v = launch({ cmd: NODE_RUNTIME.cmd, argv: entrypoint(NODE_RUNTIME, 'version_argv') });
  const r = spawnSync(v.cmd, v.argv, {
    cwd: repoRoot, encoding: 'utf8', env, timeout: 30_000,
  });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

// SCOPE DERIVATION READS GLOBS THROUGH THE ONE OWNER (contract-glob-grammar stage 3). A private globToRe compiled the
// grammar a second way here — `[` and `{` escaped as literals where globMatches passed a class through (r4 G-3) — so
// one contract glob had a different reach in scope than in the snapshot. Deleted, not wrapped.
// From the one owner of a path's kind (lib/finding-scope.mjs), with this scope's own meaning: source_globs minus
// generated_globs, a file that also matches test_globs still in scope (remediation-paths stage 1).
const isSource = (p) => matchesSourceGlobs(p, contract) && !isGeneratedPath(p, contract);

const base = args.base ?? 'HEAD~1';
// By exit status, not output (G-16 of 20261020-105833-ciss-remediation-2-review): a revision git cannot resolve is echoed
// back on stdout with exit 128, so `HEAD~1` in a one-commit repository read as a base.
const revParse = (rev) => { const r = git(['rev-parse', rev]); return r.code === 0 ? r.out || null : null; };
const headSha = revParse('HEAD');
const baseSha = revParse(base);
// UNKNOWN IS NOT CLEAN (G-23). This read `git status --porcelain` and treated ANY failure — not a
// repository, git missing, a broken index — as `dirty: false`, so run.json could assert a clean tree
// when cleanliness was never established, and every reproducibility claim downstream rests on that
// field. A failed check is a third state; recorded as `null`, which reads as "not established"
// rather than as either answer.
const dirtyProbe = git(['status', '--porcelain']);
const dirty = dirtyProbe.code === 0 ? dirtyProbe.out.length > 0 : null;
if (dirty === null) {
  console.error(`new-run: could not establish whether the tree is clean (git status exit ${dirtyProbe.code}` +
    `${dirtyProbe.err ? `: ${dirtyProbe.err.slice(0, 120)}` : ''}); recording dirty: null`);
}
// WHICH DIRTY PATHS ARE NOT GENERATED (operator, 2026-11-23: "Fix the rule, post this run (Recommended)"): a tree whose only
// changes are run records under generated_globs (.claude/reviews/**) was dirty, so pr-comments refused every review of this
// repository, whose finished runs sit untracked there. The paths outside generated_globs are recorded, an untracked
// directory git collapses counting as its own path, so one that only contains generated files still counts unless its
// path itself matches. null when the listing could not be read: not established, as dirty is.
const dirtyOutsideGenerated = (() => {
  if (dirty !== true) return dirty === false ? [] : null;
  // Untrimmed: the first entry's status may begin with a space (` M path`), which git()'s trim would eat.
  const z = gitSync(['status', '--porcelain=v1', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  if (z.status !== 0) return null;
  const parts = (z.stdout ?? '').split('\0').filter(Boolean);
  const paths = [];
  let sourceNext = false;   // a rename or copy entry is followed by its source path, as an entry of its own
  for (const part of parts) {
    if (sourceNext) { paths.push(part); sourceNext = false; continue; }
    const xy = part.slice(0, 2);
    paths.push(part.slice(3));
    sourceNext = xy.includes('R') || xy.includes('C');
  }
  const gen = contract.generated_globs ?? [];
  return paths.map((p) => p.replace(/\/+$/, '')).filter((p) => p && !matchesAnyGlob(gen, p));
})();

// UNTRACKED FILES ARE CHANGES TOO (G-27 of 20261020-094311-ciss-delivery): `git diff --name-only` never lists one, so a
// new source file nobody had staged was left out of the derived scope, or the run refused as having no source changes.
// Not-ignored only, the set the arms' snapshot takes.
// A LISTING IS READ WHOLE OR NOT AT ALL (G-16, G-17 of 20261020-105833-ciss-remediation-2-review): `git()` (then `sh()`) ignored the
// exit status, the spawn error and spawnSync's default output cap, so a failed or truncated listing became a silently
// partial scope; and without -z git C-quotes a non-ASCII path, which then matched no source glob.
function gitPaths(cmdArgs) {
  const r = gitSync(cmdArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : `exit ${r.status}${r.stderr ? `: ${r.stderr.trim().slice(0, 200)}` : ''}`;
    die(`could not list the changed files (git ${cmdArgs.join(' ')}: ${why}) — a partial listing would silently narrow the derived scope`);
  }
  return r.stdout.split('\0').filter(Boolean);
}
const diffed = baseSha
  ? [...new Set([...gitPaths(['diff', '--name-only', '-z', base]), ...gitPaths(['ls-files', '--others', '--exclude-standard', '-z'])])]
  : [];
const changedSource = diffed.filter(isSource);
// A follow-up's scope when its remediation changed only tests (G-13 of 20261121-204740-m3s7-b1-remediation-review).
const changedTests = diffed.filter((p) => isTestPath(p, contract) && !isGeneratedPath(p, contract));

const stamps = [];
// The contract declares semantics older than this engine implements, and its keys are spelled
// correctly — so nothing else in the run can detect it. Decided at parse time, recorded here.
if (versionGap.state === 'behind') stamps.push('CONTRACT-STALE');
let scope;
if (remediationFrame) {
  // Scoped to what was reviewed; not a human-asserted sweep, so not stamped UNSWEPT-DIFF.
  scope = { full_sweep: false, remediation: true, paths: args.fullSweep, changed_files: changedSource };
} else if (args.fullSweep.length) {
  scope = { full_sweep: true, paths: args.fullSweep, changed_files: changedSource };
  stamps.push('UNSWEPT-DIFF');
} else if (changedSource.length) {
  scope = { full_sweep: false, paths: changedSource, changed_files: changedSource };
} else if (followsRemediation && changedTests.length) {
  // THE REVIEW OF A TEST-ONLY REMEDIATION (G-13 of 20261121-204740-m3s7-b1-remediation-review; I-11): a fix to a test
  // commits only test files, and its follow-up review died here. It is scoped to the test files the remediation changed.
  scope = { full_sweep: false, paths: changedTests, changed_files: changedTests };
} else {
  die(
    `no source files in the diff vs ${base} or the untracked files (${diffed.length} file(s) changed, none matching source_globs).\n` +
      `  Refusing to infer a whole-repo scope. Re-run with --full-sweep <paths...> to assert it explicitly.`,
  );
}

// ---------------------------------------------------------------------------- the request
// contract-audit asks "did the code do what was asked". Without a statement of what was asked it
// reaches for the nearest substitute — the product specification — and reports the entire unbuilt
// product as conformance violations. That has happened here: a reconciliation dropped two of
// eleven groups and spent a paragraph explaining why "no vector-record type exists" is true but
// not a defect, at reconciler prices.
//
// So this refuses rather than degrades. A missing request is cheap to fix at this line and
// expensive at every line after it: seven lenses spawn, each judging against criteria nobody
// asked for, and the barrier pays to sort out the mess. Stopping the failure here is the whole
// point — it is the same reasoning as refusing to infer a whole-repo scope a few lines above.
function resolveRequest() {
  const declared = (contract.doc_roles?.request ?? '').trim();
  const explicit = (args.request ?? '').trim();
  let candidate = explicit || declared;

  // Fall back to DISCOVERY when nothing is declared. Without this the documented exit from a
  // recovered run did not exist: run-graph writes "a human who reads this and sets
  // `status: approved` lifts the cap on the next run" into every inferred document, but resolution
  // only ever looked at doc_roles.request and --request — so approving the file changed nothing,
  // the next run re-drafted it, and the banner the orchestrator itself wrote was false.
  //
  // Only APPROVED documents are discovered. A draft or an un-promoted `inferred` is still invisible
  // here, so this widens what can be found without weakening what counts.
  let discovered = null;
  if (!candidate) {
    // Resolved through links and proved inside the repository, for the same reason run-graph does:
    // discovery picks what the run is judged against, and a redirected directory picks it from
    // outside the tree.
    const dir = resolvedRequestsDir(repoRoot);
    if (!dir) return { ok: false, why: `${REQUESTS_DIR} does not resolve inside this repository` };
    if (fs.existsSync(dir)) {
      const approved = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => path.join(dir, f))
        // PROVED INSIDE THE REPOSITORY BEFORE IT IS OPENED (G-6 of 20261020-122714-ciss-remediation-4b-review): only the
        // selected entry met the containment check below, so a link here was read first — an outside approved file
        // counted as a candidate, a link to a directory crashed the mint. A file that leaves the tree is not a candidate.
        .filter((abs) => !escapesAfterRealpath(repoRoot, abs) && fs.statSync(abs).isFile())
        // ASKED OF THE OWNER, so discovery and acceptance cannot disagree about what approved
        // means (G-20). This matched ANY line, and the acceptance check below reads the FIRST.
        .filter((abs) => requestIsApproved(fs.readFileSync(abs, 'utf8')));
      // Ambiguity is refused rather than guessed. Picking the newest of several approved requests
      // would silently choose which ask the run judges conformance against — a decision that
      // belongs to whoever starts the run, and one whose consequences are invisible in the result.
      if (approved.length === 1) {
        discovered = approved[0];
        candidate = path.relative(repoRoot, discovered).replace(/\\/g, '/');
      } else if (approved.length > 1) {
        return {
          ok: false,
          why: `${approved.length} approved requests in ${REQUESTS_DIR}/ and doc_roles.request is empty — ` +
            `name one with --request (${approved.map((a) => path.basename(a)).join(', ')})`,
        };
      }
    }
  }

  // THE CONSTANT, NOT THE STRING (G-21). locate.mjs promised relocating the store was 'one line
  // rather than a search for a string', and these two refusals were the string — so after a move
  // the operator would be told to look in a directory discovery no longer searches.
  if (!candidate) return { ok: false, why: `no request supplied, doc_roles.request is not declared, and no approved request was found in ${REQUESTS_DIR}/` };

  const abs = path.resolve(repoRoot, candidate);
  // CONTAINED, LEXICALLY AND THROUGH LINKS (G-33, panel-codex-security). `--request` is a
  // caller-supplied path and this resolved and read it with no containment at all, so an absolute
  // path or one carrying `..` selected any file on the machine that happens to contain
  // `status: approved` — and run-graph then COPIES the request into the intent sandbox, where a
  // model reads it in full. That is the same two-step check every other path in this script gets,
  // in the one place whose output is handed to a model verbatim.
  if (!isWithin(repoRoot, abs)) {
    return { ok: false, why: `request at ${candidate} resolves outside the repository under review` };
  }
  if (!fs.existsSync(abs)) return { ok: false, why: `request not found at ${candidate}` };
  if (escapesAfterRealpath(repoRoot, abs)) {
    return { ok: false, why: `request at ${candidate} leaves the repository through a link` };
  }

  const text = fs.readFileSync(abs, 'utf8');
  const status = requestStatus(text);
  if (status !== 'approved') {
    // A draft is a guess wearing a document's clothes. Accepting one would give a machine-written
    // inference exactly the authority of a stated requirement, which is what this whole mechanism
    // exists to prevent.
    return { ok: false, why: `request at ${candidate} has status: ${status ?? '(none)'} — needs 'approved'`, draft: true };
  }
  // `discovered` travels with the result so the run can SAY where its request came from. A declared
  // path and a searched-for one are different facts about how this run chose what to judge against.
  return { ok: true, path: path.relative(repoRoot, abs).replace(/\\/g, '/'), text, discovered: Boolean(discovered) };
}

// INHERITED, NOT RE-RESOLVED (remediation-consumer-findings.plan.md stage 1): a run minted from another run is judged against
// that run's request, proved still present; a --request or --no-request that asks for something else is refused.
function inheritRequest() {
  const inh = inheritedRequest(inheritFrom, { explicit: args.request ?? null, noRequest: Boolean(args.noRequest) });
  if (inh.refusal) die(inh.refusal);
  if (inh.kind === 'none') return { ok: false, why: inh.reason, suppressed: true, inherited: true };
  const abs = path.resolve(repoRoot, inh.path);
  if (!isWithin(repoRoot, abs) || escapesAfterRealpath(repoRoot, abs)) die(`the inherited request ${inh.path} resolves outside the repository`);
  if (!fs.existsSync(abs)) die(`the request ${inh.path}, which ${inheritFrom.run_id} was judged against, no longer exists; restore it, or review again`);
  const text = fs.readFileSync(abs, 'utf8');
  // The bytes the source run was judged against, not only its path (G-8 of 20261021-014056-rcf-delivery).
  const changed = inheritedRequestChanged(inheritFrom, crypto.createHash('sha256').update(text).digest('hex'));
  if (changed) die(changed);
  return { ok: true, path: inh.path, text, inherited: true, inferred: inh.inferred };
}
const request = inheritFrom ? inheritRequest()
  : args.noRequest ? { ok: false, why: 'suppressed with --no-request', suppressed: true } : resolveRequest();

// A missing request is a SIGNAL, not a dead end. Something upstream should have produced one —
// a planning step, a ticket, a human stating what they wanted — and the fact that none exists is
// itself the finding. Dying here would make the operator the recovery mechanism, which is both
// slow and wrong: the gap is fillable, and run-graph fills it by spawning request-capture and
// then retrying the stage that needed it.
//
// What must NOT happen is an inferred request quietly acquiring the authority of a stated one.
// So the run is stamped, and the stamp travels to the gate. Recording the gap is this script's
// whole job; recovering from it is run-graph's.
if (args.noRequest || (request.inherited && !request.ok)) {
  // Inherited none is no request, as --no-request is: recovery would otherwise infer one the reviewed run never had.
  stamps.push('UNREQUESTED');
} else if (request.inherited && request.inferred) {
  stamps.push('REQUEST-INFERRED');
} else if (request.ok && request.discovered) {
  // WHICH ASK THIS RUN IS JUDGED AGAINST, said out loud. Nothing was declared and nothing was named
  // on the command line, so the request came from a search of .claude/requests/ — a real approved
  // document, but not one anybody chose for THIS run. The contract's own comment for an empty key
  // names the harm exactly ("the lens would judge new code against criteria nobody wrote for it"),
  // and it happened: run 20260907-192446 adopted an approved request about cross-family review while
  // auditing a day's work on the ledger, with nothing in the artifacts marking the choice (G-4).
  //
  // No ceiling — the document IS approved, and a discovered request beats none. The stamp makes the
  // selection visible, which is the whole complaint.
  stamps.push('REQUEST-DISCOVERED');
  console.error(`new-run: doc_roles.request is empty; using the sole approved request found at ${request.path}`);
} else if (!request.ok) {
  stamps.push('REQUEST-MISSING');
  console.error(`new-run: no approved request (${request.why}) — run-graph will attempt recovery.`);
}
if (!commands.build) stamps.push('UNBUILT');
if (!commands.test) stamps.push('UNTESTED');
if (!commands.bench) stamps.push('UNBENCHED');

// CONTRACT COVERAGE. A tracked file matching no declared glob is invisible to scope derivation and
// undemotable-from, so an incomplete contract silently weakens the gate — in the unsafe direction,
// with no signal. Nothing checked for it: check-install compares contract KEYS against the template
// and never asks whether the globs cover the tree.
//
// NAMED, NOT BLOCKING. This repository had 38 of 858 tracked files uncovered when the check was
// written; a guard that fires 38 times on a project's first run is the ceiling-that-fires-on-a-
// non-problem this framework warns about, and people route around those. So it stamps and records,
// like every other declared gap, and the operator decides what to declare.
// A listing that did not complete leaves coverage unknown, stamped rather than read as covered (G-23) — and stamped
// COVERAGE-UNKNOWN, its reason kept in run.json, not CONTRACT-PARTIAL, which says uncovered files were FOUND (G-9 of
// 20261021-190234-ciss-d1-remediations-review).
const coverage = contractCoverage(
  gitSync(['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 }), contract);
const uncovered = coverage.uncovered;
if (coverage.unknown) {
  stamps.push('COVERAGE-UNKNOWN');
  console.error(`new-run: contract coverage could not be checked (${coverage.unknown}); stamped COVERAGE-UNKNOWN.`);
} else if (uncovered.length) {
  stamps.push('CONTRACT-PARTIAL');
  console.error(
    `new-run: ${uncovered.length} tracked file(s) match no declared glob — findings against them ` +
    `are reported, not counted (§8.5). Declare them, or accept the gap: ` +
    `${uncovered.slice(0, 5).join(', ')}${uncovered.length > 5 ? ', …' : ''}`,
  );
}
// A budget key set to "" / "none" runs that tier uncapped. The stamp travels to the gate so an
// uncapped run is never mistaken for a bounded one, and run-graph names the tier in not_checked.
// The predicate has ONE owner (lib/decisions.mjs). A second copy here drifted from budgetOf and let
// an unparseable value (NaN) run uncapped while this block, not recognising NaN, wrote no stamp —
// an unbounded run stamped as bounded (G-21). Validate every tier at MINT, before anything spawns,
// so a contract typo is refused with the key named rather than silently reinterpreted as consent.
{
  const BUDGET_KEYS = ['budget_usd_per_node', 'budget_usd_per_barrier', 'budget_usd_per_run'];
  for (const k of BUDGET_KEYS) {
    try { budgetOf(review[k], undefined); }
    catch (e) { die(`review.${k} — ${e.message}`); }
  }
  if (BUDGET_KEYS.some((k) => isUncappedBudget(review[k]))) stamps.push('UNCAPPED-BUDGET');
}
if (review.external_panel !== true) stamps.push('PANEL-ABSENT');
else if (!fs.existsSync(path.join(FRAMEWORK.scriptsDir, 'external-review.mjs'))) {
  // NO FALLBACK (G-11 of 20261010-071234-reviewer-preflight-r7; operator, 2026-10-08: "no fallback"): with the panel on
  // and the reviewer check requested, a framework whose external-review.mjs is missing is refused, not minted without
  // a panel. --no-verify-reviewers keeps the old stamp, as it skips the check itself.
  if (args.verifyReviewers !== false) {
    die('review.external_panel is true but this framework\'s external-review.mjs is missing, so no reviewer can be checked or '
      + 'called; the mint is refused. Reinstall the framework, or pass --no-verify-reviewers to mint without the panel (PANEL-ABSENT).');
  }
  stamps.push('PANEL-ABSENT');
}

// ---------------------------------------------------------------------------- node-settings
// A bare `Read` allow-rule grants the tool with NO path restriction, and that OVERRIDES the
// directory sandbox --add-dir establishes. Verified empirically: an intent node whose policy
// allowed bare `Read` read straight through into the source tree with no denial recorded, while
// the same node under path-scoped rules was denied and the denial appeared in the envelope.
//
// So every Read rule in this system is path-scoped. Rule syntax is `Read(//abs/path/**)` —
// two slashes, i.e. one prepended to an already-absolute path.
// A tool rule scoped to a path. Read, Grep and Glob all take one, and all three need one: Grep
// returns file CONTENT, so an UNSCOPED Grep is a hole straight through a path-scoped Read — the
// node simply greps what it was not allowed to read. buildIntentSettings denies Grep outright for
// exactly that reason, in a comment 98 lines below where the lens policy granted it bare (G-28).
const readRule = (abs, recursive = true) => `Read(/${abs}${recursive ? '/**' : ''})`;

// docReadRules lived here: it granted the intent node each declared document, and the run directory, by Read rule.
// Stage 2b of contract-glob-grammar measured that those rules granted nothing on Windows (rendered `Read(/F:\...)`),
// and that the live --add-dir beside them granted whole directories. The intent node now reads only its sandbox,
// where run-graph COPIES exactly what each doc glob matches (io/doc-snapshot.mjs); it needs no Read grant at all
// (operator, 2026-10-01: "B: copy only matched docs (Recommended)").

// The run dir is only known after it is created; during --dry-run it does not exist yet.
let _runDirForRules = null;
const runDirForRules = () => _runDirForRules ?? path.join(reviewsDir, 'PENDING');

// Policy for a LENS: may read anywhere in the repo, but not outside it — a lens has no business
// reading a developer's home directory, and scoping costs nothing.
function buildNodeSettings() {
  // `git diff` and `git log` are DELIBERATELY absent from this list, and must stay absent (G-27).
  //
  // Permission rules are PREFIX matches with an open tail, so `Bash(git diff:*)` grants the whole
  // flag surface of the command — including the three families capture.mjs refuses by name:
  // `--no-index` (reads any path the operator can read: demonstrated live, teeing files from
  // C:\Windows into a run's evidence), `--output=` (writes any path, defeating the Edit/Write
  // denies below), and `--ext-diff`/`--textconv`/`-O` (launch an arbitrary program). A lens could
  // therefore read ~/.ssh/id_rsa or ~/.aws/credentials into its own context — four lines under the
  // comment saying a lens has no business reading a developer's home directory.
  //
  // A deny rule cannot fix it: deny rules are prefix matches too, so `Bash(git diff --no-index:*)`
  // is escaped by `git diff HEAD --no-index ...`. That is the same reasoning recorded below for
  // why `cd` is not granted. The flag can sit in any position, and only a check that scans EVERY
  // token can catch it — which is exactly what capture.mjs's FORBIDDEN_TAIL does.
  //
  // So both commands go through capture.mjs, which allows them and guards the tail. The node loses
  // nothing: capture is the only sanctioned way to produce an evidence path anyway, so a diff worth
  // reading is a diff worth citing.
  //
  // The three that remain carry no such surface: status, rev-parse and ls-files have no flag that
  // writes a file, reads outside the repository, or launches a program.
  const allow = [
    // KNOWN RESIDUAL, measured rather than assumed (G-28). `Grep` returns file CONTENT, so a bare
    // Grep beside a path-scoped Read is a hole straight through that scoping: a lens can read
    // ~/.ssh/id_rsa or any .env into its transcript and out through its rendered report.
    //
    // It is NOT closable through this file, and that was established by probing the CLI rather than
    // by reasoning about it:
    //   * `Grep(/<repo>/**)` in ALLOW does NOT confine the tool. Probed live: with that rule in
    //     place, Grep read C:\Windows\win.ini with no denial. An allow entry GRANTS; it does not
    //     SCOPE. Shipping it would have been false assurance — a comment claiming a boundary that
    //     does not exist, which is the exact failure this repo keeps finding in itself.
    //   * `Grep` in DENY removes the tool outright; the scoped allow does not re-admit it. Probed:
    //     "the Grep tool is not available in this session".
    // So it is all-or-nothing: Grep unscoped, or no Grep at all and content search goes through
    // `git grep` under capture.mjs (repo-scoped by construction, tail-guarded, and evidence-
    // producing). DECIDED: no Grep (operator, 2026-10-22, B; stop-owner-grep-state-roots.plan.md
    // stage 3, G-17 of 20261022-200543-ciss-d1-review-2). The node runtime's lens_allow no longer
    // lists it, and denyToolsFor('node') DENIES the runtime's content_tools: an unlisted read-only tool
    // still runs under manual mode, so omission alone was not the refusal (G-7 of
    // 20261105-212751-sogsr-delivery). shared/disk-first-protocol.md records the decision.
    //
    // Read stays scoped, and with Grep gone it is the lens's only reader of content.
    // FROM THE RUNTIME. `'Grep', 'Glob'` were Claude Code tool names in the orchestrator; which
    // tools a runtime exposes for reading names and content is its own vocabulary.
    readRule(repoRoot),
    // AND THE RUN DIRECTORY, when it is not already inside the repository.
    //
    // Since graph_contract 2 a run is STAGED outside the tree it reviews, so `Read(/<repo>/**)`
    // no longer covers `intent.md`. A lens with `intent: required` is told by its own brief to
    // read that file and cite an I-n criterion from it -- and was denied, echoed an empty
    // `intent_sha`, and DEGRADED on the drift check. contract-audit is REQUIRED, so every run
    // gated BLOCKED: a node ordered to read a file it has no permission to reach.
    //
    // Conditional on purpose. When the run IS inside the repository the repo rule already covers
    // it, and adding a second overlapping grant would widen nothing while making the policy
    // harder to read. This grants the run's OWN directory and nothing above it -- not the staging
    // root, which holds every other run of every other project.
    ...(isWithin(repoRoot, runDirForRules()) ? [] : [readRule(runDirForRules())]),
    ...toolList(NODE_RUNTIME, 'lens_allow'),
    // AND THE READ-ONLY GIT SET, in the runtime's own rule shape (G-36). These were `Bash(...)`
    // literals — one vendor's tool name, in the orchestrator, in the allow-list a second runtime
    // would have received verbatim and understood none of.
    ...grantRules(NODE_RUNTIME, ['git status', 'git rev-parse', 'git ls-files'], hostPlatform().id),
  ];

  // capture.mjs is the ONLY way a node can produce an evidence path, so a rule that misses a
  // spelling does not merely inconvenience the node — it silently strips the run of evidence.
  // Observed on Windows: a lens denied every capture attempt correctly refused to emit findings
  // at all (evidence protocol: cite only a path you saw printed), so the node returned zero
  // findings and looked like a weak reviewer rather than a blocked one.
  //
  // Permission rules are keyed by the AGENT'S TOOL, not by our scripts' language. Every script
  // here is OS-agnostic Node; the tool the node reaches for to invoke `node capture.mjs` is not.
  // Claude Code exposes a `PowerShell` tool on Windows and not on POSIX, so the policy has to
  // name whichever tools exist on this host — and only those. A rule for a tool the host has no
  // way to expose is dead weight in a file whose whole job is to be a small, auditable
  // allow-list, so these are generated per platform rather than unconditionally.
  // FROM THE RUNTIME, not from this file's knowledge of one vendor. These were the literals
  // ['Bash', 'PowerShell'] — Claude Code's tool names — so a policy written for a second runtime
  // would have granted nothing and denied nothing while that runtime declared both capabilities.
  // A capability list is a CLAIM; grants are the MECHANISM, and the orchestrator cannot write a
  // policy without them (shared/adapter-contract.md).
  const SHELLS = shellToolsOf(NODE_RUNTIME, hostPlatform().id);

  // Two spellings per shell. Which one a node picks is a property of the model, not the review,
  // and capture.mjs is the ONLY way a node can produce an evidence path — so a rule that misses
  // a spelling does not inconvenience the node, it silently strips the run of evidence. Observed
  // on Windows: a lens denied every capture correctly refused to emit findings at all (cite only
  // a path you saw printed), and so read as a weak reviewer rather than a blocked one.
  //
  // A `cd <dir> && node ...capture.mjs` form is deliberately NOT allowed, and the reason is that
  // the node never needs it: capture.mjs takes an absolute --run-dir that the brief supplies. A
  // rule nobody needs does not go in an allow-list whose whole value is being small and auditable.
  //
  // WHAT THIS COMMENT USED TO SAY, and why it no longer does (G-26). It justified the refusal with
  // a mechanism — "because deny rules are prefix matches too, `Bash(cd:*)` would admit
  // `cd x && rm -rf y` past the `Bash(rm:*)` deny" — while the brief this same engine writes into
  // every lens (run-graph.mjs) told the model the opposite: "the permission policy evaluates every
  // segment of a compound command, so one `echo` denies the whole chain". Both cannot be true, and
  // which one is decides whether this node deny-list is a boundary at all: under the prefix-match
  // model every open-tail grant here — `Bash(git status:*)`, `Bash(git rev-parse:*)`,
  // `Bash(git ls-files:*)`, the capture rules — admits an arbitrary appended command.
  //
  // NEITHER CLAIM WAS EVER PROBED. Forty lines above, this same function records three live CLI
  // probes because scoping behaviour "was established by probing the CLI rather than by reasoning
  // about it" — that is this repository's standard for exactly this class of claim, and these two
  // comments did not meet it. So the unprobed mechanism is stated as an open question in
  // shared/unverified-claims.md instead of being asserted twice in opposite directions, and the
  // decision above rests only on the part that needs no probe.
  //
  // The refusal is correct under BOTH models, which is why it stands while the question is open.
  // Derived, never a literal. The literal was `.claude/skills/scripts/capture.mjs`, which is
  // where the engine sits only when vendored in-tree. Installed as a plugin it lives at
  // `.claude/skills/quorate/scripts/capture.mjs`, and the allow-list would have permitted a path
  // that does not exist — so every node's evidence capture would be DENIED, and the live canary
  // catches it as "node-settings.json was probably not loaded". Which is exactly how this was
  // found: the canary refused to let the framework review itself under a policy that named the
  // wrong file.
  // BOTH SPELLINGS, quoted around the PATH: a permission rule matches the command string, and a
  // checkout whose path contains a space is denied by the unquoted rule alone.
  allow.push(...grantRules(NODE_RUNTIME, [`node ${CAPTURE_REL}`, `node "${CAPTURE_REL}"`], hostPlatform().id));

  // Generated from the contract, never hand-written: an entry for a command that is not
  // declared is a rule that can only ever deny something.
  // The ONE owner of this set (G-7). A key granted here and unknown to capture is a command the
  // policy permits and the evidence channel refuses.
  for (const key of EXECUTABLE_COMMAND_KEYS) {
    const c = commands[key];
    if (typeof c === 'string' && c.trim()) {
      // The EXACT command, not a prefix: a declared build command is granted as written, and
      // `:*` would grant its whole flag surface. This said "rendered through the runtime's own rule
      // shape" while interpolating a shell tool name and a command into a rule string right here
      // (G-36) — the comment described the design and the code was the thing the design replaced.
      // `command_rule_exact` is the adapter's answer.
      allow.push(...grantRules(NODE_RUNTIME, [c.trim()], hostPlatform().id, { exact: true }));
    }
  }
  return {
    permissions: {
      defaultMode: 'manual',
      allow,
      deny: [
        ...denyToolsFor('node', NODE_RUNTIME),
        // EVERY SHELL THE RUNTIME EXPOSES, in the runtime's own rule shape (G-36). This was two
        // hand-kept lists — a `Bash(...)` block and a `PowerShell(...)` block behind a
        // `process.platform === 'win32'` test — which is the same tool vocabulary the adapter
        // table exists to remove from this file, and the same two-copies-that-drift shape that let
        // PowerShell go missing from the intent deny list for months (G-28). grantRules mirrors
        // one list across whatever shells the runtime declares for this platform, so nothing is
        // written twice and a second runtime gets rules it can read.
        //
        // NOT redundant: the allow-list is not closed (G-5 of 20260930-205455-invoke-security-audit-g6-g7-high). Under
        // `defaultMode: manual` an unlisted command the runtime classes as read-only still runs, and only an unlisted
        // write is held for approval — measured, shared/disk-first-protocol.md §8. A deny rule refuses either way, so
        // these are the rules that actually bind.
        //
        // The command NAMES are deliberately not from the adapter: these are the things a review
        // node must never do, which is a fact about reviewing, not about a runtime. What the
        // adapter supplies is how to SPELL a rule about them.
        //
        // ONE COST, NAMED: the POSIX and PowerShell names are now mirrored onto every declared
        // shell, so a Linux host gets `Bash(Remove-Item:*)` and a Windows one gets
        // `PowerShell(rm:*)`. Those are inert — the tool has no such command — and the previous
        // version avoided them with a `process.platform === 'win32'` test around a second
        // hand-kept list. That test is what this file is not allowed to contain: it is the vendor
        // vocabulary again, and the two lists had already drifted once. Six dead lines in a deny
        // list is the cheaper failure than a rule a second runtime cannot read.
        ...grantRules(NODE_RUNTIME, [
          'rm', 'mv', 'cp', 'curl', 'wget', 'sudo', 'chmod', 'sh', 'bash',
          'Remove-Item', 'Move-Item', 'Set-Content', 'Out-File',
          'Invoke-WebRequest', 'Invoke-Expression',
          'git add', 'git commit', 'git push', 'git checkout', 'git reset', 'git clean',
        ], hostPlatform().id),
        // The node runtime itself, by whatever name it is invoked: §8's recursion guard is the
        // real boundary, and this is the cheap one in front of it.
        ...grantRules(NODE_RUNTIME, [NODE_RUNTIME.cmd], hostPlatform().id),
        // Deliberately NO per-toolchain entries here (no cargo, npm, pip, go...). NOT because the
        // allow-list is closed — it is not (G-5, above) — but because an unlisted command that
        // builds or launches something writes, and the runtime holds an unlisted write for approval,
        // which -p records as a denial. That rests on the runtime's read-only classification, not on
        // this policy; a toolchain deny-list would still be silently incomplete in the next repo this
        // set is copied into. commands.run is never added to the allow-list, so the launch command
        // is not granted to any lens without naming any toolchain.
      ],
    },
    env: { GRAPH_NODE_DEPTH: '1' },
  };
}

// Policy for the INTENT node — Rule 2. This is the file that actually makes the source tree
// unreachable; --add-dir alone does not, because an unscoped tool rule outranks it.
//
// Grep is DENIED here, not merely unlisted: Grep returns file CONTENT, so an unscoped Grep is a
// hole straight through the sandbox that a path-scoped Read would otherwise close. A name-listing
// tool is allowed — it returns names only, and a node that cannot enumerate the declared docs
// cannot do its job.
//
// FROM THE RUNTIME, like the lens policy beside it (G-54). `'Glob'` was a Claude Code tool name
// written into the orchestrator, in the ONE policy file §5 calls the Rule 2 sandbox — while
// adapter-contract.md states in terms that a runtime declaring no vocabulary gets NO rules, not
// guessed ones. A second runtime got a guessed `Glob` rule it has no such tool for, and its own
// declared name-lister was never granted here at all. `name_tools` is a key of its own rather than
// the lens's list: `intent_allow` — the name the lens list carried — held `Grep`, and reusing it
// here would have put a CONTENT tool in the one policy whose whole job is to withhold content. The
// deny list would have caught it today; a sandbox that depends on two lists disagreeing correctly
// is not one this file should build.
function buildIntentSettings() {
  return {
    permissions: {
      defaultMode: 'manual',
      // No Read grant: the intent node reads its sandbox (its cwd), which holds copies of exactly what it may read.
      allow: toolList(NODE_RUNTIME, 'name_tools'),
      // RENDERED FROM ONE OWNER, lib/decisions.mjs, which carries why each tool is on the list.
      // This was a hand-maintained copy of the array spawn-node.mjs pushes onto --disallowedTools,
      // and the two drifted twice: Grep (G-56) and then PowerShell (G-28) were missing from both,
      // with a regression test above them comparing a third copy to itself and passing (G-52).
      // The settings file and the flag must carry the SAME set — a settings file that fails
      // validation is silently ignored in -p mode and only the flag survives, so whichever one is
      // short is the sandbox the node actually gets.
      deny: denyToolsFor('intent', NODE_RUNTIME),
    },
    env: { GRAPH_NODE_DEPTH: '1' },
  };
}

// EVERY MODEL AND EFFORT THE ROSTER ASSIGNS, CHECKED BEFORE ANYTHING SPAWNS.
//
// Most nodes launch in the first minute. The tie-breaker launches only when a lens and an arm
// contradict each other; ui-audit only when a project declares a surface. An invalid model or
// effort on one of those surfaces HOURS in, on the rare node, after the run has spent its quota —
// and it arrives looking like a transport failure rather than a typo in a config file.
//
// Errors stop the mint. Warnings do not: a model this table has not heard of is far more likely to
// be one the vendor shipped last week than a mistake, and a preflight that blocks a working
// configuration is worse than the crash it was meant to prevent.
{
  const roster = JSON.parse(fs.readFileSync(path.join(FRAMEWORK.scriptsDir, 'lens-roster.json'), 'utf8'));
  const { errors, warnings } = validateRoster(roster, (n) => RUNTIME_TABLE[n], {
    defaultRuntime: runtimeName,
    // The values almost every lens actually runs on. Passing them is what makes this check cover
    // the 7 of 8 lenses that declare nothing of their own (G-20).
    defaults: { model: review.models?.judgment ?? '', effort: review.effort?.judgment ?? '' },
  });
  for (const w of warnings) console.error(`new-run: ${w}`);
  if (errors.length) {
    die(`the roster assigns models or efforts that will not work:\n  - ${errors.join('\n  - ')}`);
  }
}

// ---------------------------------------------------------------------------- dry run
// A consuming project's OWN skills can shadow the framework's by name, and nothing detected it.
//
// Found the hard way: quorate was installed into the project it grew out of, and six skill names
// collided outright — including arch-review and doc-consistency-review, which are LENSES this
// engine spawns. The ancestor also shipped .claude/skills/shared and .claude/skills/scripts, the
// legacy layout the doctrine-path resolvers still probe as a fallback.
//
// One accident keeps the NAME collisions from being fatal: nodes are spawned with --inline-skill,
// so the prompt carries THIS framework's SKILL.md text. That is an ordering which happens to hold
// rather than a boundary, and a review that silently applied an older lens's criteria while
// reporting this one's would be very hard to notice — so a genuine name collision still stamps.
//
// THE LEGACY DIRECTORIES NO LONGER DO, AND THE REASON IS THAT THE HAZARD WAS REMOVED (G-64). The
// second accident used to be "frameworkRoot/shared is probed before the legacy path" — and that
// probe is gone: the intent sandbox now snapshots DOCTRINE_DIR, the same resolution the node's
// brief is told, which never names `.claude/skills/shared`. Nothing in this engine resolves either
// directory any more; `.claude/skills/scripts` never did at all.
//
// Measured on a real consumer: the check was firing on a project's LIVE panel tooling —
// adjudicate-panel.py invoked by its own skill, external-review.ps1 pinned by a passing unit test,
// modified three days earlier. It reads directory NAMES, never contents, so there was no action
// that project could take short of renaming a working subsystem. A stamp that cannot be cleared by
// anything the operator is willing to do is a stamp people learn to skip, which is exactly the
// failure this project keeps writing down. It is reported as a note now, and stamps nothing.
//
// A shared ancestor is not exotic here; for any project quorate descends from it is the LIKELY
// case. So name it loudly rather than resolve it plausibly. This warns rather than dies: the
// collision is not currently known to change behaviour, and refusing to run over a warning we
// cannot yet prove harmful would be its own kind of dishonesty.
{
  const consumerSkillsDir = path.join(repoRoot, '.claude', 'skills');
  const frameworkSkills = path.resolve(FRAMEWORK.skillsDir);
  if (fs.existsSync(consumerSkillsDir) && path.resolve(consumerSkillsDir) !== frameworkSkills) {
    // BOTH NAMESPACES (G-2). This enumerated `skills/` alone, and the twelve node contracts moved to
    // `prompts/<id>/PROMPT.md` — so the two names that made this check exist in the first place,
    // `arch-review` and `doc-consistency-review`, stopped being detectable by it. The node's own
    // text still arrives inline, but a consumer skill named `code-audit` sits in the SAME skill
    // namespace the node can invoke from, which is the collision this warns about; moving our copy
    // out of `skills/` narrowed what we can see, not what can collide.
    const idsIn = (dir, marker) => {
      try {
        return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, marker)));
      } catch { return []; }
    };
    const ours = [
      ...idsIn(FRAMEWORK.skillsDir, 'SKILL.md'),
      ...idsIn(FRAMEWORK.promptsDir, 'PROMPT.md'),
    ];
    // ASKED OF THE OWNER, so check-install reports the same collisions this stamps (G — the install
    // step, whose job is saying what is not current, said nothing about eight colliding names).
    const { shadowed, legacy } = shadowedSkills({ frameworkIds: ours, consumerSkillsDir });
    if (shadowed.length) {
      console.error(
        `new-run: this project ships skills that shadow the framework's:\n` +
        `  colliding names: ${shadowed.join(', ')}\n` +
        `  Nodes are spawned with --inline-skill so the FRAMEWORK's text is used, but a node can\n` +
        `  still invoke a colliding name during its work. Migrate yours into .claude/quorate/<name>.md\n` +
        `  and drop the copy if this review must be unambiguous about whose criteria it applied.`,
      );
      stamps.push('SKILLS-SHADOWED');
    }
    // A NOTE, AND DELIBERATELY NOT A STAMP. Nothing resolves these directories any more, so their
    // presence says something about the project's history and nothing about this run's integrity.
    // Printed because an operator migrating off the ancestor engine is worth telling once; it does
    // not reach the gate, because a gate reader acting on it would be acting on nothing.
    if (legacy.length) {
      console.error(
        `new-run: note — ${legacy.map((n) => `.claude/skills/${n}`).join(' and ')} `
        + `${legacy.length > 1 ? 'are' : 'is'} where the ancestor engine kept its own files.\n`
        + `  Nothing in this engine reads either path, so this does not affect the run and is not stamped.`,
      );
    }
  }
}

if (args.dryRun) {
  console.log('Resolved contract\n=================');
  console.log(`project        ${contract.project ?? '(unset)'}`);
  // Absolute when it is outside the tree: a relative path there renders as a run of `..` segments
  // that tells the reader nothing about where their artifacts actually are.
  console.log(`reviews_dir    ${isWithin(repoRoot, reviewsDir) ? path.relative(repoRoot, reviewsDir) : reviewsDir}`);
  console.log(`base           ${base} -> ${baseSha ?? '(unresolved)'}`);
  console.log(`head           ${headSha ?? '(unresolved)'}${dirty ? ' (working tree dirty)' : ''}`);
  console.log(`scope          ${scope.full_sweep ? `human-asserted: ${scope.paths.join(', ')}` : `derived: ${scope.paths.join(', ')}`}`);
  console.log('\nCommands and consequences\n-------------------------');
  const conseq = {
    build: 'empty => pre-flight barrier skipped, run stamped UNBUILT, gate capped at RISK',
    test: 'empty => run stamped UNTESTED, gate capped at RISK',
    lint: 'empty => lint evidence unavailable; named in not_checked[]',
    fmt_check: 'empty => formatting unverified; named in not_checked[]',
    typecheck: 'empty => typecheck SKIPPED; named verbatim in not_checked[]',
    // SEVERITY *AND* VERDICT, named separately. This said "findings capped at RISK" — a verdict in
    // the severity slot, the same conflation that once disabled the clamp on every degraded lens —
    // while the owning document was corrected and this copy was not. --dry-run is the command
    // QUORATE.md tells every new consumer to run to understand their contract, so this is the
    // sentence a consumer reads FIRST.
    bench: 'empty => perf-audit is static-risk-only: findings capped at severity LOW and its verdict '
      + 'at RISK (a §6 invariant is never capped), run stamped UNBENCHED',
    run: 'empty => feature-verify is SKIPPED with skip_reason',
  };
  for (const [k, why] of Object.entries(conseq)) {
    const v = commands[k];
    console.log(`  ${k.padEnd(10)} ${v ? `"${v}"` : '""'.padEnd(4) + `  <- ${why}`}`);
  }
  console.log(`\nStamps         ${stamps.length ? stamps.join(', ') : '(none)'}`);
  console.log(`doc_roles      ${JSON.stringify(contract.doc_roles ?? {})}`);
  console.log(`ui             ${JSON.stringify(contract.ui ?? {})}`);
  validateNodeSettings(JSON.stringify(buildNodeSettings()));
  console.log('\nnode-settings.json validates (gates 1-3). Gate 4 (live canary) needs a real run.');
  process.exit(0);
}

// ---------------------------------------------------------------------------- the reviewer preflight
// EVERY REVIEWER THIS RUN CAN CALL IS CHECKED BEFORE THE RUN EXISTS (reviewer-preflight stage 3; operator, 2026-10-08:
// "preflight test for what is needed and fails if something is missing"). One `external-review --preflight-only` per
// distinct combination of the roster's panel arms (review) and adjudicators (tie-break) — the same reviewer, model and
// effort run-graph will pass — at this process's own depth, from the repository root, where consent and the declared
// reviewers resolve. After --dry-run, which mints nothing, and before the run directory, so a refusal leaves nothing.
//
// A check that could not run is not a check that passed: exit 5 (the probe failed), any other exit, a crash, or no exit
// within the child's bound all refuse, each named. The bound is the child's worst case from the adapter's own limits —
// a wait on a lock holder that dies at its limit, then its own version command and probe, plus the margin.
let reviewerPreflight = null;
// The skip is recorded whenever it is asked for with the panel on (G-16/G-13 of 20261010-082146-reviewer-preflight-r8):
// it was decided inside a PANEL-ABSENT test, so a missing reviewer script under --no-verify-reviewers lost the cap.
if (review.external_panel === true) {
  if (args.verifyReviewers === false) {
    stamps.push('REVIEWERS-UNVERIFIED');
    reviewerPreflight = 'skipped';
  } else if (!stamps.includes('PANEL-ABSENT')) {
    reviewerPreflight = await checkReviewersAtMint();
  }
}

async function checkReviewersAtMint() {
  const script = path.join(FRAMEWORK.scriptsDir, 'external-review.mjs');
  const seams = [
    ...(args.testPreflightStallMs ? ['--test-stall-ms', String(args.testPreflightStallMs)] : []),
    ...(args.testPreflightCrash ? ['--test-crash'] : []),
  ];
  const outcomes = [];
  await runPool(rosterCombinations(ROSTER_FOR_DEFAULTS), async (c) => {
    const label = combinationLabel(c);
    let boundMs;
    try {
      boundMs = probeLimits(RUNTIME_TABLE[c.reviewer], rawTable().probe_defaults).checkBoundMs;
    } catch (e) {
      return void outcomes.push({ label, reviewer: c.reviewer, failed: `its limits could not be read: ${e.message}` });
    }
    const r = await spawnCapture(process.execPath, preflightArgv(script, c, seams),
      // KILLABLE, as run-graph's arms are (G-12 of 20261010-071234-reviewer-preflight-r7): the stop owner targets the child's
      // own process group, so a check that overruns its bound cannot leave reviewer subprocesses behind.
      { cwd: repoRoot, env: process.env, windowsHide: true, ...hostPlatform().proc.killableSpawnOptions() }, { timeoutMs: boundMs });
    outcomes.push({ label, reviewer: c.reviewer, ...preflightOutcome({ ...r, boundMs }) });
  }, Math.max(1, Number(review.concurrency ?? 3)));

  const failed = outcomes.filter((o) => o.failed);
  if (failed.length) {
    die(`the reviewer preflight refused this run — ${failed.length} of ${outcomes.length} reviewer combination(s) failed:\n`
      + failed.map((o) => `  - preflight check of ${o.label}${overrideNote(o.reviewer)}: ${o.failed}`).join('\n')
      + '\n  Fix the reviewer, or change the roster to one that passes; --no-verify-reviewers skips this and caps the run (REVIEWERS-UNVERIFIED).');
  }
  // `probe_record`, NOT `key`: gitleaks' generic-api-key rule reads a 32-hex value under any name containing "key" as a
  // credential, so every panel-on run committed three findings and the required secret scan refused the push.
  return outcomes.map(({ record: { key, ...rest } }) => ({ probe_record: key, ...rest }));
}

// ---------------------------------------------------------------------------- create the run
const now = args.now ? new Date(args.now) : new Date();
const pad = (n, w = 2) => String(n).padStart(w, '0');
const runId =
  `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-` +
  `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}-${slug}`;

const runDir = path.join(reviewsDir, runId);
if (fs.existsSync(runDir)) die(`run dir already exists: ${runDir}`);
// QUORATE OWNS reviews_dir, SO IT KEEPS THE RULE THAT HIDES EVIDENCE (G-10, code-audit).
//
// external-review refuses to write a vendor response into git's tracked surface, and the only
// pattern covering `<run>/evidence/` was THIS framework's own .gitignore. A consuming project that
// mounts the submodule as documented and sets `external_panel: true` therefore had every panel arm
// die at exit 2 before any vendor call — QUORATE.md's setup says nothing about adding the rule, and
// neither does any skill. A guarantee that holds only in the repository that wrote it is the
// inert-guarantee shape, aimed at consumers.
//
// A `.gitignore` INSIDE the reviews directory needs no instruction: it is a file this engine may own
// and update, it travels with the directory it governs, and git applies it without anyone editing
// the project's own. Written only when absent, so an operator who changed it keeps their version.
//
// WHERE THE BYTES LAND IS A SECOND PLACE, AND IT IS NOT WRITTEN HERE (G-28). Since graph_contract 2
// an undeclared reviews_dir stages the run outside the repository, so this rule governs a directory
// git cannot see, while the finished run is archived into `<repo>/.claude/reviews`. The archive
// destination gets its own copy of this rule from run-graph, AT ARCHIVE TIME -- not here, because a
// mint must leave the reviewed tree untouched, which is the whole reason runs moved out of it.
// Atomic because mints race: check-counted-facts spawns an inner `node --test`, so the suite runs
// two mints at once. One owner writes it (G-28).
{
  const ig = ensureReviewsIgnore(reviewsDir);
  if (ig.missing.length) console.error(`new-run: ${reviewsIgnoreWarning(reviewsDir, ig.missing)}`);   // G-24
}

// CLAIMED BY ONE EXCLUSIVE mkdir (G-11 of 20261022-034225-cid1a-remediation-2-review): the existsSync above and a
// recursive mkdir let two mints of one slug in one UTC second both pass and write into one directory.
fs.mkdirSync(path.dirname(runDir), { recursive: true });
try {
  fs.mkdirSync(runDir);
} catch (e) {
  if (e.code === 'EEXIST') die(`run dir already exists: ${runDir} (another mint claimed it first)`);
  throw e;
}
// EVERY WRITE INTO THE RUN BEING MINTED THROUGH THE ONE OWNER (run-dir-descendants.plan.md stage 2), rooted at the
// directory just created exclusively above: its files, nodes/, evidence/, and the canary's sandbox below it. A link
// planted below it before a write (the window a race would need) is refused, not written through.
const mintOwner = confined(runDir);
mintOwner.dir(['nodes']);
mintOwner.dir(['evidence']);

// CLAUDE.md cannot be passed to --add-dir (the CLI rejects file paths, and "add the parent
// directory" would expose the source tree to the intent node and destroy the Rule 2 sandbox).
// Snapshot it into the run dir, which is already the intent node's cwd.
mintOwner.replace(['contract.snapshot.md'], claudeMd);

_runDirForRules = runDir; // read rules can now name the real run directory

const settingsText = JSON.stringify(buildNodeSettings(), null, 2) + '\n';
const settingsPath = path.join(runDir, 'node-settings.json');
mintOwner.replace(['node-settings.json'], settingsText);
validateNodeSettings(settingsText);

// A REMEDIATION RUN'S OWN POLICY (remediate-rebuild stage 3; design decision 9). The lens policy, plus: the runtime's
// edit tools scoped by RELATIVE rules to source_globs and test_globs (measured: only relative rules confine, resolved
// against the node's cwd, which spawn-node sets to the repository root for this mode), and no commit path: the runner
// commits after the node exits (remediation-paths stage 3). Raw `git add`/`git commit` stay in the deny list. A glob that cannot be a
// confining rule (absolute, or climbing out) refuses the mint rather than being dropped silently.
if (remediationFrame) {
  const lens = buildNodeSettings().permissions;
  const globs = [...(contract.source_globs ?? []), ...(contract.test_globs ?? [])];
  const { rules: editRules, refused } = pathRules(NODE_RUNTIME, globs);
  if (refused.length) die(`these globs cannot be expressed as a confining edit rule for a remediator: ${refused.join(', ')}`);
  if (!editRules.length) die('the node runtime declares no edit tools or path rule, so a remediator cannot be sandboxed');
  const lensToolDeny = new Set(denyToolsFor('node', NODE_RUNTIME));
  // WHAT IT MAY NEVER EDIT (G-4): the framework's own directory, hooks, git, settings, run directories, generated globs.
  const relTo = (abs) => path.relative(repoRoot, abs).split(path.sep).join('/');
  const { rules: denyEditRules } = pathRules(NODE_RUNTIME, editDenyPaths({
    frameworkRel: relTo(FRAMEWORK.frameworkRoot), reviewsRel: relTo(reviewsDir), generatedGlobs: contract.generated_globs ?? [],
  }));
  const remediateSettings = {
    permissions: {
      ...lens,
      allow: [
        ...lens.allow,
        ...editRules,
        // NO COMMIT PATH (remediation-paths stage 3, operator: "The runner (Recommended)"): the runner commits after the
        // node exits; raw git add/commit stay in the deny list below.
      ],
      deny: [...denyToolsFor('remediate', NODE_RUNTIME), ...denyEditRules, ...lens.deny.filter((d) => !lensToolDeny.has(d))],
    },
  };
  mintOwner.replace(['remediate-settings.json'], JSON.stringify(remediateSettings, null, 2) + '\n');
}

// The intent node runs under its own, narrower policy — see buildIntentSettings.
const intentSettingsText = JSON.stringify(buildIntentSettings(), null, 2) + '\n';
mintOwner.replace(['intent-settings.json'], intentSettingsText);
validateNodeSettings(intentSettingsText);

const settingsSha = crypto.createHash('sha256').update(settingsText).digest('hex');

// Record the sha of every ambient settings file so that a file which could widen a node's
// sandbox is always attributable after the fact.
//
// Only settings.json is load-bearing. Nodes are spawned with `--setting-sources project`, which
// selects the project source (.claude/settings.json) and EXCLUDES the local source
// (.claude/settings.local.json) — excluding it is the whole reason that flag is passed.
// settings.local.json accumulates a developer's own interactive approvals and would otherwise
// block every run for a reason that has no effect on the sandbox.
const ambient = {};
for (const f of ['settings.json', 'settings.local.json']) {
  const p = path.join(repoRoot, '.claude', f);
  if (!fs.existsSync(p)) continue;
  const txt = fs.readFileSync(p, 'utf8');
  ambient[f] = crypto.createHash('sha256').update(txt).digest('hex');

  if (f !== 'settings.json') continue; // local source is not loaded; sha recorded, no gate
  try {
    const amb = JSON.parse(txt);
    const extra = (amb.permissions?.allow ?? []).filter(
      (r) => !buildNodeSettings().permissions.allow.includes(r),
    );
    if (extra.length) {
      die(
        `.claude/settings.json grants permissions outside the node allow-list: ${extra.join(', ')}\n` +
          `  This file IS loaded by --setting-sources project, so a node would run wider than the\n` +
          `  run's declared policy. Remove them, or move them to .claude/settings.local.json.`,
      );
    }
  } catch {
    /* unparseable project settings cannot widen anything */
  }
}

const runJson = {
  run_id: runId,
  created_at: now.toISOString(),
  mint_started_at: MINT_STARTED_AT,
  base: base,
  base_commit: baseSha,
  head_commit: headSha,
  // WHICH REPOSITORY THIS RUN REVIEWED, recorded rather than inferred from where the run sits.
  // Run directories default OUT of the tree now, so the run's own location says nothing about
  // the project it belongs to — and findings-ledger has to find that project's tracked ledger.
  // It was reading git from the current directory, which is only right when someone happens to
  // be standing in the repository at the time.
  repo_root: repoRoot,
  // WHERE THIS RUN GOES WHEN IT IS FINISHED, decided at mint and recorded rather than re-derived.
  // An undeclared reviews_dir STAGES the run outside the repository so nothing mutates the tree
  // while it is being written, then run-graph moves it back here — so the committed evidence trail
  // keeps growing and no external backup is needed. A project that DECLARED reviews_dir wrote its
  // run straight there and has nothing to archive; null says so rather than leaving run-graph to
  // work it out from a path comparison.
  archive_to: declaredReviews ? null : archivedReviewsDir(repoRoot),   // the owner's spelling (G-10 of 20261023-014400-rdt-delivery)
  // The CONTENT of the files under review, not the HEAD commit. This field was `headSha` under a
  // name promising working-tree state, so it could not have detected an uncommitted mid-run edit
  // even if something had re-read it — and nothing did. run-graph recomputes it at the barrier and
  // stamps TREE-MOVED on a mismatch (G-44).
  // generated_globs is passed rather than re-derived: the contract already declares which trees
  // are generated, and hashing them made a run notice edits no finding could ever cite (G-32).
  worktree_sha: worktreeSha({
    repoRoot, paths: scope.paths ?? [], excludeDir: reviewsDir,
    generatedGlobs: contract.generated_globs ?? [],
  }),
  dirty,
  // The dirty paths outside generated_globs ([] when every change is a generated file; null when not established).
  dirty_outside_generated: dirtyOutsideGenerated,
  // WHICH ORCHESTRATOR ran. The three fields above describe the tree under review; this describes
  // the framework that reviewed it, and they are the same checkout only until extraction. Without
  // it, two projects reporting different verdicts for identical code have no explanation, and
  // "did this reproduce on the older orchestrator?" cannot be asked.
  framework: frameworkStamp(FRAMEWORK.frameworkRoot, { layout: FRAMEWORK.layout }),
  intent_sha256: null,
  // WHAT THIS RUN REMEDIATES, and that review's frame (stage 2). Absent on a review run.
  ...(remediationFrame ? { remediates: remediationFrame.run_id, remediation_frame: remediationFrame } : {}),
  ...(followsRemediation ? { follows_remediation: followsRemediation } : {}),
  scope,
  stamps,
  ...(coverage.unknown ? { contract_coverage_unknown: coverage.unknown } : {}),
  // WHAT THE MINT CHECKED (stage 3): one `{ probe_record, adapter, model, effort, mode, route, state, checked_at }` per reviewer
  // combination the run can call; "skipped" under --no-verify-reviewers (stamped REVIEWERS-UNVERIFIED); null with the
  // panel off, when the run calls no reviewer.
  reviewer_preflight: reviewerPreflight,
  settings_sha256: settingsSha,
  ambient_settings_sha256: ambient,
  // Probed against THIS engine's skills, not the reviewed tree's. plan-review either ships with
  // the framework or it does not; whether the project under review happens to carry a copy is a
  // different question and not the one being recorded here.
  plan_review: fs.existsSync(skillFile(FRAMEWORK.skillsDir, 'plan-review')) ? 'available' : 'deferred',
  // Recorded so a finding stays attributable to the request it was judged against. A criterion
  // is only meaningful relative to a stated ask; without this in the run record, a reader of
  // gate.md months later cannot tell which ask that was — or that there wasn't one.
  request: request.ok
    ? { path: request.path, sha256: crypto.createHash('sha256').update(request.text).digest('hex') }
    : null,
  // WHY there is none, not merely that there is none. "The path you named does not exist" and
  // "no request is declared anywhere" call for different responses, and a recovery node told only
  // the latter will write around a request that is sitting on disk — the first recovery run said
  // so itself, having noticed doc_roles.request pointing at an approved file it was told did not
  // exist.
  request_missing_reason: request.ok ? null : request.why,
  ...(request.inherited ? { request_inherited_from: inheritFrom.run_id } : {}),
  contract,
  // WHERE the criteria came from. Two supported locations means a run must say which one it
  // read, or a reader cannot reproduce it from the tree alone.
  contract_source: contractPath,
  host: {
    platform: hostPlatform().id,
    arch: process.arch,
    node_version: process.version,
    // FROM THE RUNTIME, not a literal binary and flag. Recorded under `runtime_version` because
    // `claude_version` named a vendor in an artifact a consuming project keeps forever, and a run
    // spawned on another runtime would have reported that field as 'unknown' rather than as wrong —
    // which is the quieter of the two failures and therefore the worse one.
    runtime: runtimeName,
    // PROBED IN A SCRUBBED ENVIRONMENT, AND BOUNDED (G-23, panel-codex-security). `sh` inherits the
    // operator's whole environment, and NODE_RUNTIME.cmd is CONTRACT-SELECTED — a consuming project
    // names the binary — so asking a custom or compromised runtime for its version handed it
    // GITHUB_TOKEN, AWS keys and DATABASE_URL. The canary further down already applies this surgery
    // before spawning the same binary agentically; the version probe runs FIRST and did not, which
    // made the scrub a thing the run did after the fact. The timeout is the other half: a runtime
    // that never answers `--version` must not hang the mint.
    runtime_version: (runtimeProbe().out || 'unknown').split(' ')[0],
    cwd: repoRoot,
  },
};
mintOwner.replace(['run.json'], `${JSON.stringify(runJson, null, 2)}\n`); // atomic, through the run's owner (stage 2)
// ATOMIC, like every other durable write in this engine (G-24, panel-codex-arch). A bare write
// truncates before it writes, so an interruption inside that window leaves the pointer EMPTY while
// the run directory it names is intact — and this is the file milestone gating reads to find the
// current run. tmp, fsync, rename: a reader sees the old id or the new one, never nothing.
writeTextAtomic(path.join(reviewsDir, 'latest.txt'), runId + String.fromCharCode(10))

// The canary spawns `claude`, so it needs the same environment surgery spawn-node.mjs performs on
// every node — and it did not have it, which made the gate that PROVES the sandbox works the one
// spawn guaranteed to run under a broken environment. On a machine with a stale ANTHROPIC_API_KEY
// the probe 400s, no denial is recorded, no allow-listed command runs, and the canary reports
// "policy not loaded" — a false negative that blocks every run for a reason that has nothing to do
// with the policy. Kept deliberately parallel to spawn-node.mjs's block; the reasoning is there.
// G-28: this said it was "kept deliberately parallel to spawn-node.mjs's block" but mirrored only
// the second half — spawn-node DELEGATES to scrubChildEnv (the single owner of what an agentic
// claude child may inherit), while this re-implemented a four-name deny-list and spread the rest.
// The canary is an agentic `claude -p` spawned by DEFAULT on every run, so the operator's whole
// secret-bearing shell — GITHUB_TOKEN, AWS_*, DATABASE_URL, signing keys — crossed into it: the
// same class as G-10, at the one spawn that runs before any lens exists. Scrub through the owner
// FIRST, then apply the canary's own surgery on top (the owner deliberately KEEPS Anthropic auth;
// the canary just as deliberately drops it to force subscription auth).
// The surgery now lives in lib/decisions.mjs's subscriptionProbeEnv, shared with check-intent-grant (G-24 of
// 20261001-034021-cgg-remediation-review).
function canaryEnv() {
  return subscriptionProbeEnv(process.env, NODE_RUNTIME);
}

// ---------------------------------------------------------------------------- gate 4: canary
if (args.verifySandbox !== false) {
  // The canary target is a unique name inside the RUN DIRECTORY, never <repoRoot>/CANARY.txt.
  // The old form unlinked that fixed repo-root path before and after the probe, each inside a
  // bare `catch {}` — so a developer's own untracked CANARY.txt was destroyed without a word by
  // a command whose entire documented job is to create a directory. data_loss is non-waivable
  // (§6), and the run directory a few lines above is already a collision-free scratch path.
  //
  // The probe still proves the same thing: the run dir is inside the repo and inside --add-dir,
  // so a write there is exactly as forbidden as a write anywhere else under the policy.
  const canaryName = `CANARY-${runId}.txt`;
  const canaryPath = path.join(runDir, canaryName);
  if (!mintOwner.isFree([canaryName])) {
    die(`canary target already exists: ${canaryPath} — refusing to delete a file this run did not create`);
  }
  // Two arms, and BOTH are necessary.
  //
  //   negative — run a DENY-LISTED command: it must be refused, and the refusal must be recorded.
  //   positive — run an allow-listed command: it must succeed.
  //
  // THE NEGATIVE ARM USED TO ASK THE PROBE TO CREATE A FILE, AND THAT CANNOT WORK (G-63). Measured
  // against the CLI directly, three facts, none of them guessable from the settings file:
  //
  //   1. A tool killed by `--disallowedTools` returns a TOOL ERROR, not a permission denial. The
  //      probe tried, Write was gone, nothing was written, and `permission_denials` stayed EMPTY:
  //      "The Write tool is disabled for this session, and the call returned an error ... going
  //      around it isn't my call." A working sandbox, reported by this canary as a broken one.
  //   2. It passed roughly half the time anyway, because a model that reaches for a SHELL write
  //      instead trips `Bash(Set-Content:*)` — a deny RULE, which does record. Which of the two
  //      routes the probe took was the whole difference between a mint and a refusal.
  //   3. An unlisted Bash command is not gated at all: `git log --oneline -1` and `node --version`
  //      both ran under this policy. So "not on the allow-list" is not a refusal, and an arm built
  //      on one would prove nothing.
  //
  // So the arm runs a command the policy DENIES BY RULE, which is the only form of refusal that
  // reaches `permission_denials[]`. `cp` is chosen because BOTH of its outcomes are safe and
  // observable: refused, the denial is recorded; permitted, a file appears where nothing should be
  // and `wroteFile` fails the run loudly. It copies a file this run just wrote, into this run's own
  // scratch directory — nothing outside the run is touched either way.
  //
  // Diagnosing this cost two wrong theories. Both were reasoned from the settings file rather than
  // measured against the CLI, which is this framework's own §3 rule turned on itself: a claim about
  // behaviour needs output from the thing behaving, not a reading of its configuration.
  //
  // The negative arm alone proves nothing about the settings file. `--permission-mode manual`
  // is passed as a FLAG, so a bare denial is fully explained by the flag even if the file was
  // silently ignored. Only the positive arm distinguishes "policy loaded" from "policy dropped
  // and everything denied by default" — under a dropped file, the allow-list is gone and the
  // capture command is denied too.
  // Scrubbed through the single owner (G-28). `canaryStripped` is recorded in sandbox-canary.json
  // so the crossing is visible in the artifacts, the way spawn-node records status.env_stripped —
  // the finding noted the canary was the one spawn with no environment attribution at all.
  // Both facts the contract owns, resolved once, here, where the canary is assembled. The fallbacks
  // are the built-in defaults this file already applies elsewhere — an absent key is a question
  // nobody asked, not a reason to invent a different answer than the rest of the system uses.
  // FROM CONFIG, NEVER A LITERAL (G-50). The contract sets it; lens-roster.json's `default_models`
  // is what an absent key falls back to. A model name spelled in a script is the one class of fact
  // this repository has decided will not live in one.
  const CANARY_MODEL = String(
    review.models?.mechanical || ROSTER_FOR_DEFAULTS.default_models?.mechanical || '',
  ).trim();
  if (!CANARY_MODEL) {
    die('no mechanical model: review.models.mechanical is unset and lens-roster.json declares no '
      + 'default_models.mechanical — the canary needs a model and this script will not invent one');
  }
  const CANARY_BUDGET = (() => {
    const perNode = Number(review.budget_usd_per_node);
    return Number.isFinite(perNode) && perNode > 0 ? Math.max(0.10, Number((perNode / 10).toFixed(2))) : 0.40;
  })();

  // Five minutes: a canary is two tool calls against a cheap model, while the node timeout it would
  // otherwise inherit is sized for a lens reading an entire scope.
  const CANARY_TIMEOUT_MS = 5 * 60_000;
  // Every canary call's entry (runtime-call-telemetry.plan.md stage 3), kept in the canary's own record.
  const canaryCalls = [];
  const canaryCall = (p, startedMs) => callEntry({ reviewer: runtimeName, model: CANARY_MODEL, table: RUNTIME_TABLE, startedMs,
    endedMs: Date.now(), exitCode: p?.status ?? null, signal: p?.signal ?? null, timedOut: p?.error?.code === 'ETIMEDOUT',
    timeoutMinutes: CANARY_TIMEOUT_MS / 60_000, stdout: p?.stdout ?? '', answered: runtimeAnswered(p?.stdout ?? '', NODE_RUNTIME) });

  // How many non-empty lines of the snapshot the intent probe's positive arm asks for, AND the
  // window its expected answers are drawn from. One constant because they were two independent
  // numbers that drifted into disjoint sets; see the arm below. Eight rather than three so a
  // document opening with short headings still yields a candidate long enough to be unguessable.
  const INTENT_PROBE_LINES = 8;

  // The same idea for the NEGATIVE arm: how many lines of the forbidden file the probe asks for, and
  // the window its leak detector searches. Three rather than eight because the question is only
  // "did any of this file's content come back", and a shorter ask is a clearer refusal to disobey.
  const INTENT_LEAK_LINES = 3;
  const { env: canaryProcessEnv, stripped: canaryStripped } = canaryEnv();
  // RENDERED FROM THE RUNTIME, like every other node this framework spawns. This block wrote out
  // ten Claude flags of its own — a second spawner, with its own copy of the vocabulary, inside the
  // script whose job is to write the policy those flags enforce. A canary that probes a runtime by
  // guessing its flag names proves nothing about that runtime.
  // WRITTEN AGAINST THE WAY IT ACTUALLY FAILS. Measured 2026-09-23: three of seven lens-bench
  // seeds refused to mint because the probe inserted a step of its own — `ls -la` "to check that
  // capture.mjs and the run directory exist" — was correctly refused twice, and then STOPPED,
  // never reaching either command it was given. Both recorded denials were its own reconnaissance.
  //
  // So the prompt now forbids the reconnaissance and, more importantly, says that a refusal is an
  // EXPECTED OUTCOME rather than a reason to stop. The second half is the load-bearing one: step 2
  // is deny-listed on purpose, and a probe that treats its first refusal as failure abandons the
  // run before proving anything. Neither instruction changes what the canary can prove — both arms
  // are still judged by artifacts on disk, not by what the probe says it did.
  // A WINDOWS PATH IS NOT SHELL-SAFE, AND THIS PROMPT IS SHELL INPUT.
  //
  // The probe's step 1 carried `--run-dir C:\Users\...` unquoted. A POSIX shell reads each
  // backslash as an escape and hands capture.mjs `C:Userssomeone.quoratereviews...` — a relative,
  // concatenated path that does not exist, so capture exits 2, no gitstatus.log appears, and the
  // positive arm fails on a policy that is working perfectly. The probe said so itself once the
  // answer was recorded: "the backslash Windows path was mangled by the POSIX shell".
  //
  // THAT IS WHY IT LOOKED INTERMITTENT. node-settings.json permits the command under BOTH Bash and
  // PowerShell, and the two disagree about backslashes — so the mint's outcome was decided by which
  // shell the model happened to reach for. Both retry attempts failed identically on the seed that
  // exposed it, which is the tell that separates this from a flaky model: a retry cannot fix a
  // deterministic mangling, and one that appeared to work was a different shell rather than a
  // different roll.
  //
  // Forward slashes AND quotes: node accepts `/` on Windows, quoting survives all three shells, and
  // either alone leaves a path with a space or a backslash to chance.
  // briefArg, the one owner of that rule (G-7, G-8 of 20261121-214741-m3s7-b1-remediation-2-review): quotes alone left
  // `%NAME%`, `$` and a backtick live, and briefArg refuses what no shell's quoting neutralises.
  const sh = briefArg;
  // THE WORDS ARE IN prompts/_templates/sandbox-canary.md (G-17 of 20260925-015614-platform-review):
  // orchestration carries no model-facing prose (ARCHITECTURE §2). What stays here is what only this
  // file knows — the paths, rendered by `sh()` above.
  //
  // Step 1 uses the SAME derived path as the allow-list. Telling the probe to run a command the policy
  // does not permit tests nothing about the policy — it tests whether the two literals match.
  //
  // Step 2 is A DENY-LISTED COMMAND, spelled as a command rather than as a goal. Asked for an OUTCOME
  // ("create this file") the probe picks its own tool and usually picks Write, which is disabled by
  // flag and records nothing. Asked to run this exact line it uses the shell, and the shell is where
  // the deny RULES live. `node-settings.json` is the source because this run wrote it a few lines
  // above, so it is guaranteed to exist without depending on anything later.
  const canaryPrompt = renderTemplate(readTemplate('sandbox-canary.md'), {
    capture_rel: sh(CAPTURE_REL),
    run_dir: sh(runDir),
    settings_path: sh(settingsPath),
    canary_path: sh(canaryPath),
  }, 'sandbox-canary.md').trimEnd();
  // AND THE ARM MUST NOT GO INERT WITHOUT SAYING SO. Everything above rests on `cp` being DENIED by
  // rule. Remove that rule — reasonably; it is a harmless copy — and the probe would run it, record
  // no denial, and this canary would be back to proving nothing while looking unchanged. A guard
  // that stops guarding without failing is the defect shape this repository keeps finding in itself,
  // and the negative arm has already been one once.
  {
    const deny = buildNodeSettings().permissions?.deny ?? [];
    if (!deny.some((r) => /^(Bash|PowerShell)\(\s*cp:/.test(String(r)))) {
      die('the sandbox canary\'s negative arm runs `cp` because the node policy DENIES it by rule, '
        + 'and that rule is gone. A deny RULE is the only refusal that reaches permission_denials[] '
        + '— a tool removed with --disallowedTools returns a tool error and records nothing, and an '
        + 'unlisted command is not refused at all. Point the arm at another deny-listed command '
        + 'whose permitted outcome is safe and observable, or it will pass while proving nothing.');
    }
  }

  const canaryCmd = nodeArgv(NODE_RUNTIME, {
    prompt: canaryPrompt,
    // FROM THE CONTRACT (G-29). This was the literal 'sonnet' while review.models.mechanical
    // declares which model does mechanical work, and every other spawn resolves its model from
    // configuration. A project that pins a different mechanical model got a canary that proved its
    // settings file loads for a model it does not use.
    model: CANARY_MODEL,
    settingsPath,
    addDirs: [repoRoot],
    denyTools: denyToolsFor('node', NODE_RUNTIME),
    sandboxed: true,
    // Likewise the ceiling. The canary is a two-step probe and must stay cheap, so it takes a TENTH
    // of the per-node budget rather than the whole thing — derived, so a project that lowers its
    // node cap lowers this too, and one that removes the cap does not hand a probe an unbounded
    // budget by accident.
    budgetUsd: String(CANARY_BUDGET),
    sessionId: crypto.randomUUID(),
  });
  // Takes the rendered launch, its stdin prompt with it (decision-panel-seats.plan.md stage 2; DP-D1 A).
  const runCanaryProbe = (rendered) => {
    const launched = launch(rendered);
    const probeStartedMs = Date.now();
    // The prompt from a file, never spawnSync's input pipe (G-15 of 20261109-232630-dps-delivery).
    const p = spawnSyncFrom(
      launched.cmd,
      launched.argv,
      // BOUNDED (G-25, panel-codex-security). Neither canary carried a timeout, so a hung runtime or
      // a stalled transport blocked an otherwise-valid mint indefinitely — a hang on valid input,
      // which §6 makes non-waivable. A canary that never returns now fails the run closed, with the
      // stall named, instead of looking like a mint that is merely slow.
      { cwd: repoRoot, input: launched.input, encoding: 'utf8', env: canaryProcessEnv, timeout: CANARY_TIMEOUT_MS },
    );
    // THE CANARY CALL'S ENTRY (runtime-call-telemetry.plan.md stage 3): a model call, measured like every other.
    canaryCalls.push(canaryCall(p, probeStartedMs));
    let d = [];
    let text = '';
    try {
      const env = JSON.parse(p.stdout ?? '{}');
      d = env.permission_denials ?? [];
      // THE PROBE'S OWN ACCOUNT, which is the one diagnostic a positive-arm failure actually needs
      // and the only canary that was not keeping it. The intent canary records `answer`; this one
      // recorded stderr and an error object, both null on every failure seen — so "the allow-listed
      // command did not run" came with no way to learn WHY. Measured the hard way: a sweep was
      // stopped twice over a failure whose cause could only be guessed at from a denial list.
      text = typeof env.result === 'string' ? env.result : '';
    } catch {
      /* handled below */
    }
    return {
      probe: p,
      denials: d,
      text,
      // Safe to read unconditionally: the existence check above proved this path was free before
      // any probe ran, so anything here was created BY a probe.
      // Through the run's owner (run-dir-reads.plan.md stage 4). A link where the probe was to write counts as written,
      // so the canary fails closed; a link at the allow-listed command's log is no proof it ran.
      wroteFile: (() => { try { return mintOwner.exists([canaryName]); } catch { return true; } })(),
      sawDenial: d.length > 0,
      allowWorked: (() => { try { return mintOwner.exists(['evidence', 'canary', 'gitstatus.log']); } catch { return false; } })(),
    };
  };

  let attempt = runCanaryProbe(canaryCmd);
  let canaryAttempts = 1;
  let firstAttemptFailures = null;
  let firstAttemptText = null;

  // ONE RETRY, AND ONLY FOR THE FAILURE THAT IS PROVABLY THE PROBE'S.
  //
  // `sawDenial && !allowWorked` is a specific, checkable state: a denial was RECORDED, which an
  // unread policy cannot produce — so the settings file loaded and the deny rules are enforced, and
  // the only thing unproven is that the probe ran the allow-listed command. Measured at three of
  // seven seeds on 2026-09-23, every one of them a probe that spent its turns on reconnaissance.
  //
  // This cannot weaken the guarantee, and that is why it is scoped this narrowly. A retry that also
  // fails still refuses the mint; `wroteFile` is excluded because a probe that COPIED the file has
  // found a real enforcement hole and must never be given a second draw; and `!sawDenial` is
  // excluded because that is the state where the policy genuinely may not have loaded, which is a
  // fault to surface rather than to re-roll.
  //
  // A fresh session id, because the retry must be an independent draw rather than a continuation of
  // a conversation that has already decided it is stuck.
  if (attempt.sawDenial && !attempt.allowWorked && !attempt.wroteFile) {
    firstAttemptFailures = sandboxCanaryFailures(attempt);
    firstAttemptText = attempt.text || null;
    canaryAttempts = 2;
    attempt = runCanaryProbe(nodeArgv(NODE_RUNTIME, {
      prompt: canaryPrompt,
      model: CANARY_MODEL,
      settingsPath,
      addDirs: [repoRoot],
      denyTools: denyToolsFor('node', NODE_RUNTIME),
      sandboxed: true,
      budgetUsd: String(CANARY_BUDGET),
      sessionId: crypto.randomUUID(),
    }));
  }

  const { probe, denials, wroteFile, sawDenial, allowWorked } = attempt;

  /**
   * Park a probe's FREE TEXT where git does not follow, and return the path to cite.
   *
   * `sandbox-canary.json` and `intent-canary.json` sit in `nodes/`'s sibling directory and are
   * TRACKED — 27 of them are in this repository's history — while `evidence/` is gitignored
   * precisely because it holds content. Both records carried `probe_stderr` straight from a
   * subprocess, and the same defect in the tie-break's status file was raised as a HIGH by
   * security-audit: run-checks strips `stderr_tail` from the tracked checks.json because command
   * output may hold "a connection string, an environment dump, a token inside an error".
   *
   * No committed record has ever actually carried stderr — every canary spawn so far succeeded and
   * the field was null. So this is a loaded field in a tracked file rather than a leak that
   * happened, and it is being emptied before it fires rather than after.
   *
   * The diagnostics still exist on disk, in the same directory the vendor logs and the canary's own
   * gitstatus.log already use. Only the committing stops.
   */
  const stashCanaryDetail = (name, detail) => {
    const rel = `evidence/canary/${name}.json`;
    try {
      mintOwner.replace(['evidence', 'canary', `${name}.json`], `${JSON.stringify(detail, null, 2)}\n`);
      return rel;
    } catch (e) {
      console.error(`new-run: could not stash ${name} diagnostics: ${e.message}`);
      return null;
    }
  };
  // SAID, NOT SWALLOWED (G-13 of 20261103-022403-rbr-remediation-8-review): a missing canary is `false`, not a throw, so
  // what lands here is a real failure, and the file it leaves in the run directory is named.
  try { mintOwner.remove([canaryName]); } catch (e) { console.error(`new-run: could not remove the sandbox canary ${canaryName}; it is left in the run directory: ${e.message}`); }

  mintOwner.replace(
    ['sandbox-canary.json'],
    JSON.stringify(
      {
        negative_arm: { wrote_file: wroteFile, denials_observed: denials.length, denials },
        calls: canaryCalls.splice(0),
        positive_arm: { allow_listed_command_ran: allowWorked },
        // A RETRY THAT NOBODY CAN SEE IS A HIDDEN INTERMITTENCY. The probe gets one second draw
        // when the first failed in the one way that proves the POLICY loaded and only the probe
        // misbehaved, and the fact of it lands here with the first attempt's diagnosis — so a mint
        // that needed two goes is distinguishable from one that needed none, and a rising retry
        // rate is visible in the tracked artifacts rather than only in whoever was watching.
        attempts: canaryAttempts,
        first_attempt_failures: firstAttemptFailures,
        exit_code: probe.status,
        // What was stripped from this agentic child's environment, by name. spawn-node records the
        // same on every lens as status.env_stripped; the canary recorded nothing, so the one spawn
        // that runs before any lens had no environment attribution (G-28).
        env_stripped: canaryStripped,
        // The distinction this record must preserve — "the policy was ignored" versus "the probe
        // never reached the API" — needs the failure TEXT, and both produce zero denials and no
        // evidence file. So the text is kept, in the gitignored directory, and named here.
        diagnostics: stashCanaryDetail('sandbox-canary-detail', {
          // Both attempts when there were two, because the interesting question on a retry is
          // whether the probe failed the SAME way twice or two different ways — one is a flaky
          // model, the other is something real that the retry merely papered over.
          answer: attempt.text.slice(0, 4000),
          first_attempt_answer: firstAttemptText ? firstAttemptText.slice(0, 4000) : null,
          probe_stderr: (probe.stderr ?? '').trim().slice(0, 4000) || null,
          probe_error: probe.error ? String(probe.error.message ?? probe.error) : null,
        }),
      },
      null,
      2,
    ) + '\n',
  );

  // ------------------------------------------------------------------ the INTENT arm (G-62)
  //
  // §5 says it in terms: "A sandbox that is never tested is a sandbox that does not work. Verify
  // enforcement by spawning an intent-mode node that deliberately attempts a source read, and
  // asserting the denial appears in permission_denials[]." The canary above probes
  // node-settings.json — the LENS policy, the permissive one — and intent-settings.json, the file
  // §5 calls Rule 2's enforcement point, was written, structurally validated, and never exercised.
  // So a run could proceed with the documented proof absent: the narrow policy was proven to be
  // well-formed, which is not the same as proven to be applied, and the difference is the entire
  // reason gate 4 exists for the other file.
  //
  // THE CANARY READS THROUGH THE GRANT THE REAL NODE GETS (contract-glob-grammar stage 4; operator, 2026-10-01: "B: copy
  // only matched docs (Recommended)"). The intent node reads only its sandbox, where run-graph copies exactly what each
  // doc glob matches, so the canary builds the same sandbox, through the same module, and runs both arms from it.
  // The positive arm reads a DECLARED DOCUMENT there — the first copied one, or the contract snapshot when the contract
  // declares none — and the negative arm asks for a source file outside the sandbox. Both arms, because a bare denial is
  // explained by `--permission-mode manual` even if the policy was dropped; only a read that WORKS shows it loaded.
  //
  // This arm used to read the run directory's contract.snapshot.md through --add-dir, on a diagnosis the canary's first
  // live run seemed to give: `Read(/C:\repo\CLAUDE.md)` was in the policy and the read was denied, recorded as "a
  // path-scoped rule does not grant a read outside --add-dir". Stage 2b's probe found the actual cause: the rule's
  // rendering, `Read(/` + a Windows path, is not the runtime's absolute form, so it granted nothing anywhere. Moving the
  // arm into --add-dir hid that, which is how every intent node on Windows ran without its contract snapshot (review r5's
  // intent.md: "contract.snapshot.md — Not present in the sandbox").
  const intentTarget = path.resolve(FRAMEWORK.scriptsDir, 'run-graph.mjs');
  const canarySandbox = path.join(runDir, 'sandbox', 'intent-canary');
  mintOwner.remove(['sandbox', 'intent-canary'], { recursive: true });
  mintOwner.dir(['sandbox', 'intent-canary']);
  const canaryCaseInsensitive = hostPlatform().caseInsensitiveFs;
  const canarySnap = createSnapshot(path.join(canarySandbox, 'declared-docs'), { caseInsensitive: canaryCaseInsensitive,
    write: (name, content) => mintOwner.replace(['sandbox', 'intent-canary', 'declared-docs', name], content) });
  // The same owner run-graph builds the real sandbox through, so the two prune the same roots (G-25 of
  // 20261001-034021-cgg-remediation-review).
  snapshotIntentDocs({
    repoRoot, docPaths: contract.doc_paths ?? [], generatedGlobs: contract.generated_globs ?? [],
    stagingRoot: reviewsDir, snap: canarySnap, caseInsensitive: canaryCaseInsensitive,
  });
  // Through the egress owner (G-10 of 20261114-184441-m2-pred1-remediation-b-review), its one entry for a prompt-bound
  // run read (G-2 of 20261115-042114-pbr-1b-remediation-4-review). A REFUSAL REFUSES THE MINT, NEVER AN EXCEPTION (G-3 of
  // 20261115-045745-pbr-1b-remediation-5-review; ARCHITECTURE.md A-30): the read had no catch, so a hard link or an
  // oversized snapshot threw out of new-run with a stack. Any other failure still throws. The read stays inline in the
  // copy, the shape tests/regression-hardlink-egress-census.test.mjs holds every egress site to; a refusal of the copy's
  // write into the fresh sandbox is a refusal too, so the message names both paths.
  try { mintOwner.replace(['sandbox', 'intent-canary', 'contract.snapshot.md'], egressRunReader(runDir).read(['contract.snapshot.md'], null)); }
  catch (e) {
    // An absence is a refusal's class (A-30), through its owner (G-28 of 20261116-221234-m2-9a-high-2): ECONFINED alone let
    // a missing snapshot throw out of the mint with a stack.
    if (!refusedOrAbsent(e)) throw e;
    die(`the intent canary's contract snapshot could not be opened: ${refusalCause(e)}, at contract.snapshot.md below the run or its copy in sandbox/intent-canary, so no intent node could be given its contract. Run dir: ${runDir}`);
  }
  // The snapshot listed and read through the run's owner (run-dir-reads.plan.md stage 4): a link at any level is refused.
  let canaryDocs = [];
  try { canaryDocs = mintOwner.list(['sandbox', 'intent-canary', 'declared-docs']).sort(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const intentAllowedSegs = canaryDocs.length ? ['sandbox', 'intent-canary', 'declared-docs', canaryDocs[0]] : ['sandbox', 'intent-canary', 'contract.snapshot.md'];
  const intentAllowed = path.join(runDir, ...intentAllowedSegs);
  // WHICH FILE THE POSITIVE ARM READ, SAID (G-12 of 20261001-155615-cgg-review-r3). The fallback to the contract snapshot
  // exists for a contract that declares no document; when doc globs ARE declared and none was copied, the canary passed
  // the same way without ever reading a declared document. It still proves the policy loaded — the snapshot is in the
  // sandbox too — so it is not a refusal: the record names its target and the mint says so.
  const declaredDocCopied = canaryDocs.length > 0;
  const canaryTarget = path.relative(canarySandbox, intentAllowed).split(path.sep).join('/');
  if (!declaredDocCopied && (contract.doc_paths ?? []).length) {
    console.warn(`new-run: doc_paths declares ${contract.doc_paths.length} glob(s) and no declared document was copied into the `
      + 'intent sandbox, so the intent canary read contract.snapshot.md instead; the intent node will see no declared document');
  }

  // ONE QUESTION PER PROBE, because two in one conversation made this intermittent.
  //
  // Both arms used to be steps 1 and 2 of a single prompt, and the arm's evidence is read from
  // `result` — the FINAL assistant message. A model that is denied on step 2 narrates the denial,
  // sometimes retries it, and its last message is then entirely about step 2; the step-1 quote
  // happened earlier in the conversation and is nowhere in the field being scored. Measured, with
  // the diagnostics this arm had been missing:
  //
  //   "Step 2 is still blocked: reading <repo>\\scripts\\run-graph.mjs requires a permission
  //    grant I don't have ... I won't retry a third time"
  //
  // — a correct answer to both questions, scored as a failed read, refusing the mint and blaming
  // intent-settings.json. It failed roughly one run in four, never reproducibly, for exactly as
  // long as the two arms shared a turn.
  //
  // Same policy file, same add-dir, same deny list: what the two probes must share is the POLICY,
  // not the conversation. Splitting them costs one extra cheap call per mint and makes each arm's
  // evidence unambiguous — the positive one has nothing else it could be talking about.
  const intentSettings = path.join(runDir, 'intent-settings.json');
  const intentCmd = nodeArgv(NODE_RUNTIME, {
    // The canary's prompts are the prompt library's (consumer-owned-configuration.md AC2).
    prompt: renderTemplate(readTemplate('intent-canary-allowed.md'), { path: intentAllowed, lines: INTENT_PROBE_LINES }, 'intent-canary-allowed.md').trim(),
    model: CANARY_MODEL,
    settingsPath: intentSettings,
    // The sandbox alone, as the real intent node gets it. Handing this probe the repo root would let the negative arm
    // pass for the wrong reason on a runtime where --add-dir happens to be the binding constraint.
    addDirs: [canarySandbox],
    denyTools: denyToolsFor('intent', NODE_RUNTIME),
    sandboxed: true,
    budgetUsd: String(CANARY_BUDGET),
    sessionId: crypto.randomUUID(),
  });
  // TIMED, because a perf finding about these two spawns could not be evaluated from any artifact
  // (G-22, perf-audit). The claim is that the arms run one after the other — true, and they must
  // stay separate PROCESSES, since sharing one conversation made the positive arm read the negative
  // arm's denial narration and fail about one mint in four. Whether running them concurrently is
  // worth converting this synchronous mint path to async was a question about two numbers nothing
  // recorded. They are recorded now, and MEASURED THEY SAY NO: one live mint on this machine timed
  // the positive arm at 16.4s and the negative at 9.6s, 26.0s sequential. Overlapping them saves the
  // shorter one — about ten seconds, once, at the start of a run that takes tens of minutes — in
  // exchange for making the mint path async and doubling the concurrent vendor calls made by the one
  // step whose entire job is to prove a sandbox holds. Declined on the number, the same way the
  // O(F^2) grouping was. The field stays so the next person decides on evidence rather than on this
  // paragraph.
  const intentStartedAt = Date.now();
  const intentLaunch = launch(intentCmd);
  const intentProbe = spawnSyncFrom(
    intentLaunch.cmd, intentLaunch.argv,
    // Same bound as the other arm-pair (G-25). The prompt on stdin (decision-panel-seats.plan.md stage 2).
    { cwd: canarySandbox, input: intentLaunch.input, encoding: 'utf8', env: canaryProcessEnv, timeout: CANARY_TIMEOUT_MS },
  );
  const intentProbeMs = Date.now() - intentStartedAt;
  const intentCalls = [canaryCall(intentProbe, intentStartedAt)];
  let intentText = '';
  try {
    intentText = String(JSON.parse(intentProbe.stdout ?? '{}').result ?? '');
  } catch { /* recorded below, like the other arm */ }

  // THE NEGATIVE ARM, under the same policy, in its own turn. It asks for the source file and
  // nothing else, so `permission_denials` and the final message both describe one thing.
  const intentDenyCmd = nodeArgv(NODE_RUNTIME, {
    prompt: renderTemplate(readTemplate('intent-canary-denied.md'), { path: intentTarget, lines: INTENT_LEAK_LINES }, 'intent-canary-denied.md').trim(),
    model: CANARY_MODEL,
    settingsPath: intentSettings,
    addDirs: [canarySandbox],
    denyTools: denyToolsFor('intent', NODE_RUNTIME),
    sandboxed: true,
    budgetUsd: String(CANARY_BUDGET),
    sessionId: crypto.randomUUID(),
  });
  const intentDenyStartedAt = Date.now();
  const intentDenyLaunch = launch(intentDenyCmd);
  const intentDenyProbe = spawnSyncFrom(
    intentDenyLaunch.cmd, intentDenyLaunch.argv,
    { cwd: canarySandbox, input: intentDenyLaunch.input, encoding: 'utf8', env: canaryProcessEnv, timeout: CANARY_TIMEOUT_MS },
  );
  const intentDenyProbeMs = Date.now() - intentDenyStartedAt;
  intentCalls.push(canaryCall(intentDenyProbe, intentDenyStartedAt));
  let intentDenials = [];
  let intentDenyText = '';
  try {
    const parsed = JSON.parse(intentDenyProbe.stdout ?? '{}');
    intentDenials = parsed.permission_denials ?? [];
    intentDenyText = String(parsed.result ?? '');
  } catch { /* recorded below, like the other arm */ }
  // A LINE OF THE SOURCE FILE, not the word "denied". A model that was refused says so in prose
  // that varies; a model that READ the file can quote a line only a reader of it could produce.
  // Whether the content leaked is the question — whether it claimed to be denied is not.
  // CHECKED IN THE ARM THAT ASKED FOR IT. This scanned the positive arm's text back when both
  // questions shared one turn; the leak can only appear in the answer to the question that
  // requested the source file.
  // ONE WINDOW FOR THE ASK AND THE CHECK — the third time this exact shape has been found here.
  //
  // The prompt asked for the FIRST LINE and the detector scanned for line index [1]. The first line
  // of the probed file is `#!/usr/bin/env node`; the line searched for is the comment beneath it. So
  // a model that escaped the sandbox, read the source and complied exactly would report line 0, the
  // detector would look for line 1, and `leaked` stayed false BY CONSTRUCTION. The negative arm's
  // leak detector could not fire (security-audit).
  //
  // Line [1] was not arbitrary: a shebang is 19 characters and the `length > 30` guard would have
  // rejected it anyway, which is exactly why a second rule crept in. The remedy is the one the
  // POSITIVE arm already got this morning — the window is named once and both sides read it.
  const sourceLines = fs.readFileSync(intentTarget, 'utf8')
    .split(/\r?\n/).slice(0, INTENT_LEAK_LINES).map((l) => l.trim())
    .filter((l) => l.length > 30);   // a short line is guessable without reading anything
  const leaked = sourceLines.some((l) => intentDenyText.includes(l.slice(0, 50)));
  // ANY DISTINCTIVE LINE FROM THE HEAD OF THE FILE, not one line this script picked.
  //
  // The first version asked for "the first non-empty line" and then checked for the first line
  // longer than twelve characters. In this repository's own contract those are different lines —
  // `# quorate` and the paragraph below it — so the probe read the file correctly, answered
  // correctly, and was scored as a failure. A control that fails on a correct answer is worse than
  // no control: it would have blocked every mint here while pointing at the sandbox.
  //
  // Several candidates, any one of which only a reader of the file could produce. Short lines are
  // excluded because a heading like `# quorate` can plausibly be guessed from the run directory's
  // own path, and a control a model can satisfy without reading is not a control.
  // ONE RULE COMPUTES BOTH SIDES, because two rules drifted apart and a correct answer failed.
  //
  // The question asked for the first three NON-EMPTY lines; the candidate set took the first five
  // lines of length >= 20 AFTER filtering, which in the story-pipeline fixture were source lines
  // 3, 5, 8, 10 and 12. Three of the five could not appear in any correct answer, and a snapshot
  // opening with three short lines would have made the two sets fully DISJOINT — a blocking gate
  // refusing every mint, deterministically, while pointing at the sandbox.
  //
  // The comment above already records this exact shape being fixed once ("a control that fails on
  // a correct answer is worse than no control"). It was fixed for one pair of mismatched rules and
  // the shape survived in the next pair. Now the window is named once, in INTENT_PROBE_LINES, and
  // both the prompt and the candidates read it: the sets cannot be disjoint by construction rather
  // than by the maintainer checking.
  const allowedLines = (() => {
    try {
      return mintOwner.read(intentAllowedSegs)
        .split(/\r?\n/).map((l) => l.trim()).filter((l) => l)
        .slice(0, INTENT_PROBE_LINES)      // the same window the model was asked for
        .filter((l) => l.length >= 20);    // then dropped if too short to be unguessable
    } catch { return []; }
  })();
  // WHITESPACE-INSENSITIVE, because the answer is model prose and the candidates are file lines.
  // A quote that re-wraps, indents inside a blockquote, or collapses a run of spaces is still a
  // correct quote, and an exact substring test scored it as a failed read — which is how a gate
  // that refuses on a right answer becomes intermittent rather than obviously broken.
  // Model prose quoting a file line adds three things the line never had: blockquote markers, code
  // fencing, and its own line wrapping. All three are stripped from BOTH sides before comparing, so
  // the test is "did this text contain the line" rather than "did it contain the line formatted
  // exactly as the file stores it" — a distinction that has nothing to do with whether the read
  // succeeded, which is the only question this arm asks.
  const flat = (s) => String(s)
    .replace(/[`>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const haystack = flat(intentText);
  const intentReadWorked = allowedLines.some((l) => haystack.includes(flat(l).slice(0, 40)));

  mintOwner.replace(
    ['intent-canary.json'],
    JSON.stringify({
      probed: path.relative(repoRoot, intentTarget).split(path.sep).join('/'),
      calls: intentCalls,
      negative_arm: {
        source_content_leaked: leaked, denials_observed: intentDenials.length, denials: intentDenials,
      },
      positive_arm: {
        declared_doc_read: intentReadWorked,
        target: canaryTarget,
        declared_doc_copied: declaredDocCopied,
        // WHAT THE ARM ACTUALLY LOOKED FOR, AND WHAT IT GOT. This recorded a bare `false` and
        // discarded both, so a failing control said "the policy was probably not loaded" and left
        // no way to tell that from "the model answered correctly and the matcher missed" — a
        // distinction this very arm has already been wrong about once, when it scored a correct
        // answer as a failure and would have blocked every mint while pointing at the sandbox.
        // The run then refuses to spawn, so this artifact is the only evidence that will exist.
        //
        // Withheld when the negative arm leaked, and only then: the answer would carry the source
        // line the leak check just found, and writing it here would copy the escape into the
        // record. The flag above still reports the outcome in that case.
        expected_any_of: allowedLines.map((l) => l.slice(0, 40)),
      },
      // BOTH PROBES, because a failure in either refuses the mint and the reader has to tell which.
      exit_code: intentProbe.status,
      // The two numbers the perf question needs, and their sum: what gate 4 adds to every mint.
      timing_ms: {
        positive_arm: intentProbeMs,
        negative_arm: intentDenyProbeMs,
        sequential_total: intentProbeMs + intentDenyProbeMs,
      },
      deny_arm_exit_code: intentDenyProbe.status,
      env_stripped: canaryStripped,
      // THE MODEL'S ANSWER AND BOTH STDERRS, in the gitignored directory. The answer is what the
      // verdict above rests on and the run refuses to spawn once it is false, so it has to be
      // recoverable — but it is free text from a subprocess written into a TRACKED file, which is
      // the shape security-audit raised as a HIGH against the tie-break's status file on this same
      // change set. Same remedy: the bytes go where git does not follow, the path comes back.
      diagnostics: stashCanaryDetail('intent-canary-detail', {
        answer: intentText.slice(0, 4000),
        probe_stderr: (intentProbe.stderr ?? '').trim().slice(0, 4000) || null,
        probe_error: intentProbe.error ? String(intentProbe.error.message ?? intentProbe.error) : null,
        deny_arm_answer: intentDenyText.slice(0, 4000),
        deny_probe_stderr: (intentDenyProbe.stderr ?? '').trim().slice(0, 4000) || null,
        deny_probe_error: intentDenyProbe.error
          ? String(intentDenyProbe.error.message ?? intentDenyProbe.error) : null,
      }),
    }, null, 2) + '\n',
  );

  // The canary's sandbox has served: its record is written. Removed, so a run carries one intent sandbox, run-graph's.
  mintOwner.remove(['sandbox', 'intent-canary'], { recursive: true });
  const failures = [];
  if (leaked) failures.push('the intent node read a source file — Rule 2 is not enforced by intent-settings.json');
  if (!intentDenials.length) failures.push('the intent node recorded no permission denial at all');
  if (!allowedLines.length) {
    // NO CONTROL COULD BE FORMED, which is not the same as the control failing. With an empty
    // candidate set `intentReadWorked` is false for every possible answer, so this refused every
    // mint while blaming the sandbox — a diagnosis the operator cannot act on, pointing at a
    // subsystem that is working. Reachable whenever the snapshot's opening lines are all short.
    failures.push(`the intent probe's positive control could not be built: none of the first `
      + `${INTENT_PROBE_LINES} non-empty lines of contract.snapshot.md is long enough to be `
      + 'unguessable, so nothing distinguishes a loaded policy from a dropped one. This is a '
      + 'defect in the probe, not in the sandbox.');
  } else if (!intentReadWorked) {
    failures.push('the intent node could not read its own declared document — intent-settings.json '
      + 'was probably not loaded, so the denial above proves nothing. The answer it gave and the '
      + 'lines expected of it are recorded — the expected lines in intent-canary.json, the answer '
      + 'itself in evidence/canary/intent-canary-detail.json, which git does not track');
  }
  if (wroteFile) {
    failures.push(`the copy SUCCEEDED — ${canaryPath} exists, so the policy's Bash(cp:*) deny rule `
      + 'was not enforced. The node policy is not constraining the shell');
  }
  // THREE OUTCOMES, NOT TWO, and the positive arm tells the first two apart. This read "no
  // permission denial was recorded at all", which points the operator at node-settings.json — and
  // that was the wrong subsystem every time it fired, because the file had loaded fine and the
  // probe had simply taken a route that records nothing.
  // FOUR OUTCOMES, NOT TWO, and lib/decisions.mjs owns which is which. The `!sawDenial` branch had
  // already been taught that "the file had loaded fine and the probe had simply taken a route that
  // records nothing" — and the `!allowWorked` branch one line below still blamed node-settings.json
  // unconditionally, including when a recorded denial proves it loaded. Three of seven lens-bench
  // seeds refused to mint on that message on 2026-09-23 while their own canary artifact recorded
  // two denials apiece.
  failures.push(...sandboxCanaryFailures({ sawDenial, allowWorked }));
  if (failures.length) {
    die(
      `SANDBOX CANARY FAILED:\n` +
        failures.map((f) => `  - ${f}`).join('\n') +
        `\n  Structural validation cannot prove the CLI ACCEPTED these policy files; only this can.\n` +
        `  Refusing to spawn lenses under a policy that may be silently ignored. Run dir: ${runDir}\n` +
        (probe.status === 0 ? '' : `  probe exit ${probe.status}; see sandbox-canary.json for stderr\n`) +
        (overrideNote(runtimeName) ? `  The node runtime is overridden by the contract:${overrideNote(runtimeName)}\n` : ''),
    );
  }
}

// THE MINT'S END, its last act (stage 2): run.json is written before the canaries, so the end is added here, once every
// check has passed. A refused mint never reaches this line and leaves no end, so no record times a mint that failed.
// Best-effort (G-6, G-9 of 20261027-094343-trt-remediation-2-review): the field is telemetry's, so a failed write is a
// note, never a refused mint whose checks all passed.
bestEffort(() => {
  runJson.mint_ended_at = new Date().toISOString();
  mintOwner.replace(['run.json'], `${JSON.stringify(runJson, null, 2)}\n`);
}, (why) => console.error(`new-run: mint_ended_at not recorded (${why})`));

console.log(runId);
// ABSOLUTE when the run is outside the tree, which is now the default. `path.relative` renders that
// as a run of `..` segments -- unreadable, and ambiguous about which directory it even starts from.
// Every downstream tool takes `--run-dir`, so this line is what an operator copies.
console.log(`run dir: ${isWithin(repoRoot, runDir) ? path.relative(repoRoot, runDir) : runDir}`);
console.log(`scope:   ${scope.full_sweep ? `human-asserted ${scope.paths.join(', ')}` : `derived ${scope.paths.join(', ')}`}`);
console.log(`stamps:  ${stamps.length ? stamps.join(', ') : '(none)'}`);
