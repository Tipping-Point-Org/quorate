// The adjudication merge: independent votes on one disputed group, counted rather than resolved.
//
// .claude/requests/adjudication-merge-for-disputes.md. Before this, a lens and an arm contradicting
// each other went to ONE judge whose vote became the ruling, with nothing recorded about its
// reliability -- "a precision figure from one judge cannot say how often the judge is wrong".
//
// Every rule here is asserted on the pure merge, offline, because the live transport costs a vendor
// call per judge and check-tiebreak.mjs is the only place that may spend one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import {
  mergeAdjudication, summariseAdjudications, voteVocabulary, renderVoteVocabulary, VOTE_NEITHER,
} from '../scripts/lib/adjudication.mjs';

const P = ['code-audit', 'panel-codex-code'];
const vote = (judge, supports, extra = {}) =>
  ({ judge, reviewer: judge.replace(/^adj-/, ''), state: 'reachable', supports, ...extra });

test('a strict plurality decides; a tie is the finding', () => {
  const agreed = mergeAdjudication({ participants: P, votes: [vote('adj-a', 'code-audit'), vote('adj-b', 'code-audit')] });
  assert.equal(agreed.decided, true);
  assert.equal(agreed.supports, 'code-audit');
  assert.equal(agreed.single_judge, false);

  const split = mergeAdjudication({ participants: P, votes: [vote('adj-a', 'code-audit'), vote('adj-b', 'panel-codex-code')] });
  assert.equal(split.decided, false, '1-1 is not a verdict');
  assert.equal(split.supports, null);
  assert.match(split.undecided_reason, /a tie is the finding, not something to break/);

  // Three-way, all different: still no plurality.
  const three = mergeAdjudication({
    participants: P,
    votes: [vote('adj-a', 'code-audit'), vote('adj-b', 'panel-codex-code'), vote('adj-c', VOTE_NEITHER)],
  });
  assert.equal(three.decided, false, '1-1-1 has no strict plurality either');

  // 2-1 decides, and the winner is the plurality rather than the first vote seen.
  const majority = mergeAdjudication({
    participants: P,
    votes: [vote('adj-a', VOTE_NEITHER), vote('adj-b', 'panel-codex-code'), vote('adj-c', 'panel-codex-code')],
  });
  assert.equal(majority.decided, true);
  assert.equal(majority.supports, 'panel-codex-code');
});

test('regression: a judge that did not report is ABSENT, never a vote against', () => {
  // The rule the gate already applies to a lens. Silence is not a verdict -- and counting a timed-out
  // judge as disagreeing would manufacture a tie out of an absence, which is the precise failure the
  // panel exists to prevent.
  const m = mergeAdjudication({
    participants: P,
    votes: [
      { judge: 'adj-a', reviewer: 'codex', state: 'unavailable', reason: 'timed out after 15 minutes' },
      vote('adj-b', 'code-audit'),
    ],
  });
  assert.equal(m.coverage.scheduled, 2);
  assert.equal(m.coverage.voted, 1);
  assert.deepEqual(m.tally, { 'code-audit': 1 }, 'the absent judge contributes no vote to any position');
  assert.equal(m.absent.length, 1);
  assert.match(m.absent[0].why, /timed out/, 'the judge own stated reason is kept');
  // THE VOTE IS KEPT, BUT IT DOES NOT DECIDE. Labelling a lone vote SINGLE-JUDGE and letting it
  // stand restored the single-judge path this topology replaced, reachable by one timeout — so the
  // outcome is INQUORATE: a meeting is quorate when enough members are present for its decisions to
  // be valid. The vote is still in the record and still rendered.
  assert.equal(m.outcome, 'inquorate');
  assert.equal(m.decided, false, 'one vote is not a panel');
  assert.equal(m.single_judge, true, 'and the record still says how many voted');
  assert.equal(m.votes_cast.length, 1, 'the judge that DID rule is not discarded');
  assert.match(m.undecided_reason, /one vote is not a panel/);
});

