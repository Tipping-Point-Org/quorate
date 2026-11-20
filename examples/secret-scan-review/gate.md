# Gate — FAIL · every node reported

| | |
|---|---|
| Run | `20261119-051632-m2-9c-secret-scan` |
| Scope | human-asserted: `.gitleaksignore`, `CLAUDE.md`, `README.md`, `publish/CLAUDE.public.md`, `publish/manifest.json`, `scripts/lib/publish.mjs`, `scripts/publish.mjs`, `tests/regression-argv-adoption.test.mjs`, `tests/regression-arms-surface-ars-r3.test.mjs`, `tests/regression-arms-surface-ars-r5.test.mjs`, `tests/regression-arms-surface-link-classes.test.mjs`, `tests/regression-ledger-review-ltr3-remediation.test.mjs`, `tests/regression-panel-runtime.test.mjs`, `tests/regression-publish.test.mjs`, `tests/regression-vendor-stderr-off-the-tracked-side.test.mjs` |
| Stamps | `UNSWEPT-DIFF`, `UNBENCHED`, `CONTRACT-PARTIAL`, `UNCAPPED-BUDGET` |
| Pre-flight | ran in this run |
| Ceiling | PASS |
| Cost | $6.9917 |
| Framework | `quorate` 0.2.0 @ `c9c0ae95` (plugin) |

## Nodes

| Node | Required | State | Verdict | Findings |
|---|---|---|---|---|
| `contract-audit` | yes | `OK` | RISK | 1 |
| `code-audit` | yes | `OK` | PASS | 0 |
| `security-audit` | yes | `OK` | PASS | 0 |
| `arch-review` | yes | `OK` | PASS | 0 |
| `doc-consistency-review` | no | `OK` | PASS | 0 |
| `perf-audit` | no | `OK` | RISK | 0 |
| `ui-audit` | no | `SKIPPED` | — | 0 |
| `feature-verify` | no | `SKIPPED` | — | 0 |
| `panel-codex-arch` | no | `OK` | RISK | 2 |
| `panel-codex-contract` | no | `OK` | RISK | 8 |
| `panel-codex-code` | no | `OK` | RISK | 2 |
| `panel-codex-security` | no | `OK` | RISK | 2 |
| `panel-codex-docs` | no | `OK` | RISK | 1 |
| `panel-codex-perf` | no | `OK` | RISK | 3 |

## Not checked

