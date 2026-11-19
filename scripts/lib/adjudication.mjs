// adjudication.mjs — the merge rule for a disputed finding group: independent votes, counted.
//
// The third panel topology, and the pointer here named two terms that appear in neither document.
// `shared/graph-topologies.md` names Diamond, Fan-in at barrier and Adjudication panel; REVIEW and
// PROPOSAL are `shared/external-reviewers.md`'s "The uses of the panel". A reader following the old
// sentence found neither term in the file it cited (found by doc-consistency-review).
//
// This is ADJUDICATION: independent votes on one fixed item, where disagreement is MEASURED rather
// than resolved, and the merge is arithmetic rather than a model's judgment.
//
// Why it replaced a single vote (.claude/requests/adjudication-merge-for-disputes.md): a lens and an
// arm contradicted each other, one vendor voted, and that vote became the ruling with nothing
// recorded about its reliability. "A precision figure from one judge cannot say how often the judge
// is wrong." The fan-out is redundant by design; the fan-in was not.
//
// PURE, so the offline suite can assert every rule below without spending a vendor call. The live
// transport is exercised by the reviewer preflight: external-review's tie-break probe, before a judge is used, and
// check-reviewers.mjs on demand (check-tiebreak.mjs did this until reviewer-preflight stage 4).

/** The vote a judge returns when the excerpt does not settle the dispute. */
export const VOTE_NEITHER = 'neither';

/**
 * The vote vocabulary AND its definitions, from one declaration.
 *
 * THE LARGEST MEASURED EFFECT IN THE SOURCE WORK IS THIS. Adjudicating 147 items with the category
 * NAMES alone gave Fleiss' kappa 0.12; adding one-line definitions gave 0.66, and two judges'
 * pairwise agreement went 36% → 97% on the same items. "The disagreement was never about the
 * passages." A panel handed bare labels measures how differently its judges read the labels.
 *
 * Owned once because the prompt and the merge must accept the same set. quorate has already paid for
 * the two-owner version of exactly this shape twice: the intent canary asked for one window of lines
 * and scored against another, and EXECUTABLE_COMMAND_KEYS existed because a byte-identical literal
 * sat in two modules that never communicate.
 */
export function voteVocabulary(participants = []) {
  const ids = [...new Set((participants ?? []).filter((p) => typeof p === 'string' && p))];
  return [
    ...ids.map((id) => ({
      value: id,
      definition: `the position ${id} took is the one the excerpt supports, on the evidence shown`,
    })),
    {
      value: VOTE_NEITHER,
      // THE CATEGORY THAT SPLITS PANELS, so it gets the worked example. In the source work the
      // single axis that produced kappa 0.12 — and reappeared at 0.52 and 0.35 in later rounds —
      // was one category two judges read differently. Here that category is this one: a judge
      // meaning "the excerpt is insufficient" and a judge meaning "both positions are wrong" cast
      // the same vote for opposite reasons, and the merge cannot tell them apart.
      definition: 'the excerpt does not settle it — NOT "both are wrong". Worked example: an arm '
        + 'claims a guard is unreachable and a lens claims it fires, the excerpt shows the guard but '
        + 'not its caller, so nothing here decides which is right: that is `neither`. If the excerpt '
        + 'DOES show the caller and both readings of it are mistaken, that is still a vote for '
        + 'whichever position is closer, with the mistake stated in your rationale.',
    },
  ];
}

/**
 * Just the legal vote VALUES, for callers that need the set without the prose.
 *
 * The schema layer needed it — `supports` was declared a free string, so a third copy of this list
 * lived as a literal in run-graph's validity check. One owner means one list; a caller that wants
 * only the names asks for them rather than re-deriving them.
 */
export function voteValuesFor(participants = []) {
  return voteVocabulary(participants).map((v) => v.value);
}

/** The vocabulary rendered for a brief. Pre-rendered, because the templates carry no logic. */
export function renderVoteVocabulary(participants = []) {
  return voteVocabulary(participants)
    .map((v) => `- \`${v.value}\` — ${v.definition}`)
    .join('\n');
}

