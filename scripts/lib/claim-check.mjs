// The mechanical half of claim-check (.claude/requests/claim-check.md): what a checker's answer must
// look like, and the rules no model is trusted to apply to itself.
//
// The checker is a model reading a draft report in a context of its own. It is asked to search for
// what would make each claim a non-issue, and to grade what it found. Asking is not enforcing: a
// checker that writes `observed` beside nothing it can point to has made the same move the draft did.
// So the grade is RECOMPUTED here — `observed` survives only with a citation that resolves, and every
// downgrade is recorded rather than silent. That is AC3, and it is the reason this is code.
//
// Pure apart from `io`: a file citation is resolved against the repository through the platform
// implementation, like every lib/ decision that must consult the disk.
import { requireIo } from './io-param.mjs';
import { countLines, escapesAfterRealpath, isWithin } from './finding-scope.mjs';
import { absolute, resolveFrom } from './paths.mjs';

// Widened 2026-09-26 from the survey of dissolved claims: issue reports were 2 of 37. Capability, cost,
// attribution, how the code behaves and what is waiting on the operator dissolved as often, and each
// is checked differently — so each is a kind, not `other`.
export const CLAIM_KINDS = ['defect', 'risk', 'limitation', 'absence', 'impossibility', 'capability', 'cost',
  'attribution', 'behaviour', 'status', 'recommendation', 'other'];
export const GRADES = ['observed', 'inferred'];
export const VERDICTS = ['stands', 'dissolved', 'downgrade', 'ask-operator'];

/** The two values of `review.claim_check_transcript` (claim-check-cross-family.plan.md stage 0). */
export const CLAIM_CHECK_TRANSCRIPT = Object.freeze(['cross-family', 'same-family']);

/**
 * WHICH CHECKER MAY READ THE SESSION'S TRANSCRIPT, from the contract's `review` block. `cross-family`: the cross-family
 * checker gets it, redacted, and checks every claim. `same-family`: attributions are checked by a subagent of the node
 * runtime's family with it, and the cross-family checker never sees it. ABSENT IS `same-family` (operator, 2026-10-18:
 * "Absent = claude (Recommended)"; renamed from `claude` on 2026-10-19, "Rename to same-family (Recommended)", because a
 * vendor name in the vocabulary breaks A-9): a consumer sends no transcript to a second vendor unless it decides to.
 * Anything else throws rather than being guessed.
 */
export function claimCheckTranscriptOf(review) {
  if (!review || !Object.hasOwn(review, 'claim_check_transcript')) return 'same-family';
  const v = review.claim_check_transcript;
  if (!CLAIM_CHECK_TRANSCRIPT.includes(v)) {
    throw new Error(`review.claim_check_transcript must be one of ${CLAIM_CHECK_TRANSCRIPT.join(' | ')}, got ${JSON.stringify(v)}`);
  }
  return v;
}

const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;

/**
 * THE FALLBACK'S MERGE (claim-check-cross-family.plan.md stage 4): under `claim_check_transcript: same-family` the arm
 * checks the draft without the transcript, and a same-family checker given the transcript and the arm's claim list grades
 * every claim IT classes as an attribution — under the arm's id, or a new one for an attribution the arm did not list.
 * The same-family checker is the authority for that set, because the transcript it holds is what an attribution is
 * checked against. Each claim's grader is in `graded_by`; each kind the two disagree on is in `kind_disagreements`,
 * including an arm attribution the same-family checker did not return, whose grade is then recomputed as inferred. A
 * `not_checked` either side omitted is omitted from the merge, for the rules step to refuse. A same-family claim of any other kind is an
 * error: it was asked only for attributions. `grader` is the label its claims are recorded under: the node runtime's
 * name from the adapter table, never a vendor literal here (A-9; G-10 of 20261019-014448-ccf-delivery).
 */
