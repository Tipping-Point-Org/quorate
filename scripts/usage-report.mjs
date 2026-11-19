#!/usr/bin/env node
// usage-report.mjs — how much of this repository's work went through quorate, and how much did not.
//
// WHY THIS EXISTS. The operator's claim is that the volume of decisions routed to a human is caused by
// missing structure, and that an active quorate should lower it. That is a measurable claim, and it was
// about to be argued from one side of the evidence only: 632 paired conversation turns of Claude's
// behaviour existed, and ZERO data on decisions made with quorate involved. "So any statement made lies
// on weak foundation" — correct, and this closes the half that was missing.
//
// NO NEW INSTRUMENTATION. Every fact below is already on disk: each run records `head_commit`,
// `base_commit` and `scope.paths` in run.json, the gate writes a verdict, the ledger records findings
// with provenance, and git records what was committed. A hook that logged usage would be a second
// source of truth about events the artifacts already describe — and the first thing to drift.
//
// WHAT IT CANNOT SAY, stated because a coverage number invites the wrong reading: a commit matched to a
// run was REVIEWED at that commit, not made correctly. And the transcript half counts what Claude did
// with its own prose, which is a heuristic over vocabulary, not a fact about intent.
//
//   node scripts/usage-report.mjs [--since <git-date>] [--transcripts <dir>] [--json]
//
// Exit codes: 0 reported · 2 usage.

import fs from 'node:fs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitSync } from './io/git.mjs';
import { confined } from './io/confined-path.mjs';
import { coverage, scopeMatcher, reachedGate, unproven } from './lib/reviewed-run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

function die(msg) {
  console.error(`usage-report: ${msg}`);
  process.exit(2);
}

const args = { since: '2026-08-01' };
{
  // ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md).
  let v;
  try { ({ values: v } = parseArgv(process.argv.slice(2), ARGV_SPECS['usage-report'])); } catch (e) { if (e instanceof ArgvError) die(e.message); throw e; }
  if (v.since !== undefined) args.since = v.since;
  if (v.transcripts !== undefined) args.transcripts = v.transcripts;
  if (v.json) args.json = true;
}

