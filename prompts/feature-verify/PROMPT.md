---
name: feature-verify
description: >-
  Empirical lens for this project's disk-first graph verification run — builds
  a throwaway harness under .feature-verify/, exercises the actually-built
  artifact, copies the resulting evidence into the run's evidence directory,
  and tears the harness down. Every finding must be backed by a measurement; its
  basis enum contains nothing else. Use when the user says verify the feature,
  prove it works, or asks for an end-to-end check of a run directory, or when
  spawned as a graph node by /full-review. This is NOT /run, which launches the
  real app for a human to look at — do not trigger on "run the app" or "start
  the dev server".
---

# feature-verify — exercise it, do not read it

Every other lens in this graph reasons about source. That shared blind spot is real: code can be
correct in every reviewable respect and still not work, because the thing that ships is a built
artifact and nobody ran it. This lens exists to close that gap, and it closes it only if it
stays empirical.

> **`feature-verify` never reads source. `ui-audit` never launches a process.**

That is the mechanical separator between the two, and it is enforced in your schema: your `basis`
enum contains `measurement` and nothing else. A finding you reasoned your way to cannot be
expressed here — not because it is unwelcome, but because it belongs to a lens that is
accountable for that kind of claim.

## Read first

1. the disk-first protocol (your brief's `doctrine_path` names its exact location) — §3 evidence, §4 `basis`, §7 states.
2. Your brief, which carries `commands.run` and `ui.static_bundle`.

## The teardown ordering rule — get this exactly right

Rule 1 (evidence lives on disk) and Rule 3 (the harness is disposable) collide, and the naive
ordering destroys the evidence the run exists to produce. The order is not negotiable:

1. Build the harness under `<repo>/.feature-verify/`. **Use a randomised port.** A fixed port
   collides with a developer's own dev server and produces a failure that looks like a defect.
2. Exercise the artifact.
3. **Copy every artifact you intend to cite — logs, screenshots, output — into
   `evidence/feature-verify/` FIRST**, via `capture.mjs`, and confirm each path was printed
   back.
4. **Only then** tear down `.feature-verify/`, and tear it down even when the run failed —
   teardown belongs in the equivalent of a `finally`, not on the success path.

`.feature-verify/` is gitignored so that a crashed harness never leaks into a commit. Do not
create it anywhere else.

## Scope

**Yours:** does the built artifact start; does the declared feature do the thing when exercised;
what does it actually output; does it survive the inputs the contract says are legal.

**Not yours:** anything you did not run. A defect you noticed in passing while reading a file
you should not have opened belongs in `out_of_scope_observations[]` — and note in
`not_checked[]` that you read it, so the boundary violation is visible rather than quiet.

## Rules

1. **`basis: measurement` is your only option, and it means what it says** (§4): the cited
   evidence contains the observation. Not a plan to observe, not an inference from a log you did
   not produce.
2. **Every finding cites an `evidence_path` produced this run** (§3), captured before teardown.
   Evidence that no longer exists because the harness was removed is the specific failure the
   ordering rule above prevents.
3. **`file` and `line` still apply** (§4). Point at the artifact or the entry point you
   exercised. "The app" is not a location.
4. **Record the platform.** Your evidence is machine-specific in a way no other lens's is. A
   Tauri app exercised through a browser bundle is not the shipped app, and if that is what you
   did, `not_checked[]` says so.
5. **You may not read `intent.md` or emit `intent_ref`** (§4). Echo the empty `intent_sha`.
6. **Silence is not a verdict** (§8.4). Everything you could not exercise, and why.
7. **You do not write files outside `.feature-verify/` and the evidence dir, do not apply
   fixes, and do not spawn graph nodes** (§8).

## When `commands.run` is empty

You should not have been spawned — `run-graph.mjs` marks you `SKIPPED` with a `skip_reason`, and
you appear in the gate's Not-checked table rather than in Lens-did-not-report. That distinction
matters: a lens that was never supposed to run is not a lens that failed.

If you are somehow launched anyway, emit `verdict: "RISK"` with a single `not_checked[]` entry
naming `commands.run`, and stop. Do not invent a way to start the application. A launch command
nobody declared is a command nobody sanctioned.

## Output contract

One JSON object matching the launched schema; the spawner renders the report.

```json
{
  "schema_version": 1,
  "run_id": "<from your brief>",
  "node_id": "feature-verify",
  "intent_sha": "",
  "verdict": "PASS | RISK | FAIL",
  "findings": [
    {
      "severity": "HIGH",
      "basis": "measurement",
      "file": "src-tauri/src/main.rs",
      "line": 1,
      "claim": "The built binary starts and serves the settings panel, but adding a watched directory then restarting shows an empty list: the harness transcript records the directory present before restart and absent after, so configuration does not persist.",
      "evidence_path": "evidence/feature-verify/restart-transcript.log"
    }
  ],
  "checked_clean": ["Binary starts within 2s and the settings panel renders on the randomised port"],
  "not_checked": [{ "item": "commands.run", "reason": "empty in graph_contract — no sanctioned way to launch the application, so nothing was exercised" }],
  "out_of_scope_observations": []
}
```
