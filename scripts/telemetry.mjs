#!/usr/bin/env node
// telemetry.mjs — the run records' command (telemetry-records.plan.md). `backfill` builds a record for every finished run,
// claim check and bench result that predates the writers (stage 3, criterion 10): a run's files are read as they are, a
// record already present is left alone, and a run whose files cannot yield one is listed, never guessed. `report` reads the
// records at the locations shared/telemetry.md lists and prints what they add up to, each figure beside its sample size
// (stage 4); nothing is sent anywhere, and nothing is recommended.
//
// Usage: telemetry.mjs backfill [--rebuild] [--repo-root <dir>]
//        telemetry.mjs report [--since <date>] [--kind <kind>] [--fields] [--repo-root <dir>]
//
// Exit codes: 0 done · 1 some record could not be built or read, each named · 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { callerRepoRoot, quorateHome, repoRunRoots, readRunJson } from './io/reviews-root.mjs';
import { readContract } from './io/contract-reader.mjs';
import { writeRunRecord, writeClaimCheckRecord, writeBenchRecord, benchRecordPath, readRecords, notAMeasurement, ownerBelow, rootOf } from './io/telemetry-record.mjs';
import { isWithin } from './io/finding-scope.mjs';
import { reportFigures, renderReport, selectRecords } from './lib/telemetry-report.mjs';
import { remediationNotEnded } from './lib/remediation-chain.mjs';

