#!/usr/bin/env node
// findings-ledger.mjs — cross-run memory for findings.
//
// Runs are independent directories, so a defect reported in run after run reads as new every
// time, and nothing records what remediation actually closed. This CLI folds a run's kept
// findings into <reviews_dir>/ledger.json and prints the delta that matters: new, recurring,
// and previously-open entries this run was silent about (reported, never auto-closed — a lens
// that did not look is indistinguishable from a defect that is gone, so only --mark-fixed
// closes an entry).
//
// Decisions live in lib/ledger.mjs, pure and tested. This file is I/O.
//
// NO GRAPH_NODE_DEPTH GUARD: bookkeeping, starts no graph work — same class as capture.mjs
// (disk-first-protocol §8).
//
//   node scripts/findings-ledger.mjs --run-dir <abs>            fold a run in, print the delta
//   node scripts/findings-ledger.mjs --summary [--ledger <p>]   open entries, worst first
//   node scripts/findings-ledger.mjs --summary --stale          the decisions waiting on the operator:
//        stale entries (thresholds: STALE_SILENT_REVIEWS and STALE_DAYS in lib/ledger.mjs), proposed
//        declines, declines a review raised again (T4), claims exit 1 cannot close, notes on closed entries
//   node scripts/findings-ledger.mjs --mark-fixed <key> [--run-dir <abs>] --reason <text>
//        [--disposition fixed_claimed|partial|declined|open|closed|withdraw|reopen]
//        [--operator-quote "<the operator's words>"] [--evidence <path>]
//   node scripts/findings-ledger.mjs --add --file <f> --claim <text> [--line <n>] [--severity <s>] [--found-by <who>]
//        [--onto <key>]   an observation; refused, naming the entry, when it would join a decided one, unless --onto names it
//   node scripts/findings-ledger.mjs --migrate-transitions      the one-time ledger-transitions migration
//   node scripts/findings-ledger.mjs --migrate-identity [--report <p>]   the one-time ledger-identity migration (lists, applies nothing);
//        the report defaults to .claude/requests/ledger-identity.migration-report.md
//
// Who may do what is one table: shared/ledger-transitions.md. In short: an entry leaves the open set only
// by a full fix claim confirmed by a later silent review, or by the OPERATOR's decline or close. Without
// --operator-quote a disposition is an agent's — a claim (fixed_claimed, partial), a deferral (open), a
// proposed decline (declined), a withdrawal (withdraw) — and stays open work. With it, it is the
// operator's — a keep (open), a decline (declined), a close (closed), a rejection of a proposed decline
// (withdraw), a reopen (reopen). An agent never writes words the operator did not say. (G-2 of
// 20260927-224505-ledger-review-r3: this header stated the stale thresholds as literals.)
//
// Exit codes: 0 done · 1 could not read what it needed, or a disposition was refused · 2 usage.

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  mergeRun, sightingsFromReconcile, markFixed, entryNotes, declineReturned, openEntries, convergence, ledgerPathFor, staleEntries, unconfirmedDecisions, STALE_SILENT_REVIEWS, STALE_DAYS,
  isOpen, addObservation, observationTarget, migrateTransitions, migrateIdentity, runIdTime, operatorDecisionsSince, claimsNeedingOperator, unjudgedEntries, observedWhileClosed, redactClaim,
  repoOfLedger,
} from './lib/ledger.mjs';
import { REQUESTS_DIR, resolvedRequestsDir } from './io/project-paths.mjs';
import { writeJsonAtomic, acquireFileLock } from './io/atomic.mjs';
import { repoRunRoots, isSafeRunId, quorateHome, admitRun, callerRepoRoot } from './io/reviews-root.mjs';
import { isWithin, escapesBeforeCreate } from './io/finding-scope.mjs';
import { readNodeStatus, readRunRecord, readReconcileArtifacts } from './io/run-artifacts.mjs';
import { confined } from './io/confined-path.mjs';
import { statusIsReview, SEVERITY_RUNGS } from './lib/decisions.mjs';
import { reviewed as reviewedRun } from './lib/reviewed-run.mjs';
import { readContract } from './io/contract-reader.mjs';
import { runDirsPresent, locateRunDirs } from './io/run-dirs.mjs';
import { gitSync } from './io/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function die(msg, code = 2) {
  console.error(`findings-ledger: ${msg}`);
  process.exit(code);
}

const args = { markFixed: [], disposition: 'fixed_claimed', groups: [] };
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md): a missing
  // value and an unknown flag are refused, naming the flag. --mark-fixed and --group are repeatable.
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['findings-ledger'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  const take = {
    'run-dir': 'runDir', 'repo-root': 'repoRoot', ledger: 'ledger', summary: 'summary', stale: 'stale', 'mark-fixed': 'markFixed',
    disposition: 'disposition', evidence: 'evidence', reason: 'reason', 'operator-quote': 'operatorQuote',
    // The review groups a disposition concerns, as <run>:<G-n> (3b); repeatable.
    group: 'groups',
    // OBSERVED DEFECTS — found by USING the engine rather than by a lens inside a run.
    //
    // The ledger folded findings from a run directory and nothing else, so a defect found by
    // running quorate had nowhere to go but a chat message: the two intermittent suite failures
    // sighted this week lived in prose and in nobody's queue. The operator's rule is that such a
    // bug is "handled as any other bug" — so it enters the SAME store, keyed the same way, and
    // recurs and closes by the same rules. A second backlog would drift from this one.
    //
    // PROVENANCE IS RECORDED, because it changes what the entry is worth: a lens found it while
    // reviewing a declared surface, an observation found it because something broke in front of
    // someone. Neither is stronger, and reading them as the same thing would be a claim nobody made.
    add: 'add', 'migrate-transitions': 'migrateTransitions', 'migrate-identity': 'migrateIdentity',
    report: 'report', file: 'file', severity: 'severity', claim: 'claim', 'found-by': 'foundBy', onto: 'onto',
  };
  for (const [flag, key] of Object.entries(take)) if (v[flag] !== undefined) args[key] = v[flag];
  if (v.line !== undefined) args.line = Number(v.line);
}

const runDir = args.runDir ? path.resolve(args.runDir) : null;

/**
 * WHICH LEDGER a run belongs to, and the fallback that keeps a synthetic run out of a real one.
 *
 * A real run records the repository it reviewed, and that is the authority: with run directories out
 * of the tree, a run's own location says nothing about its project. But a run directory that carries
 * no `repo_root` must NOT be resolved by asking git where we happen to be standing — that reaches
 * the enclosing repository, and the suite mints synthetic run directories in temp folders while
 * standing in this one. It did: a single test run folded fake findings into the real 522-entry
 * ledger. The same class as the suite writing into committed review artifacts (d761329), through a
 * door this change had just opened.
 *
 * So git's answer is only a CANDIDATE, never the authority: a run without `repo_root` folds into the
 * repository the command stands in only when the run sits inside that repository's own reviews folders
 * (the legacy in-tree runs that predate the field), checked on real paths. A synthetic run in a temp
 * folder is refused and told to name its ledger with --ledger. The earlier fallback — the ledger BESIDE
 * the run — skipped that check, and was removed (G-3 of 20260928-024309-ltr-review-r2) and then made
 * to refuse legacy runs too (G-3 and G-1 of 20260928-032057-ltr-review-r3); this is the version of it
 * that keeps both properties.
 */
/**
 * The graph_contract of the repository at `repoRoot`, as new-run resolves it; null when it has none.
 *
 * ONLY "NO CONTRACT" IS NULL (G-2 of 20261013-023310-ledger-identity-remediation-2-review): every failure read as no
 * contract, so a contract that would not resolve searched the staging root of `project=null`, listed real runs as lost,
 * and the migration was stamped done. A contract that exists and cannot be read is refused, as declaredFloor refuses it.
 */
