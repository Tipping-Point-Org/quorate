// reviewed-run.mjs — what counts as a reviewed quorate run, decided in one place for every reader.
//
// ONE OWNER (usage-report-reviewed-runs.plan.md stage 1; G-2 and G-3 of 20261030-221015-usage-report-99-review): the
// rule lived as `runs.filter((r) => r.verdict)` in usage-report, then here, and again in findings-ledger as
// `gate?.gate !== 'BLOCKED'`, and the two read a malformed gate differently. usage-report and findings-ledger both ask
// this module; the ledger keeps its own lens filter on top, which answers a different question (which lenses may confirm
// a claim by their silence). Pure: the records arrive as the caller read them; nothing here touches the disk.
//
// Three answers, because they are three different claims:
//   reachedGate   the run wrote a verdict at all, BLOCKED included: it is counted as having reached a gate.
//   reviewed      the gate says the review happened: its verdict is one a review can reach (VERDICTS). BLOCKED means a
//                 required lens did not report, and silence is not a verdict; an unknown or missing verdict vouches for
//                 nothing.
//   creditsHead   the reviewed run looked at its head commit itself: only a run recorded clean (`dirty: false`). A dirty
//                 run reviewed working-tree content that no commit holds; an unrecorded flag vouches for nothing.
import { VERDICTS } from './decisions.mjs';
import { parseGlob, matchesGlob } from './contract-glob.mjs';

export function reachedGate(run) {
  return Boolean(run?.verdict);
}

export function reviewed(run) {
  return VERDICTS.includes(run?.verdict);
}

export function creditsHead(run) {
  return reviewed(run) && run.dirty === false && Boolean(run.head);
}

// The reviewed runs that cannot prove a clean review, by why (usage-report-reviewed-runs.plan.md stage 2): recorded
// dirty, or recording no dirty flag. While either is above zero, a figure built from creditsHead is unverified.
export function unproven(runs) {
  const covering = runs.filter(reviewed);
  return {
    dirty: covering.filter((r) => r.dirty === true).length,
    unknown: covering.filter((r) => r.dirty !== true && r.dirty !== false).length,
  };
}

// Does repo-relative `file` sit under one of the scopes some reviewed run declared? A scope is a path or a contract glob
// (G-9 of 20261031-013928-urr-delivery: compared as literal prefixes, a `.` or glob sweep credited nothing). `.` is the
// whole repository; a scope outside the glob grammar is compared as a literal path, as before.
export function inScope(scopes, file) {
  return scopeMatcher(scopes)(file);
}

// The same rule with the scopes normalised and classified ONCE (G-11 of 20261031-022756-urr-remediation-review): a caller
// asking about many files built every scope's test again for each one.
export function scopeMatcher(scopes) {
  const tests = (scopes ?? []).map((s) => {
    const p = String(s ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    if (p === '' || p === '.') return () => true;
    return parseGlob(p).ok ? (file) => matchesGlob(p, file) : (file) => file === p || file.startsWith(`${p}/`);
  });
  return (file) => tests.some((t) => t(file));
}

// The commits reviewed at their own state, and the paths some reviewed run declared.
export function coverage(runs) {
  const covering = runs.filter(reviewed);
  return {
    reviewedShas: new Set(covering.filter(creditsHead).map((r) => r.head)),
    scopePrefixes: [...new Set(covering.flatMap((r) => r.scope ?? []))],
  };
}
