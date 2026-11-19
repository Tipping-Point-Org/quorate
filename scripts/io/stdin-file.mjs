// A CHILD'S STDIN FROM A FILE, NEVER A PIPE (decision-panel-seats.plan.md stage 2; design DP-D1 A). The node runtime's
// prompt goes on stdin, and a pipe held the parent: on Windows the closing of a pipe's write end waits until the child
// has read it (libuv flushes it), so a child that never read its stdin, left running after a refused kill, kept
// spawn-node from exiting at all (the suite hung on regression-stop-on-exit, 2026-11-09). A file has no reader to wait
// for: the text is written to a folder of this call's own, opened for reading, handed to the child as its stdin, and the
// parent's descriptor closed once the child has its own. The folder is removed as soon as it can be (on Windows a file
// another process holds open may refuse its removal until it closes) and is named in no record.
//
// IN A FOLDER QUORATE OWNS (stdin-folder-owner.plan.md; design SF-D1 A, SF-D2 A, operator 2026-11-10): the folders were
// made in the SHARED temporary directory, so the stale-folder sweep had to guess from a name which were its own, and
// each guess removed someone else's (G-4 of 20261110-022503-dps-remediation-4-review, G-6 of
// 20261110-025747-dps-remediation-5-review: `quorate-stdin-backup`). Each call's folder is now made EXCLUSIVELY below
// `<engine home>/stdin/`, through `confined` (ARCHITECTURE A-30: each level lstat'ed, a link refused), so every folder
// there is one this module made, and the sweep removes what is older than a day there with no name or content test.
// An engine home that cannot be written refuses the spawn; there is no fall-back to the temporary directory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { confined } from './confined-path.mjs';
import { quorateHome as homeFrom } from '../lib/reviews-root.mjs';
import { hostPlatform } from '../platform/index.mjs';

/** The folder below the engine home that holds every call's stdin folder, and nothing else. */
export const STDIN_FOLDER = 'stdin';
/** How old a stdin folder must be before a later call removes it: past every capture and probe ceiling a child may hold it for. */
export const STALE_STDIN_MS = 24 * 60 * 60 * 1000;
/** How often one process sweeps an engine home's stdin folder (G-8 of 20261110-001436-dps-remediation-review). */
export const STDIN_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
// How many fresh names a call tries when one is taken: a random name colliding twice is not a collision but a fault.
const NAME_TRIES = 8;

/** The engine home, read as io/reviews-root.mjs's quorateHome reads it (imported from lib/: io/reviews-root.mjs reaches
 * io/pool.mjs through io/git.mjs, and pool.mjs imports this module). */
const engineHome = () => homeFrom(hostPlatform().env(), hostPlatform().homedir());

/**
 * The owner of `<home>/stdin/`, or a refusal naming the path and why: the home is made if absent (as decide.mjs makes
 * it), then everything below it goes through `confined`, so a link at the home's `stdin` is refused.
 */
function stdinOwner(home, io = null) {
  const root = path.resolve(home);
  try {
    fs.mkdirSync(root, { recursive: true });
    const owner = io ? confined(root, { io }) : confined(root);
    owner.dir([STDIN_FOLDER]);
    return owner;
  } catch (e) {
    throw Object.assign(new Error(`stdin-file: the engine home's stdin folder ${path.join(root, STDIN_FOLDER)} cannot be used `
      + `(${e?.code ?? e?.message ?? e}); the child is not started, and there is no fall-back to the temporary directory`), { code: e?.code ?? 'ESTDINHOME', cause: e });
  }
}

/**
 * Removes the stdin folders an earlier call could not (G-11 of 20261109-232630-dps-delivery): a folder in `<home>/stdin/`
 * older than `staleMs` is removed, whatever its name or contents, since every folder there is this module's; a younger
 * one may still be a live child's stdin. A link found there is reported, never followed or removed through. A read that
 * fails other than ENOENT, and a removal that fails, are reported, the folder named and never its contents, and the
 * next sweep tries again. Returns the names removed, or null when the folder could not be listed (reported through
 * `write`). `owner` is injectable so a test can make one operation fail.
 */
