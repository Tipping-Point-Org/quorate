# ADAPT — localise the test-writer skills to this repository

Run **once per repository**, before `unit-test-writer` or `integration-test-writer` is used here.
It produces `.claude/quorate/test-profile.md`: the project-specific idiom the skills deliberately do not
hardcode.

## Why this exists rather than a language switch inside the skills

A skill that says "use pytest" is wrong in every project that does not, and a skill that branches
on language accumulates a dialect per ecosystem and is stale the moment a project uses a runner the
author did not anticipate. The portable half — one behaviour per test, see it red first, assert the
negative space, fake the expensive boundary, never write into the tree — is the same everywhere.
The dialect is not, and the repository already contains the answer.

So the split is: the **contract** carries what it knows (`commands.test`, `commands.test_product`,
`commands.run`, `test_globs`, `source_globs`, `review.models.mechanical`); this prompt derives the
rest **from evidence in the tree**; the skills read both. Nothing is guessed.

## The prompt

> **Localise the test-writer skills to this project.**
>
> Read the repository and its `graph_contract` block. Determine each item below **from evidence in
> this tree**, and for each one cite the file (and line) you learned it from. Prefer the contract
> where it already answers the question.
>
> 1. **Runner and invocation** — the exact command, and the narrower form used while iterating on a
>    single test. Prefer `commands.test`; note `commands.test_product` if a second suite exists.
> 2. **Assertion idiom** — the framework and how a typical assertion with a failure message is
>    written here.
> 3. **Layout and naming** — where unit tests live, where integration tests live, and how a test
>    file's name relates to the source file it covers.
> 4. **Isolated workspace** — how a test gets a temp directory, and the project's rule about
>    writing inside the repository tree.
> 5. **Fixtures** — where shared inputs live, how they are loaded, and whether integration fixtures
>    are copied before use.
> 6. **Opt-in / slow tests** — how a test that needs a real engine, network or credentials is
>    marked, and how it is excluded from the default run.
> 7. **Faking boundaries** — how model calls, network, subprocesses, the clock and other expensive
>    or non-deterministic boundaries are faked. Give a real example from this codebase.
> 8. **Entrypoint** — how integration tests drive the product: in-process runner or subprocess, and
>    the exact call. Prefer `commands.run`.
>
> 9. **Where the coverage bar is declared** — the document and section that says what this project's
>    deterministic core consists of, and what is worth pinning per subsystem. Record the CITATION,
>    not a copy: a checklist restated here becomes a second bar that drifts from the first, and the
>    skill's job is to send the reader to the owning document. If no such document exists, say so
>    under `## Unknown` — "nothing declares what is worth testing here" is a finding about the
>    project, not a gap in the profile.
> 10. **How a test maps to a gate** — whether this project ties tests to milestones, exit gates or
>    release criteria, and where those are declared. A project that gates releases on test evidence
>    needs each test to name the gate it is evidence for; a project that does not should say so, so
>    the skill stops looking for one.
>
> Write `.claude/quorate/test-profile.md` with one section per item. Each section must contain a **concrete,
> runnable example taken from this codebase** — not a generic one. An example you wrote yourself
> rather than found is a guess; mark it as such.
>
> Two things you must not do:
>
> - **Do not invent a convention.** Anything you cannot establish from the tree goes in a final
>   `## Unknown` section, naming what you looked at and what would settle it. A profile that guesses
>   is worse than a short one, because the skills will follow it confidently.
> - **Do not silently resolve a conflict.** Where a project rule contradicts the portable core —
>   tests that must touch the real filesystem, a suite that cannot run offline, fixtures mutated in
>   place — record it under `## Conflicts with the portable core`, stating the project's rule, the
>   core rule, and which the skills should follow **here**. The project usually wins; what must not
>   happen is the contradiction going unrecorded.
>
> Finally, state how you verified the runner actually works: the command you ran and its real
> output. A profile naming a command nobody executed is the same defect as a contract key filled
> with a command that does not run.

## Maintaining it

`.claude/quorate/test-profile.md` is checked in and reviewed like any other governing document. Re-run this
prompt when the runner, layout or faking strategy changes — a stale profile is worse than none,
because both skills treat it as authoritative over their own defaults.
