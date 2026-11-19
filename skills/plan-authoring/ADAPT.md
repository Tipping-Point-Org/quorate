# ADAPT — localise plan-authoring to this repository

Run this once per repository. It writes `.claude/quorate/plan-authoring.md`, which `plan-authoring`
reads when it exists.

## Why this exists rather than a project shipping its own plan-authoring

A plan written in the wrong vocabulary is rejected for the wrong reason. A portable skill knows how
to author a plan; it cannot know that this project calls a unit of work `V0.2`, that exclusions are
as load-bearing as inclusions, or that a plan here is expected to name its own exit gate. The
alternative — shipping a project-specific `plan-authoring` of your own — collides with this one by
name, and the runtime picks whichever it likes.

The split: the **discipline** half (read the roadmap before the draft, never invent a requirement,
mark every item's source) stays in the skill. The **project** half lives here, outside the
submodule, surviving every `git submodule update`.

**Record by CITATION, not by copy.** A restated milestone list is stale the day it is written.

## The prompt

> **Localise plan-authoring to this project.**
>
> Read the repository and its `graph_contract` block. Determine each item below **from evidence in
> this tree**, and for each one cite the file (and line or section) you learned it from. Prefer the
> contract where it already answers the question.
>
> 1. **Milestone vocabulary** — what a unit of planned work is called here, how the names are
>    ordered, and which document assigns them. Prefer `doc_roles.roadmap`.
> 2. **What a finished plan of this project's own contains** — point at one or two real, accepted
>    plans. Name the sections they share; that shape is the target.
> 3. **Where a plan is written** — the directory and naming convention, and whether plans are
>    tracked.
> 4. **Where the governing documents are** — which one owns requirements, which owns architecture,
>    which owns the roadmap. A plan that contradicts the owner is the defect this prevents. Prefer
>    `doc_roles`.
> 5. **Standing constraints every plan must respect** — architectural rules, dependency policy, a
>    document-ownership rule. Cite each.
> 6. **Local history worth knowing** — a plan shape that was tried and abandoned, or a recurring
>    mistake in how work gets scoped here. Two or three lines, each with what it cost.
>
> Write `.claude/quorate/plan-authoring.md`. Open it with one line stating it is CONTEXT, not
> authority, and that it cannot license writing a plan item the roadmap does not cover. Put anything
> you could not determine under `## Unknown` rather than guessing. Keep the whole file inside the
> size budget `check-install` reports; over that you are describing a document, and a document
> belongs in `doc_paths` where a lens can cite it.

## Maintaining it

Re-run it when the shape of a plan changes, or when a governing document moves — not when a new
milestone is added, because the profile names where milestones are declared rather than listing
them. `check-install` reports the file's presence, and flags it when it is empty, unreadable, or
over budget.
