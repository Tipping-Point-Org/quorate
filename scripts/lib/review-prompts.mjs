// Prompt construction for EXTERNAL reviewer arms. Keep this module pure so prompt changes can be
// regression-tested without launching a paid reviewer.
//
// One builder, one constraints block, one feedback ask — for every external reviewer and every
// external prompt. The tie-break prompt used to be written by hand in run-graph, and it was the
// single prompt in the system that carried neither the external-arm constraints (read-only, no
// nested reviewers, no capture.mjs, read the source by whatever means you have) nor the
// brief-feedback ask that shared/external-reviewers.md mandates for EVERY brief the panel sends.
// I-8 names agy explicitly; I-9 names "constraints stated for codex but not for agy" as a failure
// mode. Both tie-break nodes then came back DEGRADED with zero findings — the third family spawned
// and producing nothing, in the one place adjudicating a genuine cross-family dispute.
//
// The vendor is a parameter for the same reason: `arm.reviewer` is threaded through the adapter
// flag, the credential allow-list, the probe, the source tag and the status record, and was
// hardcoded in exactly one place — the sentence telling the model which reviewer it is. A seam
// that is swappable everywhere except the input that names it is not swappable.

/** The ask shared/external-reviewers.md mandates for EVERY brief this panel sends. ONE owner. */
import path from 'node:path';
import { requireIo } from './io-param.mjs';
import { renderTemplate, readTemplate } from './template.mjs';
import { ruleTable } from './rule-text.mjs';
// The adapter table, for the one fact a prompt needs from it: what to call this vendor.
import { builtinReviewers } from './reviewers.mjs';
import { CENSUS_FIELDS, censusRows } from './census.mjs';

// THE PROMPTS LIVE IN prompts/_templates/, NOT IN THIS FILE.
//
// 187 lines of model-facing prose lived here as template literals, and this was one of four places:
// the run brief in run-graph.mjs, the node prompt head in spawn-node.mjs, and the schema
// `description:` strings that reach the model through --json-schema. A framework whose SUBJECT is
// model instructions kept most of its own instructions inside its orchestrator, where a prompt
// author cannot find them and where editing prose means editing control flow.
//
// `_templates` rather than a node id, because these are FRAGMENTS the engine assembles rather than
// contracts handed to a node; the underscore keeps them out of the roster's node enumeration.
//
/**
 * A schema field's description — the text a model reads to decide what to put in that field.
 *
 * It reaches the model verbatim through --json-schema, so it is prompt content, and it lived as
 * string literals inside spawn-node.mjs's schema builder. Throws on an unknown field for the same
 * reason readTemplate throws on a missing file: a schema field whose description silently became
 * `undefined` is a field the model has to guess at, and the guess looks like an answer.
 */
export function schemaField(name, io) {
  const table = ruleTable('schema-fields.json', io);
  const text = table[name];
  if (typeof text !== 'string') {
    throw new Error(`no description for schema field '${name}' in prompts/_templates/schema-fields.json`);
  }
  return text;
}

// BRIEF_FEEDBACK, EXTERNAL_ARM_CONSTRAINTS and TIE_BREAK_CONSTRAINTS were read here AT LOAD TIME, and a
// module load cannot be handed `io`. They are exported, read once for the host, by
// scripts/io/codex-prompts.mjs; the builders below read the same templates through their own `io`.

/**
 * How a vendor id is named to the model — FROM THE ADAPTER TABLE (G-22, arch-review).
 *
 * It was a second registry here, keyed by the same ids scripts/reviewers.json owns: a reviewer's
 * model-facing name declared in a source file the adapter table could not reach, so adding an
 * adapter needed an undeclared second edit or the model was told the raw key. `claude` was already
 * in the table and absent from the map, which is the shape of the problem rather than a symptom of
 * it. An id with no declared label is still used verbatim — guessing at a vendor's name is worse
 * than printing the one the operator chose.
 */
