// The decision panel's rules (autonomous-run.plan.md stage 2): what a question with options must be to reach the panel,
// what each seat may see, what counts as a vote, and when the talk ends. Three seats of different families answer a
// question the session would otherwise put to the operator (autonomous-run.md criteria 1, 7, 9, 14-17; design AR-D2,
// AR-D3, AR-D4). The seats are models; these rules are code because none of them is a rule a model is trusted to apply
// to its own answer.
//
// Pure: no I/O, no clock, no environment (ARCHITECTURE §2). The seats' calls, the record on disk and the caps' contract
// keys belong to the callers.

import { familyOfCall } from './reviewers.mjs';
import { resolveCitation } from './claim-check.mjs';
import path from 'node:path';
import { absolute } from './paths.mjs';
import { rootEvidencePath, isRunEvidence, foldIf } from './evidence-path.mjs';
import { confined } from './confined-path.mjs';

/**
 * THE QUESTIONS THAT NEVER REACH THE PANEL, flag on or off (design AR-D6): one value per bullet of
 * `shared/session-rules.md`'s "What waits for the operator". The category is the asking session's declaration; a question
 * misfiled as `delegable` reaches the panel, which is the residual the rule names.
 */
export const RESERVED_CATEGORIES = Object.freeze(['approval', 'destructive', 'environment', 'unrelated-program',
  // A-23 items 3 and 4, categories of their own (operator, 2026-10-31; G-21 of 20261101-023925-ar-remediation-2-review).
  'governing-change', 'metered-egress']);
export const CATEGORIES = Object.freeze([...RESERVED_CATEGORIES, 'delegable']);

/**
 * THE BULLETS OF `shared/session-rules.md`'s "What waits for the operator", one per reserved category, in its order. That
 * section is a marked region (`rule:reserved-decisions`) that scripts/gen-rule-text.mjs writes from this list
 * (autonomous-run.plan.md stage 5), so the prose a session reads and the set decide.mjs refuses cannot drift apart.
 */
export const RESERVED_RULES = Object.freeze([
  { category: 'approval', title: 'Approvals', text: 'of a request, a plan, a decision, or an operator close in the ledger.' },
  { category: 'destructive', title: 'Destructive actions',
    text: 'anything that cannot be undone from git or from a backup. A backup counts only when it is known to be taken and up to date; it is never assumed.' },
  { category: 'environment', title: 'Changes to the operator\'s environment',
    text: 'installing or updating a program, global configuration.' },
  { category: 'unrelated-program', title: 'Starting an installed program unrelated to the work', text: '' },
  { category: 'governing-change', title: 'Changes to what governs every run',
    text: 'the contract, the lens roster, or ARCHITECTURE.md (ARCHITECTURE.md A-23, item 3).' },
  { category: 'metered-egress', title: 'Egress metered per call by an API key',
    text: 'a call billed per invocation against a key, not subscription egress (ARCHITECTURE.md A-23, item 4).' },
]);

/** The region's body: one bullet per reserved category, its category id beside its title. */
export function renderReservedRules() {
  return RESERVED_RULES.map((r) => (r.text
    ? `- **${r.title}** (\`${r.category}\`): ${r.text}`
    : `- **${r.title}** (\`${r.category}\`).`)).join('\n');
}

/** Whether a question of this category may go to the panel; a missing or unknown category is refused, never guessed. */
export function checkCategory(category) {
  if (category === undefined || category === null || category === '') {
    return { ok: false, reason: `the question declares no category; one of ${CATEGORIES.join(' | ')} is required` };
  }
  if (!CATEGORIES.includes(category)) {
    return { ok: false, reason: `unknown category ${JSON.stringify(category)}; one of ${CATEGORIES.join(' | ')} is required` };
  }
  if (RESERVED_CATEGORIES.includes(category)) {
    return { ok: false, reason: `category '${category}' is reserved for the operator (shared/session-rules.md, "What waits for the operator")` };
  }
  return { ok: true, reason: null };
}

// The markers this repository's questions carry: a label suffix "(Recommended)" or "(suggested)", a trailing
// "— suggested", and a "Suggested: …" or "Recommended: …" sentence in a description or the question. The trailing mark
// ends A LINE, not only the text (G-14 of 20261101-032931-ar-remediation-3-review): a multiline note carried it through
// on every line but the last; `[ \t]` keeps the match from eating the line break.
const LABEL_MARKS = [/\s*\((?:recommended|suggested)\)/gi, /[ \t]*[—–-]+[ \t]*(?:recommended|suggested)[ \t]*(?=\r?$)/gim];
const SENTENCE_MARK = /\s*\b(?:suggested|recommended|recommendation|suggestion)\s*:[^\n.]*\.?/gi;
const clean = (s, marks) => marks.reduce((t, m) => t.replace(m, ''), String(s ?? '')).trim();

/**
 * THE QUESTION AS A SEAT SEES IT (criterion 7): every recommendation marker removed, the substance kept. A question with
 * fewer than two options is not a question with options, so it is refused.
 */
