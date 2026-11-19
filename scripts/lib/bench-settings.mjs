/**
 * Which model, effort and judge a bench pass runs — as decisions, not as literals.
 *
 * Every value here is READ from the frozen contract, the adapter table or lens-roster.json, and
 * where none of them answers, this module REFUSES rather than picking. That is I-10 of
 * `.claude/requests/model-and-effort-reevaluation.md` ("No model name or effort is introduced as a
 * literal in a script") and A-9 (nor a vendor name), and it is the same rule spawn-node already
 * states in its own source: "`args.runtime ?? 'claude'` put the one thing the adapter table exists
 * to remove back into the orchestrator."
 *
 * It lives in lib/ for the reason every other decision here does — so it can be tested without
 * spawning anything. The alternative is a `?? 'opus'` that only a paid pass could ever exercise.
 */
import { reviewersFromOutcome } from './reviewers.mjs';

/**
 * The adjudicator a single-judge tool asks when the caller names none.
 *
 * NOT A TIE-BREAKER. `$adjudicators` in lens-roster.json spends a paragraph denying that role
 * exists — "a tie between two judges IS the finding" — and this is a different question: a tool
 * that asks ONE judge has to ask a particular one, and which one is configuration.
 *
 * `default_judge` names it by `id`. Absent, a set of exactly one needs no decision; a set of
 * several without a declared default is a configuration nobody made, and picking by file order
 * would put the choice in whichever entry happened to be typed first.
 */
export function defaultJudge(judges, raw = null) {
  const list = Array.isArray(judges) ? judges : [];
  if (!list.length) return { ok: false, why: 'lens-roster.json declares no adjudicators' };
  const declared = typeof raw?.default_judge === 'string' ? raw.default_judge.trim() : '';
  if (declared) {
    const hit = list.find((j) => (j.id ?? j.reviewer) === declared);
    return hit
      ? { ok: true, judge: hit }
      : { ok: false, why: `lens-roster.json declares default_judge '${declared}', which is not in adjudicators[]` };
  }
  if (list.length === 1) return { ok: true, judge: list[0] };
  return {
    ok: false,
    why: 'several adjudicators and no `default_judge` in lens-roster.json: declare one, or pass '
      + '--judge. This tool does not pick a vendor.',
  };
}

/**
 * WHAT A BENCH ANSWERS TO (bench-contract-root.design.md D1-D3): the framework root's contract, read ONCE by the caller —
 * the root is chosen in orchestration, where I/O belongs — and decided here from the reader's OUTCOME, so this consults
 * no process and needs no `io` (ARCHITECTURE §2). Returns the declared adapters, from their one owner, and the `review`
 * block (null when absent); an unreadable contract is refused, never read as declaring nothing.
 */
export function benchContract(outcome) {
  const reviewers = reviewersFromOutcome(outcome, 'bench');
  return { reviewers, review: outcome?.contract?.review ?? null };
}

// The node runtime a bench records and probes is chosen by lib/reviewers.mjs's selectAdapters, the one owner, as new-run's
// is (contract-runtime-and-session-files.plan.md stage 1); benchRuntime, its copy here, is gone.

/**
 * WHETHER A LIVE BENCH MAY SPEND ON THIS CONTRACT (bench-contract-root.design.md, D1's amendment; operator, 2026-10-14:
 * "Refuse a live run; listing reads it (Recommended)"). The graphs are seeded from HEAD, so a contract that is modified,
 * staged or untracked is one they would never run under — the 2026-09-20 sweep measured the committed setting while
 * reporting the edited one. `git` is the answer of `git status --porcelain -- <CONTRACT_CANDIDATES>` as
 * `{ status, stdout, stderr }`, run by the caller. Returns why the run is refused, or null. A git that cannot answer
 * refuses too: unknown is not clean (G-23, `new-run.mjs:529-535`).
 */
export function uncommittedContractRefusal(git) {
  if (git?.status !== 0) {
    return `bench: git status failed, so whether the contract is committed is unknown, and a live run would be measured `
      + `against a contract nobody can name: ${String(git?.stderr ?? git?.error ?? '').trim() || `exit ${git?.status}`}`;
  }
  const files = String(git.stdout ?? '').split('\n').filter(Boolean).map((l) => l.slice(3).trim());
  if (!files.length) return null;
  return `bench: the contract is not committed (${files.join(', ')}). The benched graphs are seeded from HEAD, so they `
    + 'would never run under it: commit it, or sweep a setting with the bench\'s flags, which reach the seeded tree.';
}

/**
 * The model and effort `second-opinion` is spawned at for one bench position.
 *
 * Three sources in precedence order, and the first two are why this function exists:
 *
 *   1. a CANDIDATE supplied on argv — the lower setting I-3 asks every comparison to run beside
 *      the one in force. Without this the harness can only ever measure the current setting.
 *   2. the run's OWN FROZEN CONTRACT — the setting in force for that pass, which is what makes a
 *      re-scored run comparable to the pass it came from.
 *   3. lens-roster.json's `default_models` — what an ABSENT contract key falls back to, engine-wide
 *      (run-graph.mjs:342, spawn-node.mjs:300). Not a literal: a value someone declared.
 *
 * Refuses when none of the three answers. `?? 'opus'` here meant a result could report a
 * measurement at a model nobody declared, while the forge thirty lines away threw on the same
 * absence — one file, two answers to one question.
 */
