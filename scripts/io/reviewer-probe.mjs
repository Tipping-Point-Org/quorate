// THE REVIEWER PREFLIGHT'S I/O HALF (reviewer-preflight.plan.md, stage 1): one record file per combination's key, the
// lock that keeps two processes from probing one key at once, and the CLI version that is part of the key. The pure
// decisions — the key, whether a record counts, whether a probe passed — are scripts/lib/reviewer-probe.mjs.
//
// ONE FILE PER KEY, under the engine's per-user home (`<QUORATE_HOME>/reviewer-probes/<key>.json`; per machine, outside
// every repository). Nothing is read-modify-written by two processes: a probe writes its own key's file atomically, so
// parallel probes of different combinations cannot drop each other's records.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hostFs as fs, hostPlatform } from '../platform/index.mjs';
import { writeJsonAtomic, acquireFileLock } from './atomic.mjs';
import { needsShell, shellLaunchEnv } from '../lib/reviewers.mjs';
import { windowsShellArgv } from '../lib/decisions.mjs';

export * from '../lib/reviewer-probe.mjs';
import { probeCodeHash } from '../lib/reviewer-probe.mjs';
import { fileURLToPath } from 'node:url';

/** This engine's probe-code hash, from its own files (lib's PROBE_CODE_FILES under the framework root). */
export function frameworkProbeCodeHash() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  return probeCodeHash((rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } });
}

// QUORATE_REVIEWER_PROBES relocates the records; tests use it to give every call a directory of its own, so a passing
// probe recorded by one test can never satisfy another test's refusal case (plan stage 2; the per-call option its
// round-2 review offered). It must be absolute — a relative one would move with the working directory.
export function probesDir(home, env = process.env) {
  const declared = String(env.QUORATE_REVIEWER_PROBES ?? '').trim();
  if (declared) {
    if (!path.isAbsolute(declared)) throw new Error(`QUORATE_REVIEWER_PROBES must be absolute, got ${declared}`);
    return declared;
  }
  return path.join(home, 'reviewer-probes');
}
const recordPath = (home, key) => path.join(probesDir(home), `${key}.json`);

/** The record for a key, or null when there is none or it cannot be read (an unreadable record never counts). */
export function readProbeRecord(home, key) {
  try { return JSON.parse(fs.readFileSync(recordPath(home, key), 'utf8')); } catch { return null; }
}

/** Write a record for its own key, atomically. */
export function writeProbeRecord(home, record) {
  fs.mkdirSync(probesDir(home), { recursive: true });
  writeJsonAtomic(recordPath(home, record.key), record);
}

/**
 * Hold the key's lock while `fn` runs. The repository's own lock (O_EXCL, holding the pid, released on exit) — RECLAIMED
 * once older than the holder's maximum work (`staleMs`) but never while that pid is alive — and a wait bounded by that
 * plus the margin, after which acquireFileLock throws, naming the file. The caller re-reads the record once it holds the
 * lock: one written while it waited is used as it stands, so a waiter never probes after a holder that finished.
 */
/** withProbeLock for an asynchronous `fn`: the lock is held until its promise settles (G-3 of 20261010-071234). */
export async function withProbeLockAsync(home, key, limits, fn) {
  fs.mkdirSync(probesDir(home), { recursive: true });
  const release = acquireFileLock(path.join(probesDir(home), `${key}.lock`), {
    timeoutMs: limits.staleMs + limits.marginMs, staleMs: limits.staleMs,
  });
  try { return await fn(); } finally { release(); }
}

export function withProbeLock(home, key, limits, fn) {
  fs.mkdirSync(probesDir(home), { recursive: true });
  const release = acquireFileLock(path.join(probesDir(home), `${key}.lock`), {
    timeoutMs: limits.staleMs + limits.marginMs, staleMs: limits.staleMs,
  });
  try { return fn(); } finally { release(); }
}

