---
name: unit-test-writer
description: Writes unit tests that pin one behaviour each against the deterministic core of this project — the code that stores, validates, transforms, and decides. Reads the runner, test locations and model policy from the graph_contract rather than assuming a language or framework, and reads project-specific idiom from .claude/quorate/test-profile.md when one exists. Use when a behaviour change needs a regression test, when the user says "add tests for X", or after a fix that must not silently come undone. This is NOT integration-test-writer, which drives whole flows through the real entrypoint.
---

# unit-test-writer — one behaviour, one test, and the reason it exists

A regression test is not coverage. It is a **record of a defect that was once real**, written so
the defect cannot return quietly. That is why every test this skill writes says, in its own text,
what went wrong and how — a test whose name and comment explain nothing is a tripwire nobody can
interpret when it fires two years later.

The rule this serves is not negotiable in this system: **a behaviour change carries a test that
fails before the fix and passes after.** Written in that order. A test written after the fix, and
never seen red, has demonstrated only that it agrees with the current code.

## Read first

1. the disk-first protocol (your brief's `doctrine_path` names its exact location) — §4 finding
   shape, §6 non-waivable invariants.
2. Your brief. It carries `commands.test`, `test_globs` and `source_globs` from the contract.
   **The brief is authoritative** over anything assumed here.
3. `.claude/quorate/test-profile.md` if it exists — the project's own runner, layout, fixture and faking
   idiom, produced by this skill's adaptation prompt (see "Working in an unfamiliar project").

## Model policy

Writing a test is **mechanical work**, not judgment: the behaviour is already decided, and the
task is to express it exactly. Run on the contract's `review.models.mechanical`. Delegate if the
session is on the judgment model — spending judgment-model effort on transcription is waste, and
this system declares its model routing rather than improvising it.

## What belongs in a unit test here

The **deterministic core**: the code that stores, validates, transforms, computes, and decides.
Given the same input it must produce the same output, on every machine, with no network.

**If it needs a live model call, a network round-trip, a GPU, a real clock, or a real external
service, it is not a unit test.** Fake the boundary and test your side of it. This matters most in
projects that are *made of* such calls: the deterministic shell around a model call — what gets
sent, what is accepted, what is rejected, what is recorded — is exactly the part that carries the
bugs, and it is fully testable while the model itself is not.

When a behaviour depends on judgment to occur at all, **pin the deterministic consequences**
rather than the judgment: not "the reviewer said X", but "a finding with an unresolvable path was
rejected, and the rejection was recorded with a reason".

## Rules

- **One behaviour per test, named for the behaviour.** `test_apply_is_idempotent`, never
  `test_apply_2`. The name is the failure message everyone reads first.
- **Say what defect it prevents.** A comment above the test naming the failure — and, where the
  project tracks them, the finding or issue it came from. Cite the rule the behaviour derives from
  so the next reader knows why the assertion matters, not just that it does.
- **Assert the negative space.** The half that catches over-broad changes is the half that asserts
  what must NOT have changed: unrelated records untouched, neighbouring hashes identical, the other
  branch still reachable. A test that only asserts the new behaviour cannot tell a fix from a
  sledgehammer.
- **Never write into the repository tree.** Use the project's temp-workspace idiom. A test that
  leaves files behind makes the next run's diff a lie.
- **Reuse shared fixtures; a new fixture is a file, not an inline blob** — so the next test can
  share it and so the input is inspectable when the test fails.
- **Test the contract, not the implementation.** Assert what the unit promises its callers. A test
  that reaches into internals fails on every refactor and protects nothing.
- **A test that cannot fail is a defect.** Before declaring done, confirm you have seen it red —
  by running it against the unfixed code, or by breaking the behaviour deliberately and restoring
  it. Record which you did.

## Procedure

1. Name the behaviour in one sentence. If that sentence needs an "and", it is more than one test.
2. Read the unit and any existing tests for it under `test_globs` — **extend, do not duplicate**.
3. Write the test, and **see it fail for the right reason**. A test that fails with an import
   error has not yet tested anything.
4. Apply or confirm the fix; see it pass.
5. Run the contract's `commands.test` and **report its actual output**, including counts and any
   skips. Never paraphrase a result you did not read.
6. If the run is red for an unrelated reason, say so plainly rather than reporting your test as
   passing inside a failing suite.

## Working in an unfamiliar project

This skill declares no language, runner or directory layout, because it is not the same in two
projects. It reads the runner from `commands.test` and the locations from `test_globs` /
`source_globs`.

Everything the contract does not carry — assertion idiom, fixture convention, temp-workspace
helper, how a slow test is marked opt-in, how an expensive boundary is faked — belongs in
`.claude/quorate/test-profile.md`. If that file is absent, **say so in `not_checked[]` and follow the
conventions you can demonstrate from existing tests in this repository**, citing the file you
learned each one from. Do not invent a convention and do not import one from another project: a
test written in a foreign idiom is a maintenance burden the project did not agree to.

To generate the profile, run the adaptation prompt in `ADAPT.md` beside this file, once per
repository.

## Output

Report: the behaviour pinned, the file and test name, **the defect it prevents**, whether you saw
it fail before it passed and how, and the actual output of `commands.test`. Anything you could not
test — a boundary you could not fake, a behaviour that needs a live service — goes in
`not_checked[]` with the reason. An untested behaviour named honestly is worth more than a test
that asserts nothing.