export function judgmentSetting({ candidate = null, frozen = null, rosterDefaults = null } = {}) {
  const trim = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const model = trim(candidate?.model)
    ?? trim(frozen?.review?.models?.judgment)
    ?? trim(rosterDefaults?.judgment);
  if (!model) {
    return {
      ok: false,
      why: 'no judgment model: the frozen contract declares no review.models.judgment, '
        + 'lens-roster.json declares no default_models.judgment, and no --model was given. '
        + 'A model name is configuration, and this script will not invent one.',
    };
  }
  // EFFORT IS ALLOWED TO BE ABSENT, and that is not the same class as an absent model. Several
  // runtimes take no effort flag at all, and spawn-node only appends one when there is a value; a
  // missing model has nothing to spawn against.
  const effort = trim(candidate?.effort) ?? trim(frozen?.review?.effort?.judgment);
  // PER KNOB, because AC2 treats them as separate knobs and one scalar cannot answer for both. It
  // WAS one, and the opus/low artifact is what showed the cost: every seed recorded
  // `source: "frozen-contract"` beside `effort: "low"` and `in_force.effort: "medium"`. The effort
  // was the candidate; the field that exists to say where the setting came from said the contract.
  // Not false about the model, which is the trap — it described the model while sitting in a block
  // about the whole setting, so a reader checking it alone concludes nothing was overridden.
  const source = {
    model: trim(candidate?.model) ? 'candidate'
      : trim(frozen?.review?.models?.judgment) ? 'frozen-contract'
        : 'roster-default',
    // An absent effort has NO origin to name. `null` rather than borrowing the model's, because
    // "the contract set it" and "nobody set it" are different facts about the run.
    effort: trim(candidate?.effort) ? 'candidate'
      : trim(frozen?.review?.effort?.judgment) ? 'frozen-contract'
        : null,
  };
  return { ok: true, model, effort, source, is_candidate: Boolean(trim(candidate?.model) || trim(candidate?.effort)) };
}

/**
 * The effort ladder a runtime declares, ascending — or nothing.
 *
 * `ascending` is a SEPARATE CLAIM from `values`, and it has to be: the adapter's own note calls
 * that list "the closed set this CLI parses", which is a set. Taking the order from array position
 * would work today and would be an ordering nobody wrote down, which is how this repository's
 * expensive defects are shaped. Without the declaration there is no "lower", so AC2's rule cannot
 * be applied and says so instead of guessing.
 */
export function effortLadder(runtime) {
  const eff = runtime?.node_runtime?.effort ?? runtime?.effort ?? {};
  const values = Array.isArray(eff.values) ? eff.values.filter((v) => typeof v === 'string') : [];
  return eff.ascending === true ? values : [];
}

/**
 * Is this candidate inside the search space AC2 bounds?
 *
 * The bound is ASYMMETRIC on purpose, and the request says why: "at the CURRENT model, only efforts
 * LOWER than the one in force are tried — the question is whether cheaper suffices, so a higher
 * effort on the same model answers nothing. At a SIMPLER model, ANY effort is admissible including
 * a higher one, because a lower model at high effort against a higher model at low effort is a real
 * trade and ruling it out by symmetry would hide it."
 *
 * Refused up front rather than after a pass: a candidate outside the space costs the same dollars as
 * one inside it and produces a number that answers no question the request asked.
 *
 * NO MODEL LADDER IS CHECKED, and that is not an oversight. "Simpler" is a fact about a vendor's
 * line-up that nothing in this repository declares — `default_models` names two models and ranks
 * neither — so a DIFFERENT model is taken as a different model, and whether it is simpler is the
 * reader's to judge from the result. Asserting a model order here would be the same invention
 * `ascending` exists to refuse, one rung up.
 */
export function candidateAdmissible({ candidate = null, inForce = null, ladder = [] } = {}) {
  const model = typeof candidate?.model === 'string' && candidate.model.trim() ? candidate.model.trim() : null;
  const effort = typeof candidate?.effort === 'string' && candidate.effort.trim() ? candidate.effort.trim() : null;
  if (!model && !effort) return { ok: false, why: 'no candidate setting was given' };

  const model0 = inForce?.model ?? null;
  const effort0 = inForce?.effort ?? null;
  const sameModel = !model || model === model0;

  if (sameModel && !effort) {
    return { ok: false, why: `--model ${model} is the setting already in force, so there is nothing to compare` };
  }
  if (!sameModel) {
    // A different model opens the whole ladder. Still validate membership: a typo is spend.
    if (effort && ladder.length && !ladder.includes(effort)) {
      return { ok: false, why: `effort '${effort}' is not one the runtime declares: ${ladder.join(', ')}` };
    }
    return { ok: true, why: `a different model, so any effort is admissible (AC2)` };
  }

  // Same model: only LOWER efforts, which needs a declared order.
  if (!ladder.length) {
    return {
      ok: false,
      why: 'the runtime declares no declared effort order (`ascending` on its effort block), so '
        + '"lower than the setting in force" cannot be decided. Declare it, or bench a different model.',
    };
  }
  if (!ladder.includes(effort)) {
    return { ok: false, why: `effort '${effort}' is not one the runtime declares: ${ladder.join(', ')}` };
  }
  if (!effort0) {
    return {
      ok: false,
      why: 'the setting in force declares no effort, so there is no rung for a candidate to be below. '
        + 'Bench a different model instead.',
    };
  }
  if (!ladder.includes(effort0)) {
    return { ok: false, why: `the effort in force ('${effort0}') is not on the runtime's declared ladder` };
  }
  const rung = ladder.indexOf(effort);
  const rung0 = ladder.indexOf(effort0);
  if (rung === rung0) return { ok: false, why: `effort '${effort}' is the setting already in force` };
  if (rung > rung0) {
    return {
      ok: false,
      why: `effort '${effort}' is ABOVE '${effort0}' on the same model, which answers nothing — the `
        + 'question AC2 asks is whether cheaper suffices. At a different model any effort is admissible.',
    };
  }
  return { ok: true, why: `'${effort}' is below '${effort0}' on the same model (AC2)` };
}

// ============================================================================= the admission gate
//
// I-7 and I-8 of `.claude/requests/model-and-effort-reevaluation.md`. Until this existed a bench
// pass produced recall, caught and false alarms and STOPPED — so the only way to read two settings
// was to compare aggregate recall by eye, which is the one thing AC8 forbids by name ("no aggregate
// threshold or significance test is honest, because one seed flipping is 10-14% of the result").
//
// THE TWO CLAUSES ARE NOT THE SAME KIND OF RULE, and that is the whole difficulty here:
//
//   - the per-seed regression clause is EXACT. "A seed the current setting catches must still be
//     caught" needs no threshold and no statistics, and it is decided below in full.
//   - the false-positive clause needs a number the request never gives. It says "does not rise
//     MATERIALLY" and quantifies nothing; the run that raised this recorded the same gap in its own
//     words — "The request uses 'material' without quantifying it, and none of the documents read
//     declares a number."
//
// So the FP clause takes a DECLARED tolerance and, absent one, returns `undecided` naming itself.
// It does not default. A default here would be a number nobody chose deciding whether a cheaper
// model ships, wearing the authority of a gate — which is worse than the missing gate it replaces,
// because it would look decided.

