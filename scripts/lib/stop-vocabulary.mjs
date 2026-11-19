// WHAT A STOP SAYS — the one owner of every status field and every sentence derived from a stop outcome
// (stopping-a-child-vocabulary.design.md, decided 2026-10-03: 1A, 2A, 3A).
//
// io/stop-child.mjs owns HOW a child is stopped and the three outcomes: 'exited' (its own exit seen), 'refused' (the platform
// would not kill it, and it is still there), 'unconfirmed' (not seen to exit after its stop). What the run then WRITES about
// an outcome had no owner: seven functions in four files, and one inline sentence, each said it their own way, and three
// consecutive remediations each missed one of them (D1's cap, 2026-10-03). Every caller now asks here, and
// tests/regression-stop-vocabulary.test.mjs refuses the fields and the clauses anywhere else.
//
// Pure (ARCHITECTURE §2, A-2): no I/O, no clock; everything arrives as a parameter.

/** The one clause for each outcome that is not a seen exit. Every sentence below is built on one of them. */
export const UNCONFIRMED_CLAUSE = 'was not seen to exit after its stop';
export const REFUSED_CLAUSE = 'refused to be killed';
// A SEEN exit is an outcome too, and it was worded in three places of their own — "process tree killed", "[killed by
// orchestrator]" (for every timed-out capture, survivors included), "stopped its child" (for an interrupted node whose
// child survived) — G-8, G-6, G-5 of 20261003-041945-stop-child-vocabulary-review. It claims no kill: the stop asked, and
// the child's own exit was seen.
export const EXITED_CLAUSE = 'exited after its stop';

/** Who is speaking, which decides what a sentence must add to the clause. */
export const STOP_CONTEXTS = Object.freeze([
  'node',            // run-child, into the node's status
  'orchestrator',    // the leaving path, into the stub it writes for a held child
  'gate-held',       // the end-of-run reaper, about a child the run still held
  'gate-recorded',   // the end-of-run reaper, about a pid a node recorded
  'captured',        // spawnCapture, about an arm or adjudicator past its timeout
  'phrase',          // the few words spawn-node's timeout and overflow sentences carry
]);
const OUTCOMES = new Set(['exited', 'refused', 'unconfirmed']);

const AFTER = { timeout: 'its timeout', 'output-cap': 'its output cap', interrupt: 'an interrupt' };

const SENTENCES = {
  node: {
    refused: (pid, reason) => `the child (pid ${pid}) ${REFUSED_CLAUSE} after ${AFTER[reason] ?? 'its stop'}; it may still be `
      + 'running, and its output is no longer capped: nothing in this process can stop a child it could not kill. run-graph '
      + 'names it at the gate if it still answers.',
    unconfirmed: (pid) => `the child (pid ${pid}) ${UNCONFIRMED_CLAUSE}, within the grace period; it may still be running, and `
      + 'its output is no longer capped. run-graph names it at the gate if it still answers.',
  },
  orchestrator: {
    refused: (pid) => `pid ${pid} ${REFUSED_CLAUSE}; it may still be running`,
    unconfirmed: (pid) => `pid ${pid} ${UNCONFIRMED_CLAUSE}, before the orchestrator left; it may still be running`,
  },
  'gate-held': {
    refused: (pid) => `process ${pid} ${REFUSED_CLAUSE} and was still running when the run ended, with the credentials it was `
      + 'given — stop it by hand',
    unconfirmed: (pid) => `process ${pid} ${UNCONFIRMED_CLAUSE} at the end of the run, within the grace period; it may still be `
      + 'running, with the credentials it was given — check it and stop it by hand',
  },
  'gate-recorded': {
    refused: (pid) => `process ${pid} outlived its node, which recorded that it ${REFUSED_CLAUSE}, and answered when the run ended`,
    unconfirmed: (pid) => `process ${pid} outlived its node, which recorded that it ${UNCONFIRMED_CLAUSE}, and answered when the `
      + 'run ended',
  },
  captured: {
    refused: (pid) => `the child (pid ${pid}) ${REFUSED_CLAUSE}`,
    unconfirmed: (pid) => `the child (pid ${pid}) ${UNCONFIRMED_CLAUSE}`,
  },
  phrase: {
    refused: (pid) => `the child (pid ${pid}) ${REFUSED_CLAUSE}`,
    unconfirmed: (pid) => `the child (pid ${pid}) ${UNCONFIRMED_CLAUSE}`,
  },
};
// What a recorded pid's gate line adds whatever its node said: it may not be that node's process any longer.
const RECORDED_TAIL = '; if it is still that node\'s process, it holds the credentials it was given and its output is no longer '
  + 'capped (G-9 of 20261001-205530-m0-pending-claims-review) — check it and stop it by hand';