/**
 * The directories a reviewer's PATH may not lead into (reviewer-path-entries.md I-1), for both launches: the directory
 * this process stands in, the repository it stands in — git's toplevel, so a launch from a subdirectory still names the
 * whole of it (G-2 of 20261017-060636-rpe-review) — and `extra` (the snapshot). Not in a repository: no toplevel.
 *
 * The toplevel is the nearest directory at or above this one holding a `.git` (a directory, or a worktree's or
 * submodule's file), found on the disk rather than asked of `git` (G-6 of 20261017-064450-rpe-remediation-review): a
 * bare `git` is resolved through the very PATH this filters, with the whole environment, before the filter has run, and
 * a `git` that failed or was missing read as "no repository", so the entry it should have dropped was kept.
 */
export function reviewerLaunchExclusions(extra = []) {
  const cwd = process.cwd();
  let root = '';
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) { root = dir; break; }
    if (path.dirname(dir) === dir) break;
  }
  return [cwd, ...(root ? [root] : []), ...extra.filter(Boolean)];
}

/** The real-path resolver both launches judge a PATH entry with (G-5 of 20261017-060636-rpe-review). */
export const launchRealpath = (p) => fs.realpathSync(p);

/** The sentence that says PATH entries were left out, or '' when none were (I-5). */
export function droppedNote(dropped) {
  return dropped ? `${dropped} PATH entr${dropped === 1 ? 'y' : 'ies'} relative or inside the repository ${dropped === 1 ? 'was' : 'were'} left out of the reviewer's PATH` : '';
}

/**
 * The CLI's version, from the adapter's own `version_argv`, bounded by `version_timeout_seconds` — launched the way
 * external-review launches the vendor (a shell only where the platform and the adapter both need one). An adapter that
 * declares no version command keys as 'undeclared'; one whose command fails or does not exit in time is a failure,
 * named, which fails the probe it belongs to.
 */
export function cliVersion(adapter, limits, { spawn = spawnSync, platform = hostPlatform(), env = process.env, inside = [] } = {}) {
  const shell = needsShell(adapter, platform);
  // Not looked up in the current directory (G-8 of 20261016-214749-sp-bugs-remediation-2-review), nor through a PATH
  // entry that is relative or leads into the repository (reviewer-path-entries.md), as the call itself. The launch
  // directory is always one of them: this spawn names none, so it runs where this process stands.
  const launch = shellLaunchEnv(env, shell, { platform, inside: reviewerLaunchExclusions(inside), realpath: launchRealpath });
  // Filtered before the undeclared return, so that branch carries the count too (I-5; G-9 of
  // 20261017-173539-rpe-remediation-3-review): the preflight reads it from here on every exit.
  if (!Array.isArray(adapter?.version_argv)) return { ok: true, version: 'undeclared', dropped: launch.dropped };
  const argv = shell ? windowsShellArgv(adapter.version_argv) : adapter.version_argv;
  // A refusal says when filtering may be why (I-5; G-4 of 20261017-060636-rpe-review): the preflight refuses before the
  // call's own report of the count is ever reached.
  // The count is returned as well, for the caller's stderr line (G-6 of 20261017-071826-rpe-remediation-2-review).
  const why = (reason) => ({ ok: false, reason: launch.dropped ? `${reason} (${droppedNote(launch.dropped)})` : reason, dropped: launch.dropped });
  const r = spawn(adapter.cmd, argv, { encoding: 'utf8', timeout: limits.versionMs, shell, windowsHide: true, env: launch.env });
  if (r.error?.code === 'ETIMEDOUT' || (r.signal && r.status === null)) {
    return why(`the version command (${[adapter.cmd, ...adapter.version_argv].join(' ')}) did not exit within ${limits.versionMs / 1000} s`);
  }
  if (r.error) return why(`the version command could not run: ${r.error.code ?? r.error.message}`);
  const version = `${r.stdout ?? ''}`.trim().split('\n')[0];
  if (r.status !== 0 || !version) {
    // THE EXIT, NOT THE OUTPUT (G-10 of 20261010-082146-reviewer-preflight-r8): this reason is printed by new-run and
    // recorded in tracked status, and a failing CLI's output can carry a credential.
    return why(`the version command exited ${r.status} ${version ? 'with output (not quoted)' : 'with no output'}`);
  }
  // The count on success too (I-5; G-8 of 20261017-064450-rpe-remediation-review): --preflight-only exits before the
  // call that would say it.
  return { ok: true, version, dropped: launch.dropped };
}