// A failure's first line, NEVER a parse error's message (G-10 of 20261031-013928-urr-delivery): Node's JSON.parse quotes
// the input around the fault, so a malformed ledger or run file put its own bytes into the report.
const why = (e) => (e instanceof SyntaxError ? 'not valid JSON (its bytes are not quoted here)' : String(e?.message ?? e).split('\n')[0]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const git = (...argv) => gitSync(argv, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// ------------------------------------------------------------------ what quorate did
const reviewsDir = path.join(REPO, '.claude', 'reviews');
const runs = [];
// RUNS THAT COULD NOT BE READ, named in the report (G-21 of 20261030-171256-ciss-c-review): readRun's catch returned
// undefined and the run was skipped like an absent one, so a refused or malformed run shrank every figure with no word.
const unreadable = [];
try {
  const reviewsOwner = confined(reviewsDir);
  // LISTED THROUGH ITS OWNER (G-11 of 20261102-220302-rbr-remediation-5-review): a raw readdirSync followed a link or
  // junction at the reviews folder, and the names in its target reached the report as unreadable runs.
  for (const name of reviewsOwner.list([])) {
    // A run's files through its owner (G-8 of 20261030-153323-ciss-s7-remediation-2-review): a link at run.json, gate.json
    // or nodes/adjudication.json is refused, and that file counted as unreadable, never followed into the figures.
    let isDir;
    try { isDir = reviewsOwner.stat([name]).isDirectory(); } catch (e) { unreadable.push({ run: name, file: '.', why: why(e) }); continue; }
    if (!isDir) continue; // ledger.json and any other file beside the runs
    // ABSENT IS ITS OWN VALUE (G-10, G-11 of 20261031-033859-urr-remediation-2-review): absence returned `null`, so a file
    // holding the JSON `null` (or any falsy JSON, under the truthiness checks below) read as absent and was never recorded.
    const ABSENT = Symbol('absent');
    // THROUGH THE REVIEWS FOLDER'S OWNER (G-10 of 20261031-033859-urr-remediation-2-review): a second owner rooted at a
    // joined path made the run directory a root no one had checked; below reviewsOwner the run's own level is lstat'ed too.
    // ONE READ PER FILE (G-12 of 20261102-220302-rbr-remediation-5-review): an exists probe before each read walked the
    // owner's levels twice; a missing file is the read's ENOENT.
    const readRun = (segs) => { try { return JSON.parse(reviewsOwner.read([name, ...segs])); } catch (e) { if (e?.code === 'ENOENT') return ABSENT; unreadable.push({ run: name, file: segs.join('/'), why: why(e) }); return undefined; } };
    const j = readRun(['run.json']);
    if (j === undefined || j === ABSENT) continue;
    // A RUN RECORD IS AN OBJECT (G-10): `false`, `0` or `""` was dropped unrecorded, and an array or number counted as a run.
    if (!isObject(j)) { unreadable.push({ run: name, file: 'run.json', why: 'not an object' }); continue; }
    const gateRead = readRun(['gate.json']);
    // A gate.json that is not an object is unreadable too, as a malformed one is, and the run reached no gate it can show.
    if (gateRead !== ABSENT && gateRead !== undefined && !isObject(gateRead)) unreadable.push({ run: name, file: 'gate.json', why: 'not an object' });
    const gate = isObject(gateRead) ? gateRead : null;
    const adjRead = readRun(['nodes', 'adjudication.json']);
    let adjudication = adjRead === ABSENT || adjRead === undefined ? null : adjRead;
    // GROUPS THAT ARE NOT A LIST ARE UNREADABLE (G-8 of 20261031-013928-urr-delivery): `.filter` on an object crashed the
    // whole report. AND EACH GROUP AN OBJECT, IN AN OBJECT THAT HAS THEM (G-12, G-13 of 20261031-022756-urr-remediation-review):
    // a top-level array or a missing `groups` counted as zero disputes, and `groups: [null]` crashed at g.outcome. A FILE THAT
    // WAS READ is checked whatever it holds (G-11): the guard began `adjudication &&`, so falsy JSON counted as zero disputes.
    if (adjRead !== ABSENT && adjRead !== undefined && (!isObject(adjudication) || !Array.isArray(adjudication.groups) || !adjudication.groups.every(isObject))) {
      unreadable.push({ run: name, file: 'nodes/adjudication.json', why: 'not an object with a list of groups' });
      adjudication = null;
    }
    runs.push({
      run_id: j.run_id ?? name,
      head: j.head_commit ?? null,
      dirty: j.dirty ?? null,
      scope: j.scope?.paths ?? [],
      stamps: j.stamps ?? [],
      // A run that never reached a gate is a run that decided nothing — counted separately, because
      // treating it as coverage is the "silence is not a verdict" error in the metric layer.
      verdict: gate?.gate ?? null,
      disputes: adjudication ? adjudication.groups.length : 0,
      decided: adjudication ? adjudication.groups.filter((g) => g.outcome === 'decided').length : 0,
    });
  }
} catch (e) {
  // No reviews directory: a repository that has never run it. Any other failure is not "never ran" (G-21). A refused
  // reviews folder (a link or junction at it, G-11) is named as unreadable, as the ledger behind it is, and no run counted.
  if (e?.code === 'ECONFINED') unreadable.push({ run: '.', file: '.', why: why(e) });
  else if (e?.code !== 'ENOENT') die(`cannot read ${reviewsDir}: ${String(e?.message ?? e).split('\n')[0]}`);
}

// ------------------------------------------------------------------ what was committed
// ONE git traversal for every commit and its files (G-22 of 20261030-171256-ciss-c-review: a `git show` per commit was one
// process per unreviewed commit; G-14 of 20261031-022756-urr-remediation-review: a second `git log` walked the same
// history again for the names). Each record is \x1e, then sha\x1fdate\x1fsubject, then its files one per line.
const log = git('log', '--since', args.since, '--name-only', '--format=%x1e%H%x1f%ad%x1f%s', '--date=short');
if (log.status !== 0) die('git log failed — is this a git repository?');
const commits = [];
const filesBySha = new Map();
for (const block of log.stdout.split('\x1e').filter((b) => b.trim())) {
  const [head, ...rest] = block.split('\n');
  const [sha, date, subject] = head.split('\x1f');
  commits.push({ sha, date, subject });
  filesBySha.set(sha, rest.map((l) => l.trim()).filter(Boolean));
}

// ONLY A RUN THAT REACHED A GATE reviewed its commit (G-16 of 20261030-190926-ciss-remaining): an aborted run decided
// nothing, and counting its head_commit made silence coverage. Its scope is not a swept area either (G-5 of
// 20261030-195117-ciss-remaining-remediation-review): the G-16 fix filtered only the commits. Nor does a BLOCKED one, and
// a dirty run credits no commit (G-1 of 20261030-211052-usage-report-98-review); lib/reviewed-run.mjs owns the rule.
const { reviewedShas, scopePrefixes } = coverage(runs);

// A commit is "in a swept area" when at least one file it touched sits under a path some run declared.
// Weaker than review — it says the area was looked at some time, not that this change was. The scopes are built into one
// matcher once (G-11 of 20261031-022756-urr-remediation-review), not again for every file.
const inSweptScope = scopeMatcher(scopePrefixes);
function touchedSweptArea(sha) {
  const files = filesBySha.get(sha) ?? [];
  return files.some((f) => inSweptScope(f));
}

const reviewedAtCommit = commits.filter((c) => reviewedShas.has(c.sha));
const inSweptArea = commits.filter((c) => !reviewedShas.has(c.sha) && touchedSweptArea(c.sha));

// ------------------------------------------------------------------ the ledger's provenance split
let ledger = { entries: {} };
// ABSENT IS "NONE YET"; ANYTHING ELSE IS REPORTED (G-23 of 20261030-171256-ciss-c-review): every read or parse failure was
// swallowed as an empty ledger, so a damaged one printed a plausible zero.
let ledgerError = null;
// THROUGH THE OWNER (usage-report-reviewed-runs.plan.md stage 3; G-9 of 20261030-221015-usage-report-99-review): a raw
// read followed a link at ledger.json, and the parse error quoted the linked file's bytes. A link is refused and named.
try {
  // THE FOLDER AS NAMED, never its real path (G-7 of 20261102-211111-rbr-remediation-4-review): realpathSync resolved a
  // link or junction at the reviews folder before the owner's root check could see it. reviewsDir is absolute.
  const parsed = JSON.parse(confined(reviewsDir).read(['ledger.json']));
  // VALID JSON OF THE WRONG SHAPE IS UNREADABLE TOO (G-13 of 20261030-174958-ciss-c-remediation-review): `null` crashed
  // the report, and a string's characters were counted as entries. EACH ENTRY TOO (G-16 of
  // 20261031-022756-urr-remediation-review): `{entries: {x: null}}` crashed the report at e.first_seen.
  if (!isObject(parsed) || (parsed.entries !== undefined && !(isObject(parsed.entries) && Object.values(parsed.entries).every(isObject)))) {
    throw new Error('ledger.json is not an object with an object of entries, each an object');
  }
  ledger = parsed;
} catch (e) {
  if (e?.code === 'ECONFINED') ledgerError = 'refused: a link or junction stands at ledger.json, and nothing is read through one';
  else if (e?.code !== 'ENOENT') ledgerError = why(e);
}
const entries = Object.values(ledger.entries ?? {});
const byProvenance = { lens: 0, observed: 0 };
for (const e of entries) {
  if (String(e.first_seen ?? '').startsWith('observed-')) byProvenance.observed++;
  else byProvenance.lens++;
}

// ------------------------------------------------------------------ the dependence half
// Counted from the session transcripts when they are available. HEURISTIC, and the vocabulary lists are
// the judgement: a closing move is classified by how my last lines read, and your reply by whether it
// is assent alone. It is here so the two halves of the operator's claim can be read side by side —
// quorate usage going up and asking going down is the whole hypothesis.
const OFFERED_CHOICE = /\b(option\s*[12ab]|which (one|of|would)|\b1\)|\b2\)|either .* or |or should i)\b/i;
const ASKED_PERMISSION = /\b(want me to|shall i|should i|do you want|proceed\?|go ahead|ok to |may i|say the word)\b/i;
const ASSENT_ONLY = /^(y|yes|yep|ok|okay|sure|go|go ahead|continue|proceed|do it|push( it)?|next|1|2|a|b|both)[\s.!]*$/i;

