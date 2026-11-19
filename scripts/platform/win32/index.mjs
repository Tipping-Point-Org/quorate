// WINDOWS (os-platform-adapters, criterion 3).
//
// Windows has no POSIX process groups or signals: `process.kill(-pid)` is a group signal only on
// POSIX, and here it would end one process and orphan its children. Job objects exist but Node does
// not expose them to this code, so `taskkill /T` walks the parent-child tree instead. `detached` means
// something unrelated on Windows (a new console, a child that outlives its parent), so it stays false.
//
// WHAT NOT DETACHING BUYS, AND WHERE IT COMES FROM (G-1 of 20261002-215002-stop-child-review). Node's own
// documentation of `detached` says that on Windows it is what "makes it possible for the child process
// to continue running after the parent exits" — so a child started WITHOUT it does not. The mechanism is
// the runtime's, not this engine's: libuv places every non-detached child in a job object that ends it
// when the parent goes (inferred from that documented behaviour; libuv's source was not read). Nothing
// here creates or configures that job, and A-25 relies on it, so it is measured rather than assumed:
// tests/regression-windows-job.test.mjs.
import { commonFs, commonProc, commonAmbient } from '../common/index.mjs';

// The longest a taskkill given no deadline is waited for before its answer is null, "not confirmed" (G-6 of
// 20261106-182300-nbk-delivery): measured taskkills answer in 265-400 ms (non-blocking-kill.design.md NB-D2), so this
// bounds only a hung one.
export const KILL_TREE_TIMEOUT_MS = 10_000;
// The one taskkill a tree kill runs, for both primitives.
const taskkillArgs = (pid) => ['/pid', String(pid), '/T', '/F'];

