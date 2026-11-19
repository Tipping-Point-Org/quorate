// One decision run (autonomous-run.plan.md stage 5): the rounds, the moderator and the outcome, written to the decision's
// record directory as they happen. The rules are lib/decision-panel.mjs's; the seats' and the moderator's calls are the
// caller's, injected as `runSeat` and `runModerator`, so a test runs the whole loop with stubs and no reviewer is ever
// reached from here. This module writes files and nothing else.
import path from 'node:path';
import { confined } from './confined-path.mjs';
import { buildDecisionSeatPrompt, buildDecisionModeratorPrompt } from './review-prompts.mjs';
import {
  blindQuestion, seatLetters, startState, applyRound, roundResult, nextStep, parseModerator, roundView, outcomeOf,
  seatAnswerOf, decisionBasis, settleOutcome, roundQuorum, seatsUnavailableOutcome,
} from '../lib/decision-panel.mjs';

/**
 * Run the panel on `question` ({question, options}) and return `{outcome, state}`.
 *
 *   seats         the seat ids, in a fixed order (their names never reach a prompt: every seat sees letters)
 *   runSeat       async (seat, prompt, round) => the seat's raw answer object, or null
 *   runModerator  async (prompt) => the moderator's raw answer object, or null
 *   caps          {cap, hardCap} from review.decision_rounds / decision_rounds_max
 *   phase         'first', or 'revote' for the vote on the session's note (design AR-D4)
 *   grounding     {floor, basisOf}: review.grounding_floor and (citations) => a seat's basis (lib seatBasis bound to the
 *                 repository); REQUIRED, since a decision without a floor would settle by default (ARCHITECTURE A-22)
 *   families      seat → family, recorded with each seat's position (A-24)
 *   store         the record's owner (recordStore): every write and read below the record goes through `confined`
 *                 (ARCHITECTURE A-30), so a link standing at the record, or below it, is refused; decide.mjs passes one
 *                 rooted at the repository, a test one rooted at the record's parent (the default)
 *   scratchRoot   a directory outside the record; each seat's call is handed `<scratchRoot>/r<round>-<seat>` as the 4th
 *                 argument of runSeat, for its evidence, moved into the record as `evidence-r<round>-<seat>` after the round
 */
