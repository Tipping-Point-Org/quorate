# The findings ledger's transitions — who may move an entry, and what it records

The one table for `.claude/reviews/ledger.json`: every status, every transition, who may make it, and what
it records. `scripts/lib/ledger.mjs` implements it (`isOpen`, `mergeRun`, `markFixed`, `addObservation`);
`scripts/findings-ledger.mjs` is its command line. ARCHITECTURE.md A-7 states the rule in one sentence and
points here; the doctrine's ledger entry, the remediate skill and QUORATE.md point here too, rather than
restating it.

It was designed in `.claude/requests/ledger-transitions.plan.md` (plan-review PASS on round 7; operator,
2026-09-28: "approved, start stage 1"), after three consecutive reviews each found a new way an entry left
the open set without the operator. The stale thresholds are `STALE_SILENT_REVIEWS` and `STALE_DAYS` in
`scripts/lib/ledger.mjs`. Checking the operator's words against their own messages is not here yet:
`.claude/requests/ledger-quote-verification.plan.md`.

## The actors

- **The fold** (`findings-ledger --run-dir`, `mergeRun`): what a review observed.
- **An agent** — a remediation, this session, anything running `--mark-fixed`, `--add` or a disposition
  without the operator's words: may claim a fix, defer, propose a decline, withdraw its own proposal, or
  file an observation. It may not make, overwrite or undo an operator's decision, and may never write words
  the operator did not say.
- **The operator**: decides. Their decision carries their words (`--operator-quote`). Until
  `ledger-quote-verification` lands, the words are not checked, as today; the fold lists every operator
  decision recorded since the last review, so the operator sees each one.

## The rule

An entry is **open** until one of three **exits**, and each exit names who made it:
1. **a full fix claim, confirmed** (`closed_by: claim+silence`) — a later review in which: the entry's file
   was in the run's scope; the run was a real review (its gate not BLOCKED, a lens reported); a lens that
   RAISED the entry (a review lens, never an observation's `found_by`) reported OK; the run is not the one
   that made the claim; and the entry had **no recorded silence when the claim was made** — a claim on an
   entry the reviews were already silent about adds no evidence, so it goes to the operator, not to exit 1.
   The one exit without the operator, allowed by A-7 and D1. A `partial` claim never takes it ("never").
2. **a decline the operator made or confirmed** (`decided_by: operator`);
3. **a close by the operator** (`closed_by: operator`).

Everything else is a claim, a deferral, a proposal or an observation: recorded, shown, open.

## What a fold counts — a sighting

A fold's mention of an entry is a **sighting**: a reconciled group the run's gate `confirmed`, or a `symptom` of
one, at the severity in the merged reconcile payload — the decision the gate used. A group the reconciler dropped,
or judged a coincidence, is no sighting. The fold reads `finding-groups.json` and `evidence/reconcile/payload.json`
through the one reader (`readReconcileArtifacts`); it no longer reads each lens's kept verdict. (Designed in
`.claude/requests/ledger-identity.plan.md`: the old fold took raw node findings at the node's severity, and a
reconciler-raised HIGH landed as MEDIUM in an unrelated declined entry of the same ten-line bucket.)

- **Refused, never folded as silence:** a run with no `finding-groups.json`; groups with no payload; an artifact
  unreadable, malformed, or reached through a link out of the run. A run that formed no groups is silence, honestly,
  and needs no payload.
- **Unjudged, never silence:** a group the payload did not judge (the reconciler left it out, and its re-ask did too)
  is a sighting with decision `unjudged`, at the highest severity among its findings and with that finding's claim.
  The entry it lands on is marked `unjudged: true` when every mention of it in the run was unjudged, until a judged
  sighting clears it, and `--summary --stale` lists it for the operator: nobody has judged its severity. Until
  2026-10-23 a partly judged payload refused the whole fold (`reconcile-missing-groups.plan.md`, operator: "C").
