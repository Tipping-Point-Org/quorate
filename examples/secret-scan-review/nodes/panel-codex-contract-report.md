# panel-codex-contract — RISK

| | |
|---|---|
| Run | `20261119-051632-m2-9c-secret-scan` |
| Node | `panel-codex-contract` (external arm, codex, model `gpt-5.6-sol`) |
| Shadows | `contract-audit` |
| Findings | 8 kept, 0 rejected on scope |

_Rendered by the orchestrator from the validated envelope: an external arm has no
session and writes no report of its own._

## Findings (8)

### MEDIUM · convention · `publish/manifest.json:4`

The required exclusion list does not include blog/sessions digests, so a tracked digest under blog/sessions would be copied into the public snapshot.

Evidence: `evidence/panel-codex-contract/raw.log`

### MEDIUM · convention · `publish/manifest.json:16`

The Windows-path pattern accepts only backslash paths with a multi-character first component; valid machine-local paths such as <home>/file or C:\x\file pass unnamed.

Evidence: `evidence/panel-codex-contract/raw.log`

### MEDIUM · convention · `scripts/lib/publish.mjs:39`

Allowance identity hashes trimmed line text, so editing only leading or trailing whitespace preserves the allowance even though the contract requires any edited line to lose it.

Evidence: `evidence/panel-codex-contract/raw.log`

### MEDIUM · convention · `scripts/publish.mjs:388`

The public commit is created before check-secrets runs; when that check fails, the commit already remains in --out, contrary to the requirement that failure block the commit.

Evidence: `evidence/panel-codex-contract/raw.log`

### MEDIUM · convention · `scripts/publish.mjs:399`

A snapshot without scripts/check-secrets.mjs is accepted and committed after only a notice, although every committing publish must run the published tree's scanner.

Evidence: `evidence/panel-codex-contract/raw.log`

### MEDIUM · convention · `scripts/publish.mjs:402`

check-secrets inherits terminal output and no result file is written under --out, so the required recorded scan result is absent.

Evidence: `evidence/panel-codex-contract/raw.log`

### MEDIUM · convention · `scripts/publish.mjs:82`

The committing path accepts any syntactically valid --identity not matched by local deny patterns; it does not require Tipping Point Org <dev@tippingpointconsultoria.com.br> and can commit as another identity.

Evidence: `evidence/panel-codex-contract/raw.log`

### MEDIUM · convention · `scripts/publish.mjs:103`

The dirty-tree check deliberately ignores untracked files and later permits those under excluded paths, so a dirty working tree can publish despite the requirement to refuse every dirty tree.

Evidence: `evidence/panel-codex-contract/raw.log`