export function vendorLabel(reviewer, table = null, io = null) {
  const id = String(reviewer ?? 'external');
  // Without a table, io is REQUIRED: the old fallback swallowed any failure to read the table into `{}`,
  // and a missing io would then have silently printed the raw id instead of failing.
  if (!table) requireIo(io, 'vendorLabel');
  // A table that cannot be read or parsed FAILS here (G-15 of 20261122-002915-m3s7-b2-remediation-review): the catch that
  // turned it into `{}` was the fallback this comment says is gone, and it printed the raw id instead.
  const adapters = table ?? builtinReviewers(io);
  const label = adapters?.[id]?.label;
  return typeof label === 'string' && label.trim() ? label : id;
}

/**
 * The constraints EVERY external prompt carries -- shadow arms and the tie-break alike.
 * Extracted so there is exactly one copy: the tie-break prompt was written by hand in run-graph
 * and carried none of them, which is the one prompt whose reviewer then produced nothing.
 */

/** Remove SKILL.md frontmatter; triggering metadata is not part of the review contract. */
export function skillInstructions(markdown) {
  const text = String(markdown ?? '').replace(/^\uFEFF/, '');
  if (!text.startsWith('---')) return text.trim();
  const end = text.indexOf('\n---', 3);
  return end === -1 ? text.trim() : text.slice(end + 4).trim();
}

/**
 * The lens brief WITHOUT its capture mechanics, for a reviewer that has no capture channel.
 *
 * The docstring below has always said this prompt replaces "internal-only capture instructions with
 * the external arm's honest evidence contract". It did not: the brief was embedded verbatim, so the
 * §Evidence block went out intact — including the ABSOLUTE path of the run directory, which is the
 * one location the arms' isolated worktree exists to put out of reach (G-27, panel-codex-security).
 * A prompt that hands over the coordinates undoes a containment built by construction, and the
 * arm-constraints line telling the reviewer not to read that directory is labelled in this
 * repository, correctly, as defence in depth rather than a boundary.
 *
 * It is also instructions the arm cannot follow. An external reviewer runs outside the run sandbox,
 * has no capture.mjs, and its findings rest on `convention` for exactly that reason — so this
 * section was never anything but a route to a path it should not have.
 *
 * Cut at the heading and resumed at the next one, so the rest of the brief — scope, stamps, the
 * threat model, the declared commands — arrives unchanged. A brief with no such section is returned
 * untouched rather than guessed at.
 */
export function stripCaptureSection(brief, io) {
  const text = String(brief ?? '');
  const HEADING = String.fromCharCode(10) + String.fromCharCode(35, 35) + " Evidence";
  const start = text.indexOf(HEADING);
  if (start === -1) return text;
  const rest = text.slice(start + 1);
  const nextHeading = rest.slice(1).search(new RegExp(String.fromCharCode(10) + String.fromCharCode(35, 35) + String.fromCharCode(32)));
  const after = nextHeading === -1 ? '' : rest.slice(1 + nextHeading + 1);
  // The arm's honest evidence contract, from the prompt library rather than from a string array here.
  // THE DETECTOR, kept (G-1 of 20261105-212751-sogsr-delivery): the cut section held the one command the
  // inert-feature sweep needs, so an arm told to run it was given no path. It returns RELATIVE to the repository
  // root, which is the arm's working directory; a detector outside the repository is not handed over.
  const section = nextHeading === -1 ? rest : rest.slice(0, 1 + nextHeading + 1);
  const detector = armDetectorPath(text, section);
  // A path holding whitespace goes QUOTED, whole; a detector outside the arm's working directory is SAID to be absent,
  // never dropped with no word (G-15 of 20261122-014737-m3s7-b2-review-2).
  const detectorText = detector?.rel
    ? renderTemplate(readTemplate('arm-detector-command.md', io), { detector_rel: /\s/.test(detector.rel) ? `"${detector.rel}"` : detector.rel }, 'arm-detector-command.md')
    : detector?.outside ? readTemplate('arm-detector-absent.md', io) : '';
  const replacement = String.fromCharCode(35, 35) + ' Evidence' + String.fromCharCode(10)
    + readTemplate('arm-evidence-contract.md', io)
    + detectorText;
  return text.slice(0, start + 1) + replacement + String.fromCharCode(10) + after;
}

/**
 * The detector named in the section: `{ rel }`, its path relative to the brief's `repository_root`; `{ outside: true }`
 * when it lies outside that root (or cannot be made relative); null when the section names none or the brief no root.
 *
 * The path is everything after the LAST `node ` before `find-inert-features.mjs` on its line, an optional quote
 * stripped: `\S*` cut a path holding a space, and the arm silently got no command (G-15 of
 * 20261122-014737-m3s7-b2-review-2).
 */