// THE STATES ARE THE SCORER'S TO DEFINE, and this file re-spelled one of them from memory:
// `'caught'` appears in a result's SUMMARY block and never in a seed's `mutated.state`, so the
// admission gate matched nothing on every file and reported "no seed regressed" against a
// baseline that caught six. Found by the first live pass. A vocabulary spelled twice is a
// vocabulary that will disagree with itself; imported now, so a change there fails here.
import { IDENTIFIED, NOT_IDENTIFIED } from './second-opinion-scoring.mjs';

/**
 * A setting's identity as one string, for messages and for the per-position record.
 *
 * `unrecorded` rather than `?`, because the first live comparison printed "sonnet against ?" — the
 * baseline predated the result file carrying its own setting, which is honest and unreadable. A
 * result whose setting nobody wrote down is a real state and deserves a word.
 */
export const settingLabel = (s) => (s?.model
  ? `${s.model}${s.effort ? `/${s.effort}` : ''}`
  : (s?.effort ? `effort ${s.effort}` : 'unrecorded'));

/**
 * Which seeds a bench result caught, as a Set of seed names.
 *
 * A seed that was NOT RUN is neither caught nor missed — it is absent, and I-7's rule is about
 * seeds the current setting CATCHES, so an absent seed cannot regress. Counting it as missed would
 * reject a candidate for a corpus gap.
 */
export function caughtSeeds(result) {
  const out = new Set();
  for (const s of result?.seeds ?? []) if (s?.mutated?.state === IDENTIFIED) out.add(s.seed);
  return out;
}

/**
 * Seeds the candidate MEASURED AND MISSED — distinct from ones it never ran.
 *
 * Only `not-identified` counts. `unverified`, `no-vote` and `neither` are the judge failing to
 * settle the question, not the audit failing to catch the error, and counting them as misses would
 * reject a setting for the instrument's own indecision.
 */
export function missedSeeds(result) {
  const out = new Set();
  for (const s of result?.seeds ?? []) if (s?.mutated?.state === NOT_IDENTIFIED) out.add(s.seed);
  return out;
}

/** Total false alarms: reports that fired on the CLEAN control, where there was nothing to find. */
export function falseAlarms(result) {
  const explicit = result?.summary?.false_alarms;
  if (Number.isFinite(explicit)) return explicit;
  // A FALSE ALARM IS THE CONTROL SCORING `identified`: the judge found a passage identifying an
  // injected error in a report that audited a CLEAN reconciliation, where there was nothing to
  // find. Same vocabulary as the mutated side — this fallback said `'false-alarm'`, a string no
  // artifact contains, which was the same defect one function up and would have read 0 forever on
  // any file whose summary was missing.
  return (result?.seeds ?? []).filter((s) => s?.control?.state === IDENTIFIED).length;
}

/**
 * Accept either a raw bench result or an already-normalised read, and return the normalised form.
 *
 * `caught instanceof Set` is the discriminator: only `readBenchResult` produces that, and no raw
 * artifact from either harness has it.
 */
function normalised(r) {
  if (r && r.caught instanceof Set) return r;
  const read = readBenchResult(r);
  // A shape neither harness wrote normalises to EMPTY rather than throwing — the CLI refuses such a
  // file up front with a message naming it, and a library that threw here would turn that refusal
  // into a stack trace. Empty is safe because an empty baseline can never say "no seed regressed":
  // the caller checks `caught.size` before trusting a verdict.
  return read.ok ? read : {
    caught: new Set(), missed: new Set(), ran: new Set(), fp: 0, fp_label: null,
    tokens: null, duration: null, setting: null, kind: null,
  };
}

/**
 * I-7. May the candidate setting replace the one in force?
 *
 * Three verdicts, and the third is the point:
 *
 *   `rejected`  — a seed the current setting catches is not caught by the candidate, or the FP rise
 *                 exceeds a declared tolerance. The regressing seeds are NAMED, because "recall
 *                 fell" is not something anyone can act on.
 *   `admitted`  — every such seed still caught, AND the FP clause decided in the candidate's favour.
 *   `undecided` — the per-seed clause passed but the FP clause could not be evaluated, because no
 *                 tolerance is declared. NOT `admitted`: a gate that passes a clause it never
 *                 evaluated is the failure mode I-7 exists to prevent.
 */
