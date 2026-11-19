// redact.mjs — the ONE owner of redaction for text that reaches a tracked file (ledger-trust-boundaries, 1b).
//
// Review text reaches git in two places: the findings ledger, and every committed run's reconciled.md, reports,
// finding-groups.json and gate files. Both quote what lenses and vendors wrote, and a finding ABOUT a leaked
// credential tends to quote it. Redaction lived in lib/ledger.mjs and guarded only the first; it was patched
// one path and one shape at a time (G-12 of ltr-review-r3, G-7 and G-13 of r4, G-11 of r5), and each review
// found the next. One owner, applied at every tracked write, ends the per-path half of that.
//
// BEST-EFFORT, and said so (ARCHITECTURE A-10). This is a pattern guard for common credential shapes, not a
// scanner: a shape it does not know passes. The stronger check is the push-time secret scan with the shipped
// rules generated from the same definition (.claude/hooks/gitleaks.toml), and A-10 names where even that does not
// hold.
//
// ONE DEFINITION (secret-shapes-and-refusals, 1a): the credential words were written five times across this file and
// the push rules, and r4's G-2 was the two drifting apart. The shapes, and the CASES table that is their scope, live
// in secret-shapes.mjs; the push rules are generated from the same file.
import { redactionPatterns } from './secret-shapes.mjs';

const SECRET_SHAPES = redactionPatterns();

export function redactClaim(text) {
  let out = String(text ?? '');
  for (const [re, label, keepName] of SECRET_SHAPES) {
    out = out.replace(re, (...m) => (keepName ? `${m[1]}[redacted: ${label}]` : `[redacted: ${label}]`));
  }
  return out;
}

/** A copy of `value` with every string leaf redacted — for a structure bound for a tracked JSON file. */
export function redactTree(value) {
  if (typeof value === 'string') return redactClaim(value);
  if (Array.isArray(value)) return value.map(redactTree);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactTree(v)]));
  return value;
}