test('regression: a vote naming a non-participant is illegible, not a vote and not an absence', () => {
  // The single-judge code already knew this case and rendered "(NOT a participant in this dispute)".
  // Counting it would put a phantom position in the tally; calling it absent would lose that the
  // judge answered at all.
  const m = mergeAdjudication({ participants: P, votes: [vote('adj-a', 'security-audit'), vote('adj-b', 'code-audit')] });
  assert.equal(m.invalid.length, 1);
  assert.equal(m.invalid[0].supports, 'security-audit');
  assert.equal(m.absent.length, 0, 'it answered; it is not silent');
  assert.deepEqual(m.tally, { 'code-audit': 1 });
});

test('agreement is reported with its pair count, and kappa is refused with a reason', () => {
  // ONE JUDGE AGREES WITH ITSELF TRIVIALLY. Reporting that as 100% is how a single-judge number puts
  // on a bigger font, which is the sentence this whole change is built around.
  const alone = mergeAdjudication({ participants: P, votes: [vote('adj-a', 'code-audit')] });
  assert.equal(alone.agreement.rate, null, 'no pair, no rate');
  assert.equal(alone.agreement.pairs_compared, 0);

  const pair = mergeAdjudication({ participants: P, votes: [vote('adj-a', 'code-audit'), vote('adj-b', 'code-audit')] });
  assert.equal(pair.agreement.rate, 1);
  assert.equal(pair.agreement.pairs_compared, 1, 'the count must travel with the rate');

  // Fleiss' kappa needs a distribution over many items; a run produces 0-2 disputes. Refused
  // explicitly rather than invented from a sample of one.
  assert.equal(pair.agreement.kappa, null);
  assert.match(pair.agreement.kappa_why, /single item/);
  assert.match(summariseAdjudications([pair]).agreement.kappa_why, /too few disputes/);
});

test('a judge that is a PARTY to the dispute is recorded as one', () => {
  // With two external vendors and every arm on codex, a fully neutral pair is not available. The
  // source work measured this bias directly: a model judging its own output rated it 8 points above
  // the panel's figure for the same items. Recorded per judge rather than quietly accepted.
  const m = mergeAdjudication({
    participants: P,
    votes: [vote('adj-codex', 'panel-codex-code', { party: true }), vote('adj-agy', 'panel-codex-code')],
  });
  assert.deepEqual(m.party_judges, ['adj-codex']);
  assert.equal(m.non_party_votes, 1, 'the figure that would make this neutral if it reached 2');
});

test('the vote vocabulary and its definitions come from ONE declaration', () => {
  // Kappa 0.12 with bare names, 0.66 with definitions, on the same 147 items: "the disagreement was
  // never about the passages." The merge accepts exactly what the brief offers, from one source, so
  // the two cannot drift -- the shape that already cost this project the intent canary's two
  // mismatched line windows.
  const vocab = voteVocabulary(P);
  assert.deepEqual(vocab.map((v) => v.value), [...P, VOTE_NEITHER]);
  for (const v of vocab) assert.ok(v.definition.length > 30, `${v.value} needs a definition, not a label`);

  // `neither` is the category that splits panels, so it carries a worked example.
  const neither = vocab.find((v) => v.value === VOTE_NEITHER);
  assert.match(neither.definition, /NOT "both are wrong"/);
  assert.match(neither.definition, /Worked example/);

  // And the rendering the brief gets is derived from it, not restated beside it.
  const rendered = renderVoteVocabulary(P);
  for (const v of vocab) assert.ok(rendered.includes(v.value) && rendered.includes(v.definition.slice(0, 40)));

  // The merge refuses a vote outside that vocabulary -- proving both sides read the same list.
  const m = mergeAdjudication({ participants: P, votes: [vote('adj-a', 'not-a-position')] });
  assert.equal(m.invalid.length, 1);
});