/**
 * Merge one dispute's votes.
 *
 * `votes` is one entry per judge that was SCHEDULED, whether or not it answered:
 *   { judge, reviewer, state, supports, confidence, party }
 *
 * `state` comes from classifyPanelProbe, so 'reachable' is the only value that can carry a vote.
 * Everything else is ABSENT with coverage 0 — never a vote against, which is the rule the gate
 * already applies to a lens that did not report. Silence is not a verdict.
 */
export function mergeAdjudication({ participants = [], votes = [], scheduled = null } = {}) {
  const legal = new Set(voteVocabulary(participants).map((v) => v.value));

  const cast = [];       // judges that returned a legible vote
  const absent = [];     // scheduled, did not answer legibly
  const invalid = [];    // answered, but named something that is not a position in this dispute

  for (const v of votes ?? []) {
    const judge = v?.judge ?? v?.reviewer ?? 'unknown';
    if (v?.state !== 'reachable') {
      absent.push({ judge, reviewer: v?.reviewer ?? null, why: v?.reason ?? 'did not report' });
      continue;
    }
    if (!legal.has(v?.supports)) {
      // A VOTE FOR A NON-PARTICIPANT IS NOT A VOTE, and it is not an absence either. The previous
      // single-judge code already knew this case — it rendered "(NOT a participant in this dispute
      // — treat as unresolved)" — and counting it would put a phantom position in the tally.
      invalid.push({ judge, reviewer: v?.reviewer ?? null, supports: v?.supports ?? null });
      continue;
    }
    cast.push({
      judge,
      reviewer: v?.reviewer ?? null,
      supports: v.supports,
      confidence: v?.confidence ?? null,
      // A JUDGE THAT IS A PARTY TO THE DISPUTE IT IS JUDGING. With two external vendors and every
      // arm on one of them, a fully neutral pair is not available today — see the run's
      // not_checked[]. Recorded per judge rather than silently accepted, because the source work
      // measured this exact bias: a model judging its own output rated it 8 points above the
      // panel's figure for the same items.
      party: Boolean(v?.party),
    });
  }

  const tally = {};
  for (const c of cast) tally[c.supports] = (tally[c.supports] ?? 0) + 1;
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);

  // DECIDED MEANS A STRICT PLURALITY. Two judges splitting 1–1 is a tie, and three splitting
  // 1–1–1 is a tie; in both the panel did not settle it, which is a different fact from a
  // considered `neither` and is rendered differently.
  const top = ranked[0] ?? null;
  const runnerUp = ranked[1] ?? null;
  const decided = Boolean(top && (!runnerUp || top[1] > runnerUp[1]));

  // THREE OUTCOMES, IN A MACHINE VALUE — because two of them were distinguishable only by prose.
  //
  // `decided: false` meant BOTH "the judges reported and tied" and "no judge reported at all", and
  // only `undecided_reason` told them apart. Downstream that collapsed completely: the summary
  // counted both as `undecided`, run-graph rendered both as "**Panel: UNDECIDED**", and the gate
  // printed one "M undecided" line. So a dispute where every judge timed out arrived as a MEASURED
  // TIE — silence reading as a verdict, in the component built to stop that, and against the one
  // rule this framework repeats most.
  //
  // Raised as a HIGH by contract-audit on the sweep of the commit that introduced it. My own tests
  // asserted the two REASON STRINGS, which is why they passed: prose that differs is not a value
  // anything can branch on.
  // A ONE-JUDGE PANEL IS INQUORATE, AND THAT IS THE WHOLE POINT OF THE NAME.
  //
  // The first version labelled a lone surviving vote `single_judge` and let it DECIDE. Raised as a
  // finding on the sweep of that commit: "if the other judge refuses or times out, the original
  // single-judge decision path is restored, merely labeled SINGLE-JUDGE" — which is the thing this
  // request replaced, reachable by one timeout.
  //
  // The label was the wrong remedy and the repository's own first paragraph says why: *a meeting is
  // quorate when enough members are present for its decisions to be valid*. One vote is not a panel.
  // Its ruling does not stand — it is recorded, visible, and reported as what it is, so nothing is
  // thrown away, but it does not become the group's answer.
  //
  // Four outcomes, not three: 'decided' (a strict plurality of a quorate panel), 'tied' (they
  // reported and split), 'inquorate' (fewer votes than a panel needs), 'absent' (nobody reported).
  const QUORUM = 2;
  const outcome = !cast.length
    ? 'absent'
    : cast.length < QUORUM
      ? 'inquorate'
      : (decided ? 'decided' : 'tied');

  let undecided_reason = null;
  if (outcome === 'absent') {
    undecided_reason = absent.length || invalid.length
      ? `no judge returned a legible vote (${absent.length} absent, ${invalid.length} illegible)`
      : 'no judge was scheduled';
  } else if (outcome === 'inquorate') {
    undecided_reason = `only ${cast.length} of ${QUORUM} judges voted (${absent.length} absent, `
      + `${invalid.length} illegible) — one vote is not a panel, so the ruling it would have given `
      + 'is recorded below rather than adopted';
  } else if (outcome === 'tied') {
    undecided_reason = `the panel split ${ranked.map(([k, n]) => `${k}:${n}`).join(' / ')}`
      + ' — a tie is the finding, not something to break';
  }

  return {
    // 'decided' | 'tied' | 'inquorate' | 'absent'. The authoritative field: `decided` is a
    // convenience boolean DERIVED from it, and nothing downstream may infer WHY it is false from
    // its being false.
    outcome,
    decided: outcome === 'decided',
    // A LONE VOTE STILL DECIDES, AND MUST SAY THAT IT WAS ALONE. The source doctrine is explicit —
    // "never report a single-judge precision as a precision; if only one judge ran, say so in the
    // figure's name" — and this whole request exists because a single unlabelled vote was the ruling.
    // Discarding it instead would throw away a judge that did rule; leaving it unmarked would
    // reinstate exactly what was replaced. So it is decided, labelled, and the label reaches the
    // gate and reconciled.md.
    single_judge: cast.length === 1,
    // KEYED ON THE OUTCOME, NOT ON THE PRE-QUORUM PLURALITY (G-13).
    //
    // `decided` (above) is a plurality test computed BEFORE quorum: one vote has no runner-up, so a
    // lone judge makes it true while `outcome` is correctly 'inquorate'. Reading it here wrote that
    // judge's position into adjudication.json — the only machine-readable record of what the panel
    // did (I-12) — so an inquorate group carried a winner the panel never settled on, which I-2
    // forbids. The migration from "a lone vote decides" to "inquorate" reached `outcome` and stopped.
    //
    // reconciled.md happened to render correctly because it branches on `m.decided`; that was the
    // right answer by luck, and luck is not a mechanism.
    supports: outcome === 'decided' ? top[0] : null,
    // ORDER-INDEPENDENT. This took the FIRST winning vote carrying a confidence, and votes are
    // pushed in pool completion order — so two judges backing the same position with different
    // confidences yielded a merged confidence decided by vendor latency. Identical inputs must give
    // identical output whatever order the judges finished in.
    //
    // Unanimous or nothing: when the winners agree on a confidence that is the panel's, and when
    // they disagree the panel has no single confidence to report. Picking one would be inventing
    // agreement, which is the thing this whole module exists not to do.
    confidence: (() => {
      if (outcome !== 'decided') return null;
      const winners = cast.filter((c) => c.supports === top[0]).map((c) => c.confidence ?? null);
      const distinct = [...new Set(winners.filter((x) => x !== null))];
      return distinct.length === 1 ? distinct[0] : null;
    })(),
    undecided_reason,
    tally,
    votes_cast: cast,
    absent,
    invalid,
    // SCHEDULED IS TOLD, NOT COUNTED. It was `votes.length` — but a vote is only pushed inside the
    // pool worker, and runPool stops taking items once `aborted` is set. A SIGINT between two judges
    // of one group left the second out of `votes` ENTIRELY: not absent, just missing, so the group
    // reported coverage 1/1 and read exactly like a panel that never had a second judge. The caller
    // knows how many it scheduled; falling back to the vote count keeps a direct caller honest
    // rather than crashing, and the run-graph path always passes it.
    coverage: { scheduled: Number.isInteger(scheduled) ? scheduled : (votes ?? []).length, voted: cast.length },
    // Judges that were party to the dispute, named so a reader can discount them. `non_party_votes`
    // is the number of votes from judges with no stake, which is the figure that would make this a
    // neutral panel if it ever reaches 2.
    party_judges: cast.filter((c) => c.party).map((c) => c.judge),
    non_party_votes: cast.filter((c) => !c.party).length,
    agreement: pairwiseAgreement(cast),
  };
}

