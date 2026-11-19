// Where a long run's state is kept (autonomous-run.plan.md stage 7): one file per repository under the engine's home,
// keyed as the session records are (`repoKey`), so it is outside every repository and git, and survives the session
// that wrote it. What the state means is lib/run-state.mjs's; this module finds, reads and writes the file, and the
// once-a-day CLI freshness cache beside it.

import fs from 'node:fs';
import path from 'node:path';
import { quorateHome } from './reviews-root.mjs';
import { repoKey } from '../lib/reviews-root.mjs';
import { isWithin, linkForms, rootSpelling } from './finding-scope.mjs';
import { acquireFileLock } from './atomic.mjs';
import { confined } from './confined-path.mjs';
import { runStateErrors, bindSession } from '../lib/run-state.mjs';

// A path as the filesystem resolves it: its nearest existing ancestor's real path, with the rest joined on. Links are
// followed, so the checks below compare where a path leads, not how it is spelled (G-4 of
// 20261105-013235-ar-d1-c-remediation-review). The rule is linkForms', its one owner (G-8 of
// 20261105-021654-ar-d1-c-remediation-2-review: this file carried a second copy); a real path it cannot resolve is refused.
function realOf(p) {
  const forms = linkForms(path.resolve(p));
  if (!forms) throw new Error(`${p}: its real path could not be resolved; refused`);
  return forms.at(-1);
}

/**
 * The folder of this repository's run under the engine's home. A home inside the repository is refused, judged where
 * it leads, and so is a folder a link below the home leads outside it (G-4 of 20261105-013235-ar-d1-c-remediation-review).
 */
export function runFolder(repoRoot, { home = quorateHome() } = {}) {
  const root = path.resolve(repoRoot);
  const realHome = realOf(home);
  if (isWithin(root, path.resolve(home)) || isWithin(realOf(root), realHome)) {
    throw new Error(`the engine home ${home} is inside the repository ${root}; a run's state must live outside it`);
  }
  // Keyed by the repository as the filesystem spells it (canonicalSpelling): an 8.3 short and a long spelling of one
  // repository were two folders, so a hook given git's long toplevel missed the state (CI run 43281517496).
  // On its real path since ci-path-identity.plan.md stage 1c (rootSpelling), as every repoKey caller is.
  const keyed = rootSpelling(root);
  const folder = path.join(home, 'session-runs', repoKey(path.basename(keyed), keyed));
  const realFolder = realOf(folder);
  if (realFolder !== path.join(realHome, path.relative(path.resolve(home), folder))) {
    throw new Error(`a link below the engine home ${home} leads the run's folder to ${realFolder}; refused`);
  }
  return folder;
}

export const runStatePath = (repoRoot, opts) => path.join(runFolder(repoRoot, opts), 'run-state.json');
export const freshnessPath = (opts = {}) => path.join(opts.home ?? quorateHome(), 'cli-freshness.json');

// THE ENGINE HOME'S OWNER (contract-runtime-and-session-files.plan.md stage 3; design CR-D3 A, ARCHITECTURE.md A-30): every
// read, write and remove of the run state and the freshness cache goes through `confined`, rooted at the engine's home, so
// a link at the home, at any folder below it or at the file is refused, never followed (G-14 of
// 20261105-021654-ar-d1-c-remediation-2-review found a write confined only from its own folder). The home itself is made
// if missing: it is the root, and a link there is refused by the owner before every operation.
function homeOwner(opts) {
  const home = path.resolve(opts?.home ?? quorateHome());
  fs.mkdirSync(home, { recursive: true });
  return { home, own: confined(home) };
}
// The run folder's segments below the home, after runFolder's own checks (inside the repository, led outside by a link).
function stateOwner(repoRoot, opts) {
  const folder = runFolder(repoRoot, opts);
  const { home, own } = homeOwner(opts);
  return { own, segs: path.relative(home, path.resolve(folder)).split(path.sep), p: path.join(folder, 'run-state.json') };
}
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

