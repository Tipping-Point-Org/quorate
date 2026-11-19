// crash.mjs — what a thrown error is allowed to lose, in one place.
//
// A CONSUMER-MOUNT SWEEP COST $69.49 AND KEPT NONE OF ITS OWN DIAGNOSIS. The adjudication phase
// threw with five genuine disputes in flight, both judges answering correctly, and every artifact
// recorded the same sentence: "the adjudication phase threw (3 pool workers failed)". `runPool`
// throws an `AggregateError` whose `.errors` holds one real error — with its stack — per failed
// worker, and the catch did `String(e)`: the count rendered, the array dropped, at the exact moment
// those three stacks were the only evidence that would ever exist.
//
// The same shape has now been fixed four times in this repository — vendor stderr discarded by three
// separate `JSON.parse` catches, a failed subprocess reported as a missing contract block, a
// DEGRADED ruling with no reason, and this. So the unwrapping lives here, is pure, and is tested,
// rather than being retyped correctly at one catch and incorrectly at the next.
//
// THE SPLIT BETWEEN WHAT IS TRACKED AND WHAT IS NOT is the second half of the rule, and it is not a
// style choice. `name: message` is OUR OWN text — `TypeError: x is not a function` — which is
// precisely what an operator acts on, so it belongs in the gate. A STACK carries absolute paths, and
// an error raised while handling a vendor response can quote that response, so it goes where git does
// not follow and the tracked side names the path. Same rule as run-checks stripping `stderr_tail`
// from its tracked artifact.

/**
 * Every underlying cause of a thrown value, flattened.
 *
 * `AggregateError.errors` (what a pool throws), `error.cause` chains (what a rethrow adds), and the
 * plain single error, all reduced to one list in the order they occurred. A non-Error throw — a
 * string, an object — is kept as itself rather than dropped: something threw it, and inventing an
 * Error around it would hide what the thrower actually said.
 */
export function crashCauses(e, { seen = new Set() } = {}) {
  if (e == null) return [];
  // Cycles are possible through `cause`, and this runs inside a catch block: a stack overflow while
  // recording why something failed would replace the diagnosis with a second, less useful one.
  if (typeof e === 'object') {
    if (seen.has(e)) return [];
    seen.add(e);
  }
  const out = [];
  const nested = Array.isArray(e?.errors) ? e.errors : null;
  if (nested) {
    // The aggregate itself carries no location worth keeping — its message is the count — so only
    // its members are recorded.
    for (const x of nested) out.push(...crashCauses(x, { seen }));
  } else {
    out.push(e);
    if (e?.cause != null) out.push(...crashCauses(e.cause, { seen }));
  }
  return out;
}

/**
 * One line per cause, safe for a TRACKED artifact: the error's class and its first message line.
 *
 * Capped per cause and overall, because this lands in `not_checked[]` and renders into gate.md — a
 * reader scanning the gate must not have to scroll a stack to find the next entry.
 */
export function crashSummary(causes, { perCause = 200, max = 5 } = {}) {
  const list = (Array.isArray(causes) ? causes : [causes]).filter((x) => x != null);
  const lines = list.slice(0, max).map((x) => {
    const name = x?.name ?? (typeof x === 'string' ? 'thrown string' : 'Error');
    const msg = String(x?.message ?? x).split('\n')[0].trim().slice(0, perCause);
    return msg.startsWith(name) ? msg : `${name}: ${msg}`;
  });
  if (list.length > max) lines.push(`…and ${list.length - max} more`);
  return lines.join(' | ');
}

/**
 * The full record, for the GITIGNORED side: stacks included.
 *
 * `phase` names where it threw, because a crash record that cannot say which phase produced it makes
 * the reader open every other artifact to find out.
 */
export function crashRecord({ phase, error, causes = null, at }) {
  // `at` is REQUIRED (os-platform-adapters criterion 5): lib/ does not read the clock, even as a default.
  if (typeof at !== 'string' || !at) throw new Error('crashRecord: `at` is required — lib/ does not read the clock');
  const list = causes ?? crashCauses(error);
  return {
    phase,
    at,
    aggregate: Array.isArray(error?.errors) ? String(error?.message ?? '') : null,
    worker_failures: list.length,
    summary: crashSummary(list),
    causes: list.map((x) => ({
      name: x?.name ?? null,
      message: String(x?.message ?? x).slice(0, 4000),
      // The whole reason this file exists: the stack names the line, which a worker count cannot.
      stack: String(x?.stack ?? '').slice(0, 8000) || null,
      code: x?.code ?? null,
    })),
  };
}
