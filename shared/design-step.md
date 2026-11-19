# The design step — what to do when patching stops converging

The round cap (`shared/remediation.md`, **Round cap**) says WHEN to stop patching. This document says HOW to run the design
review that replaces the fourth patch. It is written down because it was a convention quorate used on itself
(stopping-a-child, contract-glob-grammar, secret-shapes-and-refusals, reconcile-batches) and nowhere a consuming project
could find it; story-pipeline asked for exactly this on 2026-10-08 and had to be told by message.

The failure it answers is specific: each fix reaches the reported instance and misses its siblings, or fixes one rule by
breaking a neighbour, because nobody has written down the whole set of places the rule applies and the choices behind it.
A design step writes that down once, gets the choices made by the operator, and gives every later review a document to
judge conformance against.

## The four artifacts, in order

All live in `.claude/requests/`, which is where `new-run` discovers requests.

### 1. The design note — `<name>.design.md`

A document; no skill writes it. Front matter:

```yaml
design: <name>
status: draft | decided (operator, <date>: "<their words for each decision>")
created: <date>
asked: <the operator's answer that started the design step, quoted>
```

Sections that have worked:

- **Why this is a design step.** The rounds, with run ids and group ids, and the pattern they show — "the fixes keep
  reaching the reported instance and missing its siblings" is the kind of sentence that belongs here.
- **What exists, spot-checked at a named commit.** Every place the rule applies, by file and line, with the command that
  found them. This is the sibling list; a later review checks the work against it, so a site missing here is a site
  the next round will find.
- **Decisions.** One subsection per choice, each with its options, their pros and cons, and a recommendation — put to
  the operator, never decided in the note. Where a choice is hard to reverse (a library, a mechanism, a vendor),
  run `quorate:candidate-pool` before writing that decision, so the options are not only the ones already in mind.
- **What is in scope**, and **Not in this design** — what the work deliberately leaves alone, and why.
- **Verification (for the plan).** How each decision will be shown done; a test per class of site where one can be
  written, so a missed sibling fails a test rather than waiting for a lens.

Once the operator has chosen, `status` becomes `decided`, quoting their choice for each decision.

### 2. The plan — `<name>.plan.md`

Written by `quorate:plan-authoring` from the decided design. Front matter names the plan, its `status`, its
`milestone`, and `design: <name>.design.md`. Stages in dependency order, each with how it will be verified — the red
test first, as `quorate:remediate` requires.

### 3. Plan review

`quorate:plan-review` on the plan, iterated until it returns `PASS` or the operator approves it as it stands. Then
`status: approved (operator, <date>: "<their words>")`. `new-run` accepts a declared request only when its front matter
reads `status: approved`.

### 4. The contract points at the plan

Set `doc_roles.request` in the project's contract to the PLAN, not the design note. `contract-audit` then judges every
later review against it, so a review can say whether the work matches the design, not only whether it has defects.
When the work is delivered, move the key to whatever is in flight next; the completed plan stays `approved` as the
record of what was asked.

`quorate:request` is the other way in: it records what a conversation converged on, in the operator's words, as an
approved request. Use it when the operator wants the ask on record before a design exists; it does not replace the
design note or the plan.

## One design per theme

Two recurring themes that share no code path, decision or verification get two design notes and two plans. One
document makes every review judge both, and a finding on one holds the other's stage. If the operator wants one review
cycle, sequence the two plans; put first the one that touches a security invariant.

## What resets the count

Delivering the plan is a feature delivery, which resets D1's round count. The first review of the delivered work
starts a fresh round, judged against the plan the contract now names.