function contractOf(repoRoot, refusal = 'refusing to guess where its runs live') {
  // THE ONE READER (G-1 of 20261013-042240-ledger-identity-remediation-4-review): declaredFloor ran and classified
  // --print-contract itself, so run-root discovery and convergence could come to read one contract two ways.
  // And since ledger-findings.plan.md stage 4, the framework's one reader: "absent" by the exit code new-run gives it, not
  // by matching its message, and read once per invocation however many questions ask it.
  const read = readContract({ repoRoot });
  if (read.absent) return null;
  if (read.error) die(`the contract of ${repoRoot} cannot be read (${String(read.message ?? '').split(/\r?\n/)[0] || read.error}); ${refusal}`, 1);
  return read.contract;
}

// THE RUN MUST BELONG TO THE REPOSITORY WHOSE LEDGER IS WRITTEN — checked on REAL paths (G-2 of
// 20260928-032057-ltr-review-r3): the check was lexical, so a junction or link under the reviews folder
// leading anywhere else passed as one of this repository's runs.
// The run id a fold and a disposition record: the admitted record's run_id, which admitRun holds equal to the directory's
// real name (ARCHITECTURE A-28). It was the --run-dir basename, never compared with the record.
let admittedRunId = null;
// AND THE RECORD AND DIRECTORY ADMITTED, the only ones read after admission (G-19 of 20261023-014400-rdt-delivery): the
// scope a fold confirms fixes by came from a second read of run.json through the path the caller spelled.
let admittedRecord = null;
let admittedDir = null;

function resolveLedgerPath(dir) {
  if (dir) {
    const runJson = path.join(dir, 'run.json');
    // THROUGH THE ONE READER (2a). A run.json THAT DOES NOT PARSE IS REFUSED (G-1 of 20260927-220507-ledger-review-r2):
    // a corrupt file must not decide where the ledger is written. NO RECORD, NO FOLD (G-3 of
    // 20260928-162609-ltr-review-r4): the older-run path below is for a run.json that predates repo_root, not for
    // a directory with no run.json at all — a partial one folded.
    // ADMITTED BEFORE IT IS READ (run-dir-descendants.plan.md stage 3; G-13 of 20261024-122231-rdt-remediation-3-review):
    // the record was read through the caller's spelling first, so a file in a place no run may be was parsed before
    // anything said it was a run. The repository is established, the run admitted, and its record read from the admitted
    // directory only.
    // ADMITTED FOR THE REPOSITORY THIS COMMAND RUNS IN, by the one owner (ARCHITECTURE A-28; run-dir-trust.plan.md stage
    // 3): the ledger a fold writes is that repository's. It was chosen from the repo_root the run's record named, checked
    // against that repository's own reviews folders (G-4 of 20260925-015614-platform-review, G-17); a run under the shared
    // home could still name another tree. A record with no repo_root, which predates the field, folds where this
    // repository keeps its runs (G-3 of 20260928-024309-ltr-review-r2), as before.
    // --repo-root names it; absent, git's toplevel of where this runs (ARCHITECTURE A-28).
    const repo = callerRepoRoot(args.repoRoot);
    if (!repo) die(`this command is not running in a repository, so ${runJson} has no repository to fold into; pass --ledger <path>`, 2);
    const admitted = admitRun({ runDir: dir, repoRoot: repo });
    if (!admitted.ok && admitted.check === 'record' && /ENOENT/.test(admitted.why)) {
      die(`${runJson} does not exist; a directory with no run record is not a run to fold, under --ledger either (ARCHITECTURE A-28)`, 2);
    }
    if (!admitted.ok && admitted.check === 'record') {
      die(`${admitted.why} — not valid JSON as a run record; refusing to fold a run whose record cannot be read`, 2);
    }
    if (!admitted.ok) {
      die(`${admitted.why}${admitted.check === 'repository' ? `; pass --ledger <path> to say which ledger` : ''}`, 2);
    }
    // THROUGH THE ONE READER (2a), from the admitted directory: the record's shape is held as every reader holds it.
    const rec = readRunRecord(admitted.dir);
    if (!rec.ok) die(`${rec.why} — not valid JSON as a run record; refusing to fold a run whose record cannot be read`, 2);
    admittedRunId = admitted.record.run_id;
    admittedRecord = admitted.record;
    admittedDir = admitted.dir;
    return ledgerPathFor(admitted.repoRoot);
  }
  // THE CALLER'S REPOSITORY, OR NONE (run-dir-descendants.plan.md stage 5; G-14 of 20261024-122231-rdt-remediation-3-review;
  // run-dir-trust.design.md R-D1 A): --repo-root, else git's toplevel, else a refusal. The working directory as a
  // fallback put a ledger wherever this happened to run.
  const repo = callerRepoRoot(args.repoRoot);
  if (!repo) die('this is not running in a repository, so there is no ledger to read or write; pass --repo-root or --ledger <path>', 2);
  return ledgerPathFor(repo);
}


// THE LEDGER IS NOT WHERE THE RUNS ARE, and both branches here used to assume it was. Run
// directories now default OUT of the repository under review; the ledger stays in it, tracked,
// because it is this project's cross-run MEMORY rather than one review's working artifacts. Deriving
// it from the run directory or from `review.reviews_dir` would have silently carried the memory out
// of the tree the moment the runs left, and a clone would have started blank.
// UNDER --ledger the operator names the ledger, so the run is read as a run of no repository (noRepository): it is still
// admitted — inside the repository or the engine's home, a readable record, a run_id that is its directory's name — and
// the output says which checks were not made.
if (args.ledger && runDir) {
  const admitted = admitRun({ runDir, repoRoot: callerRepoRoot(args.repoRoot), noRepository: true });
  if (!admitted.ok) die(admitted.why, 2);
  admittedRunId = admitted.record.run_id;
  admittedRecord = admitted.record;
  admittedDir = admitted.dir;
  console.error(`findings-ledger: --ledger names the ledger, so ${admittedRunId} was not checked as one of a repository's runs`);
}
const ledgerPath = args.ledger
  ? path.resolve(args.ledger)
  : resolveLedgerPath(runDir);

function loadLedger() {
  // THROUGH THE OWNER, ROOTED AT THE LEDGER'S FOLDER (usage-report-followup.plan.md stage 3; G-9 of
  // 20261031-055840-urr-remediation-3-review): a raw read followed a link standing at ledger.json, and the parse error
  // quoted the linked file's bytes. A link is refused and named; a parse error names the fault, never the content.
  let text;
  try {
    // THE FOLDER AS NAMED, never its real path (G-8 of 20261102-201017-rbr-remediation-3-review): realpathSync resolved a
    // link or junction at the ledger's folder before the owner's root check could see it. ledgerPath is absolute.
    const owner = confined(path.dirname(ledgerPath));
    const name = path.basename(ledgerPath);
    if (!owner.exists([name])) return { schema_version: 1, entries: {} };
    text = owner.read([name]);
  } catch (e) {
    if (e?.code === 'ENOENT') return { schema_version: 1, entries: {} };
    // THE OWNER'S REASON, not a fixed one: since the owner checks its root (G-10 of 20261102-184751-rbr-remediation-2-review),
    // a refusal is also a folder that is a file, and naming every refusal "a link or junction" said what was not there.
    if (e?.code === 'ECONFINED') die(`ledger at ${ledgerPath} refused, and a ledger is never read through a link or junction: ${e.message}`, 1);
    throw e;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // Fails loudly rather than starting a fresh ledger over a corrupt one — silently zeroing the
    // cross-run memory is the ledger-shaped version of silence as a verdict.
    die(`ledger at ${ledgerPath} did not parse (${e.name}); refusing to overwrite it`, 1);
  }
  // VALID JSON OF THE WRONG SHAPE IS REFUSED THE SAME WAY (G-5 of 20261031-033859-urr-remediation-2-review): `null` was
  // folded over as an empty ledger and rewritten, and a null entry crashed downstream at its fields.
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(parsed) || (parsed.entries !== undefined && !(isObj(parsed.entries) && Object.values(parsed.entries).every(isObj)))) {
    die(`ledger at ${ledgerPath} is not a ledger: an object with an object of entries, each an object; refusing to overwrite it`, 1);
  }
  return parsed;
}