export function admissionVerdict({ current, candidate, fpTolerance = null } = {}) {
  // EITHER SHAPE, normalised once. Callers hand this raw result JSON from either harness, or an
  // already-normalised `readBenchResult`. Taking only the second would have made every existing
  // caller rewrite its call site; taking only the first left the lens shape unreadable, which is
  // how a gate came to report ADMITTED over zero seeds.
  const C = normalised(current);
  const D = normalised(candidate);
  const cur = C.caught;
  const cand = D.caught;
  const candMissed = D.missed;
  // A SEED THE CANDIDATE NEVER RAN IS NOT A SEED IT MISSED, and the first live pass is exactly why
  // this split exists: a one-seed `--model sonnet` run against a six-seed baseline would otherwise
  // report five REGRESSIONS, saying the candidate failed to catch what nobody asked it about.
  // Reporting nothing instead is worse — it would admit a setting on a sixth of the evidence.
  // So: measured-and-missed rejects, unmeasured leaves the question open.
  const regressed = [...cur].filter((s) => candMissed.has(s)).sort();
  // TWO WAYS TO NOT HAVE AN ANSWER, and the drop/opus-low pass showed they are not the same thing.
  // `numeric-bundle-pager` came back `unverified` — the judge voted identified and cited a quote
  // that is not in the report — so the node RAN, produced an audit, and the instrument failed to
  // settle it. Calling that "never measured" was wrong twice: it was measured, and the failure was
  // the judge's rather than the candidate's. Both still block admission; they call for different
  // next steps, which is why they are named apart. An absent seed means run it. An unscoreable one
  // means re-running may land the same way and the judge is what needs looking at.
  const ranSeeds = D.ran;
  const unscoreable = [...cur].filter((s) => !cand.has(s) && !candMissed.has(s) && ranSeeds.has(s)).sort();
  const absent = [...cur].filter((s) => !ranSeeds.has(s)).sort();
  const unmeasured = [...unscoreable, ...absent].sort();
  const gained = [...cand].filter((s) => !cur.has(s)).sort();

  const fp0 = C.fp;
  const fp1 = D.fp;
  const fpRise = fp1 - fp0;

  // THE SEED COUNT TRAVELS WITH THE VERDICT (AC8's last sentence). At n=7 one seed is 14% of the
  // result, and a reader who cannot see n cannot weigh what they are being told.
  // TWO DIFFERENT QUANTITIES, AND THIS FIELD HELD THE WRONG ONE (G-22, panel-codex-contract).
  // `seeds_in_force` is AC8's n — "the number of seeds in force is reported with every result so the
  // reader can weigh it", because at n=7 one seed is 14% of the result. It was assigned the count
  // the baseline happened to CATCH, so a baseline miss silently shrank the denominator and made the
  // result look better-supported than it was.
  //
  // It went unnoticed because every pass so far had a baseline that caught everything, which makes
  // the two equal in all real data collected to date. They are different quantities; they have
  // different names now, and the sentences below use whichever they actually mean.
  const seeds_in_force = C.ran.size;
  const caught_in_force = cur.size;
  const base = {
    regressed,
    unmeasured,
    unscoreable,
    absent,
    gained,
    false_alarms: { current: fp0, candidate: fp1, rise: fpRise },
    seeds_in_force,
    caught_in_force,
    scored: { current: C.ran.size, candidate: D.ran.size },
    fp_label: D.fp_label ?? C.fp_label ?? null,
  };

  if (regressed.length) {
    return {
      ...base,
      verdict: 'rejected',
      // A TRADE IS STILL A REJECTION, however the totals look — AC8 says so outright, and it is the
      // clause an aggregate recall comparison would silently pass.
      why: `${regressed.length} of ${caught_in_force} seed(s) the setting in force catches are not `
        + `caught by the candidate: ${regressed.join(', ')}`
        + (gained.length
          ? `. It catches ${gained.join(', ')} that the current setting misses, which does NOT offset them`
          : ''),
    };
  }

  // COVERAGE IS A CLAUSE TOO, and it is checked before the FP one because it is the cheaper
  // question: a corpus the candidate only partly ran cannot support "no seed regressed" whatever
  // the false-alarm count does.
  if (unmeasured.length) {
    return {
      ...base,
      verdict: 'undecided',
      undecided_clause: 'coverage',
      why: `nothing regressed among the ${caught_in_force - unmeasured.length} seed(s) the candidate scored, `
        + `but ${unmeasured.length} the setting in force catches produced no verdict`
        + (unscoreable.length
          ? `. RAN BUT COULD NOT BE SCORED: ${unscoreable.join(', ')} — the node reported and the `
            + 'judge did not settle it, which is the instrument failing rather than the candidate'
          : '')
        + (absent.length ? `. NEVER RUN: ${absent.join(', ')}` : '')
        + '. Admission needs the whole set — the AC8 rule is per-seed, so a seed with no verdict is '
        + 'an open question rather than a pass.',
    };
  }

  if (!Number.isFinite(fpTolerance)) {
    return {
      ...base,
      verdict: 'undecided',
      undecided_clause: 'false-positive rise',
      why: `no seed regressed (${caught_in_force} caught of ${seeds_in_force} in force), but the false-positive clause cannot be `
        + `decided: false alarms went ${fp0} -> ${fp1} and no tolerance for a "material rise" is `
        + 'declared. The request says "material" and quantifies nothing. Declare one and re-read '
        + 'this; a default here would be a number nobody chose deciding whether a setting ships.',
    };
  }
  if (fpRise > fpTolerance) {
    return {
      ...base,
      verdict: 'rejected',
      why: `no seed regressed, but false alarms rose ${fp0} -> ${fp1} (+${fpRise}), above the `
        + `declared tolerance of ${fpTolerance}. A cheaper setting that matches recall by reporting `
        + 'more has moved the work to whoever reads the gate, not saved it.',
    };
  }
  return {
    ...base,
    verdict: 'admitted',
    why: `every one of the ${caught_in_force} seed(s) the setting in force catches is still caught, `
      + `and false alarms went ${fp0} -> ${fp1}, within the declared tolerance of ${fpTolerance}`,
  };
}

/**
 * Total tokens across a result's per-seed usage, or null when the vendor reported none.
 *
 * THE SHAPE IS `splitSpend`'S, read from the artifact rather than remembered: `spent.usage` is one
 * FLAT usage object per seed, not a per-node map. This walked it as a map, skipped every number as
 * "not an object", and returned null on every real file — so `preferredSetting` answered
 * `undecidable` on every real comparison, which sounds like a careful verdict and was a bug.
 *
 * Every `*_tokens` key counts (usageTokensOnce, below, which leaves out only the two that restate the others), rather
 * than a hardcoded four: cache reads DOMINATE the figure here
 * (1.48M against 42 fresh input on one seed), and a list written by hand goes stale the first time
 * a vendor adds a bucket — silently, and downward, which is the direction that flatters.
 * `output_tokens_details.thinking_tokens` is nested INSIDE output_tokens and is deliberately not
 * added again; only top-level numeric keys are summed.
 */
export function totalTokens(result) {
  let sum = null;
  for (const s of result?.seeds ?? []) {
    const n = usageTokensOnce(s?.spent?.usage ?? s?.usage ?? null);
    if (n !== null) sum = (sum ?? 0) + n;
  }
  return sum;
}

/**
 * THE ONE RULE FOR A USAGE RECORD'S TOKENS, EACH COUNTED ONCE (G-6 and G-7 of
 * 20261114-184441-m2-pred1-remediation-b-review), or null when it has none: every top-level finite `*_tokens` key, so a
 * vendor's new bucket is not dropped, except the two that restate the others. `thinking_tokens` is inside
 * `output_tokens` (agy reports it at the top level, the older lens totals did too), and `total_tokens` is agy's
 * aggregate of the rest. Nested details are never summed.
 */