- **One sighting per entry per run.** Every mention of one entry in one run is combined before any transition: the
  highest severity, with the claim and line of the group carrying it (ties to numeric group order), every group
  id, the union of nodes. A symptom landing on its root's entry is one defect: the root's id stands for both.
- An entry two or more of a run's groups landed on is **shared**; the fold report prints it with its group ids,
  and prints group ids beside every key.

## Statuses

| Status | Open? | Meaning |
|---|---|---|
| `open` | yes | raised and not decided |
| `reopened` | yes | a closed entry raised again, or a decision reopened; the label survives later deferrals |
| `fixed_claimed` | yes | an agent's full fix claim, awaiting confirmation |
| `partial` | yes | an agent's partial fix claim; never closes on silence |
| `declined`, `decided_by: agent` (or no `decided_by`) | **yes** | an agent's proposed decline, awaiting the operator |
| `declined`, `decided_by: operator`, `severity_rose: true` or `raised_again: true` | **yes** | a declined finding a review raised again — worse (`severity_rose`), or at or below its declined severity (`raised_again`, T4); open until the operator re-confirms or reopens it. `declineReturned(entry)` is the one test for both |
| `declined`, `decided_by: operator` | no — exit 2 | the operator's decline |
| `fixed`, `closed_by: claim+silence` | no — exit 1 | a full claim, confirmed |
| `closed`, `closed_by: operator` | no — exit 3 | the operator's close |
| `fixed` closed by silence alone, and `closed` without a quote | no — **legacy** | closed under the previous rule; `legacy: true`, left closed ("leave labelled"); never counts toward M0's gate ("legacy doesn't count") |

`isOpen(entry)` is the single definition of the rows above; `OPEN_STATUSES` is removed. Every reader of
"open work" calls it — the open list, the stale list, the convergence count. The silent-entry report asks a
narrower question ("open, unclaimed, not mentioned by this run"): it calls `isOpen` and then leaves out
`fixed_claimed`, as today, since that silence is what the claim waits for.

## Field sets

Named once, because every row that "voids a claim" or "clears a decision" must clear the same fields:
- **the claim**: `claimed_in`, `claim_evidence`, `silent_at_claim`, `needs_operator`, `claimed_from` (the
  status the claim replaced, so a withdrawn or failed claim puts back `reopened` rather than `open`);
- **the close**: `closed_by`, `closed_in`, `verified_in`, `fixed_in`, `legacy`, `pre_transitions`;
- **the decision**: `decided_by`, `operator_quote`, `declined_severity`, `severity_rose`, `raised_again`,
  `decided_at`, `decided_in`, `kept_at`, `prior_status`;
- **the history**, never cleared by anything: `decisions[]`, one element per DISPOSITION — every one, the
  agent's included (T9–T17; ledger-trust-boundaries 3a). Before, only the operator's were recorded here, and an
  agent's claim or deferral lived in `reason` alone, so the next disposition replaced it: 20 reasons, 2 holding
  the operator's words, were erased that way. `reason` on the entry is now only the latest element's.
  - An element is `{transition, at, run, by, groups, quote, reason}`:
    - `by` is `agent` or `operator`. An element with no `by` was written before this change, when only
      operator transitions wrote any, so it reads as `operator`.
    - `groups` names the review groups it concerns, as `<run>:<G-n>` (`--group`, repeatable), and is absent
      when none was given.
    - `run` is the run it was made in. A disposition made without `--run-dir` records `(manual <ISO time>)`:
      dated and unique, and its leading `(` keeps it out of the newest-review-cycle comparison.
    - `quote_by` is not part of the format: the engine never writes or reads it. A ledger may carry it (always
      `operator`) only from a one-time repair of an existing ledger, marking an agent's element (`by: agent`) whose
      `reason` quotes the operator verbatim. It never makes the element an operator decision.
  - A legacy deferral, which exists only as `deferred_in` and `reason`, is appended as a T11 element before any
    disposition can overwrite it. It is `by: agent`, dated by its run, or `at_unknown: true` with a
    `recorded_at` when its run carries no time (a bare `(manual)`). `recorded_at` is not `kept_at`, the
    entry-level field of the operator's keep.
  - `transition: restored` marks a reason recovered from git history (`restored_from: <commit>`). It is not a
    decision and never counts as one.

  A recurrence or a reopen clears the decision FIELDS above; it never touches `decisions[]`. The fold's list of
  operator decisions reads its `by: operator` elements, so a decision cannot be erased before it is listed.