export function blindQuestion({ question, options, evidence }) {
  if (!Array.isArray(options) || options.length < 2) throw new Error('a question for the panel needs at least two options');
  return {
    // THE EVIDENCE IT NAMES, SHOWN TO THE SEAT (G-4 of 20261103-234542-gre-delivery): the list decides which of a seat's
    // citations count (seatBasis), so a seat that was never shown it could not cite what grounds it.
    evidence: Array.isArray(evidence) ? evidence.filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim()) : [],
    // EVERY MARKER FROM EVERY FIELD (G-21 of 20261101-014615-ar-delivery-remediation-review): a "(Recommended)" in a
    // description or the question is the same cue as one in a label.
    question: clean(question, [...LABEL_MARKS, SENTENCE_MARK]),
    options: options.map((o) => ({
      label: clean(o.label, [...LABEL_MARKS, SENTENCE_MARK]),
      description: clean(o.description, [...LABEL_MARKS, SENTENCE_MARK]),
    })),
  };
}

/**
 * THE QUESTION'S EVIDENCE LIST, AT INTAKE (design GR-D1 A; evidence-path-owner.plan.md stage 3, EP-D2 C): absent, or a
 * list of non-empty strings, each normalized ONCE through lib/evidence-path.mjs's rootEvidencePath, so every reader after
 * the read of the question gets the owner's result and never the spelling. Returns { entries, error }: `entries` the
 * owner's results in order, `error` the first refusal. The link check needs the file system, so decide.mjs makes it on
 * `entries` through the confined owner of each entry's root. `rootsLater`: a caller that has not read the contract yet
 * checks the shape now and the roots once it has.
 */
export function questionEvidence(evidence, { repoRoot = null, reviewsDir = '', stagingRoot = null, rootsLater = false, caseInsensitive } = {}) {
  if (evidence === undefined) return { entries: [], error: null };
  if (!Array.isArray(evidence)) return { entries: [], error: 'the evidence of the question must be a list of paths' };
  const bad = evidence.findIndex((e) => typeof e !== 'string' || !e.trim());
  if (bad >= 0) return { entries: [], error: `the question's evidence[${bad}] is not a non-empty path` };
  if (rootsLater) return { entries: [], error: null };
  const entries = [];
  for (const [i, e] of evidence.entries()) {
    const r = rootEvidencePath(e, { repoRoot, reviewsDir, stagingRoot, caseInsensitive });
    if (r.refused) return { entries: [], error: `the question's evidence[${i}] is refused: ${r.refused}; name a path relative to the repository root, or one below a reviews directory` };
    entries.push(r);
  }
  return { entries, error: null };
}

/** The refusal text of questionEvidence alone, for a caller that needs only whether the list is admissible. */
export function questionEvidenceError(evidence, opts = {}) {
  return questionEvidence(evidence, opts).error;
}

/**
 * THE STAGE A QUESTION NAMES, AS THE PLAN NAMES IT (decision-records.plan.md stage 5; design DR-D1 A): the seat gets the
 * declared plan's own heading, never the session's text. `stage` is a number (`3`), a `Stage N` prefix, or words that
 * appear in exactly one heading; anything else is null, and the caller refuses the question. A sentence of prose names no
 * heading, so it cannot reach a seat through this field.
 */