export function sweepStaleStdin({ home = engineHome(), owner = null, now = Date.now(), staleMs = STALE_STDIN_MS,
  write = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const dir = path.join(path.resolve(home), STDIN_FOLDER);
  const removed = [];
  let own;
  let entries;
  try {
    own = owner ?? confined(path.resolve(home));
    entries = own.list([STDIN_FOLDER], { withFileTypes: true });
  } catch (e) {
    // An engine home with no stdin folder yet has nothing to sweep.
    if (e?.code === 'ENOENT') return removed;
    write(`stdin-file: the stdin folder ${dir} could not be listed (${e?.code ?? e?.message ?? e}); stale stdin folders in it were not swept`);
    return null;
  }
  for (const ent of entries) {
    const at = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) {
      write(`stdin-file: a link stands in the stdin folder (${at}); it is not this module's and is neither followed nor removed`);
      continue;
    }
    let st;
    try { st = own.stat([STDIN_FOLDER, ent.name]); } catch (e) {
      if (e?.code === 'ENOENT') continue;
      write(`stdin-file: the stdin folder ${at} could not be examined (${e?.code ?? e?.message ?? e}); the next sweep tries again`);
      continue;
    }
    if (!st.isDirectory() || now - st.mtimeMs < staleMs) continue;
    try {
      own.remove([STDIN_FOLDER, ent.name], { recursive: true });
      removed.push(ent.name);
    } catch (e) {
      if (e?.code === 'ENOENT') continue;
      write(`stdin-file: the stale stdin folder ${at} could not be removed (${e?.code ?? e?.message ?? e}); the next sweep tries again`);
    }
  }
  return removed;
}

// WHEN EACH HOME WAS LAST SWEPT (G-4 of 20261110-202954-sfo-remediation-review-c): one record for the last home swept
// meant calls alternating homes swept each again, past the bound of one sweep per home per interval.
const lastSweepAt = new Map();

// THE FOLDERS A RELEASE COULD NOT REMOVE (G-9 of 20261110-001436-dps-remediation-review): release() swallowed the failure,
// so a prompt copy whose last release was refused stayed with no record. Each is kept here, with the removal that applies
// to it, until a removal succeeds, and reportLeftoverStdin, run as the process exits, tries once more and names each it
// still cannot remove.
const leftovers = new Map();

/**
 * Tries each leftover stdin folder once more and writes one line per folder still standing, naming the folder (never its
 * contents) and the sweep that will remove it. Returns the folders named. `rm(dir)`, when given, replaces each folder's
 * own removal (a test refuses it).
 */
