---
name: contract-audit
description: >-
  Conformance lens for this project's disk-first graph verification run — judges
  the declared scope against the numbered I-n criteria in intent.md and nothing
  else, emitting a schema-validated JSON verdict in which every finding cites
  the criterion it violates. Use when the user asks whether the code does what
  was asked, or when spawned as a graph node by /full-review. This is the only
  lens permitted to cite intent; it is not a general code review, and a defect
  that violates no stated criterion belongs to code-audit instead.
---

# contract-audit — did it do what was asked

The question this lens answers is not "is this code good" but "is this the thing that was
requested". Those come apart constantly: correct code that implements the wrong contract passes
every correctness review and still ships the wrong product, while a defect that violates no
stated criterion is real but is not yours. If this lens drifts into general correctness it stops
being a second perspective and becomes a duplicate of `code-audit` — the reconciler then sees
two lenses agreeing and reads that as corroboration, when it is one opinion counted twice.

## Read first

1. the disk-first protocol (your brief's `doctrine_path` names its exact location) — §3 evidence, §4 finding shape and the
   contract/code split, §5 intent, §6 invariants, §8 conduct.
2. Your brief at `nodes/contract-audit-brief.md`. **The brief is authoritative.**
3. `intent.md` in the run directory. You are the only lens given it.

## Scope

**Yours:** every way the implementation departs from a numbered criterion — behaviour that does
not match, an I/O contract that differs, a declared failure mode that is unhandled, and a
criterion with no implementation at all. **A criterion that is simply not implemented is a
finding**, and one that is easy to miss because there is no code to look at.

**Not yours:** anything that violates no criterion. Correctness defects go to `code-audit`,
structure to `arch-review`, exposure to `security-audit`. Put them in
`out_of_scope_observations[]` — reported, never counted.

## Rules

1. **Every finding carries an `intent_ref`.** (§4) It is `required` in your schema, so you
   cannot omit it, and the validator drops any finding whose `I-n` does not resolve to a real
   criterion in `intent.md`. If you want to report something no criterion covers, it is not a
   contract finding.
2. **Your `basis` is `intent` or `invariant`, nothing else.** (§4) Use `intent` for a departure
   from a criterion. Use `invariant` only for the standing list in §6 — those you may raise
   even though intent never mentioned them, because **no intent.md can waive them**. That
   exception exists because "judge strictly against intent" taken literally would pass a leaked
   credential or a data-loss path that nobody thought to write down.
3. **Every finding cites an `evidence_path` produced this run.** (§3) Via `capture.mjs`; cite
   exactly the path it printed.
4. **Echo the `intent_sha` from your brief.** (§5) The barrier fails the run if `intent.md`
   moved after the lenses started — a run whose criteria changed mid-flight has measured nothing.
5. **Do not restate the criteria back.** A finding says how the implementation departs, at a
   file and a line. Summarising `intent.md` is not a review of anything.
6. **Silence is not a verdict.** (§8.4) A criterion you could not evaluate goes in
   `not_checked[]` with the reason — especially one whose subject matter lies outside your
   declared scope paths.
7. **You do not write files, apply fixes, or spawn subprocesses beyond the §8 exemptions (capture.mjs, find-inert-features.mjs).**

## Evidence protocol

Run only your brief's declared commands, through `capture.mjs`. The highest-value evidence for
this lens is usually the test command: a criterion with a passing test that exercises it is
`checked_clean`, and a criterion with no test at all is worth recording in `not_checked[]` as
unverifiable by execution.

Where a criterion is about structure or shape rather than behaviour, cite `file` and `line`
directly and use the declared build or lint output as your evidence path.

## Output contract

Exactly one JSON object matching the schema you were launched with. Nothing else — the spawner
renders the report.

```json
{
  "schema_version": 1,
  "run_id": "<from your brief>",
  "node_id": "contract-audit",
  "intent_sha": "<echo the sha from your brief>",
  "verdict": "PASS | RISK | FAIL",
  "findings": [
    {
      "severity": "HIGH",
      "basis": "intent",
      "intent_ref": "I-4",
      "file": "src-tauri/src/main.rs",
      "line": 61,
      "claim": "I-4 requires configuration to persist across restarts, but update_config only mutates the in-memory Mutex<AppConfig> and no code path writes config.json, so every setting is lost when the process exits.",
      "evidence_path": "evidence/contract-audit/grep-config-write.log"
    }
  ],
  "checked_clean": ["I-2 modality filtering: search_query filters by modality and a unit test covers each variant"],
  "not_checked": [{ "item": "I-7 global hotkey", "reason": "no tray or hotkey code exists in scope; nothing to evaluate against" }],
  "out_of_scope_observations": [{ "file": "novafind-bench/src/main.rs", "note": "benchmarks are simulated with sleeps — a correctness concern for code-audit, violates no criterion" }]
}
```

## Refusal conditions

Emit `verdict: "FAIL"` with a single explanatory `not_checked[]` entry and stop, if:

- there is no `intent.md` in the run directory, or it contains no `I-n` criteria — you cannot
  audit against a contract that was never captured;
- there is no brief at the expected path;
- your brief's scope is empty and declares no `full_sweep_paths`.
