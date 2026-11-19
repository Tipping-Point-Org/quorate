---
name: plan-authoring
description: Draft the plan for a milestone or version from the documents that govern it — read the roadmap and spec first, build the in-scope set before writing any item, gather options with candidate-pool wherever the milestone unlocks a deferred decision, and hand the result to plan-review. Use whenever a plan, phase breakdown or todo list for a version is being WRITTEN, or when asked what a version should include or what to do next — and before implementation on that version starts. This is the authoring counterpart to plan-review: author here, review there, never both in the same pass. It is NOT a graph node and produces no verdict. Reads project-specific milestone vocabulary and plan shape from .claude/quorate/plan-authoring.md when one exists.
---

# plan-authoring — write the plan the gate will judge

`plan-review` is the cheapest finding this system can produce, and it is cheapest of all when it
finds nothing. That happens when the plan was written against the same documents the review reads,
in the same order, with the same in-scope set built first. This skill is that discipline applied
while the plan is still a draft, so review becomes confirmation rather than rework.

The failure it prevents is the one `plan-review` exists to catch: a plan that is individually
reasonable at every line and collectively builds the wrong version, because each item was
justifiable and nobody checked the set against the milestone.

**This is not a graph node.** No run directory, no evidence directory, no verdict envelope. Its
output is a document a human approves, which `plan-review` then gates before `new-run.mjs`.

## Read first, in this order

Same order as the review, and for the same reason — reading the draft first anchors you to its
framing:

1. The `graph_contract` block in `CLAUDE.md`: `doc_roles.roadmap`, `doc_roles.spec`, `doc_paths`,
   and the standing constraints those documents declare.
2. The roadmap in full: the milestone's implement list, its exclusions, its exit gate.
3. The spec, for the version target and non-goals.
4. `.claude/quorate/plan-authoring.md` if it exists -- how THIS project names and structures its
   milestones, what a plan of its own is expected to contain, and the local history a portable
   skill cannot know. Absent, say so in the plan's header and infer from the roadmap.
5. Only then: any existing draft, notes or request.

**A profile is CONTEXT, not authority.** It carries vocabulary, structure and local history that
the contract cannot. It does not relax this skill's bar, waive a refusal condition, or license
writing a plan item the roadmap does not cover. Where it disagrees with this skill or with the doctrine,
they win, and the disagreement is itself worth reporting.

That paragraph lives here rather than being stamped on the text you read, and the difference is
worth knowing. A **node's** profile is assembled by the orchestrator, which bounds it, declares in
the brief when it had to truncate, and writes that framing itself. A **skill's** profile is read by
you directly -- Claude Code loads this file, so there is no assembly step and none of those
guarantees execute. `check-install` is what reports a profile that is empty, unreadable, or over the
size budget; nothing does so at the moment you read it.

If `doc_roles.roadmap` is empty, say so in the plan's own header and mark every item's source as
inferred. A plan whose scope rests on a guessed roadmap must announce that — `plan-review` will
cap at `NEEDS_CHANGES` for exactly this, and discovering it at review time wastes the pass.

## Procedure

1. **Build the in-scope set first**, from the roadmap alone: implement items plus exit-gate
   requirements. Write them down before drafting anything. This is the same set `plan-review`
   builds, and building it first is what makes the two passes agree.
2. **Cover the gate before covering the wish list.** Every exit-gate requirement gets a plan item
   naming it. An omitted gate item is the most serious finding the review produces, and it is
   free to prevent here.
3. **Sequence by dependency, not by appetite.** An item whose prerequisite lands in a later
   milestone is mis-sequenced even when it is in scope.
4. **Where the milestone unlocks a deferred decision, call `candidate-pool` — before writing the
   item that assumes an answer.** The roadmap deferring a choice to this milestone's trigger is
   precisely the moment the option set is cheap to widen and expensive to reopen later. Record
   the pool (source-labelled, with the constraint filter results) and cite that file from the
   plan item. A plan that names one engine with no pool behind it is a premature decision wearing
   a schedule.
5. **State each item's source** — the document and section that puts it in scope — as you write
   it, not afterwards. An item you cannot cite is either scope creep or a gap in the roadmap; both
   are findings, and the second is worth raising rather than silently filling.
6. **Declare pull-forwards explicitly.** Work borrowed from a later milestone because it is much
   cheaper to shape now than to retrofit later carries `justified_pull_forward: true` and the
   reason. An unjustified pull-forward and a justified one look identical in a plan and opposite
   in consequence.
7. **List what the plan deliberately does NOT do**, and why — the milestone's exclusions restated
   in the plan's own terms. Absence is not a gap, but only if the absence is on the page.
8. **Name the verification.** For each item, how it will be shown done: the gate item it
   satisfies, the test that will exist, or the run that will prove it. Items whose verification
   is "it works" are the ones that arrive unverifiable.
9. **A set is named by its authority, not listed.** An item that applies to every instance of a
   rule names the invariant and the authority that defines the set: a document, a registry, a
   schema, or the test that will enumerate it. The enumeration is the implementer's, at test time.
   The implementer will know the code better than you can while planning, and a list written into a
   plan becomes what reviewers check and what you maintain, stale from the moment it is written. Any
   list the plan does carry is labelled *dated, indicative*, with the command that produced it, and
   is never the set under test. Before choosing a search, follow the citations of the governing
   documents: an authority they name is the one to cite. (`.claude/requests/plan-authoring-sets-and-consumers.md`:
   three review rounds on one plan found most of their findings in lists built from a pattern the
   author chose, while the authoritative list sat in a file the governing plan cited.)
10. **Read the consumer of what you change.** For every contract key, document status, interface or
    signature an item changes, read the code that consumes it, and state in the item what that code
    will do with the new value. A change whose consumer refuses it is a finding about the plan, so
    find it here. (The same report: a draft plan pointed `doc_roles.request` at itself, and
    `new-run` refuses a declared request that is not `status: approved`. Every later run would have
    been refused.)

## What a finished plan contains

- The milestone it targets, and the roadmap sections that define it.
- Each item, with its source, its sequence position, and how it will be verified.
- Deferred decisions the milestone unlocks, each with the pool file behind the choice.
- Explicit non-goals for this milestone.
- Open questions, separated from items — a question is not work, and burying one inside a task
  hides it from the review.
- What is **not checked** by this plan: the parts of the milestone it leaves to another pass.

## Rules

1. **Author, do not review.** Do not grade your own plan against the roadmap and declare it
   passing — `plan-review` does that, and a self-issued verdict is not one. Hand it over.
2. **Cite or drop.** Every item has a source, or it is a question for the human.
3. **Do not decide what the roadmap defers.** Gather options, present them, let the caller choose.
   Writing the decision into the plan is how a deferred choice becomes a fait accompli.
4. **Silence is not coverage.** Anything you could not resolve — an ambiguous gate item, a missing
   spec section — is listed as an open question, never quietly omitted.
5. **You write one document.** No subprocess spawning, no code changes, no runs.

## Handoff

The plan goes to `plan-review` before implementation begins. A `NEEDS_CHANGES` verdict comes back
with classifications — scope creep with the milestone to defer to, premature decisions with their
trigger, missing gate items with their source, defective items with why — and each maps to an edit here. Iterate until
`PASS`, then start work; the run that eventually verifies that work will be judged against the
same roadmap this plan was built from.
