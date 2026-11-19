// A PIPELINE BUILT BY THE RUNNER, NOT BY A SHELL (capture-interactive.plan.md stage 5; story-pipeline's handover
// H#L105-L139). Every stage starts at once, and each downstream stage is given its upstream's stdout AS its stdin: the
// data flows child to child through the kernel, with the kernel's backpressure (an unbounded producer is allowed) and, on
// posix, its SIGPIPE. This process is never in the data path and never writes a child's stdin, so a stage that stops
// reading cannot hold it open (tests/regression-dps-runtime-prompt-stdin.test.mjs, the census of that). Each stage's
// stderr is its own; the result says how each stage ended, so pipefail is by construction.
//
// A STAGE STOPPED BY ITS DOWNSTREAM (decision 3, 2026-11-15: "Own state, strict flag (Recommended)"). When a stage
// closes, every upstream stage still running is given DOWNSTREAM_GRACE_MS to end by itself (one that had finished its
// output is usually exiting), then stopped through the one stop owner and marked `terminated_by_downstream_exit`. On
// posix the kernel's SIGPIPE does the same, and a stage that died of SIGPIPE is marked too. Windows has no SIGPIPE
// (H#L135-L139), which is why the runner does it on both.
//
// `2>&1` ON A STAGE THAT FEEDS ANOTHER: its stderr must join the pipe its stdout writes, which does not exist until the
// stage starts. The stage runs under a small node wrapper that starts the real command with its stderr on its own stdout
// (MERGE_WRAPPER); the wrapper is the stage's process, so a stop reaches the real command as its tree.
//
// A DEADLINE stops every stage still running, the tree of each, through the same owner.
import { spawn as nodeSpawn } from 'node:child_process';
import { stopChild, ESCALATE_AT_ONCE_MS } from './stop-child.mjs';
import { stdinFrom } from './stdin-file.mjs';
import { stopRecord } from '../lib/stop-vocabulary.mjs';
import { hostPlatform } from '../platform/index.mjs';

export const DOWNSTREAM_GRACE_MS = 200;
// argv after `-e`: [shell ? '1' : '0', cmd, ...args]. Its stdio is the stage's; its child writes stderr to fd 1.
export const MERGE_WRAPPER = "const[s,c,...a]=process.argv.slice(1);const k=require('child_process').spawn(c,a,{stdio:[0,1,1],shell:s==='1',windowsHide:true});"
  + "k.on('error',e=>{process.stderr.write(String(e.message)+'\\n');process.exit(127)});k.on('exit',(code,sig)=>process.exit(code??(sig?128:1)))";

/**
 * @param stages  [{ cmd, args, shell, env?, stdinFd?, stdoutFd?, stderrFd?, mergeStderr? }]: `env`, where given, is that
 *   stage's own environment in place of the pipeline's (a read-only git's scrubbed one); a `*Fd` is an open descriptor a
 *   redirection made (the caller opens and closes it); `mergeStderr` is `2>&1`.
 * @param onChunk(stream, chunk, stageIndex)  'stdout' for the last stage's output, 'stderr' for any stage's.
 * @param input  text for the first stage's stdin when it has no `<` (io/stdin-file.mjs), or null.
 * @returns {Promise<{ stages: [{ status, signal, error, terminated_by_downstream_exit }], timedOut, survivors, stopSentence }>}
 */
