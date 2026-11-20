# panel-codex-security — RISK

| | |
|---|---|
| Run | `20261119-051632-m2-9c-secret-scan` |
| Node | `panel-codex-security` (external arm, codex, model `gpt-5.6-sol`) |
| Shadows | `security-audit` |
| Findings | 2 kept, 0 rejected on scope |

_Rendered by the orchestrator from the validated envelope: an external arm has no
session and writes no report of its own._

## Findings (2)

### MEDIUM · convention · `scripts/publish.mjs:388`

The publisher commits the snapshot before running the public repository's whole-history secret scan; when that scan fails, the error path never resets the commit, so the rejected snapshot remains at HEAD ready for an ordinary push and may leave the machine despite publish reporting failure.

Evidence: `evidence/panel-codex-security/raw.log`

### MEDIUM · convention · `scripts/publish.mjs:399`

A missing scripts/check-secrets.mjs only produces a notice and the publish still succeeds, so a master commit that removes or renames the checker bypasses the whole-history scan and leaves an unchecked release commit ready to push; the current head contains the checker, making this reachable when such a commit becomes the release source.

Evidence: `evidence/panel-codex-security/raw.log`