test('the summary carries per-judge counts, not only a total', () => {
  // Round 6 upstream moved kappa 0.66 -> 0.35 while the headline barely changed, because one judge's
  // objection was a different rule that more items gave more to fire on. "A panel number without its
  // per-judge counts hides which way the instrument moved."
  const a = mergeAdjudication({ participants: P, votes: [vote('adj-x', 'code-audit'), vote('adj-y', 'code-audit')] });
  const b = mergeAdjudication({
    participants: P,
    // Same judge as above, so `reviewer` must match what vote() derives — the absent entry declared
    // 'agy' while the voting entries derived 'y', which split one judge across two rows the moment
    // the summary started keying on the vendor. An inconsistent fixture, not a defect in the code.
    votes: [vote('adj-x', 'code-audit'), { judge: 'adj-y', reviewer: 'y', state: 'malformed', reason: 'no envelope' }],
  });
  const s = summariseAdjudications([a, b]);
  assert.equal(s.adjudicated, 2);
  assert.equal(s.decided, 1, 'only the two-judge group decided');
  assert.equal(s.inquorate, 1, 'the one-judge group is inquorate, not decided');
  assert.equal(s.single_judge, 1, 'and the gate must see that one group had a lone voter');

  // KEYED BY THE DECLARED JUDGE (G-14). These were looked up as 'x' and 'y' — the vendor `vote()`
  // derives by stripping `adj-` — and are now the judge ids themselves. Rows still aggregate across
  // disputes, which is the whole reason the table exists; what changed is that two judges sharing one
  // adapter no longer merge. Note the fixture scar recorded just above disappears under this keying:
  // a judge whose absent entry declared a different reviewer than its votes can no longer split.
  const x = s.per_judge.find((r) => r.judge === 'adj-x');
  const y = s.per_judge.find((r) => r.judge === 'adj-y');
  assert.ok(x && y, 'a row per JUDGE, not a row per (group, judge) and not a row per adapter');
  assert.equal(x.voted, 2);
  assert.equal(y.voted, 1);
  assert.equal(y.absent, 1, 'coverage is per judge, so an unreliable judge is visible as itself');
  assert.deepEqual(x.votes, { 'code-audit': 2 });
});

test('an empty panel is undecided and says which way it was empty', () => {
  assert.match(mergeAdjudication({ participants: P, votes: [] }).undecided_reason, /no judge was scheduled/);
  const allAbsent = mergeAdjudication({
    participants: P,
    votes: [{ judge: 'adj-a', state: 'unavailable', reason: 'x' }, { judge: 'adj-b', state: 'malformed', reason: 'y' }],
  });
  assert.equal(allAbsent.decided, false);
  assert.match(allAbsent.undecided_reason, /2 absent, 0 illegible/);
});

