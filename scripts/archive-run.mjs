#!/usr/bin/env node
// ARCHIVE A RUN LEFT STAGED (story-pipeline, 2026-10-15; operator: "Self-archive + resolver (Recommended)").
//
//   node scripts/archive-run.mjs --run-dir <staged run dir> [--repo-root <repository>]
//
// A run is staged under the engine's home and moved back into the repository's .claude/reviews when it ends. Until
// 2026-10-15 only run-graph did that, so every remediate.mjs run stayed staged with its run.json out of the tree. This
// moves such a run with the same sequence (io/reviews-root's archiveStagedRun). It refuses a run that has not ended: a
// review with no gate.json (killed mid-flight; --resume works on it where it is), a remediation whose node has not run,
// with a cluster pending for --retry-commits, or with an unrecorded commit. A remediation holding its lock is refused too,
// and so is a run the one owner does not admit for this repository (ARCHITECTURE A-28).
// Exit 0 archived (or already in place), 1 refused, 2 bad arguments.

import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import path from 'node:path';
import { archiveStagedRun, inArchive, quorateHome, repoRunRoots, runCitations, admitRun, callerRepoRoot, readRunJson } from './io/reviews-root.mjs';
import { readContract } from './io/contract-reader.mjs';
import { remediationNotEnded } from './lib/remediation-chain.mjs';
import { confined } from './io/confined-path.mjs';
import { REMEDIATE_LOCK, takeRemediateLock, remediateLockTaken, releaseRemediateLock, remediateLockHeld } from './lib/remediate-lock.mjs';
import { ownerBelow, rootOf } from './io/telemetry-record.mjs';

const die = (msg, code = 1) => { console.error(`archive-run: ${msg}`); process.exit(code); };
const argv = process.argv.slice(2);
let runDirArg = null;
let repoRootArg = null;
// A FLAG IS NOT A PATH (G-1 of 20261015-220413-archive-fold-review): `--run-dir --x` read run.json at ./--x and exited 1.
// The rule is lib/argv.mjs's now, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
try {
  const v = parseArgv(argv, ARGV_SPECS['archive-run']).values;
  runDirArg = v['run-dir'] ?? null;
  repoRootArg = v['repo-root'] ?? null;
} catch (e) { if (e instanceof ArgvError) die(e.message, 2); throw e; }
if (!runDirArg) die('--run-dir <staged run dir> is required', 2);
const given = path.resolve(runDirArg);
// THE RUN, ADMITTED FOR THE REPOSITORY THIS COMMAND RUNS FOR (ARCHITECTURE A-28; run-dir-trust.plan.md stage 2). --run-dir
// was taken on trust once, so a crafted ended run anywhere was moved and its source removed (G-1 of
// 20261015-230146-archive-fold-remediation-review); then it was checked against the repository its OWN record named,
// which a run under the shared home could choose. The repository is --repo-root, or git's toplevel of where this runs.
// EVERYTHING AFTER IS DONE TO THE RUN THAT WAS VALIDATED (G-1 of 20261016-204040-sp-bugs-remediation-review): its real
// path, which carries the filesystem's own casing (G-3 of 20261015-220413-archive-fold-review).
const admitted = admitRun({ runDir: given, repoRoot: callerRepoRoot(repoRootArg) });
if (!admitted.ok) die(admitted.why);
const run = admitted.record;
const realRepo = admitted.repoRoot;
const runDir = admitted.dir;
const read = readContract({ repoRoot: realRepo });
if (read.error) die(`the contract of ${realRepo} cannot be read; refusing to guess where its runs live`);
const own = read.contract ?? null;

