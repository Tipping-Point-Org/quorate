# panel-codex-perf — RISK

| | |
|---|---|
| Run | `20261119-051632-m2-9c-secret-scan` |
| Node | `panel-codex-perf` (external arm, codex, model `gpt-5.6-sol`) |
| Shadows | `perf-audit` |
| Findings | 3 kept, 0 rejected on scope |

_Rendered by the orchestrator from the validated envelope: an external arm has no
session and writes no report of its own._

## Findings (3)

### LOW · convention · `scripts/lib/publish.mjs:212`

scanText permits zero-width regular expressions and recomputes SHA-256 over the complete line for every match; an empty regex on an N-character user-controlled line produces about N buffered hits and O(N²) hashing work, risking excessive CPU and memory during publish. Static risk only because no benchmark is declared.

Evidence: `evidence/panel-codex-perf/raw.log`

### LOW · convention · `scripts/publish.mjs:254`

The gitleaks-report loop synchronously rereads and splits an entire staged file for every finding; H findings in an S-byte file cause O(H×S) I/O and allocation, quadratic when file size grows with finding count, even though manifest validation now prohibits gitleaks allowances. Static risk only because no benchmark is declared.

Evidence: `evidence/panel-codex-perf/raw.log`

### LOW · convention · `scripts/lib/publish.mjs:342`

applyAllowances linearly searches all A allowances for each of H scan hits, producing O(H×A) comparisons and quadratic behavior when the user-controlled allowance and hit collections grow together. Static risk only because no benchmark is declared.

Evidence: `evidence/panel-codex-perf/raw.log`