export const win32 = Object.freeze({
  id: 'win32',
  name: 'win32',
  // NTFS's default: `Guide.md` and `guide.md` are one file (G-8 of 20260924-172034-post-med4).
  caseInsensitiveFs: true,
  // CreateProcess caps a whole command line at 32,767 UTF-16 units; this leaves room for the command and its flags.
  maxArgBytes: 24_000,
  // npm installs a CLI as .cmd/.ps1 wrappers, which CreateProcess cannot execute, and Node refuses to
  // spawn a .cmd without a shell since CVE-2024-27980. A real .exe must NOT get one — the adapter's
  // own `needs_shell_on_windows` says which it is; this says only that the question applies here.
  needsShellForShims: true,
  // WHAT A COMMAND NEEDS TO START HERE (candidate-check-boundaries.plan.md stage 2). Without SystemRoot a child cannot
  // load its DLLs; without PATHEXT and ComSpec a shim cannot be resolved; the profile folders hold the user's tools.
  // LOGONSERVER because Node adds it anyway: libuv copies its required variables (HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH,
  // SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR) from the parent into every child it starts,
  // so it crosses whatever this list says (found by the exact name-set test, G-18 of 20261014-022857-ccb-delivery).
  processEnvBasics: Object.freeze([
    'PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE',
    'HOMEPATH', 'HOME', 'LOGONSERVER', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432',
    'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432', 'NUMBER_OF_PROCESSORS', 'OS',
    'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'LANG', 'LC_*', 'TERM', 'TZ',
  ]),
  // Windows environment names are case-insensitive: `Path` and `PATH` are one variable.
  caseInsensitiveEnv: true,
  // PATH and PATHEXT as cmd.exe reads them; PATHEXT's own default when it is unset. A .cmd or .bat needs cmd.exe.
  pathFlavor: 'win32',
  pathListDelimiter: ';',
  executableExts: Object.freeze(['.COM', '.EXE', '.BAT', '.CMD']),
  shimExts: Object.freeze(['.cmd', '.bat']),
  // A virus scanner or indexer briefly holding the target makes a rename fail with these; the atomic
  // writer retries them with backoff. On POSIX a rename over an open file succeeds, so none apply.
  transientRenameCodes: new Set(['EPERM', 'EACCES', 'EBUSY']),
  fs: commonFs,
  proc: Object.freeze({
    ...commonProc,
    killableSpawnOptions: () => ({ detached: false }),
    // NO FILE-SIZE CEILING HERE (design 4B; "Not in this design": Job Objects have no file-size limit). A non-detached
    // child is ended by the runtime's job when its parent exits (see the header), so what a refused or unconfirmed kill leaves is the
    // window until spawn-node's own exit, which open question 3 put to the operator and they accepted. Said as null,
    // so a status can state that no ceiling applied rather than imply one did.
    boundedLaunch: (cmd, args = []) => ({ cmd, args: [...args], ceilingBytes: null }),
    /**
     * Returns whether taskkill succeeded: a refused taskkill must not leave a node hanging past its
     * timeout holding a concurrency slot with no recorded reason (G-43), so the caller is told.
     * `signal` and `escalateAfterMs` do not apply — /F is already forceful.
     */
    // NB-D1 B (non-blocking-kill.plan.md stage 1): killTreeNow is the synchronous taskkill, for the exit hook, which cannot
    // wait; killTree spawns taskkill and resolves with its exit status, so a caller stopping several children starts
    // every kill before it waits for any (A-25's one deadline). A taskkill blocked for ~350 ms each, serially, outside it
    // (measured 2026-11-06: 265-400 ms idle, 271-371 ms under load; non-blocking-kill.design.md NB-D2).
    // `spawnSync` is injectable, so the answer's mapping from taskkill's exit status is tested by running it (G-9 of
    // 20261106-182300-nbk-delivery).
    killTreeNow(pid, { spawnSync = commonProc.spawnSync } = {}) {
      const tk = spawnSync('taskkill', taskkillArgs(pid), { stdio: 'ignore' });
      return tk?.status === 0;
    },
    // `timeoutMs` is what remains of the caller's deadline (NB-D2 A): a taskkill still running then is itself stopped and
    // the answer is null, "not confirmed", never delivered, so the child is reported unconfirmed rather than refused.
    // With no deadline it is KILL_TREE_TIMEOUT_MS, so a hung taskkill never holds this process open (G-6 of
    // 20261106-182300-nbk-delivery). A timed-out taskkill is let go (unref), so it cannot hold it either (G-8 of the same
    // review), whether its own kill was refused or accepted.
    // `spawn` is injectable: a taskkill that never exits cannot be produced on request.
    killTree(pid, { timeoutMs = null, spawn = commonProc.spawn } = {}) {
      const limit = Number.isFinite(timeoutMs) ? timeoutMs : KILL_TREE_TIMEOUT_MS;
      return new Promise((resolve) => {
        let done = false;
        let timer = null;
        const finish = (answer) => { if (done) return; done = true; clearTimeout(timer); resolve(answer); };
        let tk;
        try { tk = spawn('taskkill', taskkillArgs(pid), { stdio: 'ignore', windowsHide: true }); } catch { return finish(false); }
        tk.once('exit', (code) => finish(code === 0));
        tk.once('error', () => finish(false));
        // Let go whatever its kill answers (G-9 of 20261106-190129-nbk-remediation-review): an accepted kill is not an
        // exit, so a taskkill that lingers after one held the process open as a refused one did.
        timer = setTimeout(() => {
          try { tk.kill(); } catch { /* let go below either way */ }
          try { tk.unref?.(); } catch { /* diagnostic only */ }
          finish(null);
        }, Math.max(0, limit));
      });
    },
    /**
     * When a process started, in epoch milliseconds, or null when Windows will not say (no such process, no access,
     * PowerShell missing or slow). A session record's lock holds its writer's pid and start time; a lock whose pid is
     * alive but started at another time belongs to a reused pid (session-record-files.plan.md stage 1).
     */
    startedAt(pid) {
      if (!Number.isSafeInteger(pid) || pid <= 0) return null;
      const r = commonProc.spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).StartTime.ToUniversalTime().ToString('o')`],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const ms = r.status === 0 ? Date.parse(String(r.stdout ?? '').trim()) : NaN;
      return Number.isFinite(ms) ? ms : null;
    },
  }),
  ...commonAmbient,
});