- **`intent-capture`** — doc snapshot shared__adapter-contract.md — <repo>\shared\adapter-contract.md and <repo>\.claude\skills\quorate\shared\adapter-contract.md share the snapshot name shared__adapter-contract.md; the node reads only <repo>\.claude\skills\quorate\shared\adapter-contract.md
- **`intent-capture`** — doc snapshot shared__bench-corpus.md — <repo>\shared\bench-corpus.md and <repo>\.claude\skills\quorate\shared\bench-corpus.md share the snapshot name shared__bench-corpus.md; the node reads only <repo>\.claude\skills\quorate\shared\bench-corpus.md
- **`intent-capture`** — doc snapshot shared__claude-md-contract.md — <repo>\shared\claude-md-contract.md and <repo>\.claude\skills\quorate\shared\claude-md-contract.md share the snapshot name shared__claude-md-contract.md; the node reads only <repo>\.claude\skills\quorate\shared\claude-md-contract.md
- **`intent-capture`** — doc snapshot shared__code-index.md — <repo>\shared\code-index.md and <repo>\.claude\skills\quorate\shared\code-index.md share the snapshot name shared__code-index.md; the node reads only <repo>\.claude\skills\quorate\shared\code-index.md
- **`intent-capture`** — doc snapshot shared__design-step.md — <repo>\shared\design-step.md and <repo>\.claude\skills\quorate\shared\design-step.md share the snapshot name shared__design-step.md; the node reads only <repo>\.claude\skills\quorate\shared\design-step.md
- **`intent-capture`** — doc snapshot shared__disk-first-protocol.md — <repo>\shared\disk-first-protocol.md and <repo>\.claude\skills\quorate\shared\disk-first-protocol.md share the snapshot name shared__disk-first-protocol.md; the node reads only <repo>\.claude\skills\quorate\shared\disk-first-protocol.md
- **`intent-capture`** — doc snapshot shared__external-reviewers.md — <repo>\shared\external-reviewers.md and <repo>\.claude\skills\quorate\shared\external-reviewers.md share the snapshot name shared__external-reviewers.md; the node reads only <repo>\.claude\skills\quorate\shared\external-reviewers.md
- **`intent-capture`** — doc snapshot shared__graph-topologies.md — <repo>\shared\graph-topologies.md and <repo>\.claude\skills\quorate\shared\graph-topologies.md share the snapshot name shared__graph-topologies.md; the node reads only <repo>\.claude\skills\quorate\shared\graph-topologies.md
- **`intent-capture`** — doc snapshot shared__ledger-transitions.md — <repo>\shared\ledger-transitions.md and <repo>\.claude\skills\quorate\shared\ledger-transitions.md share the snapshot name shared__ledger-transitions.md; the node reads only <repo>\.claude\skills\quorate\shared\ledger-transitions.md
- **`intent-capture`** — doc snapshot shared__remediation.md — <repo>\shared\remediation.md and <repo>\.claude\skills\quorate\shared\remediation.md share the snapshot name shared__remediation.md; the node reads only <repo>\.claude\skills\quorate\shared\remediation.md
- **`intent-capture`** — doc snapshot shared__scaffold-contract.md — <repo>\shared\scaffold-contract.md and <repo>\.claude\skills\quorate\shared\scaffold-contract.md share the snapshot name shared__scaffold-contract.md; the node reads only <repo>\.claude\skills\quorate\shared\scaffold-contract.md
- **`intent-capture`** — doc snapshot shared__session-rules.md — <repo>\shared\session-rules.md and <repo>\.claude\skills\quorate\shared\session-rules.md share the snapshot name shared__session-rules.md; the node reads only <repo>\.claude\skills\quorate\shared\session-rules.md
- **`intent-capture`** — doc snapshot shared__telemetry.md — <repo>\shared\telemetry.md and <repo>\.claude\skills\quorate\shared\telemetry.md share the snapshot name shared__telemetry.md; the node reads only <repo>\.claude\skills\quorate\shared\telemetry.md
- **`intent-capture`** — doc snapshot shared__unverified-claims.md — <repo>\shared\unverified-claims.md and <repo>\.claude\skills\quorate\shared\unverified-claims.md share the snapshot name shared__unverified-claims.md; the node reads only <repo>\.claude\skills\quorate\shared\unverified-claims.md
- **`ui-audit`** — condition not met: {"type":"not_equal","key":"ui.surface","value":"none"}
- **`feature-verify`** — condition not met: {"type":"nonempty","key":"commands.run"}
- **`commands.lint`** — empty in graph_contract — lint could not be run, and nothing in this run substitutes for it
- **`commands.fmt_check`** — empty in graph_contract — fmt_check could not be run, and nothing in this run substitutes for it
- **`commands.typecheck`** — empty in graph_contract — typecheck could not be run, and nothing in this run substitutes for it
- **`commands.bench`** — empty in graph_contract — bench could not be run, and nothing in this run substitutes for it
- **`commands.run`** — empty in graph_contract — run could not be run, and nothing in this run substitutes for it
- **`commands.audit`** — empty in graph_contract — audit could not be run, and nothing in this run substitutes for it
- **`commands.deny`** — empty in graph_contract — deny could not be run, and nothing in this run substitutes for it
- **`commands.test_product`** — empty in graph_contract — test_product could not be run, and nothing in this run substitutes for it
- **`budget.per-node`** — uncapped by contract — no per-node dollar ceiling was enforced on this run (UNCAPPED-BUDGET)
- **`budget.per-barrier`** — uncapped by contract — no per-barrier dollar ceiling was enforced on this run (UNCAPPED-BUDGET)
- **`budget.per-run`** — uncapped by contract — no per-run dollar ceiling was enforced on this run (UNCAPPED-BUDGET)
- **`ui.static_bundle`** — not declared — ui-audit reviewed source only; no built bundle or shipped webview was inspected

## Out of scope, observed (not counted)

- **`panel-codex-contract`** `.gitleaksignore` — file matches no declared glob — reported, not counted (§8.5) — The block for public commit 2a669ba0 contains the exact line-563 fingerprint twice, leaving only 12 unique fingerprints rather than the required 13.

_Reported because a lens saw them; not tallied, because nobody scoped them._
