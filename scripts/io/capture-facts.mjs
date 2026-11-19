// WHAT A REMEDIATION NODE'S CAPTURES SAY, read for the evidence gate (remediation-verification.plan.md stage 5).
//
// The facts come from capture.mjs's own header — `# admitted:`, `# exit:`, `# timed-out:`, `# captured:` — and from
// nothing after the 72-dash rule that closes it, so a command's output cannot claim a test_one admission or an exit it
// did not have. Only a regular file inside the run's evidence/remediation is read: the node's folder is the only place a
// fix's evidence is admitted from (G-8 of 20261009-014530-remediation-paths-r2). It was contained by REAL path, which
// admitted a link resolving back inside that folder; it is now read through the owner (run-dir-reads.plan.md stage 3,
// R-D3 A), so a link or junction at any level below the run is refused, whatever it leads to.

import { confined } from './confined-path.mjs';
// The header's grammar is lib/capture-header.mjs's, the one owner capture.mjs writes it with (G-2 of
// 20261013-220031-rv-delivery).
import { parseCaptureHeader, checkOutcome } from '../lib/capture-header.mjs';

/**
 * Each path (run-relative, as the node reports it) to { admitted, file, exit, timed_out, captured, outcome }, or null.
 * `outcome` is checkOutcome's over the same header (check-outcomes.plan.md stage 4), so the evidence gate admits a red
 * that ran and failed, not an exit 124 that never ran.
 */
export function captureFacts(run, paths) {
  // The owner of the run the caller admitted, or one rooted at the admitted directory it passed.
  const owner = typeof run === 'string' ? confined(run) : run;
  const out = {};
  for (const p of paths ?? []) {
    if (!p || p in out) continue;
    out[p] = null;
    // NORMAL FORMS ONLY (evidence-path-owner.plan.md stage 2): the caller passes each path as lib/evidence-path.mjs gave it,
    // `evidence/remediation/<name>`, at the read of the report; this reader no longer splits or relativizes a spelling.
    const segs = String(p).split('/');
    if (segs.length < 3 || segs[0] !== 'evidence' || segs[1] !== 'remediation' || segs.includes('..')) continue;
    try {
      // null when no rule closes a header: not a capture, since capture always closes it. read refuses a link at any
      // level, and anything but a regular file.
      const header = parseCaptureHeader(owner.read(segs));
      out[p] = header ? { ...header, outcome: checkOutcome(header).outcome } : null;
    } catch { /* missing, refused or unreadable: null */ }
  }
  return out;
}