- **the stay**, never cleared by anything: `stay_started`, when the entry's current stay in the open set began.
  It is set by T1 (a new entry, T8's included), T3 (a closed entry raised again) and T17 (the operator's reopen).
- **the identity** (ledger-identity):
  - `sightings[]`: `{run_id, group_ids, severity}`, appended per sighting by T1-T4, the last 10 kept;
  - `claims[]`: `{run_id, group_id, claim}`, every group's words per sighting with the shown `claim` last, the last 10
    kept — the entry shows the newest claim, and one that two defects passed through says so;
  - `stay_shared[]`: the run-qualified ids (`<run>:<G-n>`) of every shared sighting in the current stay, a set, not
    bounded within a stay. Started by T1 when the creating sighting is shared, appended by T2 and T4, emptied by T3
    before the raising run's ids are added, and by T17.
  - On the ledger, `identity_migrated_at`: written once by `--migrate-identity`, which refuses a second time; the
    anchor T4 reads for a legacy decline with no `decided_at`.

**A claim that does not cover a standing decision goes to the operator (3b).** An entry holds a *standing*
decision while its current stay includes a deferral (T11), an agent's proposed decline (T12) not since
withdrawn (T13), or an operator keep (T14). A T9 or T10 claim on such an entry is recorded with
`needs_operator: true`, so no silent review closes it by exit 1, unless the claim's `--group` values cover every
group that decision names. The same holds for a **shared** entry: a claim must name every id in `stay_shared[]`, or a
claim for G-1 alone would let the next silent review close the unfixed G-2. A remediation claims only its own run's
groups, so an entry shared in an earlier run of its stay goes to the operator on every claim — conservative, and
the price of not knowing which finding silence confirms.

- A decision naming no group always counts as uncovered. That is conservative, and it is the default for every
  deferral made before `--group` existed.
- An element counts when its time is on or after `stay_started`. An entry with no `stay_started`, written before
  the field existed, counts every element.
- A legacy `deferred_in` with no T11 element for that run is read as a group-less T11 by the library itself, so a
  consumer's ledger is guarded without a migration.

This is what stops one entry's fix from closing another finding that shares its ten-line bucket. That happened
at `scripts/findings-ledger.mjs:190`, where the fix claim for a lock closed a deferral of the convergence floor.

## Transitions