const RESTATED_TOKEN_KEYS = new Set(['thinking_tokens', 'total_tokens']);
/**
 * THE OWNER OF WHICH KEYS COUNT (G-2 of 20261114-195905-m2-pred1-remediation-2-review): a usage record's counted
 * `[key, value]` pairs, in the record's order. usageTokensOnce sums them and sumLensUsage totals them by name, so the
 * two cannot disagree; RESTATED_TOKEN_KEYS is consulted here only.
 */
export function countedTokenEntries(u) {
  if (!u || typeof u !== 'object') return [];
  return Object.entries(u).filter(([k, v]) => !RESTATED_TOKEN_KEYS.has(k) && k.endsWith('_tokens') && Number.isFinite(v));
}
export function usageTokensOnce(u) {
  const entries = countedTokenEntries(u);
  return entries.length ? entries.reduce((n, [, v]) => n + v, 0) : null;
}

/**
 * The cache reads of a usage total, in either vendor's spelling (G-1 of 20261114-195905-m2-pred1-remediation-2-review):
 * Claude's `cache_read_input_tokens` and agy's `cache_read_tokens`, which sumLensUsage keeps under their own names.
 */
export function cacheReadTokens(t) {
  const n = (x) => (Number.isFinite(x) ? x : 0);
  return n(t?.cache_read_input_tokens) + n(t?.cache_read_tokens);
}

/**
 * Summed wall-clock across a result's seeds, in milliseconds, or null.
 *
 * `spent.duration_ms`, singular and flat. This read `spent.durations` — a key no artifact carries.
 */
export function totalDuration(result) {
  let sum = null;
  for (const s of result?.seeds ?? []) {
    const d = s?.spent?.duration_ms ?? s?.duration_ms ?? null;
    if (Number.isFinite(d)) sum = (sum ?? 0) + d;
  }
  return sum;
}

/**
 * I-8. Among ADMITTED settings, which is preferred, and by which rule?
 *
 * Three outcomes, and the tool may decide only the first two:
 *
 *   `dominance`      — better or equal on tokens, wall-clock AND false-positive candidates, and
 *                      strictly better on at least one. No weighting, no exchange rate.
 *   `tiebreak-10pct` — the standing rule, and the 10% is the REQUEST'S number rather than one
 *                      invented here: "within 10% on tokens, prefer the faster."
 *   `genuine-trade`  — surfaced, not resolved. A non-dominated pair outside the 10% band is a
 *                      decision about what the operator values, and I-8 names resolving it here as
 *                      a failure mode. So does A-20: the recommendation is a recommendation.
 *
 * A missing metric is not a zero. Tokens or duration the vendor never reported make dominance
 * unprovable, and saying so beats a comparison against an imputed number (AC4).
 */
export function preferredSetting({ current, candidate, admitted = true } = {}) {
  if (!admitted) {
    return {
      rule: 'not-admitted',
      preferred: 'current',
      why: 'the candidate was not admitted, so there is nothing to prefer it over',
    };
  }
  const metrics = (r) => {
    const n = normalised(r);
    return { tokens: n.tokens, duration: n.duration, fp: n.fp };
  };
  const a = metrics(current);
  const b = metrics(candidate);
  const missing = ['tokens', 'duration'].filter((k) => !Number.isFinite(a[k]) || !Number.isFinite(b[k]));
  if (missing.length) {
    return {
      rule: 'undecidable',
      preferred: null,
      metrics: { current: a, candidate: b },
      why: `dominance needs ${missing.join(' and ')} on both sides, and at least one result file `
        + 'carries neither. An absent metric is recorded as absent, never imputed (AC4).',
    };
  }

  const keys = ['tokens', 'duration', 'fp'];
  const candDominates = keys.every((k) => b[k] <= a[k]) && keys.some((k) => b[k] < a[k]);
  const curDominates = keys.every((k) => a[k] <= b[k]) && keys.some((k) => a[k] < b[k]);
  if (candDominates) {
    return {
      rule: 'dominance',
      preferred: 'candidate',
      metrics: { current: a, candidate: b },
      why: 'the candidate is better or equal on tokens, wall-clock and false-positive candidates, and strictly better on at least one',
    };
  }
  if (curDominates) {
    return {
      rule: 'dominance',
      preferred: 'current',
      metrics: { current: a, candidate: b },
      why: 'the setting in force is better or equal on every metric, so admission buys nothing',
    };
  }

  // THE 10% BAND IS ON TOKENS, measured against the setting in force. Zero tokens on the baseline
  // is not a 0% difference, it is an unusable denominator.
  if (a.tokens > 0) {
    const delta = Math.abs(b.tokens - a.tokens) / a.tokens;
    if (delta <= 0.10) {
      const faster = b.duration < a.duration ? 'candidate' : a.duration < b.duration ? 'current' : null;
      if (faster) {
        return {
          rule: 'tiebreak-10pct',
          preferred: faster,
          metrics: { current: a, candidate: b },
          why: `tokens are within 10% (${(delta * 100).toFixed(1)}%), so the faster is preferred`,
        };
      }
    }
  }

  return {
    rule: 'genuine-trade',
    preferred: null,
    metrics: { current: a, candidate: b },
    why: 'neither setting dominates and tokens are outside the 10% band, so this is a trade about '
      + 'what you value rather than a comparison. I-8 asks for it to be SURFACED: resolving it with '
      + 'an invented exchange rate between minutes and tokens is the named failure mode.',
  };
}

/**
 * I-9. The per-position record, which is what a reader of the recommendation actually needs.
 *
 * A position nobody benched is `not benched` rather than absent — the difference between "we
 * measured and it was fine" and "nobody looked" is the whole reason this vocabulary is specified,
 * and an omitted row reads as the first while meaning the second.
 */
