---
name: candidate-pool
description: >-
  Widen the pool of options before a hard-to-reverse choice is made — poll the
  node runtime and every external proposer the roster names (Opus, Codex and agy
  as shipped) in parallel as independent PROPOSERS, then return one
  merged, source-labelled list filtered only against constraints the caller stated.
  Use before choosing or benchmarking a model, library, framework, algorithm,
  topology or approach; when a plan, benchmark or comparison is about to be scoped
  around a shortlist; or when plan-review flags a premature decision and the work
  is sent back to authoring. Use it even when a shortlist already exists — finding
  what the shortlist is missing is the point. This is NOT a verification lens,
  NOT part of the graph, and it decides nothing: it proposes and filters, and
  the calling task selects.
---

# candidate-pool — gather options before the decision closes

A benchmark can only rank what enters it, and a verification graph can only check the design it
is given. Careful measurement of the wrong two options still yields the wrong answer, and no
lens downstream recovers a candidate that was never proposed: `arch-review` judges conformance
to a design, `plan-review` judges scope against a roadmap, `second-opinion` re-examines a
conclusion. None of them asks *what else could have been chosen*. That question has exactly one
cheap moment — before the choice is locked in — and this skill is that moment.

The bias it corrects is not "I chose badly"; it is "I only considered what was already in front
of me". Convenience samples look like shortlists: everything already installed, everything from
one vendor, everything of the size you are used to. Measured once in a sibling project, polling
three independent advisors took a pool from 2 candidates to 15, and the strongest entry was a
*category* of solution the original list was structurally incapable of producing.

**This is not a graph node.** It runs before `new-run.mjs`, has no run directory, no scope diff
and no run's evidence directory (each proposer's raw reply goes to a directory the caller names with
`--evidence-dir`, in the procedure below), and it emits no verdict envelope. Nothing it returns can pass or fail
a gate. Its output is an input to a decision a human makes.

## Ask for options, not alternatives

These are different requests and they return different things.

**Alternatives** are anchored: "we chose X — what else is like X?" Every answer inherits X's
shape, because that is what the question asked for. **Options** are unanchored: "we need to
achieve X — what could do it?" Answers are then free to differ in kind, not merely in brand.

Write the brief around **the goal and its constraints**, never around the incumbent. The current
shortlist still goes in — labelled as a bias to correct, so advisors know what not to repeat —
but it must not become the reference point the request is phrased against. The same discipline
applies downstream: a reviewer reports that **options were never gathered**, not that
"alternatives were not considered" — the second phrasing already concedes the incumbent is the
centre of the question.

## The contract

Three inputs must come from the caller. Anything not stated is not applied; inferred constraints
are decisions in disguise, and the caller owns the decisions.

1. **The task or decision** — what is being chosen, what it must do, what "good" means.
2. **The constraints**, every one that matters, stated testably: licence, memory, language,
   runtime, offline-only, latency, platform, maturity, maintenance status, cost.
3. **The fields to return** — the columns the caller's next step consumes, *in addition to* the
   baseline fields below.

If any of the three is missing or vague, ask before polling. Three advisors given a vague brief
return three vague answers, which is worse than one — it looks like corroboration.

## Two kinds of judgement, and only one belongs here

**Mechanical filtering against a stated constraint is in scope.** Apply the constraint as given
and record what failed and on which value. That is arithmetic the caller already did.

**Everything else is out of scope.** Do not rank by expected quality, do not pick a winner, do
not quietly drop a candidate for being unfamiliar or awkward to install. Advisors argue
persuasively for options that lose on measurement; treating their reasoning as evidence
reintroduces the bias this exists to remove. Widening the pool and evaluating the pool are
different jobs, and keeping them apart is what makes the evaluation mean anything.

## Baseline fields — always returned, always requested

Each is a **checkable value, not an adjective**, and each has changed a real decision:

| field | why it is always worth having |
|---|---|
| **primary source link** | Every other claim is checkable only if there is somewhere to check it. An advisor's summary is not a source. |
| **licence** | Decision-relevant even when unconstrained — and the fact advisors state most confidently and get wrong. |
| **latest version + release date** | What "actively developed" should have said. A date can be compared; an adjective cannot. |
| **last activity date** | A project can cut releases while its issues go unanswered, or the reverse. The gap is itself the signal. |
| **maintenance status** | Only if the project states it — archived, deprecated, superseded-by. A project announcing its own end of life outranks any other evidence. |

Mark anything an advisor could not establish as `unknown` rather than omitting the column. A
blank reads as "fine"; `unknown` reads as "nobody checked", which is the truth and is actionable.

