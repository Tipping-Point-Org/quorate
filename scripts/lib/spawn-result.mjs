// spawn-result.mjs — what a finished spawnSync result's status may claim. Pure.
//
// A SPAWN THAT ERRED NEVER READS AS A SUCCESS. Past maxBuffer spawnSync sets `error` (ENOBUFS) and kills the child, but a
// child that had already exited keeps status 0 with its whole output read: measured, a 16-byte cap on a 20-file git
// listing returns all 1,150 bytes and ENOBUFS every time, its status null only because the kill landed first. Under a
// loaded suite it did not, and copyTrackedInto, reading status alone, accepted the listing its cap had refused
// (regression-framework-copy-surface, criterion 2).

/** The result with its status null when it carries an error, so a caller that reads status alone sees the failure. */
export function erredIsFailure(r) {
  if (r && r.error && r.status === 0) return { ...r, status: null };
  return r;
}
