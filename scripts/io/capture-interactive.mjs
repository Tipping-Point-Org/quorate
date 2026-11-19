// CAPTURE'S INTERACTIVE FRONT END (capture-interactive.plan.md stage 4; ROADMAP.md M2 item 7; story-pipeline's handover
// H#L53-L155). A session runs one of its own commands through it: no run directory, stdout and stderr kept apart and both
// written to disk, a bounded return, the command given as a string in the POSIX subset (lib/command-subset.mjs) and run
// as argv with no shell. Built and NOT adopted for the session's own commands until the operator says so (the roadmap).
//
// The operator's decisions (2026-11-15, the plan's stage 2), each applied here:
//   1 `$VAR`/`$?` refused (the subset)          2 globs refused (the subset)
//   3 a stage stopped by a downstream exit: its own state, --strict fails the whole (stage 5, pipelines)
//   4 preview: the contract's review.capture_preview_lines (absent = 120), --preview-lines overrides, --quiet = status only
//   5 commands.shell keeps its meaning: never used to launch here; it only splits a declared command into the argv
//     --mode read-only admits (G-17 of 20261116-001508-ci-review-2)     6 every stage's resolved argv recorded
//   7-8 --mode read-only (the lens's allow-list, lib/capture-admit.mjs) | run (any parsed command), always stated
//   9 Windows: PATH and PATHEXT; .exe direct, .cmd/.bat through the shell with each argument quoted, `"` `%` `!` refused
//   10 kept by review.session_record_retention_days, byte-exact; the preview masked (lib/redact.mjs)
//
// It is not a privilege boundary (H#L183-L188): `--mode run` runs whatever the caller could type. What it guarantees is that
// what ran is what was written, recorded, with its output.
import fs from 'node:fs';
import path from 'node:path';
import { gitSync } from './git.mjs';
import { fileURLToPath } from 'node:url';
import { classifyCommand } from '../lib/command-subset.mjs';
import { admitCommand, readOnlyPrefixes } from '../lib/capture-admit.mjs';
import { contractArgv, EXECUTABLE_COMMAND_KEYS, commandEnvFor, gitEnvFor, windowsShellArgv } from '../lib/decisions.mjs';
import { checkTimeoutMinutes, contractNumber } from '../lib/check-timeout.mjs';
import { redactClaim } from '../lib/redact.mjs';
import { retentionDays, expired } from '../lib/session-record.mjs';
import { stopRecord } from '../lib/stop-vocabulary.mjs';
import { runPipeline, pipelineExit } from './run-pipeline.mjs';
import { readContract } from './contract-reader.mjs';
import { selectAdapters } from './reviewers.mjs';
import { confined } from './confined-path.mjs';
import { hostPlatform, platformFor } from '../platform/index.mjs';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DETECTOR_ABS = path.join(SCRIPTS, 'find-inert-features.mjs');
export const PREVIEW_LINES_DEFAULT = 120;
export const CAPTURE_MAX_MB_DEFAULT = 1024;
const MODES = ['read-only', 'run'];

/** The preview default: the contract's key, absent = 120; a value that is not a whole number >= 0 is refused. */
export function previewLinesFrom(contract) {
  const v = contract?.review?.capture_preview_lines;
  if (v === undefined) return PREVIEW_LINES_DEFAULT;
  const n = typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0) throw new Error(`review.capture_preview_lines must be a whole number >= 0, got ${JSON.stringify(v)}`);
  return n;
}

/**
 * The per-stream output cap in bytes (G-8 of the plan, "Cap per stream, stop and fail (Recommended)"; G-14 of
 * 20261116-001508-ci-review-2): the contract's review.capture_max_mb, absent = 1024 MB; a value that is not a number > 0
 * is refused.
 */
export function captureMaxBytesFrom(contract) {
  const v = contract?.review?.capture_max_mb;
  if (v === undefined) return CAPTURE_MAX_MB_DEFAULT * 1024 * 1024;
  // The numeric grammar is lib/check-timeout.mjs's one owner of it (contractNumber), as for every contract number.
  const n = contractNumber(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`review.capture_max_mb must be a number > 0, got ${JSON.stringify(v)}`);
  // A finite count whose bytes overflow is no cap at all (G-4 of 20261116-021143-ci-remediation-4-review).
  const b = Math.floor(n * 1024 * 1024);
  // A positive count under one byte floors to 0, a zero-byte cap no command could pass (G-3 of
  // 20261116-031337-ci-remediation-5-review).
  if (!Number.isSafeInteger(b) || b < 1) throw new Error(`review.capture_max_mb must be a number > 0 whose byte count is a safe integer of at least 1, got ${JSON.stringify(v)}`);
  return b;
}