// EVERY WRITE PATH LOCKS BEFORE IT LOADS (G-5 of 20260925-015614-platform-review): two folds each
// loaded the same snapshot and the later save dropped the other run's findings. Released by the save
// (G-4 of 20260928-162609-ltr-review-r4): it was held until exit, through the report printed after it; a
// path that dies before saving still releases on exit.
let releaseLock = null;
function lockLedger() {
  // A REPOSITORY'S LEDGER IS WRITTEN INSIDE IT (G-2 of 20261013-042240-ledger-identity-remediation-4-review): the path is
  // lexical, so a `.claude` link in the repository sent the lock and the save into whatever it led to. Checked on what
  // the filesystem will resolve, before the lock — the first write.
  const repo = ledgerRepo();
  if (repo && escapesBeforeCreate(repo, ledgerPath)) {
    die(`the ledger ${ledgerPath} leads out of ${repo} through a link; refusing to write a repository's ledger anywhere else`, 1);
  }
  releaseLock = acquireFileLock(`${ledgerPath}.lock`);
}

function saveLedger(ledger) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  // writeJsonAtomic (lib/atomic.mjs) is the ONE owner of durable-write semantics. This hand-rolled
  // tmp+fsync+rename was correct, but a correct duplicate still drifts — globDirPrefix had three
  // owners and two disagreed (G-9). One home.
  writeJsonAtomic(ledgerPath, ledger);
  releaseLock?.();
  releaseLock = null;
}

/**
 * The convergence floor, from the contract (G-13).
 *
 * I-10 requires the ledger to report whether a cycle introduced anything at or above a DECLARED
 * floor, and names "the severity floor hardcoded rather than declared" as its failure mode. It was
 * the literal 'HIGH' at the one call site, so a project wanting to drain to MEDIUM had to patch the
 * engine. `review.convergence_floor` in the graph_contract now names it; HIGH remains the default,
 * so nothing changes for a project that says nothing.
 */
function declaredFloor() {
  // ONE LADDER (G-5 of 20260928-162609-ltr-review-r4): SEVERITY_RUNGS is its owner, not a local copy.
  const SEV = SEVERITY_RUNGS;
  // NEVER SILENTLY HIGH (G-3 of 20260928-171758-ltr-review-r5; operator: "G-3 fix"). Every failure here returned
  // HIGH, so a project that declared MEDIUM could be told DRAINED with MEDIUMs open. Now: no contract at all keeps
  // the documented default; a contract that cannot be resolved, or a floor that is not a severity, is refused.
  // Read through contractOf, the one reader (G-1 of 20261013-042240-ledger-identity-remediation-4-review).
  // The caller's repository's contract (stage 5, G-14): the working directory named it before.
  const floorRepo = callerRepoRoot(args.repoRoot);
  // Under --ledger with no repository there is no contract to declare a floor: the documented default, as a missing
  // contract always gave. Without --ledger there is no ledger to report on either, and resolveLedgerPath refused already.
  if (!floorRepo && args.ledger) return 'HIGH';
  if (!floorRepo) die('this is not running in a repository, so the convergence floor is unknown; pass --repo-root', 1);
  const contract = contractOf(floorRepo, 'the convergence floor is unknown; refusing to report whether the ledger is drained');
  if (contract === null) return 'HIGH';
  const raw = contract?.review?.convergence_floor;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 'HIGH';
  const declared = String(raw).trim().toUpperCase();
  if (!SEV.includes(declared)) {
    die(`review.convergence_floor is ${JSON.stringify(raw)}, not one of ${SEV.join('|')}; refusing to guess the floor`, 1);
  }
  return declared;
}

/** The repository this ledger is the memory of, read through the owner of its location (G-1); null otherwise. */
function ledgerRepo() {
  const repo = repoOfLedger(path.resolve(ledgerPath));
  return repo ? path.resolve(repo) : null;
}

/**
 * WHERE THIS LEDGER'S RUNS ARE (G-4 and G-2 of 20261013-000416-ledger-identity-review). The ledger is located from the
 * repository precisely so that it is NOT tied to where runs live, yet the migration and the unfolded-run check both
 * looked only beside it — and an unconfigured repository's runs are staged under quorate's home. A repository's ledger
 * reads every place that repository keeps runs, by the list `runBelongsToRepo` checks against; a ledger named anywhere
 * else has only its siblings.
 */
function runRoots() {
  const roots = [path.dirname(path.resolve(ledgerPath))];
  const repo = ledgerRepo();
  if (repo) {
    let real = repo;
    try { real = fs.realpathSync.native(repo); } catch { /* not there: its own folder is all there is */ }
    const own = contractOf(real);
    roots.push(...repoRunRoots({ repoRoot: real, project: own?.project ?? null, home: quorateHome(), declaredReviewsDir: own?.review?.reviews_dir || null }));
  }
  return [...new Set(roots.map((r) => path.resolve(r)))];
}

// The run directories present where this ledger's runs live: scripts/io/run-dirs.mjs owns the listing (ledger-findings
// stage 5), which skips the runs already folded before it reads anything.

// ------------------------------------------------------------------------------ observed defect
// A defect found by USING the engine, folded into the same store by the same merge, so it buckets,
// recurs and closes exactly as a lens-reported one does. `run_id` records where it came from instead
// of naming a run that does not exist — an entry claiming a run id nobody can open would be worse
// than no provenance at all.
if (args.add) {
  if (!args.file || !args.claim) {
    die('--add needs at least --file and --claim; --line, --severity, --found-by and --onto are optional');
  }
  const SEVERITIES = [...SEVERITY_RUNGS].reverse();
  const severity = args.severity ?? 'MEDIUM';
  if (!SEVERITIES.includes(severity)) die(`--severity must be one of ${SEVERITIES.join('|')}`);
  const foundBy = args.foundBy ?? 'observed';
  const at = new Date();
  // UNIQUE PER OBSERVATION, and this was a data-loss bug before it was a naming choice. mergeRun
  // treats `prior.last_seen === run_id` as re-folding the SAME run — idempotent bookkeeping that
  // deliberately neither increments times_seen nor reports a delta (G-18). With a date-based id, the
  // second observation of one defect on one day hit that branch and vanished: no sighting recorded, no
  // claim updated, and a report that said "(unchanged)" to someone who had just filed a bug. The
  // timestamp carries seconds and a short digest of the claim, so two observations are two runs — except two of one
  // file and claim in one second, which share an id (G-6 of 20261102-173413-rbr-remediation-review). Nothing is lost
  // then: --add goes through addObservation, which appends every note whatever its run_id and never reads it as a
  // re-fold; the id is only the new entry's first_seen and last_seen.
  const stamp = at.toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const digest = crypto.createHash('sha256').update(`${args.file}|${args.claim}`).digest('hex').slice(0, 6);
  const runId = `observed-${stamp}-${digest}`;
  lockLedger();
  const ledger = loadLedger();
  // A NOTE DOES NOT VANISH INTO A DECIDED ENTRY (observation-guard-and-sibling-census.md, A): refused before anything is
  // written, naming the entry, unless --onto names it — the same append, made as a decision rather than by accident.
  const target = observationTarget(ledger, { file: args.file, line: Number.isFinite(args.line) ? args.line : 0 });
  if (args.onto !== undefined && args.onto !== target.key) {
    die(`--onto ${args.onto} is not where this note lands: it resolves to ${target.key}${target.entry ? '' : ' (a new entry)'}`, 1);
  }
  if (target.decided && args.onto !== target.key) {
    const e = target.entry;
    die(`this note would join ${target.key}, and ${target.decided}: ${e.severity} ${e.file}:${e.line} — ${String(e.claim ?? '').slice(0, 160)}\n`
      + `  Nothing was written. Re-anchor the note on a line that resolves to no decided entry, or attach it to this one on `
      + `purpose with --onto ${target.key}.`, 1);
  }
  // AN OBSERVATION, NOT A FOLD (ledger-transitions T8, T8b). This went through mergeRun, which treated a
  // hand-filed note as a review's sighting: it voided claims, cleared silences, reopened closed entries,
  // made its author a raising lens and appended its id to runs_folded — so an agent could add, claim and
  // let the next silent review close an entry it had just reset. addObservation changes none of that.
  const next = addObservation(ledger, {
    file: args.file,
    line: Number.isFinite(args.line) ? args.line : 0,
    severity,
    claim: args.claim,
    found_by: foundBy,
    at: at.toISOString(),
    run_id: runId,
  });
  saveLedger(next);
  // REPORTED FROM THE LEDGER: which entry holds the note, and whether it opened it.
  const before = new Set(Object.keys(ledger.entries ?? {}));
  // THE ENTRY THE NOTE WAS RESOLVED TO (G-7 of 20261102-220302-rbr-remediation-5-review): it was found again by its
  // timestamp and finder, which an earlier note of the same finder in the same millisecond also matches.
  const touched = next.entries[target.key];
  const state = touched && !before.has(touched.key) ? 'opened' : (touched && !isOpen(touched) ? 'noted on the CLOSED entry' : 'noted on');
  console.log(`findings-ledger: ${state} ${touched?.key ?? '(no entry)'}`
    + ` — ${severity} ${args.file}${Number.isFinite(args.line) ? `:${args.line}` : ''} [${foundBy}]`);
  // WHAT WAS STORED, NOT WHAT WAS TYPED (G-7 of 20260928-162609-ltr-review-r4): the redacted claim went to the
  // ledger and the raw one to stdout, which is where terminal and CI logs keep it.
  console.log(`  ${redactClaim(args.claim).slice(0, 160)}`);
  process.exit(0);
}

