# panel-codex-arch — RISK

| | |
|---|---|
| Run | `20261119-051632-m2-9c-secret-scan` |
| Node | `panel-codex-arch` (external arm, codex, model `gpt-5.6-sol`) |
| Shadows | `arch-review` |
| Findings | 2 kept, 0 rejected on scope |

_Rendered by the orchestrator from the validated envelope: an external arm has no
session and writes no report of its own._

## Findings (2)

### MEDIUM · convention · `scripts/publish.mjs:388`

The publisher commits the candidate to --out before running the final whole-history validation at line 402; a failed scan therefore leaves the rejected release as HEAD and requires manual rollback, instead of validating before changing the target repository, contrary to A-11's rule that what reaches Git is a decision (ARCHITECTURE.md §4).

Evidence: `evidence/panel-codex-arch/raw.log`

### MEDIUM · convention · `scripts/publish.mjs:399`

The orchestration layer directly decides that an absent public scan passes and that a nonzero scan blocks publication, duplicating the scan-outcome policy already assigned to scripts/lib/publish.mjs; this testable release rule belongs in the pure decision layer rather than orchestration (ARCHITECTURE.md §2).

Evidence: `evidence/panel-codex-arch/raw.log`

