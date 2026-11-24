// lib/remediate-lock.mjs — THE ONE OWNER OF THE remediate.lock PROTOCOL (G-3 of 20261121-193516-m3s7-b1-review).
//
// remediate.mjs and archive-run.mjs each created, recognised and removed the run's remediate.lock with their own code, so
// the lock's name, its record's fields and which refusal means "another holder has it" could drift apart between the two,
// and a lock one wrote would no longer be one the other refused on. Both take, test and release it here. The run's owner
// (io/confined-path.mjs's `confined`) is passed in as `runOwner`: no I/O of this module's own. It is named for the run,
// not `owner`, because the lock lives in a run directory and never directly under the engine's home
// (tests/regression-home-state-roots.test.mjs reads an `owner` receiver as one rooted at the home).

/** The lock's name, directly in the run directory. */
export const REMEDIATE_LOCK = 'remediate.lock';

/** The lock's record: who holds it, since when, and in which phase. */
export function remediateLockRecord({ pid, startedAt, phase }) {
  return JSON.stringify({ pid, started_at: startedAt, phase });
}

/** Take the lock exclusively, written WITH its record; throws when it cannot (see remediateLockTaken). */
export function takeRemediateLock(runOwner, record) {
  runOwner.create([REMEDIATE_LOCK], remediateLockRecord(record));
}

/** Rewrite the held lock's record, for a new phase. */
export function setRemediateLockPhase(runOwner, record) {
  runOwner.replace([REMEDIATE_LOCK], remediateLockRecord(record));
}

/**
 * Whether a failure to take the lock means another holder has it: the owner's exclusive create refuses a taken name
 * before it opens (tagged 'taken'), and `wx` refuses one taken in between (EEXIST).
 */
export function remediateLockTaken(e) {
  return e?.code === 'EEXIST' || (e?.code === 'ECONFINED' && e?.refusal === 'taken');
}

/** Whether the lock is present, by the owner's view of the run. */
export function remediateLockHeld(runOwner) {
  return runOwner.exists([REMEDIATE_LOCK]);
}

/** Release the lock; the owner's answer (false when it was already gone). */
export function releaseRemediateLock(runOwner) {
  return runOwner.remove([REMEDIATE_LOCK]);
}
