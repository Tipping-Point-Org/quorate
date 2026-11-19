// lib/reap.mjs, BOUND TO THIS HOST: the stop and the wait are io/stop-child.mjs's, the leftovers come from the run's own
// children and the status files its nodes wrote (stopping-a-child stage 4).
//
// MOVED OUT OF run-graph so a test can drive the whole reap — real children, real status files, an injected stop — and
// read back what the gate is given. It was a block at run-graph's top level, pinned by matching its source
// (ledger tests/regression-refused-kill-reaped.test.mjs:40).
import path from 'node:path';
import * as pure from '../lib/reap.mjs';
import { confined } from './confined-path.mjs';
import { stopChild, confirmGone, ORPHAN_SETTLE_MS } from './stop-child.mjs';
import { hostPlatform } from '../platform/index.mjs';

export * from '../lib/reap.mjs';

const hostIo = () => ({
  stop: (l) => stopChild(l.handle, { event: 'exit' }),
  confirmGone: (pid) => confirmGone(pid, { deadlineMs: ORPHAN_SETTLE_MS }),
  isAlive: (pid) => hostPlatform().proc.isAlive(pid),
});

/**
 * Everything the run must look at before its gate: its own children whose handle has not seen an exit (held), and every
 * pid a node recorded as `orphan_pid` in its status (not held: polled, never killed).
 *
 * @param {Iterable<[string, import('node:child_process').ChildProcess]>} held
 */
export function leftoversOf(held, nodesDir) {
  const out = [...held]
    .filter(([, child]) => child.exitCode === null && child.signalCode === null)
    .map(([node, child]) => ({ node, pid: child.pid, held: true, handle: child }));
  // THROUGH THE OWNER of the run that holds nodes/ (run-dir-reads.plan.md stage 3): a link at nodes/ or at a status file
  // is refused, so a pid recorded outside the run is never one this run polls.
  const owner = confined(path.dirname(nodesDir));
  const nodes = path.basename(nodesDir);
  for (const f of owner.list([nodes]).filter((x) => x.endsWith('.status.json'))) {
    try {
      const s = JSON.parse(owner.read([nodes, f]));
      // HOW the node's own stop ended is kept with the pid (G-2 of 20261002-215002-stop-child-review): dropped, a refusal
      // and an unconfirmed exit reached the gate as one combined sentence.
      const recorded = s.kill_refused ? 'refused' : s.kill_unconfirmed ? 'unconfirmed' : null;
      if (s.orphan_pid) out.push({ node: f.slice(0, -'.status.json'.length), pid: s.orphan_pid, held: false, recorded });
    } catch { /* an unreadable status is reported by the gate's own accounting */ }
  }
  return out;
}

/**
 * Reap and say: each leftover stopped (its exit seen) or named for the gate's not_checked[] with why.
 * `io` overrides the host's for a test — no operating system refuses a kill, or accepts one without effect, on request.
 *
 * @returns {Promise<{ stopped: {node, pid}[], notChecked: {node_id, why}[] }>}
 */
export async function reapRun({ held, nodesDir, io = {} }) {
  const results = await pure.reapLeftovers(leftoversOf(held, nodesDir), { ...hostIo(), ...io });
  const stopped = [];
  const notChecked = [];
  for (const r of results) {
    const why = pure.survivorNote(r);
    if (why === null) stopped.push({ node: r.node, pid: r.pid });
    else notChecked.push({ node_id: r.node, why });
  }
  return { stopped, notChecked };
}