export function positionRecord({
  position, current, candidate = null, gate = null, preference = null, measuredBy = null,
} = {}) {
  if (!candidate || !gate) {
    return {
      position,
      setting: settingLabel(current),
      verdict: 'not benched',
      measured_by: null,
      why: 'no candidate was measured against this position, so its setting is untested rather than confirmed',
    };
  }
  const verdict = gate.verdict === 'admitted' ? 'similar'
    : gate.verdict === 'rejected' ? 'not similar'
      : 'undecided';
  return {
    position,
    setting: settingLabel(current),
    candidate: settingLabel(candidate),
    verdict,
    // AC10: an unchanged value is MEASURED AND KEPT, not untouched.
    outcome: verdict === 'similar'
      ? 'candidate admitted — the operator decides whether to adopt it (A-20)'
      : verdict === 'not similar'
        ? 'measured and kept'
        : 'measured, undecided — a clause could not be evaluated',
    rule: preference?.rule ?? null,
    preferred: preference?.preferred ?? null,
    regressed: gate.regressed ?? [],
    seeds_in_force: gate.seeds_in_force ?? null,
    // THE CITATION IS THE POINT OF THE RECORD. A verdict nobody can trace to a run is an assertion.
    measured_by: measuredBy,
    why: gate.why,
  };
}

/**
 * The basename a bench result is written to — every knob that changes WHAT WAS MEASURED in it.
 *
 * FOUND WHILE ABOUT TO SPEND ON THE FIRST CANDIDATE PASS. `--model sonnet --from <the opus
 * baseline>` would have written over the very file it was to be compared against, destroying the
 * baseline by producing the other half of the comparison.
 *
 * That is the FOURTH instance of one class in this harness, and the three before it were each fixed
 * on their own: `--seed` (two single-seed runs, the second silently replacing the first — measured,
 * that is how one run's result was lost), `--rejudge`, and per-mutation (a `deflate` forge-only pass
 * replacing the `misanchor` paragraphs, the one artifact whose whole purpose is being read
 * afterwards). Three separate patches to one filename expression, and the fourth knob arrived with
 * nobody noticing the pattern — so the rule is stated here instead: **a knob that changes what was
 * measured changes the filename, and this function is where that is decided.**
 *
 * `misanchor` at the setting in force keeps the bare name so existing references stay valid.
 */
export function resultBasename({ stamp, mutation, rejudge = false, candidate = null } = {}) {
  const parts = [`${stamp}-second-opinion`];
  if (mutation && mutation !== 'misanchor') parts.push(mutation);
  const slug = candidateSlug(candidate);
  if (slug) parts.push(slug);
  if (rejudge) parts.push('rejudge');
  return `${parts.join('.')}.json`;
}

/**
 * A candidate setting as one filename-safe token, or null when there is no candidate.
 *
 * A MODEL NAME IS NOT A FILENAME. Vendors ship spaces, dots, parentheses and slashes in model
 * labels — the pinned agy judge is literally `Gemini 3.1 Pro (High)` — and a path separator
 * arriving here would write outside the results directory. Everything outside [A-Za-z0-9] collapses
 * to a hyphen, which can collide in principle (two labels differing only in punctuation) and does
 * not matter: the file's own `candidate` field carries the exact setting, and this is a name.
 */
export function candidateSlug(candidate) {
  const clean = (v) => (typeof v === 'string' && v.trim()
    ? v.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
    : '');
  const model = clean(candidate?.model);
  const effort = clean(candidate?.effort);
  if (!model && !effort) return null;
  // `effort-low` rather than a bare `low`, so a file measured at the current model with a lower
  // effort cannot be misread as one measured on a model of that name.
  return [model, effort && `effort-${effort}`].filter(Boolean).join('.');
}


// ======================================================= two bench shapes, one admission rule
//
// `bench-lenses` and `bench-second-opinion` write DIFFERENT artifacts, and the gate was written
// against one of them. Handed a lens result it read no seeds at all and reported
// `ADMITTED — every one of the 0 seed(s) ... is still caught`: a vacuous pass, the same shape as the
// `'caught'` vocabulary bug and arriving through a different door. Caught before a $22 lens sweep
// rather than after, which is the only reason it did not become a number someone quoted.
//
// AC7's rule does not care which harness produced the file — no seed the current setting catches
// may regress, and the false-positive count may not rise materially. So the fix is one normaliser
// and a REFUSAL for anything neither shape explains.

/**
 * Normalise a bench result to the few facts the admission gate needs, or say it cannot.
 *
 * `kind` is reported so a caller can say what it read. `fp_label` differs by shape and is carried
 * rather than flattened: second-opinion's false alarms are CONTROL reports that fired where there
 * was nothing to find, while a lens's `fp_candidates` are findings that did not match the seed —
 * which `lib/bench-scoring.mjs` deliberately refuses to turn into a precision rate, because on a
 * tree with one seeded defect an unmatched finding may be a real defect. Same role in I-7's rule,
 * different quantities, so the gate names which one it counted.
 */
export function readBenchResult(json) {
  if (!json || typeof json !== 'object') {
    return { ok: false, why: 'not a JSON object' };
  }

  // second-opinion: seeds[] carrying a judged state per seed.
  if (Array.isArray(json.seeds) && json.seeds.length) {
    return {
      ok: true,
      kind: 'second-opinion',
      caught: caughtSeeds(json),
      missed: missedSeeds(json),
      ran: new Set(json.seeds.map((s) => s?.seed).filter(Boolean)),
      fp: falseAlarms(json),
      fp_label: 'false alarms on the clean control',
      tokens: totalTokens(json),
      duration: totalDuration(json),
      setting: json.candidate ?? json.seeds?.[0]?.setting?.in_force ?? null,
      mutation: json.mutation ?? null,
    };
  }

  // bench-lenses: scores[] carrying a boolean per seed, and the SETTING on each node rather than in
  // config — `config.declared_effort` records the contract as it was read, which on the two
  // archived sweeps was the PREVIOUS setting both times (the xhigh run says `high`, the medium run
  // says `xhigh`). Reading it would attribute every number to the wrong setting.
  if (Array.isArray(json.scores) && json.scores.length) {
    const caught = new Set();
    const missed = new Set();
    const ran = new Set();
    let fp = 0;
    for (const s of json.scores) {
      if (!s?.seed) continue;
      ran.add(s.seed);
      (s.caught === true ? caught : missed).add(s.seed);
      for (const n of Object.values(s.fp_candidates ?? {})) if (Number.isFinite(n)) fp += n;
    }
    return {
      ok: true,
      kind: 'lenses',
      caught,
      missed,
      ran,
      fp,
      fp_label: 'false-positive candidates across the lenses',
      tokens: lensTokens(json),
      duration: lensDuration(json),
      setting: lensSetting(json),
      mutation: null,
    };
  }

  return {
    ok: false,
    why: 'no `seeds[]` (bench-second-opinion) and no `scores[]` (bench-lenses) — this file is '
      + 'neither shape the gate can read. It will not compare nothing and call it admitted.',
  };
}