function armDetectorPath(brief, section) {
  const rootLine = /^repository_root:[ \t]*(.+?)[ \t]*$/m.exec(brief);
  const line = section.split(/\r?\n/).find((l) => l.includes('find-inert-features.mjs'));
  if (!rootLine || line === undefined) return null;
  const head = line.slice(0, line.indexOf('find-inert-features.mjs') + 'find-inert-features.mjs'.length);
  const starts = /(?:^|[ \t])node[ \t]+/g;
  let from = -1;
  for (let m = starts.exec(head); m; m = starts.exec(head)) from = m.index + m[0].length;
  if (from === -1) return null;
  const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const root = norm(rootLine[1]);
  const abs = norm(head.slice(from).replace(/^["']/, ''));
  if (!root || abs.slice(0, root.length + 1).toLowerCase() !== `${root}/`.toLowerCase()) return { outside: true };
  const rel = abs.slice(root.length + 1);
  return rel.split('/').some((s) => s === '..' || s === '') ? { outside: true } : { rel };
}

/**
 * The `## Criteria` section of an intent document, and NOTHING else from it.
 *
 * The narrowness is a containment decision, not a size one. `intent.md` for the arch-declared run was
 * 76 KB, of which 65 KB was the 57 criteria — and the two absolute paths in the file
 * (`story-pipeline\.claude\skills\adjudication-panel`, the operator's OTHER project) sat outside
 * the criteria section, in the sources notes. Inlining the whole document into a prompt bound for a
 * third-party cloud would have sent a local filesystem layout and the name of an unrelated private
 * project, neither of which is a review criterion. Cutting at the heading keeps the one thing the arm
 * needs and leaves behind the one thing it must not have — the same trade `stripCaptureSection` makes
 * about the run directory's absolute path.
 *
 * Returns the empty string when there is no such section, so the caller states the gap rather than
 * inlining a guess.
 */
export function criteriaSection(intentText) {
  const text = String(intentText ?? '');
  const HEADING = String.fromCharCode(10) + String.fromCharCode(35, 35) + ' Criteria';
  const start = text.indexOf(HEADING);
  if (start === -1) return '';
  const rest = text.slice(start + 1 + HEADING.length - 1);
  const next = rest.search(new RegExp(String.fromCharCode(10) + String.fromCharCode(35, 35) + String.fromCharCode(32)));
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/**
 * The criteria INLINED, for a reviewer that may not read the run directory.
 *
 * The sibling of `stripCaptureSection`, and it exists for the same reason: the brief carries an
 * instruction only an internal lens can follow. `## Intent` tells the node "intent.md: read it. Every
 * finding you emit MUST cite an I-n criterion from it" — and an external arm is forbidden the run
 * directory, so it was handed an order it had to refuse. `panel-codex-contract` refused it exactly
 * that way, in its own words:
 *
 *   "The authoritative intent.md criteria were not provided inline and the external-arm rules
 *    prohibit reading the run directory, so the declared request was reviewed but complete I-n
 *    coverage could not be verified."
 *
 * That was the correct answer to a broken prompt. The arm shadowing `contract-audit` is the one node
 * whose entire question is "did the code do what was asked?", and it was the only one structurally
 * unable to see the ask. Opening the run directory would fix it the wrong way: containment there is
 * built by construction, and what leaves the machine must stay bounded to what the framework composed.
 * So the criteria travel INTO the prompt, where they are reviewable, instead of the arm travelling out
 * to fetch them.
 *
 * NOT TRUNCATED, deliberately. The arm's job is to certify that every numbered criterion was covered,
 * so a silently shortened list would produce a coverage claim over criteria it never saw — worse than
 * the honest refusal this replaces. Where the criteria are absent the gap is stated in the prompt in
 * the words the arm should give back.
 */
export function inlineIntentSection(brief, criteria, { intentMode, io } = {}) {
  const text = String(brief ?? '');

  // ONE OWNER FOR THE INTENT POLICY, AND IT IS NOT THIS FUNCTION (G-22, HIGH, four nodes).
  //
  // This decided what to write by asking whether `criteria` was empty. run-graph fills criteria only
  // for a lens declaring intent: 'required', so empty carried two unrelated meanings — "this lens may
  // not cite intent" and "intent.md could not be read" — and the first was answered with the second's
  // text. Every intent:forbidden arm had run-graph's correct withheld block replaced by "the criteria
  // were NOT supplied ... record this exact gap in not_checked[]", and in run
  // 20260914-004236-postfix-timeout-criteria all five non-contract arm prompts carried it while three
  // status files carried the fabricated gap it ordered.
  //
  // The cost was not the wrong sentence. The engine reads an arm's not_checked[] when deciding whether
  // an empty result is clean, so a REAL read failure on the contract arm became indistinguishable from
  // four manufactured ones — noise raised to the authority of a finding.
  //
  // So the lens's MODE decides and emptiness decides nothing. A forbidden arm's brief is returned
  // exactly as run-graph wrote it: this function has no opinion to add about a node that may not cite
  // intent at all. The mode is passed in rather than inferred, because inferring intent policy from a
  // value that does not carry it is the whole defect.
  if (intentMode !== 'required') return text;

  const HEADING = String.fromCharCode(10) + String.fromCharCode(35, 35) + ' Intent';
  const start = text.indexOf(HEADING);
  if (start === -1) return text;
  const rest = text.slice(start + 1);
  const nextHeading = rest.slice(1).search(new RegExp(String.fromCharCode(10) + String.fromCharCode(35, 35) + String.fromCharCode(32)));
  const after = nextHeading === -1 ? '' : rest.slice(1 + nextHeading + 1);

  // THE SENTENCES LIVE IN prompts/_templates/, NOT HERE (G-20).
  //
  // These two branches were seven paragraphs of model-facing prose as JS string arrays, in a file whose
  // line 27 says prompts do not live here. A prompt author editing templates could not find them, and
  // changing a sentence meant editing control flow. The guard written for exactly this defect pinned
  // three already-moved strings, so it could not fail on prose added after it — see
  // tests/regression-prompt-prose-allowlist.test.mjs, which is a whitelist for that reason.
  const body = String(criteria ?? '').trim()
    ? renderTemplate(readTemplate('arm-intent-inlined.md', io),
      { criteria: String(criteria).trim() }, 'arm-intent-inlined.md')
    : readTemplate('arm-intent-unavailable.md', io);

  const replacement = String.fromCharCode(35, 35) + ' Intent' + String.fromCharCode(10) + body;
  return text.slice(0, start + 1) + replacement + String.fromCharCode(10) + after;
}

/**
 * Give a Codex shadow arm the same review criteria and run scope as the lens it shadows, while
 * replacing internal-only capture instructions with the external arm's honest evidence contract.
 */
/*
 * ONE ask, whoever supplies it. run-graph appends BRIEF_FEEDBACK to every lens brief (line ~570) and
 * the brief is embedded whole below, so appending unconditionally asked the highest-volume external
 * brief in the system for its feedback TWICE (G-16, G-45) — and the document promising "one feedback
 * ask per external prompt" then described neither the old paraphrase nor the new duplicate.
 *
 * The check is on the brief's content rather than on a flag the caller passes, because the caller
 * that knows is the one assembling the brief and it is not this one.
 */
// NAMED FOR THE ROLE, NOT THE VENDOR (G-14). Generic panel orchestration imported this and used
// it for whichever `arm.reviewer` the adapter table selected, so a concrete provider sat in the
// one interface the adapter table exists to make swappable (I-4, ARCHITECTURE §4). The module
// path still carries the name and is tracked separately under consumer-owned-configuration AC 6.
// NO VENDOR DEFAULT (G-9 — arch-review, contract-audit and two arms, independently). The rename
// moved the vendor out of the NAME and left `reviewer = 'codex'` in the signature, so an omission
// labelled the arm codex in the one sentence that tells the model which reviewer it is. The
// orchestrator passes `arm.reviewer`, so the default was reachable only by mistake — and a mistake
// that misattributes an arm is exactly the harm the rename was for. `vendorLabel` already resolves
// an absent reviewer to the neutral "external", so omission now claims nothing false.
/**
 * Where the arms' directory holds the census of the remediation a review follows (20261020-132503-ciss-remediation-5-
 * review): run-graph copies the run's census there, and the arm's prompt names it, because the run directory the lens's
 * brief names is one an arm may not read. Outside git: the arms' directory is a build of its own.
 */
export const ARM_CENSUS_PATH = '.quorate-arm/remediation-census.json';

export function buildArmShadowPrompt({ lensId, skillMarkdown, runBrief, reviewer, intentCriteria = '', intentMode, censusLeftOut = null, io }) {
  requireIo(io, 'buildArmShadowPrompt');
  const BRIEF_FEEDBACK = readTemplate('brief-feedback.md', io);
  const ARM_ROOT = readTemplate('arm-repository-root.md', io).trim();
  const lens = skillInstructions(skillMarkdown);
  // Two internal-only instructions, two replacements, in the order the brief carries them. Both are
  // orders an external arm cannot obey: one points at a capture channel it does not have, the other at
  // a run directory it is forbidden.
  const brief = inlineIntentSection(stripCaptureSection(String(runBrief ?? '').trim(), io), intentCriteria, { intentMode, io })
    // A third: the census copy is named relative to the run directory, and an arm reads its copy in the arms' directory.
    // A census LEFT OUT of that directory (`censusLeftOut`, its cause) is named there instead, never pointed at a copy that
    // was not written (G-6 of 20261115-035028-pbr-1b-remediation-3-review; ARCHITECTURE.md A-30, a context input refused is
    // "named in the node's brief").
    .replace(/, copied into this run, relative to its run directory: \S+/g, () => (censusLeftOut
      ? renderTemplate(readTemplate('arm-census-left-out.md', io), { reason: String(censusLeftOut) }, 'arm-census-left-out.md').trim()
      : `, copied into the directory you review: ${ARM_CENSUS_PATH}`))
    // A fourth (G-10 of 20261115-013659-pbr-1b-delivery): the brief names the operator's checkout by its absolute path, and
    // an arm whose sandbox does not confine reads could follow it past the filtered surface it was given to review.
    .replace(/^repository_root: .*$/gm, () => `repository_root: ${ARM_ROOT}`);

  return renderTemplate(readTemplate('shadow-arm.md', io), {
    vendor: vendorLabel(reviewer, null, io),
    lens_id: lensId,
    arm_constraints: readTemplate('external-arm-constraints.md', io),
    lens_contract: lens,
    run_brief: brief,
    // Not appended twice. The brief a lens receives already carries the feedback ask; an arm
    // shadowing that lens is handed the same text, and asking again in one prompt reads as two
    // different questions to a model that answers both.
    brief_feedback: brief.includes(BRIEF_FEEDBACK.trim()) ? '' : BRIEF_FEEDBACK,
  }, 'shadow-arm.md');
}

/**
 * The tie-break prompt: ONE disputed group, adjudicated by a third family.
 *
 * This was written by hand in run-graph and was the only external prompt in the system carrying
 * neither EXTERNAL_ARM_CONSTRAINTS nor BRIEF_FEEDBACK. shared/external-reviewers.md mandates the
 * feedback ask for every brief the panel sends and names agy explicitly; "constraints stated for
 * codex but not for agy" is a named failure mode. Both tie-break nodes came back DEGRADED with
 * zero findings, so the third family was spawned and produced nothing at exactly the point where a
 * genuine cross-family dispute needed deciding.
 *
 * It deliberately does NOT ask for a re-review: the tie-breaker rules on one contested group from
 * the positions already taken, and widening that into a fresh review is how a tie-break turns into
 * an unbounded third opinion.
 */
/**
 * The tie-break's OWN constraints. It does not inherit EXTERNAL_ARM_CONSTRAINTS.
 *
 * That block tells a reviewer to read the repository "by WHATEVER means your environment gives you
 * — a file-reading tool if you have one, and otherwise ordinary read-only shell commands". Correct
 * for a shadow arm: codex runs in a read-only sandbox and can. Fatal for the tie-breaker: agy runs
 * headless, a tool needing the `command` permission is auto-denied because there is nobody to
 * prompt, and agy then returns an EMPTY response while reporting SUCCESS. One constraints block for
 * two different execution environments, instructing one of them to do the thing it cannot do.
 *
 * A tie-break does not need to browse anyway. Its whole job is to rule on ONE group from evidence
 * that is supplied to it — the prompt already says "do not re-review the codebase" — so the honest
 * instruction is to rule from what is here and say so when that is not enough.
 */

/**
 * The adjudication brief — ONE rendering, handed to every judge verbatim.
 *
 * IT NAMES NO JUDGE, and that is a change from the tie-break version it replaces. The old brief
 * opened "You are <vendor>, the independent tie-breaker", which meant a panel of three judges read
 * three different documents and any disagreement was partly a measurement of the wording. The
 * source work states the rule plainly: "The script renders the same brief for every judge... the
 * brief is blind: it names no model."
 *
 * It also says "tie-breaker" exactly once, in the sentence DENYING the role — and that is now
 * asserted rather than described (G-17). This docstring claimed the brief "no longer says
 * tie-breaker" while the constraints fragment it embeds was titled "# Tie-breaker constraints" and
 * called an undecided answer "a legitimate ruling", three lines after the denial: every judge was
 * told it is not the tie-breaker and then handed that role's constraints by name. A judge told it is
 * the tie-breaker is being told its vote
 * decides, which is exactly the framing the merge removed: a split is the result.
 */
export function buildTieBreakPrompt({
  groupId, file, line, rationale, findings = [], excerpt = null,
  judgeCount = 1, voteVocabulary = '', mechanicalFacts = '', io,
}) {
  requireIo(io, 'buildTieBreakPrompt');
  // The excerpt the doctrine promises. Its ABSENCE is stated rather than left blank: a tie-breaker
  // that cannot see the code must know that is why, so it can rule "the evidence here does not
  // settle it" instead of guessing at a file it was never shown.
  // The excerpt's header tells the judge how to read it, so it is the prompt library's (consumer-owned-configuration.md AC2).
  const excerptBlock = excerpt?.ok
    ? renderTemplate(readTemplate('tie-break-excerpt.md', io),
      { file, from: excerpt.from, to: excerpt.to, of: excerpt.of, body: excerpt.body }, 'tie-break-excerpt.md').trim()
    : renderTemplate(readTemplate('tie-break-excerpt-missing.md', io),
      { why: excerpt?.why ?? 'no excerpt was supplied' }, 'tie-break-excerpt-missing.md').trim();

  const positions = findings.length
    ? findings.map((f) => `- [${f.node_id}${f.source ? ` · ${f.source}` : ''}] ${f.claim}`).join('\n')
    : readTemplate('tie-break-no-positions.md', io).trim();

  return renderTemplate(readTemplate('tie-break.md', io), {
    judge_count: String(judgeCount),
    vote_vocabulary: voteVocabulary || readTemplate('tie-break-no-votes.md', io).trim(),
    tie_constraints: readTemplate('tie-break-constraints.md', io),
    group_id: groupId,
    file: file ?? '?',
    line: line ?? '?',
    rationale: rationale ?? '(none)',
    positions,
    // MECHANICAL FACTS ARE THE SCRIPT'S JOB. "A fact judges have to compute is a fact judges
    // compute differently" — measured upstream, where one judge raised an objection 59 times that
    // two others never raised, and 48 of the 59 were a string comparison nobody had done for them.
    mechanical_facts: mechanicalFacts || '- (none stated for this group)',
    excerpt: excerptBlock,
    brief_feedback: readTemplate('brief-feedback.md', io),
  }, 'tie-break.md');
}

/**
 * THE CROSS-FAMILY CLAIM CHECKER'S PROMPT (claim-check-cross-family.plan.md stage 2): `checker` is
 * `skills/claim-check/CHECKER.md`, carried unchanged, then the paths the brief says follow it. The one override is the
 * output channel — the arm runs read-only and cannot write the result file, so it answers with the JSON. The transcript
 * line is present only when `review.claim_check_transcript` let one be sent; the caller decides, this renders.
 */
export function buildClaimCheckArmPrompt({ checker, draftPath, repoRoot, transcriptPath = null, io }) {
  requireIo(io, 'buildClaimCheckArmPrompt');
  return renderTemplate(readTemplate('claim-check-arm.md', io), {
    checker: String(checker ?? ''),
    draft: String(draftPath ?? ''),
    repo: String(repoRoot ?? ''),
    // The line's prose is a template's (G-16 of 20261121-233915-m3s7-b2-review): only whether it is sent is decided here.
    transcript: transcriptPath
      ? renderTemplate(readTemplate('claim-check-arm-transcript.md', io), { path: String(transcriptPath) }, 'claim-check-arm-transcript.md').trim() + '\n'
      : '',
  }, 'claim-check-arm.md');
}

/**
 * ONE SEAT'S PROMPT FOR ONE ROUND OF THE DECISION PANEL (autonomous-run.plan.md stage 4). `view` is
 * lib/decision-panel.mjs's `roundView` — the blinded question and every entry, with each entry's reasons under this
 * round's letters from round 2 on — so nothing here can show a seat what that function withholds. `context` is the work
 * context the caller built in code (the request or plan, the stage, the changed files), never the conversation. No
 * family or vendor is named anywhere in it (A-9; the seats are anonymous).
 */
export function buildDecisionSeatPrompt({ view, letter, context = '', io }) {
  requireIo(io, 'buildDecisionSeatPrompt');
  const entries = (view?.entries ?? []).map((e) => {
    const head = `- **${e.id}**${e.from ? ` (a change of ${e.from})` : ''}: ${e.label}${e.description ? ` — ${e.description}` : ''}`;
    const reasons = (e.reasons ?? []).map((r) => `  - Judge ${r.by}, round ${r.round}: ${r.reason}`);
    return [head, ...reasons].join('\n');
  }).join('\n');
  const round = Number(view?.round ?? 1);
  return renderTemplate(readTemplate('decision-seat.md', io), {
    letter: String(letter ?? ''),
    round: String(round),
    round_note: readTemplate(round <= 1 ? 'decision-seat-round-1.md' : 'decision-seat-later-round.md', io).trim(),
    context: String(context ?? '').trim() || '(none given)',
    question: String(view?.question ?? ''),
    entries,
  }, 'decision-seat.md');
}

/**
 * THE MODERATOR'S PROMPT (autonomous-run.plan.md stage 5, design AR-D3): the blinded question, every entry with every
 * reason so far, and each round's votes, all under letters (the seats' letters of the round they spoke in), never a seat
 * id or a family. `state` is lib/decision-panel.mjs's panel state; the moderator does not vote.
 */
export function buildDecisionModeratorPrompt({ state, hardCap, io }) {
  requireIo(io, 'buildDecisionModeratorPrompt');
  const letterOf = (seat, round) => state.rounds.find((r) => r.round === round)?.letters?.[seat] ?? '?';
  const entries = state.entries.map((e) => {
    const head = `- **${e.id}**${e.from ? ` (a change of ${e.from})` : ''}: ${e.label}${e.description ? ` — ${e.description}` : ''}`;
    const reasons = e.reasons.map((r) => ({ ...r, by: letterOf(r.seat, r.round) }))
      .map((r) => `  - Judge ${r.by}, round ${r.round}: ${r.reason}`);
    return [head, ...reasons].join('\n');
  }).join('\n');
  const SILENT = '(no readable answer)';
  const votes = state.rounds.map((r) => `- Round ${r.round}: ` + r.votes
    .map((v) => ({ by: r.letters[v.seat] ?? '?', entry: v.entry ?? SILENT }))
    .map((v) => `Judge ${v.by} ${v.entry}`).join(', ')).join('\n');
  return renderTemplate(readTemplate('decision-moderator.md', io), {
    rounds: String(state.rounds.length), hard_cap: String(hardCap), question: String(state.question ?? ''), entries, votes,
  }, 'decision-moderator.md');
}

/**
 * THE REVOTE NOTE'S AUTHOR'S BRIEF (decision-records.plan.md stage 5; design DR-D1 A): a fresh subagent, given ONLY the
 * question, its options and the work context, writes the note the revote's seats read. It takes those three fields by
 * name, so nothing else (round 1, the seats' replies, the asking session's text, a transcript path) can reach it through
 * here. It runs outside the repository (runtimeCall), which keeps it from DISCOVERING the decision records by looking
 * around its working directory; it does not stop a read of an absolute path, so what keeps the record out of the note is
 * that nothing here names one (G-16 of 20261122-014737-m3s7-b2-review-2).
 */
export function buildRevoteAuthorPrompt({ question, options, context, io }) {
  requireIo(io, 'buildRevoteAuthorPrompt');
  const list = (Array.isArray(options) ? options : []).map((o, i) => {
    const label = String(o?.label ?? '');
    const desc = o?.description ? ` — ${o.description}` : '';
    return `- **E${i + 1}**: ${label}${desc}`;
  }).join('\n');
  return renderTemplate(readTemplate('decision-revote-author.md', io), {
    question: String(question ?? ''), options: list, context: String(context ?? ''),
  }, 'decision-revote-author.md');
}

/**
 * THE SAME-FAMILY CLAIM CHECKER'S BRIEF (claim-check-cross-family.plan.md stage 4), spawned through spawn-subagent.mjs on
 * the node runtime, and named for that role rather than a vendor (A-9; G-5 of 20261025-235636-tel-remediation-5-review).
 * `armClaims`, when given, is the fallback's scope: the cross-family arm's claim list, of which this checker grades only
 * the attributions, under the arm's ids, adding any the arm did not list.
 */
export function buildClaimCheckSameFamilyBrief({ checker, draftPath, resultPath, repoRoot, transcriptPath = null, armClaims = null, io }) {
  requireIo(io, 'buildClaimCheckSameFamilyBrief');
  const scope = armClaims
    ? renderTemplate(readTemplate('claim-check-same-family-scope.md', io), {
      claims: JSON.stringify(armClaims.map(({ id, text, kind }) => ({ id, text, kind })), null, 2),
    }, 'claim-check-same-family-scope.md')
    : '';
  // The templates are named for the role, not a vendor (A-9; G-19 of 20261122-002915-m3s7-b2-remediation-review), and the
  // transcript line is prose from the prompt library (G-20 there).
  const transcript = transcriptPath
    ? renderTemplate(readTemplate('claim-check-same-family-transcript.md', io), { path: String(transcriptPath) },
      'claim-check-same-family-transcript.md').trim() + '\n'
    : '';
  return renderTemplate(readTemplate('claim-check-same-family.md', io), {
    checker: String(checker ?? ''),
    draft: String(draftPath ?? ''),
    result: String(resultPath ?? ''),
    repo: String(repoRoot ?? ''),
    transcript,
    scope,
  }, 'claim-check-same-family.md');
}

/**
 * THE FOLLOW-UP REVIEW'S CENSUS SECTION (observation-guard-and-sibling-census.md, B). Its sentences are templates
 * (G-3 of 20261017-031552-ogsc-review); the counts are lib/census's censusRows. `payloadPath` names the copy
 * run-graph made inside the review's own run, the one directory a lens may read beside the repository (G-5).
 */
export function censusSection({ followsRemediation, payload = null, payloadPath = '', refused = null, io } = {}) {
  if (!followsRemediation) return '';
  requireIo(io, 'censusSection');
  // A read its owner REFUSED is said to be refused (G-13 of 20261029-224143-rdr-remediation-3-review): "could not be
  // read" hid that a link stood below the admitted run.
  if (refused) {
    return renderTemplate(readTemplate('remediation-census-refused.md', io),
      { run_id: followsRemediation.run_id, reason: String(refused) }, 'remediation-census-refused.md');
  }
  const rows = censusRows(payload);
  if (!rows) {
    return renderTemplate(readTemplate('remediation-census-unreadable.md', io),
      { run_id: followsRemediation.run_id }, 'remediation-census-unreadable.md');
  }
  const none = readTemplate('remediation-census-row-none.md', io);
  const lines = rows.map((r) => (r.counts
    ? `  - ${r.group_id}: ${CENSUS_FIELDS.map((f) => `${r.counts[f]} ${f}`).join(', ')}`
    : renderTemplate(none, { group_id: r.group_id }, 'remediation-census-row-none.md').trimEnd()));
  return renderTemplate(readTemplate('remediation-census.md', io), {
    run_id: followsRemediation.run_id, payload_path: payloadPath, rows: lines.join('\n'),
  }, 'remediation-census.md');
}
