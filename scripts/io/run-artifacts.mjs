// lib/run-artifacts.mjs, BOUND TO THIS HOST (os-platform-adapters stage 3c). See scripts/io/finding-scope.mjs
// for why this layer exists: lib/ takes `io` as a parameter, and orchestration imports it bound here.
import path from 'node:path';
import * as pure from '../lib/run-artifacts.mjs';
import { hostPlatform } from '../platform/index.mjs';
import { confined } from './confined-path.mjs';
import { relativeBelow } from './finding-scope.mjs';

export * from '../lib/run-artifacts.mjs';

// EVERY REFUSAL IS SAID (G-16 of 20260928-221454-ltb-review): collectRun records what it refused in `refused`, and no
// caller read that map, so a refused verdict was as silent to a benchmark as before the strict reader existed. The
// host-bound call says each one — stderr by default — so no caller, present or later, can drop it unseen.
//
// A refused run.json is not in that map: it THROWS RunRefused (secret-shapes-and-refusals, 2a), so the run is not
// scored at all and a caller cannot score it by forgetting to look. The throw passes through here unchanged.
export const collectRun = (runDir, { warn = (m) => process.stderr.write(`${m}\n`), ...opts } = {}) => {
  const out = pure.collectRun(runDir, { ...opts, io: hostPlatform() });
  for (const [what, why] of Object.entries(out.refused ?? {})) {
    warn(`run-artifacts: ${path.basename(typeof runDir === 'string' ? runDir : runDir.root)}: ${what} refused — ${why}; excluded from what this run is scored on`);
  }
  return out;
};

export const readKeptVerdict = (runDir, nodeId, opts = {}) => pure.readKeptVerdict(runDir, nodeId, { ...opts, io: hostPlatform() });
export const readNodeStatus = (runDir, nodeId, opts = {}) => pure.readNodeStatus(runDir, nodeId, { ...opts, io: hostPlatform() });
export const readRunRecord = (runDir, opts = {}) => pure.readRunRecord(runDir, { ...opts, io: hostPlatform() });
export const readReconcileArtifacts = (runDir, opts = {}) => pure.readReconcileArtifacts(runDir, { ...opts, io: hostPlatform() });

// EACH BATCH'S REPORT, KEPT, when the node wrote one (G-5 of 20261024-064941-rrr-delivery): the next spawn of the node
// rewrites it. Its own function so a test can run it (G-10 of 20261024-083753-rrr-remediation-3-review): a reconcile node
// writes no report, so no run reaches the copy, and a test reading run-graph's source passed on wrong code spelled right.
// THROUGH THE ONE OWNER (run-dir-descendants.plan.md stage 2): report_path is read from a status file, a field with no `..`
// check, so it is split into names the owner checks (a `..`, an absolute path or a link at any level is refused), and the
// copy is written to `to` below the same run through the owner too. A field it refuses is no report to keep, and it is
// SAID (G-8 of 20261029-055946-rdd-remediation-review): the refused path came back as the kept report, the refusal
// swallowed. Now the report fields are null and `refused` carries why, for the caller to name.
export function keepBatchReport({ runDir, status, to }) {
  const { report_path: reportRel = null, report_sha256: reportSha = null } = status ?? {};
  if (reportRel) {
    const owner = confined(runDir);
    // Below the run by containment's one owner (G-2 of 20261105-154708-crsf-remediation-5-review; G-4 of
    // 20261105-151040-crsf-remediation-4b-review: a hand-rolled `startsWith('..')` refused a target named `..x`).
    const toSegs = relativeBelow(path.resolve(runDir), path.resolve(to));
    const from = String(reportRel).split(/[\\/]/);
    try {
      if (path.isAbsolute(String(reportRel))) throw Object.assign(new Error(`confined path refused: ${reportRel} — an absolute path`), { code: 'ECONFINED' });
      if (!toSegs) throw Object.assign(new Error(`confined path refused: ${to} — not below ${runDir}`), { code: 'ECONFINED' });
      // A MISSING REPORT IS NOT KEPT (G-8 of 20261029-065343-rdd-remediation-2-review): the copy was skipped and the path
      // and hash still came back as the kept report.
      if (owner.isFree(from)) return { report_path: null, report_sha256: null, refused: `report_path ${reportRel}: no such file below the run` };
      owner.replace(toSegs, owner.read(from, null));
    } catch (e) {
      if (e.code !== 'ECONFINED') throw e;
      return { report_path: null, report_sha256: null, refused: `report_path ${reportRel}: ${e.message}` };
    }
  }
  return { report_path: reportRel, report_sha256: reportSha };
}
