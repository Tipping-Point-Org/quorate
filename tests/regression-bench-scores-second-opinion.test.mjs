// THE BENCH'S LARGEST LINE ITEM IS SCORED BY NOTHING.
//
// `second-opinion` costs $14.80 over seven seeds — 38% of the Anthropic total — and is the graph's
// one PROSE node (`schema_variant: none`), so there is no validated artifact to join on and every
// scorer here refuses to parse a report with nothing behind it. AC 14 of
// model-and-effort-reevaluation.md says what that needs: a corpus of seeded RECONCILIATION errors
// rather than seeded code defects, because its job is catching the reconciler's mistakes.
//
// Three modules make that measurable, and these tests pin the parts that decide a number:
//
//   reconcile-mutations.mjs      injects ONE known error into a finished reconciliation
//   verbatim.mjs                 checks the judge actually quoted the report it is ruling on
//   second-opinion-scoring.mjs   turns a ruling into a state, and refuses to turn a bad one
//
// The expensive part of this benchmark is the model run. The part that must never be quietly wrong
// is the scoring, and it costs nothing to test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupHeaders, groupSection, alternateAnchor, applyMisanchor, mutationSurvived,
  splitGroupSection, rewriteCarriesTell, applyRewrittenRationale, citedLines,
  MUTATIONS, INJECTION_RULES,
  deflatedSeverity, applyDeflate, dropWouldDangle, applyDrop,
  forgeSlots, tellForMutation, injectionSurvived,
} from '../scripts/lib/reconcile-mutations.mjs';
import { flat, quotePresent } from '../scripts/lib/verbatim.mjs';
import { splitSpend } from '../scripts/io/run-artifacts.mjs';
import {
  extractQuote, scoreJudgedReport, summariseSecondOpinion, readCliEnvelope, IDENTIFIED, NOT_IDENTIFIED,
} from '../scripts/lib/second-opinion-scoring.mjs';

// A reconciled.md exactly as run-graph.mjs:3070-3095 renders one: `### <id> · <SEV> · `file:line``,
// then `Raised by:`, an optional root-cause pointer, the rationale, then the findings.
const RECONCILED = [
  '# Reconciled',
  '',
  'One defect dominates this run.',
  '',
  '## Confirmed (2)',
  '',
  '### G-3 · BLOCKER · `scripts/external-review.mjs:1014`',
  '',
  'Raised by: `contract-audit`, `panel-codex-contract`',
  '',
  'Root cause, and the only cross-arm agreement in the run.',
  '',
  '### G-6 · MEDIUM · `shared/unverified-claims.md:130`',
  '',
  'Raised by: `contract-audit`',
  '',
  'Verified both texts.',
  '',
  '## Symptom (1)',
  '',
  '### G-5 · BLOCKER · `scripts/external-review.mjs:1135`',
  '',
  'Raised by: `contract-audit`',
  '',
  'Root cause: `G-3`',
  '',
  'Verified: line 1135 is correct code given a valid payload.',
  '',
].join('\n');

const FINDING_GROUPS = {
  run_id: 'test',
  groups: [
    { group_id: 'G-3', file: 'scripts/external-review.mjs', line: 1014, proximate_nodes: ['contract-audit'] },
    { group_id: 'G-5', file: 'scripts/external-review.mjs', line: 1135, proximate_nodes: ['contract-audit'] },
    { group_id: 'G-6', file: 'shared/unverified-claims.md', line: 130, proximate_nodes: ['contract-audit'] },
  ],
};

// ------------------------------------------------------------------ reading the rendered report

test('every group header is parsed out of a rendered reconciled.md', () => {
  const h = groupHeaders(RECONCILED);
  assert.equal(h.length, 3);
  assert.deepEqual(h.map((x) => x.group_id), ['G-3', 'G-6', 'G-5']);
  assert.equal(h[0].file, 'scripts/external-review.mjs');
  assert.equal(h[0].line, 1014);
  assert.equal(h[0].severity, 'BLOCKER');
});

test('a file path containing a colon still splits on the LAST one', () => {
  // The anchor is `file:line`, and a Windows-style or namespaced path carries its own colons. A
  // split on the FIRST colon would put half a path in `file` and a non-number in `line`, and the
  // mutation would then be injected into a group nothing could locate.
  const h = groupHeaders('### G-1 · HIGH · `C:/tmp/a.mjs:42`');
  assert.equal(h[0].file, 'C:/tmp/a.mjs');
  assert.equal(h[0].line, 42);
});