/**
 * The fields and the sentence for one stop outcome, said by one context.
 *
 * `reason` is what asked for the stop (`timeout`, `output-cap`, `interrupt`, `end-of-run`) and is what `kill_refused`
 * records. For `gate-recorded`, `recorded` is how the node's own stop ended (`refused`, `unconfirmed`, or null when the
 * node did not say); the outcome there is the reaper's own watch of the pid.
 *
 * Every valid outcome and context has a sentence (G-7 of 20261003-045647-stop-child-vocabulary-confirm: this said
 * `string | null` after the exited branch began returning one).
 *
 * @returns {{ fields: object, sentence: string }}
 */
export function stopRecord({ outcome, pid, reason = null, context, recorded = null }) {
  if (!STOP_CONTEXTS.includes(context)) throw new TypeError(`stopRecord: unknown context '${context}'`);
  if (!OUTCOMES.has(outcome)) throw new TypeError(`stopRecord: unknown outcome '${outcome}'`);
  // A RECORDED pid is watched, never stopped (design 2A), so its being gone is not an exit after a stop the run made
  // (G-8 of 20261003-045647-stop-child-vocabulary-confirm).
  if (outcome === 'exited' && context === 'gate-recorded') {
    return { fields: {}, sentence: `process ${pid}, which its node recorded, no longer answers` };
  }
  if (outcome === 'exited') {
    const who = context === 'orchestrator' ? `pid ${pid}` : context.startsWith('gate') ? `process ${pid}`
      : pid == null ? 'the child' : `the child (pid ${pid})`;
    return { fields: {}, sentence: `${who} ${EXITED_CLAUSE}` };
  }
  const fields = outcome === 'refused'
    ? { orphan_pid: pid, kill_refused: reason ?? true }
    : { orphan_pid: pid, kill_unconfirmed: true };
  if (context === 'gate-recorded') {
    // The node's word decides the clause: the reaper only watched the pid, it did not stop it. A node that recorded the pid
    // but no outcome is said to have recorded none — not an unconfirmed stop it never claimed (G-9 of
    // 20261003-045647-stop-child-vocabulary-confirm).
    if (recorded !== 'refused' && recorded !== 'unconfirmed') {
      return { fields: {}, sentence: `process ${pid} outlived its node, which recorded no outcome for its stop, and answered when `
        + `the run ended${RECORDED_TAIL}` };
    }
    return { fields: {}, sentence: SENTENCES['gate-recorded'][recorded](pid) + RECORDED_TAIL };
  }
  return { fields, sentence: SENTENCES[context][outcome](pid, reason) };
}

/**
 * A node runner's own survivor, carried into the orchestrator's stub when the runner was seen to exit (stage 3): the stub
 * replaces the runner's status, so the pid the runner named would otherwise be lost. Empty when the runner named none.
 */
export function carriedSurvivorFields(own) {
  if (!own || !Number.isInteger(own.orphan_pid)) return {};
  return own.kill_refused
    ? { orphan_pid: own.orphan_pid, kill_refused: own.kill_refused }
    : { orphan_pid: own.orphan_pid, kill_unconfirmed: true };
}