export function mergeAttributionCheck(armResult, sameResult, { grader = 'same-family' } = {}) {
  const errors = [];
  const claims = (armResult?.claims ?? []).map((c) => ({ ...c }));
  const graded_by = Object.fromEntries(claims.map((c) => [c.id, 'arm']));
  const armKind = Object.fromEntries(claims.map((c) => [c.id, c.kind]));
  const kind_disagreements = [];
  const fromSame = new Set();
  // AN ID MATCHES ONLY THE CLAIM IT QUOTES (G-11 of 20261019-033102-review-review): matched by id alone, a same-family
  // claim that reused an arm id for a different claim overwrote it, and the arm's claim was lost. The text is compared
  // with spacing and case folded, so a re-quote still matches; a reused id with other text gets a fresh id instead.
  const quoted = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const indexOf = new Map(claims.map((a, i) => [a.id, i]));
  const freshId = (id) => { let n = 2; while (indexOf.has(`${id}-sf${n === 2 ? '' : n}`)) n++; return `${id}-sf${n === 2 ? '' : n}`; };
  for (const c of sameResult?.claims ?? []) {
    if (c?.kind !== 'attribution') { errors.push(`the same-family checker graded ${c?.id ?? '(no id)'} as ${c?.kind}, and was asked only for attributions`); continue; }
    let at = indexOf.get(c.id) ?? -1;
    let own = { ...c };
    if (at !== -1 && (fromSame.has(c.id) || quoted(claims[at].text) !== quoted(c.text))) {
      own = { ...c, id: freshId(c.id) };
      at = -1;
    }
    fromSame.add(own.id);
    if (at === -1) { indexOf.set(own.id, claims.length); claims.push(own); }
    else {
      if (armKind[own.id] !== 'attribution') kind_disagreements.push({ id: own.id, arm: armKind[own.id], same_family: 'attribution' });
      claims[at] = own;
    }
    graded_by[own.id] = grader;
  }
  // AN ARM ATTRIBUTION THE SAME-FAMILY CHECKER LEFT OUT IS NOT LEFT WITH THE ARM'S GRADE (G-9 of
  // 20261019-042251-review-review): the arm graded it without the transcript an attribution is checked against, so its
  // grade is recomputed as inferred, which the rules step turns into a question, and the regrade is said.
  const regraded = [];
  for (const c of armResult?.claims ?? []) {
    if (c.kind !== 'attribution' || fromSame.has(c.id)) continue;
    kind_disagreements.push({ id: c.id, arm: 'attribution', same_family: 'not an attribution' });
    const at = indexOf.get(c.id);
    if (claims[at].grade !== 'inferred') {
      claims[at] = { ...claims[at], grade: 'inferred' };
      regraded.push(`${c.id}: the arm graded it ${c.grade} as an attribution without the transcript, and ${grader} did not class it as `
        + 'one, so nothing checked it against the transcript; recomputed as inferred');
    }
  }
  kind_disagreements.sort((a, b) => indexOf.get(a.id) - indexOf.get(b.id));
  const result = { schema_version: 1, claims };
  // ABSENT STAYS ABSENT (G-10 of 20261019-042251-review-review): merged as [], a checker that omitted its gaps passed the
  // rules step's absent-versus-empty guard (resultShapeErrors), which now refuses it as it would refuse either alone.
  if (Array.isArray(armResult?.not_checked) && Array.isArray(sameResult?.not_checked)) {
    result.not_checked = [...armResult.not_checked, ...sameResult.not_checked, ...regraded];
  }
  return { result, graded_by, kind_disagreements, errors };
}

/** Every way `result` fails the checker's output shape; empty when it does not. */
export function resultShapeErrors(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ['the result is not a JSON object'];
  if (!Array.isArray(result.claims)) return ['`claims` is not an array'];
  const errors = [];
  // G-13 of 20260926-044637-m0-close-r2: absent read as [] — a checker that omitted its gaps looked
  // like one that had none. Empty is a statement; absent is not.
  if (!Array.isArray(result.not_checked)) errors.push('`not_checked` must be an array — empty if nothing was left unchecked, never absent');
  if (!result.claims.length) errors.push('`claims` is empty — a draft that makes no claim needs no check, and one that does was not read');
  // AN ID NAMES ONE CLAIM (G-7 of 20261019-053230-review-review): the merge and check.json's graded_by are keyed by id,
  // so two claims under one id collapsed there, the later winning, and a claim could be regraded or misattributed.
  const seen = new Set();
  result.claims.forEach((c, i) => {
    const at = `claims[${i}]${c?.id ? ` (${c.id})` : ''}`;
    if (!c || typeof c !== 'object') { errors.push(`${at}: not an object`); return; }
    if (!nonEmpty(c.id)) errors.push(`${at}: no id`);
    else if (seen.has(c.id)) errors.push(`${at}: duplicate id — the id is used more than once, and every claim needs its own`);
    else seen.add(c.id);
    if (!nonEmpty(c.text)) errors.push(`${at}: no text — the claim is quoted from the draft`);
    if (!CLAIM_KINDS.includes(c.kind)) errors.push(`${at}: kind must be one of ${CLAIM_KINDS.join('|')}`);
    if (!GRADES.includes(c.grade)) errors.push(`${at}: grade must be observed|inferred`);
    if (!VERDICTS.includes(c.verdict)) errors.push(`${at}: verdict must be one of ${VERDICTS.join('|')}`);
    if (!c.search || !nonEmpty(c.search.looked_for) || !Array.isArray(c.search.where) || typeof c.search.found !== 'string') {
      errors.push(`${at}: search must carry looked_for, where[] and found — the disconfirming search is the point`);
    }
    if (!Array.isArray(c.citations)) errors.push(`${at}: citations must be an array (empty is allowed, and grades inferred)`);
    if (!c.counter_question || !nonEmpty(c.counter_question.question)) errors.push(`${at}: counter_question.question is required`);
  });
  return errors;
}

