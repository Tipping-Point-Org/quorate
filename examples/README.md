# Examples: one review, and the run that fixed what it found

Two real runs from quorate's own repository, made during the 0.3.0 release. quorate reviewed a change to its
own publish script, and a separate, later run fixed what the review confirmed. Together they show the whole
loop: findings with evidence, a gated verdict, then a remediation that proves each fix red before green.

## `secret-scan-review/` — a review that failed

Run `20261119-051632-m2-9c-secret-scan`. Its gate is **FAIL** with every node reported, so the verdict rests
on all of its lenses (see the diagram in the top-level README for the phases).

Read in this order:

1. `gate.md`: the verdict, the stamps and what each caps, the cost, and the Not-checked table.
2. `reconciled.md`: the finding groups the barrier confirmed. **G-10 (HIGH)**: the publish committed the
   release *before* running the public repository's secret scan, so a failing scan left the rejected commit
   at `HEAD`, one ordinary push from leaving the machine. Four arms from another model family raised it.
   **G-11 (MEDIUM)**: a snapshot without the scan script was published after only a notice, and the scan's
   result was not recorded.
3. `intent.md`: the numbered criteria the lenses judged against, written from the documents before any lens
   read the code.
4. `nodes/*-report.md` and `nodes/*.status.json`: each lens's own report, and what the engine recorded about
   the node (model, effort, duration, cost, exit state).
5. `evidence/`: the captured command output the findings cite.

## `secret-scan-remediation/` — the run that fixed G-10 and G-11

Run `20261119-054112-m2-9c-secret-scan-remediation`, minted from the review by `new-run --remediates`. Its
node worked in a fresh context and never saw the review's session.

- `nodes/remediation-brief.md`: what the node was asked to fix.
- `nodes/remediation.status.json`: what the engine recorded about the node.
- `evidence/remediation/red-g10-g11-publish.log`: the new test failing on the code as it was.
- `evidence/remediation/green-g10-g11-publish.log`: the same test passing after the fix.
- `evidence/remediation/payload.json`: the node's report of each fix, with its test.

The follow-up review of this fix (gate RISK) found one more MEDIUM in the new code. A second remediation fixed
it, and the review after that confirmed no MEDIUM on the work's own lines. Those runs are not copied here.

## What was changed when these were copied

These are curated copies, not whole runs.

- **Paths replaced.** Machine-local paths read `<repo>`, `<home>`, `<tmp>`, `<program-files>` or `<public-clone>`, and the
  operator's account name reads `<operator-account>`. Nothing else in the text was edited.
- **Large files left out.** A file over 256 KiB was not copied: the external arms' raw logs
  (`evidence/panel-codex-*/raw.log`), which `reconciled.md` still cites, and the full suite's log. Also left
  out: the lenses' briefs, the sandbox, and the uncited evidence.
- **Hashes no longer match.** Each `report_sha256` and `settings_sha256` describes the original file, so a
  scrubbed copy no longer hashes to it.
