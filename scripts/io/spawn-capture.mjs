// A child whose output this process reads whole — an external panel arm or an adjudicator — run without blocking the
// event loop, its output captured up to a cap, stopped through the one owner if it outlives its timeout.
//
// MOVED OUT OF run-graph.mjs (stopping-a-child stage 2) so it can be driven with a real child: inside run-graph it was a
// closure over the `live` map, and every property it has — the 'close' wait, the refused kill, the cap — was pinned by
// matching run-graph's source text (G-23 of 20260925-200721-platform-remediated, ledger
// tests/regression-refused-kill-followups.test.mjs:30). The caller keeps `live`; it is told through onSpawn and onDone.
//
// spawnSync BLOCKED the event loop, which is what serialised the panel (six arms, 30.5 minutes, each start stamped at the
// previous arm's end). This is the async equivalent, shaped like a spawnSync result so the callers' parsing is unchanged.
import { spawn as nodeSpawn } from 'node:child_process';
import { stopChild, ESCALATE_AT_ONCE_MS } from './stop-child.mjs';
import { stopRecord } from '../lib/stop-vocabulary.mjs';
import { stdinFrom } from './stdin-file.mjs';

// Mirrors the maxBuffer the sync form declared, per stream.
export const CAPTURE_MAX_BYTES = 32 * 1024 * 1024;

/**
 * What a node's status keeps of a captured result (G-11, G-13 of 20261002-215002-stop-child-review): a survivor named as
 * A-25 names one — `orphan_pid` with `kill_refused` or `kill_unconfirmed` — and output dropped past the cap, per stream.
 * Every writer that receives a captured result spreads this, so the arms and the adjudicators record what lens nodes do.
 * Empty for a child that exited whole. Pure.
 */
export function capturedStatusFields({ survivor = null, capped = null } = {}) {
  // A survivor's fields are lib/stop-vocabulary.mjs's (stopping-a-child-vocabulary, 1A/2A); the dropped bytes are this
  // module's own fact.
  const out = survivor ? { ...stopRecord({ outcome: survivor.outcome, pid: survivor.pid, reason: 'timeout', context: 'captured' }).fields } : {};
  if (capped && (capped.stdout > 0 || capped.stderr > 0)) {
    out.output_capped = true;
    out.output_dropped_bytes = { stdout: capped.stdout, stderr: capped.stderr };
  }
  return out;
}

/**
 * @param onSpawn(child)   the caller registers the child (run-graph's `live`), so an interrupt can stop it.
 * @param onDone({ survivor })   called once; `survivor` is null when the child is gone, or `{ outcome, pid }` when it may
 *   still run — refused or unconfirmed — and the caller keeps it registered, so killAllLive and the reaper can still
 *   reach it (G-23).
 * @param stop   the owner's stopChild, injectable for the outcomes no OS produces on request.
 * @returns {Promise<{ status, signal, stdout, stderr, error, timedOut, capped: { stdout, stderr }, survivor }>}
 *   capped: the bytes dropped past maxBytes on each stream.
 */