/**
 * Does one citation point at something that exists? A file citation must resolve INSIDE the
 * repository to lines the file has; a command citation is an instrument a reader can re-run, and
 * counts as one — it cannot be verified here, so it is rendered verbatim for that reader.
 * @returns {{ok: boolean, why?: string, label: string}}
 */
export function resolveCitation(citation, { repoRoot, io }) {
  requireIo(io, 'resolveCitation');
  if (citation && nonEmpty(citation.command)) return { ok: true, label: `\`${citation.command}\`` };
  if (!citation || !nonEmpty(citation.file)) return { ok: false, label: JSON.stringify(citation), why: 'neither a file nor a command' };
  const root = absolute(repoRoot, 'resolveCitation: repoRoot');
  const abs = resolveFrom(root, 'resolveCitation: repoRoot', citation.file);
  const label = `${citation.file}${citation.lines ? `:${citation.lines}` : ''}`;
  if (!isWithin(root, abs)) return { ok: false, label, why: 'outside the repository' };
  if (!io.fs.existsSync(abs)) return { ok: false, label, why: 'no such file' };
  // A REAL FILE, INSIDE AFTER LINKS (G-9 of 20261019-053230-review-review): containment above is lexical, so an
  // in-repository link to a file outside resolved, and countLines read its target; and a directory, `.` included, is
  // not evidence anyone can open at a line.
  if (escapesAfterRealpath(root, abs, io)) return { ok: false, label, why: 'resolves outside the repository through a link' };
  let isFile = false;
  try { isFile = io.fs.statSync(abs).isFile(); } catch { /* unreadable: not a file */ }
  if (!isFile) return { ok: false, label, why: 'not a file' };
  if (citation.lines === undefined || citation.lines === null || citation.lines === '') return { ok: true, label };
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(citation.lines).trim());
  if (!m) return { ok: false, label, why: `lines "${citation.lines}" is not N or N-M` };
  const from = Number(m[1]);
  const to = Number(m[2] ?? m[1]);
  const count = countLines(abs, io);
  if (from < 1 || to < from || to > count) return { ok: false, label, why: `the file has ${count} lines` };
  return { ok: true, label };
}

/**
 * The checker's result with the mechanical rules applied. Every change is recorded in `notes`.
 * @returns {{ok: boolean, errors: string[], claims: object[], summary: Record<string, number>}}
 */
export function applyClaimRules(result, { repoRoot, io }) {
  requireIo(io, 'applyClaimRules');
  const errors = resultShapeErrors(result);
  if (errors.length) return { ok: false, errors, claims: [], summary: {} };
  const claims = result.claims.map((c) => {
    const notes = [];
    const cited = c.citations.map((x) => resolveCitation(x, { repoRoot, io }));
    for (const r of cited.filter((x) => !x.ok)) notes.push(`citation ${r.label} does not resolve (${r.why})`);
    let grade = c.grade;
    // AC3: observed means a citation someone can open. Without one it is what the draft was: inferred.
    if (grade === 'observed' && !cited.some((x) => x.ok)) {
      grade = 'inferred';
      notes.push('graded observed with no citation that resolves — recomputed as inferred');
    }
    let verdict = c.verdict;
    // A claim about the operator — what they can run, approve or decide — is not the repository's to
    // answer, however confidently it is phrased. It becomes a question to them.
    if (c.operator_only === true && verdict !== 'ask-operator') {
      notes.push(`about the operator, so asked rather than stated (was ${verdict})`);
      verdict = 'ask-operator';
    }
    // G-11 of 20260926-044637-m0-close-r2: a dissolution is a claim too. With nothing that resolves
    // behind it, the claim it would remove was never disproved — it is kept, labelled unverified.
    if (verdict === 'dissolved' && grade === 'inferred') {
      verdict = 'downgrade';
      notes.push('dissolved -> downgrade: nothing that resolves shows it is a non-issue, so it is kept, unverified');
    }
    // A risk nobody can name a trigger for is not presented as real.
    if (c.kind === 'risk' && !nonEmpty(c.trigger)) {
      notes.push('a risk with no realistic trigger named');
      if (verdict === 'stands') { verdict = 'downgrade'; notes.push('stands -> downgrade: no trigger'); }
    }
    // shared/unverified-claims.md: an attribution is available only where the operator's words can be
    // quoted. With nothing that resolves, "you asked" is the agent's memory of the conversation, and it
    // becomes a QUESTION (I-11) — a downgraded statement still borrows the operator's authority
    // (G-7 of 20260926-060936-m0-close-r3).
    if (c.kind === 'attribution' && grade === 'inferred' && verdict !== 'ask-operator' && verdict !== 'dissolved') {
      notes.push(`${verdict} -> ask-operator: an attribution needs the operator's words, quoted and cited; without them it is asked`);
      verdict = 'ask-operator';
    }
    return { ...c, grade, verdict, citations_resolved: cited, notes };
  });
  const summary = Object.fromEntries(VERDICTS.map((v) => [v, claims.filter((c) => c.verdict === v).length]));
  summary.inferred = claims.filter((c) => c.grade === 'inferred').length;
  return { ok: true, errors: [], claims, summary, not_checked: result.not_checked };
}

