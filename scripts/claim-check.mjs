#!/usr/bin/env node
// claim-check.mjs — the mechanical half of the claim-check skill (.claude/requests/claim-check.md).
//
//   node <framework-root>/scripts/claim-check.mjs --new <slug>    make a check directory, print its path
//   node <framework-root>/scripts/claim-check.mjs <check-dir>     apply the rules to <dir>/result.json
//
// A check directory holds `draft.md` (the report, written before it is sent), `result.json` (what the
// checker subagent returned) and, after this runs, `checked.json` and `checked.md`. It lives under
// `.claude/claim-checks/`, which is gitignored: the draft and the checker's answer are model text,
// and what reaches git is cited from a tracked file by path rather than copied into one.
//
// This script does not call a model. It refuses a result of the wrong shape, recomputes each grade —
// `observed` survives only with a citation that resolves — and turns claims about the operator into
// questions. Exit: 0 applied · 1 the result was refused (for --new: git would not ignore the directory) · 2 usage, or
// not a repository.
//
//   node <framework-root>/scripts/claim-check.mjs <check-dir> --check [--transcript <session.jsonl>]
//
// RUNS THE CHECKER (claim-check-cross-family.plan.md stage 4), writing `result.json` and `check.json` for the rules step
// above. The panel off: a checker on the node runtime through spawn-subagent.mjs, same-family. The panel on: the roster's
// `claim_checker` through `external-review --mode claim-check`, standing in the arms' snapshot (--surface), with the
// transcript redacted into it under `review.claim_check_transcript: cross-family`; under `same-family` the arm never sees
// it, and a same-family checker given it grades the attributions (mergeAttributionCheck). Exit 0 checked · 1 a checker failed · 2 usage · 3 nested (§8).
import fs from 'node:fs';
import { appendRecord } from './io/torn-tail.mjs';
import { parseArgv, ArgvError } from './lib/argv.mjs';
import { ARGV_SPECS } from './lib/argv-specs.mjs';
import { runtimeBinArg, runtimeBinArgv } from './io/runtime-bin.mjs';
import { egress, egressReadFile, egressRootOf } from './io/egress-read.mjs';
import { nodeDepth } from './lib/node-depth.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyClaimRules, renderChecked, claimCheckTranscriptOf, mergeAttributionCheck } from './io/claim-check.mjs';
import { writeJsonAtomic, writeTextAtomic } from './io/atomic.mjs';
import { writeClaimCheckRecord, subagentRecordPath } from './io/telemetry-record.mjs';
import { errorLine } from './lib/command-log.mjs';
import { markAnswered } from './lib/call-entry.mjs';
import { readContract } from './io/contract-reader.mjs';
import { redactedTranscriptCopy } from './io/transcript-copy.mjs';
import { buildArmsSurface, armsBuildDir, reclaimArmsRoot } from './io/snapshot.mjs';
import { quorateHome } from './io/reviews-root.mjs';
import { hostProc } from './platform/index.mjs';
import { selectAdapters, subagentNotices } from './io/reviewers.mjs';
import { panelSnapshotMaxBytes } from './lib/snapshot-surface.mjs';
import { buildClaimCheckArmPrompt, buildClaimCheckSameFamilyBrief } from './io/review-prompts.mjs';
import { gitSync } from './io/git.mjs';
import { relativeBelow } from './io/finding-scope.mjs';
import { confined } from './io/confined-path.mjs';

