// io/telemetry-record.mjs — THE WRITERS' HALF of telemetry-records.plan.md stage 3: read a finished run's files, build its
// record with lib/telemetry-record.mjs, write it beside them. A record that cannot be built is a note the caller prints,
// never a failed run (stage 3: "a record that cannot be built is a note in the run's output").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Every record below the repository is written through `confined` (ownerBelow); nothing here writes a raw path.
import { confined } from './confined-path.mjs';
import { hostPlatform } from '../platform/index.mjs';
import { selectAdapters } from './reviewers.mjs';
import { quorateHome, readRunJson } from './reviews-root.mjs';
import { isWithin, canonicalSpelling, belowRoot, isBelowRoot } from './finding-scope.mjs';

// The adapter table a family is asked of (runtime-call-telemetry.plan.md stage 1): the built-ins, with the overrides the
// run's frozen contract declared, so a consumer's own adapter resolves as it did in the run. From the one owner
// (contract-runtime-and-session-files.plan.md stage 1); the table only, the runtime being what the run froze (below).
const adapterTable = (contract) => selectAdapters({ contract: contract ?? null }).table;
import { buildRunRecord, buildClaimCheckRecord, buildSubagentRecord, buildBenchRecord, buildSuiteRecord, buildDecisionRecord, notAMeasurement, suiteRecordsPast } from '../lib/telemetry-record.mjs';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// ABSENT IS ENOENT ONLY (the error-as-absence class, G-4 of 20261025-114413-srf-remediation-4-review): a file that is
// missing is no input; one that cannot be read or parsed is an error the caller turns into its note.
const readJson = (p) => {
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  return JSON.parse(text);
};
// A journal is the check's own appended lines: a line that does not parse (a write cut by a kill) is skipped, not fatal,
// and counted (G-3 of 20261105-004603-ar-d1-c-review): `unparsed` says how many, so a record missing steps says so.
// Read through the check folder's owner (G-9 of 20261105-013235-ar-d1-c-remediation-review): a link there is refused.
const readJournal = (own, segs) => {
  let text;
  // No journal is no measurement (G-13 of 20261105-021654-ar-d1-c-remediation-2-review): null, never a measured zero.
  try { text = own.read(segs); } catch (e) { if (e.code === 'ENOENT') return { entries: [], unparsed: null }; throw e; }
  const entries = []; let unparsed = 0;
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try { const e = JSON.parse(l); if (e) entries.push(e); else unparsed += 1; } catch { unparsed += 1; }
  }
  return { entries, unparsed };
};
const roster = () => readJson(path.join(SCRIPTS, 'lens-roster.json')) ?? {};
// THE NODE RUNTIME a task with no declared family ran on (G-11 of 20261025-203513-tel-delivery: no writer passed one, so
// every such task fell to the builder's default). A spawn's record is written as it ends, so the adapter table's declared
// default is the runtime it ran on. A run's or check's record may be written long after (backfill), so it reads only what
// the run or check froze: the contract's review.runtime, else run.json's host.runtime; a claim check's
// same_family.runtime. None frozen is unknown, never today's table (G-20 of 20261025-215217-tel-remediation-2-review).
const named = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const runRuntime = (run) => named(run?.contract?.review?.runtime) ?? named(run?.host?.runtime);