// ------------------------------------------------------------------------------------ stale
// NOTHING LEAVES THE OPEN SET WITHOUT A DECISION (operator, 2026-09-27: "go with the design, 2 reviews
// or 14 days"). Silence no longer closes an unclaimed entry; an entry that has gone quiet is SHOWN here,
// with what the operator can do about it. Printed after every fold and by --summary --stale.
// EVERYTHING WAITING ON THE OPERATOR (shared/ledger-transitions.md). Printed after every fold and by
// --summary --stale. Each entry appears in ONE list, the most specific that applies, so a proposed
// decline that has also gone stale is not shown twice. `decisions` is the list of the operator's
// decisions since the previous fold — computed by the caller BEFORE the fold moves the window.
function printStale(ledger, { decisions = null, closedNotes = observedWhileClosed(ledger) } = {}) {
  let shown = 0;
  const listed = new Set();
  const section = (title, rows, render, hints) => {
    if (!rows.length) return;
    console.log(`\n${title} (${rows.length}):`);
    for (const r of rows) { render(r); if (r.key) listed.add(r.key); }
    for (const h of hints) console.log(`  ${h}`);
    shown += rows.length;
  };
  const line = (e, text) => console.log(`  ${String(e.severity ?? '').padEnd(7)} ${e.key} — ${String(text ?? '').slice(0, 110)}`);
  const QUOTE = '--operator-quote "<their words>"';

  // A decline an agent proposed is open work until the operator's words confirm it (G-12, G-17).
  section('declined, awaiting the operator — a decline nobody confirmed', unconfirmedDecisions(ledger), (e) => line(e, e.reason ?? '(no reason)'), [
    `confirm:   --mark-fixed <key> --disposition declined --reason "<why>" ${QUOTE}`,
    `reject:    --mark-fixed <key> --disposition withdraw --reason "<why>" ${QUOTE}   (back to the status it had)`,
  ]);
  // "third otherwise": a declined finding a review raised again at a HIGHER severity than it was declined at.
  // And, since ledger-identity stage 1b, one raised again at the same or a lower severity (`raised_again`): only a
  // rise is labelled worse.
  section('declined, but raised again — re-confirm or reopen',
    // ONE LINE SHAPE (I-12; G-3 of 20261013-000416-ledger-identity-review): a rise read "came back worse at Y" instead of
    // "raised again at Y" with "came back worse" added.
    Object.values(ledger.entries ?? {}).filter(declineReturned), (e) => line(e,
      `declined at ${e.declined_severity}, raised again at ${e.severity_rose ? e.severity : (e.sightings?.at(-1)?.severity ?? e.severity)}`
      + `${e.severity_rose ? ', came back worse' : ''}: ${String(e.claim ?? '').slice(0, 60)}`), [
      `re-confirm: --mark-fixed <key> --disposition declined --reason "<why>" ${QUOTE}`,
      `reopen:     --mark-fixed <key> --disposition reopen --reason "<why>" ${QUOTE}`,
    ]);
  // A claim exit 1 cannot close: made on an entry already silent, or with no raising review lens.
  section('claims only the operator can close', claimsNeedingOperator(ledger).filter((e) => !listed.has(e.key)), (e) => line(e, e.claim), [
    `close:  --mark-fixed <key> --disposition closed --reason "<why>" ${QUOTE}`,
    `keep:   --mark-fixed <key> --disposition open --reason "<why>" ${QUOTE}`,
  ]);
  // An entry no review judged: the reconciler left its group out (reconcile-missing-groups.plan.md stage 2), so its
  // severity is its findings' own, and nobody has said whether it is real.
  section('unjudged — the reconciler left these out; the next review of the file judges them, or you do',
    unjudgedEntries(ledger).filter((e) => !listed.has(e.key)), (e) => line(e, e.claim), [
      `close:  --mark-fixed <key> --disposition closed --reason "<why>" ${QUOTE}`,
      `keep:   --mark-fixed <key> --disposition open --reason "<why>" ${QUOTE}`,
    ]);
  const stale = staleEntries(ledger, { now: Date.now() }).filter((e) => !listed.has(e.key));
  section(`stale — silent in ${STALE_SILENT_REVIEWS} reviews, or ${STALE_DAYS} days since last raised or kept; decide each`, stale, (e) => {
    line(e, e.claim);
    console.log(`          ${e.stale_because}`);
  }, [
    'handle it: leave it open for the next remediation',
    `close it:  --mark-fixed <key> --disposition closed --reason "<why>" ${QUOTE}`,
    `keep it:   --mark-fixed <key> --disposition open --reason "<why>" ${QUOTE}   (restarts both clocks)`,
  ]);
  // An agent's observation on a finding that is closed: a note, never a reopen (T8b).
  section('observed while closed — notes by an agent on a decided entry', closedNotes, (o) => console.log(`  ${o.key} — [${o.found_by}] ${String(o.claim).slice(0, 110)}`), [
    `reopen: --mark-fixed <key> --disposition reopen --reason "<why>" ${QUOTE}`,
  ]);
  // The operator's decisions recorded since the previous fold — how they see every decision made in their name.
  if (decisions) {
    section('the operator\'s decisions since the previous fold — check each is yours', decisions,
      (d) => console.log(`  ${d.transition} ${d.key} — "${String(d.quote ?? '').slice(0, 80)}" (${d.at})`), []);
  }
  return shown;
}