// ONE PARSER, lib/argv.mjs's, against this script's spec in lib/argv-specs.mjs (entrypoint-argv.plan.md): refused before
// anything is asked of git, naming the flag. The check directory is the first bare argument.
let parsed;
try { parsed = parseArgv(process.argv.slice(2), ARGV_SPECS['claim-check']); } catch (e) {
  if (!(e instanceof ArgvError)) throw e;
  console.error(`claim-check: ${e.message}`);
  process.exit(2);
}
const top = gitSync(['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (top.status !== 0) {
  console.error('claim-check: not inside a git repository');
  process.exit(2);
}
const repoRoot = path.resolve(top.stdout.trim());
const { values: opts, positionals } = parsed;
const checksRoot = path.join(repoRoot, '.claude', 'claim-checks');
// The files the modes below write into a check directory; external-review's evidence lands there too, under its own names.
// ONE INVENTORY (G-4 of 20261025-235636-tel-remediation-5-review): CHECK_OUTPUTS are what a check produced, which --check
// removes before a checker starts; CHECK_FILES adds the draft and the inputs each check rewrites, all of which --new asks git.
// The check's step journal (runtime-call-telemetry.plan.md stage 4): one entry per step, its record built from it.
const STEP_JOURNAL = 'steps.jsonl';
const CHECK_OUTPUTS = ['arm.json', 'same-family.json', 'same-family.envelope.json', 'same-family.envelope.telemetry.json',
  'result.json', 'check.json', 'checked.json', 'checked.md', 'telemetry.json', STEP_JOURNAL];
const CHECK_FILES = ['draft.md', 'arm-prompt.md', 'same-family-brief.md', 'transcript.redacted.jsonl', 'transcript.json',
  ...CHECK_OUTPUTS];

/**
 * A CHECK DIRECTORY IS ONE UNDER .claude/claim-checks/ (G-3 of 20261019-042251-review-review): the path a mode was given
 * was resolved and used as it stood, so --check deleted six fixed names, and the rules step wrote two, in any directory
 * holding a draft.md or result.json. Both paths are resolved through their links before they are compared.
 */
function checkDirOf(arg, usage) {
  if (!arg || arg.startsWith('--')) { console.error(usage); process.exit(2); }
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
  const dir = path.resolve(arg);
  const root = real(checksRoot);
  const at = real(dir);
  // Strictly below the checks root, by containment's one owner and the host's case rule (link-leaving-owner.plan.md stage
  // 4; design divergence 9): a hand-rolled path.relative and startsWith('..') beside the owner is the class it ends.
  if (!root || !at || !relativeBelow(root, at)) {
    console.error(`claim-check: ${arg} is not a check directory: it must be a directory under ${checksRoot}, as --new makes one`);
    process.exit(2);
  }
  // The path that was checked, not the one that was given (G-4 of 20261025-211318-tel-remediation-review): a link in the
  // given path retargeted after the check would otherwise redirect every later read and write out of the checks root.
  return at;
}

if (opts.new !== undefined) {
  const slug = String(opts.new).trim();
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) {
    console.error('claim-check: --new needs a slug of lowercase letters, digits and dashes');
    process.exit(2);
  }
  const now = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}`
    + `-${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}`;
  // EXCLUSIVE creation (G-2 of 20260926-044637-m0-close-r2): a recursive mkdir succeeds on a directory
  // that exists, so two same-slug checks in one second shared a draft. The parent is made recursively;
  // the check directory itself must be new, and a taken name gets a numeric suffix.
  // MADE THROUGH THE OWNER (G-7 of 20261122-193909-llo-delivery): a raw recursive mkdir followed a link at .claude or at
  // .claude/claim-checks, and the .gitignore below was written through it, outside the repository. `confined`, rooted at
  // the repository's real path, refuses a link at either level before anything is written.
  let parent;
  try { parent = confined(fs.realpathSync(repoRoot)).dir(['.claude', 'claim-checks']); } catch (e) {
    console.error(`claim-check: ${path.join(repoRoot, '.claude', 'claim-checks')} cannot be used for a check directory: ${e?.message ?? e}`);
    process.exit(2);
  }
  // THE DIRECTORY IGNORES ITSELF. "Gitignored" above held only in quorate's own repository: in a
  // consumer nothing ignored .claude/claim-checks/, so a draft and a checker's answer (model text) sat
  // untracked one `git add` from a commit (story-pipeline, 2026-10-06). A `*` .gitignore inside it holds
  // in any repository; an existing one is the repository's own choice and is left alone.
  const ignoreFile = path.join(parent, '.gitignore');
  if (!fs.existsSync(ignoreFile)) {
    writeTextAtomic(ignoreFile, '# Written by quorate claim-check: drafts and checker answers are model text, never committed.\n*\n');
  }
  let dir = null;
  for (let i = 1; i <= 100 && !dir; i++) {
    const candidate = path.join(parent, `${stamp}-${slug}${i === 1 ? '' : `-${i}`}`);
    try { fs.mkdirSync(candidate); dir = candidate; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  if (!dir) { console.error(`claim-check: 100 directories named ${stamp}-${slug} already exist`); process.exit(2); }
  // ASKED OF GIT, not assumed from the file just written: a repository's own .gitignore can re-include
  // the path, and the claim that this is model text kept out of git is the one being made.
  // REFUSED, NOT WARNED (G-2 of 20261019-033102-review-review): a warning left the directory one `git add` from a
  // commit, so the claim was never enforced. The directory is removed and no path is printed.
  // EVERY FILE IT WILL HOLD, NOT draft.md ALONE (G-2 of 20261019-042251-review-review): a rule naming the draft passed while
  // result.json and the transcript copy stayed addable. The directory itself is asked, which covers a name not listed here
  // (git does not descend into an ignored directory), and so is each file the modes below write.
  const ignored = [dir, ...CHECK_FILES.map((f) => path.join(dir, f))]
    .every((p) => gitSync(['check-ignore', '-q', p], { cwd: repoRoot }).status === 0);
  if (!ignored) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.error(`claim-check: ${path.relative(repoRoot, dir)} is NOT ignored by git here, so it was removed; `
      + 'its draft and checker answer are model text and must not be committed — make git ignore .claude/claim-checks/');
    process.exit(1);
  }
  console.log(dir);
  process.exit(0);
}

if (opts.check) await runCheck();

const RULES_USAGE = 'usage: claim-check.mjs --new <slug> | claim-check.mjs <check-dir containing result.json>';
const dir = checkDirOf(positionals[0], RULES_USAGE);
if (!fs.existsSync(path.join(dir, 'result.json'))) {
  console.error(RULES_USAGE);
  process.exit(2);
}

let result;
try {
  result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
} catch (e) {
  result = null;
  console.error(`claim-check: result.json is not JSON (${e.message})`);
}
const checked = applyClaimRules(result, { repoRoot });
const draft = path.join(dir, 'draft.md');
writeJsonAtomic(path.join(dir, 'checked.json'), checked);
// check.json, when --check wrote one, says who checked and what was sent (stage 5); absent, checked.md says so.
let checkInfo = null;
try { checkInfo = JSON.parse(fs.readFileSync(path.join(dir, 'check.json'), 'utf8')); } catch { /* absent: said in checked.md */ }
writeTextAtomic(path.join(dir, 'checked.md'), renderChecked(checked, {
  draftPath: fs.existsSync(draft) ? path.relative(repoRoot, draft).split(path.sep).join('/') : null,
  check: checkInfo,
}));
// THE CHECK'S TELEMETRY RECORD (telemetry-records.plan.md stage 3), refused results included: a checker that ran and
// answered badly still spent its time and tokens. One that cannot be built is a note, never a failed check.
{
  const tel = writeClaimCheckRecord(dir, { repoRoot });
  if (!tel.ok) console.error(`claim-check: ${tel.note}`);
}

if (!checked.ok) {
  console.error(`claim-check: the checker's result was refused (${checked.errors.length} problem(s)):`);
  for (const e of checked.errors) console.error(`  - ${e}`);
  process.exit(1);
}
const s = checked.summary;
console.log(`claim-check: ${checked.claims.length} claim(s) — ${s.stands} stand, ${s.dissolved} dissolved, `
  + `${s.downgrade} downgraded, ${s['ask-operator']} to ask the operator; ${s.inferred} inferred`);
