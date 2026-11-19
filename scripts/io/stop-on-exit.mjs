// WHAT AN ORCHESTRATOR DOES WITH ITS CHILDREN WHEN IT IS LEAVING (stopping-a-child stage 3; design 3A).
//
// Three ways out, one path through the owner (io/stop-child.mjs) for each:
//
// - SIGINT/SIGTERM: every held child stopped in parallel, at most one deadline waited, each outcome recorded — a child
//   not seen to exit is named with its pid — then the teardown, then exit 130. It used to be one kill per child with
//   the platform's answer read as a death and an immediate exit, so a child that ignored SIGTERM outlived the run with no
//   record (confirm3-confirm G-10; ledger run-graph.mjs:1040).
// - AN UNCAUGHT FAILURE: the same stop, the error printed first, exit 1. The generic exit hook removed only the arms'
//   directory, so a lens pool that rethrew left the concurrently started arms running (ledger run-graph.mjs:1130).
// - ANY OTHER EXIT with children still held (a process.exit elsewhere): the 'exit' hook may only do synchronous work, so
//   the kill is requested and each child recorded as unconfirmed — never as stopped.
//
// MOVED OUT OF run-graph so it can be driven: a test installs it in a small process holding real children, injects the
// kill, and raises the signal with process.emit, which reaches these handlers on every operating system — a Windows
// process cannot be sent a SIGTERM that runs its handler (stopping-a-child.plan.md, "How these stages stay testable").
import { stopAll, requestStopNow, SIGNAL_EXIT_DEADLINE_MS, SIGNAL_ESCALATE_AFTER_MS } from './stop-child.mjs';
import { stopRecord, carriedSurvivorFields } from '../lib/stop-vocabulary.mjs';

/**
 * What a node's status says about how its stop ended: nothing for an exit that was seen; the fields and a note for one that
 * was not. The words and the fields are lib/stop-vocabulary.mjs's (stopping-a-child-vocabulary, 1A/2A); this keeps the shape
 * its callers read. Pure.
 */
export function stopOutcomeFields({ outcome, pid }) {
  // A seen exit needs no note in the stub: the reason that started the stop says it (the stage-3 shape its tests pin).
  if (outcome === 'exited') return { note: null };
  const { fields, sentence } = stopRecord({ outcome, pid, reason: 'interrupt', context: 'orchestrator' });
  return { ...fields, note: sentence };
}

/**
 * The stop's part of the status an orchestrator writes for a child it stopped on the way out. Pure.
 *
 * `own` is the status the child wrote for itself, read after its exit was seen. A node runner that stopped its OWN child
 * (spawn-node passes the signal on, design §5) and could not see that child exit wrote the child's pid there before
 * leaving; the orchestrator's stub replaces that status, so the pid is carried — or the one survivor the runner managed
 * to name is lost by the orchestrator overwriting it.
 */
export function stoppedStatusFields({ outcome, pid }, reason, own = null) {
  const { note, ...fields } = stopOutcomeFields({ outcome, pid });
  const carried = outcome === 'exited' ? carriedSurvivorFields(own) : {};
  const ownNotes = Object.keys(carried).length ? (own.validator_errors ?? []).filter((e) => e.includes(String(own.orphan_pid))) : [];
  return { validator_errors: [reason, ...(note ? [note] : []), ...ownNotes], ...carried, ...fields };
}

/**
 * Install the three exits. `held()` returns the [key, child] pairs held now; `record(key, result, reason)` writes what
 * the run must keep about each (it is called once per child, with { outcome, pid }); `teardown()` is synchronous.
 * `killProc` (the platform's process interface the stop owner reaches its kill through: stop-owner-seam, SS-D1 A),
 * `exit` and `proc` (Node's process, whose signals are listened for) are injectable for the test that drives this.
 *
 * @returns {{ stopping: () => boolean }}
 */
export function stopHeldOnExit({
  held, record, teardown = () => {}, onStart = () => {},
  deadlineMs = SIGNAL_EXIT_DEADLINE_MS, escalateAfterMs = SIGNAL_ESCALATE_AFTER_MS,
  killProc = null, exit = (code) => process.exit(code), proc = process, log = (m) => console.error(m),
}) {
  let stopping = false;
  const recordAll = (results, reason) => {
    for (const r of results) {
      try { record(r.key, { outcome: r.outcome, pid: r.pid }, reason); } catch (e) { log(`could not record ${r.key}: ${e.message}`); }
      if (r.outcome !== 'exited') log(`${r.key}: ${stopOutcomeFields(r).note} — it carries the operator's credentials`);
    }
  };
  const leave = async (reason, code) => {
    // ONE STOP. A second Ctrl+C during the wait does not start another, and does not cut the wait short: the wait is
    // bounded by the deadline, and leaving early is exactly what loses the record of a child still running.
    if (stopping) return;
    stopping = true;
    // THE EXIT IS ALWAYS REACHED (G-5 of 20261003-032341-stop-child-sweep-confirm). A throw from held(), onStart() or the stop
    // itself reached the unhandledRejection handler, whose leave() returned at once because `stopping` was already set — so
    // neither the teardown nor the exit ran, and the process lingered with the arms' checkout in place.
    try {
      const entries = [...held()];
      onStart(reason, entries.length);
      const results = await stopAll(entries, { deadlineMs, escalateAfterMs, ...(killProc ? { proc: killProc } : {}) });
      recordAll(results, reason);
    } catch (e) {
      log(`stopping the held children failed: ${(e && e.stack) || e}`);
    } finally {
      try { teardown(); } catch (e) { log(`teardown failed: ${e.message}`); }
      exit(code);
    }
  };
  for (const sig of ['SIGINT', 'SIGTERM']) proc.on(sig, () => { leave(`orchestrator received ${sig}`, 130); });
  for (const ev of ['uncaughtException', 'unhandledRejection']) {
    proc.on(ev, (err) => {
      // Printed FIRST: installing a handler replaces Node's own report, and a failure nobody can read is worse than one
      // that left a child behind.
      log((err && err.stack) || String(err));
      leave(`orchestrator failed: ${(err && err.message) || String(err)}`, 1);
    });
  }
  proc.on('exit', () => {
    // Children already being stopped are the signal path's; this is only for an exit nothing else handled.
    if (stopping) return;
    const entries = [...held()];
    if (entries.length) recordAll(requestStopNow(entries, killProc ? { proc: killProc } : {}), 'orchestrator exited with children still running');
    try { teardown(); } catch (e) { log(`teardown failed: ${e.message}`); }
  });
  return { stopping: () => stopping };
}
