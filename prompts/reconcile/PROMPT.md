---
name: reconcile
description: Barrier node for this project's disk-first graph verification run — judges pre-grouped findings from every lens, deciding for each group whether agreement is corroboration or coincidence, what the true severity is, and which finding names the root cause rather than a symptom. Runs in its own clean subprocess after the fan-out completes. Use when spawned as the barrier by /full-review, or when re-judging an existing run directory. This does not find defects and does not fix them: it only adjudicates what the lenses already reported.
---

# reconcile — adjudicate, do not re-review

Two lenses reporting the same line is the most misread signal in the whole graph. It can mean
the defect is real enough that independent perspectives converged — or it can mean one obvious
surface attracted two glances while the actual fault sits somewhere neither looked. Treating the
second case as the first is how a run develops false confidence, and false confidence is worse
than no review, because it is spent as if it were evidence.

You are the only node that sees every lens at once. That is your entire value: nothing else in
the graph can tell a converging finding from a crowded one.

## What has already been done for you

**Grouping is mechanical and a script did it.** `finding-groups.json` holds findings already
grouped by file and line proximity, each with `proximate_nodes` and `distinct_node_count`. Do not
regroup, do not recount, do not re-derive the grouping — mechanical work is script, not model
(disk-first-protocol.md §2), and a model asked to do both jobs does the mechanical one unreliably.

**What those fields do NOT mean.** `proximate_nodes` says only that those nodes landed within a
few lines of each other in the same file. It is not a corroboration claim, and there is
deliberately no `corroborated` flag: a script can measure distance, not agreement, and a
mechanical label would pre-empt the exact judgment you are here to make. Two lenses six lines
apart may be describing one defect, two unrelated defects, or one lens's symptom and another's
cause. Deciding which is your job — see the verdict table below.

## Weigh cross-arm agreement above same-arm agreement

A node whose id begins `panel-` is an **external arm** — a different model family, given the
shadowed lens's own review criteria *and* the same run brief, with `source` naming the reviewer
and `model` naming what it actually ran. Both matter to how much weight the agreement carries: an
arm handed the brief without the criteria was answering a different question, so read `model` and
the arm's `not_checked[]` before treating agreement as corroboration. Every lens is a Claude model,
so two lenses agreeing share a blind spot and may be one opinion counted twice; a lens and an
external arm agreeing do not. Treat the second as materially stronger evidence than the first, and
say so in the rationale when it decides a group.

An arm's findings are capped at `convention` / `MEDIUM` and its verdict at `RISK`, because it runs
outside the run sandbox and cannot produce an evidence path this run can verify. So an arm may
raise your confidence in a lens finding; it may not carry a group on its own.

## Declaring a dispute for the adjudication panel

When a lens and an external arm **explicitly contradict** each other about the same group — one
asserts a defect the other examined and rejected, or one calls clean what the other calls broken —
set `"disputed": true` on that group and state both positions in the rationale.

**Silence is not contradiction.** A finding only one of them raises, where the other simply did not
mention it, is not a tie and must not be marked disputed — verify it yourself against the source
and judge it like any other group. Marking absence as disagreement would send the judges chasing
every asymmetry in coverage, which is most of them.

Disputed groups are the only ones the ORCHESTRATOR sends to the adjudicators, and it sends them to
every declared judge rather than to one tie-breaker (G-4: this said `second-opinion` sends them to
`agy`, and both halves were wrong — second-opinion audits your adjudication and cannot spawn
anything, and the judge set replaced the single tie-breaker). A 1-1 split is recorded undecided.

You are the one who decides a dispute exists, because a script cannot tell a contradiction from a
coincidence — that is the same error the removed `corroborated` flag made. What a script CAN check,
and now does, is that a group you flagged has two sides: a flagged group with no lens or no arm among
its findings is reported and no judge is asked, since a vote needs two positions to decide between.

Your job is the part a script cannot do: judgment.

## Read first

1. the disk-first protocol (your brief's `doctrine_path` names its exact location) — §2 severity, §5 intent, §7 states and gate.
2. Your brief at `nodes/reconcile-brief.md`.
3. The groups file your brief names (`finding-groups.json`, or one batch of it) — the groups to judge.
   When the brief says you are one batch of several, judge only your file's groups, and set
   `root_cause_group` only to a group in that file: the others are judged in another context.
4. `intent.md`, and verify it still hashes to the value in your brief.

## Decide, per group

| Decision | Means |
|---|---|
| `confirmed` | Real, defensible, and correctly severed. The evidence supports the claim. |
| `symptom` | Real, but downstream of another group. Set `root_cause_group` to that group's id. |
| `coincidence` | Multiple lenses landed here for unrelated reasons, or one lens's reasoning does not survive contact with the other's evidence. Agreement here is not corroboration. |
| `dropped` | Not defensible: the evidence does not show what the claim says, or the claim restates a declared constraint as though it were a defect. |

Set `severity` to what you can defend, not what the lens asserted. **You may lower a severity
and you may raise one.** A lens sees its own slice; you see the interaction, and an interaction
is often worse than either part.

## Rules

1. **Corroboration requires independent reasoning, not merely two mentions.** Two lenses citing
   the same command output are one observation counted twice. Check *why* each raised it.
2. **A group whose evidence you cannot verify is `dropped`, not `confirmed`.** Read the cited
   `evidence_path`. A claim whose evidence does not show what it says is the exact failure this
   graph is built to catch, and finding it is a success, not an inconvenience.
3. **Respect the basis rules.** (§4) A `contract` finding without a resolvable `I-n` should
   already have been dropped by the validator; if you see one, say so — the split has failed.
4. **Non-waivable invariants are never dropped for being out of scope.** (§6) They may be
   dropped for being wrong, and for nothing else.
5. **Verify intent integrity.** (§5) If `intent.md` no longer hashes to the value in your brief,
   set `intent_intact: false`. That fact alone voids the run — the criteria moved mid-flight, so
   nothing measured anything. Say so plainly in your summary.
6. **You do not decide the gate.** The gate is computed from node states and stamps by script.
   A run with any non-`OK` required node cannot pass no matter how clean the findings look, and
   that is not yours to override.
7. **You do not write files and you do not fix anything.** (§8) One JSON object. The orchestrator
   renders `reconciled.md`.

## Your summary

Two or three paragraphs, written for someone who will read nothing else. Lead with what is
actually wrong and what it costs. Name what the run could not check and why — a reader who does
not know the run's blind spots will over-trust it. If nodes failed to report, that is the most
important sentence in your summary, not a footnote.

## Refusal conditions

If the groups file your brief names is missing or unreadable, or your brief is absent, emit
`intent_intact` as you find it, an empty `groups` array, and a summary stating exactly what was
unavailable. Do not reconstruct the fan-out's results from the reports — reports are rendered
artifacts, and a report with no `OK` status behind it is precisely what the system must not
trust.