test('regression: the per-judge summary aggregates by JUDGE IDENTITY, not by node id', () => {
  // Found by the sweep of the commit that introduced this table, in the section that commit added.
  //
  // `judge` is the node id -- `adjudicate-G-5-agy` -- which is unique per (group, judge). Grouping
  // on it meant nothing ever aggregated: the first real run produced SIX one-vote rows for TWO
  // judges, rendering as `agy, codex, agy, codex, agy, codex`. The point of a per-judge table is the
  // pattern ACROSS disputes, and a row per vote shows a reader nothing the individual rulings do not
  // already say. "A panel number without its per-judge counts hides which way the instrument moved"
  // -- and so does a per-judge count that is really a per-vote count.
  //
  // AMENDED for G-14. This test was written when votes carried the NODE id and asserted that keying on
  // the VENDOR rescued the aggregation. Both halves aged: run-graph.mjs:3374 now sends the DECLARED
  // judge id (`adj-agy`), and vendor keys merge two DIFFERENT judges that share an adapter -- a roster
  // capabilities.mjs explicitly permits, since agy serves Gemini and Claude models alike. So the
  // fixture was feeding an input production had stopped producing, and the assertion was pinning the
  // rescue rather than the goal (A-15: a probe must not differ from production in a dimension that can
  // fail). The GOAL is unchanged and still checked: two judges are two rows, aggregated across
  // disputes, with party sticky.
  const P = ['contract-audit', 'panel-codex-contract'];
  const v = (judgeId, reviewer, supports, party) =>
    ({ judge: judgeId, reviewer, state: 'reachable', supports, party });

  // The three disputes the sweep actually produced, with the same votes.
  const merges = [
    mergeAdjudication({ participants: P, votes: [v('adj-agy', 'agy', VOTE_NEITHER, false), v('adj-codex', 'codex', VOTE_NEITHER, true)] }),
    mergeAdjudication({ participants: P, votes: [v('adj-agy', 'agy', 'contract-audit', false), v('adj-codex', 'codex', 'panel-codex-contract', true)] }),
    mergeAdjudication({ participants: P, votes: [v('adj-agy', 'agy', 'contract-audit', false), v('adj-codex', 'codex', 'contract-audit', true)] }),
  ];
  const s = summariseAdjudications(merges);

  assert.equal(s.per_judge.length, 2, 'two judges must produce two rows, whatever the node ids were');
  const agy = s.per_judge.find((r) => r.judge === 'adj-agy');
  const codex = s.per_judge.find((r) => r.judge === 'adj-codex');
  assert.ok(agy && codex, 'rows are keyed by the DECLARED judge, so two judges on one adapter stay two');
  assert.equal(agy.voted, 3);
  assert.equal(codex.voted, 3);
  // THE PATTERN IS THE POINT: one judge concentrated, the other spread across three positions.
  assert.deepEqual(agy.votes, { [VOTE_NEITHER]: 1, 'contract-audit': 2 });
  assert.deepEqual(codex.votes, { [VOTE_NEITHER]: 1, 'panel-codex-contract': 1, 'contract-audit': 1 });

  // A STAKE ON ANY DISPUTE IS A FACT ABOUT THE JUDGE'S RUN. Taking the last vote's flag would report
  // whichever dispute happened to merge last; a judge that was a party once is not a neutral judge.
  assert.equal(codex.party, true);
  assert.equal(agy.party, false);

  // And the run-level arithmetic is unchanged by the regrouping.
  assert.equal(s.decided, 2);
  // `tied`, not `undecided`. The combined field is gone on purpose: it merged a measured tie with a
  // panel that never reported, and a consumer must now name which one it means.
  assert.equal(s.tied, 1, 'the 1-1 split stays undecided, as a TIE');
  assert.equal(s.absent, 0, 'and nothing here was unadjudicated');
  assert.equal(s.agreement.rate, 0.667);
  assert.equal(s.agreement.pairs_compared, 3);
});

test('regression: a panel that never reported is ABSENT, not a measured tie', () => {
  // Raised as a HIGH by contract-audit on the sweep of the commit that introduced this module, and
  // the criterion it cites is the one this framework repeats most: adjudication ABSENT and
  // adjudication UNDECIDED must stay distinguishable in every artifact.
  //
  // They were not. `decided: false` meant both "the judges reported and tied" and "no judge reported
  // at all", and only the PROSE `undecided_reason` told them apart -- so the summary counted both as
  // undecided, run-graph rendered both as "**Panel: UNDECIDED**", and the gate printed one line. A
  // dispute where every judge timed out arrived as a measured tie. Silence read as a verdict.
  //
  // My own tests asserted the two reason STRINGS, which is exactly why they passed: prose that
  // differs is not a value anything can branch on.
  const tied = mergeAdjudication({
    participants: P,
    votes: [vote('adj-a', 'code-audit'), vote('adj-b', 'panel-codex-code')],
  });
  const absent = mergeAdjudication({
    participants: P,
    votes: [
      { judge: 'adj-a', reviewer: 'a', state: 'unavailable', reason: 'timed out' },
      { judge: 'adj-b', reviewer: 'b', state: 'malformed', reason: 'no envelope' },
    ],
  });
  const decided = mergeAdjudication({
    participants: P,
    votes: [vote('adj-a', 'code-audit'), vote('adj-b', 'code-audit')],
  });

  // THE MACHINE VALUE, which is the whole finding. Both were `decided: false` before.
  assert.equal(tied.outcome, 'tied');
  assert.equal(absent.outcome, 'absent');
  assert.equal(decided.outcome, 'decided');
  assert.equal(tied.decided, false);
  assert.equal(absent.decided, false, 'both are still not decided — that part was never wrong');

  // And the summary counts them apart rather than adding them.
  const s = summariseAdjudications([tied, absent, decided]);
  assert.equal(s.decided, 1);
  assert.equal(s.tied, 1);
  assert.equal(s.absent, 1, 'a group nobody judged must not be counted as a group that tied');
  assert.equal(s.decided + s.tied + s.absent, s.adjudicated, 'every group lands in exactly one bucket');

  // The renderer must branch on the value, not on the reason text.
  const graph = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'run-graph.mjs'), 'utf8');
  assert.match(graph, /m\.outcome === 'absent'/, 'the render branches on the outcome');
  assert.match(graph, /Panel: NOT ADJUDICATED/);
  assert.match(graph, /Panel: UNDECIDED \(tied\)/);
  assert.match(graph, /\$\{s\.tied\} tied/, 'and the gate line reports them separately');
  assert.match(graph, /\$\{s\.absent\} not adjudicated/);
});