const die = (msg, code = 2) => { console.error(`telemetry: ${msg}`); process.exit(code); };
let parsed;
try { parsed = parseArgv(process.argv.slice(2), ARGV_SPECS.telemetry); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
const [command] = parsed.positionals;
const USAGE = 'usage: telemetry.mjs backfill [--rebuild] [--repo-root <dir>] | report [--since <date>] [--kind <kind>] [--fields] [--repo-root <dir>]';
if (command !== 'backfill' && command !== 'report') die(USAGE);
if (command === 'backfill' && ['since', 'kind', 'fields'].some((k) => parsed.values[k] !== undefined)) die(`backfill takes no filter; ${USAGE}`);
if (command === 'report' && parsed.values.rebuild !== undefined) die(`--rebuild is backfill's; ${USAGE}`);

const repoRoot = callerRepoRoot(parsed.values['repo-root']);
if (!repoRoot) die('not inside a git repository; pass --repo-root');
const read = readContract({ repoRoot });
if (read.error) die(`the contract cannot be read: ${String(read.message ?? read.error).split(/\r?\n/)[0]}`, 1);
const own = read.contract ?? {};
// --rebuild rewrites a record already there, from the run's files (runtime-call-telemetry.plan.md stage 5): a change to
// what a record holds, such as the one family rule, reaches the records written before it.
const REBUILD = parsed.values.rebuild === true;
// A root left out because it leads outside is named unread (G-7 of 20261105-154708-crsf-remediation-5-review): it was
// dropped with nothing recorded, so every archived run behind a linked .claude/reviews went unseen and none was unread.
const droppedRoots = [];
const runRoots = repoRunRoots({ repoRoot, project: own.project ?? null, home: quorateHome(), declaredReviewsDir: own.review?.reviews_dir || null, dropped: droppedRoots });
const droppedUnread = droppedRoots.map((d) => `${d.root}: not read, ${d.reason}`);

if (command === 'report') {
  // The selection is applied as each record is read, so a narrow report holds only what it reports (G-11 of
  // 20261025-215217-tel-remediation-2-review); an unusable --since is refused before anything is read.
  const filter = { since: parsed.values.since ?? null, kind: parsed.values.kind ?? null };
  try { selectRecords([], filter); } catch (e) { die(e.message); }
  const { records: selected, locations, unreadable: readBad } = readRecords(repoRoot, { runRoots,
    keep: (r) => selectRecords([r], filter).length > 0 });
  const bad = [...droppedUnread, ...readBad];
  const label = [parsed.values.since && `since ${parsed.values.since}`, parsed.values.kind && `kind ${parsed.values.kind}`].filter(Boolean).join(', ');
  process.stdout.write(renderReport(reportFigures(selected), { locations, fields: parsed.values.fields === true, label: label || null }));
  for (const u of bad) console.error(`telemetry: could not read ${u}`);
  process.exit(bad.length ? 1 : 0);
}

// ABSENT IS ENOENT ONLY: a folder that cannot be listed is named, never read as empty (the error-as-absence class).
// Listed through its owner, walked from the repository or quorate's home (G-10 of
// 20261105-151040-crsf-remediation-4b-review): a raw readdirSync followed a junction at a record root, and an empty linked
// target passed with nothing unreadable. A link at any level is refused here, and the folder named unreadable.
const unreadable = [...droppedUnread];
// A LINK CHILD IS NAMED, NEVER SKIPPED (G-15 of 20261105-163851-crsf-d1-review): each loop below keeps only a Dirent that
// is a directory (or a file), so a junction or symlink below a real root was dropped with nothing recorded and the backfill
// passed. It is named unreadable here, once for every loop, and not followed.
const listDir = (d) => {
  try {
    const entries = ownerBelow(d, rootOf(d, repoRoot)).list([], { withFileTypes: true });
    for (const e of entries) if (e.isSymbolicLink()) unreadable.push(`${path.join(d, e.name)}: a link, not followed`);
    return entries.filter((e) => !e.isSymbolicLink());
  } catch (e) {
    if (e.code !== 'ENOENT') unreadable.push(`${d}: ${e.code ?? e.message}`);
    return [];
  }
};

const written = []; const present = []; const failed = []; const skipped = [];
const note = (where, r) => (r.ok ? written.push(where) : failed.push(`${where}: ${r.note}`));
// ONE ITEM THAT CANNOT BE READ IS ONE FAILED ITEM (G-16 of 20261025-215217-tel-remediation-2-review): a stat that fails with
// anything but ENOENT is named as a record that could not be built, and the backfill goes on to the next.
const each = (where, fn) => { try { fn(); } catch (err) { failed.push(`${where}: ${err.code ?? err.message}`); } };

// Runs: every root the repository keeps runs in, a finished run being one with a gate (a remediation: an archived run).
// A run under quorate's home is STAGED: still running, or stopped mid-flight. One anywhere else was archived, which
// happens only when a run has ended, so the not-ended rule asks only of a staged one. The earliest archived remediations
// (2026-09) predate the remediation_state that rule reads, and were read as never run (found by backfill --rebuild).
const homeReal = (() => { try { return fs.realpathSync(quorateHome()); } catch { return path.resolve(quorateHome()); } })();
const isStaged = (root) => {
  let real;
  try { real = fs.realpathSync(root); } catch { real = path.resolve(root); }
  // Asked of isWithin, containment's one owner (G-13 of 20261105-074139-crsf-remediation-3-review): `startsWith('..')`
  // read a home root named `..records` as archived, and a remediation still running got a record. Equal is inside.
  return isWithin(homeReal, real);
};
for (const root of runRoots) {
  const staged = isStaged(root);
  for (const e of listDir(root)) each(path.join(root, e.name), () => {
    if (!e.isDirectory()) return;
    const dir = path.join(root, e.name);
    // A run's files through its owner (G-7 of 20261030-153323-ciss-s7-remediation-2-review): a link at any of them is
    // refused, and each() names the run failed, rather than followed into its record.
    // Walked from the repository down, or a staged run from the engine's home down (G-11 of
    // 20261105-070121-crsf-remediation-2-review): rooted at the run, a link at .claude/reviews above it was followed.
    const runOwner = ownerBelow(dir, rootOf(dir, repoRoot));
    const runHas = (name) => runOwner.exists([name]);
    if (!runHas('run.json')) return;
    if (!REBUILD && runHas('telemetry.json')) { present.push(dir); return; }
    let run;
    // Bounded as admitRun bounds it (G-8 of 20261124-160743-gsw-remediation-2-review-b, a symptom of G-3).
    try { run = readRunJson(runOwner, ['run.json']); } catch (err) { failed.push(`${dir}: run.json: ${err.message}`); return; }
    const kind = run.remediates ? 'remediation' : 'review';
    if (kind === 'review' && !runHas('gate.json')) { skipped.push(`${dir}: no gate (not finished)`); return; }
    // A remediation is finished when remediate.mjs's own rule says it has ended (G-20 of 20261025-203513-tel-delivery): a
    // record written for one still running would be partial, and the rule above keeps an existing record for good.
    // And only of a run the runner made: remediate.mjs writes remediate-settings.json at mint, and the remediations from
    // before it (to 2026-10-04, 85 staged under the home) carry neither its mark nor the remediation_state the rule reads.
    const runnerMade = runHas('remediate-settings.json');
    const notEnded = kind === 'remediation' && staged && runnerMade ? remediationNotEnded(run) : null;
    if (notEnded) { skipped.push(`${dir}: not ended (${notEnded})`); return; }
    note(dir, writeRunRecord(dir, { recordKind: kind, repoRoot, run }));
  });
}

// Claim checks: each check directory that reached the rules step.
for (const e of listDir(path.join(repoRoot, '.claude', 'claim-checks'))) each(path.join(repoRoot, '.claude', 'claim-checks', e.name), () => {
  if (!e.isDirectory()) return;
  const dir = path.join(repoRoot, '.claude', 'claim-checks', e.name);
  // Probed through the check's owner, rooted at the repository (G-12 and G-14 of 20261105-074139-crsf-remediation-3-review):
  // a raw statSync followed a link at .claude or claim-checks and counted an outside record as present.
  const checkOwner = ownerBelow(dir, repoRoot);
  const has = (name) => checkOwner.exists([name]);
  if (!REBUILD && has('telemetry.json')) { present.push(dir); return; }
  // A check that failed after its checker ran writes its record and no checked.json, so under --rebuild a record already
  // there is a check to rebuild (G-15 of 20261026-080302-rct-delivery); with neither, the rules step never ran.
  if (!has('checked.json') && !has('telemetry.json')) { skipped.push(`${dir}: no checked.json (the rules step never ran)`); return; }
  note(dir, writeClaimCheckRecord(dir, { repoRoot }));
});

// Bench results: each results file, not a record, under bench/results.
const benchDir = path.join(repoRoot, 'bench', 'results');
for (const e of listDir(benchDir)) each(path.join(benchDir, e.name), () => {
  if (!e.isFile() || !/\.json$/i.test(e.name) || /\.telemetry\.json$/i.test(e.name)) return;
  const file = path.join(benchDir, e.name);
  // A results file its bench marked not_a_measurement (a forge file holds forged rationales, G-21 of
  // 20261025-203513-tel-delivery) has no record: the writer reads the marker, never the name (G-17 of
  // 20261025-215217-tel-remediation-2-review), and its record already standing is not one this backfill counts.
  // Read and probed through the results folder's owner, rooted at the repository (G-15 and G-12 of
  // 20261105-074139-crsf-remediation-3-review): a raw read followed a link at bench/results to outside JSON.
  const benchOwner = ownerBelow(benchDir, repoRoot);
  let results;
  try { results = JSON.parse(benchOwner.read([e.name])); } catch (err) { failed.push(`${file}: ${err.code ?? err.message}`); return; }
  if (notAMeasurement(results)) { skipped.push(`${file}: not a measurement`); return; }
  if (!REBUILD && benchOwner.exists([path.basename(benchRecordPath(file))])) { present.push(file); return; }
  note(file, writeBenchRecord(file, { repoRoot, results }));
});

console.log(`telemetry backfill: ${written.length} written, ${present.length} already there, ${skipped.length} skipped, `
  + `${failed.length} could not be built, ${unreadable.length} folder(s) unreadable`);
for (const s of skipped) console.log(`  skipped  ${s}`);
for (const f of failed) console.log(`  FAILED   ${f}`);
for (const u of unreadable) console.log(`  UNREAD   ${u}`);
process.exit(failed.length || unreadable.length ? 1 : 0);
