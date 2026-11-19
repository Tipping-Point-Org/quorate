// WHAT LINUX AND MACOS SHARE AND WIN32 DOES NOT (os-platform-adapters, criteria 9 and 12).
//
// THE ENVIRONMENT A COMMAND NEEDS TO START on POSIX (candidate-check-boundaries.plan.md stage 2): the allow-list a
// candidate check begins from, before the git identity and what a contract declares in review.candidate_env.
import { spawnSync } from 'node:child_process';

export const POSIX_ENV_BASICS = Object.freeze([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE', 'LC_*', 'TERM', 'TZ',
]);
//
// Written once, here, and built on by both linux/ and macos/ — so neither operating system's folder
// depends on the other's.
//
// A child that must be killable WITH ITS DESCENDANTS is started `detached`: on POSIX that makes it
// the leader of a new process group, and a signal to the negative pid then reaches the whole group.
// A node child is itself a process that starts further work (spawn-node -> claude; external-review
// -> the vendor CLI), so killing only the direct child orphans the process actually doing the work.

// THE DISK CEILING FOR A MODEL CHILD (stopping-a-child stage 5, design 4B; operator, 2026-10-02: "4 GB (Recommended)").
// Disk protection, NOT the node's output cap: run-child samples and kills at the cap, and this is what still holds when it
// cannot — a kill the OS refused, or one accepted and never seen to take effect (ledger io/run-child.mjs:80,
// spawn-node.mjs:1210/1230). Far above any legitimate log. A runaway can still write this much per file before the kernel
// stops it (SIGXFSZ, or EFBIG where the signal is ignored).
export const FILE_SIZE_CEILING_BYTES = 4 * 1024 ** 3;
// POSIX sh counts `ulimit -f` in 512-byte blocks (bash only outside POSIX mode uses 1024; /bin/sh is POSIX sh). NOT ON
// macOS: its /bin/sh counted 1024, measured on PR #3's macOS job (CI run 44220656481), where a 64 KiB ceiling let the file
// grow to exactly 131072 bytes. The macOS platform builds its launch with boundedLaunchFor(1024) (ci-path-identity.plan.md
// stage 3b).
const ULIMIT_BLOCK_BYTES = 512;
/** The bounded launch for a shell whose `ulimit -f` counts in `blockBytes`. */
export function boundedLaunchFor(blockBytes) {
  return (cmd, args = [], { ceilingBytes = FILE_SIZE_CEILING_BYTES } = {}) => {
    const blocks = Math.floor(ceilingBytes / blockBytes);
    return { cmd: '/bin/sh', args: ['-c', BOUNDED, 'sh', String(blocks), cmd, ...args], ceilingBytes: blocks * blockBytes };
  };
}
// The arguments travel as "$@" and the block count as "$1": nothing is interpolated into the script, so no argument —
// spaces, quotes, a leading dash — is ever parsed by the shell. `sh` after the script is $0, the placeholder. `;`, not
// `&&`, as the design wrote it: a ulimit refused because the hard limit is already lower leaves the child MORE bounded,
// and must not stop the node from launching.
const BOUNDED = 'ulimit -f "$1"; shift; exec "$@"';

/**
 * Signal the child's whole process group. With `escalateAfterMs`, follow up with SIGKILL for
 * whatever ignored the first signal.
 *
 * Returns whether the group is gone or was signalled. ONLY ESRCH means "already gone" (G-18 of
 * 20260925-015614-platform-review): every error used to be swallowed as that, so an EPERM — a
 * group this process may not signal, still running and still carrying the operator's credentials —
 * was reported to the caller as killed. `kill` is injectable so both outcomes can be tested.
 */
function killTreeNow(pid, { signal = 'SIGTERM', escalateAfterMs = null, kill = process.kill.bind(process) } = {}) {
  let delivered = true;
  try {
    kill(-pid, signal);
  } catch (e) {
    if (e?.code === 'ESRCH') return true;   // nothing left to kill, so nothing to escalate
    delivered = false;
  }
  // ESCALATE EVEN AFTER A REFUSAL (G-19 of 20260925-200721-platform-remediated). The G-18 fix returned
  // before this, so a refused SIGTERM lost the SIGKILL the pre-refactor code always attempted.
  // Reporting the refusal and still escalating were never in conflict.
  if (escalateAfterMs != null) {
    setTimeout(() => {
      try { kill(-pid, 'SIGKILL'); } catch { /* gone by now, or refused again */ }
    }, escalateAfterMs).unref();
  }
  return delivered;
}

export const posixProc = Object.freeze({
  killableSpawnOptions: () => ({ detached: true }),

  /**
   * When a process started, in epoch milliseconds, or null when the OS will not say. `ps -o lstart=` prints the start in
   * the C locale's fixed form, which Date.parse reads as local time (session-record-files.plan.md stage 1).
   */
  startedAt(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000, env: { ...process.env, LC_ALL: 'C' } });
    const ms = r.status === 0 ? Date.parse(String(r.stdout ?? '').trim()) : NaN;
    return Number.isFinite(ms) ? ms : null;
  },

  /**
   * The command, run under a file-size ceiling. `exec` replaces the shell, so the pid and the process group a kill
   * targets are the command's own.
   */
  boundedLaunch: boundedLaunchFor(ULIMIT_BLOCK_BYTES),

  // NB-D1 B (non-blocking-kill.plan.md stage 1): killTreeNow is the synchronous signal, for the exit hook, which cannot
  // wait; killTree answers the same with a promise, so every platform's caller awaits one shape. The signal is immediate
  // here, so the promise is resolved at once; win32's is not.
  killTreeNow,
  killTree(pid, opts = {}) {
    const { timeoutMs, ...rest } = opts;   // a timeout is win32's: a signal does not wait
    return Promise.resolve(killTreeNow(pid, rest));
  },
});