/** Whether the engine is reviewing its own repository: the framework root is the repository root (criterion 9). */
// Folded where the file system folds case (G-8 of 20261025-215217-tel-remediation-2-review): the same repository named in
// another case is the same repository, as reviews-root and stop-log key a real path.
export function isSelfReview(repoRoot) {
  const key = (p) => { const real = fs.realpathSync(p); return hostPlatform().caseInsensitiveFs ? real.toLowerCase() : real; };
  // ABSENT IS ENOENT ONLY, as readJson above (G-8 of 20261025-222928-tel-remediation-3-review): a root that is missing is
  // not this repository; one realpath cannot resolve for another reason (EACCES, an invalid path) is an error the writer
  // turns into its note, never a self-review label nothing established.
  try { return key(path.join(SCRIPTS, '..')) === key(repoRoot); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

// A RUN'S FILES THROUGH ITS OWNER (G-2 of 20261030-153323-ciss-s7-remediation-2-review): each was read raw, so a link at any
// level below the run was followed and another directory's files recorded as the run's. A link is refused; the throw
// becomes the writer's note. Absent is ENOENT only, as readJson above.
const ownJson = (own, segs) => {
  let text;
  try { text = own.read(segs); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  return JSON.parse(text);
};
const ownRunJson = (own) => {
  try { return readRunJson(own, ['run.json']); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
const ownStdout = (own, segs) => {
  let text;
  try { text = own.read(segs); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  try { return JSON.parse(text); } catch { return null; }
};
/**
 * THE OWNER OF A FOLDER, ROOTED AT THE REPOSITORY when the folder is inside it (G-14 and G-15 of
 * 20261105-021654-ar-d1-c-remediation-2-review): an owner rooted at the folder itself never inspects the levels above it,
 * so a junction at .claude or at a record root was followed. Inside `repoRoot`, every level from it down is walked and a
 * link at any is refused. A folder outside the root it is given is REFUSED (G-7 and G-9 of
 * 20261105-074139-crsf-remediation-3-review): re-rooted at itself, it inspected no level above it, so a record path outside
 * the repository was read or written. A staged run is asked with quorate's home as its root (rootOf). `[]` names the
 * folder itself.
 */
export function ownerBelow(dir, repoRoot) {
  // Both as the filesystem spells them (canonicalSpelling, links kept): run-all's root came from git, long, and the record
  // folder from the test tree's own path, which under a Windows runner's TEMP is an 8.3 short one (CI run 43281517496).
  const abs = canonicalSpelling(path.resolve(dir));
  // Containment decided by the one owner of "below a root", belowRoot (ci-path-identity.plan.md stage 1c): the home is on
  // its real path since roots are resolved where they are read, and a run directory spelled through macOS's /var was "not
  // below" it (census row 8). The names below the root come back as given, so confined still walks each of them.
  const placed = repoRoot ? belowRoot(path.resolve(repoRoot), abs) : null;
  if (!placed) {
    throw Object.assign(new Error(`confined path refused: ${abs} — not below ${repoRoot ?? '(no root)'}`), { code: 'ECONFINED' });
  }
  {
    const root = placed.root;
    const pre = placed.segs;
    if (!pre.length) return confined(root);
    const own = confined(root);
    const at = (segs) => [...pre, ...segs];
    return {
      read: (segs, enc) => own.read(at(segs), enc),
      readBounded: (segs, max) => own.readBounded(at(segs), max),
      readLines: (segs, onLine, o) => own.readLines(at(segs), onLine, o),
      exists: (segs) => own.exists(at(segs)),
      list: (segs, o) => own.list(at(segs), o),
      replace: (segs, data) => own.replace(at(segs), data),
    };
  }
}
// By belowRoot too (census row 9, ci-path-identity.plan.md stage 1c), so a run inside a repository spelled through a link
// is rooted at the repository, as the same run spelled really is.
// One predicate, isBelowRoot (G-9 of 20261118-112631-cpi-review), not a composition of its own.
const insideOf = (dir, root) => Boolean(root) && isBelowRoot(path.resolve(root), path.resolve(dir));
/** The root a folder's owner walks from: the repository when the folder is inside it, else quorate's home (a staged run). */
export const rootOf = (dir, repoRoot) => (insideOf(dir, repoRoot) ? repoRoot : quorateHome());
const ownList = (own, segs) => { try { return own.exists(segs) ? own.list(segs) : []; } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };

/** Every task status a run directory holds: nodes/*.status.json, and each re-ask batch's status under evidence/. */
function runStatuses(own) {
  const statuses = {}; const stdouts = {};
  for (const f of ownList(own, ['nodes'])) {
    const m = /^(.+)\.status\.json$/.exec(f);
    if (!m) continue;
    const s = ownJson(own, ['nodes', f]);
    if (!s) continue;
    statuses[m[1]] = s;
    const out = ownStdout(own, ['evidence', m[1], 'stdout.json']);
    if (out) stdouts[m[1]] = out;
  }
  let batches = 0;
  for (const f of ownList(own, ['evidence', 'reconcile-reask'])) {
    const m = /^batch-(\d+)-status\.json$/.exec(f);
    if (!m) continue;
    const s = ownJson(own, ['evidence', 'reconcile-reask', f]);
    if (s) { statuses[`reconcile-reask-${m[1]}`] = s; batches += 1; }
  }
  // ONE COUNT OF A RE-ASK (G-4 of 20261025-203513-tel-delivery): run-graph's nodes/reconcile-reask.status.json sums its
  // batches' time and cost, so with the batches read it is a second count of the same work. Kept only when no batch was.
  if (batches) { delete statuses['reconcile-reask']; delete stdouts['reconcile-reask']; }
  return { statuses, stdouts };
}

/** Builds and writes `<runDir>/telemetry.json` for a review or remediation run. Returns { ok, path } or { ok: false, note }. */
// `run`, when the caller already parsed run.json, is used as it is (G-6 of 20261026-174311-rct-remediation-review: the
// backfill parsed it, then this parsed it again).
export function writeRunRecord(runDir, { recordKind, repoRoot, run: parsed = null }) {
  try {
    // Rooted at the repository, or at the engine's home for a staged run (G-12 of 20261105-052942-crsf-delivery): rooted
    // at the run itself, a link at .claude/reviews or between the home and a staged run was followed.
    const own = ownerBelow(runDir, rootOf(runDir, repoRoot));
    // Held to readRunJson's bound (G-6 of 20261124-170802-gsw-remediation-3-review-b): run-graph and remediate pass no
    // parsed record, and this read the file whole; a record over the bound throws EFBIG, which becomes the note.
    const run = parsed ?? ownRunJson(own) ?? {};
    const { statuses, stdouts } = runStatuses(own);
    const record = buildRunRecord({
      kind: recordKind, run, statuses, stdouts, roster: roster(),
      checks: ownJson(own, ['checks.json']),
      groups: ownJson(own, ['finding-groups.json'])?.groups ?? [],
      decisions: ownJson(own, ['evidence', 'reconcile', 'payload.json'])?.groups ?? [],
      gate: ownJson(own, ['gate.json']),
      fullChecks: run.full_checks ?? [], fmtBaseline: run.fmt_baseline ?? null,
      queue: ownJson(own, ['queue.json']) ?? {},
      selfReview: isSelfReview(repoRoot ?? run.repo_root ?? runDir), defaultRuntime: runRuntime(run), table: adapterTable(run.contract),
    });
    // Into the run through its one owner (run-dir-descendants.plan.md stage 4 found this write below the run unconverted):
    // atomic as before, and a link at telemetry.json refused rather than written through.
    const at = own.replace(['telemetry.json'], `${JSON.stringify(record, null, 2)}\n`);
    return { ok: true, path: at };
  } catch (e) { return { ok: false, note: `telemetry record not written: ${e.message}` }; }
}

/**
 * Builds and writes `<checkDir>/telemetry.json` for a claim check. `failed` is the record of a check that failed after its
 * checker ran (G-2 of 20261025-232315-tel-remediation-4-review): it writes no check.json, which would read as current, so
 * its facts are passed here instead.
 */
export function writeClaimCheckRecord(checkDir, { repoRoot }) {
  try {
    // THE STEP JOURNAL (runtime-call-telemetry.plan.md stage 4): the check's facts from check.json when the check finished,
    // else from the journal's start entry, which a failed check leaves where it leaves no check.json.
    // Every file below the check folder through its one owner (G-9 of 20261105-013235-ar-d1-c-remediation-review): a
    // link standing there is refused, never followed to an outside file read as the check's.
    // Rooted at the repository (G-14 of 20261105-021654-ar-d1-c-remediation-2-review): a link at .claude or claim-checks
    // is refused too, not only one below the check folder.
    const own = ownerBelow(checkDir, repoRoot);
    const { entries: journal, unparsed } = readJournal(own, ['steps.jsonl']);
    const start = journal.find((e) => e?.step === 'start') ?? null;
    const check = ownJson(own, ['check.json'])
      ?? (start ? { panel: start.panel, setting: start.setting, family: start.family, same_family: { runtime: start.same_runtime } } : {});
    const sameStep = journal.find((e) => e?.step === 'same-family-call' && typeof e.call_record === 'string');
    const sameRecord = sameStep ? ownJson(own, [path.basename(sameStep.call_record)]) : null;
    // The spawn's record keeps its call's facts on its task, under the entry's own field names (stage 5).
    const record = buildClaimCheckRecord({ journal, sameFamilyCall: sameRecord?.tasks?.[0] ?? null,
      checkId: path.basename(checkDir), roster: roster(), selfReview: isSelfReview(repoRoot),
      defaultRuntime: named(check.same_family?.runtime), table: adapterTable(null), check, arm: ownJson(own, ['arm.json']),
      // The runtime's raw output, empty when its spawn failed: no envelope, never a record that cannot be built.
      sameFamily: ownStdout(own, ['same-family.envelope.json']), checked: ownJson(own, ['checked.json']) ?? {},
      journalUnparsed: unparsed,
    });
    // Written through the same owner: a link at telemetry.json is refused, not written through.
    const at = own.replace(['telemetry.json'], `${JSON.stringify(record, null, 2)}\n`);
    return { ok: true, path: at };
  } catch (e) { return { ok: false, note: `telemetry record not written: ${e.message}` }; }
}

/** The subagent record's path: beside the envelope, named after it (`envelope.json` -> `envelope.telemetry.json`). */
export const subagentRecordPath = (outPath) => outPath.replace(/(\.json)?$/i, '.telemetry.json');

/** Builds and writes the subagent record beside its --out envelope. */
export function writeSubagentRecord(outPath, { envelope, proc, pins, call = null, repoRoot, runtime = null, contract = null }) {
  try {
    const at = subagentRecordPath(outPath);
    // The runtime the spawn ran on, as spawn-subagent chose it; a caller that does not pass it gets the one owner's choice
    // (G-11 of 20261105-052942-crsf-delivery: the table's default was read here, ignoring the contract's review.runtime).
    const selected = selectAdapters({ contract: contract ?? null });
    const record = buildSubagentRecord({ envelope, proc, pins, call, label: path.basename(path.dirname(outPath)),
      roster: roster(), selfReview: isSelfReview(repoRoot), defaultRuntime: named(runtime) ?? selected.runtime, table: selected.table });
    // Through the owner below the repository (contract-runtime-and-session-files.plan.md stage 3; G-5 of
    // 20261105-031048-ar-d1-c-remediation-3-review): a link at any level from the repository down is refused.
    ownerBelow(path.dirname(at), repoRoot).replace([path.basename(at)], `${JSON.stringify(record, null, 2)}\n`);
    return { ok: true, path: at };
  } catch (e) { return { ok: false, note: `telemetry record not written: ${e.message}` }; }
}

/** A bench record's path: beside its results file (`<stamp>.json` -> `<stamp>.telemetry.json`). */
export const benchRecordPath = (resultsPath) => resultsPath.replace(/(\.json)?$/i, '.telemetry.json');

// notAMeasurement is a pure decision, owned by lib/telemetry-record.mjs and re-exported here for the reader below and its
// callers (G-10 of 20261025-222928-tel-remediation-3-review).
export { notAMeasurement };

/**
 * Builds and writes a bench run's record beside its results file, from the file as written. A file marked
 * not_a_measurement gets none: { ok: true, written: false, skipped }.
 */
// `results`, when the caller already parsed the file, is used as it is (G-6 of 20261026-174311-rct-remediation-review: the
// backfill parsed each file, then this parsed it again).
export function writeBenchRecord(resultsPath, { repoRoot, results: parsed = null }) {
  try {
    const at = benchRecordPath(resultsPath);
    // The results read and the record written through the owner below the repository (stage 3; G-6 of
    // 20261105-031048-ar-d1-c-remediation-3-review): a link at any level from the repository down is refused.
    const own = ownerBelow(path.dirname(at), repoRoot);
    const results = parsed ?? ownJson(own, [path.basename(resultsPath)]) ?? {};
    if (notAMeasurement(results)) return { ok: true, written: false, skipped: 'not a measurement' };
    const record = buildBenchRecord({ results, label: path.basename(resultsPath).replace(/\.json$/i, ''), selfReview: isSelfReview(repoRoot) });
    own.replace([path.basename(at)], `${JSON.stringify(record, null, 2)}\n`);
    return { ok: true, written: true, path: at };
  } catch (e) { return { ok: false, note: `telemetry record not written: ${e.message}` }; }
}

/** Where the suite's records live, under the repository root; gitignored (telemetry-run-time.plan.md stage 3). */
export const SUITE_RECORDS_DIR = path.join('.claude', 'suite-runs');
/** Where decide.mjs keeps each decision's record (autonomous-run.plan.md stage 5), read for the report's decision kind. */
export const DECISIONS_DIR = path.join('.claude', 'decisions');

/**
 * Builds and writes a suite run's record from the reporter's file (one JSON line per entry, tests/tools/suite-file-reporter.mjs).
 * Each test file's absolute path is made repository-relative here; one outside `repoRoot` arrives as null and is left out.
 */
export function writeSuiteRecord(repoRoot, { linesFile, startedAt, endedAt, exitCode }) {
  try {
    // Both as the filesystem spells them (canonicalSpelling): the root came from git, long, and the reporter's file paths
    // from node, short under an 8.3 TEMP, so every file read as outside and the record held none (CI run 43281517496).
    const root = path.resolve(repoRoot);
    const spelledRoot = canonicalSpelling(root);
    const rel = (f) => {
      if (typeof f !== 'string' || !f) return null;
      const r = path.relative(spelledRoot, canonicalSpelling(path.resolve(f)));
      // `..` as a whole first name only (G-7 of 20261105-070121-crsf-remediation-2-review): `..fixtures` is inside.
      return !r || r === '..' || r.startsWith(`..${path.sep}`) || path.isAbsolute(r) ? null : r.split(path.sep).join('/');
    };
    // Folded per test file as each line arrives (G-8 of 20261105-074139-crsf-remediation-3-review): every parsed line was
    // kept until the end, so the heap grew with the reporter file. buildSuiteRecord reads only a file's last `file` and
    // `summary` entries, so keeping those, trimmed to what it reads, gives the same record in memory bounded by files.
    const kept = new Map();
    const keep = (e) => {
      if (!e || (e.event !== 'file' && e.event !== 'summary') || typeof e.file !== 'string' || !e.file) return;
      kept.set(`${e.event}\0${e.file}`, e.event === 'file'
        ? { event: 'file', file: e.file, duration_ms: e.duration_ms }
        : { event: 'summary', file: e.file, counts: e.counts && typeof e.counts === 'object'
          ? { tests: e.counts.tests, failed: e.counts.failed, skipped: e.counts.skipped } : e.counts });
    };
    // A torn line is one entry fewer, and counted (G-4 of 20261105-004603-ar-d1-c-review): the record says how many.
    let unparsed = 0;
    // Through the owner below the repository (G-13 of 20261105-052942-crsf-delivery; G-7 of
    // 20261105-061926-crsf-remediation-review): rooted at the file's own folder, a link at tests/ above it was followed.
    const linesAbs = path.resolve(linesFile);
    // Line by line in bounded chunks (G-8 of 20261105-070121-crsf-remediation-2-review): the whole file was held as one
    // string and split into an array of every line before one was parsed.
    ownerBelow(path.dirname(linesAbs), root).readLines([path.basename(linesAbs)], (raw) => {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!line.trim()) return;
      let e;
      try { e = JSON.parse(line); } catch { unparsed += 1; return; }
      if (e && typeof e === 'object') keep({ ...e, file: rel(e.file) });
    });
    const record = buildSuiteRecord({ entries: [...kept.values()], startedAt, endedAt, exitCode, unparsedLines: unparsed });
    // Through the one owner below the repository (G-8 of 20261105-013235-ar-d1-c-remediation-review): a link at
    // .claude or .claude/suite-runs is refused, not written through. Then the oldest past SUITE_RECORDS_KEEP go (§6).
    const own = confined(root);
    const segs = SUITE_RECORDS_DIR.split(path.sep);
    const at = own.replace([...segs, `${record.run_id ?? 'suite'}.json`], `${JSON.stringify(record, null, 2)}\n`);
    for (const old of suiteRecordsPast(own.list(segs))) own.remove([...segs, old]);
    return { ok: true, path: at };
  } catch (e) { return { ok: false, note: `suite record not written: ${e.message}` }; }
}

/**
 * THE READER'S HALF (stage 4): every record at the locations shared/telemetry.md lists, and how many each held, so an
 * empty location is visible. `runRoots` are the repository's run roots (repoRunRoots). A subagent record is read only
 * under .claude/plan-reviews/: one beside a claim check's envelope is already counted inside that check's own record.
 * A record that cannot be parsed is named, never skipped silently. `keep` is the caller's selection, applied as each record
 * is read, so a narrow report holds only what it reports (G-11 of 20261025-215217-tel-remediation-2-review); a location
 * still counts every record it held.
 */
export function readRecords(repoRoot, { runRoots = [], keep = null } = {}) {
  const records = []; const locations = []; const unreadable = [];
  // EVERY RECORD THROUGH THE ONE OWNER of reads below a directory (G-9 and G-10 of
  // 20261105-013235-ar-d1-c-remediation-review): a link standing at the record, or at any level below the folder it is
  // read from, is refused and named, never followed to an outside file read as the record (A-30).
  // Each folder's owner rooted at the repository where the folder is inside it (G-15 of
  // 20261105-021654-ar-d1-c-remediation-2-review): a link at .claude or at a record root is refused too, and the folders
  // are listed through it, never with a raw readdir that followed one.
  // A staged run root is outside the repository and is walked from quorate's home (rootOf; G-9 of
  // 20261105-074139-crsf-remediation-3-review): ownerBelow refuses a folder outside the root it is given.
  const owned = (file) => ownJson(ownerBelow(path.dirname(file), rootOf(file, repoRoot)), [path.basename(file)]);
  const take = (file) => {
    let rec;
    try { rec = owned(file); } catch (e) { unreadable.push(`${file}: ${e.message}`); return 0; }
    if (!rec) return 0;
    if (!keep || keep(rec)) records.push(rec);
    return 1;
  };
  const dirs = (d) => {
    let entries;
    try { entries = ownerBelow(d, rootOf(d, repoRoot)).list([], { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return []; unreadable.push(`${d}: ${e.code === 'ECONFINED' ? e.message : (e.code ?? e.message)}`); return []; }
    // A link among the entries is named, not skipped unseen: what it leads to is not read as this folder's.
    for (const e of entries) if (e.isSymbolicLink()) unreadable.push(`${path.join(d, e.name)}: a link or junction stands here; not followed`);
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(d, e.name));
  };
  // A folder that cannot be listed is named, as dirs() names one (G-6 of 20261025-203513-tel-delivery: listDir rethrows
  // anything but ENOENT, and the report crashed on it).
  const files = (d) => { try { return ownerBelow(d, repoRoot).list([]); } catch (e) { if (e.code === 'ENOENT') return []; unreadable.push(`${d}: ${e.code === 'ECONFINED' ? e.message : (e.code ?? e.message)}`); return []; } };
  const scan = (where, files) => locations.push({ where, found: files.reduce((n, f) => n + take(f), 0) });
  for (const root of runRoots) scan(root, dirs(root).map((d) => path.join(d, 'telemetry.json')));
  const checks = path.join(repoRoot, '.claude', 'claim-checks');
  scan(checks, dirs(checks).map((d) => path.join(d, 'telemetry.json')));
  const plans = path.join(repoRoot, '.claude', 'plan-reviews');
  scan(plans, dirs(plans).flatMap((p) => dirs(p)).flatMap((round) => files(round).filter((f) => /\.telemetry\.json$/i.test(f)).map((f) => path.join(round, f))));
  const bench = path.join(repoRoot, 'bench', 'results');
  // A record beside a results file marked not_a_measurement is not read (G-10): the marker is the results file's.
  const measured = (f) => {
    const results = path.join(bench, f.replace(/\.telemetry\.json$/i, '.json'));
    try { return !notAMeasurement(owned(results)); } catch (e) { unreadable.push(`${results}: ${e.code ?? e.message}`); return false; }
  };
  scan(bench, files(bench).filter((f) => /\.telemetry\.json$/i.test(f) && measured(f)).map((f) => path.join(bench, f)));
  const suite = path.join(repoRoot, SUITE_RECORDS_DIR);
  scan(suite, files(suite).filter((f) => /\.json$/i.test(f)).map((f) => path.join(suite, f)));
  // THE DECISION PANEL'S DECISIONS (autonomous-run.plan.md stage 8): one record per `.claude/decisions/<id>/` holding an
  // outcome, built here from the files decide.mjs and io/decision-run.mjs write (buildDecisionRecord). A folder with no
  // outcome yet is a decision still running: not a record, not an error. A file that cannot be read is named.
  const decisions = path.join(repoRoot, DECISIONS_DIR);
  // An error isSelfReview rethrows is named, and no decision record is built on a guessed label (G-15 of
  // 20261104-223634-ar-d1-review: a bare catch here answered "not a self-review" to the error it rethrows on purpose).
  let selfReview = null;
  try { selfReview = isSelfReview(repoRoot); } catch (e) { unreadable.push(`${decisions}: self-review check failed: ${e.code ?? e.message}`); }
  let found = 0;
  for (const d of selfReview === null ? [] : dirs(decisions)) {
    const at = (...p) => path.join(d, ...p);
    const own = ownerBelow(d, repoRoot);
    const parts = {};
    let bad = null;
    // Each part through the decision folder's owner (G-9): a link at revote/, or at a file, is refused and named.
    for (const [k, segs] of [['first', ['outcome.json']], ['revote', ['revote', 'outcome.json']], ['overrule', ['overrule.json']], ['sample', ['sample.json']]]) {
      try { parts[k] = ownJson(own, segs); } catch (e) { bad = `${at(...segs)}: ${e.message}`; break; }
    }
    if (bad) { unreadable.push(bad); continue; }
    const { first, revote, overrule, sample } = parts;
    if (!first) continue;
    let rec;
    try { rec = buildDecisionRecord(path.basename(d), { first, revote, overrule, sample, selfReview }); } catch (e) {
      unreadable.push(`${at('outcome.json')}: ${e.message}`); continue;
    }
    found += 1;
    if (!keep || keep(rec)) records.push(rec);
  }
  locations.push({ where: decisions, found });
  return { records, locations, unreadable };
}
