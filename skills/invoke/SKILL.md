---
name: invoke
description: Runs ONE review lens through this project's whole disk-first verification path — mints a run directory, renders the brief, spawns the lens and its cross-family shadow arm, holds the barrier, reconciles, adjudicates a dispute if one arises, and emits a gate. Use when the user names a single dimension to check — "arch-review this adapter", "security-audit the new endpoint", "run doc-consistency on these docs" — or wants one lens rather than a full sweep. This is NOT a cheaper review: it narrows the fan-out and nothing else, and it costs what quorate costs for the work it does. It is also NOT pasting a lens prompt into the session; the lens runs as an isolated subprocess with a run directory, which is what lets its findings cite evidence.
---

# invoke — one lens, the whole path

quorate offered a full sweep or nothing. Checking one adapter's boundaries after scaffolding it
meant paying for eight lenses, so consuming projects wrote their own standalone review skills
instead — hand-built substitutes that produce no envelope, cite no evidence path, and reach no
barrier. The gap quorate left was being filled by the thing quorate exists to replace.

**The unit is the whole review of that lens, not a fragment of it.** Mint, brief, node policy,
the lens, its shadow arm, the barrier, reconciliation, adjudication on dispute, gate. A finding
that has not been through that has not been through the thing that makes a quorate finding mean
anything.

## What this is not

- **Not a degraded review.** The arm cap (`basis=convention`, MEDIUM, `RISK`) exists for reviewers
  that *cannot* produce a verifiable evidence path. A lens invoked this way has a run directory, so
  `capture.mjs` works and its cited paths are checked by the same mechanism a full run uses. Nothing
  is given up, so nothing is capped for it.
- **Not a way to spend less.** A single-lens run still spawns a judgment-tier lens at the contract's
  declared model and effort. Invoking a subset of quorate costs quorate's price; that is the deal,
  not a defect.
- **Not a lens prompt pasted into the session.** The node contracts under `prompts/` refuse to run
  outside a run directory, and they are right to. An inline opinion is an uncontexted extra lens with
  no schema and no evidence discipline.

## Running it

```
node <framework-root>/scripts/new-run.mjs   --slug invoke-<lens> [--full-sweep <paths...>]
node <framework-root>/scripts/run-graph.mjs --run-dir <run-dir> --only <lens>
```

`<framework-root>` is where this framework's `scripts/` lives — the repository root in quorate
itself, `.claude/skills/quorate/` in the documented consumer mount. Your brief interpolates the
resolved path; prefer it verbatim.

That is the entire mechanism. `--only` narrows the fan-out; `panelArmsFor()` already selects exactly
the arms whose shadowed lens is running, so the arm set narrows with it and nothing else changes.

**Defaults are quorate's own.** Models, effort, budgets, archive, timeouts, and the contract's
`review.external_panel` switch all behave as they do in a full review. The only thing `/invoke`
narrows without being asked is the fan-out. Any further narrowing is something the operator asks
for explicitly.

To be unambiguous, because "panel" carries two meanings: the `external_panel` boolean is honoured
as-is, and the arms that actually run are those shadowing the invoked lens — **not** the full
`panel_arms` array. Loading every declared arm would restore the fan-out and defeat the point.

## What may be invoked

The eight lenses, and the set is a declared decision rather than a runtime probe:
`contract-audit`, `code-audit`, `security-audit`, `arch-review`, `doc-consistency-review`,
`perf-audit`, `ui-audit`, `feature-verify`.

`scripts/lens-roster.json` owns it — each lens carries `invokable: true` and a sentence saying why
it is meaningful on its own, and the `$invokable` block records what is excluded and for what
reason. Read that block before adding to the set; an absent entry there cannot be told from an
oversight, which is why the exclusions are written down too.

Two things follow from the set being declared:

- **A name outside it is refused, not attempted.** `run-graph` fails closed on an `--only` id no
  lens matches and prints the available ones. It used to deselect everything and reach the gate
  having spawned nothing — `--only arch-reveiw` produced `# Gate — PASS · every node reported` for
  $0, a clean bill of health from a transposition.
- **`contract-audit` also spawns `intent-capture`.** It is the one lens with `intent: required`, and
  the criteria are part of its path rather than a separate node you are paying for by accident.

## Scope

**Scope defaults to exactly what a full review would do**: derived from
`git diff --name-only <base>`, plus the untracked files git does not ignore, filtered by `source_globs`. **If that is empty, the run refuses** —
exit `BLOCKED` and tell the operator to re-run with `--full-sweep <paths>`. An implicit whole-repo
review is a scope nobody chose, and narrowing to one lens does not make it cheap enough to guess.

`--full-sweep <paths>` overrides it and stamps the run `UNSWEPT-DIFF`, same as anywhere else.

## Reporting back

**Run `quorate:claim-check` on the draft before you send it** (.claude/requests/claim-check.md). The relay of `gate.md` you are about to write goes to a file, a fresh checker searches for what would make each claim a non-issue, and the script recomputes the grades — so a claim that dissolves under one question from the operator is caught before they have to ask it. Send the revised report, with one line naming the check directory.

Relay `gate.md` faithfully, and lead with the scope of the claim:

1. **The gate headline names the narrowing** — `# Gate — PASS · fan-out narrowed to arch-review`.
   Say which lens ran. "The review passed" is a claim about a review that did not happen; "the
   architecture review passed" is the claim you have.
2. **`FAN-OUT-NARROWED` is stamped and does not cap.** The lens that ran is worth exactly what it is
   worth in a full review. What the stamp carries is that the dimensions nobody ran found nothing
   because nobody looked.
3. **The arm, and whether it agreed.** A dispute between the lens and its shadow arm is adjudicated
   the way it is in a full run, and the merge labels which family each judge belongs to.
4. **The Not-checked table**, including the deselected lenses. They appear there by name.

Then fold the run into the cross-run ledger:

```
node <framework-root>/scripts/findings-ledger.mjs --run-dir <abs-run-dir>
```

## Rules

1. **You do not review anything yourself.** Invoking a lens and then adding your own opinion puts an
   uncontexted second lens in the room with no schema and no evidence discipline.
2. **You do not apply fixes.** Not in this run, not even obvious ones. `quorate:remediate` is a
   separate, later run, so the thing fixed and the thing judging the fix never share a context.
3. **One lens means one lens.** There is no cross-*lens* reconciliation to miss here: the operator
   chose the scope at invocation, and that is a choice rather than a degradation. If they want two,
   `--only a,b` is the same command and reconciles across both.
4. **Do not reach for this when a full review was asked for.** `quorate:full-review` exists and is
   the default. This is for when a dimension is named.

## Refusal conditions

Exit `BLOCKED`, print the reason, and spawn nothing, if: `GRAPH_NODE_DEPTH > 0` (you are yourself a
graph node — §8) · there is no `graph_contract` block · the named lens is not in the invokable set ·
the pre-flight barrier's build check fails · neither the diff nor the untracked files git does not
ignore include a source file, and no `--full-sweep` was given · the sandbox canary fails.
