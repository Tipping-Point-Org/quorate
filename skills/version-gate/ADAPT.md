# ADAPT — localise version-gate to this repository

Run this once per repository. It writes `.claude/quorate/version-gate.md`, which `version-gate`
reads when it exists.

## Why this exists rather than a project shipping its own version-gate

`version-gate` reads `gate.json`, which is portable and stable. What is not portable is the other
half of the question: **what else this project requires before a milestone is done.** A
Definition-of-Done list, a set of fixtures that must run end to end, a document that must be updated
in the same breath — none of that is in `gate.json`, and a portable skill has nowhere to learn it.

So projects write their own `version-gate`, which then collides with this one by name and gets
picked or not picked at random. The split: **reading a run's verdict faithfully** — never softening
a `BLOCKED`, never counting a lens that did not report — stays in the skill. **What this project
additionally requires** lives here, outside the submodule.

This is the profile where the authority line matters most, because the skill's output is a release
decision. The profile may add requirements. It may not remove one, and it may not license declaring
a gate `PASSED` on evidence the skill would otherwise refuse.

**Record by CITATION, not by copy.** A restated Definition-of-Done is a second bar that drifts from
the first, and this is the one place a drifted bar ships a release.

## The prompt

> **Localise version-gate to this project.**
>
> Read the repository and its `graph_contract` block. Determine each item below **from evidence in
> this tree**, and for each one cite the file (and line or section) you learned it from. Prefer the
> contract where it already answers the question.
>
> 1. **Milestone vocabulary** — what a released unit is called here, and which document assigns the
>    names. Prefer `doc_roles.roadmap`.
> 2. **Where the Definition-of-Done is declared** — the document and section. The CITATION, not the
>    list: the list changes per milestone and the profile must not go stale with it.
> 3. **What counts as end-to-end evidence** — which fixtures, example projects or golden outputs
>    this project requires to have actually run, and the command that runs them. Prefer
>    `commands.test_product` and `commands.run` where they answer it.
> 4. **What must be updated alongside code** — a changelog, a phase log, a version file, a
>    documentation index. A gate that passes with these stale is the failure this catches.
> 5. **Where release state is recorded** — how the project marks a milestone finished, so the gate's
>    verdict lands somewhere rather than being said once.
> 6. **Local history worth knowing** — a milestone declared done and reopened, and why. Two or three
>    lines, each with what it cost.
>
> Write `.claude/quorate/version-gate.md`. Open it with one line stating it is CONTEXT, not
> authority: it may ADD requirements to a gate, and it may not remove one or license passing a gate
> on evidence the skill would otherwise refuse. Put anything you could not determine under
> `## Unknown` rather than guessing — "nothing declares a Definition-of-Done here" is a finding
> about the project, and an important one for a release gate. Keep the whole file inside the size
> budget `check-install` reports; over that you are describing a document, and a document belongs in
> `doc_paths` where a lens can cite it.

## Maintaining it

Re-run it when the release procedure changes or a governing document moves — not per milestone,
because the profile names where the Definition-of-Done is declared rather than restating it.
`check-install` reports the file's presence, and flags it when it is empty, unreadable, or over
budget.