function dependence(dir) {
  let owner;
  let files;
  // A DIRECTORY THE OPERATOR NAMED AND THAT COULD NOT BE READ IS REPORTED (G-19 of 20261030-190926-ciss-remaining): it
  // returned null, the half vanished, and the report asked for the option the operator had just passed.
  // THROUGH THE OWNER, ROOTED AT THAT FOLDER (usage-report-reviewed-runs.plan.md stage 3): a transcript link was followed.
  try {
    // THE FOLDER AS NAMED, never its real path (G-8 of 20261102-211111-rbr-remediation-4-review): realpathSync resolved a
    // link or junction at the --transcripts folder before the owner's root check could see it.
    owner = confined(path.resolve(dir));
    files = owner.list([]).filter((f) => f.endsWith('.jsonl'));
  } catch (e) {
    return { asked: null, assent_only: null, informative: null, reports: null, malformed_lines: null,
      transcripts_unreadable: String(e?.message ?? e).split('\n')[0] };
  }
  let asked = 0;
  let assent = 0;
  let reports = 0;
  // Counted, not dropped (G-20): a damaged transcript otherwise gives plausible, understated figures.
  let malformed = 0;
  // A transcript that cannot be read is recorded and the rest are read (G-10 of 20261030-221015-usage-report-99-review).
  const unreadableFiles = [];
  for (const f of files) {
    // PER TRANSCRIPT (G-8 of 20261030-195117-ciss-remaining-remediation-review): carried across files, a reply ending one
    // session was paired with the first message of the next.
    let last = null;
    // PER-FILE COUNTS, added to the totals only once the whole file was read (G-13 of
    // 20261031-033859-urr-remediation-2-review): a read that failed partway left its earlier pairs in the totals.
    let fAsked = 0;
    let fAssent = 0;
    let fReports = 0;
    let fMalformed = 0;
    // LINE BY LINE (G-3 of 20261030-211052-usage-report-98-review): a transcript was read whole and split, unbounded.
    const onLine = (line) => {
      if (!line.trim()) return;
      let ev;
      // The pending reply ends here too (G-17 of 20261031-022756-urr-remediation-review): kept, it was paired with a
      // message across an event nobody could read.
      try { ev = JSON.parse(line); } catch { fMalformed++; last = null; return; }
      const msg = ev.message ?? ev;
      const content = msg?.content;
      if (msg?.role === 'assistant') {
        for (const c of Array.isArray(content) ? content : []) {
          if (c?.type === 'text' && (c.text ?? '').trim()) last = c.text;
        }
      }
      if (msg?.role !== 'user') return;
      const human = typeof content === 'string' ? content
        : (Array.isArray(content) && content.every((c) => c?.type === 'text')
          ? content.map((c) => c.text).join('\n') : null);
      // NOT PLAIN TEXT, NOT AN ANSWER (usage-report-followup.plan.md stage 3; G-19 of 20261031-055840): a tool result or a
      // mixed event left the pending reply standing, and the next text message was paired with it.
      if (human === null) { last = null; return; }
      if (/^<(command-name|local-command|system-reminder)/.test(human.trim())) { last = null; return; }
      if (last) {
        // THE LAST FOUR NON-EMPTY LINES, found from the end (G-12 of 20261031-033859-urr-remediation-2-review): the whole
        // reply was split and filtered on every pair to keep four lines.
        const tailLines = [];
        for (let end = last.length; end > 0 && tailLines.length < 4;) {
          const start = last.lastIndexOf('\n', end - 1) + 1;
          const line = last.slice(start, end).trim();
          if (line) tailLines.unshift(line);
          end = start - 1;
        }
        const tail = tailLines.join(' ');
        const isAsk = OFFERED_CHOICE.test(tail) || ASKED_PERMISSION.test(tail) || /\?\s*$/.test(tail);
        if (isAsk) { fAsked++; if (ASSENT_ONLY.test(human.trim())) fAssent++; } else fReports++;
      }
      last = null;
    };
    try {
      owner.readLines([f], onLine);
      asked += fAsked; assent += fAssent; reports += fReports; malformed += fMalformed;
    } catch (e) {
      // {file, reason}, the I-11 contract's shape (G-11 of 20261031-013928-urr-delivery).
      unreadableFiles.push({ file: f, reason: e?.code === 'ECONFINED'
        ? 'refused: a link or junction stands at it, and nothing is read through one' : why(e) });
    }
  }
  return { asked, assent_only: assent, informative: asked - assent, reports, malformed_lines: malformed, unreadable_files: unreadableFiles };
}