// ---------------------------------------------------------------------------------- summary
if (args.summary && args.stale) {
  // With the operator's decisions since the last fold (G-1 of 20260928-004954-ledger-transitions-review):
  // QUORATE.md names this as where to look, and it never showed them.
  const staleLedger = loadLedger();
  if (!printStale(staleLedger, { decisions: operatorDecisionsSince(staleLedger) })) console.log('findings-ledger: nothing stale');
  process.exit(0);
}
if (args.summary) {
  // LOADED ONCE (G-5 of 20260927-220507-ledger-review-r2, perf-audit and a codex arm): this reread and
  // reparsed the whole ledger in each section, and once PER RUN DIRECTORY in the unfolded check below.
  const summaryLedger = loadLedger();
  const open = openEntries(summaryLedger);
  // NO EARLY EXIT (G-4 of 20260927-211023-ledger-review): this exited here when nothing was open, before
  // the decisions below — so a ledger holding only declined and closed entries showed none of them.
  if (!open.length) console.log('findings-ledger: no open entries');
  for (const e of open) {
    console.log(`${e.severity.padEnd(7)} ${e.status.padEnd(8)} x${e.times_seen}  ${e.key}`);
    console.log(`        ${e.claim}`);
    for (const n of entryNotes(e)) console.log(`        ${n}`);
    console.log(`        first ${e.first_seen} · last ${e.last_seen} · ${(e.nodes ?? []).join(', ')}`);
  }
  // DECISIONS ARE SHOWN, NOT ONLY STORED (G-12, arch-review). `declined` carries a mandatory reason
  // because conflating a decision with a failed attempt "loses the reason nobody will re-derive" —
  // and it was write-only: openEntries deliberately excludes `declined`, the fold report never
  // labels it, so no invocation of this tool ever showed that a group was declined or why. The
  // reason survived on disk and was reachable only by opening ledger.json by hand, which is the half
  // of the fix that makes a decision usable by a later reader.
  const declined = Object.values(summaryLedger.entries ?? {}).filter((e) => e.status === 'declined');
  if (declined.length) {
    console.log(`
declined (${declined.length}) — decisions, not omissions:`);
    for (const e of declined) {
      console.log(`${e.severity.padEnd(7)} declined x${e.times_seen}  ${e.key}`);
      console.log(`        ${e.reason ?? '(no reason recorded — a decline without one is an omission)'}`);
    }
  }
  // AND CLOSED ONES (G-5 of 20260927-211023-ledger-review): an operator's explicit close of a stale entry
  // carries a mandatory reason too, and was write-only exactly as `declined` had been.
  const closedByOperator = Object.values(summaryLedger.entries ?? {}).filter((e) => e.status === 'closed');
  if (closedByOperator.length) {
    console.log(`
closed (${closedByOperator.length}) — closed by the operator, with the reason:`);
    for (const e of closedByOperator) {
      console.log(`${e.severity.padEnd(7)} closed   x${e.times_seen}  ${e.key}`);
      console.log(`        ${e.reason ?? '(no reason recorded)'}`);
    }
  }

  // THE FLOOR IS DECLARED, NOT A LITERAL (G-13, contract-audit against I-10, which names "the
  // severity floor hardcoded rather than declared" as its failure mode verbatim). A consuming
  // project wanting to drain to MEDIUM had to patch the framework.
  const floor = declaredFloor();
  const c = convergence(summaryLedger, { floor });
  // WHICH RUNS THIS ANSWER COVERS (G-14, arch-review). `drained` is the loop's stop signal, and
  // nothing folds a run in automatically — not run-graph, not new-run, not either git hook — so the
  // fold happens only when someone runs `--run-dir` by hand. An operator who ran five cycles and
  // folded one is told DRAINED because four cycles were never recorded: cross-run silence read as a
  // verdict, which is the single rule this store exists to enforce.
  //
  // The ledger already records `runs_folded`; nothing compared it against the run directories on
  // disk. That comparison is the whole check.
  const folded = new Set(summaryLedger.runs_folded ?? []);
  const present = runDirsPresent(runRoots(), { skip: folded });
  if (present.error) die(`${present.error}; refusing to report which runs are folded`, 1);
  const unfolded = present.names;
  // ASKED BEFORE DRAINED IS SAID (G-8 of 20261015-230146-archive-fold-remediation-review): the positive signal printed
  // first and the warning after it did not retract it, so a ledger that had never heard of a run was still DRAINED.
  console.log(
    `\nopen: ${c.by_severity.BLOCKER} BLOCKER, ${c.by_severity.HIGH} HIGH, ` +
    `${c.by_severity.MEDIUM} MEDIUM, ${c.by_severity.LOW} LOW`,
  );
  console.log(
    c.drained && unfolded.length
      ? `no open finding at/above ${c.floor} in the runs folded — NOT DRAINED: ${unfolded.length} run(s) below were never folded`
      : c.drained
        ? `no open finding at/above ${c.floor} — this cycle is DRAINED (two consecutive is the recommended stop)`
        : `${c.open_above_floor} open at/above ${c.floor}; ${c.new_above_floor_this_run} introduced by the newest run (${c.newest_run ?? 'n/a'})`,
  );
  if (unfolded.length) {
    console.log(
      `
WARNING: ${unfolded.length} run(s) where this ledger's runs live `
      + 'have never been folded into this ledger, so the counts above do not cover them: '
      + `${unfolded.slice(0, 5).join(', ')}${unfolded.length > 5 ? `, +${unfolded.length - 5} more` : ''}`,
    );
    console.log('  fold each with --run-dir <dir> before trusting DRAINED — absence from this store '
      + 'is not absence from the tree.');
  }
  if (present.ungrouped.length) {
    console.log(`  ${present.ungrouped.length} run(s) have no finding-groups.json (a remediation, or a review that ended `
      + `before its barrier), so there is nothing to fold: ${present.ungrouped.slice(0, 5).join(', ')}`
      + `${present.ungrouped.length > 5 ? `, +${present.ungrouped.length - 5} more` : ''}`);
  }
  // G-18, G-5 of 20260928-004954-ledger-transitions-review: bare --mark-fixed records an agent's CLAIM, not a
  // close; a close is the operator's, with their words.
  console.log('claim a fix:  --mark-fixed <key> --evidence <green capture> --reason "<why>"   (closes when a later review is silent)');
  console.log('close one:    --mark-fixed <key> --disposition closed --reason "<why>" --operator-quote "<their words>"');
  process.exit(0);
}

// -------------------------------------------------------------------------------- mark fixed
if (args.markFixed.length) {
  const at = new Date().toISOString();
  // A DISPOSITION WITHOUT A RUN IS DATED AND UNIQUE (ledger-trust-boundaries 3b): the bare `(manual)` gave every
  // such deferral one shared, dateless id, so neither the stay rule nor a match by run could tell two apart. The
  // leading `(` keeps it out of the newest-review-cycle comparison (isCycle; G-19 of ledger-review).
  const runId = runDir ? (admittedRunId ?? path.basename(runDir)) : `(manual ${at})`;
  let result;
  lockLedger();
  try {
    result = markFixed(loadLedger(), args.markFixed, runId, {
      groups: args.groups,
      disposition: args.disposition,
      evidence_path: args.evidence ?? null,
      reason: args.reason ?? null,
      // The operator's own words: a close requires them, and a decline without them stays unconfirmed.
      operator_quote: args.operatorQuote ?? null,
      // When it was kept: a kept entry's stale clock starts again here.
      at,
    });
  } catch (e) {
    die(e.message);
  }
  const { ledger, missing, refused } = result;
  if (missing.length) die(`no such entr${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')}`, 1);
  // A REFUSAL WRITES NOTHING (G-5 of 20261102-211111-rbr-remediation-4-review): markFixed applied nothing, but the save
  // still rewrote ledger.json before the refusal's exit, where a refused disposition leaves the ledger unchanged.
  if (!refused.length) saveLedger(ledger);
  // ALL OR NOTHING, in what is printed too: markFixed applies no key when any is refused, so nothing here
  // may say a key was recorded (found claim-checking the G-6 remediation).
  const done = refused.length ? [] : args.markFixed;
  if (refused.length) console.error(`findings-ledger: nothing recorded — ${refused.length} of ${args.markFixed.length} key(s) refused, so none was applied`);
  // Who acted, by the rule markFixed applies (G-6(b)): the operator's words, trimmed; a claim is never theirs.
  const who = String(args.operatorQuote ?? '').trim() && !['fixed_claimed', 'partial'].includes(args.disposition) ? 'the operator\'s' : 'an agent\'s';
  if (done.length) {
    console.log(`findings-ledger: recorded ${who} ${args.disposition}: ${done.join(', ')}` +
      (args.evidence ? ` (evidence ${args.evidence})` : ''));
  }
  if (done.length && (args.disposition === 'fixed_claimed' || args.disposition === 'partial')) {
    // Said out loud, because the whole point is that the operator does not mistake the claim for
    // the confirmation. The entry is still open work until a run covering that file is silent on it.
    console.log('        still OPEN until a later run reviews that file and does not report it');
    const flagged = done.filter((k) => ledger.entries[k]?.needs_operator);
    if (flagged.length) console.log(`        exit 1 is closed to ${flagged.join(', ')} (already silent, or no raising review lens): only the operator can close it`);
  }
  // REFUSED, each with why (shared/ledger-transitions.md): an agent move on a decided entry, a move that
  // would change nothing, an operator move on a decided entry that must be reopened first.
  for (const r of refused) console.error(`findings-ledger: refused ${args.disposition} on ${r.key} — ${r.why}`);
  process.exit(refused.length ? 1 : 0);
}