/**
 * Pairwise agreement over the judges that voted, for ONE dispute.
 *
 * KAPPA IS NOT COMPUTED HERE, AND THAT IS NOT AN OMISSION. Fleiss' kappa needs a distribution over
 * many items to estimate chance agreement; the source work reports it over 46–157. A quorate run
 * produces 0–2 disputes, so a kappa from one item would be a statistic invented from a sample of
 * one — the class of number this project refuses elsewhere ("do not run 20 items and report a
 * percentage to one decimal"). Pairwise agreement is defined for a single pair and is reported
 * instead, with the pair count beside it so nobody reads 100% off one pair as a panel property.
 */
export function pairwiseAgreement(cast = []) {
  const pairs = [];
  for (let i = 0; i < cast.length; i++) {
    for (let j = i + 1; j < cast.length; j++) {
      pairs.push({ a: cast[i].judge, b: cast[j].judge, agree: cast[i].supports === cast[j].supports });
    }
  }
  const agreed = pairs.filter((p) => p.agree).length;
  return {
    pairs,
    pairs_compared: pairs.length,
    // null rather than 1 when there is nothing to compare: one judge agrees with itself trivially,
    // and reporting that as perfect agreement is how a single-judge number puts on a bigger font.
    rate: pairs.length ? Number((agreed / pairs.length).toFixed(3)) : null,
    kappa: null,
    kappa_why: 'not computed: chance agreement cannot be estimated from a single item',
  };
}

