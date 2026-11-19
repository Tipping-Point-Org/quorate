// The repository-wide remediation lock's I/O (remediation-consumer-findings.plan.md stage 2): where it lives, taking it
// atomically, and releasing it. What a held lock means is lib/repo-lock.mjs's.
//
// It lives under the engine's home, keyed by the repository's git COMMON directory, so every linked worktree of one
// repository shares one lock (operator, 2026-10-20: "Engine home, keyed by git's common dir (Recommended)").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gitSync } from './git.mjs';
import { hostPlatform } from '../platform/index.mjs';
import { quorateHome } from './reviews-root.mjs';
import { lockState } from '../lib/repo-lock.mjs';

/** The lock file for `repo`'s repository, under `home` (default: the engine's home). Throws when git cannot say. */
export function repoLockPath(repo, { home = quorateHome() } = {}) {
  const r = gitSync(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error(`git rev-parse --git-common-dir failed in ${repo}: ${String(r.stderr ?? '').trim()}`);
  let dir = r.stdout.trim();
  try { dir = fs.realpathSync.native(dir); } catch { /* the path git printed */ }
  dir = path.resolve(dir).split(path.sep).join('/');
  if (hostPlatform().caseInsensitiveFs) dir = dir.toLowerCase();
  const key = crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32);
  return path.join(home, 'locks', `${key}.lock`);
}

/**
 * Take the lock at `lockPath` for `runId`, atomically (created exclusively, with its content). Returns { ok: true } or
 * { ok: false, state, record } with state from lib/repo-lock.mjs's lockState, for the caller's refusal.
 */
export function acquireRepoLock(lockPath, runId) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const record = { run_id: runId, pid: process.pid, host: os.hostname(), started_at: new Date().toISOString() };
  try {
    fs.writeFileSync(lockPath, JSON.stringify(record), { flag: 'wx' });
    return { ok: true };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  let held = null;
  try { held = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* unreadable */ }
  const alive = Number.isInteger(held?.pid) && hostPlatform().proc.isAlive(held.pid);
  return { ok: false, state: lockState({ record: held, host: os.hostname(), alive }), record: held };
}

/** Remove the lock if this process holds it. Returns null, or the error's code when removal failed. */
export function releaseRepoLock(lockPath) {
  let held = null;
  try { held = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (e) { return e?.code === 'ENOENT' ? null : (e?.code ?? 'EREAD'); }
  if (held?.pid !== process.pid || held?.host !== os.hostname()) return null;
  try { fs.unlinkSync(lockPath); return null; } catch (e) { return e?.code === 'ENOENT' ? null : (e?.code ?? 'EUNLINK'); }
}
