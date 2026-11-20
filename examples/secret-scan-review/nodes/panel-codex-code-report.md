# panel-codex-code — RISK

| | |
|---|---|
| Run | `20261119-051632-m2-9c-secret-scan` |
| Node | `panel-codex-code` (external arm, codex, model `gpt-5.6-sol`) |
| Shadows | `code-audit` |
| Findings | 2 kept, 0 rejected on scope |

_Rendered by the orchestrator from the validated envelope: an external arm has no
session and writes no report of its own._

## Findings (2)

### MEDIUM · convention · `scripts/publish.mjs:388`

The release commit is created before the public-history scan runs, so a scan failure returns exit 1 with `--out` already advanced to a rejected commit; retrying from that clean but contaminated clone stacks another commit and the whole-history failure persists until HEAD is repaired manually.

Evidence: `evidence/panel-codex-code/raw.log`

### MEDIUM · convention · `scripts/publish.mjs:399`

The missing-script branch treats absence of `scripts/check-secrets.mjs` as success after logging, so an exclusion or snapshot error can remove the validation it is meant to perform; the publish exits 0 and leaves a release commit whose public-history scan never ran.

Evidence: `evidence/panel-codex-code/raw.log`

