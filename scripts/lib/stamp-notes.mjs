// WHAT A RUN STAMP DOES TO THE NODE READING IT — the stamp notes in prompts/_templates/, and the
// rule that derives a recovery stamp's note from its base.
//
// MOVED HERE from codex-prompts.mjs (G-21 of 20260925-015614-platform-review, and the second
// precondition of consumer-owned-configuration AC 6): stamp semantics are not a review prompt, and
// carrying them kept a vendor-named prompt module from being about one thing.
import { renderTemplate, readTemplate } from './template.mjs';
// The table is read through ruleTable, which fills its rule slots, so every path below gets the filled text.
import { ruleTable } from './rule-text.mjs';

/**
 * What a run stamp DOES to the node reading it.
 *
 * The brief rendered a bare list of stamp names and left the node to interpret them (G-39): only
 * TESTS-THIN and FMT-DIRTY said what followed, and they said it in separate blocks of their own. A
 * node told `CONTRACT-PARTIAL` with no statement of effect has been handed a fact that changes
 * nothing it does, which is I-49's definition of an inert guarantee — and the two stamps that DID
 * carry a consequence prove the shape was known and applied to two of fifteen.
 *
 * Throws on an unknown stamp, like schemaField: a stamp emitted with no sentence here would render
 * as a bare name again, which is the exact defect, and a silent `undefined` is worse than a crash at
 * mint. The set is asserted against the emitters in tests, so adding a stamp to a script without a
 * sentence fails the suite rather than the next run's brief.
 */
export function stampConsequence(stamp, io) {
  const table = ruleTable('stamp-consequences.json', io);
  const text = table[stamp];
  if (typeof text === 'string') return text;

  // A RECOVERY STAMP IS DERIVED, SO ITS CONSEQUENCE IS TOO (G-39, doc-consistency-review).
  //
  // run-graph builds these as `${pre.stamp}-FAILED` — the graph knew a precondition was unmet,
  // spawned a producer to close it, and the producer did not. The throw above turned that into a
  // CRASH: the first brief rendered after such a recovery would take the whole run down, and the
  // throw was added by the same change that introduced this table. A stamp nothing explains was the
  // defect; a stamp whose explanation can only be written by hand for a suffix the code composes is
  // the same defect waiting on the next precondition anyone adds.
  //
  // Composed from the base stamp, so a new entry in PRECONDITIONS is explained the moment it exists.
  const base = stamp.endsWith('-FAILED') ? stamp.slice(0, -'-FAILED'.length) : null;
  if (base && typeof table[base] === 'string') {
    return renderTemplate(readTemplate('stamp-recovery-failed.md', io),
      { base_consequence: table[base] }, 'stamp-recovery-failed.md').trim();
  }

  throw new Error(`no consequence for run stamp '${stamp}' in prompts/_templates/stamp-consequences.json`
    + ' — a stamp a node cannot act on states nothing (I-49)');
}

/** Every stamp the prompt library can explain. The emitters are checked against this in tests. */
export function explainedStamps(io) {
  return Object.keys(ruleTable('stamp-consequences.json', io)).filter((k) => !k.startsWith('$'));
}
