// second-opinion-scoring.mjs — did the adversarial audit catch the error that was put there?
//
// `second-opinion` is the graph's one PROSE node (`schema_variant: none`), which is why nothing in
// this framework has ever read it: there is no validated artifact to join on, and the rule every
// other scorer here follows is that a report with no artifact behind it must not be trusted. It is
// also the bench's largest line item — $14.80 over seven seeds, 38% of the Anthropic cost — scored
// by nothing (.claude/findings/2026-09-20-second-opinion-reaches-nobody.md).
//
// So the join is supplied rather than found: a cross-family JUDGE reads the report and rules on
// one narrow question with a known answer — was the injected reconciliation error identified? —
// and the ruling is only believed if it QUOTES the report verbatim. That is the whole design:
//
//   * the question is narrow and its ground truth is known by construction, because this harness
//     wrote the error into the reconciliation itself (lib/reconcile-mutations.mjs);
//   * the citation is checked mechanically against the report (lib/verbatim.mjs), so a judge that
//     says "caught" and cannot point at where is recorded as UNVERIFIED, never as a catch;
//   * and the same judge is run against the CONTROL report — the one the unmutated run produced,
//     where nothing was injected — so the instrument's own false-alarm rate is measured beside the
//     result instead of assumed to be zero.
//
// A model grading a model is still a model grading a model. The quote requirement and the negative
// control bound how wrong it can be silently; they do not make it a mechanical measurement, and
// any result read off this module has to say so.

import { quotePresent } from './verbatim.mjs';

/**
 * Read a Claude CLI result envelope, and refuse an error dressed as an answer.
 *
 * TWO DEFECTS LIVE HERE AND BOTH COST A LIVE RUN (2026-09-22), which is why this is a function
 * rather than four lines inside the forge:
 *
 *   1. THE ANSWER IS ON STDOUT ALONE. `shAsync` returns `out` (stdout and stderr merged, for logs)
 *      and `stdout` (the child's actual answer) — and its own source records that conflation as a
 *      past defect. The forge and the judge both parsed `out`, so ONE warning line on stderr —
 *      there was one, about connectors — turned every good envelope into "no parseable envelope"
 *      and every seed into NOT RUN. This function takes the stdout text, so a caller that hands it
 *      the merged buffer is making a visible mistake rather than an invisible one.
 *   2. AN ERROR CARRIES ITS MESSAGE IN `result`, THE SAME FIELD AS AN ANSWER, and sets
 *      `subtype: "success"` beside `is_error: true`. A failed call returned
 *      `{"is_error":true,"api_error_status":400,"result":"Credit balance is too low"}` — a
 *      non-empty string the forge would have spliced into `reconciled.md` as the rewritten
 *      rationale. It was caught downstream by the tell check only because that text happens to
 *      cite no line number; an error message containing the injected line would have passed.
 *      `is_error` is the field to read, never `subtype`.
 */
export function readCliEnvelope(stdoutText) {
  let envelope;
  try {
    envelope = JSON.parse(String(stdoutText ?? ''));
  } catch {
    return { ok: false, why: 'no parseable JSON envelope on stdout' };
  }
  if (envelope?.is_error) {
    return {
      ok: false,
      why: `the call failed (${envelope.api_error_status ?? envelope.terminal_reason ?? 'no status'}): `
        + String(envelope.result ?? '(no message)').slice(0, 200),
    };
  }
  const text = typeof envelope?.result === 'string' ? envelope.result.trim() : '';
  if (!text) return { ok: false, why: 'the envelope carries no result text' };
  return { ok: true, text, cost_usd: envelope.total_cost_usd ?? null };
}

/** The two positions the judge votes between, plus the abstention `neither` the vocabulary adds. */
export const IDENTIFIED = 'identified';
export const NOT_IDENTIFIED = 'not-identified';
export const JUDGE_PARTICIPANTS = [IDENTIFIED, NOT_IDENTIFIED];

/**
 * The judge's citation, pulled out of its free-text rationale.
 *
 * A DEDICATED MARKER rather than the whole rationale, because the rationale legitimately contains
 * the judge's own prose, and searching all of it for something that happens to appear in the
 * report would verify nothing — the injected-error statement itself is quoted into the brief, so
 * any judge echoing the question would "cite" successfully. The prompt asks for `QUOTE:` on its
 * own line; everything after it on that line is the citation.
 */