console.log(`             ${path.join(dir, 'checked.md')}`);

async function runCheck() {
  // THE RECURSION GUARD, for this mode only: it starts a model, and a graph node may not (§8). The other two modes parse
  // and write files, and start nothing.
  const { raw: RAW_DEPTH, depth: PARSED_DEPTH } = nodeDepth(process.env);
  const DEPTH = PARSED_DEPTH ?? NaN;
  if (!Number.isInteger(DEPTH) || DEPTH < 0) {
    console.error(`ABORT: GRAPH_NODE_DEPTH=${JSON.stringify(RAW_DEPTH)} is not a non-negative integer — refusing to guess whether this is nested (§8).`);
    process.exit(3);
  }
  if (DEPTH > 0) {
    console.error(`ABORT: GRAPH_NODE_DEPTH=${DEPTH} — a graph node may not run a claim checker (§8).`);
    process.exit(3);
  }
  const fail = (msg, code = 1) => { console.error(`claim-check: ${msg}`); process.exit(code); };
  const dir = checkDirOf(positionals[0], 'usage: claim-check.mjs <check-dir> --check [--transcript <file>]');
  const transcript = opts.transcript ?? null;
  // The node runtime's binary override, --runtime-bin, through the pair's one owner (its old spelling an alias).
  let runtimeBin;
  try { runtimeBin = runtimeBinArg(opts); } catch (e) { fail(e.message, 2); }
  const draftPath = path.join(dir, 'draft.md');
  // THE DRAFT THROUGH THE EGRESS OWNER (hardlink-egress.plan.md stage 2; it replaces this site's own guard, G-8 of
  // 20261111-224124-runtime-bin-d1-review and G-4 of 20261111-232547-runtime-bin-remediation-4-review): a link, a junction
  // or a file with a second name is refused, exit 2, before a checker starts. What the owner read is what the cross-family
  // checker's surface gets (below), so nothing is read again between the check and the copy.
  let draftText;
  try { draftText = egressReadFile(draftPath, 'utf8', { repoRoot }); } catch (e) {
    if (e?.code === 'ENOENT') fail(`${draftPath} does not exist: write the draft first`, 2);
    fail(`${draftPath} is refused: ${e.message}`, 2);
  }
  // THE TRANSCRIPT TOO: it is copied, redacted, where the cross-family checker reads it, so the same owner refuses it
  // here, before a checker starts (its copy reads it through the owner again, io/transcript-copy.mjs).
  if (transcript) {
    // Rooted at the repository for an in-repository transcript, as the draft is (G-2 of 20261112-054852-hl-remediation-3-review).
    try { const t = egressRootOf(path.resolve(transcript), repoRoot); egress(t.root).stat(t.segments); } catch (e) {
      if (e?.code === 'ENOENT') fail(`--transcript ${transcript} does not exist`, 2);
      fail(`--transcript ${transcript} is refused: ${e.message}`, 2);
    }
  }
  // NO EARLIER CHECK STANDS IN FOR THIS ONE (G-3 of 20261019-014448-ccf-delivery; G-6 of 20261019-033102-review-review):
  // every file a previous --check or rules step wrote is removed before a checker starts, so a check that fails leaves
  // nothing that reads as current — not arm.json alone, which left result.json, check.json and checked.md standing. The
  // same-family checker's envelope and the telemetry records go too (G-5 of 20261025-215217-tel-remediation-2-review): the
  // check's record reads that envelope, so a stale one counted a checker task this check never ran.
  for (const f of CHECK_OUTPUTS) fs.rmSync(path.join(dir, f), { force: true });

  const scripts = path.dirname(fileURLToPath(import.meta.url));
  // THROUGH THE EGRESS OWNER (G-2 of 20261112-050334-hl-review-b): the instructions go into both checkers' prompts, so a
  // link or a file with a second name is refused, checked from the framework's own folder.
  let checker;
  try { checker = egressReadFile(path.join(scripts, '..', 'skills', 'claim-check', 'CHECKER.md'), 'utf8', { repoRoot: path.join(scripts, '..') }); } catch (e) {
    fail(`the checker's instructions are refused: ${e.message}`, 2);
  }
  const read = readContract({ repoRoot });
  if (!read.contract) fail(`no contract to read the panel and the transcript setting from: ${read.error ?? read.message ?? 'graph_contract absent'}`, 2);
  const review = read.contract.review ?? {};
  const panel = review.external_panel === true;
  let setting;
  try { setting = claimCheckTranscriptOf(review); } catch (e) { fail(e.message, 2); }
  const resultPath = path.join(dir, 'result.json');

  // THE SAME-FAMILY CHECKER IS NAMED BY THE NODE RUNTIME IT RUNS ON, from the adapter table, never a vendor literal here
  // (A-9; G-8/G-10 of 20261019-014448-ccf-delivery): moving the node runtime moves the label with it.
  // Chosen by the one owner (contract-runtime-and-session-files.plan.md stage 1): review.runtime, else the table's default,
  // the runtime spawn-subagent runs the checker on.
  let sameRuntime;
  try { sameRuntime = selectAdapters({ contract: read.contract }).runtime; } catch (e) { fail(e.message, 2); }
  // THE STEP JOURNAL (runtime-call-telemetry.plan.md stage 4; design CR-D1: "B with a 'total' record as suggested by A"):
  // once a checker is about to start, every step appends its entry to steps.jsonl when it ends, failed or not, and an exit
  // handler writes the check's record as the total of the journal, whatever ends the process (success, a failure, an
  // uncaught throw). Nothing routes a failure to a writer by hand, so no exit can skip the record; a kill runs no handler and
  // loses the record, which shared/telemetry.md allows. A failed check still writes no check.json (G-6 above): only the
  // journal and the record say what happened. A failure before any checker starts spent nothing and writes no record.
  const journalPath = path.join(dir, STEP_JOURNAL);
  let journalOpen = false;
  // On a line of its own after a torn tail (G-3 of 20261106-022028-stoplog-g8-remediation-2-review), the tail check and the
  // append under the record lock through appendRecord (stop-record-bounds-and-kill-log.plan.md stage 1; G-2 of
  // 20261106-061604-srb-delivery: unlocked, it was neither locked nor named a single writer). One process writes the
  // journal, so the lock is never contended; a record it still could not lock is an error, never a silent skip.
  const journal = (entry) => { if (!appendRecord(journalPath, `${JSON.stringify(entry)}\n`)) throw new Error(`the step journal's record lock is held: ${journalPath}`); };
  const openJournal = (family) => {
    if (journalOpen) return;
    journalOpen = true;
    journal({ step: 'start', task: null, panel, setting, family, same_runtime: sameRuntime, at: new Date().toISOString() });
    process.on('exit', (code) => {
      try { journal({ step: 'end', task: null, exit_code: code, at: new Date().toISOString() }); } catch { /* the record says what it has */ }
      const tel = writeClaimCheckRecord(dir, { repoRoot });
      if (!tel.ok) console.error(`claim-check: ${tel.note}`);
    });
  };
  // One step: timed, its entry appended when it ends, its error kept as one redacted line (lib/command-log's errorLine).
  // `task` is the checker a failure of this step is charged to, or null for a step of the check itself.
  const runStep = (step, task, body, extra = () => ({})) => {
    const startedMs = Date.now();
    const end = (outcome, error = null) => journal({ step, task, outcome, started_at: new Date(startedMs).toISOString(),
      ended_at: new Date().toISOString(), duration_ms: Date.now() - startedMs, ...(error ? { error: errorLine(error) } : {}), ...extra() });
    let v;
    try { v = body(); } catch (e) { end('failed', String(e?.message ?? e)); throw e; }
    end('ok');
    return v;
  };
  const relaySubagentNotices = (stderr) => { for (const l of subagentNotices(stderr)) console.error(l); };
  const SAME_ID = 'claim-checker-same-family';
  // The same-family checker's call, then its answer read, each its own step charged to it. Its call's entry is the one
  // spawn-subagent wrote beside its envelope (design CR-D2 A), referenced by the journal, never measured twice.
  const spawnSame = (brief, name) => {
    const briefPath = path.join(dir, `${name}-brief.md`);
    writeTextAtomic(briefPath, brief);
    const envelopePath = path.join(dir, `${name}.envelope.json`);
    runStep('same-family-call', SAME_ID, () => {
      const r = spawnSync(process.execPath, [path.join(scripts, 'spawn-subagent.mjs'), '--prompt-file', briefPath,
        '--out', envelopePath, '--result', path.join(dir, `${name}.json`), '--repo-root', repoRoot,
        ...runtimeBinArgv(runtimeBin)], { cwd: repoRoot, encoding: 'utf8' });
      // Whatever the exit, and before a failure throws (G-6 of 20261105-163851-crsf-d1-review; G-5 of
      // 20261105-173030-crsf-d1-remediation-review): the child's override notice is passed on (A-26).
      relaySubagentNotices(r.stderr);
      if (r.status !== 0) throw new Error(`the same-family checker (${sameRuntime}) failed (exit ${r.status}): ${String(r.stderr).trim().split('\n').slice(-2).join(' ')}`);
    }, () => ({ call_record: path.basename(subagentRecordPath(envelopePath)) }));
    return runStep('same-family-answer', SAME_ID, () => {
      const res = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
      if (!Array.isArray(res?.claims)) throw new Error('the same-family checker\'s answer has no list of claims');
      return res;
    });
  };
  const record = (info) => {
    runStep('write-check', null, () => writeJsonAtomic(path.join(dir, 'check.json'), { schema_version: 1, panel, setting, ...info }));
    console.log(`claim-check: checked (${info.family}-family); now run: claim-check.mjs ${dir}`);
    process.exit(0);
  };
  // Every failure after the journal opened ends here: the message, a failing exit, and the exit handler writes the record.
  const afterJournal = (body) => {
    try { body(); } catch (e) { fail(`claim-check failed: ${e?.message ?? e}`); }
  };

  if (!panel) {
    openJournal('same');
    afterJournal(() => {
      const res = spawnSame(buildClaimCheckSameFamilyBrief({ checker, draftPath, resultPath, repoRoot, transcriptPath: transcript }), 'same-family');
      runStep('write-result', null, () => writeJsonAtomic(resultPath, res));
      record({
        family: 'same', arm: null, same_family: { via: 'spawn-subagent.mjs', runtime: sameRuntime },
        transcript: { sent: Boolean(transcript), to: transcript ? 'same-family' : null },
        graded_by: Object.fromEntries(res.claims.map((c) => [c.id, sameRuntime])), kind_disagreements: [],
      });
    });
  }

  const roster = JSON.parse(fs.readFileSync(path.join(scripts, 'lens-roster.json'), 'utf8')).claim_checker;
  if (!roster?.reviewer || !roster?.model) fail('lens-roster.json declares no claim_checker reviewer and model', 2);
  const copy = setting === 'cross-family' && transcript ? await redactedTranscriptCopy(transcript, dir, { repoRoot }) : null;
  // THE ARMS' SNAPSHOT, NOT THE REPOSITORY (G-2 of 20261019-014448-ccf-delivery; operator: "The arms' snapshot
  // (Recommended)"): the reviewer stands in a directory built as the panel arms' is — what git tracks or would add, no
  // ignored file — with the draft and the redacted transcript copy added. The check directory is excluded, and so is the
  // --transcript file itself (G-4 of 20261019-033102-review-review): one tracked elsewhere in the repository was copied in
  // unredacted beside its redacted copy. This narrows what the reviewer is SHOWN; it does not bound what it can read
  // outside its working directory (shared/external-reviewers.md, G-7 of the same review).
  let maxBytes;
  try { maxBytes = panelSnapshotMaxBytes(read.contract); } catch (e) { fail(e.message, 2); }
  // A SURFACE IS ITS PROCESS'S (G-3 of 20261019-033102-review-review): it was removed only around the reviewer's spawn, so
  // an exception after the build, or a kill, left a repository snapshot under quorate's home for good. Each leaf is named
  // for the process that builds it and removed on that process's exit, whatever the cause; one whose process is gone (a
  // kill runs no exit handler) is reclaimed here, and one whose process is alive is never touched.
  const surfacesRoot = path.join(quorateHome(), 'claim-check-surfaces');
  reclaimSurfaces(surfacesRoot);
  const surfaceDir = path.join(surfacesRoot, `${process.pid}-${path.basename(armsBuildDir(surfacesRoot))}`);
  let surfaceMade = null;
  const dropSurface = () => { if (surfaceMade) fs.rmSync(surfaceMade, { recursive: true, force: true }); };
  const SURFACE_SUB = '.claim-check';
  const built = buildArmsSurface({
    repoRoot, headCommit: 'HEAD', baseCommit: 'HEAD', dir: surfaceDir, exclude: [dir, ...(transcript ? [path.resolve(transcript)] : [])], maxBytes,
    onCreated: (d) => { surfaceMade = d; process.on('exit', dropSurface); },
    beforeAssert: (d) => {
      fs.mkdirSync(path.join(d, SURFACE_SUB));
      // What the owner read above, written here: no second read of a path that could have changed in between.
      fs.writeFileSync(path.join(d, SURFACE_SUB, 'draft.md'), draftText);
      // This process's own redacted copy, checked by the egress owner before it is copied where the checker reads it.
      if (copy) { egress(path.dirname(copy.path)).stat([path.basename(copy.path)]); fs.copyFileSync(copy.path, path.join(d, SURFACE_SUB, path.basename(copy.path))); }
      return { ok: true };
    },
  });
  if (!built.ok) { dropSurface(); fail(`the directory the cross-family checker reads could not be built: ${built.why}`); }
  // WHAT THE SURFACE LEFT OUT IS SAID (G-5 of 20261019-033102-review-review): a build can succeed with entries withheld
  // (a link, a name that is not UTF-8, a file that moved under git), and nothing recorded them, so a partial surface read
  // as the whole repository. They go into the result's not_checked, which checked.md renders, and into check.json.
  const surfaceWithheld = built.withheld ?? [];
  const withheldNotes = surfaceWithheld.map((w) => `${w.path} was left out of what the cross-family checker read: ${w.why}`);
  const armPrompt = path.join(dir, 'arm-prompt.md');
  writeTextAtomic(armPrompt, buildClaimCheckArmPrompt({
    checker, draftPath: path.join(surfaceDir, SURFACE_SUB, 'draft.md'), repoRoot: surfaceDir,
    transcriptPath: copy ? path.join(surfaceDir, SURFACE_SUB, path.basename(copy.path)) : null,
  }));
  const armOut = path.join(dir, 'arm.json');
  // The arm.json a previous --check left was removed above, and the reviewer's exit status is required, so an arm that
  // dies before writing --out is a failure (G-3 of 20261019-014448-ccf-delivery).
  openJournal('cross');
  let r;
  let arm = null;
  afterJournal(() => {
    // The arm's call: its own step, charged to it, with external-review's call entry (stage 3) and the process's facts.
    try {
      runStep('arm-call', 'claim-checker', () => {
        const armStartedMs = Date.now();
        r = spawnSync(process.execPath, [path.join(scripts, 'external-review.mjs'), '--reviewer', roster.reviewer,
          '--model', roster.model, ...(roster.effort ? ['--effort', roster.effort] : []), '--mode', 'claim-check',
          '--prompt-file', armPrompt, '--evidence-dir', dir, '--out', armOut, '--surface', surfaceDir], { cwd: repoRoot, encoding: 'utf8' });
        let out = null;
        try { out = JSON.parse(fs.readFileSync(armOut, 'utf8')); } catch { /* no output: no entry */ }
        // WHAT THE PROCESS DID (telemetry-records.plan.md stage 1c), and the vendor call's entry, answered when it holds a result.
        arm = { reviewer: roster.reviewer, model: roster.model, effort: roster.effort ?? null, record: 'arm.json',
          started_at: new Date(armStartedMs).toISOString(), ended_at: new Date().toISOString(), exit_code: r.status ?? null,
          signal: r.signal ?? null, call: markAnswered(out?.call ?? null, Boolean(out?.result)) };
      }, () => ({ arm }));
    } finally {
      // The surface goes whatever happened to the call, as its own step: a cleanup that throws is recorded, not lost (G-8).
      runStep('surface-cleanup', null, dropSurface);
    }
    const rec = runStep('arm-answer', 'claim-checker', () => {
      let out = null;
      try { out = JSON.parse(fs.readFileSync(armOut, 'utf8')); } catch { /* named below */ }
      if (r.status !== 0 || !out?.result) {
        const why = (out?.not_checked ?? []).map((n) => `${n.item}: ${n.reason}`).join('; ') || String(r.stderr).trim().split('\n').slice(-2).join(' ');
        throw new Error(`the cross-family checker returned no result (exit ${r.status}): ${why}`);
      }
      if (!Array.isArray(out.result.claims)) throw new Error('the cross-family checker\'s answer has no list of claims');
      // Appended only to an array: an absent not_checked is the checker's omission, which the rules step refuses, not an empty list.
      if (Array.isArray(out.result.not_checked)) out.result.not_checked.push(...withheldNotes);
      return out;
    });
    const sent = copy ? { sent: true, to: roster.reviewer, bytes: copy.bytes_out, redactions: copy.redactions, malformed: copy.malformed ?? 0 } : null;

    if (setting === 'same-family' && transcript) {
      const sameRes = spawnSame(buildClaimCheckSameFamilyBrief({
        checker, draftPath, resultPath, repoRoot, transcriptPath: transcript, armClaims: rec.result.claims,
      }), 'same-family');
      // The merge reads the same-family checker's answer, so its failure is charged to that checker.
      const merged = runStep('merge', SAME_ID, () => {
        const m = mergeAttributionCheck(rec.result, sameRes, { grader: sameRuntime });
        if (m.errors.length) throw new Error(`the same-family checker's result could not be merged: ${m.errors.join('; ')}`);
        return m;
      });
      runStep('write-result', null, () => writeJsonAtomic(resultPath, merged.result));
      record({
        family: 'cross', arm, same_family: { via: 'spawn-subagent.mjs', runtime: sameRuntime, scope: 'attributions' },
        transcript: { sent: true, to: 'same-family' },
        graded_by: merged.graded_by, kind_disagreements: merged.kind_disagreements, surface_withheld: surfaceWithheld,
      });
    }
    const graded_by = Object.fromEntries(rec.result.claims.map((c) => [c.id, 'arm']));
    runStep('write-result', null, () => writeJsonAtomic(resultPath, rec.result));
    record({
      family: 'cross', arm, same_family: null, transcript: sent ?? { sent: false, to: null },
      graded_by, kind_disagreements: [], surface_withheld: surfaceWithheld,
    });
  });
}

/** Remove every claim-check surface under `root` whose building process is gone (G-3 of 20261019-033102-review-review). */
function reclaimSurfaces(root) {
  const alive = (pid) => hostProc.isAlive(pid);
  let names = [];
  // Only ENOENT is absence (G-4 of 20261105-181450-crsf-d1-remediation-2-review): any other error left dead processes'
  // snapshots in place with nothing said.
  try { names = fs.readdirSync(root); } catch (e) {
    if (e.code !== 'ENOENT') console.error(`claim-check: surfaces under ${root} could not be listed, so none was reclaimed: ${e.code ?? e.message}`);
    return;
  }
  for (const name of names) {
    const m = /^(\d+)-[0-9a-f]+$/.exec(name);
    if (!m || Number(m[1]) === process.pid || alive(Number(m[1]))) continue;
    // Through the arms root's reclaimer, which refuses a link at any level below the home rather than following it.
    const r = reclaimArmsRoot(path.join(root, name), { home: quorateHome() });
    if (r.refused || r.failed) console.error(`claim-check: a surface left by process ${m[1]} was not reclaimed: ${r.refused ?? r.failed}`);
  }
}
