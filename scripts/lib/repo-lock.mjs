// ONE REMEDIATION PER REPOSITORY (remediation-consumer-findings.plan.md stage 2, AC6; operator, 2026-10-20: "Repository-wide
// lock (Recommended)"; "Engine home, keyed by git's common dir (Recommended)").
//
// The run lock (<run-dir>/remediate.lock) serialised two runners on ONE run and nothing across runs, so two remediations
// launched a minute apart both completed and committed nothing (story-pipeline's 20261020-114215 and -114309). This is
// what a lock record held by another remediation means for this one. Pure: the caller reads the record, the host and
// whether the pid is alive.

/**
 * `record`: the lock's parsed content ({ run_id, pid, host }) or null when it cannot be read; `host`: this machine's
 * name; `alive`: whether record.pid is a running process here. Returns:
 * - 'live': held by a runner on this host that is still running;
 * - 'stale': held on this host by a pid that is gone, so a crash left it;
 * - 'foreign-host': held on another host; its liveness cannot be known here, so it is never called stale;
 * - 'unreadable': there is a lock and nothing in it can be trusted.
 */
export function lockState({ record, host, alive }) {
  if (!record || typeof record !== 'object' || !Number.isInteger(record.pid) || !record.host) return 'unreadable';
  if (record.host !== host) return 'foreign-host';
  return alive ? 'live' : 'stale';
}