export function extractQuote(rationale) {
  const m = /^\s*QUOTE:\s*(.+?)\s*$/m.exec(String(rationale ?? ''));
  if (!m) return null;
  // Surrounding quotation marks are the judge being tidy, not part of the cited span.
  return m[1].replace(/^["“”']+/, '').replace(/["“”']+$/, '').trim() || null;
}

/**
 * Score one judged report.
 *
 * States, and why each is separate — the same discipline scoreReconcile applies, where a node that
 * never ran is not a node that dropped something:
 *
 *   identified     the judge voted `identified` AND its citation is verbatim in the report
 *   not-identified the judge voted `not-identified` — the audit missed the injected error
 *   neither        the judge says the report does not settle it; an abstention, not a miss
 *   unverified     voted `identified` with no citation, or one that is not in the report. The
 *                  vote is DISCARDED rather than counted either way: an uncheckable claim is
 *                  exactly what this framework refuses everywhere else, and counting it as a miss
 *                  would punish the audited node for the judge's failure.
 *   no-vote        the judge returned nothing legible (absent CLI, refusal, timeout). Silence is
 *                  not a verdict, here as at the gate.
 */
export function scoreJudgedReport({ vote, rationale = '', report = '' }) {
  const v = typeof vote === 'string' ? vote.trim() : '';
  if (!v) return { state: 'no-vote', quote: null, why: 'the judge returned no legible vote' };
  if (v === 'neither') {
    return { state: 'neither', quote: null, why: 'the judge ruled the report does not settle it' };
  }
  if (v === NOT_IDENTIFIED) {
    return { state: NOT_IDENTIFIED, quote: null, why: 'the judge found no passage identifying the injected error' };
  }
  if (v !== IDENTIFIED) {
    return { state: 'no-vote', quote: null, why: `vote '${v}' is not one of ${[...JUDGE_PARTICIPANTS, 'neither'].join(', ')}` };
  }
  const quote = extractQuote(rationale);
  if (!quote) {
    return {
      state: 'unverified', quote: null,
      why: 'voted identified and supplied no `QUOTE:` line, so nothing can be checked against the report',
    };
  }
  const { ok, missing } = quotePresent({ haystack: report, quote });
  if (!ok) {
    return {
      state: 'unverified', quote,
      why: `the citation is not in the report — first fragment not found: "${String(missing ?? '').slice(0, 110)}"`,
    };
  }
  return { state: IDENTIFIED, quote, why: 'cited verbatim from the report' };
}

/**
 * Aggregate, with the negative control beside the result rather than folded into it.
 *
 * `rows` are `{ seed, mutated: <state>, control: <state> }`. The two are deliberately NOT combined
 * into one per-seed verdict: a control that scores `identified` means the judge found the injected
 * error in a report written before anything was injected, which is a fact about the INSTRUMENT.
 * Netting it off against the mutated result would hide the one number that says whether the
 * instrument works.
 */
export function summariseSecondOpinion(rows = []) {
  const tally = (key) => rows.reduce((acc, r) => {
    const s = r?.[key] ?? 'no-vote';
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const mutated = tally('mutated');
  const control = tally('control');
  const scoreable = rows.filter((r) => r?.mutated === IDENTIFIED || r?.mutated === NOT_IDENTIFIED);
  const caught = scoreable.filter((r) => r.mutated === IDENTIFIED).length;
  return {
    seeds: rows.length,
    // Over the SCOREABLE seeds only, and the denominator travels with it. An unverified or absent
    // ruling is not evidence that the audit missed anything, so folding it into the denominator
    // would report the judge's failures as the audited node's.
    scoreable: scoreable.length,
    caught,
    recall: scoreable.length ? Number((caught / scoreable.length).toFixed(3)) : null,
    mutated,
    control,
    // The instrument's own error, stated as a count and never subtracted from anything above.
    false_alarms: control[IDENTIFIED] ?? 0,
    // A SECOND DENOMINATOR, ADDED RATHER THAN SUBSTITUTED (measured 2026-09-22).
    //
    // `status-never-a-pass` scored `control: identified` on BOTH runs of it, with a verbatim-
    // verified citation each time and a different citation each time. The second was
    // "The G-3 -> G-5 root-cause direction is right, and I checked it the hard way ... line 1135
    // given a valid `ok` payload is correct code needing no edit" — a real sentence from the report
    // which says the OPPOSITE of the vote it was offered to support.
    //
    // So the cause is not only a contaminated seed: the judge over-votes `identified` on the
    // control, and `quotePresent` cannot see it, because the verbatim rule checks that a citation
    // EXISTS and not that it SUPPORTS the vote. That is weaker than the design claimed, and the
    // control is what revealed it — which is the control doing exactly its job.
    //
    // Either way the exclusion is right: whether the seed is contaminated or the judge is wrong
    // about it, a seed whose control fired is not clean evidence about the audited node.
    //
    // Netting false alarms off `recall` stays forbidden — that hides the one number saying whether
    // the instrument works, which is the whole reason the control exists. This is the different
    // question: over the seeds whose control was SILENT, how often was the injected error caught?
    // Both are published, both carry their denominators, and a reader can see how many seeds the
    // corpus actually had anything to say about.
    //
    // CLEAN MEANS THE CONTROL SAID `not-identified` (G-13 of 20261114-174045-m2-pred1-review): the filter
    // was `control !== identified`, which admitted an unverified, unscored, no-vote or missing control as
    // clean. Silence is not a verdict, so such a seed is excluded and counted as `control_unverified`.
    clean_control: (() => {
      const clean = scoreable.filter((r) => r?.control === NOT_IDENTIFIED);
      const hits = clean.filter((r) => r.mutated === IDENTIFIED).length;
      const unverified = scoreable.filter((r) => r?.control !== IDENTIFIED && r?.control !== NOT_IDENTIFIED).length;
      return {
        seeds: clean.length,
        caught: hits,
        recall: clean.length ? Number((hits / clean.length).toFixed(3)) : null,
        excluded: scoreable.length - clean.length,
        control_unverified: unverified,
      };
    })(),
  };
}