/** The checked result as a page a person reads before the report is revised. */
export function renderChecked(checked, { draftPath = null, check = null } = {}) {
  const L = ['# Claim check', ''];
  if (draftPath) L.push(`Draft: \`${draftPath}\``, '');
  // WHO CHECKED, AND WHAT LEFT THE MACHINE (claim-check-cross-family.plan.md stage 5), from check.json.
  const armName = check?.arm?.reviewer ?? 'the arm';
  const sameName = check?.same_family?.runtime ?? 'same-family';
  if (!check) {
    L.push('How this check ran is not recorded (no check.json): which checker, which family, and whether a transcript was sent.', '');
  } else if (check.family === 'same') {
    L.push(`Checked by a ${sameName} subagent: **same-family**, the family the draft was written in (\`review.external_panel\` is off).`, '');
  } else {
    const pin = [check.arm?.model, check.arm?.effort].filter(Boolean).join(', ');
    L.push(`Checked by ${armName}${pin ? ` (${pin})` : ''}: **cross-family** (\`review.claim_check_transcript: ${check.setting}\`).`
      + (check.same_family ? ` Attribution claims were checked by a ${sameName} subagent, which holds the transcript.` : ''), '');
  }
  if (check) {
    const t = check.transcript ?? {};
    if (!t.sent) L.push('No session transcript was given, so no attribution could be checked against it.', '');
    else if (t.to === 'same-family') L.push(`The session transcript went to the ${sameName} checker only; it was not sent to ${armName}.`, '');
    // A PARTIAL TRANSCRIPT SAYS SO (G-11 of 20261112-063354-hl-remediation-4-review): lines the copy could not parse.
    else L.push(`The session transcript was sent to ${t.to}, redacted: ${t.bytes} bytes, ${t.redactions} secret(s) redacted.`
      + (Number(t.malformed) > 0 ? ` ${t.malformed} line(s) of the transcript could not be parsed and were not sent, so the checker saw a partial conversation.` : ''), '');
  }
  const graderOf = (id) => {
    const g = check?.graded_by?.[id];
    return g === 'arm' ? armName : g ?? null;
  };
  if (!checked.ok) {
    L.push('**The checker\'s result was refused** — nothing below was applied:', '');
    for (const e of checked.errors) L.push(`- ${e}`);
    return L.join('\n') + '\n';
  }
  const s = checked.summary;
  L.push(`${checked.claims.length} claim(s): ${s.stands} stand, ${s.dissolved} dissolved, ${s.downgrade} downgraded, `
    + `${s['ask-operator']} become questions to the operator; ${s.inferred} graded inferred.`, '');
  for (const c of checked.claims) {
    L.push(`## ${c.id} · ${c.verdict} · ${c.grade} · ${c.kind}${graderOf(c.id) ? ` · checked by ${graderOf(c.id)}` : ''}`, '', `> ${c.text}`, '');
    L.push(`- **Searched for:** ${c.search.looked_for}`);
    L.push(`- **Where:** ${c.search.where.join('; ') || '(nowhere named)'}`);
    L.push(`- **Found:** ${c.search.found}`);
    L.push(`- **Citations:** ${c.citations_resolved.map((r) => `${r.label}${r.ok ? '' : ' (does not resolve)'}`).join('; ') || 'none'}`);
    if (c.kind === 'risk') L.push(`- **Trigger:** ${nonEmpty(c.trigger) ? c.trigger : 'none named'}`);
    L.push(`- **Counter-question:** ${c.counter_question.question}${c.counter_question.answer ? ` — ${c.counter_question.answer}` : ''}`);
    for (const n of c.notes) L.push(`- **Rule applied:** ${n}`);
    L.push('');
  }
  if (check?.kind_disagreements?.length) {
    L.push('## Kinds the checkers disagreed on', '');
    for (const d of check.kind_disagreements) L.push(`- ${d.id}: ${armName} said ${d.arm}, ${sameName} said ${d.same_family}`);
    L.push('');
  }
  if (Array.isArray(checked.not_checked) && checked.not_checked.length) {
    L.push('## Not checked', '');
    for (const n of checked.not_checked) L.push(`- ${typeof n === 'string' ? n : JSON.stringify(n)}`);
  }
  return L.join('\n') + '\n';
}