| # | Transition | Who | From | To | Records | Clocks |
|---|---|---|---|---|---|---|
| T1 | new finding | fold | — | `open` | `first_seen`, `last_seen_at`; `nodes` = the sighting's lenses; `stay_shared[]` = its ids when it is shared | start |
| T2 | raised again | fold | `open`, `reopened`, `fixed_claimed`, `partial`, agent `declined` | `fixed_claimed`, `partial`, agent `declined` → `reopened`; else unchanged | `last_seen_at`; clears **the claim** and a proposed decline's decision fields; `silent_in: []` | restart |
| T3 | raised again | fold | `fixed`, `closed` (legacy included) | `reopened` | as T2; clears **the claim**, **the close** and **the decision** fields — `decisions[]` keeps the history, so an operator's close raised again before the next fold is still listed; empties `stay_shared[]` before this run's ids are added | restart |
| T4 | raised again | fold | operator `declined` | stays `declined`, and comes back to the operator: `severity_rose: true` when the severity is above `declined_severity`; `raised_again: true` when it is at or below it — only from a run newer than the decision (`decided_at`, or for a legacy undated decline the ledger's `identity_migrated_at`) and not already in `runs_folded`; no anchor flags nothing. Operator, 2026-10-12: "Resurface every hit (Recommended)", reversing the 2026-09-27 rule that a declined finding raised again stays declined — every such hit after a dated decline had been a different defect the bucket absorbed | `times_seen`, `last_seen_at`, the shown claim | — |
| T5 | silent review, conditions of exit 1 except a claim | fold | any open entry but `fixed_claimed` | unchanged | appends `silent_in` | — |
| T6 | silent review, all conditions of exit 1 | fold | `fixed_claimed` with `silent_at_claim: 0` | `fixed` (exit 1) | `closed_by: claim+silence`, `closed_in`, `verified_in`, `fixed_in` = the claiming run (as today) | — |
| T7 | re-fold of the same run | fold | a run already in `runs_folded` — membership there is the test, not `sightings[]`, which keeps ten (plan stage 3, amended 2026-10-13: "A run in runs_folded (Recommended)") | nothing changes: a re-fold applies nothing to any entry | nothing — no line, severity, nodes, `severity_rose` or silence, and `last_fold_at` does not move | — |
| T8 | observation (`--add`) | agent | an open entry, or none — a new entry: `open`, `first_seen` = the observation's id (`observed-…`, as a fold records its run's id), `last_seen_at` = the observation's time, the stale clock starting there, `nodes: []` | status unchanged — an observation is an agent's note, not a review's sighting; which entry it belongs to is resolved by the same bucket rule the fold uses (the closure inside `mergeRun`, extracted into a function both call) | appends `observations` (`found_by`, `observed_at`, `severity`, and the `claim` — redacted by `redactClaim` and capped at 300 characters, so what is stored may differ from what was typed); all of them are kept — the operator reversed the 50-note cap ("4a"), which could drop a note on a closed entry before it was listed; `found_by` never enters `nodes`, so never a raising lens; `times_seen` +1 | **none** — it clears no `silent_in` and restarts no clock, so an agent cannot hold an entry back from going stale or reset its silence before a claim |
| T8b | observation on a decided entry, attached on purpose (`--add --onto <key>`) | agent | a DECIDED entry: not open, a pending claim (`fixed_claimed`, `partial`), or a standing decision. Without `--onto` naming it, `--add` refuses before writing, names the entry, and offers re-anchoring or `--onto` (observation-guard-and-sibling-census.md, A); a note used to vanish into such an entry by the bucket rule | unchanged | appended to `observations`; on a closed entry, listed for the operator ("an agent observed a closed finding") | — |
| T9 | full fix claim | agent | any open status | `fixed_claimed` | `claimed_in`, `claim_evidence`, `claimed_from`, `silent_at_claim` = the length of `silent_in`; `needs_operator: true` when it is above 0, **or the entry has no raising lens**, **or the claim does not cover a standing decision or every `stay_shared[]` id** (3b, above) — either way exit 1 is closed to it, so it is listed for the operator | — |
| T10 | partial fix claim | agent | any open status | `partial` | `claimed_in`, `claim_evidence`, `claimed_from`, and, as T9, `silent_at_claim` and `needs_operator` when it applies — a partial claim reaches the operator on the same terms as a full one, though only a full claim can close by exit 1 | — |
| T11 | deferral, or a failed fix | agent | any open status | `fixed_claimed`, `partial` → their `claimed_from` (`open` or `reopened`); else unchanged | `deferred_in`, **reason required**; clears **the claim** | **unchanged** |
| T12 | proposed decline | agent | any open status | `declined`, `decided_by: agent` | reason required; `prior_status` = the status it had, or a claim's `claimed_from`; clears **the claim**, the close and the decision fields | unchanged |
| T13 | withdraw a proposed decline — the agent's own, or the operator rejecting it | agent, or operator with their words | agent `declined` | `prior_status` (so a `reopened` entry stays `reopened`), else `open` | reason required; a `decisions[]` element either way (`by: agent` or `by: operator`, 3a); when the operator's, also their words, `decided_at` and `decided_in` | unchanged |
| T14 | keep | operator | any open status | unchanged | reason, `operator_quote`, `kept_at`, `decided_at`, `decided_in`, a `decisions[]` element | restart |
| T15 | decline, or confirm or re-confirm one | operator | any open status, incl. agent `declined` and a decline a review raised again (`severity_rose` or `raised_again`) | `declined`, `decided_by: operator` | reason, `operator_quote`, `declined_severity` = current, `decided_at`, `decided_in`, a `decisions[]` element; clears `severity_rose`, `raised_again`, `prior_status` and **the claim** | — |
| T16 | close | operator | any open status | `closed`, `closed_by: operator` | reason, `operator_quote`, `closed_in`, `decided_at`, `decided_in`, a `decisions[]` element; clears **the claim** and any earlier **decision** fields | — |
| T17 | reopen | operator | any closed entry: operator `declined`, `closed`, `fixed`, legacy — and a decline a review raised again, which is open only so the operator sees it | `reopened` | reason, `operator_quote`, `decided_at`, `decided_in`, a `decisions[]` element; clears **the claim**, **the close**, the earlier **decision** fields and `stay_shared[]` — so no silent review can close it again on the old claim (G-8's rule) | restart |

**Refused**, with the reason printed:
- every agent transition (T8, T9–T13) on an entry that is not open — an agent never overwrites or undoes
  a decision or a confirmed fix; the message names T17 (an observation there is T8b, a note only);
- every agent transition (T9–T12) on an operator decline a review raised again (`severity_rose` or
  `raised_again`) — it is open only so the operator sees it; only T15 or T17 moves it;
- T9–T12 and T14 on an agent's proposed decline — they would change nothing and leave it awaiting (a second
  T12 would also overwrite `prior_status` with `declined`, so a later T13 would "restore" the decline); the
  message names T13 (withdraw) and T15 (confirm) instead, and the awaiting list's hint says the same;
