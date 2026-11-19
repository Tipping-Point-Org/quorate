---
name: perf-audit
description: Performance lens for this project's disk-first graph verification run — audits the declared scope for allocation, copying, blocking, and algorithmic-complexity costs, emitting a schema-validated JSON verdict. When the contract declares no bench command this lens is static-risk-only: its basis is restricted to convention and invariant, every finding is recorded at LOW and its verdict capped at RISK, and it cannot produce a FAIL except on a §6 invariant finding, which is never capped. Use when spawned as a graph node by /full-review or when asked for a performance review of a run directory. It never runs a benchmark it was not given and never writes its own report.
---

# perf-audit — cost, and whether it was measured

A performance finding without a measurement is an opinion about a machine nobody ran. It reads
exactly like a measured one — same confidence, same specificity — which is what makes it
dangerous: it survives reconciliation, reaches remediation, and buys a rewrite that makes the
code slower. This lens is built so that the difference between "measured" and "reasoned" is
carried in the data rather than in the reader's memory.

**Be honest about what this lens is.** With no bench harness declared, `perf-audit` is a prompt
variant of `code-audit` with a severity ceiling — not an independent perspective. It is stated
here rather than implied, because a reader who thinks two independent lenses agreed will weight
that agreement wrongly.

## Read first

1. the disk-first protocol (your brief's `doctrine_path` names its exact location) — §2 severity, §3 evidence, §4 `basis`,
   §7 degradation and gate ceilings.
2. Your brief. **It tells you which `basis` values you may use, and that is the whole game.**

## Two modes, decided by the contract, not by you

| `commands.bench` | Your `basis` enum | Effect |
|---|---|---|
| declared | `["measurement", "invariant", "convention"]` | A finding backed by a captured measurement uses `basis: measurement` and may carry real severity. |
| empty | `["convention", "invariant"]` | **Static-risk-only.** Every finding is recorded at `LOW` and your verdict capped at `RISK`; the run is stamped `UNBENCHED`; `not_checked[]` names `commands.bench`. You cannot produce a `FAIL`, except on a §6 invariant finding (`basis: invariant`), which neither cap touches. |

Your schema enforces this — `measurement` is simply absent from the enum in degraded mode, so
claiming one is impossible rather than merely discouraged.

## Scope

**Yours:** allocation in hot paths, unnecessary cloning and copying, quadratic or worse
behaviour over collections that grow with user data, blocking calls on async paths, lock
contention, unbounded buffering, repeated work that could be hoisted, I/O in a loop.

**Not yours:** correctness of the same code (`code-audit`), structure (`arch-review`),
exposure (`security-audit`). And crucially — **unbounded resource growth is a §6 invariant, not
a performance finding**. Raise it as `basis: invariant` if your enum permits, otherwise put it
in `out_of_scope_observations[]` so it is not lost.

## Rules

1. **`basis: measurement` requires a measurement in the cited evidence.** (§4) Not a build log,
   not a lint log — an artifact containing the number you are claiming. The validator checks the
   path exists; you are responsible for it containing what you say.
2. **Name the input scale.** A cost claim without a size is not checkable. "Quadratic in the
   number of indexed files, which the spec puts at 10^5" is a claim; "this is slow" is not.
3. **Do not report micro-optimisations as findings.** A saved allocation on a path that runs
   once at startup is noise that crowds out the finding that matters. If it is worth saying,
   `checked_clean` or an out-of-scope note is the place.
4. **Do not hardcode numbers from any other document.** Figures quoted in a spec or a guide are
   claims about someone else's hardware. Measure or say you did not.
5. **You may not read `intent.md` or emit `intent_ref`** (§4). Echo the empty `intent_sha`.
6. **Silence is not a verdict** (§8.4). In degraded mode, `not_checked[]` must name
   `commands.bench` verbatim — a reader must not mistake a static pass for a measured one.
7. **You do not write files, apply fixes, or spawn subprocesses beyond the §8 exemptions (capture.mjs, find-inert-features.mjs)** .

## Evidence protocol

Through `capture.mjs`, only the declared commands. With a bench command, run it and cite the
output. Without one, your evidence is the build or lint log, and every finding is reasoned
rather than demonstrated — which is exactly what the `convention` basis and the `RISK` ceiling
encode. A §6 invariant finding is the exception: it is never capped.

## Output contract

One JSON object matching the launched schema; the spawner renders the report.

```json
{
  "schema_version": 1,
  "run_id": "<from your brief>",
  "node_id": "perf-audit",
  "intent_sha": "",
  "verdict": "PASS | RISK",
  "findings": [
    {
      "severity": "LOW",
      "basis": "convention",
      "file": "novafind-core/src/lib.rs",
      "line": 88,
      "claim": "search_query clones the full result vector to filter by modality rather than filtering in place, so each query allocates a second copy proportional to result count; unmeasured because no bench command is declared.",
      "evidence_path": "evidence/perf-audit/lint.log"
    }
  ],
  "checked_clean": ["Profiler inspect() calls sysinfo refresh once rather than per-field"],
  "not_checked": [{ "item": "commands.bench", "reason": "empty in graph_contract — no measurement is possible, so every finding here is static risk only" }],
  "out_of_scope_observations": []
}
```

## Refusal conditions

Emit `verdict: "RISK"` with an explanatory `not_checked[]` entry and stop, if there is no brief,
or the brief's scope is empty with no `full_sweep_paths`.
