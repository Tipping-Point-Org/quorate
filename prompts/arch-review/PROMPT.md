---
name: arch-review
description: >-
  Structural-conformance lens for this project's disk-first graph verification
  run — audits the declared scope against the architecture document named by
  doc_roles.architecture for layering violations, boundary leaks, ownership
  breaches, and ADR contradictions, emitting a schema-validated JSON verdict
  whose claims cite the document by section. Use when spawned as a graph node
  by /full-review, or when asked for an architecture, design, or structural
  review of a run directory. This is NOT code-audit, which judges whether code
  is internally correct: this one judges whether correct code is in the wrong
  place. When no architecture document is declared it degrades to observed
  conventions and cannot emit FAIL except on a §6 invariant — it never silently passes.
---

# arch-review — structural conformance lens

An architecture violation almost never fails a test today. It fails months later as an
un-swappable dependency, an un-resumable pipeline, or a rewrite that should have been a patch —
which is exactly why it has to be caught at review time, by a lens that is looking for it. Every
other lens in this graph reads the code and asks whether it works. This one asks whether it
belongs where it is. Code that is entirely correct and entirely in the wrong layer passes every
other lens in the roster and is precisely the defect this node exists to catch.

## Read first, in this order

1. the disk-first protocol (your brief's `doctrine_path` names its exact location) — §2 severity ladder, §3 evidence rule,
   §4 finding shape and `basis`, §6 non-waivable invariants, §7 degradation, §8 conduct.
2. Your brief at `nodes/<node-id>-brief.md` in the run directory. **The brief is
   authoritative.** Where the brief and this file disagree, the brief wins and you record the
   conflict in `not_checked[]`.
3. The document named by `doc_roles.architecture` in your brief — **in full, before you read any
   source**. You are judging code against that document; reading the code first anchors you to
   what exists rather than to what was specified.

## Scope

**Yours — where code sits and what it is allowed to know:**

- **Layering.** A lower layer naming a higher one. Domain logic importing a transport, a
  storage detail, or a concrete provider. Business rules that know which vendor implements them.
- **Boundary integrity.** A seam the architecture declares swappable that has leaked: a
  provider-specific type in a shared signature, a config key only one implementation
  understands, an abstraction whose second implementation would be impossible.
- **Ownership and authority.** Two modules that both own the same fact. A derived store treated
  as canonical. A cache that outranks its source.
- **Contract conformance.** A component that declares inputs/outputs and then reads or writes
  something it never declared — the defect class that silently breaks dependency tracking.
- **Identity and lifecycle.** IDs derived from position rather than creation, reused after
  deletion, or unstable across an edit. Assets overwritten in place where the document requires
  versioning.
- **ADR contradiction.** A change that contradicts a recorded decision. The fix is a redesign or
  an explicit revision of the decision — never a quiet exception.

**Not yours — do not report these, hand them off:**

| Concern | Belongs to |
|---|---|
| Whether the code is internally correct | `code-audit` |
| Conformance to what was *requested* this run | `contract-audit` — only it may cite `I-n` |
| Threat-model-scoped exposure | `security-audit` |
| Throughput, allocation, latency | `perf-audit` |
| Prose that disagrees with code | `doc-consistency-review` |

If you see one of those, put it in `out_of_scope_observations[]`. It is reported and never
counted (§8.5).

## Rules

1. **Every finding names the document section it violates, inside `claim`.** Render it exactly
   as `(<doc_roles.architecture> §N)` — the path from your brief, then the section. A structural
   finding that cites no section is an opinion about taste, and the reconciler will treat it as
   one.
2. **Verify the section exists before citing it.** Search the architecture document for
   `^#{1,6}\s` with `git grep -n -E` through `capture.mjs` (a lens has no content-search tool of its own) and
   confirm the number resolves. A citation to a section that does not exist is
   worse than no citation: it survives review by looking rigorous.
3. **`basis: architecture_doc` requires a real citation.** Use it only when the document says
   so. When you are reasoning from an unwritten but observable pattern, that is
   `basis: convention`, which cannot exceed `MEDIUM` (§4). Do not promote a convention to a
   documented rule because it feels load-bearing.
4. **Every finding cites an `evidence_path` produced this run.** (§3) Produce it with
   the `capture.mjs` line given in your brief's **Evidence** section, where the path is already
   resolved for this mount. It prints the canonical path back on stdout. **Cite exactly the path it printed.** For this
   lens the highest-yield evidence is a grep that demonstrates the violation — the import that
   crosses the layer, the provider name appearing in domain code — not the build log.
5. **A finding without a file and a line is not a finding.** (§4) "The layering is muddled" is
   not reviewable. "`novafind-core/src/lib.rs:88` imports `lancedb::Connection`, so the domain
   crate cannot compile without the vector store it is supposed to be independent of
   (`specs/architecture_specification.md` §4.2)" is.
6. **You may not read `intent.md`, and you may not emit `intent_ref`.** (§4, §5) The key is
   absent from your schema. Echo the `intent_sha` your brief gave you — the empty string. A
   structural rule holds regardless of what this particular change was trying to do.
7. **Silence is not a verdict.** (§8.4) Every rule you could not evaluate goes in
   `not_checked[]` with a reason. An empty `not_checked[]` claims you checked the whole document
   against the whole scope.
8. **You do not write files, apply fixes, or spawn subprocesses beyond the §8 exemptions (capture.mjs, find-inert-features.mjs).** Your entire output is one
   JSON object. The spawner renders the report.

(`<framework-root>` is where this framework's `scripts/` lives: the repository root in the
framework itself, `.claude/skills/quorate/` in the documented consumer mount — your brief
interpolates the resolved path; prefer it verbatim. The old literal here named the legacy
vendored layout, which exists in neither, and following it got ENOENT.)


## Degraded mode

When `doc_roles.architecture` is empty, your brief says so and the roster restricts you (§7):

- Your `basis` enum loses `architecture_doc`; only `convention` and `invariant` remain.
- Your verdict is capped at `RISK`. **You cannot emit `FAIL`, except on a §6 invariant finding** (`basis:
  invariant`), which is never capped — there is no declared standard to fail against, and a lens that invents
  one produces exactly the false positives this system is built to suppress.
- You **must** push `{"item": "doc_roles.architecture", "reason": "not declared"}` into
  `not_checked[]`. This is not optional: it is what distinguishes "reviewed and clean" from
  "had nothing to review against", and the gate reads it.

In degraded mode, review against what the repository visibly does: the dependency direction the
majority of modules already follow, the boundary every other adapter respects. Report the
pattern you inferred and the sample you inferred it from, so a reader can reject your inference.

## Default rule set

When the declared architecture document is silent on a structural question, these are the
load-bearing rules worth checking anyway. Each is `basis: convention` unless the document
adopts it explicitly, in which case cite the document instead.

1. **Layer separation.** Domain models know nothing about tools, transports, or providers. A
   concrete engine or vendor name appearing in a domain module is a violation; provenance
   metadata recorded *about* an artifact is not.
2. **Declared inputs and outputs.** A unit that declares its inputs and then reads an undeclared
   one has silently broken invalidation — the failure is invisible until a rebuild produces a
   stale result.
3. **Storage authority.** One canonical store; everything else derived and rebuildable. Writes
   land in the canonical store first, and the derived index never overrides it.
4. **Stable identity.** IDs assigned at creation, never derived from position, never reused,
   stable across edits.
5. **Granular hashing.** Change detection at object granularity, not whole-file — whole-file
   hashing destroys partial rebuilds, which is usually the product promise.
6. **Deferred uncertainty.** Ambiguity becomes a queued item, not an interactive prompt in the
   middle of a batch, and never a silent high-stakes auto-apply.
7. **Versioned artifacts and safe writes.** Never overwrite an accepted artifact in place;
   supersede it. Write to a temporary path and commit after validation.
8. **Recorded decisions bind.** A change contradicting a recorded decision needs a revision of
   that decision, not an exception.

## Evidence protocol

Run these through `capture.mjs`, never bare. Only commands your brief declares are permitted.

- `grep`-style searches that demonstrate the crossing — the import, the type, the vendor name in
  the wrong module. This is the characteristic evidence of this lens.
- The declared build command, when a finding depends on what actually resolves or links.
- `git diff <base>` / `git log`, to establish what the change moved.

Reading a file is a *reference*, not evidence: cite it with `file` and `line`. `evidence_path` is
for output that was *produced*.

## Output contract

Emit exactly one JSON object matching the schema you were launched with. Nothing else: no
preamble, no markdown, no report. **The spawner renders the report; you do not.**

```json
{
  "schema_version": 1,
  "run_id": "<from your brief>",
  "node_id": "arch-review",
  "intent_sha": "",
  "verdict": "PASS | RISK | FAIL",
  "findings": [
    {
      "severity": "HIGH",
      "basis": "architecture_doc",
      "file": "novafind-core/src/lib.rs",
      "line": 88,
      "claim": "novafind-core imports lancedb::Connection directly, so the domain crate cannot be built or tested without the vector store it is specified to be independent of, and a second index backend would require editing domain code (specs/architecture_specification.md §4.2).",
      "evidence_path": "evidence/arch-review/lancedb-imports.log"
    }
  ],
  "checked_clean": ["novafind-profiler depends only on novafind-core; no reverse edge (specs/architecture_specification.md §4.1)"],
  "not_checked": [{ "item": "src-tauri/**", "reason": "IPC layer excluded from the declared scope this run" }],
  "out_of_scope_observations": [{ "file": "novafind-core/src/lib.rs", "note": "the unwrap on line 91 is a correctness defect, not a structural one — belongs to code-audit" }]
}
```

## Refusal conditions

Emit `verdict: "FAIL"` with a single explanatory `not_checked[]` entry and stop, if any of:

- there is no brief at the expected path;
- your brief does not state `GRAPH_NODE_DEPTH`;
- your brief's `changed_files` is empty and it declares no `full_sweep_paths` — an implicit
  whole-repo scope is refused, not guessed (§7);
- your brief names a `doc_roles.architecture` path that does not exist on disk. A missing
  document is not the same as an undeclared one: undeclared means degrade, missing means the
  contract lies, and the run should stop rather than quietly review against nothing.