// ------------------------------------------------------------------------- one-time migration
if (args.migrateTransitions) {
  lockLedger();
  const { ledger, report } = migrateTransitions(loadLedger());
  saveLedger(ledger);
  console.log(`findings-ledger: ledger-transitions migration — ${report.changed} entr${report.changed === 1 ? 'y' : 'ies'} changed`);
  for (const [k, v] of Object.entries(report)) if (k !== 'changed') console.log(`  ${k.padEnd(16)} ${v}`);
  const legacyUnquoted = Object.values(ledger.entries).filter((e) => e.status === 'closed' && e.legacy);
  if (legacyUnquoted.length) {
    console.log(`\ncloses with no operator words, labelled legacy (${legacyUnquoted.length}) — confirm or reopen each:`);
    for (const e of legacyUnquoted) console.log(`  ${e.key} — ${String(e.reason ?? e.claim ?? '').slice(0, 110)}`);
  }
  process.exit(0);
}

// ------------------------------------------------------------------------- one-time migration: ledger identity
// Plan stage 6 (ledger-identity.plan.md): forward-only, with a recheck that LISTS and never applies. Each folded run is
// looked for wherever this ledger's runs live (runRoots); its reconcile artifacts are read through the one reader, and a
// run that lost them, or that cannot be read, is counted, never guessed at. A partially judged run counts only its
// judged groups.
const MIGRATION_REPORT_HEADING = '# ledger-identity migration report\n';
/** Is the file at `p` a migration report a failed attempt left — a plain file, not a link, opening with its heading? */
function priorAttemptReport(p) {
  try {
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.isSymbolicLink()) return false;
    return fs.readFileSync(p, 'utf8').startsWith(MIGRATION_REPORT_HEADING);
  } catch { return false; }
}

if (args.migrateIdentity) {
  // THE REPORT STAYS OUT OF THE PUBLIC MIRROR (G-6 of 20261013-000416-ledger-identity-review): any --report path was
  // created and overwritten, so the listing could land in a mirrored path, or over the ledger itself. I-17 names
  // .claude/requests/ledger-identity.migration-report.md, and that is the default; a path named must sit in the ledger's
  // own folder or, for a repository's ledger, the `requests` folder beside it — both outside the mirror (ROADMAP D2, D4).
  const ledgerDir = path.dirname(path.resolve(ledgerPath));
  // The requests folder from its owner (G-4 of 20261013-023310-ledger-identity-remediation-2-review), not the ledger's
  // path plus a literal; only a repository's ledger has one. RESOLVED BY THAT OWNER TOO (G-3 of
  // 20261013-042240-ledger-identity-remediation-4-review): a join of REQUESTS_DIR was a second answer to where the
  // requests folder is, beside resolvedRequestsDir's; null there is a folder leading out of the repository.
  const requestsDir = ledgerRepo() ? resolvedRequestsDir(ledgerRepo(), { mustExist: false }) : null;
  if (ledgerRepo() && !requestsDir) die(`${path.join(ledgerRepo(), REQUESTS_DIR)} cannot be resolved inside ${ledgerRepo()}; refusing to write the report through it`, 1);
  const allowed = ledgerRepo() ? [ledgerDir, requestsDir] : [ledgerDir];
  const report = args.report ? path.resolve(args.report) : (ledgerRepo() ? path.join(requestsDir, 'ledger-identity.migration-report.md') : null);
  if (!report) die('--migrate-identity needs --report <path> for a ledger outside a repository\'s .claude/reviews/ (the report goes beside the ledger)');
  if (!allowed.some((r) => isWithin(r, report)) || [ledgerPath, `${ledgerPath}.lock`].some((p) => path.resolve(p) === report)) {
    die(`--report ${report} must be a new file in ${allowed.join(' or ')}, not the ledger: the report lists entries, runs and claims, and stays out of the public mirror`);
  }
  // THE RUNS ARE READ BEFORE THE LOCK (G-4 of 20261013-042240-ledger-identity-remediation-4-review): it was held through
  // every historical run's artifact I/O, so its hold time grew with the backlog and other ledger writers waited on it or
  // timed out. The ledger is read again under the lock, and a fold that landed in between is refused, not merged over.
  const unlocked = loadLedger();
  const roots = runRoots();
  const runs = [];
  const lost = [];
  const unreadable = [];
  // Each root LISTED once (ledger-findings stage 5): two existence probes per run per root became a set lookup, with a
  // run.json probe only for an id present in two roots.
  // A root that cannot be listed is refused here, before the lock and the stamp (G-13 of 20261014-181622-lf-delivery):
  // read as empty, it reported every folded run under it as lost and the stamp stopped the migration being run again.
  const located = locateRunDirs(roots, (unlocked.runs_folded ?? []).filter((id) => isSafeRunId(id)));
  if (located.error) die(`${located.error}; nothing was migrated`, 1);
  for (const id of unlocked.runs_folded ?? []) {
    if (String(id).startsWith('observed-') || runIdTime(id) === null) continue;
    // A run id, never a path (G-4's traversal facet): an id is joined beneath a reviews folder only when it is one.
    if (!isSafeRunId(id)) { unreadable.push(`${id} (not a run id)`); continue; }
    const dir = located.dirs.get(id);
    if (!dir) { lost.push(id); continue; }
    // ADMITTED BEFORE IT IS READ (G-9 of 20261030-010649-rdr-remediation-5-review): the directory was found by name, so a
    // link bearing a recorded run id became the root of the reader and supplied another tree's reconciliation. A run is
    // admitted as the fold admits one (ARCHITECTURE A-28), and read from the directory admission returns.
    // A ledger outside a repository has only its own folder for runs (runRoots), which the operator chose by naming the
    // ledger: the same owner admits a run there, with that folder as the only place it may be and no repository
    // (noRepository), not a second routine with a subset of its checks (G-7 of 20261030-024618-rdr-remediation-6-review).
    // NO HOME (G-7 of 20261030-033642-rdr-remediation-7-review): the io re-export fills the engine's home in, and
    // containment admits a run there too, so a junction beside a ledger kept under the home led to another project's run.
    // An empty home is no container, which leaves the ledger's folder the only one.
    const admitted = ledgerRepo() ? admitRun({ runDir: dir, repoRoot: ledgerRepo() })
      : admitRun({ runDir: dir, repoRoot: ledgerDir, home: '', noRepository: true });
    if (!admitted.ok) { unreadable.push(`${id} (not admitted: ${admitted.why})`); continue; }
    if (admitted.record?.run_id !== id) { unreadable.push(`${id} (not admitted: its run.json records ${JSON.stringify(admitted.record?.run_id)})`); continue; }
    const art = readReconcileArtifacts(admitted.dir);
    if (Object.keys(art.refused).length || !art.groups) { unreadable.push(`${id} (${Object.values(art.refused)[0] ?? 'no finding-groups.json'})`); continue; }
    const judged = new Set((art.payload?.groups ?? []).map((p) => p?.group_id));
    const kept = art.groups.groups.filter((g) => judged.has(g?.group_id));
    const partial = kept.length < art.groups.groups.length && kept.length > 0;
    if (art.groups.groups.length && !kept.length) { unreadable.push(`${id} (no payload judged its groups)`); continue; }
    const read = sightingsFromReconcile(id, { groups: { ...art.groups, groups: kept }, payload: art.payload });
    if (!read.ok) { unreadable.push(`${id} (${read.why})`); continue; }
    runs.push({ run_id: id, sightings: read.sightings, partial });
  }
  lockLedger();
  const before = loadLedger();
  if (JSON.stringify(before.runs_folded ?? []) !== JSON.stringify(unlocked.runs_folded ?? [])) {
    die('the ledger folded a run while the migration was reading its runs; nothing was migrated, so run it again', 1);
  }
  const m = migrateIdentity(before, { at: new Date().toISOString(), runs });
  if (!m.ok) die(m.why, 1);
  const { listed, skipped, partial } = m.report;
  const md = [
    MIGRATION_REPORT_HEADING.trimEnd(),
    '',
    `Migrated at ${m.ledger.identity_migrated_at}: ${Object.keys(m.ledger.entries).length} entries, ${runs.length} runs rechecked.`,
    'Nothing below was applied. Each line is a reconciled group a past run confirmed, attributed to an entry by the',
    "entry's CURRENT key and line; a key or line that moved since that run can attribute it to an unrelated entry.",
    'Act with existing transitions only: reopen a declined or closed entry you confirm',
    '(`--mark-fixed <key> --disposition reopen --reason "<why>" --operator-quote "<your words>"`). An entry already',
    'open needs no action: its severity is undercounted until its next sighting.',
    '',
    `## Listed (${listed.length})`,
    '',
    ...listed.map((l) => `- \`${l.key}\` ${l.kind === 'rise' ? `RISE ${l.held} -> ${l.severity}` : `raised again at ${l.severity} (declined at ${l.held})`} — ${l.run_id} ${l.group_id} (anchor: ${l.anchor}): ${String(l.claim ?? '').slice(0, 200)}`),
    '',
    `## Skipped entries, no anchor (${skipped.length})`,
    '',
    ...skipped.map((s) => `- \`${s.key}\` — ${s.why}`),
    '',
    `## Partially judged runs, judged groups only (${partial.length})`,
    '',
    ...partial.map((id) => `- ${id}`),
    '',
    `## Runs not rechecked (${lost.length + unreadable.length})`,
    '',
    ...lost.map((id) => `- ${id} — its directory is gone`),
    ...unreadable.map((s) => `- ${s}`),
    '',
  ].join('\n');
  // THE REPORT FIRST, THE LEDGER AFTER (G-5 of 20261013-000416-ledger-identity-review): the ledger was saved migrated
  // before the report was written, so a failed write lost the recheck for good — a second migration is refused. Now a
  // failed write leaves the ledger as it was, and the migration can simply be run again.
  const container = allowed.find((r) => isWithin(r, report));
  try {
    // Through a link out of its folder is outside it too, checked on what the filesystem will resolve — against the
    // FOLDER that allowed it (G-7 of 20261013-023310-ledger-identity-remediation-2-review): anchored at its parent, a
    // link in .claude/reviews leading to a sibling under .claude passed. The folder is made first, so the check has a
    // real path to anchor at; the folder itself may not lead out of its own parent.
    if (escapesBeforeCreate(path.dirname(container), container)) throw new Error(`${container} leads out of ${path.dirname(container)} through a link`);
    fs.mkdirSync(container, { recursive: true });
    if (escapesBeforeCreate(container, report)) throw new Error(`it leads out of ${container} through a link`);
    fs.mkdirSync(path.dirname(report), { recursive: true });
    // A NEW FILE, as the refusal above says (G-7): writeFileSync truncated an existing one, such as an archived run.json.
    // `wx` also refuses a link at the name.
    try { fs.writeFileSync(report, md, { flag: 'wx' }); } catch (e) {
      // EXCEPT A FAILED ATTEMPT'S OWN REPORT (G-5 of 20261013-042240-ledger-identity-remediation-4-review): the report is
      // written before the ledger is saved, so a save that failed or a crash between the two left one, and every retry
      // died on EEXIST under a message saying "run it again". The ledger is not migrated (migrateIdentity refuses a
      // second migration), so a report there is that attempt's: a plain file carrying this report's heading is replaced.
      // Anything else at the name is still refused.
      if (e.code !== 'EEXIST' || !priorAttemptReport(report)) throw e;
      fs.unlinkSync(report);
      fs.writeFileSync(report, md, { flag: 'wx' });
    }
  } catch (e) {
    die(`the report could not be written to ${report} (${e.code ?? e.message}); the ledger is NOT migrated — `
      + 'remove or move what is at that path, or name another with --report, and run it again', 1);
  }
  try { saveLedger(m.ledger); } catch (e) {
    // The report goes with the failed save, so the retry this message asks for starts clean.
    try { fs.unlinkSync(report); } catch { /* the retry recognises it as this attempt's report */ }
    die(`the ledger could not be saved (${e.code ?? e.message}); it is NOT migrated, so run it again`, 1);
  }
  console.log(`findings-ledger: ledger-identity migration — ${listed.length} listed, ${skipped.length} entries skipped, `
    + `${runs.length} runs rechecked, ${lost.length + unreadable.length} not; report at ${report}`);
  process.exit(0);
}

