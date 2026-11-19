// The ONE owner of what a minutes value may be (code-index-d1-part-a.plan.md stage 1; design note A-D1, operator 2026-10-21:
// "one module validates every minutes value"). Every limit in minutes that reaches a timer is read through minutes()
// below, by its registry key, so each key has one absent default, one minimum, one maximum and one rule for fractions.
//
// Why: one key, review.node_timeout_minutes, fell back to 15 at four readers and 30 at two; at least five validators read
// "a positive number of minutes" and disagreed about fractions, "" and `true`; and every value that reached setTimeout
// was unbounded except reviewers.json's probe limit, so a value above 35,791 minutes overflowed to about 1 ms (G-12 of
// 20261021-202611-ciss-d1-remediation-4-review, drawn by the fix for G-11 one round earlier).
//
// It began as the owner of the pre-flight check's ceiling (M1 stage 5, 2026-10-04): run-checks passed no timeout to
// capture, so every declared check ran under capture's own 10-minute default, and story-pipeline's 11-minute suite was
// killed 55% through on every review. checkTimeoutMinutes and contractMinutes stay as the names their callers import.
//
// Pure (ARCHITECTURE §2): the values arrive as parameters.

// The most minutes a Node timer can hold: setTimeout takes at most 2^31-1 ms and fires after about 1 ms above it. The one
// maximum for EVERY minutes value (operator, 2026-10-21: "B"), check_timeout_minutes included although it reaches
// spawnSync: its old bound, MAX_SAFE_INTEGER ms, rested on spawnSync ACCEPTING such a value (G-6 of
// 20261004-183024-m1-6b-check-timeout-3), never on it honouring one.
export const TIMER_MAX_MS = 2_147_483_647;
export const TIMER_MAX_MINUTES = Math.floor(TIMER_MAX_MS / 60_000);

/**
 * Milliseconds for a timer of `mins` minutes plus `marginMinutes`, held at what a timer can hold. A backstop set a margin
 * beyond a value at the maximum (the arm's and the judge's +2 minutes) would otherwise overflow to about 1 ms.
 */
// At least 1 ms (G-5 of 20261022-013653-cid1a-delivery): a tiny positive value rounded to 0, which spawnSync reads as no
// timeout at all.
export const timerMs = (mins, marginMinutes = 0) => Math.min(Math.max(Math.round((mins + marginMinutes) * 60_000), 1), TIMER_MAX_MS);

/**
 * The registry: one entry per minutes value, holding every property of it (G-2 of
 * 20261022-034225-cid1a-remediation-2-review: the empty rule, minimum and maximum lived in minutes() alone). `absent` is
 * a number, or the name of the value it falls back to, which the caller resolves (through minutes()) and passes in.
 * `empty`: what "" means — refused for every key: a timeout with no ceiling can hold the run forever, which is the
 * BLOCKED-over-nothing outcome a timeout exists to stop. `whole`: only whole minutes. `min`: the least value, inclusive
 * for a whole key, exclusive (any positive number) otherwise. `max`: the most, inclusive, and `maxWhy` why.
 */
const entry = (absent, whole, max = TIMER_MAX_MINUTES, maxWhy = 'the most a timer can hold') =>
  Object.freeze({ absent, empty: 'refused', whole, min: whole ? 1 : 0, max, maxWhy });
// ONE MAXIMUM PER VALUE, the reviewer probe's included (probe-limit-sum.design.md). Its limits also enter one timer as a
// SUM (3 x version + 2 x probe + 4 x margin), and that sum is checked once, where it is summed: reviewer-probe.mjs
// probeLimits, at mint and at the call. A per-key maximum here was a second owner of that rule, and it could disagree
// with the real sum (G-1 of 20261022-131046-cid1a-remediation-3-review).
// A derived default is held at the maximum (G-14 of 20261022-034225-cid1a-remediation-2-review).
const TWICE_NODE = `twice review.node_timeout_minutes, at most ${TIMER_MAX_MINUTES}`;
export const MINUTES = Object.freeze({
  'review.node_timeout_minutes': entry(30, false),
  'review.barrier_timeout_minutes': entry(TWICE_NODE, false),
  'review.intent_timeout_minutes': entry(TWICE_NODE, false),
  'review.check_timeout_minutes': entry(10, true),
  'review.code_index_timeout_minutes': entry(10, false),
  'roster.lens.timeout_minutes': entry('review.node_timeout_minutes', false),
  'roster.arm.timeout_minutes': entry('its lens timeout_minutes', false),
  'roster.remediation.timeout_minutes': entry('review.node_timeout_minutes', true),
  'consumer_lens.timeout_minutes': entry('review.node_timeout_minutes', false),
  'reviewers.probe_timeout_minutes': entry(5, false),
  // The flag spawn-node and external-review take, which carries any of the values above (a batch's share of the barrier
  // included, hence fractions). Absent is a direct call: the node default.
  'flag --timeout-minutes': entry('review.node_timeout_minutes', false),
});