/**
 * Roll several disputes' merges into what the gate prints.
 *
 * PER-JUDGE COUNTS, NOT ONLY A TOTAL. The source work's round 6 moved kappa 0.66 → 0.35 while the
 * headline precision barely changed, because one judge's objection was a different rule that more
 * items gave more to fire on: "a panel number without its per-judge counts hides which way the
 * instrument moved." So the summary carries every judge's votes and coverage, and the aggregate
 * agreement is reported beside them rather than instead of them.
 */
export function summariseAdjudications(merges = []) {
  const perJudge = new Map();
  let pairs = 0;
  let agreed = 0;

  // KEYED BY THE VENDOR, NOT THE NODE ID — and keying it wrong made this table useless in exactly
  // the way its own criterion warns about.
  //
  // `judge` is the node id, `adjudicate-G-5-agy`, which is unique per (group, judge). Grouping on it
  // meant nothing ever aggregated: the first real run produced SIX one-vote rows for TWO judges,
  // rendering as `agy, codex, agy, codex, agy, codex`. The point of a per-judge table is the pattern
  // ACROSS disputes — "agy voted neither once and the lens position twice" — and a row per vote
  // shows a reader precisely nothing they could not read off the individual rulings. "A panel number
  // without its per-judge counts hides which way the instrument moved"; so does a per-judge count
  // that is really a per-vote count.
  //
  // Found by the sweep of the commit that introduced it, in the section that commit added.
  // THE DECLARED JUDGE, THEN THE TRANSPORT (G-14). The comment above is accurate about the world it
  // was written in and false about this one: `judge` WAS the node id (`adjudicate-G-5-agy`), unique
  // per group, so grouping on it gave one row per vote. run-graph.mjs:3374 now sends the DECLARED id
  // (`adj-agy`), which aggregates across disputes exactly as that comment wants — while keying on the
  // transport merges two DIFFERENT judges that share one adapter, a roster capabilities.mjs
  // explicitly permits because agy serves Gemini models and Claude models alike. Two judges become
  // one row with doubled counts and the cross-family guarantee reads as satisfied when it is not.
  // The fix that was right for the old input became the defect under the new one.
  const keyOf = (v) => v?.judge ?? v?.reviewer ?? 'unknown';
  for (const m of merges ?? []) {
    for (const c of m?.votes_cast ?? []) {
      const k = keyOf(c);
      const row = perJudge.get(k) ?? { judge: k, reviewer: c.reviewer ?? null, voted: 0, absent: 0, illegible: 0, party: false, votes: {} };
      row.voted += 1;
      row.votes[c.supports] = (row.votes[c.supports] ?? 0) + 1;
      // STICKY, because a stake on ANY dispute is a fact about this judge's run. A judge that was a
      // party once and neutral twice is not a neutral judge, and taking the last vote's flag would
      // report whichever dispute happened to be merged last.
      row.party = row.party || Boolean(c.party);
      perJudge.set(k, row);
    }
    for (const a of m?.absent ?? []) {
      const k = keyOf(a);
      const row = perJudge.get(k) ?? { judge: k, reviewer: a.reviewer ?? null, voted: 0, absent: 0, illegible: 0, party: false, votes: {} };
      row.absent += 1;
      perJudge.set(k, row);
    }
    // ILLEGIBLE VOTES WERE ITERATED BY NOBODY. A judge whose vote named a non-participant appeared
    // in neither `votes_cast` nor `absent`, so it got no per_judge row at all — and the gate's table
    // is built from per_judge, so that judge vanished from the gate entirely: counted as neither
    // voted nor absent, and the panel read as smaller than the one that actually ran. The merge had
    // always recorded `invalid`; the summary simply never looked at it (contract-audit, I-8).
    for (const i of m?.invalid ?? []) {
      const k = keyOf(i);
      const row = perJudge.get(k) ?? { judge: k, reviewer: i.reviewer ?? null, voted: 0, absent: 0, illegible: 0, party: false, votes: {} };
      row.illegible = (row.illegible ?? 0) + 1;
      perJudge.set(k, row);
    }
    for (const p of m?.agreement?.pairs ?? []) { pairs += 1; if (p.agree) agreed += 1; }
  }

  // COUNTED BY OUTCOME, not by the negation of one. `undecided` was every group that was not
  // decided, which merged a measured tie with a panel that never reported — see `outcome` above.
  const countOf = (o) => (merges ?? []).filter((m) => (m?.outcome ?? (m?.decided ? 'decided' : 'tied')) === o).length;
  const decided = countOf('decided');
  return {
    adjudicated: (merges ?? []).length,
    decided,
    tied: countOf('tied'),
    // Fewer votes than a panel needs. Separate from `tied` and from `absent`, because "one judge
    // answered and the other did not" is neither a split nor a silence.
    inquorate: countOf('inquorate'),
    // Disputes the panel never answered on. A gate that prints this beside `tied` is saying two
    // different things; a gate that adds them is saying neither.
    absent: countOf('absent'),
    // Counted at the top level too, so a gate reader sees "3 adjudicated, 2 of them by one judge"
    // rather than having to open three status files to discover the panel was mostly absent.
    single_judge: (merges ?? []).filter((m) => m?.single_judge).length,
    per_judge: [...perJudge.values()].sort((a, b) => a.judge.localeCompare(b.judge)),
    agreement: {
      pairs_compared: pairs,
      rate: pairs ? Number((agreed / pairs).toFixed(3)) : null,
      kappa: null,
      kappa_why: 'not computed: a run produces too few disputes to estimate chance agreement',
    },
  };
}

