---
name: full-review
description: >-
  Orchestrator for this project's disk-first graph verification run — runs the
  pre-flight barrier, captures intent, fans out review lenses as isolated
  claude -p subprocesses, holds the barrier, reconciles, and emits a gated
  verdict into .claude/reviews/. Use when the user asks for a full review, wants
  everything reviewed, or says run the graph. This is NOT /review, which reviews
  a GitHub pull request, and NOT the built-in code review: it requires a
  graph_contract block in CLAUDE.md and refuses to run without one, and it
  refuses to infer a whole-repo scope from an empty diff.
---

# full-review — run the graph

A review that decides its own scope has not been scoped. A review that reports a clean result
because three of its lenses silently failed to run has not been performed. This orchestrator
exists to make both of those impossible: the graph is derived from declared data before
anything launches, and every node that was *supposed* to run is recorded before any node
*does* run, so a missing result is visibly missing rather than absent.

**The decomposition is deterministic and a script does it.** You are not asked how to split the
work. `run-graph.mjs` derives the node set from `lens-roster.json` crossed with the contract —
model-authored decomposition is the weakest node in a fan-out graph, because nothing downstream
can distinguish a bad split from a good one.

## Read first

the disk-first protocol (your brief's `doctrine_path` names its exact location) §1 (layout), §7 (states, degradation, gate
ceilings), §8 (recursion guard).

## Pre-flight — check these before running anything

1. **`GRAPH_NODE_DEPTH` must be unset or `0`.** If it is greater than zero you are yourself a
   graph node: **abort immediately and emit nothing.** A lens that starts a graph run is an
   unbounded fan-out with a bill attached (§8).
2. **`CLAUDE.md` must contain a `graph_contract` block.** If it does not, exit `BLOCKED`
   exactly once, print the block pre-filled with what you could detect about this repo, and
   **spawn nothing**. Do not go looking for build commands — the whole point of the contract is
   that nodes never discover the environment.
3. **`plan-review`, if installed and a plan was supplied**, runs first as a gate on whether the
   run should start at all. It is not a graph node. Absent, the run records
   `plan_review: "deferred"`.

## Running it

```
node <framework-root>/scripts/new-run.mjs --slug <slug> [--full-sweep <paths...>]
node <framework-root>/scripts/run-graph.mjs --run-dir .claude/reviews/<run-id>
```

(`<framework-root>` is where this framework's `scripts/` lives: the repository root in the
framework itself, `.claude/skills/quorate/` in the documented consumer mount — your brief
interpolates the resolved path; prefer it verbatim. The old literal here named the legacy
vendored layout, which exists in neither, and following it got ENOENT.)


`new-run.mjs` creates the run, resolves the contract, generates and validates the node policy
file, and runs the sandbox canary. `run-graph.mjs` does the rest: pre-flight barrier →
`intent-capture` → fan-out → barrier → `reconcile` → gate.

Useful flags: `--only <ids>` restricts the fan-out; `--dry-run` on `new-run.mjs` resolves the
contract and spawns nothing; `--reconcile-twice` runs a second reconciler on the same groups and
records the disagreement rate in `reconcile-divergence.json` — calibration of the barrier's single
point of judgment, never a change to the run's verdict.

**The pre-flight is CHECKED, not re-run.** By default the barrier does not re-execute: the engine
hashes the files the declared checks read and reuses the last result while it still applies. A
changed input invalidates it; with the input set inferred, a dirty worktree does too
(`shared/disk-first-protocol.md` §7, the `CHECKS-REUSED` row, owns the rule). A reused run is stamped `CHECKS-REUSED` and the gate names the run the
evidence came from.

- `--preflight always` re-runs unconditionally.
- `--preflight never`, and its alias `--skip-preflight`, skips the checks entirely. The run is
  stamped `CHECKS-SKIPPED`, **capped at `RISK`**, and every declared command is named in the gate's
  Not-checked table. This flag used to be documented here as "reuses an earlier barrier result" and
  did no such thing: it omitted the barrier and stamped nothing, so a gate went out silent about
  declared `build` and `test` having never run. Reuse is what the DEFAULT does; this is omission,
  and it now says so.
- `node scripts/preflight.mjs --run` executes the checks once and seeds the cache. That is where a
  long suite should be paid for — at install, not before every review.

## Scope, and the refusal that matters

`git diff --name-only <base>`, plus the untracked files git does not ignore, filtered by `source_globs` defines the scope. **If that is empty,
refuse.** Exit `BLOCKED` and tell the operator to re-run with `--full-sweep <paths>`. An
implicit whole-repo review is a scope nobody chose, and it is expensive in a way that is
invisible until the bill arrives.

A `--full-sweep` run is stamped `UNSWEPT-DIFF` so the gate records that scope was asserted by a
human rather than derived. That is not a defect; it is provenance.

## What you report back

**Run `quorate:claim-check` on the draft before you send it** (.claude/requests/claim-check.md). The summary you are about to write goes to a file, a fresh checker searches for what would make each claim a non-issue, and the script recomputes the grades — so a claim that dissolves under one question from the operator is caught before they have to ask it. Send the revised report, with one line naming the check directory.

Read `gate.json` and `reconciled.md` and summarise. Lead with the gate verdict and the reason.
Then, in order of how much they should change the reader's confidence:

1. **Anything in the "Lens did not report" bucket.** A run with a `BLOCKED` or `DEGRADED`
   required node **cannot pass**, and the gate will read `BLOCKED` — not `FAIL`, which would
   assert something about the code the run never established. Say which lens, and why.
2. **Confirmed findings**, most severe first, with the file and line.
3. **Stamps and what they cap.** `UNBUILT`/`UNTESTED` cap the gate at `RISK`; `TESTS-THIN`
   makes coverage claims inadmissible; `UNBENCHED` caps `perf-audit` (as `shared/disk-first-protocol.md` §7 states); `CHECKS-SKIPPED`
   caps and means the declared commands **did not run at all**; `CHECKS-INPUTS-INFERRED` caps and
   means a reused result's freshness rests on a guess about what those commands read.
   `CHECKS-REUSED` does not cap — say which run the evidence came from, which the gate names.
4. **The Not-checked table.** A reader who does not know the run's blind spots will over-trust
   it. Deferred and condition-skipped lenses belong here, never hidden.

Do not restate every finding — the reports are on disk and the paths are in `gate.json`. Do not
soften a `BLOCKED` into "mostly fine".

## Rules

1. **You do not review anything yourself.** You orchestrate. Any opinion you form about the code
   is a fourteenth uncontexted lens with no schema, no evidence discipline, and no place in the
   reconciliation.
2. **You do not apply fixes.** Not even obvious ones, and not even when asked in the same
   breath. Remediation is a separate run against `reconciled.md`, so the thing being fixed and
   the thing judging the fix are never the same context (§8.2).
3. **You do not re-run a failed lens to get a cleaner result.** A `DEGRADED` node is a finding
   about the run. Report it.
4. **Never edit `intent.md` after the fan-out starts.** The barrier fails the run on a hash
   mismatch, and it is right to.

## Refusal conditions

Exit `BLOCKED`, print the reason, and spawn nothing, if: `GRAPH_NODE_DEPTH > 0` · there is no
`graph_contract` block · the pre-flight barrier's build check fails · neither the diff nor the
untracked files git does not ignore include a source file, and no `--full-sweep` was given · the
sandbox canary fails.
