# ADAPT — localise plan-review to this repository

Run this once per repository. It writes `.claude/quorate/plan-review.md`, which `plan-review` reads
when it exists.

## Why this exists rather than a project shipping its own plan-review

A project that plans by milestones has vocabulary a portable skill cannot guess: what a version is
called, where the exit gate lives, what counts as an exclusion rather than an omission. The obvious
answer is to write your own `plan-review` skill — and that is how the problem was found. Two skills
answering to one name is not a merge; it is an ambiguity resolved differently each time it is
invoked, and quorate's own `check-install` reports the collision precisely because nothing else can.

A profile splits the two halves that were being fused. The **discipline** half — read the roadmap
before the plan, refuse to approve what the roadmap does not cover — stays portable and stays in the
skill. The **project** half lives here, outside the submodule, surviving every
`git submodule update`.

**Record by CITATION, not by copy.** A restated exit gate becomes a second bar that drifts from the
first. Send the reader to the owning document.

## The prompt

> **Localise plan-review to this project.**
>
> Read the repository and its `graph_contract` block. Determine each item below **from evidence in
> this tree**, and for each one cite the file (and line or section) you learned it from. Prefer the
> contract where it already answers the question.
>
> 1. **Milestone vocabulary** — what a unit of planned work is called here (V0.1, M0, sprint,
>    epoch), how the names are ordered, and which document assigns them. Prefer
>    `doc_roles.roadmap`.
> 2. **Where the exit gate is declared** — the document and section that states what must be true
>    for a milestone to be finished. The CITATION, not the checklist.
> 3. **Where non-goals and exclusions live** — a plan covering an excluded item is a defect this
>    skill must catch, and it cannot without knowing where exclusions are written down.
> 4. **What a plan of this project's own looks like** — point at one or two real, accepted plans in
>    the tree. Their shape is the standard a new plan is judged against.
> 5. **Standing constraints a plan must respect** — architectural rules, dependency policy, a
>    document-ownership rule: the things that make a plausible plan wrong here specifically. Cite
>    each.
> 6. **Local history worth knowing** — a plan shape that was tried and rejected, or a recurring
>    mistake. Two or three lines, each with what it cost.
>
> Write `.claude/quorate/plan-review.md`. Open it with one line stating it is CONTEXT, not
> authority, and that it cannot relax the skill's bar or waive a refusal condition. Put anything you
> could not determine under `## Unknown` rather than guessing — "nothing declares the exit gate
> here" is a finding about the project, not a gap in the profile. Keep the whole file inside the
> size budget `check-install` reports; over that you are describing a document, and a document
> belongs in `doc_paths` where a lens can cite it.

## Maintaining it

Re-run it when the roadmap's structure changes, not when its contents do — the profile names where
the milestones are declared, so new milestones need no edit. `check-install` reports the file's
presence, and flags it when it is empty, unreadable, or over budget.