export async function runDecision({ question, recordDir, seed, seats, context, caps, runSeat, runModerator, phase = 'first', scratchRoot = null, grounding = null, families = {}, store = null }) {
  if (!grounding || typeof grounding.floor !== 'string' || typeof grounding.basisOf !== 'function') {
    throw new Error('runDecision: grounding {floor, basisOf} is required; a decision without its floor would be settled by default (ARCHITECTURE A-22)');
  }
  const rec = store ?? recordStore(recordDir);
  const blinded = blindQuestion(question);
  rec.owner.dir(rec.prefix);
  rec.json('blinded.json', blinded);
  let state = startState(blinded);
  let round = 1;
  let moderatorRounds = 0;
  let last = { majority: null, unanimous: false };
  // A ROUND WITH TOO FEW SEATS ENDS THE DECISION (decision-panel-seats.plan.md stage 4; DP-D3 A): set to the round's
  // quorum when fewer seats answered than QUORUM (lib/decision-panel.mjs, its one owner), and the loop stops there.
  let unavailable = null;
  for (;;) {
    const letters = seatLetters(seats, round, seed);
    const view = roundView(state, round, letters);
    // A ROUND'S REPLIES REACH THE RECORD ONLY AFTER EVERY SEAT HAS ANSWERED. The node-runtime seat runs in the repository
    // (spawn-subagent reads its pins there), where the record lives: a reply written while another seat is still
    // thinking is a file that seat can read, and round 1 would no longer be blind (criterion 7).
    const answered = await Promise.all(seats.map(async (seat) => {
      const prompt = buildDecisionSeatPrompt({ view, letter: letters[seat], context });
      rec.text(`round-${round}-${seat}-prompt.md`, prompt);
      // A SEAT'S EVIDENCE TOO (G-11 of 20261101-005402-ar-delivery): whatever a seat's call writes during the round goes
      // to a directory of its own under `scratchRoot`, outside the record, and is moved into the record with the replies.
      // Made through the owner rooted at the scratch root decide.mjs made (stage 6), so a link planted there is refused.
      // Rooted at the scratch root AS NAMED (G-10 of 20261102-231209-rbr-remediation-6-review): its real path resolved a
      // link at the root before the owner's root check could refuse it.
      const scratch = scratchRoot ? confined(path.resolve(scratchRoot)).dir([`r${round}-${seat}`]) : null;
      let raw = null;
      try { raw = await runSeat(seat, prompt, round, scratch); } catch (e) { raw = { status: 'error', reason: String(e?.message ?? e) }; }
      return [seat, raw, seatAnswerOf(raw)];
    }));
    for (const [seat, raw, answer] of answered) {
      rec.json(`round-${round}-${seat}-reply.json`, { raw, ...answer });
      if (scratchRoot) moveScratchIntoRecord(scratchRoot, `r${round}-${seat}`, rec, `evidence-r${round}-${seat}`);
    }
    // EACH SEAT THAT DID NOT ANSWER, AND WHY, PER ROUND (stage 4), whether or not the round was quorate.
    const quorum = roundQuorum(answered.map(([seat, , answer]) => [seat, answer]));
    rec.json(`round-${round}-seats.json`, { answering: quorum.answering, silent: quorum.silent });
    const replies = answered.map(([seat, , answer]) => [seat, answer.result]);
    state = applyRound(state, round, Object.fromEntries(replies), letters);
    last = roundResult(state, round);
    if (!quorum.enough) { unavailable = quorum; break; }
    let step = nextStep({ round, majority: last.majority, ...caps });
    if (step === 'ask-moderator') {
      const prompt = buildDecisionModeratorPrompt({ state, hardCap: caps.hardCap });
      rec.text(`moderator-${round}-prompt.md`, prompt);
      let raw = null;
      try { raw = await runModerator(prompt); } catch (e) { raw = { error: String(e?.message ?? e) }; }
      const extend = parseModerator(raw);
      rec.json(`moderator-${round}-reply.json`, { raw, extend });
      step = nextStep({ round, majority: null, ...caps, moderatorExtends: extend });
      if (extend && step === 'next-round') moderatorRounds += 1;
    }
    if (step !== 'next-round') break;
    round += 1;
  }
  rec.json('state.json', state);
  const talked = unavailable
    ? seatsUnavailableOutcome({ rounds: round, silent: unavailable.silent, answering: unavailable.answering, moderatorRounds })
    : outcomeOf({ phase, majority: last.majority, unanimous: last.unanimous, rounds: round, moderatorRounds });
  // THE RECORD A-24 ASKS FOR (decision-records.plan.md stage 3): each seat's last position, family, citations, basis set
  // by code from them, and what would change its choice; the decision's basis, the lowest among the majority's seats;
  // the floor in force; and the outcome grounded against it (DR-D6 A: below the floor, to the operator).
  const lastVotes = state.rounds.at(-1)?.votes ?? [];
  const seatRecords = lastVotes.map((v) => ({
    seat: v.seat, family: families[v.seat] ?? null, entry: v.entry, citations: v.citations ?? [],
    basis: v.entry === null ? null : grounding.basisOf(v.citations ?? []), what_would_change: v.what_would_change ?? null,
  }));
  const bases = Object.fromEntries(seatRecords.map((s) => [s.seat, s.basis]));
  const basis = talked.entry ? decisionBasis(bases, lastVotes.filter((v) => v.entry === talked.entry).map((v) => v.seat)) : null;
  // THE POSITIONS AS THE OPERATOR'S OPTIONS (G-14 of 20261101-065930-dr-delivery): each entry a seat held last, with its label.
  const positions = [];
  for (const v of lastVotes) {
    if (v.entry === null || v.entry === undefined) continue;
    let p = positions.find((x) => x.entry === v.entry);
    if (!p) { p = { entry: v.entry, label: state.entries.find((e) => e.id === v.entry)?.label ?? null, seats: [] }; positions.push(p); }
    p.seats.push(v.seat);
  }
  const outcome = settleOutcome(talked, { basis, floor: grounding.floor, positions });
  const entry = outcome.entry ? state.entries.find((e) => e.id === outcome.entry) : null;
  const full = { ...outcome, label: entry?.label ?? null, phase, basis, floor: grounding.floor, seats: seatRecords,
    what_would_change: seatRecords.filter((s) => s.what_would_change).map((s) => ({ seat: s.seat, text: s.what_would_change })) };
  rec.json('outcome.json', full);
  return { outcome: full, state };
}

