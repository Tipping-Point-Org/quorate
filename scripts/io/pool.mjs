// THE CHILD-PROCESS HALF OF THE POOL (os-platform-adapters stage 4), moved out of lib/: shAsync spawns,
// and lib/ does not. The concurrency itself — runPool, makeLock, runBudgetedPool — stays pure in
// lib/pool.mjs, re-exported here so a caller imports one module.
import { hostProc } from '../platform/index.mjs';
import { stdinFrom } from './stdin-file.mjs';

export * from '../lib/pool.mjs';

const { spawn } = hostProc;   // lazy: looks the host up per call, not at import

/**
 * How much of a child's output is kept. The bench runs whole graph runs as children, several at a
 * time, and each prints without bound — so an unbounded accumulator retained every byte of every
 * concurrent run for the lifetime of the pool, in the one process that must outlive them all (G-5).
 *
 * The HEAD is what is kept: this output exists to diagnose a child that failed to start or died
 * early, and the tail of a 200MB progress stream diagnoses nothing. Truncation is STATED in the
 * text rather than silent — a log that quietly stops is indistinguishable from a child that quietly
 * stopped, which is the confusion this project refuses everywhere else.
 */
export const CHILD_OUTPUT_CAP = 1 << 20;   // 1 MiB of characters per child

/**
 * Spawn a child WITHOUT blocking the event loop, capturing stdout+stderr.
 *
 * Lives here beside runPool because it is half of the same guarantee: a concurrent loop over a
 * BLOCKING spawn is not concurrent. bench-lenses held these privately, so the regression test could
 * only grep its source for `await shAsync(` — which still passed if the helper itself became
 * blocking, and therefore could not fail for the behaviour it claimed to protect (G-59). Exported
 * so the test can measure instead of read.
 */
export function shAsync(cmd, argv, opts = {}) {
  // `input`: text the child reads as its stdin (decision-panel-seats.plan.md stage 2: the bench forge's prompt, when its
  // runtime takes it there), from a file (io/stdin-file.mjs), never a pipe whose close waits on the child's reading.
  // Absent, stdin is ignored as before. Not an option of spawn itself.
  const { input = null, ...spawnOpts } = opts;
  return new Promise((resolve) => {
    const stdin = stdinFrom(input);
    let p;
    try { p = spawn(cmd, argv, { ...spawnOpts, stdio: [stdin.fd, 'pipe', 'pipe'] }); } finally { stdin.release(); }
    let out = '';
    let stdoutText = '';   // stdout ALONE — see the finish() note
    let produced = 0;      // bytes the child wrote, counted without decoding any of them
    let capped = false;
    const take = (d) => {
      // THE CAP IS CHECKED BEFORE THE DECODE (G-18). `String(d)` ran on every chunk first, purely
      // so the dropped counter could read `s.length` — so a child that would not stop writing still
      // allocated a full string per chunk after the cap was reached, and then threw it away. The cap
      // bounded RETENTION and not allocation, which is most of what a cap on a runaway child is for.
      produced += d.length;
      const room = Math.max(CHILD_OUTPUT_CAP - out.length, 0);
      if (!room) { capped = true; return; }
      const s = String(d);
      if (s.length > room) { out += s.slice(0, room); capped = true; }
      else out += s;
    };
    // STDOUT IS ALSO KEPT ON ITS OWN (G-38). Both streams merge into `out` — right for a log, and
    // wrong for a caller that needs one of them: capture.mjs reserves stdout for the evidence PATH
    // and writes its preview to stderr, so run-checks' concurrent path recorded a multi-line blob
    // as `evidence_path` while its synchronous twin recorded the path. The test-log lookup then
    // failed to open it and every concurrent run was stamped TESTS-UNCOUNTED. Same cap, same
    // check-before-decode discipline: a second unbounded buffer would undo what the cap is for.
    p.stdout.on('data', (d) => {
      const room = Math.max(CHILD_OUTPUT_CAP - stdoutText.length, 0);
      if (room) stdoutText += String(d).slice(0, room);
      take(d);
    });
    p.stderr.on('data', take);
    const finish = (status, extra = '') => resolve({
      status,
      // `out` is BOTH streams, for logs and diagnostics. `stdout` is stdout alone, for a caller
      // that needs the child's actual answer — a path, an id — rather than everything it said.
      stdout: stdoutText,
      // REPORTS WHAT IT MEASURED, not a figure derived from two different units. The old message
      // named a count of dropped CHARACTERS, which is only knowable by decoding the very chunks the
      // cap exists to avoid decoding. Bytes produced is exact, free, and answers the question a
      // reader of a truncated log actually has: how much is missing.
      out: out + extra + (capped
        ? `\n[...output capped at ${CHILD_OUTPUT_CAP} characters; this child produced ${produced} bytes in total]`
        : ''),
      truncated: capped,
    });
    // The stdin file's folder, if the child's handle refused its removal at the spawn.
    p.on('error', (e) => { stdin.release(); finish(-1, `\n${e.message}`); });
    p.on('close', (code) => { stdin.release(); finish(code ?? -1); });
  });
}
