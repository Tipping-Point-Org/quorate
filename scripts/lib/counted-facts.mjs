// counted-facts.mjs — verify the numbers prose states against the numbers disk holds.
//
// CLAUDE.md states countable facts: how many regression tests, how many skills. Hand-maintained
// counts drift — the test count needed five manual corrections in a single working day
// (2026-08-31) — and a stale count is an inert guarantee: prose promising a property the tree no
// longer has, which is the highest-value defect class doc-consistency-review exists to catch.
// Catching it downstream with a model is the expensive way; verifying it at the push gate is the
// cheap one. This module is the pure decision so the rule is testable without running anything.

/**
 * Extract the facts a document states. A fact the document does not state is simply absent —
 * this check verifies stated numbers, it does not require every document to state them.
 */
export function statedFacts(docText) {
  const text = String(docText ?? '');
  const facts = {};
  const tests = text.match(/(\d+) regression tests/);
  if (tests) facts.tests = Number(tests[1]);
  // EVERY stated skill count, not the first phrasing anyone thought of. The pattern was
  // /[Tt]he (\d+) skills/ alone, so QUORATE.md's "colliding with quorate's 21?" three lines below
  // "the 22 skills" was invisible — two counts in one file, three lines apart, disagreeing, and the
  // checker that exists to catch exactly that could not see one of them (G-2/G-22). A checker that
  // reads one spelling verifies one sentence, not a fact.
  const counts = [...text.matchAll(/(?:[Tt]he|quorate's)\s+(\d+)\s+skills|quorate's\s+(\d+)/g)]
    .map((m) => Number(m[1] ?? m[2]))
    .filter((n) => Number.isInteger(n));
  if (counts.length) {
    // Disagreeing counts in one document are themselves the defect, so the LOWEST is reported and
    // the drift check then fails against the tree — rather than picking one and calling it agreed.
    facts.skills = Math.min(...counts);
  }
  // The prompt library, split out of skills/ on 2026-09-09. It is a second countable population the
  // moment it exists, and an uncounted one drifts exactly as the test count did — the reason this
  // module exists at all.
  const prompts = text.match(/(?:[Tt]he|quorate's)\s+(\d+)\s+node prompts/);
  if (prompts) facts.prompts = Number(prompts[1]);
  return facts;
}

/**
 * Compare stated facts against actual counts. Returns one entry per drifted fact; empty means
 * every stated number is true. An actual count that is null/undefined means the caller could not
 * measure it — that fact is skipped, never failed, because "could not count" is a caller problem
 * and must not read as "the document lies".
 */
export function countedFactDrift({ stated, actual }) {
  const drift = [];
  for (const [fact, statedValue] of Object.entries(stated ?? {})) {
    const actualValue = actual?.[fact];
    if (actualValue === null || actualValue === undefined) continue;
    if (Number(actualValue) !== Number(statedValue)) {
      drift.push({ fact, stated: Number(statedValue), actual: Number(actualValue) });
    }
  }
  return drift;
}

/**
 * The scripts §8 ENUMERATES as carrying the recursion guard.
 *
 * G-47: the sentence named five while seven carried it — `check-panel.mjs` and `bench-lenses.mjs`
 * were added with the guard and the enumeration was not updated. A list is a countable fact wearing
 * different clothes, and it drifts the same way a number does, except that nothing was checking it:
 * a reader auditing the boundary sees two scripts spawning children that the doctrine appears not
 * to cover, and cannot tell whether the code or the document is wrong.
 *
 * Names rather than a count, deliberately. A count passes when one script is added and another
 * dropped, which is exactly the edit most likely to be wrong.
 */
export function statedGuardedScripts(docText) {
  const text = String(docText ?? '');
  // The enumeration is a run of `name.mjs` in backticks joined by commas and "and", introduced by
  // the phrase that names what they do. Anchored on that phrase so an unrelated list of scripts
  // elsewhere in the document is not mistaken for this claim.
  // Anchored on the `GRAPH_NODE_DEPTH > 0` abort clause and read BACKWARD to the start of its
  // bullet: the names come before the verb. Anchoring on a looser phrase matched the bullet BELOW
  // this one — the two scripts that deliberately carry NO guard — and cheerfully reported that the
  // document named capture.mjs and find-inert-features.mjs as guarded. A checker that reads the
  // wrong sentence does not fail, it lies, so the anchor is the exact clause or nothing.
  const m = /abort[^.]{0,120}GRAPH_NODE_DEPTH > 0/i.exec(text);
  if (!m) return null;
  const bulletStart = text.lastIndexOf('\n- ', m.index);
  if (bulletStart === -1) return null;
  const window = text.slice(bulletStart, m.index);
  const names = [...window.matchAll(/`([a-z-]+\.mjs)`/g)].map((m) => m[1]);
  return names.length ? [...new Set(names)].sort() : null;
}

/** The declaration a script carries when it reads GRAPH_NODE_DEPTH without aborting on it. */
export const DEPTH_READ_NOT_GUARD = 'DEPTH READ, NOT A GUARD';

/** Does this source actually READ the depth variable, or merely mention it in a comment? */
export function carriesDepthGuard(source) {
  // A script that reads the depth to tell a node from the working session, and never aborts on it, says so with
  // DEPTH_READ_NOT_GUARD (the session hooks, autonomous-run-pauses): it is not a guard, and the doctrine lists it apart.
  if (String(source ?? '').includes(DEPTH_READ_NOT_GUARD)) return false;
  // nodeDepth(process.env) is the guard's one parse since entrypoint-argv.plan.md stage 2; the bare read is how a script
  // that has not adopted it carries one.
  return /process\.env\.GRAPH_NODE_DEPTH|nodeDepth\(process\.env\)/.test(String(source ?? ''));
}

/**
 * Compare the enumerated list against the scripts that carry the guard. Returns `{ missing, extra }`;
 * both empty means the document is true. A null `stated` means the document makes no such claim,
 * which is not a drift — this verifies stated lists, it does not require one.
 */
export function guardListDrift({ stated, actual }) {
  if (!stated) return { missing: [], extra: [] };
  const have = new Set(actual ?? []);
  const said = new Set(stated);
  return {
    missing: [...have].filter((n) => !said.has(n)).sort(),   // guarded, but not named
    extra: [...said].filter((n) => !have.has(n)).sort(),     // named, but not guarded
  };
}