export function stageHeading(planText, stage) {
  const s = typeof stage === 'string' || typeof stage === 'number' ? String(stage).trim() : '';
  if (!s) return null;
  const headings = String(planText ?? '').split(/\r?\n/).map((l) => /^#{1,6}\s+(.+?)\s*$/.exec(l)?.[1]).filter(Boolean);
  const num = /^(?:stage\s+)?(\d+[a-z]?)$/i.exec(s);
  if (num) {
    const hit = headings.filter((h) => new RegExp(`^stage\\s+${num[1]}(?![0-9a-z])`, 'i').test(h));
    return hit.length === 1 ? hit[0] : null;
  }
  if (s.length < 3) return null;
  const hit = headings.filter((h) => h.toLowerCase().includes(s.toLowerCase()));
  return hit.length === 1 ? hit[0] : null;
}

/**
 * ONE NODE-RUNTIME CALL OF THE PANEL (decision-records.plan.md stage 5; design DR-D1 A): a seat, the moderator or the revote
 * note's author, through spawn-subagent.mjs with its MODEL'S cwd in `surface`, an empty directory outside the repository,
 * so the decision record and earlier ones are not where it starts looking. That limits discovery, not reads: a path it is
 * given or guesses is still readable (G-2 of 20261104-082659-epo-remediation-2-review; shared/external-reviewers.md). The spawner still reads the pins from `repoRoot`'s contract;
 * the prompt, envelope and result files are the spawner's, never the model's. A surface inside the repository is refused.
 */
// `runtimeBin` overrides the node runtime's command (G-5 of 20261102-220302-rbr-remediation-5-review: it carried a
// provider's name in a generic seam). The function and its messages were provider-named too (G-13 of
// 20261102-231209-rbr-remediation-6-review; ARCHITECTURE A-9), and so was the flag it passed until spawn-subagent took
// the runtime-neutral `--runtime-bin` (G-4 of 20261104-171128-epo-remediation-3-review).
export function runtimeCall({ scripts, promptFile, out, result, repoRoot, surface, runtimeBin = null }) {
  const root = absolute(repoRoot, 'runtimeCall: repoRoot');
  const cwd = absolute(surface, 'runtimeCall: surface');
  // A `..` SEGMENT leaves the repository (G-11 of 20261105-074139-crsf-remediation-3-review): `startsWith('..')` read an
  // in-repository `..surface` as outside. path.relative keeps the host's case rule, which the pure isWithin cannot know.
  const rel = path.relative(root, cwd);
  if (rel.split(/[\\/]/)[0] !== '..' && !path.isAbsolute(rel)) throw new Error(`runtimeCall: the surface ${cwd} is inside the repository; a panel subagent must run outside the repository`);
  return {
    cwd,
    argv: [path.join(scripts, 'spawn-subagent.mjs'), '--prompt-file', promptFile, '--out', out, '--result', result,
      '--repo-root', root, '--cwd', cwd, ...(runtimeBin ? ['--runtime-bin', runtimeBin] : [])],
  };
}

// FNV-1a over the seed and round, then a Fisher-Yates shuffle driven by a small LCG: the same seed and round always give
// the same letters (a record can be replayed), and different rounds give different ones.
function hash(s) {
  let h = 0x811c9dc5;
  for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Each seat's anonymous letter for one round (design AR-D2): a permutation of A, B, C…, reshuffled per round. */
export function seatLetters(seats, round, seed) {
  let x = hash(`${seed}:${round}`) || 1;
  const letters = seats.map((_, i) => String.fromCharCode(65 + i));
  for (let i = letters.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  return Object.fromEntries(seats.map((s, i) => [s, letters[i]]));
}

/** The panel's state before round 1: the question's options are entries E1…En, with no votes and no reasons. */
export function startState(blinded) {
  return {
    question: blinded.question,
    entries: blinded.options.map((o, i) => ({ id: `E${i + 1}`, label: o.label, description: o.description, from: null, reasons: [] })),
    rounds: [],
  };
}

const text = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * ONE ROUND'S REPLIES APPLIED (criteria 14, 17). A reply is `{choice, reason}` where `choice` is an entry id, `other`
 * (with `other_text`) or `change` (with `change_of`, an existing entry, and `other_text`). `other` and `change` add an
 * entry; a change records the entry it came from, and the original stays as it was and stays votable. A reply that is
 * not of that shape, or names no entry that exists, is SILENCE: never a vote, never an entry (the roundtable's rule: a
 * parse failure counted as agreement would fake the thing being measured). Returns a new state.
 */
export function applyRound(state, round, replies, letters) {
  const entries = state.entries.map((e) => ({ ...e, reasons: [...e.reasons] }));
  const known = new Set(entries.map((e) => e.id));
  const votes = []; const added = [];
  for (const [seat, r] of Object.entries(replies)) {
    if (!r || typeof r !== 'object' || !text(r.choice) || !text(r.reason)) { votes.push({ seat, entry: null }); continue; }
    let entry = null;
    if (r.choice === 'other' || r.choice === 'change') {
      if (!text(r.other_text) || (r.choice === 'change' && !known.has(r.change_of))) { votes.push({ seat, entry: null }); continue; }
      entry = `E${entries.length + 1}`;
      entries.push({ id: entry, label: r.other_text.trim(), description: '', from: r.choice === 'change' ? r.change_of : null, reasons: [] });
      known.add(entry); added.push(entry);
    } else if (known.has(r.choice)) {
      entry = r.choice;
    }
    if (entry === null) { votes.push({ seat, entry: null }); continue; }
    entries.find((e) => e.id === entry).reasons.push({ seat, round, reason: r.reason.trim() });
    votes.push({ seat, entry, citations: Array.isArray(r.citations) ? [...r.citations] : [], what_would_change: text(r.what_would_change) ? r.what_would_change.trim() : null });
  }
  return { ...state, entries, rounds: [...state.rounds, { round, letters: { ...letters }, votes, added }] };
}

/**
 * WHAT A SEAT'S ANSWER MUST BE (autonomous-run.plan.md stage 4), as the transport checks it before the answer is
 * recorded: a `choice` and a `reason`; `other` with `other_text`; `change` with `change_of` and `other_text`. Whether
 * the entry a choice names exists is the round's question (applyRound), not the shape's. Empty array = acceptable.
 * This is the mapped answer's shape only: seatAnswerOf, which maps a seat's raw answer to it, also refuses one whose
 * `citations` is missing or not a list, or whose `what_would_change` is empty (G-6 of
 * 20261103-191032-dr-remediation-3-review).
 */
export function seatResultErrors(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ['the answer is not an object'];
  const errors = [];
  if (!text(result.choice)) errors.push('`choice` is empty');
  if (!text(result.reason)) errors.push('`reason` is empty: a vote carries its reason');
  if ((result.choice === 'other' || result.choice === 'change') && !text(result.other_text)) {
    errors.push(`\`${result.choice}\` needs \`other_text\`, the entry it adds`);
  }
  if (result.choice === 'change' && !text(result.change_of)) errors.push('`change` needs `change_of`, the entry it changes');
  return errors;
}

/**
 * WHETHER ONE ROUND REACHED A MAJORITY (criterion 15): one entry holding more than half of the readable votes AND more
 * than half of all the seats, and no entry added in that round. The second half is what keeps one readable reply out of
 * three from deciding for a panel two of whose seats were silent.
 */
export function roundResult(state, round) {
  const r = state.rounds.find((x) => x.round === round);
  if (!r) throw new Error(`no round ${round} in the panel's state`);
  const readable = r.votes.filter((v) => v.entry !== null);
  const counts = new Map();
  for (const v of readable) counts.set(v.entry, (counts.get(v.entry) ?? 0) + 1);
  let majority = null;
  if (r.added.length === 0) {
    for (const [entry, n] of counts) if (n > readable.length / 2 && n > r.votes.length / 2) majority = entry;
  }
  const unanimous = majority !== null && counts.get(majority) === r.votes.length;
  return { majority, unanimous, readable: readable.length, addedThisRound: r.added.length };
}

/**
 * WHAT HAPPENS AFTER A ROUND (design AR-D3): a majority decides; below the cap another round runs; at or past the cap
 * the moderator is asked, and only its explicit extension runs one more round, never past the hard cap.
 */
export function nextStep({ round, majority, cap, hardCap, moderatorExtends }) {
  if (!(Number.isInteger(cap) && Number.isInteger(hardCap) && cap >= 1 && hardCap >= cap)) {
    throw new Error(`the round cap must be a whole number at least 1, and the hard cap at least the cap (cap ${cap}, hard cap ${hardCap})`);
  }
  if (majority) return 'decided';
  if (round < cap) return 'next-round';
  if (round >= hardCap) return 'no-majority';
  if (moderatorExtends === undefined) return 'ask-moderator';
  return moderatorExtends === true ? 'next-round' : 'no-majority';
}

/** The moderator extends only by `{extend: true, reason: <text>}`; anything else, including a bare yes, is "not". */
export function parseModerator(reply) {
  return !!reply && typeof reply === 'object' && reply.extend === true && text(reply.reason);
}

/**
 * WHAT A SEAT SEES IN A ROUND (design AR-D2): the blinded question and every entry; from round 2, each entry's reasons,
 * each under the letter its author has in THIS round, never a seat id or a family.
 */
export function roundView(state, round, letters) {
  return {
    round,
    question: state.question,
    entries: state.entries.map((e) => ({
      id: e.id, label: e.label, description: e.description, from: e.from,
      reasons: round <= 1 ? [] : e.reasons.map((r) => ({ by: letters[r.seat] ?? '?', round: r.round, reason: r.reason })),
    })),
  };
}

/**
 * THE DECISION'S OUTCOME (criterion 9, design AR-D4): a majority on the first talk; none sends the question to a revote
 * on the session's note; none again postpones it for the operator. The agreement figure travels with it (design AR-D8).
 */
export function outcomeOf({ phase, majority, unanimous = false, rounds, moderatorRounds = 0 }) {
  // A-21's `converged` AS A FIELD (G-8 of 20261101-065930-dr-delivery; decision-records.plan.md stage 3): true when the
  // last round was unanimous after the seats had read each other, whatever extended it; false otherwise.
  const base = { rounds, moderator_rounds: moderatorRounds, converged: Boolean(majority && unanimous && rounds > 1) };
  if (!majority) return { outcome: phase === 'revote' ? 'postponed' : 'revote', entry: null, agreement: 'none', ...base };
  let agreement = 'majority';
  if (phase === 'revote') agreement = 'majority-on-revote';
  // Round 1's unanimity is independent agreement; reached after the seats read each other it is convergence (A-21;
  // G-23 of 20261101-023925-ar-remediation-2-review), in a moderator-extended round too (G-17 of
  // 20261101-032931-ar-remediation-3-review): unanimity is checked before the moderator's extension.
  else if (unanimous) agreement = rounds > 1 ? 'converged' : 'unanimous';
  else if (moderatorRounds > 0) agreement = 'moderator-extended';
  return { outcome: 'majority', entry: majority, agreement, ...base };
}

// ------------------------------------------------------------------------------------- the grounding (ARCHITECTURE A-22)
// decision-records.plan.md stage 3; the operator, 2026-11-01: DR-D2 B, DR-D6 A, DR-D7 A.

// A captured artifact: a file in a run's evidence directory, archived under the reviews directory (disk-first §3). The
// CAPTURED_ARTIFACT pattern fixed to .claude/reviews is gone; isCapturedArtifact below is the one rule.

/**
 * The reviews directory a citation is graded against, absolute: review.reviews_dir as the contract declares it
 * (repository-relative or absolute), or, empty or absent, ARCHIVED_REVIEWS, its one owner (G-8 of
 * 20261103-022403-rbr-remediation-8-review). Null when it names the repository root itself.
 */
/**
 * Whether a normalized evidence path is a captured artifact (G-11 of 20261103-005954-rbr-remediation-7-review): below one
 * of the reviews roots, at `<run>/evidence/...`, by the owner's rule (lib/evidence-path.mjs isRunEvidence). `file` is
 * rootEvidencePath's result, never a spelling: normalization is the intake's, and a raw string is refused rather than
 * normalized a second time here (G-5 of 20261104-171128-epo-remediation-3-review).
 */
export function isCapturedArtifact(file, { repoRoot, reviewsDir = '', stagingRoot = null, caseInsensitive } = {}) {
  // The case rule is the caller's, as the owner's is (G-6 of 20261104-060910-epo-delivery): no default here either.
  if (typeof caseInsensitive !== 'boolean') throw new Error("isCapturedArtifact: caseInsensitive (the platform's letter-case rule) is required");
  const root = absolute(repoRoot, 'isCapturedArtifact: repoRoot');
  if (typeof file === 'string') throw new Error("isCapturedArtifact: takes the owner's result (rootEvidencePath), not a spelling; normalize at the intake");
  const r = file;
  if (!r || r.refused) return false;
  // The containment is the owner's (G-4 of 20261104-072059-epo-remediation-review): not restated here.
  return isRunEvidence(r, { repoRoot: root, reviewsDir, stagingRoot, caseInsensitive });
}

/**
 * A SEAT'S BASIS, FROM ITS CITATIONS (DR-D7 A): `measurement` when at least one cited path is a captured artifact that
 * exists with no link on its path, and is among the evidence the question names (GR-D1 A); otherwise `convention`. A
 * citation that is not counts for nothing and is named in `refused`. A seat executes nothing, so a basis can come only
 * from an artifact that exists.
 *
 * NORMALIZED ONCE, HERE, WHERE A SEAT'S ANSWER ENTERS GROUNDING (evidence-path-owner.plan.md stage 3, EP-D2 C): each
 * citation goes through lib/evidence-path.mjs's rootEvidencePath once, and everything below compares the owner's `key`.
 * `evidence` is the question's list as the intake normalized it (its entries, or their canonical spellings, which the
 * owner maps to the same keys). Inside the repository the existence and link checks are claim-check's resolveCitation and
 * the real path, as before; below a reviews root outside it, the confined owner of that root.
 */
export function seatBasis(citations, { repoRoot, io, reviewsDir = '', stagingRoot = null, evidence = [] }) {
  const root = absolute(repoRoot, 'seatBasis: repoRoot');
  const resolved = []; const refused = [];
  // The fold is the PLATFORM's (io.caseInsensitiveFs, ARCHITECTURE §2; G-4 of 20261104-020352-gre-remediation-2-review).
  // Required, as isCapturedArtifact requires it (G-5 of 20261104-072059-epo-remediation-review): no default.
  if (typeof io?.caseInsensitiveFs !== 'boolean') throw new Error("seatBasis: io.caseInsensitiveFs (the platform's letter-case rule) is required");
  const caseInsensitive = io.caseInsensitiveFs;
  const fold = foldIf(caseInsensitive);
  const roots = { repoRoot: root, reviewsDir, stagingRoot, caseInsensitive };
  const named = new Set((Array.isArray(evidence) ? evidence : [])
    .map((e) => (e && typeof e === 'object' && typeof e.key === 'string' ? e : rootEvidencePath(e, roots)))
    .filter((e) => e && !e.refused).map((e) => e.key));
  // EACH DISTINCT CITATION IS CHECKED ONCE (G-5 of 20261110-022503-dps-remediation-4-review): a repeated citation redid
  // every synchronous resolution and realpath. Its outcome is kept and given again, so the result is what it was.
  const judged = new Map();
  for (const c of Array.isArray(citations) ? citations : []) {
    if (typeof c !== 'string' || !c.trim()) continue;
    if (!judged.has(c)) judged.set(c, judgeCitation(c));
    const o = judged.get(c);
    if (o.refused) refused.push({ path: c, why: o.refused }); else resolved.push(o.resolved);
  }
  return { basis: resolved.length ? 'measurement' : 'convention', resolved, refused };

  function judgeCitation(c) {
    const n = rootEvidencePath(c, roots);
    if (n.refused) return { refused: n.refused };
    if (!isCapturedArtifact(n, roots)) return { refused: "not a captured artifact (a run's evidence/)" };
    if (n.inRepo) {
      const r = resolveCitation({ file: n.rel }, { repoRoot: root, io });
      if (!r.ok) return { refused: r.why };
      // WHAT IT RESOLVES TO IS THE ARTIFACT, NOT ITS NAME (G-14 of 20261102-231209-rbr-remediation-6-review): a citation
      // counts only when no link stands on its path, so its real path, from the repository's, is the path it names.
      let realRel = null;
      try {
        const realRoot = io.fs.realpathSync(root);
        const realFile = io.fs.realpathSync(path.join(root, ...n.rel.split('/')));
        realRel = path.relative(realRoot, realFile).split(path.sep).join('/');
      } catch { /* unresolvable: refused below */ }
      if (realRel === null || fold(realRel) !== fold(n.rel)) {
        return { refused: 'reaches its file through a link; only a captured artifact itself grounds a seat' };
      }
    } else {
      // THROUGH THE ONE OWNER of a path below a root (lib/confined-path.mjs; ARCHITECTURE A-30): every level lstat'ed, a
      // link at any of them, the reviews root's own included, refused whatever it leads to.
      let st;
      try { st = confined({ root: n.root, io }).stat(n.rel.split('/')); } catch (e) {
        return { refused: e.code === 'ECONFINED' ? `refused (${e.message}); only a captured artifact itself grounds a seat` : `cannot be read (${e.code ?? e.message})` };
      }
      if (!st?.isFile()) return { refused: 'not a file' };
    }
    if (!named.has(n.key)) {
      return { refused: named.size ? 'not among the evidence the question names' : 'the question names no evidence, so no citation grounds a seat' };
    }
    return { resolved: n.canonical };
  }
}

/** The bases a panel decision can reach, weakest first: a seat's basis is only ever one of these (seatBasis). */
const PANEL_BASES = ['convention', 'measurement'];

/**
 * THE DECISION'S BASIS (DR-D7 A): the lowest among the seats that formed the majority, so one ungrounded vote makes the
 * majority ungrounded. `bases` maps seat → basis; null when there is no majority.
 */
export function decisionBasis(bases, majoritySeats) {
  if (!majoritySeats?.length) return null;
  let low = null;
  for (const s of majoritySeats) {
    const rank = PANEL_BASES.indexOf(bases?.[s]);
    const r = rank < 0 ? 0 : rank;
    if (low === null || r < low) low = r;
  }
  return PANEL_BASES[low];
}

/**
 * WHETHER A BASIS MEETS THE FLOOR (A-22): a floor of `convention` is met by any basis; `measurement` only by a measured
 * decision; a floor a panel cannot reach (`intent`, `architecture_doc`, `invariant`: no seat's citations grant them) is
 * met by nothing, so every decision goes to the operator. No basis meets no floor.
 */
export function meetsFloor(basis, floor) {
  if (!basis) return false;
  if (floor === 'convention') return true;
  if (floor === 'measurement') return basis === 'measurement';
  return false;
}

/**
 * THE OUTCOME, GROUNDED (DR-D6 A): a majority whose basis meets the floor stays `majority`, the panel's decision; one
 * below it becomes `to-operator`, keeping the panel's choice as its position, so the question reaches the operator with
 * the positions as its options (G-14 of 20261101-065930-dr-delivery: `options`, built by the caller from the last round's
 * votes as `{entry, label, seats}`, was promised here and never carried). A talk with no majority is unchanged.
 */
export function settleOutcome(outcome, { basis, floor, positions = [] }) {
  if (outcome?.outcome !== 'majority') return { ...outcome };
  if (meetsFloor(basis, floor)) return { ...outcome, outcome: 'majority' };
  const options = (Array.isArray(positions) ? positions : []).map((p) => ({ ...p, seats: [...(p.seats ?? [])] }));
  return { ...outcome, outcome: 'to-operator', options };
}

/**
 * A SEAT'S RAW ANSWER AS THE PANEL READS IT: the schema's `status`, `choice`, `rationale`, `other_text`, `change_of`
 * become `{choice, reason, other_text?, change_of?}`. A status other than `ok`, or a shape seatResultErrors refuses, is
 * `{result: null, why}`: silence, never a vote. One owner for both transports, external-review's decide mode and the
 * node-runtime seat decide.mjs spawns.
 */
export function seatAnswerOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { result: null, why: 'no answer object' };
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  // A SEAT THAT DID NOT ANSWER, AND WHY (decision-panel-seats.plan.md stage 4; DP-D3 A): an external seat's envelope's
  // not_checked reason, or a runtime seat's failed call, carried as said, never "no answer object".
  if (str(raw.status) === 'unavailable') return { result: null, why: `unavailable: ${str(raw.reason) || '(no reason given)'}` };
  if (str(raw.status) === 'error') return { result: null, why: `the seat's call failed: ${str(raw.reason) || '(no reason given)'}` };
  if (str(raw.status) !== 'ok') {
    return { result: null, why: str(raw.status) ? `reported status '${str(raw.status)}': ${str(raw.reason) || '(no reason)'}` : 'no status' };
  }
  const result = { choice: str(raw.choice), reason: str(raw.rationale) };
  if (str(raw.other_text)) result.other_text = str(raw.other_text);
  if (str(raw.change_of)) result.change_of = str(raw.change_of);
  // WHAT GROUNDS IT AND WHAT WOULD CHANGE IT (decision-records.plan.md stages 3-4; ARCHITECTURE A-22, A-24): the paths the
  // seat cites, of which only those that resolve to a captured artifact count (seatBasis), and its own answer to what
  // would change its choice, which is not the same thing as its reason for it.
  const citations = Array.isArray(raw.citations) ? raw.citations.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim()) : [];
  if (citations.length) result.citations = citations;
  if (str(raw.what_would_change)) result.what_would_change = str(raw.what_would_change);
  // BOTH REQUIRED, AS THE SEAT SCHEMA REQUIRES THEM (G-15 of 20261101-065930-dr-delivery): an answer that omits either is
  // silence, never a counted vote. An empty `citations` list is an answer (a convention seat cites nothing); a missing
  // one is not.
  const errors = seatResultErrors(result);
  if (!Array.isArray(raw.citations)) errors.push('`citations` is missing or not a list: a vote names what grounds it');
  if (!str(raw.what_would_change)) errors.push('`what_would_change` is empty: a vote says what would change it');
  return errors.length ? { result: null, why: errors.join('; ') } : { result, why: null };
}

// A NAME IN A SPAN IT CANNOT CLOSE (G-9 of 20261103-191032-dr-remediation-3-review): a repository's file names reach every
// seat's prompt, so a backtick in one closed its code span and a line break started a prompt line of its own. The fence is
// one backtick longer than the name's longest run (CommonMark), padded where the name starts or ends with one, and a line
// break becomes a space.
function codeSpan(s) {
  const flat = String(s).replace(/[\r\n]+/g, ' ');
  const run = Math.max(0, ...(flat.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(run + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${flat}${pad}${fence}`;
}

/**
 * THE WORK CONTEXT A SEAT IS GIVEN (criterion 2): built from the request or plan path, the stage the question names, the
 * diff summary, the changed files and the question's evidence list, and from nothing else. It takes those fields by name, so no other field of a
 * question file (a transcript path, a pasted conversation) can reach a seat through it.
 */
export function workContextText({ request = null, stage = null, diffStat = '', files = [], evidence = [] } = {}) {
  const lines = [];
  lines.push(`- The approved request or plan the work follows: ${request ? codeSpan(request) : '(none declared)'}`);
  lines.push(`- The stage in progress: ${stage ? String(stage).trim().replace(/[\r\n]+/g, ' ') : '(not named)'}`);
  const list = (files ?? []).filter((f) => typeof f === 'string' && f.trim());
  lines.push(`- Files changed: ${list.length ? list.map(codeSpan).join(', ') : '(none)'}`);
  // THE QUESTION'S EVIDENCE LIST (G-4, G-3 of 20261103-234542-gre-delivery): only a citation among these grounds a vote
  // (seatBasis), so a seat is told which they are.
  const ev = (Array.isArray(evidence) ? evidence : []).filter((e) => typeof e === 'string' && e.trim());
  lines.push(`- The evidence the question names: ${ev.length ? `${ev.map(codeSpan).join(', ')} (only a citation among them grounds a vote)` : '(none)'}`);
  const stat = String(diffStat ?? '').trim();
  // THE SUMMARY'S FENCE, LONGER THAN ANY RUN IN IT (G-9): the diff summary lists the same file names.
  const fence = '`'.repeat(Math.max(3, ...(stat.match(/`+/g) ?? []).map((m) => m.length + 1)));
  return stat ? `${lines.join('\n')}\n\nThe change summary:\n\n${fence}\n${stat}\n${fence}` : lines.join('\n');
}

/**
 * THE PATHS A NODE-RUNTIME CALL'S DIRECTORY GETS A COPY OF (decision-panel-seats.plan.md stage 1; operator, 2026-11-09:
 * "A. Copy cited files in (Recommended)"): every path the work context names, each once, in its order: the request, the
 * changed files, and the question's evidence as the intake normalized it (questionEvidence's entries). The seat stands in
 * an empty directory outside the repository and its CLI refuses a Read outside that directory, so a copy at the same
 * repository-relative path is what makes the relative path it is sent resolve. An evidence entry outside the repository
 * (a staged run below a reviews root) has no repository-relative path and is refused, named with why, never copied.
 * Returns `{copy: [repository-relative path], refused: [{path, why}]}`; io/seat-copies.mjs does the copying.
 */
export function seatCopyPaths({ request = null, files = [], evidence = [], caseInsensitive = false } = {}) {
  const seen = new Set();
  const copy = [];
  const refused = [];
  // BY THE FILESYSTEM'S CASE RULE (G-12 of 20261109-232630-dps-delivery): on a case-insensitive one two spellings are one
  // file, and the second's exclusive create in copyIntoSeatDir failed and aborted the decision. The first spelling is kept.
  const keyOf = (s) => (caseInsensitive ? s.toLowerCase() : s);
  // IN THE SPELLING THE SEAT IS SENT, NEVER TRIMMED (G-8, G-2 of 20261110-014035-dps-remediation-3-review): decide.mjs reads
  // git's lists untrimmed and workContextText names each path as given, so a trimmed `config ` was copied as `config`, the
  // named file absent and an ignored sibling in its place. Whitespace decides only whether an entry is a path at all.
  // A LINE BREAK IS REFUSED (G-7): codeSpan shows it to the seat as a space, so a copy under the real name is one the seat
  // was never told how to open.
  const add = (p) => {
    const s = typeof p === 'string' ? p : '';
    if (!s.trim() || seen.has(keyOf(s))) return;
    seen.add(keyOf(s));
    if (/[\r\n]/.test(s)) { refused.push({ path: s, why: 'a line break in the name: the seat is shown it as a space, so a copy under it is one the seat cannot address' }); return; }
    copy.push(s);
  };
  add(request);
  for (const f of files ?? []) add(f);
  for (const e of evidence ?? []) {
    if (e?.inRepo === true) add(e.rel);
    else refused.push({ path: String(e?.canonical ?? e), why: 'outside the repository: the node-runtime seat can read only its own directory, so it gets no copy' });
  }
  return { copy, refused };
}

/**
 * WHETHER A ROUND HAD ENOUGH SEATS (decision-panel-seats.plan.md stage 4; design DP-D3 A): `answered` is the round's
 * `[seat, seatAnswerOf(raw)]` pairs. A seat with a result answered; every other seat is silent, named with its why. Fewer
 * than two answering seats is not a panel: one voice cannot be a majority of anything, and a broken panel must never
 * read as a divided one (decision 20261107-213602-4f3308: one seat answering, recorded "no majority").
 */
export const QUORUM = 2;
export function roundQuorum(answered) {
  const silent = [];
  let answering = 0;
  for (const [seat, a] of answered ?? []) {
    if (a?.result) answering += 1;
    else silent.push({ seat, why: a?.why ?? 'no answer object' });
  }
  return { answering, silent, enough: answering >= QUORUM };
}

/**
 * THE OUTCOME OF A PANEL THAT WAS NOT QUORATE: `seats-unavailable`, naming each silent seat with why, for the operator at
 * once: no further round, no moderator, no revote. Its own outcome, never `revote` or `postponed`, whose words are a
 * real split's.
 */
export function seatsUnavailableOutcome({ rounds, silent = [], answering = 0, moderatorRounds = 0 }) {
  return { outcome: 'seats-unavailable', entry: null, agreement: 'none', rounds, moderator_rounds: moderatorRounds, converged: false,
    answering, silent: silent.map((x) => ({ seat: x.seat, why: x.why })) };
}

/**
 * WHY THE PANEL'S SEATS ARE NOT INDEPENDENT VOTES, or null (G-8 of 20261101-005402-ar-delivery): every seat, the node
 * runtime's included, as `{reviewer, model}`, resolved to its family through the adapter table's one rule
 * (`familyOfCall`). Two seats of one family are one opinion counted twice, so they are refused, and so is a seat whose
 * family cannot be resolved, since its independence cannot be shown. Distinct reviewer ids are not enough: a contract may
 * override adapters so that two ids run one family.
 */
export function seatFamilyErrors(seats, table) {
  const seen = new Map();
  for (const s of seats ?? []) {
    const family = familyOfCall({ reviewer: s?.reviewer, model: s?.model ?? '' }, table);
    if (!family) return `the decision panel's seat ${JSON.stringify(s?.reviewer)} has no family its adapter declares, so its independence cannot be shown`;
    if (seen.has(family)) return `the decision panel's seats ${JSON.stringify(seen.get(family))} and ${JSON.stringify(s.reviewer)} are of the same family (${family}): one opinion counted twice`;
    seen.set(family, s.reviewer);
  }
  return null;
}

/**
 * THE REVISION A QUESTION'S `since` NAMES, as the arguments `git diff` takes after its own options (G-7 of
 * 20261101-005402-ar-delivery): the revision, then `--`, so nothing after it is read as an option. A value beginning
 * with `-` is an option however it is placed (`--output=<path>` writes a file, `--ext-diff` runs a command), so it is
 * refused, never passed. Absent or blank is HEAD.
 */
export function sinceGitArgs(since) {
  const s = typeof since === 'string' ? since.trim() : '';
  if (!s) return ['HEAD', '--'];
  if (s.startsWith('-') || /[\0\r\n]/.test(s)) throw new Error(`the question's since ${JSON.stringify(s)} is not a revision git can take`);
  return [s, '--'];
}

/** How a delegated answer is attributed wherever it is recorded: to the panel and its record, never to the operator. */
export function panelAttribution(id) {
  return `decided by the panel (\`${id}\`)`;
}

/** Whether one more spend fits under `review.run_spend_max` (null is no bound). */
export function spendAllowed(count, max) {
  return max === null || max === undefined || count < max;
}

/** The operator's marks on a sampled decision (autonomous-run.plan.md stage 8; design AR-D8). */
export const SAMPLE_MARKS = Object.freeze(['agree', 'differ']);
/** The sample's default size, the design's suggestion; the size is the operator's to change (`decide.mjs --sample --size <n>`). */
export const SAMPLE_DEFAULT = 10;

/**
 * THE DECISIONS TO SAMPLE (design AR-D8): the newest delegated ones, a decision the panel took by majority, that the
 * operator has not marked yet, at most `n`. A postponed or revote-pending decision was never delegated, so it is not
 * offered. `decisions` are `{id, final, sampled}`; ids sort by time because decide.mjs mints them from the clock.
 */
export function sampleCandidates(decisions, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`the sample size must be a whole number of at least 1, got ${JSON.stringify(n)}`);
  return (decisions ?? [])
    .filter((d) => d?.final?.outcome === 'majority' && !d.sampled)
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, n);
}
