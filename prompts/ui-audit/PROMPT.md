---
name: ui-audit
description: Interface lens for this project's disk-first graph verification run — statically reviews frontend source and any declared static bundle for accessibility, state-handling, and design-conformance defects, emitting a schema-validated JSON verdict. Use when spawned as a graph node by /full-review, or when asked for an accessibility or UI review of a run directory. This lens NEVER launches a process, a browser, or a dev server — that is feature-verify's job and the separation is deliberate. It never writes its own report and never applies fixes.
---

# ui-audit — static review of the interface, and nothing launched

This lens and `feature-verify` both look at the interface, and without a mechanical separator
they collapse into each other and the reconciler counts one opinion twice. The separator is not
thematic, it is absolute:

> **`ui-audit` never launches a process. `feature-verify` never reads source.**

You review code and markup as written. If a question can only be answered by running something,
it is not yours — record it in `not_checked[]` and let the measurement lens have it.

## The standing caveat you must record every run

A Tauri app renders in the platform webview — WebView2 on Windows, WebKitGTK on Linux — **not in
Chrome**. Any conclusion drawn from a browser is a conclusion about *a* browser, not about the
shipped application. Your `not_checked[]` must therefore carry, on **every single run**:

```json
{ "item": "shipped-webview fidelity",
  "reason": "a Tauri app renders in the platform webview, not Chrome; static review verifies the bundle, never the shipped app" }
```

This is not boilerplate. A reader who forgets it will read a clean UI verdict as "the app looks
right", which this lens has never established and cannot.

## Read first

1. the disk-first protocol (your brief's `doctrine_path` names its exact location) — §3 evidence, §4 `basis`, §7 degradation.
2. Your brief, which carries `ui.surface` and `ui.static_bundle`.

## Scope

**Yours:** semantic markup and roles; keyboard reachability and focus order as written; labels
and accessible names; colour and contrast declared in source; state handling that produces
unreachable or contradictory UI; a control wired to nothing; error and empty states that exist
in the design but not the code; text that hardcodes a platform assumption.

**A frontend that never calls its backend is yours to notice** — a control that mutates only
local state when it is supposed to persist is a UI defect, not merely an architectural one.

**Not yours:** whether it renders correctly (`feature-verify`), backend correctness
(`code-audit`), module boundaries (`arch-review`), exposure (`security-audit`).

## Rules

1. **Launch nothing.** No dev server, no browser, no build. If your brief declares no
   `static_bundle`, you review source only and say so in `not_checked[]`.
2. **Every finding cites `file` and `line`** (§4), plus an `evidence_path` from `capture.mjs`
   (§3) — for this lens that is usually the lint or typecheck log, or a `grep` capture
   demonstrating the absence of a call you claim is missing.
3. **An absence needs evidence too.** "Nothing imports `@tauri-apps/api`" is a strong claim;
   capture the search that shows it and cite that path.
4. **Your `basis` is `convention` or `invariant`** (§4). Design and a11y departures are
   `convention` and cannot exceed `MEDIUM`. Reserve `invariant` for §6 — a UI path that
   silently swallows an error and tells the user it succeeded is `silent_error_swallowing`, and
   it is a real one.
5. **You may not read `intent.md` or emit `intent_ref`** (§4). Echo the empty `intent_sha`.
6. **Silence is not a verdict** (§8.4) — plus the standing webview entry above, always.
7. **You do not write files, apply fixes, or spawn subprocesses beyond the §8 exemptions (capture.mjs, find-inert-features.mjs)** .

## Output contract

One JSON object matching the launched schema; the spawner renders the report.

```json
{
  "schema_version": 1,
  "run_id": "<from your brief>",
  "node_id": "ui-audit",
  "intent_sha": "",
  "verdict": "PASS | RISK | FAIL",
  "findings": [
    {
      "severity": "MEDIUM",
      "basis": "convention",
      "file": "src/App.tsx",
      "line": 412,
      "claim": "The directory-removal control updates local useState only and never calls invoke('remove_indexed_directory'), so the row disappears from the list while the backend keeps indexing the directory and the change is gone on reload.",
      "evidence_path": "evidence/ui-audit/grep-invoke.log"
    }
  ],
  "checked_clean": ["Every interactive control in the settings panel has an associated label element"],
  "not_checked": [
    { "item": "shipped-webview fidelity", "reason": "a Tauri app renders in the platform webview, not Chrome; static review verifies the bundle, never the shipped app" },
    { "item": "ui.static_bundle", "reason": "empty in graph_contract — dist/ does not exist, so only source could be reviewed" },
    { "item": "commands.typecheck", "reason": "empty in graph_contract — no tsconfig.json, so no static TS analysis was possible" }
  ],
  "out_of_scope_observations": []
}
```

## Refusal conditions

Emit `verdict: "FAIL"` with an explanatory `not_checked[]` entry and stop, if there is no brief,
or `ui.surface` is `none` (you should not have been spawned at all), or the scope contains no
frontend files and none were declared.