// WHO CITES THIS RUN (story-pipeline, 2026-10-16; operator: "Treat it as a bug"): a run that cannot be archived may still be
// the recorded source of another review's reused pre-flight or intent, so a refusal that names only --resume invites the
// deletion of evidence a tracked gate depends on. Every run root of this repository is listed, and the refusal says which
// it searched, so "nothing cites it" is never claimed beyond where it looked.
// The staging root is listed only given quorate's home (G-2 of 20261016-193355-sp-bugs-review): without it, the root where
// every unarchived run lives was never searched. A root that does not exist holds no run; one that cannot be listed, or a
// run.json that cannot be parsed, is named as unread and no all-clear is given (G-3 of the same review).
function citations() {
  // A root left out because it leads outside is named unread (G-7, G-9 of 20261105-154708-crsf-remediation-5-review):
  // dropped with nothing recorded, a linked .claude/reviews hid every run that could cite this one, and the all-clear
  // was given anyway.
  const dropped = [];
  const roots = repoRunRoots({ repoRoot: realRepo, project: own?.project ?? null, home: quorateHome(),
    declaredReviewsDir: own?.review?.reviews_dir || null, dropped });
  const records = [];
  const unread = dropped.map((d) => `${d.root} (${d.reason})`);
  for (const root of roots) {
    // The root listed through an owner walked from the repository, or a staged root from quorate's home (G-1 of
    // 20261105-074139-crsf-remediation-3-review): listed raw, a link at .claude/reviews was followed, and the run.json
    // files beyond it entered the citation decision. A link at any level is refused and the root named unread.
    let names = [];
    let own;
    try {
      own = ownerBelow(root, rootOf(root, realRepo));
      const entries = own.list([], { withFileTypes: true }).filter((e) => e.name !== run.run_id);
      // A link child is named unread, never dropped as not a directory (G-3 of 20261105-163851-crsf-d1-review): a
      // junction run below a real root was skipped with nothing recorded, and the all-clear was given.
      for (const e of entries) if (e.isSymbolicLink()) unread.push(`${path.join(root, e.name)} (a link, not followed)`);
      names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (e) {
      if (e.code !== 'ENOENT') unread.push(`${root} (${e.code === 'ECONFINED' ? e.message : (e.code ?? e.message)})`);
      continue;
    }
    for (const n of names) {
      const file = path.join(root, n, 'run.json');
      // Through the same owner (G-1 of 20261030-153323-ciss-s7-remediation-2-review): a link at run.json is refused and
      // named unread, never followed into the citation decision.
      // Bounded as admitRun bounds it (G-3 of 20261124-160743-gsw-remediation-2-review-b): a record larger than the bound
      // is named unread, never read whole.
      try { records.push(readRunJson(own, [n, 'run.json'])); } catch (e) { if (e.code !== 'ENOENT') unread.push(`${file} (${e.code === 'EFBIG' ? e.message : (e.code ?? e.message)})`); }
    }
  }
  const found = runCitations(run.run_id, records);
  const cited = found.length ? `cited by ${found.map((c) => `${c.run_id} (${c.field})`).join(', ')}, so do not delete it` : null;
  const gap = unread.length ? `could not read ${unread.join(', ')}, so another review may cite it unseen: do not delete it` : null;
  return `${[cited, gap].filter(Boolean).join('; ') || 'cited by no review'}; searched ${roots.join(', ')}`;
}
// ENDED BEFORE IN PLACE (G-2 of 20261015-230146-archive-fold-remediation-review): "already in place" was answered first,
// so a live or unfinished run with no archive_to, or already in it, exited 0 as archived.
// Whether the run has ended is read through its owner (run-dir-reads.plan.md stage 4): a link at remediate.lock or at
// gate.json is refused, and the run stays staged, rather than archived on the strength of another file.
const runHas = (name) => { try { return confined(runDir).exists([name]); } catch (e) { die(`${name}: ${e.message}; it stays at ${runDir}`); } };
// THE LOCK IS TAKEN, NOT OBSERVED (G-3 of 20261105-173030-crsf-d1-remediation-review): a check that remediate.lock was
// absent let remediate.mjs create it after the check, while the run was copied and its staged directory removed. Created
// exclusively through the run's owner, as remediate.mjs creates it, so one of the two refuses the other; it is left out
// of the archive (skip), goes with the staged directory once the archive has moved it, and is released on any refusal.
let lockTaken = false;
const releaseLock = () => {
  if (!lockTaken) return;
  lockTaken = false;
  try { releaseRemediateLock(confined(runDir)); } catch (e) { if (e?.code !== 'ENOENT') console.error(`archive-run: ${REMEDIATE_LOCK} at ${runDir} could not be released (${e?.message ?? e}); remove it once no runner holds the run`); }
};
process.on('exit', releaseLock);
if (run.remediates) {
  // Asked of the lock's owner (G-1 of 20261121-204740-m3s7-b1-remediation-review), as it is taken and released there.
  let held;
  try { held = remediateLockHeld(confined(runDir)); } catch (e) { die(`${REMEDIATE_LOCK}: ${e.message}; it stays at ${runDir}`); }
  if (held) die(`${run.run_id} holds ${REMEDIATE_LOCK}; a runner holds it, or one stopped: see the lock`);
  try {
    // Through the lock's one owner (G-3 of 20261121-193516-m3s7-b1-review), as remediate.mjs takes it.
    takeRemediateLock(confined(runDir), { pid: process.pid, startedAt: new Date().toISOString(), phase: 'archiving' });
    lockTaken = true;
  } catch (e) {
    die(`${run.run_id} holds ${REMEDIATE_LOCK} (${remediateLockTaken(e) ? 'a runner took it just now' : e?.message ?? e}); a runner holds it, or one stopped: see the lock`);
  }
  const why = remediationNotEnded(run);
  if (why) die(`${run.run_id} has not ended: ${why}; it stays at ${runDir}`);
} else if (!runHas('gate.json')) {
  die(`${run.run_id} has not ended: no gate.json (a run killed mid-flight stays staged for --resume); it stays at ${runDir}; ${citations()}`);
}
// ALREADY IN PLACE, by the archive's own rule (G-2, G-3 of 20261015-220413-archive-fold-review): no archive_to (a declared
// reviews_dir wrote it where it belongs) or already in archive_to, in this platform's case rule. Nothing moves: exit 0.
if (inArchive(runDir, run.archive_to)) {
  console.log(`archive-run: ${run.run_id} is already in place at ${runDir}`);
  process.exit(0);
}
// Evidence withheld at archive time is reported on stderr only (by archiveStagedRun's log), not added to the gate the run
// already wrote. Adding it was G-3 of 20261016-214749-sp-bugs-remediation-2-review; that fix drew two MEDIUMs of its own
// (G-2, G-9 of 20261016-224651-sp-bugs-remediation-3b-review) and was backed out (operator, 2026-10-16: "Back out G-3's
// rewrite (Recommended)"). G-3 stays open in the ledger.
const to = archiveStagedRun({ runDir, archiveTo: run.archive_to, repoRoot: realRepo, skip: [REMEDIATE_LOCK], log: (m) => console.error(`archive-run: ${m}`) });
if (to === runDir) die(`${run.run_id} was not archived; it stays at ${runDir}`);
console.log(`archive-run: ${run.run_id} is at ${to}`);