/**
 * A bench-lenses sweep's token totals across its rows' per-node usage, every token counted once.
 *
 * THINKING IS NESTED, AS THE VENDOR NESTS IT (G-4 of 20261114-174045-m2-pred1-review): thinking tokens
 * are already inside `output_tokens`, so the total carries them under `output_tokens_details`, where
 * a reader that sums every top-level `*_tokens` key (`lensTokens` below) does not add them a second
 * time. A top-level `thinking_tokens` beside `output_tokens` counted them twice in every sweep.
 * A usage record with no thinking field adds zero.
 */
export function sumLensUsage(rows) {
  const t = {
    input_tokens: 0, output_tokens: 0,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
    output_tokens_details: { thinking_tokens: 0 },
  };
  // EVERY BUCKET, NOT FOUR (G-7 of 20261114-184441-m2-pred1-remediation-b-review): the keys usageTokensOnce counts are
  // kept under their own names, so agy's cache_read_tokens is totalled rather than dropped, and its top-level thinking
  // is nested with the vendor's, where no reader adds it again.
  for (const r of rows ?? []) {
    for (const u of Object.values(r?.usage ?? {})) {
      if (!u || typeof u !== 'object') continue;
      for (const [k, v] of countedTokenEntries(u)) t[k] = (t[k] ?? 0) + v;
      const thinking = Number.isFinite(u.output_tokens_details?.thinking_tokens) ? u.output_tokens_details.thinking_tokens : u.thinking_tokens;
      if (Number.isFinite(thinking)) t.output_tokens_details.thinking_tokens += thinking;
    }
  }
  return t;
}

/**
 * Summed tokens from a lens result's per-run usage.
 *
 * A top-level `thinking_tokens` is not added: a `total_usage` written before `sumLensUsage` carried
 * thinking there, beside the `output_tokens` that already includes it (G-4 of
 * 20261114-174045-m2-pred1-review). Nested details are never summed; only top-level numbers are.
 */
function lensTokens(json) {
  let sum = null;
  const add = (u) => {
    const n = usageTokensOnce(u);
    if (n !== null) sum = (sum ?? 0) + n;
  };
  if (json.total_usage && typeof json.total_usage === 'object') add(json.total_usage);
  else for (const r of json.runs ?? []) add(r?.usage);
  return sum;
}

/**
 * Summed wall-clock from a lens result's per-run durations.
 *
 * `runs[].duration_ms` is a MAP of node -> ms here, and a scalar in a second-opinion result. Same
 * key, opposite shape, and the first draft of this function read it as a scalar — so every lens
 * comparison answered `undecidable` on dominance. Caught because the total disagreed with the
 * figure RESULTS.md already published for these two sweeps (100.7 and 48.6 minutes), which is the
 * cross-check worth having: a reader that cannot reproduce a number someone already wrote down is
 * wrong about the shape.
 *
 * SUMMED NODE TIME, not wall-clock of the sweep. The nodes run concurrently, so this is the cost
 * paid in node-minutes rather than the time a person waited — the same quantity on both sides of a
 * comparison, which is what the dominance rule needs.
 */
function lensDuration(json) {
  let sum = null;
  for (const r of json.runs ?? []) {
    const d = r?.duration_ms;
    if (Number.isFinite(d)) sum = (sum ?? 0) + d;
    else if (d && typeof d === 'object') {
      for (const v of Object.values(d)) if (Number.isFinite(v)) sum = (sum ?? 0) + v;
    }
  }
  return sum;
}

/**
 * The model and effort a lens sweep ACTUALLY ran at, from the per-node records.
 *
 * bench-lenses applies `--effort` by rewriting the seeded worktree's contract, and its own source
 * says so: "The result records the effort every node ACTUALLY ran at. Read that, never this flag."
 * `config.declared_effort` is the repository's contract read at a different moment and is not it.
 * A node with no effort (the mechanical tier) contributes nothing rather than a null.
 */
function lensSetting(json) {
  const models = new Set();
  const efforts = new Set();
  for (const r of json.runs ?? []) {
    for (const n of Object.values(r?.nodes ?? {})) {
      if (typeof n?.model === 'string' && n.model) models.add(n.model);
      if (typeof n?.effort === 'string' && n.effort) efforts.add(n.effort);
    }
  }
  // MIXED IS REPORTED, NOT AVERAGED. Two efforts across one sweep means the file does not describe
  // a single setting, and a gate that picked one would be inventing the thing it is ruling on.
  const one = (s) => (s.size === 1 ? [...s][0] : s.size === 0 ? null : `mixed(${[...s].sort().join('|')})`);
  return { model: one(models), effort: one(efforts) };
}


/**
 * Is the difference between these two results the SETTING, or something else?
 *
 * The gate checked that both files were readable and measured the same mutation, and then compared
 * them. It did not check that they reviewed the same TREE with the same REPORTERS, and that cost a
 * real pass: a lens sweep at `low` was compared against the archived `medium` baseline where
 *
 *   - `corpus_commit` differed — 07db3f6b against 8c23dbd6 — because bench-lenses seeds whatever
 *     HEAD is when it runs, so two sweeps on different days review DIFFERENT CODE. Nothing said so.
 *   - the reporter set differed — 11 nodes against 14, the newer one carrying three codex panel
 *     arms. That is the damaging one: a seed the lens MISSED and an arm CAUGHT still scores as
 *     caught, so the arms mask exactly the regression the gate exists to find. Tokens, wall-clock
 *     and false-positive candidates are all inflated by the extra nodes too.
 *
 * Either of those makes "the candidate lost a seed" unattributable, which is the whole product.
 * `bench-lenses`'s own `--score-only` already refuses to recompute an anchor against today's
 * checkout, calling it "the cross-tree comparison this rework exists to make impossible" — this is
 * the same rule one level up, where nothing was enforcing it.
 *
 * Returns a list of reasons, empty when the two are comparable.
 */