export function runPipeline(stages, { cwd, env, timeoutMs = 0, onChunk = () => {}, input = null, stop = stopChild, spawn = nodeSpawn,
  graceMs = DOWNSTREAM_GRACE_MS, onStart = () => {} } = {}) {
  return new Promise((resolve) => {
    const n = stages.length;
    const out = stages.map(() => ({ status: null, signal: null, error: null, terminated_by_downstream_exit: false }));
    const closed = new Array(n).fill(false);
    const kids = [];
    const survivors = [];
    const graces = [];
    // One downstream stop per stage: every closing stage scans its upstream, and a stop already scheduled is not scheduled
    // again (G-17 of 20261116-021143-ci-remediation-4-review).
    const scheduled = new Array(n).fill(false);
    let timedOut = false;
    let settled = false;
    const stdin = stdinFrom(stages[0]?.stdinFd == null ? input : null);
    const finishIfDone = () => {
      if (settled || !closed.every(Boolean)) return;
      settled = true;
      clearTimeout(timer);
      for (const g of graces) clearTimeout(g);
      stdin.release();
      const said = timedOut ? stopRecord({ outcome: survivors.length ? survivors[0].outcome : 'exited',
        pid: survivors[0]?.pid ?? kids.find(Boolean)?.pid, reason: 'timeout', context: 'captured' }).sentence : null;
      resolve({ stages: out, timedOut, survivors, stopSentence: said });
    };
    // A stop that is not seen to end the child ends the wait for it: its 'close' may never come (spawn-capture's G-22).
    const stopStage = (i, why) => {
      const k = kids[i];
      if (!k || closed[i]) return;
      if (why === 'downstream') out[i].terminated_by_downstream_exit = true;
      stop(k, { event: 'close', escalateAfterMs: ESCALATE_AT_ONCE_MS }).then(({ outcome, pid }) => {
        if (outcome === 'exited') return;
        survivors.push({ stage: i, outcome, pid });
        for (const s of [k.stdout, k.stderr]) { try { s?.destroy(); } catch { /* gone */ } }
        if (!closed[i]) { closed[i] = true; finishIfDone(); }
      });
    };

    const stopUpstream = (i) => {
      for (let u = 0; u < i; u++) {
        if (closed[u] || scheduled[u]) continue;
        scheduled[u] = true;
        graces.push(setTimeout(() => stopStage(u, 'downstream'), graceMs));
      }
    };
    for (let i = 0; i < n; i++) {
      const s = stages[i];
      const feedsNext = i < n - 1;
      const prev = kids[i - 1];
      const fromUpstream = i > 0 && stages[i - 1].stdoutFd == null && prev?.stdout ? prev.stdout : 'ignore';
      const stdioIn = s.stdinFd ?? (i === 0 ? stdin.fd : fromUpstream);
      const wrap = s.mergeStderr && s.stdoutFd == null && feedsNext;
      // `2>&1` with a file shares the file's descriptor; without one, the stderr is read here (the last stage) or the
      // wrapper joins it to stdout (a stage that feeds another), so this process reads it as a pipe either way.
      const stdio = [stdioIn, s.stdoutFd ?? 'pipe', s.mergeStderr ? (s.stdoutFd ?? 'pipe') : (s.stderrFd ?? 'pipe')];
      const [cmd, args, shell] = wrap
        ? [process.execPath, ['-e', MERGE_WRAPPER, s.shell ? '1' : '0', s.cmd, ...s.args], false]
        : [s.cmd, s.args, Boolean(s.shell)];
      let child;
      try {
        // A stage the caller found could not start (its command not on PATH) is never spawned: it fails as a spawn error
        // does, exit 127 (G-14 of 20261116-021143-ci-remediation-4-review).
        if (s.unstartable) throw Object.assign(new Error(s.unstartable), { code: 'ENOENT' });
        child = spawn(cmd, args, { cwd, env: s.env ?? env, windowsHide: true, shell, stdio, ...hostPlatform().proc.killableSpawnOptions() });
      } catch (e) {
        out[i].error = e;
        closed[i] = true;
        kids.push(null);
        stopUpstream(i);   // as for an asynchronous spawn error (G-11 of 20261116-013621-review)
        continue;
      }
      kids.push(child);
      // The upstream's stdout now belongs to this stage, so this process lets go of its own end and holds no pipe open.
      // A stage reading `<` from a file leaves that output with no reader, so its end is closed as well, as a shell does:
      // the upstream's next write fails (SIGPIPE on posix) instead of blocking until the deadline.
      if (i > 0 && prev?.stdout && stages[i - 1].stdoutFd == null) { try { prev.stdout.destroy(); } catch { /* gone */ } }
      // A stage that could not start ends like one that closed: its upstream stages are given the grace and stopped, so a
      // producer does not run on to the deadline and turn a 127 into 124 (G-11 of 20261116-013621-review).
      child.on('error', (e) => { out[i].error = e; if (!closed[i]) { closed[i] = true; stopUpstream(i); finishIfDone(); } });
      child.on('close', (code, signal) => {
        if (closed[i]) return;
        closed[i] = true;
        out[i].status = code;
        out[i].signal = signal ?? null;
        // LOST ITS READER: a stage that ends unsuccessfully after a stage downstream of it closed. With the pipe child to
        // child, the stage ends by itself when its next write fails: SIGPIPE on posix, an EPIPE error (exit 1) on Windows,
        // measured 2026-11-15. A downstream ends only after reading its EOF when the upstream ran to completion, so a stage
        // that failed on its own closes first and keeps its failure.
        const downstreamClosedFirst = closed.slice(i + 1).some(Boolean);
        if (signal === 'SIGPIPE' || (downstreamClosedFirst && (code !== 0 || signal))) out[i].terminated_by_downstream_exit = true;
        stopUpstream(i);
        finishIfDone();
      });
      // The last stage's stdout is the result; with 2>&1 and no file, its stderr joins it.
      if (!feedsNext && child.stdout) child.stdout.on('data', (d) => onChunk('stdout', d, i));
      if (child.stderr) {
        const stream = s.mergeStderr && s.stdoutFd == null && !feedsNext ? 'stdout' : 'stderr';
        child.stderr.on('data', (d) => onChunk(stream, d, i));
      }
    }
    stdin.release();

    // The caller's way to stop every stage's tree at once (the output cap, G-14 of 20261116-001508-ci-review-2): a stop
    // through the same owner as the deadline's, its reason the caller's to record.
    onStart(() => { for (let i = 0; i < n; i++) stopStage(i, 'caller'); });
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      for (let i = 0; i < n; i++) stopStage(i, 'timeout');
    }, timeoutMs) : null;
    finishIfDone();
  });
}

/**
 * The pipeline's exit, pipefail by construction: the rightmost stage that failed decides; a stage stopped by its
 * downstream is not a failure unless `strict` (decision 3). 124 for a deadline; a stage that could not start is 127.
 */
export function pipelineExit({ stages, timedOut }, { strict = false } = {}) {
  if (timedOut) return 124;
  let code = 0;
  for (const s of stages) {
    if (s.error && s.status === null) { code = 127; continue; }
    if (s.terminated_by_downstream_exit && !strict) continue;
    const c = s.status ?? (s.terminated_by_downstream_exit ? 141 : 1);
    if (c !== 0) code = c;
  }
  return code;
}