const dep = args.transcripts ? dependence(args.transcripts) : null;

// ------------------------------------------------------------------ report
const report = {
  since: args.since,
  quorate: {
    runs: runs.length,
    unreadable,
    reached_a_gate: runs.filter(reachedGate).length,
    verdicts: runs.reduce((acc, r) => {
      if (reachedGate(r)) acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
      return acc;
    }, {}),
    disputes_adjudicated: runs.reduce((n, r) => n + r.disputes, 0),
    disputes_decided: runs.reduce((n, r) => n + r.decided, 0),
  },
  commits: {
    total: commits.length,
    reviewed_at_that_commit: reviewedAtCommit.length,
    in_a_swept_area_but_not_reviewed: inSweptArea.length,
    never_in_any_run_scope: commits.length - reviewedAtCommit.length - inSweptArea.length,
  },
  // COUNTED AND SAID, never dropped in silence (usage-report-reviewed-runs.plan.md stage 2; G-6, G-14 of
  // 20261030-221015-usage-report-99-review): a reviewed run recorded dirty, or with no dirty flag, credits no commit,
  // so while either count is above zero the reviewed-at figure counts only what clean runs prove, and is unverified.
  coverage: (() => {
    const u = unproven(runs);
    return { dirty_runs: u.dirty, dirty_unknown_runs: u.unknown, reviewed_at_that_commit: u.dirty || u.unknown ? 'unverified' : 'proven' };
  })(),
  findings: ledgerError
    ? { total: null, from_a_lens: null, observed_by_hand: null, ledger_unreadable: ledgerError }
    : { total: entries.length, from_a_lens: byProvenance.lens, observed_by_hand: byProvenance.observed },
  dependence: dep,
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
console.log(`usage-report — since ${args.since}\n`);
console.log(`quorate runs                       ${report.quorate.runs}`);
if (unreadable.length) {
  console.log(`  NOT COUNTED, unreadable          ${unreadable.length}   (the figures below leave these out)`);
  for (const u of unreadable) console.log(`    ${u.run}/${u.file}: ${u.why}`);
}
console.log(`  reached a gate                   ${report.quorate.reached_a_gate}`
  + `   ${JSON.stringify(report.quorate.verdicts)}`);
console.log(`  disputes adjudicated / decided   ${report.quorate.disputes_adjudicated}`
  + ` / ${report.quorate.disputes_decided}`);
console.log('');
console.log(`commits                            ${report.commits.total}`);
console.log(`  reviewed AT that commit          ${report.commits.reviewed_at_that_commit}`
  + `   ${pct(report.commits.reviewed_at_that_commit, report.commits.total)}`
  + (report.coverage.reviewed_at_that_commit === 'unverified'
    ? '   unverified: only commits a clean run proves, the reviewed runs below credit none' : ''));
// Both counts always, zero included (G-12 of 20261031-013928-urr-delivery): a zero left out reads as never counted.
console.log(`    reviewed runs dirty when reviewed   ${report.coverage.dirty_runs}`);
console.log(`    reviewed runs, no dirty flag recorded ${report.coverage.dirty_unknown_runs}`);
console.log(`  in a swept area, not reviewed    ${report.commits.in_a_swept_area_but_not_reviewed}`);
console.log(`  never in any run's scope         ${report.commits.never_in_any_run_scope}`
  + `   ${pct(report.commits.never_in_any_run_scope, report.commits.total)}`);
console.log('');
if (ledgerError) console.log(`findings on the ledger             UNREADABLE — ${ledgerError}`);
else console.log(`findings on the ledger             ${report.findings.total}`
  + `   (lens ${report.findings.from_a_lens} · observed ${report.findings.observed_by_hand})`);
if (dep?.transcripts_unreadable) {
  console.log(`\ndependence (heuristic, from transcripts)   UNREADABLE — ${dep.transcripts_unreadable}`);
} else if (dep) {
  console.log('');
  console.log(`dependence (heuristic, from transcripts)`);
  console.log(`  replies that ended in an ask     ${dep.asked}`);
  console.log(`    answered with assent alone     ${dep.assent_only}   ${pct(dep.assent_only, dep.asked)}`);
  console.log(`    answered with information      ${dep.informative}   ${pct(dep.informative, dep.asked)}`);
  console.log(`  replies that just reported       ${dep.reports}`);
  if (dep.malformed_lines) console.log(`  NOT COUNTED, malformed lines     ${dep.malformed_lines}   (the figures above leave these out)`);
  if (dep.unreadable_files?.length) {
    console.log(`  NOT COUNTED, unreadable files    ${dep.unreadable_files.length}   (the figures above leave these out)`);
    for (const u of dep.unreadable_files) console.log(`    ${u.file}: ${u.reason}`);
  }
} else {
  console.log('\n(pass --transcripts <dir> to include the dependence half)');
}
console.log('\nWhat this cannot say: a commit matched to a run was REVIEWED at that commit, not made');
console.log('correctly, and the dependence figures are vocabulary heuristics rather than facts about');
console.log('intent. Both halves are here so the claim "structure lowers the asking" can be checked');
console.log('over time rather than asserted once.');
