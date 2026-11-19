// THE CENSUS A REMEDIATION REPORTS PER GROUP (observation-guard-and-sibling-census.md, B), defined once: the remediation
// schema in spawn-node requires these names and the follow-up's census counts them (G-2 of 20261017-031552-ogsc-review).
//
// A LEAF, ON PURPOSE: spawn-node and lib/review-prompts are code the reviewer probe loads, and every module the probe
// loads is in its key (PROBE_CODE_FILES), so a change to any of them re-probes every reviewer. Kept in
// lib/remediation-chain, these names pulled that module and its imports into the key; here they add one file that
// changes only when the census does.

//
// THE NAMES AND THE ITEM SHAPES ARE ONE TABLE (G-4 of 20261017-040138-ogsc-remediation-review): the schema spelled each
// property beside the CENSUS_FIELDS that drove `required`, so a renamed field would be required and, under
// additionalProperties: false, forbidden. A census entry cannot be "" (G-6 of 20261017-031552-ogsc-review).
const nonEmpty = { type: 'string', minLength: 1 };
export const CENSUS_ITEMS = Object.freeze({
  search_sites: nonEmpty,
  not_in_class: { type: 'object', additionalProperties: false, required: ['site', 'reason'], properties: { site: nonEmpty, reason: nonEmpty } },
  unmatched_spellings: nonEmpty,
});
export const CENSUS_FIELDS = Object.freeze(Object.keys(CENSUS_ITEMS));

/**
 * THE FOLLOW-UP REVIEW IS SHOWN THE FIX'S CENSUS: what each group of the remediation's report counts, as data. The
 * sentences around it are the prompt library's (lib/review-prompts censusSection; G-3 of 20261017-031552-ogsc-review).
 * Copies none of the node's text: a brief is tracked. `payload` is the remediation's evidence/remediation/payload.json,
 * or null. Returns null when it has no groups, else one row per group: `{ group_id, counts }`, `counts` null when the
 * report predates the census.
 */
export function censusRows(payload) {
  if (!Array.isArray(payload?.groups)) return null;
  return payload.groups.map((g) => ({
    group_id: String(g?.group_id ?? '?').replace(/[^\w-]/g, ''),
    counts: CENSUS_FIELDS.every((f) => Array.isArray(g?.[f])) ? Object.fromEntries(CENSUS_FIELDS.map((f) => [f, g[f].length])) : null,
  }));
}
