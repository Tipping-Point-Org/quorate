// Whether a reviewer's or the runtime's failure text is a usage limit, and when it says the limit resets
// (autonomous-run.plan.md stage 7 part 2; operator, 2026-10-31: "3 a"). A quota error read as any other failure leaves
// the record and the metric unable to tell the two apart, so the text is classified once, here, against the patterns
// each adapter declares in scripts/reviewers.json (`quota_patterns`). No vendor's wording is written in this file
// (ARCHITECTURE.md A-9): the patterns are the adapter's, and they are UNVERIFIED until a real quota error is seen.
//
// Pure: no I/O (ARCHITECTURE §2).
import { redactClaim } from './redact.mjs';

// The phrasings a reset time follows: "resets 3:45pm", "limit resets at 4:10 PM", "try again at 4:10 PM",
// "try again in 2 hours". The captured text is reported as written, never parsed into a time: the formats are unknown.
const RESET = /\b(?:resets?|try again)\s+(?:at|in)?\s*([^.·\n;,)]+?)\s*(?:[.·\n;,)]|$)/i;

/**
 * The reset text a failure message names, as written, or null; redacted here, where it is cut from a CLI's raw output
 * (G-3 of 20261105-021654-ar-d1-c-remediation-2-review: external-review wrote it into the panel JSON as it came), so no
 * caller can carry a secret of a known shape that followed "try again" into an artifact.
 */
export function resetTextOf(text) {
  const m = RESET.exec(String(text ?? ''));
  const t = m?.[1]?.trim();
  return t ? redactClaim(t) : null;
}

/**
 * `{quota: true, reset_text}` when the text matches one of the declared patterns (case-insensitive regex sources), else
 * null. No patterns, or a text matching none, is null: nothing is recognised that the adapter does not declare. A pattern
 * that does not compile is skipped, never thrown: a bad declaration costs that pattern, not the caller's failure path.
 */
export function quotaOf(text, patterns) {
  const s = String(text ?? '');
  if (!s || !Array.isArray(patterns)) return null;
  for (const p of patterns) {
    let re;
    try { re = new RegExp(String(p), 'i'); } catch { continue; }
    if (re.test(s)) return { quota: true, reset_text: resetTextOf(s) };
  }
  return null;
}
