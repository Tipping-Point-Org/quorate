---
name: claim-check
description: >-
  Check a report's claims BEFORE it reaches the operator. Write the draft to a file, hand it to a fresh
  checker subagent that searches for what would make each claim a non-issue, grades it observed or
  inferred, names a risk's trigger and the strongest counter-question, then run the script that
  recomputes the grades mechanically. Revise the draft from the result and send that. Use before any
  message that rests on a claim the operator will act or decide on — a review summary, a triage, a
  remediation report, a plan review, a request for a decision, a recommendation, or any answer naming a
  defect, risk, limitation, absence, impossibility or capability, a cost or estimate, who asked for
  something, how existing code behaves, or what is waiting on the operator. Not needed for a status line
  that makes none of those claims. This is NOT a review lens and NOT part of the graph: it
  checks the agent's own prose, the channel shared/unverified-claims.md names as unverified.
---

# claim-check — one task to run, instead of rules to remember

The operator, after five issues in one session each dissolved under a single question: *"running a
task is easier than remebering a set of rules."* This skill is those rules, run.

It closes item 2 of `shared/unverified-claims.md`: the graph verifies artifacts, and nothing verified
what the agent says in prose. A draft written to a file is an artifact, and it is checked before it is
sent rather than after the operator has had to find the gap.

## When

**On the claim, not on the kind of message.** Run it before sending anything the operator will act or
decide on that rests on one of these:

- a defect, a risk, a limitation, or an absence ("not recorded anywhere");
- an impossibility or a capability ("cannot be tested here", "I'm not authorized", "only Codex can tell you");
- a cost or an estimate;
- an attribution — who asked for something;
- how existing code behaves;
- what is waiting on the operator ("all of it needs you");
- a recommendation.

A request for a decision is the commonest carrier: every option's pros and cons is a claim. It was
scoped to "reports that raise an issue or recommend" until a survey of the interactive sessions found
37 claims that dissolved under one question from the operator, and issue reports were 2 of them
(2026-09-26, `.claude/requests/claim-check.md`, amendment 2).

`full-review`, `invoke` and `remediate` require it at their reporting step, and so does relaying a
`plan-review` verdict, which is itself a report. A status line that makes none of these claims needs no
check.

## Presenting a decision

A decision put to the operator — in a report, in a plan, or in plain conversation — names the options and,
for each one, its pros and its cons, and ends with a suggestion. The suggestion is labelled as judgement
unless a measurement backs it. The authority is ARCHITECTURE.md A-20 — quorate recommends; the operator decides
(operator, 2026-10-07). A-22, which would allow only options below `measurement`, belongs to the decision layer in
§7, deferred and not built, and does not govern this.
The operator should never have to ask "what are the trade-offs?" or "what would you do?".

The pros and cons are claims, so the decision is checked like any other draft above before it is sent.
This was in neither this skill nor `QUORATE.md`, only in the memory of quorate's own development sessions
— so a consumer's sessions put decisions to the operator as unchecked prose, and the operator had to ask
why (story-pipeline, 2026-10-06).

## How

`<framework-root>` is where this framework's `scripts/` lives: the repository root in quorate itself,
`.claude/skills/quorate/` in a consumer's mount.

1. **Make a check directory:**
   ```
   node <framework-root>/scripts/claim-check.mjs --new <short-slug>
   ```
   It prints the path, under `.claude/claim-checks/`, which is gitignored: the draft and the checker's
   answer are model text.
2. **Write the draft** — the report exactly as you would send it — to `<dir>/draft.md`.
3. **Run the checker:**
   ```
   node <framework-root>/scripts/claim-check.mjs <dir> --check [--transcript <session.jsonl>]
   ```
   Pass `--transcript` when the draft attributes anything to the operator: this session's transcript (Claude Code keeps
   it at `~/.claude/projects/<project>/<session-id>.jsonl`). Without it, an attribution cannot be checked and will not
   stand. The script decides who checks (`.claude/requests/claim-check-cross-family.md`), writing `result.json` and
   `check.json`:
   - **`review.external_panel` off:** a Claude checker, spawned through `scripts/spawn-subagent.mjs` at the contract's
     `review.models.judgment` and `review.effort.judgment`, read-only. A session's own subagent tool takes a model but no
     effort, so it cannot pin the checker. The check is **same-family**, and `checked.md` says so.
   - **The panel on:** the checker of the other family, the roster's `claim_checker` (reviewer, model and effort,
     `scripts/lens-roster.json`), through `external-review --mode claim-check`. What it gets of the transcript is
     `review.claim_check_transcript`: under `cross-family` a copy reduced to the conversation (commands and their outputs
     dropped, file changes and commits kept as one line each) and redacted of every secret shape, so the transcript
     reaches that reviewer's vendor too; under `same-family`, absent included, nothing — attributions are checked by a
     node-runtime checker that holds the transcript, and the two results are merged by claim. Either way the reviewer
     stands in the arms' snapshot with the draft added, which narrows what it is shown and does not bound what it reads:
     it is a working directory, not a jail (`shared/external-reviewers.md`).

   Every checker gets `CHECKER.md` beside this file, unchanged, and the paths: nothing else, not this conversation, not
   your reasoning — a checker that has read the argument agrees with it. The pins are **unmeasured for this task**: the
   contract's figure was measured on the lens corpus, and the claim checker's starts at its adjudicator pin. Never write
   a model name or an effort into a script.
4. **Apply the rules:**
   ```
   node <framework-root>/scripts/claim-check.mjs <dir>
   ```
   It refuses a result of the wrong shape (exit 1: run the check once more, in a new check directory with the same
   draft, since each directory keeps one checker's answer; if it is refused again, say the check could not complete —
   never send the draft as though it had been checked). `--check` exiting 1 is the same case: the checker failed. Otherwise it recomputes every grade — `observed` survives only with a citation that
   resolves — turns claims about the operator into questions, and writes `checked.md`.
5. **Read `checked.md` and revise the draft:**
   - `dissolved` — remove the claim. If the operator had already seen it, say what dissolved it.
   - `downgrade`, or graded `inferred` — keep it only labelled as unverified, with the check that
     would settle it. If that check is cheap, run it now and re-grade instead.
   - `ask-operator` — turn it into a question.
   - `stands` — keep it, with its citation.
6. **Send the revised report**, with one line naming the check directory.

## Rules

1. **Do not skip a claim because it is obvious.** The five that dissolved were all obvious to the
   agent that wrote them.
2. **Do not edit `result.json`**, and do not argue the recomputed grades down: they are mechanical.
   Disagree in the report, visibly, if you must.
3. **The checker is read-only.** It writes `result.json` and nothing else.
4. **This checks prose; it does not fix code.** A claim that stands is still reported, not acted on —
   remediation remains its own run.

## What it does not do

It checks "you asked for X" only against a transcript it is given, and only by finding the operator's
words — `shared/unverified-claims.md`'s rule on attribution. An attribution with no citation that
resolves becomes a question to the operator, never a statement. One cited by a command stands on the checker's word: the
script cannot tell whether that command found the operator's words, the same limit every command
citation has (G-12 of run 20260926-044637-m0-close-r2 — this paragraph said "downgraded" without it). A claim about what the operator CAN do or INTENDS is
still theirs to answer, and becomes a question. And a checker can miss a claim, as a lens can miss a defect; the result lists
every claim it extracted, so a missing one is visible to whoever compares it with the draft.