/** A word of a plan as its literal string; a word with a `$( )` part is the caller's to resolve first (stage 5). */
const literalWord = (w) => (w.parts.every((p) => 'literal' in p) ? w.parts.map((p) => p.literal).join('') : null);

/**
 * Resolve `name` through PATH (and PATHEXT where the platform has executable extensions), as a shell would, with no
 * shell. Returns the absolute path or null. A name with a separator is taken as a path relative to `cwd`. `platform` is
 * a platform id, and every rule that differs by operating system is that implementation's fact (G-5 of
 * 20261116-221234-m2-9a-high-2): the platform asked about, not the host, so the decision is tested for Windows anywhere.
 */
export function resolveCommand(name, { cwd, env = process.env, platform = hostPlatform().id, exists = null }) {
  const plat = platformFor(platform);
  // By default a candidate counts only as a runnable regular file, as a shell skips a directory or (where there is no
  // executable extension) a file without execute permission (G-10 of 20261117-013640-m2-9a-final).
  exists ??= (c) => {
    try {
      if (!fs.statSync(c).isFile()) return false;
      if (plat.executableExts.length === 0) fs.accessSync(c, fs.constants.X_OK);
      return true;
    } catch { return false; }
  };
  const P = path[plat.pathFlavor];
  const sep = plat.pathListDelimiter;
  const searched = plat.executableExts.length > 0;
  const exts = searched ? String(env.PATHEXT ?? plat.executableExts.join(sep)).split(sep).filter(Boolean) : [''];
  const withExts = (base) => (searched && P.extname(base) ? [base, ...exts.map((e) => base + e)] : exts.map((e) => base + e));
  if (/[\\/]/.test(name)) {
    for (const c of withExts(P.resolve(cwd, name))) if (exists(c)) return c;
    return null;
  }
  const dirs = String(env.PATH ?? env.Path ?? '').split(sep).filter(Boolean);
  for (const d of dirs) for (const c of withExts(P.join(d, name))) if (exists(c)) return c;
  return null;
}

/**
 * How one stage's argv is launched: `{ cmd, args, shell }`, or `{ refused }`. Where the platform needs a shell for its
 * shims (Windows: a `.cmd` or `.bat` cannot start without cmd.exe), the shim goes through the shell with each argument quoted by the engine's one rule (windowsShellArgv),
 * and an argument cmd.exe would reinterpret (`"`, `%`, `!`) is refused rather than escaped (decision 9).
 */