export function spawnCapture(cmd, argv, opts, {
  timeoutMs, onSpawn = () => {}, onDone = () => {}, stop = stopChild, maxBytes = CAPTURE_MAX_BYTES, spawn = nodeSpawn,
  // Text the child reads as its stdin (stop-owner-grep-state-roots.plan.md stage 1): external-review hands a reviewer its
  // prompt this way, and spawn-subagent the node runtime its prompt (decision-panel-seats.plan.md stage 2). From a file
  // (io/stdin-file.mjs) since that stage: a pipe's close waited on the child's reading, so a survivor that never read it
  // held this process open. Absent, stdin is ignored as before.
  input = null,
  // WHERE THE OUTPUT GOES, WHEN NOT INTO MEMORY (capture-interactive.plan.md stage 3: "one async core, deadlines as
  // parameters, two front ends", ROADMAP.md M2 item 7). Absent, each stream is kept whole up to maxBytes, as every caller
  // before capture.mjs needs. Given, `collector.take(name, chunk)` receives every chunk of 'stdout' and 'stderr' and the
  // result carries `collector.result()` as `streams`, with stdout and stderr left empty: capture.mjs keeps a bounded head
  // and tail of each for its log window, and the interactive front end writes each stream to a file.
  collector = null,
} = {}) {
  if (collector && (typeof collector.take !== 'function' || typeof collector.result !== 'function')) {
    throw new TypeError('spawnCapture: a collector has take(name, chunk) and result()');
  }
  return new Promise((resolve) => {
    let child;
    let stdin = { release: () => {} };
    try {
      stdin = stdinFrom(input);
      child = spawn(cmd, argv, { ...opts, stdio: [stdin.fd, 'pipe', 'pipe'] });
      // The child holds its own handle on the file; this process's goes, and the folder where the host allows.
      stdin.release();
    } catch (e) {
      stdin.release();
      onDone({ survivor: null });
      resolve({ status: null, stdout: '', stderr: String(e?.message ?? e), error: e, timedOut: false,
        capped: { stdout: 0, stderr: 0 }, survivor: null, ...(collector ? { streams: collector.result(), stopSentence: null } : {}) });
      return;
    }
    // Byte-counted, so the cap is a cap on bytes and the dropped count is exact.
    const collect = () => ({ chunks: [], kept: 0, dropped: 0 });
    const out = collect();
    const err = collect();
    const take = (s) => (d) => {
      const room = maxBytes - s.kept;
      if (room <= 0) { s.dropped += d.length; return; }
      const part = d.length > room ? d.subarray(0, room) : d;
      s.chunks.push(part);
      s.kept += part.length;
      s.dropped += d.length - part.length;
    };
    child.stdout.on('data', collector ? (d) => collector.take('stdout', d) : take(out));
    child.stderr.on('data', collector ? (d) => collector.take('stderr', d) : take(err));
    onSpawn(child);

    let done = false;
    let timedOut = false;
    let survivor = null;
    // `signal` is the one a child closed with (code-index.plan.md stage 6): without it a signal-killed child read as a
    // failure of its own, and check-outcomes' `incomplete` was unreachable for a captured child.
    const finish = (status, error, signal = null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stdin.release();
      onDone({ survivor });
      // A collector's caller writes its own record: it gets the streams and the stop's sentence, not a stderr string.
      if (collector) {
        const stopSentence = timedOut ? stopRecord({ outcome: survivor ? survivor.outcome : 'exited',
          pid: survivor ? survivor.pid : child?.pid, reason: 'timeout', context: 'captured' }).sentence : null;
        resolve({ status, signal, stdout: '', stderr: '', error: error ?? null, timedOut, capped: { stdout: 0, stderr: 0 },
          survivor, streams: collector.result(), stopSentence });
        return;
      }
      let stderr = Buffer.concat(err.chunks).toString();
      // EVERY CAP IS SAID (ledger run-graph.mjs:2230): the stream was cut silently, and a truncated envelope read as an
      // arm that returned nothing parseable.
      for (const [name, s] of [['stdout', out], ['stderr', err]]) {
        if (s.dropped) stderr += `\n[output capped: ${s.dropped} bytes of ${name} dropped past ${maxBytes} bytes]`;
      }
      // The stop's outcome in the owner's words — this said "killed by orchestrator" for every timed-out capture, the
      // refused and unconfirmed survivors included (G-8 of 20261003-041945-stop-child-vocabulary-review).
      if (timedOut) {
        const said = stopRecord({ outcome: survivor ? survivor.outcome : 'exited', pid: survivor ? survivor.pid : child?.pid,
          reason: 'timeout', context: 'captured' }).sentence;
        stderr += `\n[timed out after ${timeoutMs}ms: ${said}]`;
      }
      resolve({
        status, signal, stdout: Buffer.concat(out.chunks).toString(), stderr, error: error ?? null, timedOut,
        capped: { stdout: out.dropped, stderr: err.dropped }, survivor,
      });
    };
    // Past its OWN timeout the child is already unresponsive, so the stop is immediate (no grace for SIGTERM). A stop that
    // is not seen to end the child ends the wait here: its 'close' may never come, and waiting for it hung the whole
    // panel or adjudication pool short of the gate (G-22). Its pipes are destroyed so it cannot hold this process open;
    // the owner has unref'd it.
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      stop(child, { event: 'close', escalateAfterMs: ESCALATE_AT_ONCE_MS }).then(({ outcome, pid }) => {
        if (outcome === 'exited') return;   // 'close' has finished it
        survivor = { outcome, pid };
        try { child.stdout?.destroy(); } catch {}
        try { child.stderr?.destroy(); } catch {}
        finish(null, new Error(`timed out after ${timeoutMs}ms and ${stopRecord({ outcome, pid, reason: 'timeout', context: 'captured' }).sentence}`));
      });
    }, timeoutMs) : null;
    // 'close', NOT 'exit': 'exit' fires while stdio may still hold buffered data, and a truncated envelope reads as "no
    // parseable verdict", the indistinguishable failure external-review exists to prevent (G-35).
    child.on('close', (code, signal) => finish(code, undefined, signal ?? null));
    child.on('error', (e) => finish(null, e));
  });
}