test('regression: an illegible vote keeps its judge in the per-judge table', () => {
  // I-8 names this: "a judge returns a schema-valid category the merge does not accept, and the vote
  // is dropped silently". summariseAdjudications iterated votes_cast and absent and NEVER invalid,
  // so a judge whose vote named a non-participant got no row -- and the gate's table is built from
  // per_judge, so that judge vanished from the gate entirely, counted as neither voted nor absent.
  // The panel read as smaller than the one that actually ran.
  const m = mergeAdjudication({
    participants: P,
    votes: [vote('adj-a', 'security-audit'), vote('adj-b', 'code-audit')],
  });
  const s = summariseAdjudications([m]);
  // Keyed by the declared judge since G-14; was the stripped vendor 'a'.
  const a = s.per_judge.find((r) => r.judge === 'adj-a');
  assert.ok(a, 'the judge that answered unusably must still appear');
  assert.equal(a.illegible, 1);
  assert.equal(a.voted, 0, 'it did not vote');
  assert.equal(a.absent, 0, 'and it was not silent — three states, not two');
  assert.equal(s.per_judge.length, 2, 'both scheduled judges are visible');
});

test('regression: coverage counts judges SCHEDULED, not votes that arrived', () => {
  // A vote is pushed inside the pool worker, and runPool stops taking items once `aborted` is set.
  // A SIGINT between two judges of one group left the second out of `votes` ENTIRELY -- not absent,
  // just missing -- so the group reported coverage 1/1 and read exactly like a panel that never had
  // a second judge. The caller knows how many it sent.
  const interrupted = mergeAdjudication({
    participants: P,
    votes: [vote('adj-a', 'code-audit')],   // the second judge never ran, so it is not here at all
    scheduled: 2,
  });
  assert.equal(interrupted.coverage.scheduled, 2, 'the panel that was SENT, not the votes that came back');
  assert.equal(interrupted.coverage.voted, 1);
  assert.equal(interrupted.outcome, 'inquorate');

  // A direct caller that says nothing still gets a coherent answer rather than a crash.
  const noHint = mergeAdjudication({ participants: P, votes: [vote('adj-a', 'code-audit')] });
  assert.equal(noHint.coverage.scheduled, 1);
});

test('regression: the merged confidence does not depend on which judge finished first', () => {
  // It took the FIRST winning vote carrying a confidence, and votes are pushed in pool completion
  // order -- so two judges backing the same position with different confidences yielded a merged
  // confidence decided by vendor latency. Identical inputs, any order, identical output.
  const hi = vote('adj-a', 'code-audit', { confidence: 'high' });
  const lo = vote('adj-b', 'code-audit', { confidence: 'low' });
  const ab = mergeAdjudication({ participants: P, votes: [hi, lo] });
  const ba = mergeAdjudication({ participants: P, votes: [lo, hi] });
  assert.equal(ab.confidence, ba.confidence, 'order must not change the answer');
  assert.equal(ab.confidence, null, 'and judges who disagree about confidence have no shared one');

  // Unanimous confidence IS the panel's — refusing it would throw away real agreement.
  const both = mergeAdjudication({
    participants: P,
    votes: [vote('adj-a', 'code-audit', { confidence: 'high' }), vote('adj-b', 'code-audit', { confidence: 'high' })],
  });
  assert.equal(both.confidence, 'high');
});