// ------------------------------------------------------------------------------------ ingest
if (!runDir) die('one of --run-dir, --summary, --mark-fixed, --add, --migrate-transitions or --migrate-identity is required');
// THE ADMITTED DIRECTORY ONLY (G-8 of 20261102-220302-rbr-remediation-5-review): an existsSync on the caller's spelling
// ran after admission and gave that path authority over control flow; admission already established the directory.
if (!admittedDir) die(`${runDir} was not admitted; refusing to fold it (ARCHITECTURE A-28)`, 2);

// WHAT THE GATE CONFIRMED, AT THE SEVERITY IT CONFIRMED (ledger-identity plan, stage 5). The fold read each OK node's
// kept findings at the node's severity, so a reconciler-raised HIGH whose raising node said MEDIUM landed as MEDIUM in
// an unrelated declined entry and stayed hidden (2026-10-12). It now reads the reconciled groups — finding-groups.json
// and the merged payload — through the one strict reader, and a sighting is a confirmed or symptom group at the
// payload's severity. A dropped finding is no longer a sighting.
//
// REFUSED, NEVER FOLDED: a run with no finding-groups.json, an artifact that cannot be read or is reached through a
// link out of the run (G-9 of ltb-review-r4), groups with no payload, and a payload that judged fewer groups than were
// formed (a batched barrier that failed part-way). Each would otherwise read as SILENCE — the signal that turns a
// claimed fix into a confirmed one. A run that formed no groups needs no payload: it is silence, honestly.
// AN UNREADABLE STATUS FILE STILL STOPS THE FOLD, FIRST (G-8 of 20260927-224505-ledger-review-r3; G-9 of ltr-review-r3 and r4):
// the statuses say which lenses reported OK, and a claim is confirmed only by the silence of the lens that raised it.
// EVERY READ OF THE FOLD GOES THROUGH THE ADMITTED DIRECTORY (G-12 of 20261023-040306-rdt-remediation-2-review): the
// statuses and the gate were read through the caller's --run-dir, so a link retargeted after admission mixed the admitted
// run's identity with another directory's verdicts. Both admission paths above set it; a run not admitted is not folded,
// by the one guard at the head of the ingest (G-8 of 20261102-231209-rbr-remediation-6-review: it stood here twice).
const foldDir = admittedDir;
// THROUGH THE RUN'S OWNER (run-dir-reads.plan.md stage 4): nodes/, each status and gate.json decide `reviewed`, and so
// whether a claim can close; they were listed and read raw below the admitted directory, so a link at nodes/ or at a
// status put another directory's verdicts into the fold. A link at any level is refused.
const foldOwner = confined(foldDir);
// THE STATUSES, READ ONCE (G-9 of 20261102-231209-rbr-remediation-6-review): validated here and kept, so the coverage
// below asks them of `nodeStatuses` rather than listing nodes/ and reading every status a second time.
const nodeStatuses = [];
{
  let names = [];
  try { names = foldOwner.list(['nodes']); } catch (e) {
    if (e.code !== 'ENOENT') die(`nodes/: ${e.message}; refusing to fold a run whose lenses cannot be read`, 1);
  }
  for (const f of names.filter((f) => f.endsWith('.status.json'))) {
    const r = readNodeStatus(foldOwner, f.slice(0, -'.status.json'.length));
    if (!r.ok) die(`${r.why}; refusing to fold a run whose lenses cannot be read (unreadable node status)`, 1);
    nodeStatuses.push(r.status);
  }
}