/** The active run's state, or null when there is none; a file that is not a valid state is an error, named. */
// Read through the home's owner (G-9 of 20261105-021654-ar-d1-c-remediation-2-review): a link at run-state.json itself, or
// at any folder above it, is refused, never followed to outside JSON taken as the active run. Absent is ENOENT only.
export function readRunState(repoRoot, opts) {
  const { own, segs, p } = stateOwner(repoRoot, opts);
  let text;
  try { text = own.read([...segs, 'run-state.json']); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
  const s = JSON.parse(text);
  const errs = runStateErrors(s);
  if (errs.length) throw new Error(`${p}: ${errs.join('; ')}`);
  return s;
}

/**
 * Write the run's state. With `exclusive` (a `start`), the file must not exist: the state is created beside it and
 * hard-linked into place, which fails if another start got there first, so two starts at once cannot both succeed
 * (G-13 of 20261105-004603-ar-d1-c-review). The file appears whole or not at all. Both names go through the owner; the
 * hard link itself is one call on the two paths it checked (A-30's residual: a swap between the check and the call).
 */
export function writeRunState(repoRoot, state, opts) {
  const { own, segs, p } = stateOwner(repoRoot, opts);
  if (!opts?.exclusive) { own.replace([...segs, 'run-state.json'], json(state)); return p; }
  const tmp = [...segs, `run-state.json.${process.pid}.${Date.now()}.new`];
  own.create(tmp, json(state));
  try {
    fs.linkSync(own.resolve(tmp), own.resolve([...segs, 'run-state.json']));
  } catch (e) {
    if (e?.code === 'EEXIST') throw new Error(`a run is already active (${p}); \`run-session.mjs stop\` it first`);
    throw e;
  } finally { own.remove(tmp); }
  return p;
}

// THE ENGINE'S FILE LOCK, not a rule of this file's own (contract-runtime-and-session-files.plan.md stage 2; design CR-D4 A):
// acquireFileLock reclaims a lock only when its holder's pid is gone AND it is older than staleMs, never by age alone (G-4
// of 20261105-031048-ar-d1-c-remediation-3-review: a binder paused past 30 s lost its lock to a stop). A hook waits briefly
// (it must not hold the session); a stop waits longer. `opts.lockTimeoutMs` sets the wait, for tests.
const BIND_WAIT_MS = 2_000;
const CLEAR_WAIT_MS = 10_000;
// The lock's name is checked through the owner (a link at it refused); acquireFileLock then works on that path (A-30's
// residual: a swap between the check and its open).
const takeLock = (own, segs, timeoutMs) => acquireFileLock(own.resolve([...segs, 'run-state.json.bind']), { timeoutMs });

/**
 * Bind the run to `session` if it is unbound, under the lock, re-reading the state inside it (G-5 and G-16 of
 * 20261105-013235-ar-d1-c-remediation-review): two hooks that both saw an unbound state cannot both bind, the second
 * finds the first's session and keeps it. A hook that cannot take the lock in time binds nothing and returns the state it
 * reads; a later hook binds. Returns the state after the bind, or null when there is no run.
 */
export function bindRunState(repoRoot, session, opts) {
  const { own, segs } = stateOwner(repoRoot, opts);
  if (!own.exists(segs)) return null;
  let release;
  try { release = takeLock(own, segs, opts?.lockTimeoutMs ?? BIND_WAIT_MS); } catch (e) {
    if (!/is held by another process/.test(e?.message ?? '')) throw e;
    return readRunState(repoRoot, opts);
  }
  try {
    const state = readRunState(repoRoot, opts);
    if (!state) return null;
    const bound = bindSession(state, session);
    if (!bound) return state;
    own.replace([...segs, 'run-state.json'], json(bound));
    return bound;
  } finally { release(); }
}

/**
 * Remove the run's state under the lock (G-11 of 20261105-021654-ar-d1-c-remediation-2-review): a stop that removed it
 * while a binder held the lock had the binder write the stopped run back. A lock still held when the wait ends refuses
 * the stop with a message to retry. No folder is no state.
 */
export function clearRunState(repoRoot, opts) {
  const { own, segs, p } = stateOwner(repoRoot, opts);
  if (!own.exists(segs)) return;
  let release;
  try { release = takeLock(own, segs, opts?.lockTimeoutMs ?? CLEAR_WAIT_MS); } catch (e) {
    if (!/is held by another process/.test(e?.message ?? '')) throw e;
    throw new Error(`a session is binding the run (${p}.bind is held); stop it again in a moment`);
  }
  try { own.remove([...segs, 'run-state.json']); } finally { release(); }
}

// Absent is ENOENT only (G-12 of 20261105-021654-ar-d1-c-remediation-2-review): the catch-all took a corrupt or unreadable
// cache for a missing one. Read through the home's owner, so a link at cli-freshness.json is refused, not followed.
export function readFreshness(opts) {
  const p = freshnessPath(opts);
  let text;
  try { text = homeOwner(opts).own.read(['cli-freshness.json']); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
  try { return JSON.parse(text); } catch (e) { throw Object.assign(new Error(`${p} does not parse: ${e.message}`), { code: 'EBADCACHE' }); }
}

// Through the home's owner, as the read is: a link at the home or at the file is refused.
export function writeFreshness(cache, opts) {
  homeOwner(opts).own.replace(['cli-freshness.json'], json(cache));
  return freshnessPath(opts);
}