export function comparabilityErrors({ current, candidate } = {}) {
  const out = [];
  const pick = (j, k) => j?.config?.[k] ?? j?.[k] ?? null;

  // THE TREE UNDER REVIEW. Lens sweeps record it as config.corpus_commit; a second-opinion pass
  // pins it per seed as head_commit, and those are checked by the mutation guard already.
  const treeA = pick(current, 'corpus_commit');
  const treeB = pick(candidate, 'corpus_commit');
  if (treeA && treeB && treeA !== treeB) {
    out.push(`different corpus_commit (${String(treeA).slice(0, 8)} vs ${String(treeB).slice(0, 8)}): `
      + 'the two sweeps seeded different trees, so a lost seed may be a changed codebase rather '
      + 'than a changed setting');
  }

  // THE REPORTER SET. A union rather than a per-run comparison: concurrency and conditions mean an
  // individual run legitimately spawns a subset, but across a whole sweep the set is the panel.
  const nodesOf = (j) => {
    const s = new Set();
    for (const r of j?.runs ?? []) for (const k of Object.keys(r?.nodes ?? {})) s.add(k);
    return s;
  };
  const a = nodesOf(current);
  const b = nodesOf(candidate);
  if (a.size && b.size) {
    const onlyA = [...a].filter((x) => !b.has(x)).sort();
    const onlyB = [...b].filter((x) => !a.has(x)).sort();
    if (onlyA.length || onlyB.length) {
      out.push('different reporter sets'
        + (onlyB.length ? `; only in the candidate: ${onlyB.join(', ')}` : '')
        + (onlyA.length ? `; only in the baseline: ${onlyA.join(', ')}` : '')
        + '. A seed the lens missed and another reporter caught still scores as caught, so an '
        + 'unmatched panel masks the regression this gate exists to find');
    }
  }

  // IS THE DIFFERENCE ONE COHERENT CHANGE? — not "is each file internally uniform", which is the
  // question this used to ask and the wrong one. It refused any sweep whose per-node records showed
  // more than one setting, and a real comparison tripped it immediately: `second-opinion` carries an
  // adopted `effort: low` override in lens-roster.json, so a medium sweep legitimately reads
  // `mixed(low|medium)` while still differing from a low sweep by exactly one knob. A node held
  // CONSTANT across both sides is a control, not a contaminant.
  //
  // So the per-node settings are lined up instead. Nodes that moved are the knob; nodes identical on
  // both sides are held fixed; and a pair where NOTHING moved is not a comparison at all.
  const settingsByNode = (j) => {
    const m = new Map();
    for (const r of j?.runs ?? []) {
      for (const [id, n] of Object.entries(r?.nodes ?? {})) {
        const v = `${n?.model ?? '-'}/${n?.effort ?? '-'}`;
        if (v !== '-/-') m.set(id, v);
      }
    }
    return m;
  };
  const sa = settingsByNode(current);
  const sb = settingsByNode(candidate);
  if (sa.size && sb.size) {
    const shared = [...sa.keys()].filter((k) => sb.has(k));
    const moved = shared.filter((k) => sa.get(k) !== sb.get(k)).sort();
    if (shared.length && !moved.length) {
      out.push('no node ran at a different setting between these two results — every shared node '
        + 'is identical, so there is no change to attribute a difference to. This is the same '
        + 'sweep twice, not a comparison');
    }
  }

  // THE SAME RULE FOR A SHAPE WITH NO PER-NODE RECORDS (G-4). The check above reads `runs[].nodes`,
  // which a second-opinion result does not have — so passing one baseline as BOTH inputs produced
  // "ADMITTED — unrecorded against unrecorded" at exit 0, behind a warning a reader had to notice.
  // A warning is not a refusal. One shape was guarded and the other was not, by a rule that should
  // never have been shape-specific.
  //
  // Two results that name the same setting cannot attribute a difference to the setting, and two
  // that name NO setting cannot attribute one to anything — the conservative call, because a file
  // that does not say what it ran at is exactly the one whose verdict nobody can trace.
  if (!sa.size && !sb.size) {
    const A = readBenchResult(current);
    const B = readBenchResult(candidate);
    if (A.ok && B.ok) {
      const la = settingLabel(A.setting);
      const lb = settingLabel(B.setting);
      if (la === lb) {
        out.push(`both results are at the same setting (${la}), so there is nothing to attribute a `
          + 'difference to — this is one pass compared with itself, not a comparison'
          + (la === 'unrecorded'
            ? '. Neither file records the setting it ran at, which is the case a warning used to '
              + 'cover and a verdict should not'
            : ''));
      }
    }
  }
  return out;
}

/**
 * Sum one spend field across seeds, reporting ABSENCE rather than imputing zero.
 *
 * `perSeed.reduce((a, s) => a + (s.spent?.x ?? 0), 0)` turned every seed the vendor priced at
 * nothing into a seed that cost nothing, and always emitted a number — so a pass where no price
 * came back is indistinguishable from a free one (G-7, panel-codex-contract). I-6 says absence is
 * RECORDED, not imputed, and `splitSpend` already follows that rule by keeping an absent cost as
 * `null` rather than `0`.
 *
 * `total` is null when NOTHING was priced, because "$0.00" and "the vendor returned nothing" are
 * different claims. When some seeds priced and others did not, the total is what was actually
 * reported and `absent` says how many are missing from it — a partial total labelled as partial,
 * rather than one silently short.
 */
export function sumSpend(perSeed, key) {
  const seeds = (perSeed ?? []).length;
  let total = null;
  let absent = 0;
  for (const s of perSeed ?? []) {
    const v = s?.spent?.[key];
    if (Number.isFinite(v)) total = (total ?? 0) + v;
    else absent += 1;
  }
  return { total: total === null ? null : Number(total.toFixed(4)), absent, seeds };
}