- T14 (keep) on an operator decline a review raised again — it would overwrite the decline's words and time;
  only T15 (re-confirm) or T17 (reopen) applies;
- T13 on a decline the agent did not propose (`decided_by: operator`);
- operator decisions T14–T16 on an entry that is not open — the operator reopens it first (T17), so every
  change to a decided entry passes through one visible transition.

**At the CLI** — one disposition per transition, so no command means two things:
- `--disposition fixed_claimed | partial` → T9, T10; `open` without a quote → T11; `declined` without a
  quote → T12; `withdraw` → T13 (new);
- with `--operator-quote`: `open` → T14 (keep), `declined` → T15, `closed` → T16, `reopen` → T17 (new),
  `withdraw` → T13 as the operator rejecting a proposed decline;
- the printed hints — the stale list, the awaiting list, the usage text, the summary footer — carry the
  quote flag on every operator command.

**The fold lists**, after every run: the stale entries; the proposed declines awaiting the operator; the
declines a review raised again ("declined, but raised again", which says "came back worse" only for a rise);
the shared entries, with their group ids; the claims made on already-silent entries (`needs_operator`); agents'
observations of closed entries (T8b); every exit-1 close this run made (the `CONFIRMED` lines, as today);
and every operator decision since the previous fold — the `decisions[]` elements with `at` after the
ledger's `last_fold_at`. (Before this table, decisions recorded no time and the ledger no fold time, so
no such list was possible.)

**Only a review's fold** — `--run-dir` without `--mark-fixed`, i.e. `mergeRun` folding a run's findings —
writes `last_fold_at` and `runs_folded`; `--mark-fixed --run-dir` names the run a disposition belongs to and
writes neither. An observation (`--add`)
writes neither, so no agent act can move the window past a decision before it is listed. (`--add` used to
go through `mergeRun` and append its `observed-…` id to `runs_folded`; the ids it left there stay, and
`convergence` never counts them as a review cycle.)
