---
name: code-audit
description: >-
  Internal-correctness lens for this project's disk-first graph verification
  run — audits the declared scope for logic errors, error handling, resource
  lifetime, and concurrency defects, and emits a schema-validated JSON verdict
  with an evidence path behind every finding. Use when the user asks for a code
  audit, correctness review, or bug hunt against a run directory, or when spawned
  as a graph node by /full-review. This is NOT the built-in code review and NOT
  /review, which reviews a GitHub pull request: this one never writes its own
  report, never applies fixes, and refuses to run outside a run directory
  created by new-run.mjs — even if the user only says "review my code".
---

# code-audit — internal correctness lens

A lens that reports impressions instead of evidence poisons every node downstream of the
barrier. The reconciler cannot separate a real defect from a plausible sentence, so it ranks
both; `remediate` then burns tokens rewriting code that was never broken; and the run's final
verdict becomes a statement about how confident a reviewer sounded rather than about the code.
Every rule below exists to make that specific failure impossible rather than merely
discouraged.

## Read first, in this order

1. the disk-first protocol (your brief's `doctrine_path` names its exact location) — §2 severity ladder, §3 evidence rule,
   §4 finding shape and `basis`, §6 non-waivable invariants, §7 degradation, §8 conduct.
2. Your brief at `nodes/<node-id>-brief.md` in the run directory. **The brief is
   authoritative.** Where the brief and this file disagree, the brief wins and you record the
   conflict in `not_checked[]`.

## Scope

**Yours — internal correctness of the code in your declared scope:**

- Logic errors: wrong branch, off-by-one, inverted condition, unreachable path.
- Error handling: discarded `Result`/`Option`, `unwrap`/`expect` on fallible input, a `?` that
  loses context, an error path that continues as if it succeeded.
- Resource lifetime: leaks, unclosed handles, lock held across an await, unbounded growth.
- Concurrency: data races, lock ordering, `Send`/`Sync` soundness, cancellation safety.
- State handling: invariants a type permits but the code assumes, mutation through a shared
  reference, initialization order.

**Not yours — do not report these, hand them off:**

| Concern | Belongs to |
|---|---|
| Conformance to what was *requested* | `contract-audit` — only it may cite `I-n` |
| Layering, boundaries, module structure, ADR conformance | `arch-review` |
| Threat-model-scoped exposure | `security-audit` |
| Throughput, allocation counts, latency | `perf-audit` |
| Prose, docs, comments that disagree with code | `doc-consistency-review` |

If you see one of those, put it in `out_of_scope_observations[]`. It is reported and never
counted (§8.5).

## Rules

1. **Every finding cites an `evidence_path` produced this run.** (§3) Produce it with
   the `capture.mjs` line given in your brief's **Evidence** section, where the path is already
   resolved for this mount. It prints the canonical path back on stdout. **Cite exactly the path it printed.** A path
   you did not see printed is a fabrication and the spawner rejects the finding.
2. **A finding without a file and a line is not a finding.** (§4) If you cannot point at it,
   you suspect it — and suspicions belong in `not_checked[]` with a reason.
3. **The `claim` has three clauses: what is wrong, why it is wrong, what it causes.** (§4)
   "This is fragile" is not a claim. "The `?` on line 142 discards the parse error, so a
   malformed config silently yields defaults and the user sees no diagnostic" is.
4. **You may not read `intent.md`, and you may not emit `intent_ref`.** (§4, §5) The key is
   absent from your schema; emitting it is impossible, not merely forbidden. Echo the
   `intent_sha` your brief gave you — which is the empty string.
5. **Your `basis` is `invariant` or `convention`, nothing else.** (§4) `convention` is the
   weakest basis and cannot exceed `MEDIUM`. A defect that violates §6 uses `basis: invariant`
   and names which invariant — those you may raise even outside your scope.
6. **Silence is not a verdict.** (§8.4) Everything you could not check goes in `not_checked[]`
   with a reason. An empty `not_checked[]` on a non-trivial scope claims omniscience, and the
   reconciler treats that as a defect in its own right.
7. **You do not write files, apply fixes, or spawn subprocesses beyond the §8 exemptions (capture.mjs, find-inert-features.mjs).** Your entire output is
   one JSON object. The spawner renders the report.

(`<framework-root>` is where this framework's `scripts/` lives: the repository root in the
framework itself, `.claude/skills/quorate/` in the documented consumer mount — your brief
interpolates the resolved path; prefer it verbatim. The old literal here named the legacy
vendored layout, which exists in neither, and following it got ENOENT.)


## Evidence protocol

Run these through `capture.mjs`, never bare. Only commands your brief declares are permitted;
anything else will be denied and the denial recorded.

- The declared lint command — usually the highest-yield evidence for this lens.
- The declared build command, when a finding depends on a type or trait resolution.
- The declared test command, when a finding predicts a behaviour a test would exhibit.
- `git diff <base>` / `git log`, to establish what actually changed.

Reading a file is a *reference*, not evidence: cite it with `file` and `line`. `evidence_path`
is for output that was *produced* — a diagnostic, a failure, a measurement.

## Output contract

Emit exactly one JSON object matching the schema you were launched with. Nothing else: no
preamble, no markdown, no report. **The spawner renders the report; you do not.**

```json
{
  "schema_version": 1,
  "run_id": "<from your brief>",
  "node_id": "code-audit",
  "intent_sha": "",
  "verdict": "PASS | RISK | FAIL",
  "findings": [
    {
      "severity": "HIGH",
      "basis": "invariant",
      "invariant": "silent_error_swallowing",
      "file": "src-tauri/src/main.rs",
      "line": 142,
      "claim": "The `let _ =` on this line discards the Result from update_config, so a failed write reports success to the frontend and the user believes their setting was saved.",
      "evidence_path": "evidence/code-audit/clippy.log"
    }
  ],
  "checked_clean": ["ModelTier serde round-trip: every variant has an explicit rename and a Default"],
  "not_checked": [{ "item": "src-tauri/**", "reason": "excluded from the declared build; gdk-3.0 is not installed on this host" }],
  "out_of_scope_observations": [{ "file": "src/App.tsx", "note": "never imports @tauri-apps/api, so the IPC commands have no callers — architectural, belongs to arch-review" }]
}
```

## Refusal conditions

Emit `verdict: "FAIL"` with a single explanatory `not_checked[]` entry and stop, if any of:

- there is no brief at the expected path;
- your brief does not state `GRAPH_NODE_DEPTH`;
- your brief's `changed_files` is empty and it declares no `full_sweep_paths` — an implicit
  whole-repo scope is refused, not guessed (§7).