## Observations: report decision-relevant facts nobody asked for

The caller cannot specify a column for a fact it does not know exists — an unfixed CVE backlog, a
maintainer who stopped merging, a licence that changed in a recent release, a benchmark retracted
by its authors. Put such facts in an **observations** column. The line that keeps this from
becoming a back door for deciding: **an observation is a checkable fact about the candidate, not
a judgement about its worth.** "Three CVEs open more than 18 months, newest 2025-03" is an
observation; "riskier than the alternatives" is a ranking, and ranking belongs to the caller. If
you cannot point at a source, leave it out.

## The proposers are equal here

The node-runtime proposer and every reviewer under `proposers` in `scripts/lens-roster.json` (Codex and agy as
shipped) are **first-order proposers** in this skill — independent sources, none senior to another, none an
arbiter. This is the deliberate inversion of
`shared/external-reviewers.md`, where a dispute goes to its judge set and an external arm's verdict is capped at
`RISK`. Those rules answer *is this correct?*, where convergence is confirmation and an
unverifiable assertion can turn a run red. This skill answers *what exists?*, where the answer is
additive, nothing is being asserted about the code, and no verdict is produced to cap. See that
file's "The uses of the panel".

**Never tie-break a candidate away.** A candidate only one advisor names is not a weaker finding;
it is the one that escaped the shared bias.

Pin each model explicitly, because the value comes from different training data and cutoffs. A
panel that is really one model three times defeats the purpose.

## Procedure

