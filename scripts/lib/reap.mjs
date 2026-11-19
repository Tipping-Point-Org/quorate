// What to do with processes a run could not stop (G-14 of 20260926-002850-m0-close).
//
// A child whose kill the OS refused keeps running after the run ends — an external reviewer holding
// the operator's credentials, still working and billing. Nothing can force the OS; the run can try
// once more, and it must say which ones outlived it. Pure: the stop, the wait and the liveness check
// are passed in as `io`, so the decision is tested without a process in sight (ARCHITECTURE §2, A-2).
//
// ONLY A PROCESS WE STILL HOLD IS STOPPED. A pid is an identity only while something holds the process
// open: run-graph's own children qualify (their handle has not seen an exit), but a pid spawn-node
// RECORDED before it exited does not — that process may have died since, and the OS reuses pids
// (quickly, on Windows), so `taskkill /T /F` on it could end an unrelated process tree, the operator's
// editor included. A recorded orphan that still answers is therefore POLLED and REPORTED, never killed.
//
// STOPPED MEANS AN EXIT WAS SEEN (stopping-a-child stage 4, design 2A). This used to kill a held child
// and ask isAlive in the same breath, so a child still dying from that kill read as a survivor, and a
// "stopped" was a guess either way (S5). The answer is now the owner's — io/stop-child.mjs's three
// outcomes — reached through `io.stop` (a held child: the kill, then its own exit event within the
// deadline) and `io.confirmGone` (a recorded pid: polled, never killed). The poll and its clock live
// there, not here.
import { stopRecord } from './stop-vocabulary.mjs';

/**
 * @param {{node: string, pid: number, held: boolean, handle?: unknown, recorded?: 'refused' | 'unconfirmed' | null}[]} leftovers
 *   held = we own a live handle to it, passed back to `io.stop` as `handle`; recorded = how the node's own stop of a pid
 *   it recorded ended, carried to the gate's sentence
 * @param {{
 *   stop: (leftover) => Promise<{outcome: 'exited' | 'refused' | 'unconfirmed'}>,
 *   confirmGone: (pid: number) => Promise<{outcome: 'exited' | 'unconfirmed'}>,
 *   isAlive: (pid: number) => boolean,
 * }} io
 * @returns {Promise<{node: string, pid: number, held: boolean, recorded: string | null, outcome: 'exited' | 'refused' | 'unconfirmed'}[]>}
 *   one per leftover that was still there, all looked at together so the wait is one deadline, not one per survivor
 */
export async function reapLeftovers(leftovers, { stop, confirmGone, isAlive }) {
  const looked = leftovers
    .filter(({ pid }) => Number.isInteger(pid) && pid > 0)
    // A held child's handle knows whether it exited; a recorded pid that no longer answers is simply gone.
    .filter((l) => l.held || isAlive(l.pid))
    .map(async (l) => {
      let outcome;
      try { ({ outcome } = await (l.held ? stop(l) : confirmGone(l.pid))); } catch { outcome = 'unconfirmed'; }
      return { node: l.node, pid: l.pid, held: Boolean(l.held), recorded: l.recorded ?? null, outcome };
    });
  return Promise.all(looked);
}

/**
 * What the gate says about one reaped leftover: nothing for an exit that was seen; otherwise why the process is still
 * named, and what the operator has to do. Pure.
 *
 * @returns {string | null}
 */
export function survivorNote({ pid, held, outcome, recorded = null }) {
  // A seen exit is no survivor: it goes to the stopped list, not the gate.
  if (outcome === 'exited') return null;
  // The words are lib/stop-vocabulary.mjs's (stopping-a-child-vocabulary, 1A/2A): a held child in the gate-held context, a
  // pid a node recorded in the gate-recorded one, which says how the node's own stop ended.
  return stopRecord({ outcome, pid, reason: 'end-of-run', context: held ? 'gate-held' : 'gate-recorded', recorded }).sentence;
}