/**
 * Everything a judge's brief needs, derived ONCE from the group.
 *
 * THE PROBE HAD ITS OWN COPY, AND THE COPY HAD ALREADY DRIFTED. `check-tiebreak.mjs` exists because
 * nothing else exercises this path, and it re-typed the participants, the mechanical facts, the
 * node-id format and the party rule that run-graph computes inline — so the one thing standing in
 * for production was reconstructing production from memory, and its mechanical-facts block was
 * already missing fields the real one states. A probe that differs from production in a dimension
 * that can fail is not a probe; a probe that re-implements production is guaranteed to differ
 * eventually (arch-review, contract-audit).
 *
 * Pure, and returns data rather than prose: the caller renders. `excerpt` is whatever readExcerpt
 * produced, including its failure shape, because "the excerpt is NOT available" is itself one of
 * the mechanical facts a judge needs.
 */
export function adjudicationBrief({ group = {}, excerpt = null, judgeId = null } = {}) {
  const findings = group?.findings ?? [];
  const participants = [...new Set(findings.map((f) => f.node_id).filter(Boolean))];
  const cited = Number(group?.line);
  const inExcerpt = Boolean(
    excerpt?.ok && Number.isFinite(cited) && cited >= excerpt.from && cited <= excerpt.to,
  );
  return {
    participants,
    // THE NODE ID, from here, so the probe cannot send a shape the orchestrator never sends. That
    // divergence is what let every real adjudication be refused at argument-parse time while the
    // probe reported the path as exercised.
    // THROWS RATHER THAN SUBSTITUTING. The first version defaulted the group to 'G-0' and the judge
    // to 'judge', and the probe's group object spells the key `groupId` — so the probe was reading
    // the default, matching production's shape BY COINCIDENCE, in the one helper written to stop the
    // probe and production from diverging. A default here cannot be told from a correct derivation:
    // two disputes missing a group id would both write to `adjudicate-G-0-<judge>`, one overwriting
    // the other's evidence, and the merge would key them together as one.
    nodeId: (id) => {
      const gid = group?.group_id;
      const jid = id ?? judgeId;
      if (!gid) throw new Error('adjudicationBrief: group.group_id is required to name an adjudication node');
      if (!jid) throw new Error('adjudicationBrief: a judge id is required to name an adjudication node');
      return `adjudicate-${gid}-${jid}`;
    },
    // Facts the judges would otherwise each compute. "A fact judges have to compute is a fact judges
    // compute differently" — measured upstream, where one judge raised an objection 59 times that
    // two others never raised, and 48 of the 59 were a string comparison nobody had done for them.
    mechanicalFacts: [
      `- positions in this dispute: ${participants.length}`,
      `- the excerpt ${excerpt?.ok ? `covers lines ${excerpt.from}-${excerpt.to} of ${excerpt.of}` : 'is NOT available'}`,
      `- the cited line ${inExcerpt ? 'IS' : 'is NOT'} inside the excerpt`,
      ...findings.map((f) => `- ${f.node_id} claims severity ${f.severity ?? '?'}`
        + `${f.basis ? ` on basis ${f.basis}` : ''}`),
    ].join('\n'),
  };
}