export function launchFor(argv, { cwd, env = process.env, platform = hostPlatform().id, exists = null }) {
  const resolved = resolveCommand(argv[0], { cwd, env, platform, exists });
  // A command not on PATH is a stage that could not start, recorded with exit 127 as a shell records it, not a refusal
  // (G-14 of 20261116-021143-ci-remediation-4-review). Nothing is launched for it: `unstartable` is the pipeline's to record.
  if (!resolved) return { cmd: argv[0], args: argv.slice(1), shell: false, resolved: null, unstartable: `\`${argv[0]}\` was not found on PATH` };
  const plat = platformFor(platform);
  if (plat.needsShellForShims && plat.shimExts.includes(path[plat.pathFlavor].extname(resolved).toLowerCase())) {
    // The resolved path is a cmd.exe token too (G-5 of 20261116-021143-ci-remediation-4-review).
    const bad = [resolved, ...argv.slice(1)].find((a) => /["%!]/.test(a));
    if (bad !== undefined) return { refused: `\`${bad}\` holds a character cmd.exe would reinterpret ("%!), and ${path.basename(resolved)} runs through cmd.exe` };
    return { cmd: windowsShellArgv([resolved])[0], args: windowsShellArgv(argv.slice(1)), shell: true, resolved };
  }
  return { cmd: resolved, args: argv.slice(1), shell: false, resolved };
}

/** Refuse an evidence directory git would track: inside a work tree and not ignored (the handover's G-9, H#L75-L85). */
export function evidenceDirRefusal(dir) {
  // From the nearest ancestor that exists: a nested new path has no parent to run git in, and a git that could not start
  // is not a directory outside the work tree (G-6 of 20261115-220919-ci-delivery).
  let probe = dir;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const top = gitSync(['rev-parse', '--show-toplevel'], { cwd: probe, encoding: 'utf8' });
  // A git that could not start (no status) is not "outside a work tree": refused, never admitted (G-11 of
  // 20261117-013640-m2-9a-final).
  if (top.status === null || top.error) return `--evidence-dir ${dir} could not be checked: git could not be run (${top.error?.message ?? top.signal ?? 'no status'}); evidence is kept out of what git tracks`;
  if (top.status !== 0) return null;   // not inside a work tree
  const ignored = gitSync(['check-ignore', '-q', dir], { cwd: top.stdout.trim(), encoding: 'utf8' });
  return ignored.status === 0 ? null : `--evidence-dir ${dir} is inside the git work tree ${top.stdout.trim()} and not ignored; evidence is kept out of what git tracks`;
}

/** A collector writing each stream to its own file and both, in arrival order, to `combined` (interleaving on request). */
function fileSinks(owner, segs, dirAbs, { maxBytes = Infinity, onCap = () => {} } = {}) {
  // Each file made by the run folder's owner (exclusive, each level checked for a link), then opened to append: the
  // owner, not a private exclusive open, is what refuses a name already there (the one-record-lock census).
  // Owner-only (0o600): the files are byte-exact and may hold a credential the command printed (G-6 of
  // 20261116-021143-ci-remediation-4-review); only the preview is masked.
  const open = (n) => { owner.create([...segs, n], '', { mode: 0o600 }); return fs.openSync(path.join(dirAbs, n), 'a'); };
  const fd = { stdout: open('stdout'), stderr: open('stderr'), combined: open('combined') };
  const bytes = { stdout: 0, stderr: 0 };
  let combinedBytes = 0;
  const tail = { stdout: [], stderr: [] };
  let capped = null;
  return {
    get capped() { return capped; },
    // Every stage of a pipeline has its stderr.stage-<n>, a silent one included, so a fetch of it reads empty rather
    // than failing (G-6 of 20261116-031337-ci-remediation-5-review).
    stages(n) {
      if (n < 2) return;
      for (let i = 1; i <= n; i += 1) { const k = `stderr.stage-${i}`; if (!(k in fd)) fd[k] = open(k); }
    },
    take(name, chunk, stage = null) {
      // A stream at the cap keeps exactly the bytes up to it, and stops the command's tree (G-14 of
      // 20261116-001508-ci-review-2).
      if (capped) return;
      // Output AT the cap is kept whole, and a stream that REACHES the cap stops the tree (the plan's stage 7, "a stream
      // reaching it stops"; G-5 of 20261116-031337-ci-remediation-5-review). `combined` is a saved stream too and is held
      // to the same cap with its own count (G-4 of 20261116-013621-review).
      if (bytes[name] + chunk.length >= maxBytes) {
        chunk = chunk.subarray(0, Math.max(0, maxBytes - bytes[name]));
        capped = name;
      }
      let toCombined = chunk;
      if (combinedBytes + chunk.length >= maxBytes) {
        toCombined = chunk.subarray(0, Math.max(0, maxBytes - combinedBytes));
        capped = capped ?? 'combined';
      }
      fs.writeSync(fd[name], chunk);
      // Each stage of a pipeline has its stderr kept apart too, `stderr.stage-<n>` (the plan's "per-stage stderr"; G-15 of
      // 20261116-021143-ci-remediation-4-review), within the stream's cap since the chunk is already cut to it.
      if (name === 'stderr' && stage !== null && chunk.length) {
        const k = `stderr.stage-${stage + 1}`;
        if (!(k in fd)) fd[k] = open(k);
        fs.writeSync(fd[k], chunk);
      }
      fs.writeSync(fd.combined, toCombined);
      bytes[name] += chunk.length;
      combinedBytes += toCombined.length;
      tail[name].push(chunk);
      if (tail[name].length > 64) tail[name] = [Buffer.concat(tail[name]).subarray(-64 * 1024)];
      // The stream that reached the cap, `combined` included, not the one this chunk came on (G-9 of
      // 20261116-021143-ci-remediation-4-review).
      if (capped) onCap(capped);
    },
    result() {
      for (const f of Object.values(fd)) { try { fs.closeSync(f); } catch { /* closed */ } }
      return { bytes, tail: { stdout: Buffer.concat(tail.stdout).subarray(-64 * 1024), stderr: Buffer.concat(tail.stderr).subarray(-64 * 1024) } };
    },
  };
}

/**
 * The cap's clause of the report: the tree is said stopped only when the stop owner saw every stage end; a survivor it
 * could not confirm is named (G-8 of 20261116-013621-review).
 */
export function capNote(stream, maxBytes, survivors = []) {
  const left = (survivors ?? []).filter(Boolean);
  const how = left.length
    // Each survivor's sentence from the stop vocabulary's one owner, not phrased here (G-10 of
    // 20261116-021143-ci-remediation-4-review).
    ? `${left.map((v) => stopRecord({ outcome: v.outcome, pid: v.pid ?? null, reason: 'output_cap', context: 'captured' }).sentence).join('; ')}, which may still be running`
    : 'the tree was stopped';
  return ` (output_cap_reached: ${stream} reached ${maxBytes} B; ${how})`;
}

/** The mark status.json carries for a label this front end wrote; retention prunes nothing without it. */
export const WRITER = 'quorate capture.mjs --interactive';
const STATUS_MAX_BYTES = 1024 * 1024;

/**
 * Decision 10's retention (G-3 of 20261116-021143-ci-remediation-4-review; the operator: "Prune only its own labels
 * (Recommended)"): a label this front end wrote, known by its status.json naming that label, is removed once that file is
 * older than review.session_record_retention_days. Anything else in the evidence directory is the caller's and is left.
 * Through the owner, so a link at any level is refused rather than followed; a label that cannot be read is left.
 */
export function pruneOwnLabels(owner, days, now, { onFailure = () => {} } = {}) {
  if (days == null) return [];
  const pruned = [];
  for (const ent of owner.list([], { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    try {
      const st = owner.stat([ent.name, 'status.json']);
      // A status file no label of ours could be is not read whole (G-8 of 20261116-031337-ci-remediation-5-review).
      if (st.size > STATUS_MAX_BYTES) continue;
      // The stat holds the time: a label inside the window is never read (G-9 of 20261116-200635-m2-9a-high). Ownership
      // is still checked below before any removal.
      if (!expired(st.mtimeMs, now, days)) continue;
      const status = JSON.parse(owner.read([ent.name, 'status.json']));
      // Owned only when this front end's writer mark is there: schema_version and label are generic fields any status
      // file may carry (G-8 of 20261116-031337-ci-remediation-5-review).
      if (status?.writer !== WRITER || status?.schema_version !== 1 || status?.label !== ent.name) continue;
    } catch { continue; /* not a label of ours, or not readable: left */ }
    // A label of ours that expired and could not be removed is reported, not swallowed with the reads above (G-13 of
    // 20261117-013640-m2-9a-final): retention of byte-exact captures failing is something the caller must hear.
    try { owner.remove([ent.name], { recursive: true }); pruned.push(ent.name); } catch (e) { onFailure(ent.name, e); }
  }
  return pruned;
}

const lastLines = (buf, n) => {
  const lines = buf.toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return n >= lines.length ? lines : lines.slice(-n);
};

/**
 * Run one command string. Returns `{ code, report }`: the exit code to leave with, and the text for the session (already
 * bounded and masked). Writes `<evidenceDir>/<label>/` with stdout, stderr, combined, argv.json and status.json.
 */
export async function runInteractive({ source, mode, evidenceDir, name, cwd = process.cwd(), previewLines = null, quiet = false,
  stdinFile = null, timeoutMinutes = null, strict = false, env = process.env, captureMaxMb = null, runtime = undefined,
  readContractFn = readContract }) {
  if (!MODES.includes(mode)) return { code: 2, report: `capture: --mode must be one of ${MODES.join(', ')} (decision 7-8: the intent is stated)` };
  const plan = classifyCommand(source);
  if (!plan.ok) {
    return { code: 2, report: ['capture: refusing the command; outside the subset:', ...plan.refusals.map((r) => `  - ${r.construct}: ${r.why}`)].join('\n') };
  }
  const repoTop = gitSync(['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  const repoRoot = repoTop.status === 0 ? repoTop.stdout.trim() : cwd;
  const read = readContractFn({ cwd });
  // A contract that could not be read is refused, not taken as empty: an empty one chooses the default runtime, and another
  // runtime's credentials would reach the command (G-11 of 20261116-021143-ci-remediation-4-review). An absent contract
  // is no contract, and the built-in runtime is the one in use.
  if (read.error) return { code: 2, report: `capture: the contract could not be read (${read.error}); refusing to run a command with its runtime unknown` };
  const contract = read.contract ?? {};
  const shell = contract?.commands?.shell ?? '';
  const declared = Object.entries(contract?.commands ?? {}).filter(([k, v]) => EXECUTABLE_COMMAND_KEYS.includes(k) && String(v ?? '').trim())
    .map(([key, v]) => ({ key, argv: contractArgv(String(v).trim(), shell) }));
  let lines;
  try { lines = previewLines ?? previewLinesFrom(contract); } catch (e) { return { code: 2, report: `capture: ${e.message}` }; }
  let maxBytes;
  try { maxBytes = captureMaxBytesFrom(captureMaxMb === null ? contract : { review: { capture_max_mb: captureMaxMb } }); } catch (e) { return { code: 2, report: `capture: ${e.message}` }; }
  let minutes;
  try {
    minutes = timeoutMinutes === null ? checkTimeoutMinutes(contract) : checkTimeoutMinutes({ review: { check_timeout_minutes: timeoutMinutes } });
  } catch (e) { return { code: 2, report: `capture: timeout refused: ${e.message}` }; }

  // The runtime's own credentials are dropped, as for a remediation's commands (G-7 of 20261116-001508-ci-review-2): a
  // session's command has no use for the node runtime's authentication, and a byte-exact stdout would keep it. WHICH are
  // the runtime's is the adapter the contract chooses, by the one owner, as capture.mjs chooses it (G-7 of
  // 20261116-013621-review): the fixed set alone let an overridden runtime's key cross.
  let adapter = runtime;
  if (adapter === undefined) {
    try {
      const adapters = selectAdapters({ contract: read.contract ?? null });
      adapter = adapters.table[adapters.runtime];
      if (!adapter) throw new Error(`runtime ${adapters.runtime} is not in the adapter table`);
    } catch (e) {
      return { code: 2, report: `capture: the node runtime could not be chosen (${e.message}); refusing to run a command with its auth unknown` };
    }
  }
  if (!path.isAbsolute(String(evidenceDir))) return { code: 2, report: '--evidence-dir must be absolute' };
  const dir = path.resolve(evidenceDir);
  const tracked = evidenceDirRefusal(dir);
  if (tracked) return { code: 2, report: `capture: ${tracked}` };
  // Opened before the label is made, so a missing file consumes no label and leaves no half-written evidence (G-8 of
  // 20261116-001508-ci-review-2).
  let stdinFd = null;
  // An empty path is a path given and refused, not the option left out (G-6 of 20261116-013621-review).
  if (stdinFile !== null && stdinFile !== undefined && !String(stdinFile).trim()) return { code: 2, report: 'capture: --stdin-file needs a path' };
  if (stdinFile) {
    try { stdinFd = fs.openSync(stdinFile, 'r'); } catch (e) { return { code: 2, report: `capture: --stdin-file ${stdinFile}: ${e.message}` }; }
  }
  fs.mkdirSync(dir, { recursive: true });
  const owner = confined(dir);
  let days;
  try { days = retentionDays(contract?.review); } catch (e) { if (stdinFd !== null) fs.closeSync(stdinFd); return { code: 2, report: `capture: ${e.message}` }; }
  pruneOwnLabels(owner, days, Date.now(), {
    onFailure: (label, e) => process.stderr.write(`capture: retention: the expired label ${label} could not be removed: ${e.message}
`),
  });
  let runAbs;
  try { runAbs = owner.dirNew([name]); } catch (e) {
    if (stdinFd !== null) fs.closeSync(stdinFd);
    return { code: 2, report: `capture: --name ${name}: ${e.message} (a label is used once; fetch the earlier one with --fetch)` };
  }

  const ctx = { mode, cwd, env: commandEnvFor(env, { remediation: true, runtime: adapter }), declared, repoRoot, owner, strict,
    deadline: Date.now() + minutes * 60_000, substs: 0, records: [], survivors: [], maxBytes, stopAll: () => {}, capped: null };
  const onCap = (stream) => { if (!ctx.capped) { ctx.capped = stream; ctx.stopAll(); } };
  const sinks = fileSinks(owner, [name], runAbs, { maxBytes, onCap });
  const started = Date.now();
  // The file is handed to the first stage as its descriptor, streamed rather than read whole into this process's memory
  // (G-10 of 20261115-220919-ci-delivery); a `<` the stage names itself still wins.
  let top;
  try { top = await executePlan(plan.plan, ctx, { segs: [name], sinks, stdinFd }); } finally { if (stdinFd !== null) fs.closeSync(stdinFd); }
  const { bytes, tail } = sinks.result();
  const exit = ctx.capped ? 1 : top.exit;
  owner.create([name, 'argv.json'], JSON.stringify({ source, mode, strict, commands: ctx.records }, null, 2), { mode: 0o600 });
  const status = { schema_version: 1, writer: WRITER, label: name, mode, strict, exit, timed_out: Boolean(top.timedOut), refused: top.refused ?? null,
    failed_inner: top.failedInner ?? null, stop: top.stopSentence ?? null,
    status: ctx.capped ? 'output_cap_reached' : null, output_cap_reached: ctx.capped, capture_max_bytes: maxBytes, stages: top.stages ?? [], bytes,
    duration_ms: Date.now() - started, evidence: runAbs };
  owner.create([name, 'status.json'], JSON.stringify(status, null, 2), { mode: 0o600 });

  if (top.refused) return { code: 2, report: `capture: refusing the command: ${top.refused}\n(evidence of what was resolved: ${runAbs})` };
  // Its own exit and how it is counted (G-13 of 20261116-021143-ci-remediation-4-review).
  const stopped = (top.stages ?? []).map((s, i) => (s.terminated_by_downstream_exit
    ? ` · stage ${i + 1} stopped by its downstream (${s.signal ? `signal ${s.signal}` : `exit ${s.status ?? '?'}`}; ${strict ? 'a failure under --strict' : 'counted as stopped, not failed, unless --strict'})`
    : '')).join('');
  const head = `capture: exit ${exit}${ctx.capped ? capNote(ctx.capped, maxBytes, ctx.survivors) : ''}${top.timedOut ? ` (timed out after ${minutes} minute(s))` : ''}`
    + `${top.failedInner ? ` (${top.failedInner})` : ''}${stopped}`
    + ` · stdout ${bytes.stdout} B · stderr ${bytes.stderr} B · ${runAbs}`;
  if (quiet || lines === 0) return { code: exit, report: head };
  const show = (n, b) => (b.length ? [`--- ${n} (last ${lines} lines, secrets masked) ---`, ...lastLines(b, lines).map((l) => redactClaim(l))] : []);
  return { code: exit, report: [head, ...show('stdout', tail.stdout), ...show('stderr', tail.stderr)].join('\n') };
}

// What a `$( )` may return: its output is held in memory to be substituted, so it is bounded, and one past the bound
// fails the whole command rather than substitute a cut value.
export const SUBST_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Run one plan: each stage's words resolved (every `$( )` first, depth-first, each a captured command of its own, and a
 * failing one failing the whole before anything after it runs: decision 6 of 2026-10-19), admitted by the mode, launched,
 * its redirections opened, and the stages run as one pipeline. `sinks` receives the last stage's stdout and every stage's
 * stderr. Returns `{ exit, stages, timedOut, stopSentence }`, or `{ exit: 2, refused }`, or `{ exit, failedInner }`.
 */
async function executePlan(plan, ctx, { segs, sinks, stdinFd = null }) {
  const resolved = [];
  for (const stage of plan.stages) {
    const argv = [];
    for (const w of stage.argv) {
      const r = await resolveWord(w, ctx, segs);
      if (r.stop) return r.stop;
      argv.push(r.value);
    }
    const redirects = [];
    let stderrOnOriginal = false;
    for (const rd of stage.redirects) {
      if (ctx.mode === 'read-only' && rd.op !== 'dup') {
        return { exit: 2, refused: `\`${rd.fd}${rd.op}\` reads or writes a file, which --mode read-only does not admit (2>&1 alone is)` };
      }
      // In order, as POSIX applies them (G-11 of 20261115-220919-ci-delivery): a `2>&1` with stdout not yet redirected
      // leaves stderr on the ORIGINAL stdout, which a later `>` leaves behind and the runner cannot express apart from it;
      // refused, not run otherwise. A `2>` after it takes stderr back.
      if (rd.op === 'dup') { stderrOnOriginal = !redirects.some((r) => r.fd === 1); redirects.push(rd); continue; }
      if (rd.fd === 2) stderrOnOriginal = false;
      if (rd.fd === 1 && stderrOnOriginal) {
        return { exit: 2, refused: `\`2>&1\` before stdout's own redirection \`${rd.op}\` sends stderr to the original stdout, which this runner does not express; write \`${rd.op} file 2>&1\`, or send stderr to a file of its own` };
      }
      const t = await resolveWord(rd.target, ctx, segs);
      if (t.stop) return t.stop;
      redirects.push({ ...rd, path: path.resolve(ctx.cwd, t.value) });
    }
    let stageEnv = null;
    if (ctx.mode === 'read-only') {
      const admit = admitCommand(argv, { declared: ctx.declared, readOnly: readOnlyPrefixes(DETECTOR_ABS), repoRoot: ctx.repoRoot });
      if (!admit.ok) return { exit: 2, refused: `${admit.why}\n(--mode read-only applies the lens's allow-list; --mode run admits any parsed command)` };
      // A READ-ONLY GIT INSPECTION runs with git's own scrubbed environment, as capture.mjs's does and every git the engine
      // starts (io/git.mjs; G-16 of 20261117-013640-m2-9a-final, A-29): a helper it starts inherits no secret. A declared
      // command keeps the command environment its declaration was written for.
      if (!admit.declaredHit && admit.readOnlyMatch?.[0] === 'git') stageEnv = gitEnvFor(ctx.env);
    }
    const launch = launchFor(argv, { cwd: ctx.cwd, env: stageEnv ?? ctx.env });
    if (launch.refused) return { exit: 2, refused: launch.refused };
    resolved.push({ argv, launch, redirects, env: stageEnv });
  }
  const record = { at: segs.join('/'), stages: resolved.map((s) => ({ argv: s.argv, resolved: s.launch.resolved, shell: s.launch.shell,
    redirects: s.redirects.map((r) => ({ fd: r.fd, op: r.op, path: r.path ?? null })) })) };
  ctx.records.push(record);

  const fds = [];
  const openFd = (p, flags) => { const fd = fs.openSync(p, flags); fds.push(fd); return fd; };
  let stages;
  try {
    stages = resolved.map((s) => {
      const st = { cmd: s.launch.cmd, args: s.launch.args, shell: s.launch.shell, unstartable: s.launch.unstartable ?? null };
      if (s.env) st.env = s.env;   // a read-only git's own environment (G-16 of 20261117-013640-m2-9a-final)
      if (s === resolved[0] && stdinFd !== null) st.stdinFd = stdinFd;
      for (const r of s.redirects) {
        // In order: `2>&1` binds stderr to what stdout is NOW (a file opened before it, or the stage's stdout), and a
        // later `2>` takes stderr back (G-11 of 20261115-220919-ci-delivery).
        if (r.op === 'dup') {
          if (st.stdoutFd != null) { st.stderrFd = st.stdoutFd; st.mergeStderr = false; } else { st.mergeStderr = true; delete st.stderrFd; }
          continue;
        }
        const fd = openFd(r.path, r.op === '<' ? 'r' : r.op === '>>' ? 'a' : 'w');
        if (r.fd === 0) st.stdinFd = fd; else if (r.fd === 1) st.stdoutFd = fd; else { st.stderrFd = fd; st.mergeStderr = false; }
      }
      return st;
    });
  } catch (e) {
    for (const fd of fds) { try { fs.closeSync(fd); } catch { /* closed */ } }
    return { exit: 2, refused: `a redirection could not be opened: ${e.message}` };
  }
  sinks.stages?.(resolved.length);
  const res = await runPipeline(stages, { cwd: ctx.cwd, env: ctx.env, timeoutMs: Math.max(1, ctx.deadline - Date.now()),
    onChunk: (stream, chunk, i) => sinks.take(stream, chunk, resolved.length > 1 ? i : null), onStart: (stopAll) => { ctx.stopAll = stopAll; } });
  for (const fd of fds) { try { fs.closeSync(fd); } catch { /* closed */ } }
  ctx.survivors.push(...(res.survivors ?? []));
  record.result = res.stages.map((s) => ({ status: s.status, signal: s.signal, error: s.error ? String(s.error.code ?? s.error.message) : null,
    terminated_by_downstream_exit: s.terminated_by_downstream_exit }));
  return { exit: pipelineExit(res, { strict: ctx.strict }), stages: record.result, timedOut: res.timedOut, stopSentence: res.stopSentence };
}

/** A word's string: its literals joined, each `$( )` replaced by its command's output with trailing newlines removed. */
async function resolveWord(w, ctx, segs) {
  let value = '';
  for (const p of w.parts) {
    if ('literal' in p) { value += p.literal; continue; }
    ctx.substs += 1;
    const sub = [...segs, `subst-${ctx.substs}`];
    const subAbs = ctx.owner.dirNew(sub);
    const outer = ctx.stopAll;
    const files = fileSinks(ctx.owner, sub, subAbs, { maxBytes: ctx.maxBytes,
      onCap: (stream) => { if (!ctx.capped) { ctx.capped = stream; ctx.stopAll(); } } });
    const kept = [];
    let keptBytes = 0;
    let over = false;
    const sinks = { stages: (n) => files.stages(n), take(stream, chunk, stage = null) {
      files.take(stream, chunk, stage);
      if (stream !== 'stdout') return;
      keptBytes += chunk.length;
      // Past the limit the outcome is decided, so the command is stopped there rather than left to run on to its own
      // exit, the output cap or the deadline (G-12 of 20261116-221234-m2-9a-high-2).
      if (keptBytes > SUBST_MAX_BYTES) { if (!over) { over = true; ctx.stopAll(); } } else kept.push(chunk);
    } };
    const r = await executePlan(p.subst, ctx, { segs: sub, sinks });
    ctx.stopAll = outer;
    files.result();
    if (ctx.capped) return { stop: { exit: 1, stages: r.stages, failedInner: `the command in ${sub.join('/')} reached the output cap` } };
    if (r.refused) return { stop: r };
    // Before the exit check: a command stopped for being over exits non-zero because it was stopped.
    if (over) return { stop: { exit: 1, stages: r.stages, failedInner: `the command in ${sub.join('/')} printed over ${SUBST_MAX_BYTES} bytes, past what a "$( )" may substitute` } };
    if (r.timedOut) return { stop: { ...r, failedInner: `the command in ${sub.join('/')} reached the deadline` } };
    if (r.exit !== 0) return { stop: { exit: r.exit, stages: r.stages, failedInner: `the command in ${sub.join('/')} exited ${r.exit}; nothing after it ran` } }; // outcome-ok: r.exit is pipelineExit's own verdict on the inner command, already classified, not a child's raw exit
    value += Buffer.concat(kept).toString('utf8').replace(/\n+$/, '');
  }
  return { value };
}

/** `--name <label> --fetch <stream>`: print one saved stream whole (the "delay-output" half, H#L140-L142). */
export function fetchSaved({ evidenceDir, name, stream = 'stdout', mode }) {
  if (!MODES.includes(mode)) return { code: 2, report: `capture: --mode must be one of ${MODES.join(', ')} (decision 7-8: the intent is stated, a fetch included)` };
  if (!['stdout', 'stderr', 'combined', 'status.json', 'argv.json'].includes(stream) && !/^stderr\.stage-[1-9]\d*$/.test(stream)) return { code: 2, report: `capture: --stream ${stream} is not a saved stream` };
  // The same refusals as a capture's (G-11 of 20261116-031337-ci-remediation-5-review): absolute, and not tracked by git.
  if (!path.isAbsolute(String(evidenceDir))) return { code: 2, report: '--evidence-dir must be absolute' };
  const tracked = evidenceDirRefusal(path.resolve(evidenceDir));
  if (tracked) return { code: 2, report: `capture: ${tracked}` };
  // Read as bytes, never decoded (G-14 of 20261116-221234-m2-9a-high-2): the save is byte-exact, and a UTF-8 read turned
  // what is not UTF-8 into U+FFFD and could not hold a stream past V8's string limit. `bytes` is what the CLI prints;
  // `report` decodes it for a caller that wants text.
  let bytes;
  try { bytes = confined(path.resolve(evidenceDir)).read([name, stream], null); } catch (e) { return { code: 2, report: `capture: ${name}/${stream}: ${e.message}` }; }
  return { code: 0, bytes, get report() { return bytes.toString('utf8'); } };
}