/**
 * THE RECORD'S OWNER (decision-records.plan.md stage 6; ARCHITECTURE A-30): `confined` rooted at an admitted real
 * directory, with the segments from it to the record. decide.mjs roots it at the repository (`.claude`, `decisions`,
 * the id), so a link at any of those levels is refused; without `root`, it is rooted at the record's parent, whose own
 * links the caller answers for (a test's temporary directory).
 */
export function recordStore(recordDir, { root = null, prefix = null } = {}) {
  // The default is rooted at the record's parent AS NAMED (G-11 of 20261102-231209-rbr-remediation-6-review), so a link
  // standing at that parent is refused by the owner's root check rather than resolved away before it.
  const owner = root ? confined(root) : confined(path.dirname(path.resolve(recordDir)));
  const pre = root ? [...prefix] : [path.basename(path.resolve(recordDir))];
  const seg = (...names) => [...pre, ...names.flatMap((n) => String(n).split('/'))];
  return {
    owner, prefix: pre, seg,
    path: (...names) => owner.resolve(seg(...names)),
    text: (name, s) => owner.replace(seg(name), s),
    json: (name, v) => owner.replace(seg(name), `${JSON.stringify(v, null, 2)}\n`),
  };
}

/**
 * A SEAT'S SCRATCH INTO THE RECORD, WITH NO LINK AND NO HALF COPY (G-18 of 20261101-014615-ar-delivery-remediation-review).
 * The scratch is read through `confined` rooted at the scratch root AS NAMED, the seat's directory a segment below it
 * (G-12 of 20261102-231209-rbr-remediation-6-review): rooted at the scratch's real path, a link the seat's call left AT
 * its directory was resolved, its target copied into the record and then deleted. A link at the root or at the seat's
 * directory is now refused before anything is read or removed; a link below it is not followed but listed in
 * `links-refused.json`. Each file is written into the record through the record's owner. A copy that fails removes what
 * it wrote of the destination and leaves the scratch where it was; the scratch is removed, through the same owner, only
 * once the record holds it. A seat whose call made no directory has nothing to move.
 */
function moveScratchIntoRecord(scratchRoot, name, rec, destName) {
  const from = confined(path.resolve(scratchRoot));
  if (!from.exists([name])) return;
  const refused = [];
  const walk = (segs) => {
    for (const ent of from.list([name, ...segs], { withFileTypes: true })) {
      const here = [...segs, ent.name];
      if (ent.isSymbolicLink()) { refused.push(here.join('/')); continue; }
      if (ent.isDirectory()) { walk(here); continue; }
      if (ent.isFile()) rec.owner.replace(rec.seg(destName, ...here), from.read([name, ...here], null));
    }
  };
  try {
    rec.owner.dir(rec.seg(destName));
    walk([]);
    if (refused.length) rec.json(`${destName}/links-refused.json`, { refused });
  } catch (e) {
    try { rec.owner.remove(rec.seg(destName), { recursive: true }); } catch { /* the copy's error is the one to report */ }
    throw e;
  }
  from.remove([name], { recursive: true });
}

/**
 * The decision's final outcome: the revote's when one ran, else the first talk's; null when none was written. ONLY A
 * MISSING FILE FALLS THROUGH (G-12 of 20261101-032931-ar-remediation-3-review): an outcome that cannot be read or parsed
 * is refused, naming the file, never read as the earlier outcome, which is the decision's stale state. Read through the
 * record's owner (stage 6): a link at the record, or below it, is refused.
 */
export function finalOutcome(dir, store = null) {
  const rec = store ?? recordStore(dir);
  for (const names of [['revote', 'outcome.json'], ['outcome.json']]) {
    let body;
    try { body = rec.owner.read(rec.seg(...names)); } catch (e) {
      if (e?.code === 'ENOENT') continue;
      throw new Error(`the decision's outcome ${path.join(dir, ...names)} could not be read (${e?.message ?? e}); it is refused, not skipped`);
    }
    try { return JSON.parse(body); } catch (e) {
      throw new Error(`the decision's outcome ${path.join(dir, ...names)} is not JSON (${e.message}); it is refused, not read as the earlier outcome`);
    }
  }
  return null;
}