/** The least value of entry `s` in words: inclusive for a whole key, exclusive otherwise. */
export const minText = (s) => (s.whole ? `${s.min}` : `above ${s.min}`);

const describe = (key) => {
  const s = MINUTES[key];
  const kind = s.whole ? `a whole number of minutes, at least ${s.min}` : 'a positive number of minutes';
  return `${key} must be ${kind}, at most ${s.max} (${s.maxWhy}); absent = ${s.absent}`;
};

// A refused value as written: JSON.stringify shows NaN and Infinity as null (G-8 of 20261022-013653-cid1a-delivery).
const show = (v) => (typeof v === 'number' ? String(v) : JSON.stringify(v));

/**
 * A numeric contract value: a number as written, or a string of plain decimal digits read as one; NaN for anything else.
 * The one owner of that grammar (G-11 of 20261030-142430-ciss-s7-remediation-review): Number(true) is 1, Number([10]) is
 * 10 and Number('  ') is 0, each a value nobody declared. Every contract number, a limit, a budget or a cap, reads here.
 */
export const contractNumber = (value) => (typeof value === 'number' ? value
  : typeof value === 'string' && /^[0-9]+(?:\.[0-9]+)?$/.test(value) ? Number(value) : NaN);

/**
 * The value of minutes value `key`: `fallback` (or the registry's number) when `value` is undefined, else `value` if it is a
 * number or a string of plain decimal digits within the key's bounds. Everything else throws, naming the key, the bound
 * and the value: Number() took YAML `true` as one minute, "" as 0 and "0x2" as 2. null is a key DECLARED with no value
 * (`check_timeout_minutes:` in YAML) and is refused like "": the pre-flight check's owner refused it, contractMinutes read
 * it as absent, and one rule had to win.
 */
export function minutes(key, value, fallback) {
  const spec = MINUTES[key];
  if (!spec) throw new Error(`no minutes value is registered as ${JSON.stringify(key)} (lib/check-timeout.mjs)`);
  if (value === undefined) {
    if (typeof spec.absent === 'number') return spec.absent;
    if (typeof fallback !== 'number' || !Number.isFinite(fallback) || !(fallback > 0)) {
      throw new Error(`${key} is absent and its fallback (${spec.absent}) was not resolved to a positive number — got ${show(fallback)}`);
    }
    // HELD AT THE MAXIMUM (G-7 of 20261022-013653-cid1a-delivery): twice a valid node limit above 17,895 minutes is above
    // what a timer holds, so the derived barrier minted cleanly and blocked the run when a node spawned.
    return Math.min(fallback, spec.max);
  }
  const n = contractNumber(value);
  const ok = Number.isFinite(n) && (spec.whole ? Number.isInteger(n) && n >= spec.min : n > spec.min) && n <= spec.max;
  if (!ok) throw new Error(`${describe(key)} — got ${show(value)}`);
  return n;
}

/** A `review.<key>` limit; the name run-graph and spawn-subagent import. `fallback` serves a derived absent default. */
export function contractMinutes(review, key, fallback) {
  return minutes(`review.${key}`, review?.[key], fallback);
}

export const CHECK_TIMEOUT_DEFAULT_MINUTES = MINUTES['review.check_timeout_minutes'].absent;
export const CHECK_TIMEOUT_MAX_MINUTES = TIMER_MAX_MINUTES;

/**
 * Minutes each pre-flight check may run before capture kills its DIRECT process — only that one: a command that starts
 * others can leave them running (G-2 of 20261004-194936-m1-6b-check-timeout-5; the ledger tracks it against capture.mjs).
 * Throws on a value it cannot honour.
 */
export function checkTimeoutMinutes(contract = {}) {
  const review = contract?.review ?? {};
  return minutes('review.check_timeout_minutes', Object.hasOwn(review, 'check_timeout_minutes') ? review.check_timeout_minutes : undefined);
}