/**
 * Who was on each side of a disputed group — REPORTED, never a gate.
 *
 * A PURE FUNCTION OF ITS ARGUMENTS, and that is the point. The first version of this was a closure in
 * run-graph reading `groupsById` from an enclosing scope — which was declared in a NESTED block, so
 * the name resolved nowhere and the adjudication artifact threw `ReferenceError: groupsById is not
 * defined` after all ten judges had already ruled. Third occurrence of that class in this phase
 * (`tbStartedAt`, `judgeId`, this), and the only structural cure is a function whose inputs arrive
 * through its parameters: a missing argument is then a value to handle, not a name that might resolve.
 *
 * `armIds` comes from the declared panel arms rather than the `panel-` prefix, because the node-id
 * shape is "a convention lens-roster.json can change".
 *
 * WHY THIS IS NOT A GATE. I-1 describes a dispute as a lens contradicting an external arm, and a
 * script-side check of that silenced every dispute in a live consumer-mount run: the reconcile payload
 * carries no findings at all, `source` is the model family rather than the role, and the most valuable
 * class is invisible either way — a group can hold ONE finding from an arm whose opponent is a lens's
 * `checked_clean` entry, which is not a finding. So the reconciler decides, and this only lets a reader
 * tell a cross-family dispute from an arm-only one.
 */
export function disputeComposition({ findings = [], armIds = [] } = {}) {
  const arms = new Set(armIds);
  const positions = [...new Set((findings ?? []).map((f) => f?.node_id).filter(Boolean))];
  return {
    positions,
    arms: positions.filter((id) => arms.has(id)),
    non_arms: positions.filter((id) => !arms.has(id)),
  };
}