1. **Write one outcome-first brief; give it to every proposer unchanged.** Use these short sections:
   `Role`, `Goal`, `Success criteria`, `Constraints`, `Inputs`, `Output`, and `Stop rules`. Tell each
   proposer to widen the option set, not rank it; preserve the caller's constraints verbatim;
   filter only a mechanically failed constraint; return `unknown` rather than guess; and attach a
   primary-source link to every factual candidate claim. Put the current shortlist under `Inputs`
   and label it as a bias to correct, not as the shape alternatives should resemble. Put dynamic
   task details last and state each rule once.

   Every brief's `Stop rules` carries this line, unchanged: **"You are proposing, not verifying.
   Execute nothing — no tests, no installs, no commands. Where a constraint asks that something be
   verifiable, describe how it would be tested, do not test it."** An agentic proposer reads a
   constraint like "must be verifiable by an automated test" as an instruction to run one: codex
   did, on story-pipeline's pool (2026-10-08), spent 514 s and reported itself incomplete.

   Every brief then ENDS with the brief-feedback ask, the text of `prompts/_templates/brief-feedback.md` unchanged,
   as every brief the panel sends does (`shared/external-reviewers.md`, "Every brief asks the reviewer to fix the
   brief"): proposers given one brief share its blind spots, and the ask is how they name them. Propose mode does
   not append it for you (G-30 of 20261122-232627-m3s7-b4-review).
2. **Poll every proposer in parallel**, in the background — they take minutes and are independent.
   Each reviewer named under `proposers` in `scripts/lens-roster.json` goes through `scripts/external-review.mjs`
   as `--reviewer <name>`, one launch per entry, never a raw CLI line; a proposer added to or removed from that block
   is polled or dropped with no edit here. Pass
   `--mode propose`, the shared prompt file, and an inline schema whose top-level object contains
   `candidates[]` and `not_checked[]`; each candidate must contain the baseline fields plus the
   caller's requested fields. Pass `--candidate-fields` naming the per-candidate fields you
   asked for: that is what lets the adapter build an enforced JSON Schema, and without it the
   proposer falls back to being asked in prose and having its answer scanned out of stdout — which
   still works, but the downgrade is reported in `not_checked[]`. Pin the external models too:
   pass `--model` and `--effort` for every proposer, from that reviewer's entry under `proposers` in
   `scripts/lens-roster.json`. They are required (`.claude/requests/skill-subagent-pins.md`); an entry whose effort is
   `null` declares a reviewer that rejects `--effort` (the reason is beside it), so that proposer gets `--model` alone.
   The pins are **unmeasured for proposing**: they start at each reviewer's adjudicator pin. Left unset, the proposer ran on each user's local CLI default, so one
   pool came from different settings on different machines. Keep every proposer's raw reply and give each
   launch a file of its own: pass `--evidence-dir <dir>` and `--out <dir>/<proposer>.json`, one `<dir>` per
   proposer. What `--out` accepts is the contract's `OUT-1` … `OUT-8` (`shared/claude-md-contract.md`, the
   `scripts/external-review.mjs` row). A file per launch is what keeps two runs' answers apart; without
   `--evidence-dir` a proposer that reports itself incomplete leaves nothing to inspect. The adapter returns a proposal record
   (its shape is the contract's `scripts/external-review.mjs` row, the one copy) rather than a review verdict, and drops any candidate that came back with no
   fields — an empty candidate makes the pool look wider than it is. A proposer that reports a
   status other than `ok` returns an EMPTY `candidates` plus whatever it did propose in
   `incomplete_candidates`, so a partial batch never reads as a complete one. The node-runtime proposer (Opus under the
   default contract) is spawned with `node <framework-root>/scripts/spawn-subagent.mjs --prompt-file <brief>
   --out <dir>/node-runtime.envelope.json --result <dir>/node-runtime.json`, which runs it at the contract's `review.models.judgment` and `review.effort.judgment`,
   read-only; a session's own subagent tool takes a model but no effort, so it cannot pin one. The effort is
   **unmeasured for this task**: the
   contract's figure was measured on the lens corpus, not on proposing. The panel's data-governance rule applies unchanged:
   the brief leaves the machine, so it carries the goal and constraints, not the repository.
3. **Merge, labelled by source** — the node-runtime proposer by the model it ran (`[opus]` under the default contract's
   `review.models.judgment`), each external one by its reviewer name (`[codex]`, `[agy]` as shipped). Convergence is a
   **popularity** signal, not a quality one: models trained on overlapping public text agree most readily
   on whatever is most written about, and that visibility is often exactly the bias the caller
   already had. Record a single-source candidate identically, with no "unconfirmed" framing.
   An `incomplete_candidates` entry is merged too, labelled `[<source>, incomplete]` (`[codex, incomplete]`),
   with the proposer's reason beside the pool: it is an option, not evidence the source finished.
   A proposer record carrying `reviewer_override` goes into the pool with it, beside that source's label —
   `[codex] (override: codex — cmd set by the contract; …)` — because the operator reads the pool, not the record,
   and the override decided where that vendor's credentials went (ARCHITECTURE.md A-26).
   **Contradictions are findings**: if advisors disagree on a licence, size or date, verify it at
   the primary source before spending time on the candidate — never average it away, and never
   resolve it by majority.
4. **Return the pool.** Report the size before and after ("2 → 15" is what tells the caller
   whether this was worth doing), plus what was filtered and the stated constraint it failed.
   Recommend a next step only if the caller asked for one.

## Write the pool to disk before it is cited

This skill produces no verdict, but the disk-first rule still applies to what it claims
(`shared/disk-first-protocol.md` §3). Save the merged table — with the source labels, the
constraint filter results and the primary-source links — as a file under the caller's working
notes, and cite that path when the decision is later justified. A pool quoted from memory in a
plan is exactly as unverifiable as a finding quoted from memory in a review.

## Before adopting or benchmarking anything from the pool

A candidate measured on its defaults is not measured at its best, and the gap is often large
enough to reverse a ranking. Spend a few minutes in each shortlisted candidate's own
documentation and record a **summary and a link, never a copy of upstream docs**: structured
output (is the shape enforced, or merely requested in a prompt?), provenance (can it return
source spans?), determinism controls, variant traps (instruct vs base vs thinking builds; one
name covering two releases with different licences), batching, real context limits and, for
non-model software, documented failure modes — *is failure distinguishable from success?* —
version pinning, and whether it forces dependency versions that conflict with this environment.
"Checked, no such flag" is worth recording too: it converts an assumed limitation into a measured
one and stops the next person repeating the search.

## Call this while authoring, never while reviewing

Options are an input to a design and an interruption to a review. While a plan, topology or
scaffold is being written, a wider pool is exactly what is needed and one costs minutes. Once
that document exists and is under review, the reviewer's job is to judge what was decided;
producing a fresh list of alternatives reopens the decision, buries the structural findings under
a shopping list, and asks the author to redo work rather than fix it.

So a reviewer who notices a choice was never widened **says so as a finding** and sends it back
to authoring. In this repository, `plan-review` classifies exactly that as a *premature decision*
and `graph-plan` shapes work around decisions already made; neither may run this skill mid-review.
The authoring callers are `plan-authoring` (when a milestone unlocks a deferred decision) and any
scaffolding step that is about to commit to an engine, library or topology.

## When to use it

Use it when the decision is hard to reverse or expensive to re-run: a component that will spread
through the codebase, a benchmark whose runs cost real time, a graph topology, an engine. Skip it
for choices that can be flipped in an afternoon.

The strongest signal that you need it is noticing your shortlist is made entirely of things you
already have installed, already know well, or that all come from one family. That is what a
convenience sample looks like from the inside.