test('a group section stops at the next heading, not at the end of the file', () => {
  // The judge is shown one group, not the run. A section that ran on to the end of the file would
  // hand it every other group's rationale and turn a narrow question into a re-review.
  const s = groupSection(RECONCILED, 'G-3');
  assert.match(s, /^### G-3 · BLOCKER/);
  assert.match(s, /only cross-arm agreement/);
  assert.doesNotMatch(s, /G-6/, 'it must stop before the next group');
  assert.doesNotMatch(s, /## Symptom/, 'and before the next bucket heading');
});

test('the LAST group in the file still terminates', () => {
  // An off-by-one here reads as an empty excerpt, and the judge would rule on nothing while the
  // harness recorded a vote.
  const s = groupSection(RECONCILED, 'G-5');
  assert.match(s, /^### G-5 · BLOCKER/);
  assert.match(s, /Root cause: `G-3`/);
  assert.equal(groupSection(RECONCILED, 'G-404'), null);
});

// ------------------------------------------------------------------------ choosing the anchor

test('the alternate anchor is borrowed from a group the reconciliation already discusses', () => {
  // NOT an arbitrary line. Nothing in the prose may contradict the new anchor, so the destination
  // is another group's anchor in the same file — on the real corpus, the symptom the root cause was
  // correctly separated from, with both lines named in the surrounding paragraphs.
  const r = alternateAnchor({ headers: groupHeaders(RECONCILED), targetId: 'G-3', tolerance: 15 });
  assert.equal(r.ok, true);
  assert.equal(r.file, 'scripts/external-review.mjs');
  assert.equal(r.line, 1135);
  assert.equal(r.borrowed_from, 'G-5');
});

test('a candidate in a DIFFERENT file is never borrowed', () => {
  // G-6 is 130 in another file. Re-anchoring across files would be a mutation the prose contradicts
  // on its face, which measures tamper-detection rather than the reconciliation error.
  const r = alternateAnchor({ headers: groupHeaders(RECONCILED), targetId: 'G-6', tolerance: 15 });
  assert.equal(r.ok, false);
  assert.match(r.why, /no other group in shared\/unverified-claims\.md/);
});

test('an anchor INSIDE tolerance is refused, because it is not a wrong anchor', () => {
  // THE RULE THAT KEEPS THIS HONEST. scoreSeed accepts any finding within `tolerance` of the seed,
  // because a real reviewer cites the call site, the guard, or the consequence. An anchor a
  // reviewer could defensibly have cited is therefore not an error, and injecting one would
  // manufacture the result — the harness would be scoring the auditor for failing to object to
  // something correct.
  const near = [
    { group_id: 'G-1', file: 'a.mjs', line: 100 },
    { group_id: 'G-2', file: 'a.mjs', line: 108 },
  ];
  const r = alternateAnchor({ headers: near, targetId: 'G-1', tolerance: 15 });
  assert.equal(r.ok, false);
  assert.match(r.why, /every alternative anchor is one a reviewer could defensibly have cited/);
});

test('the farthest admissible candidate wins', () => {
  const spread = [
    { group_id: 'G-1', file: 'a.mjs', line: 100 },
    { group_id: 'G-2', file: 'a.mjs', line: 130 },
    { group_id: 'G-3', file: 'a.mjs', line: 400 },
  ];
  assert.equal(alternateAnchor({ headers: spread, targetId: 'G-1' }).borrowed_from, 'G-3');
});

// ----------------------------------------------------------------------------- the injection

test('misanchor moves the anchor in BOTH artifacts, and in neither more than once', () => {
  // BOTH, because they must agree. reconciled.md is what second-opinion audits and what remediate
  // works from; finding-groups.json is the grouping the header was rendered from. Moving only the
  // report leaves two artifacts contradicting each other, and an auditor that spots THAT has found
  // a rendering bug rather than a misjudged anchor. With both moved, the only thing disagreeing
  // with the anchor is the source — which is the version of this defect that actually shipped.
  const out = applyMisanchor({
    reconciledMd: RECONCILED, findingGroups: FINDING_GROUPS, targetId: 'G-3',
    to: { file: 'scripts/external-review.mjs', line: 1135 },
  });
  assert.match(out.reconciled_md, /### G-3 · BLOCKER · `scripts\/external-review\.mjs:1135`/);
  assert.doesNotMatch(out.reconciled_md, /:1014/);
  const g3 = out.finding_groups.groups.find((g) => g.group_id === 'G-3');
  assert.equal(g3.line, 1135);
  // G-5 genuinely lives at 1135 and must be untouched: the mutation is one group's anchor, not a
  // global search and replace.
  assert.equal(out.finding_groups.groups.find((g) => g.group_id === 'G-5').line, 1135);
  assert.equal(out.finding_groups.groups.find((g) => g.group_id === 'G-6').line, 130);
});

// ------------------------------------------------- the injection surviving to the spawned node

test('a reconciled.md re-derived by the resume is NOT RUN, never a miss', () => {
  // THE GAP THIS CLOSES. The mutation is injected, then one node is re-spawned by
  // `run-graph --resume`. Reuse of the reconciliation requires that the resume re-ran no lens and
  // no arm; anything that does re-run sends the barrier back through its SPAWN branch, which
  // re-renders reconciled.md from payload.json — and the injected anchor is gone, silently, with
  // no error raised. `second-opinion` would then audit a correct reconciliation, correctly say
  // nothing is wrong with the anchor, and be scored `not-identified`: the harness's failure
  // recorded as the audited node's miss, which is the one thing scoreJudgedReport refuses at the
  // other end and cannot see from here, because by then there is only a report.
  const original = applyMisanchor({
    reconciledMd: RECONCILED, findingGroups: FINDING_GROUPS, targetId: 'G-3',
    to: { file: 'scripts/external-review.mjs', line: 1135 },
  });
  const survived = mutationSurvived({
    reconciledMd: original.reconciled_md, targetId: 'G-3', expectedAnchor: original.ground_truth.to,
  });
  assert.equal(survived.ok, true);

  // The re-render: the ORIGINAL file, which is exactly what payload.json renders back to.
  const rerendered = mutationSurvived({
    reconciledMd: RECONCILED, targetId: 'G-3', expectedAnchor: original.ground_truth.to,
  });
  assert.equal(rerendered.ok, false, 'a re-derived reconciliation must not pass as mutated');
  assert.equal(rerendered.anchor, original.ground_truth.from);
  assert.match(rerendered.why, /1014/, 'the reason names where it actually found the anchor');
});

test('a group that vanished from reconciled.md is distinguished from one that moved', () => {
  // Two different failures. A header that is GONE means the rendering changed shape; a header at
  // the wrong line means the anchor was re-derived. Collapsing them would send a reader looking
  // for the wrong cause, and both arrive through the same `ok: false`.
  const gone = mutationSurvived({
    reconciledMd: RECONCILED, targetId: 'G-99', expectedAnchor: 'scripts/external-review.mjs:1135',
  });
  assert.equal(gone.ok, false);
  assert.equal(gone.anchor, null);
  assert.match(gone.why, /no header/);
});

test('the input artifacts are not mutated in place', () => {
  // The control report is scored against the UNMUTATED reconciliation, so a scorer that corrupted
  // its own input would silently destroy the negative control — the one number that says whether
  // the instrument works at all.
  const before = JSON.stringify(FINDING_GROUPS);
  applyMisanchor({
    reconciledMd: RECONCILED, findingGroups: FINDING_GROUPS, targetId: 'G-3',
    to: { file: 'scripts/external-review.mjs', line: 1135 },
  });
  assert.equal(JSON.stringify(FINDING_GROUPS), before, 'finding-groups.json was mutated in place');
});

test('ground truth names both ends, because the result file is read without the tree', () => {
  const { ground_truth } = applyMisanchor({
    reconciledMd: RECONCILED, findingGroups: FINDING_GROUPS, targetId: 'G-3',
    to: { file: 'scripts/external-review.mjs', line: 1135 },
  });
  assert.equal(ground_truth.mutation, 'misanchor');
  assert.equal(ground_truth.from, 'scripts/external-review.mjs:1014');
  assert.equal(ground_truth.to, 'scripts/external-review.mjs:1135');
  // ONE string for the question asked and the question recorded. Two spellings would let the judge
  // be asked something the result file does not say it was asked.
  assert.match(ground_truth.statement, /1135/);
  assert.match(ground_truth.statement, /1014/);
});

test('a no-op move is refused rather than scored as an injected error', () => {
  // A mutation that changed nothing would produce a run where the "injected error" is not present,
  // and every NOT_IDENTIFIED would be correct. That reads as the auditor failing.
  assert.throws(() => applyMisanchor({
    reconciledMd: RECONCILED, findingGroups: FINDING_GROUPS, targetId: 'G-3',
    to: { file: 'scripts/external-review.mjs', line: 1014 },
  }), /already anchored/);
});

test('a target absent from either artifact is refused', () => {
  assert.throws(() => applyMisanchor({
    reconciledMd: RECONCILED, findingGroups: FINDING_GROUPS, targetId: 'G-99',
    to: { file: 'a.mjs', line: 1 },
  }), /no group header for G-99/);
  assert.throws(() => applyMisanchor({
    reconciledMd: '### G-7 · LOW · `a.mjs:5`', findingGroups: FINDING_GROUPS, targetId: 'G-7',
    to: { file: 'a.mjs', line: 900 },
  }), /not in finding-groups\.json/);
});

test('only the mutations that are actually implemented are offered', () => {
  // This asserted `['misanchor']` while `drop` and `deflate` were designed and REFUSED: each left a
  // tell, because the rationale on disk was written to justify the opposite decision, and listing
  // them would have let a driver report a number measuring tamper-detection.
  //
  // The `rewrite` injection rule removed that objection — the rationale is regenerated to match the
  // new decision — so both are implemented, and each earned its own refusal instead: `deflate` will
  // not move a severity fewer than two rungs, `drop` will not orphan a symptom. The list still
  // means what it meant: a driver may select only what is built and guarded.
  assert.deepEqual(MUTATIONS, ['misanchor', 'deflate', 'drop']);
});

// -------------------------------------------------------------- the judge must have read it

test('a citation present in the report verifies', () => {
  const report = 'The anchor on G-3 points at the symptom, not the writer.';
  assert.equal(quotePresent({ haystack: report, quote: 'points at the symptom' }).ok, true);
});

test('whitespace and case do not decide it, because a copied quote keeps the words', () => {
  const report = 'The   anchor\non G-3\tpoints at the symptom.';
  assert.equal(quotePresent({ haystack: report, quote: 'The ANCHOR on g-3 points' }).ok, true);
  assert.equal(flat('  A   b\nc '), 'a b c');
});

test('an elision may drop the middle, but the fragments must appear IN ORDER', () => {
  // AN ELISION IS NOT A LICENCE. Without the ordering rule two unrelated sentences could be
  // stitched into one quotation nobody wrote — which is precisely the failure check-quotes exists
  // for, now applied to a judge instead of a blog post.
  const report = 'First the anchor is wrong. Later, the severity is right.';
  assert.equal(quotePresent({ haystack: report, quote: 'the anchor is wrong…the severity is right' }).ok, true);
  assert.equal(quotePresent({ haystack: report, quote: 'the severity is right…the anchor is wrong' }).ok, false);
});

test('a quotation too short to locate FAILS rather than passing vacuously', () => {
  // The tightening this module was extracted to make: the inline version fragmented the quote and
  // then never entered the loop, so a two-word citation passed without being checked at all. A
  // judge answering with one word would have been believed.
  assert.equal(quotePresent({ haystack: 'anything at all', quote: 'an' }).ok, false);
  assert.equal(quotePresent({ haystack: 'anything at all', quote: '' }).ok, false);
});

test('the missing fragment is reported, since it is the only useful part of a failure', () => {
  const r = quotePresent({ haystack: 'the anchor is wrong', quote: 'the anchor is wrong…and the severity too' });
  assert.equal(r.ok, false);
  assert.equal(r.missing, 'and the severity too');
});

// ------------------------------------------------------------------------- ruling into a state

test('the citation is taken from a marked line, not from the whole rationale', () => {
  // A DEDICATED MARKER, because the injected-error STATEMENT is quoted into the judge's brief. A
  // scorer that searched the whole rationale for something appearing in the report would verify
  // any judge that echoed the question back.
  assert.equal(extractQuote('I agree.\nQUOTE: the anchor points at the caller\nSo it is caught.'),
    'the anchor points at the caller');
  assert.equal(extractQuote('"QUOTE:" appears nowhere useful here'), null);
  assert.equal(extractQuote(null), null);
});

test('surrounding quotation marks are the judge being tidy, not part of the span', () => {
  assert.equal(extractQuote('QUOTE: "the anchor is wrong"'), 'the anchor is wrong');
  assert.equal(extractQuote('QUOTE: “the anchor is wrong”'), 'the anchor is wrong');
});

test('identified + a verbatim citation is the only way to score a catch', () => {
  const report = 'G-3 is anchored at the symptom; the fix belongs at the writer.';
  const s = scoreJudgedReport({ vote: IDENTIFIED, rationale: 'QUOTE: anchored at the symptom', report });
  assert.equal(s.state, IDENTIFIED);
  assert.equal(s.quote, 'anchored at the symptom');
});

test('identified with a citation that is NOT in the report is discarded, never counted as a miss', () => {
  // THE DISTINCTION THIS SCORER EXISTS FOR. An uncheckable claim is what this framework refuses
  // everywhere else, and counting it as NOT_IDENTIFIED would punish the audited node for the
  // JUDGE's failure — the same error as scoring a lens that never ran as having missed.
  const s = scoreJudgedReport({
    vote: IDENTIFIED, rationale: 'QUOTE: it plainly says the anchor is wrong',
    report: 'The severity looks generous to me.',
  });
  assert.equal(s.state, 'unverified');
  assert.notEqual(s.state, NOT_IDENTIFIED);
  assert.match(s.why, /not in the report/);
});

test('identified with no citation at all is unverified for the same reason', () => {
  const s = scoreJudgedReport({ vote: IDENTIFIED, rationale: 'Yes, it caught it.', report: 'anything' });
  assert.equal(s.state, 'unverified');
  assert.equal(s.quote, null);
});

test('not-identified needs no citation — there is no passage to point at', () => {
  const s = scoreJudgedReport({ vote: NOT_IDENTIFIED, rationale: 'Nothing about the anchor.', report: 'x' });
  assert.equal(s.state, NOT_IDENTIFIED);
});

test('an abstention and a silence are distinct, and neither is a miss', () => {
  // Silence is not a verdict, here as at the gate: a judge that never answered has said nothing
  // about the report, and an explicit `neither` is a ruling that the report does not settle it.
  assert.equal(scoreJudgedReport({ vote: 'neither', report: 'x' }).state, 'neither');
  assert.equal(scoreJudgedReport({ vote: '', report: 'x' }).state, 'no-vote');
  assert.equal(scoreJudgedReport({ vote: undefined, report: 'x' }).state, 'no-vote');
  assert.equal(scoreJudgedReport({ vote: 'sure-looks-like-it', report: 'x' }).state, 'no-vote');
});

// ------------------------------------------------------------------------------- aggregation

test('recall counts only the seeds a judge actually ruled on', () => {
  // An unverified or absent ruling is not evidence the audit missed anything, so folding it into
  // the denominator would report the judge's failures as the audited node's.
  const s = summariseSecondOpinion([
    { seed: 'a', mutated: IDENTIFIED, control: NOT_IDENTIFIED },
    { seed: 'b', mutated: NOT_IDENTIFIED, control: NOT_IDENTIFIED },
    { seed: 'c', mutated: 'unverified', control: NOT_IDENTIFIED },
    { seed: 'd', mutated: 'no-vote', control: 'no-vote' },
  ]);
  assert.equal(s.seeds, 4);
  assert.equal(s.scoreable, 2);
  assert.equal(s.caught, 1);
  assert.equal(s.recall, 0.5);
});

test('the negative control is reported beside the result and never netted off it', () => {
  // A control scoring `identified` means the judge found the injected error in a report written
  // BEFORE anything was injected. That is a fact about the instrument, and subtracting it from the
  // result would hide the one number that says whether the instrument works.
  const s = summariseSecondOpinion([
    { seed: 'a', mutated: IDENTIFIED, control: IDENTIFIED },
    { seed: 'b', mutated: IDENTIFIED, control: NOT_IDENTIFIED },
  ]);
  assert.equal(s.caught, 2);
  assert.equal(s.recall, 1);
  assert.equal(s.false_alarms, 1, 'a false alarm must survive into the summary');
  assert.equal(s.control[IDENTIFIED], 1);
});

test('no scoreable seed reports null recall, not 1.0 and not 0', () => {
  // A run where every ruling was unverified measured nothing. Reporting 0 would read as the audit
  // having missed everything; reporting 1 would read as a clean sweep.
  const s = summariseSecondOpinion([{ seed: 'a', mutated: 'unverified', control: 'no-vote' }]);
  assert.equal(s.recall, null);
  assert.equal(s.scoreable, 0);
});

// ------------------------------------------------- the rewrite: isolating the reconciler's prose
//
// A fixture rendered EXACTLY as run-graph.mjs:3083-3096 emits a group, finding lines included —
// RECONCILED above has none, which is fine for header parsing and useless here: the rationale's
// end is the first finding line.
const WITH_FINDINGS = [
  '# Reconciled',
  '',
  '## Confirmed (2)',
  '',
  '### G-3 · BLOCKER · `scripts/external-review.mjs:1014`',
  '',
  'Raised by: `contract-audit`, `panel-codex-contract`',
  '',
  'Verified: this change DELETED an eleven-line guard at line 1014 that read `p.status`.',
  'Raised HIGH->BLOCKER because that deletion is load-bearing.',
  '',
  '- `contract-audit` · opus: `p.reason` is never read anywhere in the tree. (evidence: `evidence/contract-audit/a.log`)',
  '- `panel-codex-contract` · codex: the adapter dispatches on mode without consulting p.status. (evidence: `evidence/panel-codex-contract/raw.log`)',
  '',
  '### G-1 · HIGH · `scripts/external-review.mjs:711`',
  '',
  'Raised by: `contract-audit`',
  '',
  'Root cause: `G-3`',
  '',
  'Verified at line 711.',
  '',
  '- `contract-audit` · opus: a second claim. (evidence: `evidence/contract-audit/b.log`)',
  '',
].join('\n');

const PAYLOAD = {
  groups: [
    {
      group_id: 'G-3',
      severity: 'BLOCKER',
      decision: 'confirmed',
      rationale: 'Verified: this change DELETED an eleven-line guard at line 1014 that read `p.status`.\nRaised HIGH->BLOCKER because that deletion is load-bearing.',
    },
    { group_id: 'G-1', severity: 'HIGH', decision: 'symptom', rationale: 'Verified at line 711.' },
  ],
};

test("only the reconciler's own prose is isolated — the lenses' words are left out of it", () => {
  // THE DISTINCTION THE REWRITE TURNS ON. The rationale is forged; the finding lines are not,
  // because a group header disagreeing with the findings under it IS the injected defect. Rewriting
  // those would forge the lenses' reports — which also sit in nodes/*-report.md, so the forgery
  // would have to spread to stay consistent — and would erase the very evidence second-opinion is
  // supposed to catch this with.
  const parts = splitGroupSection(WITH_FINDINGS, 'G-3');
  assert.equal(parts.ok, true);
  assert.match(parts.rationale, /eleven-line guard at line 1014/);
  assert.ok(!parts.rationale.includes('contract-audit'), 'a finding line leaked into the rationale');
  assert.match(parts.findings, /^- `contract-audit`/);
  assert.equal(parts.findings.split('\n').length, 2);
  assert.match(parts.preamble, /^### G-3 /);
  assert.match(parts.preamble, /Raised by:/);
  assert.ok(!parts.preamble.includes('eleven-line'));
});

test('an optional Root cause: line is found, not counted past', () => {
  // `Root cause:` is emitted only for a symptom, so a fixed offset from the header would swallow
  // the first line of one group's rationale and none of another's.
  const parts = splitGroupSection(WITH_FINDINGS, 'G-1');
  assert.equal(parts.ok, true);
  assert.equal(parts.rationale, 'Verified at line 711.');
  assert.match(parts.preamble, /Root cause: `G-3`/);
});

test('a section with no finding lines is refused rather than split at a guess', () => {
  // RECONCILED renders no finding lines. The rationale's end is the first of them, so without one
  // there is no boundary — and inventing one would hand the forge the whole section to rewrite.
  const parts = splitGroupSection(RECONCILED, 'G-3');
  assert.equal(parts.ok, false);
  assert.match(parts.why, /no finding lines/);
});

// --------------------------------------------------------------- the rewrite: the tell is checked

test('a rewritten rationale that still cites the real line is REFUSED', () => {
  // THE GUARANTEE THE ORIGINAL DESIGN ASSERTED AND DID NOT HAVE. `misanchor` was justified on the
  // premise that the prose does not restate the anchor; measured on the 2026-09-21 corpus it
  // restates it by line number in every seed that could be mutated at all. This is what stops that
  // from being assumed a second time.
  const r = rewriteCarriesTell({
    rationale: 'Verified at line 711, though the guard at line 1014 is what matters.',
    from: { file: 'scripts/external-review.mjs', line: 1014 },
    to: { file: 'scripts/external-review.mjs', line: 711 },
  });
  assert.equal(r.ok, false);
  assert.match(r.why, /1014/);
});

test('a citation NEAR the real line is a tell too, because prose cites ranges', () => {
  // An anchor at 1818 is routinely written `1817-1819`. Checking the exact number alone would pass
  // a paragraph that still points the reader at the right place — the same "near enough to be the
  // same location" notion alternateAnchor uses to refuse a destination, applied at the other end.
  const r = rewriteCarriesTell({
    rationale: 'Verified at source: lines 1817-1819 run the clamp. The fix goes at 2514.',
    from: { file: 'scripts/spawn-node.mjs', line: 1818 },
    to: { file: 'scripts/spawn-node.mjs', line: 2514 },
    tolerance: 15,
  });
  assert.equal(r.ok, false);
  assert.match(r.why, /1817|1819/);
});

test('a rewrite that goes vague instead of wrong is REFUSED', () => {
  // A paragraph with no line reference is a reconciler that stopped corroborating its own anchor —
  // a weaker and different defect than one that confidently justifies the wrong location, and one
  // an auditor could flag without ever checking the source.
  const r = rewriteCarriesTell({
    rationale: 'Something is wrong somewhere in this file and it matters.',
    from: { file: 'a.mjs', line: 1014 },
    to: { file: 'a.mjs', line: 711 },
  });
  assert.equal(r.ok, false);
  assert.match(r.why, /never cites the injected line/);
});

test('a cross-file rewrite must stop naming the file the header left', () => {
  const r = rewriteCarriesTell({
    rationale: 'The clamp in spawn-node.mjs is applied at 2514 without the floor.',
    from: { file: 'scripts/spawn-node.mjs', line: 1818 },
    to: { file: 'scripts/run-graph.mjs', line: 2514 },
  });
  assert.equal(r.ok, false);
  assert.match(r.why, /spawn-node/);
});

test('a clean rewrite passes, and says why it passed', () => {
  const r = rewriteCarriesTell({
    rationale: 'Verified at source: run-graph.mjs:2514 applies the ceiling with no floor derived first.',
    from: { file: 'scripts/spawn-node.mjs', line: 1818 },
    to: { file: 'scripts/run-graph.mjs', line: 2514 },
  });
  assert.equal(r.ok, true);
});

// -------------------------------------------------------------- the rewrite: splicing it back in

test('a rewritten rationale replaces the prose in BOTH the report and the payload', () => {
  // Both, for the reason the anchor moves in both artifacts that carry it: reconciled.md is what
  // second-opinion audits, payload.json is what the orchestrator renders it from. A payload left
  // holding the original paragraph puts a contradiction in the run directory, and an auditor
  // finding THAT has found this harness rather than a reconciler.
  const out = applyRewrittenRationale({
    reconciledMd: WITH_FINDINGS,
    payload: PAYLOAD,
    groupId: 'G-3',
    rationale: 'Verified: the guard at line 711 was deleted.',
  });
  assert.match(out.reconciled_md, /Verified: the guard at line 711 was deleted\./);
  assert.ok(!out.reconciled_md.includes('eleven-line guard at line 1014'));
  assert.equal(
    out.payload.groups.find((g) => g.group_id === 'G-3').rationale,
    'Verified: the guard at line 711 was deleted.',
  );
  // The findings under it, and the other group, are untouched.
  assert.match(out.reconciled_md, /- `contract-audit` · opus: `p\.reason` is never read/);
  assert.match(out.reconciled_md, /Verified at line 711\./);
  assert.equal(out.payload.groups.find((g) => g.group_id === 'G-1').rationale, 'Verified at line 711.');
});

test('the payload passed in is not mutated in place', () => {
  const before = JSON.stringify(PAYLOAD);
  applyRewrittenRationale({
    reconciledMd: WITH_FINDINGS, payload: PAYLOAD, groupId: 'G-3',
    rationale: 'A new paragraph at line 711.',
  });
  assert.equal(JSON.stringify(PAYLOAD), before);
});

test('an empty rewrite is refused rather than spliced in as a blank rationale', () => {
  assert.throws(() => applyRewrittenRationale({
    reconciledMd: WITH_FINDINGS, payload: PAYLOAD, groupId: 'G-3', rationale: '   ',
  }), /empty/);
});

// ------------------------------------------------------ the rewrite: widening where it may land

test('cross-file destinations are available only when the rationale is being rewritten', () => {
  // A borrowed-and-unchanged rationale has to keep making sense above the new header, which is what
  // confines it to one file. Measured 2026-09-22: that refused five of seven seeds.
  const headers = groupHeaders(RECONCILED);
  const narrow = alternateAnchor({ headers, targetId: 'G-6', tolerance: 15 });
  assert.equal(narrow.ok, false, 'G-6 is alone in its file, so borrowing must refuse');
  const wide = alternateAnchor({ headers, targetId: 'G-6', tolerance: 15, allowCrossFile: true });
  assert.equal(wide.ok, true);
  assert.equal(wide.cross_file, true);
  assert.equal(wide.file, 'scripts/external-review.mjs');
});

test('a same-file destination still outranks a cross-file one', () => {
  // A within-file move is the more conservative mistake, so widening must not reorder what was
  // already admissible.
  const headers = groupHeaders(RECONCILED);
  const wide = alternateAnchor({ headers, targetId: 'G-3', tolerance: 15, allowCrossFile: true });
  assert.equal(wide.ok, true);
  assert.equal(wide.cross_file, false);
  assert.equal(wide.borrowed_from, 'G-5');
});

test('tolerance never compares line numbers BETWEEN files', () => {
  // Applying a within-file notion of "near enough" across files is arithmetic on unrelated numbers
  // that happens not to throw.
  const headers = [
    { group_id: 'G-A', file: 'a.mjs', line: 100 },
    { group_id: 'G-B', file: 'b.mjs', line: 104 },
  ];
  const wide = alternateAnchor({ headers, targetId: 'G-A', tolerance: 15, allowCrossFile: true });
  assert.equal(wide.ok, true, 'a different file is always a different place');
  assert.equal(wide.borrowed_from, 'G-B');
});

// -------------------------------------------------- the rewrite: mining destinations from prose

test('a line cited for ANOTHER file is never offered as a line in this one', () => {
  // THE BUG THIS PINS. Inheriting every mined number into the group's file offered
  // `spawn-node.mjs:1771` as line 1771 of `decisions.mjs` — a line the reconciliation does not
  // discuss, dressed as one that does. It was caught only because decisions.mjs is 1362 lines and
  // the caller's end-of-file bound rejected it; in a longer file it would have passed silently.
  const text = 'decisions.mjs:42-43 apply the cap, while spawn-node.mjs:1771 asserts it throws.';
  const got = citedLines({ text, file: 'scripts/lib/decisions.mjs', excludeLine: 43, tolerance: 15 });
  assert.ok(!got.includes(1771), 'a citation qualified with another filename must be dropped');
});

test('unqualified citations belong to the group own file; bare numbers are not citations', () => {
  // `line 900` and `capVerdict:54` are line references. `$1790` and `7 seeds` are a cost and a
  // count, and a destination mined from one of those is not a location the prose discusses at all.
  // excludeLine is 1 so the tolerance window does not swallow 54 — this test is about what counts
  // as a citation at all, and the window is the previous test's subject.
  const text = 'See line 900 and sibling capVerdict:54. It cost $1790 across 7 seeds.';
  const got = citedLines({ text, file: 'a.mjs', excludeLine: 1, tolerance: 15 });
  assert.deepEqual(got.slice().sort((x, y) => x - y), [54, 900]);
  assert.ok(!got.includes(1790), 'a dollar amount is not a line citation');
  assert.ok(!got.includes(7), 'a count is not a line citation');
});

test('a cited line within tolerance of the anchor is not a wrong location', () => {
  const text = 'decisions.mjs:42-43 apply the cap; see also line 800.';
  const got = citedLines({ text, file: 'decisions.mjs', excludeLine: 43, tolerance: 15 });
  assert.deepEqual(got, [800]);
});

test('mined destinations come back farthest-first', () => {
  const text = 'See line 100, line 900 and line 300.';
  const got = citedLines({ text, file: 'a.mjs', excludeLine: 50, tolerance: 15 });
  assert.deepEqual(got, [900, 300, 100]);
});

test('MUTATIONS and INJECTION_RULES list only what is implemented', () => {
  // The same rule MUTATIONS already carries: a driver must not be able to select a rule that is
  // only designed and report a number measuring something else.
  assert.deepEqual(MUTATIONS, ['misanchor', 'deflate', 'drop']);
  assert.deepEqual(INJECTION_RULES, ['borrow', 'rewrite']);
});

// ------------------------------------------------- reading a CLI envelope without being lied to

test('an error envelope is NOT an answer, even though it fills the same field', () => {
  // MEASURED 2026-09-22, and it cost a whole forge pass. A failed call returns its message in
  // `result` — the field an answer uses — with `subtype: "success"` sitting next to
  // `is_error: true`. The forge would have handed "Credit balance is too low" back as the
  // rewritten rationale and the harness would have spliced it into reconciled.md. It was stopped
  // downstream by the tell check only because that text cites no line number; an error message
  // containing the injected line would have gone through.
  const r = readCliEnvelope(JSON.stringify({
    is_error: true, subtype: 'success', api_error_status: 400, result: 'Credit balance is too low',
  }));
  assert.equal(r.ok, false);
  assert.match(r.why, /400/);
  assert.match(r.why, /Credit balance is too low/);
  assert.equal(r.text, undefined, 'an error must not come back carrying usable text');
});

test('`subtype: success` is never the field that decides it', () => {
  // The envelope above sets both. Reading `subtype` instead of `is_error` reads every failure as a
  // success, which is how this defect existed at all.
  const r = readCliEnvelope(JSON.stringify({ is_error: true, subtype: 'success', result: 'boom' }));
  assert.equal(r.ok, false);
});

test('merged stdout+stderr does not parse, which is the point', () => {
  // THE OTHER HALF OF THE SAME RUN. `shAsync` returns `out` (both streams, for logs) and `stdout`
  // (the answer). Both the forge and the judge parsed `out`, so one CLI warning line on stderr —
  // there was one, about connectors — turned every good envelope into "no parseable envelope" and
  // every seed into NOT RUN. A caller handing this function the merged buffer gets a legible
  // refusal rather than a silent one.
  const r = readCliEnvelope('⚠ claude.ai connectors are disabled\n{"result":"a paragraph"}');
  assert.equal(r.ok, false);
  assert.match(r.why, /no parseable JSON envelope on stdout/);
});

test('a good envelope yields trimmed text and its cost', () => {
  const r = readCliEnvelope(JSON.stringify({ result: '  A rewritten paragraph.  ', total_cost_usd: 0.2146 }));
  assert.equal(r.ok, true);
  assert.equal(r.text, 'A rewritten paragraph.');
  assert.equal(r.cost_usd, 0.2146);
});

test('an envelope with no result text is refused rather than returned empty', () => {
  // An empty rationale spliced into reconciled.md would leave a group with a header, findings and
  // nothing between them — and the seed would be scored as though an error had been injected.
  assert.equal(readCliEnvelope(JSON.stringify({ result: '   ' })).ok, false);
  assert.equal(readCliEnvelope(JSON.stringify({ total_cost_usd: 1 })).ok, false);
  assert.equal(readCliEnvelope('').ok, false);
  assert.equal(readCliEnvelope(undefined).ok, false);
});

test('cost is null rather than 0 when the envelope does not report it', () => {
  // 0 is a measurement ("this was free"); null is its absence. Summing absences as zeros would
  // under-report what a pass actually cost.
  assert.equal(readCliEnvelope(JSON.stringify({ result: 'x' })).cost_usd, null);
});

test('a forged rationale containing $& or $` splices verbatim, not expanded', () => {
  // `String.replace(str, str)` interprets `$&`, "$`", `$'` and `$n` IN THE REPLACEMENT, and the
  // replacement here is model-written prose — a rationale discussing shell or git syntax reaches
  // this function routinely. Expanded, it would splice a silently corrupted paragraph into
  // reconciled.md, and a mangled paragraph is exactly the kind of thing an auditor objects to —
  // which the harness would then score as having caught the injected anchor. The callback form of
  // replace inserts the text verbatim; the string form does not.
  const forged = 'Verified at line 711: the capture passes $& and $` through to the shell, and $1 too.';
  const out = applyRewrittenRationale({
    reconciledMd: WITH_FINDINGS, payload: PAYLOAD, groupId: 'G-3', rationale: forged,
  });
  assert.ok(out.reconciled_md.includes(forged), 'the rationale must appear exactly as written');
  assert.equal(out.payload.groups.find((g) => g.group_id === 'G-3').rationale, forged);
});

// ------------------------------------------- the mutation surviving in EVERY artifact it touched

test('a finding-groups.json that reverted is NOT RUN, even when reconciled.md is intact', () => {
  // MEASURED 2026-09-22, on the first end-to-end run. `run-graph.mjs:2729` rewrites
  // finding-groups.json from the lens reports on EVERY run, resume included, so the injected anchor
  // survived in the report and reverted in the grouping. Checking reconciled.md alone passed that
  // half-undone state, and `second-opinion` duly reported the two artifacts contradicting each
  // other — "finding-groups.json anchors G-3 at line 1014 ... reconciled.md renders it as :711".
  // That is the rendering-bug catch applyMisanchor moves BOTH files to prevent, and it would have
  // been scored as though the audit had caught the misanchor.
  const md = RECONCILED.replace('scripts/external-review.mjs:1014', 'scripts/external-review.mjs:1135');
  const reverted = { groups: [{ group_id: 'G-3', file: 'scripts/external-review.mjs', line: 1014 }] };
  const r = mutationSurvived({
    reconciledMd: md, findingGroups: reverted, targetId: 'G-3',
    expectedAnchor: 'scripts/external-review.mjs:1135',
  });
  assert.equal(r.ok, false);
  assert.match(r.why, /contradict/);
  assert.match(r.why, /1014/);
});

test('both artifacts carrying the injected anchor is the only passing state', () => {
  const md = RECONCILED.replace('scripts/external-review.mjs:1014', 'scripts/external-review.mjs:1135');
  const moved = { groups: [{ group_id: 'G-3', file: 'scripts/external-review.mjs', line: 1135 }] };
  const r = mutationSurvived({
    reconciledMd: md, findingGroups: moved, targetId: 'G-3',
    expectedAnchor: 'scripts/external-review.mjs:1135',
  });
  assert.equal(r.ok, true);
});

test('a group that vanished from finding-groups.json is named as such', () => {
  // Distinct from "it moved": an absent group means the grouping changed shape, not that an anchor
  // was re-derived, and it sends a reader somewhere different.
  const md = RECONCILED.replace('scripts/external-review.mjs:1014', 'scripts/external-review.mjs:1135');
  const r = mutationSurvived({
    reconciledMd: md, findingGroups: { groups: [] }, targetId: 'G-3',
    expectedAnchor: 'scripts/external-review.mjs:1135',
  });
  assert.equal(r.ok, false);
  assert.match(r.why, /not in finding-groups\.json/);
});

test('the rewritten section keeps the renderer blank line after Raised by:', () => {
  // Observed on the first end-to-end run: the splice joined the preamble straight onto the new
  // paragraph, so that one group read `Raised by: ...` with the prose on the very next line while
  // every other group had a blank between them. Only markdown, and exactly the kind of seam this
  // mutation exists NOT to have — a reader who notices the formatting differs has found the
  // harness rather than the anchor.
  const out = applyRewrittenRationale({
    reconciledMd: WITH_FINDINGS, payload: PAYLOAD, groupId: 'G-3',
    rationale: 'A rewritten paragraph about line 711.',
  });
  assert.match(out.reconciled_md, /Raised by: `contract-audit`, `panel-codex-contract`\n\nA rewritten paragraph/);
});

// ------------------------------------------------------- the second denominator, not a substitute

test('a seed whose control already identified it is excluded from the CLEAN recall only', () => {
  // MEASURED 2026-09-22. `status-never-a-pass` scored `control: identified` with a verbatim-verified
  // citation: the audit of the UNMUTATED reconciliation already objected to that group's anchoring.
  // Such a seed cannot measure detection of an injected ANCHOR error — the audit raises an anchor
  // objection either way — so its mutated result is not evidence about the audited node.
  const s = summariseSecondOpinion([
    { seed: 'contaminated', mutated: IDENTIFIED, control: IDENTIFIED },
    { seed: 'clean-hit', mutated: IDENTIFIED, control: NOT_IDENTIFIED },
    { seed: 'clean-miss', mutated: NOT_IDENTIFIED, control: NOT_IDENTIFIED },
  ]);
  // The headline is unchanged: all three are scoreable and recall counts all three.
  assert.equal(s.scoreable, 3);
  assert.equal(s.recall, 0.667);
  assert.equal(s.false_alarms, 1);
  // The second denominator drops the contaminated one and SAYS how many it dropped.
  assert.equal(s.clean_control.seeds, 2);
  assert.equal(s.clean_control.caught, 1);
  assert.equal(s.clean_control.recall, 0.5);
  assert.equal(s.clean_control.excluded, 1);
});

test('false alarms are still never netted off the headline recall', () => {
  // The prohibition the plan states, pinned: subtracting the control from the result would hide the
  // one number that says whether the instrument works. `clean_control` answers a DIFFERENT question
  // alongside it; it does not replace it.
  const s = summariseSecondOpinion([
    { seed: 'a', mutated: IDENTIFIED, control: IDENTIFIED },
    { seed: 'b', mutated: IDENTIFIED, control: IDENTIFIED },
  ]);
  assert.equal(s.recall, 1, 'the headline still counts every scoreable seed');
  assert.equal(s.false_alarms, 2);
  assert.equal(s.clean_control.seeds, 0);
  assert.equal(s.clean_control.recall, null, 'no clean seed measured nothing, which is not 0 or 1');
});

test('a control that gave no verdict is never counted as a clean control', () => {
  // G-13 of 20261114-174045-m2-pred1-review (I-2): the clean filter was `control !== identified`, so a
  // control that was unverified, unscored, a no-vote or missing entered the clean denominator as though
  // it had established a negative. Silence is not a verdict: only `not-identified` is clean.
  const s = summariseSecondOpinion([
    { seed: 'unverified', mutated: IDENTIFIED, control: 'unverified' },
    { seed: 'no-vote', mutated: IDENTIFIED, control: 'no-vote' },
    { seed: 'missing', mutated: IDENTIFIED },
    { seed: 'neither', mutated: IDENTIFIED, control: 'neither' },
    { seed: 'clean-miss', mutated: NOT_IDENTIFIED, control: NOT_IDENTIFIED },
  ]);
  assert.equal(s.scoreable, 5, 'the headline still counts every scoreable seed');
  assert.equal(s.clean_control.seeds, 1, 'only the control that said not-identified is clean');
  assert.equal(s.clean_control.caught, 0);
  assert.equal(s.clean_control.recall, 0);
  assert.equal(s.clean_control.excluded, 4);
  assert.equal(s.clean_control.control_unverified, 4, 'the excluded seeds whose control gave no verdict are counted as such');
});

test('an unscoreable seed is in neither denominator', () => {
  // `unverified` is the judge failing, not the audit missing. It was never in `scoreable`, so it
  // must not quietly appear in the clean-control count either.
  const s = summariseSecondOpinion([
    { seed: 'a', mutated: 'unverified', control: NOT_IDENTIFIED },
    { seed: 'b', mutated: IDENTIFIED, control: NOT_IDENTIFIED },
  ]);
  assert.equal(s.scoreable, 1);
  assert.equal(s.clean_control.seeds, 1);
  assert.equal(s.clean_control.excluded, 0);
});

// --------------------------------------------- what a pass SPENT versus what it merely inherited

test('only the node this pass spawned counts as spent', () => {
  // MEASURED 2026-09-22 and wrong by 3.8x. `collectRun` reads every node in the run directory, and
  // that directory is a COPY of a finished pass — so the per-node cost map is dominated by nodes
  // that ran days earlier. Written out flat, summing it reported $19.30 for a pass that spent
  // $5.13. Not an estimate that drifted: a number sitting in the artifact a reader quotes.
  const r = splitSpend({
    costsByNode: { 'second-opinion': 1.1423, 'code-audit': 2.0, reconcile: 0.86 },
    nodeId: 'second-opinion', extraUsd: 0.2169, extraLabel: 'forge_usd',
  });
  assert.equal(r.spent.second_opinion_usd, 1.1423);
  assert.equal(r.spent.forge_usd, 0.2169);
  assert.equal(r.spent.total_usd, 1.3592);
  assert.ok(!('code-audit' in r.spent), 'an inherited node must not appear in spent');
});

test('inherited costs are kept and LABELLED, not dropped and not summed', () => {
  // Kept, because comparing this run's node against the original pass is the reason to look.
  // Labelled, because naming it is what stops it being added into a total claiming to be a cost.
  const r = splitSpend({
    costsByNode: { 'second-opinion': 1, 'code-audit': 2, reconcile: 3 },
    nodeId: 'second-opinion',
  });
  assert.deepEqual(Object.keys(r.inherited.costs).sort(), ['code-audit', 'reconcile']);
  assert.match(r.inherited.$note, /NOT spent by it/);
  assert.match(r.inherited.$note, /never add these to spent/);
  assert.equal(r.spent.total_usd, 1, 'the inherited $5 must not reach the total');
});

test('absent cost is null, never 0', () => {
  // 0 is a measurement ("this was free"); null is its absence. Summing absences as zeros
  // under-reports what a pass cost, which is the same direction of error as the defect above.
  const r = splitSpend({ costsByNode: {}, nodeId: 'second-opinion', extraLabel: 'forge_usd' });
  assert.equal(r.spent.second_opinion_usd, null);
  assert.equal(r.spent.forge_usd, null);
  assert.equal(r.spent.usage, null);
  assert.equal(r.spent.duration_ms, null);
  // AND THE TOTAL TOO (G-3). This asserted `0` under the comment "nothing recorded totals to
  // nothing spent" — in a test named "absent cost is null, never 0". The title had the rule right
  // and the assertion had the opposite, so the defect was pinned by the check meant to forbid it,
  // and three arms had to find it from the outside.
  //
  // "Nothing recorded" and "nothing spent" are different claims, which is the whole point of every
  // other line in this test.
  assert.equal(r.spent.total_usd, null);
});

test('durations split the same way the costs do', () => {
  // The contamination was never only about money — a pass that reported the preserved run's node
  // durations would claim wall-clock it never spent either. Fixing one and not the others is how
  // half a defect survives.
  const r = splitSpend({
    costsByNode: { 'second-opinion': 1 },
    durationsByNode: { 'second-opinion': 750000, 'code-audit': 99 },
    nodeId: 'second-opinion',
  });
  assert.equal(r.spent.duration_ms, 750000);
  assert.deepEqual(Object.keys(r.inherited.duration_ms), ['code-audit']);
});

// ============================================================ deflate: lowering a kept severity

test('a severity one rung down is REFUSED, because reviewers disagree about that in good faith', () => {
  // The severity analogue of `tolerance`. HIGH versus BLOCKER on the same finding is an argument
  // two reviewers have honestly, so injecting it would score an auditor for failing to agree with
  // this harness rather than for missing a defect — the same manufacturing `alternateAnchor`
  // refuses when a destination sits inside the window.
  const rungs = ['LOW', 'MEDIUM', 'HIGH', 'BLOCKER'];
  assert.equal(deflatedSeverity({ severity: 'MEDIUM', rungs }).ok, false);
  assert.match(deflatedSeverity({ severity: 'MEDIUM', rungs }).why, /good faith/);
  assert.equal(deflatedSeverity({ severity: 'LOW', rungs }).ok, false);
  // Two rungs or more is an error nobody would call a close reading.
  assert.deepEqual(deflatedSeverity({ severity: 'HIGH', rungs }), { ok: true, from: 'HIGH', to: 'LOW', fell: 2 });
  assert.deepEqual(deflatedSeverity({ severity: 'BLOCKER', rungs }), { ok: true, from: 'BLOCKER', to: 'LOW', fell: 3 });
});

test('a severity off the ladder is refused rather than ranked', () => {
  // The ladder is passed in, never imported: decisions.mjs owns it, and a second copy here is the
  // two-owners defect this project keeps paying for.
  assert.equal(deflatedSeverity({ severity: 'CRITICAL', rungs: ['LOW', 'MEDIUM', 'HIGH', 'BLOCKER'] }).ok, false);
  assert.equal(deflatedSeverity({ severity: 'BLOCKER', rungs: [] }).ok, false);
});

test('deflate lowers the header and the payload, and leaves the findings at their own severity', () => {
  // The findings keep theirs for the reason misanchor leaves the lens bullets naming the true line:
  // a group recorded at LOW above findings raised as BLOCKER IS the injected defect — a reconciler
  // that talked itself down — and that disagreement is what an audit is meant to notice.
  const out = applyDeflate({ reconciledMd: WITH_FINDINGS, payload: PAYLOAD, targetId: 'G-3', to: 'LOW' });
  assert.match(out.reconciled_md, /### G-3 · LOW · `scripts\/external-review\.mjs:1014`/);
  assert.equal(out.payload.groups.find((g) => g.group_id === 'G-3').severity, 'LOW');
  // The anchor is untouched — this mutation moves severity and nothing else.
  assert.match(out.reconciled_md, /`scripts\/external-review\.mjs:1014`/);
  // The other group is untouched.
  assert.equal(out.payload.groups.find((g) => g.group_id === 'G-1').severity, 'HIGH');
  assert.equal(out.ground_truth.mutation, 'deflate');
  assert.equal(out.ground_truth.from, 'BLOCKER');
  assert.equal(out.ground_truth.to, 'LOW');
  assert.match(out.ground_truth.statement, /BLOCKER/);
  assert.match(out.ground_truth.statement, /LOW/);
});

test('deflate does not mutate the payload it was handed', () => {
  const before = JSON.stringify(PAYLOAD);
  applyDeflate({ reconciledMd: WITH_FINDINGS, payload: PAYLOAD, targetId: 'G-3', to: 'LOW' });
  assert.equal(JSON.stringify(PAYLOAD), before);
});

test('deflating to the severity a group already has is refused', () => {
  assert.throws(() => applyDeflate({
    reconciledMd: WITH_FINDINGS, payload: PAYLOAD, targetId: 'G-3', to: 'BLOCKER',
  }), /already BLOCKER/);
});

// ================================================================ drop: the dangling-root refusal

test('dropping a group other groups call their root cause is REFUSED', () => {
  // THE SECOND REFUSAL, AND THE ONE THE REWRITE DOES NOT FIX. Regenerating the dropped group's own
  // paragraph says nothing about the symptoms still pointing at it: a `root_cause_group` naming a
  // group that is gone is a structural inconsistency an auditor finds by following a pointer, not
  // by judging the drop. Measured on the corpus: 2 of 6 targets are roots, so this costs a third of
  // the seeds and buys a mutation that is only ever about the drop.
  const payload = {
    groups: [
      { group_id: 'G-3', decision: 'confirmed' },
      { group_id: 'G-5', decision: 'symptom', root_cause_group: 'G-3' },
      { group_id: 'G-4', decision: 'symptom', root_cause_group: 'G-3' },
    ],
  };
  const r = dropWouldDangle({ payload, targetId: 'G-3' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.dependents, ['G-5', 'G-4']);
  assert.match(r.why, /live symptoms pointing at a group that is gone/);
});

test('a group nothing points at may be dropped', () => {
  const payload = { groups: [{ group_id: 'G-3' }, { group_id: 'G-1', root_cause_group: 'G-2' }] };
  assert.deepEqual(dropWouldDangle({ payload, targetId: 'G-3' }), { ok: true, dependents: [] });
});

// ============================================================ drop: the counts stay honest

test('drop moves the section and keeps every bucket count truthful', () => {
  // The renderer emits `## Confirmed (2)` from `rows.length`. A section moved without adjusting
  // both headings leaves a bucket claiming a population it does not have — an inconsistency found
  // by COUNTING, which is not the misjudgement being injected.
  const out = applyDrop({ reconciledMd: WITH_FINDINGS, payload: PAYLOAD, targetId: 'G-3' });
  assert.match(out.reconciled_md, /^## Confirmed \(1\)$/m, 'the source bucket must lose one');
  assert.match(out.reconciled_md, /^## Dropped \(1\)$/m, 'and the destination must gain one');
  // The section moved whole, findings included.
  const dropped = out.reconciled_md.split('## Dropped (1)')[1];
  assert.match(dropped, /### G-3 · BLOCKER/);
  assert.match(dropped, /- `contract-audit` · opus:/);
  // And it is no longer above the Dropped heading.
  assert.ok(!out.reconciled_md.split('## Dropped (1)')[0].includes('### G-3'));
  assert.equal(out.payload.groups.find((g) => g.group_id === 'G-3').decision, 'dropped');
  assert.equal(out.ground_truth.mutation, 'drop');
  assert.equal(out.ground_truth.from, 'confirmed');
});

test('a bucket emptied by the drop loses its heading, because the renderer never emits an empty one', () => {
  // `if (!rows.length) continue` — `## Confirmed (0)` is a shape the renderer cannot produce, so
  // leaving one behind is a tell that has nothing to do with the drop.
  const solo = [
    '# Reconciled', '',
    '## Confirmed (1)', '',
    '### G-9 · HIGH · `a.mjs:1`', '', 'Only one.', '',
    '- `code-audit` · opus: c. (evidence: `e/a.log`)', '',
    '## Symptom (1)', '',
    '### G-8 · LOW · `a.mjs:9`', '', 'Other.', '',
    '- `code-audit` · opus: d. (evidence: `e/b.log`)', '',
  ].join('\n');
  const out = applyDrop({
    reconciledMd: solo,
    payload: { groups: [{ group_id: 'G-9', decision: 'confirmed' }, { group_id: 'G-8', decision: 'symptom' }] },
    targetId: 'G-9',
  });
  assert.ok(!/## Confirmed/.test(out.reconciled_md), 'an emptied bucket keeps no heading');
  assert.match(out.reconciled_md, /^## Symptom \(1\)$/m, 'and the untouched bucket is untouched');
  assert.match(out.reconciled_md, /^## Dropped \(1\)$/m);
});

test('the moved section does not arrive with doubled blank lines', () => {
  // The slice ends at the NEXT heading, so it already carries the blank the renderer put between
  // sections; appending another produced `\n\n\n` before the following heading. Only markdown, and
  // exactly the seam that reads as "this group is formatted unlike every other".
  const withTrailer = `${WITH_FINDINGS}\n## Lens did not report\n\n- **\`ui-audit\`** — skipped\n`;
  const out = applyDrop({ reconciledMd: withTrailer, payload: PAYLOAD, targetId: 'G-3' });
  assert.ok(!/\n\n\n/.test(out.reconciled_md), 'the renderer emits one blank between sections, not two');
});

test('drop refuses a group that is already dropped, and one with no bucket above it', () => {
  const out = applyDrop({ reconciledMd: WITH_FINDINGS, payload: PAYLOAD, targetId: 'G-3' });
  assert.throws(() => applyDrop({ reconciledMd: out.reconciled_md, payload: out.payload, targetId: 'G-3' }),
    /already dropped/);
  const headless = '### G-7 · LOW · `a.mjs:2`\n\nNo bucket.\n\n- `x` · opus: c. (evidence: `e/a.log`)\n';
  assert.throws(() => applyDrop({
    reconciledMd: headless, payload: { groups: [{ group_id: 'G-7' }] }, targetId: 'G-7',
  }), /sits under no bucket heading/);
});

// ====================================================== the per-mutation dispatchers

test('every mutation in MUTATIONS has prose, a tell check and a survival check', () => {
  // MUTATIONS is the list a driver may select from, so a name on it with no checker behind it is a
  // mutation that runs unguarded. Asserted by CALLING each, not by counting branches.
  assert.deepEqual(MUTATIONS, ['misanchor', 'deflate', 'drop']);
  for (const mutation of MUTATIONS) {
    const slots = forgeSlots({
      mutation, groupId: 'G-3', tolerance: 15, destinationSource: '   90  const commandEnv = { ...process.env };',
      from: mutation === 'misanchor' ? { file: 'a.mjs', line: 10 } : 'BLOCKER',
      to: mutation === 'misanchor' ? { file: 'a.mjs', line: 90 } : 'LOW',
    });
    for (const k of ['change_instruction', 'forbidden_rule', 'destination_source']) {
      assert.ok(typeof slots[k] === 'string' && slots[k].length > 20, `${mutation} has no ${k}`);
    }
  }
  for (const m of ['misanchor', 'deflate', 'drop']) {
    assert.ok(typeof tellForMutation === 'function');
    assert.ok(typeof injectionSurvived === 'function');
    assert.notEqual(m, '');
  }
  // An unknown mutation throws rather than silently producing an unguarded run.
  assert.throws(() => forgeSlots({ mutation: 'invent', groupId: 'G-1' }), /no prose for mutation/);
  assert.throws(() => tellForMutation({ mutation: 'invent', rationale: 'x' }), /no checker/);
  assert.throws(() => injectionSurvived({ mutation: 'invent', reconciledMd: '', targetId: 'G-1' }), /no checker/);
});

test('only misanchor is given the destination source; the others are told it does not apply', () => {
  // The forge invents source it has not been shown — measured, and the reason misanchor gets ±7
  // real lines. deflate and drop move no location, so there is nothing new to show and saying so
  // beats handing over an irrelevant block the paragraph might start discussing.
  const anchor = forgeSlots({
    mutation: 'misanchor', groupId: 'G-1', tolerance: 15, destinationSource: '  90  const x = 1;',
    from: { file: 'a.mjs', line: 10 }, to: { file: 'a.mjs', line: 90 },
  });
  assert.match(anchor.destination_source, /const x = 1;/);
  for (const mutation of ['deflate', 'drop']) {
    const s = forgeSlots({ mutation, groupId: 'G-1', from: 'BLOCKER', to: 'LOW', tolerance: 15 });
    assert.match(s.destination_source, /not applicable/);
  }
});

test('deflate\'s tell check is BOUNDED, and drop\'s says it is not', () => {
  // `bounded` is part of the answer. misanchor and deflate have a mechanical tell to look for — a
  // line number, a severity word. Drop does not: "does this now argue for dropping" is a judgement,
  // and a row resting on a prompt instruction must not read as one resting on a check.
  const good = tellForMutation({ mutation: 'deflate', rationale: 'Bounded; LOW is right.', from: 'BLOCKER', to: 'LOW' });
  assert.equal(good.ok, true);
  assert.equal(good.bounded, true);
  const leaks = tellForMutation({ mutation: 'deflate', rationale: 'Really a BLOCKER, call it LOW.', from: 'BLOCKER', to: 'LOW' });
  assert.equal(leaks.ok, false);
  assert.match(leaks.why, /still says BLOCKER/);
  // NOT NAMING THE NEW RUNG IS FINE, and this assertion used to say the opposite. Measured
  // 2026-09-22 on a real forge: the rule refused "I lower it below both nodes' MEDIUM because no
  // run is harmed today ... a wrong answer nobody reads, not a wrong verdict" — a committed LOW
  // rationale that never writes the word. The requirement was borrowed from misanchor, where
  // citing the injected line is the only way to commit to a location; severity is stated by the
  // header and argued by the paragraph, so the proxy cost a seed for prose that was right.
  const unnamed = tellForMutation({
    mutation: 'deflate', rationale: 'I lower it below MEDIUM: no run is harmed today.',
    original: 'Raised to BLOCKER.', from: 'BLOCKER', to: 'LOW',
  });
  assert.equal(unnamed.ok, true, 'a rationale may argue the lower severity without naming the rung');
  // What is still refused is a forge that did nothing.
  const same = tellForMutation({ mutation: 'deflate', rationale: 'x', original: 'x', from: 'BLOCKER', to: 'LOW' });
  assert.equal(same.ok, false);
  assert.match(same.why, /came back unchanged/);

  const dropped = tellForMutation({ mutation: 'drop', rationale: 'The evidence withdraws it.', original: 'keep it' });
  assert.equal(dropped.ok, true);
  assert.equal(dropped.bounded, false, 'drop must declare that its guard is not mechanical');
  assert.match(dropped.why, /NOT a bounded check/);
});

test('drop refuses only a rationale that came back unchanged', () => {
  // A `\bconfirm(ed|s|ing)?\b` rule used to sit here too, and it was worse than nothing. Measured
  // across eight forges it refused three, and both refusals examined argued FOR dropping: "its
  // agreement echoes the lens's framing rather than CONFIRMING it independently", and
  // "floor-callsites.log CONFIRMS that verdictFloorFromFindings ... are still imported" — the
  // second describing what a log shows and saying nothing about the group's standing. `confirm` is
  // ordinary reconciler vocabulary for what evidence demonstrates, so the keyword matched
  // negations and citations alike. It cost two of four seeds in one pass and bounded nothing.
  assert.equal(tellForMutation({ mutation: 'drop', rationale: ' same ', original: 'same' }).ok, false);
  const usesTheWordInnocently = tellForMutation({
    mutation: 'drop',
    rationale: 'The arm echoes the lens rather than confirming it independently, so it is one observation twice.',
    original: 'Root cause, confirmed by two families.',
  });
  assert.equal(usesTheWordInnocently.ok, true, 'a drop argument may use the word in a negation');
  assert.equal(usesTheWordInnocently.bounded, false, 'and it is still not a bounded check');
});

// ------------------------------------------------------------------ survival, per mutation

test('deflate survives only when BOTH artifacts carry the new severity', () => {
  const md = WITH_FINDINGS.replace('### G-3 · BLOCKER', '### G-3 · LOW');
  const gt = { from: 'BLOCKER', to: 'LOW' };
  const both = { groups: [{ group_id: 'G-3', severity: 'LOW' }] };
  assert.equal(injectionSurvived({ mutation: 'deflate', reconciledMd: md, payload: both, targetId: 'G-3', groundTruth: gt }).ok, true);
  // Payload reverted: the two artifacts contradict, which is the harness being found.
  const reverted = { groups: [{ group_id: 'G-3', severity: 'BLOCKER' }] };
  const r = injectionSurvived({ mutation: 'deflate', reconciledMd: md, payload: reverted, targetId: 'G-3', groundTruth: gt });
  assert.equal(r.ok, false);
  assert.match(r.why, /contradict/);
  // Report reverted.
  const r2 = injectionSurvived({ mutation: 'deflate', reconciledMd: WITH_FINDINGS, payload: both, targetId: 'G-3', groundTruth: gt });
  assert.equal(r2.ok, false);
  assert.match(r2.why, /not the injected LOW/);
});

test('drop survives only when the section sits under Dropped AND the payload says so', () => {
  const out = applyDrop({ reconciledMd: WITH_FINDINGS, payload: PAYLOAD, targetId: 'G-3' });
  const gt = { from: 'confirmed', to: 'dropped' };
  assert.equal(injectionSurvived({
    mutation: 'drop', reconciledMd: out.reconciled_md, payload: out.payload, targetId: 'G-3', groundTruth: gt,
  }).ok, true);
  // Payload says dropped, the report still renders it under Confirmed.
  const r = injectionSurvived({
    mutation: 'drop', reconciledMd: WITH_FINDINGS, payload: out.payload, targetId: 'G-3', groundTruth: gt,
  });
  assert.equal(r.ok, false);
  assert.match(r.why, /still renders G-3 under Confirmed/);
  // The report moved it, the payload did not.
  const r2 = injectionSurvived({
    mutation: 'drop', reconciledMd: out.reconciled_md, payload: PAYLOAD, targetId: 'G-3', groundTruth: gt,
  });
  assert.equal(r2.ok, false);
  assert.match(r2.why, /not dropped/);
});

// ------------------------------------------------ a citation rejected over two asterisks
// MEASURED ON A REAL PASS, drop at opus/low, seed `numeric-bundle-pager`. The audit caught the
// injected error and said so at length; the judge voted `identified` and quoted the sentence that
// says it. The scorer returned `unverified` and the gate returned UNDECIDED.
//
// The entire difference was markdown emphasis:
//
//   report : - **G-2: I dispute the drop.** It should be Confirmed at BLOCKER, with G-7 and G-6 ...
//   judge  :   G-2: I dispute the drop. It should be Confirmed at BLOCKER, with G-7 and G-6 ...
//
// `flat()` normalised whitespace and case and left `**` in place, so the needle was not a substring
// of the haystack. Stripping formatting is what any quoter does — a model, a person, a clipboard.
//
// This is a loosening, and it is the SAFE direction for one reason: emphasis markers are
// presentation, not words. Every protection that makes this check worth having is untouched —
// fragments must still appear, in order, each longer than minFragment, so two unrelated sentences
// still cannot be stitched into a quotation nobody wrote. What changes is that the check now
// compares prose to prose.
test('markdown emphasis is presentation, not words — a quote that strips it still verifies', async () => {
  const { quotePresent } = await import('../scripts/lib/verbatim.mjs');

  const report = '- **G-2: I dispute the drop.** It should be Confirmed at BLOCKER, with G-7 linked to it.';
  const judge = 'G-2: I dispute the drop. It should be Confirmed at BLOCKER, with G-7 linked to it.';
  assert.equal(quotePresent({ haystack: report, quote: judge }).ok, true,
    'this exact pair scored `unverified` on a real pass and cost a seed its verdict');

  // The other emphasis markers a report uses, and the inverse direction: a judge that KEEPS the
  // formatting must still match a report that has it.
  assert.equal(quotePresent({ haystack: report, quote: '**G-2: I dispute the drop.**' }).ok, true);
  assert.equal(quotePresent({ haystack: 'the `capture.mjs` guard is gone', quote: 'the capture.mjs guard is gone' }).ok, true);
  assert.equal(quotePresent({ haystack: 'a _quiet_ regression', quote: 'a quiet regression' }).ok, true);
  assert.equal(quotePresent({ haystack: 'a *quiet* regression', quote: 'a quiet regression' }).ok, true);

  // AND THE GUARANTEE IS UNCHANGED. Loosening formatting must not loosen anything else.
  assert.equal(quotePresent({ haystack: report, quote: 'G-2: I invented this sentence.' }).ok, false,
    'words that are not there are still not there');
  assert.equal(quotePresent({
    haystack: 'the anchor is wrong. the severity is right.',
    quote: 'the severity is right…the anchor is wrong',
  }).ok, false, 'fragments must still appear IN ORDER — an elision is not a licence');
  assert.equal(quotePresent({ haystack: 'anything at all', quote: 'an' }).ok, false,
    'a quotation too short to locate is still not verified');
  assert.equal(quotePresent({ haystack: 'abc', quote: '***' }).ok, false,
    'a quote that is nothing BUT formatting verifies nothing');
});

// ------------------------------- G-33: the loosening also let a fabricated identifier verify
// `panel-codex-code` against run 20260924-004905-today-review: "`flat` removes `_`, `*`, and
// backticks everywhere rather than only when they delimit Markdown, so semantic code text is
// altered during comparison and a fabricated quotation such as `maxbudget` can verify against
// `max_budget`."
//
// My own comment on that change called the collision possible and dismissed it — "two labels
// differing only in punctuation ... does not matter". It does: this module's entire job is
// refusing a quotation the source does not contain, and an underscore INSIDE a token is part of an
// identifier rather than punctuation around one.
//
// The markdown case that motivated the loosening was real and must keep working, so the rule is
// DELIMITER vs IDENTIFIER: strip these characters where they flank a word, keep them where they
// join one. Erring toward KEEPING is the safe direction here — a kept character can only make the
// check stricter, and strictness is what this module is for.
test('emphasis that DELIMITS is stripped; punctuation INSIDE a token is not', async () => {
  const { quotePresent } = await import('../scripts/lib/verbatim.mjs');

  // The case the loosening exists for — a judge quoting prose and dropping the markdown.
  assert.equal(quotePresent({
    haystack: '- **G-2: I dispute the drop.** It should be Confirmed at BLOCKER',
    quote: 'G-2: I dispute the drop. It should be Confirmed at BLOCKER',
  }).ok, true, 'a real citation that drops emphasis must still verify');
  assert.equal(quotePresent({ haystack: 'the `capture.mjs` guard is gone', quote: 'the capture.mjs guard is gone' }).ok, true);
  assert.equal(quotePresent({ haystack: 'a _quiet_ regression', quote: 'a quiet regression' }).ok, true);

  // THE COLLISION. An underscore joining two word characters is part of the identifier.
  assert.equal(quotePresent({
    haystack: 'the max_budget flag was dropped', quote: 'the maxbudget flag was dropped',
  }).ok, false, 'a fabricated identifier must not verify against a real one');
  assert.equal(quotePresent({
    haystack: 'set review.budget_usd_per_node to zero', quote: 'set review.budgetusdpernode to zero',
  }).ok, false);

  // And an identifier quoted correctly still verifies, with or without surrounding code ticks.
  assert.equal(quotePresent({ haystack: 'the max_budget flag', quote: 'the max_budget flag' }).ok, true);
  assert.equal(quotePresent({ haystack: 'the `max_budget` flag', quote: 'the max_budget flag' }).ok, true);
});

// ============ G-21 + G-22: one cluster, one claim — this module refuses a non-verbatim quotation
//
// G-21 (`panel-codex-code`): stripEmphasis removed a run with an alphanumeric on only ONE side, so
// `_private` normalised to `private` and `value_` to `value`. The G-33 fix narrowed the gap and did
// not close it: position alone cannot tell an identifier's leading underscore from an emphasis
// opener, because they look identical. What separates them is whether a matching CLOSER exists.
//
// G-22 (`panel-codex-contract`): fragments at or below `minFragment` were silently discarded, so
// `allowed … not` verified because `allowed` is present and `not` was thrown away. That reverses
// the meaning of the citation, which is worse than a near-miss — and the module's own header
// already says "a quotation too short to locate has not been verified". That rule was applied to
// the whole quote and never to the fragments it splits into.
test('emphasis is stripped only when it PAIRS; an unmatched marker is part of the token', async () => {
  const { flat, quotePresent } = await import('../scripts/lib/verbatim.mjs');

  // Identifiers keep their markers — nothing closes them.
  assert.equal(flat('_private'), '_private');
  assert.equal(flat('value_'), 'value_');
  assert.equal(flat('max_budget'), 'max_budget');
  assert.equal(flat('__dunder__'), '__dunder__', 'a leading and trailing pair around a word is ambiguous; keeping is the safe read');

  // Real emphasis still normalises, which is the case the loosening exists for.
  assert.equal(flat('_italic_'), 'italic');
  assert.equal(flat('**bold**'), 'bold');
  assert.equal(flat('`code`'), 'code');

  // The fabricated citation must now fail.
  assert.equal(quotePresent({ haystack: 'the _private field', quote: 'the private field' }).ok, false);
  // And the real one must still pass.
  assert.equal(quotePresent({
    haystack: '- **G-2: I dispute the drop.** It should be Confirmed at BLOCKER',
    quote: 'G-2: I dispute the drop. It should be Confirmed at BLOCKER',
  }).ok, true);
});

test('a fragment too short to locate FAILS the quote instead of vanishing from it', async () => {
  const { quotePresent } = await import('../scripts/lib/verbatim.mjs');

  // THE REVERSAL. `not` is three characters, was dropped, and the quote verified on `allowed`.
  const r = quotePresent({ haystack: 'allowed for every caller', quote: 'allowed…not' });
  assert.equal(r.ok, false, 'a citation cannot verify by discarding the half that carries its meaning');
  assert.match(String(r.why ?? r.missing ?? ''), /too short|not found/i);

  // A genuinely short-but-locatable elision is still a failure to locate, not a silent pass — the
  // module's whole contract is that an unverifiable citation is refused rather than assumed.
  assert.equal(quotePresent({ haystack: 'allowed but not for every caller', quote: 'allowed…not' }).ok, false);

  // Ordinary multi-fragment quotes are unaffected.
  assert.equal(quotePresent({
    haystack: 'the anchor is wrong and the severity is right',
    quote: 'the anchor is wrong…the severity is right',
  }).ok, true);
});
