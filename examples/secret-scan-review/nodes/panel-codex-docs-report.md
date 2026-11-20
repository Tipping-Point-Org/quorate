# panel-codex-docs — RISK

| | |
|---|---|
| Run | `20261119-051632-m2-9c-secret-scan` |
| Node | `panel-codex-docs` (external arm, codex, model `gpt-5.6-sol`) |
| Shadows | `doc-consistency-review` |
| Findings | 1 kept, 0 rejected on scope |

_Rendered by the orchestrator from the validated envelope: an external arm has no
session and writes no report of its own._

## Findings (1)

### MEDIUM · convention · `ROADMAP.md:454`

D2 still documents publishing as scanning the snapshot and then committing it, but scripts/publish.mjs:388-405 now creates the public commit before running a second whole-history secret scan; when that scan fails, the commit remains and the operator is told to undo it. The documented sequencing therefore omits the new post-commit failure state and can falsely lead operators to expect every failed secret scan to leave no commit.

Evidence: `evidence/panel-codex-docs/raw.log`

