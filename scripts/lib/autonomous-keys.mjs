// The contract keys of autonomous-run.plan.md stage 3, one reader each (shared/claude-md-contract.md owns what each key
// means): whether a question with options goes to the decision panel, how long the panel may talk, how many spends a run
// may make, and how long a run may last. Each reader takes the contract's `review` block and refuses any value outside its
// set rather than guessing, as `claimCheckTranscriptOf` does (lib/claim-check.mjs).
//
// Pure: no I/O (ARCHITECTURE §2).

const has = (review, key) => !!review && Object.hasOwn(review, key);
const whole = (v) => Number.isInteger(v);

/**
 * `review.grounding_floor`: the floor of ARCHITECTURE.md A-22, one of the basis values (disk-first §4, passed in as
 * `basisValues` from io/basis-values.mjs, never copied here). ABSENT IS `measurement`, the operator's ruling of
 * 2026-09-13 (decision-records.plan.md stage 2). Anything else is refused.
 */
export const GROUNDING_FLOOR_DEFAULT = 'measurement';
export function groundingFloorOf(review, basisValues) {
  if (!Array.isArray(basisValues) || !basisValues.length) throw new Error('groundingFloorOf: the basis values are required (io/basis-values.mjs)');
  if (!has(review, 'grounding_floor')) return GROUNDING_FLOOR_DEFAULT;
  const v = review.grounding_floor;
  if (!basisValues.includes(v)) throw new Error(`review.grounding_floor must be one of ${basisValues.join(' | ')}, got ${JSON.stringify(v)}`);
  return v;
}

/** `review.decision_panel`: `off | on`; ABSENT IS `off` (autonomous-run.md criterion 3, "off by default"). */
export const DECISION_PANEL = Object.freeze(['off', 'on']);
export function decisionPanelOf(review) {
  if (!has(review, 'decision_panel')) return 'off';
  const v = review.decision_panel;
  if (!DECISION_PANEL.includes(v)) throw new Error(`review.decision_panel must be one of ${DECISION_PANEL.join(' | ')}, got ${JSON.stringify(v)}`);
  return v;
}

/**
 * Whether the panel may run here: the flag on AND `review.external_panel: true`. The panel is three families; with the
 * external panel off only one is reachable, and a one-family panel is not the request's panel (plan stage 4).
 */
export function panelUsable(review) {
  if (decisionPanelOf(review) !== 'on') {
    return { ok: false, reason: 'review.decision_panel is off: questions with options go to the operator' };
  }
  if (review.external_panel !== true) {
    return { ok: false, reason: 'review.decision_panel is on but review.external_panel is not true: the panel needs the other families' };
  }
  return { ok: true, reason: null };
}

/**
 * `review.decision_rounds` (absent = 3) and `review.decision_rounds_max` (absent = 6, or the declared cap if that is
 * higher): the talking rounds before the moderator is asked, and the hard cap it may extend to (design AR-D3).
 */
export function decisionRoundsOf(review) {
  const cap = has(review, 'decision_rounds') ? review.decision_rounds : 3;
  if (!whole(cap) || cap < 1) throw new Error(`review.decision_rounds must be a whole number of at least 1, got ${JSON.stringify(cap)}`);
  const hardCap = has(review, 'decision_rounds_max') ? review.decision_rounds_max : Math.max(6, cap);
  if (!whole(hardCap) || hardCap < cap) {
    throw new Error(`review.decision_rounds_max must be a whole number no less than decision_rounds (${cap}), got ${JSON.stringify(hardCap)}`);
  }
  return { cap, hardCap };
}

/**
 * `review.run_spend_max`: ABSENT OR "" IS NO BOUND (null), a whole number is that many spends (reviews, remediations,
 * bench runs) a run may start on delegated answers (design AR-D5). 0 allows none.
 */
export function runSpendMaxOf(review) {
  if (!has(review, 'run_spend_max') || review.run_spend_max === '') return null;
  const v = review.run_spend_max;
  if (!whole(v) || v < 0) throw new Error(`review.run_spend_max must be "" or a whole number, got ${JSON.stringify(v)}`);
  return v;
}

/** `review.run_time_limit_hours`: ABSENT IS 72, "" IS UNLIMITED (null), else a positive number of hours (design AR-D6). */
export function runTimeLimitHoursOf(review) {
  if (!has(review, 'run_time_limit_hours')) return 72;
  const v = review.run_time_limit_hours;
  if (v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new Error(`review.run_time_limit_hours must be "" or a positive number, got ${JSON.stringify(v)}`);
  }
  return v;
}