export function reportLeftoverStdin({ rm = null, write = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const named = [];
  for (const [dir, removeOwn] of [...leftovers.entries()]) {
    try { (rm ? () => rm(dir, { recursive: true, force: true }) : removeOwn)(); leftovers.delete(dir); continue; } catch (e) {
      leftovers.delete(dir);
      named.push(dir);
      write(`stdin-file: the stdin folder ${dir} could not be removed (${e?.code ?? e?.message ?? e}); a later call removes it once older than ${STALE_STDIN_MS / 3600000} h`);
    }
  }
  return named;
}
// SYNCHRONOUSLY at exit (G-3 of 20261110-202954-sfo-remediation-review-c): process.stderr.write to a pipe may be
// asynchronous, and an exit handler cannot wait for it, so the only notice of a prompt left on disk could be lost.
process.on('exit', () => {
  if (leftovers.size) reportLeftoverStdin({ write: (l) => { try { fs.writeSync(2, `${l}\n`); } catch { /* stderr is gone */ } } });
});

/** A fresh folder name: this process and twelve random hex digits. */
const freshName = () => `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;

/**
 * Text as a readable descriptor for a child's stdin: `{ fd, release }`. `fd` goes in the child's stdio[0]; `release()`
 * closes this process's descriptor and removes the folder, and may be called again (after the child exits) if the first
 * removal was refused. `input` null or undefined gives `{ fd: 'ignore', release }`, so a caller passes stdin through one
 * shape. `home` is the engine home (the operator's, or the suite's own); `sweep`, `rm`, `open` and `newName` are
 * injectable so a test can count the one and refuse or steer the others.
 */
export function stdinFrom(input, { home = null, sweep = sweepStaleStdin, rm = null, open = fs.openSync, newName = freshName, io = null } = {}) {
  if (input === null || input === undefined) return { fd: 'ignore', release: () => ({ removed: true, dir: null }) };
  const root = path.resolve(home ?? engineHome());
  const owner = stdinOwner(root, io);
  // ONCE PER INTERVAL, NOT PER CALL (G-8): a stale folder is a day old before it may be removed, so an hour's lag costs
  // nothing. A sweep that could not list the folder (null, G-7) is not counted: the next call tries again.
  const now = Date.now();
  const last = lastSweepAt.get(root);
  if (last === undefined || now - last >= STDIN_SWEEP_INTERVAL_MS) {
    lastSweepAt.set(root, now);
    if (sweep({ home: root, now }) === null) lastSweepAt.delete(root);
  }
  // EXCLUSIVELY (SF-D1 A): a name already in stdin/ is refused as taken and another is tried, so no call ever writes into a
  // folder it did not make. confined's exclusive directory create, not mkdtemp: one owner checks every level.
  let name = null;
  let dir = null;
  for (let i = 0; i < NAME_TRIES && !dir; i++) {
    const candidate = newName();
    // PRIVATE (G-7 of 20261110-202954-sfo-remediation-review-c): the folder 0700 and the file 0600, since the prompt may
    // carry source or credentials and stays on disk until a release or the day-old sweep removes it.
    try { dir = owner.dirNew([STDIN_FOLDER, candidate], { mode: 0o700 }); name = candidate; } catch (e) {
      if (!(e?.code === 'ECONFINED' && e.refusal === 'taken')) throw e;
    }
  }
  if (!dir) throw new Error(`stdin-file: no free folder name in ${path.join(root, STDIN_FOLDER)} after ${NAME_TRIES} tries; the child is not started`);
  const removeOwn = rm ? () => rm(dir, { recursive: true, force: true }) : () => owner.remove([STDIN_FOLDER, name], { recursive: true });
  let fd = null;
  try {
    owner.create([STDIN_FOLDER, name, 'stdin'], input, { mode: 0o600 });
    fd = open(path.join(dir, 'stdin'), 'r');
  } catch (e) {
    // A folder this cleanup could not remove is kept on the leftovers (G-8 of 20261110-010058-dps-remediation-2-review),
    // so the report at exit names it as it names one a release could not remove.
    try { removeOwn(); } catch { leftovers.set(dir, removeOwn); }
    throw e;
  }
  let closed = false;
  // Returns `{removed, dir, error}`: a removal refused (a child still holding the file, on Windows) is returned and kept
  // on the leftovers, so a later release, or the report at exit, removes or names it.
  const release = () => {
    if (!closed) { closed = true; try { fs.closeSync(fd); } catch { /* already closed */ } }
    try {
      removeOwn();
      leftovers.delete(dir);
      return { removed: true, dir, error: null };
    } catch (e) {
      if (e?.code === 'ENOENT') { leftovers.delete(dir); return { removed: true, dir, error: null }; }
      leftovers.set(dir, removeOwn);
      return { removed: false, dir, error: e?.code ?? e?.message ?? String(e) };
    }
  };
  return { fd, release };
}

/**
 * `spawnSync` whose `input` reaches the child from a file through `stdinFrom`, never spawnSync's own pipe (G-15 of
 * 20261109-232630-dps-delivery: the canary, both intent probes and check-intent-grant's probe piped the runtime's prompt).
 * Every other option is spawnSync's; stdout and stderr stay pipes, as they are without `input`.
 */
export function spawnSyncFrom(cmd, argv, { input, ...opts } = {}) {
  const stdin = stdinFrom(input);
  try {
    return spawnSync(cmd, argv, { ...opts, stdio: [stdin.fd, 'pipe', 'pipe'] });
  } finally { stdin.release(); }
}
