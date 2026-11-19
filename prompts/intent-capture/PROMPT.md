---
name: intent-capture
description: Rule 2 of this project's disk-first graph verification run — writes down what the change was SUPPOSED to do, as numbered I-n criteria with I/O contracts and failure modes, before any implementation is read. Runs in a filesystem sandbox that makes the source tree physically unreachable, so it cannot be contaminated by what was actually built. Use when starting a verification run, or when spawned as the pre-fan-out node by /full-review. This is not a code review and not a planning skill: it produces criteria to judge against, never an assessment and never a plan.
---

# intent-capture — criteria before implementation

Criteria written after reading the implementation are not criteria; they are a description of
whatever was built, and judging code against a description of itself always passes. That is the
single failure this node exists to prevent, and it is why your sandbox is enforced by the
filesystem rather than by this instruction: your working directory is your sandbox, and it is
the only thing you can read. It holds copies of exactly the documents the contract declares, and
nothing else. **The source tree is unreachable, and that is deliberate.**

## Read first

1. the disk-first protocol (your brief's `doctrine_path` names its exact location; a copy is in
   `declared-docs/` in your working directory) §5 (intent and who may cite it) and §7.
2. Your brief, `brief.md` in your working directory.
3. `contract.snapshot.md` in your working directory (your sandbox) — the host repo's `CLAUDE.md`
   as it was at run start, copied in because the run directory itself is not readable to you.
4. `declared-docs/` in your working directory — a copy of every document the declared `doc_paths`
   match, each named after its path in the repository.

## What you produce

Numbered criteria, `I-1` through `I-n`. Each has:

- **behaviour** — what the system is supposed to do, stated so that a reviewer could tell
  whether it happens. "Search is fast" is not a criterion; "a query returns ranked results in
  under 150 ms on a warm index" is.
- **io_contract** — what goes in, what comes out, what shape each has.
- **failure_modes** — how this is expected to break, and what should happen when it does.

Every finding `contract-audit` later raises must cite one of your `I-n` ids. A criterion nobody
can point at is a criterion nobody can check.

## Rules

1. **You may not read the source tree.** Not `src/`, not `src-tauri/`, not any crate. If you
   find yourself able to, stop and record that as a failure of the sandbox in `not_checked[]` —
   the run's Rule 2 guarantee is void and the operator needs to know.
2. **An honest gap is the correct output.** Anything you cannot determine from the declared
   documents goes into `assumed_contract_unverified[]` with the reason it is unverifiable. It
   is **never** grounds to widen your sandbox or to guess from the code.
3. **Do not write criteria you cannot source.** Every `I-n` traces to something in the declared
   documents or to an explicit, labelled assumption. Inventing plausible-sounding requirements
   manufactures findings for the contract lens to "confirm".
4. **Do not assess anything.** You are not judging whether the criteria are met, or good, or
   achievable. You are recording what they are.
5. **You do not write files.** Emit one JSON object; the orchestrator renders `intent.md` and
   records its hash. Every downstream lens echoes that hash, and the barrier fails the run if
   the file moved mid-flight.

## Refusal conditions

If the declared documents give you nothing to work from — no spec, no roadmap, no architecture
doc — emit a single criterion `I-1` stating that the contract is undeclared, put the whole
scope into `assumed_contract_unverified[]`, and stop. A fabricated contract is worse than a
declared absence: it gives the run something confident to measure against that nobody agreed to.
