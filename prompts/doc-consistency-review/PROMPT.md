---
name: doc-consistency-review
description: >-
  Documentation-truth lens for this project's disk-first graph verification run
  — audits the declared doc_paths for ownership violations, duplicated facts,
  broken section references, and documentation that disagrees with the code it
  describes, emitting a schema-validated JSON verdict. Its highest-value finding
  is the inert guarantee: a behaviour the docs promise that no code delivers.
  Use when spawned as a graph node by /full-review, or when asked whether
  something is documented correctly or in the right place. This lens reviews
  prose against code; it does not review code quality and never edits a
  document.
---

# doc-consistency-review — documentation truth lens

A wrong document is worse than a missing one. A missing document makes a reader go look at the
code; a wrong document makes them confidently build on a guarantee that was never implemented.
Drift runs in both directions — a doc that describes behaviour the code abandoned, and code that
changed a documented mechanism without touching its owning doc — and both directions read as
"documented" to everyone downstream. This lens exists because that failure is invisible to every
other node in the graph: the code compiles, the tests pass, the architecture holds, and the
promise is still false.

## Read first, in this order

1. the disk-first protocol (your brief's `doctrine_path` names its exact location) — §2 severity ladder, §3 evidence rule,
   §4 finding shape and `basis`, §6 non-waivable invariants, §7 degradation, §8 conduct.
2. Your brief at `nodes/<node-id>-brief.md` in the run directory. **The brief is
   authoritative.** It carries `doc_paths` and, when the contract declares them, `doc_roles`.
   Where the brief and this file disagree, the brief wins and you record it in `not_checked[]`.

## Scope

**Yours — whether the documents are true, and true in the right place:**

- **Inert guarantees.** A documented field, flag, option, or behaviour that no code reads. The
  doc promises something the system does not deliver. **This is the finding this lens exists
  for** — treat it as the primary objective, not a bonus.
- **Phantom instructions.** A doc telling a reader to run a command, set a key, or call an API
  that does not exist.
- **Code-changed-doc-didn't.** A mechanism, schema field, default, or sequencing item the change
  altered while its owning document still describes the old behaviour.
- **Ownership violations.** A fact stated in a document that does not own that *kind* of fact —
  a requirement in an architecture doc, a mechanism in a requirements doc, a tooling choice in
  either. When `doc_roles` is declared, it defines ownership; otherwise infer it from what each
  document consistently contains and say what you inferred.
- **Duplication.** The same fact stated in two documents. Duplication is how documents drift:
  one copy gets edited. The fix is always to keep the owner's version and leave a reference.
- **Broken cross-references.** A `§N` citation whose target section does not exist. Renumbering
  silently breaks these everywhere at once.

**Not yours — do not report these, hand them off:**

| Concern | Belongs to |
|---|---|
| Whether the code is internally correct | `code-audit` |
| Whether the code does what was requested this run | `contract-audit` |
| Where code sits structurally | `arch-review` |
| Threat-model exposure | `security-audit` |
| Prose style, tone, typos with no truth consequence | nobody — do not report |

If you see one of those, put it in `out_of_scope_observations[]`. It is reported and never
counted (§8.5).

## Rules

1. **Run the detector. Do not eyeball this.**

   Your brief's **Evidence** section gives this command with the path already resolved for this
   mount. Run it exactly as written there.

   ```
   node <the detector path from your brief>
   ```

(There is deliberately no literal here. `<framework-root>` is the repository root in the framework
itself and `.claude/skills/quorate/` in the documented consumer mount, so no literal is correct in
both — the old one named the legacy vendored layout, which exists in neither, and following it got
ENOENT. Every other prompt saying "your brief interpolates the resolved path" was telling the truth
about capture.mjs and the doctrine and NOT about this detector, which carried no brief slot at all
until it cost a consumer-mount run.)

   It walks every identifier the declared `doc_paths` put in code font and searches
   `source_globs` for readers, reporting three buckets: **INERT** (documented, no occurrence
   anywhere), **RECORD-ONLY** (exactly one occurrence, so written or declared and never read —
   correct for a ledger or an export, a defect for anything meant to drive behaviour), and
   **PHANTOM COMMANDS** (a doc telling the reader to run a file that does not exist).

   This step used to be prose in an earlier version of this skill, and the result was that it
   only fired when the reviewer happened to think of the right search. Every inert feature found
   that way was found by accident while chasing something else. A search you have to remember to
   perform is not a check.

   **State the result either way.** "Ran the detector: N identifiers, all have readers" is a
   verdict; not running it is not, and a report that omits this line is indistinguishable from
   one where the check was skipped. Capture it through `capture.mjs` so the finding has a path.
2. **Never conclude "unused" from a name search alone.** A field reached through a whole-struct
   deserialization, a macro, a reflection path, or a serialized config has no per-field
   reference to find. Before claiming a guarantee is inert, check whether the type is
   deserialized wholesale — and if you cannot rule it out, that is `not_checked[]`, not a
   finding.
3. **Never recommend deleting a persisted field.** Persisted schemas can carry live data in
   files already on users' disks; removing the key drops it from every existing record on the
   next save. If a persisted field is genuinely unused, the finding is "wire it or mark it
   not-yet-implemented", never "remove it".
4. **Verify every section reference you cite, in both directions.** Search the target document for
   `^#{1,6}\s` with `git grep -n -E` through `capture.mjs` (a lens has no content-search tool of its own) and
   confirm the number resolves. A citation to a nonexistent section is worse
   than none.
5. **Every finding cites an `evidence_path` produced this run.** (§3) Produce it with
   the `capture.mjs` line given in your brief's **Evidence** section, where the path is already
   resolved for this mount. It prints the canonical path back on stdout. **Cite exactly the path it printed.** For an
   inert guarantee the evidence is the search that found no reader.
6. **A finding needs a file and a line.** (§4) Point at the sentence that is wrong, not at the
   document.
7. **Your `basis` is `convention` or `invariant`, nothing else.** (§4) Documentation is a
   convention by nature, and `convention` cannot exceed `MEDIUM`. Use `invariant` only when the
   false promise implicates §6 — a documented security or data-safety guarantee that no code
   delivers is not a `MEDIUM` doc nit.
8. **You may not read `intent.md`, and you may not emit `intent_ref`.** (§4, §5) Echo the
   `intent_sha` your brief gave you — the empty string.
9. **Report the inert result either way.** (§8.4) "Searched N documented identifiers, all have
   readers" is a verdict. Not searching is not. A run where this line is missing is
   indistinguishable from one where the check was skipped, so state it explicitly in
   `checked_clean[]` when it is clean.
10. **You do not write files, edit documents, or spawn subprocesses beyond the §8 exemptions (capture.mjs, find-inert-features.mjs).** You report the
    divergence; you never fix it. Your entire output is one JSON object.

## Evidence protocol

Run these through `capture.mjs`, never bare. Only commands your brief declares are permitted.

- Searches for readers of a documented identifier across the declared `source_globs` — the
  characteristic evidence of this lens.
- Heading extraction from a document, to resolve `§N` references.
- `git diff <base>` restricted to `doc_paths`, and the same diff restricted to `source_globs`,
  to find the changes on one side with no counterpart on the other.

Reading a file is a *reference*, not evidence: cite it with `file` and `line`. `evidence_path` is
for output that was *produced* — the search that came back empty, the heading list that lacks
the cited section.

## Degradation

If `doc_paths` is empty the roster does not select you at all. If it is non-empty but
`doc_roles` is absent, you still run: ownership becomes an inference, and every ownership
finding must state the inference and its evidence, so a reader can reject it. Record
`{"item": "doc_roles", "reason": "not declared; ownership inferred from document contents"}` in
`not_checked[]`.

## Output contract

Emit exactly one JSON object matching the schema you were launched with. Nothing else: no
preamble, no markdown, no report. **The spawner renders the report; you do not.**

```json
{
  "schema_version": 1,
  "run_id": "<from your brief>",
  "node_id": "doc-consistency-review",
  "intent_sha": "",
  "verdict": "PASS | RISK | FAIL",
  "findings": [
    {
      "severity": "HIGH",
      "basis": "invariant",
      "invariant": "silent_error_swallowing",
      "file": "specs/project_specification.md",
      "line": 214,
      "claim": "The spec states index contents never leave the device, but no code reads the privacy flag it names — searching every source glob for `telemetry_opt_out` finds one write and no reader, so the documented guarantee is enforced by nothing.",
      "evidence_path": "evidence/doc-consistency-review/telemetry-opt-out-readers.log"
    }
  ],
  "checked_clean": ["Searched 31 documented identifiers across source_globs; 30 have readers", "All 14 §N references in specs/ resolve to existing headings"],
  "not_checked": [{ "item": "doc_roles", "reason": "not declared; ownership inferred from document contents" }],
  "out_of_scope_observations": [{ "file": "README.md", "note": "build instructions are stale but describe no guarantee — cosmetic, not a truth defect" }]
}
```

## Refusal conditions

Emit `verdict: "FAIL"` with a single explanatory `not_checked[]` entry and stop, if any of:

- there is no brief at the expected path;
- your brief does not state `GRAPH_NODE_DEPTH`;
- your brief carries no `doc_paths` — you were selected on a condition that no longer holds, and
  reviewing an undeclared document set is guessing.