const runId = admittedRunId ?? path.basename(runDir);
const artifacts = readReconcileArtifacts(foldDir);
for (const [what, why] of Object.entries(artifacts.refused)) die(`${what} refused — ${why}; refusing to fold a run whose decisions cannot be read`, 1);
if (!artifacts.groups) die(`${runId} has no finding-groups.json; refusing to fold a run whose barrier did not group its findings (it is not silence)`, 1);
const read = sightingsFromReconcile(runId, { groups: artifacts.groups, payload: artifacts.payload });
if (!read.ok) die(`${read.why}; refusing to fold`, 1);
const sightings = read.sightings;

// What this run actually reviewed, so a claimed fix can be CONFIRMED by a run that looked at the
// file and stayed silent. Read from run.json's own scope — never inferred from the contract's
// globs, which describe what a run MAY cover, not what this one did.
let surface = [];
{
  // The admitted record's scope (G-19 of 20261023-014400-rdt-delivery); no admitted record confirms nothing, which is the
  // safe direction.
  const scope = admittedRecord?.scope ?? {};
  surface = [...(scope.paths ?? []), ...(scope.changed_files ?? [])];
}

// DID ANY LENS ACTUALLY LOOK? Scope says the file was in front of a lens; this says a lens was there
// (G-22). A run whose lenses were BLOCKED or crashed covers its files on paper and reviewed nothing,
// and closing a remediation claim on that silence is the failure this ledger exists to prevent. The
// gate is the run's own answer to "was this a review": anything BLOCKED is not.
let reviewed = false;
const okNodes = new Set();
try {
  const gate = JSON.parse(foldOwner.read(['gate.json']));
  // The statuses validated above (G-9): a refused or unreadable one already stopped the fold, naming it (G-6 of
  // 20261029-235315-rdr-remediation-4-review asked that a refusal be said, never read as absent).
  const okLenses = nodeStatuses
    // ASKED OF THE OWNER (G-9). This read `st?.kind !== 'tiebreak'`, a kind nothing has written
    // since the adjudication panel replaced the single tie-breaker — so every judge's OK status
    // counted here as a lens that had reviewed the code, and joined `okNodes` below, where a
    // remediation claim is confirmed by the silence of the lens that raised it.
    .filter((st) => st?.state === 'OK' && statusIsReview(st));
  // WHETHER THE RUN WAS A REVIEW is the owner's (lib/reviewed-run.mjs; G-2 of 20261030-221015-usage-report-99-review):
  // a gate with no verdict, or an unknown one, confirmed claims here while usage-report counted it as no review.
  reviewed = reviewedRun({ verdict: gate?.gate }) && okLenses.length > 0;
  // WHICH lenses, not just how many (G-14). A claim is confirmed by the silence of the lens that
  // RAISED it; a run-wide count let an `--only` re-run close a security-audit claim on the silence
  // of a doc lens that never looks for that class of defect.
  for (const st of okLenses) if (st?.node_id) okNodes.add(st.node_id);
} catch (e) {
  // No gate yet: this run has not finished reviewing, so it confirms nothing. A refused one confirms nothing either, and
  // is said (G-6).
  if (e.code === 'ECONFINED') console.error('findings-ledger: gate.json or nodes/ refused (a link or junction stands below the run); this run confirms nothing');
  // A gate that exists but is malformed or unreadable is not "no gate yet" (G-9 of 20261103-005954-rbr-remediation-7-review).
  else if (e?.code !== 'ENOENT') console.error(`findings-ledger: gate.json could not be read (${e?.message ?? e}); this run confirms nothing`);
}

lockLedger();
const priorLedger = loadLedger();
// The operator's decisions, and agents' notes on closed entries, since the PREVIOUS fold — both read before
// this fold moves `last_fold_at` past them (G-4 of 20260928-004954-ledger-transitions-review: the notes were
// read after, through the window this very fold had just moved).
const decisionsSincePreviousFold = operatorDecisionsSince(priorLedger);
const closedNotesSincePreviousFold = observedWhileClosed(priorLedger);
const { ledger, delta } = mergeRun(priorLedger, {
  run_id: runId, at: new Date().toISOString(), sightings, surface, reviewed, okNodes,
});
saveLedger(ledger);

console.log(
  `findings-ledger: ${runId} — ${delta.refold ? 'already folded into this ledger; a re-fold applies nothing — ' : ''}${delta.new.length} new, ${delta.recurring.length} recurring` +
    (delta.silent_this_run.length
      ? `; ${delta.silent_this_run.length} previously-open entr${delta.silent_this_run.length === 1 ? 'y' : 'ies'} not mentioned this run (still open — absence is not a fix)`
      : ''),
);
// Each line carries the claim and, for a recurrence, the run that first recorded it (G-10): a
// bare key told an operator THAT something recurred but not what, sending them back into two run
// directories the report exists to spare them.
const describe = (k) => {
  const e = ledger.entries[k];
  // The group ids beside the key (ledger-identity stage 3), so a remediation can name the entry its group landed on.
  const s = e?.sightings?.at(-1);
  const groups = s?.run_id === runId && s.group_ids?.length ? ` [${s.group_ids.join(', ')}]` : '';
  return e ? `${groups} — ${String(e.claim ?? '').slice(0, 110)}` : '';
};
for (const k of delta.new) console.log(`  new        ${k}${describe(k)}`);
for (const k of delta.recurring) {
  const e = ledger.entries[k];
  // A regression is not an ordinary recurrence: the ledger sets status 'reopened' when a defect
  // previously marked fixed returns, and the fold report used to render both identically — the
  // memory carried the fact and the one artifact an operator reads withheld it (G-6).
  const label = e?.status === 'reopened' ? 'REOPENED ' : 'recurring';
  console.log(`  ${label}  ${k} — first ${e?.first_seen ?? '?'} · x${e?.times_seen ?? '?'}${describe(k)}`);
}
for (const k of delta.silent_this_run) console.log(`  silent     ${k}${describe(k)}`);
// SHARED: two or more of this run's groups landed on one entry (ledger-identity stage 3). One sighting of it, and a fix
// claim must name every group (`--group <run>:<G-n>`), or the operator decides it.
for (const s of delta.shared ?? []) console.log(`  shared     ${s.key} — ${s.groups.join(', ')}: a fix claim must name every group`);
// Confirmations are the only transition that CLOSES an entry, so they are reported like the rest of
// the delta rather than discovered by diffing two ledgers.
// TWO EVIDENCE SHAPES CLOSE AN ENTRY, and this line used to describe both as a claim. Since an OPEN
// entry may now be closed by coverage plus the raising lens's silence, with nobody having filed a
// remediation claim at all, `fixed_in` on such an entry falls back to the verifying run — and
// printing that under the words "claimed in" told the operator a claim existed where none did.
// The ledger records which shape applied; the report reads it rather than guessing.
for (const [k, e] of Object.entries(ledger.entries)) {
  if (e.status === 'fixed' && e.verified_in === runId) {
    const how = e.closed_by === 'silence'
      ? 'no fix was ever claimed; the lens that raised it looked here and did not report it'
      : `claimed in ${e.fixed_in ?? '?'}, not found by this run`;
    console.log(`  CONFIRMED  ${k} — ${how}`);
  }
}
printStale(ledger, { decisions: decisionsSincePreviousFold, closedNotes: closedNotesSincePreviousFold });
console.log(`wrote ${ledgerPath}`);
